/** Prompt-injection screening and source-grounding checks for language-model output. */
import { normalizeDigits } from "./language";

const INJECTION_PATTERNS: [string, RegExp][] = [
  ["ignore_instructions", /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|earlier|all|system|your)\b.{0,30}\b(instruction|prompt|rule|direction|guideline)s?/i],
  ["role_override", /\b(you are now|act as|pretend to be|roleplay as|from now on you)\b/i],
  ["system_prompt_probe", /\b(system prompt|developer message|hidden instruction|reveal (your|the) (prompt|instructions))\b/i],
  ["jailbreak", /\b(jailbreak|DAN mode|developer mode|do anything now)\b/i],
  ["fabricate_numbers", /\b(make up|invent|fabricate|guess|imagine|hypothetical(ly)?)\b.{0,40}\b(price|prices|rate|forecast|number|figure|data)\b/i],
  ["role_tags", /<\/?(system|assistant|user|tool)>|\[\/?(INST|SYS)\]|<\|im_(start|end)\|>/i],
  ["tool_manipulation", /\b(call|invoke|execute|run)\b.{0,20}\b(tool|function|endpoint|admin|sql|delete|drop table)\b/i],
  ["kannada_ignore", /(ಸೂಚನೆಗಳನ್ನು|ನಿಯಮಗಳನ್ನು).{0,20}(ನಿರ್ಲಕ್ಷಿಸ|ಮರೆತು)/],
];

export function detectInjection(text: string): string[] {
  return INJECTION_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

/** Remove control characters and role tags; collapse whitespace. Applied to every untrusted string sent to a model. */
export function sanitizeUntrusted(text: string, maxLength = 1500): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, " ")
    .replace(/<\|[^|>]*\|>/g, " ")
    .replace(/<\/?(system|assistant|user|tool)>/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

const NUMBER = /(?<![A-Za-z#])-?\d[\d,]*(?:\.\d+)?/g;

/** Every numeric token in the text, after Kannada-digit normalisation and comma removal. */
export function extractNumbers(text: string): number[] {
  const normalised = normalizeDigits(text).replace(/\[(?:S|D|N)\d+\]/g, " ");
  return [...normalised.matchAll(NUMBER)]
    .map((match) => Number(match[0].replace(/,/g, "")))
    .filter((value) => Number.isFinite(value));
}

/** Date tokens like 2026-10-05 or 05-10-2026 split into their parts so grounded dates pass the numeric check. */
function datePartNumbers(text: string): number[] {
  const parts: number[] = [];
  for (const match of normalizeDigits(text).matchAll(/\d{1,4}(?:[-/.]\d{1,4}){1,2}/g)) {
    match[0].split(/[-/.]/).forEach((part) => parts.push(Number(part)));
  }
  return parts;
}

export function allowedNumbers(evidence: string[]): Set<string> {
  const allowed = new Set<string>();
  const add = (value: number) => {
    allowed.add(String(value));
    for (const digits of [0, 1, 2]) allowed.add(String(Number(value.toFixed(digits))));
    allowed.add(String(Math.abs(value)));
  };
  for (const text of evidence) {
    extractNumbers(text).forEach(add);
    datePartNumbers(text).forEach(add);
  }
  return allowed;
}

function matchesAllowed(value: number, allowed: Set<string>) {
  if (Math.abs(value) <= 12 && Number.isInteger(value)) return true;
  if (allowed.has(String(value)) || allowed.has(String(Math.abs(value)))) return true;
  for (const digits of [0, 1, 2]) if (allowed.has(String(Number(value.toFixed(digits))))) return true;
  return false;
}

const DIRECTIONAL_CLAIMS: RegExp[] = [
  /\b(will|is going to|are going to|shall|must|certainly|definitely|surely)\s+(rise|increase|go up|climb|jump|fall|decrease|drop|decline|go down|crash|recover|improve)\b/i,
  /\b(guarantee[ds]?|assured|certain to|risk[- ]free|sure profit|no risk)\b/i,
  /\b(you should|we recommend|i recommend|best to)\s+(sell|hold|buy|store)\b/i,
  /(ಖಂಡಿತ|ಖಚಿತವಾಗಿ).{0,30}(ಏರ|ಇಳಿ|ಹೆಚ್ಚ|ಕಡಿಮೆ)/,
  /(ಏರಲಿದೆ|ಇಳಿಯಲಿದೆ|ಹೆಚ್ಚಾಗಲಿದೆ|ಕಡಿಮೆಯಾಗಲಿದೆ)/,
];

export type GroundingResult = {
  status: "passed" | "failed";
  reasons: string[];
  ungrounded_numbers: number[];
  unknown_citations: string[];
};

/**
 * Accept model prose only if every number it contains is present in the verified evidence, every citation label
 * exists, and it makes no directional price promise or recommendation.
 */
export function checkGrounding(text: string, evidence: string[], citationLabels: string[]): GroundingResult {
  const reasons: string[] = [];
  const allowed = allowedNumbers(evidence);
  const ungrounded = [...new Set(extractNumbers(text).filter((value) => !matchesAllowed(value, allowed)))];
  if (ungrounded.length) reasons.push(`Numbers not present in verified data: ${ungrounded.slice(0, 5).join(", ")}.`);
  const known = new Set(citationLabels);
  // Any short bracketed tag ([S9], [DATA], [Source 1], [1]) must be one of the supplied labels.
  const cited = [...text.matchAll(/\[([^\][\n]{1,24})\]/g)].map((match) => match[1].trim());
  const unknown = [...new Set(cited.filter((label) => !known.has(label)))];
  if (unknown.length) reasons.push(`Unknown citation labels: ${unknown.join(", ")}.`);
  if (DIRECTIONAL_CLAIMS.some((pattern) => pattern.test(text))) reasons.push("Contains a directional price promise or trading recommendation.");
  if (!text.trim()) reasons.push("Empty response.");
  if (/https?:\/\//i.test(text)) reasons.push("Contains a URL; links are supplied only from verified citations.");
  return { status: reasons.length ? "failed" : "passed", reasons, ungrounded_numbers: ungrounded, unknown_citations: unknown };
}

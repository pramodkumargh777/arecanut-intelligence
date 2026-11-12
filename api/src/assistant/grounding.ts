/** Prompt-injection screening and source-grounding checks for language-model output. */
import { normalizeDigits } from "./language";
import { restrictedPesticides } from "./pesticides";
import { namesPlace, PLACES, placeLikeWords, placesIn } from "./places";

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

// A minus sign right after a digit is a range dash ("35-45" is 35 to 45), not a negative number.
const NUMBER = /(?<![A-Za-z#\d])-?\d[\d,]*(?:\.\d+)?/g;

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
  wrong_periods: string[];
  wrong_places: string[];
  /** Sentences dropped because they failed on their own; the rest passed (see compose.ts). */
  removed_sentences?: number;
  /** Model calls made for this answer: 1, or 2 after one corrective retry. */
  attempts?: number;
};

/** The parts of a verified fact the check needs in order to tie a value to its own period and place. */
export type GroundingFact = { label: string; value: unknown; reporting_period: string | null; source_name?: string | null };

// ------------------------------------------------------------------------------------------------
// Claims a reader would act on: a price presented as today's, or a "best price" across different sources.

const TODAY_CLAIMS: RegExp[] = [
  /\b(today|tonight|right now|currently|at present|at the moment|as of now|this morning)\b/i,
  /\bcurrent (price|rate|market|quotation)s?\b/i,
  /(?<![ಀ-೿])(?:ಇಂದು|ಇಂದಿನ|ಈ ದಿನ|ಈಗಿನ|ಪ್ರಸ್ತುತ)/,
];

const RANKING_WORDS = /\b(best|highest|lowest|cheapest|higher than|lower than)\b|ಅತ್ಯುತ್ತಮ|ಉತ್ತಮ ಬೆಲೆ|ಗರಿಷ್ಠ|ಕನಿಷ್ಠ|ಅತಿ ಹೆಚ್ಚ|ಅತ್ಯಧಿಕ|ಹೆಚ್ಚಿನ ಬೆಲೆ|ಕಡಿಮೆ ಬೆಲೆ/i;

/**
 * Prices from different sources are different measures, so a ranking is only valid within one source. With several
 * sources in the data, each ranking sentence must name exactly one source and every source must get its own ranking.
 * Otherwise "the best price is at TSS Sirsi" quietly ranks TSS above MAMCOS.
 */
function rankingAcrossSources(text: string, facts: GroundingFact[]): boolean {
  const sources = [...new Set(facts.flatMap((fact) => typeof fact.value === "number" && fact.source_name ? [fact.source_name.split(" ")[0]] : []))];
  if (sources.length < 2) return false;
  const rankings = splitSentences(text).filter((sentence) => RANKING_WORDS.test(sentence));
  if (!rankings.length) return false;
  const covered = new Set<string>();
  for (const sentence of rankings) {
    const named = sources.filter((source) => new RegExp(`\\b${source}\\b`, "i").test(sentence));
    if (named.length !== 1) return true;
    covered.add(named[0]);
  }
  return covered.size !== sources.length;
}

// ------------------------------------------------------------------------------------------------
// Dates. Any calendar month written by the model must exist in the evidence and match the value beside it.

type DateMention = { year: number | null; month: number; day: number | null; text: string; index: number };

const LATIN_MONTHS = ["Jan(?:uary)?", "Feb(?:ruary)?", "Mar(?:ch)?", "Apr(?:il)?", "May", "June?", "July?", "Aug(?:ust)?", "Sep(?:t(?:ember)?)?", "Oct(?:ober)?", "Nov(?:ember)?", "Dec(?:ember)?"];
const KANNADA_MONTHS = ["ಜನವರಿ", "ಫೆಬ್ರ[ವು]ರಿ|ಫೆಬ್ರುವರಿ", "ಮಾರ್ಚ್", "ಏಪ್ರಿಲ್", "ಮೇ", "ಜೂನ್", "ಜುಲೈ", "ಆಗಸ್ಟ್", "ಸ[ೆ]?ಪ್ಟ[ೆ]?ಂಬರ್", "ಅಕ್ಟೋಬರ್", "ನವೆಂಬರ್", "ಡಿಸೆಂಬರ್"];
const NAMED_MONTHS: { month: number; pattern: RegExp }[] = [
  ...LATIN_MONTHS.map((name, index) => ({
    month: index + 1,
    // "may" is a common English word, so May counts only beside a number or after "in/of/during".
    pattern: new RegExp(name === "May" ? String.raw`(?:\bMay\b(?=\s+\d)|(?<=\b(?:in|of|during|for)\s)May\b)` : String.raw`\b(?:${name})\b`, "g"),
  })),
  ...KANNADA_MONTHS.map((name, index) => ({
    month: index + 1,
    // ಮೇ is also a syllable, so it counts only beside a number or the word for month.
    pattern: new RegExp(name === "ಮೇ" ? "(?<![\\u0C80-\\u0CFF])ಮೇ(?=\\s*(?:\\d|ತಿಂಗಳ))" : `(?<![\\u0C80-\\u0CFF])(?:${name})`, "g"),
  })),
];

/** Every calendar date or month in the text: "November 2026", "3 Nov", "2026-10", "03-11-2026", "ನವೆಂಬರ್ 2026". */
export function dateMentions(raw: string): DateMention[] {
  const text = normalizeDigits(raw).replace(/\[(?:S|D|N)\d+\]/g, " ");
  const found: DateMention[] = [];
  for (const match of text.matchAll(/\b((?:19|20)\d{2})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?\b/g)) {
    found.push({ year: Number(match[1]), month: Number(match[2]), day: match[3] ? Number(match[3]) : null, text: match[0], index: match.index });
  }
  for (const match of text.matchAll(/\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.]((?:19|20)\d{2})\b/g)) {
    found.push({ year: Number(match[3]), month: Number(match[2]), day: Number(match[1]), text: match[0], index: match.index });
  }
  for (const { month, pattern } of NAMED_MONTHS) {
    for (const match of text.matchAll(pattern)) {
      const end = match.index + match[0].length;
      const after = /^[,\s]*(?:(\d{1,2})(?:st|nd|rd|th)?(?!\d))?[,\s]*((?:19|20)\d{2})?/.exec(text.slice(end, end + 16));
      const before = /(?:((?:19|20)\d{2})ರ?\s*|(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?)$/.exec(text.slice(Math.max(0, match.index - 12), match.index));
      const year = after?.[2] ?? before?.[1];
      const day = after?.[1] ?? before?.[2];
      found.push({ year: year ? Number(year) : null, month, day: day ? Number(day) : null, text: match[0] + (year ? ` ${year}` : ""), index: match.index });
    }
  }
  return found;
}

/** All months covered by the text, expanding ranges such as "2024-11 to 2026-10". */
function evidenceMonths(texts: string[]) {
  const months = new Set<string>();
  const add = (year: number, month: number) => months.add(`${year}-${month}`);
  for (const text of texts) {
    dateMentions(text).forEach((mention) => {
      if (mention.year) add(mention.year, mention.month);
      else months.add(`*-${mention.month}`);
    });
    for (const range of text.matchAll(/\b((?:19|20)\d{2})-(0[1-9]|1[0-2])(?:-\d{2})?\s+to\s+((?:19|20)\d{2})-(0[1-9]|1[0-2])\b/g)) {
      let index = Number(range[1]) * 12 + Number(range[2]) - 1;
      const last = Number(range[3]) * 12 + Number(range[4]) - 1;
      for (; index <= last && months.size < 6000; index += 1) add(Math.floor(index / 12), (index % 12) + 1);
    }
  }
  return months;
}

function mentionInEvidence(mention: DateMention, months: Set<string>) {
  if (mention.year) return months.has(`${mention.year}-${mention.month}`) || months.has(`*-${mention.month}`);
  return [...months].some((entry) => entry.endsWith(`-${mention.month}`));
}

/** True when a date written beside a value can describe that fact's reporting period. */
function mentionFitsPeriod(mention: DateMention, period: string) {
  const periodDates = dateMentions(period).filter((date) => date.year);
  if (!periodDates.length) return true;
  const months = evidenceMonths([period]);
  if (!mentionInEvidence(mention, months)) return false;
  const exactDay = periodDates.length === 1 ? periodDates[0].day : null;
  return !(mention.day && exactDay && mention.day !== exactDay);
}

function valueMatches(stated: number, fact: number) {
  const value = Math.abs(fact);
  const text = Math.abs(stated);
  return [0, 1, 2].some((digits) => Number(value.toFixed(digits)) === text) || value === text;
}

function splitSentences(text: string) {
  // Abbreviations such as "Rs." and "ರೂ." do not end a sentence, so a price stays with the place named before it.
  return text.split(/(?<!\b(?:Rs|No|Dr|Mr|sp)\.)(?<!(?:ರೂ|ಮಿ|ಮೀ)\.)(?<=[.!?।])\s+|\n+/).map((sentence) => sentence.trim()).filter(Boolean);
}

/** Numbers in a sentence with their positions, leaving out the digits that form part of a date. */
function statedValues(sentence: string) {
  const text = normalizeDigits(sentence).replace(/\[(?:S|D|N)\d+\]/g, (tag) => " ".repeat(tag.length));
  const dateSpans = [...text.matchAll(/\b(?:19|20)\d{2}-\d{2}(?:-\d{2})?\b|\b\d{1,2}[-/.]\d{1,2}[-/.](?:19|20)\d{2}\b/g)].map((match) => [match.index, match.index + match[0].length]);
  return [...text.matchAll(NUMBER)].flatMap((match) => {
    const value = Math.abs(Number(match[0].replace(/,/g, "")));
    const insideDate = dateSpans.some(([start, end]) => match.index >= start && match.index < end);
    return Number.isFinite(value) && value >= IDENTIFYING_VALUE && !insideDate ? [{ value, index: match.index }] : [];
  });
}

/** Only large figures identify a fact; small numbers such as counts or percentages recur by coincidence. */
const IDENTIFYING_VALUE = 100;

function checkDatesAndPlaces(text: string, evidence: string[], facts: GroundingFact[]) {
  const wrongPeriods = new Set<string>();
  const wrongPlaces = new Set<string>();
  const months = evidenceMonths(evidence);
  for (const mention of dateMentions(text)) {
    if (!mentionInEvidence(mention, months)) wrongPeriods.add(`${mention.text} is not in the verified data`);
  }
  const corpus = evidence.join("\n");
  for (const place of placesIn(text)) {
    if (!namesPlace(corpus, place)) wrongPlaces.add(`${place.name} is not in the verified data`);
  }
  for (const word of placeLikeWords(text)) {
    if (!PLACES.some((place) => namesPlace(word, place)) && !corpus.includes(word)) wrongPlaces.add(`${word} is not in the verified data`);
  }

  const numeric = facts.flatMap((fact) => typeof fact.value === "number" && Math.abs(fact.value) >= IDENTIFYING_VALUE ? [{ ...fact, value: fact.value }] : []);
  for (const sentence of splitSentences(text)) {
    const stated = statedValues(sentence).flatMap((item) => {
      const owners = numeric.filter((fact) => valueMatches(item.value, fact.value));
      return owners.length ? [{ ...item, owners }] : [];
    });
    // A date describes the value nearest to it, so "47,174, down from 58,193 in October 2025" dates only the second figure.
    const datesOf = new Map<number, DateMention[]>();
    for (const date of dateMentions(sentence)) {
      const nearest = stated.reduce<(typeof stated)[number] | null>((best, item) => !best || Math.abs(item.index - date.index) < Math.abs(best.index - date.index) ? item : best, null);
      if (nearest) datesOf.set(nearest.index, [...(datesOf.get(nearest.index) ?? []), date]);
    }
    for (const { value, index, owners } of stated) {
      const shown = Math.abs(value).toLocaleString("en-IN");
      const dates = datesOf.get(index) ?? [];
      if (dates.length && !owners.some((fact) => !fact.reporting_period || dates.some((date) => mentionFitsPeriod(date, fact.reporting_period!)))) {
        wrongPeriods.add(`${shown} is reported for ${owners[0].reporting_period}, not ${dates.map((date) => date.text).join(", ")}`);
      }
      // A branch price must name its own branch, so it cannot be pinned on the wrong place. State values need no place.
      const ownerPlaces = owners.map((fact) => placesIn(fact.label).filter((place) => place.level === "local"));
      if (ownerPlaces.every((places) => places.length) && !ownerPlaces.some((places) => places.some((place) => namesPlace(sentence, place)))) {
        wrongPlaces.add(`${shown} belongs to ${[...new Set(ownerPlaces.flat().map((place) => place.name))].join(" or ")}, which the sentence does not name`);
      }
    }
  }
  return { wrongPeriods: [...wrongPeriods], wrongPlaces: [...wrongPlaces] };
}

/**
 * Accept model prose only if every number it contains is present in the verified evidence, every citation label
 * exists, every month and place is real and sits beside its own value, and it makes no directional price promise or
 * recommendation. `noPriceFromToday` rejects any wording that presents an older price as today's.
 */
export function checkGrounding(text: string, evidence: string[], citationLabels: string[], facts: GroundingFact[] = [], scannedEvidence: string[] = [], options: { noPriceFromToday?: boolean } = {}): GroundingResult {
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
  const pesticides = restrictedPesticides(text);
  if (pesticides.length) reasons.push(`Names a banned or restricted pesticide: ${pesticides.join(", ")}.`);
  const { wrongPeriods, wrongPlaces } = checkDatesAndPlaces(text, [...evidence, ...scannedEvidence], facts);
  if (wrongPeriods.length) reasons.push(`Wrong month or date: ${wrongPeriods.slice(0, 3).join("; ")}.`);
  if (wrongPlaces.length) reasons.push(`Wrong place: ${wrongPlaces.slice(0, 3).join("; ")}.`);
  if (options.noPriceFromToday && TODAY_CLAIMS.some((pattern) => pattern.test(text))) {
    wrongPeriods.push("the text speaks of today, but no price in the data is from today");
    reasons.push("Presents an older price as today's.");
  }
  if (rankingAcrossSources(text, facts)) reasons.push("Ranks prices across different sources, which are not comparable.");
  return { status: reasons.length ? "failed" : "passed", reasons, ungrounded_numbers: ungrounded, unknown_citations: unknown, wrong_periods: wrongPeriods, wrong_places: wrongPlaces };
}

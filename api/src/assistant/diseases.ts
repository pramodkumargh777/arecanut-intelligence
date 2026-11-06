/**
 * Arecanut diseases and pests that booklets discuss side by side. A retrieved passage often runs from one disease into
 * the next, and semantic search treats them as near neighbours, so advice can end up attached to the wrong disease:
 * "uproot and burn the palm" belongs to foot rot, not to koleroga. A question naming a disease therefore only receives
 * passages naming that disease, cut before the next one starts. Extend through review, with a Kannada reader.
 */
const KN_START = "(?<![\\u0C80-\\u0CFF])";

export type Disease = { name: string; pattern: RegExp };

export const DISEASES: Disease[] = [
  {
    name: "koleroga (fruit rot)",
    // ಕೊಳೆ ರೋಗ alone means koleroga, but ಸುಳಿ ಕೊಳೆ ರೋಗ (bud rot) and ಬುಡ ಕೊಳೆ ರೋಗ (foot rot) are different diseases.
    // "ಅಡಿಕೆ" is required before ಕಾಯಿ ಕೊಳೆ because ಕಾಯಿ also means a cocoa pod, as in ಚಾರ್ಕೋಲ್ ಕಾಯಿ ಕೊಳೆತ.
    pattern: new RegExp(`\\b(?:kole[\\s-]?roga|mahali|fruit[\\s-]rot|nut[\\s-]rot)\\b|${KN_START}(?<!(?:ಸುಳಿ|ತಿರಿ|ಚಂಡೆ|ಬುಡ|\\))\\s?)ಕೊಳೆ\\s?ರೋಗ|${KN_START}ಅಡಿಕೆ\\s?ಕಾಯಿ\\s?ಕೊಳೆ|${KN_START}ಮಹಾ[ಳಲ]ಿ`, "i"),
  },
  {
    name: "foot rot (anabe)",
    pattern: new RegExp(`\\b(?:foot[\\s-]rot|anabe|ganoderma|basal stem)\\b|${KN_START}ಅಣಬೆ|${KN_START}ಬುಡ\\s?ಕೊಳೆ`, "i"),
  },
  {
    name: "bud rot",
    pattern: new RegExp(`\\b(?:bud[\\s-]rot|crown[\\s-]rot)\\b|${KN_START}ಸುಳಿ\\s?(?:\\(ತಿರಿ\\)\\s?)?ಕೊಳೆ|${KN_START}ತಿರಿ\\s?ಕೊಳೆ|${KN_START}ಚಂಡೆ\\s?ಕೊಳೆ`, "i"),
  },
  { name: "yellow leaf disease", pattern: new RegExp(`\\b(?:yellow[\\s-]leaf|yld)\\b|${KN_START}ಹಳದಿ\\s?ಎಲೆ`, "i") },
  { name: "root grub", pattern: new RegExp(`\\b(?:root[\\s-]grubs?|white[\\s-]grubs?)\\b|${KN_START}ಬೇರು\\s?ಹುಳು`, "i") },
  { name: "stem bleeding", pattern: /\bstem[\s-]bleeding\b/i },
  { name: "inflorescence die-back", pattern: /\binflorescence[\s-](?:die[\s-]?back|dieback)\b/i },
  { name: "spindle bug", pattern: /\bspindle[\s-]bugs?\b/i },
  // Not an arecanut disease. Listed because booklets cover cocoa alongside arecanut, so a cocoa section must end a passage.
  { name: "cocoa", pattern: new RegExp(`\\b(?:cocoa|black pod)\\b|${KN_START}(?:ಕೊಕ್ಕೋ|ಕೊಕೊ|ಕೋಕೋ)`, "i") },
];

export function diseasesNamed(text: string): Disease[] {
  return DISEASES.filter((disease) => disease.pattern.test(text));
}

/** Shorter than this after cutting, the passage only mentions the disease in passing. */
const MIN_FOCUSED_LENGTH = 40;

/**
 * The part of a passage about the asked disease, word for word, with cut ends marked; null when it is about something
 * else. A matching heading keeps the whole passage, because the text under a heading belongs to it.
 */
export function focusOnDisease(text: string, heading: string | null, targets: Disease[]): string | null {
  const positions = targets.map((target) => text.search(target.pattern)).filter((index) => index >= 0);
  if (!positions.length) return heading && targets.some((target) => target.pattern.test(heading)) ? text : null;
  const first = Math.min(...positions);
  const others = DISEASES.filter((disease) => !targets.includes(disease));
  // A few words before the first mention introduce it. A finished sentence there is the end of the previous topic's
  // advice, even when that topic's name fell in the previous passage, so it goes too.
  const before = text.slice(0, first);
  const start = /[.।!?]\s/.test(before) || others.some((disease) => disease.pattern.test(before)) ? first : 0;
  const rest = text.slice(first);
  const stops = others.map((disease) => rest.search(disease.pattern)).filter((index) => index > 0);
  const end = stops.length ? first + Math.min(...stops) : text.length;
  const focused = text.slice(start, end).trim();
  if (text.length >= MIN_FOCUSED_LENGTH && focused.length < MIN_FOCUSED_LENGTH) return null;
  return `${start > 0 ? "… " : ""}${focused}${end < text.length ? " …" : ""}`;
}

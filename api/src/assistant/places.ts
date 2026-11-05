/**
 * Places ANI reports on, with their Kannada spellings. The grounding check uses this list to spot a place that is not
 * in the evidence and to tie each price to the branch or market it belongs to. Extend through review.
 */
export type Place = { name: string; level: "state" | "local"; latin: RegExp; kannada: string[] };

const local = (name: string, latin: RegExp, ...kannada: string[]): Place => ({ name, level: "local", latin, kannada });
const state = (name: string, latin: RegExp, ...kannada: string[]): Place => ({ name, level: "state", latin, kannada });

export const PLACES: Place[] = [
  // Branches and markets in ANI's cooperative feeds.
  local("Shivamogga", /\b(shiv?a?mogg?a|shimoga)\b/i, "ಶಿವಮೊಗ್ಗ"),
  local("Thirthahalli", /\b(thirthahalli|tirthahalli)\b/i, "ತೀರ್ಥಹಳ್ಳಿ"),
  local("Sringeri", /\bsringeri\b/i, "ಶೃಂಗೇರಿ"),
  local("Shikaripura", /\bshikaripura?\b/i, "ಶಿಕಾರಿಪುರ"),
  local("Sagara", /\bsagara?\b/i, "ಸಾಗರ"),
  local("Koppa", /\bkoppa\b/i, "ಕೊಪ್ಪ"),
  local("Channagiri", /\bchannagiri\b/i, "ಚನ್ನಗಿರಿ"),
  local("Soraba", /\bsoraba?\b/i, "ಸೊರಬ"),
  local("Jayapura", /\bjayapura\b/i, "ಜಯಪುರ"),
  local("Hosanagara", /\bhosanagara?\b/i, "ಹೊಸನಗರ"),
  local("Tarikere", /\btarikere\b/i, "ತರೀಕೆರೆ"),
  local("Birur", /\bbirur\b/i, "ಬೀರೂರು", "ಬೀರೂರ"),
  local("Bhadravathi", /\bbhadravathi\b/i, "ಭದ್ರಾವತಿ"),
  local("Sirsi", /\bsirsi\b/i, "ಶಿರಸಿ", "ಸಿರ್ಸಿ", "ಸಿರಸಿ"),
  local("Siddapur", /\bsiddapura?\b/i, "ಸಿದ್ದಾಪುರ", "ಸಿದ್ಧಾಪುರ", "ಸಿದ್ದಪುರ", "ಸಿದ್ಧಪುರ"),
  local("Yellapur", /\byell[ae]pura?\b/i, "ಯಲ್ಲಾಪುರ", "ಯಲ್ಲಪುರ", "ಯೆಲ್ಲಾಪುರ", "ಯೆಲ್ಲಪುರ"),
  // Other arecanut districts and towns.
  local("Tumakuru", /\b(tumakuru|tumkur)\b/i, "ತುಮಕೂರು", "ತುಮಕೂರ"),
  local("Davangere", /\bdavang?ere\b/i, "ದಾವಣಗೆರೆ"),
  local("Puttur", /\bputtur\b/i, "ಪುತ್ತೂರು", "ಪುತ್ತೂರ"),
  local("Mangaluru", /\b(mangaluru|mangalore)\b/i, "ಮಂಗಳೂರು", "ಮಂಗಳೂರ"),
  local("Bantwal", /\bbantwal\b/i, "ಬಂಟ್ವಾಳ"),
  local("Belthangady", /\bbelthangad[iy]\b/i, "ಬೆಳ್ತಂಗಡಿ"),
  local("Sullia", /\bsull?ia\b/i, "ಸುಳ್ಯ"),
  local("Kumta", /\bkumta\b/i, "ಕುಮಟಾ"),
  local("Honnavar", /\bhonnavar\b/i, "ಹೊನ್ನಾವರ"),
  local("Uttara Kannada", /\b(uttara kannada|north kanara)\b/i, "ಉತ್ತರ ಕನ್ನಡ"),
  local("Dakshina Kannada", /\b(dakshina kannada|south kanara)\b/i, "ದಕ್ಷಿಣ ಕನ್ನಡ"),
  local("Chikkamagaluru", /\bchikka?magalur(u)?\b/i, "ಚಿಕ್ಕಮಗಳೂರು", "ಚಿಕ್ಕಮಗಳೂರ"),
  local("Udupi", /\budupi\b/i, "ಉಡುಪಿ"),
  local("Hassan", /\bhassan\b/i, "ಹಾಸನ"),
  local("Kodagu", /\b(kodagu|coorg)\b/i, "ಕೊಡಗು"),
  local("Chitradurga", /\bchitradurga\b/i, "ಚಿತ್ರದುರ್ಗ"),
  local("Haveri", /\bhaveri\b/i, "ಹಾವೇರಿ"),
  local("Mandya", /\bmandya\b/i, "ಮಂಡ್ಯ"),
  local("Mysuru", /\b(mysuru|mysore)\b/i, "ಮೈಸೂರು", "ಮೈಸೂರ"),
  local("Bengaluru", /\b(bengaluru|bangalore)\b/i, "ಬೆಂಗಳೂರು", "ಬೆಂಗಳೂರ"),
  local("Kasaragod", /\b(kasara?god)\b/i, "ಕಾಸರಗೋಡು", "ಕಾಸರಗೋಡ"),
  local("Vittal", /\bvittal\b/i, "ವಿಟ್ಲ"),
  // States never decide which branch a price belongs to, so a sentence need not repeat them.
  state("Karnataka", /\bkarnataka\b/i, "ಕರ್ನಾಟಕ"),
  state("Kerala", /\bkerala\b/i, "ಕೇರಳ"),
  state("Assam", /\bassam\b/i, "ಅಸ್ಸಾಂ"),
  state("Tamil Nadu", /\btamil nadu\b/i, "ತಮಿಳುನಾಡು"),
  state("Maharashtra", /\bmaharashtra\b/i, "ಮಹಾರಾಷ್ಟ್ರ"),
  state("Goa", /\bgoa\b/i, "ಗೋವಾ"),
  state("West Bengal", /\bwest bengal\b/i, "ಪಶ್ಚಿಮ ಬಂಗಾಳ"),
];

const KANNADA_LETTER = "\\u0C80-\\u0CFF";

/** Kannada spellings match at the start of a word, so an inflected form such as ಸಿದ್ದಾಪುರದಲ್ಲಿ still counts. */
const kannadaPatterns = new Map(PLACES.map((place) => [place, place.kannada.map((word) => new RegExp(`(?<![${KANNADA_LETTER}])${word}`))]));

export function namesPlace(text: string, place: Place): boolean {
  return place.latin.test(text) || (kannadaPatterns.get(place) ?? []).some((pattern) => pattern.test(text));
}

export function placesIn(text: string): Place[] {
  return PLACES.filter((place) => namesPlace(text, place));
}

const TOPONYM_ENDING_KN = new RegExp(
  `(?<![${KANNADA_LETTER}])([${KANNADA_LETTER}]+?(?:ಪುರ|ಹಳ್ಳಿ|ಪೇಟೆ|ಗೆರೆ|ಕೋಟೆ))(?:ದಲ್ಲೂ|ದಲ್ಲಿ|ದಿಂದ|ಯಲ್ಲೂ|ಯಲ್ಲಿ|ಯಿಂದ|ಕ್ಕೆ|ದ|ಯ|ಗೆ)?(?![${KANNADA_LETTER}])`,
  "g",
);
const TOPONYM_ENDING_LATIN = /\b[A-Z][a-z]{2,}(?:pura?|puram|halli|pete?|kote|gere)\b/g;

/**
 * Words shaped like a place name (…ಪುರ, …ಹಳ್ಳಿ, …pur, …halli). These catch a place the list above has never heard of,
 * such as a model inventing ತುಳಸೀಪುರ for Siddapur.
 */
export function placeLikeWords(text: string): string[] {
  const found = [...text.matchAll(TOPONYM_ENDING_KN)].map((match) => match[1]);
  found.push(...[...text.matchAll(TOPONYM_ENDING_LATIN)].map((match) => match[0]));
  return [...new Set(found)];
}

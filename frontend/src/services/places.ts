import type { Language } from "./formatting";

/** Kannada names for cooperative branches and the towns APMC markets are named after, keyed by the English name in capitals. */
export const PLACE_NAMES_KN: Record<string, string> = {
  BHADRAVATHI: "ಭದ್ರಾವತಿ", BIRUR: "ಬೀರೂರು", CHANNAGIRI: "ಚನ್ನಗಿರಿ", HOSANAGARA: "ಹೊಸನಗರ", JAYAPURA: "ಜಯಪುರ", KOPPA: "ಕೊಪ್ಪ", SAGARA: "ಸಾಗರ",
  SHIKARIPURA: "ಶಿಕಾರಿಪುರ", SHIVAMOGGA: "ಶಿವಮೊಗ್ಗ", SIDDAPUR: "ಸಿದ್ದಾಪುರ", SIRSI: "ಶಿರಸಿ", SORABA: "ಸೊರಬ", SRINGERI: "ಶೃಂಗೇರಿ",
  TARIKERE: "ತರೀಕೆರೆ", THIRTHAHALLI: "ತೀರ್ಥಹಳ್ಳಿ", YELLAPUR: "ಯಲ್ಲಾಪುರ",
};

/** Other spellings people type for the same place. Used only to find a name, never to merge sources' labels. */
const PLACE_ALIASES: Record<string, string[]> = {
  SHIVAMOGGA: ["shimoga", "shivamoga"], THIRTHAHALLI: ["tirthahalli", "theerthahalli", "thirthahali"], SAGARA: ["sagar"],
  SORABA: ["sorab"], SIDDAPUR: ["siddapura"], YELLAPUR: ["yellapura"], BHADRAVATHI: ["bhadravati"], SHIKARIPURA: ["shikaripur"],
  HOSANAGARA: ["hosanagar"], SRINGERI: ["shringeri"], TARIKERE: ["tarikere"], CHANNAGIRI: ["chennagiri"],
};

/** The place a market or branch is named after: its first word, e.g. "Sirsi" for "Sirsi APMC". */
const placeKey = (name: string) => name.trim().split(/\s+/)[0]?.toUpperCase() ?? "";

export function placeName(name: string, language: Language) {
  return language === "kn" ? PLACE_NAMES_KN[name.toUpperCase()] ?? name : name;
}

/** Every text a reader might type to find this place: the source's own name, its Kannada name and common spellings. */
export function placeSearchTerms(name: string) {
  const key = placeKey(name);
  return [name, ...(PLACE_NAMES_KN[key] ? [PLACE_NAMES_KN[key]] : []), ...(PLACE_ALIASES[key] ?? [])];
}

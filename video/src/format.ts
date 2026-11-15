import { lang, type Lang } from "./i18n.ts";

const MONTHS: Record<Lang, string[]> = {
  kn: ["ಜನವರಿ", "ಫೆಬ್ರವರಿ", "ಮಾರ್ಚ್", "ಏಪ್ರಿಲ್", "ಮೇ", "ಜೂನ್", "ಜುಲೈ", "ಆಗಸ್ಟ್", "ಸೆಪ್ಟೆಂಬರ್", "ಅಕ್ಟೋಬರ್", "ನವೆಂಬರ್", "ಡಿಸೆಂಬರ್"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

/** "2026-11-14" → "14 ನವೆಂಬರ್ 2026" / "14 Nov 2026", or without the year. */
export const fmtDate = (iso: string, year = true, l: Lang = lang()) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[l][m - 1]}${year ? ` ${y}` : ""}`;
};

/** Indian digit grouping: 47805 → "₹47,805". */
export const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Kannada names for cooperative branches and APMC towns (same table as frontend/src/services/places.ts). */
const PLACES: Record<string, string> = {
  BHADRAVATHI: "ಭದ್ರಾವತಿ", BIRUR: "ಬೀರೂರು", CHANNAGIRI: "ಚನ್ನಗಿರಿ", HOSANAGARA: "ಹೊಸನಗರ", JAYAPURA: "ಜಯಪುರ", KOPPA: "ಕೊಪ್ಪ",
  SAGARA: "ಸಾಗರ", SHIKARIPURA: "ಶಿಕಾರಿಪುರ", SHIVAMOGGA: "ಶಿವಮೊಗ್ಗ", SIDDAPUR: "ಸಿದ್ದಾಪುರ", SIRSI: "ಶಿರಸಿ", SORABA: "ಸೊರಬ",
  SRINGERI: "ಶೃಂಗೇರಿ", TARIKERE: "ತರೀಕೆರೆ", THIRTHAHALLI: "ತೀರ್ಥಹಳ್ಳಿ", YELLAPUR: "ಯಲ್ಲಾಪುರ",
};
/** The town a branch or market is named after, e.g. "Siddapur" for "Siddapur APMC"; Kannada when known. */
export const place = (name: string, l: Lang = lang()) => {
  const word = name.trim().split(/\s+/)[0] ?? name;
  if (l === "en") return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  return PLACES[word.toUpperCase()] ?? name;
};

/** AGMARKNET labels with an established Kannada form (frontend/src/services/agmarknetVarieties.ts); others stay as published. */
const APMC_VARIETIES: Record<string, string> = {
  Rashi: "ರಾಶಿ", Chali: "ಚಾಲಿ", "Hosa Chali": "ಹೊಸ ಚಾಲಿ", "Hale Chali": "ಹಳೆ ಚಾಲಿ", Bette: "ಬೆಟ್ಟೆ", Gorabalu: "ಗೊರಬಲು",
  Bilegotu: "ಬಿಳೇಗೋಟು", Kempugotu: "ಕೆಂಪುಗೋಟು", Saraku: "ಸರಕು", Sippegotu: "ಸಿಪ್ಪೆಗೋಟು", api: "ಅಪಿ", Churu: "ಚೂರು",
};
export const apmcVariety = (label: string, l: Lang = lang()) => (l === "kn" ? (APMC_VARIETIES[label] ?? label) : label);

export const change = (now: number, prev: number | null) => (prev ? ((now - prev) / prev) * 100 : null);

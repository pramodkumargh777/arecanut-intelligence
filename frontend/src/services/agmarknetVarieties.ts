import type { Language } from "./formatting";
import { VARIETIES } from "./varieties";

/**
 * Kannada names for the variety labels AGMARKNET (and the monthly reference built from it) reports. Only names with an
 * established Kannada form are listed; any other label is shown as the source spells it, never guessed. The source label
 * always stays the value sent to the API. The same names are used on the sell-or-hold page.
 */
const KANNADA: Record<string, string> = {
  Rashi: "ರಾಶಿ", Chali: "ಚಾಲಿ", "Hosa Chali": "ಹೊಸ ಚಾಲಿ", "Hale Chali": "ಹಳೆ ಚಾಲಿ", Bette: "ಬೆಟ್ಟೆ", Gorabalu: "ಗೊರಬಲು",
  Bilegotu: "ಬಿಳೇಗೋಟು", Kempugotu: "ಕೆಂಪುಗೋಟು", Saraku: "ಸರಕು", Sippegotu: "ಸಿಪ್ಪೆಗೋಟು", api: "ಅಪಿ", Churu: "ಚೂರು",
};
/** English display names where the source's own spelling reads poorly. */
const ENGLISH: Record<string, string> = { api: "Api" };

export function agmarknetVarietyName(label: string, language: Language) {
  return (language === "kn" ? KANNADA[label] : undefined) ?? ENGLISH[label] ?? label;
}

/**
 * AGMARKNET labels that name the same variety as a grower's variety (catalogue key), compared without case. Only
 * certain pairs are listed: a town's APMC rate is shown beside its cooperative rate only when it is the same variety,
 * and labels such as "New Variety", "Old Variety" or "Cqca" are never guessed.
 */
const APMC_LABELS: Record<string, string[]> = {
  rashi: ["Rashi"], chali: ["Chali"], "new-chali": ["Hosa Chali"], bette: ["Bette"], gorabalu: ["Gorabalu"],
  "bile-gotu": ["Bilegotu"], "kempu-gotu": ["Kempugotu"], "sippe-gotu": ["Sippegotu"], api: ["api"], churu: ["Churu"],
};

export const apmcLabelMatches = (varietyKey: string, label: string) =>
  (APMC_LABELS[varietyKey] ?? []).some((name) => name.toLowerCase() === label.trim().toLowerCase());

/** APMC rows in the grower catalogue's order (Rashi, Chali, Sippe gotu, …); labels it has no certain match for follow, in their own order. */
export function apmcCatalogueOrder<T extends { variety_name: string }>(rows: T[]): T[] {
  const rank = (row: T) => { const index = VARIETIES.findIndex((variety) => apmcLabelMatches(variety.key, row.variety_name)); return index < 0 ? VARIETIES.length : index; };
  return rows.map((row, index) => ({ row, index })).sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index).map(({ row }) => row);
}

/* Shared by the TSS importer (api/src/tss.ts) and the grower variety catalogue (frontend/src/services/varieties.ts). */

/**
 * Arecanut grades captured from the TSS rate table, spelled exactly as TSS publishes them. Pepper, coconut, cocoa
 * and by-products (bale, mitli, dust…) are left out: TSS rows are stored as arecanut. "NEW CHALI" is listed ahead of
 * its first appearance so it is captured when the season starts. FRESH RED ARECANUT is fresh, undried nut (≈₹6,000
 * against ≈₹44,000 for NEW RASHI on 4 Nov 2026), so it is captured as its own grade, never merged into a dried one; the
 * other fresh lots (green, sippe, kole and raw green nut, ₹1,600–₹13,000 on 10 Nov 2026) are kept apart the same way.
 */
export const TSS_VARIETIES = [
  "RASHI", "NEW RASHI", "API", "BT RASHI", "SANNA RASHI",
  "CHALI", "NEW CHALI", "11-CHALI", "DNK CHALI", "SIPPE CHALI",
  "BETTE", "GOT BETTE", "KE.BETTE",
  "B.G.", "K.G.", "KARAGOTU", "SIPPE GOTU", "LA B GOT",
  "KOKA", "LA KOKA", "CH.KEMP", "ARAGERE", "MURI", "KOLE", "CHURU",
  "FRESH RED ARECANUT", "FRESH GREEN ARECANUT", "FRESH SIPPE ARECA", "FRESH KOLE RAW", "GREEN RAW ARECA", "ARECANUT",
] as const;

/**
 * The Kannada name TSS publishes for each grade (`iname_kn` in its rate table), copied exactly, including its own
 * abbreviations. Grades only TSS reports use these names on the site; a test keeps the catalogue in step.
 */
export const TSS_KANNADA: Record<(typeof TSS_VARIETIES)[number], string> = {
  "RASHI": "ರಾಶಿ", "NEW RASHI": "ಹೊಸ ರಾಶಿ", "API": "ಆಪಿ", "BT RASHI": "ರಾಶಿ - ||", "SANNA RASHI": "ಸಣ್ಣ ರಾಶಿ",
  "CHALI": "ಚಾಲಿ", "NEW CHALI": "ಹೊಸ ಚಾಲಿ", "11-CHALI": "ಚಾಲಿ-||", "DNK CHALI": "ಡಂಕ ಚಾಲಿ", "SIPPE CHALI": "ಸಿಪ್ಪೆ ಚಾಲಿ",
  "BETTE": "ಬೆಟ್ಟೆ", "GOT BETTE": "ಗೋ ಬೆಟ್ಟೆ", "KE.BETTE": "ಕೆ.ಬೆಟ್ಟೆ",
  "B.G.": "ಬಿಳೆಗೋಟು", "K.G.": "ಕೆಂ.ಗೋ.", "KARAGOTU": "ಕಾರಗೋಟು", "SIPPE GOTU": "ಸಿಪ್ಪೆ ಗೋಟು", "LA B GOT": "ಲ ಬಿಗೊ",
  "KOKA": "ಕೋಕಾ", "LA KOKA": "ಲ ಕೋಕಾ", "CH.KEMP": "ಚಾಲಿ ಕೆಂಪು", "ARAGERE": "ಅರಗೆರೆ", "MURI": "ಮುರಿ", "KOLE": "ಕೊಳೆ", "CHURU": "ಚೂರು",
  "FRESH RED ARECANUT": "ಗೋಟು ಅಡಿಕೆ", "FRESH GREEN ARECANUT": "ಹಸಿರು ಅಡಿಕೆ", "FRESH SIPPE ARECA": "ಹಸಿ ಅಡಿಕೆ(ಸಿಪ್ಪೆ ಅಡಿಕೆ)",
  "FRESH KOLE RAW": "ಹಸಿ ಕೊಳೆ", "GREEN RAW ARECA": "ಹಸಿರು ಹಸಿ ಅಡಿಕೆ", "ARECANUT": "ಅಡಿಕೆ",
};

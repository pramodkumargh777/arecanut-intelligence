import type { CooperativeSource } from "./cooperative";

export type VarietyGroup = "rashi" | "chali" | "bette" | "other" | "fresh";

/**
 * A grower's name for a variety and the exact label each cooperative publishes it under. Labels are matched exactly,
 * never fuzzily, and stay visible on every row so a reader can check the mapping. Each label must also be on the
 * importer's allowlist (TSS_VARIETIES in api/src/tss.ts) to be captured.
 */
export type GrowerVariety = {
  key: string; en: string; kn: string; group: VarietyGroup;
  labels: Partial<Record<CooperativeSource, string[]>>;
  /** Everyday varieties are picture cards on the home page; the rest sit in a grouped "More varieties" list. */
  everyday?: boolean;
  /** TUMCOS never states a variety, so its single rate is shown only beside these common dried grades. */
  tumcos?: boolean;
  note?: { en: string; kn: string };
};

const FRESH_NOTE = { en: "Fresh, undried nuts. Priced per quintal of fresh weight, so far below dried grades such as Rashi.",
  kn: "ಒಣಗಿಸದ ಹಸಿ ಅಡಿಕೆ. ಹಸಿ ತೂಕದ ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್ ದರ, ಆದ್ದರಿಂದ ರಾಶಿಯಂತಹ ಒಣ ಅಡಿಕೆಗಿಂತ ತುಂಬಾ ಕಡಿಮೆ." };

export const VARIETIES: GrowerVariety[] = [
  // Everyday
  { key: "rashi", en: "Rashi", kn: "ರಾಶಿ", group: "rashi", everyday: true, tumcos: true, labels: { mamcos: ["RASHI EDI"], tss: ["RASHI"] } },
  { key: "chali", en: "Chali", kn: "ಚಾಲಿ", group: "chali", everyday: true, tumcos: true, labels: { mamcos: ["CHALI"], tss: ["CHALI"] } },
  { key: "sippe-gotu", en: "Sippe gotu", kn: "ಸಿಪ್ಪೆಗೋಟು", group: "bette", everyday: true, labels: { mamcos: ["SIPPE GOTU"], tss: ["SIPPE GOTU"] } },
  // Rashi types
  { key: "new-rashi", en: "New Rashi", kn: "ಹೊಸ ರಾಶಿ", group: "rashi", tumcos: true, labels: { mamcos: ["NEW RASHIEDI", "NEWRASHIEDI"], tss: ["NEW RASHI"] } },
  { key: "api", en: "Api", kn: "ಆಪಿ", group: "rashi", labels: { tss: ["API"] } },
  { key: "bt-rashi", en: "Bt rashi", kn: "ರಾಶಿ - ||", group: "rashi", labels: { tss: ["BT RASHI"] } },
  { key: "sanna-rashi", en: "Sanna rashi", kn: "ಸಣ್ಣ ರಾಶಿ", group: "rashi", labels: { tss: ["SANNA RASHI"] } },
  // Chali types
  { key: "new-chali", en: "New chali", kn: "ಹೊಸ ಚಾಲಿ", group: "chali", labels: { tss: ["NEW CHALI"] } },
  { key: "second-chali", en: "Second chali", kn: "ಚಾಲಿ-||", group: "chali", labels: { tss: ["11-CHALI"] } },
  { key: "dnk-chali", en: "Dnk chali", kn: "ಡಂಕ ಚಾಲಿ", group: "chali", labels: { tss: ["DNK CHALI"] } },
  { key: "sippe-chali", en: "Sippe chali", kn: "ಸಿಪ್ಪೆ ಚಾಲಿ", group: "chali", labels: { tss: ["SIPPE CHALI"] } },
  // Bette and gotu
  { key: "bette", en: "Bette", kn: "ಬೆಟ್ಟೆ", group: "bette", tumcos: true, labels: { mamcos: ["BETTE"], tss: ["BETTE"] } },
  { key: "got-bette", en: "Got bette", kn: "ಗೋ ಬೆಟ್ಟೆ", group: "bette", labels: { tss: ["GOT BETTE"] } },
  { key: "ke-bette", en: "Ke bette", kn: "ಕೆ.ಬೆಟ್ಟೆ", group: "bette", labels: { tss: ["KE.BETTE"] } },
  { key: "bile-gotu", en: "Bile gotu", kn: "ಬಿಳೆಗೋಟು", group: "bette", labels: { tss: ["B.G."] } },
  { key: "kempu-gotu", en: "Kempu gotu", kn: "ಕೆಂ.ಗೋ.", group: "bette", labels: { tss: ["K.G."] } },
  { key: "kere-gotu", en: "Karagotu", kn: "ಕಾರಗೋಟು", group: "bette", labels: { tss: ["KARAGOTU"] } },
  { key: "laddu-bilegotu", en: "Laddu bilegotu", kn: "ಲ ಬಿಗೊ", group: "bette", labels: { tss: ["LA B GOT"] } },
  // Other grades
  { key: "gorabalu", en: "Gorabalu", kn: "ಗೊರಬಲು", group: "other", tumcos: true, labels: { mamcos: ["GORABALU"] } },
  { key: "koka", en: "Koka", kn: "ಕೋಕಾ", group: "other", labels: { tss: ["KOKA"] } },
  { key: "laddu-koka", en: "Laddu koka", kn: "ಲ ಕೋಕಾ", group: "other", labels: { tss: ["LA KOKA"] } },
  { key: "ch-kempu", en: "Chali kempu", kn: "ಚಾಲಿ ಕೆಂಪು", group: "other", labels: { tss: ["CH.KEMP"] } },
  { key: "arigere", en: "Aragere", kn: "ಅರಗೆರೆ", group: "other", labels: { tss: ["ARAGERE"] } },
  { key: "muri", en: "Muri", kn: "ಮುರಿ", group: "other", labels: { tss: ["MURI"] } },
  { key: "kole", en: "Kole", kn: "ಕೊಳೆ", group: "other", labels: { tss: ["KOLE"] } },
  { key: "churu", en: "Churu", kn: "ಚೂರು", group: "other", labels: { tss: ["CHURU"] } },
  // Fresh, undried nut. Each is its own TSS lot, never merged with another fresh grade or a dried one.
  { key: "fresh-red", en: "Fresh red arecanut", kn: "ಗೋಟು ಅಡಿಕೆ", group: "fresh", labels: { tss: ["FRESH RED ARECANUT"] }, note: FRESH_NOTE },
  { key: "fresh-green", en: "Fresh green arecanut", kn: "ಹಸಿರು ಅಡಿಕೆ", group: "fresh", labels: { tss: ["FRESH GREEN ARECANUT"] }, note: FRESH_NOTE },
  { key: "green-raw", en: "Green raw areca", kn: "ಹಸಿರು ಹಸಿ ಅಡಿಕೆ", group: "fresh", labels: { tss: ["GREEN RAW ARECA"] }, note: FRESH_NOTE },
  { key: "fresh-sippe", en: "Fresh sippe areca", kn: "ಹಸಿ ಅಡಿಕೆ(ಸಿಪ್ಪೆ ಅಡಿಕೆ)", group: "fresh", labels: { tss: ["FRESH SIPPE ARECA"] }, note: FRESH_NOTE },
  { key: "fresh-kole", en: "Fresh kole", kn: "ಹಸಿ ಕೊಳೆ", group: "fresh", labels: { tss: ["FRESH KOLE RAW"] }, note: FRESH_NOTE },
];

export const VARIETY_GROUPS: { key: VarietyGroup; en: string; kn: string }[] = [
  { key: "rashi", en: "Rashi types", kn: "ರಾಶಿ ವಿಧಗಳು" },
  { key: "chali", en: "Chali types", kn: "ಚಾಲಿ ವಿಧಗಳು" },
  { key: "bette", en: "Bette and gotu", kn: "ಬೆಟ್ಟೆ ಮತ್ತು ಗೋಟು" },
  { key: "other", en: "Other grades", kn: "ಇತರ ದರ್ಜೆಗಳು" },
  { key: "fresh", en: "Fresh (undried)", kn: "ಹಸಿ ಅಡಿಕೆ" },
];

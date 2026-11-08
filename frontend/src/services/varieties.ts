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
  /** Everyday varieties are chips on the home page; the rest sit in a grouped "More varieties" list. */
  everyday?: boolean;
  note?: { en: string; kn: string };
};

export const VARIETIES: GrowerVariety[] = [
  // Everyday
  { key: "rashi", en: "Rashi", kn: "ರಾಶಿ", group: "rashi", everyday: true, labels: { mamcos: ["RASHI EDI"], tss: ["RASHI"] } },
  { key: "new-rashi", en: "New Rashi", kn: "ಹೊಸ ರಾಶಿ", group: "rashi", everyday: true, labels: { mamcos: ["NEW RASHIEDI", "NEWRASHIEDI"], tss: ["NEW RASHI"] } },
  { key: "chali", en: "Chali", kn: "ಚಾಲಿ", group: "chali", everyday: true, labels: { mamcos: ["CHALI"], tss: ["CHALI"] } },
  { key: "bette", en: "Bette", kn: "ಬೆಟ್ಟೆ", group: "bette", everyday: true, labels: { mamcos: ["BETTE"], tss: ["BETTE"] } },
  { key: "gorabalu", en: "Gorabalu", kn: "ಗೊರಬಲು", group: "other", everyday: true, labels: { mamcos: ["GORABALU"] } },
  // Rashi types
  { key: "api", en: "Api", kn: "ಅಪಿ", group: "rashi", labels: { tss: ["API"] } },
  { key: "bt-rashi", en: "Bt rashi", kn: "ಬಿಟಿ ರಾಶಿ", group: "rashi", labels: { tss: ["BT RASHI"] } },
  { key: "sanna-rashi", en: "Sanna rashi", kn: "ಸಣ್ಣ ರಾಶಿ", group: "rashi", labels: { tss: ["SANNA RASHI"] } },
  // Chali types
  { key: "new-chali", en: "New chali", kn: "ಹೊಸ ಚಾಲಿ", group: "chali", labels: { tss: ["NEW CHALI"] } },
  { key: "second-chali", en: "Second chali", kn: "ಸೆಕೆಂಡ್ ಚಾಲಿ", group: "chali", labels: { tss: ["11-CHALI"] } },
  { key: "dnk-chali", en: "Dnk chali", kn: "ಡಂಕಿ ಚಾಲಿ", group: "chali", labels: { tss: ["DNK CHALI"] } },
  { key: "sippe-chali", en: "Sippe chali", kn: "ಸಿಪ್ಪೆ ಚಾಲಿ", group: "chali", labels: { tss: ["SIPPE CHALI"] } },
  // Bette and gotu
  { key: "got-bette", en: "Got bette", kn: "ಗೋಟು ಬೆಟ್ಟೆ", group: "bette", labels: { tss: ["GOT BETTE"] } },
  { key: "ke-bette", en: "Ke bette", kn: "ಕೆ. ಬೆಟ್ಟೆ", group: "bette", labels: { tss: ["KE.BETTE"] } },
  { key: "bile-gotu", en: "Bile gotu", kn: "ಬಿಳೇಗೋಟು", group: "bette", labels: { tss: ["B.G."] } },
  { key: "kempu-gotu", en: "Kempu gotu", kn: "ಕೆಂಪುಗೋಟು", group: "bette", labels: { tss: ["K.G."] } },
  { key: "kere-gotu", en: "Kere gotu", kn: "ಕೆರೆಗೋಟು", group: "bette", labels: { tss: ["KARAGOTU"] } },
  { key: "sippe-gotu", en: "Sippe gotu", kn: "ಸಿಪ್ಪೆಗೋಟು", group: "bette", labels: { mamcos: ["SIPPE GOTU"], tss: ["SIPPE GOTU"] } },
  { key: "laddu-bilegotu", en: "Laddu bilegotu", kn: "ಲಡ್ಡು ಬಿಳೇಗೋಟು", group: "bette", labels: { tss: ["LA B GOT"] } },
  // Other grades
  { key: "koka", en: "Koka", kn: "ಕೋಕ", group: "other", labels: { tss: ["KOKA"] } },
  { key: "laddu-koka", en: "Laddu koka", kn: "ಲಡ್ಡು ಕೋಕ", group: "other", labels: { tss: ["LA KOKA"] } },
  { key: "ch-kempu", en: "Ch kempu", kn: "ಸಿಎಚ್ ಕೆಂಪು", group: "other", labels: { tss: ["CH.KEMP"] } },
  { key: "arigere", en: "Arigere", kn: "ಅರಿಗೆರೆ", group: "other", labels: { tss: ["ARAGERE"] } },
  { key: "muri", en: "Muri", kn: "ಮುರಿ", group: "other", labels: { tss: ["MURI"] } },
  { key: "kole", en: "Kole", kn: "ಕೊಳೆ", group: "other", labels: { tss: ["KOLE"] } },
  { key: "churu", en: "Churu", kn: "ಚೂರು", group: "other", labels: { tss: ["CHURU"] } },
  // Fresh, undried nut
  { key: "fresh-red", en: "Fresh red arecanut", kn: "ಹಸಿ ಕೆಂಪು ಅಡಿಕೆ", group: "fresh", labels: { tss: ["FRESH RED ARECANUT"] },
    note: { en: "Fresh, undried nuts. Priced per quintal of fresh weight, so far below dried grades such as Rashi.",
      kn: "ಒಣಗಿಸದ ಹಸಿ ಅಡಿಕೆ. ಹಸಿ ತೂಕದ ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್ ದರ, ಆದ್ದರಿಂದ ರಾಶಿಯಂತಹ ಒಣ ಅಡಿಕೆಗಿಂತ ತುಂಬಾ ಕಡಿಮೆ." } },
];

export const VARIETY_GROUPS: { key: VarietyGroup; en: string; kn: string }[] = [
  { key: "rashi", en: "Rashi types", kn: "ರಾಶಿ ವಿಧಗಳು" },
  { key: "chali", en: "Chali types", kn: "ಚಾಲಿ ವಿಧಗಳು" },
  { key: "bette", en: "Bette and gotu", kn: "ಬೆಟ್ಟೆ ಮತ್ತು ಗೋಟು" },
  { key: "other", en: "Other grades", kn: "ಇತರ ದರ್ಜೆಗಳು" },
  { key: "fresh", en: "Fresh (undried)", kn: "ಹಸಿ ಅಡಿಕೆ" },
];

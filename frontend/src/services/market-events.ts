/**
 * Dated policy and tax events that can move arecanut prices. They are shown as markers on price charts so a reader can see
 * what happened around a jump; nothing here claims a cause or an effect size. Add an event only with an official notice or
 * a report that cites one, and keep the date the rule was issued or took effect, as named in `kind`.
 */
export type MarketEvent = {
  date: string;
  kind: "issued" | "in-force";
  en: string;
  kn: string;
  source: { name: string; url: string };
};

export const MARKET_EVENTS: MarketEvent[] = [
  {
    date: "2023-02-14", kind: "issued",
    en: "Minimum import price raised from ₹251 to ₹351 per kg; supari imports below it banned",
    kn: "ಕನಿಷ್ಠ ಆಮದು ದರ ಕೆಜಿಗೆ ₹251 ರಿಂದ ₹351ಕ್ಕೆ ಏರಿಕೆ; ಅದಕ್ಕಿಂತ ಕಡಿಮೆ ದರದ ಸುಪಾರಿ ಆಮದು ನಿಷೇಧ",
    source: { name: "DGFT notification 57/2015-20", url: "https://taxguru.in/dgft/import-policy-supari-itchs-21069030-revised-free-prohibited.html" },
  },
  {
    date: "2025-10-15", kind: "issued",
    en: "₹351 per kg minimum import price extended to roasted arecanut",
    kn: "ಕೆಜಿಗೆ ₹351 ಕನಿಷ್ಠ ಆಮದು ದರ ಹುರಿದ ಅಡಿಕೆಗೂ ಅನ್ವಯ",
    source: { name: "DGFT notification 43/2025-26", url: "https://taxguru.in/dgft/amendment-import-policy-policy-condition-areca-nuts-falling-itc-hscode-08028090-20081991-chapter-20-itc-hs2022schedule-i-import-policy.html" },
  },
  {
    date: "2026-02-01", kind: "in-force",
    en: "Pan masala moves to 40% GST with a new health cess on manufacturers",
    kn: "ಪಾನ್ ಮಸಾಲಾಗೆ 40% ಜಿಎಸ್‌ಟಿ ಮತ್ತು ತಯಾರಕರ ಮೇಲೆ ಹೊಸ ಆರೋಗ್ಯ ಸೆಸ್",
    source: { name: "Free Press Journal", url: "https://www.freepressjournal.in/amp/business/tobacco-products-face-additional-excise-duty-pan-masala-health-cess-from-february-1" },
  },
];

/** Events on or between two calendar dates, oldest first. */
export const eventsBetween = (from: string, to: string) => MARKET_EVENTS.filter((event) => event.date >= from && event.date <= to);

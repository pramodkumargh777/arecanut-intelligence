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
    date: "2015-06-08", kind: "issued",
    en: "Minimum import price raised from ₹110 to ₹162 per kg",
    kn: "ಕನಿಷ್ಠ ಆಮದು ದರ ಕೆಜಿಗೆ ₹110 ರಿಂದ ₹162ಕ್ಕೆ ಏರಿಕೆ",
    source: { name: "DGFT notification 10/2015-20", url: "https://apeda.gov.in/sites/default/files/dgft_notifications/Notification_10_08_06_2015.pdf" },
  },
  {
    date: "2016-11-08", kind: "issued",
    en: "₹500 and ₹1,000 notes withdrawn (demonetisation)",
    kn: "₹500 ಮತ್ತು ₹1,000 ನೋಟುಗಳ ಅಮಾನ್ಯೀಕರಣ",
    source: { name: "Reserve Bank of India notice", url: "https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=38520" },
  },
  {
    date: "2017-01-17", kind: "issued",
    en: "Minimum import price raised from ₹162 to ₹251 per kg",
    kn: "ಕನಿಷ್ಠ ಆಮದು ದರ ಕೆಜಿಗೆ ₹162 ರಿಂದ ₹251ಕ್ಕೆ ಏರಿಕೆ",
    source: { name: "DGFT notification 35/2015-20", url: "https://www.taxtmi.com/notifications?id=119900" },
  },
  {
    date: "2017-07-01", kind: "in-force",
    en: "GST begins; pan masala taxed at 28% plus a 60% cess",
    kn: "ಜಿಎಸ್‌ಟಿ ಜಾರಿ; ಪಾನ್ ಮಸಾಲಾಗೆ 28% ತೆರಿಗೆ ಮತ್ತು 60% ಸೆಸ್",
    source: { name: "GST Compensation Cess (Rate) notification 1/2017", url: "https://taxindiaonline.com/RC2/pdfnoti/gst/cess_rate/2017/cess_rate_01.pdf" },
  },
  {
    date: "2018-07-25", kind: "issued",
    en: "Arecanut imports below ₹251 per kg banned",
    kn: "ಕೆಜಿಗೆ ₹251ಕ್ಕಿಂತ ಕಡಿಮೆ ದರದ ಅಡಿಕೆ ಆಮದು ನಿಷೇಧ",
    source: { name: "DGFT notification 20/2015-20", url: "https://taxguru.in/dgft/govt-amends-import-policy-arecanut.html" },
  },
  {
    date: "2020-03-25", kind: "in-force",
    en: "Nationwide COVID-19 lockdown begins; arecanut trading halts",
    kn: "ದೇಶವ್ಯಾಪಿ ಕೋವಿಡ್-19 ಲಾಕ್‌ಡೌನ್ ಆರಂಭ; ಅಡಿಕೆ ವಹಿವಾಟು ಸ್ಥಗಿತ",
    source: { name: "The Hindu", url: "https://www.inkl.com/news/covid-19-areca-growers-in-peril-as-trading-comes-to-a-halt" },
  },
  {
    date: "2022-09-28", kind: "issued",
    en: "17,000 tonnes a year of green arecanut from Bhutan allowed without the minimum import price",
    kn: "ಭೂತಾನ್‌ನಿಂದ ವರ್ಷಕ್ಕೆ 17,000 ಟನ್ ಹಸಿ ಅಡಿಕೆಗೆ ಕನಿಷ್ಠ ಆಮದು ದರದ ಷರತ್ತಿಲ್ಲದೆ ಆಮದು ಅನುಮತಿ",
    source: { name: "DGFT notification 36/2015-20", url: "https://taxguru.in/dgft/amendment-import-policy-fresh-green-areca-nut-bhutan.html" },
  },
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

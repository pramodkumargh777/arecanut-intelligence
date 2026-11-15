/** Screen text for the daily video in Kannada and English. Same layout, same hierarchy; only the words change. */
export type Lang = "kn" | "en";
export const LANGS: Lang[] = ["kn", "en"];

let current: Lang = "kn";
/** Set once per render by the composition from its `lang` prop. */
export const setLang = (l: Lang) => {
  current = l;
};
export const lang = () => current;

const kn = {
  brandA: "ಅಡಿಕೆ",
  brandB: "ನಾಡಿ",
  vsReport: (d: string) => `${d} ವರದಿಗೆ ಹೋಲಿಸಿ`,
  unit: "₹/ಕ್ವಿಂಟಾಲ್",
  unitAssumed: "₹/ಕ್ವಿಂಟಾಲ್ (ಘಟಕ ಊಹಿಸಲಾಗಿದೆ)",
  branchesAvg: (n: number) => (n === 1 ? "1 ಶಾಖೆಯ ಸರಾಸರಿ" : `${n} ಶಾಖೆಗಳ ಸರಾಸರಿ ದರಗಳು`),
  modal: "ಮಾದರಿ ದರ",
  titleA: "ಇಂದಿನ ಅಡಿಕೆ",
  titleB: "ಧಾರಣೆ",
  latestReport: "ಇತ್ತೀಚಿನ ವರದಿ",
  glanceHead: "ರಾಶಿ — ಒಂದು ನೋಟ",
  mamcosNote: "ಶಿವಮೊಗ್ಗ ಸಹಕಾರ ಸಂಘ",
  rashiRates: "ರಾಶಿ ಧಾರಣೆ",
  branchAvgMinMax: "ಶಾಖಾ ಸರಾಸರಿ, ಕನಿಷ್ಠ – ಗರಿಷ್ಠ",
  moreBranches: (n: number) => `+ ಇನ್ನೂ ${n} ಶಾಖೆಗಳ ಧಾರಣೆ adikenaadi.com ನಲ್ಲಿ`,
  eachRowDate: "ಪ್ರತಿ ಶಾಖೆಯ ಹೆಸರಿನ ಕೆಳಗೆ ಅದರ ವರದಿ ದಿನಾಂಕ",
  tssNote: "ಶಿರಸಿ ಸಹಕಾರ ಸಂಘ",
  rashi: "ರಾಶಿ",
  chali: "ಚಾಲಿ",
  tssUnitFoot: "TSS ಘಟಕ ತಿಳಿಸುವುದಿಲ್ಲ; ಕ್ವಿಂಟಾಲ್‌ಗೆ ₹ ಎಂದು ಊಹಿಸಲಾಗಿದೆ",
  apmc: "ಎಪಿಎಂಸಿ",
  grade: "ದರ್ಜೆ",
  othersNote: "ಎಪಿಎಂಸಿ ಮತ್ತು ಇತರ ಸಂಘಗಳು",
  othersTitle: "ಇತರ ದರಗಳು",
  othersSub: "ಒಂದೊಂದು ಮೂಲ ಬೇರೆ ಬೇರೆ · ದಿನಾಂಕ ಸಮೇತ",
  tumcosNote: "ತಳಿ ತಿಳಿಸಿಲ್ಲ · ಘಟಕ ಊಹಿಸಲಾಗಿದೆ",
  branchAvg: "ಶಾಖಾ ಸರಾಸರಿ",
  trendTitle: (p: string) => `${p} ರಾಶಿ ಏರಿಳಿತ`,
  trendSub: (n: number) => `ಕಳೆದ ${n} ವರದಿಗಳ ಸರಾಸರಿ ಧಾರಣೆ`,
  latest: "ಇತ್ತೀಚಿನ",
  highest: "ಅತಿ ಹೆಚ್ಚು",
  lowest: "ಅತಿ ಕಡಿಮೆ",
  trendFoot: "ಹಿಂದಿನ ಧಾರಣೆ ಮುಂದಿನ ಭವಿಷ್ಯ ಅಲ್ಲ · ಮೂಲ: TSS ಪ್ರಕಟಿತ ದರ",
  ctaA: "ಎಲ್ಲಾ ಶಾಖೆಗಳ ಧಾರಣೆ,",
  ctaB: "ಚಾರ್ಟ್, ಹೋಲಿಕೆ ಎಲ್ಲಾ ಇಲ್ಲಿ",
  share: "ನಿಮ್ಮ ಊರಿನ ಬೆಳೆಗಾರರಿಗೂ ಶೇರ್ ಮಾಡಿ",
  follow: "ಫಾಲೋ ಮಾಡಿ",
  features: ["ಇಂದಿನ ಧಾರಣೆ", "ಬೆಲೆ ಏರಿಳಿತ", "ಮಾರುಕಟ್ಟೆ ಹೋಲಿಕೆ", "ಪ್ರಶ್ನೆ ಕೇಳಿ"],
  disclaimer: "ಮಾರುಕಟ್ಟೆ ಮಾಹಿತಿ ಮಾತ್ರ, ಹಣಕಾಸು ಸಲಹೆ ಅಲ್ಲ.",
};

const en: typeof kn = {
  brandA: "Areca",
  brandB: "Pulse",
  vsReport: (d: string) => `vs ${d} report`,
  unit: "₹/quintal",
  unitAssumed: "₹/quintal (unit assumed)",
  branchesAvg: (n: number) => (n === 1 ? "Average of 1 branch" : `Averages of ${n} branches`),
  modal: "Modal rate",
  titleA: "Today's Arecanut",
  titleB: "Rates",
  latestReport: "Latest report",
  glanceHead: "Rashi at a glance",
  mamcosNote: "Shivamogga co-operative",
  rashiRates: "Rashi rates",
  branchAvgMinMax: "Branch average, min – max",
  moreBranches: (n: number) => `+ ${n} more branches at adikenaadi.com`,
  eachRowDate: "Each row shows that branch's report date",
  tssNote: "Sirsi co-operative",
  rashi: "Rashi",
  chali: "Chali",
  tssUnitFoot: "TSS states no unit; ₹/quintal is assumed",
  apmc: "APMC",
  grade: "Grade",
  othersNote: "Government market and others",
  othersTitle: "Other rates",
  othersSub: "Each source shown separately · each rate with its date",
  tumcosNote: "Variety not stated · unit assumed",
  branchAvg: "Branch average",
  trendTitle: (p: string) => `${p} Rashi trend`,
  trendSub: (n: number) => `Average rate, last ${n} reports`,
  latest: "Latest",
  highest: "Highest",
  lowest: "Lowest",
  trendFoot: "Past rates are not a forecast · Source: TSS published rates",
  ctaA: "Rates for every branch,",
  ctaB: "charts and comparisons",
  share: "Share with fellow growers",
  follow: "Follow",
  features: ["Today's rates", "Price trends", "Compare markets", "Ask a question"],
  disclaimer: "Market information only, not financial advice.",
};

export const STRINGS: Record<Lang, typeof kn> = { kn, en };
/** Strings for the language being rendered. */
export const t = () => STRINGS[current];

/**
 * What search engines are told about each public page: a title and a description in both languages. The build writes
 * one HTML file per page from this (vite.config.ts), and the app keeps the tab title and description in step as a
 * visitor moves between pages (AppShell). Plain data only, so the build can import it without the app.
 *
 * Kannada titles carry the English search phrase too, because the Kannada page is what a crawler sees first and growers
 * search in both scripts ("ಅಡಿಕೆ ಧಾರಣೆ", "adike rate", "arecanut price"). Name only sources and places the page shows.
 */
import { VARIETIES, type GrowerVariety } from "./varieties";
import { COOPERATIVE_NAMES, COOPERATIVE_ORDER, MARKETS_PATH, marketFromPath, marketPath, type MarketPlace } from "./markets";

export type SeoText = { title: string; description: string };
export type SeoPage = { path: string; label: { kn: string; en: string }; kn: SeoText; en: SeoText };

export const SEO_PAGES: SeoPage[] = [
  {
    path: "/", label: { kn: "ಇಂದಿನ ಅಡಿಕೆ ಧಾರಣೆ", en: "Arecanut price today" },
    kn: {
      title: "ಇಂದಿನ ಅಡಿಕೆ ಧಾರಣೆ · Arecanut price today | ಅಡಿಕೆ ನಾಡಿ",
      description: "ಇಂದಿನ ಅಡಿಕೆ ಧಾರಣೆ: ಶಿವಮೊಗ್ಗ, ಶಿರಸಿ ಸೇರಿ ಮ್ಯಾಮ್ಕೋಸ್, ಟಿಎಸ್‌ಎಸ್ ಮತ್ತು ಎಪಿಎಂಸಿ ದರಗಳು. ರಾಶಿ, ಚಾಲಿ, ಬೆಟ್ಟೆ ದರ ದಿನಾಂಕದೊಂದಿಗೆ.",
    },
    en: {
      title: "Arecanut price today: MAMCOS, TSS and APMC rates | Areca Pulse",
      description: "Today's arecanut (adike, supari) rates in Karnataka: MAMCOS Shivamogga, Sagara and Thirthahalli, TSS Sirsi, Siddapur and Yellapur, and APMC prices. Rashi, Chali, Bette and more, each with its date and source.",
    },
  },
  {
    path: "/prices", label: { kn: "ಅಡಿಕೆ ಮಾರುಕಟ್ಟೆ ದರಗಳು", en: "Arecanut market rates" },
    kn: {
      title: "ಅಡಿಕೆ ಮಾರುಕಟ್ಟೆ ದರಗಳು · Arecanut market rates | ಅಡಿಕೆ ನಾಡಿ",
      description: "ಮ್ಯಾಮ್ಕೋಸ್, ಟಿಎಸ್‌ಎಸ್, ಟಮ್ಕೋಸ್ ಮತ್ತು ಎಪಿಎಂಸಿ ಅಡಿಕೆ ದರಗಳನ್ನು ಮಾರುಕಟ್ಟೆ, ತಳಿವಾರು ಹುಡುಕಿ: ಕನಿಷ್ಠ, ಗರಿಷ್ಠ, ಸರಾಸರಿ ಬೆಲೆ.",
    },
    en: {
      title: "Arecanut market rates by market and variety | Areca Pulse",
      description: "Search arecanut rates by market and variety across MAMCOS, TSS, TUMCOS and APMC (AGMARKNET) markets in Karnataka, with minimum, maximum and average price per quintal.",
    },
  },
  {
    path: "/analytics", label: { kn: "ಅಡಿಕೆ ದರ ಪ್ರವೃತ್ತಿ", en: "Arecanut price trend" },
    kn: {
      title: "ಅಡಿಕೆ ದರ ಪ್ರವೃತ್ತಿ · Arecanut price trend | ಅಡಿಕೆ ನಾಡಿ",
      description: "ಅಡಿಕೆ ದರದ ಏರಿಳಿತದ ಚಾರ್ಟ್‌ಗಳು: ರಾಶಿ, ಚಾಲಿ ಮತ್ತು ಇತರ ತಳಿಗಳ ದರ ಕಳೆದ ತಿಂಗಳುಗಳಲ್ಲಿ ಹೇಗೆ ಬದಲಾಗಿದೆ ಎಂದು ನೋಡಿ.",
    },
    en: {
      title: "Arecanut price trend charts | Areca Pulse",
      description: "Arecanut price trend charts for Rashi, Chali and other varieties: how cooperative and APMC prices in Karnataka have moved over recent months.",
    },
  },
  {
    path: "/compare", label: { kn: "ಅಡಿಕೆ ಮಾರುಕಟ್ಟೆ ಹೋಲಿಕೆ", en: "Compare arecanut markets" },
    kn: {
      title: "ಅಡಿಕೆ ಮಾರುಕಟ್ಟೆ ಹೋಲಿಕೆ · Compare arecanut markets | ಅಡಿಕೆ ನಾಡಿ",
      description: "ಒಂದೇ ದಿನ, ಒಂದೇ ತಳಿಗೆ ಯಾವ ಮಾರುಕಟ್ಟೆಯಲ್ಲಿ ಅಡಿಕೆ ದರ ಹೆಚ್ಚು ಎಂದು ಹೋಲಿಸಿ ನೋಡಿ.",
    },
    en: {
      title: "Compare arecanut prices across markets | Areca Pulse",
      description: "Compare arecanut prices for one variety on the same date across Karnataka markets, to see where the rate is highest.",
    },
  },
  {
    path: "/sell-or-hold", label: { kn: "ಅಡಿಕೆ ಮಾರಬೇಕೇ, ಕಾಯಬೇಕೇ", en: "Sell or hold arecanut" },
    kn: {
      title: "ಅಡಿಕೆ ಮಾರಬೇಕೇ, ಕಾಯಬೇಕೇ? · Sell or hold arecanut | ಅಡಿಕೆ ನಾಡಿ",
      description: "ಅಡಿಕೆಯನ್ನು ಈಗ ಮಾರಬೇಕೇ ಅಥವಾ ಕಾಯಬೇಕೇ? ಹಿಂದಿನ ವರ್ಷಗಳಲ್ಲಿ ಈ ತಿಂಗಳ ನಂತರ ದರ ಏನಾಯಿತು ಮತ್ತು ಕಾಯುವುದರಿಂದ ಲಾಭವಾಯಿತೇ ಎಂದು ನೋಡಿ.",
    },
    en: {
      title: "Sell arecanut now or wait? Past-year outcomes | Areca Pulse",
      description: "Should you sell arecanut now or hold? See what the price did after this month in past years, and how often waiting covered its cost.",
    },
  },
  {
    path: "/assistant", label: { kn: "ಅಡಿಕೆ ಪ್ರಶ್ನೆ ಕೇಳಿ", en: "Ask about arecanut" },
    kn: {
      title: "ಅಡಿಕೆ ಪ್ರಶ್ನೆ ಕೇಳಿ · Ask about arecanut prices | ಅಡಿಕೆ ನಾಡಿ",
      description: "ಅಡಿಕೆ ದರ, ಮಾರುಕಟ್ಟೆ, ಹವಾಮಾನ ಅಥವಾ ಬೆಳೆ ಆರೈಕೆಯ ಬಗ್ಗೆ ಕನ್ನಡ ಅಥವಾ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಕೇಳಿ. ಪ್ರತಿ ಸಂಖ್ಯೆಗೂ ಮೂಲ ತೋರಿಸಲಾಗುತ್ತದೆ.",
    },
    en: {
      title: "Ask about arecanut prices, markets and crop care | Areca Pulse",
      description: "Ask about arecanut prices, markets, weather or crop care in Kannada or English. Every number in an answer is shown with its source.",
    },
  },
  {
    path: "/monthly-trends", label: { kn: "ಅಡಿಕೆ ತಿಂಗಳ ದರ", en: "Monthly arecanut prices" },
    kn: {
      title: "ಅಡಿಕೆ ತಿಂಗಳ ದರ · Monthly arecanut prices | ಅಡಿಕೆ ನಾಡಿ",
      description: "ಕರ್ನಾಟಕದ ತಿಂಗಳ ಸರಾಸರಿ ಅಡಿಕೆ ದರ, ತಳಿವಾರು: ವರ್ಷಗಳ ಏರಿಳಿತ, ಗರಿಷ್ಠ, ಕನಿಷ್ಠ ಮತ್ತು ಋತುಮಾನದ ಮಾದರಿ.",
    },
    en: {
      title: "Monthly arecanut prices in Karnataka by variety | Areca Pulse",
      description: "Karnataka monthly average arecanut prices by variety over the years: highs, lows, year-on-year change and the seasonal pattern.",
    },
  },
  {
    path: "/forecasts", label: { kn: "ಅಡಿಕೆ ದರ ಮುನ್ನೋಟ", en: "Arecanut price outlook" },
    kn: {
      title: "ಅಡಿಕೆ ದರ ಮುನ್ನೋಟ · Arecanut price outlook | ಅಡಿಕೆ ನಾಡಿ",
      description: "ಮುಂದಿನ ತಿಂಗಳ ಅಡಿಕೆ ದರದ ಸಂಭವನೀಯ ವ್ಯಾಪ್ತಿ. ಇದು ಪ್ರಾಯೋಗಿಕ ಅಂದಾಜು, ಸಲಹೆಯಲ್ಲ.",
    },
    en: {
      title: "Arecanut price outlook for next month | Areca Pulse",
      description: "The likely range for next month's arecanut price in Karnataka. An experimental estimate with its tested accuracy, not advice.",
    },
  },
  {
    path: "/overview", label: { kn: "ಅಡಿಕೆ ಮಾರುಕಟ್ಟೆ ಸಮಗ್ರ ನೋಟ", en: "Arecanut market overview" },
    kn: { title: "ಅಡಿಕೆ ಮಾರುಕಟ್ಟೆ ಸಮಗ್ರ ನೋಟ · Arecanut market overview | ಅಡಿಕೆ ನಾಡಿ", description: "ಅಡಿಕೆ ಮಾರುಕಟ್ಟೆಯ ಒಂದು ನೋಟ: ಉಲ್ಲೇಖ ದರ, ವರದಿ ಮಾಡಿದ ಮಾರುಕಟ್ಟೆಗಳು, ಗರಿಷ್ಠ ಮತ್ತು ಕನಿಷ್ಠ ದರ." },
    en: { title: "Arecanut market overview for Karnataka | Areca Pulse", description: "The Karnataka arecanut market at a glance: reference price, reporting markets, and the highest and lowest quotes." },
  },
  {
    path: "/supply", label: { kn: "ಅಡಿಕೆ ಆವಕ ಮತ್ತು ಹವಾಮಾನ", en: "Arecanut arrivals and weather" },
    kn: { title: "ಅಡಿಕೆ ಆವಕ ಮತ್ತು ಹವಾಮಾನ · Arecanut arrivals and weather | ಅಡಿಕೆ ನಾಡಿ", description: "ಮಾರುಕಟ್ಟೆಗೆ ಅಡಿಕೆ ಆವಕ, ಉತ್ಪಾದನೆ ಮತ್ತು ಬೆಳೆ ಪ್ರದೇಶದ ಹವಾಮಾನ." },
    en: { title: "Arecanut arrivals, production and weather | Areca Pulse", description: "Arecanut market arrivals, production and weather in the growing region of Karnataka." },
  },
  {
    path: "/decision-tools", label: { kn: "ಅಡಿಕೆ ಲೆಕ್ಕಾಚಾರ", en: "Arecanut calculator" },
    kn: { title: "ಅಡಿಕೆ ಲೆಕ್ಕಾಚಾರ ಸಾಧನ · Arecanut sell or store calculator | ಅಡಿಕೆ ನಾಡಿ", description: "ಅಡಿಕೆ ಈಗ ಮಾರಿದರೆ ಮತ್ತು ಸಂಗ್ರಹಿಸಿ ನಂತರ ಮಾರಿದರೆ ಸಿಗುವ ಮೊತ್ತವನ್ನು ನಿಮ್ಮದೇ ಖರ್ಚುಗಳೊಂದಿಗೆ ಲೆಕ್ಕ ಹಾಕಿ." },
    en: { title: "Arecanut sell or store calculator | Areca Pulse", description: "Work out what you get from selling arecanut now against storing and selling later, using your own costs." },
  },
  {
    path: "/forecasts/evaluation", label: { kn: "ಮುನ್ಸೂಚನೆ ಪರಿಶೀಲನೆ", en: "Forecast accuracy" },
    kn: { title: "ಅಡಿಕೆ ದರ ಅಂದಾಜಿನ ಪರಿಶೀಲನೆ · Forecast accuracy | ಅಡಿಕೆ ನಾಡಿ", description: "ಅಡಿಕೆ ದರದ ಅಂದಾಜುಗಳು ಹಿಂದೆ ಎಷ್ಟು ನಿಖರವಾಗಿದ್ದವು ಎಂಬ ಪರೀಕ್ಷೆಯ ಫಲಿತಾಂಶ." },
    en: { title: "How accurate are the arecanut price forecasts? | Areca Pulse", description: "Back-test results showing how accurate the arecanut price estimates have been." },
  },
  {
    path: "/intelligence/news", label: { kn: "ಅಡಿಕೆ ಸುದ್ದಿ", en: "Arecanut news" },
    kn: { title: "ಅಡಿಕೆ ಸುದ್ದಿ · Arecanut news | ಅಡಿಕೆ ನಾಡಿ", description: "ಅಡಿಕೆ ಬೆಳೆಗಾರರಿಗೆ ಸಂಬಂಧಿಸಿದ ಅಧಿಕೃತ ಪ್ರಕಟಣೆಗಳು ಮತ್ತು ಸುದ್ದಿ, ಮೂಲದ ಲಿಂಕ್‌ನೊಂದಿಗೆ." },
    en: { title: "Arecanut news and official releases | Areca Pulse", description: "Official releases and news that matter to arecanut growers, each linked to its source." },
  },
  {
    path: "/intelligence/policy", label: { kn: "ಅಡಿಕೆ ನೀತಿ", en: "Arecanut policy" },
    kn: { title: "ಅಡಿಕೆ ನೀತಿ ಮತ್ತು ಆಮದು ನಿಯಮ · Arecanut policy | ಅಡಿಕೆ ನಾಡಿ", description: "ಅಡಿಕೆ ಆಮದು ದರ, ತೆರಿಗೆ ಮತ್ತು ಸರ್ಕಾರದ ನೀತಿ ಬದಲಾವಣೆಗಳು, ಅಧಿಕೃತ ಮೂಲಗಳಿಂದ." },
    en: { title: "Arecanut policy: import price and tax rules | Areca Pulse", description: "Arecanut import price, tax and government policy changes, from official sources." },
  },
  {
    path: "/intelligence/trade", label: { kn: "ಅಡಿಕೆ ಆಮದು ಮತ್ತು ರಫ್ತು", en: "Arecanut imports and exports" },
    kn: { title: "ಅಡಿಕೆ ಆಮದು ಮತ್ತು ರಫ್ತು · Arecanut imports and exports | ಅಡಿಕೆ ನಾಡಿ", description: "ಭಾರತದ ಅಡಿಕೆ ಆಮದು ಮತ್ತು ರಫ್ತು ಅಂಕಿಅಂಶಗಳು, ಅಧಿಕೃತ ಮೂಲಗಳಿಂದ." },
    en: { title: "Arecanut imports and exports of India | Areca Pulse", description: "India's arecanut import and export figures, from official sources." },
  },
  {
    path: "/intelligence/production", label: { kn: "ಅಡಿಕೆ ಉತ್ಪಾದನೆ", en: "Arecanut production" },
    kn: { title: "ಅಡಿಕೆ ಉತ್ಪಾದನೆ ಮತ್ತು ಪ್ರದೇಶ · Arecanut production | ಅಡಿಕೆ ನಾಡಿ", description: "ಅಡಿಕೆ ಬೆಳೆ ಪ್ರದೇಶ ಮತ್ತು ಉತ್ಪಾದನೆಯ ಅಧಿಕೃತ ಅಂದಾಜುಗಳು." },
    en: { title: "Arecanut area and production estimates | Areca Pulse", description: "Official estimates of arecanut area and production." },
  },
  {
    path: "/intelligence/weather", label: { kn: "ಅಡಿಕೆ ಬೆಳೆಗಾರರಿಗೆ ಹವಾಮಾನ", en: "Weather for arecanut growers" },
    kn: { title: "ಶಿರಸಿ ಹವಾಮಾನ · Weather for arecanut growers | ಅಡಿಕೆ ನಾಡಿ", description: "ಅಡಿಕೆ ಬೆಳೆಗಾರರಿಗೆ ಶಿರಸಿ ಭಾಗದ ಮಳೆ, ಉಷ್ಣಾಂಶ ಮತ್ತು ತೇವಾಂಶದ ಮುನ್ಸೂಚನೆ." },
    en: { title: "Sirsi weather forecast for arecanut growers | Areca Pulse", description: "Rain, temperature and humidity forecast for the Sirsi region, for arecanut growers." },
  },
  {
    path: "/intelligence/quality", label: { kn: "ಅಡಿಕೆ ಗುಣಮಟ್ಟ", en: "Arecanut quality" },
    kn: { title: "ಅಡಿಕೆ ಗುಣಮಟ್ಟ ಪರೀಕ್ಷೆ · Arecanut quality | ಅಡಿಕೆ ನಾಡಿ", description: "ಅಡಿಕೆ ಗುಣಮಟ್ಟ ಪರೀಕ್ಷೆಯ ದಾಖಲೆಗಳು." },
    en: { title: "Arecanut quality inspection records | Areca Pulse", description: "Arecanut quality inspection records." },
  },
];

/** Each variety has its own address, so a search for "Rashi arecanut price" can land on that variety's rates. */
export const varietyPath = (key: string) => `/variety/${key}`;
export const varietyFromPath = (path: string) => path.startsWith("/variety/") ? VARIETIES.find((variety) => varietyPath(variety.key) === path) : undefined;

/** The main branch of each cooperative, for descriptions that must stay short enough for a results page. */
const SOURCE_MAIN_BRANCH = { mamcos: "ಮ್ಯಾಮ್ಕೋಸ್ ಶಿವಮೊಗ್ಗ", tss: "ಟಿಎಸ್‌ಎಸ್ ಶಿರಸಿ" };

const SOURCE_PLACES = {
  mamcos: { kn: "ಮ್ಯಾಮ್ಕೋಸ್ (ಶಿವಮೊಗ್ಗ, ಸಾಗರ, ತೀರ್ಥಹಳ್ಳಿ)", en: "MAMCOS (Shivamogga, Sagara, Thirthahalli)" },
  tss: { kn: "ಟಿಎಸ್‌ಎಸ್ (ಶಿರಸಿ, ಸಿದ್ದಾಪುರ, ಯಲ್ಲಾಪುರ)", en: "TSS (Sirsi, Siddapur, Yellapur)" },
};

/** "Rashi arecanut", but not "Fresh red arecanut arecanut": names that already say arecanut are left as they are. */
export const varietyNames = (variety: GrowerVariety) => ({
  kn: variety.kn.includes("ಅಡಿಕೆ") ? variety.kn : `${variety.kn} ಅಡಿಕೆ`,
  en: /areca/i.test(variety.en) ? variety.en : `${variety.en} arecanut`,
});

/**
 * Other names growers search a variety by (Search Console: "kempu adike rate today"). Red, boiled arecanut is
 * "kempu adike" in Malnad, and Rashi is its main grade.
 */
const VARIETY_SEARCH_NAMES: Record<string, { kn: string; en: string }> = { rashi: { kn: "ಕೆಂಪು ಅಡಿಕೆ", en: "kempu adike" } };

export function varietySeo(variety: GrowerVariety): SeoPage {
  const name = varietyNames(variety);
  // Growers search "chali adike rate today", so titles use their words; names already saying areca stay as they are.
  const adike = /areca/i.test(variety.en) ? variety.en : `${variety.en} adike`;
  const also = VARIETY_SEARCH_NAMES[variety.key];
  const sources = (["mamcos", "tss"] as const).filter((source) => variety.labels[source]?.length);
  const where = (language: "kn" | "en") => sources.map((source) => SOURCE_PLACES[source][language]).join(language === "kn" ? " ಮತ್ತು " : " and ");
  return {
    path: varietyPath(variety.key), label: { kn: `${name.kn} ಧಾರಣೆ`, en: `${name.en} price` },
    kn: { title: `${name.kn} ಧಾರಣೆ ಇಂದು · ${adike} rate today | ಅಡಿಕೆ ನಾಡಿ`,
      // Growers also write ರೇಟ್ ("ಸಿಪ್ಪೆ ಅಡಿಕೆ ರೇಟ್"), so the description says both.
      description: `${name.kn}${also ? ` (${also.kn})` : ""} ಇಂದಿನ ರೇಟ್: ${sources.map((source) => SOURCE_MAIN_BRANCH[source]).join(", ")} ಶಾಖೆವಾರು ಧಾರಣೆ, ದಿನಾಂಕ ಮತ್ತು ಮೂಲದೊಂದಿಗೆ.` },
    en: { title: `${adike} rate today: ${name.en} price at ${sources.map((source) => source.toUpperCase()).join(" and ")} | Areca Pulse`,
      description: `Latest ${name.en}${also ? ` (${also.en})` : ""} rates per quintal at ${where("en")}, by branch, each with its date and source.` },
  };
}

/** The list of towns, linked from the footer and navigation; each town page links back to it. */
export const MARKETS_SEO: SeoPage = {
  path: MARKETS_PATH, label: { kn: "ಊರಿನ ಅಡಿಕೆ ಧಾರಣೆ", en: "Arecanut rates by town" },
  kn: { title: "ಊರಿನ ಅಡಿಕೆ ಧಾರಣೆ · Arecanut rates by town | ಅಡಿಕೆ ನಾಡಿ", description: "ಶಿವಮೊಗ್ಗ, ಶಿರಸಿ, ಸಾಗರ, ಪುತ್ತೂರು ಮತ್ತು ಇತರ ಊರುಗಳ ಇಂದಿನ ಅಡಿಕೆ ಧಾರಣೆ: ಸಹಕಾರಿ ಸಂಘ ಮತ್ತು ಎಪಿಎಂಸಿ ದರಗಳು, ದಿನಾಂಕದೊಂದಿಗೆ." },
  en: { title: "Arecanut rates by town: Shivamogga, Sirsi, Puttur and more | Areca Pulse", description: "Today's arecanut (adike) rates town by town: Shivamogga, Sirsi, Sagara, Thirthahalli, Channagiri, Puttur and more. Cooperative and APMC rates, each with its date." },
};

/** The sources a town page shows, named as the page names them. */
function placeSources(place: MarketPlace, language: "kn" | "en") {
  const sources = COOPERATIVE_ORDER.filter((source) => place.branches[source]).map((source) => COOPERATIVE_NAMES[source][language]);
  return place.apmc ? [...sources, language === "kn" ? "ಎಪಿಎಂಸಿ" : "APMC"] : sources;
}

export function marketSeo(place: MarketPlace): SeoPage {
  const join = (language: "kn" | "en") => placeSources(place, language).join(language === "kn" ? ", " : ", ");
  // The older English spelling many still search by ("today adike rate shimoga").
  const en = place.alias ? `${place.en} (${place.alias})` : place.en;
  return {
    path: marketPath(place.slug), label: { kn: `${place.kn} ಅಡಿಕೆ ಧಾರಣೆ`, en: `${place.en} arecanut rate` },
    kn: { title: `${place.kn} ಅಡಿಕೆ ಧಾರಣೆ ಇಂದು · ${en} adike rate today | ಅಡಿಕೆ ನಾಡಿ`,
      // Under about 130 Kannada characters, so a results page shows it whole; the district is on the page itself.
      description: `${place.kn} ಇಂದಿನ ಅಡಿಕೆ ರೇಟ್: ${join("kn")} ದರಗಳು. ರಾಶಿ, ಚಾಲಿ, ಬೆಟ್ಟೆ ಮತ್ತು ಇತರ ತಳಿಗಳು, ದಿನಾಂಕದೊಂದಿಗೆ.` },
    en: { title: `${en} adike rate today: ${join("en")} arecanut prices | Areca Pulse`,
      description: `Latest arecanut (adike) rates in ${en}, ${place.district.en}: ${join("en")}. Rashi, Chali, Bette and more, per quintal, each with its date and source.` },
  };
}

export function seoPage(path: string): SeoPage | undefined {
  const variety = varietyFromPath(path);
  if (variety) return varietySeo(variety);
  const place = marketFromPath(path);
  if (place) return marketSeo(place);
  return path === MARKETS_PATH ? MARKETS_SEO : SEO_PAGES.find((page) => page.path === path);
}

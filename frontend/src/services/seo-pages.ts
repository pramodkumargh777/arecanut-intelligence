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
import { GUIDE_PATH, VARIETY_HUB_PATH } from "./guides";

export type SeoText = { title: string; description: string };
export type SeoPage = { path: string; label: { kn: string; en: string }; kn: SeoText; en: SeoText };

export const SEO_PAGES: SeoPage[] = [
  {
    path: "/", label: { kn: "ಇಂದಿನ ಅಡಿಕೆ ಧಾರಣೆ", en: "Arecanut price today" },
    kn: {
      title: "ಇಂದಿನ ಅಡಿಕೆ ಧಾರಣೆ · Arecanut price today | ಅಡಿಕೆ ನಾಡಿ",
      description: "ಇಂದಿನ ಅಡಿಕೆ ಧಾರಣೆ: ಶಿವಮೊಗ್ಗ, ಶಿರಸಿ ಸೇರಿ ಮ್ಯಾಮ್ಕೋಸ್, ಟಿಎಸ್‌ಎಸ್, ಟಿಎಂಎಸ್ ಮತ್ತು ಎಪಿಎಂಸಿ ದರಗಳು. ರಾಶಿ, ಚಾಲಿ, ಬೆಟ್ಟೆ ದರ ದಿನಾಂಕದೊಂದಿಗೆ.",
    },
    en: {
      title: "Arecanut price today: MAMCOS, TSS and APMC rates | Areca Pulse",
      description: "Today's arecanut (adike, supari) rates in Karnataka: MAMCOS Shivamogga, Sagara and Thirthahalli, TSS Sirsi, Siddapur and Yellapur, TMS Sirsi, and APMC prices. Rashi, Chali, Bette and more, each with its date and source.",
    },
  },
  {
    path: "/prices", label: { kn: "ಅಡಿಕೆ ಮಾರುಕಟ್ಟೆ ದರಗಳು", en: "Arecanut market rates" },
    kn: {
      title: "ಅಡಿಕೆ ಮಾರುಕಟ್ಟೆ ದರಗಳು · Arecanut market rates | ಅಡಿಕೆ ನಾಡಿ",
      description: "ಮ್ಯಾಮ್ಕೋಸ್, ಟಿಎಸ್‌ಎಸ್, ಟಮ್ಕೋಸ್ ಮತ್ತು ಎಪಿಎಂಸಿ ಅಡಿಕೆ ದರಗಳನ್ನು ಮಾರುಕಟ್ಟೆ, ತಳಿವಾರು ಹುಡುಕಿ: ಕನಿಷ್ಠ, ಗರಿಷ್ಠ, ಸರಾಸರಿ ದರ.",
    },
    en: {
      title: "Arecanut market rates by market and variety | Areca Pulse",
      description: "Search arecanut rates by market and variety across MAMCOS, TSS, TMS Sirsi, TUMCOS and APMC (AGMARKNET) markets in Karnataka, with minimum, maximum and average price per quintal.",
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
  {
    path: VARIETY_HUB_PATH, label: { kn: "ಅಡಿಕೆ ತಳಿಗಳು ಮತ್ತು ದರ್ಜೆಗಳು", en: "Arecanut varieties and grades" },
    kn: { title: "ಅಡಿಕೆ ತಳಿಗಳು ಮತ್ತು ದರ್ಜೆಗಳು · Arecanut grades explained | ಅಡಿಕೆ ನಾಡಿ",
      description: "ರಾಶಿ, ಚಾಲಿ, ಬೆಟ್ಟೆ, ಆಪಿ, ಬಿಳೆಗೋಟು, ಸಿಪ್ಪೆಗೋಟು ಮತ್ತು ಇತರ ಅಡಿಕೆ ದರ್ಜೆಗಳು: ಪ್ರತಿಯೊಂದರ ವಿವರ ಮತ್ತು ಇಂದಿನ ಧಾರಣೆ." },
    en: { title: "Arecanut varieties and grades explained | Areca Pulse",
      description: "Every arecanut grade the cooperatives publish, from Rashi and Chali to Bette, Api, Bilegotu and Sippegotu: what each is, with today's rate." },
  },
  {
    path: GUIDE_PATH, label: { kn: "ರಾಶಿ ಮತ್ತು ಚಾಲಿ ವ್ಯತ್ಯಾಸ", en: "Rashi vs Chali" },
    kn: { title: "ರಾಶಿ ಮತ್ತು ಚಾಲಿ ಅಡಿಕೆ ವ್ಯತ್ಯಾಸ · Rashi vs Chali arecanut | ಅಡಿಕೆ ನಾಡಿ",
      description: "ರಾಶಿ (ಕೆಂಪು) ಮತ್ತು ಚಾಲಿ (ಬಿಳಿ) ಅಡಿಕೆ ಹೇಗೆ ತಯಾರಾಗುತ್ತವೆ, ಅವುಗಳ ದರ್ಜೆಗಳು ಮತ್ತು ಎಲ್ಲಿಗೆ ಹೋಗುತ್ತವೆ, ಟಿಎಸ್‌ಎಸ್ ಪ್ರಕಟಣೆಗಳ ಆಧಾರದಲ್ಲಿ." },
    en: { title: "Rashi vs Chali arecanut: how they differ | Areca Pulse",
      description: "How red (Rashi) and white (Chali) arecanut are made, their grades and where each goes, based on TSS Sirsi's published pages." },
  },
];

/** Each variety has its own address, so a search for "Rashi arecanut price" can land on that variety's rates. */
export const varietyPath = (key: string) => `/variety/${key}`;
export const varietyFromPath = (path: string) => path.startsWith("/variety/") ? VARIETIES.find((variety) => varietyPath(variety.key) === path) : undefined;

/** The main branch of each cooperative, for descriptions that must stay short enough for a results page. */
const SOURCE_MAIN_BRANCH = { mamcos: "ಮ್ಯಾಮ್ಕೋಸ್ ಶಿವಮೊಗ್ಗ", tss: "ಟಿಎಸ್‌ಎಸ್ ಶಿರಸಿ", tms: "ಟಿಎಂಎಸ್ ಶಿರಸಿ" };

const SOURCE_PLACES = {
  mamcos: { kn: "ಮ್ಯಾಮ್ಕೋಸ್ (ಶಿವಮೊಗ್ಗ, ಸಾಗರ, ತೀರ್ಥಹಳ್ಳಿ)", en: "MAMCOS (Shivamogga, Sagara, Thirthahalli)" },
  tss: { kn: "ಟಿಎಸ್‌ಎಸ್ (ಶಿರಸಿ, ಸಿದ್ದಾಪುರ, ಯಲ್ಲಾಪುರ)", en: "TSS (Sirsi, Siddapur, Yellapur)" },
  tms: { kn: "ಟಿಎಂಎಸ್ (ಶಿರಸಿ)", en: "TMS (Sirsi)" },
};

/** "A, B and C" in either language. */
const listOf = (items: string[], language: "kn" | "en") => items.length < 2 ? items.join("")
  : `${items.slice(0, -1).join(", ")}${language === "kn" ? " ಮತ್ತು " : " and "}${items.at(-1)}`;

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

/**
 * A variety's page. `shown` names the cooperatives whose rates the written page carries, so its description never names
 * a source the page does not show; without it (the app), every source publishing the grade is named.
 */
export function varietySeo(variety: GrowerVariety, shown?: readonly string[]): SeoPage {
  const name = varietyNames(variety);
  // Growers search "chali adike rate today", so titles use their words; names already saying areca stay as they are.
  const adike = /areca/i.test(variety.en) ? variety.en : `${variety.en} adike`;
  const also = VARIETY_SEARCH_NAMES[variety.key];
  // Array.isArray: pages are also built with VARIETIES.map(varietySeo), which passes an index here.
  const only = Array.isArray(shown) ? shown : undefined;
  const sources = (["mamcos", "tss", "tms"] as const).filter((source) => variety.labels[source]?.length && (!only || only.includes(source)));
  const where = (language: "kn" | "en") => listOf(sources.map((source) => SOURCE_PLACES[source][language]), language);
  return {
    path: varietyPath(variety.key), label: { kn: `${name.kn} ಧಾರಣೆ`, en: `${name.en} price` },
    // No "| ಅಡಿಕೆ ನಾಡಿ": Kannada letters are wide, and the brand is already in og:site_name.
    kn: { title: `${name.kn} ಧಾರಣೆ ಇಂದು · ${adike} rate today`,
      // Growers also write ರೇಟ್ ("ಸಿಪ್ಪೆ ಅಡಿಕೆ ರೇಟ್"), so the description says both.
      description: `${name.kn}${also ? ` (${also.kn})` : ""} ಇಂದಿನ ರೇಟ್: ${sources.map((source) => SOURCE_MAIN_BRANCH[source]).join(", ")} ಶಾಖೆವಾರು ಧಾರಣೆ, ದಿನಾಂಕ ಮತ್ತು ಮೂಲದೊಂದಿಗೆ.` },
    en: { title: `${adike} rate today: ${name.en} price at ${listOf(sources.map((source) => source.toUpperCase()), "en")} | Areca Pulse`,
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
    kn: { title: `${place.kn} ಅಡಿಕೆ ಧಾರಣೆ ಇಂದು · ${en} adike rate today`,
      // Under about 130 Kannada characters, so a results page shows it whole; the district is on the page itself.
      description: `${place.kn} ಇಂದಿನ ಅಡಿಕೆ ರೇಟ್: ${join("kn")} ದರಗಳು. ರಾಶಿ, ಚಾಲಿ, ಬೆಟ್ಟೆ ಮತ್ತು ಇತರ ತಳಿಗಳು, ದಿನಾಂಕದೊಂದಿಗೆ.` },
    en: { title: `${en} adike rate today: ${join("en")} arecanut prices | Areca Pulse`,
      description: `Latest arecanut (adike) rates in ${en}, ${place.district.en}: ${join("en")}. Rashi, Chali, Bette and more, per quintal, each with its date and source.` },
  };
}

/*
 * Dated search snippets. A grower searching "ಇಂದಿನ ಅಡಿಕೆ ಧಾರಣೆ" picks the result that shows today's date and price, so the
 * build (refreshed after each morning and evening collection) writes the newest rate date into the Kannada title and
 * leads the description with those rates. The visible page is unchanged; only the head of the written HTML differs.
 */

const KN_MONTHS = ["ಜನವರಿ", "ಫೆಬ್ರವರಿ", "ಮಾರ್ಚ್", "ಏಪ್ರಿಲ್", "ಮೇ", "ಜೂನ್", "ಜುಲೈ", "ಆಗಸ್ಟ್", "ಸೆಪ್ಟೆಂಬರ್", "ಅಕ್ಟೋಬರ್", "ನವೆಂಬರ್", "ಡಿಸೆಂಬರ್"];
/** "19 ನವೆಂಬರ್" for 2026-11-19, as Kannada papers date their rate columns. */
export const knDate = (date: string) => `${Number(date.slice(8, 10))} ${KN_MONTHS[Number(date.slice(5, 7)) - 1]}`;

/**
 * Rates quoted together must be at most this many days older than the newest, so one date honestly covers them. Zero:
 * a snippet dated "26 ನವೆಂಬರ್" quotes only rates reported on 26 November (an SEO audit found older branches' rates under
 * the newest date, 27 Nov 2026).
 */
const SNIPPET_WINDOW_DAYS = 0;
/** A snippet is written only when its date is this recent at build time; otherwise the page keeps its plain title. */
const SNIPPET_MAX_AGE_DAYS = 4;

export type SnippetRow = { name: string; date: string; price: number | null };
export type Snippet = { date: string; prices: { name: string; low: number; high: number }[] };

const daysBefore = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/**
 * The newest date among the rows and, for up to `limit` names in the rows' order, the range of prices reported near it.
 * Rows with an empty name give one unnamed range (a variety page, where the name is already in the title).
 */
export function snippetFrom(rows: SnippetRow[], limit = 2, today = new Date().toISOString().slice(0, 10)): Snippet | null {
  const priced = rows.filter((row): row is SnippetRow & { price: number } => row.price !== null && row.price > 0);
  if (!priced.length) return null;
  const date = priced.reduce((newest, row) => row.date > newest ? row.date : newest, priced[0].date);
  if (date < daysBefore(today, SNIPPET_MAX_AGE_DAYS)) return null;
  const since = daysBefore(date, SNIPPET_WINDOW_DAYS);
  const byName = new Map<string, number[]>();
  for (const row of priced) if (row.date >= since) byName.set(row.name, [...(byName.get(row.name) ?? []), Math.round(row.price)]);
  const prices = [...byName].slice(0, limit).map(([name, values]) => ({ name, low: Math.min(...values), high: Math.max(...values) }));
  return { date, prices };
}

const rupee = (value: number) => `₹${value.toLocaleString("en-IN")}`;

/** The page with the snippet's date in its Kannada title and its rates leading the Kannada description. */
export function withSnippet(page: SeoPage, snippet: Snippet | null): SeoPage {
  if (!snippet?.prices.length) return page;
  const date = knDate(snippet.date);
  const split = page.kn.title.indexOf(" · ");
  const title = split < 0 ? `${page.kn.title} ${date}` : `${page.kn.title.slice(0, split)} ${date}${page.kn.title.slice(split)}`;
  const rates = snippet.prices.map(({ name, low, high }) => `${name ? `${name} ` : ""}${rupee(low)}${high > low ? `–${rupee(high)}` : ""}`).join(", ");
  return { ...page, kn: { title, description: `${date} ಧಾರಣೆ: ${rates}. ${page.kn.description}` } };
}

/** Whether a title is the dated form of a page's Kannada title, as withSnippet writes it. */
export function isDatedTitle(title: string, kn: SeoText) {
  const split = kn.title.indexOf(" · ");
  const [head, rest] = split < 0 ? [kn.title, ""] : [kn.title.slice(0, split), kn.title.slice(split)];
  return title !== kn.title && title.startsWith(`${head} `) && title.endsWith(rest)
    && KN_MONTHS.some((month) => title.slice(head.length, title.length - rest.length).endsWith(` ${month}`));
}

export function seoPage(path: string): SeoPage | undefined {
  const variety = varietyFromPath(path);
  if (variety) return varietySeo(variety);
  const place = marketFromPath(path);
  if (place) return marketSeo(place);
  return path === MARKETS_PATH ? MARKETS_SEO : SEO_PAGES.find((page) => page.path === path);
}

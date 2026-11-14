import type { CooperativeQuote, CooperativeSource } from "./cooperative";
import { VARIETIES, type GrowerVariety } from "./varieties";

/**
 * A town with an arecanut market, and the exact name each source publishes it under. A page per town answers searches
 * such as "Sirsi adike rate". Sources are listed side by side on the page and never combined: a MAMCOS branch average,
 * a TSS tender average and an APMC modal price are different prices.
 */
export type MarketPlace = {
  slug: string; en: string; kn: string;
  district: { en: string; kn: string };
  /** Branch names exactly as each cooperative publishes them (case matters). */
  branches: Partial<Record<CooperativeSource, string>>;
  /** The AGMARKNET market name exactly as /markets returns it. */
  apmc?: string;
  /** An older English spelling people still search by (Shimoga, Mangalore), added to the page title. */
  alias?: string;
};

const SHIVAMOGGA = { en: "Shivamogga", kn: "ಶಿವಮೊಗ್ಗ" };
const DAVANAGERE = { en: "Davanagere", kn: "ದಾವಣಗೆರೆ" };
const CHIKKAMAGALURU = { en: "Chikkamagaluru", kn: "ಚಿಕ್ಕಮಗಳೂರು" };
const UTTARA_KANNADA = { en: "Uttara Kannada", kn: "ಉತ್ತರ ಕನ್ನಡ" };
const DAKSHINA_KANNADA = { en: "Dakshina Kannada", kn: "ದಕ್ಷಿಣ ಕನ್ನಡ" };

export const MARKET_PLACES: MarketPlace[] = [
  { slug: "shivamogga", en: "Shivamogga", kn: "ಶಿವಮೊಗ್ಗ", alias: "Shimoga", district: SHIVAMOGGA, branches: { mamcos: "SHIVAMOGGA" }, apmc: "Shimoga APMC" },
  { slug: "sirsi", en: "Sirsi", kn: "ಶಿರಸಿ", district: UTTARA_KANNADA, branches: { tss: "Sirsi" }, apmc: "Sirsi APMC" },
  { slug: "sagara", en: "Sagara", kn: "ಸಾಗರ", alias: "Sagar", district: SHIVAMOGGA, branches: { mamcos: "SAGARA" }, apmc: "Sagar APMC" },
  { slug: "thirthahalli", en: "Thirthahalli", kn: "ತೀರ್ಥಹಳ್ಳಿ", district: SHIVAMOGGA, branches: { mamcos: "THIRTHAHALLI" }, apmc: "APMC THIRTHAHALLI" },
  { slug: "channagiri", en: "Channagiri", kn: "ಚನ್ನಗಿರಿ", district: DAVANAGERE, branches: { mamcos: "CHANNAGIRI", tumcos: "Channagiri" }, apmc: "Channagiri APMC" },
  { slug: "siddapur", en: "Siddapur", kn: "ಸಿದ್ದಾಪುರ", district: UTTARA_KANNADA, branches: { tss: "Siddapur" }, apmc: "Siddapur APMC" },
  { slug: "yellapur", en: "Yellapur", kn: "ಯಲ್ಲಾಪುರ", district: UTTARA_KANNADA, branches: { tss: "Yellapur" }, apmc: "Yellapur APMC" },
  { slug: "puttur", en: "Puttur", kn: "ಪುತ್ತೂರು", district: DAKSHINA_KANNADA, branches: {}, apmc: "Puttur APMC" },
  { slug: "mangaluru", en: "Mangaluru", kn: "ಮಂಗಳೂರು", alias: "Mangalore", district: DAKSHINA_KANNADA, branches: {}, apmc: "Mangaluru APMC" },
  { slug: "bantwal", en: "Bantwal", kn: "ಬಂಟ್ವಾಳ", district: DAKSHINA_KANNADA, branches: {}, apmc: "Bantwala APMC" },
  { slug: "belthangady", en: "Belthangady", kn: "ಬೆಳ್ತಂಗಡಿ", district: DAKSHINA_KANNADA, branches: {}, apmc: "Belthangdi APMC" },
  { slug: "sullia", en: "Sullia", kn: "ಸುಳ್ಯ", district: DAKSHINA_KANNADA, branches: {}, apmc: "Sulya APMC" },
  { slug: "shikaripura", en: "Shikaripura", kn: "ಶಿಕಾರಿಪುರ", district: SHIVAMOGGA, branches: { mamcos: "SHIKARIPURA" }, apmc: "Shikaripura APMC" },
  { slug: "soraba", en: "Soraba", kn: "ಸೊರಬ", district: SHIVAMOGGA, branches: { mamcos: "SORABA" }, apmc: "Sorabha APMC" },
  { slug: "hosanagara", en: "Hosanagara", kn: "ಹೊಸನಗರ", district: SHIVAMOGGA, branches: { mamcos: "Hosanagara" }, apmc: "Hosanagara APMC" },
  { slug: "bhadravathi", en: "Bhadravathi", kn: "ಭದ್ರಾವತಿ", district: SHIVAMOGGA, branches: { mamcos: "BHADRAVATHI" }, apmc: "Bhadravathi APMC" },
  { slug: "koppa", en: "Koppa", kn: "ಕೊಪ್ಪ", district: CHIKKAMAGALURU, branches: { mamcos: "KOPPA" }, apmc: "Koppa APMC" },
  { slug: "sringeri", en: "Sringeri", kn: "ಶೃಂಗೇರಿ", district: CHIKKAMAGALURU, branches: { mamcos: "SRINGERI" } },
  { slug: "jayapura", en: "Jayapura", kn: "ಜಯಪುರ", district: CHIKKAMAGALURU, branches: { mamcos: "JAYAPURA" } },
  { slug: "tarikere", en: "Tarikere", kn: "ತರೀಕೆರೆ", district: CHIKKAMAGALURU, branches: { mamcos: "Tarikere" }, apmc: "Tarikere APMC" },
  { slug: "kumta", en: "Kumta", kn: "ಕುಮಟಾ", district: UTTARA_KANNADA, branches: {}, apmc: "Kumta APMC" },
  { slug: "honnavar", en: "Honnavar", kn: "ಹೊನ್ನಾವರ", district: UTTARA_KANNADA, branches: {}, apmc: "Honnavar APMC" },
];

export const MARKETS_PATH = "/market";
export const marketPath = (slug: string) => `${MARKETS_PATH}/${slug}`;
export const marketFromPath = (path: string) => path.startsWith(`${MARKETS_PATH}/`) ? MARKET_PLACES.find((place) => marketPath(place.slug) === path) : undefined;
export const marketBySlug = (slug: string | undefined) => MARKET_PLACES.find((place) => place.slug === slug);

/** Cooperatives in the order the page shows them. */
export const COOPERATIVE_ORDER: CooperativeSource[] = ["mamcos", "tss", "tumcos"];
export const COOPERATIVE_NAMES: Record<CooperativeSource, { en: string; kn: string }> = {
  mamcos: { en: "MAMCOS", kn: "ಮ್ಯಾಮ್ಕೋಸ್" }, tss: { en: "TSS", kn: "ಟಿಎಸ್‌ಎಸ್" }, tumcos: { en: "TUMCOS", kn: "ಟಮ್ಕೋಸ್" },
};

/** The grower's name for a source label, through the variety catalogue; labels outside it keep the source's spelling. */
export function varietyForLabel(source: CooperativeSource, label: string): GrowerVariety | undefined {
  return VARIETIES.find((variety) => variety.labels[source]?.includes(label));
}

/** Rows in catalogue order (Rashi, Chali, Sippe gotu, …), then anything the catalogue does not know, alphabetically. */
export function sortByCatalogue(source: CooperativeSource, rows: CooperativeQuote[]) {
  const rank = (row: CooperativeQuote) => { const index = VARIETIES.findIndex((variety) => variety.labels[source]?.includes(row.variety)); return index < 0 ? VARIETIES.length : index; };
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.variety.localeCompare(b.variety));
}

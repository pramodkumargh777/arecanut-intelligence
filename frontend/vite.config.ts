import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { MARKETS_SEO, marketSeo, SEO_PAGES, snippetFrom, varietyNames, varietySeo, withSnippet, type SeoPage } from "./src/services/seo-pages";
import { agmarknetVarietyName } from "./src/services/agmarknetVarieties";
import { COOPERATIVE_NAMES, COOPERATIVE_ORDER, MARKET_PLACES, marketPath, sortByCatalogue, varietyForLabel, type MarketPlace } from "./src/services/markets";
import { VARIETIES, VARIETY_GROUPS, type GrowerVariety } from "./src/services/varieties";
import { PLACE_NAMES_KN } from "./src/services/places";
import type { CooperativeQuote } from "./src/services/cooperative";
import { FAQ_FILE, faqJsonLd, UPDATE_QUESTION, type FaqFile, type FaqItem } from "./src/services/faq";
import { ABOUT_FILE, type AboutEntry, type AboutFile } from "./src/services/about";
import { GRADE_NOTES, GUIDE_PATH, RASHI_CHALI_GUIDE, VARIETY_HUB_PATH, VARIETY_HUB_TEXT } from "./src/services/guides";

import { MONTH_NAMES_KN } from "../shared/dates";

/** Where the site is served. Link previews and the sitemap need absolute addresses. */
const DEFAULT_SITE_URL = "https://adikenaadi.com";

/** Public pages listed in the sitemap. Workspace and data-quality pages are private to each visitor or reviewer. */
const MARKET_PAGES = [MARKETS_SEO, ...MARKET_PLACES.map(marketSeo)];
const SITEMAP_PATHS = [...SEO_PAGES, ...MARKET_PAGES].map((page) => page.path);

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Styles for the HTML a page carries before its scripts run (shown for a moment on a slow phone, read by crawlers). */
// html[data-js] is set by public/theme-init.js before the body is read, so readers with scripts never see this copy.
const STATIC_STYLE = `<style>html[data-js] .static-page{display:none}.static-page{max-width:760px;margin:0 auto;padding:24px 16px;line-height:1.6}.static-page table{width:100%;border-collapse:collapse;margin:12px 0 20px}`
  + `.static-page th,.static-page td{text-align:left;padding:8px 6px;border-bottom:1px solid rgba(128,128,128,.3);font-size:14px}`
  + `.static-page nav ul{display:flex;flex-wrap:wrap;gap:4px 16px;margin:24px 0 0;padding:0;list-style:none;font-size:14px}</style>`;

/**
 * index.html rewritten for one page: its own title, description, canonical address and link-preview text, and real
 * content inside the app's root: the page's heading and text (or the rates written for it), then links to every other
 * public page. Crawlers and checkers that do not run scripts read this; the app replaces it when it starts. The
 * markers let the built home page be rewritten for each other page.
 */
function pageHtml(html: string, siteUrl: string, page: SeoPage, linked: SeoPage[] = [], content = "", structured: object[] = []) {
  const url = `${siteUrl}${page.path}`;
  // One language per meta description keeps it near the 160 characters a results page shows; the title carries both.
  const description = page.kn.description;
  const links = [...SEO_PAGES, ...linked].filter((other) => other.path !== page.path)
    .map((other) => `<li><a href="${other.path}">${escapeHtml(other.label.kn)} · ${escapeHtml(other.label.en)}</a></li>`).join("");
  const nav = `<nav aria-label="ಪುಟಗಳು · Pages"><ul>${links}</ul></nav>`;
  const body = content
    ? content.replace(/<\/main>\s*$/, `${nav}</main>`)
    : `<main class="static-page"><h1>${escapeHtml(page.label.kn)} · ${escapeHtml(page.label.en)}</h1><p lang="kn">${escapeHtml(page.kn.description)}</p><p lang="en">${escapeHtml(page.en.description)}</p>${nav}</main>`;
  const meta = (pattern: RegExp, value: string) => { html = html.replace(pattern, (_match, start: string, end: string) => `${start}${escapeHtml(value)}${end}`); };
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(page.kn.title)}</title>`);
  meta(/(<meta name="description" content=")[^"]*(")/, description);
  meta(/(<meta property="og:title" content=")[^"]*(")/, page.kn.title);
  meta(/(<meta property="og:description" content=")[^"]*(")/, `${page.kn.description} ${page.en.description}`);
  meta(/(<meta property="og:url" content=")[^"]*(")/, url);
  meta(/(<link rel="canonical" href=")[^"]*(")/, url);
  // The old no-script copy is no longer used: the same content now sits in the root, where every reader finds it.
  html = html.replace(/<!--seo-fallback-->|<noscript><main>[\s\S]*?<\/main><\/noscript>/, "");
  // Page-specific structured data (breadcrumbs, questions): data blocks, which the CSP does not run. "<" is escaped so
  // no text inside can close the script element.
  const data = structured.map((item) => `<script type="application/ld+json">${JSON.stringify(item).replace(/</g, "\\u003c")}</script>`).join("");
  html = html.replace(/<!--page-ld-->[\s\S]*?<!--\/page-ld-->|<\/head>/, (match) => `<!--page-ld-->${data}<!--/page-ld-->${match === "</head>" ? "</head>" : ""}`);
  const block = `<div id="root"><!--static-->${STATIC_STYLE}${body}<!--/static--></div>`;
  return html.replace(/<div id="root">(?:<!--static-->[\s\S]*?<!--\/static-->)?<\/div>/, () => block);
}

type Rate = { source: "mamcos" | "tss" | "tms"; branch: string; reporting_date: string; minimum_price: number | null; maximum_price: number | null; average_price: number | null };

/** Rates older than this are left out of the written pages; the live screen marks them as old instead. */
const STATIC_RATE_DAYS = 30;

/**
 * The latest published rate per branch for every variety, read from the public API when the site is built. A failure
 * leaves the pages without written prices rather than failing the build: the live screen still loads them.
 */
async function latestRates(apiUrl: string) {
  const rates = new Map<string, Rate[]>();
  const oldest = new Date(Date.now() - STATIC_RATE_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const variety of VARIETIES) {
    const rows: Rate[] = [];
    // TMS too, so a variety page writes every cooperative its live page shows (its description names only these).
    for (const source of ["mamcos", "tss", "tms"] as const) for (const label of variety.labels[source] ?? []) {
      const response = await fetch(`${apiUrl}/cooperative/prices?${new URLSearchParams({ source, variety: label, commodity: "arecanut", limit: "10" })}`, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`${source} ${label}: HTTP ${response.status}`);
      const body = await response.json() as { latest_by_branch?: Omit<Rate, "source">[] };
      rows.push(...(body.latest_by_branch ?? []).filter((row) => row.average_price !== null && row.reporting_date >= oldest).map((row) => ({ ...row, source })));
    }
    if (rows.length) rates.set(variety.key, rows);
  }
  return rates;
}

const SOURCE_NAMES = { mamcos: "ಮ್ಯಾಮ್ಕೋಸ್ · MAMCOS", tss: "ಟಿಎಸ್‌ಎಸ್ · TSS", tms: "ಟಿಎಂಎಸ್ · TMS" };
/** Whole rupees: TMS publishes paise (₹41,797.17). */
const rupees = (value: number | null) => value === null ? "" : `₹${Math.round(value).toLocaleString("en-IN")}`;
const dayText = (date: string) => day(date);
const day = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A table of rates: cooperative, branch, date, average and range, as the rates screen shows them once it loads. */
function rateTable(rows: Rate[]) {
  const body = rows.map((row) => {
    const place = PLACE_NAMES_KN[row.branch.toUpperCase()];
    // MAMCOS prints its branches in capitals; a reader searches for "Shivamogga".
    const branch = row.branch === row.branch.toUpperCase() ? row.branch.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) : row.branch;
    const range = row.minimum_price !== null && row.maximum_price !== null ? `${rupees(row.minimum_price)} – ${rupees(row.maximum_price)}` : "";
    return `<tr><td>${SOURCE_NAMES[row.source]}</td><td>${escapeHtml(place ? `${place} · ${branch}` : branch)}</td><td><time datetime="${row.reporting_date}">${day(row.reporting_date)}</time></td><td>${rupees(row.average_price)}</td><td>${range}</td></tr>`;
  }).join("");
  return `<table><thead><tr><th>ಸಂಘ · Cooperative</th><th>ಶಾಖೆ · Branch</th><th>ದಿನಾಂಕ · Date</th><th>ಸರಾಸರಿ · Average</th><th>ಕನಿಷ್ಠ – ಗರಿಷ್ಠ · Range</th></tr></thead><tbody>${body}</tbody></table>`;
}

/** The home page: its heading and text, then the latest rates of the everyday varieties, each under its own heading. */
function homeHtml(page: SeoPage, rates: Map<string, Rate[]>) {
  const sections = VARIETIES.filter((variety) => variety.everyday && rates.has(variety.key)).map((variety) => {
    const name = varietyNames(variety);
    return `<h2><a href="${varietySeo(variety).path}">${escapeHtml(name.kn)} · ${escapeHtml(name.en)}</a></h2>${rateTable(rates.get(variety.key)!)}`;
  }).join("");
  return `<main class="static-page"><h1>${escapeHtml(page.label.kn)} · ${escapeHtml(page.label.en)}</h1>`
    + `<p lang="kn">${escapeHtml(page.kn.description)}</p><p lang="en">${escapeHtml(page.en.description)}</p>${sections}`
    + (sections ? `<p>ದರಗಳು ಮೂಲ ಪ್ರಕಟಿಸಿದಂತೆಯೇ, ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ. Rates as each cooperative publishes them, per quintal.</p>` : "") + `</main>`;
}

/** `short` is the Kannada variety name a search snippet quotes; empty when there is no established one to quote. */
type PlaceRate = { source: string; name: string; short: string; date: string; price: number | null; minimum: number | null; maximum: number | null; key?: string };

/**
 * Each town's latest rates from every source it has, read from the public API when the site is built. A town whose
 * rates cannot be read is written without them; the live page still loads them.
 */
async function placeRates(apiUrl: string, place: MarketPlace) {
  const oldest = new Date(Date.now() - STATIC_RATE_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows: PlaceRate[] = [];
  for (const source of COOPERATIVE_ORDER) {
    const branch = place.branches[source];
    if (!branch) continue;
    const response = await fetch(`${apiUrl}/cooperative/branch-latest?${new URLSearchParams({ source, branch })}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`${source} ${branch}: HTTP ${response.status}`);
    const body = await response.json() as { data: CooperativeQuote[] };
    for (const row of sortByCatalogue(source, body.data.filter((item) => item.reporting_date >= oldest))) {
      const variety = varietyForLabel(source, row.variety);
      rows.push({ source: `${COOPERATIVE_NAMES[source].kn} · ${COOPERATIVE_NAMES[source].en}`, name: source === "tumcos" ? "ಅಡಿಕೆ · Arecanut" : variety ? `${variety.kn} · ${variety.en}` : row.variety,
        short: source === "tumcos" ? "ಅಡಿಕೆ" : variety?.kn ?? "", date: row.reporting_date, price: row.average_price, minimum: row.minimum_price, maximum: row.maximum_price,
        key: source === "tumcos" ? undefined : variety?.key });
    }
  }
  const apmcId = place.apmc ? await marketId(apiUrl, place.apmc) : null;
  if (place.apmc && apmcId) {
    const response = await fetch(`${apiUrl}/prices?${new URLSearchParams({ market_id: apmcId, from: oldest, limit: "200", include_count: "false" })}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`APMC ${place.apmc}: HTTP ${response.status}`);
    const body = await response.json() as { data: { market_name: string; variety_name: string; grade?: string | null; reporting_date: string; modal_price: number; minimum_price: number; maximum_price: number }[] };
    const seen = new Set<string>();
    for (const row of body.data) {
      const key = `${row.variety_name}|${row.grade ?? ""}`;
      if (row.market_name !== place.apmc || seen.has(key)) continue;
      seen.add(key);
      rows.push({ source: "ಎಪಿಎಂಸಿ · APMC", name: row.grade ? `${row.variety_name} (${row.grade})` : row.variety_name, short: apmcSnippetName(row.variety_name), date: row.reporting_date, price: row.modal_price, minimum: row.minimum_price, maximum: row.maximum_price });
    }
  }
  return rows;
}

/**
 * AGMARKNET market ids by name, read once per build. Town lookups go by market id, which the database answers from
 * its (market, date) index; a text search (q=) scans every price row and, once per town and page, used up D1's free
 * daily read allowance (14 Nov 2026).
 */
let marketIds: Promise<Map<string, string>> | null = null;
function marketId(apiUrl: string, name: string) {
  marketIds ??= fetch(`${apiUrl}/markets`, { signal: AbortSignal.timeout(20_000) })
    .then(async (response) => {
      if (!response.ok) throw new Error(`markets: HTTP ${response.status}`);
      const body = await response.json() as { data: { id: string; name: string }[] };
      return new Map(body.data.map((market) => [market.name, market.id]));
    });
  return marketIds.then((ids) => ids.get(name) ?? null);
}

/** Months of APMC history written into a town's page for search engines. */
const STATIC_HISTORY_MONTHS = 12;
/** Varieties shown in that history: the ones with the most reports at the town's APMC. */
const STATIC_HISTORY_VARIETIES = 3;
type PlaceHistory = { varieties: string[]; months: { month: string; prices: (number | null)[] }[] };

const middle = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : Math.round((sorted[half - 1] + sorted[half]) / 2);
};

/**
 * A town's APMC prices over the last year, month by month: the median of each day's modal price for its most reported
 * varieties. Read from the published AGMARKNET history (the daily backfill), so it only ever shows verified prices.
 */
async function placeHistory(apiUrl: string, place: MarketPlace): Promise<PlaceHistory | null> {
  if (!place.apmc) return null;
  const from = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - (STATIC_HISTORY_MONTHS - 1), 1)).toISOString().slice(0, 10);
  const id = await marketId(apiUrl, place.apmc);
  if (!id) return null;
  const byVariety = new Map<string, Map<string, number[]>>();
  let cursor: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams({ market_id: id, from, limit: "1000", include_count: "false" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`${apiUrl}/prices?${params}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`APMC history ${place.apmc}: HTTP ${response.status}`);
    const body = await response.json() as { data: { market_name: string; variety_name: string; reporting_date: string; modal_price: number | null }[]; next_cursor?: string | null; has_more?: boolean };
    for (const row of body.data) {
      if (row.market_name !== place.apmc || row.modal_price === null || row.modal_price <= 0) continue;
      const months = byVariety.get(row.variety_name) ?? new Map<string, number[]>();
      const month = row.reporting_date.slice(0, 7);
      months.set(month, [...(months.get(month) ?? []), row.modal_price]);
      byVariety.set(row.variety_name, months);
    }
    if (!body.has_more || !body.next_cursor) break;
    cursor = body.next_cursor;
  }
  const count = (months: Map<string, number[]>) => [...months.values()].reduce((sum, values) => sum + values.length, 0);
  const varieties = [...byVariety].sort((a, b) => count(b[1]) - count(a[1])).slice(0, STATIC_HISTORY_VARIETIES).map(([name]) => name);
  const months = [...new Set(varieties.flatMap((name) => [...byVariety.get(name)!.keys()]))].sort().reverse();
  if (!varieties.length || months.length < 2) return null;
  return { varieties, months: months.map((month) => ({ month, prices: varieties.map((name) => {
    const values = byVariety.get(name)!.get(month);
    return values?.length ? middle(values) : null;
  }) })) };
}

const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

function historyHtml(place: MarketPlace, history: PlaceHistory) {
  const head = history.varieties.map((name) => `<th>${escapeHtml(name)}</th>`).join("");
  const body = history.months.map((row) => `<tr><td><time datetime="${row.month}">${monthLabel(row.month)}</time></td>${row.prices.map((price) => `<td>${price === null ? "—" : rupees(price)}</td>`).join("")}</tr>`).join("");
  return `<h2>${escapeHtml(place.kn)} ಎಪಿಎಂಸಿ: ಕಳೆದ ${STATIC_HISTORY_MONTHS} ತಿಂಗಳ ಧಾರಣೆ · ${escapeHtml(place.en)} APMC: last ${STATIC_HISTORY_MONTHS} months</h2>`
    + `<p>ಪ್ರತಿ ತಿಂಗಳ ದೈನಂದಿನ ಮಾದರಿ ದರಗಳ ಮಧ್ಯಮ ಮೌಲ್ಯ, ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ (AGMARKNET). Median of each month's daily modal prices, per quintal (AGMARKNET).</p>`
    + `<table><thead><tr><th>ತಿಂಗಳು · Month</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** A town's rates as plain HTML, the same rows the town page shows once it loads. */
function placeHtml(place: MarketPlace, rows: PlaceRate[], history: PlaceHistory | null = null, about: AboutEntry | null = null) {
  const body = rows.map((row) => `<tr><td>${escapeHtml(row.source)}</td><td>${escapeHtml(row.name)}</td><td><time datetime="${row.date}">${day(row.date)}</time></td><td>${rupees(row.price)}</td><td>${row.minimum !== null && row.maximum !== null ? `${rupees(row.minimum)} – ${rupees(row.maximum)}` : ""}</td></tr>`).join("");
  return `<main class="static-page">`
    // The older spelling too ("Shimoga"), which AGMARKNET and many searches still use.
    + `<h1>${escapeHtml(place.kn)} ಅಡಿಕೆ ಧಾರಣೆ · ${escapeHtml(place.en)}${place.alias ? ` (${escapeHtml(place.alias)})` : ""} arecanut rates</h1>`
    + `<p>${escapeHtml(place.district.kn)} ಜಿಲ್ಲೆ · ${escapeHtml(place.district.en)} district. ಇತ್ತೀಚಿನ ವರದಿಯಾದ ದರಗಳು, ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ. Latest reported rates, per quintal.</p>`
    + `<table><thead><tr><th>ಮೂಲ · Source</th><th>ತಳಿ · Variety</th><th>ದಿನಾಂಕ · Date</th><th>ದರ · Rate</th><th>ಕನಿಷ್ಠ – ಗರಿಷ್ಠ · Range</th></tr></thead><tbody>${body}</tbody></table>`
    + `<p>ದರಗಳು ಮೂಲ ಪ್ರಕಟಿಸಿದಂತೆ; ಮೂಲಗಳನ್ನು ಒಟ್ಟುಗೂಡಿಸಿಲ್ಲ. Rates as each source publishes them; sources are never combined.</p>`
    + (about ? aboutHtml(about) : "") + (history ? historyHtml(place, history) : "") + `</main>`;
}

/* ---------- "today's rates" questions, sitemap dates and breadcrumbs ---------- */

/** Answers quote whole rupees; TMS publishes paise (₹41,797.17), which reads oddly in a sentence. */
const whole = (value: number | null) => rupees(value === null ? null : Math.round(value));
const newestOf = (dates: string[]) => dates.reduce((a, b) => (b > a ? b : a), "");
const knDay = (date: string) => { const [, month, d] = date.split("-").map(Number); return `${d} ${MONTH_NAMES_KN[month - 1]}`; };
const branchNames = (branch: string) => {
  const en = branch === branch.toUpperCase() ? branch.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) : branch;
  return { kn: PLACE_NAMES_KN[branch.toUpperCase()] ?? en, en };
};

/**
 * "What is today's <source> <variety> rate?", answered from that source's newest report day: one branch's average, or
 * the range across its branches with the highest named. Null when the source has no rate for the variety.
 */
function sourceRateItem(variety: GrowerVariety, source: Rate["source"], rates: Rate[]): FaqItem | null {
  const rows = rates.filter((row) => row.source === source && row.average_price !== null);
  if (!rows.length) return null;
  const date = newestOf(rows.map((row) => row.reporting_date));
  const day = rows.filter((row) => row.reporting_date === date).sort((a, b) => b.average_price! - a.average_price!);
  const src = COOPERATIVE_NAMES[source], top = day[0], low = day.at(-1)!, top_ = branchNames(top.branch);
  const one = day.length === 1 || Math.round(top.average_price!) === Math.round(low.average_price!);
  return {
    q: { kn: `ಇಂದಿನ ${src.kn} ${variety.kn} ಧಾರಣೆ ಎಷ್ಟು?`, en: `What is today's ${src.en} ${variety.en} rate?` },
    a: one ? {
      kn: `${src.kn} ${top_.kn} ಶಾಖೆಯಲ್ಲಿ ${variety.kn} ಸರಾಸರಿ ದರ ${whole(top.average_price)}, ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ. ವರದಿ ದಿನಾಂಕ: ${knDay(date)}.`,
      en: `${src.en} ${top_.en}: ${variety.en} averaged ${whole(top.average_price)} per quintal in the ${dayText(date)} report.`,
    } : {
      kn: `${src.kn} ${variety.kn}: ${day.length} ಶಾಖೆಗಳ ಸರಾಸರಿ ದರ ${whole(low.average_price)} ರಿಂದ ${whole(top.average_price)}, ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ. ಅತಿ ಹೆಚ್ಚು: ${top_.kn} ${whole(top.average_price)}. ವರದಿ ದಿನಾಂಕ: ${knDay(date)}.`,
      en: `${src.en} ${variety.en}: branch averages from ${whole(low.average_price)} to ${whole(top.average_price)} per quintal across ${day.length} branches in the ${dayText(date)} report; highest at ${top_.en}.`,
    },
  };
}

/** Home page questions: the latest MAMCOS and TSS Rashi and Chali rates, from the rates written into the page. */
function homeFaq(rates: Map<string, Rate[]>): FaqItem[] {
  const items: FaqItem[] = [];
  for (const variety of VARIETIES.filter((item) => item.key === "rashi" || item.key === "chali")) {
    for (const source of ["mamcos", "tss"] as const) {
      const item = sourceRateItem(variety, source, rates.get(variety.key) ?? []);
      if (item) items.push(item);
    }
  }
  return items.length ? [...items, UPDATE_QUESTION] : [];
}

/** A town's questions: one per variety it reports (up to three), answered with each source's latest rate and date. */
function townFaq(place: MarketPlace, rows: PlaceRate[]): FaqItem[] {
  const groups = new Map<string, PlaceRate[]>();
  for (const row of rows) if (row.short && row.price !== null) groups.set(row.short, [...(groups.get(row.short) ?? []), row]);
  const items = [...groups].slice(0, 3).map(([short, group]): FaqItem => {
    const en = group[0].name.split(" · ")[1] ?? group[0].name.replace(/\s*\(.*\)$/, "");
    const apmc = group.some((row) => row.source.startsWith("ಎಪಿಎಂಸಿ"));
    const part = (row: PlaceRate, language: 0 | 1) => `${row.source.split(" · ")[language]} ${whole(row.price)} (${language ? dayText(row.date) : knDay(row.date)})`;
    return {
      q: { kn: `${place.kn} ಇಂದಿನ ${short} ಧಾರಣೆ ಎಷ್ಟು?`, en: `What is today's ${en} rate in ${place.en}?` },
      a: {
        kn: `${group.map((row) => part(row, 0)).join("; ")}. ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್ ದರ${apmc ? "; ಎಪಿಎಂಸಿಯದು ಮಾದರಿ ದರ" : ""}.`,
        en: `${group.map((row) => part(row, 1)).join("; ")}. Per quintal${apmc ? "; the APMC figure is the modal rate" : ""}.`,
      },
    };
  });
  return items.length ? [...items, UPDATE_QUESTION] : [];
}

/** The questions as plain text in the page, for readers without scripts; the app shows them in a collapsed section. */
function faqHtml(items: FaqItem[]) {
  return `<h2>ಸಾಮಾನ್ಯ ಪ್ರಶ್ನೆಗಳು · Common questions</h2>` + items.map((item) =>
    `<h3>${escapeHtml(item.q.kn)}</h3><p lang="kn">${escapeHtml(item.a.kn)}</p><p lang="en"><strong>${escapeHtml(item.q.en)}</strong> ${escapeHtml(item.a.en)}</p>`).join("");
}

/** schema.org BreadcrumbList: ಅಡಿಕೆ ನಾಡಿ › … › this page. */
function breadcrumbs(siteUrl: string, trail: [string, string][]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [["ಅಡಿಕೆ ನಾಡಿ", "/"], ...trail].map(([name, path], index) => ({ "@type": "ListItem", position: index + 1, name, item: `${siteUrl}${path === "/" ? "/" : path}` })),
  };
}

/**
 * The Kannada name a search snippet gives an APMC variety label, or "" to leave it out. Dakshina Kannada APMCs report
 * "New Variety" and "Old Variety", which growers and papers there call ಹೊಸ ಅಡಿಕೆ and ಹಳೆ ಅಡಿಕೆ.
 */
function apmcSnippetName(label: string) {
  const local: Record<string, string> = { "New Variety": "ಹೊಸ ಅಡಿಕೆ", "Old Variety": "ಹಳೆ ಅಡಿಕೆ" };
  const kn = local[label] ?? agmarknetVarietyName(label, "kn");
  return kn !== label ? kn : "";
}

/* ---------- "about this town / grade" text, the variety hub and the Rashi and Chali guide ---------- */

type RecentMarket = { market: string; last_date: string | null; last_quintals: number | null; week_quintals: number; week_days: number; usual_quintals: number | null };
type Recent = { week: { from: string; to: string }; markets: RecentMarket[] };

/** Each APMC's arrivals over the last report week (KRAMA), read once per build; a failure leaves the sentence out. */
async function recentArrivals(apiUrl: string): Promise<Recent | null> {
  const response = await fetch(`${apiUrl}/supply/arrivals/recent`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`recent arrivals: HTTP ${response.status}`);
  const body = await response.json() as Recent;
  return body.week && Array.isArray(body.markets) ? body : null;
}

const quintals = (value: number) => Math.round(value).toLocaleString("en-IN");
const knList = (items: string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ಮತ್ತು ${items.at(-1)}`;
const enList = (items: string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/**
 * A town's "about" text, only from facts the build reads: which sources the page carries and what kind of rate each
 * publishes, the grades reported there recently, and the APMC's arrivals over the last report week.
 */
function townAbout(place: MarketPlace, rows: PlaceRate[], recent: Recent | null): AboutEntry {
  const kinds: { kn: string; en: string }[] = [];
  const branch = (name: string) => branchNames(name);
  if (place.branches.mamcos) kinds.push({ kn: `ಮ್ಯಾಮ್ಕೋಸ್ ${branch(place.branches.mamcos).kn} ಶಾಖೆಯ ಸರಾಸರಿ ದರ`, en: `the MAMCOS ${branch(place.branches.mamcos).en} branch average` });
  if (place.branches.tss) kinds.push({ kn: `ಟಿಎಸ್‌ಎಸ್ ${branch(place.branches.tss).kn} ಟೆಂಡರ್ ಸರಾಸರಿ ದರ`, en: `the TSS ${branch(place.branches.tss).en} tender average` });
  if (place.branches.tms) kinds.push({ kn: "ಟಿಎಂಎಸ್ ಟೆಂಡರ್ ಸರಾಸರಿ ದರ", en: "the TMS tender average" });
  if (place.branches.tumcos) kinds.push({ kn: "ಟಮ್ಕೋಸ್ ಸರಾಸರಿ ದರ (ತಳಿ ತಿಳಿಸುವುದಿಲ್ಲ)", en: "the TUMCOS average (variety not stated)" });
  if (place.apmc) kinds.push({ kn: `${place.kn} ಎಪಿಎಂಸಿಯ ಮಾದರಿ ದರ (AGMARKNET)`, en: `the ${place.apmc} modal price (AGMARKNET)` });
  const names = place.alias ? { kn: `; ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ${place.en} ಅಥವಾ ${place.alias}`, en: `, also spelt ${place.alias}` } : { kn: "", en: "" };
  const paragraphs: { kn: string; en: string }[] = [{
    kn: `${place.kn} (${place.district.kn} ಜಿಲ್ಲೆ${names.kn}) ಅಡಿಕೆ ಧಾರಣೆಗೆ ಈ ಪುಟದ ಮೂಲಗಳು: ${knList(kinds.map((kind) => kind.kn))}.${kinds.length > 1 ? " ಇವು ಬೇರೆ ಬೇರೆ ಬಗೆಯ ದರಗಳು, ಆದ್ದರಿಂದ ಪಕ್ಕಪಕ್ಕ ತೋರಿಸಲಾಗಿದೆ, ಒಟ್ಟುಗೂಡಿಸಿಲ್ಲ." : ""}`,
    en: `${place.en} (${place.district.en} district${names.en}): this page carries ${enList(kinds.map((kind) => kind.en))}.${kinds.length > 1 ? " These are different kinds of rate, so they are shown side by side, never combined." : ""}`,
  }];
  const grades = [...new Map(rows.filter((row) => row.short).map((row) => [row.short, row.name.split(" · ")[1] ?? row.name.replace(/\s*\(.*\)$/, "")])).entries()].slice(0, 8);
  if (grades.length) paragraphs.push({
    kn: `ಇಲ್ಲಿ ಇತ್ತೀಚೆಗೆ ವರದಿಯಾದ ತಳಿಗಳು: ${grades.map(([kn]) => kn).join(", ")}.`,
    en: `Grades reported here recently: ${grades.map(([, en]) => en).join(", ")}.`,
  });
  const market = place.apmc ? recent?.markets.find((item) => item.market === place.apmc) : undefined;
  if (recent && market && market.week_quintals > 0) {
    const span = { kn: `${knDay(recent.week.from)}–${knDay(recent.week.to)}`, en: `${dayText(recent.week.from)} to ${dayText(recent.week.to)}` };
    const usual = market.usual_quintals ? { kn: ` ಸಾಮಾನ್ಯ ವರದಿ ದಿನದಲ್ಲಿ ಸುಮಾರು ${quintals(market.usual_quintals)} ಕ್ವಿಂಟಾಲ್ ಬರುತ್ತದೆ.`, en: ` A usual report day brings about ${quintals(market.usual_quintals)} quintals.` } : { kn: "", en: "" };
    paragraphs.push({
      kn: `ಕೃಷಿ ಮಾರಾಟ ಇಲಾಖೆಯ KRAMA ವರದಿಯಂತೆ ${span.kn} ನಡುವೆ ${market.week_days} ವರದಿ ದಿನಗಳಲ್ಲಿ ${place.kn} ಎಪಿಎಂಸಿಗೆ ${quintals(market.week_quintals)} ಕ್ವಿಂಟಾಲ್ ಅಡಿಕೆ ಬಂದಿದೆ.${usual.kn}`,
      en: `KRAMA (Karnataka's agricultural marketing department) reports ${quintals(market.week_quintals)} quintals of arecanut arriving at ${place.apmc} over ${market.week_days} report days, ${span.en}.${usual.en}`,
    });
  }
  const links = [...new Set(rows.map((row) => row.key).filter((key): key is string => !!key))].slice(0, 8)
    .map((key) => VARIETIES.find((variety) => variety.key === key)!).map((variety) => ({ path: varietySeo(variety).path, label: { kn: `${variety.kn} ಧಾರಣೆ`, en: `${variety.en} rate` } }));
  return { title: { kn: `${place.kn} ಮಾರುಕಟ್ಟೆ ಬಗ್ಗೆ`, en: `About ${place.en}'s market` }, paragraphs, links };
}

/** The towns whose page carries a cooperative branch, by source and branch name. */
const townOf = (source: Rate["source"], branch: string) => MARKET_PLACES.find((place) => place.branches[source]?.toUpperCase() === branch.toUpperCase());

/** A grade's "about" text: what its sources say it is (if any describe it), and who publishes its rate under which label. */
function varietyAbout(variety: GrowerVariety, rows: Rate[]): AboutEntry {
  const note = GRADE_NOTES[variety.key];
  const paragraphs: { kn: string; en: string }[] = note ? [note.text] : variety.note ? [variety.note] : [];
  const sources = (["mamcos", "tss", "tms"] as const).filter((source) => variety.labels[source]?.length);
  const labels = sources.map((source) => ({ source, labels: variety.labels[source]!.map((label) => `“${label}”`).join(" / ") }));
  if (labels.length) paragraphs.push({
    kn: `ಈ ದರ್ಜೆಯನ್ನು ${knList(labels.map((item) => `${COOPERATIVE_NAMES[item.source].kn} ${item.labels}`))} ಹೆಸರಿನಲ್ಲಿ ${labels.length > 1 ? "ಪ್ರಕಟಿಸುತ್ತವೆ" : "ಪ್ರಕಟಿಸುತ್ತದೆ"}.`,
    en: `Published as ${enList(labels.map((item) => `${item.labels} by ${COOPERATIVE_NAMES[item.source].en}`))}.`,
  });
  const branches = [...new Map(rows.map((row) => [`${row.source}|${row.branch.toUpperCase()}`, row])).values()];
  if (branches.length) {
    const by = (language: "kn" | "en") => sources.filter((source) => branches.some((row) => row.source === source))
      .map((source) => `${COOPERATIVE_NAMES[source][language]} (${branches.filter((row) => row.source === source).map((row) => branchNames(row.branch)[language]).join(", ")})`);
    paragraphs.push({ kn: `ಕಳೆದ 30 ದಿನಗಳಲ್ಲಿ ದರ ಪ್ರಕಟಿಸಿದ ಶಾಖೆಗಳು: ${knList(by("kn"))}.`, en: `Branches that published a rate in the last 30 days: ${enList(by("en"))}.` });
  } else paragraphs.push({ kn: "ಕಳೆದ 30 ದಿನಗಳಲ್ಲಿ ಈ ದರ್ಜೆಯ ದರ ವರದಿಯಾಗಿಲ್ಲ.", en: "No rate for this grade was reported in the last 30 days." });
  const towns = [...new Map(branches.map((row) => townOf(row.source, row.branch)).filter((place): place is MarketPlace => !!place).map((place) => [place.slug, place])).values()];
  const links = [
    ...towns.map((place) => ({ path: marketPath(place.slug), label: { kn: `${place.kn} ಅಡಿಕೆ ಧಾರಣೆ`, en: `${place.en} arecanut rate` } })),
    ...(variety.group === "rashi" || variety.group === "chali" ? [{ path: GUIDE_PATH, label: { kn: "ರಾಶಿ ಮತ್ತು ಚಾಲಿ ವ್ಯತ್ಯಾಸ", en: "Rashi vs Chali" } }] : []),
    { path: VARIETY_HUB_PATH, label: { kn: "ಎಲ್ಲ ಅಡಿಕೆ ದರ್ಜೆಗಳು", en: "All arecanut grades" } },
  ];
  return { title: { kn: `${variety.kn} ಬಗ್ಗೆ`, en: `About ${variety.en}` }, paragraphs, links, sources: note?.sources };
}

/** An "about" entry as plain HTML: heading, both languages' paragraphs, its links and sources. */
function aboutHtml(entry: AboutEntry) {
  return `<h2>${escapeHtml(entry.title.kn)} · ${escapeHtml(entry.title.en)}</h2>`
    + entry.paragraphs.map((paragraph) => `<p lang="kn">${escapeHtml(paragraph.kn)}</p><p lang="en">${escapeHtml(paragraph.en)}</p>`).join("")
    + (entry.links?.length ? `<ul>${entry.links.map((link) => `<li><a href="${link.path}">${escapeHtml(link.label.kn)} · ${escapeHtml(link.label.en)}</a></li>`).join("")}</ul>` : "")
    + (entry.sources?.length ? `<p>ಮೂಲ · Source: ${entry.sources.map((source) => `<a href="${source.url}" rel="noopener">${escapeHtml(source.label)}</a>`).join(", ")}</p>` : "");
}

/** A variety page as plain HTML: heading, latest rates (when there are any), then what the grade is and who reports it. */
function varietyHtml(variety: GrowerVariety, rows: Rate[], about: AboutEntry) {
  const name = varietyNames(variety);
  return `<main class="static-page"><h1>${escapeHtml(name.kn)} ಧಾರಣೆ · ${escapeHtml(name.en)} price</h1>`
    + (rows.length
      ? `<h2>ಇತ್ತೀಚಿನ ಧಾರಣೆ · Latest rates</h2><p>ಇತ್ತೀಚಿನ ವರದಿಯಾದ ದರಗಳು, ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ ರೂಪಾಯಿಗಳಲ್ಲಿ. Latest reported rates, in rupees per quintal.</p>`
        + rateTable(rows) + `<p>ದರಗಳು ಮೂಲ ಪ್ರಕಟಿಸಿದಂತೆಯೇ. Rates as each cooperative publishes them.</p>`
      : "")
    + aboutHtml(about) + `</main>`;
}

/** A variety's questions: its latest rate per cooperative, and how often rates are updated. */
function varietyFaq(variety: GrowerVariety, rows: Rate[]): FaqItem[] {
  const items: FaqItem[] = [];
  for (const source of ["mamcos", "tss", "tms"] as const) {
    const item = sourceRateItem(variety, source, rows);
    if (item) items.push(item);
  }
  // What the grade is sits in its "about" section just above, so it is not repeated as a question.
  return items.length ? [...items, UPDATE_QUESTION] : [];
}

/** The variety hub as plain HTML: every grade by group, linked, with the guide first. */
function hubHtml() {
  const text = VARIETY_HUB_TEXT;
  const groups = VARIETY_GROUPS.map((group) => `<h2>${escapeHtml(group.kn)} · ${escapeHtml(group.en)}</h2><ul>${VARIETIES.filter((variety) => variety.group === group.key)
    .map((variety) => `<li><a href="${varietySeo(variety).path}">${escapeHtml(variety.kn)} · ${escapeHtml(variety.en)}</a>${GRADE_NOTES[variety.key] ? ` — ${escapeHtml(GRADE_NOTES[variety.key].text.en.split(". ")[0])}.` : ""}</li>`).join("")}</ul>`).join("");
  return `<main class="static-page"><h1>${escapeHtml(text.kn.title)} · ${escapeHtml(text.en.title)}</h1><p lang="kn">${escapeHtml(text.kn.intro)}</p><p lang="en">${escapeHtml(text.en.intro)}</p>`
    + `<p><a href="${GUIDE_PATH}">${escapeHtml(text.kn.guide)} · ${escapeHtml(text.en.guide)}</a></p>${groups}<p>${escapeHtml(text.kn.sources)} ${escapeHtml(text.en.sources)}</p></main>`;
}

/** The Rashi and Chali guide as plain HTML, the same text the page shows. */
function guideHtml() {
  const guide = RASHI_CHALI_GUIDE;
  const both = (text: { kn: string; en: string }) => `<p lang="kn">${escapeHtml(text.kn)}</p><p lang="en">${escapeHtml(text.en)}</p>`;
  const rows = guide.table.rows.map((row) => `<tr><th scope="row">${escapeHtml(row.label.kn)} · ${escapeHtml(row.label.en)}</th><td>${escapeHtml(row.rashi.kn)} · ${escapeHtml(row.rashi.en)}</td><td>${escapeHtml(row.chali.kn)} · ${escapeHtml(row.chali.en)}</td></tr>`).join("");
  return `<main class="static-page"><h1>${escapeHtml(guide.title.kn)} · ${escapeHtml(guide.title.en)}</h1>${both(guide.intro)}`
    + guide.sections.map((section) => `<h2>${escapeHtml(section.heading.kn)} · ${escapeHtml(section.heading.en)}</h2>${both(section.text)}`).join("")
    + `<h2>${escapeHtml(guide.table.heading.kn)} · ${escapeHtml(guide.table.heading.en)}</h2><table><thead><tr><th></th><th>${escapeHtml(guide.table.columns.rashi.kn)} · ${escapeHtml(guide.table.columns.rashi.en)}</th><th>${escapeHtml(guide.table.columns.chali.kn)} · ${escapeHtml(guide.table.columns.chali.en)}</th></tr></thead><tbody>${rows}</tbody></table>`
    + `<h2>${escapeHtml(guide.prices.heading.kn)} · ${escapeHtml(guide.prices.heading.en)}</h2>${both(guide.prices.text)}`
    + `<p><a href="/variety/rashi">ರಾಶಿ ಅಡಿಕೆ ಧಾರಣೆ · Rashi arecanut price</a> · <a href="/variety/chali">ಚಾಲಿ ಅಡಿಕೆ ಧಾರಣೆ · Chali arecanut price</a></p>`
    + `<p>ಮೂಲಗಳು · Sources: ${guide.sources.map((source) => `<a href="${source.url}" rel="noopener">${escapeHtml(source.label)}</a>`).join(", ")}</p></main>`;
}

/**
 * The page Cloudflare Pages serves, with a real 404 status, for any address that has no file: the app shell (which
 * shows "Page not found" for an unknown route), marked noindex and without a canonical address. Client-only private
 * pages (workspace, data quality) are rewritten to it with a 200 in public/_redirects.
 */
function notFoundHtml(home: string, siteUrl: string) {
  const page: SeoPage = { path: "/404", label: { kn: "ಪುಟ ಸಿಗಲಿಲ್ಲ", en: "Page not found" },
    kn: { title: "ಪುಟ ಸಿಗಲಿಲ್ಲ · Page not found | ಅಡಿಕೆ ನಾಡಿ", description: "ಈ ವಿಳಾಸದಲ್ಲಿ ಪುಟ ಇಲ್ಲ. ಇಂದಿನ ಅಡಿಕೆ ಧಾರಣೆಗೆ ಮುಖಪುಟ ನೋಡಿ." },
    en: { title: "Page not found | Areca Pulse", description: "There is no page at this address. See the home page for today's arecanut rates." } };
  const content = `<main class="static-page"><h1>ಪುಟ ಸಿಗಲಿಲ್ಲ · Page not found</h1><p lang="kn">${escapeHtml(page.kn.description)}</p><p lang="en">${escapeHtml(page.en.description)}</p></main>`;
  return pageHtml(home, siteUrl, page, [], content)
    .replace(/\s*<link rel="canonical"[^>]*>/, "")
    .replace(/\s*<meta property="og:url"[^>]*>/, "")
    .replace("</head>", `  <meta name="robots" content="noindex" />\n  </head>`);
}

/** Public contact address. Also in src/services/brand.tsx (footer) and index.html (structured data). */
const CONTACT_EMAIL = "contact@adikenaadi.com";

/** RFC 9116 security.txt. It must carry an expiry, so it is set one year from each build. */
function securityTxt(siteUrl: string) {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return `Contact: mailto:${CONTACT_EMAIL}\nExpires: ${expires}\nPreferred-Languages: en, kn\nCanonical: ${siteUrl}/.well-known/security.txt\n`;
}

/** Writes robots.txt, sitemap.xml and security.txt, and puts the site address into index.html's link-preview tags. */
function seo(siteUrl: string, apiUrl: string | undefined): Plugin {
  let outDir = "";
  const robots = `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${SITEMAP_PATHS.map((path) => `  <url><loc>${siteUrl}${path}</loc></url>`).join("\n")}\n</urlset>\n`;
  const files: Record<string, { body: string; type: string }> = {
    "/robots.txt": { body: robots, type: "text/plain" },
    "/sitemap.xml": { body: sitemap, type: "application/xml" },
    "/.well-known/security.txt": { body: securityTxt(siteUrl), type: "text/plain" },
  };
  return {
    name: "areca-pulse-seo",
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    transformIndexHtml: (html) => pageHtml(html.replaceAll("%SITE_URL%", siteUrl), siteUrl, SEO_PAGES[0]),
    // One file per public page (prices.html is served at /prices), so each address has its own title and description.
    async closeBundle() {
      if (!outDir) return;
      let home: string;
      try { home = readFileSync(resolve(outDir, "index.html"), "utf8"); } catch { return; }
      // Prices are written only for a real deployment (an HTTPS API); local builds and tests fetch nothing.
      let rates = new Map<string, Rate[]>();
      if (apiUrl?.startsWith("https://")) {
        try { rates = await latestRates(apiUrl.replace(/\/+$/, "")); }
        catch (error) { console.warn(`Latest rates were not written into the variety pages: ${error instanceof Error ? error.message : error}`); }
      }
      // Every grade gets its own page, so no link the app makes ends in a 404; only those with recent rates go in the
      // sitemap and the page links (a page with no rates is thin). A page names only the cooperatives it shows.
      const shownBy = (variety: GrowerVariety) => {
        const rows = rates.get(variety.key) ?? [];
        return rows.length ? [...new Set(rows.map((row) => row.source))] : undefined;
      };
      // Search listings use the dated pages; the links between pages keep their plain labels either way.
      const allVarietyPages = VARIETIES.map((variety) => withSnippet(varietySeo(variety, shownBy(variety)),
        snippetFrom((rates.get(variety.key) ?? []).map((row) => ({ name: "", date: row.reporting_date, price: row.average_price })), 1)));
      const varietyPages = allVarietyPages.filter((_, index) => rates.has(VARIETIES[index].key));
      const homeSnippet = snippetFrom(VARIETIES.filter((variety) => variety.everyday && rates.has(variety.key))
        .flatMap((variety) => rates.get(variety.key)!.map((row) => ({ name: variety.kn, date: row.reporting_date, price: row.average_price }))));
      // Each page's newest report date (the sitemap's <lastmod>), its "today's rates" questions and its "about" text.
      const lastmod = new Map<string, string>();
      const faq: FaqFile = {};
      const about: AboutFile = {};
      const write = (page: SeoPage, content = "", structured: object[] = []) => {
        const file = resolve(outDir, page.path === "/" ? "index.html" : `${page.path.slice(1)}.html`);
        const questions = faq[page.path];
        if (questions?.length) {
          content = content.replace(/<\/main>\s*$/, `${faqHtml(questions)}</main>`);
          structured = [...structured, faqJsonLd(questions)];
        }
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, pageHtml(home, siteUrl, page, [...varietyPages, ...MARKET_PAGES], content, structured));
      };
      const allDates = [...rates.values()].flat().map((row) => row.reporting_date);
      const homeDates = VARIETIES.filter((variety) => variety.everyday).flatMap((variety) => (rates.get(variety.key) ?? []).map((row) => row.reporting_date));
      if (homeDates.length) lastmod.set("/", newestOf(homeDates));
      if (allDates.length) lastmod.set("/prices", newestOf(allDates));
      faq["/"] = homeFaq(rates);
      for (const page of SEO_PAGES) {
        if (page.path === "/") write(withSnippet(page, homeSnippet), homeHtml(page, rates));
        else if (page.path === VARIETY_HUB_PATH) write(page, hubHtml(), [breadcrumbs(siteUrl, [["ಅಡಿಕೆ ದರ್ಜೆಗಳು", VARIETY_HUB_PATH]])]);
        else if (page.path === GUIDE_PATH) write(page, guideHtml(), [breadcrumbs(siteUrl, [["ಅಡಿಕೆ ದರ್ಜೆಗಳು", VARIETY_HUB_PATH], ["ರಾಶಿ ಮತ್ತು ಚಾಲಿ", GUIDE_PATH]])]);
        else write(page);
      }
      // Arrivals for the towns' "about" text: one request for every market; without it the sentence is left out.
      let recent: Recent | null = null;
      if (apiUrl?.startsWith("https://")) {
        try { recent = await recentArrivals(apiUrl.replace(/\/+$/, "")); }
        catch (error) { console.warn(`Arrivals were not written into the town pages: ${error instanceof Error ? error.message : error}`); }
      }
      const townDates: string[] = [];
      for (const [index, place] of MARKET_PLACES.entries()) {
        let content = "";
        let rows: PlaceRate[] = [];
        const path = MARKET_PAGES[index + 1].path;
        if (apiUrl?.startsWith("https://")) {
          const api = apiUrl.replace(/\/+$/, "");
          // The year of history is extra: if it cannot be read, the page still gets its latest rates.
          let history: PlaceHistory | null = null;
          try { history = await placeHistory(api, place); }
          catch (error) { console.warn(`History was not written into ${place.en}'s page: ${error instanceof Error ? error.message : error}`); }
          try {
            rows = await placeRates(api, place);
            if (rows.length || history) {
              about[path] = townAbout(place, rows, recent);
              content = placeHtml(place, rows, history, about[path]);
            }
          }
          catch (error) { console.warn(`Rates were not written into ${place.en}'s page: ${error instanceof Error ? error.message : error}`); }
        }
        if (rows.length) { lastmod.set(path, newestOf(rows.map((row) => row.date))); townDates.push(lastmod.get(path)!); }
        faq[path] = townFaq(place, rows);
        // A town's cooperative rates lead its snippet when fresh; its APMC's named varieties stand in when they are not.
        const quoted = rows.filter((row) => row.short).map((row) => ({ name: row.short, date: row.date, price: row.price, apmc: row.source.startsWith("ಎಪಿಎಂಸಿ") }));
        write(withSnippet(MARKET_PAGES[index + 1], snippetFrom(quoted.filter((row) => !row.apmc)) ?? snippetFrom(quoted)), content,
          [breadcrumbs(siteUrl, [["ಮಾರುಕಟ್ಟೆ", MARKETS_SEO.path], [place.kn, path]])]);
      }
      if (townDates.length) lastmod.set(MARKETS_SEO.path, newestOf(townDates));
      write(MARKETS_SEO, "", [breadcrumbs(siteUrl, [["ಮಾರುಕಟ್ಟೆ", MARKETS_SEO.path]])]);
      VARIETIES.forEach((variety, index) => {
        const page = allVarietyPages[index], rows = rates.get(variety.key) ?? [];
        if (rows.length) lastmod.set(page.path, newestOf(rows.map((row) => row.reporting_date)));
        // The grade's "about" text is written on every build; its rates and questions only when they were read.
        about[page.path] = varietyAbout(variety, rows);
        faq[page.path] = varietyFaq(variety, rows);
        write(page, varietyHtml(variety, rows, about[page.path]),
          [breadcrumbs(siteUrl, [["ಅಡಿಕೆ ದರ್ಜೆಗಳು", VARIETY_HUB_PATH], [`${variety.kn} ಧಾರಣೆ`, page.path]])]);
      });
      writeFileSync(resolve(outDir, FAQ_FILE.slice(1)), JSON.stringify(Object.fromEntries(Object.entries(faq).filter(([, items]) => items.length))));
      writeFileSync(resolve(outDir, ABOUT_FILE.slice(1)), JSON.stringify(about));
      writeFileSync(resolve(outDir, "404.html"), notFoundHtml(home, siteUrl));
      // <lastmod> is the newest report date each page shows, not the build date: a rebuild with no new rates changes nothing.
      if (lastmod.size) {
        const entry = (path: string) => `  <url><loc>${siteUrl}${path}</loc>${lastmod.has(path) ? `<lastmod>${lastmod.get(path)}</lastmod>` : ""}</url>`;
        const entries = [...SITEMAP_PATHS, ...varietyPages.map((page) => page.path)].map(entry);
        writeFileSync(resolve(outDir, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`);
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = files[request.url?.split("?")[0] ?? ""];
        if (!file) return next();
        response.setHeader("Content-Type", `${file.type}; charset=utf-8`);
        response.end(file.body);
      });
    },
    generateBundle() {
      for (const [path, file] of Object.entries(files)) this.emitFile({ type: "asset", fileName: path.slice(1), source: file.body });
    },
  };
}

/**
 * Cloudflare Web Analytics: privacy-first page views, no cookies and no personal data. The beacon is added only when a
 * site token is configured, so local builds and tests send nothing. _headers allows its script and its report address.
 */
function analytics(token: string | undefined): Plugin {
  if (token && !/^[a-f0-9]{32}$/.test(token)) throw new Error("VITE_CF_ANALYTICS_TOKEN must be the 32-character site token from Cloudflare Web Analytics.");
  return {
    name: "areca-pulse-analytics",
    apply: "build",
    transformIndexHtml: (html) => token
      ? html.replace("</body>", `  <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${token}"}'></script>\n  </body>`)
      : html,
  };
}

/**
 * Google Analytics through the site's Google tag (public/google-tag.js), at the top of <head> (after the charset, as Google asks). Added
 * only when a tag ID is configured, so local builds and tests send nothing. _headers allows Google's script and its
 * report addresses; privacy.html says the site uses Google Analytics cookies.
 */
function googleTag(id: string | undefined): Plugin {
  if (id && !/^(GTM|G|GT)-[A-Z0-9]+$/.test(id)) throw new Error("VITE_GOOGLE_TAG_ID must be a Google tag ID such as GTM-XXXXXXX or G-XXXXXXXXXX.");
  return {
    name: "areca-pulse-google-tag",
    apply: "build",
    transformIndexHtml: (html) => id ? html.replace(/(<meta charset="UTF-8" \/>\n)/, `$1    <script src="/google-tag.js" data-id="${id}"></script>\n`) : html,
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../", "VITE_");
  const siteUrl = (env.VITE_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
  return {
    plugins: [react(), seo(siteUrl, env.VITE_API_BASE_URL || undefined), analytics(env.VITE_CF_ANALYTICS_TOKEN || undefined), googleTag(env.VITE_GOOGLE_TAG_ID || undefined)],
    envDir: "../",
  };
});

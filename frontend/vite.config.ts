import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { MARKETS_SEO, marketSeo, SEO_PAGES, varietyNames, varietySeo, type SeoPage } from "./src/services/seo-pages";
import { COOPERATIVE_NAMES, COOPERATIVE_ORDER, MARKET_PLACES, sortByCatalogue, varietyForLabel, type MarketPlace } from "./src/services/markets";
import { VARIETIES, type GrowerVariety } from "./src/services/varieties";
import { PLACE_NAMES_KN } from "./src/services/places";
import type { CooperativeQuote } from "./src/services/cooperative";

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
function pageHtml(html: string, siteUrl: string, page: SeoPage, linked: SeoPage[] = [], content = "") {
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
  const block = `<div id="root"><!--static-->${STATIC_STYLE}${body}<!--/static--></div>`;
  return html.replace(/<div id="root">(?:<!--static-->[\s\S]*?<!--\/static-->)?<\/div>/, () => block);
}

type Rate = { source: "mamcos" | "tss"; branch: string; reporting_date: string; minimum_price: number | null; maximum_price: number | null; average_price: number | null };

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
    for (const source of ["mamcos", "tss"] as const) for (const label of variety.labels[source] ?? []) {
      const response = await fetch(`${apiUrl}/cooperative/prices?${new URLSearchParams({ source, variety: label, commodity: "arecanut", limit: "10" })}`, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`${source} ${label}: HTTP ${response.status}`);
      const body = await response.json() as { latest_by_branch?: Omit<Rate, "source">[] };
      rows.push(...(body.latest_by_branch ?? []).filter((row) => row.average_price !== null && row.reporting_date >= oldest).map((row) => ({ ...row, source })));
    }
    if (rows.length) rates.set(variety.key, rows);
  }
  return rates;
}

const SOURCE_NAMES = { mamcos: "ಮ್ಯಾಮ್ಕೋಸ್ · MAMCOS", tss: "ಟಿಎಸ್‌ಎಸ್ · TSS" };
const rupees = (value: number | null) => value === null ? "" : `₹${value.toLocaleString("en-IN")}`;
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

/** A variety's latest rates as plain HTML: the same branches, dates and prices the rates screen shows once it loads. */
function ratesHtml(variety: GrowerVariety, rows: Rate[]) {
  const name = varietyNames(variety);
  return `<main class="static-page"><h1>${escapeHtml(name.kn)} ಧಾರಣೆ · ${escapeHtml(name.en)} price</h1>`
    + `<p>ಇತ್ತೀಚಿನ ವರದಿಯಾದ ದರಗಳು, ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ ರೂಪಾಯಿಗಳಲ್ಲಿ. Latest reported rates, in rupees per quintal.</p>`
    + rateTable(rows)
    + `<p>ದರಗಳು ಮೂಲ ಪ್ರಕಟಿಸಿದಂತೆಯೇ. Rates as each cooperative publishes them.</p></main>`;
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

type PlaceRate = { source: string; name: string; date: string; price: number | null; minimum: number | null; maximum: number | null };

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
        date: row.reporting_date, price: row.average_price, minimum: row.minimum_price, maximum: row.maximum_price });
    }
  }
  if (place.apmc) {
    const response = await fetch(`${apiUrl}/prices?${new URLSearchParams({ q: place.apmc, from: oldest, limit: "200", sort: "reporting_date", order: "desc", include_count: "false" })}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`APMC ${place.apmc}: HTTP ${response.status}`);
    const body = await response.json() as { data: { market_name: string; variety_name: string; grade?: string | null; reporting_date: string; modal_price: number; minimum_price: number; maximum_price: number }[] };
    const seen = new Set<string>();
    for (const row of body.data) {
      const key = `${row.variety_name}|${row.grade ?? ""}`;
      if (row.market_name !== place.apmc || seen.has(key)) continue;
      seen.add(key);
      rows.push({ source: "ಎಪಿಎಂಸಿ · APMC", name: row.grade ? `${row.variety_name} (${row.grade})` : row.variety_name, date: row.reporting_date, price: row.modal_price, minimum: row.minimum_price, maximum: row.maximum_price });
    }
  }
  return rows;
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
  const byVariety = new Map<string, Map<string, number[]>>();
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({ q: place.apmc, from, limit: "1000", include_count: "false" });
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
function placeHtml(place: MarketPlace, rows: PlaceRate[], history: PlaceHistory | null = null) {
  const body = rows.map((row) => `<tr><td>${escapeHtml(row.source)}</td><td>${escapeHtml(row.name)}</td><td><time datetime="${row.date}">${day(row.date)}</time></td><td>${rupees(row.price)}</td><td>${row.minimum !== null && row.maximum !== null ? `${rupees(row.minimum)} – ${rupees(row.maximum)}` : ""}</td></tr>`).join("");
  return `<main class="static-page">`
    + `<h1>${escapeHtml(place.kn)} ಅಡಿಕೆ ಧಾರಣೆ · ${escapeHtml(place.en)} arecanut rates</h1>`
    + `<p>${escapeHtml(place.district.kn)} ಜಿಲ್ಲೆ · ${escapeHtml(place.district.en)} district. ಇತ್ತೀಚಿನ ವರದಿಯಾದ ದರಗಳು, ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ. Latest reported rates, per quintal.</p>`
    + `<table><thead><tr><th>ಮೂಲ · Source</th><th>ತಳಿ · Variety</th><th>ದಿನಾಂಕ · Date</th><th>ದರ · Rate</th><th>ಕನಿಷ್ಠ – ಗರಿಷ್ಠ · Range</th></tr></thead><tbody>${body}</tbody></table>`
    + `<p>ದರಗಳು ಮೂಲ ಪ್ರಕಟಿಸಿದಂತೆ; ಮೂಲಗಳನ್ನು ಒಟ್ಟುಗೂಡಿಸಿಲ್ಲ. Rates as each source publishes them; sources are never combined.</p>`
    + (history ? historyHtml(place, history) : "") + `</main>`;
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
      const varieties = VARIETIES.filter((variety) => rates.has(variety.key));
      const varietyPages = varieties.map(varietySeo);
      const write = (page: SeoPage, content = "") => {
        const file = resolve(outDir, page.path === "/" ? "index.html" : `${page.path.slice(1)}.html`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, pageHtml(home, siteUrl, page, [...varietyPages, ...MARKET_PAGES], content));
      };
      for (const page of SEO_PAGES) write(page, page.path === "/" ? homeHtml(page, rates) : "");
      write(MARKETS_SEO);
      for (const [index, place] of MARKET_PLACES.entries()) {
        let content = "";
        if (apiUrl?.startsWith("https://")) {
          const api = apiUrl.replace(/\/+$/, "");
          // The year of history is extra: if it cannot be read, the page still gets its latest rates.
          let history: PlaceHistory | null = null;
          try { history = await placeHistory(api, place); }
          catch (error) { console.warn(`History was not written into ${place.en}'s page: ${error instanceof Error ? error.message : error}`); }
          try { const rows = await placeRates(api, place); if (rows.length || history) content = placeHtml(place, rows, history); }
          catch (error) { console.warn(`Rates were not written into ${place.en}'s page: ${error instanceof Error ? error.message : error}`); }
        }
        write(MARKET_PAGES[index + 1], content);
      }
      varieties.forEach((variety, index) => write(varietyPages[index], ratesHtml(variety, rates.get(variety.key)!)));
      if (varietyPages.length) {
        const today = new Date().toISOString().slice(0, 10);
        const entries = [...SITEMAP_PATHS.map((path) => `  <url><loc>${siteUrl}${path}</loc></url>`), ...varietyPages.map((page) => `  <url><loc>${siteUrl}${page.path}</loc><lastmod>${today}</lastmod></url>`)];
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../", "VITE_");
  const siteUrl = (env.VITE_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
  return {
    plugins: [react(), seo(siteUrl, env.VITE_API_BASE_URL || undefined), analytics(env.VITE_CF_ANALYTICS_TOKEN || undefined)],
    envDir: "../",
  };
});

import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_CATALOG } from "../../../shared/commodities";
import { HomePage } from "./HomePage";
import { MarketDataPage } from "./CooperativeMarketPage";
import { ComparePage } from "./ComparePage";
import { AppShell, searchablePath } from "../components/AppShell";
import { PricesPage } from "./PricesPage";
import { readPage, readPreset, readSort, withoutFilters, withParams } from "../services/priceFilters";
import { NotFoundPage } from "./NotFoundPage";
import { LanguageContext } from "../services/language";
import { SourceSlot } from "../components/SourceSlot";
import { VARIETIES } from "../services/varieties";
import { ForecastShowcase } from "../components/ForecastShowcase";
import { PriceOutlook } from "../components/PriceOutlook";
import { HoldOutcomeChart } from "../components/HoldOutcomeChart";
import { RollingNumber } from "../components/RollingNumber";
import type { ModelEvaluation } from "../services/forecasting";
import { TSS_VARIETIES } from "../../../shared/tss-varieties";
import { Answer, AssistantPage, followUps, PriceDates, rateLabel } from "./AssistantPage";
import type { AssistantAnswer } from "../services/assistant";
import { AnalyticsPage } from "./AnalyticsPage";
import { OverviewPage } from "./OverviewPage";
import { HistoricalAnalyticsPage } from "./HistoricalAnalyticsPage";
import { DecisionToolsPage } from "./DecisionToolsPage";
import { IntelligencePage } from "./IntelligencePage";
import { IntelligenceSourceDetails } from "../components/IntelligenceSourceHealth";
import { QualityInspectionsPage } from "./QualityInspectionsPage";
import { SupplyPage } from "./SupplyPage";
import { ForecastsPage } from "./ForecastsPage";
import { ForecastEvaluationPage } from "./ForecastEvaluationPage";
import { WorkspacePage } from "./WorkspacePage";
import { DataQualityPage } from "./DataQualityPage";
import { SellOrHoldPage } from "./SellOrHoldPage";
import { chartPalette } from "../components/chartPalette";
import { shareMessage } from "../services/share";
import { marketSuggestion, matchSuggestions } from "../services/marketSuggestions";
import { readdirSync, readFileSync } from "node:fs";
import { fromFirstCapture, shortPeriod } from "./HistoricalAnalyticsPage";
import { MONTH_NAMES_EN, MONTH_NAMES_KN } from "../../../shared/dates";
import { runInNewContext } from "node:vm";
import { ImportsPanel } from "../components/ImportsPanel";
import { eventsBetween, MARKET_EVENTS } from "../services/market-events";
import { MarketIndexPage, MarketPage } from "./MarketPage";
import { MARKET_PLACES } from "../services/markets";
import { marketSeo, seoPage } from "../services/seo-pages";

const state = vi.hoisted(() => ({
  cooperative: [] as object[],
  official: {} as object,
  comparison: [] as object[],
  cooperativePage: {} as object,
  intelligence: {} as object,
  language: "en" as "en" | "kn",
  branch: [] as object[],
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, data: undefined, error: null }),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), removeQueries: vi.fn() }),
  // Market search suggestions load only after a search box is focused, which a static render never does.
  useQueries: ({ queries }: { queries: { queryKey: string[] }[] }) => queries[0]?.queryKey[0] === "market-suggestions" ? queries.map(() => ({ data: undefined }))
    : queries[0]?.queryKey[0] === "branch-latest" ? state.branch : state.cooperative,
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "home-official-prices" || queryKey[0] === "market-apmc") return state.official;
    if (queryKey[0] === "varieties") return { data: ["Rashi"], isLoading: false };
    if (queryKey[0] === "market-comparison") return { data: { data: state.comparison }, isLoading: false };
    if (queryKey[0] === "cooperative") return state.cooperativePage;
    if (queryKey[0] === "intelligence") return state.intelligence;
    // A real query is still loading until it has data, so pages never see "finished with no data" for these.
    if (queryKey[0] === "history") return { data: undefined, isLoading: true, isPending: true };
    return { data: undefined, isLoading: false };
  },
}));
vi.mock("../services/commodity", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/commodity")>(),
  useCommodity: () => ({ code: "arecanut", commodity: FALLBACK_CATALOG.commodities[0], catalog: FALLBACK_CATALOG, unit: "INR / QUINTAL" }),
}));
vi.mock("../components/LazyCharts", () => ({ LazyRangeChart: ({ rows }: { rows: { label: string }[] }) => <div>Same-date chart: {rows.map((row) => row.label).join(", ")}</div>,
  LazyTrackChart: ({ periods }: { periods: string[] }) => <div>Track chart: {periods.length} months</div>,
  LazyOutlookChart: ({ periods }: { periods: string[] }) => <div>Outlook chart: {periods.length} months</div> }));

const quote = {
  id: "official-1", market_id: "one", market_name: "Market One", district: "District",
  variety_name: "Rashi", grade: "Grade A", reporting_date: "2026-10-01",
  source_name: "AGMARKNET", modal_price: 51000, minimum_price: 50000, maximum_price: 52000,
};
const siddapur = { ...quote, market_name: "Siddapur APMC", district: "Uttara Kannada" };
const ready = (data: object) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const failed = { isPending: false, isError: true, error: new Error("offline"), refetch: vi.fn() };
const cooperativeQuote = (source: string, branch: string, variety: string) => ({
  id: source, source_key: source, branch, variety, reporting_date: "2026-10-01",
  average_price: 48000, minimum_price: 47000, maximum_price: 49000,
  source_url: "https://example.test/", unit_status: "source_confirmed", fetched_at: "2026-10-01T10:00:00Z",
});
const render = (node: React.ReactNode, path = "/") => renderToStaticMarkup(
  <LanguageContext.Provider value={{ language: state.language, setLanguage: () => undefined }}><MemoryRouter initialEntries={[path]}>{node}</MemoryRouter></LanguageContext.Provider>);

beforeEach(() => {
  state.cooperative = [failed, ready({ latest_by_branch: [], data: [] }), ready({ latest_by_branch: [], data: [] })];
  state.official = ready({ data: [siddapur] });
  state.comparison = [];
  state.language = "en";
  state.branch = [];
  state.intelligence = { data: undefined, isLoading: true };
  state.cooperativePage = ready({
    data: [], latest_by_branch: [], branches: [], varieties: [], series: [], counts: [], recent_fetches: [],
    publication: { awaiting_review_count: 2, blocked_reason: null, latest_archived_reporting_date: "2026-09-30" },
    last_fetch: { status: "succeeded", started_at: "2026-10-01T10:00:00Z" },
  });
});

describe("market experience", () => {
  it("initializes the selected or system theme before the app loads", () => {
    const script = readFileSync("frontend/public/theme-init.js", "utf8");
    const initial = (saved: string | null, dark: boolean) => {
      const document = { documentElement: { dataset: { theme: "" } } };
      runInNewContext(script, { document, localStorage: { getItem: () => saved }, window: { matchMedia: () => ({ matches: dark }) }, console });
      return document.documentElement.dataset.theme;
    };
    expect(initial(null, true)).toBe("dark");
    expect(initial(null, false)).toBe("light");
    expect(initial("light", true)).toBe("light");
    expect(initial("dark", false)).toBe("dark");
    expect(initial("invalid", true)).toBe("dark");
    // The same early script marks that scripts run, which hides the plain copy written for search engines.
    const marked = { documentElement: { dataset: {} as Record<string, string> } };
    runInNewContext(script, { document: marked, localStorage: { getItem: () => null }, window: { matchMedia: () => ({ matches: false }) }, console });
    expect(marked.documentElement.dataset.js).toBe("on");
  });

  it("keeps chart series readable in both themes and escapes tooltip content", () => {
    const light = chartPalette("light"), dark = chartPalette("dark");
    expect(light.BRAND).toBe("#0b3d2e");
    expect(dark.BRAND).not.toBe(light.BRAND);
    const luminance = (hex: string) => {
      const channels = hex.match(/[a-f\d]{2}/gi)!.map((channel) => parseInt(channel, 16) / 255)
        .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const contrastOnWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);
    expect([...light.SERIES_COLORS, ...light.orderedRamp(10)].every((color) => contrastOnWhite(color) >= 3)).toBe(true);
    expect(dark.TOOLTIP.backgroundColor).toBe(dark.INK.surface);
    expect(dark.AXIS_LABEL.color).toBe(dark.INK[500]);
    expect(dark.tooltipHtml("<source>", [{ value: "<rate>" }])).toContain("&#60;source&#62;");
    expect(dark.tooltipHtml("<source>", [{ value: "<rate>" }])).not.toContain("<source>");
  });

  it.each(["production", "trade", "weather", "policy", "news"])("keeps operational controls off the %s customer page", (domain) => {
    state.intelligence = ready({ data: [], attempts: [{ id: "attempt", source_key: "test-source", status: "failed", started_at: "2026-10-01T10:00:00Z", error_message: "capture failed" }] });
    const html = render(<Routes><Route path="/intelligence/:domain" element={<IntelligencePage />} /></Routes>, `/intelligence/${domain}`);
    expect(html).toContain('<span class="label-full">LATEST PLATFORM FETCH</span><span class="label-short" aria-hidden="true">LATEST FETCH</span>');
    expect(html).toContain("No source records are available yet");
    expect(html).not.toContain("Recent capture attempts");
    expect(html).not.toContain("npm run refresh:intelligence");
    expect(html).not.toContain("reviewer token");
    expect(html).not.toContain("capture failed");
  });

  it.each(["production", "trade", "weather", "policy", "news"] as const)("retains %s capture history and refresh options in data quality", (domain) => {
    state.intelligence = ready({ data: [], attempts: [{ id: "attempt", source_key: "test-source", status: "failed", started_at: "2026-10-01T10:00:00Z", error_message: "capture failed" }] });
    const html = render(<IntelligenceSourceDetails domain={domain} />);
    expect(html).toContain("Recent capture attempts");
    expect(html).toContain("test-source");
    expect(html).toContain("capture failed");
    if (domain === "production" || domain === "trade") expect(html).toContain("npm run refresh:intelligence");
    else {
      expect(html).toContain("Source refresh reviewer token");
      expect(html).toContain(domain === "weather" ? "Refresh Sirsi weather" : "Refresh official releases");
    }
    expect(render(<DataQualityPage />)).toContain("Intelligence source health");
  });

  it("shows customer and operator copy in Kannada", () => {
    state.language = "kn";
    state.intelligence = ready({ data: [], attempts: [] });
    const customer = render(<Routes><Route path="/intelligence/:domain" element={<IntelligencePage />} /></Routes>, "/intelligence/weather");
    expect(customer).toContain("ಇನ್ನೂ ಯಾವುದೇ ಮೂಲ ದಾಖಲೆಗಳು ಲಭ್ಯವಿಲ್ಲ");
    expect(customer).not.toContain("ಮೂಲ ನವೀಕರಣ ಪರಿಶೀಲಕರ ಟೋಕನ್");
    expect(render(<DataQualityPage />)).toContain("ಮಾಹಿತಿ ಮೂಲಗಳ ಸ್ಥಿತಿ");
    expect(render(<IntelligenceSourceDetails domain="weather" />)).toContain("ಶಿರಸಿ ಹವಾಮಾನ ನವೀಕರಿಸಿ");
  });

  it("does not mistake an unavailable source history for an empty history", () => {
    state.intelligence = { data: undefined, isLoading: false, error: new Error("Source history unavailable"), refetch: vi.fn() };
    const html = render(<IntelligenceSourceDetails domain="weather" />);
    expect(html).toContain("Source history unavailable");
    expect(html).not.toContain("No attempts recorded.");
  });

  it.each([
    ["weather", ["Maximum (°C)", "Minimum (°C)", "Rain (mm)"]],
    ["production", ["Area (&#x27;000 ha)", "Production (&#x27;000 tonnes)", "Yield (kg/ha)"]],
    ["trade", ["Quantity (tonnes)", "Value (INR lakh)"]],
  ])("aligns numeric %s record headers with numeric data", (domain, numericHeaders) => {
    state.intelligence = ready({ data: [{ capture_id: "one", source_key: "test", source_url: "https://example.test", fetched_at: "2026-10-01T10:00:00Z", publication_period: null, content_hash: "hash", ...(domain === "weather"
      ? { date: "2026-10-01", kind: "recent_model", temperature_max_c: 30, temperature_min_c: 19, precipitation_mm: 0, grid_latitude: 14, grid_longitude: 74, elevation_m: 500 }
      : domain === "production"
        ? { geography: "Karnataka", period: "2026", estimate_status: "final", area_thousand_hectares: 1, production_thousand_tonnes: 2, yield_kg_hectare: 3 }
        : { partner: "India", period: "2026", direction: "Import", quantity_tonnes: 1, value_inr_lakh: 2 }) }], attempts: [] });
    const html = render(<Routes><Route path="/intelligence/:domain" element={<IntelligencePage />} /></Routes>, `/intelligence/${domain}`);
    for (const header of numericHeaders) expect(html).toContain(`class="numeric">${header}</th>`);
    expect(html).toContain('class="evidence-column"');
  });

  it("allows bulletin titles and source evidence to wrap independently", () => {
    state.intelligence = ready({ data: [{ capture_id: "one", source_key: "pib", source_url: "https://example.test", fetched_at: "2026-10-01T10:00:00Z", publication_period: "2026-10-01", content_hash: "hash", release_id: "1", title: "A lengthy official policy release", published_on: "2026-10-01", is_policy: 1 }], attempts: [] });
    const html = render(<Routes><Route path="/intelligence/:domain" element={<IntelligencePage />} /></Routes>, "/intelligence/policy");
    expect(html).toContain('class="bulletin-table"');
    expect(html).toContain('class="bulletin-title"');
    expect(html).toContain('class="evidence-column"');
    expect(html).toContain("A lengthy official policy release");
  });

  it("reports a failed cooperative separately while showing dated official modal prices", () => {
    const html = render(<HomePage />);
    expect(html).toContain("Could not load the rates");
    expect(html).toContain("Siddapur APMC");
    expect(html).toContain("Grade A");
    expect(html).toContain("AGMARKNET");
    expect(html).toContain("modal price, ₹/quintal");
    expect(html).toContain('href="/prices?feed=official"');
    expect(html).toContain('href="/prices?feed=mamcos&amp;variety=RASHI%20EDI"');
    expect(html).toContain('href="/prices?feed=tss&amp;variety=RASHI"');
    expect(html).toContain('href="/prices?feed=tumcos"');
  });

  it("shows all successful feeds separately with their own dates and price bases", () => {
    state.cooperative = [
      ready({ latest_by_branch: [cooperativeQuote("mamcos", "Sagara", "RASHI EDI")], data: [] }),
      ready({ latest_by_branch: [cooperativeQuote("tss", "Sirsi", "RASHI")], data: [] }),
      ready({ latest_by_branch: [cooperativeQuote("tumcos", "Channagiri", "areca")], data: [] }),
    ];
    const html = render(<HomePage />);
    expect(html).toContain("Sagara");
    expect(html).toContain("Sirsi");
    expect(html).toContain("Channagiri");
    expect(html).toContain("Siddapur APMC");
    expect(html).toContain("average per quintal");
    expect(html).toContain("modal price, ₹/quintal");
    expect(html).toContain("1 Oct 2026");
    expect(html).not.toContain("Could not load the rates");
  });

  it("offers a share button on each card that has rates, and none on an empty one", () => {
    state.cooperative = [
      ready({ latest_by_branch: [cooperativeQuote("mamcos", "Sagara", "RASHI EDI")], data: [] }),
      ready({ latest_by_branch: [], data: [] }),
      ready({ latest_by_branch: [cooperativeQuote("tumcos", "Channagiri", "areca")], data: [] }),
    ];
    state.official = ready({ data: [] });
    const html = render(<HomePage />);
    expect(html).toContain('aria-label="Share MAMCOS rates"');
    expect(html).toContain('aria-label="Share TUMCOS rates"');
    expect(html).not.toContain('aria-label="Share TSS rates"');
    expect(html).not.toContain('aria-label="Share APMC rates"');
  });

  it("builds a short chat message with the report date, basis and a link back", () => {
    const lines = Array.from({ length: 10 }, (_, index) => ({ place: `Branch ${index + 1}`, price: `₹${48000 + index}` }));
    const text = shareMessage({ title: "Rashi arecanut rates · MAMCOS", date: "Report: 1 Oct 2026", lines, more: (count) => `…and ${count} more`, note: "Average rate per quintal.", url: "https://example.test/?v=rashi" });
    expect(text.split("\n")[0]).toBe("*Rashi arecanut rates · MAMCOS*");
    expect(text).toContain("Report: 1 Oct 2026");
    expect(text).toContain("• Branch 8: ₹48007");
    expect(text).not.toContain("Branch 9:");
    expect(text).toContain("…and 2 more");
    expect(text.split("\n").at(-1)).toBe("ಅಡಿಕೆ ನಾಡಿಯಲ್ಲಿ ದಿನದ ಅಡಿಕೆ ಧಾರಣೆ ನೋಡಿ: https://example.test/?v=rashi");
    expect(shareMessage({ title: "APMC", lines: [{ place: "Market One", price: "₹100", date: "2 Oct 2026" }], more: String, note: "", url: "u" })).toContain("• Market One: ₹100 (2 Oct 2026)");
  });

  it("distinguishes an empty official feed from a failed feed", () => {
    state.official = ready({ data: [] });
    expect(render(<HomePage />)).toContain("No verified APMC prices are available yet.");
    state.official = failed;
    expect(render(<HomePage />)).not.toContain("No verified APMC prices are available yet.");
  });

  it("does not describe a paused initial request as an empty feed", () => {
    state.official = { isPending: true, isError: false };
    const html = render(<HomePage />);
    expect(html).toContain("Loading rates");
    expect(html).toContain('class="skeleton-rows"');
    expect(html).not.toContain("No verified APMC prices are available yet.");
  });

  it("keeps the official feed selectable even when it has no published prices", () => {
    const html = render(<MarketDataPage official={<><SourceSlot /><p>Official empty state</p></>} />, "/prices?feed=official");
    expect(html).toContain("Official empty state");
    expect(html).toContain('value="official"');
  });

  it.each(["official", "mamcos", "tss", "tumcos"])("clears search without losing %s feed or URL context", (feed) => {
    const original = new URLSearchParams(`feed=${feed}&commodity=arecanut&variety=RASHI&search=Sirsi&view=table`);
    const result = withParams(original, { search: null });
    expect(result.toString()).toBe(`feed=${feed}&commodity=arecanut&variety=RASHI&view=table`);
    expect(original.get("search")).toBe("Sirsi");
  });

  it("keeps the essential official filters visible and places advanced filters in a disclosure", () => {
    const html = render(<PricesPage />, "/prices?feed=official");
    expect(html).toContain("Variety (exact)");
    expect(html).toContain("More filters");
    expect(html).toContain("Reporting period");
    expect(html).toContain("Export all matching");
  });

  it("shows links to each independent price section on the homepage", () => {
    const html = render(<HomePage />);
    for (const source of ["mamcos", "tss", "tumcos", "official"]) {
      expect(html).toContain(`href="#rates-${source}"`);
      expect(html).toContain(`id="rates-${source}"`);
    }
  });

  it("organizes source quotations by price type and keeps exact cooperative labels visible in Kannada", () => {
    state.language = "kn";
    state.cooperative = [
      ready({ latest_by_branch: [cooperativeQuote("mamcos", "Sagara", "RASHI EDI")], data: [] }),
      ready({ latest_by_branch: [cooperativeQuote("tss", "Sirsi", "RASHI")], data: [] }),
      ready({ latest_by_branch: [cooperativeQuote("tumcos", "Channagiri", "areca")], data: [] }),
    ];
    const html = render(<HomePage />);
    expect(html).toContain("ಸಹಕಾರಿ ಶಾಖೆಗಳ ದರಗಳು");
    expect(html).toContain("ಇತರ ಮಾರುಕಟ್ಟೆ ದರಗಳು");
    expect(html).toContain("ಇತ್ತೀಚಿನ ಸಹಕಾರಿ ವರದಿ");
    expect(html).toContain("RASHI EDI");
    expect(html).toContain("ಘಟಕ ಊಹಿಸಲಾಗಿದೆ");
    expect(html).toContain("AGMARKNET");
    expect(html.indexOf('id="rates-tumcos"')).toBeGreaterThan(html.indexOf('id="other-prices-heading"'));
    expect(html.indexOf('id="rates-official"')).toBeGreaterThan(html.indexOf('id="other-prices-heading"'));
  });

  it("distinguishes retrieved data awaiting review from published observations", () => {
    const html = render(<MarketDataPage official={<p>Official</p>} />, "/prices?feed=tss");
    expect(html).toContain("Source supported");
    expect(html).toContain("Last retrieval: succeeded");
    expect(html).toContain("2 awaiting review across this source and commodity");
    expect(html).toContain("No published observations in this selection");
    expect(html).toContain("Latest archived reporting date: 30 Sep 2026");
  });

  it("does not rank or draw cross-date bars in latest quotations", () => {
    state.comparison = [quote, { ...quote, id: "official-2", market_id: "two", market_name: "Market Two", reporting_date: "2026-09-30", modal_price: 53000 }];
    const html = render(<ComparePage />, "/compare?feed=official");
    expect(html).toContain("Reporting dates vary by market");
    expect(html).toContain("Market One");
    expect(html).toContain("Market Two");
    expect(html).not.toContain("comparison-bar-track");
    expect(html).not.toContain('class="rank"');
    expect(html).not.toContain("Sort by price");
    expect(html).toContain("Modal price · INR / quintal");
    expect(html).toContain("Same-date chart: Market One");
    expect(html).not.toContain("Same-date chart: Market One, Market Two");
  });

  it("suggests markets by start of name first, and finds Kannada names and other spellings", () => {
    const items = [
      marketSuggestion("mamcos", "SHIVAMOGGA"), marketSuggestion("mamcos", "SAGARA"), marketSuggestion("tss", "SIRSI"),
      marketSuggestion("mamcos", "THIRTHAHALLI"), marketSuggestion("official", "Siddapur APMC", { marketId: "m1", district: "Uttara Kannada" }),
      marketSuggestion("mamcos", "KOPPA"),
    ];
    const names = (query: string) => matchSuggestions(items, query).map((item) => item.name);
    expect(names("s")).toEqual(["SAGARA", "SHIVAMOGGA", "Siddapur APMC", "SIRSI"]);
    expect(names("shimoga")).toEqual(["SHIVAMOGGA"]);
    expect(names("ಶಿವ")).toEqual(["SHIVAMOGGA"]);
    expect(names("tirtha")).toEqual(["THIRTHAHALLI"]);
    expect(names("apmc")).toEqual(["Siddapur APMC"]);
    expect(names("uttara")).toEqual(["Siddapur APMC"]);
    expect(names("  ")).toEqual([]);
    expect(matchSuggestions(Array.from({ length: 20 }, (_, i) => marketSuggestion("official", `Sa ${i}`, { marketId: String(i) })), "sa")).toHaveLength(8);
  });

  it("links every page's footer to WhatsApp for reporting a wrong price, with the page address in the message", () => {
    const html = render(<AppShell />);
    expect(html).toContain("Spotted a wrong price or a missing market?");
    expect(html).toContain('href="https://wa.me/918660862841?text=');
    expect(html).toContain(encodeURIComponent("Page: /"));
  });

  it("gives the contact email in every page's footer, for reports and in the contact block", () => {
    const html = render(<AppShell />);
    expect(html).toContain(`href="mailto:contact@adikenaadi.com?subject=${encodeURIComponent("Wrong price or missing market")}&amp;body=`);
    expect(html).toContain('href="mailto:contact@adikenaadi.com"');
    expect(html).toContain(">contact@adikenaadi.com</span>");
    expect(html).toContain("All rights reserved.");
  });

  it("offers Rashi, Chali and Sippe gotu as picture pills and every other variety under More varieties", () => {
    const html = render(<HomePage />);
    const cards = html.slice(html.indexOf('class="variety-cards"'));
    expect(cards).toContain('aria-labelledby="home-variety-label"');
    expect([...cards.matchAll(/class="variety-card-name">([^<]+)</g)].map((match) => match[1])).toEqual(["Rashi", "Chali", "Sippe gotu"]);
    expect(cards).toMatch(/aria-pressed="true"><span class="variety-card-photo"><img src="[^"]*rashi[^"]*\.webp"/);
    expect(cards).toContain('<option value="new-rashi">New Rashi</option>');
    expect(cards).toContain('<option value="bette">Bette</option>');
  });

  it("gives phones one variety dropdown that starts on Rashi", () => {
    const html = render(<HomePage />);
    const phone = html.slice(html.indexOf('class="variety-phone"'));
    expect(phone).toContain('aria-labelledby="home-variety-label"');
    expect(phone).toMatch(/<optgroup label="Everyday varieties"><option value="rashi" selected="">Rashi<\/option><option value="chali">Chali<\/option><option value="sippe-gotu">Sippe gotu<\/option><\/optgroup>/);
  });

  it("summarises yearly imports from the published total, with the change and largest sources", () => {
    const trade = (period: string, partner: string, quantity_tonnes: number | null) => ({ period, partner, quantity_tonnes, direction: "Import", value_inr_lakh: null, source_url: "https://dasd.example/imports.pdf" });
    state.intelligence = ready({ data: [
      trade("2023-24", "All partners (including others)", 39443), trade("2024-25", "All partners (including others)", 42174),
      trade("2024-25", "Bangladesh", 12155), trade("2024-25", "Indonesia", 11590), trade("2024-25", "Sri Lanka", 8354), trade("2024-25", "UAE", 390), trade("2024-25", "Bhutan", null),
    ], attempts: [] });
    const html = render(<ImportsPanel />);
    expect(html).toContain("42,174");
    expect(html).toContain("+7% on 2023-24");
    expect(html).toContain("Bangladesh 12,155 · Indonesia 11,590 · Sri Lanka 8,354");
    expect(html).toContain('href="https://dasd.example/imports.pdf"');
  });

  it("shows nothing about imports when no total is published", () => {
    state.intelligence = ready({ data: [], attempts: [] });
    expect(render(<ImportsPanel />)).toBe("");
  });

  it("keeps market events dated, sourced and in order, and picks only those inside a chart's range", () => {
    expect(MARKET_EVENTS.every((event, index) => /^\d{4}-\d{2}-\d{2}$/.test(event.date) && event.source.url.startsWith("https://") && event.en && event.kn
      && (index === 0 || MARKET_EVENTS[index - 1].date < event.date))).toBe(true);
    expect(eventsBetween("2025-01-01", "2025-12-31").map((event) => event.date)).toEqual(["2025-10-15"]);
  });

  it("lets Monthly trends pick a year from a dropdown instead of the browser's month input", () => {
    const html = render(<HistoricalAnalyticsPage />, "/monthly-trends");
    expect(html).not.toContain('type="month"');
    const from = html.slice(html.indexOf('aria-label="From month"'));
    expect(from).toMatch(/aria-label="From month: year"><option value="20\d\d"/);
    expect(from).toContain('<option value="2021" selected="">2021</option>');
    expect(from).toContain('<option value="2010">2010</option>');
  });

  it("offers a menu collapse button that starts expanded", () => {
    const html = render(<AppShell />);
    expect(html).toContain('class="app-shell"');
    expect(html).toContain('class="icon-button sidebar-collapse"');
    expect(html).toContain('aria-label="Collapse menu"');
    expect(html).toContain('class="brand-collapsed-icon"');
  });

  it("keeps advanced routes in a disclosure and displays both navigation languages", () => {
    const english = render(<AppShell />);
    expect(english).toContain('aria-label="Areca Pulse · Market Intelligence"');
    expect(english).toContain('class="brand-icon"');
    expect(english).toContain("Market Intelligence");
    expect(english).toContain("Areca Pulse · Market Intelligence");
    expect(english).not.toContain("Arecanut Intelligence");
    expect(english).toContain("Explore prices");
    expect(english).toContain("More tools");
    expect(english).toContain('href="/monthly-trends"');
    // Internal pages stay reachable by address but are out of the menu, and Historical analytics is part of Monthly trends.
    for (const hidden of ['href="/data-quality"', 'href="/workspace"', 'href="/history"']) expect(english).not.toContain(hidden);
    expect(english).toContain("<details");
    state.language = "kn";
    const kannada = render(<AppShell />);
    expect(kannada).toContain("ಮಾರುಕಟ್ಟೆ ದರಗಳು");
    expect(kannada).toContain("ಹೆಚ್ಚಿನ ಸಾಧನಗಳು");
    expect(render(<HomePage />)).toContain("ಎಪಿಎಂಸಿ ಮಾರುಕಟ್ಟೆ ದರಗಳು");
  });

  it("keeps price filters in the URL and resets them without losing feed, commodity or context", () => {
    const params = new URLSearchParams("feed=official&commodity=arecanut&variety=Rashi&search=Sirsi&district=Shivamogga&from=2026-01-01&period=custom&sort=modal_price&dir=asc&page=3");
    expect(withoutFilters(params).toString()).toBe("feed=official&commodity=arecanut&variety=Rashi");
    expect(withoutFilters(params, ["variety"]).toString()).toBe("feed=official&commodity=arecanut");
    expect(withParams(params, { page: null, district: "", grade: "A" }).get("page")).toBeNull();
    expect(withParams(params, { district: "" }).has("district")).toBe(false);
    expect(withParams(params, { grade: "A" }).get("grade")).toBe("A");
    expect(readPage(params)).toBe(2);
    expect(readPage(new URLSearchParams("page=-4"))).toBe(0);
    expect(readPage(new URLSearchParams("page=abc"))).toBe(0);
    const fallback = { key: "reporting_date", direction: "desc" } as const;
    expect(readSort(params, ["reporting_date", "modal_price"] as const, fallback)).toEqual({ key: "modal_price", direction: "asc" });
    expect(readSort(new URLSearchParams("sort=injected"), ["reporting_date"] as const, fallback)).toEqual(fallback);
    expect(readPreset(params)).toBe("custom");
    expect(readPreset(new URLSearchParams("period=30d"))).toBe("30d");
    expect(readPreset(new URLSearchParams("period=bogus"))).toBe("all");
  });

  it("restores official price filters from a shared link and has its own search box", () => {
    const html = render(<PricesPage />, "/prices?feed=official&search=Sirsi&district=Shivamogga");
    expect(html).toContain("Search market, district or variety");
    expect(html).toContain('value="Sirsi"');
    expect(html).toContain("More filters · active");
    expect(html).toContain("Clear all filters");
  });

  it("restores cooperative branch filters from the URL", () => {
    state.cooperativePage = ready({
      data: [cooperativeQuote("mamcos", "Sagara", "RASHI EDI"), { ...cooperativeQuote("mamcos", "Sirsi", "RASHI EDI"), id: "two" }],
      latest_by_branch: [], branches: ["Sagara", "Sirsi"], varieties: ["RASHI EDI"], variety: "RASHI EDI", series: [], counts: [], recent_fetches: [],
      publication: { awaiting_review_count: 0, blocked_reason: null, latest_archived_reporting_date: null },
      last_fetch: null, latest_reporting_date: "2026-10-01",
    });
    const html = render(<MarketDataPage official={<p>Official</p>} />, "/prices?feed=mamcos&branch=Sirsi");
    expect(html).toContain("1 matching observation");
    expect(html).toContain('<td class="table-market">Sirsi</td>');
    expect(html).not.toContain('<td class="table-market">Sagara</td>');
  });

  it("shows a not-found page for unknown addresses instead of silently going home", () => {
    const shell = render(<AppShell />, "/no-such-page");
    expect(shell).toContain("Page not found");
    expect(render(<NotFoundPage />, "/no-such-page")).toContain("There is no page at /no-such-page");
    state.language = "kn";
    expect(render(<NotFoundPage />, "/no-such-page")).toContain("ಪುಟ ಸಿಗಲಿಲ್ಲ");
  });

  it("shows the shell in Kannada on every page and hides the duplicate search on the prices page", () => {
    state.language = "kn";
    const prices = render(<AppShell />, "/prices");
    expect(prices).not.toContain('lang="en"><div');
    expect(prices).not.toContain('role="search"');
    expect(prices).toContain("ಮುಖ್ಯ ವಿಷಯಕ್ಕೆ ಹೋಗಿ");
    expect(render(<AppShell />, "/analytics")).toContain('role="search"');
  });

  it("keeps language and theme preferences together after page-specific header controls", () => {
    for (const language of ["en", "kn"] as const) {
      state.language = language;
      for (const path of ["/", "/prices", "/analytics", "/sell-or-hold"]) {
        const html = render(<AppShell />, path);
        const preferences = html.indexOf('class="topbar-preferences"');
        expect(preferences).toBeGreaterThan(-1);
        expect(html.indexOf('class="language-toggle"', preferences)).toBeGreaterThan(preferences);
        expect(html.indexOf("theme-toggle", preferences)).toBeGreaterThan(preferences);
        if (path === "/prices" || path === "/analytics") {
          expect(html.indexOf('class="topbar-tools"')).toBeLessThan(preferences);
          expect(html).toContain('class="commodity-select"');
        } else {
          expect(html).not.toContain('class="topbar-tools"');
        }
      }
    }
  });

  it("answers in the site language by default", () => {
    state.language = "kn";
    expect(render(<AssistantPage />, "/assistant")).toMatch(/<option value="kn"[^>]*selected="">/);
    state.language = "en";
    expect(render(<AssistantPage />, "/assistant")).toMatch(/<option value="en"[^>]*selected="">/);
  });

  it("lays the home price cards out in one grid with the comparison note after it", () => {
    const html = render(<HomePage />);
    expect(html).toContain('class="rate-grid');
    const grid = html.slice(html.indexOf('class="rate-grid'));
    for (const source of ["mamcos", "tss", "tumcos", "official"]) expect(grid).toContain(`id="rates-${source}"`);
    expect(html.indexOf("rates-official")).toBeLessThan(html.indexOf("compare rates directly"));
  });

  it("keeps methodology collapsed and drops repeated banner text on cooperative pages", () => {
    const html = render(<MarketDataPage official={<p>Official</p>} />, "/analytics?feed=tss");
    expect(html).toContain('<details class="about-data">');
    expect(html).toContain("branch averages · ₹/quintal (unit assumed)");
    expect(html).not.toContain('class="eyebrow"');
    expect(html).not.toContain("Supported sources are listed even when no prices are published");
    expect(html).not.toContain("No variety aliases are merged.");
  });

  it("only lists TSS labels the importer captures, and keeps fresh nut apart from dried grades", () => {
    const captured = new Set<string>(TSS_VARIETIES);
    for (const variety of VARIETIES) for (const label of variety.labels.tss ?? []) expect(captured.has(label), label).toBe(true);
    expect(VARIETIES.find((item) => item.key === "new-rashi")?.labels.tss).toEqual(["NEW RASHI"]);
    expect(VARIETIES.filter((item) => item.labels.tss?.includes("FRESH RED ARECANUT")).map((item) => item.key)).toEqual(["fresh-red"]);
    // Every fresh lot is its own variety in the fresh group, so no fresh price is ever read as a dried grade's.
    const fresh = ["FRESH RED ARECANUT", "FRESH GREEN ARECANUT", "GREEN RAW ARECA", "FRESH SIPPE ARECA", "FRESH KOLE RAW"];
    expect(VARIETIES.filter((item) => item.group === "fresh").map((item) => item.labels.tss)).toEqual(fresh.map((label) => [label]));
  });

  it("shows only the cooperatives that publish a variety and names the others in one line", () => {
    state.cooperative = [ready({ latest_by_branch: [cooperativeQuote("tss", "Sirsi", "CHURU")], data: [] })];
    const html = render(<HomePage />, "/?v=churu");
    expect(html).toContain('id="rates-tss"');
    expect(html).not.toContain('id="rates-mamcos"');
    expect(html).not.toContain('id="rates-tumcos"');
    expect(html).toContain("MAMCOS does not publish this variety.");
    expect(html).toContain('href="/prices?feed=tss&amp;variety=CHURU"');
    expect(html).toContain('class="variety-more variety-more-active"');
  });

  it("explains that fresh red arecanut is undried nut", () => {
    state.cooperative = [ready({ latest_by_branch: [], data: [] })];
    expect(render(<HomePage />, "/?v=fresh-red")).toContain("Fresh, undried nuts");
  });

  it.each([
    ["/", () => <HomePage />], ["/sell-or-hold", () => <SellOrHoldPage />], ["/prices", () => <PricesPage />], ["/overview", () => <OverviewPage />],
    ["/analytics", () => <AnalyticsPage />], ["/compare", () => <ComparePage />], ["/prices?feed=mamcos", () => <MarketDataPage official={<p />} />],
    ["/monthly-trends", () => <HistoricalAnalyticsPage />], ["/decision-tools", () => <DecisionToolsPage />],
    ["/intelligence/production", () => <IntelligencePage />], ["/intelligence/quality", () => <QualityInspectionsPage />], ["/supply", () => <SupplyPage />],
    ["/forecasts", () => <ForecastsPage />], ["/forecasts/evaluation", () => <ForecastEvaluationPage />], ["/assistant", () => <AssistantPage />],
    ["/workspace", () => <WorkspacePage />], ["/data-quality", () => <DataQualityPage />], ["/no-such-page", () => <NotFoundPage />],
  ] as [string, () => React.ReactNode][])("renders %s in Kannada", (path, page) => {
    state.language = "kn";
    state.cooperative = [ready({ latest_by_branch: [], data: [] }), ready({ latest_by_branch: [], data: [] }), ready({ latest_by_branch: [], data: [] })];
    const html = render(page(), path);
    const heading = /<h1[^>]*>(.*?)<\/h1>/.exec(html)?.[1] ?? "";
    expect(heading, `${path} heading`).toMatch(/[\u0C80-\u0CFF]/);
  });

  it("places the source dropdown in the page heading row instead of a separate row", () => {
    const html = render(<MarketDataPage official={<p />} />, "/prices?feed=mamcos");
    const heading = html.slice(html.indexOf('class="page-heading"'), html.indexOf("</section>", html.indexOf('class="page-heading"')));
    expect(heading).toContain('class="heading-controls"');
    expect(heading).toContain("source-control");
    expect(html).not.toContain("source-bar");
  });

  it("sums up each cooperative's latest report in the at-a-glance strip, separately per source", () => {
    state.cooperative = [
      ready({ latest_by_branch: [
        { ...cooperativeQuote("mamcos", "Sagara", "RASHI EDI"), id: "m1", average_price: 47000 },
        { ...cooperativeQuote("mamcos", "Koppa", "RASHI EDI"), id: "m2", average_price: 48500 },
      ], data: [
        { ...cooperativeQuote("mamcos", "Sagara", "RASHI EDI"), id: "p1", reporting_date: "2026-09-30", average_price: 48000 },
        { ...cooperativeQuote("mamcos", "Koppa", "RASHI EDI"), id: "p2", reporting_date: "2026-09-30", average_price: 49000 },
      ] }),
      ready({ latest_by_branch: [cooperativeQuote("tss", "Sirsi", "RASHI")], data: [] }),
      ready({ latest_by_branch: [], data: [] }),
    ];
    const html = render(<HomePage />);
    const strip = html.slice(html.indexOf('class="glance"'), html.indexOf("</section>", html.indexOf('class="glance"')));
    expect(strip).toContain("Rashi at a glance");
    expect(strip).toContain("₹47,000");
    expect(strip).toContain("₹48,500");
    expect(strip).toContain("/ quintal");
    expect(strip).toMatch(/class="glance-trend hold-down">.*Down −/);
    expect(strip).not.toContain("median");
    expect(strip).toContain("2 branches");
    expect(strip).toContain("1 Oct 2026");
    expect(strip).toContain("₹48,000");
    expect(strip).toContain("1 branch<");
    expect(strip).toContain('title="No earlier report to show a change against">No prior report<');
    expect(strip).toMatch(/class="glance-share"><button[^>]*aria-label="Share this summary"/);
  });

  it("shows one APMC Siddapur row for the chosen variety from its latest day, with a link to the other markets", () => {
    state.official = ready({ data: [
      { ...siddapur, id: "s-chali", variety_name: "Chali", modal_price: 41899 },
      { ...siddapur, id: "s-rashi", variety_name: "Rashi", modal_price: 45699 },
      { ...siddapur, id: "s-old", variety_name: "Rashi", reporting_date: "2026-09-30", modal_price: 40000 },
    ] });
    const html = render(<HomePage />);
    const card = html.slice(html.indexOf('id="rates-official"'));
    expect((card.match(/class="rate-row/g) ?? []).length).toBe(1);
    expect(card).toContain("₹45,699");
    expect(card).not.toContain("₹40,000");
    expect(card).toContain("See rates from more APMC markets");
  });

  it("shows three branches per card, the featured MAMCOS ones first, with a toggle for the rest", () => {
    const branches = ["Koppa", "Sagara", "Birur", "Shivamogga", "Soraba", "Tarikere", "Thirthahalli", "Jayapura"];
    state.cooperative = [
      ready({ latest_by_branch: branches.map((branch, index) => ({ ...cooperativeQuote("mamcos", branch, "RASHI EDI"), id: `m${index}`, average_price: 48000 - index })), data: [] }),
      ready({ latest_by_branch: [], data: [] }), ready({ latest_by_branch: [], data: [] }),
    ];
    const html = render(<HomePage />);
    expect((html.match(/class="rate-row/g) ?? []).length).toBe(3 + 1);
    const card = html.slice(html.indexOf('id="rates-mamcos"'), html.indexOf("rate-more-toggle"));
    expect(card).toContain("Sagara");
    expect(card).toContain("Shivamogga");
    expect(card).toContain("Thirthahalli");
    expect(card).not.toContain("Koppa");
    expect(html).toContain("Show all 8 branches");
    expect(html).toContain('class="home-date-pill');
    expect(html).toContain("Latest report");
  });
});

/** The text a screen reader would read: aria-hidden subtrees (such as rolling digits) removed, tags stripped. */
function spoken(html: string): string {
  let out = "", hiddenDepth = 0;
  for (const token of html.match(/<[^>]+>|[^<]+/g) ?? []) {
    if (token.startsWith("</")) { if (hiddenDepth) hiddenDepth--; continue; }
    if (token.startsWith("<")) {
      const selfClosing = token.endsWith("/>");
      if (hiddenDepth) { if (!selfClosing) hiddenDepth++; continue; }
      if (token.includes('aria-hidden="true"') && !selfClosing) hiddenDepth = 1;
      continue;
    }
    if (!hiddenDepth) out += token;
  }
  return out.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
}

describe("forecast evaluation summary", () => {
  const evaluation = (model: string, mae: number, status: ModelEvaluation["status"] = "not_better_than_baseline"): ModelEvaluation => ({
    id: mae, series_id: "KA|Rashi", variety: "Rashi", market: "Karnataka", grade: null, horizon: 1, model, model_version: "1",
    baseline_model: "last_value", status: model === "last_value" ? "reference" : status, reasons: [], n: 34, mae, rmse: null,
    wape: mae / 48000, mase: null, directional_accuracy: null, interval_coverage: 0.88, interval_width: null, dm_statistic: null,
    p_value: null, p_value_holm: null, mae_skill_vs_baseline: null, coverage_status: "consistent_with_nominal",
  });
  const show = (rows: ModelEvaluation[]) => render(<ForecastShowcase evaluations={rows} track={[{ series_id: "KA|Rashi", variety: "Rashi",
    periods: ["2026-01", "2026-02"], actual: [1, 2], baseline: [1, 2], median: [1, 2], lower: [0, 1], upper: [2, 3] }]} trackModel="theta"
    predictions={[]} performance={undefined} />);

  it("says plainly when no model beats last month's price, and names no winner", () => {
    const html = show([evaluation("last_value", 2065), evaluation("chronos2", 2106), evaluation("theta", 2223)]);
    expect(html).toContain("Not yet better than “Last month&#x27;s price”");
    expect(html).toContain("±₹2,065");
    expect(html).toContain("Chronos-2");
    expect(html).toContain("2.0% further off");
    expect(html).not.toContain("Promising");
    expect(html).toContain("Track chart: 2 months");
  });

  it("calls a model promising only when it passed the backtest gate", () => {
    const html = show([evaluation("last_value", 2065), evaluation("ensemble", 1900, "candidate")]);
    expect(html).toContain("Promising");
    expect(html).toContain("Ensemble");
    expect(html).toContain("Passed");
    expect(html).not.toContain("Not yet better");
  });
});

describe("price outlook", () => {
  it("leads with the published range and counts how often past ranges held", () => {
    const points = [{ reporting_month: "2026-09", training_through: "2026-08", actual: 47805, last_value: 50637, seasonal_naive: 1 },
      { reporting_month: "2026-10", training_through: "2026-09", actual: 47175, last_value: 47805, seasonal_naive: 1 }];
    const evaluation = {
      selected_model: "last_value" as const, label: "", selection_rule: "", initial_training_months: 36,
      validation: { points: [], metrics: { last_value: { count: 0, mae: 0, rmse: 0, smape_percent: 0 }, seasonal_naive: { count: 0, mae: 0, rmse: 0, smape_percent: 0 } } },
      calibration: { count: 12, absolute_residual_radius: 2000, nominal_coverage: 0.8, quantile_rank: 10 },
      holdout: { points, selected: { count: 2, mae: 1730, rmse: 0, smape_percent: 0 }, naive: { count: 2, mae: 1730, rmse: 0, smape_percent: 0 }, covered: 1, interval_coverage: 0.5, mae_skill_vs_naive: 0 },
    };
    const html = render(<PriceOutlook variety="Rashi" historyCount={70} evaluation={evaluation} outlook={null}
      forecast={{ reporting_month: "2026-11", model: "last_value", point: 47175, lower: 43048, upper: 51301, nominal_coverage: 0.8, method: "" }}
      prices={[{ reporting_month: "2026-09", weighted_price: 47805 }, { reporting_month: "2026-10", weighted_price: 47175 }]} />);
    expect(spoken(html)).toContain("Likely between ₹43,048 and ₹51,301");
    expect(spoken(html)).toContain("Most likely around ₹47,175 per quintal.");
    expect(html).toContain("1 of 2 months");
    expect(html).toContain("Outside range");
    expect(html).toContain("Outlook chart: 2 months");
  });
});

describe("sell or wait chart", () => {
  it("marks a past year as paid off only when it rose at least as much as the cost line, and skips left-out months", () => {
    const year = (start: string, percent: number | null, excluded = false) => ({ start_month: start, start_price: 40000,
      changes: [{ months: 3, target_month: "x", percent, excluded }] });
    const html = renderToStaticMarkup(<HoldOutcomeChart years={[year("2021-11", 6), year("2022-11", 2.5), year("2023-11", -4), year("2024-11", 20, true)]}
      columns={[{ months: 3, label: "3 months", needed: 2.5, covered: "paid off 2 of 3" }]} monthLabel={(m) => m}
      neededLabel={(p) => `needs +${p}%`} paidLabel="covered costs" notPaidLabel="did not cover costs" description="chart"
      legend={{ paid: "paid", notPaid: "not", needed: "needed", zone: "zone" }} />);
    expect(html.match(/hold-chart-dot is-paid/g)).toHaveLength(2);
    expect(html.match(/hold-chart-dot/g)).toHaveLength(3);
    expect(spoken(html)).toContain("needs +2.5%");
    expect(spoken(html)).toContain("paid off 2 of 3");
  });

  it("gives phones short labels while screen readers keep the full wording", () => {
    const year = (start: string, percent: number) => ({ start_month: start, start_price: 40000, changes: [{ months: 1, target_month: "x", percent, excluded: false }] });
    const html = renderToStaticMarkup(<HoldOutcomeChart years={[year("2021-11", 6), year("2022-11", -1)]}
      columns={[{ months: 1, label: "1 month", shortLabel: "1 mo", needed: 0.8, covered: "paid off 1 of 2", coveredShort: "1/2" }]} monthLabel={(m) => m}
      neededLabel={(p) => `needs +${p}%`} neededShort={(p) => `+${p}%`} paidLabel="covered costs" notPaidLabel="did not cover costs" description="chart"
      legend={{ paid: "Year waiting paid off", notPaid: "Year it did not", needed: "Rise needed to cover your costs", zone: "Where waiting pays off" }}
      legendShort={{ paid: "Paid off", notPaid: "Did not", needed: "Cost line" }} />);
    for (const short of ["1 mo", "Paid off", "Cost line"]) expect(html).toContain(`<span class="label-short" aria-hidden="true">${short}</span>`);
    // Legend (3), month, required rise and years paid off: every phone label has a hidden-from-readers short copy.
    expect(html.match(/class="label-short" aria-hidden="true"/g)).toHaveLength(6);
    expect(html).toContain('class="hold-key-zone-item"');
    for (const full of ["1 month", "needs +0.8%", "paid off 1 of 2", "Rise needed to cover your costs"]) expect(spoken(html)).toContain(full);
    expect(spoken(html)).not.toContain("Cost line");
  });
});

describe("rolling price", () => {
  it("gives screen readers the exact price and keeps the moving digits hidden from them", () => {
    const html = renderToStaticMarkup(<RollingNumber text="₹46,789" />);
    expect(html).toContain('<span class="sr-only">₹46,789</span>');
    expect(html).toContain('class="roll-face" aria-hidden="true"');
    expect(html.match(/class="roll-digit"/g)).toHaveLength(5);
    // The resting state is the final digit, so the price is right even if the roll animation never runs.
    expect(html).toContain("translateY(-90%)"); // the 9 in 46,789
    expect(html).toContain("translateY(-40%)"); // the 4
  });
});

describe("town pages", () => {
  const renderTown = (slug: string) => render(<Routes><Route path="/market/:slug" element={<MarketPage />} /></Routes>, `/market/${slug}`);

  it("shows each source at the town in its own card, with the grower's variety names linked to their pages", () => {
    state.branch = [ready({ data: [{ ...cooperativeQuote("tss-chali", "Sirsi", "CHALI"), id: "tss-chali" }, { ...cooperativeQuote("tss-rashi", "Sirsi", "RASHI"), id: "tss-rashi", average_price: 45024 }] })];
    state.official = ready({ data: [{ ...quote, id: "sirsi-apmc", market_name: "Sirsi APMC", modal_price: 44100 }, siddapur] });
    const html = renderTown("sirsi");
    expect(html).toContain("<h1>Sirsi arecanut rates</h1>");
    expect(html).toContain("TSS · Sirsi branch");
    // Catalogue order (Rashi before Chali), whatever order the API used.
    expect(html.indexOf('href="/variety/rashi"')).toBeLessThan(html.indexOf('href="/variety/chali"'));
    expect(html).toContain("₹45,024");
    expect(html).toContain("APMC · Sirsi");
    expect(html).toContain("₹44,100");
    // Another market's APMC row that matched the search is left out.
    expect(html).not.toContain("₹51,000");
    expect(html).toContain('href="/market/siddapur"');
  });

  it("says when a source has published nothing recently instead of showing an empty card", () => {
    state.branch = [ready({ data: [] })];
    state.official = ready({ data: [] });
    expect(renderTown("sirsi")).toContain("No published rate in the last 45 days.");
  });

  it("treats an unknown town as a missing page", () => {
    expect(renderTown("atlantis")).toContain("Page not found");
  });

  it("lists every town under its district, in Kannada too", () => {
    const html = render(<MarketIndexPage />, "/market");
    for (const place of MARKET_PLACES) expect(html).toContain(`href="/market/${place.slug}"`);
    expect(html).toContain("Dakshina Kannada district");
    state.language = "kn";
    expect(render(<MarketIndexPage />, "/market")).toContain("ಶಿರಸಿ");
  });

  it("gives each town its own title naming only the sources it has", () => {
    const sirsi = MARKET_PLACES.find((place) => place.slug === "sirsi")!;
    expect(marketSeo(sirsi).en.title).toBe("Sirsi arecanut price today: TSS, APMC rates | Areca Pulse");
    expect(seoPage("/market/puttur")?.en.title).toBe("Puttur arecanut price today: APMC rates | Areca Pulse");
    expect(seoPage("/market")?.path).toBe("/market");
    expect(new Set(MARKET_PLACES.map((place) => place.slug)).size).toBe(MARKET_PLACES.length);
  });
});


describe("AGMARKNET variety names", () => {
  it("shows Kannada names where one is established, and the source's own spelling otherwise", async () => {
    const { agmarknetVarietyName } = await import("../services/agmarknetVarieties");
    expect(agmarknetVarietyName("Rashi", "kn")).toBe("ರಾಶಿ");
    expect(agmarknetVarietyName("Sippegotu", "kn")).toBe("ಸಿಪ್ಪೆಗೋಟು");
    expect(agmarknetVarietyName("Cqca", "kn")).toBe("Cqca");
    expect(agmarknetVarietyName("api", "en")).toBe("Api");
    expect(agmarknetVarietyName("Rashi", "en")).toBe("Rashi");
  });
});

describe("assistant conversation", () => {
  const answer = (overrides: Partial<AssistantAnswer> = {}): AssistantAnswer => ({
    language: "en", tools: [{ tool: "get_current_prices", status: "ok", title: "Current prices", summary: "", reporting_period: "2026-11-11", args: {} }],
    facts: [{ label: "TSS Sirsi – CHALI", value: 41430, unit: "INR/quintal", basis: "COOPERATIVE_TENDER_AVERAGE", reporting_period: "2026-11-11", source_key: "t", source_name: "TSS", citation: "S1", tool: "get_current_prices" },
      { label: "CPCRI publication", value: "garbled passage text", unit: null, reporting_period: null, source_key: "d", citation: "D1", tool: "search_agricultural_documents" }],
    interpretation: { text: "The latest TSS Chali average at Sirsi was reported on 11 Nov 2026 [S1].", generated_by: "llm", note: "", data_dates: "Price dates: TSS 11 Nov 2026 (1 day old).",
      grounding: { status: "passed", reasons: [], ungrounded_numbers: [], unknown_citations: [], removed_sentences: 1, attempts: 1 } },
    assumptions: [], uncertainty: [], missing: [], limitations: [], excerpts: [],
    citations: [{ ref: "S1", key: "t", kind: "data", label: "TSS tender rates", publisher: "TSS", url: "https://example.test/tss", reporting_period: "2026-11-11", retrieved_at: null }],
    disclaimer: "Market information only.", llm: { status: "used", provider: "workers_ai", model: "qwen", reason: null }, injection_flags: [], answer_text: "",
    planning: "rules", planning_error: null, interaction_id: "11111111-1111-4111-8111-111111111111", duration_ms: 3200, entities: { variety: "Chali" }, ...overrides,
  });
  const renderAnswer = (value: AssistantAnswer, latest = true) => render(<Answer question="Chali price?" answer={value} fresh={false} latest={latest} onAsk={() => undefined} />, "/assistant");

  it("opens on a welcome with examples in the reader's language", () => {
    state.language = "kn";
    const html = render(<AssistantPage />, "/assistant");
    expect(html).toContain("ಹೀಗೆ ಕೇಳಿ ನೋಡಿ");
    for (const topic of ["ದರಗಳು", "ಬೆಳೆ ಆರೈಕೆ", "ಮಾರುಕಟ್ಟೆ ಮತ್ತು ಹವಾಮಾನ"]) expect(html).toContain(topic);
    expect(html).toContain("ರಾಶಿ ಅಡಿಕೆಯ ಇತ್ತೀಚಿನ ಬೆಲೆ ಎಷ್ಟು?");
    expect(html).toContain("ಬೋರ್ಡೋ ದ್ರಾವಣ ತಯಾರಿಕೆ ಹೇಗೆ?");
    expect(html).not.toContain("What is the latest Rashi price?");
    // The assistant has its own mark beside the title, distinct from the site logo in the top bar.
    expect(html).toMatch(/<img src="[^"]*ask-areca-pulse[^"]*\.png" alt="" width="52" height="52" class="assistant-brand-mark"/);
  });

  it("puts the answer first, with linked citations, a rate card and its source", () => {
    const html = renderAnswer(answer());
    expect(html.indexOf("The latest TSS Chali average")).toBeLessThan(html.indexOf("₹41,430"));
    expect(html).toContain('href="#11111111-1111-4111-8111-111111111111-S1"');
    expect(html).toContain('id="11111111-1111-4111-8111-111111111111-S1"');
    expect(html).toContain('<span class="chat-dates-label">Price dates</span>');
    expect(html).toContain("<li>TSS 11 Nov 2026 <small>1 day old</small></li>");
    // Sources start folded; the citation link unfolds them.
    expect(html).toMatch(/<details class="chat-sources-box"><summary><span>Sources · 1<\/span>/);
    expect(html).toMatch(/<img class="chat-avatar" src="[^"]*ask-areca-pulse/);
    // Document passages are cited as sources, never shown as figures.
    expect(html).not.toContain("garbled passage text");
  });

  it("keeps how the answer was made folded away, and in plain words", () => {
    const html = renderAnswer(answer({ llm: { status: "grounding_failed", provider: "workers_ai", model: "qwen", reason: "x" },
      interpretation: { ...answer().interpretation, generated_by: "rules", grounding: { status: "failed", reasons: ["Numbers not present in verified data: 35."], ungrounded_numbers: [35], unknown_citations: [] } } }));
    const folded = html.slice(html.indexOf('<details class="chat-how">'));
    expect(html.indexOf("Numbers not present")).toBeGreaterThan(html.indexOf('<details class="chat-how">'));
    expect(folded).toContain("could not be verified, so this is written directly from the data");
  });

  it("offers share, copy and feedback, and follow-ups only on the latest answer", () => {
    const html = renderAnswer(answer());
    expect(html).toContain('aria-label="Helpful"');
    expect(html).toContain("Copy");
    expect(html).toContain("Compare Chali prices across markets");
    expect(renderAnswer(answer(), false)).not.toContain("Compare Chali prices across markets");
  });

  it("suggests follow-ups the assistant can answer, in Kannada for Kannada readers", () => {
    expect(followUps(answer(), "kn")[0]).toBe("ಚಾಲಿ ದರವನ್ನು ಮಾರುಕಟ್ಟೆಗಳಲ್ಲಿ ಹೋಲಿಸಿ");
    const crop = answer({ tools: [{ tool: "search_agricultural_documents", status: "ok", title: "", summary: "", reporting_period: null, args: {} }] });
    expect(followUps(crop, "en")).toContain("How to manage yellow leaf disease?");
    expect(followUps(answer({ tools: [{ tool: "compare_markets", status: "ok", title: "", summary: "", reporting_period: null, args: {} }] }), "en")).not.toContain("Compare Chali prices across markets");
  });
});

describe("price dates in an answer", () => {
  it("shows one line per feed under a label, with the age set apart", () => {
    const html = render(<PriceDates text="Price dates: AGMARKNET daily 6 Nov 2026 (6 days old); MAMCOS 30 Oct 2026 – 3 Nov 2026 (9 days old); AGMARKNET monthly Oct 2026." />);
    expect(html).toContain('<span class="chat-dates-label">Price dates</span>');
    expect(html.match(/<li>/g)).toHaveLength(3);
    expect(html).toContain("<li>MAMCOS 30 Oct 2026 – 3 Nov 2026 <small>9 days old</small></li>");
    expect(html).toContain("<li>AGMARKNET monthly Oct 2026</li>");
  });

  it("shows any other shape of text as it is", () => {
    expect(render(<PriceDates text="No dates" />)).toContain("<span>No dates</span>");
  });
});

describe("rate tile labels", () => {
  it("keeps the place and variety in the title and moves the source and kind of price below", () => {
    expect(rateLabel("AGMARKNET Yellapur APMC – Chali latest modal price", "AGMARKNET daily", "en")).toEqual({ title: "Yellapur APMC · Chali", measure: "latest modal" });
    expect(rateLabel("Sirsi APMC (Uttara Kannada) – Chali modal price", "AGMARKNET daily", "en")).toEqual({ title: "Sirsi APMC · Chali", measure: "modal" });
    expect(rateLabel("TSS Sirsi – RASHI branch average", "TSS", "en")).toEqual({ title: "Sirsi · RASHI", measure: "branch average" });
    expect(rateLabel("MAMCOS median of branch averages – RASHI EDI", "MAMCOS", "en")).toEqual({ title: "Median of branch averages · RASHI EDI", measure: null });
    expect(rateLabel("Karnataka monthly arrival-weighted modal price – Rashi", "AGMARKNET monthly", "kn")).toEqual({ title: "Karnataka monthly · Rashi", measure: "ಆವಕ ಆಧಾರಿತ ಮೋಡಲ್ ದರ" });
    expect(rateLabel("Reference index – Rashi", "Areca Pulse reference index", "en")).toEqual({ title: "Reference index · Rashi", measure: null });
  });
});

describe("pages search engines may index", () => {
  it("allows every address in the sitemap, including town and variety pages that are not in the menu", async () => {
    const { SEO_PAGES, MARKETS_SEO, marketSeo, varietySeo } = await import("../services/seo-pages");
    const paths = [...SEO_PAGES.map((page) => page.path), MARKETS_SEO.path, ...MARKET_PLACES.map((place) => marketSeo(place).path), ...VARIETIES.map((variety) => varietySeo(variety).path)];
    const blocked = paths.filter((path) => !searchablePath(path));
    expect(blocked).toEqual([]);
    expect(paths.length).toBeGreaterThan(60);
  });

  it("keeps private pages and unknown addresses out", () => {
    for (const path of ["/workspace", "/data-quality", "/market/atlantis", "/variety/not-a-variety", "/nothing-here"]) expect(searchablePath(path), path).toBe(false);
  });
});

describe("search result descriptions", () => {
  it("keeps every page's description short enough for a results page (Kannada glyphs are wide)", async () => {
    const { SEO_PAGES, MARKETS_SEO, marketSeo, varietySeo } = await import("../services/seo-pages");
    const pages = [...SEO_PAGES, MARKETS_SEO, ...MARKET_PLACES.map(marketSeo), ...VARIETIES.map(varietySeo)];
    const tooLong = pages.filter((page) => page.kn.description.length > 130).map((page) => `${page.path} (${page.kn.description.length})`);
    expect(tooLong).toEqual([]);
  });
});

describe("social links", () => {
  it("links the official Instagram and X accounts from every page's footer, opening safely in a new tab", () => {
    const html = render(<AppShell />);
    expect(html).toContain('<a href="https://www.instagram.com/adike_naadi/" target="_blank" rel="noopener noreferrer" aria-label="Areca Pulse on Instagram, @adike_naadi (opens Instagram)"');
    expect(html).toContain('<a href="https://x.com/adikenaadi" target="_blank" rel="noopener noreferrer" aria-label="Areca Pulse on X, @adikenaadi (opens X)"');
    expect(html).toContain('<a href="https://www.youtube.com/@adikenaadi" target="_blank" rel="noopener noreferrer" aria-label="Areca Pulse on YouTube, @adikenaadi (opens YouTube)"');
  });

  it("names the same accounts in the structured data search engines read", () => {
    expect(readFileSync("frontend/index.html", "utf8")).toContain('"sameAs": ["https://www.instagram.com/adike_naadi/", "https://x.com/adikenaadi", "https://www.youtube.com/@adikenaadi"]');
  });
});

describe("icon scale", () => {
  it("draws every icon at a size from the brand scale, with the default stroke", () => {
    const files = (readdirSync("frontend/src", { recursive: true }) as string[]).filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"));
    const sizes = new Set<string>();
    for (const file of files) {
      const source = readFileSync(`frontend/src/${file}`, "utf8");
      for (const match of source.matchAll(/\bsize=\{(\d+)\}/g)) sizes.add(match[1]);
      expect(source, file).not.toMatch(/strokeWidth=\{/);
    }
    expect([...sizes].sort()).toEqual(["14", "16", "18", "24"]);
  });
});

describe("daily aggregates", () => {
  it("writes periods compactly for phones", () => {
    expect(shortPeriod("2026-11-02", "2026-11-08", MONTH_NAMES_EN, false)).toBe("2–8 Nov");
    expect(shortPeriod("2026-10-26", "2026-11-01", MONTH_NAMES_EN, false)).toBe("26 Oct – 1 Nov");
    expect(shortPeriod("2026-11-01", "2026-11-30", MONTH_NAMES_EN, true)).toBe("Nov 2026");
    expect(shortPeriod("2026-11-02", "2026-11-08", MONTH_NAMES_KN, false)).toBe("2–8 ನವೆಂಬರ್");
  });

  it("leaves out only the empty periods before the first captured day", () => {
    const rows = [0, 0, 2, 0, 3].map((reporting_days, index) => ({ period: String(index), reporting_days }));
    expect(fromFirstCapture(rows).map((row) => row.period)).toEqual(["2", "3", "4"]);
    expect(fromFirstCapture([{ reporting_days: 0 }])).toEqual([]);
  });
});

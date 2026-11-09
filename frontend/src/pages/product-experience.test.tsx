import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_CATALOG } from "../../../shared/commodities";
import { HomePage } from "./HomePage";
import { MarketDataPage } from "./CooperativeMarketPage";
import { ComparePage } from "./ComparePage";
import { AppShell } from "../components/AppShell";
import { PricesPage } from "./PricesPage";
import { readPage, readPreset, readSort, withoutFilters, withParams } from "../services/priceFilters";
import { NotFoundPage } from "./NotFoundPage";
import { LanguageContext } from "../services/language";
import { SourceSlot } from "../components/SourceSlot";
import { VARIETIES } from "../services/varieties";
import { ForecastShowcase } from "../components/ForecastShowcase";
import { PriceOutlook } from "../components/PriceOutlook";
import type { ModelEvaluation } from "../services/forecasting";
import { TSS_VARIETIES } from "../../../shared/tss-varieties";
import { AssistantPage } from "./AssistantPage";
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
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ImportsPanel } from "../components/ImportsPanel";
import { eventsBetween, MARKET_EVENTS } from "../services/market-events";

const state = vi.hoisted(() => ({
  cooperative: [] as object[],
  official: {} as object,
  comparison: [] as object[],
  cooperativePage: {} as object,
  intelligence: {} as object,
  language: "en" as "en" | "kn",
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, data: undefined, error: null }),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), removeQueries: vi.fn() }),
  // Market search suggestions load only after a search box is focused, which a static render never does.
  useQueries: ({ queries }: { queries: { queryKey: string[] }[] }) => queries[0]?.queryKey[0] === "market-suggestions" ? queries.map(() => ({ data: undefined })) : state.cooperative,
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "home-official-prices") return state.official;
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
    expect(html).toContain("LATEST PLATFORM FETCH");
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
    expect(text.split("\n").at(-1)).toBe("ದಿನದ ಅಡಿಕೆ ಧಾರಣೆ ನೋಡಿ: https://example.test/?v=rashi");
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
    expect(html).toContain("Likely between ₹43,048 and ₹51,301");
    expect(html).toContain("Most likely around ₹47,175 per quintal.");
    expect(html).toContain("1 of 2 months");
    expect(html).toContain("Outside range");
    expect(html).toContain("Outlook chart: 2 months");
  });
});

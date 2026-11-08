import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_CATALOG } from "../../../shared/commodities";
import { HomePage } from "./HomePage";
import { MarketDataPage } from "./CooperativeMarketPage";
import { ComparePage } from "./ComparePage";
import { AppShell } from "../components/AppShell";
import { PricesPage } from "./PricesPage";
import { readPage, readPreset, readSort, withoutFilters, withParams } from "../services/priceFilters";
import { NotFoundPage } from "./NotFoundPage";
import { VARIETIES } from "../services/varieties";
import { TSS_VARIETIES } from "../../../shared/tss-varieties";
import { AssistantPage } from "./AssistantPage";

const state = vi.hoisted(() => ({
  cooperative: [] as object[],
  official: {} as object,
  comparison: [] as object[],
  cooperativePage: {} as object,
  language: "en" as "en" | "kn",
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false, data: undefined, error: null }),
  useQueries: () => state.cooperative,
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "home-official-prices") return state.official;
    if (queryKey[0] === "varieties") return { data: ["Rashi"], isLoading: false };
    if (queryKey[0] === "market-comparison") return { data: { data: state.comparison }, isLoading: false };
    if (queryKey[0] === "cooperative") return state.cooperativePage;
    return { data: undefined, isLoading: false };
  },
}));
vi.mock("../services/commodity", () => ({
  useCommodity: () => ({ code: "arecanut", commodity: FALLBACK_CATALOG.commodities[0], catalog: FALLBACK_CATALOG, unit: "INR / QUINTAL" }),
}));
vi.mock("../services/language", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/language")>(),
  useLanguage: () => ({ language: state.language }),
}));
vi.mock("../components/LazyCharts", () => ({ LazyRangeChart: ({ rows }: { rows: { label: string }[] }) => <div>Same-date chart: {rows.map((row) => row.label).join(", ")}</div> }));

const quote = {
  id: "official-1", market_id: "one", market_name: "Market One", district: "District",
  variety_name: "Rashi", grade: "Grade A", reporting_date: "2026-10-01",
  source_name: "AGMARKNET", modal_price: 51000, minimum_price: 50000, maximum_price: 52000,
};
const ready = (data: object) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const failed = { isPending: false, isError: true, error: new Error("offline"), refetch: vi.fn() };
const cooperativeQuote = (source: string, branch: string, variety: string) => ({
  id: source, source_key: source, branch, variety, reporting_date: "2026-10-01",
  average_price: 48000, minimum_price: 47000, maximum_price: 49000,
  source_url: "https://example.test/", unit_status: "source_confirmed", fetched_at: "2026-10-01T10:00:00Z",
});
const render = (node: React.ReactNode, path = "/") => renderToStaticMarkup(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);

beforeEach(() => {
  state.cooperative = [failed, ready({ latest_by_branch: [], data: [] }), ready({ latest_by_branch: [], data: [] })];
  state.official = ready({ data: [quote] });
  state.comparison = [];
  state.language = "en";
  state.cooperativePage = ready({
    data: [], latest_by_branch: [], branches: [], varieties: [], series: [], counts: [], recent_fetches: [],
    publication: { awaiting_review_count: 2, blocked_reason: null, latest_archived_reporting_date: "2026-09-30" },
    last_fetch: { status: "succeeded", started_at: "2026-10-01T10:00:00Z" },
  });
});

describe("market experience", () => {
  it("reports a failed cooperative separately while showing dated official modal prices", () => {
    const html = render(<HomePage />);
    expect(html).toContain("Could not load the rates");
    expect(html).toContain("Market One");
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
    expect(html).toContain("Market One");
    expect(html).toContain("average per quintal");
    expect(html).toContain("modal price, ₹/quintal");
    expect(html).toContain("1 Oct 2026");
    expect(html).not.toContain("Could not load the rates");
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
    expect(html).not.toContain("No verified APMC prices are available yet.");
  });

  it("keeps the official feed selectable even when it has no published prices", () => {
    const html = render(<MarketDataPage official={<p>Official empty state</p>} />, "/prices?feed=official");
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

  it("keeps advanced routes in a disclosure and displays both navigation languages", () => {
    const english = render(<AppShell />);
    expect(english).toContain('aria-label="Areca Pulse · Market Intelligence"');
    expect(english).toContain('class="brand-icon"');
    expect(english).toContain("Market Intelligence");
    expect(english).toContain("Areca Pulse · Market Intelligence");
    expect(english).not.toContain("Arecanut Intelligence");
    expect(english).toContain("Explore prices");
    expect(english).toContain("More tools");
    expect(english).toContain('href="/data-quality"');
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

  it("marks untranslated pages as English and hides the duplicate search on the prices page", () => {
    state.language = "kn";
    const prices = render(<AppShell />, "/prices");
    expect(prices).toContain('class="page-content" lang="en"');
    expect(prices).not.toContain('role="search"');
    expect(prices).toContain("ಮುಖ್ಯ ವಿಷಯಕ್ಕೆ ಹೋಗಿ");
    const home = render(<AppShell />, "/analytics");
    expect(home).toContain('role="search"');
    expect(render(<AppShell />, "/")).not.toContain('class="page-content" lang="en"');
  });

  it("answers in the site language by default", () => {
    state.language = "kn";
    expect(render(<AssistantPage />, "/assistant")).toMatch(/<option value="kn" selected="">/);
    state.language = "en";
    expect(render(<AssistantPage />, "/assistant")).toMatch(/<option value="en" selected="">/);
  });

  it("lays the home price cards out in one grid with the comparison note after it", () => {
    const html = render(<HomePage />);
    expect(html).toContain('class="rate-grid"');
    const grid = html.slice(html.indexOf('class="rate-grid"'));
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
    expect(html).toContain("More varieties");
  });

  it("explains that fresh red arecanut is undried nut", () => {
    state.cooperative = [ready({ latest_by_branch: [], data: [] })];
    expect(render(<HomePage />, "/?v=fresh-red")).toContain("Fresh, undried nuts");
  });
});


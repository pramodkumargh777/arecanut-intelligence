import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_CATALOG } from "../../../shared/commodities";
import { HomePage } from "./HomePage";
import { MarketDataPage } from "./CooperativeMarketPage";
import { ComparePage } from "./ComparePage";
import { AppShell } from "../components/AppShell";

const state = vi.hoisted(() => ({
  cooperative: [] as object[],
  official: {} as object,
  comparison: [] as object[],
  cooperativePage: {} as object,
  language: "en" as "en" | "kn",
}));

vi.mock("@tanstack/react-query", () => ({
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
  source_url: "https://example.test/", unit_status: "source_confirmed",
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
    expect(html).toContain('href="/prices?feed=mamcos"');
    expect(html).toContain('href="/prices?feed=tss"');
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
});

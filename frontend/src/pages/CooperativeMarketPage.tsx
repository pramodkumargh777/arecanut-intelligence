import { lazy, Suspense, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api } from "../services/api";
import { downloadCsv } from "../services/csvDownload";
import { crossSectionSpread, DATE_PRESETS, describe, histogram, presetRange, rankSameDate, sortRows, type DatePreset, type SortDirection } from "../services/insights";
import { LazyBarChart, LazyRangeChart } from "../components/LazyCharts";
import { SourceLabel } from "../components/Scorecard";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import type { CooperativeCommodity, CooperativeQuote, CooperativeSource } from "../services/cooperative";
import { calendarTodayIST, formatCalendarDate, formatTimestampIST } from "../../../shared/dates";
import { capabilityStatus, marketFeeds, type MarketFeed } from "../../../shared/commodities";
import { useCommodity } from "../services/commodity";
import { IntelligenceScorecard } from "../components/Scorecard";
import { AboutData } from "../components/AboutData";
import { pageParam, readPage, readPreset, readSort, sortParams, withoutFilters, withParams } from "../services/priceFilters";

const PriceChart = lazy(() => import("../components/PriceChart").then((module) => ({ default: module.PriceChart })));
const money = (value: number | null | undefined) => value == null ? "Not reported" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
// Calculated statistics are shown to the rupee; source prices above keep what was published.
const rupees = (value: number | null | undefined) => value == null ? "—" : `₹${Math.round(value).toLocaleString("en-IN")}`;
const dateText = (value: string | null | undefined) => value ? formatCalendarDate(value) : "Unavailable";
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const modes: Record<string, { title: (commodity: string) => string; description: string }> = {
  "/overview": { title: (commodity) => `${commodity} market overview`, description: "Published cooperative branch quotations, with reporting dates and source evidence." },
  "/prices": { title: () => "Market prices", description: "Explore reviewed cooperative minimum, maximum and reported average prices." },
  "/analytics": { title: () => "Price analytics", description: "Source-specific daily medians of branch averages. Never mixed with official modal prices." },
  "/compare": { title: () => "Market comparison", description: "Compare cooperative branches for the same variety and date. Branches are not APMC market mappings." },
};
/** Rows per page in the observation table. */
const PAGE_SIZE = 25;
const QUOTE_SORT_KEYS = ["branch", "reporting_date", "minimum_price", "average_price", "maximum_price"] as const;
const DEFAULT_QUOTE_SORT = { key: "reporting_date", direction: "desc" } as const;

const feedLabels: Record<MarketFeed, string> = {
  mamcos: "MAMCOS · Cooperative branch averages", tss: "TSS · Tender averages",
  tumcos: "TUMCOS · Channagiri averages", official: "AGMARKNET · Official modal prices",
};
const feedCapability = { mamcos: "cooperative_mamcos", tss: "cooperative_tss", tumcos: "cooperative_tumcos", official: "daily_prices" } as const;

export function MarketDataPage({ official }: { official: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const { commodity } = useCommodity();
  const feeds = marketFeeds(commodity);
  const requestedFeed = params.get("feed");
  const feed = requestedFeed || feeds[0] || "";
  const supported = (feeds as string[]).includes(feed);
  const name = commodity?.display_name ?? "the selected commodity";
  return <div className="page-stack">
    <section className="filter-bar source-bar" aria-label="Market data source"><label className="filter-control"><span>Source</span>
      <select value={supported ? feed : ""} onChange={(event) => {
        setParams(withParams(withoutFilters(params, ["variety"]), { feed: event.target.value }));
      }}><option value="" disabled>Select a supported source</option>{feeds.map((value) => <option key={value} value={value}>{feedLabels[value]}{capabilityStatus(commodity, feedCapability[value]) === "unpublished" ? " · unpublished" : ""}</option>)}</select>
    </label></section>
    {!supported ? <ErrorState error={new Error(`Unsupported market-data source for ${name}. Select one of: ${feeds.map((value) => feedLabels[value].split(" · ")[0]).join(", ")}.`)} /> : feed === "official" ? official : <CooperativeMarketPage key={`${location.pathname}:${feed}:${commodity?.code}`} source={feed === "tss" || feed === "tumcos" ? feed : "mamcos"} />}
  </div>;
}

type QuoteSortKey = typeof QUOTE_SORT_KEYS[number];
type QuoteSort = { key: QuoteSortKey; direction: SortDirection };

/** Row-level checks shown as text chips; they describe the published quote, they do not alter it. */
function quoteQuality(row: CooperativeQuote): { label: string; ok: boolean | null }[] {
  const ordered = row.minimum_price === null || row.maximum_price === null || row.average_price === null ? null
    : row.minimum_price <= row.average_price && row.average_price <= row.maximum_price;
  return [
    { label: ordered === null ? "Range incomplete" : ordered ? "Min ≤ avg ≤ max" : "Range inconsistent", ok: ordered },
    { label: row.unit_status === "source_confirmed" ? "Unit confirmed" : "Unit assumed", ok: row.unit_status === "source_confirmed" ? true : null },
  ];
}

function SortHeader({ label, column, sort, onSort, numeric }: { label: string; column: QuoteSortKey; sort?: QuoteSort; onSort?: (key: QuoteSortKey) => void; numeric?: boolean }) {
  const active = sort?.key === column;
  if (!onSort) return <th scope="col" className={numeric ? "numeric" : undefined}>{label}</th>;
  return <th scope="col" className={numeric ? "numeric" : undefined} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
    <button type="button" className="sort-button" onClick={() => onSort(column)}>{label}<span aria-hidden="true">{active ? (sort.direction === "asc" ? " ▲" : " ▼") : " ↕"}</span></button></th>;
}

function QuoteTable({ rows, sort, onSort }: { rows: CooperativeQuote[]; sort?: QuoteSort; onSort?: (key: QuoteSortKey) => void }) {
  const source = rows[0]?.source_key ?? "mamcos";
  const tss = source === "tss";
  const sourceName = source.toUpperCase();
  return <div className="table-scroll" tabIndex={0} role="region" aria-label="Cooperative quotations"><table>
    <caption>{sourceName} published quotations · {rows[0]?.price_unit ?? "INR/quintal"}{rows[0]?.unit_status === "assumed" ? " — operator assumption" : ""} · Average is not modal price</caption>
    <thead><tr><SortHeader label="Branch" column="branch" sort={sort} onSort={onSort} /><SortHeader label="Reporting date" column="reporting_date" sort={sort} onSort={onSort} /><th scope="col">Exact variety</th>
      <SortHeader label="Minimum" column="minimum_price" sort={sort} onSort={onSort} numeric /><SortHeader label="Average" column="average_price" sort={sort} onSort={onSort} numeric /><SortHeader label="Maximum" column="maximum_price" sort={sort} onSort={onSort} numeric />
      {tss && <th scope="col" className="numeric">Normal rate</th>}<th scope="col">Quality</th><th scope="col">Source / fetched at</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.id}><td className="table-market">{row.branch}</td><td>{formatCalendarDate(row.reporting_date)}</td><td>{row.variety}</td>
      <td className="numeric">{money(row.minimum_price)}</td><td className="numeric table-price">{money(row.average_price)}</td><td className="numeric">{money(row.maximum_price)}</td>
      {tss && <td className="numeric">{money(row.normal_price)}</td>}
      <td><span className="quality-chips">{quoteQuality(row).map((check) => <span key={check.label} className={`status-pill tone-${check.ok === null ? "neutral" : check.ok ? "good" : "warn"}`}>{check.label}</span>)}</span></td>
      <td><a href={row.source_url} target="_blank" rel="noreferrer">{sourceName}</a><small className="quote-fetch">Platform fetched: {formatTimestampIST(row.fetched_at)}</small></td></tr>)}</tbody>
  </table></div>;
}

function CooperativeMarketPage({ source }: { source: CooperativeSource }) {
  const sourceName = source.toUpperCase();
  const assumedUnit = source !== "mamcos";
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const { code, commodity: commodityDef } = useCommodity();
  // Only commodities with a cooperative capability reach this page (see marketFeeds); the API rejects anything else.
  const commodity = code as CooperativeCommodity;
  // Filters, sort, page and comparison date live in the URL so reloads, shared links and Back keep them.
  const branch = params.get("branch") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const comparisonDate = params.get("date") ?? "";
  const page = readPage(params);
  const sort: QuoteSort = readSort(params, QUOTE_SORT_KEYS, DEFAULT_QUOTE_SORT);
  const preset = readPreset(params);
  /** Applies filter changes; any change other than paging returns to the first page. */
  const update = (changes: Record<string, string | number | null>) => setParams(withParams(params, { page: null, ...changes }), { replace: true });
  const [chartBranch, setChartBranch] = useState("");
  const selected = params.get("variety") ?? "";
  // Only the observation table honours a custom range; the API keeps headline values anchored to the latest date.
  const range = location.pathname === "/prices" && !(from && to && from > to) ? { from, to } : {};
  const query = useQuery({ queryKey: ["cooperative", source, commodity, selected, range.from ?? "", range.to ?? ""], queryFn: () => api.cooperativePrices(source, selected || undefined, commodity, range), refetchInterval: 60_000 });
  const mode = modes[location.pathname] ?? modes["/overview"];
  const data = query.data;
  const coverage = data?.minimum_branch_coverage ?? 3;
  const rows = data?.data ?? [];
  const branches = [...new Set(rows.map((row) => row.branch))].sort();
  // The first branch alphabetically is charted until the reader picks one.
  const selectedChartBranch = branches.includes(chartBranch) ? chartBranch : branches[0] ?? "";
  const quotePoints = rows.flatMap((row) => row.branch === selectedChartBranch && row.average_price !== null
    ? [{ reporting_date: row.reporting_date, average_price: row.average_price }] : []);
  const dates = [...new Set(rows.map((row) => row.reporting_date))].sort().reverse();
  const selectedDate = comparisonDate || data?.latest_reporting_date || "";
  const search = params.get("search")?.trim().toLowerCase() ?? "";
  const filtered = sortRows(rows.filter((row) => (!branch || row.branch === branch) && (!from || row.reporting_date >= from)
    && (!to || row.reporting_date <= to) && (!search || `${row.branch} ${row.variety}`.toLowerCase().includes(search))), (row) => row[sort.key], sort.direction);
  const activePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const comparison = rows.filter((row) => row.reporting_date === selectedDate).sort((a, b) => (b.average_price ?? 0) - (a.average_price ?? 0));
  const ranked = rankSameDate(rows, (row) => row.average_price === null ? null : { key: String(row.id), label: row.branch, detail: row.variety, reporting_date: row.reporting_date, minimum: row.minimum_price, central: row.average_price, maximum: row.maximum_price }, selectedDate);
  const comparedBranches = new Set(comparison.map((row) => row.branch)).size;
  // Cross-branch spread per reporting date: only dates with at least two reporting branches carry a spread.
  const spreadByDate = dates.slice().reverse().map((date) => ({ date, ...crossSectionSpread(rows.filter((row) => row.reporting_date === date).map((row) => row.average_price)) })).filter((point) => point.count >= 2);
  const averageDistribution = describe(rows.map((row) => row.average_price));
  const averageBins = histogram(rows.flatMap((row) => row.average_price === null ? [] : [row.average_price]), 8);
  function toggleSort(key: QuoteSortKey) {
    const next: QuoteSort = sort.key === key ? { key, direction: sort.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "branch" ? "asc" : "desc" };
    update(sortParams(next, DEFAULT_QUOTE_SORT));
  }
  function applyPreset(value: DatePreset) {
    const range = presetRange(value, calendarTodayIST());
    const period = value === "all" ? null : value;
    if (range) update({ period, from: range.from, to: range.to });
    else if (value === "all") update({ period, from: null, to: null });
    else update({ period });
  }
  const series = data?.series ?? [];
  const current = series.find((point) => point.reporting_date === data?.latest_reporting_date);
  const benchmark = series.at(-1);
  const previous = series.filter((point) => point.reporting_date < (data?.latest_reporting_date ?? "")).at(-1);
  const sameBranches = Boolean(current && previous && JSON.stringify(current.branches) === JSON.stringify(previous.branches));
  const delta = sameBranches && current && previous ? current.median_average_price - previous.median_average_price : null;
  const awaitingReview = data?.publication.awaiting_review_count ?? 0;
  const benchmarkValues = series.map((point) => point.median_average_price);
  // A source with fewer locations than the coverage rule (TUMCOS reports one) cannot form a benchmark, so its own series is charted.
  const singleLocation = (data?.branches.length ?? 0) < coverage;
  // When the newest date lacks coverage, show the latest qualifying benchmark; the card states that date.
  const headlinePrice = data?.reference_price ?? (singleLocation ? comparison[0]?.average_price : series.at(-1)?.median_average_price);
  const latestBranches = (data?.latest_by_branch ?? []).filter((row) => row.reporting_date === data?.latest_reporting_date);
  const missingBranches = (data?.branches ?? []).filter((name) => !(data?.latest_by_branch ?? []).some((row) => row.branch === name));
  const periodMean = benchmarkValues.length ? benchmarkValues.reduce((sum, value) => sum + value, 0) / benchmarkValues.length : null;
  const dispersion = periodMean === null ? null : Math.sqrt(benchmarkValues.reduce((sum, value) => sum + (value - periodMean) ** 2, 0) / benchmarkValues.length);
  function exportRows() {
    const exportData = location.pathname === "/compare" ? comparison : filtered;
    downloadCsv([["source", "branch", "reporting_date", "variety", "minimum_price", "average_price", "maximum_price", "normal_price", "price_type", "price_unit", "unit_status", "source_url", "fetched_at"],
      ...exportData.map((row) => [row.source_key, row.branch, row.reporting_date, row.variety, row.minimum_price, row.average_price, row.maximum_price, row.normal_price, row.price_type, row.price_unit, row.unit_status, row.source_url, row.fetched_at])], `areca-pulse-${source}-branch-prices.csv`);
  }
  return <div className="page-stack">
    <section className="page-heading"><div><h1>{mode.title(commodityDef?.display_name ?? "Market")}</h1><p>{mode.description}</p>
      <p className="page-meta">{sourceName} branch averages · ₹/quintal{assumedUnit ? " (unit assumed)" : ""} · not APMC modal prices</p></div>
      <label className="filter-control"><span>Exact reported variety</span><select value={data?.variety ?? ""} disabled={!data?.varieties.length} onChange={(event) => {
        update({ variety: event.target.value, date: null });
      }}>{!data?.varieties.length && <option>No published varieties</option>}{data?.varieties.map((variety) => <option key={variety}>{variety}</option>)}</select></label>
    </section>
    {location.pathname === "/overview" && <IntelligenceScorecard feed={source} variety={selected} />}
    {query.isPending ? <LoadingState label="Loading cooperative quotations" /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : !rows.length ? <EmptyState title="No reviewed cooperative quotations in this selection">
      {data?.publication.blocked_reason ? <>{data.publication.blocked_reason} {data.publication.latest_archived_reporting_date ? `Latest archived market reporting date: ${data.publication.latest_archived_reporting_date}.` : "No reporting dates archived yet."} </> : null}
      <Link to="/data-quality">Fetch and review {sourceName} quotations in Data quality</Link>. {awaitingReview > 0 ? `${awaitingReview} quotations for this source and commodity await review.` : "Nothing is substituted for missing prices."}
    </EmptyState> : <>
      {location.pathname === "/overview" && <>
        <section className="snapshot-grid" aria-label="Cooperative snapshot">
          <article className="snapshot-card featured-card"><div className="card-kicker">{singleLocation ? "LATEST REPORTED AVERAGE" : "BRANCH-AVERAGE BENCHMARK"} · {data?.variety}</div><div className="snapshot-value">{money(headlinePrice)}<small>/ quintal</small></div>{singleLocation ? <p>{dateText(data?.latest_reporting_date)} · {comparison[0]?.branch ?? "one location"}</p> : <p>{benchmark ? `${dateText(benchmark.reporting_date)} · ${plural(benchmark.branch_count, "branch", "branches")}` : "No date has enough branches yet"}</p>}{!singleLocation && benchmark && benchmark.reporting_date !== data?.latest_reporting_date && <p>Newer reports on {dateText(data?.latest_reporting_date)} come from {plural(comparison.length, "branch", "branches")}, below the {coverage}-branch rule.</p>}</article>
          <article className="snapshot-card"><div className="card-kicker">{singleLocation ? "REPORTED AVERAGES" : "BRANCHES REPORTING"}</div><div className="snapshot-value">{singleLocation ? rows.length : comparison.length}</div><p>{singleLocation ? `Published for ${data?.variety} so far` : `${dateText(data?.latest_reporting_date)} · ${coverage} needed for a benchmark`}</p></article>
          {singleLocation ? <>
            <article className="snapshot-card"><div className="card-kicker">DAY'S MINIMUM</div><div className="snapshot-value">{money(comparison[0]?.minimum_price)}</div><p>{comparison[0]?.branch} · {dateText(data?.latest_reporting_date)}</p></article>
            <article className="snapshot-card"><div className="card-kicker">DAY'S MAXIMUM</div><div className="snapshot-value">{money(comparison[0]?.maximum_price)}</div><p>{comparison[0]?.branch} · {dateText(data?.latest_reporting_date)}</p></article>
          </> : <>
            <article className="snapshot-card"><div className="card-kicker">HIGHEST AVERAGE</div><div className="snapshot-value">{money(comparison[0]?.average_price)}</div><p>{comparison[0]?.branch} · {dateText(data?.latest_reporting_date)}</p></article>
            <article className="snapshot-card"><div className="card-kicker">LOWEST AVERAGE</div><div className="snapshot-value">{money(comparison.at(-1)?.average_price)}</div><p>{comparison.at(-1)?.branch} · {dateText(data?.latest_reporting_date)}</p></article>
          </>}
        </section>
        <section className="panel"><div className="panel-heading"><div><h2>Market pulse</h2><p>Observed facts, not a forecast or causal explanation</p></div></div><div className="monthly-details">
          <p>{data?.variety}: {plural(comparison.length, "branch", "branches")} reported on {dateText(data?.latest_reporting_date)}. {singleLocation ? `The reported average is ${money(headlinePrice)} per quintal.` : data?.reference_price !== null ? `The median of their reported averages is ${money(data?.reference_price)} per quintal.` : benchmark ? `That is below the ${coverage}-branch rule, so the latest benchmark is ${money(benchmark.median_average_price)} from ${dateText(benchmark.reporting_date)}.` : `No date has reached the ${coverage}-branch rule yet.`}</p>
          {delta !== null ? <p>The comparable branch-set median changed by {money(delta)} from {dateText(previous?.reporting_date)}.</p> : <p>A like-for-like price-change claim is withheld: branch constituents differ between dates or comparable history is insufficient.</p>}
        </div></section>
        <section>
          <article className="panel table-panel"><div className="panel-heading"><div><h2>Branch coverage</h2><p>{latestBranches.length} of {plural(data?.branches.length ?? 0, "branch", "branches")} reported {data?.variety} on {data?.latest_reporting_date ? formatCalendarDate(data.latest_reporting_date) : "the latest date"} · latest report per branch</p></div></div>
            <div className="coverage-meter" role="img" aria-label={`${latestBranches.length} of ${data?.branches.length ?? 0} branches on the latest reporting date`}><span style={{ width: `${data?.branches.length ? latestBranches.length / data.branches.length * 100 : 0}%` }} /></div>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Branch coverage"><table><caption className="sr-only">Latest published report per branch for {data?.variety}</caption>
              <thead><tr><th scope="col">Branch</th><th scope="col">Latest reporting date</th><th scope="col" className="numeric">Reported average</th><th scope="col">Status</th></tr></thead>
              <tbody>{(data?.latest_by_branch ?? []).map((row) => {
                const lag = data?.latest_reporting_date ? Math.round((Date.parse(data.latest_reporting_date) - Date.parse(row.reporting_date)) / 86_400_000) : null;
                return <tr key={row.branch}><td className="table-market">{row.branch}</td><td>{formatCalendarDate(row.reporting_date)}</td><td className="numeric">{money(row.average_price)}</td>
                  <td>{lag === 0 ? <span className="status-pill tone-good">Latest date</span> : <span className="status-pill tone-neutral">{lag} day{lag === 1 ? "" : "s"} earlier</span>}</td></tr>;
              })}</tbody></table></div>
            {missingBranches.length > 0 && <p className="panel-note">No {data?.variety} report in the current window: {missingBranches.join(", ")}.</p>}
          </article>
        </section>
      </>}
      {location.pathname === "/analytics" && !singleLocation && <section className="snapshot-grid" aria-label="Cooperative analytics summary">
        <article className="snapshot-card"><div className="card-kicker">QUALIFYING DAILY OBSERVATIONS</div><div className="snapshot-value">{series.length}</div><p>Dates meeting the {coverage}-branch minimum</p></article>
        <article className="snapshot-card"><div className="card-kicker">PERIOD AVERAGE</div><div className="snapshot-value">{rupees(periodMean)}</div><p>Arithmetic mean of published daily medians</p></article>
        <article className="snapshot-card"><div className="card-kicker">PERIOD HIGH / LOW</div><div className="snapshot-value">{rupees(benchmarkValues.length ? Math.max(...benchmarkValues) : null)}</div><p>Low: {rupees(benchmarkValues.length ? Math.min(...benchmarkValues) : null)}</p></article>
        <article className="snapshot-card"><div className="card-kicker">PRICE DISPERSION</div><div className="snapshot-value">{rupees(dispersion)}</div><p>Population standard deviation, not forecast uncertainty</p></article>
      </section>}
      {(location.pathname === "/overview" || location.pathname === "/analytics") && <section className="panel"><div className="panel-heading"><div><h2>{sourceName} {singleLocation ? "reported-average history" : "branch-average benchmark"}</h2><p>{singleLocation ? "One location and exact variety. Not a benchmark or forecast." : `${plural(series.length, "qualifying reporting date")} · At least ${coverage} branches per date · Constituent coverage varies`}</p></div>
        {singleLocation && <label className="filter-control"><span>Chart location</span><select value={selectedChartBranch} onChange={(event) => setChartBranch(event.target.value)}>{branches.map((value) => <option key={value}>{value}</option>)}</select></label>}</div>
        {singleLocation ? <div className="monthly-details"><Suspense fallback={<LoadingState />}><PriceChart label={`${sourceName} · ${selectedChartBranch} · ${data?.variety} · Reported average`} quotePoints={quotePoints} unitNote={assumedUnit ? " — operator assumption" : undefined} /></Suspense></div>
          : !series.length ? <EmptyState title="Insufficient same-date branch coverage" /> : <div className="monthly-details"><Suspense fallback={<LoadingState />}><PriceChart label={`${sourceName} branch-average benchmark`} averagePoints={series} showStats={location.pathname !== "/analytics"} unitNote={assumedUnit ? " — operator assumption" : undefined} /></Suspense>
          <details><summary>Constituent branches by date</summary>{series.map((point) => <p key={point.reporting_date}>{dateText(point.reporting_date)}: {point.branches.join(", ")}</p>)}</details></div>}
      </section>}
      {location.pathname === "/analytics" && <section className="chart-grid">
        <article className="panel chart-panel"><div className="panel-heading"><div><h2>Cross-branch spread</h2><p>Highest minus lowest reported average among branches on the same date · dates with ≥2 branches</p></div></div>
          {!spreadByDate.length ? <EmptyState title="No date has two or more reporting branches" /> : <LazyBarChart categories={spreadByDate.map((point) => formatCalendarDate(point.date))} values={spreadByDate.map((point) => point.spread)} name="Branch spread" description={`${sourceName} cross-branch average spread by reporting date`} />}
          <div className="chart-foot"><SourceLabel>{sourceName} · reported averages{assumedUnit ? " · INR/quintal by operator assumption" : ""}</SourceLabel></div></article>
        <article className="panel chart-panel"><div className="panel-heading"><div><h2>Price distribution</h2><p>{averageDistribution.count} published branch averages in the current window · not a forecast range</p></div></div>
          {!averageBins.length ? <EmptyState title="No published averages" /> : <LazyBarChart categories={averageBins.map((bin) => `₹${(bin.from / 1000).toFixed(1)}k`)} tooltipLabels={averageBins.map((bin) => `${rupees(bin.from)} – ${rupees(bin.to)}`)} values={averageBins.map((bin) => bin.count)} name="Observations" valueFormat="count" description={`${sourceName} distribution of branch averages`} />}
          <dl className="fact-list compact"><div><dt>Median</dt><dd>{rupees(averageDistribution.median)}</dd></div><div><dt>Interquartile range</dt><dd>{rupees(averageDistribution.q1)} – {rupees(averageDistribution.q3)}</dd></div><div><dt>Coefficient of variation</dt><dd>{averageDistribution.cvPercent === null ? "—" : `${averageDistribution.cvPercent.toFixed(1)}%`}</dd></div></dl>
          <div className="chart-foot"><SourceLabel>{sourceName} · {data?.window ? `${formatCalendarDate(data.window.from)} – ${formatCalendarDate(data.window.to)}` : "current window"}</SourceLabel></div></article>
        <p className="panel-note chart-wide">Seasonal and year-on-year analysis needs multi-year history: see <Link to="/history">Historical analytics</Link> (AGMARKNET monthly series, a different price basis).</p>
      </section>}
      {location.pathname === "/prices" && <section className="filter-bar">
        <label className="filter-control"><span>Branch</span><select value={branch} onChange={(event) => update({ branch: event.target.value })}><option value="">All branches</option>{(data?.branches ?? [...new Set(rows.map((row) => row.branch))].sort()).map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="filter-control"><span>Search branch or variety</span><input type="search" value={params.get("search") ?? ""} placeholder="e.g. Sagara" onChange={(event) => update({ search: event.target.value })} /></label>
        <button className="button-secondary" onClick={() => setParams(withoutFilters(params), { replace: true })}>Reset filters</button>
        <details className="advanced-filters">
        <summary>More filters{from || to ? " · active" : ""}</summary>
        <div className="advanced-filter-fields">
        <label className="filter-control"><span>Reporting period</span><select value={preset} onChange={(event) => applyPreset(event.target.value as DatePreset)}>{DATE_PRESETS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="filter-control"><span>From</span><input type="date" value={from} max={to || undefined} onChange={(event) => update({ from: event.target.value, period: "custom" })} /></label>
        <label className="filter-control"><span>To</span><input type="date" value={to} min={from || undefined} onChange={(event) => update({ to: event.target.value, period: "custom" })} /></label>
        </div></details>
      </section>}
      {location.pathname === "/compare" && <section className="filter-bar"><label className="filter-control"><span>Same reporting date</span><select value={selectedDate} onChange={(event) => update({ date: event.target.value })}>{dates.map((date) => <option key={date} value={date}>{formatCalendarDate(date)}</option>)}</select></label><span>Ranked by average, highest first. Other reporting dates are excluded. {comparedBranches} of {data?.branches.length ?? 0} branches reported on this date.</span></section>}
      {location.pathname === "/compare" && <section className="panel chart-panel"><div className="panel-heading"><div><h2>Ranked branch range</h2><p>{formatCalendarDate(selectedDate)} · {data?.variety} · Bar shows minimum–maximum, marker shows the reported average{assumedUnit ? " · INR/quintal by operator assumption" : ""}</p></div></div>
        {!ranked.length ? <EmptyState title="No branch averages on this date" /> : <LazyRangeChart rows={ranked.map((row) => ({ label: row.label, detail: row.detail, minimum: row.minimum, central: row.central, maximum: row.maximum }))} centralLabel="Reported average" description={`${sourceName} branch ranges for ${data?.variety} on ${selectedDate}`} />}
        <div className="chart-foot"><SourceLabel>{sourceName} · cooperative reported averages · {formatCalendarDate(selectedDate)}</SourceLabel></div>
      </section>}
      {from && to && from > to ? <ErrorState error={new Error("From date must not be after To date.")} /> : <section className="panel table-panel">
        <div className="panel-heading"><div><h2>{location.pathname === "/compare" ? "Same-date branch comparison" : "Published branch observations"}</h2><p>{plural(location.pathname === "/compare" ? comparison.length : filtered.length, "matching observation")} · Reported averages, not modal prices{data?.window && <> · Reporting window {formatCalendarDate(data.window.from)} – {formatCalendarDate(data.window.to)}{data.window.truncated ? ` (latest ${data.window.row_limit.toLocaleString("en-IN")} rows only; narrow the date range to see the rest)` : ""}</>}</p></div>
          <button className="button-secondary" onClick={exportRows} disabled={!(location.pathname === "/compare" ? comparison : filtered).length}>Export matching CSV</button></div>
        {!(location.pathname === "/compare" ? comparison : filtered).length ? <EmptyState title="No quotations match these filters" /> : <QuoteTable rows={location.pathname === "/compare" ? comparison : filtered.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE)} sort={location.pathname === "/compare" ? undefined : sort} onSort={location.pathname === "/compare" ? undefined : toggleSort} />}
        {location.pathname !== "/compare" && filtered.length > PAGE_SIZE && <div className="pagination"><span>Page {activePage + 1} of {Math.ceil(filtered.length / PAGE_SIZE)}</span><div><button className="button-secondary" disabled={!activePage} onClick={() => update({ page: pageParam(activePage - 1) })}>Previous</button><button className="button-secondary" disabled={(activePage + 1) * PAGE_SIZE >= filtered.length} onClick={() => update({ page: pageParam(activePage + 1) })}>Next</button></div></div>}
      </section>}
    </>}
    <AboutData>
      <p>{data?.methodology}</p>
      {(data?.benchmark_conflicts?.length ?? 0) > 0 && <p role="note">Left out of the benchmark because verified prices disagree: {data!.benchmark_conflicts.map((conflict) => `${conflict.branch} on ${conflict.reporting_date} (${conflict.prices.join(", ")})`).join("; ")}.</p>}
      <dl className="fact-list">
      <div><dt>Price type</dt><dd>Cooperative reported average (not APMC modal)</dd></div>
      <div><dt>Unit</dt><dd>{assumedUnit ? "INR/quintal (operator assumption)" : "INR/quintal (source-confirmed)"}</dd></div>
      <div><dt>Coverage rule</dt><dd>At least {coverage} branches on the same reporting date</dd></div>
      <div><dt>Latest constituents</dt><dd>{benchmark ? `${benchmark.branches.join(", ")} (${formatCalendarDate(benchmark.reporting_date)})` : "No qualifying date"}</dd></div>
      <div><dt>Market reporting date</dt><dd>{data?.latest_reporting_date ? formatCalendarDate(data.latest_reporting_date) : "Unavailable"}</dd></div>
      <div><dt>Source publication time</dt><dd>Not supplied by this source</dd></div>
      <div><dt>Last platform fetch</dt><dd>{data?.last_fetch ? `${data.last_fetch.status} · ${formatTimestampIST(data.last_fetch.started_at)}` : "Never"}</dd></div>
      <div><dt>Reporting dates</dt><dd>Kept per branch</dd></div>
      <div><dt>Variety names</dt><dd>As published by {sourceName}; no aliases merged</dd></div>
      <div><dt>Source permission</dt><dd>{data?.permission?.label ?? "Not recorded"}</dd></div>
      </dl>
      {data && <><p>Source supported · {data.last_fetch ? `Last retrieval: ${data.last_fetch.status} (${formatTimestampIST(data.last_fetch.started_at)})` : "No retrieval recorded"} · {awaitingReview} awaiting review across this source and commodity.</p><p>{rows.length ? "Published observations are available for this selection." : "No published observations in this selection and reporting window."}{data.publication.latest_archived_reporting_date ? ` Latest archived reporting date: ${formatCalendarDate(data.publication.latest_archived_reporting_date)}.` : ""}</p></>}
      {data?.last_fetch?.error_message && <p>Last fetch error: {data.last_fetch.error_message}</p>}
      {assumedUnit && <details><summary>Recent location fetches</summary>{data?.recent_fetches.map((run) => <p key={`${run.source_url}:${run.started_at}`}><a href={run.source_url} target="_blank" rel="noreferrer">Source request</a> · {run.status} · {formatTimestampIST(run.started_at)} · {run.received_count ?? "Unknown"} rows · {run.excluded_count} excluded{run.error_message && <span role="alert"> · {run.error_message}</span>}</p>)}</details>}
      <p>These are the observations available in captured source snapshots, not a complete historical archive. A new fetch does not make an older quotation current.</p>
      <Link to="/data-quality">Inspect validation, source evidence and refresh controls</Link>
    </AboutData>
  </div>;
}

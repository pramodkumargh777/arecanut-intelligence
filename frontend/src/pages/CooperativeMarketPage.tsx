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

const PriceChart = lazy(() => import("../components/PriceChart").then((module) => ({ default: module.PriceChart })));
const money = (value: number | null | undefined) => value == null ? "Not reported" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const modes: Record<string, { title: string; description: string }> = {
  "/": { title: "Arecanut market overview", description: "Published cooperative branch quotations, with reporting dates and source evidence." },
  "/prices": { title: "Market prices", description: "Explore reviewed cooperative minimum, maximum and reported average prices." },
  "/analytics": { title: "Price analytics", description: "Source-specific daily medians of branch averages. Never mixed with official modal prices." },
  "/compare": { title: "Market comparison", description: "Compare cooperative branches for the same variety and date. Branches are not APMC market mappings." },
};

const feedLabels: Record<MarketFeed, string> = {
  mamcos: "MAMCOS · Cooperative branch averages", tss: "TSS · Averages (unit assumed)",
  tumcos: "TUMCOS · Channagiri averages (unit unconfirmed)", official: "AGMARKNET · Official modal prices",
};
const feedCapability = { mamcos: "cooperative_mamcos", tss: "cooperative_tss", tumcos: "cooperative_tumcos", official: "daily_prices" } as const;

export function MarketDataPage({ official }: { official: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const { commodity } = useCommodity();
  const feeds = marketFeeds(commodity);
  const feed = params.get("feed") ?? feeds[0] ?? "";
  const supported = (feeds as string[]).includes(feed);
  const name = commodity?.display_name ?? "the selected commodity";
  return <div className="page-stack">
    <section className="filter-bar" aria-label="Market data source"><label className="filter-control"><span>Data source / price type</span>
      <select value={supported ? feed : ""} onChange={(event) => {
        const next = new URLSearchParams(params); next.set("feed", event.target.value); next.delete("variety"); setParams(next);
      }}><option value="" disabled>Select a supported source</option>{feeds.map((value) => <option key={value} value={value}>{feedLabels[value]}{capabilityStatus(commodity, feedCapability[value]) === "unpublished" ? " · unpublished" : ""}</option>)}</select>
    </label><span>Separate sources, varieties and benchmark methodologies.</span></section>
    {!supported ? <ErrorState error={new Error(`Unsupported market-data source for ${name}. Select one of: ${feeds.map((value) => feedLabels[value].split(" · ")[0]).join(", ")}.`)} /> : feed === "official" ? official : <CooperativeMarketPage key={`${location.pathname}:${feed}:${commodity?.code}`} source={feed === "tss" || feed === "tumcos" ? feed : "mamcos"} />}
  </div>;
}

type QuoteSortKey = "branch" | "reporting_date" | "minimum_price" | "average_price" | "maximum_price";
type QuoteSort = { key: QuoteSortKey; direction: SortDirection };

/** Row-level checks shown as text chips; they describe the published quote, they do not alter it. */
function quoteQuality(row: CooperativeQuote): { label: string; ok: boolean | null }[] {
  const ordered = row.minimum_price === null || row.maximum_price === null || row.average_price === null ? null
    : row.minimum_price <= row.average_price && row.average_price <= row.maximum_price;
  return [
    { label: ordered === null ? "Range incomplete" : ordered ? "Min ≤ avg ≤ max" : "Range inconsistent", ok: ordered },
    { label: row.unit_status === "source_confirmed" ? "Unit confirmed" : "Unit assumed", ok: row.unit_status === "source_confirmed" },
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
    <caption>{sourceName} published quotations · {rows[0]?.price_unit ?? "INR/quintal"}{rows[0] && rows[0].unit_status !== "source_confirmed" ? " — unit not source-confirmed" : ""} · Average is not modal price</caption>
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
  const { code } = useCommodity();
  // Only commodities with a cooperative capability reach this page (see marketFeeds); the API rejects anything else.
  const commodity = code as CooperativeCommodity;
  const [branch, setBranch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [comparisonDate, setComparisonDate] = useState("");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<QuoteSort>({ key: "reporting_date", direction: "desc" });
  const [preset, setPreset] = useState<DatePreset>("all");
  const [chartBranch, setChartBranch] = useState("Sirsi");
  const selected = params.get("variety") ?? "";
  // Only the observation table honours a custom range; the API keeps headline values anchored to the latest date.
  const range = location.pathname === "/prices" && !(from && to && from > to) ? { from, to } : {};
  const query = useQuery({ queryKey: ["cooperative", source, commodity, selected, range.from ?? "", range.to ?? ""], queryFn: () => api.cooperativePrices(source, selected || undefined, commodity, range), refetchInterval: 60_000 });
  const mode = modes[location.pathname] ?? modes["/"];
  const data = query.data;
  const coverage = data?.minimum_branch_coverage ?? 3;
  const rows = data?.data ?? [];
  const branches = [...new Set(rows.map((row) => row.branch))].sort();
  const selectedChartBranch = branches.includes(chartBranch) ? chartBranch : branches[0] ?? "";
  const quotePoints = rows.flatMap((row) => row.branch === selectedChartBranch && row.average_price !== null
    ? [{ reporting_date: row.reporting_date, average_price: row.average_price }] : []);
  const dates = [...new Set(rows.map((row) => row.reporting_date))].sort().reverse();
  const selectedDate = comparisonDate || data?.latest_reporting_date || "";
  const search = params.get("search")?.trim().toLowerCase() ?? "";
  const filtered = sortRows(rows.filter((row) => (!branch || row.branch === branch) && (!from || row.reporting_date >= from)
    && (!to || row.reporting_date <= to) && (!search || `${row.branch} ${row.variety}`.toLowerCase().includes(search))), (row) => row[sort.key], sort.direction);
  const activePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 25) - 1));
  const comparison = rows.filter((row) => row.reporting_date === selectedDate).sort((a, b) => (b.average_price ?? 0) - (a.average_price ?? 0));
  const ranked = rankSameDate(rows, (row) => row.average_price === null ? null : { key: String(row.id), label: row.branch, detail: row.variety, reporting_date: row.reporting_date, minimum: row.minimum_price, central: row.average_price, maximum: row.maximum_price }, selectedDate);
  const comparedBranches = new Set(comparison.map((row) => row.branch)).size;
  // Cross-branch spread per reporting date: only dates with at least two reporting branches carry a spread.
  const spreadByDate = dates.slice().reverse().map((date) => ({ date, ...crossSectionSpread(rows.filter((row) => row.reporting_date === date).map((row) => row.average_price)) })).filter((point) => point.count >= 2);
  const averageDistribution = describe(rows.map((row) => row.average_price));
  const averageBins = histogram(rows.flatMap((row) => row.average_price === null ? [] : [row.average_price]), 8);
  function toggleSort(key: QuoteSortKey) {
    setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "branch" ? "asc" : "desc" });
    setPage(0);
  }
  function applyPreset(value: DatePreset) {
    setPreset(value); setPage(0);
    const range = presetRange(value, calendarTodayIST());
    if (range) { setFrom(range.from); setTo(range.to); } else if (value === "all") { setFrom(""); setTo(""); }
  }
  const series = data?.series ?? [];
  const current = series.find((point) => point.reporting_date === data?.latest_reporting_date);
  const previous = series.filter((point) => point.reporting_date < (data?.latest_reporting_date ?? "")).at(-1);
  const sameBranches = Boolean(current && previous && JSON.stringify(current.branches) === JSON.stringify(previous.branches));
  const delta = sameBranches && current && previous ? current.median_average_price - previous.median_average_price : null;
  const pending = data?.counts.filter((row) => row.status === "pending" || row.status === "invalid").reduce((sum, row) => sum + row.count, 0) ?? 0;
  const benchmarkValues = series.map((point) => point.median_average_price);
  const latestBranches = (data?.latest_by_branch ?? []).filter((row) => row.reporting_date === data?.latest_reporting_date);
  const missingBranches = (data?.branches ?? []).filter((name) => !(data?.latest_by_branch ?? []).some((row) => row.branch === name));
  const periodMean = benchmarkValues.length ? benchmarkValues.reduce((sum, value) => sum + value, 0) / benchmarkValues.length : null;
  const dispersion = periodMean === null ? null : Math.sqrt(benchmarkValues.reduce((sum, value) => sum + (value - periodMean) ** 2, 0) / benchmarkValues.length);
  function exportRows() {
    const exportData = location.pathname === "/compare" ? comparison : filtered;
    downloadCsv([["source", "branch", "reporting_date", "variety", "minimum_price", "average_price", "maximum_price", "normal_price", "price_type", "price_unit", "unit_status", "source_url", "fetched_at"],
      ...exportData.map((row) => [row.source_key, row.branch, row.reporting_date, row.variety, row.minimum_price, row.average_price, row.maximum_price, row.normal_price, row.price_type, row.price_unit, row.unit_status, row.source_url, row.fetched_at])], `ani-${source}-branch-prices.csv`);
  }
  return <div className="page-stack">
    <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />{sourceName} · COOPERATIVE INTELLIGENCE</div><h1>{commodity === "black_pepper" ? mode.title.replace("Arecanut", "Black pepper") : mode.title}</h1><p>{mode.description}</p></div>
      <label className="filter-control"><span>Exact reported variety</span><select value={data?.variety ?? ""} disabled={!data?.varieties.length} onChange={(event) => {
        const next = new URLSearchParams(params); next.set("variety", event.target.value); setParams(next); setComparisonDate(""); setPage(0);
      }}>{!data?.varieties.length && <option>No published varieties</option>}{data?.varieties.map((variety) => <option key={variety}>{variety}</option>)}</select></label>
    </section>
    <div className="data-disclosure"><span>{sourceName} reported averages{commodity === "black_pepper" ? " · black pepper" : ""} · {source === "tumcos" ? "source label \"kg\" conflicts with value magnitude — unit unconfirmed" : source === "tss" ? "INR / quintal — assumed, not source-confirmed" : "INR / quintal"}.{assumedUnit ? " Excluded from verified-unit benchmarks." : ""} Not official APMC modal prices. Reporting dates are preserved per branch. No variety aliases are merged.{data?.permission ? ` Source permission: ${data.permission.label}.` : ""}</span></div>
    {location.pathname === "/" && <IntelligenceScorecard feed={source} variety={selected} />}
    {query.isLoading ? <LoadingState label="Loading cooperative quotations" /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : !rows.length ? <EmptyState title="No reviewed cooperative quotations published">
      {data?.publication.blocked_reason ? <>{data.publication.blocked_reason} {data.publication.latest_archived_reporting_date ? `Latest archived market reporting date: ${data.publication.latest_archived_reporting_date}.` : "No reporting dates archived yet."} </> : null}
      <Link to="/data-quality">Fetch and review {sourceName} quotations in Data quality</Link>. {pending > 0 ? `${pending} quotations await inspection.` : "Nothing is substituted for missing prices."}
    </EmptyState> : <>
      {location.pathname === "/" && <>
        <section className="snapshot-grid" aria-label="Cooperative snapshot">
          <article className="snapshot-card featured-card"><div className="card-kicker">BRANCH-AVERAGE BENCHMARK · {data?.variety}</div><div className="snapshot-value">{assumedUnit ? "Withheld" : money(data?.reference_price)}{!assumedUnit && <small>/ quintal</small>}</div><p>{assumedUnit ? "Unit assumed; not included in verified-unit benchmarks" : `Market reporting date: ${data?.latest_reporting_date} · ${current?.branch_count ?? 0} qualifying branches`}</p>{!assumedUnit && <p>Latest qualifying benchmark date: {data?.benchmark_reporting_date ?? "Unavailable"}. {data?.benchmark_reporting_date !== data?.latest_reporting_date && "Latest reports lack benchmark coverage; the chart ends at an earlier qualifying date."}</p>}</article>
          <article className="snapshot-card"><div className="card-kicker">LATEST-DATE BRANCHES</div><div className="snapshot-value">{comparison.length}</div><p>{data?.latest_reporting_date} · Minimum benchmark coverage: {coverage}</p></article>
          <article className="snapshot-card"><div className="card-kicker">HIGHEST COMPARABLE AVERAGE</div><div className="snapshot-value">{money(comparison[0]?.average_price)}</div><p>{comparison[0]?.branch}</p></article>
          <article className="snapshot-card"><div className="card-kicker">LOWEST COMPARABLE AVERAGE</div><div className="snapshot-value">{money(comparison.at(-1)?.average_price)}</div><p>{comparison.at(-1)?.branch}</p></article>
        </section>
        <section className="panel"><div className="panel-heading"><div><h2>Market pulse</h2><p>Observed facts, not a forecast or causal explanation</p></div></div><div className="monthly-details">
          <p>{data?.variety}: {comparison.length} branches reported on {data?.latest_reporting_date}. {assumedUnit ? "INR/quintal is assumed, not source-confirmed; benchmark withheld." : data?.reference_price !== null ? `The median of their reported averages is ${money(data?.reference_price)} per quintal.` : "Coverage is insufficient for the benchmark."}</p>
          {delta !== null ? <p>The comparable branch-set median changed by {money(delta)} from {previous?.reporting_date}.</p> : <p>A like-for-like price-change claim is withheld: branch constituents differ between dates or comparable history is insufficient.</p>}
        </div></section>
        <section className="content-grid">
          <article className="panel table-panel"><div className="panel-heading"><div><h2>Branch coverage</h2><p>{latestBranches.length} of {data?.branches.length ?? 0} branches reported {data?.variety} on {data?.latest_reporting_date ? formatCalendarDate(data.latest_reporting_date) : "the latest date"} · latest report per branch</p></div></div>
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
          <article className="panel"><div className="panel-heading"><div><h2>Benchmark methodology</h2><p>How the headline figure is produced</p></div><span className="method-chip">DOCUMENTED METHOD</span></div><div className="monthly-details">
            <p>{data?.methodology}</p>
            <dl className="fact-list">
              <div><dt>Price type</dt><dd>Cooperative reported average (not APMC modal)</dd></div>
              <div><dt>Unit</dt><dd>{assumedUnit ? "INR/quintal assumed — benchmark withheld" : "INR/quintal (source-confirmed)"}</dd></div>
              <div><dt>Coverage rule</dt><dd>At least {coverage} branches on the same reporting date</dd></div>
              <div><dt>Latest constituents</dt><dd>{current ? `${current.branches.join(", ")} (${formatCalendarDate(current.reporting_date)})` : "No qualifying date"}</dd></div>
              <div><dt>Market reporting date</dt><dd>{data?.latest_reporting_date ? formatCalendarDate(data.latest_reporting_date) : "Unavailable"}</dd></div>
              <div><dt>Source publication time</dt><dd>Not supplied by this source</dd></div>
              <div><dt>Last platform fetch</dt><dd>{data?.last_fetch ? `${data.last_fetch.status} · ${formatTimestampIST(data.last_fetch.started_at)}` : "Never"}</dd></div>
            </dl>
          </div></article>
        </section>
      </>}
      {location.pathname === "/analytics" && !assumedUnit && <section className="snapshot-grid" aria-label="Cooperative analytics summary">
        <article className="snapshot-card"><div className="card-kicker">QUALIFYING DAILY OBSERVATIONS</div><div className="snapshot-value">{series.length}</div><p>Dates meeting the {coverage}-branch minimum</p></article>
        <article className="snapshot-card"><div className="card-kicker">PERIOD AVERAGE</div><div className="snapshot-value">{money(periodMean)}</div><p>Arithmetic mean of published daily medians</p></article>
        <article className="snapshot-card"><div className="card-kicker">PERIOD HIGH / LOW</div><div className="snapshot-value">{money(benchmarkValues.length ? Math.max(...benchmarkValues) : null)}</div><p>Low: {money(benchmarkValues.length ? Math.min(...benchmarkValues) : null)}</p></article>
        <article className="snapshot-card"><div className="card-kicker">PRICE DISPERSION</div><div className="snapshot-value">{money(dispersion)}</div><p>Population standard deviation, not forecast uncertainty</p></article>
      </section>}
      {(location.pathname === "/" || location.pathname === "/analytics") && <section className="panel"><div className="panel-heading"><div><h2>{sourceName} {assumedUnit ? "reported-average history" : "branch-average benchmark"}</h2><p>{assumedUnit ? "One location and exact variety. INR/quintal assumed, not source-confirmed. Not a benchmark or forecast." : `${series.length} qualifying reporting dates · At least ${coverage} branches per date · Constituent coverage varies`}</p></div>
        {assumedUnit && <label className="filter-control"><span>Chart location</span><select value={selectedChartBranch} onChange={(event) => setChartBranch(event.target.value)}>{branches.map((value) => <option key={value}>{value}</option>)}</select></label>}</div>
        {assumedUnit ? <div className="monthly-details"><Suspense fallback={<LoadingState />}><PriceChart label={`TSS · ${selectedChartBranch} · ${data?.variety} · Reported average`} quotePoints={quotePoints} unitNote=" — assumed, not source-confirmed" /></Suspense></div>
          : !series.length ? <EmptyState title="Insufficient same-date branch coverage" /> : <div className="monthly-details"><Suspense fallback={<LoadingState />}><PriceChart label={`${sourceName} branch-average benchmark`} averagePoints={series} /></Suspense>
          <details><summary>Constituent branches by date</summary>{series.map((point) => <p key={point.reporting_date}>{point.reporting_date}: {point.branches.join(", ")}</p>)}</details></div>}
      </section>}
      {location.pathname === "/analytics" && <section className="content-grid">
        <article className="panel chart-panel"><div className="panel-heading"><div><h2>Cross-branch spread</h2><p>Highest minus lowest reported average among branches on the same date · dates with ≥2 branches</p></div></div>
          {!spreadByDate.length ? <EmptyState title="No date has two or more reporting branches" /> : <LazyBarChart categories={spreadByDate.map((point) => formatCalendarDate(point.date))} values={spreadByDate.map((point) => point.spread)} name="Branch spread" description={`${sourceName} cross-branch average spread by reporting date`} />}
          <div className="chart-foot"><SourceLabel>{sourceName} · reported averages{assumedUnit ? " · unit assumed" : ""}</SourceLabel></div></article>
        <article className="panel chart-panel"><div className="panel-heading"><div><h2>Price distribution</h2><p>{averageDistribution.count} published branch averages in the current window · not a forecast range</p></div></div>
          {!averageBins.length ? <EmptyState title="No published averages" /> : <LazyBarChart categories={averageBins.map((bin) => `${Math.round(bin.from).toLocaleString("en-IN")}–${Math.round(bin.to).toLocaleString("en-IN")}`)} values={averageBins.map((bin) => bin.count)} name="Observations" valueFormat="count" description={`${sourceName} distribution of branch averages`} />}
          <dl className="fact-list compact"><div><dt>Median</dt><dd>{money(averageDistribution.median)}</dd></div><div><dt>Interquartile range</dt><dd>{money(averageDistribution.q1)} – {money(averageDistribution.q3)}</dd></div><div><dt>Coefficient of variation</dt><dd>{averageDistribution.cvPercent === null ? "—" : `${averageDistribution.cvPercent.toFixed(1)}%`}</dd></div></dl>
          <div className="chart-foot"><SourceLabel>{sourceName} · {data?.window ? `${formatCalendarDate(data.window.from)} – ${formatCalendarDate(data.window.to)}` : "current window"}</SourceLabel></div></article>
        <article className="panel"><div className="panel-heading"><div><h2>Seasonal and year-on-year analysis</h2><p>Requires multi-year history</p></div></div><div className="monthly-details">
          <p>{sourceName} snapshots cover {dates.length} reporting date{dates.length === 1 ? "" : "s"}{dates.length ? ` (${formatCalendarDate(dates.at(-1)!)} – ${formatCalendarDate(dates[0])})` : ""}. Seasonal indices and year-on-year comparisons are not computed from such a short span.</p>
          <p>Multi-year seasonal, year-on-year and volatility analysis is available for the Karnataka monthly AGMARKNET series in <Link to="/analytics?feed=official">Official analytics</Link> and <Link to="/history">Historical analytics</Link>. Price bases are kept separate; those figures are arrival-weighted modal averages, not cooperative averages.</p>
        </div></article>
      </section>}
      {location.pathname === "/prices" && <section className="filter-bar">
        <label className="filter-control"><span>Branch</span><select value={branch} onChange={(event) => { setBranch(event.target.value); setPage(0); }}><option value="">All branches</option>{(data?.branches ?? [...new Set(rows.map((row) => row.branch))].sort()).map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="filter-control"><span>Reporting period</span><select value={preset} onChange={(event) => applyPreset(event.target.value as DatePreset)}>{DATE_PRESETS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="filter-control"><span>From</span><input type="date" value={from} max={to || undefined} onChange={(event) => { setFrom(event.target.value); setPreset("custom"); setPage(0); }} /></label>
        <label className="filter-control"><span>To</span><input type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setPreset("custom"); setPage(0); }} /></label>
        <label className="filter-control"><span>Search branch or variety</span><input type="search" value={params.get("search") ?? ""} placeholder="e.g. Sagara" onChange={(event) => { const next = new URLSearchParams(params); if (event.target.value) next.set("search", event.target.value); else next.delete("search"); setParams(next, { replace: true }); setPage(0); }} /></label>
        <button className="button-secondary" onClick={() => { setBranch(""); setFrom(""); setTo(""); setPreset("all"); setPage(0); const next = new URLSearchParams(params); next.delete("search"); setParams(next); }}>Reset filters</button>
      </section>}
      {location.pathname === "/compare" && <section className="filter-bar"><label className="filter-control"><span>Same reporting date</span><select value={selectedDate} onChange={(event) => setComparisonDate(event.target.value)}>{dates.map((date) => <option key={date}>{date}</option>)}</select></label><span>Ranked by average, highest first. Other reporting dates are excluded. {comparedBranches} of {data?.branches.length ?? 0} branches reported on this date.</span></section>}
      {location.pathname === "/compare" && <section className="panel chart-panel"><div className="panel-heading"><div><h2>Ranked branch range</h2><p>{formatCalendarDate(selectedDate)} · {data?.variety} · Bar shows minimum–maximum, marker shows the reported average{assumedUnit ? " · unit not source-confirmed" : ""}</p></div></div>
        {!ranked.length ? <EmptyState title="No branch averages on this date" /> : <LazyRangeChart rows={ranked.map((row) => ({ label: row.label, detail: row.detail, minimum: row.minimum, central: row.central, maximum: row.maximum }))} centralLabel="Reported average" description={`${sourceName} branch ranges for ${data?.variety} on ${selectedDate}`} />}
        <div className="chart-foot"><SourceLabel>{sourceName} · cooperative reported averages · {formatCalendarDate(selectedDate)}</SourceLabel></div>
      </section>}
      {from && to && from > to ? <ErrorState error={new Error("From date must not be after To date.")} /> : <section className="panel table-panel">
        <div className="panel-heading"><div><h2>{location.pathname === "/compare" ? "Same-date branch comparison" : "Published branch observations"}</h2><p>{location.pathname === "/compare" ? comparison.length : filtered.length} matching observations · Reported averages, not modal prices{data?.window && <> · Reporting window {formatCalendarDate(data.window.from)} – {formatCalendarDate(data.window.to)}{data.window.truncated ? ` (latest ${data.window.row_limit.toLocaleString("en-IN")} rows only; narrow the date range to see the rest)` : ""}</>}</p></div>
          <button className="button-secondary" onClick={exportRows} disabled={!(location.pathname === "/compare" ? comparison : filtered).length}>Export matching CSV</button></div>
        {!(location.pathname === "/compare" ? comparison : filtered).length ? <EmptyState title="No quotations match these filters" /> : <QuoteTable rows={location.pathname === "/compare" ? comparison : filtered.slice(activePage * 25, (activePage + 1) * 25)} sort={location.pathname === "/compare" ? undefined : sort} onSort={location.pathname === "/compare" ? undefined : toggleSort} />}
        {location.pathname !== "/compare" && filtered.length > 25 && <div className="pagination"><span>Page {activePage + 1} of {Math.ceil(filtered.length / 25)}</span><div><button className="button-secondary" disabled={!activePage} onClick={() => setPage(activePage - 1)}>Previous</button><button className="button-secondary" disabled={(activePage + 1) * 25 >= filtered.length} onClick={() => setPage(activePage + 1)}>Next</button></div></div>}
      </section>}
    </>}
    <section className="panel"><div className="panel-heading"><div><h2>Source and methodology</h2><p>{data?.methodology}</p></div></div><div className="monthly-details">
      <p>Market reporting date: {data?.latest_reporting_date ?? "Unavailable"}. Source publication timestamp: not supplied by this feed. Last platform fetch attempt: {data?.last_fetch ? `${data.last_fetch.status} · ${formatTimestampIST(data.last_fetch.started_at)}` : "Never"}.</p>
      {data?.last_fetch?.error_message && <p role="alert">{data.last_fetch.error_message}</p>}
      {assumedUnit && <details><summary>Recent location fetches</summary>{data?.recent_fetches.map((run) => <p key={`${run.source_url}:${run.started_at}`}><a href={run.source_url} target="_blank" rel="noreferrer">Source request</a> · {run.status} · {formatTimestampIST(run.started_at)} · {run.received_count ?? "Unknown"} rows · {run.excluded_count} excluded{run.error_message && <span role="alert"> · {run.error_message}</span>}</p>)}</details>}
      <p>These are the observations available in captured source snapshots, not a complete historical archive. A new fetch does not make an older quotation current.</p>
      <Link to="/data-quality">Inspect validation, source evidence and refresh controls</Link>
    </div></section>
  </div>;
}

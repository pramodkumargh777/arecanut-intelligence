import { lazy, Suspense, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api } from "../services/api";
import { toCsv } from "../services/csv";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import type { CooperativeQuote } from "../services/cooperative";

const PriceChart = lazy(() => import("../components/PriceChart").then((module) => ({ default: module.PriceChart })));
const money = (value: number | null | undefined) => value == null ? "Not reported" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const modes: Record<string, { title: string; description: string }> = {
  "/": { title: "Arecanut market overview", description: "Published cooperative branch quotations, with reporting dates and source evidence." },
  "/prices": { title: "Market prices", description: "Explore reviewed cooperative minimum, maximum and reported average prices." },
  "/analytics": { title: "Price analytics", description: "Source-specific daily medians of branch averages. Never mixed with official modal prices." },
  "/compare": { title: "Market comparison", description: "Compare cooperative branches for the same variety and date. Branches are not APMC market mappings." },
};

export function MarketDataPage({ official }: { official: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const feed = params.get("feed") ?? "mamcos";
  const supported = feed === "mamcos" || feed === "tss" || feed === "official";
  return <div className="page-stack">
    <section className="filter-bar" aria-label="Market data source"><label className="filter-control"><span>Data source / price type</span>
      <select value={supported ? feed : ""} onChange={(event) => {
        const next = new URLSearchParams(params); next.set("feed", event.target.value); next.delete("variety"); setParams(next);
      }}><option value="" disabled>Select a supported source</option><option value="mamcos">MAMCOS · Cooperative branch averages</option><option value="tss">TSS · Averages (unit assumed)</option><option value="official">AGMARKNET · Official modal prices</option></select>
    </label><span>Separate sources, varieties and benchmark methodologies.</span></section>
    {!supported ? <ErrorState error={new Error("Unsupported market-data source. Select MAMCOS, TSS or AGMARKNET.")} /> : feed === "official" ? official : <CooperativeMarketPage key={`${location.pathname}:${feed}`} source={feed === "tss" ? "tss" : "mamcos"} />}
  </div>;
}

function QuoteTable({ rows }: { rows: CooperativeQuote[] }) {
  const tss = rows[0]?.source_key === "tss";
  return <div className="table-scroll" tabIndex={0} role="region" aria-label="Cooperative quotations"><table>
    <caption>{tss ? "TSS" : "MAMCOS"} published quotations · INR / quintal {tss ? "— assumed, not source-confirmed" : ""} · Average is not modal price</caption>
    <thead><tr><th scope="col">Branch</th><th scope="col">Reporting date</th><th scope="col">Exact variety</th><th scope="col" className="numeric">Minimum</th><th scope="col" className="numeric">Average</th><th scope="col" className="numeric">Maximum</th>{tss && <th scope="col" className="numeric">Normal rate</th>}<th scope="col">Source / fetched at</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.id}><td className="table-market">{row.branch}</td><td>{row.reporting_date}</td><td>{row.variety}</td>
      <td className="numeric">{money(row.minimum_price)}</td><td className="numeric table-price">{money(row.average_price)}</td><td className="numeric">{money(row.maximum_price)}</td>
      {tss && <td className="numeric">{money(row.normal_price)}</td>}
      <td><a href={row.source_url} target="_blank" rel="noreferrer">{tss ? "TSS" : "MAMCOS"}</a><small className="quote-fetch">{new Date(row.fetched_at).toLocaleString("en-IN")}</small></td></tr>)}</tbody>
  </table></div>;
}

function CooperativeMarketPage({ source }: { source: "mamcos" | "tss" }) {
  const sourceName = source.toUpperCase();
  const assumedUnit = source === "tss";
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [branch, setBranch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [comparisonDate, setComparisonDate] = useState("");
  const [page, setPage] = useState(0);
  const [chartBranch, setChartBranch] = useState("Sirsi");
  const selected = params.get("variety") ?? "";
  const query = useQuery({ queryKey: ["cooperative", source, selected], queryFn: () => api.cooperativePrices(source, selected || undefined), refetchInterval: 60_000 });
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
  const filtered = rows.filter((row) => (!branch || row.branch === branch) && (!from || row.reporting_date >= from)
    && (!to || row.reporting_date <= to) && (!search || `${row.branch} ${row.variety}`.toLowerCase().includes(search)));
  const activePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 25) - 1));
  const comparison = rows.filter((row) => row.reporting_date === selectedDate).sort((a, b) => (b.average_price ?? 0) - (a.average_price ?? 0));
  const series = data?.series ?? [];
  const current = series.find((point) => point.reporting_date === data?.latest_reporting_date);
  const previous = series.filter((point) => point.reporting_date < (data?.latest_reporting_date ?? "")).at(-1);
  const sameBranches = Boolean(current && previous && JSON.stringify(current.branches) === JSON.stringify(previous.branches));
  const delta = sameBranches && current && previous ? current.median_average_price - previous.median_average_price : null;
  const pending = data?.counts.filter((row) => row.status === "pending" || row.status === "invalid").reduce((sum, row) => sum + row.count, 0) ?? 0;
  const benchmarkValues = series.map((point) => point.median_average_price);
  const periodMean = benchmarkValues.length ? benchmarkValues.reduce((sum, value) => sum + value, 0) / benchmarkValues.length : null;
  const dispersion = periodMean === null ? null : Math.sqrt(benchmarkValues.reduce((sum, value) => sum + (value - periodMean) ** 2, 0) / benchmarkValues.length);
  function exportRows() {
    const exportData = location.pathname === "/compare" ? comparison : filtered;
    const csv = toCsv([["source", "branch", "reporting_date", "variety", "minimum_price", "average_price", "maximum_price", "normal_price", "price_type", "price_unit", "unit_status", "source_url", "fetched_at"],
      ...exportData.map((row) => [row.source_key, row.branch, row.reporting_date, row.variety, row.minimum_price, row.average_price, row.maximum_price, row.normal_price, row.price_type, row.price_unit, row.unit_status, row.source_url, row.fetched_at])]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `ani-${source}-branch-prices.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <div className="page-stack">
    <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />{sourceName} · COOPERATIVE INTELLIGENCE</div><h1>{mode.title}</h1><p>{mode.description}</p></div>
      <label className="filter-control"><span>Exact reported variety</span><select value={data?.variety ?? ""} disabled={!data?.varieties.length} onChange={(event) => {
        const next = new URLSearchParams(params); next.set("variety", event.target.value); setParams(next); setComparisonDate(""); setPage(0);
      }}>{!data?.varieties.length && <option>No published varieties</option>}{data?.varieties.map((variety) => <option key={variety}>{variety}</option>)}</select></label>
    </section>
    <div className="data-disclosure"><span>{sourceName} reported averages · INR / quintal{assumedUnit ? " — assumed, not source-confirmed. Excluded from verified-unit benchmarks." : "."} Not official APMC modal prices. Reporting dates are preserved per branch. No variety aliases are merged.</span></div>
    {query.isLoading ? <LoadingState label="Loading cooperative quotations" /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : !rows.length ? <EmptyState title="No reviewed cooperative quotations published">
      <Link to="/data-quality">Fetch and review {sourceName} quotations in Data quality</Link>. {pending > 0 ? `${pending} quotations await inspection.` : "Nothing is substituted for missing prices."}
    </EmptyState> : <>
      {location.pathname === "/" && <>
        <section className="snapshot-grid" aria-label="Cooperative snapshot">
          <article className="snapshot-card featured-card"><div className="card-kicker">BRANCH-AVERAGE BENCHMARK · {data?.variety}</div><div className="snapshot-value">{assumedUnit ? "Withheld" : money(data?.reference_price)}{!assumedUnit && <small>/ quintal</small>}</div><p>{assumedUnit ? "Unit assumed; not included in verified-unit benchmarks" : `${data?.latest_reporting_date} · ${current?.branch_count ?? 0} qualifying branches`}</p></article>
          <article className="snapshot-card"><div className="card-kicker">LATEST-DATE BRANCHES</div><div className="snapshot-value">{comparison.length}</div><p>{data?.latest_reporting_date} · Minimum benchmark coverage: {coverage}</p></article>
          <article className="snapshot-card"><div className="card-kicker">HIGHEST COMPARABLE AVERAGE</div><div className="snapshot-value">{money(comparison[0]?.average_price)}</div><p>{comparison[0]?.branch}</p></article>
          <article className="snapshot-card"><div className="card-kicker">LOWEST COMPARABLE AVERAGE</div><div className="snapshot-value">{money(comparison.at(-1)?.average_price)}</div><p>{comparison.at(-1)?.branch}</p></article>
        </section>
        <section className="panel"><div className="panel-heading"><div><h2>Market pulse</h2><p>Observed facts, not a forecast or causal explanation</p></div></div><div className="monthly-details">
          <p>{data?.variety}: {comparison.length} branches reported on {data?.latest_reporting_date}. {assumedUnit ? "INR/quintal is assumed, not source-confirmed; benchmark withheld." : data?.reference_price !== null ? `The median of their reported averages is ${money(data?.reference_price)} per quintal.` : "Coverage is insufficient for the benchmark."}</p>
          {delta !== null ? <p>The comparable branch-set median changed by {money(delta)} from {previous?.reporting_date}.</p> : <p>A like-for-like price-change claim is withheld: branch constituents differ between dates or comparable history is insufficient.</p>}
        </div></section>
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
      {location.pathname === "/prices" && <section className="filter-bar">
        <label className="filter-control"><span>Branch</span><select value={branch} onChange={(event) => { setBranch(event.target.value); setPage(0); }}><option value="">All branches</option>{[...new Set(rows.map((row) => row.branch))].sort().map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="filter-control"><span>From</span><input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(0); }} /></label>
        <label className="filter-control"><span>To</span><input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(0); }} /></label>
        <button className="button-secondary" onClick={() => { setBranch(""); setFrom(""); setTo(""); setPage(0); const next = new URLSearchParams(params); next.delete("search"); setParams(next); }}>Reset filters</button>
      </section>}
      {location.pathname === "/compare" && <section className="filter-bar"><label className="filter-control"><span>Same reporting date</span><select value={selectedDate} onChange={(event) => setComparisonDate(event.target.value)}>{dates.map((date) => <option key={date}>{date}</option>)}</select></label><span>Ranked by average, highest first. Other reporting dates are excluded.</span></section>}
      {from && to && from > to ? <ErrorState error={new Error("From date must not be after To date.")} /> : <section className="panel table-panel">
        <div className="panel-heading"><div><h2>{location.pathname === "/compare" ? "Same-date branch comparison" : "Published branch observations"}</h2><p>{location.pathname === "/compare" ? comparison.length : filtered.length} matching observations · Reported averages, not modal prices</p></div>
          <button className="button-secondary" onClick={exportRows} disabled={!(location.pathname === "/compare" ? comparison : filtered).length}>Export matching CSV</button></div>
        {!(location.pathname === "/compare" ? comparison : filtered).length ? <EmptyState title="No quotations match these filters" /> : <QuoteTable rows={location.pathname === "/compare" ? comparison : filtered.slice(activePage * 25, (activePage + 1) * 25)} />}
        {location.pathname !== "/compare" && filtered.length > 25 && <div className="pagination"><span>Page {activePage + 1} of {Math.ceil(filtered.length / 25)}</span><div><button className="button-secondary" disabled={!activePage} onClick={() => setPage(activePage - 1)}>Previous</button><button className="button-secondary" disabled={(activePage + 1) * 25 >= filtered.length} onClick={() => setPage(activePage + 1)}>Next</button></div></div>}
      </section>}
    </>}
    <section className="panel"><div className="panel-heading"><div><h2>Source and methodology</h2><p>{data?.methodology}</p></div></div><div className="monthly-details">
      <p>Source reporting date: {data?.latest_reporting_date ?? "Unavailable"}. Last fetch attempt: {data?.last_fetch ? `${data.last_fetch.status} · ${new Date(data.last_fetch.started_at).toLocaleString("en-IN")}` : "Never"}.</p>
      {data?.last_fetch?.error_message && <p role="alert">{data.last_fetch.error_message}</p>}
      {assumedUnit && <details><summary>Recent location fetches</summary>{data?.recent_fetches.map((run) => <p key={`${run.source_url}:${run.started_at}`}><a href={run.source_url} target="_blank" rel="noreferrer">Source request</a> · {run.status} · {new Date(run.started_at).toLocaleString("en-IN")} · {run.received_count ?? "Unknown"} rows · {run.excluded_count} excluded{run.error_message && <span role="alert"> · {run.error_message}</span>}</p>)}</details>}
      <p>These are the observations available in captured source snapshots, not a complete historical archive. A new fetch does not make an older quotation current.</p>
      <Link to="/data-quality">Inspect validation, source evidence and refresh controls</Link>
    </div></section>
  </div>;
}

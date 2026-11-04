import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { toCsv } from "../services/csv";
import { EmptyState, ErrorState, LoadingState } from "../components/State";

const PriceChart = lazy(() => import("../components/PriceChart").then((module) => ({ default: module.PriceChart })));
const number = (value: number | null) => value === null ? "Unavailable" : value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const completed = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
function download(rows: (string | number | null)[][], name: string) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}
export function HistoricalAnalyticsPage() {
  const [from, setFrom] = useState("2021-01"), [to, setTo] = useState(completed), [variety, setVariety] = useState("Rashi");
  const valid = from >= "2010-01" && from <= to && to <= completed();
  const query = useQuery({ queryKey: ["history", from, to, variety], queryFn: () => api.monthlyHistory(from, to, variety), enabled: valid, refetchInterval: 60_000 });
  const data = query.data;
  const latest = data?.points.filter((point) => point.weighted_price !== null).at(-1);
  const changes = data?.versions.filter((row, index, versions) => {
    const prior = versions.slice(0, index).filter((value) => value.reporting_month === row.reporting_month).at(-1);
    return prior !== undefined && (prior.weighted_price !== row.weighted_price || prior.variety_present !== row.variety_present);
  }) ?? [];
  return <div className="page-stack">
    <section className="page-heading"><div><div className="eyebrow">HISTORY & COVERAGE</div><h1>Historical analytics</h1><p>Exact-variety monthly AGMARKNET reports. Calendar gaps remain missing; revisions remain traceable.</p></div></section>
    <section className="filter-bar">
      <label className="filter-control"><span>From month</span><input type="month" min="2010-01" max={completed()} value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="filter-control"><span>Through month</span><input type="month" min="2010-01" max={completed()} value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <label className="filter-control"><span>Exact monthly variety</span><select value={variety} onChange={(event) => setVariety(event.target.value)}>{[...new Set([variety, ...(data?.varieties ?? [])])].map((value) => <option key={value}>{value}</option>)}</select></label>
    </section>
    {!valid ? <ErrorState error={new Error("Select completed months in ascending order, from 2010 onward.")} /> : query.isLoading ? <LoadingState /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : data && <>
      <section className="snapshot-grid">
        <article className="snapshot-card"><div className="card-kicker">PRICE COVERAGE</div><div className="snapshot-value">{data.observed_months} / {data.expected_months}</div><p>{data.reporting_months} report months stored; missing values are not zero</p></article>
        <article className="snapshot-card"><div className="card-kicker">LATEST OBSERVED MONTH</div><div className="snapshot-value">{latest?.reporting_month ?? "None"}</div><p>Fetched: {latest?.fetched_at ? new Date(latest.fetched_at).toLocaleString("en-IN") : "Never"}. Reporting and fetch dates differ.</p></article>
        <article className="snapshot-card"><div className="card-kicker">LATEST YEAR-ON-YEAR</div><div className="snapshot-value">{number(latest?.yoy_percent ?? null)}{latest?.yoy_percent != null ? "%" : ""}</div><p>Exact month vs same month last year; never nearest available</p></article>
        <article className="snapshot-card"><div className="card-kicker">TRAILING VOLATILITY</div><div className="snapshot-value">{number(latest?.volatility_percent ?? null)}{latest?.volatility_percent != null ? "%" : ""}</div><p>Annualized sample volatility of 12 consecutive monthly log returns</p></article>
      </section>
      <section className="panel"><div className="panel-heading"><div><h2>{variety} · Observed monthly weighted prices</h2><p>INR/quintal · State: {data.state} · No interpolation</p></div></div>
        {!data.observed_months ? <EmptyState title="No observed monthly prices in this range">Missing reports, absent varieties and missing prices remain distinguished in the calendar table.</EmptyState>
          : <Suspense fallback={<LoadingState />}><PriceChart label={`${variety} · Official monthly weighted price`} quotePoints={data.points.flatMap((row) => row.weighted_price === null ? [] : [{ reporting_date: `${row.reporting_month}-01`, average_price: row.weighted_price }])} calendarInterval="monthly" /></Suspense>}
      </section>
      <section className="panel table-panel"><div className="panel-heading"><div><h2>Calendar history and rolling statistics</h2><p>Rolling windows are unavailable if any required month is missing. Prices and rolling means: INR/quintal.</p></div><button className="button-secondary" onClick={() => download([
        ["month", "weighted_price", "price_unit", "status", "rolling_3", "rolling_12", "yoy_percent", "volatility_percent", "source_url", "fetched_at", "refresh_run_id"],
        ...data.points.map((row) => [row.reporting_month, row.weighted_price, "INR/quintal", row.status, row.rolling_3, row.rolling_12, row.yoy_percent, row.volatility_percent, row.source_url, row.fetched_at, row.refresh_run_id]),
      ], "ani-monthly-history.csv")}>Export history CSV</button></div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Monthly historical analytics"><table><caption>One row per calendar month; coverage and source attempt status retained</caption><thead><tr><th>Month</th><th>Status</th><th>Weighted price</th><th>3-month mean</th><th>12-month mean</th><th>YoY %</th><th>Volatility %</th><th>Source / freshness</th></tr></thead><tbody>
          {data.points.map((row) => <tr key={row.reporting_month}><td>{row.reporting_month}</td><td>{row.status.replace(/_/g, " ")}{row.latest_attempt?.status === "failed" && <small className="quote-fetch" role="note">Latest refresh failed: {row.latest_attempt.error_message}</small>}</td><td className="numeric">{number(row.weighted_price)}</td><td className="numeric">{number(row.rolling_3)}</td><td className="numeric">{number(row.rolling_12)}</td><td className="numeric">{number(row.yoy_percent)}</td><td className="numeric">{number(row.volatility_percent)}</td><td>{row.source_url ? <a href={row.source_url} target="_blank" rel="noreferrer">AGMARKNET CSV</a> : "No observation"}<small className="quote-fetch">{row.fetched_at ? new Date(row.fetched_at).toLocaleString("en-IN") : "Not fetched for this variety"}</small></td></tr>)}
        </tbody></table></div>
      </section>
      <section className="panel table-panel"><div className="panel-heading"><div><h2>Descriptive seasonal pattern</h2><p>{data.seasonal_years.length} complete years: {data.seasonal_years.join(", ") || "none"}. Requires at least 3. Index 100 = each full year's average. Not a forecast.</p></div></div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Monthly seasonal indices"><table><caption>Average year-normalized month index · Complete years only</caption><thead><tr><th>Calendar month</th><th>Index</th><th>Complete years</th></tr></thead><tbody>{data.seasonal.map((row) => <tr key={row.month}><td>{row.month}</td><td className="numeric">{number(row.index)}</td><td>{row.complete_years}</td></tr>)}</tbody></table></div>
      </section>
      <section className="panel"><div className="panel-heading"><div><h2>Source snapshots and revisions</h2><p>{data.versions.length} stored report snapshots; {changes.length} consecutive value or presence changes for their month. Identical re-fetches are not price revisions.</p></div></div><div className="monthly-details"><details><summary>Inspect all captured versions</summary><div className="table-scroll" tabIndex={0} role="region" aria-label="Monthly source versions"><table><caption>Historical snapshots are retained even after a source correction or removed variety</caption><thead><tr><th>Month</th><th>Price / presence</th><th>Fetched at</th><th>Captured report</th><th>Source</th></tr></thead><tbody>{data.versions.map((row) => <tr key={`${row.reporting_month}:${row.refresh_run_id}`}><td>{row.reporting_month}</td><td>{row.variety_present ? number(row.weighted_price) : "Variety absent from this snapshot"}</td><td>{new Date(row.fetched_at).toLocaleString("en-IN")}</td><td><a href={api.monthlySnapshotUrl(row.refresh_run_id)} target="_blank" rel="noreferrer">Download archived CSV</a></td><td><a href={row.source_url} target="_blank" rel="noreferrer">Official CSV</a></td></tr>)}</tbody></table></div></details><p>{data.methodology}</p><p>Refresh a single month in Monthly Trends. To resume the approved local backfill: <code>npm run backfill:monthly -- 2021-01 2026-10</code>. Failed source requests remain recorded; re-run retries missing reports. No inference is made that every supported month is available.</p></div></section>
    </>}
    <DailyAggregation />
  </div>;
}

function DailyAggregation() {
  const [source, setSource] = useState("mamcos"), [variety, setVariety] = useState("RASHI EDI"), [branch, setBranch] = useState("");
  const [from, setFrom] = useState("2026-10-01"), [to, setTo] = useState(new Date().toISOString().slice(0, 10)), [interval, setInterval] = useState("weekly");
  const quotes = useQuery({ queryKey: ["cooperative", source, variety], queryFn: () => api.cooperativePrices(source, variety) });
  const branches = [...new Set(quotes.data?.data.map((row) => row.branch) ?? [])].sort();
  const selectedBranch = branches.includes(branch) ? branch : branches[0] ?? "";
  const query = useQuery({ queryKey: ["aggregates", source, variety, selectedBranch, from, to, interval],
    queryFn: () => api.aggregates({ source, variety, branch: selectedBranch, from, to, interval }), enabled: Boolean(selectedBranch && from && to) });
  const data = query.data;
  return <section className="panel table-panel"><div className="panel-heading"><div><h2>Weekly / monthly captured daily quotations</h2><p>Partial captured history only. Never converts official monthly reports into daily observations.</p></div></div>
    <div className="filter-bar">
      <label className="filter-control"><span>Daily source</span><select value={source} onChange={(event) => { setSource(event.target.value); setVariety(event.target.value === "tss" ? "RASHI" : "RASHI EDI"); setBranch(""); }}><option value="mamcos">MAMCOS</option><option value="tss">TSS — unit assumed</option></select></label>
      <label className="filter-control"><span>Daily exact variety</span><select value={variety} onChange={(event) => setVariety(event.target.value)}>{[...new Set([variety, ...(quotes.data?.varieties ?? [])])].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="filter-control"><span>Branch</span><select value={selectedBranch} onChange={(event) => setBranch(event.target.value)}>{!branches.length && <option value="">No records</option>}{branches.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="filter-control"><span>Aggregation</span><select value={interval} onChange={(event) => setInterval(event.target.value)}><option value="weekly">Weekly (Monday start)</option><option value="monthly">Monthly</option></select></label>
      <label className="filter-control"><span>From day</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="filter-control"><span>Through day</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
    </div>
    <div className="data-disclosure">{source.toUpperCase()} · INR/quintal{source === "tss" ? " — assumed, not source-confirmed" : " — source-confirmed"} · Coverage is captured reporting days / calendar days, not complete trading days.</div>
    {!from || !to ? <ErrorState error={new Error("Select both daily aggregation dates.")} /> : quotes.error ? <ErrorState error={quotes.error} /> : !selectedBranch ? <EmptyState title="No captured quotations for this selection" /> : query.isLoading ? <LoadingState /> : query.error ? <ErrorState error={query.error} /> : data && <>
      <button className="button-secondary" onClick={() => download([["period", "from", "to", "source", "branch", "variety", "mean_average_price", "price_unit", "reporting_days", "calendar_days", "unit_status", "fetched_at"],
        ...data.data.map((row) => [row.period, row.from, row.to, source, selectedBranch, variety, row.mean_average_price, "INR/quintal", row.reporting_days, row.calendar_days, row.unit_status, row.fetched_at])], "ani-captured-aggregates.csv")}>Export aggregates CSV</button>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Captured daily aggregates"><table><caption>Equal-weight average of captured daily branch averages; empty periods remain empty</caption><thead><tr><th>Period</th><th>Mean · INR/qtl</th><th>Min daily average</th><th>Max daily average</th><th>Reporting / calendar days</th><th>Fetched at</th></tr></thead><tbody>{data.data.map((row) => <tr key={row.period}><td>{row.from} to {row.to}</td><td>{number(row.mean_average_price)}</td><td>{number(row.minimum_average)}</td><td>{number(row.maximum_average)}</td><td>{row.reporting_days} / {row.calendar_days}</td><td>{row.fetched_at ? new Date(row.fetched_at).toLocaleString("en-IN") : "No captured record"}</td></tr>)}</tbody></table></div>
      <div className="monthly-details"><p>{data.methodology}</p><details><summary>Underlying source observations ({data.observations.length})</summary>{data.observations.map((row) => <p key={row.reporting_date}>{row.reporting_date} · {number(row.average_price)} · <a href={row.source_url} target="_blank" rel="noreferrer">Source</a> · Fetched {new Date(row.fetched_at).toLocaleString("en-IN")}</p>)}</details></div>
    </>}
  </section>;
}

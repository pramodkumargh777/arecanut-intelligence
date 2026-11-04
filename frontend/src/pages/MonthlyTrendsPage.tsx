import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { EmptyState, ErrorState, LoadingState } from "../components/State";

const price = (value: number | null) => value === null ? "Not reported" : new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(value);
const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const timestamp = (value: string) => new Date(value).toLocaleString("en-IN");

export function MonthlyTrendsPage() {
  const [month, setMonth] = useState("");
  const [variety, setVariety] = useState("");
  const [token, setToken] = useState("");
  const [refreshMonth, setRefreshMonth] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  });
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["monthly-prices", month, variety],
    queryFn: () => api.monthlyPrices(month || undefined, variety || undefined),
    refetchInterval: 60_000,
  });
  const refresh = useMutation({
    mutationFn: () => api.refreshMonthly(refreshMonth, token),
    onSuccess: async () => {
      setToken("");
      setMonth(refreshMonth);
      await client.invalidateQueries({ queryKey: ["monthly-prices"] });
      await client.invalidateQueries({ queryKey: ["history"] });
      await client.invalidateQueries({ queryKey: ["decision-prices"] });
    },
    onError: async () => {
      await client.invalidateQueries({ queryKey: ["monthly-prices"] });
      await client.invalidateQueries({ queryKey: ["history"] });
    },
  });
  const data = query.data;
  const latestFetch = data?.data.reduce((latest, row) => row.fetched_at > latest ? row.fetched_at : latest, "");
  return <div className="page-stack">
    <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />OFFICIAL MONTHLY REPORTS</div>
      <h1>Monthly Trends</h1><p>State-level, variety-specific weighted prices. Separate from daily market quotations and the reference index.</p></div><Link to="/history" className="button-secondary">Explore historical analytics</Link></section>
    <div className="data-disclosure"><span>AGMARKNET published aggregates · INR / quintal · Not live auction prices. A missing value is not zero.</span></div>
    <section className="filter-bar">
      <label className="filter-control"><span>Reporting month</span><select value={month} onChange={(event) => setMonth(event.target.value)}>
        <option value="">Latest available</option>{data?.months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}
      </select></label>
      <label className="filter-control"><span>Variety / history</span><select value={variety} onChange={(event) => setVariety(event.target.value)}>
        <option value="">All varieties</option>{variety && !data?.data.some((row) => row.variety_name === variety) && <option>{variety}</option>}
        {data?.data.map((row) => <option key={row.variety_name}>{row.variety_name}</option>)}
      </select></label>
    </section>
    {query.isLoading ? <LoadingState label="Loading monthly reports" /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : <section className="panel table-panel">
      <div className="panel-heading"><div><h2>{data?.state} · {data?.reporting_month ? monthLabel(data.reporting_month) : "No report imported"}</h2>
        <p>Last successfully fetched for this report: {latestFetch ? timestamp(latestFetch) : "Never"}</p></div></div>
      {!data?.data.length ? <EmptyState title="No monthly observations available">An authorized refresh can fetch a completed reporting month. Daily imports do not populate this view.</EmptyState> :
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Monthly weighted prices">
          <table><caption>Reported state-level weighted prices, not individual market prices · INR / quintal</caption>
            <thead><tr><th scope="col">Variety</th><th scope="col" className="numeric">Weighted price</th><th scope="col">Reporting month</th><th scope="col">Source</th></tr></thead>
            <tbody>{data.data.filter((row) => !variety || row.variety_name === variety).map((row) => <tr key={row.variety_name}>
              <td>{row.variety_name}</td><td className="numeric table-price">{price(row.weighted_price)}</td><td>{monthLabel(row.reporting_month)}</td>
              <td><a href={row.source_url} target="_blank" rel="noreferrer">AGMARKNET CSV</a></td></tr>)}</tbody>
          </table>
        </div>}
    </section>}
    {variety && data && <section className="panel table-panel"><div className="panel-heading"><div><h2>{variety} · Monthly history</h2><p>24 calendar months through the selected period. Missing months are not interpolated. Full coverage, revisions and statistics are in Historical analytics.</p></div></div>
      {!data.history.length ? <EmptyState title="No stored history for this selection" /> : <div className="table-scroll" tabIndex={0} role="region" aria-label="Selected variety monthly history">
        <table><caption>{variety} · {data.state} · INR / quintal</caption><thead><tr><th scope="col">Reporting month</th><th scope="col" className="numeric">Weighted price</th><th scope="col">Fetched at</th></tr></thead>
          <tbody>{data.history.map((row) => <tr key={row.reporting_month}><td>{monthLabel(row.reporting_month)}</td><td className="numeric">{price(row.weighted_price)}</td><td>{row.fetched_at ? timestamp(row.fetched_at) : "No captured variety observation"}</td></tr>)}</tbody>
        </table></div>}
    </section>}
    <section className="panel"><div className="panel-heading"><div><h2>Methodology and refresh status</h2><p>{data?.methodology}</p></div></div>
      <div className="monthly-details">
        <p>Only the requested month's primary price column is stored. Comparison columns are not treated as independently fetched reports. Original variety labels are preserved, including source categories such as husk.</p>
        <p>Production schedule: daily at 09:00 IST, refreshing the previous two completed months to capture revisions. Local development requires the refresh action below; cron does not run automatically.</p>
        {data?.last_run && <p role="status">Last refresh attempt: <strong>{data.last_run.status}</strong> · {monthLabel(data.last_run.reporting_month)} · {timestamp(data.last_run.started_at)}
          {data.last_run.error_message && <span> · {data.last_run.error_message}</span>}</p>}
        <details><summary>Refresh an official report (reviewer access)</summary>
          <p>Validated official monthly aggregates are published directly here, not sent to the daily observation review queue. Existing data remains available if a refresh fails.</p>
          <form className="monthly-refresh" onSubmit={(event) => { event.preventDefault(); refresh.mutate(); }}>
            <label className="filter-control"><span>Completed reporting month</span><input type="month" min="2010-01" value={refreshMonth} required disabled={refresh.isPending} onChange={(event) => setRefreshMonth(event.target.value)} /></label>
            <label className="filter-control"><span>Reviewer token</span><input type="password" autoComplete="off" required value={token} disabled={refresh.isPending} onChange={(event) => setToken(event.target.value)} /></label>
            <button className="button-secondary" disabled={refresh.isPending || !token}>{refresh.isPending ? "Fetching report..." : "Fetch official report"}</button>
          </form>
          {refresh.error && <ErrorState error={refresh.error} />}
          {refresh.isSuccess && <p role="status">Fetched {refresh.data.record_count} variety rows for {monthLabel(refresh.data.reporting_month)}.</p>}
        </details>
      </div>
    </section>
  </div>;
}

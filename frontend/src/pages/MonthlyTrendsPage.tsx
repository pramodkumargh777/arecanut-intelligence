import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { completedMonthIST } from "../../../shared/dates";
import { defineCopy, useCopy, useFormat } from "../services/language";
import { COMMON, fetchStatusText } from "../services/commonCopy";

const PriceChart = lazy(() => import("../components/PriceChart").then((module) => ({ default: module.PriceChart })));
const price = (value: number | null, missing: string) => value === null ? missing : new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(value);

const COPY = defineCopy({
  en: {
    title: "Monthly Trends", intro: "State-level, variety-specific weighted prices. Separate from daily market quotations and the reference index.",
    exploreHistory: "Explore historical analytics", meta: "AGMARKNET monthly averages · ₹/quintal · not live auction prices · a gap means no report, not zero",
    reportingMonth: "Reporting month", latestAvailable: "Latest available", varietyHistory: "Variety / history",
    loading: "Loading monthly reports", noReport: "No report imported",
    lastFetched: (time: string) => `Last successfully fetched for this report: ${time}`, chooseVariety: " · Choose a variety above to see its 24-month trend",
    noObservations: "No monthly observations available", noObservationsHint: "An authorized refresh can fetch a completed reporting month. Daily imports do not populate this view.",
    tableAria: "Monthly weighted prices", tableCaption: "Reported state-level weighted prices, not individual market prices · INR / quintal",
    weightedPrice: "Weighted price", csv: "AGMARKNET CSV",
    historyTitle: (variety: string) => `${variety} · Monthly history`,
    historyHint: "24 calendar months through the selected period. Missing months are not interpolated. Full coverage, revisions and statistics are in Historical analytics.",
    noHistory: "No stored history for this selection", loadingChart: "Loading chart", chartLabel: (variety: string) => `${variety} · Official monthly weighted price`,
    viewTable: "View monthly table", historyAria: "Selected variety monthly history", fetchedAt: "Fetched at", noCaptured: "No captured variety observation",
    methodTitle: "Methodology and refresh status",
    methodology: "State/UT and variety-level arrival-weighted modal price: sum(arrival quantity × modal price) / sum(arrival quantity). Not a daily market quotation.",
    primaryOnly: "Only the requested month's primary price column is stored. Comparison columns are not treated as independently fetched reports. Original variety labels are preserved, including source categories such as husk.",
    schedule: "Production schedule: daily at 09:00 IST, refreshing the previous two completed months to capture revisions. Local development requires the refresh action below; cron does not run automatically.",
    lastAttempt: "Last refresh attempt:", refreshTitle: "Refresh an official report (reviewer access)",
    refreshNote: "Validated official monthly aggregates are published directly here, not sent to the daily observation review queue. Existing data remains available if a refresh fails.",
    completedMonth: "Completed reporting month", token: "Reviewer token", fetching: "Fetching report...", fetch: "Fetch official report",
    fetched: (rows: number, month: string) => `Fetched ${rows} variety rows for ${month}.`,
  },
  kn: {
    title: "ತಿಂಗಳ ಪ್ರವೃತ್ತಿ", intro: "ರಾಜ್ಯ ಮಟ್ಟದ, ತಳಿವಾರು ತೂಕದ ಸರಾಸರಿ ದರಗಳು. ದೈನಂದಿನ ಮಾರುಕಟ್ಟೆ ದರ ಮತ್ತು ಮಾನದಂಡ ಸೂಚ್ಯಂಕದಿಂದ ಪ್ರತ್ಯೇಕ.",
    exploreHistory: "ಐತಿಹಾಸಿಕ ವಿಶ್ಲೇಷಣೆ ನೋಡಿ", meta: "AGMARKNET ತಿಂಗಳ ಸರಾಸರಿಗಳು · ₹/ಕ್ವಿಂಟಾಲ್ · ನೇರ ಹರಾಜು ದರಗಳಲ್ಲ · ಖಾಲಿ ಎಂದರೆ ವರದಿ ಇಲ್ಲ, ಸೊನ್ನೆಯಲ್ಲ",
    reportingMonth: "ವರದಿ ತಿಂಗಳು", latestAvailable: "ಇತ್ತೀಚಿನ ಲಭ್ಯ", varietyHistory: "ತಳಿ / ಇತಿಹಾಸ",
    loading: "ತಿಂಗಳ ವರದಿಗಳನ್ನು ತರಲಾಗುತ್ತಿದೆ", noReport: "ಯಾವುದೇ ವರದಿ ಆಮದಾಗಿಲ್ಲ",
    lastFetched: (time: string) => `ಈ ವರದಿಯನ್ನು ಕೊನೆಯ ಬಾರಿ ಯಶಸ್ವಿಯಾಗಿ ತಂದದ್ದು: ${time}`, chooseVariety: " · 24 ತಿಂಗಳ ಪ್ರವೃತ್ತಿ ನೋಡಲು ಮೇಲೆ ತಳಿ ಆಯ್ಕೆಮಾಡಿ",
    noObservations: "ತಿಂಗಳ ದಾಖಲೆಗಳು ಲಭ್ಯವಿಲ್ಲ", noObservationsHint: "ಅಧಿಕೃತ ನವೀಕರಣವು ಮುಗಿದ ವರದಿ ತಿಂಗಳನ್ನು ತರಬಹುದು. ದೈನಂದಿನ ಆಮದುಗಳು ಈ ಪುಟವನ್ನು ತುಂಬುವುದಿಲ್ಲ.",
    tableAria: "ತಿಂಗಳ ತೂಕದ ಸರಾಸರಿ ದರಗಳು", tableCaption: "ವರದಿಯಾದ ರಾಜ್ಯ ಮಟ್ಟದ ತೂಕದ ಸರಾಸರಿ ದರಗಳು, ಪ್ರತ್ಯೇಕ ಮಾರುಕಟ್ಟೆ ದರಗಳಲ್ಲ · ₹ / ಕ್ವಿಂಟಾಲ್",
    weightedPrice: "ತೂಕದ ಸರಾಸರಿ ದರ", csv: "AGMARKNET CSV",
    historyTitle: (variety: string) => `${variety} · ತಿಂಗಳ ಇತಿಹಾಸ`,
    historyHint: "ಆಯ್ದ ಅವಧಿಯವರೆಗಿನ 24 ಕ್ಯಾಲೆಂಡರ್ ತಿಂಗಳುಗಳು. ಇಲ್ಲದ ತಿಂಗಳುಗಳನ್ನು ತುಂಬುವುದಿಲ್ಲ. ಸಂಪೂರ್ಣ ವ್ಯಾಪ್ತಿ, ತಿದ್ದುಪಡಿಗಳು ಮತ್ತು ಅಂಕಿಅಂಶಗಳು ಐತಿಹಾಸಿಕ ವಿಶ್ಲೇಷಣೆಯಲ್ಲಿವೆ.",
    noHistory: "ಈ ಆಯ್ಕೆಗೆ ಸಂಗ್ರಹಿಸಿದ ಇತಿಹಾಸವಿಲ್ಲ", loadingChart: "ಚಾರ್ಟ್ ತರಲಾಗುತ್ತಿದೆ", chartLabel: (variety: string) => `${variety} · ಅಧಿಕೃತ ತಿಂಗಳ ತೂಕದ ಸರಾಸರಿ ದರ`,
    viewTable: "ತಿಂಗಳ ಪಟ್ಟಿ ನೋಡಿ", historyAria: "ಆಯ್ದ ತಳಿಯ ತಿಂಗಳ ಇತಿಹಾಸ", fetchedAt: "ತಂದ ಸಮಯ", noCaptured: "ಈ ತಳಿಯ ದಾಖಲೆ ಸಂಗ್ರಹವಾಗಿಲ್ಲ",
    methodTitle: "ವಿಧಾನ ಮತ್ತು ನವೀಕರಣ ಸ್ಥಿತಿ",
    methodology: "ರಾಜ್ಯ ಮತ್ತು ತಳಿ ಮಟ್ಟದ ಆವಕ ಆಧಾರಿತ ಮಾದರಿ ದರ: (ಆವಕ × ಮಾದರಿ ದರ) ಮೊತ್ತ / ಆವಕದ ಮೊತ್ತ. ಇದು ದೈನಂದಿನ ಮಾರುಕಟ್ಟೆ ದರವಲ್ಲ.",
    primaryOnly: "ಕೇಳಿದ ತಿಂಗಳ ಮುಖ್ಯ ದರ ಕಾಲಮ್ ಮಾತ್ರ ಸಂಗ್ರಹವಾಗುತ್ತದೆ. ಹೋಲಿಕೆ ಕಾಲಮ್‌ಗಳನ್ನು ಪ್ರತ್ಯೇಕ ವರದಿಗಳೆಂದು ಪರಿಗಣಿಸುವುದಿಲ್ಲ. ಮೂಲದ ತಳಿ ಹೆಸರುಗಳನ್ನು (ಸಿಪ್ಪೆ ಸಹಿತ ವಿಭಾಗಗಳು ಸೇರಿ) ಹಾಗೆಯೇ ಉಳಿಸಲಾಗುತ್ತದೆ.",
    schedule: "ನಿಯಮಿತ ವೇಳಾಪಟ್ಟಿ: ಪ್ರತಿದಿನ ಬೆಳಿಗ್ಗೆ 09:00 IST, ತಿದ್ದುಪಡಿಗಳನ್ನು ಹಿಡಿಯಲು ಹಿಂದಿನ ಎರಡು ಮುಗಿದ ತಿಂಗಳುಗಳನ್ನು ನವೀಕರಿಸುತ್ತದೆ. ಸ್ಥಳೀಯ ಅಭಿವೃದ್ಧಿಯಲ್ಲಿ ಕೆಳಗಿನ ನವೀಕರಣ ಕ್ರಮ ಬೇಕು; ವೇಳಾಪಟ್ಟಿ ತಾನಾಗಿ ನಡೆಯುವುದಿಲ್ಲ.",
    lastAttempt: "ಕೊನೆಯ ನವೀಕರಣ ಪ್ರಯತ್ನ:", refreshTitle: "ಅಧಿಕೃತ ವರದಿ ನವೀಕರಿಸಿ (ಪರಿಶೀಲಕರಿಗೆ)",
    refreshNote: "ಪರಿಶೀಲಿತ ಅಧಿಕೃತ ತಿಂಗಳ ವರದಿಗಳು ನೇರವಾಗಿ ಇಲ್ಲಿ ಪ್ರಕಟವಾಗುತ್ತವೆ, ದೈನಂದಿನ ಪರಿಶೀಲನಾ ಸರದಿಗೆ ಹೋಗುವುದಿಲ್ಲ. ನವೀಕರಣ ವಿಫಲವಾದರೂ ಈಗಿನ ದತ್ತಾಂಶ ಲಭ್ಯವಿರುತ್ತದೆ.",
    completedMonth: "ಮುಗಿದ ವರದಿ ತಿಂಗಳು", token: "ಪರಿಶೀಲಕರ ಟೋಕನ್", fetching: "ವರದಿ ತರಲಾಗುತ್ತಿದೆ...", fetch: "ಅಧಿಕೃತ ವರದಿ ತನ್ನಿ",
    fetched: (rows: number, month: string) => `${month} ಗೆ ${rows} ತಳಿ ಸಾಲುಗಳನ್ನು ತರಲಾಗಿದೆ.`,
  },
});

export function MonthlyTrendsPage() {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const format = useFormat();
  const monthLabel = (month: string) => format.month(month);
  const timestamp = (value: string) => format.timestamp(value);
  const [month, setMonth] = useState("");
  const [variety, setVariety] = useState("");
  const [token, setToken] = useState("");
  const [refreshMonth, setRefreshMonth] = useState(completedMonthIST);
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
    <section className="page-heading"><div>
      <h1>{t.title}</h1><p>{t.intro}</p></div><Link to="/history" className="button-secondary">{t.exploreHistory}</Link></section>
    <p className="page-meta">{t.meta}</p>
    <section className="filter-bar">
      <label className="filter-control"><span>{t.reportingMonth}</span><select value={month} onChange={(event) => setMonth(event.target.value)}>
        <option value="">{t.latestAvailable}</option>{data?.months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}
      </select></label>
      <label className="filter-control"><span>{t.varietyHistory}</span><select value={variety} onChange={(event) => setVariety(event.target.value)}>
        <option value="">{c.allVarieties}</option>{variety && !data?.data.some((row) => row.variety_name === variety) && <option>{variety}</option>}
        {data?.data.map((row) => <option key={row.variety_name} lang="en">{row.variety_name}</option>)}
      </select></label>
    </section>
    {query.isLoading ? <LoadingState label={t.loading} /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : <section className="panel table-panel">
      <div className="panel-heading"><div><h2>{data?.state} · {data?.reporting_month ? monthLabel(data.reporting_month) : t.noReport}</h2>
        <p>{t.lastFetched(latestFetch ? timestamp(latestFetch) : c.never)}{!variety && data?.data.length ? t.chooseVariety : ""}</p></div></div>
      {!data?.data.length ? <EmptyState title={t.noObservations}>{t.noObservationsHint}</EmptyState> :
        <div className="table-scroll table-tall" tabIndex={0} role="region" aria-label={t.tableAria}>
          <table><caption>{t.tableCaption}</caption>
            <thead><tr><th scope="col">{c.variety}</th><th scope="col" className="numeric">{t.weightedPrice}</th><th scope="col">{t.reportingMonth}</th><th scope="col">{c.source}</th></tr></thead>
            <tbody>{data.data.filter((row) => !variety || row.variety_name === variety).map((row) => <tr key={row.variety_name}>
              <td lang="en">{row.variety_name}</td><td className="numeric table-price">{price(row.weighted_price, c.notReported)}</td><td>{monthLabel(row.reporting_month)}</td>
              <td><a href={row.source_url} target="_blank" rel="noreferrer">{t.csv}</a></td></tr>)}</tbody>
          </table>
        </div>}
    </section>}
    {variety && data && <section className="panel table-panel"><div className="panel-heading"><div><h2>{t.historyTitle(variety)}</h2><p>{t.historyHint}</p></div></div>
      {!data.history.length ? <EmptyState title={t.noHistory} /> : <>{data.history.some((row) => row.weighted_price !== null) && <Suspense fallback={<LoadingState label={t.loadingChart} />}><PriceChart label={t.chartLabel(variety)} calendarInterval="monthly" range={{ from: `${[...data.history].sort((a, b) => a.reporting_month.localeCompare(b.reporting_month))[0].reporting_month}-01`, to: `${[...data.history].sort((a, b) => b.reporting_month.localeCompare(a.reporting_month))[0].reporting_month}-01` }} quotePoints={data.history.flatMap((row) => row.weighted_price === null ? [] : [{ reporting_date: `${row.reporting_month}-01`, average_price: row.weighted_price }])} /></Suspense>}<details className="chart-data"><summary>{t.viewTable}</summary><div className="table-scroll table-tall" tabIndex={0} role="region" aria-label={t.historyAria}>
        <table><caption>{variety} · {data.state} · {c.perQuintal}</caption><thead><tr><th scope="col">{t.reportingMonth}</th><th scope="col" className="numeric">{t.weightedPrice}</th><th scope="col">{t.fetchedAt}</th></tr></thead>
          <tbody>{data.history.map((row) => <tr key={row.reporting_month}><td>{monthLabel(row.reporting_month)}</td><td className="numeric">{price(row.weighted_price, c.notReported)}</td><td>{row.fetched_at ? timestamp(row.fetched_at) : t.noCaptured}</td></tr>)}</tbody>
        </table></div></details></>}
    </section>}
    {/* Method and refresh details are for reviewers; phones skip the section. */}
    <section className="panel phone-hide"><div className="panel-heading"><div><h2>{t.methodTitle}</h2><p>{t.methodology}</p></div></div>
      <div className="monthly-details">
        <p>{t.primaryOnly}</p>
        <p>{t.schedule}</p>
        {data?.last_run && <p role="status">{t.lastAttempt} <strong>{fetchStatusText(c, data.last_run.status)}</strong> · {monthLabel(data.last_run.reporting_month)} · {timestamp(data.last_run.started_at)}
          {data.last_run.error_message && <span> · {data.last_run.error_message}</span>}</p>}
        <details><summary>{t.refreshTitle}</summary>
          <p>{t.refreshNote}</p>
          <form className="monthly-refresh" onSubmit={(event) => { event.preventDefault(); refresh.mutate(); }}>
            <label className="filter-control"><span>{t.completedMonth}</span><input type="month" min="2010-01" value={refreshMonth} required disabled={refresh.isPending} onChange={(event) => setRefreshMonth(event.target.value)} /></label>
            <label className="filter-control"><span>{t.token}</span><input type="password" autoComplete="off" required value={token} disabled={refresh.isPending} onChange={(event) => setToken(event.target.value)} /></label>
            <button className="button-secondary" disabled={refresh.isPending || !token}>{refresh.isPending ? t.fetching : t.fetch}</button>
          </form>
          {refresh.error && <ErrorState error={refresh.error} />}
          {refresh.isSuccess && <p role="status">{t.fetched(refresh.data.record_count, monthLabel(refresh.data.reporting_month))}</p>}
        </details>
      </div>
    </section>
  </div>;
}

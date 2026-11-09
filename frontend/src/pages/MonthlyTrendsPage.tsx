import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { completedMonthIST } from "../../../shared/dates";
import { defineCopy, useCopy, useFormat } from "../services/language";
import { COMMON, fetchStatusText } from "../services/commonCopy";

const price = (value: number | null, missing: string) => value === null ? missing : new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(value);

const COPY = defineCopy({
  en: {
    snapshotTitle: "All varieties in one month", meta: "AGMARKNET monthly averages · ₹/quintal · not live auction prices · a gap means no report, not zero",
    reportingMonth: "Reporting month", latestAvailable: "Latest available",
    loading: "Loading monthly reports",
    lastFetched: (time: string) => `Last successfully fetched for this report: ${time}`,
    noObservations: "No monthly observations available", noObservationsHint: "An authorized refresh can fetch a completed reporting month. Daily imports do not populate this view.",
    tableAria: "Monthly weighted prices", tableCaption: "Reported state-level weighted prices, not individual market prices · INR / quintal",
    weightedPrice: "Weighted price", csv: "AGMARKNET CSV",
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
    snapshotTitle: "ಒಂದು ತಿಂಗಳ ಎಲ್ಲಾ ತಳಿಗಳು", meta: "AGMARKNET ತಿಂಗಳ ಸರಾಸರಿಗಳು · ₹/ಕ್ವಿಂಟಾಲ್ · ನೇರ ಹರಾಜು ದರಗಳಲ್ಲ · ಖಾಲಿ ಎಂದರೆ ವರದಿ ಇಲ್ಲ, ಸೊನ್ನೆಯಲ್ಲ",
    reportingMonth: "ವರದಿ ತಿಂಗಳು", latestAvailable: "ಇತ್ತೀಚಿನ ಲಭ್ಯ",
    loading: "ತಿಂಗಳ ವರದಿಗಳನ್ನು ತರಲಾಗುತ್ತಿದೆ",
    lastFetched: (time: string) => `ಈ ವರದಿಯನ್ನು ಕೊನೆಯ ಬಾರಿ ಯಶಸ್ವಿಯಾಗಿ ತಂದದ್ದು: ${time}`,
    noObservations: "ತಿಂಗಳ ದಾಖಲೆಗಳು ಲಭ್ಯವಿಲ್ಲ", noObservationsHint: "ಅಧಿಕೃತ ನವೀಕರಣವು ಮುಗಿದ ವರದಿ ತಿಂಗಳನ್ನು ತರಬಹುದು. ದೈನಂದಿನ ಆಮದುಗಳು ಈ ಪುಟವನ್ನು ತುಂಬುವುದಿಲ್ಲ.",
    tableAria: "ತಿಂಗಳ ತೂಕದ ಸರಾಸರಿ ದರಗಳು", tableCaption: "ವರದಿಯಾದ ರಾಜ್ಯ ಮಟ್ಟದ ತೂಕದ ಸರಾಸರಿ ದರಗಳು, ಪ್ರತ್ಯೇಕ ಮಾರುಕಟ್ಟೆ ದರಗಳಲ್ಲ · ₹ / ಕ್ವಿಂಟಾಲ್",
    weightedPrice: "ತೂಕದ ಸರಾಸರಿ ದರ", csv: "AGMARKNET CSV",
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

/**
 * The Monthly trends page's "all varieties in one month" table and its reviewer refresh form. They used to be a page of
 * their own; that page duplicated the variety history now shown once on Monthly trends (HistoricalAnalyticsPage).
 */
export function MonthlySnapshot() {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const format = useFormat();
  const monthLabel = (month: string) => format.month(month);
  const [month, setMonth] = useState("");
  const query = useQuery({ queryKey: ["monthly-prices", month, ""], queryFn: () => api.monthlyPrices(month || undefined, undefined), refetchInterval: 60_000 });
  const data = query.data;
  const latestFetch = data?.data.reduce((latest, row) => row.fetched_at > latest ? row.fetched_at : latest, "");
  return <section className="panel table-panel">
    <div className="panel-heading"><div><h2>{t.snapshotTitle}{data?.reporting_month ? ` · ${monthLabel(data.reporting_month)}` : ""}</h2>
      <p className="phone-hide">{t.meta} · {t.lastFetched(latestFetch ? format.timestamp(latestFetch) : c.never)}</p></div>
      <label className="filter-control"><span>{t.reportingMonth}</span><select value={month} onChange={(event) => setMonth(event.target.value)}>
        <option value="">{t.latestAvailable}</option>{data?.months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}
      </select></label></div>
    {query.isLoading ? <LoadingState label={t.loading} /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      : !data?.data.length ? <EmptyState title={t.noObservations}>{t.noObservationsHint}</EmptyState> :
      <div className="table-scroll table-tall" tabIndex={0} role="region" aria-label={t.tableAria}>
        <table><caption>{t.tableCaption}</caption>
          <thead><tr><th scope="col">{c.variety}</th><th scope="col" className="numeric">{t.weightedPrice}</th><th scope="col">{t.reportingMonth}</th><th scope="col">{c.source}</th></tr></thead>
          <tbody>{data.data.map((row) => <tr key={row.variety_name}>
            <td lang="en">{row.variety_name}</td><td className="numeric table-price">{price(row.weighted_price, c.notReported)}</td><td>{monthLabel(row.reporting_month)}</td>
            <td><a href={row.source_url} target="_blank" rel="noreferrer">{t.csv}</a></td></tr>)}</tbody>
        </table>
      </div>}
  </section>;
}

/** Method notes and the reviewer-only refresh of an official month. For reviewers, so phones skip it. */
export function MonthlyRefresh() {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const format = useFormat();
  const monthLabel = (month: string) => format.month(month);
  const [token, setToken] = useState("");
  const [refreshMonth, setRefreshMonth] = useState(completedMonthIST);
  const client = useQueryClient();
  const status = useQuery({ queryKey: ["monthly-prices", "", ""], queryFn: () => api.monthlyPrices(undefined, undefined), refetchInterval: 60_000 });
  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ["monthly-prices"] });
    await client.invalidateQueries({ queryKey: ["history"] });
  };
  const refresh = useMutation({
    mutationFn: () => api.refreshMonthly(refreshMonth, token),
    onSuccess: async () => { setToken(""); await invalidate(); await client.invalidateQueries({ queryKey: ["decision-prices"] }); },
    onError: invalidate,
  });
  const lastRun = status.data?.last_run;
  return <section className="panel phone-hide"><div className="panel-heading"><div><h2>{t.methodTitle}</h2><p>{t.methodology}</p></div></div>
    <div className="monthly-details">
      <p>{t.primaryOnly}</p>
      <p>{t.schedule}</p>
      {lastRun && <p role="status">{t.lastAttempt} <strong>{fetchStatusText(c, lastRun.status)}</strong> · {monthLabel(lastRun.reporting_month)} · {format.timestamp(lastRun.started_at)}
        {lastRun.error_message && <span> · {lastRun.error_message}</span>}</p>}
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
  </section>;
}

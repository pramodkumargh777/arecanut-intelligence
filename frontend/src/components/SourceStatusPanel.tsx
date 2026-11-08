import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import type { SourceRun, SourceStatus } from "../types";
import { EmptyState, ErrorState, LoadingState } from "./State";
import { defineCopy, useCopy, useFormat } from "../services/language";

const COPY = defineCopy({
  en: {
    runStatus: { completed: "Completed", completed_with_rejections: "Completed with rejections", no_data: "No data returned", failed: "Failed" } as Record<SourceRun["status"], string>,
    failed: (message: string) => `Failed: ${message}`, noMessage: "no error message recorded",
    counts: (fetched: number, accepted: number, rejected: number, inserted: number, duplicates: number, corrected: number) =>
      `${fetched} fetched · ${accepted} accepted · ${rejected} rejected · ${inserted} new · ${duplicates} already stored · ${corrected} corrected`,
    disabled: " · disabled",
    latest: (state: string, date: string, observations: number, markets: number, dates: number, since: string) =>
      `Latest ${state} market date: ${date} · ${observations} observations across ${markets} markets · ${dates} reporting date${dates === 1 ? "" : "s"} since ${since}`,
    fetch: (fetched: string, stored: string) => `Platform fetch: ${fetched} · Stored: ${stored}`, notCaptured: "Not captured",
    noObservations: (state: string) => `No ${state} observations stored for this source.`,
    byStatus: (text: string) => `Observations by status: ${text}`, none: "none",
    lastRun: (mode: string, status: string, time: string) => `Last run (${mode}, ${status}) ${time}`, sourceUpdated: (time: string) => ` · source updated ${time}`, noRun: "No connector run recorded.",
    title: "Data-source status", intro: "Official AGMARKNET daily connector runs, stored coverage and rejected source records. Imported observations still require review before publication.",
    loading: "Loading data-source status", noStatus: "No status available", noStatusHint: "The API did not return source status.",
    runsAria: "Recent connector runs", runsCaption: "Recent connector runs (timestamps in IST)",
    completedCol: "Completed", source: "Source", mode: "Mode", status: "Status", dates: "Market dates", fetched: "Fetched", accepted: "Accepted", rejected: "Rejected", inserted: "New", duplicates: "Duplicates", corrected: "Corrected",
    rejectedRecords: (n: number) => `Rejected source records (${n} most recent)`, unidentified: "Unidentified record",
  },
  kn: {
    runStatus: { completed: "ಪೂರ್ಣಗೊಂಡಿದೆ", completed_with_rejections: "ಕೆಲವು ತಿರಸ್ಕಾರಗಳೊಂದಿಗೆ ಪೂರ್ಣ", no_data: "ದತ್ತಾಂಶ ಬಂದಿಲ್ಲ", failed: "ವಿಫಲ" },
    failed: (message: string) => `ವಿಫಲ: ${message}`, noMessage: "ದೋಷ ಸಂದೇಶ ದಾಖಲಾಗಿಲ್ಲ",
    counts: (fetched: number, accepted: number, rejected: number, inserted: number, duplicates: number, corrected: number) =>
      `${fetched} ತಂದದ್ದು · ${accepted} ಸ್ವೀಕೃತ · ${rejected} ತಿರಸ್ಕೃತ · ${inserted} ಹೊಸದು · ${duplicates} ಈಗಾಗಲೇ ಇದೆ · ${corrected} ತಿದ್ದಲಾಗಿದೆ`,
    disabled: " · ನಿಷ್ಕ್ರಿಯ",
    latest: (state: string, date: string, observations: number, markets: number, dates: number, since: string) =>
      `${state} ಇತ್ತೀಚಿನ ಮಾರುಕಟ್ಟೆ ದಿನಾಂಕ: ${date} · ${markets} ಮಾರುಕಟ್ಟೆಗಳಲ್ಲಿ ${observations} ದಾಖಲೆಗಳು · ${since} ರಿಂದ ${dates} ವರದಿ ದಿನಾಂಕಗಳು`,
    fetch: (fetched: string, stored: string) => `ತಂದ ಸಮಯ: ${fetched} · ಸಂಗ್ರಹಿಸಿದ್ದು: ${stored}`, notCaptured: "ದಾಖಲಾಗಿಲ್ಲ",
    noObservations: (state: string) => `ಈ ಮೂಲಕ್ಕೆ ${state} ದಾಖಲೆಗಳು ಸಂಗ್ರಹವಾಗಿಲ್ಲ.`,
    byStatus: (text: string) => `ಸ್ಥಿತಿವಾರು ದಾಖಲೆಗಳು: ${text}`, none: "ಯಾವುದೂ ಇಲ್ಲ",
    lastRun: (mode: string, status: string, time: string) => `ಕೊನೆಯ ಸಂಗ್ರಹ (${mode}, ${status}) ${time}`, sourceUpdated: (time: string) => ` · ಮೂಲ ನವೀಕರಿಸಿದ್ದು ${time}`, noRun: "ಯಾವುದೇ ಸಂಗ್ರಹ ದಾಖಲಾಗಿಲ್ಲ.",
    title: "ದತ್ತಾಂಶ ಮೂಲದ ಸ್ಥಿತಿ", intro: "ಅಧಿಕೃತ AGMARKNET ದೈನಂದಿನ ಸಂಗ್ರಹಗಳು, ಸಂಗ್ರಹಿತ ವ್ಯಾಪ್ತಿ ಮತ್ತು ತಿರಸ್ಕೃತ ಮೂಲ ದಾಖಲೆಗಳು. ಆಮದು ಮಾಡಿದ ದಾಖಲೆಗಳು ಪ್ರಕಟಣೆಗೆ ಮೊದಲು ಪರಿಶೀಲನೆ ಬೇಕು.",
    loading: "ಮೂಲದ ಸ್ಥಿತಿ ತರಲಾಗುತ್ತಿದೆ", noStatus: "ಸ್ಥಿತಿ ಲಭ್ಯವಿಲ್ಲ", noStatusHint: "API ಮೂಲದ ಸ್ಥಿತಿಯನ್ನು ನೀಡಲಿಲ್ಲ.",
    runsAria: "ಇತ್ತೀಚಿನ ಸಂಗ್ರಹಗಳು", runsCaption: "ಇತ್ತೀಚಿನ ಸಂಗ್ರಹಗಳು (ಸಮಯ ಭಾರತೀಯ ಕಾಲಮಾನ)",
    completedCol: "ಪೂರ್ಣಗೊಂಡದ್ದು", source: "ಮೂಲ", mode: "ವಿಧಾನ", status: "ಸ್ಥಿತಿ", dates: "ಮಾರುಕಟ್ಟೆ ದಿನಾಂಕಗಳು", fetched: "ತಂದದ್ದು", accepted: "ಸ್ವೀಕೃತ", rejected: "ತಿರಸ್ಕೃತ", inserted: "ಹೊಸದು", duplicates: "ಪುನರಾವರ್ತಿತ", corrected: "ತಿದ್ದಲಾಗಿದೆ",
    rejectedRecords: (n: number) => `ತಿರಸ್ಕೃತ ಮೂಲ ದಾಖಲೆಗಳು (ಇತ್ತೀಚಿನ ${n})`, unidentified: "ಗುರುತಿಲ್ಲದ ದಾಖಲೆ",
  },
});

type Copy = typeof COPY.en;
function describe(run: SourceRun, t: Copy): string {
  if (run.status === "failed") return t.failed(run.error_message ?? t.noMessage);
  return t.counts(run.fetched_count, run.accepted_count, run.rejected_count, run.inserted_count, run.duplicate_count, run.corrected_count);
}

function SourceCard({ source, state }: { source: SourceStatus["sources"][number]; state: string }) {
  const t = useCopy(COPY);
  const format = useFormat();
  const counts = Object.entries(source.observation_counts);
  const run = source.last_run;
  return <article className="source-status-card">
    <strong>{source.name}<span>{source.source_key}{source.is_enabled ? "" : t.disabled}</span></strong>
    {source.coverage ? <p>
      {t.latest(state, format.date(source.coverage.latest_reporting_date), source.coverage.latest_date_observations, source.coverage.latest_date_markets, source.coverage.reporting_date_count, format.date(source.coverage.earliest_reporting_date))}<br />
      {t.fetch(source.coverage.latest_platform_fetch ? format.timestamp(source.coverage.latest_platform_fetch) : t.notCaptured, format.timestamp(source.coverage.latest_ingested_at))}
    </p> : <p>{t.noObservations(state)}</p>}
    <p>{t.byStatus(counts.length ? counts.map(([status, count]) => `${status} ${count}`).join(" · ") : t.none)}</p>
    {run ? <p className={run.status === "failed" ? "message-error" : undefined}>
      {t.lastRun(run.mode, t.runStatus[run.status], format.timestamp(run.completed_at))}{run.source_updated_at ? t.sourceUpdated(format.timestamp(run.source_updated_at)) : ""}<br />{describe(run, t)}
    </p> : <p>{t.noRun}</p>}
  </article>;
}

export function SourceStatusPanel({ token }: { token: string }) {
  const t = useCopy(COPY);
  const format = useFormat();
  const status = useQuery({ queryKey: ["source-status", token], queryFn: () => api.sourceStatus(token), enabled: Boolean(token) });
  const rejected = status.data?.recent_runs.flatMap((run) => run.rejected_sample.map((item, index) => ({ run, item, index }))).slice(0, 10) ?? [];
  return <section className="panel review-panel">
    <div className="panel-heading"><div><h2>{t.title}</h2><p>{t.intro}</p></div></div>
    {status.isLoading ? <LoadingState label={t.loading} /> : status.error ? <ErrorState error={status.error} onRetry={() => void status.refetch()} /> : !status.data ? <EmptyState title={t.noStatus}>{t.noStatusHint}</EmptyState> : <>
      <div className="source-status-grid">{status.data.sources.map((source) => <SourceCard key={source.source_key} source={source} state={status.data.reference_state} />)}</div>
      {status.data.recent_runs.length > 0 && <div className="table-scroll" tabIndex={0} role="region" aria-label={t.runsAria}><table>
        <caption>{t.runsCaption}</caption>
        <thead><tr><th>{t.completedCol}</th><th>{t.source}</th><th>{t.mode}</th><th>{t.status}</th><th>{t.dates}</th><th>{t.fetched}</th><th>{t.accepted}</th><th>{t.rejected}</th><th>{t.inserted}</th><th>{t.duplicates}</th><th>{t.corrected}</th></tr></thead>
        <tbody>{status.data.recent_runs.map((run) => <tr key={run.id}>
          <td className="table-market">{format.timestamp(run.completed_at)}</td><td>{run.source_key}</td><td>{run.mode}</td><td title={run.error_message ?? undefined}>{t.runStatus[run.status]}</td>
          <td>{run.reporting_dates.length ? run.reporting_dates.map((date) => format.date(date)).join(", ") : "—"}</td>
          <td>{run.fetched_count}</td><td>{run.accepted_count}</td><td>{run.rejected_count}</td><td>{run.inserted_count}</td><td>{run.duplicate_count}</td><td>{run.corrected_count}</td>
        </tr>)}</tbody>
      </table></div>}
      {rejected.length > 0 && <details className="review-evidence"><summary>{t.rejectedRecords(rejected.length)}</summary><ul lang="en">{rejected.map(({ run, item, index }) => <li key={`${run.id}-${index}`}>{item.source_record_id ?? t.unidentified}: {item.reasons.map((reason) => reason.message).join("; ")}</li>)}</ul></details>}
      <ul className="source-status-limitations" lang="en">{status.data.limitations.map((text) => <li key={text}>{text}</li>)}</ul>
    </>}
  </section>;
}

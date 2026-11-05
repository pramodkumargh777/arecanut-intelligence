import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import type { SourceRun, SourceStatus } from "../types";
import { EmptyState, ErrorState, LoadingState } from "./State";
import { formatCalendarDate, formatTimestampIST } from "../../../shared/dates";

const RUN_STATUS: Record<SourceRun["status"], string> = {
  completed: "Completed",
  completed_with_rejections: "Completed with rejections",
  no_data: "No data returned",
  failed: "Failed",
};

export function describeRun(run: SourceRun): string {
  if (run.status === "failed") return `Failed: ${run.error_message ?? "no error message recorded"}`;
  return `${run.fetched_count} fetched · ${run.accepted_count} accepted · ${run.rejected_count} rejected · ${run.inserted_count} new · ${run.duplicate_count} already stored · ${run.corrected_count} corrected`;
}

function SourceCard({ source, state }: { source: SourceStatus["sources"][number]; state: string }) {
  const counts = Object.entries(source.observation_counts);
  const run = source.last_run;
  return <article className="source-status-card">
    <strong>{source.name}<span>{source.source_key}{source.is_enabled ? "" : " · disabled"}</span></strong>
    {source.coverage ? <p>
      Latest {state} market date: <b>{formatCalendarDate(source.coverage.latest_reporting_date)}</b> · {source.coverage.latest_date_observations} observations across {source.coverage.latest_date_markets} markets · {source.coverage.reporting_date_count} reporting date{source.coverage.reporting_date_count === 1 ? "" : "s"} since {formatCalendarDate(source.coverage.earliest_reporting_date)}<br />
      Platform fetch: {source.coverage.latest_platform_fetch ? formatTimestampIST(source.coverage.latest_platform_fetch) : "Not captured"} · Stored: {formatTimestampIST(source.coverage.latest_ingested_at)}
    </p> : <p>No {state} observations stored for this source.</p>}
    <p>Observations by status: {counts.length ? counts.map(([status, count]) => `${status} ${count}`).join(" · ") : "none"}</p>
    {run ? <p className={run.status === "failed" ? "message-error" : undefined}>
      Last run ({run.mode}, {RUN_STATUS[run.status]}) {formatTimestampIST(run.completed_at)}{run.source_updated_at ? ` · source updated ${formatTimestampIST(run.source_updated_at)}` : ""}<br />{describeRun(run)}
    </p> : <p>No connector run recorded.</p>}
  </article>;
}

export function SourceStatusPanel({ token }: { token: string }) {
  const status = useQuery({ queryKey: ["source-status", token], queryFn: () => api.sourceStatus(token), enabled: Boolean(token) });
  const rejected = status.data?.recent_runs.flatMap((run) => run.rejected_sample.map((item, index) => ({ run, item, index }))).slice(0, 10) ?? [];
  return <section className="panel review-panel">
    <div className="panel-heading"><div><h2>Data-source status</h2><p>Official AGMARKNET daily connector runs, stored coverage and rejected source records. Imported observations still require review before publication.</p></div></div>
    {status.isLoading ? <LoadingState label="Loading data-source status" /> : status.error ? <ErrorState error={status.error} onRetry={() => void status.refetch()} /> : !status.data ? <EmptyState title="No status available">The API did not return source status.</EmptyState> : <>
      <div className="source-status-grid">{status.data.sources.map((source) => <SourceCard key={source.source_key} source={source} state={status.data.reference_state} />)}</div>
      {status.data.recent_runs.length > 0 && <div className="table-scroll" tabIndex={0} role="region" aria-label="Recent connector runs"><table>
        <caption>Recent connector runs (timestamps in IST)</caption>
        <thead><tr><th>Completed</th><th>Source</th><th>Mode</th><th>Status</th><th>Market dates</th><th>Fetched</th><th>Accepted</th><th>Rejected</th><th>New</th><th>Duplicates</th><th>Corrected</th></tr></thead>
        <tbody>{status.data.recent_runs.map((run) => <tr key={run.id}>
          <td className="table-market">{formatTimestampIST(run.completed_at)}</td><td>{run.source_key}</td><td>{run.mode}</td><td title={run.error_message ?? undefined}>{RUN_STATUS[run.status]}</td>
          <td>{run.reporting_dates.length ? run.reporting_dates.map(formatCalendarDate).join(", ") : "—"}</td>
          <td>{run.fetched_count}</td><td>{run.accepted_count}</td><td>{run.rejected_count}</td><td>{run.inserted_count}</td><td>{run.duplicate_count}</td><td>{run.corrected_count}</td>
        </tr>)}</tbody>
      </table></div>}
      {rejected.length > 0 && <details className="review-evidence"><summary>Rejected source records ({rejected.length} most recent)</summary><ul>{rejected.map(({ run, item, index }) => <li key={`${run.id}-${index}`}>{item.source_record_id ?? "Unidentified record"}: {item.reasons.map((reason) => reason.message).join("; ")}</li>)}</ul></details>}
      <ul className="source-status-limitations">{status.data.limitations.map((text) => <li key={text}>{text}</li>)}</ul>
    </>}
  </section>;
}

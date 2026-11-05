import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { describeFreshness, type CooperativeSourceStatus, type PermissionStatus } from "../services/cooperative";
import { EmptyState, ErrorState, LoadingState } from "./State";
import { formatCalendarDate, formatTimestampIST } from "../../../shared/dates";

type Source = CooperativeSourceStatus["sources"][number];

const AVAILABILITY: Record<Source["availability"]["state"], string> = {
  available: "Available",
  running: "Fetch in progress",
  failing: "Failing",
  never_fetched: "Never fetched",
};
function PermissionForm({ source, token }: { source: Source; token: string }) {
  const client = useQueryClient();
  const [status, setStatus] = useState<PermissionStatus>(source.permission.status);
  const [scheduled, setScheduled] = useState(source.permission.scheduled_collection_allowed);
  const [redistribution, setRedistribution] = useState(source.permission.redistribution_allowed);
  const [reference, setReference] = useState(source.permission.permission_reference ?? "");
  const update = useMutation({
    mutationFn: () => api.updateCooperativePermission(token, source.source_key, {
      permission_status: status, scheduled_collection_allowed: status === "granted" && scheduled,
      redistribution_allowed: status === "granted" && redistribution, permission_reference: reference.trim() || null,
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["cooperative-sources"] }),
  });
  const needsReference = status === "granted" && reference.trim().length < 3;
  return <details className="review-evidence"><summary>Record permission decision</summary>
    <form className="monthly-refresh" onSubmit={(event: FormEvent) => { event.preventDefault(); update.mutate(); }}>
      <label className="filter-control"><span>Permission status</span><select value={status} onChange={(event) => setStatus(event.target.value as PermissionStatus)}>
        <option value="not_requested">Not requested</option><option value="requested">Requested</option><option value="granted">Granted</option><option value="denied">Denied</option></select></label>
      <label className="filter-control"><span>Written permission reference</span><input value={reference} maxLength={500} onChange={(event) => setReference(event.target.value)} placeholder="Letter, email or agreement reference" /></label>
      <label><input type="checkbox" checked={scheduled} disabled={status !== "granted"} onChange={(event) => setScheduled(event.target.checked)} /> Scheduled collection permitted</label>
      <label><input type="checkbox" checked={redistribution} disabled={status !== "granted"} onChange={(event) => setRedistribution(event.target.checked)} /> Redistribution permitted</label>
      <button className="button-secondary" disabled={update.isPending || needsReference}>{update.isPending ? "Saving..." : "Save permission record"}</button>
    </form>
    {needsReference && <p role="note">A granted permission requires a written reference.</p>}
    {update.error && <ErrorState error={update.error} />}
    {update.isSuccess && <p role="status">Permission record saved.</p>}
  </details>;
}

function SourceCard({ source, token }: { source: Source; token: string }) {
  const { availability, permission } = source;
  return <article className="source-status-card">
    <strong>{source.display_name}<span>{source.source_key} · {source.operator}</span></strong>
    <p className={availability.state === "failing" ? "message-error" : undefined}>
      Availability: <b>{AVAILABILITY[availability.state]}</b>
      {availability.last_attempt_at ? ` · last attempt ${formatTimestampIST(availability.last_attempt_at)}` : ""}
      {availability.http_status ? ` · HTTP ${availability.http_status}` : ""}
      {availability.attempts ? ` · ${availability.attempts} attempt${availability.attempts === 1 ? "" : "s"}` : ""}<br />
      Last successful fetch: {source.last_success_at ? formatTimestampIST(source.last_success_at) : "None recorded"}
    </p>
    {source.commodity_status.length ? source.commodity_status.map((item) => <p key={item.commodity}>
      <b>{item.commodity === "black_pepper" ? "Black pepper" : "Arecanut"}</b>: {describeFreshness(item)}<br />
      Status: {Object.entries(item.by_status).map(([key, count]) => `${key} ${count}`).join(" · ")} · Unit: {Object.entries(item.by_unit_status).map(([key, count]) => `${key} ${count}`).join(" · ")}
    </p>) : <p>No quotations stored for this source.</p>}
    <p>Permission: <b>{permission.label}</b> · Scheduled collection {permission.scheduled_collection_allowed ? "allowed" : "not allowed"} · Redistribution {permission.redistribution_allowed ? "allowed" : "not allowed"}
      {permission.permission_reference ? ` · Reference: ${permission.permission_reference}` : ""}<br />
      Robots: {permission.robots_status} · Terms: {permission.terms_status} (checked {formatCalendarDate(permission.terms_checked_at)})</p>
    <p>Unit evidence: {source.unit_evidence}</p>
    {source.recent_failures.length > 0 && <details className="review-evidence"><summary>Recent failures and blocked runs ({source.recent_failures.length})</summary><ul>
      {source.recent_failures.map((failure) => <li key={failure.fetch_id}>{formatTimestampIST(failure.started_at)} · {failure.status}{failure.ingest_mode ? ` (${failure.ingest_mode})` : ""}{failure.http_status ? ` · HTTP ${failure.http_status}` : ""}: {failure.reason ?? "No reason recorded"}</li>)}
    </ul></details>}
    {source.recent_fetches.length > 0 && <details className="review-evidence"><summary>Recent fetches (stored snapshot IDs for replay)</summary><ul>
      {source.recent_fetches.map((fetch) => <li key={fetch.fetch_id}><code>{fetch.fetch_id}</code> · {formatTimestampIST(fetch.started_at)} · {fetch.status}{fetch.ingest_mode ? ` (${fetch.ingest_mode})` : ""} · received {fetch.received_count ?? "—"} · new {fetch.inserted_count ?? "—"}</li>)}
    </ul></details>}
    <PermissionForm key={`${permission.status}:${permission.permission_reference ?? ""}`} source={source} token={token} />
  </article>;
}

export function CooperativeSourceStatusPanel({ token }: { token: string }) {
  const status = useQuery({ queryKey: ["cooperative-sources", token], queryFn: () => api.cooperativeSources(token), enabled: Boolean(token) });
  return <section className="panel review-panel">
    <div className="panel-heading"><div><h2>Cooperative source intelligence</h2><p>Availability, freshness, permission and failure reasons for MAMCOS, TSS and TUMCOS. Freshness uses market reporting dates (IST calendar), not fetch times.</p></div></div>
    {status.isLoading ? <LoadingState label="Loading cooperative source status" /> : status.error ? <ErrorState error={status.error} onRetry={() => void status.refetch()} /> : !status.data ? <EmptyState title="No status available">The API did not return cooperative source status.</EmptyState> : <>
      <div className="source-status-grid">{status.data.sources.map((source) => <SourceCard key={source.source_key} source={source} token={token} />)}</div>
      <ul className="source-status-limitations">
        <li>Scheduled collection runs only when the source's schedule flag is enabled and a granted permission with scheduled collection is recorded; otherwise the run is recorded as blocked.</li>
        <li>Records are stale when the latest stored market reporting date is more than 7 days old. Stale or missing dates are never filled.</li>
        <li>Status generated {formatTimestampIST(status.data.generated_at)} · market calendar today {formatCalendarDate(status.data.market_calendar_today)}.</li>
      </ul>
    </>}
  </section>;
}

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { describeFreshness, type CooperativeSourceStatus, type PermissionStatus } from "../services/cooperative";
import { EmptyState, ErrorState, LoadingState } from "./State";
import { defineCopy, useCopy, useFormat } from "../services/language";
import { fetchStatusText, COMMON } from "../services/commonCopy";

type Source = CooperativeSourceStatus["sources"][number];

const COPY = defineCopy({
  en: {
    availability: { available: "Available", running: "Fetch in progress", failing: "Failing", never_fetched: "Never fetched" } as Record<Source["availability"]["state"], string>,
    permissionStatus: { not_requested: "Not requested", requested: "Requested", granted: "Granted", denied: "Denied" } as Record<PermissionStatus, string>,
    permissionLabel: (status: string, redistribution: boolean) => status === "granted" && redistribution ? "Permission recorded for collection and redistribution"
      : status === "granted" ? "Collection permission recorded; redistribution not confirmed" : status === "denied" ? "Permission denied"
      : status === "requested" ? "Permission requested; not confirmed" : "Permission not confirmed",
    record: "Record permission decision", status: "Permission status", reference: "Written permission reference", referencePlaceholder: "Letter, email or agreement reference",
    scheduled: "Scheduled collection permitted", redistribution: "Redistribution permitted", saving: "Saving...", save: "Save permission record",
    needsReference: "A granted permission requires a written reference.", saved: "Permission record saved.",
    availabilityLine: "Availability:", lastAttempt: (time: string) => ` · last attempt ${time}`, attempts: (n: number) => ` · ${n} attempt${n === 1 ? "" : "s"}`,
    lastSuccess: (time: string) => `Last successful fetch: ${time}`, noneRecorded: "None recorded",
    arecanut: "Arecanut", blackPepper: "Black pepper", statusLine: (status: string, unit: string) => `Status: ${status} · Unit: ${unit}`, noQuotes: "No quotations stored for this source.",
    permission: "Permission:", allowed: (what: string, allowed: boolean) => ` · ${what} ${allowed ? "allowed" : "not allowed"}`, scheduledWord: "Scheduled collection", redistributionWord: "Redistribution",
    referenceLine: (reference: string) => ` · Reference: ${reference}`, robots: (robots: string, terms: string, checked: string) => `Robots: ${robots} · Terms: ${terms} (checked ${checked})`,
    unitEvidence: "Unit evidence:", failures: (n: number) => `Recent failures and blocked runs (${n})`, noReason: "No reason recorded",
    fetches: "Recent fetches (stored snapshot IDs for replay)", fetchLine: (received: string, inserted: string) => ` · received ${received} · new ${inserted}`,
    title: "Cooperative source intelligence", intro: "Availability, freshness, permission and failure reasons for MAMCOS, TSS and TUMCOS. Freshness uses market reporting dates (IST calendar), not fetch times.",
    loading: "Loading cooperative source status", noStatus: "No status available", noStatusHint: "The API did not return cooperative source status.",
    rule1: "Scheduled collection runs only when the source's schedule flag is enabled and a granted permission with scheduled collection is recorded; otherwise the run is recorded as blocked.",
    rule2: "Records are stale when the latest stored market reporting date is more than 7 days old. Stale or missing dates are never filled.",
    generated: (time: string, today: string) => `Status generated ${time} · market calendar today ${today}.`,
  },
  kn: {
    availability: { available: "ಲಭ್ಯ", running: "ಸಂಗ್ರಹ ನಡೆಯುತ್ತಿದೆ", failing: "ವಿಫಲವಾಗುತ್ತಿದೆ", never_fetched: "ಎಂದೂ ತಂದಿಲ್ಲ" },
    permissionStatus: { not_requested: "ಕೋರಿಲ್ಲ", requested: "ಕೋರಲಾಗಿದೆ", granted: "ನೀಡಲಾಗಿದೆ", denied: "ನಿರಾಕರಿಸಲಾಗಿದೆ" },
    permissionLabel: (status: string, redistribution: boolean) => status === "granted" && redistribution ? "ಸಂಗ್ರಹ ಮತ್ತು ಮರುಪ್ರಕಟಣೆಗೆ ಅನುಮತಿ ದಾಖಲಾಗಿದೆ"
      : status === "granted" ? "ಸಂಗ್ರಹಕ್ಕೆ ಅನುಮತಿ ದಾಖಲಾಗಿದೆ; ಮರುಪ್ರಕಟಣೆ ದೃಢಪಟ್ಟಿಲ್ಲ" : status === "denied" ? "ಅನುಮತಿ ನಿರಾಕರಿಸಲಾಗಿದೆ"
      : status === "requested" ? "ಅನುಮತಿ ಕೋರಲಾಗಿದೆ; ದೃಢಪಟ್ಟಿಲ್ಲ" : "ಅನುಮತಿ ದೃಢಪಟ್ಟಿಲ್ಲ",
    record: "ಅನುಮತಿ ನಿರ್ಧಾರ ದಾಖಲಿಸಿ", status: "ಅನುಮತಿ ಸ್ಥಿತಿ", reference: "ಲಿಖಿತ ಅನುಮತಿ ಉಲ್ಲೇಖ", referencePlaceholder: "ಪತ್ರ, ಇಮೇಲ್ ಅಥವಾ ಒಪ್ಪಂದದ ಉಲ್ಲೇಖ",
    scheduled: "ನಿಯಮಿತ ಸಂಗ್ರಹಕ್ಕೆ ಅನುಮತಿ", redistribution: "ಮರುಪ್ರಕಟಣೆಗೆ ಅನುಮತಿ", saving: "ಉಳಿಸಲಾಗುತ್ತಿದೆ...", save: "ಅನುಮತಿ ದಾಖಲೆ ಉಳಿಸಿ",
    needsReference: "ನೀಡಿದ ಅನುಮತಿಗೆ ಲಿಖಿತ ಉಲ್ಲೇಖ ಬೇಕು.", saved: "ಅನುಮತಿ ದಾಖಲೆ ಉಳಿಸಲಾಗಿದೆ.",
    availabilityLine: "ಲಭ್ಯತೆ:", lastAttempt: (time: string) => ` · ಕೊನೆಯ ಪ್ರಯತ್ನ ${time}`, attempts: (n: number) => ` · ${n} ಪ್ರಯತ್ನಗಳು`,
    lastSuccess: (time: string) => `ಕೊನೆಯ ಯಶಸ್ವಿ ಸಂಗ್ರಹ: ${time}`, noneRecorded: "ದಾಖಲಾಗಿಲ್ಲ",
    arecanut: "ಅಡಿಕೆ", blackPepper: "ಕರಿಮೆಣಸು", statusLine: (status: string, unit: string) => `ಸ್ಥಿತಿ: ${status} · ಘಟಕ: ${unit}`, noQuotes: "ಈ ಮೂಲಕ್ಕೆ ದರಗಳು ಸಂಗ್ರಹವಾಗಿಲ್ಲ.",
    permission: "ಅನುಮತಿ:", allowed: (what: string, allowed: boolean) => ` · ${what} ${allowed ? "ಅನುಮತಿಸಲಾಗಿದೆ" : "ಅನುಮತಿಸಿಲ್ಲ"}`, scheduledWord: "ನಿಯಮಿತ ಸಂಗ್ರಹ", redistributionWord: "ಮರುಪ್ರಕಟಣೆ",
    referenceLine: (reference: string) => ` · ಉಲ್ಲೇಖ: ${reference}`, robots: (robots: string, terms: string, checked: string) => `Robots: ${robots} · ನಿಯಮಗಳು: ${terms} (ಪರಿಶೀಲಿಸಿದ್ದು ${checked})`,
    unitEvidence: "ಘಟಕದ ಆಧಾರ:", failures: (n: number) => `ಇತ್ತೀಚಿನ ವಿಫಲ ಮತ್ತು ತಡೆಹಿಡಿದ ಸಂಗ್ರಹಗಳು (${n})`, noReason: "ಕಾರಣ ದಾಖಲಾಗಿಲ್ಲ",
    fetches: "ಇತ್ತೀಚಿನ ಸಂಗ್ರಹಗಳು (ಮರು-ಓದಿಗೆ ಸಂಗ್ರಹ ಗುರುತುಗಳು)", fetchLine: (received: string, inserted: string) => ` · ಬಂದದ್ದು ${received} · ಹೊಸದು ${inserted}`,
    title: "ಸಹಕಾರಿ ಮೂಲಗಳ ಸ್ಥಿತಿ", intro: "MAMCOS, TSS ಮತ್ತು TUMCOS ನ ಲಭ್ಯತೆ, ಹೊಸತನ, ಅನುಮತಿ ಮತ್ತು ವಿಫಲತೆಯ ಕಾರಣಗಳು. ಹೊಸತನವನ್ನು ಮಾರುಕಟ್ಟೆ ವರದಿ ದಿನಾಂಕದಿಂದ ಅಳೆಯಲಾಗುತ್ತದೆ, ತಂದ ಸಮಯದಿಂದಲ್ಲ.",
    loading: "ಸಹಕಾರಿ ಮೂಲದ ಸ್ಥಿತಿ ತರಲಾಗುತ್ತಿದೆ", noStatus: "ಸ್ಥಿತಿ ಲಭ್ಯವಿಲ್ಲ", noStatusHint: "API ಸಹಕಾರಿ ಮೂಲದ ಸ್ಥಿತಿಯನ್ನು ನೀಡಲಿಲ್ಲ.",
    rule1: "ಮೂಲದ ವೇಳಾಪಟ್ಟಿ ಸಕ್ರಿಯವಾಗಿದ್ದು ನಿಯಮಿತ ಸಂಗ್ರಹಕ್ಕೆ ಅನುಮತಿ ದಾಖಲಾಗಿದ್ದರೆ ಮಾತ್ರ ನಿಯಮಿತ ಸಂಗ್ರಹ ನಡೆಯುತ್ತದೆ; ಇಲ್ಲದಿದ್ದರೆ ತಡೆಹಿಡಿದಿದೆ ಎಂದು ದಾಖಲಾಗುತ್ತದೆ.",
    rule2: "ಇತ್ತೀಚಿನ ಮಾರುಕಟ್ಟೆ ವರದಿ ದಿನಾಂಕ 7 ದಿನಕ್ಕಿಂತ ಹಳೆಯದಾದರೆ ದಾಖಲೆಗಳು ಹಳೆಯವು. ಹಳೆಯ ಅಥವಾ ಇಲ್ಲದ ದಿನಾಂಕಗಳನ್ನು ಎಂದೂ ತುಂಬುವುದಿಲ್ಲ.",
    generated: (time: string, today: string) => `ಸ್ಥಿತಿ ತಯಾರಿಸಿದ್ದು ${time} · ಇಂದಿನ ಮಾರುಕಟ್ಟೆ ದಿನಾಂಕ ${today}.`,
  },
});

function PermissionForm({ source, token }: { source: Source; token: string }) {
  const t = useCopy(COPY);
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
  return <details className="review-evidence"><summary>{t.record}</summary>
    <form className="monthly-refresh" onSubmit={(event: FormEvent) => { event.preventDefault(); update.mutate(); }}>
      <label className="filter-control"><span>{t.status}</span><select value={status} onChange={(event) => setStatus(event.target.value as PermissionStatus)}>
        {(["not_requested", "requested", "granted", "denied"] as const).map((value) => <option key={value} value={value}>{t.permissionStatus[value]}</option>)}</select></label>
      <label className="filter-control"><span>{t.reference}</span><input value={reference} maxLength={500} onChange={(event) => setReference(event.target.value)} placeholder={t.referencePlaceholder} /></label>
      <label><input type="checkbox" checked={scheduled} disabled={status !== "granted"} onChange={(event) => setScheduled(event.target.checked)} /> {t.scheduled}</label>
      <label><input type="checkbox" checked={redistribution} disabled={status !== "granted"} onChange={(event) => setRedistribution(event.target.checked)} /> {t.redistribution}</label>
      <button className="button-secondary" disabled={update.isPending || needsReference}>{update.isPending ? t.saving : t.save}</button>
    </form>
    {needsReference && <p role="note">{t.needsReference}</p>}
    {update.error && <ErrorState error={update.error} />}
    {update.isSuccess && <p role="status">{t.saved}</p>}
  </details>;
}

function SourceCard({ source, token }: { source: Source; token: string }) {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const format = useFormat();
  const { availability, permission } = source;
  const freshness = (item: Source["commodity_status"][number]) => describeFreshness(item, format.language);
  return <article className="source-status-card">
    <strong>{source.display_name}<span>{source.source_key} · {source.operator}</span></strong>
    <p className={availability.state === "failing" ? "message-error" : undefined}>
      {t.availabilityLine} <b>{t.availability[availability.state]}</b>
      {availability.last_attempt_at ? t.lastAttempt(format.timestamp(availability.last_attempt_at)) : ""}
      {availability.http_status ? ` · HTTP ${availability.http_status}` : ""}
      {availability.attempts ? t.attempts(availability.attempts) : ""}<br />
      {t.lastSuccess(source.last_success_at ? format.timestamp(source.last_success_at) : t.noneRecorded)}
    </p>
    {source.commodity_status.length ? source.commodity_status.map((item) => <p key={item.commodity}>
      <b>{item.commodity === "black_pepper" ? t.blackPepper : t.arecanut}</b>: {freshness(item)}<br />
      {t.statusLine(Object.entries(item.by_status).map(([key, count]) => `${key} ${count}`).join(" · "), Object.entries(item.by_unit_status).map(([key, count]) => `${key} ${count}`).join(" · "))}
    </p>) : <p>{t.noQuotes}</p>}
    <p>{t.permission} <b>{t.permissionLabel(permission.status, permission.redistribution_allowed)}</b>{t.allowed(t.scheduledWord, permission.scheduled_collection_allowed)}{t.allowed(t.redistributionWord, permission.redistribution_allowed)}
      {permission.permission_reference ? t.referenceLine(permission.permission_reference) : ""}<br />
      {t.robots(permission.robots_status, permission.terms_status, format.date(permission.terms_checked_at))}</p>
    <p>{t.unitEvidence} <span lang="en">{source.unit_evidence}</span></p>
    {source.recent_failures.length > 0 && <details className="review-evidence"><summary>{t.failures(source.recent_failures.length)}</summary><ul>
      {source.recent_failures.map((failure) => <li key={failure.fetch_id}>{format.timestamp(failure.started_at)} · {fetchStatusText(c, failure.status)}{failure.ingest_mode ? ` (${failure.ingest_mode})` : ""}{failure.http_status ? ` · HTTP ${failure.http_status}` : ""}: <span lang="en">{failure.reason ?? t.noReason}</span></li>)}
    </ul></details>}
    {source.recent_fetches.length > 0 && <details className="review-evidence"><summary>{t.fetches}</summary><ul>
      {source.recent_fetches.map((fetch) => <li key={fetch.fetch_id}><code>{fetch.fetch_id}</code> · {format.timestamp(fetch.started_at)} · {fetchStatusText(c, fetch.status)}{fetch.ingest_mode ? ` (${fetch.ingest_mode})` : ""}{t.fetchLine(String(fetch.received_count ?? "—"), String(fetch.inserted_count ?? "—"))}</li>)}
    </ul></details>}
    <PermissionForm key={`${permission.status}:${permission.permission_reference ?? ""}`} source={source} token={token} />
  </article>;
}

export function CooperativeSourceStatusPanel({ token }: { token: string }) {
  const t = useCopy(COPY);
  const format = useFormat();
  const status = useQuery({ queryKey: ["cooperative-sources", token], queryFn: () => api.cooperativeSources(token), enabled: Boolean(token) });
  return <section className="panel review-panel">
    <div className="panel-heading"><div><h2>{t.title}</h2><p>{t.intro}</p></div></div>
    {status.isLoading ? <LoadingState label={t.loading} /> : status.error ? <ErrorState error={status.error} onRetry={() => void status.refetch()} /> : !status.data ? <EmptyState title={t.noStatus}>{t.noStatusHint}</EmptyState> : <>
      <div className="source-status-grid">{status.data.sources.map((source) => <SourceCard key={source.source_key} source={source} token={token} />)}</div>
      <ul className="source-status-limitations">
        <li>{t.rule1}</li>
        <li>{t.rule2}</li>
        <li>{t.generated(format.timestamp(status.data.generated_at), format.date(status.data.market_calendar_today))}</li>
      </ul>
    </>}
  </section>;
}

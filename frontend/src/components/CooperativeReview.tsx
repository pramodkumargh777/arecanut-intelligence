import { useEffect, useState, type FormEvent } from "react";
import { calendarTodayIST, formatCalendarDate, formatTimestampIST } from "../../../shared/dates";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, QUEUE_PAGE_SIZE } from "../services/api";
import { QueuePager } from "./QueuePager";
import { reviewFlags, unitPublishable, type CooperativeQuote, type CooperativeSource } from "../services/cooperative";
import { EmptyState, ErrorState, LoadingState } from "./State";

const UNIT_LABEL: Record<CooperativeQuote["unit_status"], string> = {
  source_confirmed: "source-confirmed",
  assumed: "operator assumption",
  source_conflict: "source unit label conflicts with value magnitude; not publishable",
};
const COMMODITY_LABEL: Record<string, string> = { arecanut: "Arecanut", black_pepper: "Black pepper" };

function QueueRow({ row, busy, onReview }: { row: CooperativeQuote; busy: boolean; onReview: (action: "approve" | "reject") => void }) {
  const flags = reviewFlags(row.review_flags);
  const publishable = unitPublishable(row);
  return <article className="review-row"><div className="review-details">
    <strong>{row.source_key.toUpperCase()} · {COMMODITY_LABEL[row.commodity ?? "arecanut"] ?? row.commodity} · {row.branch} · {row.variety || "Missing variety"}{row.variety_reported === 0 ? " (variety not reported by source)" : ""}</strong>
    <p>Market reporting date {formatCalendarDate(row.reporting_date)} · {row.price_unit}{row.source_unit_label ? ` (source label "${row.source_unit_label}")` : ""} — {UNIT_LABEL[row.unit_status]} · Reported average, not an APMC modal price</p>
    <p>Minimum {row.minimum_price ?? "Missing"} · Average {row.average_price ?? "Missing"} · Maximum {row.maximum_price ?? "Missing"}</p>
    {row.source_key === "tss" && <p>Normal rate {row.normal_price ?? "Missing"} (separate from reported average){row.lot_count != null ? ` · Tender lots ${row.lot_count} · Bags ${row.bag_count ?? "Missing"} · Reported weight ${row.reported_weight ?? "Missing"} (unit unconfirmed)` : ""}</p>}
    {flags.length > 0 && <p role="note">Review flags: {flags.map((flag) => flag.replace(/_/g, " ")).join(", ")}</p>}
    {row.validation_message && <p role="note">{row.validation_message}</p>}
    <details className="review-evidence"><summary>Original source evidence</summary><p><a href={row.source_url} target="_blank" rel="noreferrer">Source</a> · Platform fetched {formatTimestampIST(row.fetched_at)} · Source publication timestamp {row.source_published_at ?? "not supplied"}{row.source_record_id ? ` · Source record ${row.source_record_id}` : ""}{row.ingest_mode ? ` · Ingest mode ${row.ingest_mode}` : ""}</p><pre>{row.raw_record}</pre></details>
  </div><div className="review-actions"><button className="approve-button" disabled={busy || row.status !== "pending"} title={publishable ? undefined : "Approval archives the record as accepted; it is not published while the unit is unconfirmed."} onClick={() => onReview("approve")}>{publishable ? "Verify average" : "Accept (unit unconfirmed)"}</button>
    <button className="reject-button" disabled={busy} onClick={() => onReview("reject")}>Reject</button></div></article>;
}

export function CooperativeReview() {
  const today = calendarTodayIST();
  const [token, setToken] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [queueSource, setQueueSource] = useState<CooperativeSource | "">("");
  const [tssDate, setTssDate] = useState(today);
  const [includeLots, setIncludeLots] = useState(false);
  const [backfillStart, setBackfillStart] = useState(today);
  const [backfillEnd, setBackfillEnd] = useState(today);
  const [tumcosScope, setTumcosScope] = useState<"recent" | "full_history">("recent");
  const [csvSource, setCsvSource] = useState<CooperativeSource>("mamcos");
  const [csvText, setCsvText] = useState("");
  const [authorizedBy, setAuthorizedBy] = useState("");
  const [permissionReference, setPermissionReference] = useState("");
  const [attested, setAttested] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [replayId, setReplayId] = useState("");
  const client = useQueryClient();
  const [queueOffset, setQueueOffset] = useState(0);
  const queue = useQuery({ queryKey: ["cooperative-quality", token, queueSource, queueOffset], queryFn: () => api.cooperativeQuality(token, queueSource || undefined, queueOffset), enabled: unlocked });
  const queueTotal = queue.data?.total;
  const queueEmptyPage = Boolean(queue.data && !queue.data.data.length);
  // Reviewing shrinks the queue; step back when the current page empties.
  useEffect(() => { if (queueEmptyPage && queueOffset > 0 && queueTotal) setQueueOffset(Math.max(0, queueOffset - QUEUE_PAGE_SIZE)); }, [queueEmptyPage, queueOffset, queueTotal]);
  async function invalidate() {
    for (const key of ["cooperative", "cooperative-quality", "cooperative-sources", "decision-prices", "aggregates"]) await client.invalidateQueries({ queryKey: [key] });
  }
  const done = (message: string) => async () => { setFeedback(message); await invalidate(); };
  const refresh = useMutation({ mutationFn: () => api.refreshMamcos(token), onError: invalidate,
    onSuccess: async (r) => done(`MAMCOS: fetched ${r.received_count} rows; ${r.inserted_count} new or reactivated; ${r.invalid_count} invalid rows withheld.`)() });
  const tssRefresh = useMutation({ mutationFn: () => api.refreshTss(token, tssDate, includeLots), onError: invalidate,
    onSuccess: async (r) => done(`TSS: ${r.received_count} source rows; ${r.inserted_count} new or reactivated; ${r.invalid_count} invalid; ${r.excluded_count} non-arecanut items excluded. Approve rows below to publish them.`)() });
  const tssBackfill = useMutation({ mutationFn: () => api.backfillTss(token, backfillStart, backfillEnd), onError: invalidate,
    onSuccess: async (r) => done(`TSS backfill: ${r.succeeded} of ${r.dates} dates fetched.${r.results.filter((x) => x.status === "failed").map((x) => ` ${x.date}: ${typeof x.detail === "string" ? x.detail : "failed"}.`).join("")}`)() });
  const tumcos = useMutation({ mutationFn: () => api.refreshTumcos(token, tumcosScope), onError: invalidate,
    onSuccess: async (r) => done(`TUMCOS: ${r.received_count} source records; ${r.in_scope_count} in scope (arecanut ${r.commodities.arecanut}, black pepper ${r.commodities.black_pepper}); ${r.inserted_count} new; ${r.invalid_count} invalid; ${r.unit_conflict_count} with unit conflict. Latest record date ${r.latest_record_date ?? "none"}; page "Last Updated" ${r.page_last_updated ?? "absent"}${r.stale_page_metadata ? " (stale page metadata)" : ""}. Table cross-check ${r.table_check.matched}/${r.table_check.rows}.`)() });
  const csvImport = useMutation({
    mutationFn: () => api.importCooperativeCsv(token, { source: csvSource, csv: csvText, authorized_by: authorizedBy, permission_reference: permissionReference, attestation: true, dry_run: dryRun }),
    onError: invalidate,
    onSuccess: async (r) => done(`${r.dry_run ? "Dry run (nothing stored)" : "CSV import"}: ${r.received_count} rows; ${r.pending_count} pending review; ${r.invalid_count} invalid${r.dry_run ? "" : `; ${r.inserted_count} stored; ${r.duplicate_count} already present`}.${r.rejected.slice(0, 5).map((x) => ` ${x.branch} ${x.reporting_date} ${x.variety}: ${x.reason}.`).join("")}`)(),
  });
  const replay = useMutation({ mutationFn: () => api.replayCooperativeSnapshot(token, replayId.trim()), onError: invalidate,
    onSuccess: async (r) => done(`Replayed ${r.source.toUpperCase()} snapshot ${r.replay_of}: ${r.parsed_count} parsed; ${r.inserted_count} new; ${r.duplicate_count} unchanged; ${r.invalid_count} invalid.`)() });
  const review = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) => api.cooperativeReview(id, token, action),
    onError: invalidate,
    onSuccess: async (r) => done(r.note ?? (r.published ? "Verified and published." : "Review recorded."))(),
  });
  const mutations = [refresh, tssRefresh, tssBackfill, tumcos, csvImport, replay, review];
  const busy = mutations.some((m) => m.isPending);
  function lock() {
    client.removeQueries({ queryKey: ["cooperative-quality"] });
    setToken(""); setUnlocked(false); setFeedback(""); setAttested(false); setCsvText("");
    mutations.forEach((m) => m.reset());
  }
  const submit = (action: () => void) => (event: FormEvent) => { event.preventDefault(); setFeedback(""); action(); };
  async function loadCsvFile(file: File | undefined) { if (file) setCsvText(await file.text()); }
  return <section className="panel"><div className="panel-heading"><div><h2>Cooperative source review</h2><p>MAMCOS, TSS and TUMCOS averages are separate from official modal prices and from each other. Invalid records cannot be approved. Approved records are published in INR/quintal.</p></div></div>
    <div className="monthly-details">
      {!unlocked ? <form className="monthly-refresh" onSubmit={(event) => { event.preventDefault(); setUnlocked(true); }}>
        <label className="filter-control"><span>Cooperative reviewer token</span><input type="password" autoComplete="off" required value={token} onChange={(event) => setToken(event.target.value)} /></label>
        <button className="button-secondary" disabled={!token}>Unlock cooperative review</button>
      </form> : <>
        <div className="monthly-refresh"><button className="button-secondary" disabled={busy} onClick={() => { setFeedback(""); refresh.mutate(); }}>{refresh.isPending ? "Fetching MAMCOS..." : "Fetch latest MAMCOS snapshot"}</button>
          <button className="button-secondary" disabled={busy} onClick={lock}>Lock cooperative review</button></div>
        <form className="monthly-refresh" onSubmit={submit(() => tssRefresh.mutate())}>
          <label className="filter-control"><span>TSS reporting date (IST)</span><input type="date" required max={today} value={tssDate} onChange={(event) => setTssDate(event.target.value)} disabled={busy} /></label>
          <label><input type="checkbox" checked={includeLots} onChange={(event) => setIncludeLots(event.target.checked)} disabled={busy} /> Add tender lot/bag/weight totals (personal data is discarded)</label>
          <button className="button-secondary" disabled={busy || !tssDate}>{tssRefresh.isPending ? "Fetching TSS..." : "Fetch TSS reporting date"}</button>
        </form>
        <form className="monthly-refresh" onSubmit={submit(() => tssBackfill.mutate())}>
          <label className="filter-control"><span>TSS backfill start</span><input type="date" required max={today} value={backfillStart} onChange={(event) => setBackfillStart(event.target.value)} disabled={busy} /></label>
          <label className="filter-control"><span>TSS backfill end (max 5 days)</span><input type="date" required max={today} value={backfillEnd} onChange={(event) => setBackfillEnd(event.target.value)} disabled={busy} /></label>
          <button className="button-secondary" disabled={busy || backfillStart > backfillEnd}>{tssBackfill.isPending ? "Backfilling TSS..." : "Backfill TSS dates"}</button>
        </form>
        <form className="monthly-refresh" onSubmit={submit(() => tumcos.mutate())}>
          <label className="filter-control"><span>TUMCOS scope</span><select value={tumcosScope} onChange={(event) => setTumcosScope(event.target.value === "full_history" ? "full_history" : "recent")} disabled={busy}>
            <option value="recent">Recent records (latest 45 days)</option><option value="full_history">Full published history (backfill)</option></select></label>
          <button className="button-secondary" disabled={busy}>{tumcos.isPending ? "Fetching TUMCOS..." : "Fetch TUMCOS arecanut and black pepper"}</button>
        </form>
        <details className="review-evidence"><summary>Authorized manual CSV import</summary>
          <form className="monthly-refresh" onSubmit={submit(() => csvImport.mutate())}>
            <label className="filter-control"><span>Source</span><select value={csvSource} onChange={(event) => setCsvSource(event.target.value as CooperativeSource)} disabled={busy}><option value="mamcos">MAMCOS</option><option value="tss">TSS</option><option value="tumcos">TUMCOS</option></select></label>
            <label className="filter-control"><span>Authorized by</span><input required minLength={2} maxLength={200} value={authorizedBy} onChange={(event) => setAuthorizedBy(event.target.value)} disabled={busy} /></label>
            <label className="filter-control"><span>Permission reference</span><input required minLength={3} maxLength={500} value={permissionReference} onChange={(event) => setPermissionReference(event.target.value)} disabled={busy} /></label>
            <label className="filter-control"><span>CSV file (max 500 rows)</span><input type="file" accept=".csv,text/csv" onChange={(event) => void loadCsvFile(event.target.files?.[0])} disabled={busy} /></label>
            <label className="filter-control"><span>CSV content</span><textarea rows={4} required value={csvText} onChange={(event) => setCsvText(event.target.value)} disabled={busy} placeholder="branch,reporting_date,commodity,variety,minimum_price,maximum_price,average_price,declared_unit,unit_evidence,source_reference,source_record_id,lot_count,bag_count,reported_weight" /></label>
            <label><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} disabled={busy} /> I attest these rows are copied unaltered from the source under the recorded permission</label>
            <label><input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} disabled={busy} /> Dry run (validate only)</label>
            <button className="button-secondary" disabled={busy || !attested || !csvText.trim()}>{csvImport.isPending ? "Importing..." : dryRun ? "Validate CSV" : "Import CSV for review"}</button>
          </form>
          <p>Imported rows enter the review queue. A unit is source-confirmed only when the declared unit is INR/quintal with recorded evidence. TSS and TUMCOS rows otherwise use the operator assumption of INR/quintal.</p>
        </details>
        <details className="review-evidence"><summary>Replay a stored raw snapshot</summary>
          <form className="monthly-refresh" onSubmit={submit(() => replay.mutate())}>
            <label className="filter-control"><span>Stored fetch ID</span><input required value={replayId} onChange={(event) => setReplayId(event.target.value)} disabled={busy} /></label>
            <button className="button-secondary" disabled={busy || !replayId.trim()}>{replay.isPending ? "Replaying..." : "Re-parse stored snapshot"}</button>
          </form>
          <p>Replay re-parses the immutable archived source snapshot with the current parser. It never re-fetches the source.</p>
        </details>
        <label className="filter-control"><span>Review queue source</span><select value={queueSource} onChange={(event) => { setQueueSource(event.target.value as CooperativeSource | ""); setQueueOffset(0); }}><option value="">All cooperative sources</option><option value="mamcos">MAMCOS</option><option value="tss">TSS</option><option value="tumcos">TUMCOS</option></select></label>
        {queue.isLoading ? <LoadingState label="Loading cooperative review queue" /> : queue.error ? <ErrorState error={queue.error} onRetry={() => void queue.refetch()} /> : !queue.data?.data.length ? <EmptyState title="Cooperative review queue is clear" /> : queue.data.data.map((row) => <QueueRow key={row.id} row={row} busy={busy} onReview={(action) => review.mutate({ id: row.id, action })} />)}
        {queue.data && <QueuePager offset={queueOffset} limit={QUEUE_PAGE_SIZE} total={queue.data.total} busy={queue.isFetching || busy} label="cooperative records" onChange={setQueueOffset} />}
      </>}
      {mutations.map((m, index) => m.error ? <ErrorState key={index} error={m.error} /> : null)}
      {feedback && <p role="status">{feedback}</p>}
      <p>Every fetch archives the raw source snapshot. Missing source history is not fabricated. Scheduled collection runs only after the source's permission is recorded as granted.</p>
      <p>TSS publishes no unit, and TUMCOS labels values "kg" although their size is only plausible per quintal. Both are treated as INR/quintal by operator decision and published after review; the source's own label stays on each record. TUMCOS values under ₹1,000 stay unconfirmed because they could genuinely be per kg.</p>
    </div>
  </section>;
}

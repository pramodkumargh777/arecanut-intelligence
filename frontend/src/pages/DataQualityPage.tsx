import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Check, ClipboardCheck, KeyRound, LockKeyhole, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, QUEUE_PAGE_SIZE } from "../services/api";
import { QueuePager } from "../components/QueuePager";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { CooperativeReview } from "../components/CooperativeReview";
import { SourceStatusPanel } from "../components/SourceStatusPanel";
import { CooperativeSourceStatusPanel } from "../components/CooperativeSourceStatusPanel";
import { formatCalendarDate, formatTimestampIST } from "../../../shared/dates";

function clearReviewerQueries(queryClient: QueryClient) {
  for (const key of ["quality", "source-status", "cooperative-sources", "cooperative-quality"]) queryClient.removeQueries({ queryKey: [key] });
}

export function DataQualityPage() {
  // Held in memory only, so it is gone when you leave this page or reload it.
  const [token, setToken] = useState("");
  const [draftToken, setDraftToken] = useState("");
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  useEffect(() => {
    // Removes a token saved by an earlier version of this page.
    try { sessionStorage.removeItem("ani-admin-token"); } catch { /* Nothing to remove when storage is blocked. */ }
    // Query keys contain the token, so cached queries go too.
    return () => { clearReviewerQueries(queryClient); };
  }, [queryClient]);
  const [queueOffset, setQueueOffset] = useState(0);
  const quality = useQuery({ queryKey: ["quality", token, queueOffset], queryFn: () => api.qualityQueue(token, queueOffset), enabled: Boolean(token) });
  const queueTotal = quality.data?.total;
  const queueEmptyPage = Boolean(quality.data && !quality.data.data.length);
  // Reviewing shrinks the queue; step back when the current page empties.
  useEffect(() => { if (queueEmptyPage && queueOffset > 0 && queueTotal) setQueueOffset(Math.max(0, queueOffset - QUEUE_PAGE_SIZE)); }, [queueEmptyPage, queueOffset, queueTotal]);
  const evidence = quality.data?.data.map((row) => <details className="review-evidence" key={row.id}>
    <summary>{row.market_name} · {row.reporting_date} · {row.variety_name}: source evidence</summary>
    <p>Status: {row.validation_status} · Original unit: {row.original_unit} · Imported: {row.ingested_at}</p>
    {row.validation_message && <p role="note">{row.validation_message}</p>}
    <pre>{row.raw_payload}</pre>
  </details>);
  function saveToken(event: FormEvent) {
    event.preventDefault();
    const value = draftToken.trim();
    if (!value) return;
    setToken(value);
    setMessage("");
    setMessageError(false);
  }
  function lockReview() {
    setToken("");
    setDraftToken("");
    setMessage("");
    setMessageError(false);
    clearReviewerQueries(queryClient);
  }
  async function review(id: string, action: "approve" | "reject") {
    setMessage("");
    setMessageError(false);
    setReviewingId(id);
    try {
      await api.review(id, token, action);
      setMessage(action === "approve" ? "Observation verified and published." : "Observation rejected and withheld.");
      await queryClient.invalidateQueries({ queryKey: ["quality", token] });
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
      await queryClient.invalidateQueries({ queryKey: ["latest-prices"] });
      await queryClient.invalidateQueries({ queryKey: ["market-comparison"] });
      await queryClient.invalidateQueries({ queryKey: ["reference-index"] });
      await queryClient.invalidateQueries({ queryKey: ["prices"] });
      await queryClient.invalidateQueries({ queryKey: ["varieties"] });
      await queryClient.invalidateQueries({ queryKey: ["markets"] });
    } catch (error) {
      setMessageError(true);
      setMessage(error instanceof Error ? error.message : "Review could not be completed.");
    } finally {
      setReviewingId(null);
    }
  }
  return (
    <div className="page-stack">
      <section className="page-heading"><div><h1>Data quality</h1><p>Review imported observations before they are included in published prices and analytics.</p></div><div className="quality-heading-icon"><ClipboardCheck size={23} /></div></section>
      <CooperativeReview />
      <section className="quality-banner"><div className="quality-banner-icon"><LockKeyhole size={18} /></div><div><strong>Official observations require verification</strong><p>The official modal-price queue below is separate from cooperative review. Approval publishes eligible official records to prices and reference-index calculations; rejection retains them without publication. Approved TSS and TUMCOS records are published in INR/quintal by operator decision, separately from official prices.</p></div></section>
      <section className="panel review-panel"><div className="panel-heading"><div><h2>Observation review queue</h2><p>Review source, date, reported variety and price range before publication.</p></div>{token && <button className="button-secondary" disabled={reviewingId !== null} onClick={lockReview}>Lock review queue</button>}</div>
        {!token ? <form className="token-form" onSubmit={saveToken}><div className="token-icon"><KeyRound size={20} /></div><div className="token-copy"><strong>Reviewer access required</strong><span>Enter the ADMIN_TOKEN configured for the API. It is stored for this browser session only.</span></div><input aria-label="Admin token" type="password" autoComplete="current-password" required value={draftToken} onChange={(event) => setDraftToken(event.target.value)} placeholder="Admin token" /><button className="button-primary" type="submit" disabled={!draftToken.trim()}>Unlock queue</button></form> : quality.isLoading ? <LoadingState label="Loading review queue" /> : quality.error ? <><ErrorState error={quality.error} onRetry={() => void quality.refetch()} /><button className="text-button" onClick={lockReview}>Change reviewer token</button></> : !quality.data?.data.length ? <EmptyState title="Review queue is clear">New CSV and API imports will appear here as pending observations.</EmptyState> : <div className="review-list">{quality.data.data.map((row) => <article className="review-row" key={row.id}><div className="review-details"><strong>{row.market_name}<span>{row.district}, {row.state}</span></strong><div className="review-meta"><span>Market reporting: {formatCalendarDate(row.reporting_date)}</span><span>{row.variety_name}{row.grade ? ` · grade ${row.grade}` : ""}</span><span>{row.source_name}</span><span>Source record: {row.source_record_id}</span></div><p>Publication date: {row.publication_date ? formatCalendarDate(row.publication_date) : "Not supplied"} · Platform fetch: {row.platform_fetched_at ? formatTimestampIST(row.platform_fetched_at) : "Not captured"} · Ingested: {formatTimestampIST(row.ingested_at)} · Original unit: {row.original_unit}</p><div className="review-prices"><span>Min <b>₹{row.minimum_price.toLocaleString("en-IN")}</b></span><span>Modal <b>₹{row.modal_price.toLocaleString("en-IN")}</b></span><span>Max <b>₹{row.maximum_price.toLocaleString("en-IN")}</b></span><small>{row.price_unit}</small></div></div><div className="review-actions" aria-busy={reviewingId === row.id}><button className="approve-button" disabled={reviewingId !== null} onClick={() => void review(row.id, "approve")}><Check size={15} /> Verify</button><button className="reject-button" disabled={reviewingId !== null} onClick={() => void review(row.id, "reject")}><X size={15} /> Reject</button></div></article>)}</div>}
        {token && quality.data && <QueuePager offset={queueOffset} limit={QUEUE_PAGE_SIZE} total={quality.data.total} busy={quality.isFetching || reviewingId !== null} label="pending observations" onChange={setQueueOffset} />}
        {reviewingId && <div className="review-message" role="status">Saving review and refreshing published data…</div>}
        {message && <div className={`review-message ${messageError ? "message-error" : ""}`} role={messageError ? "alert" : "status"}>{message}</div>}
      </section>
      {token && <SourceStatusPanel token={token} />}
      {token && <CooperativeSourceStatusPanel token={token} />}
      {token && evidence && evidence.length > 0 && <section className="panel"><div className="panel-heading"><div><h2>Validation and original source evidence</h2><p>Inspect original records before verification. Invalid ranges and future reporting dates cannot be published.</p></div></div><div className="monthly-details">{evidence}</div></section>}
      <section className="quality-details"><div><span className="quality-detail-icon"><Check size={17} /></span><strong>Source provenance retained</strong><p>Each record retains its original source identifier, import date and reporting date.</p></div><div><span className="quality-detail-icon"><Check size={17} /></span><strong>Assumptions stay visible</strong><p>Units and market labels are not silently changed. TSS and TUMCOS use an operator assumption of INR/quintal, and the source's own label stays on each record. Invalid prices remain withheld.</p></div><div><span className="quality-detail-icon"><Check size={17} /></span><strong>Corrections stay traceable</strong><p>Rejected records are retained with their status rather than silently deleted.</p></div></section>
    </div>
  );
}

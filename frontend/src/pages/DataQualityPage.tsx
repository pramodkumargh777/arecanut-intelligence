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
import { defineCopy, useCopy, useFormat } from "../services/language";

const COPY = defineCopy({
  en: {
    evidence: (market: string, date: string, variety: string) => `${market} · ${date} · ${variety}: source evidence`,
    evidenceLine: (status: string, unit: string, imported: string) => `Status: ${status} · Original unit: ${unit} · Imported: ${imported}`,
    verified: "Observation verified and published.", rejected: "Observation rejected and withheld.", failed: "Review could not be completed.",
    title: "Data quality", intro: "Review imported observations before they are included in published prices and analytics.",
    bannerTitle: "Official observations require verification",
    banner: "The official modal-price queue below is separate from cooperative review. Approval publishes eligible official records to prices and reference-index calculations; rejection retains them without publication. Approved TSS and TUMCOS records are published in INR/quintal by operator decision, separately from official prices.",
    queue: "Observation review queue", queueHint: "Review source, date, reported variety and price range before publication.", lock: "Lock review queue",
    access: "Reviewer access required", accessHint: "Enter the ADMIN_TOKEN configured for the API. It is stored for this browser session only.", tokenLabel: "Admin token", unlock: "Unlock queue",
    loading: "Loading review queue", changeToken: "Change reviewer token", clear: "Review queue is clear", clearHint: "New CSV and API imports will appear here as pending observations.",
    marketReporting: (date: string) => `Market reporting: ${date}`, grade: (grade: string) => ` · grade ${grade}`, record: (id: string) => `Source record: ${id}`,
    provenance: (published: string, fetched: string, ingested: string, unit: string) => `Publication date: ${published} · Platform fetch: ${fetched} · Ingested: ${ingested} · Original unit: ${unit}`,
    notSupplied: "Not supplied", notCaptured: "Not captured", min: "Min", modal: "Modal", max: "Max", verify: "Verify", reject: "Reject",
    pending: "pending observations", saving: "Saving review and refreshing published data…",
    evidenceTitle: "Validation and original source evidence", evidenceHint: "Inspect original records before verification. Invalid ranges and future reporting dates cannot be published.",
    provenanceTitle: "Source provenance retained", provenanceText: "Each record retains its original source identifier, import date and reporting date.",
    assumptionsTitle: "Assumptions stay visible", assumptionsText: "Units and market labels are not silently changed. TSS and TUMCOS use an operator assumption of INR/quintal, and the source's own label stays on each record. Invalid prices remain withheld.",
    correctionsTitle: "Corrections stay traceable", correctionsText: "Rejected records are retained with their status rather than silently deleted.",
  },
  kn: {
    evidence: (market: string, date: string, variety: string) => `${market} · ${date} · ${variety}: ಮೂಲದ ಆಧಾರ`,
    evidenceLine: (status: string, unit: string, imported: string) => `ಸ್ಥಿತಿ: ${status} · ಮೂಲ ಘಟಕ: ${unit} · ಆಮದು: ${imported}`,
    verified: "ದಾಖಲೆ ದೃಢೀಕರಿಸಿ ಪ್ರಕಟಿಸಲಾಗಿದೆ.", rejected: "ದಾಖಲೆ ತಿರಸ್ಕರಿಸಿ ತಡೆಹಿಡಿಯಲಾಗಿದೆ.", failed: "ಪರಿಶೀಲನೆ ಪೂರ್ಣಗೊಳ್ಳಲಿಲ್ಲ.",
    title: "ದತ್ತಾಂಶ ಗುಣಮಟ್ಟ", intro: "ಆಮದು ಮಾಡಿದ ದಾಖಲೆಗಳು ಪ್ರಕಟಿತ ದರ ಮತ್ತು ವಿಶ್ಲೇಷಣೆಗೆ ಸೇರುವ ಮೊದಲು ಅವುಗಳನ್ನು ಪರಿಶೀಲಿಸಿ.",
    bannerTitle: "ಅಧಿಕೃತ ದಾಖಲೆಗಳಿಗೆ ದೃಢೀಕರಣ ಬೇಕು",
    banner: "ಕೆಳಗಿನ ಅಧಿಕೃತ ಮಾದರಿ ದರದ ಸರದಿ ಸಹಕಾರಿ ಪರಿಶೀಲನೆಯಿಂದ ಪ್ರತ್ಯೇಕ. ಅನುಮೋದನೆಯು ಅರ್ಹ ಅಧಿಕೃತ ದಾಖಲೆಗಳನ್ನು ದರ ಮತ್ತು ಮಾನದಂಡ ಸೂಚ್ಯಂಕಕ್ಕೆ ಪ್ರಕಟಿಸುತ್ತದೆ; ತಿರಸ್ಕಾರವು ಪ್ರಕಟಿಸದೆ ಉಳಿಸುತ್ತದೆ. ಅನುಮೋದಿತ TSS ಮತ್ತು TUMCOS ದಾಖಲೆಗಳು ನಿರ್ವಾಹಕರ ನಿರ್ಧಾರದಂತೆ ₹/ಕ್ವಿಂಟಾಲ್‌ನಲ್ಲಿ, ಅಧಿಕೃತ ದರಗಳಿಂದ ಪ್ರತ್ಯೇಕವಾಗಿ ಪ್ರಕಟವಾಗುತ್ತವೆ.",
    queue: "ದಾಖಲೆ ಪರಿಶೀಲನಾ ಸರದಿ", queueHint: "ಪ್ರಕಟಣೆಗೆ ಮೊದಲು ಮೂಲ, ದಿನಾಂಕ, ವರದಿಯಾದ ತಳಿ ಮತ್ತು ದರ ಶ್ರೇಣಿಯನ್ನು ಪರಿಶೀಲಿಸಿ.", lock: "ಪರಿಶೀಲನಾ ಸರದಿ ಮುಚ್ಚಿ",
    access: "ಪರಿಶೀಲಕರ ಪ್ರವೇಶ ಬೇಕು", accessHint: "API ಗೆ ಹೊಂದಿಸಿದ ADMIN_TOKEN ನಮೂದಿಸಿ. ಇದು ಈ ಪುಟ ತೆರೆದಿರುವವರೆಗೆ ಮಾತ್ರ ಉಳಿಯುತ್ತದೆ.", tokenLabel: "ನಿರ್ವಾಹಕ ಟೋಕನ್", unlock: "ಸರದಿ ತೆರೆಯಿರಿ",
    loading: "ಪರಿಶೀಲನಾ ಸರದಿ ತರಲಾಗುತ್ತಿದೆ", changeToken: "ಪರಿಶೀಲಕರ ಟೋಕನ್ ಬದಲಿಸಿ", clear: "ಪರಿಶೀಲನಾ ಸರದಿ ಖಾಲಿ", clearHint: "ಹೊಸ CSV ಮತ್ತು API ಆಮದುಗಳು ಬಾಕಿ ದಾಖಲೆಗಳಾಗಿ ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತವೆ.",
    marketReporting: (date: string) => `ಮಾರುಕಟ್ಟೆ ವರದಿ: ${date}`, grade: (grade: string) => ` · ದರ್ಜೆ ${grade}`, record: (id: string) => `ಮೂಲ ದಾಖಲೆ: ${id}`,
    provenance: (published: string, fetched: string, ingested: string, unit: string) => `ಪ್ರಕಟಣೆ ದಿನಾಂಕ: ${published} · ತಂದ ಸಮಯ: ${fetched} · ಸೇರಿಸಿದ್ದು: ${ingested} · ಮೂಲ ಘಟಕ: ${unit}`,
    notSupplied: "ನೀಡಿಲ್ಲ", notCaptured: "ದಾಖಲಾಗಿಲ್ಲ", min: "ಕನಿಷ್ಠ", modal: "ಮಾದರಿ", max: "ಗರಿಷ್ಠ", verify: "ದೃಢೀಕರಿಸಿ", reject: "ತಿರಸ್ಕರಿಸಿ",
    pending: "ಬಾಕಿ ದಾಖಲೆಗಳು", saving: "ಪರಿಶೀಲನೆ ಉಳಿಸಿ ಪ್ರಕಟಿತ ದತ್ತಾಂಶ ನವೀಕರಿಸಲಾಗುತ್ತಿದೆ…",
    evidenceTitle: "ಪರಿಶೀಲನೆ ಮತ್ತು ಮೂಲದ ಆಧಾರ", evidenceHint: "ದೃಢೀಕರಿಸುವ ಮೊದಲು ಮೂಲ ದಾಖಲೆಗಳನ್ನು ನೋಡಿ. ಅಮಾನ್ಯ ಶ್ರೇಣಿ ಮತ್ತು ಮುಂದಿನ ದಿನಾಂಕಗಳನ್ನು ಪ್ರಕಟಿಸಲಾಗದು.",
    provenanceTitle: "ಮೂಲದ ಆಧಾರ ಉಳಿಯುತ್ತದೆ", provenanceText: "ಪ್ರತಿ ದಾಖಲೆಯೂ ಅದರ ಮೂಲ ಗುರುತು, ಆಮದು ದಿನಾಂಕ ಮತ್ತು ವರದಿ ದಿನಾಂಕವನ್ನು ಉಳಿಸಿಕೊಳ್ಳುತ್ತದೆ.",
    assumptionsTitle: "ಊಹೆಗಳು ಕಾಣುತ್ತವೆ", assumptionsText: "ಘಟಕ ಮತ್ತು ಮಾರುಕಟ್ಟೆ ಹೆಸರುಗಳನ್ನು ಗುಟ್ಟಾಗಿ ಬದಲಿಸುವುದಿಲ್ಲ. TSS ಮತ್ತು TUMCOS ಗೆ ₹/ಕ್ವಿಂಟಾಲ್ ನಿರ್ವಾಹಕರ ಊಹೆ, ಮತ್ತು ಮೂಲದ ಹೆಸರು ಪ್ರತಿ ದಾಖಲೆಯಲ್ಲೂ ಉಳಿಯುತ್ತದೆ. ಅಮಾನ್ಯ ದರಗಳು ತಡೆಹಿಡಿಯಲ್ಪಡುತ್ತವೆ.",
    correctionsTitle: "ತಿದ್ದುಪಡಿಗಳನ್ನು ಪತ್ತೆಹಚ್ಚಬಹುದು", correctionsText: "ತಿರಸ್ಕೃತ ದಾಖಲೆಗಳನ್ನು ಅಳಿಸದೆ ಅವುಗಳ ಸ್ಥಿತಿಯೊಂದಿಗೆ ಉಳಿಸಲಾಗುತ್ತದೆ.",
  },
});

function clearReviewerQueries(queryClient: QueryClient) {
  for (const key of ["quality", "source-status", "cooperative-sources", "cooperative-quality"]) queryClient.removeQueries({ queryKey: [key] });
}

export function DataQualityPage() {
  const t = useCopy(COPY);
  const format = useFormat();
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
    <summary>{t.evidence(row.market_name, format.date(row.reporting_date), row.variety_name)}</summary>
    <p>{t.evidenceLine(row.validation_status, row.original_unit, format.timestamp(row.ingested_at))}</p>
    {row.validation_message && <p role="note" lang="en">{row.validation_message}</p>}
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
      setMessage(action === "approve" ? t.verified : t.rejected);
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
      setMessage(error instanceof Error ? error.message : t.failed);
    } finally {
      setReviewingId(null);
    }
  }
  return (
    <div className="page-stack">
      <section className="page-heading"><div><h1>{t.title}</h1><p>{t.intro}</p></div><div className="quality-heading-icon"><ClipboardCheck size={23} /></div></section>
      <CooperativeReview />
      <section className="quality-banner"><div className="quality-banner-icon"><LockKeyhole size={18} /></div><div><strong>{t.bannerTitle}</strong><p>{t.banner}</p></div></section>
      <section className="panel review-panel"><div className="panel-heading"><div><h2>{t.queue}</h2><p>{t.queueHint}</p></div>{token && <button className="button-secondary" disabled={reviewingId !== null} onClick={lockReview}>{t.lock}</button>}</div>
        {!token ? <form className="token-form" onSubmit={saveToken}><div className="token-icon"><KeyRound size={20} /></div><div className="token-copy"><strong>{t.access}</strong><span>{t.accessHint}</span></div><input aria-label={t.tokenLabel} type="password" autoComplete="current-password" required value={draftToken} onChange={(event) => setDraftToken(event.target.value)} placeholder={t.tokenLabel} /><button className="button-primary" type="submit" disabled={!draftToken.trim()}>{t.unlock}</button></form> : quality.isLoading ? <LoadingState label={t.loading} /> : quality.error ? <><ErrorState error={quality.error} onRetry={() => void quality.refetch()} /><button className="text-button" onClick={lockReview}>{t.changeToken}</button></> : !quality.data?.data.length ? <EmptyState title={t.clear}>{t.clearHint}</EmptyState> : <div className="review-list">{quality.data.data.map((row) => <article className="review-row" key={row.id}><div className="review-details"><strong>{row.market_name}<span>{row.district}, {row.state}</span></strong><div className="review-meta"><span>{t.marketReporting(format.date(row.reporting_date))}</span><span lang="en">{row.variety_name}{row.grade ? t.grade(row.grade) : ""}</span><span>{row.source_name}</span><span>{t.record(row.source_record_id)}</span></div><p>{t.provenance(row.publication_date ? format.date(row.publication_date) : t.notSupplied, row.platform_fetched_at ? format.timestamp(row.platform_fetched_at) : t.notCaptured, format.timestamp(row.ingested_at), row.original_unit)}</p><div className="review-prices"><span>{t.min} <b>₹{row.minimum_price.toLocaleString("en-IN")}</b></span><span>{t.modal} <b>₹{row.modal_price.toLocaleString("en-IN")}</b></span><span>{t.max} <b>₹{row.maximum_price.toLocaleString("en-IN")}</b></span><small>{row.price_unit}</small></div></div><div className="review-actions" aria-busy={reviewingId === row.id}><button className="approve-button" disabled={reviewingId !== null} onClick={() => void review(row.id, "approve")}><Check size={15} /> {t.verify}</button><button className="reject-button" disabled={reviewingId !== null} onClick={() => void review(row.id, "reject")}><X size={15} /> {t.reject}</button></div></article>)}</div>}
        {token && quality.data && <QueuePager offset={queueOffset} limit={QUEUE_PAGE_SIZE} total={quality.data.total} busy={quality.isFetching || reviewingId !== null} label={t.pending} onChange={setQueueOffset} />}
        {reviewingId && <div className="review-message" role="status">{t.saving}</div>}
        {message && <div className={`review-message ${messageError ? "message-error" : ""}`} role={messageError ? "alert" : "status"}>{message}</div>}
      </section>
      {token && <SourceStatusPanel token={token} />}
      {token && <CooperativeSourceStatusPanel token={token} />}
      {token && evidence && evidence.length > 0 && <section className="panel"><div className="panel-heading"><div><h2>{t.evidenceTitle}</h2><p>{t.evidenceHint}</p></div></div><div className="monthly-details">{evidence}</div></section>}
      <section className="quality-details"><div><span className="quality-detail-icon"><Check size={17} /></span><strong>{t.provenanceTitle}</strong><p>{t.provenanceText}</p></div><div><span className="quality-detail-icon"><Check size={17} /></span><strong>{t.assumptionsTitle}</strong><p>{t.assumptionsText}</p></div><div><span className="quality-detail-icon"><Check size={17} /></span><strong>{t.correctionsTitle}</strong><p>{t.correctionsText}</p></div></section>
    </div>
  );
}

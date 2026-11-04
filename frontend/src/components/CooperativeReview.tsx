import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { EmptyState, ErrorState, LoadingState } from "./State";

export function CooperativeReview() {
  const [token, setToken] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [tssDate, setTssDate] = useState(new Date().toISOString().slice(0, 10));
  const [acceptAssumption, setAcceptAssumption] = useState(false);
  const client = useQueryClient();
  const queue = useQuery({ queryKey: ["cooperative-quality", token], queryFn: () => api.cooperativeQuality(token), enabled: unlocked });
  async function invalidate() {
    await client.invalidateQueries({ queryKey: ["cooperative"] });
    await client.invalidateQueries({ queryKey: ["cooperative-quality"] });
    await client.invalidateQueries({ queryKey: ["decision-prices"] });
    await client.invalidateQueries({ queryKey: ["aggregates"] });
  }
  const refresh = useMutation({
    mutationFn: () => api.refreshMamcos(token),
    onSuccess: async (result) => { setFeedback(`Fetched ${result.received_count} rows; ${result.inserted_count} new or reactivated; ${result.invalid_count} invalid rows withheld.`); await invalidate(); },
    onError: invalidate,
  });
  const review = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) => api.cooperativeReview(id, token, action),
    onSuccess: async () => { setFeedback("Review recorded. Published data refreshed."); await invalidate(); },
    onError: invalidate,
  });
  const tssRefresh = useMutation({
    mutationFn: () => api.refreshTss(token, tssDate),
    onSuccess: async (result) => {
      setFeedback(`TSS: ${result.received_count} source rows; ${result.inserted_count} new or reactivated; ${result.invalid_count} invalid; ${result.excluded_count} items outside the supported arecanut labels excluded. INR/quintal remains assumed.`);
      await invalidate();
    },
    onError: invalidate,
  });
  const busy = refresh.isPending || tssRefresh.isPending || review.isPending;
  return <section className="panel"><div className="panel-heading"><div><h2>Cooperative source review</h2><p>Cooperative averages are separate from official modal prices. Invalid records cannot be approved. TSS units remain assumed after approval.</p></div></div>
    <div className="monthly-details">
      {!unlocked ? <form className="monthly-refresh" onSubmit={(event) => { event.preventDefault(); setUnlocked(true); }}>
        <label className="filter-control"><span>Cooperative reviewer token</span><input type="password" autoComplete="off" required value={token} onChange={(event) => setToken(event.target.value)} /></label>
        <button className="button-secondary" disabled={!token}>Unlock cooperative review</button>
      </form> : <>
        <div className="monthly-refresh"><button className="button-secondary" disabled={busy} onClick={() => { setFeedback(""); refresh.mutate(); }}>{refresh.isPending ? "Fetching MAMCOS..." : "Fetch latest MAMCOS snapshot"}</button>
          <button className="button-secondary" disabled={busy} onClick={() => { client.removeQueries({ queryKey: ["cooperative-quality"] }); setToken(""); setUnlocked(false); setFeedback(""); setAcceptAssumption(false); review.reset(); refresh.reset(); tssRefresh.reset(); }}>Lock cooperative review</button></div>
        <form className="monthly-refresh" onSubmit={(event) => { event.preventDefault(); setFeedback(""); tssRefresh.mutate(); }}>
          <label className="filter-control"><span>TSS reporting date (UTC day limit)</span><input type="date" required max={new Date().toISOString().slice(0, 10)} value={tssDate} onChange={(event) => setTssDate(event.target.value)} disabled={busy} /></label>
          <label><input type="checkbox" checked={acceptAssumption} onChange={(event) => setAcceptAssumption(event.target.checked)} disabled={busy} /> Accept INR/quintal as assumed, not source-confirmed</label>
          <button className="button-secondary" disabled={busy || !acceptAssumption || !tssDate}>{tssRefresh.isPending ? "Fetching TSS..." : "Fetch TSS reporting date"}</button>
        </form>
        {queue.isLoading ? <LoadingState label="Loading cooperative review queue" /> : queue.error ? <ErrorState error={queue.error} onRetry={() => void queue.refetch()} /> : !queue.data?.data.length ? <EmptyState title="Cooperative review queue is clear" /> : queue.data.data.map((row) => <article className="review-row" key={row.id}><div className="review-details">
          <strong>{row.source_key.toUpperCase()} · {row.branch} · {row.variety || "Missing variety"}</strong><p>{row.reporting_date} · {row.price_unit}{row.unit_status === "assumed" ? " — assumed, not source-confirmed" : " — source-confirmed"} · Reported average</p>
          <p>Minimum {row.minimum_price ?? "Missing"} · Average {row.average_price ?? "Missing"} · Maximum {row.maximum_price ?? "Missing"}</p>
          {row.source_key === "tss" && <p>Normal rate {row.normal_price ?? "Missing"} (separate from reported average)</p>}
          {row.validation_message && <p role="note">{row.validation_message}</p>}
          <details className="review-evidence"><summary>Original source evidence</summary><p><a href={row.source_url} target="_blank" rel="noreferrer">Source page</a> · Fetched {new Date(row.fetched_at).toLocaleString("en-IN")}</p><pre>{row.raw_record}</pre></details>
        </div><div className="review-actions"><button className="approve-button" disabled={busy || row.status !== "pending"} onClick={() => review.mutate({ id: row.id, action: "approve" })}>{row.unit_status === "assumed" ? "Approve with assumed unit" : "Verify average"}</button>
          <button className="reject-button" disabled={busy} onClick={() => review.mutate({ id: row.id, action: "reject" })}>Reject</button></div></article>)}
      </>}
      {refresh.error && <ErrorState error={refresh.error} />}{tssRefresh.error && <ErrorState error={tssRefresh.error} />}{review.error && <ErrorState error={review.error} />}
      {feedback && <p role="status">{feedback}</p>}
      <p>Refresh archives the source snapshot. Missing source history is not fabricated. Automatic collection is opt-in after confirming collection permissions.</p>
      <p>TSS uses an explicitly assumed INR/quintal unit. Only exact RASHI, BETTE, CHALI, MURI, KOLE and ARECANUT labels are included. Pepper and unsupported items are archived but excluded. Empty reporting days are not replaced with another date.</p>
    </div>
  </section>;
}

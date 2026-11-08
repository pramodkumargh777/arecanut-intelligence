import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import type { QualityInput } from "../services/modules";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { IntelligenceNavigation, exportModule } from "./IntelligencePage";
import { AboutData } from "../components/AboutData";

const textFields = [
  ["lot_id", "Lot identifier"], ["variety", "Exact variety"], ["location", "Lot location"],
  ["sampled_on", "Sampling date"], ["reported_on", "Report date"], ["laboratory", "Laboratory / inspector"],
  ["report_reference", "Report reference"], ["evidence_url", "HTTPS report evidence URL"], ["notes", "Sampling method and measurement notes"],
] as const;
type TextKey = typeof textFields[number][0];
const empty = (): Record<TextKey, string> => Object.fromEntries(textFields.map(([key]) => [key, ""])) as Record<TextKey, string>;
export function QualityInspectionsPage() {
  const client = useQueryClient();
  const [token, setToken] = useState(""), [unlocked, setUnlocked] = useState(false), [values, setValues] = useState(empty);
  const [moisture, setMoisture] = useState(""), [defects, setDefects] = useState(""), [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<Error | null>(null);
  const publicQuery = useQuery({ queryKey: ["inspections"], queryFn: api.qualityInspections });
  const queue = useQuery({ queryKey: ["inspection-queue", token], queryFn: () => api.privateInspections(token), enabled: unlocked, retry: false });
  const invalidate = async () => { await client.invalidateQueries({ queryKey: ["inspections"] }); await client.invalidateQueries({ queryKey: ["inspection-queue"] }); };
  const submit = useMutation({ mutationFn: (input: QualityInput) => api.submitInspection(input, token), onSuccess: async () => { setValues(empty()); setMoisture(""); setDefects(""); await invalidate(); } });
  const review = useMutation({ mutationFn: ({ id, action }: { id: string; action: "verify" | "reject" }) => api.reviewInspection(id, action, reviewNotes[id] ?? "", token), onSuccess: invalidate });
  const rows = publicQuery.data?.data ?? [];
  const busy = submit.isPending || review.isPending;
  return <div className="page-stack">
    <section className="page-heading"><div><h1>Quality inspections</h1><p>Actual laboratory or inspection reports, independently reviewed. A market quotation cannot establish a lot's quality.</p></div></section>
    <IntelligenceNavigation current="quality" />
    {!rows.length && <p className="page-meta">No reviewed lot report is published.</p>}
    <AboutData><p>Do not enter example measurements as evidence. Published inspections and their evidence links are public; do not include personal or confidential information. These measurements do not certify safety or assign a commercial grade.</p></AboutData>
    {publicQuery.isLoading ? <LoadingState /> : publicQuery.error ? <ErrorState error={publicQuery.error} onRetry={() => void publicQuery.refetch()} /> : <section className="panel table-panel"><div className="panel-heading"><div><h2>Reviewed lot measurements</h2><p>Latest {publicQuery.data?.limit ?? 500} reviewed records · Percentages by the method stated in each report.</p></div><button className="button-secondary" disabled={!rows.length} onClick={() => exportModule([
      ["lot_id", "variety", "location", "sampled_on", "reported_on", "laboratory", "report_reference", "moisture_percent", "defects_percent", "notes", "evidence_url", "review_note", "reviewed_at"],
      ...rows.map((row) => [row.lot_id, row.variety, row.location, row.sampled_on, row.reported_on, row.laboratory, row.report_reference, row.moisture_percent, row.defects_percent, row.notes, row.evidence_url, row.review_note, row.reviewed_at]),
    ], "areca-pulse-quality-inspections.csv")}>Export quality CSV</button></div>
      {!rows.length ? <EmptyState title="No measured quality reports published">Provide a real lot inspection or laboratory report, then submit and review it below. Missing measurements are not inferred from variety or price.</EmptyState>
        : <div className="table-scroll" tabIndex={0} role="region" aria-label="Published quality inspections"><table><caption>Reviewer-checked lot reports, not a safety certification</caption><thead><tr><th>Lot / variety</th><th>Sampling / report date</th><th>Moisture %</th><th>Defects %</th><th>Report / evidence</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.lot_id} · {row.variety}<small className="quote-fetch">{row.location}</small></td><td>{row.sampled_on}<small className="quote-fetch">Reported {row.reported_on}</small></td><td className="numeric">{row.moisture_percent ?? "Not measured"}</td><td className="numeric">{row.defects_percent ?? "Not measured"}</td><td><a href={row.evidence_url} target="_blank" rel="noreferrer">{row.laboratory} · {row.report_reference}</a><small className="quote-fetch">{row.notes}</small><small className="quote-fetch">Review: {row.review_note} · {row.reviewed_at}</small></td></tr>)}</tbody></table></div>}
    </section>}
    <section className="panel"><div className="panel-heading"><div><h2>Inspection submission & review</h2><p>Shared reviewer access, not individual identity. Original evidence is immutable; corrected reports need distinct report references.</p></div></div><div className="monthly-details">
      {!unlocked ? <form className="monthly-refresh" onSubmit={(event) => { event.preventDefault(); setUnlocked(true); }}><label className="filter-control"><span>Inspection reviewer token</span><input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} required /></label><button className="button-secondary">Unlock inspection workflow</button></form> : <>
        <button className="button-secondary" disabled={busy} onClick={() => { setUnlocked(false); setToken(""); setValues(empty()); setMoisture(""); setDefects(""); setReviewNotes({}); setError(null); submit.reset(); review.reset(); client.removeQueries({ queryKey: ["inspection-queue"] }); }}>Lock and clear inspection inputs</button>
        {queue.isPending ? <LoadingState /> : queue.error ? <ErrorState error={queue.error} onRetry={() => void queue.refetch()} /> : <>
          <form className="page-stack" onSubmit={(event) => { event.preventDefault(); setError(null); const input = { ...values, moisture_percent: moisture === "" ? null : Number(moisture), defects_percent: defects === "" ? null : Number(defects) }; if (input.moisture_percent === null && input.defects_percent === null) { setError(new Error("Enter at least one actual measured percentage.")); return; } submit.mutate(input); }}>
            <div className="calculator-grid">{textFields.map(([key, label]) => <label key={key} className="filter-control"><span>{label}</span><input required disabled={busy} type={key.endsWith("_on") ? "date" : key === "evidence_url" ? "url" : "text"} maxLength={key === "notes" ? 2000 : key === "evidence_url" ? 1000 : 160} value={values[key]} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
              <label className="filter-control"><span>Measured moisture (%) — leave blank if not measured</span><input type="number" step="any" min={0} max={100} disabled={busy} value={moisture} onChange={(event) => setMoisture(event.target.value)} /></label>
              <label className="filter-control"><span>Measured defects (%) — leave blank if not measured</span><input type="number" step="any" min={0} max={100} disabled={busy} value={defects} onChange={(event) => setDefects(event.target.value)} /></label>
            </div><button className="button-primary" disabled={busy}>{submit.isPending ? "Submitting..." : "Submit real report for review"}</button>
          </form>
          {submit.isSuccess && <p role="status">Report stored as pending; it is not published until reviewed.</p>}
          <h3>Submitted reports</h3>{!queue.data?.data.length ? <p>No submitted inspection reports.</p> : <ul>{queue.data.data.map((row) => <li key={row.id}><p>{row.lot_id} · {row.variety} · {row.status} · {row.laboratory} · {row.report_reference}</p><p>Sampled {row.sampled_on}; reported {row.reported_on}; moisture {row.moisture_percent ?? "not measured"}%; defects {row.defects_percent ?? "not measured"}%. {row.notes}</p><a href={row.evidence_url} target="_blank" rel="noreferrer">Inspect original evidence</a>{row.status === "pending" && <div className="monthly-refresh"><label className="filter-control"><span>Evidence review note for {row.lot_id}</span><input value={reviewNotes[row.id] ?? ""} maxLength={1000} disabled={busy} onChange={(event) => setReviewNotes((current) => ({ ...current, [row.id]: event.target.value }))} /></label><button className="button-secondary" disabled={busy || !reviewNotes[row.id]?.trim()} onClick={() => review.mutate({ id: row.id, action: "verify" })}>Verify report</button><button className="button-secondary" disabled={busy || !reviewNotes[row.id]?.trim()} onClick={() => review.mutate({ id: row.id, action: "reject" })}>Reject report</button></div>}</li>)}</ul>}
        </>}
      </>}
      {(error || submit.error || review.error) && <ErrorState error={error ?? submit.error ?? review.error ?? new Error("Inspection operation failed.")} />}
    </div></section>
  </div>;
}

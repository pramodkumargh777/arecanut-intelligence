import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import type { QualityInput } from "../services/modules";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { IntelligenceNavigation, exportModule } from "./IntelligencePage";
import { AboutData } from "../components/AboutData";
import { defineCopy, useCopy, useFormat } from "../services/language";

const TEXT_KEYS = ["lot_id", "variety", "location", "sampled_on", "reported_on", "laboratory", "report_reference", "evidence_url", "notes"] as const;
type TextKey = typeof TEXT_KEYS[number];
const empty = (): Record<TextKey, string> => Object.fromEntries(TEXT_KEYS.map((key) => [key, ""])) as Record<TextKey, string>;

const COPY = defineCopy({
  en: {
    fields: { lot_id: "Lot identifier", variety: "Exact variety", location: "Lot location", sampled_on: "Sampling date", reported_on: "Report date", laboratory: "Laboratory / inspector",
      report_reference: "Report reference", evidence_url: "HTTPS report evidence URL", notes: "Sampling method and measurement notes" } as Record<TextKey, string>,
    title: "Quality inspections", intro: "Actual laboratory or inspection reports, independently reviewed. A market quotation cannot establish a lot's quality.",
    noneYet: "No reviewed lot report is published.",
    about: "Do not enter example measurements as evidence. Published inspections and their evidence links are public; do not include personal or confidential information. These measurements do not certify safety or assign a commercial grade.",
    reviewed: "Reviewed lot measurements", reviewedHint: (limit: number) => `Latest ${limit} reviewed records · Percentages by the method stated in each report.`, exportCsv: "Export quality CSV",
    noReports: "No measured quality reports published", noReportsHint: "Provide a real lot inspection or laboratory report, then submit and review it below. Missing measurements are not inferred from variety or price.",
    tableAria: "Published quality inspections", tableCaption: "Reviewer-checked lot reports, not a safety certification",
    lotVariety: "Lot / variety", dates: "Sampling / report date", moisture: "Moisture %", defects: "Defects %", evidence: "Report / evidence",
    notMeasured: "Not measured", reportedOn: (date: string) => `Reported ${date}`, reviewNote: (note: string, at: string) => `Review: ${note} · ${at}`,
    workflow: "Inspection submission & review", workflowHint: "Shared reviewer access, not individual identity. Original evidence is immutable; corrected reports need distinct report references.",
    token: "Inspection reviewer token", unlock: "Unlock inspection workflow", lock: "Lock and clear inspection inputs",
    atLeastOne: "Enter at least one actual measured percentage.",
    moistureInput: "Measured moisture (%) — leave blank if not measured", defectsInput: "Measured defects (%) — leave blank if not measured",
    submitting: "Submitting...", submit: "Submit real report for review", pending: "Report stored as pending; it is not published until reviewed.",
    submitted: "Submitted reports", noSubmitted: "No submitted inspection reports.",
    status: { pending: "pending", verified: "verified", rejected: "rejected" } as Record<string, string>,
    measuredLine: (sampled: string, reported: string, moisture: string, defects: string) => `Sampled ${sampled}; reported ${reported}; moisture ${moisture}%; defects ${defects}%.`,
    notMeasuredLower: "not measured", original: "Inspect original evidence", reviewFor: (lot: string) => `Evidence review note for ${lot}`,
    verify: "Verify report", reject: "Reject report", failed: "Inspection operation failed.",
  },
  kn: {
    fields: { lot_id: "ಲಾಟ್ ಗುರುತು", variety: "ನಿಖರ ತಳಿ", location: "ಲಾಟ್ ಸ್ಥಳ", sampled_on: "ಮಾದರಿ ತೆಗೆದ ದಿನಾಂಕ", reported_on: "ವರದಿ ದಿನಾಂಕ", laboratory: "ಪ್ರಯೋಗಾಲಯ / ಪರಿಶೀಲಕರು",
      report_reference: "ವರದಿ ಸಂಖ್ಯೆ", evidence_url: "ವರದಿಯ HTTPS ಆಧಾರ ಕೊಂಡಿ", notes: "ಮಾದರಿ ವಿಧಾನ ಮತ್ತು ಅಳತೆಯ ಟಿಪ್ಪಣಿ" },
    title: "ಗುಣಮಟ್ಟ ಪರಿಶೀಲನೆಗಳು", intro: "ನಿಜವಾದ ಪ್ರಯೋಗಾಲಯ ಅಥವಾ ಪರಿಶೀಲನಾ ವರದಿಗಳು, ಸ್ವತಂತ್ರವಾಗಿ ಪರಿಶೀಲಿಸಲಾಗಿದೆ. ಮಾರುಕಟ್ಟೆ ದರದಿಂದ ಲಾಟ್‌ನ ಗುಣಮಟ್ಟ ತಿಳಿಯಲಾಗದು.",
    noneYet: "ಪರಿಶೀಲಿತ ಲಾಟ್ ವರದಿ ಇನ್ನೂ ಪ್ರಕಟವಾಗಿಲ್ಲ.",
    about: "ಉದಾಹರಣೆ ಅಳತೆಗಳನ್ನು ಆಧಾರವಾಗಿ ನಮೂದಿಸಬೇಡಿ. ಪ್ರಕಟಿತ ಪರಿಶೀಲನೆಗಳು ಮತ್ತು ಆಧಾರ ಕೊಂಡಿಗಳು ಸಾರ್ವಜನಿಕ; ವೈಯಕ್ತಿಕ ಅಥವಾ ಗೋಪ್ಯ ಮಾಹಿತಿ ಸೇರಿಸಬೇಡಿ. ಈ ಅಳತೆಗಳು ಸುರಕ್ಷತೆಯನ್ನು ಪ್ರಮಾಣೀಕರಿಸುವುದಿಲ್ಲ ಅಥವಾ ವಾಣಿಜ್ಯ ದರ್ಜೆ ನೀಡುವುದಿಲ್ಲ.",
    reviewed: "ಪರಿಶೀಲಿತ ಲಾಟ್ ಅಳತೆಗಳು", reviewedHint: (limit: number) => `ಇತ್ತೀಚಿನ ${limit} ಪರಿಶೀಲಿತ ದಾಖಲೆಗಳು · ಶೇಕಡಾವಾರು ಪ್ರತಿ ವರದಿಯ ವಿಧಾನದಂತೆ.`, exportCsv: "ಗುಣಮಟ್ಟ CSV ಡೌನ್‌ಲೋಡ್",
    noReports: "ಅಳತೆ ಮಾಡಿದ ಗುಣಮಟ್ಟ ವರದಿಗಳು ಪ್ರಕಟವಾಗಿಲ್ಲ", noReportsHint: "ನಿಜವಾದ ಲಾಟ್ ಪರಿಶೀಲನೆ ಅಥವಾ ಪ್ರಯೋಗಾಲಯ ವರದಿ ನೀಡಿ, ನಂತರ ಕೆಳಗೆ ಸಲ್ಲಿಸಿ ಪರಿಶೀಲಿಸಿ. ತಳಿ ಅಥವಾ ದರದಿಂದ ಅಳತೆಗಳನ್ನು ಊಹಿಸುವುದಿಲ್ಲ.",
    tableAria: "ಪ್ರಕಟಿತ ಗುಣಮಟ್ಟ ಪರಿಶೀಲನೆಗಳು", tableCaption: "ಪರಿಶೀಲಕರು ನೋಡಿದ ಲಾಟ್ ವರದಿಗಳು, ಸುರಕ್ಷತಾ ಪ್ರಮಾಣಪತ್ರವಲ್ಲ",
    lotVariety: "ಲಾಟ್ / ತಳಿ", dates: "ಮಾದರಿ / ವರದಿ ದಿನಾಂಕ", moisture: "ತೇವಾಂಶ %", defects: "ದೋಷ %", evidence: "ವರದಿ / ಆಧಾರ",
    notMeasured: "ಅಳೆದಿಲ್ಲ", reportedOn: (date: string) => `ವರದಿ ${date}`, reviewNote: (note: string, at: string) => `ಪರಿಶೀಲನೆ: ${note} · ${at}`,
    workflow: "ಪರಿಶೀಲನಾ ವರದಿ ಸಲ್ಲಿಕೆ ಮತ್ತು ಪರಿಶೀಲನೆ", workflowHint: "ಹಂಚಿಕೊಂಡ ಪರಿಶೀಲಕರ ಪ್ರವೇಶ, ವೈಯಕ್ತಿಕ ಗುರುತಲ್ಲ. ಮೂಲ ಆಧಾರ ಬದಲಾಗುವುದಿಲ್ಲ; ತಿದ್ದಿದ ವರದಿಗಳಿಗೆ ಬೇರೆ ವರದಿ ಸಂಖ್ಯೆ ಬೇಕು.",
    token: "ಪರಿಶೀಲನೆಯ ಪರಿಶೀಲಕರ ಟೋಕನ್", unlock: "ಪರಿಶೀಲನಾ ಕೆಲಸ ತೆರೆಯಿರಿ", lock: "ಮುಚ್ಚಿ ಮತ್ತು ನಮೂದುಗಳನ್ನು ತೆರವುಗೊಳಿಸಿ",
    atLeastOne: "ಕನಿಷ್ಠ ಒಂದು ನಿಜವಾದ ಅಳತೆಯ ಶೇಕಡಾವಾರು ನಮೂದಿಸಿ.",
    moistureInput: "ಅಳೆದ ತೇವಾಂಶ (%) — ಅಳೆದಿಲ್ಲದಿದ್ದರೆ ಖಾಲಿ ಬಿಡಿ", defectsInput: "ಅಳೆದ ದೋಷ (%) — ಅಳೆದಿಲ್ಲದಿದ್ದರೆ ಖಾಲಿ ಬಿಡಿ",
    submitting: "ಸಲ್ಲಿಸಲಾಗುತ್ತಿದೆ...", submit: "ನಿಜವಾದ ವರದಿಯನ್ನು ಪರಿಶೀಲನೆಗೆ ಸಲ್ಲಿಸಿ", pending: "ವರದಿ ಬಾಕಿ ಎಂದು ಉಳಿಸಲಾಗಿದೆ; ಪರಿಶೀಲನೆಯಾಗುವವರೆಗೆ ಪ್ರಕಟವಾಗುವುದಿಲ್ಲ.",
    submitted: "ಸಲ್ಲಿಸಿದ ವರದಿಗಳು", noSubmitted: "ಸಲ್ಲಿಸಿದ ಪರಿಶೀಲನಾ ವರದಿಗಳಿಲ್ಲ.",
    status: { pending: "ಬಾಕಿ", verified: "ದೃಢೀಕರಿಸಲಾಗಿದೆ", rejected: "ತಿರಸ್ಕರಿಸಲಾಗಿದೆ" },
    measuredLine: (sampled: string, reported: string, moisture: string, defects: string) => `ಮಾದರಿ ${sampled}; ವರದಿ ${reported}; ತೇವಾಂಶ ${moisture}%; ದೋಷ ${defects}%.`,
    notMeasuredLower: "ಅಳೆದಿಲ್ಲ", original: "ಮೂಲ ಆಧಾರ ನೋಡಿ", reviewFor: (lot: string) => `${lot} ಗೆ ಆಧಾರ ಪರಿಶೀಲನೆಯ ಟಿಪ್ಪಣಿ`,
    verify: "ವರದಿ ದೃಢೀಕರಿಸಿ", reject: "ವರದಿ ತಿರಸ್ಕರಿಸಿ", failed: "ಪರಿಶೀಲನಾ ಕ್ರಿಯೆ ವಿಫಲವಾಯಿತು.",
  },
});

export function QualityInspectionsPage() {
  const t = useCopy(COPY);
  const format = useFormat();
  const day = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? format.date(value) : value;
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
    <section className="page-heading"><div><h1>{t.title}</h1><p>{t.intro}</p></div></section>
    <IntelligenceNavigation current="quality" />
    {!rows.length && <p className="page-meta">{t.noneYet}</p>}
    <AboutData><p>{t.about}</p></AboutData>
    {publicQuery.isLoading ? <LoadingState /> : publicQuery.error ? <ErrorState error={publicQuery.error} onRetry={() => void publicQuery.refetch()} /> : <section className="panel table-panel"><div className="panel-heading"><div><h2>{t.reviewed}</h2><p>{t.reviewedHint(publicQuery.data?.limit ?? 500)}</p></div><button className="button-secondary" disabled={!rows.length} onClick={() => exportModule([
      ["lot_id", "variety", "location", "sampled_on", "reported_on", "laboratory", "report_reference", "moisture_percent", "defects_percent", "notes", "evidence_url", "review_note", "reviewed_at"],
      ...rows.map((row) => [row.lot_id, row.variety, row.location, row.sampled_on, row.reported_on, row.laboratory, row.report_reference, row.moisture_percent, row.defects_percent, row.notes, row.evidence_url, row.review_note, row.reviewed_at]),
    ], "areca-pulse-quality-inspections.csv")}>{t.exportCsv}</button></div>
      {!rows.length ? <EmptyState title={t.noReports}>{t.noReportsHint}</EmptyState>
        : <div className="table-scroll" tabIndex={0} role="region" aria-label={t.tableAria}><table><caption>{t.tableCaption}</caption><thead><tr><th>{t.lotVariety}</th><th>{t.dates}</th><th>{t.moisture}</th><th>{t.defects}</th><th>{t.evidence}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.lot_id} · {row.variety}<small className="quote-fetch">{row.location}</small></td><td>{day(row.sampled_on)}<small className="quote-fetch">{t.reportedOn(day(row.reported_on))}</small></td><td className="numeric">{row.moisture_percent ?? t.notMeasured}</td><td className="numeric">{row.defects_percent ?? t.notMeasured}</td><td><a href={row.evidence_url} target="_blank" rel="noreferrer">{row.laboratory} · {row.report_reference}</a><small className="quote-fetch">{row.notes}</small><small className="quote-fetch">{t.reviewNote(row.review_note ?? "", row.reviewed_at ? format.timestamp(row.reviewed_at) : "")}</small></td></tr>)}</tbody></table></div>}
    </section>}
    <section className="panel"><div className="panel-heading"><div><h2>{t.workflow}</h2><p>{t.workflowHint}</p></div></div><div className="monthly-details">
      {!unlocked ? <form className="monthly-refresh" onSubmit={(event) => { event.preventDefault(); setUnlocked(true); }}><label className="filter-control"><span>{t.token}</span><input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} required /></label><button className="button-secondary">{t.unlock}</button></form> : <>
        <button className="button-secondary" disabled={busy} onClick={() => { setUnlocked(false); setToken(""); setValues(empty()); setMoisture(""); setDefects(""); setReviewNotes({}); setError(null); submit.reset(); review.reset(); client.removeQueries({ queryKey: ["inspection-queue"] }); }}>{t.lock}</button>
        {queue.isPending ? <LoadingState /> : queue.error ? <ErrorState error={queue.error} onRetry={() => void queue.refetch()} /> : <>
          <form className="page-stack" onSubmit={(event) => { event.preventDefault(); setError(null); const input = { ...values, moisture_percent: moisture === "" ? null : Number(moisture), defects_percent: defects === "" ? null : Number(defects) }; if (input.moisture_percent === null && input.defects_percent === null) { setError(new Error(t.atLeastOne)); return; } submit.mutate(input); }}>
            <div className="calculator-grid">{TEXT_KEYS.map((key) => <label key={key} className="filter-control"><span>{t.fields[key]}</span><input required disabled={busy} type={key.endsWith("_on") ? "date" : key === "evidence_url" ? "url" : "text"} maxLength={key === "notes" ? 2000 : key === "evidence_url" ? 1000 : 160} value={values[key]} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
              <label className="filter-control"><span>{t.moistureInput}</span><input type="number" step="any" min={0} max={100} disabled={busy} value={moisture} onChange={(event) => setMoisture(event.target.value)} /></label>
              <label className="filter-control"><span>{t.defectsInput}</span><input type="number" step="any" min={0} max={100} disabled={busy} value={defects} onChange={(event) => setDefects(event.target.value)} /></label>
            </div><button className="button-primary" disabled={busy}>{submit.isPending ? t.submitting : t.submit}</button>
          </form>
          {submit.isSuccess && <p role="status">{t.pending}</p>}
          <h3>{t.submitted}</h3>{!queue.data?.data.length ? <p>{t.noSubmitted}</p> : <ul>{queue.data.data.map((row) => <li key={row.id}><p>{row.lot_id} · {row.variety} · {t.status[row.status] ?? row.status} · {row.laboratory} · {row.report_reference}</p><p>{t.measuredLine(day(row.sampled_on), day(row.reported_on), String(row.moisture_percent ?? t.notMeasuredLower), String(row.defects_percent ?? t.notMeasuredLower))} {row.notes}</p><a href={row.evidence_url} target="_blank" rel="noreferrer">{t.original}</a>{row.status === "pending" && <div className="monthly-refresh"><label className="filter-control"><span>{t.reviewFor(row.lot_id)}</span><input value={reviewNotes[row.id] ?? ""} maxLength={1000} disabled={busy} onChange={(event) => setReviewNotes((current) => ({ ...current, [row.id]: event.target.value }))} /></label><button className="button-secondary" disabled={busy || !reviewNotes[row.id]?.trim()} onClick={() => review.mutate({ id: row.id, action: "verify" })}>{t.verify}</button><button className="button-secondary" disabled={busy || !reviewNotes[row.id]?.trim()} onClick={() => review.mutate({ id: row.id, action: "reject" })}>{t.reject}</button></div>}</li>)}</ul>}
        </>}
      </>}
      {(error || submit.error || review.error) && <ErrorState error={error ?? submit.error ?? review.error ?? new Error(t.failed)} />}
    </div></section>
  </div>;
}

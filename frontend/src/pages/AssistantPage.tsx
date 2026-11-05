import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import type { AssistantAnswer, AssistantCalculation, AssistantQuery } from "../services/assistant";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { formatTimestampIST } from "../../../shared/dates";

const EXAMPLES: { text: string; language: "en" | "kn" }[] = [
  { text: "What is the latest Rashi arecanut price in Karnataka?", language: "en" },
  { text: "Compare Chali prices across markets", language: "en" },
  { text: "What is the forecast for Rashi next month?", language: "en" },
  { text: "Karnataka arecanut production in recent years", language: "en" },
  { text: "How to manage Mahali (fruit rot) disease?", language: "en" },
  { text: "ರಾಶಿ ಅಡಿಕೆಯ ಇತ್ತೀಚಿನ ಬೆಲೆ ಎಷ್ಟು?", language: "kn" },
  { text: "ಕೊಳೆ ರೋಗ ನಿರ್ವಹಣೆ ಹೇಗೆ?", language: "kn" },
];

const CALCULATION_FIELDS: { key: Exclude<keyof AssistantCalculation, "variety">; label: string }[] = [
  { key: "price", label: "Sale price (INR/quintal)" },
  { key: "quantity_quintals", label: "Quantity (quintals)" },
  { key: "commission_percent", label: "Commission (%)" },
  { key: "transport_cost", label: "Transport cost (total INR)" },
  { key: "other_selling_cost", label: "Other selling cost (total INR)" },
  { key: "hold_days", label: "Hold period (days)" },
  { key: "storage_cost", label: "Storage cost (total INR)" },
  { key: "annual_finance_percent", label: "Annual finance rate (%)" },
  { key: "weight_loss_percent", label: "Weight loss while holding (%)" },
  { key: "scenario_price", label: "Your scenario future price (INR/quintal)" },
];

const LLM_STATUS: Record<AssistantAnswer["llm"]["status"], string> = {
  used: "Language model used; text passed grounding checks",
  not_configured: "No language model configured; rule-based explanation",
  disabled: "Language model switched off for this question; rule-based explanation",
  skipped_injection: "Language model skipped: question resembled an instruction override",
  skipped_no_data: "Language model skipped: no verified data to explain",
  failed: "Language model unavailable; rule-based explanation",
  grounding_failed: "Model text rejected by grounding checks; rule-based explanation",
};

const formatValue = (value: number | string | null) => value == null ? "Unavailable" : typeof value === "number" ? value.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : value;
const humanize = (value: string) => value.replace(/_/g, " ");

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <section className="panel table-panel"><div className="panel-heading"><div><h2>{title}</h2></div></div><div style={{ lineHeight: 1.65, overflowWrap: "anywhere" }}><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></div></section>;
}

export function AssistantPage() {
  const [question, setQuestion] = useState("");
  const [language, setLanguage] = useState<"auto" | "en" | "kn">("auto");
  const [useLlm, setUseLlm] = useState(true);
  const [showCalculation, setShowCalculation] = useState(false);
  const [calculation, setCalculation] = useState<Record<string, string>>({});
  const status = useQuery({ queryKey: ["assistant-status"], queryFn: api.assistantStatus, refetchInterval: 120_000 });
  const ask = useMutation({ mutationFn: (query: AssistantQuery) => api.askAssistant(query) });
  const answer = ask.data;

  const submit = (text = question) => {
    const trimmed = text.trim();
    if (trimmed.length < 2) return;
    const inputs: AssistantCalculation = {};
    if (showCalculation) {
      for (const field of CALCULATION_FIELDS) {
        const raw = calculation[field.key]?.trim();
        if (raw) inputs[field.key] = Number(raw);
      }
    }
    ask.mutate({ question: trimmed, language, use_llm: useLlm, ...(Object.keys(inputs).length ? { calculation: inputs } : {}) });
  };

  const chat = status.data?.chat;
  return <div className="page-stack">
    <section className="page-heading"><div><div className="eyebrow">VERIFIED ANI DATA · NOT TRADING ADVICE</div><h1>ANI intelligence assistant</h1>
      <p>Answers come from ANI's own price, forecast, production, trade, weather and advisory endpoints and from ingested CPCRI, DASD and government documents. Every number is copied from a cited source or calculated from your inputs. A language model may only explain those values, and its text is rejected if it adds numbers, unknown citations or price predictions. Arecanut only for now.</p></div></section>

    {status.error ? <div className="data-disclosure">Assistant status unavailable: {status.error.message}</div>
      : status.data && <div className="data-disclosure">
        Language model: <strong>{chat?.configured ? `${chat.provider} · ${chat.model}` : "not configured"}</strong>{chat?.reason ? ` (${chat.reason})` : ""} ·
        Document index: <strong>{status.data.corpus.documents} documents, {status.data.corpus.chunks} passages</strong> ({status.data.corpus.embedded_chunks} with {status.data.embedding.configured ? "semantic" : "stored"} embeddings{status.data.embedding.configured ? "" : "; keyword search only"}) ·
        Limit {status.data.rate_limit_per_hour} questions/hour · Questions {status.data.questions_retained ? "are" : "are not"} retained.
      </div>}

    <form className="panel table-panel" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <div className="panel-heading"><div><h2>Ask a question</h2><p>English or Kannada. Ask about prices, comparisons, the market index, arrivals, forecasts, production, trade, weather, crop risk, news or research documents.</p></div></div>
      <div className="calculator-grid" style={{ padding: 0 }}>
        <label className="filter-control calculator-wide"><span>Question</span>
          <textarea required minLength={2} maxLength={1000} rows={3} value={question} disabled={ask.isPending} onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); } }}
            style={{ width: "100%", border: "1px solid #cbd6c7", borderRadius: 4, padding: 10, font: "inherit", fontSize: 13, resize: "vertical" }} />
        </label>
        <label className="filter-control"><span>Answer language</span><select value={language} disabled={ask.isPending} onChange={(event) => setLanguage(event.target.value as typeof language)}>
          <option value="auto">Detect from question</option><option value="en">English</option><option value="kn">ಕನ್ನಡ (Kannada)</option>
        </select></label>
        <label className="filter-control"><span>Explanation</span><select value={useLlm ? "llm" : "rules"} disabled={ask.isPending} onChange={(event) => setUseLlm(event.target.value === "llm")}>
          <option value="llm">Language model when available (grounding-checked)</option><option value="rules">Rule-based only (no language model)</option>
        </select></label>
        <label className="filter-control"><span>Calculation inputs</span><select value={showCalculation ? "yes" : "no"} disabled={ask.isPending} onChange={(event) => setShowCalculation(event.target.value === "yes")}>
          <option value="no">None</option><option value="yes">Provide my own figures (net realisation / sell-or-hold)</option>
        </select></label>
        {showCalculation && CALCULATION_FIELDS.map((field) => <label className="filter-control" key={field.key}><span>{field.label}</span>
          <input type="number" step="any" min={0} value={calculation[field.key] ?? ""} disabled={ask.isPending} onChange={(event) => setCalculation((current) => ({ ...current, [field.key]: event.target.value }))} /></label>)}
        <div className="calculator-wide"><button className="button-primary" disabled={ask.isPending || question.trim().length < 2}>{ask.isPending ? "Collecting verified data…" : "Ask"}</button></div>
      </div>
      <div style={{ lineHeight: 1.65, marginTop: 20 }}><span className="filter-label">Examples</span> {EXAMPLES.map((example) => <button type="button" key={example.text} className="button-secondary" style={{ margin: "4px 6px 0 0" }} disabled={ask.isPending}
        onClick={() => { setQuestion(example.text); setLanguage(example.language); submit(example.text); }}>{example.text}</button>)}</div>
    </form>

    {ask.isPending && <LoadingState label="Querying ANI data sources" />}
    {ask.error && <ErrorState error={ask.error} onRetry={() => submit()} />}
    {answer && !ask.isPending && <AnswerView answer={answer} />}
  </div>;
}

function AnswerView({ answer }: { answer: AssistantAnswer }) {
  const grounding = answer.interpretation.grounding;
  return <>
    <section className="panel table-panel" aria-label="Interpretation">
      <div className="panel-heading"><div><h2>{answer.interpretation.generated_by === "llm" ? "Interpretation · language model" : "Interpretation · rule-based"}</h2>
        <p>{LLM_STATUS[answer.llm.status]}{answer.llm.model ? ` · ${answer.llm.provider} ${answer.llm.model}` : ""}{grounding ? ` · grounding ${grounding.status}` : ""} · {answer.duration_ms.toLocaleString("en-IN")} ms</p></div></div>
      <div style={{ lineHeight: 1.65, overflowWrap: "anywhere" }}>
        <p lang={answer.language} style={{ whiteSpace: "pre-wrap" }}>{answer.interpretation.text}</p>
        <p className="card-hint">{answer.interpretation.note}</p>
        {answer.llm.reason && answer.llm.status !== "used" && <p className="card-hint">Reason: {answer.llm.reason}</p>}
        {grounding?.status === "failed" && <p className="card-hint">Rejected model text: {grounding.reasons.join("; ")}</p>}
        {answer.injection_flags.length > 0 && <p className="card-hint">Instruction-override patterns detected: {answer.injection_flags.map(humanize).join(", ")}. Only verified data is shown.</p>}
      </div>
    </section>

    {answer.facts.length ? <section className="panel table-panel" aria-label="Verified facts">
      <div className="panel-heading"><div><h2>Verified facts</h2><p>Values copied from ANI sources. Price basis is shown separately; different bases are not comparable.</p></div></div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Verified facts table"><table>
        <thead><tr><th>Fact</th><th>Value</th><th>Unit</th><th>Basis</th><th>Reporting period</th><th>Source</th><th>Note</th></tr></thead>
        <tbody>{answer.facts.map((fact, index) => <tr key={`${fact.citation}-${fact.label}-${index}`}>
          <td>{fact.label}</td><td className="numeric">{formatValue(fact.value)}</td><td>{fact.unit ?? "—"}</td><td>{fact.basis ? humanize(fact.basis) : "—"}</td>
          <td>{fact.reporting_period ?? "—"}</td><td><span className="source-tag">[{fact.citation}]</span></td><td style={{ whiteSpace: "normal" }}>{fact.note ?? ""}</td>
        </tr>)}</tbody>
      </table></div>
    </section> : <EmptyState title="No verified figures for this question">The assistant does not fill gaps from model knowledge. See missing data below.</EmptyState>}

    <section className="panel table-panel" aria-label="Tools used">
      <div className="panel-heading"><div><h2>Data tools used</h2><p>Tool selection: {answer.planning === "llm" ? "language-model planner (arguments validated)" : answer.planning === "rules" ? "keyword rules" : "no matching tool"}{answer.planning_error ? ` · planner error: ${answer.planning_error}` : ""}</p></div></div>
      {answer.tools.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Tools table"><table>
        <thead><tr><th>Tool</th><th>Status</th><th>Summary</th><th>Reporting period</th></tr></thead>
        <tbody>{answer.tools.map((tool, index) => <tr key={`${tool.tool}-${index}`}><td>{tool.title}</td><td>{humanize(tool.status)}</td><td style={{ whiteSpace: "normal" }}>{tool.summary}</td><td>{tool.reporting_period ?? "—"}</td></tr>)}</tbody>
      </table></div> : <div style={{ lineHeight: 1.65, overflowWrap: "anywhere" }}><p>No ANI tool matched this question. Try naming a variety, market, district or topic.</p></div>}
    </section>

    <List title="Calculation assumptions" items={answer.assumptions} />
    <List title="Uncertainty" items={answer.uncertainty} />
    <List title="Missing data" items={answer.missing} />
    <List title="Limitations" items={answer.limitations} />

    {answer.excerpts.length > 0 && <section className="panel table-panel" aria-label="Document excerpts">
      <div className="panel-heading"><div><h2>Document excerpts</h2><p>Quoted passages from ingested documents. Treat as reference material, not a diagnosis; consult an agricultural officer before acting.</p></div></div>
      <div style={{ lineHeight: 1.65, overflowWrap: "anywhere" }}>{answer.excerpts.map((excerpt, index) => <blockquote key={`${excerpt.citation}-${index}`} style={{ margin: "0 0 12px", paddingLeft: 12, borderLeft: "3px solid #cbd6c7", whiteSpace: "pre-wrap" }}>
        <span className="source-tag">[{excerpt.citation}]</span> {excerpt.text}</blockquote>)}</div>
    </section>}

    {answer.citations.length > 0 && <section className="panel table-panel" aria-label="Sources">
      <div className="panel-heading"><div><h2>Sources</h2><p>Retrieval times shown in IST.</p></div></div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Sources table"><table>
        <thead><tr><th>Ref</th><th>Source</th><th>Publisher</th><th>Reporting period</th><th>Published</th><th>Page</th><th>Retrieved</th></tr></thead>
        <tbody>{answer.citations.map((citation) => <tr key={citation.ref}>
          <td><span className="source-tag">[{citation.ref}]</span></td>
          <td style={{ whiteSpace: "normal" }}>{citation.url ? <a className="subtle-link" href={citation.url} target="_blank" rel="noopener noreferrer">{citation.label}</a> : citation.label}</td>
          <td>{citation.publisher ?? "—"}</td><td>{citation.reporting_period ?? "—"}</td><td>{citation.publication_date ?? "—"}</td><td>{citation.page ?? "—"}</td>
          <td>{citation.retrieved_at ? formatTimestampIST(citation.retrieved_at) : "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    <div className="data-disclosure" role="note">{answer.disclaimer}</div>
  </>;
}

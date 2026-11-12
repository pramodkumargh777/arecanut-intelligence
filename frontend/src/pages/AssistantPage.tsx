import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import type { AssistantAnswer, AssistantCalculation, AssistantQuery } from "../services/assistant";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { defineCopy, useCopy, useFormat, useLanguage } from "../services/language";
import { AboutData } from "../components/AboutData";

const EXAMPLES: { text: string; language: "en" | "kn" }[] = [
  { text: "What is the latest Rashi arecanut price in Karnataka?", language: "en" },
  { text: "Compare Chali prices across markets", language: "en" },
  { text: "What is the forecast for Rashi next month?", language: "en" },
  { text: "Karnataka arecanut production in recent years", language: "en" },
  { text: "How to manage Mahali (fruit rot) disease?", language: "en" },
  { text: "ರಾಶಿ ಅಡಿಕೆಯ ಇತ್ತೀಚಿನ ಬೆಲೆ ಎಷ್ಟು?", language: "kn" },
  { text: "ಕೊಳೆ ರೋಗ ನಿರ್ವಹಣೆ ಹೇಗೆ?", language: "kn" },
];

const CALCULATION_KEYS = ["price", "quantity_quintals", "commission_percent", "transport_cost", "other_selling_cost", "hold_days", "storage_cost", "annual_finance_percent", "weight_loss_percent", "scenario_price"] as const;
type CalculationKey = typeof CALCULATION_KEYS[number];

const COPY = defineCopy({
  en: {
    fields: { price: "Sale price (INR/quintal)", quantity_quintals: "Quantity (quintals)", commission_percent: "Commission (%)", transport_cost: "Transport cost (total INR)",
      other_selling_cost: "Other selling cost (total INR)", hold_days: "Hold period (days)", storage_cost: "Storage cost (total INR)", annual_finance_percent: "Annual finance rate (%)",
      weight_loss_percent: "Weight loss while holding (%)", scenario_price: "Your scenario future price (INR/quintal)" } as Record<CalculationKey, string>,
    llm: {
      used: "Language model used; text passed grounding checks", not_configured: "No language model configured; rule-based explanation",
      disabled: "Language model switched off for this question; rule-based explanation", skipped_injection: "Language model skipped: question resembled an instruction override",
      skipped_no_data: "Language model skipped: no verified data to explain", failed: "Language model unavailable; rule-based explanation",
      grounding_failed: "Model text rejected by grounding checks; rule-based explanation",
    } as Record<AssistantAnswer["llm"]["status"], string>,
    unavailable: "Unavailable",
    title: "Areca Pulse intelligence assistant", intro: "Ask about arecanut prices, markets, weather or crop care. Every number in an answer comes from a cited source or from your own figures.",
    statusUnavailable: (message: string) => `Assistant status unavailable: ${message}`, howMade: "How answers are made",
    howMadeText: "Answers come from Areca Pulse's own price, forecast, production, trade, weather and advisory endpoints and from ingested CPCRI, DASD and government documents. A language model may only explain those values, and its text is rejected if it adds numbers, unknown citations or price predictions. Arecanut only for now.",
    model: "Language model:", notConfigured: "not configured", index: "Document index:", indexValue: (documents: number, chunks: number) => `${documents} documents, ${chunks} passages`,
    embeddings: (count: number, semantic: boolean) => `(${count} with ${semantic ? "semantic" : "stored"} embeddings${semantic ? "" : "; keyword search only"})`,
    limit: (perHour: number, retained: boolean) => `Limit ${perHour} questions/hour · Questions ${retained ? "are" : "are not"} retained.`,
    ask: "Ask a question", askHint: "English or Kannada. Ask about prices, comparisons, the market index, arrivals, forecasts, production, trade, weather, crop risk, news or research documents.",
    question: "Question", answerLanguage: "Answer language", detect: "Detect from question", explanation: "Explanation", llmOption: "Language model (grounding-checked)", rulesOption: "Rule-based only",
    calculationInputs: "Calculation inputs", none: "None", ownFigures: "Provide my own figures", collecting: "Collecting verified data…", submit: "Ask", examples: "Examples",
    querying: "Querying Areca Pulse data sources",
    interpretation: "Interpretation", byModel: "Interpretation · language model", byRules: "Interpretation · rule-based", grounding: (status: string) => ` · grounding ${status}`,
    reason: (text: string) => `Reason: ${text}`, rejected: (reasons: string) => `Rejected model text: ${reasons}`,
    injection: (flags: string) => `Instruction-override patterns detected: ${flags}. Only verified data is shown.`,
    facts: "Verified facts", factsHint: "Values copied from Areca Pulse sources. Price basis is shown separately; different bases are not comparable.", factsTable: "Verified facts table",
    fact: "Fact", value: "Value", unit: "Unit", basis: "Basis", reportingPeriod: "Reporting period", source: "Source", note: "Note",
    noFacts: "No verified figures for this question", noFactsHint: "The assistant does not fill gaps from model knowledge. See missing data below.",
    tools: "Data tools used", toolsTable: "Tools table", selection: (how: string) => `Tool selection: ${how}`, plannerError: (error: string) => ` · planner error: ${error}`,
    planning: { llm: "language-model planner (arguments validated)", rules: "keyword rules", none: "no matching tool" } as Record<string, string>,
    tool: "Tool", status: "Status", summary: "Summary", noTool: "No Areca Pulse tool matched this question. Try naming a variety, market, district or topic.",
    assumptions: "Calculation assumptions", uncertainty: "Uncertainty", missing: "Missing data", limitations: "Limitations",
    excerpts: "Document excerpts", excerptsHint: "Quoted passages from ingested documents. Treat as reference material, not a diagnosis; consult an agricultural officer before acting.",
    sources: "Sources", sourcesHint: "Retrieval times shown in IST.", sourcesTable: "Sources table", ref: "Ref", publisher: "Publisher", published: "Published", page: "Page", retrieved: "Retrieved",
  },
  kn: {
    fields: { price: "ಮಾರಾಟ ದರ (₹/ಕ್ವಿಂಟಾಲ್)", quantity_quintals: "ಪ್ರಮಾಣ (ಕ್ವಿಂಟಾಲ್)", commission_percent: "ಕಮಿಷನ್ (%)", transport_cost: "ಸಾಗಣೆ ವೆಚ್ಚ (ಒಟ್ಟು ₹)",
      other_selling_cost: "ಇತರ ಮಾರಾಟ ವೆಚ್ಚ (ಒಟ್ಟು ₹)", hold_days: "ಕಾಯುವ ಅವಧಿ (ದಿನಗಳು)", storage_cost: "ಸಂಗ್ರಹ ವೆಚ್ಚ (ಒಟ್ಟು ₹)", annual_finance_percent: "ವಾರ್ಷಿಕ ಬಡ್ಡಿ ದರ (%)",
      weight_loss_percent: "ಕಾಯುವಾಗ ತೂಕ ನಷ್ಟ (%)", scenario_price: "ನಿಮ್ಮ ಮುಂದಿನ ದರದ ಊಹೆ (₹/ಕ್ವಿಂಟಾಲ್)" },
    llm: {
      used: "ಭಾಷಾ ಮಾದರಿ ಬಳಸಲಾಗಿದೆ; ಪಠ್ಯ ಆಧಾರ ಪರಿಶೀಲನೆಯಲ್ಲಿ ಉತ್ತೀರ್ಣ", not_configured: "ಭಾಷಾ ಮಾದರಿ ಹೊಂದಿಸಿಲ್ಲ; ನಿಯಮ ಆಧಾರಿತ ವಿವರಣೆ",
      disabled: "ಈ ಪ್ರಶ್ನೆಗೆ ಭಾಷಾ ಮಾದರಿ ಆಫ್ ಮಾಡಲಾಗಿದೆ; ನಿಯಮ ಆಧಾರಿತ ವಿವರಣೆ", skipped_injection: "ಭಾಷಾ ಮಾದರಿ ಬಿಡಲಾಗಿದೆ: ಪ್ರಶ್ನೆ ಸೂಚನೆ ಬದಲಿಸುವ ಪ್ರಯತ್ನದಂತಿತ್ತು",
      skipped_no_data: "ಭಾಷಾ ಮಾದರಿ ಬಿಡಲಾಗಿದೆ: ವಿವರಿಸಲು ಪರಿಶೀಲಿತ ದತ್ತಾಂಶವಿಲ್ಲ", failed: "ಭಾಷಾ ಮಾದರಿ ಲಭ್ಯವಿಲ್ಲ; ನಿಯಮ ಆಧಾರಿತ ವಿವರಣೆ",
      grounding_failed: "ಆಧಾರ ಪರಿಶೀಲನೆಯಲ್ಲಿ ಮಾದರಿ ಪಠ್ಯ ತಿರಸ್ಕೃತ; ನಿಯಮ ಆಧಾರಿತ ವಿವರಣೆ",
    },
    unavailable: "ಲಭ್ಯವಿಲ್ಲ",
    title: "ಅಡಿಕೆ ನಾಡಿ ಮಾಹಿತಿ ಸಹಾಯಕ", intro: "ಅಡಿಕೆ ದರ, ಮಾರುಕಟ್ಟೆ, ಹವಾಮಾನ ಅಥವಾ ಬೆಳೆ ಆರೈಕೆಯ ಬಗ್ಗೆ ಕೇಳಿ. ಉತ್ತರದ ಪ್ರತಿ ಸಂಖ್ಯೆಯೂ ಉಲ್ಲೇಖಿತ ಮೂಲದಿಂದ ಅಥವಾ ನಿಮ್ಮ ಅಂಕಿಗಳಿಂದ ಬರುತ್ತದೆ.",
    statusUnavailable: (message: string) => `ಸಹಾಯಕದ ಸ್ಥಿತಿ ಲಭ್ಯವಿಲ್ಲ: ${message}`, howMade: "ಉತ್ತರಗಳನ್ನು ಹೇಗೆ ತಯಾರಿಸಲಾಗುತ್ತದೆ",
    howMadeText: "ಉತ್ತರಗಳು ಅಡಿಕೆ ನಾಡಿಯ ದರ, ಮುನ್ಸೂಚನೆ, ಉತ್ಪಾದನೆ, ವ್ಯಾಪಾರ, ಹವಾಮಾನ ಮತ್ತು ಸಲಹಾ ಸೇವೆಗಳಿಂದ ಹಾಗೂ CPCRI, DASD ಮತ್ತು ಸರ್ಕಾರದ ದಾಖಲೆಗಳಿಂದ ಬರುತ್ತವೆ. ಭಾಷಾ ಮಾದರಿ ಆ ಮೌಲ್ಯಗಳನ್ನು ವಿವರಿಸಬಹುದು ಮಾತ್ರ; ಅದು ಹೊಸ ಸಂಖ್ಯೆ, ಅಜ್ಞಾತ ಉಲ್ಲೇಖ ಅಥವಾ ದರ ಮುನ್ಸೂಚನೆ ಸೇರಿಸಿದರೆ ಪಠ್ಯವನ್ನು ತಿರಸ್ಕರಿಸಲಾಗುತ್ತದೆ. ಸದ್ಯಕ್ಕೆ ಅಡಿಕೆ ಮಾತ್ರ.",
    model: "ಭಾಷಾ ಮಾದರಿ:", notConfigured: "ಹೊಂದಿಸಿಲ್ಲ", index: "ದಾಖಲೆ ಸೂಚಿ:", indexValue: (documents: number, chunks: number) => `${documents} ದಾಖಲೆಗಳು, ${chunks} ಭಾಗಗಳು`,
    embeddings: (count: number, semantic: boolean) => `(${count} ${semantic ? "ಅರ್ಥ ಆಧಾರಿತ" : "ಸಂಗ್ರಹಿತ"} ಹುಡುಕಾಟದೊಂದಿಗೆ${semantic ? "" : "; ಪದ ಹುಡುಕಾಟ ಮಾತ್ರ"})`,
    limit: (perHour: number, retained: boolean) => `ಗಂಟೆಗೆ ${perHour} ಪ್ರಶ್ನೆಗಳ ಮಿತಿ · ಪ್ರಶ್ನೆಗಳನ್ನು ${retained ? "ಉಳಿಸಲಾಗುತ್ತದೆ" : "ಉಳಿಸುವುದಿಲ್ಲ"}.`,
    ask: "ಪ್ರಶ್ನೆ ಕೇಳಿ", askHint: "ಕನ್ನಡ ಅಥವಾ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ. ದರ, ಹೋಲಿಕೆ, ಮಾರುಕಟ್ಟೆ ಸೂಚ್ಯಂಕ, ಆವಕ, ಮುನ್ಸೂಚನೆ, ಉತ್ಪಾದನೆ, ವ್ಯಾಪಾರ, ಹವಾಮಾನ, ಬೆಳೆ ಅಪಾಯ, ಸುದ್ದಿ ಅಥವಾ ಸಂಶೋಧನಾ ದಾಖಲೆಗಳ ಬಗ್ಗೆ ಕೇಳಿ.",
    question: "ಪ್ರಶ್ನೆ", answerLanguage: "ಉತ್ತರದ ಭಾಷೆ", detect: "ಪ್ರಶ್ನೆಯಿಂದ ಗುರುತಿಸಿ", explanation: "ವಿವರಣೆ", llmOption: "ಭಾಷಾ ಮಾದರಿ (ಆಧಾರ ಪರಿಶೀಲನೆಯೊಂದಿಗೆ)", rulesOption: "ನಿಯಮ ಆಧಾರಿತ ಮಾತ್ರ",
    calculationInputs: "ಲೆಕ್ಕದ ಅಂಕಿಗಳು", none: "ಯಾವುದೂ ಇಲ್ಲ", ownFigures: "ನನ್ನ ಅಂಕಿಗಳನ್ನು ನೀಡುತ್ತೇನೆ", collecting: "ಪರಿಶೀಲಿತ ದತ್ತಾಂಶ ಸಂಗ್ರಹಿಸಲಾಗುತ್ತಿದೆ…", submit: "ಕೇಳಿ", examples: "ಉದಾಹರಣೆಗಳು",
    querying: "ಅಡಿಕೆ ನಾಡಿ ದತ್ತಾಂಶ ಮೂಲಗಳನ್ನು ಹುಡುಕಲಾಗುತ್ತಿದೆ",
    interpretation: "ವಿವರಣೆ", byModel: "ವಿವರಣೆ · ಭಾಷಾ ಮಾದರಿ", byRules: "ವಿವರಣೆ · ನಿಯಮ ಆಧಾರಿತ", grounding: (status: string) => ` · ಆಧಾರ ಪರಿಶೀಲನೆ ${status}`,
    reason: (text: string) => `ಕಾರಣ: ${text}`, rejected: (reasons: string) => `ತಿರಸ್ಕೃತ ಮಾದರಿ ಪಠ್ಯ: ${reasons}`,
    injection: (flags: string) => `ಸೂಚನೆ ಬದಲಿಸುವ ಪ್ರಯತ್ನ ಕಂಡುಬಂದಿದೆ: ${flags}. ಪರಿಶೀಲಿತ ದತ್ತಾಂಶ ಮಾತ್ರ ತೋರಿಸಲಾಗಿದೆ.`,
    facts: "ಪರಿಶೀಲಿತ ಸಂಗತಿಗಳು", factsHint: "ಅಡಿಕೆ ನಾಡಿ ಮೂಲಗಳಿಂದ ನಕಲಿಸಿದ ಮೌಲ್ಯಗಳು. ದರದ ಆಧಾರವನ್ನು ಪ್ರತ್ಯೇಕವಾಗಿ ತೋರಿಸಲಾಗಿದೆ; ಬೇರೆ ಆಧಾರಗಳನ್ನು ಹೋಲಿಸಲಾಗದು.", factsTable: "ಪರಿಶೀಲಿತ ಸಂಗತಿಗಳ ಪಟ್ಟಿ",
    fact: "ಸಂಗತಿ", value: "ಮೌಲ್ಯ", unit: "ಘಟಕ", basis: "ಆಧಾರ", reportingPeriod: "ವರದಿ ಅವಧಿ", source: "ಮೂಲ", note: "ಟಿಪ್ಪಣಿ",
    noFacts: "ಈ ಪ್ರಶ್ನೆಗೆ ಪರಿಶೀಲಿತ ಅಂಕಿಗಳಿಲ್ಲ", noFactsHint: "ಸಹಾಯಕ ಮಾದರಿಯ ಸ್ವಂತ ಜ್ಞಾನದಿಂದ ಖಾಲಿ ತುಂಬುವುದಿಲ್ಲ. ಕೆಳಗೆ ಇಲ್ಲದ ದತ್ತಾಂಶ ನೋಡಿ.",
    tools: "ಬಳಸಿದ ದತ್ತಾಂಶ ಸಾಧನಗಳು", toolsTable: "ಸಾಧನಗಳ ಪಟ್ಟಿ", selection: (how: string) => `ಸಾಧನ ಆಯ್ಕೆ: ${how}`, plannerError: (error: string) => ` · ಯೋಜಕ ದೋಷ: ${error}`,
    planning: { llm: "ಭಾಷಾ ಮಾದರಿ ಯೋಜಕ (ಪರಿಶೀಲಿತ ಅಂಶಗಳು)", rules: "ಪದ ನಿಯಮಗಳು", none: "ಹೊಂದುವ ಸಾಧನವಿಲ್ಲ" },
    tool: "ಸಾಧನ", status: "ಸ್ಥಿತಿ", summary: "ಸಾರಾಂಶ", noTool: "ಈ ಪ್ರಶ್ನೆಗೆ ಯಾವ ಅಡಿಕೆ ನಾಡಿ ಸಾಧನವೂ ಹೊಂದಲಿಲ್ಲ. ತಳಿ, ಮಾರುಕಟ್ಟೆ, ಜಿಲ್ಲೆ ಅಥವಾ ವಿಷಯವನ್ನು ಹೆಸರಿಸಿ ಕೇಳಿ.",
    assumptions: "ಲೆಕ್ಕದ ಊಹೆಗಳು", uncertainty: "ಅನಿಶ್ಚಿತತೆ", missing: "ಇಲ್ಲದ ದತ್ತಾಂಶ", limitations: "ಮಿತಿಗಳು",
    excerpts: "ದಾಖಲೆಗಳ ಭಾಗಗಳು", excerptsHint: "ಸಂಗ್ರಹಿಸಿದ ದಾಖಲೆಗಳಿಂದ ಉಲ್ಲೇಖಿಸಿದ ಭಾಗಗಳು. ಉಲ್ಲೇಖಕ್ಕೆ ಮಾತ್ರ, ರೋಗ ನಿರ್ಣಯವಲ್ಲ; ಕ್ರಮ ಕೈಗೊಳ್ಳುವ ಮೊದಲು ಕೃಷಿ ಅಧಿಕಾರಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    sources: "ಮೂಲಗಳು", sourcesHint: "ಸಂಗ್ರಹದ ಸಮಯ ಭಾರತೀಯ ಕಾಲಮಾನದಲ್ಲಿ.", sourcesTable: "ಮೂಲಗಳ ಪಟ್ಟಿ", ref: "ಉಲ್ಲೇಖ", publisher: "ಪ್ರಕಟಣಕಾರ", published: "ಪ್ರಕಟಣೆ", page: "ಪುಟ", retrieved: "ಸಂಗ್ರಹಿಸಿದ್ದು",
  },
});

const humanize = (value: string) => value.replace(/_/g, " ");

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <section className="panel table-panel"><div className="panel-heading"><div><h2>{title}</h2></div></div><div className="prose-block"><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></div></section>;
}

export function AssistantPage() {
  const t = useCopy(COPY);
  const [question, setQuestion] = useState("");
  // Answers follow the site's language toggle; the reader can still pick another language or detection for one question.
  const { language: siteLanguage } = useLanguage();
  const [language, setLanguage] = useState<"auto" | "en" | "kn">(siteLanguage);
  useEffect(() => setLanguage(siteLanguage), [siteLanguage]);
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
      for (const key of CALCULATION_KEYS) {
        const raw = calculation[key]?.trim();
        if (raw) inputs[key] = Number(raw);
      }
    }
    ask.mutate({ question: trimmed, language, use_llm: useLlm, ...(Object.keys(inputs).length ? { calculation: inputs } : {}) });
  };

  const chat = status.data?.chat;
  return <div className="page-stack">
    <section className="page-heading"><div><h1>{t.title}</h1><p className="page-intro">{t.intro}</p></div></section>

    {status.error ? <div className="data-disclosure">{t.statusUnavailable(status.error.message)}</div>
      : status.data && <AboutData title={t.howMade}><p>{t.howMadeText}</p><p>
        {t.model} <strong>{chat?.configured ? `${chat.provider} · ${chat.model}` : t.notConfigured}</strong>{chat?.reason ? ` (${chat.reason})` : ""} ·{" "}
        {t.index} <strong>{t.indexValue(status.data.corpus.documents, status.data.corpus.chunks)}</strong> {t.embeddings(status.data.corpus.embedded_chunks, status.data.embedding.configured)} ·{" "}
        {t.limit(status.data.rate_limit_per_hour, status.data.questions_retained)}
      </p></AboutData>}

    <form className="panel table-panel" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <div className="panel-heading"><div><h2>{t.ask}</h2><p>{t.askHint}</p></div></div>
      <div className="calculator-grid calculator-grid-flush">
        <label className="filter-control calculator-wide"><span>{t.question}</span>
          <textarea required minLength={2} maxLength={1000} rows={3} value={question} disabled={ask.isPending} onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); } }} />
        </label>
        <label className="filter-control"><span>{t.answerLanguage}</span><select value={language} disabled={ask.isPending} onChange={(event) => setLanguage(event.target.value as typeof language)}>
          <option value="auto">{t.detect}</option><option value="en" lang="en">English</option><option value="kn" lang="kn">ಕನ್ನಡ (Kannada)</option>
        </select></label>
        <label className="filter-control"><span>{t.explanation}</span><select value={useLlm ? "llm" : "rules"} disabled={ask.isPending} onChange={(event) => setUseLlm(event.target.value === "llm")}>
          <option value="llm">{t.llmOption}</option><option value="rules">{t.rulesOption}</option>
        </select></label>
        <label className="filter-control"><span>{t.calculationInputs}</span><select value={showCalculation ? "yes" : "no"} disabled={ask.isPending} onChange={(event) => setShowCalculation(event.target.value === "yes")}>
          <option value="no">{t.none}</option><option value="yes">{t.ownFigures}</option>
        </select></label>
        {showCalculation && CALCULATION_KEYS.map((key) => <label className="filter-control" key={key}><span>{t.fields[key]}</span>
          <input type="number" step="any" min={0} value={calculation[key] ?? ""} disabled={ask.isPending} onChange={(event) => setCalculation((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
        <div className="calculator-wide"><button className="button-primary" disabled={ask.isPending || question.trim().length < 2}>{ask.isPending ? t.collecting : t.submit}</button></div>
      </div>
      <div className="example-list"><span className="filter-label">{t.examples}</span> {EXAMPLES.map((example) => <button type="button" key={example.text} className="button-secondary example-chip" lang={example.language} disabled={ask.isPending}
        onClick={() => { setQuestion(example.text); submit(example.text); }}>{example.text}</button>)}</div>
    </form>

    {ask.isPending && <LoadingState label={t.querying} />}
    {ask.error && <ErrorState error={ask.error} onRetry={() => submit()} />}
    {answer && !ask.isPending && <AnswerView answer={answer} />}
  </div>;
}

function AnswerView({ answer }: { answer: AssistantAnswer }) {
  const t = useCopy(COPY);
  const format = useFormat();
  const grounding = answer.interpretation.grounding;
  const formatValue = (value: number | string | null) => value == null ? t.unavailable : typeof value === "number" ? value.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : value;
  return <>
    <section className="panel table-panel" aria-label={t.interpretation}>
      <div className="panel-heading"><div><h2>{answer.interpretation.generated_by === "llm" ? t.byModel : t.byRules}</h2>
        <p>{t.llm[answer.llm.status]}{answer.llm.model ? ` · ${answer.llm.provider} ${answer.llm.model}` : ""}{grounding ? t.grounding(grounding.status) : ""} · {answer.duration_ms.toLocaleString("en-IN")} ms</p></div></div>
      <div className="prose-block">
        {answer.interpretation.data_dates && <p lang={answer.language}><strong>{answer.interpretation.data_dates}</strong></p>}
        <p lang={answer.language} className="pre-wrap">{answer.interpretation.text}</p>
        <p className="card-hint" lang={answer.language}>{answer.interpretation.note}</p>
        {answer.llm.reason && answer.llm.status !== "used" && <p className="card-hint">{t.reason(answer.llm.reason)}</p>}
        {grounding?.status === "failed" && <p className="card-hint">{t.rejected(grounding.reasons.join("; "))}</p>}
        {answer.injection_flags.length > 0 && <p className="card-hint">{t.injection(answer.injection_flags.map(humanize).join(", "))}</p>}
      </div>
    </section>

    {answer.facts.length ? <section className="panel table-panel" aria-label={t.facts}>
      <div className="panel-heading"><div><h2>{t.facts}</h2><p>{t.factsHint}</p></div></div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={t.factsTable}><table>
        <thead><tr><th>{t.fact}</th><th>{t.value}</th><th>{t.unit}</th><th>{t.basis}</th><th>{t.reportingPeriod}</th><th>{t.source}</th><th>{t.note}</th></tr></thead>
        <tbody>{answer.facts.map((fact, index) => <tr key={`${fact.citation}-${fact.label}-${index}`}>
          <td>{fact.label}</td><td className="numeric">{formatValue(fact.value)}</td><td>{fact.unit ?? "—"}</td><td>{fact.basis ? humanize(fact.basis) : "—"}</td>
          <td>{fact.reporting_period ?? "—"}</td><td><span className="source-tag">[{fact.citation}]</span></td><td className="cell-wrap">{fact.note ?? ""}</td>
        </tr>)}</tbody>
      </table></div>
    </section> : <EmptyState title={t.noFacts}>{t.noFactsHint}</EmptyState>}

    <section className="panel table-panel" aria-label={t.tools}>
      <div className="panel-heading"><div><h2>{t.tools}</h2><p>{t.selection(t.planning[answer.planning] ?? t.planning.none)}{answer.planning_error ? t.plannerError(answer.planning_error) : ""}</p></div></div>
      {answer.tools.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label={t.toolsTable}><table>
        <thead><tr><th>{t.tool}</th><th>{t.status}</th><th>{t.summary}</th><th>{t.reportingPeriod}</th></tr></thead>
        <tbody>{answer.tools.map((tool, index) => <tr key={`${tool.tool}-${index}`}><td>{tool.title}</td><td>{humanize(tool.status)}</td><td className="cell-wrap">{tool.summary}</td><td>{tool.reporting_period ?? "—"}</td></tr>)}</tbody>
      </table></div> : <div className="prose-block"><p>{t.noTool}</p></div>}
    </section>

    <List title={t.assumptions} items={answer.assumptions} />
    <List title={t.uncertainty} items={answer.uncertainty} />
    <List title={t.missing} items={answer.missing} />
    <List title={t.limitations} items={answer.limitations} />

    {answer.excerpts.length > 0 && <section className="panel table-panel" aria-label={t.excerpts}>
      <div className="panel-heading"><div><h2>{t.excerpts}</h2><p>{t.excerptsHint}</p></div></div>
      <div className="prose-block">{answer.excerpts.map((excerpt, index) => <blockquote key={`${excerpt.citation}-${index}`} className="excerpt">
        <span className="source-tag">[{excerpt.citation}]</span> {excerpt.text}</blockquote>)}</div>
    </section>}

    {answer.citations.length > 0 && <section className="panel table-panel" aria-label={t.sources}>
      <div className="panel-heading"><div><h2>{t.sources}</h2><p>{t.sourcesHint}</p></div></div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={t.sourcesTable}><table>
        <thead><tr><th>{t.ref}</th><th>{t.source}</th><th>{t.publisher}</th><th>{t.reportingPeriod}</th><th>{t.published}</th><th>{t.page}</th><th>{t.retrieved}</th></tr></thead>
        <tbody>{answer.citations.map((citation) => <tr key={citation.ref}>
          <td><span className="source-tag">[{citation.ref}]</span></td>
          <td className="cell-wrap">{citation.url ? <a className="subtle-link" href={citation.url} target="_blank" rel="noopener noreferrer">{citation.label}</a> : citation.label}</td>
          <td>{citation.publisher ?? "—"}</td><td>{citation.reporting_period ?? "—"}</td><td>{citation.publication_date ?? "—"}</td><td>{citation.page ?? "—"}</td>
          <td>{citation.retrieved_at ? format.timestamp(citation.retrieved_at) : "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    <div className="data-disclosure" role="note" lang={answer.language}>{answer.disclaimer}</div>
  </>;
}

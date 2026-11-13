import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, ArrowUpRight, Check, ChevronDown, CloudSun, Copy, ExternalLink, IndianRupee, Plus, SlidersHorizontal, Sprout, ThumbsDown, ThumbsUp, type LucideIcon } from "lucide-react";
/** The assistant's own mark ("Ask Areca Pulse"): the site's palm in a speech bubble. */
import askIcon from "../assets/ask-areca-pulse.png";
import { api } from "../services/api";
import type { AssistantAnswer, AssistantCalculation, AssistantFact, AssistantQuery } from "../services/assistant";
import { defineCopy, useCopy, useLanguage, type Language } from "../services/language";
import { agmarknetVarietyName } from "../services/agmarknetVarieties";
import { ShareButton } from "../components/ShareButton";
import { SHARE_INVITE } from "../services/share";
import { formatCalendarDate, formatCalendarMonth, formatPeriodKannada } from "../../../shared/dates";

/** Starter questions by topic. Each one is routed to a tool by the assistant's classifier (see assistant.test.ts). */
const TOPICS: { key: string; icon: LucideIcon; title: Record<Language, string>; questions: Record<Language, string[]> }[] = [
  { key: "prices", icon: IndianRupee, title: { en: "Prices", kn: "ದರಗಳು" }, questions: {
    en: ["What is the latest Rashi price?", "Compare Chali prices across markets", "Should I sell Rashi now or wait?"],
    kn: ["ರಾಶಿ ಅಡಿಕೆಯ ಇತ್ತೀಚಿನ ಬೆಲೆ ಎಷ್ಟು?", "ಚಾಲಿ ದರವನ್ನು ಮಾರುಕಟ್ಟೆಗಳಲ್ಲಿ ಹೋಲಿಸಿ", "ರಾಶಿ ಈಗ ಮಾರಬೇಕೇ ಕಾಯಬೇಕೇ?"] } },
  { key: "crop", icon: Sprout, title: { en: "Crop care", kn: "ಬೆಳೆ ಆರೈಕೆ" }, questions: {
    en: ["How to manage koleroga (Mahali)?", "How to manage yellow leaf disease?", "How to prepare Bordeaux mixture?"],
    kn: ["ಕೊಳೆ ರೋಗ ನಿರ್ವಹಣೆ ಹೇಗೆ?", "ಹಳದಿ ಎಲೆ ರೋಗ ನಿರ್ವಹಣೆ ಹೇಗೆ?", "ಬೋರ್ಡೋ ದ್ರಾವಣ ತಯಾರಿಕೆ ಹೇಗೆ?"] } },
  { key: "market", icon: CloudSun, title: { en: "Markets & weather", kn: "ಮಾರುಕಟ್ಟೆ ಮತ್ತು ಹವಾಮಾನ" }, questions: {
    en: ["Karnataka arecanut production in recent years", "Arecanut imports in recent years", "Weather in Sirsi"],
    kn: ["ಕರ್ನಾಟಕದ ಅಡಿಕೆ ಉತ್ಪಾದನೆ ಎಷ್ಟು?", "ಅಡಿಕೆ ಆಮದು ಎಷ್ಟು?", "ಶಿರಸಿಯಲ್ಲಿ ಹವಾಮಾನ ಹೇಗಿದೆ?"] } },
];

const CALCULATION_KEYS = ["price", "quantity_quintals", "commission_percent", "transport_cost", "other_selling_cost", "hold_days", "storage_cost", "annual_finance_percent", "weight_loss_percent", "scenario_price"] as const;
type CalculationKey = typeof CALCULATION_KEYS[number];

const COPY = defineCopy({
  en: {
    title: "Ask Areca Pulse", intro: "Prices, markets, crop care and weather, answered from verified sources. Every figure is cited.",
    newChat: "New conversation", placeholder: "Ask about prices, crops or weather…", send: "Send", options: "Options",
    answerLanguage: "Answer language", detect: "Detect from question", explanation: "Explanation", llmOption: "Written by the assistant (checked)", rulesOption: "Data only",
    calculationInputs: "My own figures for a calculation", fields: { price: "Sale price (₹/quintal)", quantity_quintals: "Quantity (quintals)", commission_percent: "Commission (%)", transport_cost: "Transport cost (₹ total)",
      other_selling_cost: "Other selling cost (₹ total)", hold_days: "Hold period (days)", storage_cost: "Storage cost (₹ total)", annual_finance_percent: "Annual interest (%)",
      weight_loss_percent: "Weight loss while holding (%)", scenario_price: "Your expected future price (₹/quintal)" } as Record<CalculationKey, string>,
    tryAsking: "Try asking",
    thinking: ["Checking the latest rates…", "Reading the research documents…", "Writing the answer…", "Checking every figure…"],
    you: "You", assistant: "Areca Pulse", failed: "The answer could not be fetched.", retry: "Try again",
    rates: "Rates in this answer", figures: "Figures", sources: "Sources", sourceCount: (count: number) => `Sources · ${count}`, page: "p.", missing: "Not available",
    copy: "Copy", copied: "Copied", share: "Share", shareOpening: "Opening…", shareDone: "Shared", shareWhatsapp: "WhatsApp opened", shareAria: "Share this answer",
    helpful: "Helpful", notHelpful: "Not helpful", thanks: "Thanks for the feedback",
    followUps: "Ask next", followUpRead: "Read with your previous question",
    how: "How this answer was made",
    llm: { used: "Written by the assistant from the data below; every figure was checked against its source.", not_configured: "Written directly from the data (no language model).",
      disabled: "Written directly from the data, as you asked.", skipped_injection: "Written directly from the data: the question looked like an instruction to the system.",
      skipped_no_data: "No data matched, so nothing was written by the language model.", failed: "The language model was unavailable, so this is written directly from the data.",
      grounding_failed: "The language model's text could not be verified, so this is written directly from the data." } as Record<AssistantAnswer["llm"]["status"], string>,
    removed: (count: number) => `${count} sentence${count === 1 ? "" : "s"} that could not be verified ${count === 1 ? "was" : "were"} left out.`,
    retried: "The first draft failed a check and was rewritten once.",
    model: "Model", checks: "Checks", rejectedBecause: "Rejected because", tools: "Data used", assumptions: "Assumptions", uncertainty: "Uncertainty", limitations: "Limitations", time: "Time",
    footer: (limit: number, retained: boolean) => `Up to ${limit} questions an hour · Questions are ${retained ? "kept for quality checks" : "not stored"}.`,
    answerReady: "Answer ready",
  },
  kn: {
    title: "ಅಡಿಕೆ ನಾಡಿಯನ್ನು ಕೇಳಿ", intro: "ದರ, ಮಾರುಕಟ್ಟೆ, ಬೆಳೆ ಆರೈಕೆ ಮತ್ತು ಹವಾಮಾನ: ಪರಿಶೀಲಿತ ಮೂಲಗಳಿಂದ ಉತ್ತರ. ಪ್ರತಿ ಅಂಕಿಗೂ ಮೂಲ ಇದೆ.",
    newChat: "ಹೊಸ ಸಂಭಾಷಣೆ", placeholder: "ದರ, ಬೆಳೆ ಅಥವಾ ಹವಾಮಾನದ ಬಗ್ಗೆ ಕೇಳಿ…", send: "ಕಳುಹಿಸಿ", options: "ಆಯ್ಕೆಗಳು",
    answerLanguage: "ಉತ್ತರದ ಭಾಷೆ", detect: "ಪ್ರಶ್ನೆಯಿಂದ ಗುರುತಿಸಿ", explanation: "ವಿವರಣೆ", llmOption: "ಸಹಾಯಕ ಬರೆದದ್ದು (ಪರಿಶೀಲಿತ)", rulesOption: "ದತ್ತಾಂಶ ಮಾತ್ರ",
    calculationInputs: "ಲೆಕ್ಕಕ್ಕೆ ನನ್ನ ಅಂಕಿಗಳು", fields: { price: "ಮಾರಾಟ ದರ (₹/ಕ್ವಿಂಟಾಲ್)", quantity_quintals: "ಪ್ರಮಾಣ (ಕ್ವಿಂಟಾಲ್)", commission_percent: "ಕಮಿಷನ್ (%)", transport_cost: "ಸಾಗಣೆ ವೆಚ್ಚ (ಒಟ್ಟು ₹)",
      other_selling_cost: "ಇತರ ಮಾರಾಟ ವೆಚ್ಚ (ಒಟ್ಟು ₹)", hold_days: "ಕಾಯುವ ಅವಧಿ (ದಿನಗಳು)", storage_cost: "ಸಂಗ್ರಹ ವೆಚ್ಚ (ಒಟ್ಟು ₹)", annual_finance_percent: "ವಾರ್ಷಿಕ ಬಡ್ಡಿ (%)",
      weight_loss_percent: "ಕಾಯುವಾಗ ತೂಕ ನಷ್ಟ (%)", scenario_price: "ನಿಮ್ಮ ನಿರೀಕ್ಷಿತ ಮುಂದಿನ ದರ (₹/ಕ್ವಿಂಟಾಲ್)" } as Record<CalculationKey, string>,
    tryAsking: "ಹೀಗೆ ಕೇಳಿ ನೋಡಿ",
    thinking: ["ಇತ್ತೀಚಿನ ದರಗಳನ್ನು ನೋಡಲಾಗುತ್ತಿದೆ…", "ಸಂಶೋಧನಾ ದಾಖಲೆಗಳನ್ನು ಓದಲಾಗುತ್ತಿದೆ…", "ಉತ್ತರ ಬರೆಯಲಾಗುತ್ತಿದೆ…", "ಪ್ರತಿ ಅಂಕಿಯನ್ನು ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ…"],
    you: "ನೀವು", assistant: "ಅಡಿಕೆ ನಾಡಿ", failed: "ಉತ್ತರ ಪಡೆಯಲಾಗಲಿಲ್ಲ.", retry: "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ",
    rates: "ಈ ಉತ್ತರದ ದರಗಳು", figures: "ಅಂಕಿಗಳು", sources: "ಮೂಲಗಳು", sourceCount: (count: number) => `ಮೂಲಗಳು · ${count}`, page: "ಪು.", missing: "ಲಭ್ಯವಿಲ್ಲ",
    copy: "ನಕಲಿಸಿ", copied: "ನಕಲಿಸಲಾಗಿದೆ", share: "ಹಂಚಿಕೊಳ್ಳಿ", shareOpening: "ತೆರೆಯುತ್ತಿದೆ…", shareDone: "ಹಂಚಿಕೊಳ್ಳಲಾಗಿದೆ", shareWhatsapp: "ವಾಟ್ಸಾಪ್ ತೆರೆಯಿತು", shareAria: "ಈ ಉತ್ತರವನ್ನು ಹಂಚಿಕೊಳ್ಳಿ",
    helpful: "ಉಪಯುಕ್ತ", notHelpful: "ಉಪಯುಕ್ತವಲ್ಲ", thanks: "ಪ್ರತಿಕ್ರಿಯೆಗೆ ಧನ್ಯವಾದ",
    followUps: "ಮುಂದೆ ಕೇಳಿ", followUpRead: "ಹಿಂದಿನ ಪ್ರಶ್ನೆಯೊಂದಿಗೆ ಅರ್ಥೈಸಲಾಗಿದೆ",
    how: "ಈ ಉತ್ತರವನ್ನು ಹೇಗೆ ತಯಾರಿಸಲಾಯಿತು",
    llm: { used: "ಕೆಳಗಿನ ದತ್ತಾಂಶದಿಂದ ಸಹಾಯಕ ಬರೆದದ್ದು; ಪ್ರತಿ ಅಂಕಿಯನ್ನು ಅದರ ಮೂಲದೊಂದಿಗೆ ಪರಿಶೀಲಿಸಲಾಗಿದೆ.", not_configured: "ದತ್ತಾಂಶದಿಂದ ನೇರವಾಗಿ ಬರೆದದ್ದು (ಭಾಷಾ ಮಾದರಿ ಇಲ್ಲ).",
      disabled: "ನೀವು ಕೇಳಿದಂತೆ ದತ್ತಾಂಶದಿಂದ ನೇರವಾಗಿ ಬರೆದದ್ದು.", skipped_injection: "ಪ್ರಶ್ನೆ ವ್ಯವಸ್ಥೆಗೆ ಸೂಚನೆಯಂತಿತ್ತು, ಆದ್ದರಿಂದ ದತ್ತಾಂಶದಿಂದ ನೇರವಾಗಿ ಬರೆದದ್ದು.",
      skipped_no_data: "ಹೊಂದುವ ದತ್ತಾಂಶ ಸಿಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಭಾಷಾ ಮಾದರಿ ಏನೂ ಬರೆದಿಲ್ಲ.", failed: "ಭಾಷಾ ಮಾದರಿ ಲಭ್ಯವಿರಲಿಲ್ಲ, ಆದ್ದರಿಂದ ದತ್ತಾಂಶದಿಂದ ನೇರವಾಗಿ ಬರೆದದ್ದು.",
      grounding_failed: "ಭಾಷಾ ಮಾದರಿಯ ಪಠ್ಯವನ್ನು ಪರಿಶೀಲಿಸಲಾಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ದತ್ತಾಂಶದಿಂದ ನೇರವಾಗಿ ಬರೆದದ್ದು." },
    removed: (count: number) => `ಪರಿಶೀಲಿಸಲಾಗದ ${count} ವಾಕ್ಯವನ್ನು ಬಿಡಲಾಗಿದೆ.`,
    retried: "ಮೊದಲ ಕರಡು ಪರಿಶೀಲನೆಯಲ್ಲಿ ವಿಫಲವಾಯಿತು; ಒಮ್ಮೆ ಮತ್ತೆ ಬರೆಯಲಾಗಿದೆ.",
    model: "ಮಾದರಿ", checks: "ಪರಿಶೀಲನೆ", rejectedBecause: "ತಿರಸ್ಕರಿಸಿದ ಕಾರಣ", tools: "ಬಳಸಿದ ದತ್ತಾಂಶ", assumptions: "ಊಹೆಗಳು", uncertainty: "ಅನಿಶ್ಚಿತತೆ", limitations: "ಮಿತಿಗಳು", time: "ಸಮಯ",
    footer: (limit: number, retained: boolean) => `ಗಂಟೆಗೆ ಗರಿಷ್ಠ ${limit} ಪ್ರಶ್ನೆಗಳು · ಪ್ರಶ್ನೆಗಳನ್ನು ${retained ? "ಗುಣಮಟ್ಟ ಪರಿಶೀಲನೆಗಾಗಿ ಉಳಿಸಲಾಗುತ್ತದೆ" : "ಉಳಿಸುವುದಿಲ್ಲ"}.`,
    answerReady: "ಉತ್ತರ ಸಿದ್ಧ",
  },
});

type Copy = typeof COPY["en"];

/** Suggested next questions for what was just asked. Each is phrased so the assistant's own tools can answer it. */
export function followUps(answer: AssistantAnswer, language: Language): string[] {
  const tools = new Set(answer.tools.map((tool) => tool.tool));
  const variety = answer.entities?.variety;
  const name = variety ? agmarknetVarietyName(variety, language) : language === "kn" ? "ರಾಶಿ" : "Rashi";
  const kn = language === "kn";
  const priceQuestions = [
    kn ? `${name} ದರವನ್ನು ಮಾರುಕಟ್ಟೆಗಳಲ್ಲಿ ಹೋಲಿಸಿ` : `Compare ${name} prices across markets`,
    kn ? `${name} ಈಗ ಮಾರಬೇಕೇ ಕಾಯಬೇಕೇ?` : `Should I sell ${name} now or wait?`,
    kn ? `ಮುಂದಿನ ತಿಂಗಳ ${name} ದರದ ಮುನ್ಸೂಚನೆ ಏನು?` : `${name} price forecast`,
    kn ? `${name} ಅಡಿಕೆಯ ಇತ್ತೀಚಿನ ಬೆಲೆ ಎಷ್ಟು?` : `What is the latest ${name} price?`,
  ];
  if (tools.has("get_current_prices")) return [priceQuestions[0], priceQuestions[1], priceQuestions[2]];
  if (tools.has("compare_markets") || tools.has("get_price_forecast") || tools.has("calculate_sell_hold") || tools.has("get_historical_prices")) {
    return priceQuestions.filter((_, index) => !(index === 0 && tools.has("compare_markets")) && !(index === 1 && tools.has("calculate_sell_hold")) && !(index === 2 && tools.has("get_price_forecast"))).slice(0, 3);
  }
  if (tools.has("search_agricultural_documents")) return kn
    ? ["ಹಳದಿ ಎಲೆ ರೋಗ ನಿರ್ವಹಣೆ ಹೇಗೆ?", "ಬೇರು ಹುಳು ನಿಯಂತ್ರಣ ಹೇಗೆ?", "ಕೊಳೆ ರೋಗ ನಿರ್ವಹಣೆ ಹೇಗೆ?"]
    : ["How to manage yellow leaf disease?", "How to control root grub?", "How to manage koleroga (Mahali)?"];
  if (tools.has("get_production_statistics") || tools.has("get_trade_statistics")) return kn
    ? ["ಅಡಿಕೆ ಆಮದು ಎಷ್ಟು?", "ಕರ್ನಾಟಕದ ಅಡಿಕೆ ಉತ್ಪಾದನೆ ಎಷ್ಟು?", priceQuestions[3]]
    : ["Arecanut imports in recent years", "Karnataka arecanut production in recent years", priceQuestions[3]];
  return TOPICS.map((topic) => topic.questions[language][0]);
}

const CITE = /(\[(?:S|D|N)\d+\])/g;

/** Sources are folded by default; following a citation unfolds them so the link lands on its source. */
function openSource(id: string) {
  const details = document.getElementById(id)?.closest("details");
  if (details && !details.open) details.open = true;
}
function CiteLink({ anchor, refId }: { anchor: string; refId: string }) {
  const id = `${anchor}-${refId}`;
  return <a className="chat-cite" href={`#${id}`} onClick={() => openSource(id)}>{refId}</a>;
}
const plain = (text: string) => text.replace(/\s*\[(?:S|D|N)\d+\]/g, "").trim();

/** Answer text with its citation labels as small links to the source list below it. */
function CitedText({ text, anchor }: { text: string; anchor: string }) {
  return <>{text.split("\n").filter(Boolean).map((line, index) => <p key={index}>{line.split(CITE).map((part, at) => {
    const ref = /^\[((?:S|D|N)\d+)\]$/.exec(part)?.[1];
    return ref ? <CiteLink key={at} anchor={anchor} refId={ref} /> : <span key={at}>{part}</span>;
  })}</p>)}</>;
}

/** Shows a fresh answer a few words at a time; a restored or reduced-motion answer appears at once. */
function useReveal(text: string, animate: boolean) {
  const [shown, setShown] = useState(animate ? 0 : Infinity);
  useEffect(() => {
    if (!animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setShown(Infinity); return; }
    const words = text.split(/(\s+)/).length;
    const step = Math.max(2, Math.ceil(words / 45));
    const timer = window.setInterval(() => setShown((count) => { if (count >= words) { window.clearInterval(timer); return Infinity; } return count + step; }), 22);
    return () => window.clearInterval(timer);
  }, [text, animate]);
  return shown === Infinity ? text : text.split(/(\s+)/).slice(0, shown).join("");
}

/** Kind-of-price words at the end of a server label, and how they read in Kannada. */
const MEASURES: [RegExp, Record<Language, string>][] = [
  [/\s*latest modal price$/i, { en: "latest modal", kn: "ಇತ್ತೀಚಿನ ಮೋಡಲ್ ದರ" }],
  [/\s*arrival-weighted modal price$/i, { en: "arrival-weighted modal", kn: "ಆವಕ ಆಧಾರಿತ ಮೋಡಲ್ ದರ" }],
  [/\s*modal price$/i, { en: "modal", kn: "ಮೋಡಲ್ ದರ" }],
  [/\s*branch average$/i, { en: "branch average", kn: "ಶಾಖೆಯ ಸರಾಸರಿ" }],
];

/**
 * A rate tile's title is the place and variety only ("AGMARKNET Yellapur APMC – Chali latest modal price" becomes
 * "Yellapur APMC · Chali"); the source and kind of price move to the line under the figure. Variety and branch names
 * keep the source's spelling. A label in another shape keeps its words, with " · " for the dash.
 */
export function rateLabel(label: string, source: string | null | undefined, language: Language) {
  let text = label.trim();
  const sourceWord = source?.split(/\s+/)[0];
  if (sourceWord && text.startsWith(`${sourceWord} `)) text = text.slice(sourceWord.length + 1);
  let measure: string | null = null;
  const parts = text.split(/\s+–\s+/).map((part) => {
    let cleaned = part.replace(/\s+\([^)]*\)$/, "");
    for (const [pattern, words] of MEASURES) {
      if (pattern.test(cleaned)) { measure = words[language]; cleaned = cleaned.replace(pattern, ""); break; }
    }
    return cleaned.trim();
  }).filter(Boolean);
  const title = parts.join(" · ");
  return { title: title.charAt(0).toUpperCase() + title.slice(1), measure };
}

const periodText = (period: string | null, language: Language) => !period ? null
  : language === "kn" ? formatPeriodKannada(period) : /^\d{4}-\d{2}-\d{2}$/.test(period) ? formatCalendarDate(period) : /^\d{4}-\d{2}$/.test(period) ? formatCalendarMonth(period) : period;

const rupees = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const isPrice = (fact: AssistantFact) => typeof fact.value === "number" && /INR/i.test(fact.unit ?? "") && /quintal/i.test(fact.unit ?? "");

/**
 * "Price dates: TSS 6 Nov 2026 (6 days old); MAMCOS 30 Oct 2026 – 3 Nov 2026 (9 days old)." as a label and one line
 * per feed, so each feed's date can be read at a glance. Text in another shape is shown as it is.
 */
export function PriceDates({ text }: { text: string }) {
  const match = /^([^:]+):\s*(.+?)\.?$/.exec(text.trim());
  const items = match ? match[2].split(/;\s*/).filter(Boolean) : [];
  if (!match || !items.length) return <p className="chat-dates"><span>{text}</span></p>;
  return <div className="chat-dates">
    <span className="chat-dates-label">{match[1]}</span>
    <ul>{items.map((item) => {
      const age = /\(([^)]*)\)\s*$/.exec(item);
      return <li key={item}>{age ? <>{item.slice(0, age.index).trim()} <small>{age[1]}</small></> : item}</li>;
    })}</ul>
  </div>;
}

function Facts({ answer, t, language }: { answer: AssistantAnswer; t: Copy; language: Language }) {
  const [all, setAll] = useState(false);
  const facts = answer.facts.filter((fact) => fact.tool !== "search_agricultural_documents");
  const prices = facts.filter(isPrice);
  const others = facts.filter((fact) => !isPrice(fact));
  if (!facts.length) return null;
  const shownPrices = all ? prices : prices.slice(0, 6);
  return <>
    {prices.length > 0 && <section className="chat-block" aria-label={t.rates}>
      <h3>{t.rates}</h3>
      <ul className="chat-rates">{shownPrices.map((fact, index) => {
        const { title, measure } = rateLabel(fact.label, fact.source_name, language);
        const meta = [fact.source_name, measure, periodText(fact.reporting_period, language)].filter(Boolean).join(" · ");
        return <li key={`${fact.citation}-${index}`}>
          <span className="chat-rate-label">{title}</span>
          <strong>{rupees(fact.value as number)}</strong>
          <span className="chat-rate-meta">{meta} <CiteLink anchor={answer.interaction_id} refId={fact.citation} /></span>
        </li>;
      })}</ul>
      {prices.length > 6 && <button type="button" className="chat-link-button" onClick={() => setAll(!all)}>{all ? "−" : `+${prices.length - 6}`}</button>}
    </section>}
    {others.length > 0 && <section className="chat-block" aria-label={t.figures}>
      <h3>{t.figures}</h3>
      <dl className="chat-figures">{others.slice(0, 12).map((fact, index) => <div key={`${fact.citation}-${index}`}>
        <dt>{fact.label}{fact.reporting_period ? <small> · {fact.reporting_period}</small> : null}</dt>
        <dd>{fact.value == null ? t.missing : typeof fact.value === "number" ? `${fact.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}${fact.unit ? ` ${fact.unit}` : ""}` : `${fact.value}${fact.unit ? ` ${fact.unit}` : ""}`}
          {" "}<CiteLink anchor={answer.interaction_id} refId={fact.citation} /></dd>
      </div>)}</dl>
    </section>}
  </>;
}

function HowMade({ answer, t }: { answer: AssistantAnswer; t: Copy }) {
  const grounding = answer.interpretation.grounding;
  const list = (title: string, items: string[]) => items.length ? <div><h4>{title}</h4><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></div> : null;
  return <details className="chat-how">
    <summary>{t.how}</summary>
    <div className="chat-how-body">
      <p>{t.llm[answer.llm.status]}</p>
      {grounding?.removed_sentences ? <p>{t.removed(grounding.removed_sentences)}</p> : null}
      {grounding?.attempts === 2 && grounding.status === "passed" ? <p>{t.retried}</p> : null}
      {answer.follow_up && <p>{t.followUpRead}</p>}
      {list(t.tools, answer.tools.map((tool) => `${tool.title}${tool.reporting_period ? ` · ${tool.reporting_period}` : ""}`))}
      {list(t.assumptions, answer.assumptions)}
      {list(t.uncertainty, answer.uncertainty)}
      {list(t.limitations, answer.limitations)}
      {grounding?.status === "failed" && grounding.reasons.length > 0 && <div lang="en"><h4>{t.rejectedBecause}</h4><ul>{grounding.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}
      <p className="chat-how-meta" lang="en">{answer.llm.model ? `${t.model}: ${answer.llm.model} · ` : ""}{t.time}: {(answer.duration_ms / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} s</p>
    </div>
  </details>;
}

function Feedback({ answer, t }: { answer: AssistantAnswer; t: Copy }) {
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const rate = (value: "up" | "down") => {
    setRating(value);
    void api.assistantFeedback(answer.interaction_id, value).catch(() => setRating(null));
  };
  return <span className="chat-feedback" role="group" aria-label={rating ? t.thanks : t.helpful}>
    <button type="button" className="chat-icon-button" aria-pressed={rating === "up"} aria-label={t.helpful} title={t.helpful} onClick={() => rate("up")}><ThumbsUp size={16} aria-hidden="true" /></button>
    <button type="button" className="chat-icon-button" aria-pressed={rating === "down"} aria-label={t.notHelpful} title={t.notHelpful} onClick={() => rate("down")}><ThumbsDown size={16} aria-hidden="true" /></button>
    {rating && <span className="chat-feedback-thanks" role="status">{t.thanks}</span>}
  </span>;
}

export function Answer({ question, answer, fresh, latest, onAsk }: { question: string; answer: AssistantAnswer; fresh: boolean; latest: boolean; onAsk: (text: string) => void }) {
  const t = useCopy(COPY);
  const { language } = useLanguage();
  const text = useReveal(answer.interpretation.text, fresh);
  const done = text === answer.interpretation.text;
  const [copied, setCopied] = useState(false);
  const anchor = answer.interaction_id;
  const missing = !answer.facts.length && !answer.excerpts.length ? answer.missing : [];
  const sharing = () => [`*${question}*`, "", plain(answer.interpretation.text), ...(answer.interpretation.data_dates ? ["", answer.interpretation.data_dates] : []), "", `${SHARE_INVITE}: ${window.location.origin}/assistant`].join("\n");
  const copy = async () => {
    try { await navigator.clipboard.writeText(sharing()); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* The text stays selectable. */ }
  };
  return <article className={`chat-answer${latest ? " is-latest" : ""}`} lang={answer.language} aria-label={t.assistant}>
    <header className="chat-answer-head"><img className="chat-avatar" src={askIcon} alt="" width={26} height={26} /><strong>{t.assistant}</strong></header>
    <div className="chat-text"><CitedText text={text} anchor={anchor} /></div>
    {done && <>
      {answer.interpretation.data_dates && <PriceDates text={answer.interpretation.data_dates} />}
      {missing.length > 0 && <ul className="chat-missing">{missing.map((item) => <li key={item}>{item}</li>)}</ul>}
      <Facts answer={answer} t={t} language={language} />
      {answer.citations.length > 0 && <details className="chat-sources-box">
        <summary><span>{t.sourceCount(answer.citations.length)}</span>
          <span className="chat-sources-peek" aria-hidden="true">{answer.citations.slice(0, 4).map((citation) => <i key={citation.ref}>{citation.ref}</i>)}</span>
          <ChevronDown size={16} aria-hidden="true" className="chat-sources-chevron" /></summary>
        <ol className="chat-sources" aria-label={t.sources}>{answer.citations.map((citation) => <li key={citation.ref} id={`${anchor}-${citation.ref}`}>
          <span className="chat-cite chat-cite-static">{citation.ref}</span>
          <span className="chat-source-text">{citation.url ? <a href={citation.url} target="_blank" rel="noopener noreferrer">{citation.label}<ExternalLink size={14} aria-hidden="true" /></a> : citation.label}
            <small>{[citation.publisher, citation.reporting_period].filter(Boolean).join(" · ")}</small></span>
        </li>)}</ol>
      </details>}
      <p className="chat-disclaimer">{answer.disclaimer}</p>
      <footer className="chat-actions">
        <button type="button" className="chat-icon-button chat-text-button" onClick={() => void copy()}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? t.copied : t.copy}</button>
        <ShareButton labels={{ share: t.share, opening: t.shareOpening, shared: t.shareDone, whatsapp: t.shareWhatsapp }} ariaLabel={t.shareAria} title={question} message={sharing} />
        <Feedback answer={answer} t={t} />
      </footer>
      <HowMade answer={answer} t={t} />
      {latest && <nav className="chat-follow-ups" aria-label={t.followUps}>
        <span>{t.followUps}</span>
        {followUps(answer, language).map((item) => <button type="button" key={item} onClick={() => onAsk(item)}>{item}</button>)}
      </nav>}
    </>}
  </article>;
}

function Thinking({ t }: { t: Copy }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setStep((current) => Math.min(current + 1, t.thinking.length - 1)), 1700);
    return () => window.clearInterval(timer);
  }, [t]);
  return <div className="chat-answer chat-thinking" role="status">
    <header className="chat-answer-head"><img className="chat-avatar" src={askIcon} alt="" width={26} height={26} /><strong>{t.assistant}</strong></header>
    <p><span className="chat-dots" aria-hidden="true"><i /><i /><i /></span><span key={step} className="chat-thinking-step">{t.thinking[step]}</span></p>
    <div className="chat-skeleton" aria-hidden="true"><span /><span /><span /></div>
  </div>;
}

type Turn = { id: string; question: string; answer?: AssistantAnswer; error?: string; pending?: boolean; fresh?: boolean; query: AssistantQuery };
const STORE_KEY = "ani-assistant-conversation";
const MAX_STORED = 12;

function storedTurns(): Turn[] {
  try {
    const turns = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "[]") as Turn[];
    return Array.isArray(turns) ? turns.filter((turn) => turn.answer).map((turn) => ({ ...turn, fresh: false })) : [];
  } catch { return []; }
}

export function AssistantPage() {
  const t = useCopy(COPY);
  const { language: siteLanguage } = useLanguage();
  const [turns, setTurns] = useState<Turn[]>(storedTurns);
  const [question, setQuestion] = useState("");
  const [language, setLanguage] = useState<"auto" | "en" | "kn">(siteLanguage);
  useEffect(() => setLanguage(siteLanguage), [siteLanguage]);
  const [useLlm, setUseLlm] = useState(true);
  const [calculation, setCalculation] = useState<Record<string, string>>({});
  const [showCalculation, setShowCalculation] = useState(false);
  const [announce, setAnnounce] = useState("");
  const status = useQuery({ queryKey: ["assistant-status"], queryFn: api.assistantStatus, staleTime: 120_000 });
  const input = useRef<HTMLTextAreaElement>(null);
  const pending = turns.some((turn) => turn.pending);
  // The question box grows with its text up to its CSS max-height, in browsers without field-sizing.
  useEffect(() => {
    const box = input.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
  }, [question]);

  useEffect(() => {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(turns.filter((turn) => turn.answer).slice(-MAX_STORED).map(({ fresh: _fresh, ...turn }) => turn))); } catch { /* The conversation lasts until the page closes. */ }
  }, [turns]);

  /** Brings a question and its answer card to the top of the screen, above the composer. */
  const showTurn = (id: string) => window.requestAnimationFrame(() => document.getElementById(`turn-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));

  async function run(turn: Turn) {
    try {
      const answer = await api.askAssistant(turn.query);
      setTurns((current) => current.map((item) => item.id === turn.id ? { ...item, answer, pending: false, fresh: true, error: undefined } : item));
      setAnnounce(t.answerReady);
      showTurn(turn.id);
    } catch (error) {
      setTurns((current) => current.map((item) => item.id === turn.id ? { ...item, pending: false, error: error instanceof Error ? error.message : t.failed } : item));
    }
  }

  function ask(text = question) {
    const trimmed = text.trim();
    if (trimmed.length < 2 || pending) return;
    const inputs: AssistantCalculation = {};
    if (showCalculation) for (const key of CALCULATION_KEYS) { const raw = calculation[key]?.trim(); if (raw) inputs[key] = Number(raw); }
    const previous = [...turns].reverse().find((turn) => turn.answer)?.question;
    const query: AssistantQuery = { question: trimmed, language, use_llm: useLlm, ...(Object.keys(inputs).length ? { calculation: inputs } : {}), ...(previous ? { context: { previous_question: previous } } : {}) };
    const turn: Turn = { id: crypto.randomUUID(), question: trimmed, pending: true, query };
    setTurns((current) => [...current, turn]);
    setQuestion("");
    setAnnounce("");
    // On touch screens the keyboard would cover the answer that is loading, so it is closed.
    if (window.matchMedia?.("(pointer: coarse)").matches) input.current?.blur();
    showTurn(turn.id);
    void run(turn);
  }

  const retry = (turn: Turn) => {
    setTurns((current) => current.map((item) => item.id === turn.id ? { ...item, pending: true, error: undefined } : item));
    showTurn(turn.id);
    void run(turn);
  };
  const lastAnswered = [...turns].reverse().find((turn) => turn.answer)?.id;

  return <div className={`assistant-page${turns.length ? " has-turns" : ""}`} lang={siteLanguage}>
    <header className="assistant-head">
      <div className="assistant-brand">
        <img src={askIcon} alt="" width={52} height={52} className="assistant-brand-mark" />
        <div><h1>{t.title}</h1><p>{t.intro}</p></div>
      </div>
      {turns.length > 0 && <button type="button" className="button-secondary assistant-new" aria-label={t.newChat} title={t.newChat} disabled={pending} onClick={() => { setTurns([]); input.current?.focus(); }}><Plus size={16} aria-hidden="true" /><span className="assistant-new-label">{t.newChat}</span></button>}
    </header>

    <div className="assistant-thread">
      {!turns.length && <section className="assistant-topics" aria-label={t.tryAsking}>
        <h2>{t.tryAsking}</h2>
        <div className="assistant-topic-grid">{TOPICS.map((topic) => {
          const Icon = topic.icon;
          return <div className="assistant-topic" key={topic.key}>
            <h3><span className="assistant-topic-icon" aria-hidden="true"><Icon size={16} /></span>{topic.title[siteLanguage]}</h3>
            <ul>{topic.questions[siteLanguage].map((example) => <li key={example}><button type="button" onClick={() => ask(example)}>
              {/* On phones the topic headings are hidden and each question carries its topic's icon instead. */}
              <span className="assistant-topic-q-icon" aria-hidden="true"><Icon size={16} /></span>
              <span className="assistant-topic-q">{example}</span><ArrowUpRight size={16} aria-hidden="true" /></button></li>)}</ul>
          </div>;
        })}</div>
      </section>}
      {turns.map((turn) => <div className="chat-turn" key={turn.id} id={`turn-${turn.id}`} aria-busy={turn.pending || undefined}>
        <p className="chat-user" aria-label={t.you}>{turn.question}</p>
        {turn.pending ? <Thinking t={t} />
          : turn.error ? <div className="chat-answer chat-error" role="alert"><p>{t.failed}</p><button type="button" className="button-secondary" onClick={() => retry(turn)}>{t.retry}</button></div>
          : turn.answer && <Answer question={turn.question} answer={turn.answer} fresh={Boolean(turn.fresh)} latest={turn.id === lastAnswered} onAsk={ask} />}
      </div>)}
      <p className="sr-only" role="status">{announce}</p>
    </div>

    <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); ask(); }}>
      <div className="assistant-input">
        <textarea ref={input} rows={1} maxLength={1000} value={question} placeholder={t.placeholder} aria-label={t.placeholder}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); ask(); } }} />
        <button className={`assistant-send${pending ? " is-busy" : ""}`} disabled={pending || question.trim().length < 2} aria-label={t.send} title={t.send}>
          {pending ? <span className="assistant-spinner" aria-hidden="true" /> : <ArrowUp size={18} aria-hidden="true" />}</button>
      </div>
      <details className="assistant-options">
        <summary><SlidersHorizontal size={14} aria-hidden="true" />{t.options}</summary>
        <div className="assistant-options-grid">
          <label className="filter-control"><span>{t.answerLanguage}</span><select value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}>
            <option value="auto">{t.detect}</option><option value="en" lang="en">English</option><option value="kn" lang="kn">ಕನ್ನಡ</option></select></label>
          <label className="filter-control"><span>{t.explanation}</span><select value={useLlm ? "llm" : "rules"} onChange={(event) => setUseLlm(event.target.value === "llm")}>
            <option value="llm">{t.llmOption}</option><option value="rules">{t.rulesOption}</option></select></label>
          <label className="assistant-check"><input type="checkbox" checked={showCalculation} onChange={(event) => setShowCalculation(event.target.checked)} />{t.calculationInputs}</label>
          {showCalculation && CALCULATION_KEYS.map((key) => <label className="filter-control" key={key}><span>{t.fields[key]}</span>
            <input type="number" step="any" min={0} inputMode="decimal" value={calculation[key] ?? ""} onChange={(event) => setCalculation((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
        </div>
      </details>
      {status.data && <p className="assistant-foot">{t.footer(status.data.rate_limit_per_hour, status.data.questions_retained)}</p>}
    </form>
  </div>;
}


/** Response shapes of the ANI assistant API (`api/src/assistant`). */
export type AssistantLanguage = "en" | "kn";
export type AssistantToolStatus = "ok" | "empty" | "needs_input" | "unavailable" | "error";
export type AssistantLlmStatus = "used" | "not_configured" | "disabled" | "skipped_injection" | "skipped_no_data" | "failed" | "grounding_failed";

export type AssistantCitation = {
  ref: string;
  key: string;
  kind: "data" | "document" | "news";
  label: string;
  publisher: string | null;
  url: string | null;
  reporting_period: string | null;
  retrieved_at: string | null;
  publication_date?: string | null;
  page?: string | null;
};

export type AssistantFact = {
  label: string;
  value: number | string | null;
  unit?: string | null;
  basis?: string | null;
  reporting_period: string | null;
  source_key: string;
  note?: string | null;
  citation: string;
  tool: string;
};

export type AssistantCalculation = Partial<Record<
  "price" | "quantity_quintals" | "commission_percent" | "transport_cost" | "other_selling_cost" | "hold_days" | "storage_cost" | "annual_finance_percent" | "weight_loss_percent" | "scenario_price",
  number
>> & { variety?: string };

export type AssistantQuery = { question: string; language?: "auto" | AssistantLanguage; calculation?: AssistantCalculation; use_llm?: boolean };

export type AssistantAnswer = {
  language: AssistantLanguage;
  tools: { tool: string; status: AssistantToolStatus; title: string; summary: string; reporting_period: string | null; args: Record<string, unknown> }[];
  facts: AssistantFact[];
  interpretation: {
    text: string;
    generated_by: "llm" | "rules";
    note: string;
    grounding: { status: "passed" | "failed"; reasons: string[]; ungrounded_numbers: number[]; unknown_citations: string[] } | null;
  };
  assumptions: string[];
  uncertainty: string[];
  missing: string[];
  limitations: string[];
  excerpts: { citation: string; text: string }[];
  citations: AssistantCitation[];
  disclaimer: string;
  llm: { status: AssistantLlmStatus; provider: string | null; model: string | null; reason: string | null };
  injection_flags: string[];
  answer_text: string;
  planning: "rules" | "llm" | "none";
  planning_error: string | null;
  interaction_id: string;
  duration_ms: number;
};

export type ProviderStatus = { provider: string; model: string | null; configured: boolean; reason: string | null };

export type AssistantStatus = {
  available: boolean;
  chat: ProviderStatus;
  embedding: ProviderStatus;
  embedding_canonical_model: string;
  semantic_threshold: number;
  corpus: { documents: number; chunks: number; embedded_chunks: number };
  rate_limit_per_hour: number;
  questions_retained: boolean;
  last_24_hours: { llm_status: string; requests: number }[];
  tools: number;
  guarantees: string[];
};

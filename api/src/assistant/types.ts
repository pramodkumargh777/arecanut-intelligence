/** Shared assistant types. */
export const TOOL_NAMES = [
  "get_current_prices",
  "get_historical_prices",
  "compare_markets",
  "get_market_index",
  "get_market_arrivals",
  "get_price_forecast",
  "get_production_statistics",
  "get_trade_statistics",
  "get_weather",
  "get_advisories",
  "calculate_net_realization",
  "calculate_sell_hold",
  "search_industry_news",
  "search_agricultural_documents",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** A citable origin of a fact. `id` is assigned per answer (S1, S2 … for data, D1, D2 … for documents). */
export type SourceRef = {
  key: string;
  kind: "data" | "document" | "news";
  label: string;
  publisher: string | null;
  url: string | null;
  /** Market/statistical period the data describes (date, month, year range). */
  reporting_period: string | null;
  /** When ANI retrieved the source (ISO timestamp, UTC). */
  retrieved_at: string | null;
  publication_date?: string | null;
  page?: string | null;
};

/** One verified value returned by an ANI endpoint. Values are copied, never computed by the language model. */
export type Fact = {
  label: string;
  value: number | string | null;
  unit?: string | null;
  /** Price basis / measure type, e.g. APMC_MODAL, COOPERATIVE_AVERAGE, MONTHLY_STATE_WEIGHTED_AVERAGE. */
  basis?: string | null;
  reporting_period: string | null;
  source_key: string;
  note?: string | null;
  /** Set on market prices only: the feed the price came from (MAMCOS, TSS, "AGMARKNET daily", …). */
  source_name?: string | null;
};

export type ToolStatus = "ok" | "empty" | "needs_input" | "unavailable" | "error";

export type ToolResult = {
  tool: ToolName;
  status: ToolStatus;
  title: string;
  summary: string;
  facts: Fact[];
  sources: SourceRef[];
  assumptions: string[];
  uncertainty: string[];
  missing: string[];
  limitations: string[];
  reporting_period: string | null;
  args: Record<string, unknown>;
  /** Plain statements built from this tool's facts, in the reader's language; shown when no model text is used. */
  highlights?: string[];
  /** Untrusted document text passed to the language model as quoted evidence (documents/news only). */
  excerpts?: {
    source_key: string; text: string; scanned?: boolean;
    /** Language of the source document ("en", "kn"). */
    language?: string;
    /** An expert-reviewed knowledge card (knowledge-cards.ts): clean text whose numbers count as verified. */
    reviewed?: boolean;
  }[];
};

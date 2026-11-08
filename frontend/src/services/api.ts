import type { CommodityCatalog } from "../../../shared/commodities";
import type { Market, Overview, PriceObservation, QualityRecord, ReferencePoint, SourceStatus } from "../types";
import type { CooperativeCommodity, CooperativeData, CooperativeQuote, CooperativeSource, CooperativeSourceStatus, CsvImportRequest, CsvImportSummary, PermissionStatus, RefreshSummary, ReplaySummary, ReviewResult, TssBackfillSummary, TumcosRefreshSummary } from "./cooperative";
import type { MonthlyHistory, MonthlyEvidence, Aggregates, CalculationInputs, Calculation, DecisionPrices } from "./intelligence";
import type { ArrivalPriceComparison, DistrictProduction, SupplyAdvisories, SupplyArrivals, SupplyProduction, SupplyWeather, RiskRule } from "./supply";
import type { ForecastingOverview, ForecastingPerformance, ModelEvaluation, Page, StoredPrediction } from "./forecasting";
import type { AssistantAnswer, AssistantQuery, AssistantStatus } from "./assistant";
import type { ModuleDomain, ModuleData, Production, Trade, Weather, Bulletin, QualityInput, QualityInspection, ForecastData } from "./modules";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787/api/v1").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    throw new Error("The Areca Pulse API is unavailable. Start the API service and try again.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

function queryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const result = search.toString();
  return result ? `?${result}` : "";
}

/** Reviewer queues are paginated server-side; the browser holds one page at a time. */
export const QUEUE_PAGE_SIZE = 50;
export type QueuePage<T> = { data: T[]; total: number; limit: number; offset: number };

export const api = {
  assistantStatus: () => request<AssistantStatus>("/assistant/status"),
  askAssistant: (query: AssistantQuery) => request<AssistantAnswer>("/assistant/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query) }),
  intelligence: <T extends Production | Trade | Weather | Bulletin>(domain: ModuleDomain) => request<ModuleData<T>>(`/intelligence/${domain}`),
  sourceCaptureUrl: (id: string) => `${API_BASE_URL}/intelligence/captures/${encodeURIComponent(id)}`,
  refreshIntelligence: (domain: "weather" | "news", token: string) => request<{ count?: number }>(`/admin/intelligence/${domain}/refresh`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }),
  qualityInspections: () => request<{ data: QualityInspection[]; coverage: string; limit: number }>("/intelligence/quality/records"),
  privateInspections: (token: string) => request<{ data: QualityInspection[] }>("/admin/intelligence/quality", { headers: { Authorization: `Bearer ${token}` } }),
  submitInspection: (input: QualityInput, token: string) => request<{ id: string }>("/admin/intelligence/quality", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  reviewInspection: (id: string, action: "verify" | "reject", note: string, token: string) => request<{ success: boolean }>(`/admin/intelligence/quality/${encodeURIComponent(id)}/review`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, note }) }),
  forecasts: (variety: string) => request<ForecastData>(`/forecasts${queryString({ variety })}`),
  supplyProduction: (geography: string, compare: string) => request<SupplyProduction>(`/supply/production${queryString({ geography, compare })}`),
  supplyDistricts: (state: string) => request<DistrictProduction>(`/supply/production/districts${queryString({ state })}`),
  supplyArrivals: (params: Record<string, string | undefined>) => request<SupplyArrivals>(`/supply/arrivals${queryString(params)}`),
  arrivalPriceComparison: (params: Record<string, string | undefined>) => request<ArrivalPriceComparison>(`/supply/arrivals/price-comparison${queryString(params)}`),
  supplyWeather: (params: Record<string, string | undefined>) => request<SupplyWeather>(`/supply/weather${queryString(params)}`),
  supplyRiskRules: () => request<{ rules: RiskRule[]; policy: string }>("/supply/risk/rules"),
  supplyAdvisories: (district: string) => request<SupplyAdvisories>(`/supply/risk/advisories${queryString({ district })}`),
  forecastingOverview: () => request<ForecastingOverview>("/forecasting/overview"),
  forecastingEvaluations: (params: Record<string, string | undefined>) => request<Page<ModelEvaluation>>(`/forecasting/evaluations${queryString(params)}`),
  forecastingPredictions: (params: Record<string, string | undefined>) => request<Page<StoredPrediction>>(`/forecasting/predictions${queryString(params)}`),
  forecastingPerformance: () => request<ForecastingPerformance>("/forecasting/performance"),
  evaluateForecast: (variety: string, token: string) => request<ForecastData>("/admin/forecasts/evaluate", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ variety }) }),
  monthlyHistory: (from: string, to: string, variety: string) => request<MonthlyHistory>(`/history/monthly${queryString({ from, to, variety })}`),
  monthlySnapshotUrl: (id: string) => `${API_BASE_URL}/history/monthly/snapshots/${encodeURIComponent(id)}`,
  monthlyEvidence: (id: string, variety: string) => request<MonthlyEvidence>(`/history/monthly/snapshots/${encodeURIComponent(id)}/evidence${queryString({ variety })}`),
  aggregates: (params: Record<string, string>) => request<Aggregates>(`/history/aggregates${queryString(params)}`),
  decisionPrices: () => request<DecisionPrices>("/decisions/prices"),
  calculate: (input: CalculationInputs) => request<Calculation>("/decisions/calculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  saveCalculation: (input: CalculationInputs, token: string) => request<Calculation>("/admin/decisions", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input),
  }),
  savedCalculations: (token: string) => request<{ data: Calculation[] }>("/admin/decisions", { headers: { Authorization: `Bearer ${token}` } }),
  cooperativePrices: (source: CooperativeSource, variety?: string, commodity?: CooperativeCommodity, range: { from?: string; to?: string } = {}, limit?: number) =>
    request<CooperativeData>(`/cooperative/prices${queryString({ source, variety, commodity, from: range.from || undefined, to: range.to || undefined, limit: limit ? String(limit) : undefined })}`),
  cooperativeQuality: (token: string, source?: CooperativeSource, offset = 0, limit = QUEUE_PAGE_SIZE) => request<QueuePage<CooperativeQuote>>(`/admin/cooperative/quality${queryString({ source, limit: String(limit), offset: String(offset) })}`, { headers: { Authorization: `Bearer ${token}` } }),
  refreshMamcos: (token: string) => request<RefreshSummary>("/admin/cooperative/refresh", { method: "POST", headers: { Authorization: `Bearer ${token}` } }),
  refreshTss: (token: string, date: string, includeLots = false) => request<RefreshSummary & { excluded_count: number }>("/admin/cooperative/tss/refresh", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ date, include_lots: includeLots }),
  }),
  backfillTss: (token: string, start: string, end: string) => request<TssBackfillSummary>("/admin/cooperative/tss/backfill", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ start, end }),
  }),
  refreshTumcos: (token: string, scope: "recent" | "full_history") => request<TumcosRefreshSummary>("/admin/cooperative/tumcos/refresh", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ scope }),
  }),
  importCooperativeCsv: (token: string, input: CsvImportRequest) => request<CsvImportSummary>("/admin/cooperative/import", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input),
  }),
  replayCooperativeSnapshot: (token: string, fetchId: string, scope: "recent" | "full_history" = "recent") => request<ReplaySummary>(`/admin/cooperative/replay/${encodeURIComponent(fetchId)}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ scope }),
  }),
  cooperativeSources: (token: string) => request<CooperativeSourceStatus>("/admin/cooperative/sources", { headers: { Authorization: `Bearer ${token}` } }),
  updateCooperativePermission: (token: string, source: CooperativeSource, input: { permission_status: PermissionStatus; scheduled_collection_allowed: boolean; redistribution_allowed: boolean; permission_reference: string | null; notes?: string }) =>
    request<unknown>(`/admin/cooperative/sources/${source}/permission`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  cooperativeReview: (id: string, token: string, action: "approve" | "reject") => request<ReviewResult>(`/admin/cooperative/${encodeURIComponent(id)}/review`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action }),
  }),
  monthlyPrices: (month?: string, variety?: string) => request<{
    data: { reporting_month: string; state: string; variety_name: string; weighted_price: number | null; price_unit: string; source_url: string; fetched_at: string }[];
    months: string[]; reporting_month: string | null; state: string; methodology: string;
    history: { reporting_month: string; weighted_price: number | null; fetched_at: string | null }[];
    last_run: { reporting_month: string; started_at: string; finished_at: string | null; status: string; record_count: number | null; error_message: string | null } | null;
  }>(`/monthly-prices${queryString({ month, variety })}`),
  refreshMonthly: (month: string, token: string) => request<{ reporting_month: string; record_count: number }>("/admin/monthly/refresh", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ month }),
  }),
  commodities: () => request<CommodityCatalog>("/commodities"),
  overview: (variety: string | undefined, commodity: string) => request<{ data: Overview }>(`/overview${queryString({ variety, commodity })}`).then((response) => response.data),
  markets: (commodity: string) => request<{ data: Market[] }>(`/markets${queryString({ commodity })}`).then((response) => response.data),
  varieties: (commodity: string) => request<{ data: string[] }>(`/varieties${queryString({ commodity })}`).then((response) => response.data),
  prices: (params: Record<string, string | undefined>) =>
    request<{ data: PriceObservation[]; count: number | null; limit: number; next_cursor: string | null }>(`/prices${queryString(params)}`),
  referenceIndex: (params: Record<string, string | undefined>) =>
    request<{ data: ReferencePoint[]; minimum_market_coverage: number; methodology: string; truncated?: boolean }>(
      `/analytics/reference-index${queryString(params)}`,
    ),
  marketComparison: (variety: string | undefined, commodity: string) =>
    request<{ data: PriceObservation[]; reason?: string }>(
      `/analytics/market-comparison${queryString({ variety, commodity })}`,
    ),
  qualityQueue: (token: string, offset = 0, limit = QUEUE_PAGE_SIZE) =>
    request<QueuePage<QualityRecord>>(`/admin/quality${queryString({ limit: String(limit), offset: String(offset) })}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  sourceStatus: (token: string) =>
    request<SourceStatus>("/admin/source-status", { headers: { Authorization: `Bearer ${token}` } }),
  review: (id: string, token: string, action: "approve" | "reject") =>
    request<{ success: boolean }>(`/admin/observations/${encodeURIComponent(id)}/review`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }),
};

import type { Market, Overview, PriceObservation, QualityRecord, ReferencePoint } from "../types";
import type { CooperativeData, CooperativeQuote } from "./cooperative";
import type { MonthlyHistory, Aggregates, CalculationInputs, Calculation, DecisionPrices } from "./intelligence";
import type { ModuleDomain, ModuleData, Production, Trade, Weather, Bulletin, QualityInput, QualityInspection, ForecastData } from "./modules";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787/api/v1").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    throw new Error("The ANI API is unavailable. Start the API service and try again.");
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

export const api = {
  intelligence: <T extends Production | Trade | Weather | Bulletin>(domain: ModuleDomain) => request<ModuleData<T>>(`/intelligence/${domain}`),
  sourceCaptureUrl: (id: string) => `${API_BASE_URL}/intelligence/captures/${encodeURIComponent(id)}`,
  refreshIntelligence: (domain: "weather" | "news", token: string) => request<{ count?: number }>(`/admin/intelligence/${domain}/refresh`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }),
  qualityInspections: () => request<{ data: QualityInspection[]; coverage: string; limit: number }>("/intelligence/quality/records"),
  privateInspections: (token: string) => request<{ data: QualityInspection[] }>("/admin/intelligence/quality", { headers: { Authorization: `Bearer ${token}` } }),
  submitInspection: (input: QualityInput, token: string) => request<{ id: string }>("/admin/intelligence/quality", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  reviewInspection: (id: string, action: "verify" | "reject", note: string, token: string) => request<{ success: boolean }>(`/admin/intelligence/quality/${encodeURIComponent(id)}/review`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, note }) }),
  forecasts: (variety: string) => request<ForecastData>(`/forecasts${queryString({ variety })}`),
  evaluateForecast: (variety: string, token: string) => request<ForecastData>("/admin/forecasts/evaluate", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ variety }) }),
  monthlyHistory: (from: string, to: string, variety: string) => request<MonthlyHistory>(`/history/monthly${queryString({ from, to, variety })}`),
  monthlySnapshotUrl: (id: string) => `${API_BASE_URL}/history/monthly/snapshots/${encodeURIComponent(id)}`,
  aggregates: (params: Record<string, string>) => request<Aggregates>(`/history/aggregates${queryString(params)}`),
  decisionPrices: () => request<DecisionPrices>("/decisions/prices"),
  calculate: (input: CalculationInputs) => request<Calculation>("/decisions/calculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  saveCalculation: (input: CalculationInputs, token: string) => request<Calculation>("/admin/decisions", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input),
  }),
  savedCalculations: (token: string) => request<{ data: Calculation[] }>("/admin/decisions", { headers: { Authorization: `Bearer ${token}` } }),
  cooperativePrices: (source: string, variety?: string) => request<CooperativeData>(`/cooperative/prices${queryString({ source, variety })}`),
  cooperativeQuality: (token: string) => request<{ data: CooperativeQuote[] }>("/admin/cooperative/quality", { headers: { Authorization: `Bearer ${token}` } }),
  refreshMamcos: (token: string) => request<{ received_count: number; inserted_count: number; invalid_count: number }>("/admin/cooperative/refresh", { method: "POST", headers: { Authorization: `Bearer ${token}` } }),
  refreshTss: (token: string, date: string) => request<{ received_count: number; inserted_count: number; invalid_count: number; excluded_count: number }>("/admin/cooperative/tss/refresh", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ date, accept_assumed_unit: true }),
  }),
  cooperativeReview: (id: string, token: string, action: "approve" | "reject") => request<{ success: boolean }>(`/admin/cooperative/${encodeURIComponent(id)}/review`, {
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
  overview: (variety?: string) => request<{ data: Overview }>(`/overview${queryString({ variety })}`).then((response) => response.data),
  markets: () => request<{ data: Market[] }>("/markets").then((response) => response.data),
  varieties: () => request<{ data: string[] }>("/varieties").then((response) => response.data),
  prices: (params: Record<string, string | undefined>) =>
    request<{ data: PriceObservation[]; count: number }>(`/prices${queryString(params)}`),
  referenceIndex: (params: Record<string, string | undefined>) =>
    request<{ data: ReferencePoint[]; minimum_market_coverage: number; methodology: string }>(
      `/analytics/reference-index${queryString(params)}`,
    ),
  marketComparison: (variety?: string) =>
    request<{ data: PriceObservation[]; reason?: string }>(
      `/analytics/market-comparison${queryString({ variety })}`,
    ),
  qualityQueue: (token: string) =>
    request<{ data: QualityRecord[]; count: number }>("/admin/quality", {
      headers: { Authorization: `Bearer ${token}` },
    }),
  review: (id: string, token: string, action: "approve" | "reject") =>
    request<{ success: boolean }>(`/admin/observations/${encodeURIComponent(id)}/review`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }),
};

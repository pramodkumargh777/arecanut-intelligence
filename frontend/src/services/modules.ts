export type Evidence = { capture_id: string; source_key: string; source_url: string; fetched_at: string; publication_period: string | null; content_hash: string };
export type Production = Evidence & { geography: string; period: string; estimate_status: string; area_thousand_hectares: number | null; production_thousand_tonnes: number | null; yield_kg_hectare: number | null };
export type Trade = Evidence & { partner: string; period: string; direction: "Import" | "Export"; quantity_tonnes: number | null; value_inr_lakh: number | null };
export type Weather = Evidence & { date: string; kind: "recent_model" | "forecast_model"; temperature_max_c: number | null; temperature_min_c: number | null; precipitation_mm: number | null; grid_latitude: number; grid_longitude: number; elevation_m: number };
export type Bulletin = Evidence & { release_id: string; title: string; published_on: string; is_policy: number };
export type ModuleDomain = "production" | "trade" | "weather" | "news" | "policy";
export type SourceAttempt = { id: string; source_key: string; started_at: string; finished_at: string | null; status: string; error_message: string | null };
export type ModuleData<T> = { domain: string; data: T[]; attempts: SourceAttempt[]; coverage: string };
export type QualityInput = { lot_id: string; variety: string; location: string; sampled_on: string; reported_on: string; laboratory: string; report_reference: string; evidence_url: string; moisture_percent: number | null; defects_percent: number | null; notes: string };
export type QualityInspection = QualityInput & { id: string; submitted_at: string; status: string; review_note: string | null; reviewed_at: string | null };
export type ForecastMetrics = { count: number; mae: number; rmse: number; smape_percent: number };
export type ForecastPoint = { reporting_month: string; training_through: string; actual: number; last_value: number; seasonal_naive: number };
export type Forecast = { reporting_month: string; model: string; point: number; lower: number; upper: number; nominal_coverage: number; method: string };
export type ForecastData = {
  status: string; stale: boolean; stale_reasons: string[]; forecast: Forecast | null;
  snapshot: null | {
    id: string; state: string; variety: string; evaluated_at: string; formula_version: string; source_fingerprint: string;
    inputs: { prices: { reporting_month: string; weighted_price: number | null; fetched_at: string; refresh_run_id: string; source_url: string }[] };
    results: {
      publishable: boolean; reasons: string[]; gates: Record<string, boolean>; limitations: string[];
      history: { count: number; from: string | null; through: string | null };
      evaluation: null | {
        selected_model: "last_value" | "seasonal_naive"; label: string; selection_rule: string; initial_training_months: number;
        validation: { points: ForecastPoint[]; metrics: { last_value: ForecastMetrics; seasonal_naive: ForecastMetrics } };
        calibration: { count: number; absolute_residual_radius: number; nominal_coverage: number; quantile_rank: number };
        holdout: { points: ForecastPoint[]; selected: ForecastMetrics; naive: ForecastMetrics; covered: number; interval_coverage: number; mae_skill_vs_naive: number | null };
      };
    };
  };
};

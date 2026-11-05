export type Period = { from: string; to: string } | null;
export type ForecastGate = { status: "suppressed" | "eligible_for_evaluation"; points: number; minimum: number; reason: string };

export type ProductionEstimate = {
  evidence_id: string; source_key: string; publisher: string; source_url: string; reporting_year: string; geography: string;
  geography_level: "country" | "state" | "district"; state: string | null; district: string | null;
  estimate_type: string; estimate_label: string; area_thousand_hectares: number | null; production_thousand_tonnes: number | null;
  yield_kg_hectare: number | null; publication_date: string | null; publication_precision: string | null; recorded_at: string;
  vintages?: number; revised?: boolean; stage_changed?: boolean; previous_estimate_type?: string;
  change_production_thousand_tonnes?: number | null; change_area_thousand_hectares?: number | null; change_yield_kg_hectare?: number | null;
};
export type Growth = { yoy: { from: string; to: string; percent: number | null; mixed_estimate_types: boolean; reason: string | null }[];
  cagr: { from: string; to: string; years: number; percent: number | null; mixed_estimate_types: boolean } | null };
export type SupplySource = { publisher: string; source_url: string; source_key?: string; latest_recorded_at?: string; publication_date?: string | null };
export type SupplyProduction = {
  commodity: string; geography: string; comparison_geography: string | null; geographies: string[];
  unit: { area: string; production: string; yield: string }; reporting_period: (Period & { kind?: string }) | null;
  sources: SupplySource[]; current: ProductionEstimate[]; comparison_current: ProductionEstimate[];
  share_of_comparison: { reporting_year: string; percent: number | null; estimate_types: string[]; note: string | null }[];
  revisions: ProductionEstimate[]; vintages: number; growth: { production: Growth; area: Growth; yield: Growth };
  districts: { available: number; message: string | null }; forecast: ForecastGate; notes: string[];
};
export type DistrictProduction = { state: string; districts: ProductionEstimate[]; reporting_period: Period; sources: SupplySource[]; message: string | null };

export type ArrivalBucket = { measure: "arrival" | "traded"; bucket: string; first_date: string; last_date: string; quantity_tonnes: number | null;
  records: number; unknown_unit_records: number; markets_reporting: number; reporting_days: number };
export type SupplyArrivals = {
  state: string; granularity: Granularity; requested_range: { from: string; to: string }; reporting_period: Period; unit: string;
  measures: { arrival: ArrivalBucket[]; traded: ArrivalBucket[] };
  markets: { measure: string; market: string; district: string | null; reporting_days: number; quantity_tonnes: number | null; unknown_unit_records: number }[];
  sources: { id: string; source_key: string; source_name: string; source_url: string | null; file_name: string | null; imported_at: string; authorization_note: string }[];
  forecast: ForecastGate; message: string | null; notes: string[];
};
export type ArrivalPricePair = { observation_date: string; market: string; district: string | null; variety: string; quantity_original: number | null; unit_original: string | null;
  quantity_tonnes: number | null; minimum_price: number | null; maximum_price: number | null; modal_price: number; price_unit: string; price_basis: string | null; source_record_id: string | null };
export type ArrivalPriceComparison = { state: string; requested_range: { from: string; to: string }; pairs: ArrivalPricePair[]; method: string; caution: string; message: string | null };
export type Granularity = "daily" | "weekly" | "monthly" | "seasonal";

export type WeatherDay = { day: string; provider: string; data_type: string; rainfall_mm: number | null; temperature_max_c: number | null;
  temperature_min_c: number | null; relative_humidity_pct: number | null; retrieved_at: string; source_url: string | null };
export type WeatherForecastDay = { target_date: string; provider: string; data_type: string; rainfall_mm: number | null; temperature_max_c: number | null;
  temperature_min_c: number | null; relative_humidity_pct: number | null; issued_at: string; source_url: string | null };
export type SeasonSummary = { key: string; season: string; label: string; data_type: string; start: string; end: string; days_with_data: number;
  expected_days: number; complete: boolean; rainfall_total_mm: number | null; rainy_days_2_5mm: number; mean_humidity_pct: number | null };
export type SupplyWeather = {
  state: string; district: string; districts: string[]; requested_range: { from: string; to: string }; reporting_period: Period;
  history: WeatherDay[]; forecasts: { model: WeatherForecastDay[]; official: WeatherForecastDay[] };
  warnings: { issued_at: string; valid_from: string; valid_to: string; warning_level: string; phenomena: string; source_url: string | null; provider: string }[];
  seasonal: SeasonSummary[];
  freshness: { model_capture: { status: string; age_hours: number | null; max_age_hours: number; latest: string | null } | null;
    imports: { dataset: string; latest: string; note: string }[] };
  data_types: Record<string, string>; message: string | null; notes: string[];
};

export type Citation = { publisher: string; title: string; url: string };
export type RiskRule = { id: string; rule_key: string; version: number; hazard_name: string; hazard_type: string; causal_agent: string | null;
  source_summary: string; weather_relevance: string; field_evidence_required: string; management_guidance: string | null;
  citations: Citation[]; citation_status: string; status: string; latest_version: boolean; approval_blockers: string[];
  reviews: { decision: string; reviewer_name: string; reviewed_at: string }[] };
export type Advisory = { rule_id: string; hazard_name: string; level: "field_reported" | "weather_watch" | "insufficient_data" | "no_advisory"; message: string;
  verified_field_reports: number; field_evidence_window: { from: string; to: string }; citations: Citation[] };
export type SupplyAdvisories = { state: string; district: string; as_of: string; advisories: Advisory[];
  rules: { total_versions: number; published: number; awaiting_review: number };
  weather_basis: { days: number; data_types: { type: string; label: string }[]; period: Period }; message: string | null; disclaimer: string };

export const ADVISORY_LABEL: Record<Advisory["level"], string> = {
  field_reported: "Verified field reports", weather_watch: "Weather watch (not a diagnosis)", insufficient_data: "Insufficient weather data", no_advisory: "No advisory",
};

export function formatPeriod(period: Period | undefined): string {
  if (!period) return "No records in range";
  return period.from === period.to ? period.from : `${period.from} to ${period.to}`;
}

export function estimateBadge(row: Pick<ProductionEstimate, "estimate_type" | "estimate_label">): string {
  return row.estimate_type === "final" ? "Final" : row.estimate_type === "unspecified" ? "Stage not stated" : row.estimate_label;
}

/** Merge per-measure buckets into rows keyed by bucket without ever summing arrival and traded quantities. */
export function arrivalRows(measures: SupplyArrivals["measures"]) {
  const map = new Map<string, { bucket: string; arrival: ArrivalBucket | null; traded: ArrivalBucket | null }>();
  for (const measure of ["arrival", "traded"] as const) for (const row of measures[measure]) {
    const entry = map.get(row.bucket) ?? { bucket: row.bucket, arrival: null, traded: null };
    entry[measure] = row; map.set(row.bucket, entry);
  }
  return [...map.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

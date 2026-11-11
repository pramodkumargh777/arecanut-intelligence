export type HistoryPoint = {
  reporting_month: string; weighted_price: number | null; status: string; fetched_at: string | null;
  source_url: string | null; refresh_run_id: string | null; rolling_3: number | null; rolling_12: number | null;
  yoy_percent: number | null; volatility_percent: number | null;
  price_unit: string; review_flags: { code: string; explanation: string }[];
  latest_attempt: { status: string; error_message: string | null; started_at: string } | null;
};
export type MonthlyHistory = {
  points: HistoryPoint[]; varieties: string[];
  /** Months and calendar years with a price for each variety. */
  variety_coverage?: { variety: string; months: number; years: number }[]; variety: string; state: string; from: string; to: string;
  expected_months: number; observed_months: number; reporting_months: number; methodology: string;
  flagged_months: number; review_method: string; anomaly_threshold_percent: number;
  seasonal: { month: number; index: number | null; complete_years: number }[]; seasonal_years: string[];
  versions: { reporting_month: string; weighted_price: number | null; fetched_at: string; source_url: string; refresh_run_id: string; variety_present: number }[];
  /** MONTHLY_STATE_WEIGHTED_AVERAGE (the monthly report) or MONTHLY_APMC_MODAL_MEDIAN (from daily APMC prices). */
  basis?: string; long_history_varieties?: string[];
  long_history?: { first_month: string; last_month: string; compared_months: number; median_abs_gap_pct: number | null; same_direction_pct: number | null; imported_at: string };
};
export const LONG_BASIS = "MONTHLY_APMC_MODAL_MEDIAN";
export const isLongBasis = (history?: Pick<MonthlyHistory, "basis"> | null) => history?.basis === LONG_BASIS;
/** The first month the long series is asked for. */
export const LONG_HISTORY_FROM = "2014-01";
export type MonthlyEvidence = {
  reporting_month: string; state: string; variety: string; source_url: string; fetched_at: string;
  source_publication_timestamp: null; source_value: string; raw_imported_value: string; source_unit: string;
  source_columns: string[]; reparsed_value: number | null; normalized_value: number | null; normalized_unit: string | null;
  review_flags: { code: string; explanation: string }[]; explanation: string;
};
export type Aggregates = {
  data: { period: string; from: string; to: string; mean_average_price: number | null; minimum_average: number | null;
    maximum_average: number | null; reporting_days: number; calendar_days: number; fetched_at: string | null; unit_status: string | null }[];
  observations: { reporting_date: string; average_price: number; fetched_at: string; source_url: string; unit_status: string }[];
  methodology: string;
};
export type PriceReference = { kind: "cooperative"; id: string } | { kind: "monthly"; month: string; variety: string; refresh_run_id: string } | { kind: "manual"; value: number };
export type CalculationInputs = {
  name: string; quantity_quintals: number; commission_percent: number; transport_cost: number; other_selling_cost: number;
  area_hectares: number; production_cost: number; byproduct_income: number; hold_days: number;
  annual_finance_percent: number; storage_cost: number; weight_loss_percent: number; scenario_price: number; price: PriceReference;
};
export type Calculation = {
  id?: string; created_at?: string; name?: string; inputs: CalculationInputs; formula_version: string;
  price: { value: number; source: string; reporting_period: string | null; fetched_at: string | null; source_url: string | null;
    variety: string | null; branch: string | null; state: string | null; unit_status: string; price_type: string; reference_id: string | null };
  results: { gross_realization: number; selling_costs: number; net_realization: number; net_per_quintal: number;
    farm_profit: number; profit_per_hectare: number; roi_percent: number | null; remaining_quintals: number;
    finance_cost: number; hold_net_realization: number; hold_advantage: number; break_even_hold_price: number;
    break_even_increase_percent: number; farm_break_even_price: number;
    hold_unchanged_net_realization: number; hold_unchanged_advantage: number };
};
export type DecisionPrices = {
  cooperative: { id: string; source_key: string; branch: string; reporting_date: string; variety: string; average_price: number; unit_status: string; fetched_at: string }[];
  monthly: { reporting_month: string; variety_name: string; weighted_price: number; refresh_run_id: string; fetched_at: string }[];
};
export const defaultGeography = (domain: string) => domain === "production" ? "Karnataka" : "";

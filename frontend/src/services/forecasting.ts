/** Experimental forecasting engine (data-platform/forecasting) as served by /forecasting/* routes. */

export type EvaluationStatus = "reference" | "candidate" | "not_better_than_baseline";
export type CoverageStatus = "consistent_with_nominal" | "below_nominal" | "not_evaluated";
export type Publication = "validated_forecast" | "experimental_candidate" | "reference_baseline" | "not_published";

export type ForecastingDataset = {
  key: string; price_basis: string; frequency: "monthly" | "daily"; unit: string; unit_status: string; provenance: string;
  data_version: string; suppressed: boolean; suppression_reasons: string[]; publication_eligible: boolean;
  series_total: number; series_eligible: number; observations: number; notes: string[];
};

export type PooledMetric = {
  horizon: number; model: string; n: number; mae: number | null; rmse: number | null; wape: number | null; mase: number | null;
  directional_accuracy: number | null; interval_coverage: number | null; interval_width: number | null;
  relative_mae_vs_best_baseline: number | null;
};

export type LegacyComparison = {
  variety: string; legacy_model: string; legacy_mae: number | null; legacy_publishable: boolean; holdout_months: number;
  engine_mae: Record<string, number | null>;
};

export type ExperimentMetadata = {
  datasets: ForecastingDataset[];
  pooled?: PooledMetric[];
  legacy_comparison?: LegacyComparison[];
  strict_vintage?: { origins_evaluated: number; origins_skipped: Record<string, number> };
  exogenous?: Record<string, { usable_in_backtest: boolean; reason: string }>;
  multiple_testing?: string;
  environment?: { git?: { sha?: string; dirty?: boolean }; packages?: Record<string, string | null>; licences?: Record<string, string> };
  config?: { horizons: number[]; interval_level?: number };
  /** One-step backtest record per series for the strongest pooled model (absent on experiments before 2026-11-09). */
  track?: { model: string; horizon: number; series: TrackSeries[] };
};

export type TrackSeries = {
  series_id: string; variety: string; periods: string[];
  actual: number[]; baseline: number[]; median: number[]; lower: number[]; upper: number[];
};

export type ForecastingOverview = {
  experiment: null | {
    id: string; engine_version: string; created_at: string; received_at: string; config_hash: string; payload_sha256: string;
    vintage_mode: "revised" | "strict"; dataset_key: string; price_basis: string; input_data_version: string;
    origin_period: string; origins_evaluated: number; metadata: ExperimentMetadata;
  };
  status_counts: Partial<Record<EvaluationStatus, number>>;
  totals: { experiments: number; predictions: number; outcomes: number; validated_events: number; revoked_events: number };
  policy: Record<string, number>;
  limitations: string[];
};

export type ModelEvaluation = {
  id: number; series_id: string; variety: string; market: string; grade: string | null; horizon: number; model: string;
  model_version: string; baseline_model: string; status: EvaluationStatus; reasons: string[]; n: number;
  mae: number | null; rmse: number | null; wape: number | null; mase: number | null; directional_accuracy: number | null;
  interval_coverage: number | null; interval_width: number | null; dm_statistic: number | null; p_value: number | null;
  p_value_holm: number | null; mae_skill_vs_baseline: number | null; coverage_status: CoverageStatus;
};

export type StoredPrediction = {
  id: number; series_id: string; market: string; variety: string; grade: string | null; price_basis: string; unit: string;
  model: string; model_version: string; forecast_created_at: string; origin_period: string; target_period: string; horizon: number;
  median: number; lower_bound: number; upper_bound: number; interval_level: number; last_observed_value: number;
  evaluation_status: EvaluationStatus | "not_evaluated"; coverage_status: CoverageStatus;
  actual_value: number | null; absolute_error: number | null; within_interval: number | null; matched_at: string | null;
  effective_status: string; publication: Publication;
};

export type Page<T> = { experiment_id: string | null; data: T[]; next_after: number | null };

export type PerformanceKey = {
  series_id: string; variety: string; horizon: number; model: string; model_version: string; outcomes: number; mae: number;
  coverage: number; paired: number; baseline_mae: number | null; mae_ratio: number | null; recent_mae_ratio: number | null;
  backtest_status: string; effective_status: string; last_event: { event: string; reason: string; created_at: string } | null;
};
export type ForecastingPerformance = { keys: PerformanceKey[]; truncated: boolean; outcomes: number; policy: Record<string, number> };

/** Only reference baselines, candidates and validated models expose numeric values in the dashboard. */
export function showsValues(publication: Publication): boolean {
  return publication !== "not_published";
}


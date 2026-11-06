-- 0017: Forecasting experiments, evaluations, stored predictions, prospective outcomes and model status events.
-- The existing monthly-baselines-v1 snapshots (0010) are untouched and remain the published reference.
-- Everything here is append-only: corrections are new experiments or new events, never edits.

CREATE TABLE forecast_experiments (
  id TEXT PRIMARY KEY CHECK (id GLOB 'fx-*' AND length(id) BETWEEN 10 AND 80),
  engine_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  config_hash TEXT NOT NULL CHECK (length(config_hash) = 64),
  payload_sha256 TEXT NOT NULL UNIQUE CHECK (length(payload_sha256) = 64),
  vintage_mode TEXT NOT NULL CHECK (vintage_mode IN ('revised', 'strict')),
  dataset_key TEXT NOT NULL,
  price_basis TEXT NOT NULL,
  input_data_version TEXT NOT NULL CHECK (length(input_data_version) = 64),
  origin_period TEXT NOT NULL,
  origins_evaluated INTEGER NOT NULL CHECK (origins_evaluated >= 0),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json))
);
CREATE INDEX idx_forecast_experiments_recent ON forecast_experiments (received_at DESC);

CREATE TABLE forecast_model_evaluations (
  id INTEGER PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES forecast_experiments(id),
  dataset_key TEXT NOT NULL,
  series_id TEXT NOT NULL,
  market TEXT NOT NULL,
  variety TEXT NOT NULL,
  grade TEXT,
  price_basis TEXT NOT NULL,
  horizon INTEGER NOT NULL CHECK (horizon BETWEEN 1 AND 366),
  model TEXT NOT NULL,
  model_version TEXT NOT NULL,
  baseline_model TEXT NOT NULL,
  -- 'validated' and 'revoked' are never backtest outcomes; they live in forecast_model_events.
  status TEXT NOT NULL CHECK (status IN ('reference', 'candidate', 'not_better_than_baseline')),
  reasons_json TEXT NOT NULL CHECK (json_valid(reasons_json)),
  n INTEGER NOT NULL CHECK (n >= 0),
  mae REAL, rmse REAL, wape REAL, mase REAL, directional_accuracy REAL,
  interval_coverage REAL, interval_width REAL,
  dm_statistic REAL, p_value REAL, p_value_holm REAL, mae_skill_vs_baseline REAL,
  coverage_status TEXT NOT NULL CHECK (coverage_status IN ('consistent_with_nominal', 'below_nominal', 'not_evaluated')),
  UNIQUE (experiment_id, series_id, horizon, model)
);
CREATE INDEX idx_forecast_evaluations_status ON forecast_model_evaluations (experiment_id, status, horizon);

CREATE TABLE forecast_predictions (
  id INTEGER PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES forecast_experiments(id),
  dataset_key TEXT NOT NULL,
  series_id TEXT NOT NULL,
  market TEXT NOT NULL,
  variety TEXT NOT NULL,
  grade TEXT,
  price_basis TEXT NOT NULL CHECK (price_basis IN ('MONTHLY_STATE_WEIGHTED_AVERAGE', 'APMC_MODAL', 'COOPERATIVE_AVERAGE')),
  unit TEXT NOT NULL CHECK (unit = 'INR/quintal'),
  model TEXT NOT NULL,
  model_version TEXT NOT NULL,
  forecast_created_at TEXT NOT NULL,
  origin_period TEXT NOT NULL,
  target_period TEXT NOT NULL CHECK (target_period > origin_period),
  horizon INTEGER NOT NULL CHECK (horizon BETWEEN 1 AND 366),
  median REAL NOT NULL CHECK (median > 0),
  lower_bound REAL NOT NULL CHECK (lower_bound >= 0 AND lower_bound <= median),
  upper_bound REAL NOT NULL CHECK (upper_bound >= median),
  interval_level INTEGER NOT NULL CHECK (interval_level BETWEEN 50 AND 99),
  last_observed_value REAL NOT NULL CHECK (last_observed_value > 0),
  input_data_version TEXT NOT NULL CHECK (length(input_data_version) = 64),
  evaluation_status TEXT NOT NULL CHECK (evaluation_status IN ('reference', 'candidate', 'not_better_than_baseline', 'not_evaluated')),
  coverage_status TEXT NOT NULL CHECK (coverage_status IN ('consistent_with_nominal', 'below_nominal', 'not_evaluated')),
  UNIQUE (experiment_id, series_id, horizon, model)
);
CREATE INDEX idx_forecast_predictions_target ON forecast_predictions (price_basis, target_period);
CREATE INDEX idx_forecast_predictions_series ON forecast_predictions (series_id, model, horizon, target_period);

-- A prediction must be anchored on a stored real observation at its origin (blocks synthetic or edited
-- inputs) and must be saved before its target is observed (prospective only).
CREATE TRIGGER forecast_predictions_monthly_guard BEFORE INSERT ON forecast_predictions
WHEN NEW.price_basis = 'MONTHLY_STATE_WEIGHTED_AVERAGE'
BEGIN
  SELECT RAISE(ABORT, 'Monthly forecast series must be Karnataka exact-variety series')
  WHERE NEW.series_id <> 'KA|' || NEW.variety OR NEW.market <> 'Karnataka';
  SELECT RAISE(ABORT, 'Forecast origin does not match a stored observation')
  WHERE NOT EXISTS (SELECT 1 FROM monthly_variety_prices m WHERE m.state = 'Karnataka'
    AND m.variety_name = NEW.variety AND m.reporting_month = NEW.origin_period
    AND m.price_unit = 'INR/quintal' AND abs(m.weighted_price - NEW.last_observed_value) <= 0.005);
  SELECT RAISE(ABORT, 'Forecast target is already observed')
  WHERE EXISTS (SELECT 1 FROM monthly_variety_prices m WHERE m.state = 'Karnataka'
    AND m.variety_name = NEW.variety AND m.reporting_month >= NEW.target_period AND m.weighted_price IS NOT NULL);
END;

CREATE TRIGGER forecast_predictions_daily_guard BEFORE INSERT ON forecast_predictions
WHEN NEW.price_basis = 'APMC_MODAL'
BEGIN
  SELECT RAISE(ABORT, 'Forecast origin does not match a stored observation')
  WHERE NOT EXISTS (SELECT 1 FROM market_price_observations o WHERE o.validation_status = 'validated'
    AND o.price_basis = 'APMC_MODAL' AND o.market_id || '|' || o.variety_name || '|' || COALESCE(o.grade, '-') = NEW.series_id
    AND o.reporting_date = NEW.origin_period AND abs(o.modal_price - NEW.last_observed_value) <= 0.005);
  SELECT RAISE(ABORT, 'Forecast target is already observed')
  WHERE EXISTS (SELECT 1 FROM market_price_observations o WHERE o.validation_status = 'validated'
    AND o.market_id || '|' || o.variety_name || '|' || COALESCE(o.grade, '-') = NEW.series_id
    AND o.reporting_date >= NEW.target_period);
END;

CREATE TRIGGER forecast_predictions_cooperative_guard BEFORE INSERT ON forecast_predictions
WHEN NEW.price_basis = 'COOPERATIVE_AVERAGE'
BEGIN
  SELECT RAISE(ABORT, 'Forecast origin does not match a stored observation')
  WHERE NOT EXISTS (SELECT 1 FROM cooperative_quotes q WHERE q.source_key = 'mamcos' AND q.status = 'verified'
    AND q.unit_status = 'source_confirmed' AND 'mamcos|' || q.branch || '|' || q.variety = NEW.series_id
    AND q.reporting_date = NEW.origin_period AND abs(q.average_price - NEW.last_observed_value) <= 0.005);
  SELECT RAISE(ABORT, 'Forecast target is already observed')
  WHERE EXISTS (SELECT 1 FROM cooperative_quotes q WHERE q.source_key = 'mamcos' AND q.status = 'verified'
    AND 'mamcos|' || q.branch || '|' || q.variety = NEW.series_id AND q.reporting_date >= NEW.target_period);
END;

CREATE TABLE forecast_outcomes (
  id INTEGER PRIMARY KEY,
  prediction_id INTEGER NOT NULL UNIQUE REFERENCES forecast_predictions(id),
  actual_value REAL NOT NULL CHECK (actual_value > 0),
  actual_captured_at TEXT,
  matched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  error REAL NOT NULL,
  absolute_error REAL NOT NULL CHECK (absolute_error >= 0),
  within_interval INTEGER NOT NULL CHECK (within_interval IN (0, 1)),
  source_table TEXT NOT NULL
);

CREATE TABLE forecast_model_events (
  id INTEGER PRIMARY KEY,
  dataset_key TEXT NOT NULL,
  series_id TEXT NOT NULL,
  horizon INTEGER NOT NULL,
  model TEXT NOT NULL,
  model_version TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('validated', 'revoked')),
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  actor TEXT NOT NULL CHECK (actor IN ('reconciliation', 'reviewer')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_forecast_model_events_key ON forecast_model_events (series_id, horizon, model, model_version, id DESC);

CREATE TRIGGER forecast_experiments_no_update BEFORE UPDATE ON forecast_experiments
BEGIN SELECT RAISE(ABORT, 'Forecast experiments are immutable'); END;
CREATE TRIGGER forecast_experiments_no_delete BEFORE DELETE ON forecast_experiments
BEGIN SELECT RAISE(ABORT, 'Forecast experiments are immutable'); END;
CREATE TRIGGER forecast_evaluations_no_update BEFORE UPDATE ON forecast_model_evaluations
BEGIN SELECT RAISE(ABORT, 'Forecast evaluations are immutable'); END;
CREATE TRIGGER forecast_evaluations_no_delete BEFORE DELETE ON forecast_model_evaluations
BEGIN SELECT RAISE(ABORT, 'Forecast evaluations are immutable'); END;
CREATE TRIGGER forecast_predictions_no_update BEFORE UPDATE ON forecast_predictions
BEGIN SELECT RAISE(ABORT, 'Forecast predictions are immutable'); END;
CREATE TRIGGER forecast_predictions_no_delete BEFORE DELETE ON forecast_predictions
BEGIN SELECT RAISE(ABORT, 'Forecast predictions are immutable'); END;
CREATE TRIGGER forecast_outcomes_no_update BEFORE UPDATE ON forecast_outcomes
BEGIN SELECT RAISE(ABORT, 'Forecast outcomes are immutable'); END;
CREATE TRIGGER forecast_outcomes_no_delete BEFORE DELETE ON forecast_outcomes
BEGIN SELECT RAISE(ABORT, 'Forecast outcomes are immutable'); END;
CREATE TRIGGER forecast_model_events_no_update BEFORE UPDATE ON forecast_model_events
BEGIN SELECT RAISE(ABORT, 'Forecast model events are append-only'); END;
CREATE TRIGGER forecast_model_events_no_delete BEFORE DELETE ON forecast_model_events
BEGIN SELECT RAISE(ABORT, 'Forecast model events are append-only'); END;

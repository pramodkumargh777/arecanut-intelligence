-- Operator decision (2026-11-05): TSS and TUMCOS prices are treated as INR/quintal and may be published after review.
-- This is recorded as an assumption, not a source confirmation: unit_status stays 'assumed' and the source's own unit
-- label and raw record are retained. Permission records and the human review gate are unchanged.
PRAGMA defer_foreign_keys = on;

-- 1. Publication gate: a normalized INR/quintal price that is source-confirmed or operator-assumed.
DROP TRIGGER cooperative_unit_publication_update;
DROP TRIGGER cooperative_unit_publication_insert;
CREATE TRIGGER cooperative_unit_publication_update
BEFORE UPDATE ON cooperative_quotes
WHEN NEW.status = 'verified' AND (NEW.unit_status NOT IN ('source_confirmed', 'assumed') OR NEW.price_unit != 'INR/quintal')
BEGIN
  SELECT RAISE(ABORT, 'Only INR/quintal quotations can be published as verified');
END;
CREATE TRIGGER cooperative_unit_publication_insert
BEFORE INSERT ON cooperative_quotes
WHEN NEW.status = 'verified' AND (NEW.unit_status NOT IN ('source_confirmed', 'assumed') OR NEW.price_unit != 'INR/quintal')
BEGIN
  SELECT RAISE(ABORT, 'Only INR/quintal quotations can be published as verified');
END;

-- 2. Existing rows. A TUMCOS value under 1,000 could genuinely be per kg, so those rows are left unconfirmed.
UPDATE cooperative_quotes SET price_unit = 'INR/quintal', unit_status = 'assumed'
WHERE price_unit = 'unconfirmed' AND (source_key = 'tss' OR (source_key = 'tumcos' AND average_price >= 1000));

-- 3. Rows a reviewer already accepted are published now, with an audit entry for the status change.
INSERT INTO cooperative_reviews (id, quote_id, action, reviewer, reviewed_at, previous_status, new_status)
SELECT 'unit-decision-0020-' || id, id, 'approve', 'operator-unit-decision-2026-11-05',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), status, 'verified'
FROM cooperative_quotes
WHERE status = 'accepted_unit_unconfirmed' AND source_key IN ('tss', 'tumcos') AND price_unit = 'INR/quintal';
UPDATE cooperative_quotes SET status = 'verified'
WHERE status = 'accepted_unit_unconfirmed' AND source_key IN ('tss', 'tumcos') AND price_unit = 'INR/quintal';

-- 4. Source registry and commodity capability.
UPDATE cooperative_sources SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  unit_evidence = 'No unit label in the rates API, the tender API or the public page bundle. Treated as INR/quintal by operator decision on 2026-11-05 (an assumption, not a source confirmation).'
WHERE source_key = 'tss';
UPDATE cooperative_sources SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  unit_evidence = 'Every embedded record declares unit "kg", but values (about 22,000-70,000) are only plausible per quintal. Treated as INR/quintal by operator decision on 2026-11-05 (an assumption, not a source confirmation). Values under 1,000 stay unconfirmed.'
WHERE source_key = 'tumcos';
UPDATE commodity_capabilities SET status = 'available',
  note = 'TUMCOS black pepper prices are treated as INR/quintal by operator decision and published after review.'
WHERE commodity_id = 'commodity-black-pepper' AND capability = 'cooperative_tumcos';

-- 5. Unified read view: the normalized unit follows the publication rule above.
DROP VIEW price_observations;
CREATE VIEW price_observations AS
SELECT
  'market_price_observations' AS source_table,
  o.id AS observation_id,
  s.source_key,
  c.id AS commodity_id,
  c.code AS commodity_code,
  o.original_commodity_name AS original_commodity_label,
  o.market_id,
  m.name AS market_label,
  m.market_type AS market_kind,
  m.district,
  m.state,
  va.variety_id,
  o.variety_name AS variety_label,
  o.original_variety_name AS original_variety_label,
  va.mapping_status AS variety_mapping_status,
  gm.grade_id,
  o.grade AS grade_label,
  o.price_basis,
  o.original_unit,
  o.price_unit AS normalized_unit,
  o.reporting_date AS observation_date,
  o.minimum_price,
  o.maximum_price,
  o.modal_price,
  NULL AS average_price,
  o.arrival_quantity AS quantity,
  o.arrival_unit AS quantity_unit,
  o.validation_status,
  CASE WHEN o.validation_status = 'verified' AND m.mapping_status = 'verified' THEN 1 ELSE 0 END AS published,
  o.source_record_id,
  NULL AS source_url
FROM market_price_observations o
JOIN data_sources s ON s.id = o.source_id
JOIN markets m ON m.id = o.market_id
LEFT JOIN commodities c ON c.canonical_name = o.commodity_name
LEFT JOIN variety_aliases va ON va.commodity_id = c.id AND va.source_key = s.source_key AND va.source_name = o.original_variety_name
LEFT JOIN grade_mappings gm ON gm.commodity_id = c.id AND gm.source_key = s.source_key AND gm.source_label = o.grade
UNION ALL
SELECT
  'cooperative_quotes',
  q.id,
  q.source_key,
  c.id,
  c.code,
  q.commodity,
  NULL,
  q.branch,
  'cooperative_branch',
  NULL,
  NULL,
  va.variety_id,
  q.variety,
  q.variety,
  va.mapping_status,
  NULL,
  NULL,
  q.price_basis,
  COALESCE(q.source_unit_label, q.price_unit),
  CASE WHEN q.price_unit = 'INR/quintal' THEN 'INR/quintal' ELSE NULL END,
  q.reporting_date,
  q.minimum_price,
  q.maximum_price,
  NULL,
  q.average_price,
  q.reported_weight,
  CASE WHEN q.reported_weight IS NULL THEN NULL ELSE 'unconfirmed' END,
  q.status,
  CASE WHEN q.status = 'verified' THEN 1 ELSE 0 END,
  q.source_record_id,
  q.source_url
FROM cooperative_quotes q
LEFT JOIN commodities c ON c.code = q.commodity
LEFT JOIN variety_aliases va ON va.commodity_id = c.id AND va.source_key = q.source_key AND va.source_name = q.variety;

-- 6. Forecast predictions must accept the TSS tender basis, which needs a table rebuild because of its CHECK.
-- Outcome rows are stashed and restored so no foreign-key violation is left deferred. All rows keep their ids.
CREATE TABLE forecast_outcomes_stash AS SELECT * FROM forecast_outcomes;
DROP TRIGGER forecast_outcomes_no_delete;
DELETE FROM forecast_outcomes;

CREATE TABLE forecast_predictions_new (
  id INTEGER PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES forecast_experiments(id),
  dataset_key TEXT NOT NULL,
  series_id TEXT NOT NULL,
  market TEXT NOT NULL,
  variety TEXT NOT NULL,
  grade TEXT,
  price_basis TEXT NOT NULL CHECK (price_basis IN ('MONTHLY_STATE_WEIGHTED_AVERAGE', 'APMC_MODAL', 'COOPERATIVE_AVERAGE', 'COOPERATIVE_TENDER_AVERAGE')),
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
INSERT INTO forecast_predictions_new SELECT * FROM forecast_predictions;
DROP TABLE forecast_predictions;
ALTER TABLE forecast_predictions_new RENAME TO forecast_predictions;
CREATE INDEX idx_forecast_predictions_target ON forecast_predictions (price_basis, target_period);
CREATE INDEX idx_forecast_predictions_series ON forecast_predictions (series_id, model, horizon, target_period);

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
WHEN NEW.price_basis IN ('COOPERATIVE_AVERAGE', 'COOPERATIVE_TENDER_AVERAGE')
BEGIN
  SELECT RAISE(ABORT, 'Forecast origin does not match a stored observation')
  WHERE NOT EXISTS (SELECT 1 FROM cooperative_quotes q WHERE q.status = 'verified' AND q.price_basis = NEW.price_basis
    AND q.price_unit = 'INR/quintal' AND q.source_key || '|' || q.branch || '|' || q.variety = NEW.series_id
    AND q.reporting_date = NEW.origin_period AND abs(q.average_price - NEW.last_observed_value) <= 0.005);
  SELECT RAISE(ABORT, 'Forecast target is already observed')
  WHERE EXISTS (SELECT 1 FROM cooperative_quotes q WHERE q.status = 'verified' AND q.price_basis = NEW.price_basis
    AND q.source_key || '|' || q.branch || '|' || q.variety = NEW.series_id AND q.reporting_date >= NEW.target_period);
END;

CREATE TRIGGER forecast_predictions_no_update BEFORE UPDATE ON forecast_predictions
BEGIN SELECT RAISE(ABORT, 'Forecast predictions are immutable'); END;
CREATE TRIGGER forecast_predictions_no_delete BEFORE DELETE ON forecast_predictions
BEGIN SELECT RAISE(ABORT, 'Forecast predictions are immutable'); END;

INSERT INTO forecast_outcomes SELECT * FROM forecast_outcomes_stash;
DROP TABLE forecast_outcomes_stash;
CREATE TRIGGER forecast_outcomes_no_delete BEFORE DELETE ON forecast_outcomes
BEGIN SELECT RAISE(ABORT, 'Forecast outcomes are immutable'); END;

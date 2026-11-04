CREATE UNIQUE INDEX idx_one_current_source_record
  ON market_price_observations(source_id, source_record_id)
  WHERE validation_status != 'superseded';

CREATE TRIGGER verified_price_invariants_insert
BEFORE INSERT ON market_price_observations
WHEN NEW.validation_status = 'verified' AND
  (NEW.minimum_price > NEW.modal_price OR NEW.modal_price > NEW.maximum_price
   OR NEW.reporting_date > date('now') OR NEW.price_unit != 'INR/quintal')
BEGIN
  SELECT RAISE(ABORT, 'Invalid observation cannot be verified');
END;

CREATE TRIGGER verified_price_invariants_update
BEFORE UPDATE ON market_price_observations
WHEN NEW.validation_status = 'verified' AND
  (NEW.minimum_price > NEW.modal_price OR NEW.modal_price > NEW.maximum_price
   OR NEW.reporting_date > date('now') OR NEW.price_unit != 'INR/quintal')
BEGIN
  SELECT RAISE(ABORT, 'Invalid observation cannot be verified');
END;

CREATE TABLE observation_reviews (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES market_price_observations(id),
  action TEXT NOT NULL CHECK (action IN ('approve', 'reject')),
  reviewer TEXT NOT NULL,
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  previous_status TEXT NOT NULL,
  validation_message TEXT
);
CREATE INDEX idx_reviews_observation ON observation_reviews(observation_id, reviewed_at);

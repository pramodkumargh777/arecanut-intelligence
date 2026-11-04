DROP INDEX idx_observations_date_status;
DROP INDEX idx_observations_market_date;
DROP INDEX idx_observations_source_date;
DROP INDEX idx_observations_variety_date;

ALTER TABLE market_price_observations RENAME TO market_price_observations_legacy;

CREATE TABLE market_price_observations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  ingestion_job_id TEXT REFERENCES ingestion_jobs(id),
  source_record_id TEXT NOT NULL,
  market_id TEXT NOT NULL REFERENCES markets(id),
  reporting_date TEXT NOT NULL,
  publication_date TEXT,
  commodity_name TEXT NOT NULL,
  original_commodity_name TEXT NOT NULL,
  variety_name TEXT NOT NULL,
  original_variety_name TEXT NOT NULL,
  minimum_price REAL NOT NULL CHECK (minimum_price >= 0),
  maximum_price REAL NOT NULL CHECK (maximum_price >= 0),
  modal_price REAL NOT NULL CHECK (modal_price >= 0),
  arrival_quantity REAL,
  arrival_unit TEXT,
  original_unit TEXT NOT NULL,
  price_unit TEXT NOT NULL CHECK (price_unit = 'INR/quintal'),
  validation_status TEXT NOT NULL CHECK (
    validation_status IN ('validated', 'review_required', 'verified', 'rejected', 'superseded')
  ),
  validation_message TEXT,
  raw_payload TEXT NOT NULL,
  ingested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO market_price_observations (
  id, source_id, ingestion_job_id, source_record_id, market_id, reporting_date,
  publication_date, commodity_name, original_commodity_name, variety_name,
  original_variety_name, minimum_price, maximum_price, modal_price,
  arrival_quantity, arrival_unit, original_unit, price_unit, validation_status,
  validation_message, raw_payload, ingested_at
)
SELECT
  id, source_id, ingestion_job_id, source_record_id, market_id, reporting_date,
  publication_date, commodity_name, original_commodity_name, variety_name,
  original_variety_name, minimum_price, maximum_price, modal_price,
  arrival_quantity, arrival_unit, original_unit, price_unit, validation_status,
  validation_message, raw_payload, ingested_at
FROM market_price_observations_legacy;

DROP TABLE market_price_observations_legacy;

CREATE TABLE source_record_versions (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES market_price_observations(id),
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  source_record_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  snapshot_payload TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_id, source_record_id, version_number)
);

CREATE INDEX idx_observations_date_status
  ON market_price_observations (reporting_date, validation_status);
CREATE INDEX idx_observations_market_date
  ON market_price_observations (market_id, reporting_date);
CREATE INDEX idx_observations_source_date
  ON market_price_observations (source_id, reporting_date);
CREATE INDEX idx_observations_variety_date
  ON market_price_observations (variety_name, reporting_date);
CREATE INDEX idx_source_versions_record
  ON source_record_versions (source_id, source_record_id, version_number);

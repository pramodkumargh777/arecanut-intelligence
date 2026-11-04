CREATE TABLE states (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT
);

CREATE TABLE districts (
  id TEXT PRIMARY KEY,
  state_id TEXT NOT NULL REFERENCES states(id),
  name TEXT NOT NULL,
  UNIQUE (state_id, name)
);

CREATE TABLE markets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  district TEXT NOT NULL,
  state TEXT NOT NULL,
  mapping_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (mapping_status IN ('unverified', 'verified')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (state, district, name)
);

CREATE TABLE commodities (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL UNIQUE
);

CREATE TABLE varieties (
  id TEXT PRIMARY KEY,
  commodity_id TEXT NOT NULL REFERENCES commodities(id),
  canonical_name TEXT NOT NULL,
  mapping_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (mapping_status IN ('unverified', 'verified')),
  UNIQUE (commodity_id, canonical_name)
);

CREATE TABLE variety_aliases (
  id TEXT PRIMARY KEY,
  variety_id TEXT NOT NULL REFERENCES varieties(id),
  source_key TEXT NOT NULL,
  source_name TEXT NOT NULL,
  mapping_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (mapping_status IN ('unverified', 'verified')),
  UNIQUE (source_key, source_name)
);

CREATE TABLE data_sources (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1))
);

CREATE TABLE ingestion_jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  received_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE ingestion_job_logs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES ingestion_jobs(id),
  level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
    validation_status IN ('validated', 'review_required', 'verified', 'rejected')
  ),
  validation_message TEXT,
  raw_payload TEXT NOT NULL,
  ingested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_id, source_record_id)
);

CREATE INDEX idx_observations_date_status
  ON market_price_observations (reporting_date, validation_status);
CREATE INDEX idx_observations_market_date
  ON market_price_observations (market_id, reporting_date);
CREATE INDEX idx_observations_source_date
  ON market_price_observations (source_id, reporting_date);
CREATE INDEX idx_observations_variety_date
  ON market_price_observations (variety_name, reporting_date);
CREATE INDEX idx_markets_district
  ON markets (state, district, name);
CREATE INDEX idx_ingestion_jobs_source_started
  ON ingestion_jobs (source_id, started_at);

INSERT INTO states (id, name, code) VALUES ('state-karnataka', 'Karnataka', 'KA');
INSERT INTO commodities (id, canonical_name) VALUES ('commodity-arecanut', 'Arecanut');
INSERT INTO data_sources (id, source_key, name, source_type) VALUES
  ('source-agmarknet', 'agmarknet', 'AGMARKNET / data.gov.in', 'official_api'),
  ('source-agmarknet-csv', 'agmarknet_csv', 'AGMARKNET CSV import', 'manual_file');

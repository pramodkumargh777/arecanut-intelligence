CREATE TABLE intelligence_captures (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  domain TEXT NOT NULL CHECK(domain IN ('production','trade','weather','news')),
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  publication_period TEXT,
  media_type TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  extraction_json TEXT,
  content_hash TEXT NOT NULL,
  row_count INTEGER NOT NULL
);
CREATE INDEX intelligence_capture_source ON intelligence_captures(source_key, fetched_at);
CREATE TABLE intelligence_refresh_runs (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
  capture_id TEXT REFERENCES intelligence_captures(id),
  error_message TEXT
);
CREATE TABLE production_records (
  capture_id TEXT NOT NULL REFERENCES intelligence_captures(id),
  geography TEXT NOT NULL,
  period TEXT NOT NULL,
  estimate_status TEXT NOT NULL,
  area_thousand_hectares REAL,
  production_thousand_tonnes REAL,
  yield_kg_hectare REAL,
  PRIMARY KEY(capture_id, geography, period)
);
CREATE TABLE trade_records (
  capture_id TEXT NOT NULL REFERENCES intelligence_captures(id),
  partner TEXT NOT NULL,
  period TEXT NOT NULL,
  quantity_tonnes REAL,
  value_inr_lakh REAL,
  PRIMARY KEY(capture_id, partner, period)
);
CREATE TABLE weather_records (
  capture_id TEXT NOT NULL REFERENCES intelligence_captures(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('recent_model','forecast_model')),
  temperature_max_c REAL,
  temperature_min_c REAL,
  precipitation_mm REAL,
  grid_latitude REAL NOT NULL,
  grid_longitude REAL NOT NULL,
  elevation_m REAL NOT NULL,
  PRIMARY KEY(capture_id, date)
);
CREATE TABLE intelligence_bulletins (
  capture_id TEXT PRIMARY KEY REFERENCES intelligence_captures(id),
  release_id TEXT NOT NULL,
  title TEXT NOT NULL,
  published_on TEXT NOT NULL,
  is_policy INTEGER NOT NULL CHECK(is_policy IN (0,1))
);
CREATE TABLE quality_inspections (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL,
  variety TEXT NOT NULL,
  location TEXT NOT NULL,
  sampled_on TEXT NOT NULL,
  reported_on TEXT NOT NULL,
  laboratory TEXT NOT NULL,
  report_reference TEXT NOT NULL,
  evidence_url TEXT NOT NULL,
  moisture_percent REAL CHECK(moisture_percent BETWEEN 0 AND 100),
  defects_percent REAL CHECK(defects_percent BETWEEN 0 AND 100),
  notes TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','verified','rejected','superseded')),
  review_note TEXT,
  reviewed_at TEXT,
  supersedes_id TEXT REFERENCES quality_inspections(id)
);
CREATE UNIQUE INDEX current_quality_report ON quality_inspections(laboratory,report_reference,lot_id)
  WHERE status != 'superseded';
CREATE TRIGGER intelligence_capture_no_update BEFORE UPDATE ON intelligence_captures
BEGIN SELECT RAISE(ABORT, 'Source captures are immutable'); END;
CREATE TRIGGER intelligence_capture_no_delete BEFORE DELETE ON intelligence_captures
BEGIN SELECT RAISE(ABORT, 'Source captures are immutable'); END;
CREATE TRIGGER quality_evidence_no_update BEFORE UPDATE OF lot_id,variety,location,sampled_on,reported_on,laboratory,report_reference,evidence_url,moisture_percent,defects_percent,notes ON quality_inspections
BEGIN SELECT RAISE(ABORT, 'Quality evidence is immutable; obtain a separately identified corrected report'); END;

-- Supply, production, arrivals, weather and crop-risk evidence (non-destructive).
-- Existing DASD production_records and Open-Meteo weather_records are preserved and exposed through
-- read-only views; new official/authorized records are append-only and always reference a source document.

-- ---------------------------------------------------------------------------------------------
-- Geography: canonical districts and verified spelling aliases. Used to reject unmapped districts,
-- never to apportion state figures to districts.
CREATE TABLE geography_districts (
  state TEXT NOT NULL,
  district TEXT NOT NULL,
  PRIMARY KEY (state, district)
);
CREATE TABLE geography_aliases (
  state TEXT NOT NULL,
  alias_key TEXT NOT NULL,
  district TEXT NOT NULL,
  note TEXT NOT NULL,
  PRIMARY KEY (state, alias_key),
  FOREIGN KEY (state, district) REFERENCES geography_districts(state, district)
);
INSERT INTO geography_districts(state, district)
SELECT DISTINCT state, district FROM markets WHERE state = 'Karnataka';
INSERT OR IGNORE INTO geography_districts(state, district) VALUES
  ('Karnataka', 'Chikkamagaluru'), ('Karnataka', 'Chitradurga'), ('Karnataka', 'Dakshina Kannada'), ('Karnataka', 'Davangere'),
  ('Karnataka', 'Hassan'), ('Karnataka', 'Haveri'), ('Karnataka', 'Kodagu'), ('Karnataka', 'Mandya'), ('Karnataka', 'Mysuru'),
  ('Karnataka', 'Shivamogga'), ('Karnataka', 'Tumakuru'), ('Karnataka', 'Udupi'), ('Karnataka', 'Uttara Kannada');
INSERT INTO geography_aliases(state, alias_key, district, note)
SELECT state, lower(district), district, 'Canonical spelling' FROM geography_districts;
INSERT OR IGNORE INTO geography_aliases(state, alias_key, district, note) VALUES
  ('Karnataka', 'shimoga', 'Shivamogga', 'Pre-2014 English spelling'),
  ('Karnataka', 'shivamoga', 'Shivamogga', 'Common transliteration'),
  ('Karnataka', 'mysore', 'Mysuru', 'Pre-2014 English spelling'),
  ('Karnataka', 'davanagere', 'Davangere', 'Official spelling; ANI market master uses Davangere'),
  ('Karnataka', 'chikmagalur', 'Chikkamagaluru', 'Pre-2014 English spelling'),
  ('Karnataka', 'chikkamagalur', 'Chikkamagaluru', 'Common transliteration'),
  ('Karnataka', 'tumkur', 'Tumakuru', 'Pre-2014 English spelling'),
  ('Karnataka', 'coorg', 'Kodagu', 'Anglicised name');

-- ---------------------------------------------------------------------------------------------
-- A. Production estimates from official documents other than the DASD capture pipeline
CREATE TABLE production_estimate_documents (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL CHECK (source_key GLOB '[a-z]*' AND length(source_key) <= 64),
  publisher TEXT NOT NULL,
  title TEXT NOT NULL,
  source_url TEXT NOT NULL CHECK (source_url LIKE 'https://%'),
  publication_date TEXT,
  publication_precision TEXT CHECK (publication_precision IN ('day', 'month', 'year')),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  archive_object_key TEXT,
  imported_at TEXT NOT NULL,
  CHECK ((publication_date IS NULL) = (publication_precision IS NULL)),
  UNIQUE (source_key, content_sha256)
);
CREATE TABLE production_estimate_records (
  document_id TEXT NOT NULL REFERENCES production_estimate_documents(id),
  commodity_code TEXT NOT NULL DEFAULT 'arecanut',
  reporting_year TEXT NOT NULL CHECK (reporting_year GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  geography_level TEXT NOT NULL CHECK (geography_level IN ('country', 'state', 'district')),
  state TEXT,
  district TEXT,
  estimate_type TEXT NOT NULL CHECK (estimate_type IN ('first_advance', 'second_advance', 'third_advance', 'final', 'unspecified')),
  estimate_label TEXT NOT NULL,
  area_thousand_hectares REAL CHECK (area_thousand_hectares IS NULL OR area_thousand_hectares >= 0),
  production_thousand_tonnes REAL CHECK (production_thousand_tonnes IS NULL OR production_thousand_tonnes >= 0),
  yield_kg_hectare REAL CHECK (yield_kg_hectare IS NULL OR yield_kg_hectare >= 0),
  source_row_reference TEXT NOT NULL,
  CHECK ((geography_level = 'country' AND state IS NULL AND district IS NULL)
      OR (geography_level = 'state' AND state IS NOT NULL AND district IS NULL)
      OR (geography_level = 'district' AND state IS NOT NULL AND district IS NOT NULL)),
  CHECK (area_thousand_hectares IS NOT NULL OR production_thousand_tonnes IS NOT NULL OR yield_kg_hectare IS NOT NULL)
);
CREATE UNIQUE INDEX production_estimate_records_identity
  ON production_estimate_records(document_id, commodity_code, reporting_year, geography_level, COALESCE(state, ''), COALESCE(district, ''));
CREATE TRIGGER production_estimate_documents_no_update BEFORE UPDATE ON production_estimate_documents
BEGIN SELECT RAISE(ABORT, 'production source documents are immutable'); END;
CREATE TRIGGER production_estimate_documents_no_delete BEFORE DELETE ON production_estimate_documents
BEGIN SELECT RAISE(ABORT, 'production source documents are immutable'); END;
CREATE TRIGGER production_estimate_records_no_update BEFORE UPDATE ON production_estimate_records
BEGIN SELECT RAISE(ABORT, 'production estimates are append-only; import a revised document'); END;
CREATE TRIGGER production_estimate_records_no_delete BEFORE DELETE ON production_estimate_records
BEGIN SELECT RAISE(ABORT, 'production estimates are append-only; import a revised document'); END;

-- Every vintage of every estimate (DASD captures and imported documents). Repeated captures of an
-- unchanged DASD table appear as repeated vintages; the API collapses identical values.
CREATE VIEW production_estimates AS
SELECT
  'capture:' || p.capture_id AS evidence_id,
  c.source_key AS source_key,
  'Directorate of Arecanut and Spices Development (DASD)' AS publisher,
  c.source_url AS source_url,
  'arecanut' AS commodity_code,
  p.period AS reporting_year,
  CASE WHEN p.geography = 'All India' THEN 'country' ELSE 'state' END AS geography_level,
  CASE WHEN p.geography = 'All India' THEN NULL ELSE p.geography END AS state,
  NULL AS district,
  p.geography AS geography,
  CASE
    WHEN lower(p.estimate_status) = 'final' THEN 'final'
    WHEN lower(p.estimate_status) LIKE 'first advance%' THEN 'first_advance'
    WHEN lower(p.estimate_status) LIKE 'second advance%' THEN 'second_advance'
    WHEN lower(p.estimate_status) LIKE 'third advance%' THEN 'third_advance'
    ELSE 'unspecified'
  END AS estimate_type,
  p.estimate_status AS estimate_label,
  p.area_thousand_hectares, p.production_thousand_tonnes, p.yield_kg_hectare,
  c.publication_period AS publication_date,
  CASE WHEN c.publication_period IS NULL THEN NULL ELSE 'month' END AS publication_precision,
  c.fetched_at AS recorded_at,
  c.content_hash AS content_sha256
FROM production_records p JOIN intelligence_captures c ON c.id = p.capture_id
UNION ALL
SELECT
  'document:' || d.id, d.source_key, d.publisher, d.source_url, r.commodity_code, r.reporting_year, r.geography_level,
  r.state, r.district, COALESCE(r.district, r.state, 'All India'), r.estimate_type, r.estimate_label,
  r.area_thousand_hectares, r.production_thousand_tonnes, r.yield_kg_hectare,
  d.publication_date, d.publication_precision, d.imported_at, d.content_sha256
FROM production_estimate_records r JOIN production_estimate_documents d ON d.id = r.document_id;

-- ---------------------------------------------------------------------------------------------
-- B. Market arrivals and traded quantities (authorized file imports only; kept as separate measures)
CREATE TABLE arrival_import_batches (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL CHECK (source_key IN ('agmarknet', 'enam', 'other_official')),
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL CHECK (source_url LIKE 'https://%'),
  authorization_note TEXT NOT NULL CHECK (length(trim(authorization_note)) >= 10),
  file_name TEXT NOT NULL,
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  submitted_rows INTEGER NOT NULL,
  accepted_rows INTEGER NOT NULL,
  duplicate_rows INTEGER NOT NULL,
  rejected_rows INTEGER NOT NULL,
  rejections_json TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  UNIQUE (source_key, content_sha256)
);
CREATE TABLE market_arrivals (
  batch_id TEXT NOT NULL REFERENCES arrival_import_batches(id),
  source_key TEXT NOT NULL CHECK (source_key IN ('agmarknet', 'enam', 'other_official')),
  measure TEXT NOT NULL CHECK (measure IN ('arrival', 'traded')),
  commodity_code TEXT NOT NULL DEFAULT 'arecanut',
  state TEXT NOT NULL,
  district TEXT NOT NULL,
  market TEXT NOT NULL,
  variety TEXT,
  observation_date TEXT NOT NULL CHECK (observation_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  quantity_original REAL NOT NULL CHECK (quantity_original >= 0),
  unit_original TEXT NOT NULL,
  quantity_tonnes REAL CHECK (quantity_tonnes IS NULL OR quantity_tonnes >= 0),
  unit_status TEXT NOT NULL CHECK (unit_status IN ('converted', 'unknown_unit')),
  source_row_number INTEGER NOT NULL,
  CHECK ((unit_status = 'converted') = (quantity_tonnes IS NOT NULL))
);
CREATE UNIQUE INDEX market_arrivals_identity
  ON market_arrivals(source_key, measure, commodity_code, state, market, COALESCE(variety, ''), observation_date);
CREATE INDEX market_arrivals_scope_date ON market_arrivals(commodity_code, state, observation_date);
CREATE TRIGGER arrival_import_batches_no_update BEFORE UPDATE ON arrival_import_batches
BEGIN SELECT RAISE(ABORT, 'arrival import batches are immutable'); END;
CREATE TRIGGER arrival_import_batches_no_delete BEFORE DELETE ON arrival_import_batches
BEGIN SELECT RAISE(ABORT, 'arrival import batches are immutable'); END;
CREATE TRIGGER market_arrivals_no_update BEFORE UPDATE ON market_arrivals
BEGIN SELECT RAISE(ABORT, 'arrival records are append-only'); END;
CREATE TRIGGER market_arrivals_no_delete BEFORE DELETE ON market_arrivals
BEGIN SELECT RAISE(ABORT, 'arrival records are append-only'); END;

-- ---------------------------------------------------------------------------------------------
-- C. Weather: optional humidity on the existing model capture, plus separate history, forecast and
-- warning datasets for authorized IMD/official imports and Open-Meteo reanalysis backfill.
ALTER TABLE weather_records ADD COLUMN relative_humidity_mean_pct REAL;

CREATE TABLE weather_import_batches (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('imd', 'open_meteo', 'other_official')),
  dataset TEXT NOT NULL CHECK (dataset IN ('history', 'forecast', 'warning')),
  source_url TEXT NOT NULL CHECK (source_url LIKE 'https://%'),
  authorization_note TEXT NOT NULL CHECK (length(trim(authorization_note)) >= 10),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  row_count INTEGER NOT NULL,
  imported_at TEXT NOT NULL,
  UNIQUE (provider, dataset, content_sha256)
);
CREATE TABLE weather_history_records (
  batch_id TEXT NOT NULL REFERENCES weather_import_batches(id),
  provider TEXT NOT NULL,
  data_type TEXT NOT NULL CHECK (data_type IN ('station_measurement', 'model_grid', 'reanalysis')),
  location_key TEXT NOT NULL,
  station_id TEXT,
  station_name TEXT,
  district TEXT NOT NULL,
  state TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  observation_date TEXT NOT NULL CHECK (observation_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  rainfall_mm REAL CHECK (rainfall_mm IS NULL OR rainfall_mm >= 0),
  temperature_max_c REAL,
  temperature_min_c REAL,
  relative_humidity_pct REAL CHECK (relative_humidity_pct IS NULL OR relative_humidity_pct BETWEEN 0 AND 100),
  CHECK (data_type <> 'station_measurement' OR (station_id IS NOT NULL AND station_name IS NOT NULL)),
  CHECK (temperature_max_c IS NULL OR temperature_min_c IS NULL OR temperature_min_c <= temperature_max_c),
  UNIQUE (provider, data_type, location_key, observation_date)
);
CREATE TABLE weather_forecast_records (
  batch_id TEXT NOT NULL REFERENCES weather_import_batches(id),
  provider TEXT NOT NULL,
  data_type TEXT NOT NULL CHECK (data_type IN ('official_forecast', 'model_grid')),
  location_key TEXT NOT NULL,
  district TEXT NOT NULL,
  state TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  target_date TEXT NOT NULL CHECK (target_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  rainfall_mm REAL CHECK (rainfall_mm IS NULL OR rainfall_mm >= 0),
  temperature_max_c REAL,
  temperature_min_c REAL,
  relative_humidity_pct REAL CHECK (relative_humidity_pct IS NULL OR relative_humidity_pct BETWEEN 0 AND 100),
  UNIQUE (provider, location_key, issued_at, target_date)
);
CREATE TABLE weather_warnings (
  batch_id TEXT NOT NULL REFERENCES weather_import_batches(id),
  provider TEXT NOT NULL,
  district TEXT NOT NULL,
  state TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  valid_from TEXT NOT NULL CHECK (valid_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  valid_to TEXT NOT NULL CHECK (valid_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  warning_level TEXT NOT NULL CHECK (warning_level IN ('green', 'yellow', 'orange', 'red', 'unspecified')),
  phenomena TEXT NOT NULL,
  source_text TEXT NOT NULL,
  CHECK (valid_from <= valid_to),
  UNIQUE (provider, district, issued_at, valid_from, phenomena)
);
CREATE INDEX weather_history_district_date ON weather_history_records(state, district, observation_date);
CREATE INDEX weather_forecast_district_date ON weather_forecast_records(state, district, target_date);
CREATE INDEX weather_warnings_district_valid ON weather_warnings(state, district, valid_to);
CREATE TRIGGER weather_import_batches_no_update BEFORE UPDATE ON weather_import_batches
BEGIN SELECT RAISE(ABORT, 'weather import batches are immutable'); END;
CREATE TRIGGER weather_import_batches_no_delete BEFORE DELETE ON weather_import_batches
BEGIN SELECT RAISE(ABORT, 'weather import batches are immutable'); END;
CREATE TRIGGER weather_history_no_update BEFORE UPDATE ON weather_history_records
BEGIN SELECT RAISE(ABORT, 'weather history is append-only'); END;
CREATE TRIGGER weather_history_no_delete BEFORE DELETE ON weather_history_records
BEGIN SELECT RAISE(ABORT, 'weather history is append-only'); END;
CREATE TRIGGER weather_forecast_no_update BEFORE UPDATE ON weather_forecast_records
BEGIN SELECT RAISE(ABORT, 'weather forecasts are append-only'); END;
CREATE TRIGGER weather_forecast_no_delete BEFORE DELETE ON weather_forecast_records
BEGIN SELECT RAISE(ABORT, 'weather forecasts are append-only'); END;
CREATE TRIGGER weather_warnings_no_update BEFORE UPDATE ON weather_warnings
BEGIN SELECT RAISE(ABORT, 'weather warnings are append-only'); END;
CREATE TRIGGER weather_warnings_no_delete BEFORE DELETE ON weather_warnings
BEGIN SELECT RAISE(ABORT, 'weather warnings are append-only'); END;

-- Open-Meteo Sirsi capture rows exposed with an explicit model_grid data type. Sirsi is in Uttara Kannada.
CREATE VIEW weather_model_capture_days AS
SELECT
  'capture:' || w.capture_id AS evidence_id,
  'open_meteo' AS provider,
  'model_grid' AS data_type,
  'sirsi_reference' AS location_key,
  'Uttara Kannada' AS district,
  'Karnataka' AS state,
  w.grid_latitude AS latitude, w.grid_longitude AS longitude,
  w.date AS day,
  w.kind AS kind,
  w.precipitation_mm AS rainfall_mm,
  w.temperature_max_c, w.temperature_min_c,
  w.relative_humidity_mean_pct AS relative_humidity_pct,
  c.fetched_at AS retrieved_at,
  c.source_url AS source_url
FROM weather_records w JOIN intelligence_captures c ON c.id = w.capture_id;

-- ---------------------------------------------------------------------------------------------
-- D. Crop risk rules (versioned, immutable), expert reviews and field evidence
CREATE TABLE crop_risk_rules (
  id TEXT PRIMARY KEY,
  rule_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  commodity_code TEXT NOT NULL DEFAULT 'arecanut',
  hazard_key TEXT NOT NULL CHECK (hazard_key IN ('fruit_rot_mahali', 'yellow_leaf_disease', 'bud_rot', 'root_grub', 'areolate_mildew')),
  hazard_name TEXT NOT NULL,
  hazard_type TEXT NOT NULL CHECK (hazard_type IN ('disease', 'pest')),
  causal_agent TEXT,
  source_summary TEXT NOT NULL,
  weather_relevance TEXT NOT NULL CHECK (weather_relevance IN ('weather_linked', 'not_weather_driven', 'unknown')),
  weather_conditions_json TEXT,
  field_evidence_required TEXT NOT NULL,
  management_guidance TEXT,
  citations_json TEXT NOT NULL,
  citation_status TEXT NOT NULL CHECK (citation_status IN ('verified', 'unverified')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE (rule_key, version)
);
CREATE TABLE crop_risk_rule_reviews (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES crop_risk_rules(id),
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'retire')),
  reviewer_name TEXT NOT NULL,
  reviewer_qualification TEXT NOT NULL,
  note TEXT NOT NULL,
  reviewed_at TEXT NOT NULL
);
CREATE INDEX crop_risk_rule_reviews_rule ON crop_risk_rule_reviews(rule_id, reviewed_at);
CREATE TABLE crop_field_reports (
  id TEXT PRIMARY KEY,
  hazard_key TEXT NOT NULL CHECK (hazard_key IN ('fruit_rot_mahali', 'yellow_leaf_disease', 'bud_rot', 'root_grub', 'areolate_mildew')),
  state TEXT NOT NULL,
  district TEXT NOT NULL,
  location_detail TEXT NOT NULL,
  observed_on TEXT NOT NULL CHECK (observed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reporter_role TEXT NOT NULL CHECK (reporter_role IN ('farmer', 'extension_officer', 'scientist', 'other')),
  symptoms_observed TEXT NOT NULL,
  palms_inspected INTEGER CHECK (palms_inspected IS NULL OR palms_inspected > 0),
  palms_affected INTEGER CHECK (palms_affected IS NULL OR palms_affected >= 0),
  evidence_url TEXT CHECK (evidence_url IS NULL OR evidence_url LIKE 'https://%'),
  submitted_at TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  reviewed_by TEXT,
  review_note TEXT,
  reviewed_at TEXT,
  CHECK (palms_affected IS NULL OR palms_inspected IS NULL OR palms_affected <= palms_inspected)
);
CREATE INDEX crop_field_reports_scope ON crop_field_reports(hazard_key, state, district, observed_on);
CREATE TRIGGER crop_risk_rules_no_update BEFORE UPDATE ON crop_risk_rules
BEGIN SELECT RAISE(ABORT, 'risk rules are versioned; create a new version'); END;
CREATE TRIGGER crop_risk_rules_no_delete BEFORE DELETE ON crop_risk_rules
BEGIN SELECT RAISE(ABORT, 'risk rules are versioned; retire through review'); END;
CREATE TRIGGER crop_risk_rule_reviews_no_update BEFORE UPDATE ON crop_risk_rule_reviews
BEGIN SELECT RAISE(ABORT, 'rule reviews are immutable'); END;
CREATE TRIGGER crop_risk_rule_reviews_no_delete BEFORE DELETE ON crop_risk_rule_reviews
BEGIN SELECT RAISE(ABORT, 'rule reviews are immutable'); END;
CREATE TRIGGER crop_field_reports_evidence_immutable BEFORE UPDATE OF hazard_key, state, district, location_detail, observed_on,
  reporter_role, symptoms_observed, palms_inspected, palms_affected, evidence_url, submitted_at ON crop_field_reports
BEGIN SELECT RAISE(ABORT, 'field evidence is immutable; submit a new report'); END;
CREATE TRIGGER crop_field_reports_no_delete BEFORE DELETE ON crop_field_reports
BEGIN SELECT RAISE(ABORT, 'field evidence is immutable'); END;

-- Draft seed rules. Summaries restate only what the cited ICAR-CPCRI publications say. No weather
-- thresholds or treatment guidance are seeded: a qualified reviewer must supply them in a new version.
INSERT INTO crop_risk_rules (id, rule_key, version, hazard_key, hazard_name, hazard_type, causal_agent, source_summary,
  weather_relevance, weather_conditions_json, field_evidence_required, management_guidance, citations_json, citation_status, created_at, created_by)
VALUES
('arecanut-fruit-rot-v1', 'arecanut-fruit-rot', 1, 'fruit_rot_mahali', 'Fruit rot (Koleroga / Mahali)', 'disease', 'Phytophthora meadii (P. arecae in older CPCRI literature)',
 'ICAR-CPCRI (Vittal) describes fruit rot as widespread in all arecanut tracts with crop losses of 10-90% depending on weather conditions; control is by prophylactic pre-monsoon spraying with a repeat spray after 40-45 days and a third if the monsoon is prolonged.',
 'weather_linked', NULL,
 'Water-soaked lesions on the nut surface near the perianth end, shedding of infected nuts, whitish mycelial growth on shed nuts.',
 NULL,
 '[{"publisher":"ICAR-CPCRI Regional Station, Vittal","title":"Disease management strategies in arecanut and cocoa","url":"https://cpcri.gov.in/filemgr/webfs/publication/disease_management_strategies_in_arecanut_and_cocoa(eng)_1.pdf"},{"publisher":"ICAR-CPCRI Krishi Vigyan Kendra, Kasaragod","title":"Arecanut cultivation practices (KVK Folder No. 2)","url":"https://cpcri.gov.in/filemgr/webfs/publication/arecanut_cultivation_practices(eng).pdf"}]',
 'verified', '2026-11-05T00:00:00Z', 'migration-0018'),
('arecanut-bud-rot-v1', 'arecanut-bud-rot', 1, 'bud_rot', 'Bud rot and crown rot', 'disease', 'Phytophthora meadii',
 'ICAR-CPCRI (Vittal) describes bud rot as a fatal disease caused by the same organism as fruit rot, prevalent during the south-west monsoon (June-September) and the subsequent winter months (October-February).',
 'weather_linked', NULL,
 'Yellowing of the spindle leaf that later turns brown; in advanced stages the spindle can be drawn out of the crown with a slight pull. Crown rot starts at the leaf-sheath base of the outer whorl.',
 NULL,
 '[{"publisher":"ICAR-CPCRI Regional Station, Vittal","title":"Disease management strategies in arecanut and cocoa","url":"https://cpcri.gov.in/filemgr/webfs/publication/disease_management_strategies_in_arecanut_and_cocoa(eng)_1.pdf"}]',
 'verified', '2026-11-05T00:00:00Z', 'migration-0018'),
('arecanut-yellow-leaf-v1', 'arecanut-yellow-leaf', 1, 'yellow_leaf_disease', 'Yellow leaf disease (YLD)', 'disease', NULL,
 'ICAR-CPCRI describes yellowing starting from leaflet tips of outer leaves, reduced crown and blackening/rotting of feeder roots; the KVK leaflet states the disease is not amenable to control by conventional plant-protection measures.',
 'not_weather_driven', NULL,
 'Yellowing from leaflet tips of outer leaves with green stripes, necrosis from tips, smaller stiff leaves, reduced crown, blackened feeder roots.',
 NULL,
 '[{"publisher":"ICAR-CPCRI Regional Station, Vittal","title":"Disease management strategies in arecanut and cocoa","url":"https://cpcri.gov.in/filemgr/webfs/publication/disease_management_strategies_in_arecanut_and_cocoa(eng)_1.pdf"},{"publisher":"ICAR-CPCRI Krishi Vigyan Kendra, Kasaragod","title":"Arecanut cultivation practices (KVK Folder No. 2)","url":"https://cpcri.gov.in/filemgr/webfs/publication/arecanut_cultivation_practices(eng).pdf"}]',
 'verified', '2026-11-05T00:00:00Z', 'migration-0018'),
('arecanut-root-grub-v1', 'arecanut-root-grub', 1, 'root_grub', 'Root grub', 'pest', 'Leucopholis burmeisteri Brenske',
 'The ICAR-CPCRI KVK leaflet lists root grub as a pest and ties adult-beetle collection to the days after pre-monsoon showers and soil treatment to May (before the south-west monsoon) and September-October. Its chemical recommendations are historical and must not be republished without current expert approval.',
 'weather_linked', NULL,
 'Grubs feeding on roots in the root zone; adult beetles emerging after pre-monsoon showers.',
 NULL,
 '[{"publisher":"ICAR-CPCRI Krishi Vigyan Kendra, Kasaragod","title":"Arecanut cultivation practices (KVK Folder No. 2)","url":"https://cpcri.gov.in/filemgr/webfs/publication/arecanut_cultivation_practices(eng).pdf"}]',
 'verified', '2026-11-05T00:00:00Z', 'migration-0018'),
('arecanut-areolate-mildew-v1', 'arecanut-areolate-mildew', 1, 'areolate_mildew', 'Areolate mildew', 'disease', NULL,
 'No ICAR-CPCRI primary source describing areolate mildew of arecanut has been verified by ANI. This rule cannot be approved until a reviewer attaches a verified citation in a new version.',
 'unknown', NULL,
 'To be specified by the reviewing expert from a verified source.',
 NULL, '[]', 'unverified', '2026-11-05T00:00:00Z', 'migration-0018');

-- AGMARKNET 2.0 wholesale arrivals (api.agmarknet.gov.in/v1/price-trend/wholesale-arrivals-{monthly,weekly}).
-- Additive only: no existing table, row or trigger is changed. Prices are never read from this source, and nothing here
-- feeds market_price_observations, the reference index or market_arrivals (daily file imports keep their own table).
-- See docs/AGMARKNET_V2_ARRIVALS.md.
--
-- Rollback (nothing else references these objects):
--   DROP VIEW market_arrival_periods_current; DROP TABLE market_arrival_periods; DROP TABLE agmarknet_v2_fetches;
--   DROP TABLE agmarknet_v2_market_aliases;
--   DELETE FROM source_ingestion_runs WHERE source_id = 'source-agmarknet-v2-arrivals';
--   DELETE FROM data_sources WHERE id = 'source-agmarknet-v2-arrivals';
INSERT OR IGNORE INTO data_sources (id, source_key, name, source_type) VALUES
  ('source-agmarknet-v2-arrivals', 'agmarknet_v2_arrivals', 'AGMARKNET 2.0 market-wise wholesale arrivals', 'public_report');

-- Every distinct source response, exactly as received. A re-fetch with identical bytes is not stored again.
CREATE TABLE agmarknet_v2_fetches (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL CHECK (endpoint IN ('wholesale-arrivals-monthly', 'wholesale-arrivals-weekly')),
  -- instr, not LIKE: D1 limits LIKE/GLOB patterns to 50 bytes.
  request_url TEXT NOT NULL CHECK (instr(request_url, 'https://api.agmarknet.gov.in/v1/price-trend/wholesale-arrivals-') = 1),
  request_params TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  response_sha256 TEXT NOT NULL CHECK (length(response_sha256) = 64),
  response_bytes INTEGER NOT NULL CHECK (response_bytes > 0),
  response_body TEXT NOT NULL,
  source_title TEXT,
  parser_version TEXT NOT NULL,
  first_fetched_at TEXT NOT NULL,
  UNIQUE (request_url, response_sha256)
);
CREATE TRIGGER agmarknet_v2_fetches_no_update BEFORE UPDATE ON agmarknet_v2_fetches
BEGIN SELECT RAISE(ABORT, 'AGMARKNET 2.0 fetch evidence is immutable'); END;
CREATE TRIGGER agmarknet_v2_fetches_no_delete BEFORE DELETE ON agmarknet_v2_fetches
BEGIN SELECT RAISE(ABORT, 'AGMARKNET 2.0 fetch evidence is immutable'); END;

-- One row per market and closed reporting period, in the source's own names and unit. A changed source value is stored
-- as the next version; earlier versions stay. AGMARKNET weeks are month-relative (1-8, 9-15, 16-23, 24-end), not
-- Monday weeks, so they are kept as their own period type rather than as daily rows.
CREATE TABLE market_arrival_periods (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL CHECK (source_key = 'agmarknet_v2_arrivals'),
  fetch_id TEXT NOT NULL REFERENCES agmarknet_v2_fetches(id),
  commodity_code TEXT NOT NULL DEFAULT 'arecanut',
  source_commodity_id INTEGER NOT NULL,
  source_commodity_name TEXT NOT NULL,
  state TEXT NOT NULL,
  source_state_id INTEGER NOT NULL,
  source_district_id INTEGER NOT NULL,
  source_district_name TEXT NOT NULL,
  source_market_name TEXT NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('month', 'agm_week')),
  period_start TEXT NOT NULL CHECK (period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  period_end TEXT NOT NULL CHECK (period_end GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  period_week INTEGER CHECK (period_week IS NULL OR period_week BETWEEN 1 AND 4),
  source_period_label TEXT NOT NULL,
  source_column_key TEXT NOT NULL,
  value_status TEXT NOT NULL CHECK (value_status IN ('reported', 'not_reported')),
  quantity_original REAL CHECK (quantity_original IS NULL OR quantity_original >= 0),
  unit_original TEXT NOT NULL,
  quantity_tonnes REAL CHECK (quantity_tonnes IS NULL OR quantity_tonnes >= 0),
  unit_status TEXT NOT NULL CHECK (unit_status IN ('converted', 'not_applicable')),
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  first_seen_at TEXT NOT NULL,
  CHECK (period_start <= period_end),
  CHECK ((period_type = 'month') = (period_week IS NULL)),
  CHECK ((value_status = 'reported') = (quantity_original IS NOT NULL)),
  CHECK ((unit_status = 'converted') = (quantity_tonnes IS NOT NULL)),
  CHECK ((value_status = 'reported') = (unit_status = 'converted')),
  UNIQUE (source_key, source_state_id, source_district_id, source_market_name, period_type, period_start, version_number)
);
CREATE INDEX market_arrival_periods_scope ON market_arrival_periods(commodity_code, state, period_type, period_start);
CREATE INDEX market_arrival_periods_identity
  ON market_arrival_periods(source_state_id, source_district_id, source_market_name, period_type, period_start, version_number);
CREATE TRIGGER market_arrival_periods_no_update BEFORE UPDATE ON market_arrival_periods
BEGIN SELECT RAISE(ABORT, 'arrival periods are append-only; a changed source value is a new version'); END;
CREATE TRIGGER market_arrival_periods_no_delete BEFORE DELETE ON market_arrival_periods
BEGIN SELECT RAISE(ABORT, 'arrival periods are append-only'); END;

-- Source market names that changed over time, mapped to the current AGMARKNET name (which matches the price markets).
-- Insert-only: a correction is a new version, and the highest version applies.
CREATE TABLE agmarknet_v2_market_aliases (
  source_state_id INTEGER NOT NULL,
  source_district_id INTEGER NOT NULL,
  source_market_name TEXT NOT NULL,
  district TEXT NOT NULL,
  market TEXT NOT NULL,
  mapping_status TEXT NOT NULL CHECK (mapping_status IN ('verified', 'unverified')),
  evidence TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_state_id, source_district_id, source_market_name, version)
);
CREATE TRIGGER agmarknet_v2_market_aliases_no_update BEFORE UPDATE ON agmarknet_v2_market_aliases
BEGIN SELECT RAISE(ABORT, 'market aliases are versioned; insert a new version'); END;
CREATE TRIGGER agmarknet_v2_market_aliases_no_delete BEFORE DELETE ON agmarknet_v2_market_aliases
BEGIN SELECT RAISE(ABORT, 'market aliases are versioned; insert a new version'); END;
INSERT INTO agmarknet_v2_market_aliases (source_state_id, source_district_id, source_market_name, district, market, mapping_status, evidence, created_at) VALUES
  (16, 266, 'Hosanagar APMC', 'Shivamogga', 'Hosanagara APMC', 'verified',
   'Same APMC: name used to 2025-05, current name from 2026-04; confirmed by the operator 2026-11-17.', '2026-11-17T00:00:00Z'),
  (16, 266, 'Shimogga(Theertahalli) APMC', 'Shivamogga', 'APMC THIRTHAHALLI', 'verified',
   'Old name ends 2025-08 and the current name starts 2025-09 with no overlap; the price history maps the same market (docs/AGMARKNET_HISTORY.md).', '2026-11-17T00:00:00Z');

-- Latest version of each period, with current market names, the matching price market (when one exists) and the
-- reporting era. AGMARKNET 2.0 went live on 2025-11-07; October 2025 is markedly under-reported in every market.
CREATE VIEW market_arrival_periods_current AS
SELECT p.id, p.source_key, p.fetch_id, p.commodity_code, p.state, p.source_state_id, p.source_district_id, p.source_district_name,
  p.source_market_name, COALESCE(a.district, p.source_district_name) AS district, COALESCE(a.market, p.source_market_name) AS market,
  CASE WHEN a.market IS NULL THEN 'source_name' ELSE 'alias_' || a.mapping_status END AS mapping_status,
  (SELECT m.id FROM markets m WHERE m.state = p.state AND m.district = COALESCE(a.district, p.source_district_name)
     AND lower(m.name) = lower(COALESCE(a.market, p.source_market_name)) LIMIT 1) AS market_id,
  p.period_type, p.period_start, p.period_end, p.period_week, p.source_period_label, p.source_column_key,
  p.value_status, p.quantity_original, p.unit_original, p.quantity_tonnes, p.unit_status, p.version_number, p.first_seen_at,
  CASE WHEN p.period_end < '2025-10-01' THEN 'agmarknet_1_legacy'
       WHEN p.period_start >= '2025-11-07' THEN 'agmarknet_2' ELSE 'cutover' END AS era
FROM market_arrival_periods p
LEFT JOIN agmarknet_v2_market_aliases a ON a.source_state_id = p.source_state_id AND a.source_district_id = p.source_district_id
  AND a.source_market_name = p.source_market_name
  AND a.version = (SELECT MAX(x.version) FROM agmarknet_v2_market_aliases x WHERE x.source_state_id = a.source_state_id
    AND x.source_district_id = a.source_district_id AND x.source_market_name = a.source_market_name)
WHERE p.version_number = (SELECT MAX(q.version_number) FROM market_arrival_periods q
  WHERE q.source_key = p.source_key AND q.source_state_id = p.source_state_id AND q.source_district_id = p.source_district_id
    AND q.source_market_name = p.source_market_name AND q.period_type = p.period_type AND q.period_start = p.period_start);

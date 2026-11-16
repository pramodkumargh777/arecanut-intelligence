-- TMS Sirsi (Sirsi Taluka Agricultural Produce Co-operative Marketing Society) as a fourth cooperative source.
-- SQLite cannot widen a CHECK constraint in place, so the tables that list cooperative sources are rebuilt under the
-- same names, as in migration 0013. Every row, trigger, index, view and foreign key is preserved. TMS publishes a
-- tender average (the plain mean of the day's tender lot rates), the same price basis as TSS.
PRAGMA defer_foreign_keys = on;

-- The view and the forecast guard read cooperative_quotes; renaming a rebuilt table fails while they point at a missing one.
DROP VIEW price_observations;
DROP TRIGGER forecast_predictions_cooperative_guard;

-- 1. Source registry.
CREATE TABLE cooperative_sources_new (
  source_key TEXT PRIMARY KEY CHECK (source_key IN ('mamcos', 'tss', 'tumcos', 'tms')),
  display_name TEXT NOT NULL,
  operator TEXT NOT NULL,
  source_url TEXT NOT NULL,
  access_method TEXT NOT NULL,
  commodities TEXT NOT NULL,
  robots_status TEXT NOT NULL,
  terms_status TEXT NOT NULL,
  permission_status TEXT NOT NULL CHECK (permission_status IN ('not_requested', 'requested', 'granted', 'denied')),
  scheduled_collection_allowed INTEGER NOT NULL DEFAULT 0 CHECK (scheduled_collection_allowed IN (0, 1)),
  redistribution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (redistribution_allowed IN (0, 1)),
  permission_reference TEXT,
  unit_evidence TEXT NOT NULL,
  notes TEXT NOT NULL,
  terms_checked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO cooperative_sources_new SELECT source_key, display_name, operator, source_url, access_method, commodities,
  robots_status, terms_status, permission_status, scheduled_collection_allowed, redistribution_allowed, permission_reference,
  unit_evidence, notes, terms_checked_at, updated_at FROM cooperative_sources;
INSERT INTO cooperative_sources_new VALUES
('tms', 'TMS Sirsi tender rates', 'Sirsi Taluka Agricultural Produce Co-operative Marketing Society Ltd. (TMS), Sirsi',
 'https://members.tmssirsi.com/', 'public_json_api_used_by_public_page', 'arecanut',
 'members.tmssirsi.com robots.txt contains only Cloudflare content-signal definitions; no allow/disallow rules and no content-signal values.',
 'Terms of Use (updated 2026-08-25) cover the members'' app and services; no data-reuse licence for the public rates was found.',
 'not_requested', 0, 0, NULL,
 'The public member-portal page states "Rates in ₹/quintal"; the parser fails closed if the declaration is missing.',
 'The average is the plain mean of the day''s general tender lot rates and the minimum and maximum are the lowest and highest lot (checked against the lot rows on 2026-11-13). Lot rows carry only lot number, item, bags, rate and quantity; per-variety lot, bag and quantity totals are kept. The quantity unit is not stated.',
 '2026-11-16', '2026-11-16T05:30:00Z');
DROP TABLE cooperative_sources;
ALTER TABLE cooperative_sources_new RENAME TO cooperative_sources;

-- 2. Fetches and quotations. Child review rows are stashed so the parents can be rebuilt without dangling foreign keys.
CREATE TABLE cooperative_reviews_stash AS SELECT * FROM cooperative_reviews;
DELETE FROM cooperative_reviews;

CREATE TABLE cooperative_fetches_new (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL CHECK (source_key IN ('mamcos', 'tss', 'tumcos', 'tms')),
  source_url TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'blocked')),
  error_message TEXT,
  raw_snapshot TEXT,
  received_count INTEGER,
  inserted_count INTEGER,
  excluded_count INTEGER NOT NULL DEFAULT 0,
  ingest_mode TEXT NOT NULL DEFAULT 'manual_refresh'
    CHECK (ingest_mode IN ('scheduled', 'manual_refresh', 'backfill', 'manual_csv', 'snapshot_replay')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  http_status INTEGER,
  requested_date TEXT,
  replay_of TEXT,
  snapshot_sha256 TEXT,
  notes TEXT
);
INSERT INTO cooperative_fetches_new (id, source_key, source_url, started_at, finished_at, status, error_message, raw_snapshot,
  received_count, inserted_count, excluded_count, ingest_mode, attempt_count, http_status, requested_date, replay_of,
  snapshot_sha256, notes)
SELECT id, source_key, source_url, started_at, finished_at, status, error_message, raw_snapshot,
  received_count, inserted_count, excluded_count, ingest_mode, attempt_count, http_status, requested_date, replay_of,
  snapshot_sha256, notes FROM cooperative_fetches;

CREATE TABLE cooperative_quotes_new (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL CHECK (source_key IN ('mamcos', 'tss', 'tumcos', 'tms')),
  commodity TEXT NOT NULL DEFAULT 'arecanut' CHECK (commodity IN ('arecanut', 'black_pepper')),
  branch TEXT NOT NULL,
  reporting_date TEXT NOT NULL,
  variety TEXT NOT NULL,
  variety_reported INTEGER NOT NULL DEFAULT 1 CHECK (variety_reported IN (0, 1)),
  minimum_price REAL,
  maximum_price REAL,
  average_price REAL,
  price_type TEXT NOT NULL CHECK (price_type = 'reported_average'),
  price_unit TEXT NOT NULL CHECK (price_unit IN ('INR/quintal', 'unconfirmed')),
  source_unit_label TEXT,
  unit_status TEXT NOT NULL DEFAULT 'source_confirmed' CHECK (unit_status IN ('source_confirmed', 'assumed', 'source_conflict')),
  normal_price REAL,
  lot_count INTEGER,
  bag_count INTEGER,
  reported_weight REAL,
  session_codes TEXT,
  source_record_id TEXT NOT NULL DEFAULT '',
  source_published_at TEXT,
  review_flags TEXT,
  ingest_mode TEXT NOT NULL DEFAULT 'manual_refresh'
    CHECK (ingest_mode IN ('scheduled', 'manual_refresh', 'backfill', 'manual_csv', 'snapshot_replay')),
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  fetch_id TEXT NOT NULL REFERENCES cooperative_fetches_new(id),
  raw_record TEXT NOT NULL,
  validation_message TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'invalid', 'verified', 'rejected', 'superseded', 'accepted_unit_unconfirmed')),
  price_basis TEXT NOT NULL DEFAULT 'COOPERATIVE_AVERAGE'
    CHECK (price_basis IN ('COOPERATIVE_AVERAGE', 'COOPERATIVE_TENDER_AVERAGE')),
  hold_reason TEXT,
  held_at TEXT
);
INSERT INTO cooperative_quotes_new (id, source_key, commodity, branch, reporting_date, variety, variety_reported, minimum_price,
  maximum_price, average_price, price_type, price_unit, source_unit_label, unit_status, normal_price, lot_count, bag_count,
  reported_weight, session_codes, source_record_id, source_published_at, review_flags, ingest_mode, source_url, fetched_at,
  fetch_id, raw_record, validation_message, status, price_basis, hold_reason, held_at)
SELECT id, source_key, commodity, branch, reporting_date, variety, variety_reported, minimum_price,
  maximum_price, average_price, price_type, price_unit, source_unit_label, unit_status, normal_price, lot_count, bag_count,
  reported_weight, session_codes, source_record_id, source_published_at, review_flags, ingest_mode, source_url, fetched_at,
  fetch_id, raw_record, validation_message, status, price_basis, hold_reason, held_at FROM cooperative_quotes;

DROP TABLE cooperative_quotes;
DROP TABLE cooperative_fetches;
ALTER TABLE cooperative_fetches_new RENAME TO cooperative_fetches;
ALTER TABLE cooperative_quotes_new RENAME TO cooperative_quotes;

INSERT INTO cooperative_reviews SELECT * FROM cooperative_reviews_stash;
DROP TABLE cooperative_reviews_stash;

CREATE UNIQUE INDEX cooperative_current ON cooperative_quotes(source_key, commodity, branch, reporting_date, variety, source_record_id)
  WHERE status != 'superseded';
CREATE INDEX cooperative_date ON cooperative_quotes(source_key, status, commodity, reporting_date, variety);
CREATE INDEX cooperative_fetch_recent ON cooperative_fetches(source_key, started_at);
CREATE INDEX idx_cooperative_variety_date
  ON cooperative_quotes (source_key, commodity, status, variety, reporting_date);
CREATE INDEX idx_cooperative_review_queue
  ON cooperative_quotes (reporting_date, source_key)
  WHERE status IN ('pending', 'invalid');

CREATE TRIGGER cooperative_verify_guard
BEFORE UPDATE ON cooperative_quotes
WHEN NEW.status = 'verified' AND (
  NEW.minimum_price IS NULL OR NEW.maximum_price IS NULL OR NEW.average_price IS NULL
  OR NEW.minimum_price <= 0 OR NEW.average_price < NEW.minimum_price OR NEW.average_price > NEW.maximum_price
  OR trim(NEW.branch) = '' OR trim(NEW.variety) = '' OR NEW.validation_message IS NOT NULL
  OR length(NEW.reporting_date) != 10 OR date(NEW.reporting_date, '+0 days') IS NULL
  OR date(NEW.reporting_date, '+0 days') != NEW.reporting_date OR NEW.reporting_date > date('now'))
BEGIN
  SELECT RAISE(ABORT, 'Invalid cooperative quotation cannot be published');
END;
CREATE TRIGGER cooperative_verify_insert_guard
BEFORE INSERT ON cooperative_quotes
WHEN NEW.status = 'verified' AND (
  NEW.minimum_price IS NULL OR NEW.maximum_price IS NULL OR NEW.average_price IS NULL
  OR NEW.minimum_price <= 0 OR NEW.average_price < NEW.minimum_price OR NEW.average_price > NEW.maximum_price
  OR trim(NEW.branch) = '' OR trim(NEW.variety) = '' OR NEW.validation_message IS NOT NULL
  OR length(NEW.reporting_date) != 10 OR date(NEW.reporting_date, '+0 days') IS NULL
  OR date(NEW.reporting_date, '+0 days') != NEW.reporting_date OR NEW.reporting_date > date('now'))
BEGIN
  SELECT RAISE(ABORT, 'Invalid cooperative quotation cannot be published');
END;
CREATE TRIGGER tss_assumed_unit_insert
BEFORE INSERT ON cooperative_quotes
WHEN NEW.source_key = 'tss' AND NEW.unit_status != 'assumed'
BEGIN
  SELECT RAISE(ABORT, 'TSS unit must remain explicitly assumed');
END;
CREATE TRIGGER tss_assumed_unit_update
BEFORE UPDATE ON cooperative_quotes
WHEN NEW.source_key = 'tss' AND NEW.unit_status != 'assumed'
BEGIN
  SELECT RAISE(ABORT, 'TSS unit must remain explicitly assumed');
END;
CREATE TRIGGER cooperative_source_commodity_insert
BEFORE INSERT ON cooperative_quotes
WHEN NEW.commodity = 'black_pepper' AND NEW.source_key != 'tumcos'
BEGIN
  SELECT RAISE(ABORT, 'Only TUMCOS black pepper quotations are supported');
END;
CREATE TRIGGER cooperative_raw_immutable
BEFORE UPDATE OF raw_record, minimum_price, maximum_price, average_price, reporting_date, branch, variety, commodity, source_key
ON cooperative_quotes
BEGIN
  SELECT RAISE(ABORT, 'Cooperative source observations are immutable; ingest a corrected record instead');
END;
CREATE TRIGGER cooperative_price_basis_immutable
BEFORE UPDATE OF price_basis ON cooperative_quotes
WHEN NEW.price_basis != OLD.price_basis
BEGIN
  SELECT RAISE(ABORT, 'Price basis is immutable; ingest a corrected record instead');
END;
-- TSS and TMS publish tender averages; MAMCOS and TUMCOS publish branch averages.
CREATE TRIGGER cooperative_price_basis_source_insert
BEFORE INSERT ON cooperative_quotes
WHEN (NEW.source_key IN ('tss', 'tms') AND NEW.price_basis != 'COOPERATIVE_TENDER_AVERAGE')
  OR (NEW.source_key NOT IN ('tss', 'tms') AND NEW.price_basis != 'COOPERATIVE_AVERAGE')
BEGIN
  SELECT RAISE(ABORT, 'Cooperative price basis does not match the source');
END;
CREATE TRIGGER cooperative_quotes_no_delete BEFORE DELETE ON cooperative_quotes
BEGIN SELECT RAISE(ABORT, 'Cooperative quotations are retained evidence; supersede instead'); END;
CREATE TRIGGER cooperative_fetches_no_delete BEFORE DELETE ON cooperative_fetches
BEGIN SELECT RAISE(ABORT, 'Cooperative fetch records are retained evidence'); END;
CREATE TRIGGER cooperative_snapshot_offload_guard
BEFORE UPDATE OF raw_snapshot ON cooperative_fetches
WHEN OLD.raw_snapshot IS NOT NULL AND NEW.raw_snapshot IS NULL AND NOT EXISTS (
  SELECT 1 FROM archive_objects a WHERE a.related_table = 'cooperative_fetches' AND a.related_id = OLD.id
    AND a.storage = 'r2' AND a.status = 'stored' AND a.sha256 = OLD.snapshot_sha256)
BEGIN SELECT RAISE(ABORT, 'Inline snapshot can be cleared only after a verified R2 archive copy exists'); END;
CREATE TRIGGER cooperative_snapshot_no_rewrite
BEFORE UPDATE OF raw_snapshot ON cooperative_fetches
WHEN OLD.raw_snapshot IS NOT NULL AND NEW.raw_snapshot IS NOT NULL AND NEW.raw_snapshot != OLD.raw_snapshot
BEGIN SELECT RAISE(ABORT, 'Raw snapshots are immutable'); END;
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

-- 3. Commodity capabilities: arecanut gains the TMS feed.
CREATE TABLE commodity_capabilities_new (
  commodity_id TEXT NOT NULL REFERENCES commodities(id),
  capability TEXT NOT NULL CHECK (capability IN (
    'daily_prices', 'analytics', 'market_comparison', 'monthly_history', 'forecast',
    'cooperative_mamcos', 'cooperative_tss', 'cooperative_tumcos', 'cooperative_tms',
    'production', 'trade', 'weather', 'quality', 'calculators', 'intelligence')),
  status TEXT NOT NULL CHECK (status IN ('available', 'unpublished')),
  note TEXT,
  PRIMARY KEY (commodity_id, capability)
);
INSERT INTO commodity_capabilities_new SELECT commodity_id, capability, status, note FROM commodity_capabilities;
INSERT INTO commodity_capabilities_new (commodity_id, capability, status, note) VALUES ('commodity-arecanut', 'cooperative_tms', 'available', NULL);
DROP TABLE commodity_capabilities;
ALTER TABLE commodity_capabilities_new RENAME TO commodity_capabilities;

-- 4. Restore the readers of cooperative_quotes, unchanged from migration 0020.
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

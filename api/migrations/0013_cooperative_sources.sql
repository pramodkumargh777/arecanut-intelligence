-- Cooperative source generalisation: TUMCOS, commodities, quantities, ingestion provenance,
-- permission registry and a hard block on publishing unconfirmed units as verified INR/quintal.
-- Existing rows are preserved. Rebuilt tables keep their names so existing foreign keys remain valid.
PRAGMA defer_foreign_keys = on;

CREATE TABLE cooperative_sources (
  source_key TEXT PRIMARY KEY CHECK (source_key IN ('mamcos', 'tss', 'tumcos')),
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

INSERT INTO cooperative_sources VALUES
('mamcos', 'MAMCOS areca market rates', 'Malnad Areca Marketing Co-operative Society Limited (MAMCOS)',
 'https://mamcos.info/areca-market-rates', 'public_html_page', 'arecanut',
 'robots.txt disallows /admin and /api/ only; the rates page is not disallowed.',
 'No terms of use or data-reuse licence found. Footer states "All rights reserved". Privacy policy covers personal data only.',
 'not_requested', 0, 0, NULL,
 'Page declares "All market rates are in ₹ per Quintal"; parser fails closed if the declaration is missing.',
 'Reported averages are cooperative branch averages, not APMC modal prices. Public display retained by owner decision while permission is unconfirmed.',
 '2026-11-04', '2026-11-04T17:30:00Z'),
('tss', 'TSS Sirsi tender rates', 'Totagars Co-operative Sales Society (TSS), Sirsi',
 'https://web.tssindia.in/', 'public_json_api_used_by_public_page', 'arecanut',
 'web.tssindia.in and webapi.tssindia.in robots.txt contain only Cloudflare content-signal definitions; no allow/disallow rules and no content-signal values.',
 'No terms of use or data-reuse licence found on the public homepage.',
 'not_requested', 0, 0, NULL,
 'No unit label in the rates API, the tender API or the public page bundle. INR/quintal is an assumption.',
 'Lot-level tender records include seller names, account numbers and buyer codes; only per-variety lot, bag and weight aggregates are retained.',
 '2026-11-04', '2026-11-04T17:30:00Z'),
('tumcos', 'TUMCOS market rates', 'TUMCOS Ltd (Tota Utpannagala Marata Sahakara Sangha Niyamith), Channagiri',
 'https://www.tumcos.com/market-rates.php?lang=en', 'public_html_page', 'arecanut,black_pepper',
 'robots.txt returns HTTP 404 (no robots policy published).',
 'No terms of use found. Footer states "All rights reserved". Disclaimer: "Rates are indicative and may vary."',
 'not_requested', 0, 0, NULL,
 'Every embedded record declares unit "kg", but values (about 22,000-70,000) are only plausible per quintal. Unit is recorded as a source conflict.',
 'Page header "Last Updated" is stale relative to record dates; record dates are used. No variety/grade field is published.',
 '2026-11-04', '2026-11-04T17:30:00Z');

-- Child review rows are stashed so parent tables can be rebuilt without dangling deferred foreign-key counts.
CREATE TABLE cooperative_reviews_stash AS SELECT * FROM cooperative_reviews;
DELETE FROM cooperative_reviews;

CREATE TABLE cooperative_fetches_new (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL CHECK (source_key IN ('mamcos', 'tss', 'tumcos')),
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
INSERT INTO cooperative_fetches_new (id, source_key, source_url, started_at, finished_at, status, error_message,
  raw_snapshot, received_count, inserted_count, excluded_count)
SELECT id, source_key, source_url, started_at, finished_at, status, error_message, raw_snapshot,
  received_count, inserted_count, excluded_count FROM cooperative_fetches;

CREATE TABLE cooperative_quotes_new (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL CHECK (source_key IN ('mamcos', 'tss', 'tumcos')),
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
  status TEXT NOT NULL CHECK (status IN ('pending', 'invalid', 'verified', 'rejected', 'superseded', 'accepted_unit_unconfirmed'))
);
-- Previously approved TSS rows had an assumed unit. They are retained but no longer published as verified.
INSERT INTO cooperative_quotes_new (id, source_key, commodity, branch, reporting_date, variety, minimum_price, maximum_price,
  average_price, price_type, price_unit, unit_status, normal_price, source_url, fetched_at, fetch_id, raw_record,
  validation_message, status)
SELECT id, source_key, 'arecanut', branch, reporting_date, variety, minimum_price, maximum_price, average_price,
  price_type, price_unit, unit_status, normal_price, source_url, fetched_at, fetch_id, raw_record, validation_message,
  CASE WHEN status = 'verified' AND unit_status != 'source_confirmed' THEN 'accepted_unit_unconfirmed' ELSE status END
FROM cooperative_quotes;

DROP TABLE cooperative_quotes;
DROP TABLE cooperative_fetches;
ALTER TABLE cooperative_fetches_new RENAME TO cooperative_fetches;
ALTER TABLE cooperative_quotes_new RENAME TO cooperative_quotes;

ALTER TABLE cooperative_reviews ADD COLUMN new_status TEXT;
INSERT INTO cooperative_reviews (id, quote_id, action, reviewer, reviewed_at, previous_status)
SELECT id, quote_id, action, reviewer, reviewed_at, previous_status FROM cooperative_reviews_stash;
DROP TABLE cooperative_reviews_stash;

CREATE UNIQUE INDEX cooperative_current ON cooperative_quotes(source_key, commodity, branch, reporting_date, variety, source_record_id)
  WHERE status != 'superseded';
CREATE INDEX cooperative_date ON cooperative_quotes(source_key, status, commodity, reporting_date, variety);
CREATE INDEX cooperative_fetch_recent ON cooperative_fetches(source_key, started_at);

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

CREATE TRIGGER cooperative_unit_publication_update
BEFORE UPDATE ON cooperative_quotes
WHEN NEW.status = 'verified' AND (NEW.unit_status != 'source_confirmed' OR NEW.price_unit != 'INR/quintal')
BEGIN
  SELECT RAISE(ABORT, 'Only source-confirmed INR/quintal quotations can be published as verified');
END;

CREATE TRIGGER cooperative_unit_publication_insert
BEFORE INSERT ON cooperative_quotes
WHEN NEW.status = 'verified' AND (NEW.unit_status != 'source_confirmed' OR NEW.price_unit != 'INR/quintal')
BEGIN
  SELECT RAISE(ABORT, 'Only source-confirmed INR/quintal quotations can be published as verified');
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

CREATE TRIGGER cooperative_snapshot_immutable
BEFORE UPDATE OF raw_snapshot ON cooperative_fetches
WHEN OLD.raw_snapshot IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Raw cooperative snapshots are immutable');
END;

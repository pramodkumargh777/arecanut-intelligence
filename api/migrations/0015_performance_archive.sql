-- 0015: D1 query performance, derived summary cache, optional R2 archive registry,
-- import idempotency, persisted operational errors and evidence-retention guards.
-- Additive only: no historical row is modified or removed.

-- 1. Compound/partial indexes matching the published read paths.
CREATE INDEX idx_observations_verified_series
  ON market_price_observations (commodity_name, variety_name, reporting_date, market_id)
  WHERE validation_status = 'verified';
CREATE INDEX idx_observations_verified_commodity_date
  ON market_price_observations (commodity_name, reporting_date)
  WHERE validation_status = 'verified';
CREATE INDEX idx_observations_review_queue
  ON market_price_observations (reporting_date, ingested_at)
  WHERE validation_status IN ('validated', 'review_required');
CREATE INDEX idx_observations_source_status_date
  ON market_price_observations (source_id, validation_status, reporting_date);
CREATE INDEX idx_observations_job ON market_price_observations (ingestion_job_id);
CREATE INDEX idx_cooperative_variety_date
  ON cooperative_quotes (source_key, commodity, status, variety, reporting_date);
CREATE INDEX idx_cooperative_review_queue
  ON cooperative_quotes (reporting_date, source_key)
  WHERE status IN ('pending', 'invalid');
CREATE INDEX idx_ingestion_job_logs_job ON ingestion_job_logs (job_id, created_at);
CREATE INDEX idx_ingestion_jobs_started ON ingestion_jobs (started_at);
CREATE INDEX idx_monthly_refresh_month ON monthly_refresh_runs (state, reporting_month, status);

-- 2. Derived daily reference cache. One row per commodity/state/variety/date holding the
-- median of one verified modal price per market (latest ingested record per market).
-- The coverage gate is applied at read time so MIN_INDEX_MARKETS changes need no rebuild.
-- This is a derived cache, never evidence: rows are recomputed from market_price_observations.
CREATE TABLE market_daily_summaries (
  commodity_name TEXT NOT NULL,
  state TEXT NOT NULL,
  variety_name TEXT NOT NULL,
  reporting_date TEXT NOT NULL,
  market_count INTEGER NOT NULL CHECK (market_count > 0),
  observation_count INTEGER NOT NULL CHECK (observation_count >= market_count),
  median_modal_price REAL NOT NULL,
  min_modal_price REAL NOT NULL,
  max_modal_price REAL NOT NULL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (commodity_name, state, variety_name, reporting_date)
) WITHOUT ROWID;

-- Dates whose cached summary must be recomputed; maintained by triggers so every write path
-- (import, review, correction, market-mapping approval) invalidates the cache.
CREATE TABLE market_summary_dirty (
  commodity_name TEXT NOT NULL,
  variety_name TEXT NOT NULL,
  reporting_date TEXT NOT NULL,
  marked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (commodity_name, variety_name, reporting_date)
) WITHOUT ROWID;

CREATE TRIGGER summary_dirty_observation_insert
AFTER INSERT ON market_price_observations
WHEN NEW.validation_status = 'verified'
BEGIN
  INSERT OR IGNORE INTO market_summary_dirty (commodity_name, variety_name, reporting_date)
  VALUES (NEW.commodity_name, NEW.variety_name, NEW.reporting_date);
END;

CREATE TRIGGER summary_dirty_observation_update
AFTER UPDATE OF validation_status, modal_price, market_id, variety_name, commodity_name, reporting_date, ingested_at
ON market_price_observations
WHEN OLD.validation_status = 'verified' OR NEW.validation_status = 'verified'
BEGIN
  INSERT OR IGNORE INTO market_summary_dirty (commodity_name, variety_name, reporting_date)
  VALUES (OLD.commodity_name, OLD.variety_name, OLD.reporting_date);
  INSERT OR IGNORE INTO market_summary_dirty (commodity_name, variety_name, reporting_date)
  VALUES (NEW.commodity_name, NEW.variety_name, NEW.reporting_date);
END;

CREATE TRIGGER summary_dirty_market_update
AFTER UPDATE OF mapping_status, state ON markets
BEGIN
  INSERT OR IGNORE INTO market_summary_dirty (commodity_name, variety_name, reporting_date)
  SELECT DISTINCT commodity_name, variety_name, reporting_date FROM market_price_observations
  WHERE market_id = NEW.id AND validation_status = 'verified';
END;

-- Initial population with the same SQL the API uses for incremental refreshes.
WITH current AS (
  SELECT o.commodity_name, m.state, o.variety_name, o.reporting_date, o.market_id, o.modal_price,
    ROW_NUMBER() OVER (PARTITION BY o.commodity_name, m.state, o.variety_name, o.reporting_date, o.market_id
      ORDER BY o.ingested_at DESC, o.id) AS market_rank,
    COUNT(*) OVER (PARTITION BY o.commodity_name, m.state, o.variety_name, o.reporting_date) AS observation_count
  FROM market_price_observations o JOIN markets m ON m.id = o.market_id
  WHERE o.validation_status = 'verified' AND m.mapping_status = 'verified'
), one_per_market AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY commodity_name, state, variety_name, reporting_date ORDER BY modal_price) AS price_rank,
    COUNT(*) OVER (PARTITION BY commodity_name, state, variety_name, reporting_date) AS market_count
  FROM current WHERE market_rank = 1
)
INSERT INTO market_daily_summaries (commodity_name, state, variety_name, reporting_date, market_count, observation_count,
  median_modal_price, min_modal_price, max_modal_price, refreshed_at)
SELECT commodity_name, state, variety_name, reporting_date, MAX(market_count), MAX(observation_count),
  AVG(CASE WHEN price_rank IN ((market_count + 1) / 2, (market_count + 2) / 2) THEN modal_price END),
  MIN(modal_price), MAX(modal_price), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM one_per_market GROUP BY commodity_name, state, variety_name, reporting_date;

-- 3. Import idempotency, job identifiers and reprocessing lineage.
ALTER TABLE ingestion_jobs ADD COLUMN idempotency_key TEXT;
ALTER TABLE ingestion_jobs ADD COLUMN content_sha256 TEXT;
ALTER TABLE ingestion_jobs ADD COLUMN source_file_name TEXT;
ALTER TABLE ingestion_jobs ADD COLUMN reprocess_of TEXT REFERENCES ingestion_jobs(id);
ALTER TABLE ingestion_jobs ADD COLUMN duplicate_count INTEGER;
ALTER TABLE ingestion_jobs ADD COLUMN corrected_count INTEGER;
-- A key may be reused only after a failed attempt or through an explicit reprocess job.
CREATE UNIQUE INDEX idx_ingestion_jobs_idempotency
  ON ingestion_jobs (source_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND reprocess_of IS NULL AND status != 'failed';

-- 4. Persisted operational errors (scheduled refreshes, archive sync, retention purge).
CREATE TABLE operational_errors (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  component TEXT NOT NULL CHECK (component IN ('scheduled', 'archive', 'retention', 'import', 'summary_cache')),
  source_key TEXT,
  message TEXT NOT NULL,
  detail_json TEXT
);
CREATE INDEX idx_operational_errors_recent ON operational_errors (occurred_at);

-- 5. Archive registry. R2 is optional: without a binding, existing inline D1 evidence is registered
-- with storage 'd1_inline' (hash + size + MIME) so the evidence inventory is complete either way.
CREATE TABLE archive_objects (
  id TEXT PRIMARY KEY,
  storage TEXT NOT NULL CHECK (storage IN ('r2', 'd1_inline')),
  object_key TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  mime_type TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'source_csv', 'source_html', 'source_json', 'source_pdf', 'imported_report', 'quality_image', 'source_payload', 'temporary_processing'
  )),
  source_key TEXT,
  related_table TEXT,
  related_id TEXT,
  original_file_name TEXT,
  retention_class TEXT NOT NULL CHECK (retention_class IN ('evidence', 'temporary')),
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'stored' CHECK (status IN ('stored', 'missing', 'hash_mismatch', 'expired')),
  last_verified_at TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((retention_class = 'temporary') = (category = 'temporary_processing')),
  CHECK (retention_class = 'evidence' OR expires_at IS NOT NULL),
  CHECK (status != 'expired' OR retention_class = 'temporary'),
  UNIQUE (storage, object_key, related_table, related_id)
);
CREATE INDEX idx_archive_related ON archive_objects (related_table, related_id, storage);
CREATE INDEX idx_archive_category ON archive_objects (category, source_key, created_at);
CREATE INDEX idx_archive_sha ON archive_objects (sha256);
CREATE INDEX idx_archive_temporary ON archive_objects (expires_at) WHERE retention_class = 'temporary' AND status = 'stored';

CREATE TRIGGER archive_objects_no_delete BEFORE DELETE ON archive_objects
BEGIN SELECT RAISE(ABORT, 'Archive registry rows are permanent; mark temporary objects expired instead'); END;
CREATE TRIGGER archive_objects_identity_immutable
BEFORE UPDATE OF id, storage, object_key, sha256, size_bytes, mime_type, category, source_key, related_table, related_id,
  original_file_name, retention_class, created_at ON archive_objects
BEGIN SELECT RAISE(ABORT, 'Archive object identity and hash are immutable'); END;

-- 6. Evidence-retention guards: historical evidence and audit rows can never be deleted.
CREATE TRIGGER observations_no_delete BEFORE DELETE ON market_price_observations
BEGIN SELECT RAISE(ABORT, 'Market observations are retained evidence; supersede or reject instead'); END;
CREATE TRIGGER source_record_versions_immutable BEFORE UPDATE ON source_record_versions
BEGIN SELECT RAISE(ABORT, 'Source record versions are immutable'); END;
CREATE TRIGGER source_record_versions_no_delete BEFORE DELETE ON source_record_versions
BEGIN SELECT RAISE(ABORT, 'Source record versions are immutable'); END;
CREATE TRIGGER observation_reviews_immutable BEFORE UPDATE ON observation_reviews
BEGIN SELECT RAISE(ABORT, 'Review audit rows are immutable'); END;
CREATE TRIGGER observation_reviews_no_delete BEFORE DELETE ON observation_reviews
BEGIN SELECT RAISE(ABORT, 'Review audit rows are immutable'); END;
CREATE TRIGGER monthly_price_versions_immutable BEFORE UPDATE ON monthly_price_versions
BEGIN SELECT RAISE(ABORT, 'Monthly price versions are immutable'); END;
CREATE TRIGGER monthly_price_versions_no_delete BEFORE DELETE ON monthly_price_versions
BEGIN SELECT RAISE(ABORT, 'Monthly price versions are immutable'); END;
CREATE TRIGGER cooperative_quotes_no_delete BEFORE DELETE ON cooperative_quotes
BEGIN SELECT RAISE(ABORT, 'Cooperative quotations are retained evidence; supersede instead'); END;
CREATE TRIGGER cooperative_fetches_no_delete BEFORE DELETE ON cooperative_fetches
BEGIN SELECT RAISE(ABORT, 'Cooperative fetch records are retained evidence'); END;
CREATE TRIGGER monthly_refresh_runs_no_delete BEFORE DELETE ON monthly_refresh_runs
BEGIN SELECT RAISE(ABORT, 'Monthly refresh runs are retained evidence'); END;
CREATE TRIGGER ingestion_jobs_no_delete BEFORE DELETE ON ingestion_jobs
BEGIN SELECT RAISE(ABORT, 'Ingestion jobs are retained audit records'); END;
CREATE TRIGGER ingestion_job_logs_immutable BEFORE UPDATE ON ingestion_job_logs
BEGIN SELECT RAISE(ABORT, 'Ingestion job logs are immutable'); END;
CREATE TRIGGER ingestion_job_logs_no_delete BEFORE DELETE ON ingestion_job_logs
BEGIN SELECT RAISE(ABORT, 'Ingestion job logs are immutable'); END;
CREATE TRIGGER operational_errors_no_delete BEFORE DELETE ON operational_errors
BEGIN SELECT RAISE(ABORT, 'Operational error logs are retained'); END;
-- An inline snapshot may only be cleared after a verified R2 copy with the same hash is registered.
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
CREATE TRIGGER monthly_report_offload_guard
BEFORE UPDATE OF raw_report ON monthly_refresh_runs
WHEN OLD.raw_report IS NOT NULL AND (NEW.raw_report IS NULL OR NEW.raw_report != OLD.raw_report) AND (NEW.raw_report IS NOT NULL OR NOT EXISTS (
  SELECT 1 FROM archive_objects a WHERE a.related_table = 'monthly_refresh_runs' AND a.related_id = OLD.id
    AND a.storage = 'r2' AND a.status = 'stored'))
BEGIN SELECT RAISE(ABORT, 'Monthly raw reports are immutable; clear only after a verified R2 copy exists'); END;

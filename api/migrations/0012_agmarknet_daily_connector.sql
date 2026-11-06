-- AGMARKNET current-daily connector (data.gov.in resource 9ef84268-d588-465a-a308-a864a43d0070).
-- Additive only: existing observations keep NULL in the new provenance columns.
ALTER TABLE market_price_observations ADD COLUMN grade TEXT;
ALTER TABLE market_price_observations ADD COLUMN source_resource_id TEXT;
ALTER TABLE market_price_observations ADD COLUMN platform_fetched_at TEXT;

CREATE TABLE source_ingestion_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  resource_id TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('daily', 'backfill', 'csv', 'replay')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'completed_with_rejections', 'no_data', 'failed')),
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  source_updated_at TEXT,
  request_filters TEXT NOT NULL DEFAULT '{}',
  source_total INTEGER,
  fetched_count INTEGER NOT NULL DEFAULT 0 CHECK (fetched_count >= 0),
  out_of_scope_count INTEGER NOT NULL DEFAULT 0 CHECK (out_of_scope_count >= 0),
  accepted_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  review_required_count INTEGER NOT NULL DEFAULT 0 CHECK (review_required_count >= 0),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  inserted_count INTEGER NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  corrected_count INTEGER NOT NULL DEFAULT 0 CHECK (corrected_count >= 0),
  market_count INTEGER NOT NULL DEFAULT 0 CHECK (market_count >= 0),
  reporting_dates TEXT NOT NULL DEFAULT '[]',
  import_job_ids TEXT NOT NULL DEFAULT '[]',
  rejected_sample TEXT NOT NULL DEFAULT '[]',
  error_message TEXT,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_source_runs_source_completed ON source_ingestion_runs(source_id, completed_at);

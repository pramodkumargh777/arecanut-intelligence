CREATE TABLE cooperative_fetches (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL CHECK (source_key IN ('mamcos', 'tss')),
  source_url TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  error_message TEXT,
  raw_snapshot TEXT,
  received_count INTEGER,
  inserted_count INTEGER
);
CREATE TABLE cooperative_quotes (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL CHECK (source_key IN ('mamcos', 'tss')),
  branch TEXT NOT NULL,
  reporting_date TEXT NOT NULL,
  variety TEXT NOT NULL,
  minimum_price REAL,
  maximum_price REAL,
  average_price REAL,
  price_type TEXT NOT NULL CHECK (price_type = 'reported_average'),
  price_unit TEXT NOT NULL CHECK (price_unit = 'INR/quintal'),
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  fetch_id TEXT NOT NULL REFERENCES cooperative_fetches(id),
  raw_record TEXT NOT NULL,
  validation_message TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'invalid', 'verified', 'rejected', 'superseded'))
);
CREATE UNIQUE INDEX cooperative_current ON cooperative_quotes(source_key, branch, reporting_date, variety)
  WHERE status != 'superseded';
CREATE INDEX cooperative_date ON cooperative_quotes(source_key, status, reporting_date, variety);
CREATE TABLE cooperative_reviews (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES cooperative_quotes(id),
  action TEXT NOT NULL CHECK (action IN ('approve', 'reject')),
  reviewer TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  previous_status TEXT NOT NULL
);
CREATE TRIGGER cooperative_verify_guard
BEFORE UPDATE ON cooperative_quotes
WHEN NEW.status = 'verified' AND (
  NEW.minimum_price IS NULL OR NEW.maximum_price IS NULL OR NEW.average_price IS NULL
  OR NEW.minimum_price <= 0 OR NEW.average_price < NEW.minimum_price OR NEW.average_price > NEW.maximum_price
  OR NEW.variety = '' OR NEW.reporting_date > date('now'))
BEGIN
  SELECT RAISE(ABORT, 'Invalid cooperative quotation cannot be published');
END;

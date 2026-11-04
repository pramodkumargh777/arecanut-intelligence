CREATE TABLE monthly_refresh_runs (
  id TEXT PRIMARY KEY,
  reporting_month TEXT NOT NULL,
  state TEXT NOT NULL,
  source_url TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  record_count INTEGER,
  error_message TEXT,
  raw_report TEXT
);

CREATE TABLE monthly_variety_prices (
  reporting_month TEXT NOT NULL,
  state TEXT NOT NULL,
  variety_name TEXT NOT NULL,
  weighted_price REAL CHECK (weighted_price IS NULL OR weighted_price >= 0),
  price_unit TEXT NOT NULL CHECK (price_unit = 'INR/quintal'),
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  refresh_run_id TEXT NOT NULL REFERENCES monthly_refresh_runs(id),
  PRIMARY KEY (reporting_month, state, variety_name)
);

CREATE INDEX monthly_refresh_status ON monthly_refresh_runs(state, started_at DESC);

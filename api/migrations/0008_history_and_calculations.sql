CREATE TABLE monthly_price_versions (
  refresh_run_id TEXT NOT NULL REFERENCES monthly_refresh_runs(id),
  reporting_month TEXT NOT NULL,
  state TEXT NOT NULL,
  variety_name TEXT NOT NULL,
  weighted_price REAL,
  price_unit TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (refresh_run_id, variety_name)
);
INSERT INTO monthly_price_versions
SELECT refresh_run_id, reporting_month, state, variety_name, weighted_price, price_unit, source_url, fetched_at
FROM monthly_variety_prices;
CREATE INDEX monthly_versions_lookup ON monthly_price_versions(state,variety_name,reporting_month,fetched_at);

CREATE TABLE decision_calculations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  price_snapshot_json TEXT NOT NULL,
  results_json TEXT NOT NULL,
  formula_version TEXT NOT NULL
);

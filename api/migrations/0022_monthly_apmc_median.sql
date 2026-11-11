-- Long-run monthly series built from AGMARKNET daily APMC modal prices (2014 onward), kept apart from the monthly
-- report (monthly_variety_prices, an arrival-weighted state average). The daily rows stay as files in
-- data-platform/forecasting/daily_archive/; only these monthly values are stored. Rule: each market's mean daily
-- modal for the month, then the median across at least 2 markets (data-platform/forecasting/daily_monthly.py).
-- Loaded by `python -m forecasting daily-monthly-sql`, which replaces every row in one file. See docs/AGMARKNET_HISTORY.md.
CREATE TABLE IF NOT EXISTS monthly_apmc_prices (
  state TEXT NOT NULL,
  reporting_month TEXT NOT NULL,
  variety_name TEXT NOT NULL,
  modal_median REAL NOT NULL CHECK (modal_median > 0),
  markets INTEGER NOT NULL,
  market_days INTEGER NOT NULL,
  data_version TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (state, variety_name, reporting_month)
);

-- One row per variety: how closely the series follows the monthly report where both exist (2021 onward), and whether
-- it passes the fixed rule for pages to use it in place of the report (tracks_reports = 1).
CREATE TABLE IF NOT EXISTS monthly_apmc_series (
  state TEXT NOT NULL,
  variety_name TEXT NOT NULL,
  first_month TEXT NOT NULL,
  last_month TEXT NOT NULL,
  months INTEGER NOT NULL,
  compared_months INTEGER NOT NULL,
  median_abs_gap_pct REAL,
  same_direction_pct REAL,
  move_correlation REAL,
  tracks_reports INTEGER NOT NULL CHECK (tracks_reports IN (0, 1)),
  data_version TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (state, variety_name)
);

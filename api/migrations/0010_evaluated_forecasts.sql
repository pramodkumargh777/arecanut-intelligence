CREATE TABLE forecast_snapshots (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state = 'Karnataka'),
  variety_name TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  formula_version TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  results_json TEXT NOT NULL
);
CREATE INDEX forecast_snapshot_latest ON forecast_snapshots(state, variety_name, evaluated_at DESC, id DESC);
CREATE TRIGGER forecast_snapshot_no_update BEFORE UPDATE ON forecast_snapshots
BEGIN SELECT RAISE(ABORT, 'Forecast snapshots are immutable'); END;
CREATE TRIGGER forecast_snapshot_no_delete BEFORE DELETE ON forecast_snapshots
BEGIN SELECT RAISE(ABORT, 'Forecast snapshots are immutable'); END;

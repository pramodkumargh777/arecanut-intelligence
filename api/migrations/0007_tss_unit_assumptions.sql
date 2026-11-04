ALTER TABLE cooperative_quotes ADD COLUMN unit_status TEXT NOT NULL DEFAULT 'source_confirmed'
  CHECK (unit_status IN ('source_confirmed', 'assumed'));
ALTER TABLE cooperative_quotes ADD COLUMN normal_price REAL;
ALTER TABLE cooperative_fetches ADD COLUMN excluded_count INTEGER NOT NULL DEFAULT 0;

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

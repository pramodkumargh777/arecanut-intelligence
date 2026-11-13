-- Why the automatic check left a quotation for a person (src/cooperative-auto-publish.ts). Written each time the check
-- holds a row and cleared when it passes, so the daily held-rates alert (.github/workflows/held-rates-alert.yml) and
-- the review queue can say why without re-running the check. NULL on a pending row means the check has not judged it,
-- for example a backfill older than AUTO_PUBLISH_MAX_AGE_DAYS. Price columns stay immutable (cooperative_raw_immutable).
ALTER TABLE cooperative_quotes ADD COLUMN hold_reason TEXT;
ALTER TABLE cooperative_quotes ADD COLUMN held_at TEXT;

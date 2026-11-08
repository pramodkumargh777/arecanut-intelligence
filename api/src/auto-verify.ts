/**
 * Automatic verification of AGMARKNET current-daily observations (AGMARKNET_DAILY_AUTO_VERIFY="true").
 *
 * A row is verified only when it passed every connector check (status 'validated', no validation message), satisfies
 * the verified-price invariants the database enforces, and no other verified row holds its market, date, variety and
 * grade. Flagged rows ('review_required') and reviewer decisions are never touched. Each approval is written to
 * observation_reviews under AGMARKNET_DAILY_REVIEWER, and the market is verified as a manual approval would.
 *
 * Set-based: three statements per pass whatever the row count, so it fits the D1 query limit of Workers Free.
 */
export const AGMARKNET_DAILY_REVIEWER = "auto-validation-daily-v1";
export const AGMARKNET_DAILY_SOURCE = "agmarknet";

const ELIGIBLE = `o.source_id = ? AND o.validation_status = 'validated' AND o.validation_message IS NULL
  AND o.minimum_price <= o.modal_price AND o.modal_price <= o.maximum_price AND o.reporting_date <= date('now')
  AND o.price_unit = 'INR/quintal'
  AND NOT EXISTS (SELECT 1 FROM market_price_observations other
    WHERE other.id != o.id AND other.market_id = o.market_id AND other.reporting_date = o.reporting_date
      AND other.variety_name = o.variety_name AND COALESCE(other.grade, '') = COALESCE(o.grade, '')
      AND other.validation_status = 'verified')`;

/**
 * Statements for one verification pass over a source's pending rows, optionally limited to one import job.
 * Run them together in one batch; the first statement's meta.changes is the number of rows verified (the reviews
 * table has no triggers, so D1's count is exact).
 */
export function autoVerifyStatements(db: D1Database, sourceId: string, options: { jobId?: string; passId?: string } = {}) {
  // The review timestamp doubles as this pass's marker, so the following statements act on exactly the rows it
  // approved. SQLite timestamp format, with three random extra fractional digits to keep passes distinct.
  const passId = options.passId ?? `${new Date().toISOString().replace("T", " ").replace("Z", "")}${String(crypto.getRandomValues(new Uint16Array(1))[0] % 1000).padStart(3, "0")}`;
  const jobFilter = options.jobId ? " AND o.ingestion_job_id = ?" : "";
  const eligibleValues = options.jobId ? [sourceId, options.jobId] : [sourceId];
  return [
    db.prepare(`INSERT INTO observation_reviews (id, observation_id, action, reviewer, reviewed_at, previous_status, validation_message)
      SELECT lower(hex(randomblob(16))), o.id, 'approve', ?, ?, o.validation_status, NULL
      FROM market_price_observations o WHERE ${ELIGIBLE}${jobFilter}`)
      .bind(AGMARKNET_DAILY_REVIEWER, passId, ...eligibleValues),
    db.prepare(`UPDATE market_price_observations SET validation_status = 'verified'
      WHERE validation_status = 'validated' AND id IN (
        SELECT observation_id FROM observation_reviews WHERE reviewer = ? AND reviewed_at = ?)`)
      .bind(AGMARKNET_DAILY_REVIEWER, passId),
    db.prepare(`UPDATE markets SET mapping_status = 'verified' WHERE mapping_status = 'unverified' AND id IN (
        SELECT o.market_id FROM market_price_observations o JOIN observation_reviews r ON r.observation_id = o.id
        WHERE r.reviewer = ? AND r.reviewed_at = ?)`)
      .bind(AGMARKNET_DAILY_REVIEWER, passId),
  ];
}

/** Verifies every eligible pending current-daily row, e.g. rows imported before auto-verification was switched on. */
export async function autoVerifyPendingDaily(db: D1Database): Promise<number> {
  const source = await db.prepare("SELECT id FROM data_sources WHERE source_key = ?").bind(AGMARKNET_DAILY_SOURCE).first<{ id: string }>();
  if (!source) return 0;
  const results = await db.batch(autoVerifyStatements(db, source.id));
  return results[0].meta.changes;
}

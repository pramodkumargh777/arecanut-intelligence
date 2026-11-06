/**
 * Publishes scheduled cooperative quotations that pass every check, so prices reach readers the same day. Anything
 * unusual stays in the Data quality queue for a person. A price is only published as the source reported it, and each
 * automatic approval is written to cooperative_reviews under its own reviewer name.
 */
import { calendarDateToTime, calendarTodayIST, DAY_MS } from "../../shared/dates";
import type { CooperativeSource } from "./cooperative";
import { publishableUnit } from "./cooperative-units";
import { median } from "./domain/analytics";

export const AUTO_REVIEWER = "auto-validation-v1";
/** A branch average further than this from the variety's recent median waits for a person. */
export const AUTO_PUBLISH_MAX_DEVIATION = 0.2;
/** With fewer recent quotes there is no reliable "normal" to compare against, as with a newly seen variety. */
export const AUTO_PUBLISH_MIN_REFERENCE = 3;
export const AUTO_PUBLISH_LOOKBACK_DAYS = 30;
const MAX_ROWS_PER_RUN = 200;
const STATEMENTS_PER_BATCH = 100;
/**
 * The first two record the operator's unit decision (migration 0020). TUMCOS never reports a variety, so that flag is on
 * all its rows, and readers are told so wherever its rate appears. Every other flag needs a person.
 */
const ACCEPTED_FLAGS = new Set(["declared_unit_conflicts_with_magnitude", "unit_operator_assumed", "variety_not_reported"]);

export type PendingQuote = {
  id: string; commodity: string; branch: string; reporting_date: string; variety: string;
  minimum_price: number | null; maximum_price: number | null; average_price: number | null;
  price_unit: string; unit_status: string; validation_message: string | null; review_flags: string | null;
};

/** Why a quotation must wait for a person, or null when it can be published. */
export function holdReason(row: PendingQuote, referenceMedian: number | null, today: string): string | null {
  if (row.validation_message) return "failed source validation";
  const { minimum_price: minimum, maximum_price: maximum, average_price: average } = row;
  if (minimum === null || maximum === null || average === null || minimum <= 0 || average < minimum || average > maximum) return "incomplete or inconsistent price range";
  if (row.reporting_date > today) return "future reporting date";
  if (!publishableUnit(row)) return "price unit not confirmed";
  const flags: string[] = row.review_flags ? JSON.parse(row.review_flags) : [];
  const unaccepted = flags.filter((flag) => !ACCEPTED_FLAGS.has(flag));
  if (unaccepted.length) return `review flag: ${unaccepted.join(", ")}`;
  if (referenceMedian === null) return "too few recent quotes to compare against";
  if (Math.abs(average - referenceMedian) / referenceMedian > AUTO_PUBLISH_MAX_DEVIATION) return `average ${average} is more than ${AUTO_PUBLISH_MAX_DEVIATION * 100}% from the recent median ${referenceMedian}`;
  return null;
}

export async function autoPublishPending(db: D1Database, source: CooperativeSource, now = new Date()) {
  const today = calendarTodayIST(now);
  const cutoff = new Date(calendarDateToTime(today) - AUTO_PUBLISH_LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);
  const { results: pending } = await db.prepare(`SELECT id,commodity,branch,reporting_date,variety,minimum_price,maximum_price,average_price,
      price_unit,unit_status,validation_message,review_flags FROM cooperative_quotes
    WHERE source_key=? AND status='pending' AND reporting_date>=? ORDER BY reporting_date,id LIMIT ?`).bind(source, cutoff, MAX_ROWS_PER_RUN).all<PendingQuote>();
  if (!pending.length) return { published: 0, held: [] as { id: string; reason: string }[] };
  // Pending rows count towards the median so a new source can start, and one bad row cannot move a median of three or more.
  const { results: recent } = await db.prepare(`SELECT commodity,variety,average_price FROM cooperative_quotes
    WHERE source_key=? AND status IN ('verified','pending') AND validation_message IS NULL AND average_price IS NOT NULL AND reporting_date>=?`)
    .bind(source, cutoff).all<{ commodity: string; variety: string; average_price: number }>();
  const byVariety = new Map<string, number[]>();
  for (const row of recent) {
    const key = `${row.commodity}|${row.variety}`;
    byVariety.set(key, [...(byVariety.get(key) ?? []), row.average_price]);
  }
  const held: { id: string; reason: string }[] = [];
  const statements: D1PreparedStatement[] = [];
  const reviewedAt = now.toISOString();
  for (const row of pending) {
    const values = byVariety.get(`${row.commodity}|${row.variety}`) ?? [];
    const reference = values.length >= AUTO_PUBLISH_MIN_REFERENCE ? median(values) : null;
    const reason = holdReason(row, reference, today);
    if (reason) { held.push({ id: row.id, reason }); continue; }
    // Checked inside the UPDATE, as in manual review: a different verified price for this branch and date blocks publication.
    statements.push(
      db.prepare(`UPDATE cooperative_quotes SET status='verified' WHERE id=? AND status='pending' AND NOT EXISTS (
          SELECT 1 FROM cooperative_quotes other WHERE other.id!=? AND other.source_key=? AND other.commodity=? AND other.branch=?
            AND other.reporting_date=? AND other.variety=? AND other.status='verified' AND other.average_price!=?)`)
        .bind(row.id, row.id, source, row.commodity, row.branch, row.reporting_date, row.variety, row.average_price),
      db.prepare(`INSERT INTO cooperative_reviews (id,quote_id,action,reviewer,reviewed_at,previous_status,new_status)
          SELECT ?,?,'approve',?,?,'pending','verified' WHERE changes()=1`)
        .bind(crypto.randomUUID(), row.id, AUTO_REVIEWER, reviewedAt),
    );
  }
  let published = 0;
  for (let start = 0; start < statements.length; start += STATEMENTS_PER_BATCH) {
    const results = await db.batch(statements.slice(start, start + STATEMENTS_PER_BATCH));
    published += results.filter((_, index) => index % 2 === 0).reduce((sum, result) => sum + result.meta.changes, 0);
  }
  return { published, held };
}

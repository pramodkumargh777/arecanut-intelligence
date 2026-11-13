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
/**
 * How far a branch average may sit from its reference before it waits for a person. The band starts at 20% and widens
 * for grades whose prices naturally swing (fresh nut, sippe, koka), measured from their own recent spread, but never
 * past 50%: a price half or double its usual level is almost always a typo or a unit slip, whatever the grade.
 */
export const AUTO_PUBLISH_MAX_DEVIATION = 0.2;
export const AUTO_PUBLISH_HARD_LIMIT = 0.5;
/** Robust spread multiplier: 3.5 scaled median absolute deviations (about 3.5 standard deviations for normal data). */
const SPREAD_MULTIPLIER = 3.5 * 1.4826;
/** With fewer recent quotes there is no reliable "normal", as with a newly seen variety, so the deviation check is skipped. */
export const AUTO_PUBLISH_MIN_REFERENCE = 3;
/**
 * Each quotation is compared with prices within AUTO_PUBLISH_LOOKBACK_DAYS either side of its own reporting date, so a
 * backfilled October rate is judged against October prices (including the days after it), and today's rate against the
 * last month, as nothing later exists yet.
 */
export const AUTO_PUBLISH_LOOKBACK_DAYS = 30;
/** Older quotations (a backfill reaching back further than a year) are not judged automatically and wait for a person. */
export const AUTO_PUBLISH_MAX_AGE_DAYS = 366;
/** Pending rows judged per run (newest first), and the most a run publishes, so a large backfill spreads over runs. */
const MAX_ROWS_EVALUATED = 1000;
const MAX_ROWS_PER_RUN = 200;
/**
 * A row still held this many days after it was first held is rejected automatically, with its reason kept, so the queue
 * empties itself and nothing doubtful is ever published. In practice these are odd low-grade lots (₹250 fresh kole).
 */
export const AUTO_REJECT_AFTER_DAYS = 14;
export const CONFLICT_REASON = "a different price is already published for this branch and date";
const STATEMENTS_PER_BATCH = 100;
/**
 * The first two record the operator's unit decision (migration 0020). TUMCOS never reports a variety, so that flag is on
 * all its rows, and readers are told so wherever its rate appears. Every other flag needs a person.
 */
const ACCEPTED_FLAGS = new Set(["declared_unit_conflicts_with_magnitude", "unit_operator_assumed", "variety_not_reported"]);

/** The reference a quotation is compared with: a median, and the deviation allowed from it. */
export type Reference = { median: number; tolerance: number; basis: "branch" | "variety" };

/** Median and allowed deviation for a set of recent averages, or null with too few to judge by. */
export function referenceFor(values: number[], basis: Reference["basis"]): Reference | null {
  if (values.length < AUTO_PUBLISH_MIN_REFERENCE) return null;
  const middle = median(values)!;
  const spread = median(values.map((value) => Math.abs(value - middle)))! / middle;
  return { median: middle, basis, tolerance: Math.min(AUTO_PUBLISH_HARD_LIMIT, Math.max(AUTO_PUBLISH_MAX_DEVIATION, SPREAD_MULTIPLIER * spread)) };
}

export type PendingQuote = {
  id: string; commodity: string; branch: string; reporting_date: string; variety: string;
  minimum_price: number | null; maximum_price: number | null; average_price: number | null;
  price_unit: string; unit_status: string; validation_message: string | null; review_flags: string | null;
};

/** Why a quotation must wait for a person, or null when it can be published. */
export function holdReason(row: PendingQuote, reference: Reference | number | null, today: string): string | null {
  if (row.validation_message) return "failed source validation";
  const { minimum_price: minimum, maximum_price: maximum, average_price: average } = row;
  if (minimum === null || maximum === null || average === null || minimum <= 0 || average < minimum || average > maximum) return "incomplete or inconsistent price range";
  if (row.reporting_date > today) return "future reporting date";
  if (!publishableUnit(row)) return "price unit not confirmed";
  const flags: string[] = row.review_flags ? JSON.parse(row.review_flags) : [];
  const unaccepted = flags.filter((flag) => !ACCEPTED_FLAGS.has(flag));
  if (unaccepted.length) return `review flag: ${unaccepted.join(", ")}`;
  // A newly seen variety (fewer than AUTO_PUBLISH_MIN_REFERENCE recent quotes) has no "normal" to compare against, so it
  // publishes on the checks above alone; the 20% comparison starts once there is enough history.
  const judged = typeof reference === "number" ? { median: reference, tolerance: AUTO_PUBLISH_MAX_DEVIATION, basis: "variety" as const } : reference;
  if (judged && Math.abs(average - judged.median) / judged.median > judged.tolerance) {
    return `average ${average} is more than ${Math.round(judged.tolerance * 100)}% from the recent ${judged.basis === "branch" ? "branch" : "variety"} median ${judged.median}`;
  }
  return null;
}

const dayBefore = (date: string, days: number) => new Date(calendarDateToTime(date) - days * DAY_MS).toISOString().slice(0, 10);

/**
 * What a quotation is judged against, over the window around its own date: the same branch's recent
 * averages for that variety when there are enough (branches differ, e.g. Yellapur kole sells below Sirsi kole), else
 * the variety's averages across branches, else nothing (a newly seen grade).
 */
function referenceOn(series: { branch: string; date: string; price: number }[] | undefined, branch: string, date: string, cache: Map<string, Reference | null>, key: string) {
  const cacheKey = `${key}|${branch}|${date}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;
  const from = dayBefore(date, AUTO_PUBLISH_LOOKBACK_DAYS), to = dayBefore(date, -AUTO_PUBLISH_LOOKBACK_DAYS);
  const window = (series ?? []).filter((row) => row.date >= from && row.date <= to);
  const result = referenceFor(window.filter((row) => row.branch === branch).map((row) => row.price), "branch")
    ?? referenceFor(window.map((row) => row.price), "variety");
  cache.set(cacheKey, result);
  return result;
}

export async function autoPublishPending(db: D1Database, source: CooperativeSource, now = new Date()) {
  const today = calendarTodayIST(now);
  const oldest = dayBefore(today, AUTO_PUBLISH_MAX_AGE_DAYS);
  // Newest first: today's rates go out at once even while a backfill is still being worked through.
  const { results: pending } = await db.prepare(`SELECT id,commodity,branch,reporting_date,variety,minimum_price,maximum_price,average_price,
      price_unit,unit_status,validation_message,review_flags,hold_reason,held_at FROM cooperative_quotes
    WHERE source_key=? AND status='pending' AND reporting_date>=? ORDER BY reporting_date DESC,id LIMIT ?`)
    .bind(source, oldest, MAX_ROWS_EVALUATED).all<PendingQuote & { hold_reason: string | null; held_at: string | null }>();
  if (!pending.length) return { published: 0, held: [] as { id: string; reason: string }[], rejected: 0 };
  const earliest = pending.reduce((min, row) => row.reporting_date < min ? row.reporting_date : min, today);
  // Pending rows count towards the median so a new source can start, and one bad row cannot move a median of three or more.
  const { results: recent } = await db.prepare(`SELECT commodity,variety,branch,reporting_date,average_price FROM cooperative_quotes
    WHERE source_key=? AND status IN ('verified','pending') AND validation_message IS NULL AND average_price IS NOT NULL AND reporting_date BETWEEN ? AND ?`)
    .bind(source, dayBefore(earliest, AUTO_PUBLISH_LOOKBACK_DAYS), today).all<{ commodity: string; variety: string; branch: string; reporting_date: string; average_price: number }>();
  const byVariety = new Map<string, { branch: string; date: string; price: number }[]>();
  for (const row of recent) {
    const key = `${row.commodity}|${row.variety}`;
    byVariety.set(key, [...(byVariety.get(key) ?? []), { branch: row.branch, date: row.reporting_date, price: row.average_price }]);
  }
  const references = new Map<string, Reference | null>();
  const held: { id: string; reason: string }[] = [];
  const candidates: (PendingQuote & { hold_reason: string | null; held_at: string | null })[] = [];
  for (const row of pending) {
    const key = `${row.commodity}|${row.variety}`;
    const reason = holdReason(row, referenceOn(byVariety.get(key), row.branch, row.reporting_date, references, key), today);
    if (reason) held.push({ id: row.id, reason });
    else if (candidates.length < MAX_ROWS_PER_RUN) candidates.push(row);
  }
  const reviewedAt = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const row of candidates) {
    // Checked inside the UPDATE, as in manual review: a different verified price for this branch and date blocks publication.
    statements.push(
      db.prepare(`UPDATE cooperative_quotes SET status='verified', hold_reason=NULL, held_at=NULL WHERE id=? AND status='pending' AND NOT EXISTS (
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
    results.forEach((result, index) => {
      if (index % 2 !== 0) return;
      if (result.meta.changes) published += result.meta.changes;
      else held.push({ id: candidates[(start + index) / 2].id, reason: CONFLICT_REASON });
    });
  }
  // Record why each held row waits, so the alert and the review queue can say so. Only changed reasons are written, and
  // held_at keeps the first time the row was held, so a reason whose median shifts a little does not restart the clock.
  const byId = new Map(pending.map((row) => [row.id, row]));
  const expiry = new Date(now.getTime() - AUTO_REJECT_AFTER_DAYS * DAY_MS).toISOString();
  const notes: D1PreparedStatement[] = [];
  let rejected = 0;
  for (const row of held) {
    const before = byId.get(row.id);
    if (before?.held_at && before.held_at <= expiry) {
      rejected += 1;
      notes.push(
        db.prepare("UPDATE cooperative_quotes SET status='rejected', hold_reason=? WHERE id=? AND status='pending'").bind(row.reason, row.id),
        db.prepare(`INSERT INTO cooperative_reviews (id,quote_id,action,reviewer,reviewed_at,previous_status,new_status)
            SELECT ?,?,'reject',?,?,'pending','rejected' WHERE changes()=1`).bind(crypto.randomUUID(), row.id, AUTO_REVIEWER, reviewedAt),
      );
    } else if (before?.hold_reason !== row.reason) {
      notes.push(db.prepare("UPDATE cooperative_quotes SET hold_reason=?, held_at=COALESCE(held_at, ?) WHERE id=? AND status='pending'").bind(row.reason, reviewedAt, row.id));
    }
  }
  for (let start = 0; start < notes.length; start += STATEMENTS_PER_BATCH) await db.batch(notes.slice(start, start + STATEMENTS_PER_BATCH));
  return { published, held: held.filter((row) => !(byId.get(row.id)?.held_at && byId.get(row.id)!.held_at! <= expiry)), rejected };
}

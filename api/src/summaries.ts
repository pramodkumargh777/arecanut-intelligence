/**
 * Derived daily reference cache (market_daily_summaries).
 *
 * Each row holds, for one commodity/state/exact variety/reporting date, the median of one verified
 * modal price per verified market (the latest-ingested record per market, ties broken by id) — the
 * same rule as buildReferenceSeries. Coverage gating happens at read time. Triggers from migration
 * 0015 mark affected dates dirty on every write path; readers call refreshDirtySummaries first.
 */
const SUMMARY_SQL = (dateFilter: string) => `
WITH current AS (
  SELECT o.commodity_name, m.state, o.variety_name, o.reporting_date, o.market_id, o.modal_price,
    ROW_NUMBER() OVER (PARTITION BY o.commodity_name, m.state, o.variety_name, o.reporting_date, o.market_id
      ORDER BY o.ingested_at DESC, o.id) AS market_rank,
    COUNT(*) OVER (PARTITION BY o.commodity_name, m.state, o.variety_name, o.reporting_date) AS observation_count
  FROM market_price_observations o JOIN markets m ON m.id = o.market_id
  WHERE o.validation_status = 'verified' AND m.mapping_status = 'verified' AND o.commodity_name = ? AND ${dateFilter}
), one_per_market AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY commodity_name, state, variety_name, reporting_date ORDER BY modal_price) AS price_rank,
    COUNT(*) OVER (PARTITION BY commodity_name, state, variety_name, reporting_date) AS market_count
  FROM current WHERE market_rank = 1
)
INSERT INTO market_daily_summaries (commodity_name, state, variety_name, reporting_date, market_count, observation_count,
  median_modal_price, min_modal_price, max_modal_price, refreshed_at)
SELECT commodity_name, state, variety_name, reporting_date, MAX(market_count), MAX(observation_count),
  AVG(CASE WHEN price_rank IN ((market_count + 1) / 2, (market_count + 2) / 2) THEN modal_price END),
  MIN(modal_price), MAX(modal_price), ?
FROM one_per_market GROUP BY commodity_name, state, variety_name, reporting_date`;

const DIRTY_BATCH = 400;
const MAX_ROUNDS = 25;

/** Recomputes dirty dates for one commodity. Bounded per call; returns the number of dates refreshed. */
export async function refreshDirtySummaries(db: D1Database, commodityName: string): Promise<number> {
  let refreshed = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const dirty = await db.prepare(`SELECT variety_name, reporting_date FROM market_summary_dirty
      WHERE commodity_name = ? ORDER BY variety_name, reporting_date LIMIT ?`).bind(commodityName, DIRTY_BATCH)
      .all<{ variety_name: string; reporting_date: string }>();
    if (!dirty.results.length) return refreshed;
    const keys = JSON.stringify(dirty.results.map((row) => [row.variety_name, row.reporting_date]));
    const inKeys = `(variety_name, reporting_date) IN (SELECT value ->> 0, value ->> 1 FROM json_each(?))`;
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`DELETE FROM market_daily_summaries WHERE commodity_name = ? AND ${inKeys}`).bind(commodityName, keys),
      db.prepare(SUMMARY_SQL(`(o.variety_name, o.reporting_date) IN (SELECT value ->> 0, value ->> 1 FROM json_each(?))`))
        .bind(commodityName, keys, now),
      db.prepare(`DELETE FROM market_summary_dirty WHERE commodity_name = ? AND ${inKeys}`).bind(commodityName, keys),
    ]);
    refreshed += dirty.results.length;
    if (dirty.results.length < DIRTY_BATCH) return refreshed;
  }
  return refreshed;
}

/** Scheduled maintenance: refresh every commodity that has dirty dates. */
export async function refreshAllDirtySummaries(db: D1Database) {
  const dirty = await db.prepare("SELECT DISTINCT commodity_name FROM market_summary_dirty LIMIT 20").all<{ commodity_name: string }>();
  let refreshed = 0;
  for (const row of dirty.results) refreshed += await refreshDirtySummaries(db, row.commodity_name);
  return refreshed;
}

/** Operator-triggered rebuild of a bounded range (reprocessing control). */
export async function rebuildSummaries(db: D1Database, commodityName: string, from: string, to: string, variety?: string) {
  const varietyFilter = variety ? " AND variety_name = ?" : "";
  const deleteValues = variety ? [commodityName, from, to, variety] : [commodityName, from, to];
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`DELETE FROM market_daily_summaries WHERE commodity_name = ? AND reporting_date BETWEEN ? AND ?${varietyFilter}`).bind(...deleteValues),
    db.prepare(SUMMARY_SQL(`o.reporting_date BETWEEN ? AND ?${variety ? " AND o.variety_name = ?" : ""}`)).bind(...deleteValues, now),
    db.prepare(`DELETE FROM market_summary_dirty WHERE commodity_name = ? AND reporting_date BETWEEN ? AND ?${varietyFilter}`).bind(...deleteValues),
  ]);
  return { removed: results[0].meta.changes, written: results[1].meta.changes };
}

export type SummaryRow = {
  reporting_date: string;
  market_count: number;
  observation_count: number;
  median_modal_price: number;
  min_modal_price: number;
  max_modal_price: number;
};

export const MAX_REFERENCE_POINTS = 4000;

type SeriesScope = { commodityName: string; state: string; variety: string; coverage: number };

/** Covered daily reference points (ascending), bounded by MAX_REFERENCE_POINTS most recent points. */
export async function coveredReferenceSeries(db: D1Database, scope: SeriesScope, from?: string, to?: string) {
  await refreshDirtySummaries(db, scope.commodityName);
  const filters = ["commodity_name = ?", "state = ?", "variety_name = ?", "market_count >= ?"];
  const values: (string | number)[] = [scope.commodityName, scope.state, scope.variety, scope.coverage];
  if (from) { filters.push("reporting_date >= ?"); values.push(from); }
  if (to) { filters.push("reporting_date <= ?"); values.push(to); }
  const rows = await db.prepare(`SELECT reporting_date, market_count, median_modal_price FROM market_daily_summaries
    WHERE ${filters.join(" AND ")} ORDER BY reporting_date DESC LIMIT ?`).bind(...values, MAX_REFERENCE_POINTS + 1)
    .all<{ reporting_date: string; market_count: number; median_modal_price: number }>();
  const truncated = rows.results.length > MAX_REFERENCE_POINTS;
  return { data: rows.results.slice(0, MAX_REFERENCE_POINTS).reverse(), truncated };
}

export type OverviewSnapshot = {
  latestDate: string | null;
  latest: { reporting_date: string; median_modal_price: number; market_count: number } | null;
  previous: { reporting_date: string; median_modal_price: number } | null;
  comparable: { market_name: string; modal_price: number; source_name: string }[];
};

/** Overview inputs with at most four small indexed reads instead of loading the full variety history. */
export async function overviewSnapshot(db: D1Database, scope: SeriesScope): Promise<OverviewSnapshot> {
  await refreshDirtySummaries(db, scope.commodityName);
  const base = "FROM market_daily_summaries WHERE commodity_name = ? AND state = ? AND variety_name = ?";
  const keys = [scope.commodityName, scope.state, scope.variety];
  const [latestDateRow, latestRow] = await db.batch<Record<string, string | number | null>>([
    db.prepare(`SELECT MAX(reporting_date) AS reporting_date ${base}`).bind(...keys),
    db.prepare(`SELECT reporting_date, median_modal_price, market_count ${base} AND market_count >= ? ORDER BY reporting_date DESC LIMIT 1`)
      .bind(...keys, scope.coverage),
  ]);
  const latestDate = (latestDateRow.results[0]?.reporting_date as string | null) ?? null;
  if (!latestDate) return { latestDate: null, latest: null, previous: null, comparable: [] };
  const latest = (latestRow.results[0] as OverviewSnapshot["latest"]) ?? null;
  const [previousRow, comparable] = await db.batch<Record<string, string | number | null>>([
    db.prepare(`SELECT reporting_date, median_modal_price ${base} AND market_count >= ? AND reporting_date < ? ORDER BY reporting_date DESC LIMIT 1`)
      .bind(...keys, scope.coverage, latestDate),
    // Same rule as the reference median: one verified record per market, latest ingested, ties by id.
    db.prepare(`WITH ranked AS (
        SELECT m.name AS market_name, o.modal_price, s.name AS source_name, o.ingested_at, o.id,
          ROW_NUMBER() OVER (PARTITION BY o.market_id ORDER BY o.ingested_at DESC, o.id) AS market_rank
        FROM market_price_observations o JOIN markets m ON m.id = o.market_id JOIN data_sources s ON s.id = o.source_id
        WHERE o.validation_status = 'verified' AND m.mapping_status = 'verified' AND o.commodity_name = ? AND m.state = ?
          AND o.variety_name = ? AND o.reporting_date = ?)
      SELECT market_name, modal_price, source_name FROM ranked WHERE market_rank = 1 ORDER BY modal_price, ingested_at DESC, id`)
      .bind(scope.commodityName, scope.state, scope.variety, latestDate),
  ]);
  return {
    latestDate,
    latest,
    previous: (previousRow.results[0] as OverviewSnapshot["previous"]) ?? null,
    comparable: comparable.results as OverviewSnapshot["comparable"],
  };
}

export type ChartInterval = "daily" | "weekly" | "monthly";

function bucketStart(date: string, interval: ChartInterval) {
  if (interval === "daily") return date;
  if (interval === "monthly") return `${date.slice(0, 7)}-01`;
  const day = new Date(`${date}T00:00:00Z`);
  const mondayOffset = (day.getUTCDay() + 6) % 7;
  return new Date(day.valueOf() - mondayOffset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Server-side chart aggregation. Buckets summarize only covered daily reference values that exist;
 * empty buckets are omitted (never interpolated) and withheld dates are counted, not hidden.
 */
export async function referenceChart(db: D1Database, scope: SeriesScope, from: string, to: string, interval: ChartInterval) {
  await refreshDirtySummaries(db, scope.commodityName);
  const rows = await db.prepare(`SELECT reporting_date, market_count, median_modal_price FROM market_daily_summaries
    WHERE commodity_name = ? AND state = ? AND variety_name = ? AND reporting_date BETWEEN ? AND ? ORDER BY reporting_date`)
    .bind(scope.commodityName, scope.state, scope.variety, from, to)
    .all<{ reporting_date: string; market_count: number; median_modal_price: number }>();
  const buckets = new Map<string, { values: number[]; first: string; last: string; minMarkets: number }>();
  let withheld = 0;
  for (const row of rows.results) {
    if (row.market_count < scope.coverage) { withheld += 1; continue; }
    const key = bucketStart(row.reporting_date, interval);
    const bucket = buckets.get(key) ?? { values: [], first: row.reporting_date, last: row.reporting_date, minMarkets: row.market_count };
    bucket.values.push(row.median_modal_price);
    bucket.last = row.reporting_date;
    bucket.minMarkets = Math.min(bucket.minMarkets, row.market_count);
    buckets.set(key, bucket);
  }
  const points = [...buckets.entries()].map(([bucket_start, bucket]) => ({
    bucket_start,
    first_reporting_date: bucket.first,
    last_reporting_date: bucket.last,
    reporting_days: bucket.values.length,
    mean_reference_price: bucket.values.reduce((sum, value) => sum + value, 0) / bucket.values.length,
    min_reference_price: Math.min(...bucket.values),
    max_reference_price: Math.max(...bucket.values),
    min_market_count: bucket.minMarkets,
  }));
  return { points, covered_days: rows.results.length - withheld, withheld_days: withheld };
}

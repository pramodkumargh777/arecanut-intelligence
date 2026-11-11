import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./index";
import { parseMonthlyEvidence, previousMonth, validMonth } from "./monthly";
import { archiveReadMessage, readRelatedText } from "./archive";
import { MONTHLY_ANOMALY_THRESHOLD, MONTHLY_REVIEW_METHOD, monthlyReviewFlags, type ReviewFlag } from "./monthly-quality";
import { calendarTodayIST, shiftCalendarMonth } from "../../shared/dates";

export function monthRange(from: string, to: string) {
  const months: string[] = [];
  for (let month = from; month <= to;) {
    months.push(month);
    const [year, value] = month.split("-").map(Number);
    month = new Date(Date.UTC(year, value, 1)).toISOString().slice(0, 7);
  }
  return months;
}
type Price = { reporting_month: string; weighted_price: number | null; fetched_at: string; source_url: string; refresh_run_id: string; price_unit?: string };
type Run = { reporting_month: string; status: string; error_message: string | null; started_at: string };
export function monthlyAnalytics(from: string, to: string, prices: Price[], reports: string[], runs: Run[]) {
  const byMonth = new Map(prices.map((row) => [row.reporting_month, row]));
  const reportSet = new Set(reports);
  const latestRun = new Map<string, Run>();
  for (const run of runs) if (!latestRun.has(run.reporting_month)) latestRun.set(run.reporting_month, run);
  const months = monthRange(from, to);
  const calculationMonths = monthRange(previousMonth(new Date(`${from}-01T00:00:00Z`), 12), to);
  const points = months.map((month) => {
    const row = byMonth.get(month);
    const index = calculationMonths.indexOf(month);
    const windowMean = (length: number) => {
      if (index + 1 < length) return null;
      const values = calculationMonths.slice(index - length + 1, index + 1).map((value) => byMonth.get(value)?.weighted_price ?? null);
      return values.every((value) => value !== null) ? values.reduce<number>((sum, value) => sum + value!, 0) / length : null;
    };
    const lastYear = `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
    const prior = byMonth.get(lastYear)?.weighted_price ?? null;
    const value = row?.weighted_price ?? null;
    const returns: number[] = [];
    if (index >= 12) {
      const window = calculationMonths.slice(index - 12, index + 1).map((key) => byMonth.get(key)?.weighted_price ?? null);
      if (window.every((price) => price !== null && price > 0)) {
        for (let i = 1; i < window.length; i++) returns.push(Math.log(window[i]! / window[i - 1]!));
      }
    }
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const volatility = returns.length === 12 ? Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 11) * Math.sqrt(12) * 100 : null;
    return {
      reporting_month: month, weighted_price: value,
      price_unit: row?.price_unit ?? "INR/quintal",
      review_flags: row ? monthlyReviewFlags(row, byMonth) : [],
      status: row ? value === null ? "price_missing" : "observed" : reportSet.has(month) ? "variety_missing" : "report_missing",
      fetched_at: row?.fetched_at ?? null, source_url: row?.source_url ?? null, refresh_run_id: row?.refresh_run_id ?? null,
      latest_attempt: latestRun.get(month) ?? null,
      rolling_3: windowMean(3), rolling_12: windowMean(12),
      yoy_percent: value !== null && prior !== null && prior > 0 ? (value / prior - 1) * 100 : null,
      volatility_percent: volatility,
    };
  });
  const completeYears: { year: string; values: number[]; mean: number }[] = [];
  for (const year of [...new Set(months.map((month) => month.slice(0, 4)))]) {
    const keys = monthRange(`${year}-01`, `${year}-12`);
    const values = keys.map((key) => months.includes(key) ? byMonth.get(key)?.weighted_price ?? null : null);
    if (values.every((value) => value !== null && value > 0)) {
      const numbers = values as number[];
      completeYears.push({ year, values: numbers, mean: numbers.reduce((sum, value) => sum + value, 0) / 12 });
    }
  }
  const seasonal = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1, complete_years: completeYears.length,
    index: completeYears.length >= 3 ? completeYears.reduce((sum, year) => sum + year.values[index] / year.mean * 100, 0) / completeYears.length : null,
  }));
  return { points, seasonal, seasonal_years: completeYears.map((year) => year.year),
    expected_months: months.length, observed_months: points.filter((point) => point.status === "observed").length,
    reporting_months: months.filter((month) => reportSet.has(month)).length,
    review_method: MONTHLY_REVIEW_METHOD, anomaly_threshold_percent: MONTHLY_ANOMALY_THRESHOLD * 100,
    flagged_months: points.filter((point) => point.review_flags.length > 0).length };
}

type DailyQuote = { reporting_date: string; average_price: number; fetched_at: string; source_url: string; unit_status: string };
export function aggregateDaily(rows: DailyQuote[], from: string, to: string, interval: "weekly" | "monthly") {
  const day = 86_400_000;
  const result = new Map<string, { period: string; from: string; to: string; values: number[]; dates: Set<string>; fetched_at: string | null; unit_status: string | null }>();
  for (let time = Date.parse(from); time <= Date.parse(to); time += day) {
    const date = new Date(time).toISOString().slice(0, 10);
    const weekday = (new Date(time).getUTCDay() + 6) % 7;
    const period = interval === "monthly" ? date.slice(0, 7) : new Date(time - weekday * day).toISOString().slice(0, 10);
    const bucket = result.get(period) ?? { period, from: date, to: date, values: [], dates: new Set<string>(), fetched_at: null, unit_status: null };
    bucket.to = date;
    result.set(period, bucket);
  }
  for (const row of rows) {
    if (row.reporting_date < from || row.reporting_date > to) continue;
    const time = Date.parse(row.reporting_date);
    const period = interval === "monthly" ? row.reporting_date.slice(0, 7)
      : new Date(time - ((new Date(time).getUTCDay() + 6) % 7) * day).toISOString().slice(0, 10);
    const bucket = result.get(period)!;
    bucket.values.push(row.average_price); bucket.dates.add(row.reporting_date);
    if (!bucket.fetched_at || row.fetched_at > bucket.fetched_at) bucket.fetched_at = row.fetched_at;
    bucket.unit_status = row.unit_status;
  }
  return [...result.values()].map((bucket) => ({
    period: bucket.period, from: bucket.from, to: bucket.to,
    mean_average_price: bucket.values.length ? bucket.values.reduce((sum, value) => sum + value, 0) / bucket.values.length : null,
    minimum_average: bucket.values.length ? Math.min(...bucket.values) : null,
    maximum_average: bucket.values.length ? Math.max(...bucket.values) : null,
    reporting_days: bucket.dates.size, calendar_days: (Date.parse(bucket.to) - Date.parse(bucket.from)) / day + 1,
    fetched_at: bucket.fetched_at, unit_status: bucket.unit_status,
  }));
}

export const REPORT_BASIS = "MONTHLY_STATE_WEIGHTED_AVERAGE";
export const LONG_BASIS = "MONTHLY_APMC_MODAL_MEDIAN";
const LONG_SOURCE_URL = "https://api.data.gov.in/resource/35985678-0d79-46b4-9ed6-6f13308a1d24";
type LongSeries = { tracking: Set<string>; coverage: Map<string, { variety: string; months: number; years: number }>; meta: Map<string, LongMeta> };
type LongMeta = { variety_name: string; first_month: string; last_month: string; compared_months: number; median_abs_gap_pct: number | null;
  same_direction_pct: number | null; move_correlation: number | null; data_version: string; imported_at: string };

/** Months and calendar years with a report price, per variety, so a page can leave out varieties with too little history. */
async function reportCoverage(db: D1Database, state: string) {
  const rows = await db.prepare(`SELECT variety_name, COUNT(DISTINCT CASE WHEN weighted_price IS NOT NULL THEN reporting_month END) AS months,
    COUNT(DISTINCT CASE WHEN weighted_price IS NOT NULL THEN substr(reporting_month, 1, 4) END) AS years
    FROM monthly_variety_prices WHERE state=? GROUP BY variety_name ORDER BY variety_name`).bind(state).all<{ variety_name: string; months: number; years: number }>();
  return rows.results.map(({ variety_name, months, years }) => ({ variety: variety_name, months, years }));
}

/** Varieties whose long series passed the tracking rule and is as recent as their report. Null when the table is missing or empty (migration not applied). */
async function longSeries(db: D1Database, state: string): Promise<LongSeries | null> {
  try {
    const rows = await db.prepare(`SELECT s.*, (SELECT COUNT(DISTINCT substr(p.reporting_month,1,4)) FROM monthly_apmc_prices p
      WHERE p.state=s.state AND p.variety_name=s.variety_name) AS years, s.months FROM monthly_apmc_series s WHERE s.state=? AND s.tracks_reports=1
      -- A series behind the report (not topped up since a newer report arrived) is not used, so pages never go stale.
      AND s.last_month >= COALESCE((SELECT MAX(r.reporting_month) FROM monthly_variety_prices r WHERE r.state=s.state AND r.variety_name=s.variety_name), '')`)
      .bind(state).all<LongMeta & { months: number; years: number }>();
    if (!rows.results.length) return null;
    return { tracking: new Set(rows.results.map((row) => row.variety_name)),
      coverage: new Map(rows.results.map((row) => [row.variety_name, { variety: row.variety_name, months: row.months, years: row.years }])),
      meta: new Map(rows.results.map((row) => [row.variety_name, row])) };
  } catch {
    return null;
  }
}

async function longHistory(db: D1Database, state: string, variety: string, from: string, to: string, long: LongSeries) {
  const meta = long.meta.get(variety)!;
  const rows = await db.prepare(`SELECT reporting_month, modal_median, markets, imported_at, data_version FROM monthly_apmc_prices
    WHERE state=? AND variety_name=? AND reporting_month BETWEEN ? AND ? ORDER BY reporting_month`)
    .bind(state, variety, previousMonth(new Date(`${from}-01T00:00:00Z`), 12), shiftCalendarMonth(to, 1))
    .all<{ reporting_month: string; modal_median: number; markets: number; imported_at: string; data_version: string }>();
  const prices: Price[] = rows.results.map((row) => ({ reporting_month: row.reporting_month, weighted_price: row.modal_median,
    fetched_at: row.imported_at, source_url: LONG_SOURCE_URL, refresh_run_id: `apmc-median:${row.data_version}`, price_unit: "INR/quintal" }));
  const present = rows.results.map((row) => row.reporting_month).filter((month) => month >= from && month <= to);
  const reports = await reportCoverage(db, state);
  const coverage = [...reports.filter((row) => !long.coverage.has(row.variety)), ...long.coverage.values()].sort((a, b) => a.variety.localeCompare(b.variety));
  return { ...monthlyAnalytics(from, to, prices, present, []), variety, state, from, to, varieties: coverage.map((row) => row.variety),
    variety_coverage: coverage, versions: [], basis: LONG_BASIS, long_history_varieties: [...long.tracking],
    long_history: { first_month: meta.first_month, last_month: meta.last_month, compared_months: meta.compared_months,
      median_abs_gap_pct: meta.median_abs_gap_pct, same_direction_pct: meta.same_direction_pct, imported_at: meta.imported_at },
    methodology: "Monthly value: each Karnataka APMC's mean daily modal price for the month (AGMARKNET daily, data.gov.in), then the median across at least 2 markets; months below that are left missing. A different measure from the arrival-weighted monthly report; used only for varieties whose series follows the report closely where both exist (2021 onward: typical gap within 3%, moves in the same direction at least 75% of months). Rolling means, YoY, volatility and seasonality are computed as for the monthly report. Descriptive only, not a forecast.",
  };
}

export const historyRoutes = new Hono<Env>();
historyRoutes.get("/history/monthly", async (c) => {
  const input = z.object({ from: z.string().refine(validMonth), to: z.string().refine(validMonth), variety: z.string().trim().min(1).max(160) })
    .safeParse({ from: c.req.query("from") ?? "2021-01", to: c.req.query("to") ?? previousMonth(new Date()), variety: c.req.query("variety") ?? "Rashi" });
  if (!input.success || input.data.from > input.data.to || input.data.to > previousMonth(new Date())
    || monthRange(input.data.from, input.data.to).length > 240) return c.json({ error: "Select an exact variety and up to 240 completed months in ascending order." }, 400);
  const { to, variety } = input.data, state = c.env.REFERENCE_STATE ?? "Karnataka";
  let { from } = input.data;
  // ?basis=long asks for the 2014+ series built from daily APMC prices, used only for varieties that track the report.
  const long = c.req.query("basis") === "long" ? await longSeries(c.env.DB, state) : null;
  if (long?.tracking.has(variety)) return c.json(await longHistory(c.env.DB, state, variety, input.data.from, to, long));
  // Asked for the longest history but this variety stays on the report: start where the report starts.
  if (c.req.query("basis") === "long") {
    const first = await c.env.DB.prepare("SELECT MIN(reporting_month) AS month FROM monthly_variety_prices WHERE state=?").bind(state).first<{ month: string | null }>();
    if (first?.month && first.month > from && first.month <= to) from = first.month;
  }
  const prices = await c.env.DB.prepare("SELECT * FROM monthly_variety_prices WHERE state=? AND variety_name=? AND reporting_month BETWEEN ? AND ? ORDER BY reporting_month")
    .bind(state, variety, previousMonth(new Date(`${from}-01T00:00:00Z`), 12), shiftCalendarMonth(to, 1)).all<Price>();
  const reports = await c.env.DB.prepare("SELECT DISTINCT reporting_month FROM monthly_variety_prices WHERE state=? AND reporting_month BETWEEN ? AND ?")
    .bind(state, from, to).all<{ reporting_month: string }>();
  const varieties = await reportCoverage(c.env.DB, state);
  const runs = await c.env.DB.prepare("SELECT reporting_month,status,error_message,started_at FROM monthly_refresh_runs WHERE state=? AND reporting_month BETWEEN ? AND ? ORDER BY started_at DESC")
    .bind(state, from, to).all<Run>();
  const versions = await c.env.DB.prepare(`SELECT r.reporting_month,v.weighted_price,r.source_url,
  r.finished_at AS fetched_at,r.id AS refresh_run_id,
  CASE WHEN v.refresh_run_id IS NULL THEN 0 ELSE 1 END AS variety_present
  FROM monthly_refresh_runs r LEFT JOIN monthly_price_versions v ON v.refresh_run_id=r.id AND v.variety_name=?
  WHERE r.state=? AND r.status='succeeded' AND r.reporting_month BETWEEN ? AND ?
  AND EXISTS (SELECT 1 FROM monthly_price_versions complete WHERE complete.refresh_run_id=r.id)
  ORDER BY r.reporting_month,r.finished_at,r.rowid`)
  .bind(variety, state, from, to).all();
  return c.json({ ...monthlyAnalytics(from, to, prices.results, reports.results.map((row) => row.reporting_month), runs.results),
    variety, state, from, to, varieties: varieties.map((row) => row.variety),
    variety_coverage: varieties.map((row) => long?.coverage.get(row.variety) ?? row), versions: versions.results,
    basis: REPORT_BASIS, long_history_varieties: long ? [...long.tracking] : [],
    methodology: "Rolling means require every calendar month in the window; rolling statistics and YoY use up to 12 stored months before the selected range as lookback. Volatility: sample standard deviation of 12 consecutive monthly log returns, annualized by sqrt(12). Seasonality: monthly price / full-year mean × 100, averaged across at least 3 complete years within the selected range. Descriptive only, not a forecast. Missing months and varieties are not filled. Monthly state-level arrival-weighted modal prices are not daily quotes.",
  });

});

historyRoutes.get("/history/monthly/snapshots/:id/evidence", async (c) => {
  const variety = z.string().trim().min(1).max(160).safeParse(c.req.query("variety"));
  if (!variety.success) return c.json({ error: "Select an exact monthly variety." }, 400);
  const capture = await c.env.DB.prepare("SELECT raw_report,reporting_month,state,source_url,finished_at FROM monthly_refresh_runs WHERE id=? AND status='succeeded'")
    .bind(c.req.param("id")).first<{ raw_report: string | null; reporting_month: string; state: string; source_url: string; finished_at: string }>();
  if (!capture) return c.json({ error: "Archived successful report not found." }, 404);
  const report = await monthlyReportText(c.env, c.req.param("id"), capture.raw_report);
  if ("error" in report) return c.json({ error: report.error }, report.status);
  let evidence;
  try {
    evidence = parseMonthlyEvidence(report.text, capture.reporting_month).find((row) => row.state === capture.state && row.variety_name === variety.data);
  } catch (error) {
    console.error("Archived monthly evidence parsing failed", error);
    return c.json({ error: "Archived report cannot be verified against the monthly source contract. Original CSV remains available for review." }, 422);
  }
  if (!evidence) return c.json({ error: "Exact variety is absent from the archived source." }, 404);
  const stored = await c.env.DB.prepare("SELECT weighted_price,price_unit FROM monthly_price_versions WHERE refresh_run_id=? AND state=? AND variety_name=?")
    .bind(c.req.param("id"), capture.state, variety.data).first<{ weighted_price: number | null; price_unit: string }>();
  const flags: ReviewFlag[] = [];
  if (!stored) flags.push({ code: "version_missing", explanation: "No normalized version is retained for this exact capture/state/variety. Source comparison is incomplete." });
  else if (stored.weighted_price !== evidence.weighted_price || stored.price_unit !== "INR/quintal") {
    flags.push({ code: "source_import_mismatch", explanation: "Retained normalized value or unit differs from the captured primary source column. Investigate ingestion; neither value has been altered." });
  }
  return c.json({
    reporting_month: capture.reporting_month, state: capture.state, variety: variety.data,
    source_url: capture.source_url, fetched_at: capture.finished_at,
    source_publication_timestamp: null,
    source_value: evidence.source_value, raw_imported_value: evidence.source_value,
    source_unit: evidence.source_unit, source_columns: evidence.source_columns,
    reparsed_value: evidence.weighted_price, normalized_value: stored?.weighted_price ?? null,
    normalized_unit: stored?.price_unit ?? null, review_flags: flags,
    explanation: "Original source evidence is the archived CSV captured by this import, not a live re-fetch or an earlier publisher vintage. The primary Rs./Quintal column is parsed numerically without scaling; comparison columns are not imported. Publication time is not supplied by this feed.",
  });
});

historyRoutes.get("/history/monthly/snapshots/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT raw_report,reporting_month FROM monthly_refresh_runs WHERE id=? AND status='succeeded'")
    .bind(c.req.param("id")).first<{ raw_report: string | null; reporting_month: string }>();
  if (!row) return c.json({ error: "Archived successful report not found." }, 404);
  const report = await monthlyReportText(c.env, c.req.param("id"), row.raw_report);
  if ("error" in report) return c.json({ error: report.error }, report.status);
  return new Response(report.text, { headers: { "Content-Type": "text/csv;charset=utf-8",
    "Content-Disposition": `attachment; filename="agmarknet-${row.reporting_month}.csv"` } });
});

historyRoutes.get("/history/aggregates", async (c) => {
  const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const input = z.object({ source: z.enum(["mamcos", "tss", "tumcos"]), variety: z.string().trim().min(1).max(160), branch: z.string().trim().min(1).max(160),
    from: z.string().refine(validDay), to: z.string().refine(validDay), interval: z.enum(["weekly", "monthly"]) }).safeParse(c.req.query());
  if (!input.success || input.data.from > input.data.to || Date.parse(input.data.to) - Date.parse(input.data.from) > 366 * 86_400_000
    || input.data.to > calendarTodayIST()) return c.json({ error: "Select source, exact variety, branch, interval and a valid date range up to 366 days through today (IST)." }, 400);
  const { source, variety, branch, from, to, interval } = input.data;
  const rows = await c.env.DB.prepare(`SELECT reporting_date,average_price,fetched_at,source_url,unit_status FROM cooperative_quotes
    WHERE source_key=? AND commodity='arecanut' AND variety=? AND branch=? AND status='verified' AND reporting_date BETWEEN ? AND ? ORDER BY reporting_date`)
    .bind(source, variety, branch, from, to).all<DailyQuote>();
  return c.json({ data: aggregateDaily(rows.results, from, to, interval), observations: rows.results, ...input.data,
    methodology: "Equal-weight arithmetic mean of captured daily reported averages for one exact variety and branch. Coverage is observed days / calendar days in the selected range, not a claim about trading-day completeness. No interpolation or volume weighting. TSS and TUMCOS INR/quintal is an operator assumption. Not the official monthly arrival-weighted report." });
});

/** Inline report, or its verified R2 copy when the inline column was offloaded. */
async function monthlyReportText(env: Env["Bindings"], runId: string, inline: string | null):
  Promise<{ text: string } | { error: string; status: 404 | 409 | 503 }> {
  if (inline !== null) return { text: inline };
  const archived = await readRelatedText(env, "monthly_refresh_runs", runId);
  if (archived.status === "ok" && archived.text !== undefined) return { text: archived.text };
  const status = archived.status === "unconfigured" ? 503 : archived.status === "hash_mismatch" ? 409 : 404;
  return { error: archived.status === "not_archived" ? "Archived successful report not found." : archiveReadMessage(archived), status };
}

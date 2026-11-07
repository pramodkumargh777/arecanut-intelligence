import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { percentageChange, type Observation } from "./domain/analytics";
import { MONTHLY_METHOD, previousMonth, refreshMonthly, validMonth } from "./monthly";
import { cooperativeRoutes } from "./cooperative-routes";
import { MAMCOS_URL, refreshMamcos } from "./cooperative";
import { configuredAttempts } from "./cooperative-fetch";
import { readCooperativeSource, recordBlockedFetch, schedulingDecision } from "./cooperative-sources";
import { refreshTss } from "./tss";
import { refreshTumcos, TUMCOS_URL } from "./tumcos";
import { calendarDateToTime, calendarTodayIST, DAY_MS } from "../../shared/dates";
import { historyRoutes, monthRange } from "./history";
import { decisionRoutes } from "./decisions";
import { intelligenceRoutes, refreshSirsiWeather, refreshPib } from "./intelligence-routes";
import { autoPublishPending } from "./cooperative-auto-publish";
import { forecastRoutes, refreshChangedForecasts } from "./forecast";
import { commodityRoutes, resolveCommodity } from "./commodity-routes";
import { priceBasisForSource } from "../../shared/commodities";
import { sourceStatusRoutes } from "./source-status";
import { coveredReferenceSeries, overviewSnapshot, referenceChart, refreshAllDirtySummaries, refreshDirtySummaries, type ChartInterval } from "./summaries";
import { operationsRoutes } from "./operations-routes";
import { logOperationalError, purgeExpiredTemporary, syncArchive } from "./archive";
import { forecastingRoutes, reconcileForecastOutcomes } from "./forecasting";
import { supplyRoutes } from "./supply-routes";
import { createAssistantRoutes } from "./assistant/routes";
import type { AssistantConfig } from "./assistant/providers";
import { bearerMatches } from "./auth";

export type Env = {
  Bindings: {
    DB: D1Database;
    CORS_ORIGIN?: string;
    INGESTION_TOKEN?: string;
    ADMIN_TOKEN?: string;
    MIN_INDEX_MARKETS?: string;
    REFERENCE_STATE?: string;
    MAMCOS_SCHEDULE_ENABLED?: string;
    TSS_SCHEDULE_ENABLED?: string;
    TUMCOS_SCHEDULE_ENABLED?: string;
    /** "true" publishes scheduled quotations that pass every check; the rest wait in the review queue. */
    COOPERATIVE_AUTO_PUBLISH?: string;
    COOPERATIVE_FETCH_ATTEMPTS?: string;
    INTELLIGENCE_SCHEDULE_ENABLED?: string;
    /** Optional R2 evidence archive. Absent locally and on deployments without a bucket. */
    ARCHIVE?: R2Bucket;
    ARCHIVE_OFFLOAD_MIN_BYTES?: string;
    TEMP_RETENTION_DAYS?: string;
    ARCHIVE_SCHEDULE_ENABLED?: string;
    /** Set to "false" to disable Open-Meteo (development weather source; non-commercial licence). */
    OPEN_METEO_ENABLED?: string;
    /** AI assistant (optional). Provider "none"/unset = deterministic answers from verified data only. */
    ASSISTANT_LLM_PROVIDER?: string;
    ASSISTANT_LLM_MODEL?: string;
    ASSISTANT_EMBEDDING_PROVIDER?: string;
    ASSISTANT_EMBEDDING_MODEL?: string;
    OLLAMA_BASE_URL?: string;
    ASSISTANT_LLM_TIMEOUT_MS?: string;
    ASSISTANT_RATE_LIMIT_PER_HOUR?: string;
    ASSISTANT_CLIENT_SALT?: string;
    ASSISTANT_LOG_QUESTIONS?: string;
    ASSISTANT_SEMANTIC_THRESHOLD?: string;
    /** Optional Cloudflare Workers AI binding. */
    AI?: AssistantConfig["AI"];
  };
};

const app = new Hono<Env>().basePath("/api/v1");
app.use("*", async (c, next) => {
  const allowedOrigins = (c.env.CORS_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return cors({ origin: allowedOrigins, allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type", "Authorization"] })(c, next);
});

app.onError((error, c) => {
  console.error("ANI API error", error);
  return c.json({ error: "The request could not be completed." }, 500);
});

const reviewSchema = z.object({ action: z.enum(["approve", "reject"]) });
const priceRecordSchema = z.object({
  id: z.string().min(1).max(128),
  source_record_id: z.string().min(1).max(256),
  market_id: z.string().min(1).max(128),
  market_name: z.string().trim().min(1).max(160),
  district: z.string().trim().min(1).max(120),
  state: z.string().trim().min(1).max(80),
  reporting_date: z.string().refine(validDate, "Reporting date must be a real date in YYYY-MM-DD format."),
  publication_date: z.string().refine(validDate, "Publication date must be a real date in YYYY-MM-DD format.").nullable().optional(),
  commodity_name: z.literal("Arecanut"),
  original_commodity_name: z.string().min(1).max(160),
  variety_name: z.string().trim().min(1).max(160),
  original_variety_name: z.string().min(1).max(160),
  minimum_price: z.number().finite().nonnegative(),
  maximum_price: z.number().finite().nonnegative(),
  modal_price: z.number().finite().nonnegative(),
  arrival_quantity: z.number().finite().nonnegative().nullable(),
  arrival_unit: z.string().max(40).nullable(),
  original_unit: z.string().min(1).max(40),
  price_unit: z.literal("INR/quintal"),
  validation_status: z.enum(["validated", "review_required"]),
  validation_message: z.string().max(500).nullable(),
  raw_payload: z.string().max(20_000),
  grade: z.string().trim().min(1).max(80).nullable().optional(),
  source_resource_id: z.string().trim().min(1).max(64).nullable().optional(),
  platform_fetched_at: z.string().datetime({ offset: true }).nullable().optional(),
}).refine((record) =>
  record.validation_status === "review_required"
  || (record.minimum_price <= record.maximum_price
    && record.modal_price >= record.minimum_price
    && record.modal_price <= record.maximum_price),
{ message: "Prices must satisfy minimum ≤ modal ≤ maximum." });

const importSchema = z.object({
  source_key: z.enum(["agmarknet", "agmarknet_csv"]),
  records: z.array(priceRecordSchema).min(1).max(500),
  /** Client-derived key (e.g. file SHA-256 + batch index). A completed key is replayed, not re-imported. */
  idempotency_key: z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9:._-]+$/).optional(),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  source_file_name: z.string().trim().min(1).max(260).optional(),
  /** Explicit operator request to run a completed batch again as a new, linked job. */
  reprocess: z.boolean().optional(),
}).superRefine((payload, context) => {
  const recordIds = new Map<string, string>();
  for (const [index, record] of payload.records.entries()) {
    const previousId = recordIds.get(record.source_record_id);
    if (previousId && previousId !== record.id) {
      context.addIssue({
        code: "custom",
        message: "A source record can have only one version per import batch.",
        path: ["records", index, "source_record_id"],
      });
    } else {
      recordIds.set(record.source_record_id, record.id);
    }
  }
});

function isAuthorized(header: string | undefined, token: string | undefined): boolean {
  return bearerMatches(header, token);
}

const UNKNOWN_COMMODITY = { error: "Unknown commodity. Use a code from GET /commodities." } as const;

function minimumCoverage(value: string | undefined): number {
  const parsed = Number(value ?? 3);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : 3;
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number | null {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function parseDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return validDate(value) ? value : undefined;
}

app.get("/health", (c) => c.json({ status: "ok", service: "ani-market-api" }));
app.route("/", cooperativeRoutes);
app.route("/", historyRoutes);
app.route("/", decisionRoutes);
app.route("/", sourceStatusRoutes);
app.route("/", intelligenceRoutes);
app.route("/", forecastRoutes);
app.route("/", forecastingRoutes);
app.route("/", commodityRoutes);
app.route("/", operationsRoutes);
app.route("/", supplyRoutes);
// Tools call existing public endpoints in-process, so the assistant reads exactly what the UI reads.
app.route("/", createAssistantRoutes((path, init, env) => Promise.resolve(app.request(`/api/v1${path}`, init, env))));

app.get("/monthly-prices", async (c) => {
  const state = c.env.REFERENCE_STATE ?? "Karnataka";
  const month = c.req.query("month");
  if (month && !validMonth(month)) return c.json({ error: "month must be YYYY-MM, from 2010 onward." }, 400);
  const months = await c.env.DB.prepare("SELECT DISTINCT reporting_month FROM monthly_variety_prices WHERE state = ? ORDER BY reporting_month DESC")
    .bind(state).all<{ reporting_month: string }>();
  const selected = month ?? months.results[0]?.reporting_month ?? null;
  const data = selected ? await c.env.DB.prepare(`SELECT reporting_month, state, variety_name, weighted_price,
    price_unit, source_url, fetched_at FROM monthly_variety_prices WHERE state = ? AND reporting_month = ? ORDER BY variety_name`)
    .bind(state, selected).all() : { results: [] };
  const variety = c.req.query("variety");
  const historyFrom = selected ? previousMonth(new Date(`${selected}-01T00:00:00Z`), 23) : null;
  const history = variety && selected ? await c.env.DB.prepare(`SELECT reporting_month, weighted_price, fetched_at
    FROM monthly_variety_prices WHERE state = ? AND variety_name = ? AND reporting_month BETWEEN ? AND ?
    ORDER BY reporting_month DESC`).bind(state, variety, historyFrom, selected)
    .all<{ reporting_month: string; weighted_price: number | null; fetched_at: string }>() : { results: [] };
  const historyByMonth = new Map(history.results.map((row) => [row.reporting_month, row]));
  const calendarHistory = variety && selected && historyFrom ? monthRange(historyFrom, selected).reverse().map((month) =>
    historyByMonth.get(month) ?? { reporting_month: month, weighted_price: null, fetched_at: null }) : [];
  const lastRun = await c.env.DB.prepare(`SELECT reporting_month, started_at, finished_at, status, record_count, error_message
    FROM monthly_refresh_runs WHERE state = ? ORDER BY started_at DESC LIMIT 1`).bind(state).first();
  return c.json({ data: data.results, months: months.results.map((row) => row.reporting_month),
    reporting_month: selected, state, methodology: MONTHLY_METHOD, last_run: lastRun, history: calendarHistory });
});

app.post("/admin/monthly/refresh", async (c) => {
  if (!isAuthorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) {
    return c.json({ error: "A valid reviewer token is required." }, 401);
  }
  const body: unknown = await c.req.json().catch(() => null);
  const parsed = z.object({ month: z.string().refine(validMonth) }).strict().safeParse(body);
  if (!parsed.success || parsed.data.month > previousMonth(new Date())) {
    return c.json({ error: "Provide a completed reporting month as YYYY-MM, from 2010 onward." }, 400);
  }
  try {
    const result = await refreshMonthly(c.env.DB, parsed.data.month, c.env.REFERENCE_STATE ?? "Karnataka");
    // Match stored experimental forecasts to newly published actuals; never fails the refresh.
    await reconcileForecastOutcomes(c.env.DB).catch((error) => console.error("Forecast reconciliation failed", error));
    return c.json(result);
  } catch (error) {
    console.error("Monthly refresh failed", error);
    return c.json({ error: "Monthly refresh failed. Existing prices were preserved; see monthly refresh status for details." }, 502);
  }
});

app.get("/markets", async (c) => {
  const commodity = await resolveCommodity(c.env.DB, c.req.query("commodity"));
  if (!commodity) return c.json(UNKNOWN_COMMODITY, 400);
  const result = await c.env.DB.prepare(
    `SELECT DISTINCT m.id, m.name, m.district, m.state
     FROM markets m
     JOIN market_price_observations o ON o.market_id = m.id
     WHERE o.validation_status = 'verified' AND m.mapping_status = 'verified' AND m.state = ? AND o.commodity_name = ?
     ORDER BY m.district, m.name`,
  ).bind(c.env.REFERENCE_STATE ?? "Karnataka", commodity.canonical_name).all<{ id: string; name: string; district: string; state: string }>();
  return c.json({ data: result.results });
});

app.get("/varieties", async (c) => {
  const commodity = await resolveCommodity(c.env.DB, c.req.query("commodity"));
  if (!commodity) return c.json(UNKNOWN_COMMODITY, 400);
  await refreshDirtySummaries(c.env.DB, commodity.canonical_name);
  const result = await c.env.DB.prepare(
    `SELECT DISTINCT variety_name FROM market_daily_summaries WHERE commodity_name = ? AND state = ? ORDER BY variety_name`,
  ).bind(commodity.canonical_name, c.env.REFERENCE_STATE ?? "Karnataka").all<{ variety_name: string }>();
  return c.json({ data: result.results.map((row) => row.variety_name) });
});

type PriceCursor = [reportingDate: string, marketName: string, observationId: string];

function encodeCursor(cursor: PriceCursor) {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(value: string): PriceCursor | null {
  try {
    const parsed: unknown = JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/")));
    return Array.isArray(parsed) && parsed.length === 3 && parsed.every((item) => typeof item === "string") && validDate(parsed[0])
      ? parsed as PriceCursor : null;
  } catch {
    return null;
  }
}

/** Whitelisted /prices sort keys mapped to SQL expressions; never interpolate client input directly. */
const PRICE_SORT_COLUMNS: Record<string, string> = {
  reporting_date: "o.reporting_date",
  market_name: "m.name",
  district: "m.district",
  variety_name: "o.variety_name",
  minimum_price: "o.minimum_price",
  maximum_price: "o.maximum_price",
  modal_price: "o.modal_price",
};

app.get("/prices", async (c) => {
  const limit = boundedInteger(c.req.query("limit"), 200, 1, 1000);
  const offset = boundedInteger(c.req.query("offset"), 0, 0, 2_000_000);
  if (limit === null) return c.json({ error: "limit must be an integer from 1 to 1000." }, 400);
  if (offset === null) return c.json({ error: "offset must be an integer from 0 to 2000000." }, 400);
  const cursorParameter = c.req.query("cursor");
  const cursor = cursorParameter ? decodeCursor(cursorParameter) : null;
  if (cursorParameter && !cursor) return c.json({ error: "Invalid cursor; use next_cursor from a previous response." }, 400);
  if (cursor && offset) return c.json({ error: "Use either cursor or offset, not both." }, 400);
  const sortParameter = c.req.query("sort");
  const orderParameter = c.req.query("order") ?? (sortParameter === "market_name" ? "asc" : "desc");
  const sortColumn = sortParameter ? PRICE_SORT_COLUMNS[sortParameter] : undefined;
  if (sortParameter && !sortColumn) return c.json({ error: `sort must be one of: ${Object.keys(PRICE_SORT_COLUMNS).join(", ")}.` }, 400);
  if (orderParameter !== "asc" && orderParameter !== "desc") return c.json({ error: "order must be asc or desc." }, 400);
  const customSort = Boolean(sortColumn) && !(sortParameter === "reporting_date" && orderParameter === "desc");
  if (customSort && cursor) return c.json({ error: "Cursor pagination supports only the default reporting_date desc order; use offset with custom sorting." }, 400);
  const includeCount = c.req.query("include_count") !== "false";
  const commodity = await resolveCommodity(c.env.DB, c.req.query("commodity"));
  if (!commodity) return c.json(UNKNOWN_COMMODITY, 400);
  const filters: string[] = ["o.validation_status = 'verified'", "m.mapping_status = 'verified'", "m.state = ?", "o.commodity_name = ?"];
  const values: (string | number)[] = [c.env.REFERENCE_STATE ?? "Karnataka", commodity.canonical_name];
  const exactFilters: [string, string | undefined][] = [
    ["o.market_id = ?", c.req.query("market_id")],
    ["o.variety_name = ?", c.req.query("variety")],
    ["m.district = ?", c.req.query("district")],
    ["o.grade = ?", c.req.query("grade")],
  ];
  for (const [condition, value] of exactFilters) {
    if (value) {
      filters.push(condition);
      values.push(value);
    }
  }
  for (const [parameter, operator] of [["from", ">="], ["to", "<="]] as const) {
    const value = c.req.query(parameter);
    if (value && !parseDate(value)) return c.json({ error: `Invalid ${parameter} date; expected YYYY-MM-DD.` }, 400);
    if (value) {
      filters.push(`o.reporting_date ${operator} ?`);
      values.push(value);
    }
  }
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (from && to && from > to) return c.json({ error: "'from' date must not be after 'to' date." }, 400);
  const search = c.req.query("q")?.trim();
  if (search) {
    if (search.length > 100) return c.json({ error: "Search text must be at most 100 characters." }, 400);
    filters.push("(m.name LIKE ? OR m.district LIKE ? OR o.variety_name LIKE ?)");
    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const where = filters.join(" AND ");
  // Keyset pagination: stable order (date DESC, market ASC, id ASC) avoids deep OFFSET scans.
  const pageFilters = cursor
    ? `${where} AND (o.reporting_date < ? OR (o.reporting_date = ? AND (m.name > ? OR (m.name = ? AND o.id > ?))))`
    : where;
  const pageValues = cursor ? [...values, cursor[0], cursor[0], cursor[1], cursor[1], cursor[2]] : values;
  const [rows, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT o.id, o.reporting_date, o.publication_date, o.original_unit,
              NULL AS source_publication_timestamp, o.platform_fetched_at AS platform_fetch_timestamp, o.grade,
              o.market_id, m.name AS market_name, m.district,
              o.variety_name, o.minimum_price, o.maximum_price, o.modal_price,
              o.arrival_quantity, o.arrival_unit, o.price_unit, s.name AS source_name,
              o.source_record_id, o.ingested_at AS ingestion_timestamp, o.price_basis
       FROM market_price_observations o
       JOIN markets m ON m.id = o.market_id
       JOIN data_sources s ON s.id = o.source_id
       WHERE ${pageFilters}
       ORDER BY ${customSort ? `${sortColumn} ${orderParameter.toUpperCase()}, o.reporting_date DESC, m.name ASC, o.id ASC` : "o.reporting_date DESC, m.name ASC, o.id ASC"}
       LIMIT ? OFFSET ?`,
    ).bind(...pageValues, limit + 1, cursor ? 0 : offset).all<Observation>(),
    includeCount ? c.env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM market_price_observations o
       JOIN markets m ON m.id = o.market_id
       WHERE ${where}`,
    ).bind(...values).first<{ count: number }>() : Promise.resolve(null),
  ]);
  const page = rows.results.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = !customSort && rows.results.length > limit && last ? encodeCursor([last.reporting_date, last.market_name, last.id]) : null;
  return c.json({ data: page, count: includeCount ? count?.count ?? 0 : null, limit, next_cursor: nextCursor, has_more: rows.results.length > limit });
});

app.get("/analytics/reference-index", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if ((from && !parseDate(from)) || (to && !parseDate(to))) {
    return c.json({ error: "Dates must use YYYY-MM-DD format." }, 400);
  }
  if (from && to && from > to) return c.json({ error: "'from' date must not be after 'to' date." }, 400);
  const commodity = await resolveCommodity(c.env.DB, c.req.query("commodity"));
  if (!commodity) return c.json(UNKNOWN_COMMODITY, 400);
  const variety = c.req.query("variety");
  if (!variety) {
    return c.json({
      data: [],
      minimum_market_coverage: minimumCoverage(c.env.MIN_INDEX_MARKETS),
      methodology: "The reference index is calculated separately for each reported variety; select a variety to avoid combining non-comparable market categories.",
      reason: "Select a reported variety to calculate the reference index.",
    });
  }
  const coverage = minimumCoverage(c.env.MIN_INDEX_MARKETS);
  const series = await coveredReferenceSeries(c.env.DB,
    { commodityName: commodity.canonical_name, state: c.env.REFERENCE_STATE ?? "Karnataka", variety, coverage }, from, to);
  return c.json({
    data: series.data,
    truncated: series.truncated,
    minimum_market_coverage: coverage,
    methodology: `For each reporting date, take the median of one verified modal price per market for the exact reported variety "${variety}". Dates with fewer than ${coverage} verified markets are withheld. No arrival weighting or variety mapping is applied.${series.truncated ? " Only the most recent points are returned; narrow the date range or use /charts/reference for aggregated history." : ""}`,
  });
});

const MAX_CHART_SPAN_DAYS = 3660;

app.get("/charts/reference", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!from || !to || !parseDate(from) || !parseDate(to)) return c.json({ error: "from and to are required as YYYY-MM-DD." }, 400);
  if (from > to) return c.json({ error: "'from' date must not be after 'to' date." }, 400);
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (span > MAX_CHART_SPAN_DAYS) return c.json({ error: `Date range must not exceed ${MAX_CHART_SPAN_DAYS} days.` }, 400);
  const interval = (c.req.query("interval") ?? "daily") as ChartInterval;
  if (!["daily", "weekly", "monthly"].includes(interval)) return c.json({ error: "interval must be daily, weekly or monthly." }, 400);
  const commodity = await resolveCommodity(c.env.DB, c.req.query("commodity"));
  if (!commodity) return c.json(UNKNOWN_COMMODITY, 400);
  const variety = c.req.query("variety");
  if (!variety) return c.json({ error: "Select an exact reported variety." }, 400);
  const coverage = minimumCoverage(c.env.MIN_INDEX_MARKETS);
  const chart = await referenceChart(c.env.DB,
    { commodityName: commodity.canonical_name, state: c.env.REFERENCE_STATE ?? "Karnataka", variety, coverage }, from, to, interval);
  return c.json({
    commodity: commodity.code, variety, from, to, interval, minimum_market_coverage: coverage, ...chart,
    methodology: `Each bucket (${interval}${interval === "weekly" ? ", Monday start" : ""}) summarizes covered daily reference values only (median of one verified modal price per market, at least ${coverage} markets). Buckets without covered reporting days are omitted, never interpolated. Withheld days had insufficient market coverage.`,
  });
});

app.get("/analytics/market-comparison", async (c) => {
  const commodity = await resolveCommodity(c.env.DB, c.req.query("commodity"));
  if (!commodity) return c.json(UNKNOWN_COMMODITY, 400);
  const variety = c.req.query("variety");
  if (!variety) return c.json({ data: [], reason: "Select a reported variety to compare markets." });
  const result = await c.env.DB.prepare(
    `WITH ranked AS (
       SELECT o.id, o.reporting_date, o.publication_date, o.original_unit,
              NULL AS source_publication_timestamp, o.platform_fetched_at AS platform_fetch_timestamp, o.grade,
              o.market_id, m.name AS market_name, m.district,
              o.variety_name, o.minimum_price, o.maximum_price, o.modal_price,
              o.arrival_quantity, o.arrival_unit, o.price_unit, s.name AS source_name,
              o.source_record_id, o.ingested_at AS ingestion_timestamp, o.price_basis,
              ROW_NUMBER() OVER (
                PARTITION BY o.market_id
                ORDER BY o.reporting_date DESC, o.ingested_at DESC, o.id
              ) AS row_num
       FROM market_price_observations o
       JOIN markets m ON m.id = o.market_id
       JOIN data_sources s ON s.id = o.source_id
       WHERE o.validation_status = 'verified'
         AND m.mapping_status = 'verified'
         AND m.state = ?
         AND o.variety_name = ?
         AND o.commodity_name = ?
     )
     SELECT id, reporting_date, publication_date, original_unit, source_publication_timestamp, platform_fetch_timestamp, grade,
            market_id, market_name, district, variety_name,
            minimum_price, maximum_price, modal_price, arrival_quantity, arrival_unit,
            price_unit, source_name, source_record_id, ingestion_timestamp, price_basis
     FROM ranked
     WHERE row_num = 1
     ORDER BY modal_price DESC, market_name ASC`,
  ).bind(c.env.REFERENCE_STATE ?? "Karnataka", variety, commodity.canonical_name).all<Observation>();
  return c.json({ data: result.results });
});

app.get("/overview", async (c) => {
  const commodity = await resolveCommodity(c.env.DB, c.req.query("commodity"));
  if (!commodity) return c.json(UNKNOWN_COMMODITY, 400);
  const variety = c.req.query("variety");
  const coverage = minimumCoverage(c.env.MIN_INDEX_MARKETS);
  if (!variety) {
    return c.json({
      data: {
        latest_reporting_date: null,
        benchmark_reporting_date: null,
        reference_price: null,
        previous_reference_price: null,
        absolute_change: null,
        percent_change: null,
        reporting_markets: 0,
        market_coverage_required: coverage,
        index_status: "no_data",
        highest_market: null,
        lowest_market: null,
        source_count: 0,
      },
    });
  }
  const snapshot = await overviewSnapshot(c.env.DB,
    { commodityName: commodity.canonical_name, state: c.env.REFERENCE_STATE ?? "Karnataka", variety, coverage });
  const latestDate = snapshot.latestDate;
  const latest = snapshot.latest;
  const comparable = snapshot.comparable;
  const currentPrice = latest?.reporting_date === latestDate ? latest.median_modal_price : null;
  const previousPrice = snapshot.previous?.median_modal_price ?? null;
  const absoluteChange = currentPrice !== null && previousPrice !== null ? currentPrice - previousPrice : null;
  return c.json({
    data: {
      latest_reporting_date: latestDate,
      benchmark_reporting_date: latest?.reporting_date ?? null,
      reference_price: currentPrice,
      previous_reference_price: previousPrice,
      absolute_change: absoluteChange,
      percent_change: percentageChange(currentPrice, previousPrice),
      reporting_markets: comparable.length,
      market_coverage_required: coverage,
      index_status: !latestDate ? "no_data" : currentPrice === null ? "insufficient_coverage" : "available",
      highest_market: comparable.length ? { market_name: comparable.at(-1)!.market_name, modal_price: comparable.at(-1)!.modal_price } : null,
      lowest_market: comparable.length ? { market_name: comparable[0].market_name, modal_price: comparable[0].modal_price } : null,
      source_count: new Set(comparable.map((row) => row.source_name)).size,
    },
  });
});

app.get("/admin/quality", async (c) => {
  if (!isAuthorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) {
    return c.json({ error: "A valid reviewer token is required." }, 401);
  }
  const limit = boundedInteger(c.req.query("limit"), 100, 1, 200);
  const offset = boundedInteger(c.req.query("offset"), 0, 0, 1_000_000);
  if (limit === null || offset === null) return c.json({ error: "limit must be 1-200 and offset a non-negative integer." }, 400);
  const [result, total] = await c.env.DB.batch<Record<string, unknown>>([c.env.DB.prepare(
    `SELECT o.id, o.reporting_date, o.publication_date, m.name AS market_name, m.district, m.state, o.variety_name,
            o.minimum_price, o.maximum_price, o.modal_price, o.price_unit,
            s.name AS source_name, o.source_record_id, o.validation_status, o.validation_message,
            o.raw_payload, o.original_unit, o.ingested_at, o.grade, o.source_resource_id, o.platform_fetched_at
     FROM market_price_observations o
     JOIN markets m ON m.id = o.market_id
     JOIN data_sources s ON s.id = o.source_id
     WHERE o.validation_status IN ('validated', 'review_required')
     ORDER BY o.reporting_date DESC, o.ingested_at DESC, o.id
     LIMIT ? OFFSET ?`,
  ).bind(limit, offset), c.env.DB.prepare(
    "SELECT COUNT(*) AS total FROM market_price_observations WHERE validation_status IN ('validated', 'review_required')",
  )]);
  return c.json({ data: result.results, count: result.results.length, total: Number(total.results[0]?.total ?? 0), limit, offset });
});

app.post("/admin/import", async (c) => {
  if (!isAuthorized(c.req.header("Authorization"), c.env.INGESTION_TOKEN)) {
    return c.json({ error: "A valid ingestion token is required." }, 401);
  }
  const parsed = importSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid import payload.", details: parsed.error.issues }, 400);
  const source = await c.env.DB.prepare(
    "SELECT id, source_key FROM data_sources WHERE source_key = ? AND is_enabled = 1",
  ).bind(parsed.data.source_key).first<{ id: string; source_key: string }>();
  if (!source) return c.json({ error: "The requested source is not enabled." }, 400);
  const idempotencyKey = parsed.data.idempotency_key ?? null;
  let reprocessOf: string | null = null;
  if (idempotencyKey) {
    const prior = await c.env.DB.prepare(`SELECT id, status, received_count, inserted_count, duplicate_count, corrected_count
      FROM ingestion_jobs WHERE source_id = ? AND idempotency_key = ? AND reprocess_of IS NULL AND status != 'failed'`)
      .bind(source.id, idempotencyKey).first<{ id: string; status: string; received_count: number; inserted_count: number;
        duplicate_count: number | null; corrected_count: number | null }>();
    if (prior?.status === "running") return c.json({ error: "An import with this idempotency key is still running.", job_id: prior.id }, 409);
    if (prior && !parsed.data.reprocess) {
      return c.json({ job_id: prior.id, received_count: prior.received_count, inserted_count: prior.inserted_count,
        duplicate_count: prior.duplicate_count ?? 0, corrected_count: prior.corrected_count ?? 0, replayed: true }, 200);
    }
    reprocessOf = prior?.id ?? null;
  }
  const jobId = crypto.randomUUID();
  try {
    await c.env.DB.prepare(
      `INSERT INTO ingestion_jobs (id, source_id, status, received_count, idempotency_key, content_sha256, source_file_name, reprocess_of)
       VALUES (?, ?, 'running', ?, ?, ?, ?, ?)`,
    ).bind(jobId, source.id, parsed.data.records.length, idempotencyKey, parsed.data.content_sha256 ?? null,
      parsed.data.source_file_name ?? null, reprocessOf).run();
  } catch (error) {
    // Unique index race: another request registered the same key first.
    if (idempotencyKey && error instanceof Error && /UNIQUE/i.test(error.message)) {
      return c.json({ error: "An import with this idempotency key was registered concurrently; retry to receive its result." }, 409);
    }
    throw error;
  }
  let insertedCount = 0;
  let duplicateCount = 0;
  let correctedCount = 0;
  try {
    const seenInRequest = new Set<string>();
    for (let offset = 0; offset < parsed.data.records.length; offset += 25) {
      const batch = parsed.data.records.slice(offset, offset + 25);
      const statements: D1PreparedStatement[] = [];
      const observationStatementIndexes: number[] = [];
      const correctionStatementIndexes: number[] = [];
      for (const record of batch) {
        const requestKey = `${record.source_record_id}:${record.id}`;
        if (seenInRequest.has(requestKey)) {
          duplicateCount += 1;
          continue;
        }
        seenInRequest.add(requestKey);
        statements.push(c.env.DB.prepare(
          `INSERT INTO markets (id, name, district, state, mapping_status)
           VALUES (?, ?, ?, ?, 'unverified')
           ON CONFLICT(id) DO NOTHING`,
        ).bind(record.market_id, record.market_name, record.district, record.state));
        statements.push(c.env.DB.prepare(
          `INSERT OR IGNORE INTO market_commodities (market_id, commodity_id, source_key, status)
           SELECT ?, id, ?, 'observed' FROM commodities WHERE canonical_name = ?`,
        ).bind(record.market_id, source.source_key, record.commodity_name));
        statements.push(c.env.DB.prepare(
          `INSERT INTO source_record_versions
            (id, observation_id, source_id, source_record_id, version_number, snapshot_payload)
           SELECT ?, o.id, o.source_id, o.source_record_id,
             COALESCE((SELECT MAX(version_number) FROM source_record_versions v
               WHERE v.source_id = o.source_id AND v.source_record_id = o.source_record_id), 0) + 1,
             json_object('id', o.id, 'validation_status', o.validation_status,
               'minimum_price', o.minimum_price, 'modal_price', o.modal_price,
               'maximum_price', o.maximum_price, 'raw_payload', o.raw_payload,
               'ingested_at', o.ingested_at, 'validation_message', o.validation_message)
           FROM market_price_observations o WHERE o.source_id = ? AND o.source_record_id = ?
             AND o.id != ? AND o.validation_status != 'superseded'`,
        ).bind(crypto.randomUUID(), source.id, record.source_record_id, record.id));
        correctionStatementIndexes.push(statements.length);
        statements.push(c.env.DB.prepare(
          `UPDATE market_price_observations SET validation_status = 'superseded'
           WHERE source_id = ? AND source_record_id = ? AND id != ? AND validation_status != 'superseded'`,
        ).bind(source.id, record.source_record_id, record.id));
        observationStatementIndexes.push(statements.length);
        statements.push(c.env.DB.prepare(
          `INSERT INTO market_price_observations (
             id, source_id, ingestion_job_id, source_record_id, market_id, reporting_date,
             publication_date, commodity_name, original_commodity_name, variety_name,
             original_variety_name, minimum_price, maximum_price, modal_price,
             arrival_quantity, arrival_unit, original_unit, price_unit, validation_status,
             validation_message, raw_payload, grade, source_resource_id, platform_fetched_at, price_basis
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET validation_status = excluded.validation_status,
             validation_message = excluded.validation_message, ingestion_job_id = excluded.ingestion_job_id,
             ingested_at = CURRENT_TIMESTAMP
           WHERE market_price_observations.validation_status = 'superseded'
             AND market_price_observations.source_id = excluded.source_id
             AND market_price_observations.source_record_id = excluded.source_record_id`,
        ).bind(
          record.id, source.id, jobId, record.source_record_id, record.market_id,
          record.reporting_date, record.publication_date ?? null, record.commodity_name,
          record.original_commodity_name, record.variety_name, record.original_variety_name,
          record.minimum_price, record.maximum_price, record.modal_price,
          record.arrival_quantity, record.arrival_unit, record.original_unit, record.price_unit,
          record.validation_status, record.validation_message, record.raw_payload,
          record.grade ?? null, record.source_resource_id ?? null, record.platform_fetched_at ?? null,
          priceBasisForSource(source.source_key),
        ));
      }
      if (!statements.length) continue;
      const results = await c.env.DB.batch(statements);
      for (const index of observationStatementIndexes) {
        if (results[index].meta.changes) insertedCount += 1;
        else duplicateCount += 1;
      }
      for (const index of correctionStatementIndexes) correctedCount += results[index].meta.changes;
    }
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO ingestion_job_logs (id, job_id, level, message) VALUES (?, ?, 'info', ?)",
      ).bind(crypto.randomUUID(), jobId, `Received ${parsed.data.records.length}; inserted ${insertedCount}; corrected ${correctedCount}; duplicates ignored ${duplicateCount}.`),
      c.env.DB.prepare(
        `UPDATE ingestion_jobs SET status = 'completed', inserted_count = ?, duplicate_count = ?, corrected_count = ?,
           completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).bind(insertedCount, duplicateCount, correctedCount, jobId),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database insert failed.";
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO ingestion_job_logs (id, job_id, level, message) VALUES (?, ?, 'error', ?)",
      ).bind(crypto.randomUUID(), jobId, message.slice(0, 500)),
      c.env.DB.prepare(
        "UPDATE ingestion_jobs SET status = 'failed', inserted_count = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).bind(insertedCount, message.slice(0, 500), jobId),
    ]);
    console.error("ANI ingestion job failed", { jobId, insertedCount, error });
    await logOperationalError(c.env.DB, "import", source.source_key, message, { job_id: jobId, inserted_count: insertedCount });
    return c.json({ error: "Import failed; completed batches remain recorded in the ingestion job.", job_id: jobId, inserted_count: insertedCount }, 500);
  }
  return c.json({
    job_id: jobId,
    received_count: parsed.data.records.length,
    inserted_count: insertedCount,
    duplicate_count: duplicateCount,
    corrected_count: correctedCount,
    replayed: false,
    reprocess_of: reprocessOf,
  }, 201);
});

app.post("/admin/observations/:id/review", async (c) => {
  if (!isAuthorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) {
    return c.json({ error: "A valid reviewer token is required." }, 401);
  }
  const parsed = reviewSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Action must be 'approve' or 'reject'." }, 400);
  const status = parsed.data.action === "approve" ? "verified" : "rejected";
  const observation = await c.env.DB.prepare(
    "SELECT * FROM market_price_observations WHERE id = ? AND validation_status IN ('validated', 'review_required')",
  ).bind(c.req.param("id")).first<{
    market_id: string; minimum_price: number; modal_price: number; maximum_price: number;
    reporting_date: string; validation_status: string; validation_message: string | null;
  }>();
  if (!observation) return c.json({ error: "Pending observation not found." }, 404);
  if (status === "verified" && (observation.minimum_price > observation.modal_price
      || observation.modal_price > observation.maximum_price || observation.reporting_date > new Date().toISOString().slice(0, 10))) {
    return c.json({ error: "Invalid price range or future reporting date cannot be approved. Correct the source record first." }, 409);
  }
  const reviewId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      "UPDATE market_price_observations SET validation_status = ? WHERE id = ? AND validation_status = ?",
    ).bind(status, c.req.param("id"), observation.validation_status),
    c.env.DB.prepare(
      `INSERT INTO observation_reviews (id, observation_id, action, reviewer, previous_status, validation_message)
       SELECT ?, ?, ?, 'shared-reviewer-token', ?, ? WHERE changes() = 1`,
    ).bind(reviewId, c.req.param("id"), parsed.data.action, observation.validation_status, observation.validation_message),
  ];
  if (parsed.data.action === "approve") {
    statements.push(c.env.DB.prepare(`UPDATE markets SET mapping_status = 'verified' WHERE id = ?
      AND EXISTS (SELECT 1 FROM observation_reviews WHERE id = ?)`).bind(observation.market_id, reviewId));
  }
  const results = await c.env.DB.batch(statements);
  if (!results[0].meta.changes) return c.json({ error: "Observation changed during review. Reload the queue." }, 409);
  return c.json({ success: true, status });
});

/** 20:00 IST, after the day's tenders. Collects cooperative rates only; the 09:00 IST run does everything else. */
export const EVENING_CRON = "30 14 * * *";

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env["Bindings"], _ctx: ExecutionContext) {
    const now = new Date();
    const errors: unknown[] = [];
    const evening = event.cron === EVENING_CRON;
    if (!evening && env.INTELLIGENCE_SCHEDULE_ENABLED === "true") {
      if (env.OPEN_METEO_ENABLED !== "false") {
        try { await refreshSirsiWeather(env.DB); }
        catch (error) { console.error("Scheduled Sirsi weather refresh failed", error); errors.push(error); }
      }
      try {
        const result = await refreshPib(env.DB);
        if (result.failures.length) throw new Error(result.failures.join("; "));
      } catch (error) { console.error("Scheduled official bulletin refresh failed", error); errors.push(error); }
    }
    const attempts = configuredAttempts(env.COOPERATIVE_FETCH_ATTEMPTS);
    // TSS is requested by date. At 09:00 IST today's tenders have not happened, so the morning run closes out yesterday.
    const today = calendarTodayIST(now);
    const tssDate = evening ? today : new Date(calendarDateToTime(today) - DAY_MS).toISOString().slice(0, 10);
    const cooperative = [
      { key: "mamcos" as const, flag: env.MAMCOS_SCHEDULE_ENABLED, url: MAMCOS_URL, run: () => refreshMamcos(env.DB, { mode: "scheduled", attempts }) },
      { key: "tss" as const, flag: env.TSS_SCHEDULE_ENABLED, url: "https://webapi.tssindia.in/getrateshomepage",
        run: () => refreshTss(env.DB, tssDate, { mode: "scheduled", attempts }) },
      { key: "tumcos" as const, flag: env.TUMCOS_SCHEDULE_ENABLED, url: TUMCOS_URL, run: () => refreshTumcos(env.DB, { mode: "scheduled", scope: "recent", attempts }) },
    ];
    for (const source of cooperative) {
      if (source.flag !== "true") continue;
      try {
        const decision = schedulingDecision(await readCooperativeSource(env.DB, source.key), true);
        if (!decision.allowed) {
          console.warn(`Scheduled ${source.key} collection skipped: ${decision.reason}`);
          await recordBlockedFetch(env.DB, source.key, source.url, decision.reason);
          continue;
        }
        await source.run();
      } catch (error) { console.error(`Scheduled ${source.key} refresh failed`, error); errors.push(error); }
      if (env.COOPERATIVE_AUTO_PUBLISH !== "true") continue;
      // Also runs after a partial failure, so rows from locations that succeeded still reach readers.
      try {
        const { published, held } = await autoPublishPending(env.DB, source.key, now);
        if (published || held.length) console.log(`${source.key}: ${published} auto-published, ${held.length} held for review`, held.slice(0, 5));
      } catch (error) { console.error(`Scheduled ${source.key} auto-publish failed`, error); errors.push(error); }
    }
    if (evening) {
      try { await refreshAllDirtySummaries(env.DB); }
      catch (error) { await logOperationalError(env.DB, "summary_cache", null, error instanceof Error ? error.message : String(error)); }
      for (const error of errors) await logOperationalError(env.DB, "scheduled", null, error instanceof Error ? error.message : String(error));
      if (errors.length) throw new AggregateError(errors, "Source refresh schedule failed.");
      return;
    }
    for (const offset of [2, 1]) {
      try {
        await refreshMonthly(env.DB, previousMonth(now, offset), env.REFERENCE_STATE ?? "Karnataka");
      } catch (error) {
        console.error("Scheduled monthly refresh failed", error);
        errors.push(error);
      }
    }
    // Derived-cache and archive maintenance never fail the source schedule; failures are persisted for operators.
    const maintenance: [string, unknown][] = [];
    try {
      await refreshAllDirtySummaries(env.DB);
    } catch (error) { maintenance.push(["summary_cache", error]); }
    try {
      await reconcileForecastOutcomes(env.DB);
    } catch (error) { maintenance.push(["forecasting", error]); }
    try {
      await refreshChangedForecasts(env.DB, now);
    } catch (error) { maintenance.push(["forecasting", error]); }
    if (env.ARCHIVE_SCHEDULE_ENABLED === "true") {
      try {
        const archive = await syncArchive(env, { limit: 5 });
        if (archive.errors.length) console.warn("Archive sync reported issues", archive.errors);
        const purge = await purgeExpiredTemporary(env);
        if (purge.errors.length) console.warn("Temporary retention purge reported issues", purge.errors);
      } catch (error) { maintenance.push(["archive", error]); }
    }
    for (const [component, error] of maintenance) {
      console.error(`Scheduled ${component} maintenance failed`, error);
      // The error-log component CHECK predates forecasting, so reconciliation failures are logged under "scheduled".
      const logged = component === "forecasting" ? "scheduled" : component as "summary_cache" | "archive";
      await logOperationalError(env.DB, logged, component === "forecasting" ? "forecasting" : null, error instanceof Error ? error.message : String(error));
    }
    for (const error of errors) {
      await logOperationalError(env.DB, "scheduled", null, error instanceof Error ? error.message : String(error));
    }
    if (errors.length) throw new AggregateError(errors, "Source refresh schedule failed.");
  },
};

export { app };

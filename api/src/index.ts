import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { buildReferenceSeries, percentageChange, type Observation } from "./domain/analytics";
import { MONTHLY_METHOD, previousMonth, refreshMonthly, validMonth } from "./monthly";
import { cooperativeRoutes } from "./cooperative-routes";
import { refreshMamcos } from "./cooperative";
import { historyRoutes, monthRange } from "./history";
import { decisionRoutes } from "./decisions";
import { intelligenceRoutes, refreshSirsiWeather, refreshPib } from "./intelligence-routes";
import { forecastRoutes } from "./forecast";

export type Env = {
  Bindings: {
    DB: D1Database;
    CORS_ORIGIN?: string;
    INGESTION_TOKEN?: string;
    ADMIN_TOKEN?: string;
    MIN_INDEX_MARKETS?: string;
    REFERENCE_STATE?: string;
    MAMCOS_SCHEDULE_ENABLED?: string;
    INTELLIGENCE_SCHEDULE_ENABLED?: string;
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
}).refine((record) =>
  record.validation_status === "review_required"
  || (record.minimum_price <= record.maximum_price
    && record.modal_price >= record.minimum_price
    && record.modal_price <= record.maximum_price),
{ message: "Prices must satisfy minimum ≤ modal ≤ maximum." });

const importSchema = z.object({
  source_key: z.enum(["agmarknet", "agmarknet_csv"]),
  records: z.array(priceRecordSchema).min(1).max(500),
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
  return Boolean(token && header === `Bearer ${token}`);
}

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
app.route("/", intelligenceRoutes);
app.route("/", forecastRoutes);

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
    return c.json(result);
  } catch (error) {
    console.error("Monthly refresh failed", error);
    return c.json({ error: "Monthly refresh failed. Existing prices were preserved; see monthly refresh status for details." }, 502);
  }
});

app.get("/markets", async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT DISTINCT m.id, m.name, m.district, m.state
     FROM markets m
     JOIN market_price_observations o ON o.market_id = m.id
     WHERE o.validation_status = 'verified' AND m.mapping_status = 'verified' AND m.state = ?
     ORDER BY m.district, m.name`,
  ).bind(c.env.REFERENCE_STATE ?? "Karnataka").all<{ id: string; name: string; district: string; state: string }>();
  return c.json({ data: result.results });
});

app.get("/varieties", async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT DISTINCT variety_name
     FROM market_price_observations
     JOIN markets m ON m.id = market_price_observations.market_id
     WHERE validation_status = 'verified' AND m.mapping_status = 'verified' AND m.state = ?
     ORDER BY variety_name`,
  ).bind(c.env.REFERENCE_STATE ?? "Karnataka").all<{ variety_name: string }>();
  return c.json({ data: result.results.map((row) => row.variety_name) });
});

app.get("/prices", async (c) => {
  const limit = boundedInteger(c.req.query("limit"), 200, 1, 1000);
  const offset = boundedInteger(c.req.query("offset"), 0, 0, 2_000_000);
  if (limit === null) return c.json({ error: "limit must be an integer from 1 to 1000." }, 400);
  if (offset === null) return c.json({ error: "offset must be an integer from 0 to 2000000." }, 400);
  const filters: string[] = ["o.validation_status = 'verified'", "m.mapping_status = 'verified'", "m.state = ?"];
  const values: (string | number)[] = [c.env.REFERENCE_STATE ?? "Karnataka"];
  const exactFilters: [string, string | undefined][] = [
    ["o.market_id = ?", c.req.query("market_id")],
    ["o.variety_name = ?", c.req.query("variety")],
    ["m.district = ?", c.req.query("district")],
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
    filters.push("(m.name LIKE ? OR m.district LIKE ? OR o.variety_name LIKE ?)");
    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const where = filters.join(" AND ");
  const [rows, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT o.id, o.reporting_date, o.market_id, m.name AS market_name, m.district,
              o.variety_name, o.minimum_price, o.maximum_price, o.modal_price,
              o.arrival_quantity, o.arrival_unit, o.price_unit, s.name AS source_name,
              o.source_record_id, o.ingested_at AS ingestion_timestamp
       FROM market_price_observations o
       JOIN markets m ON m.id = o.market_id
       JOIN data_sources s ON s.id = o.source_id
       WHERE ${where}
       ORDER BY o.reporting_date DESC, m.name ASC
       LIMIT ? OFFSET ?`,
    ).bind(...values, limit, offset).all<Observation>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM market_price_observations o
       JOIN markets m ON m.id = o.market_id
       WHERE ${where}`,
    ).bind(...values).first<{ count: number }>(),
  ]);
  return c.json({ data: rows.results, count: count?.count ?? 0 });
});

async function verifiedObservations(
  db: D1Database,
  variety: string | undefined,
  from: string | undefined,
  to: string | undefined,
  state: string,
): Promise<Observation[]> {
  const filters = ["o.validation_status = 'verified'", "m.mapping_status = 'verified'", "m.state = ?"];
  const values: string[] = [state];
  if (variety) {
    filters.push("o.variety_name = ?");
    values.push(variety);
  }
  if (from) {
    filters.push("o.reporting_date >= ?");
    values.push(from);
  }
  if (to) {
    filters.push("o.reporting_date <= ?");
    values.push(to);
  }
  const result = await db.prepare(
    `SELECT o.id, o.reporting_date, o.market_id, m.name AS market_name, m.district,
            o.variety_name, o.minimum_price, o.maximum_price, o.modal_price,
            o.arrival_quantity, o.arrival_unit, o.price_unit, s.name AS source_name,
            o.source_record_id, o.ingested_at AS ingestion_timestamp
     FROM market_price_observations o
     JOIN markets m ON m.id = o.market_id
     JOIN data_sources s ON s.id = o.source_id
     WHERE ${filters.join(" AND ")}
     ORDER BY o.reporting_date DESC, o.ingested_at DESC, o.id`,
  ).bind(...values).all<Observation>();
  return result.results;
}

app.get("/analytics/reference-index", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if ((from && !parseDate(from)) || (to && !parseDate(to))) {
    return c.json({ error: "Dates must use YYYY-MM-DD format." }, 400);
  }
  if (from && to && from > to) return c.json({ error: "'from' date must not be after 'to' date." }, 400);
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
  const observations = await verifiedObservations(c.env.DB, variety, from, to, c.env.REFERENCE_STATE ?? "Karnataka");
  return c.json({
    data: buildReferenceSeries(observations, coverage),
    minimum_market_coverage: coverage,
    methodology: `For each reporting date, take the median of one verified modal price per market for the exact reported variety "${variety}". Dates with fewer than ${coverage} verified markets are withheld. No arrival weighting or variety mapping is applied.`,
  });
});

app.get("/analytics/market-comparison", async (c) => {
  const variety = c.req.query("variety");
  if (!variety) return c.json({ data: [], reason: "Select a reported variety to compare markets." });
  const result = await c.env.DB.prepare(
    `WITH ranked AS (
       SELECT o.id, o.reporting_date, o.market_id, m.name AS market_name, m.district,
              o.variety_name, o.minimum_price, o.maximum_price, o.modal_price,
              o.arrival_quantity, o.arrival_unit, o.price_unit, s.name AS source_name,
              o.source_record_id, o.ingested_at AS ingestion_timestamp,
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
     )
     SELECT id, reporting_date, market_id, market_name, district, variety_name,
            minimum_price, maximum_price, modal_price, arrival_quantity, arrival_unit,
            price_unit, source_name, source_record_id, ingestion_timestamp
     FROM ranked
     WHERE row_num = 1
     ORDER BY modal_price DESC, market_name ASC`,
  ).bind(c.env.REFERENCE_STATE ?? "Karnataka", variety).all<Observation>();
  return c.json({ data: result.results });
});

app.get("/overview", async (c) => {
  const variety = c.req.query("variety");
  const coverage = minimumCoverage(c.env.MIN_INDEX_MARKETS);
  if (!variety) {
    return c.json({
      data: {
        latest_reporting_date: null,
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
  const observations = await verifiedObservations(c.env.DB, variety, undefined, undefined, c.env.REFERENCE_STATE ?? "Karnataka");
  const series = buildReferenceSeries(observations, coverage);
  const latestDate = observations[0]?.reporting_date ?? null;
  const latest = series.at(-1) ?? null;
  const previous = series.filter((point) => latestDate !== null && point.reporting_date < latestDate).at(-1) ?? null;
  const comparableByMarket = new Map<string, Observation>();
  if (latestDate) {
    for (const row of observations.filter((item) => item.reporting_date === latestDate)) {
      const current = comparableByMarket.get(row.market_id);
      if (!current || row.ingestion_timestamp > current.ingestion_timestamp) comparableByMarket.set(row.market_id, row);
    }
  }
  const comparable = [...comparableByMarket.values()];
  const sorted = [...comparable].sort((a, b) => a.modal_price - b.modal_price);
  const currentPrice = latest?.reporting_date === latestDate ? latest.median_modal_price : null;
  const previousPrice = previous?.median_modal_price ?? null;
  const absoluteChange = currentPrice !== null && previousPrice !== null ? currentPrice - previousPrice : null;
  return c.json({
    data: {
      latest_reporting_date: latestDate,
      reference_price: currentPrice,
      previous_reference_price: previousPrice,
      absolute_change: absoluteChange,
      percent_change: percentageChange(currentPrice, previousPrice),
      reporting_markets: comparable.length,
      market_coverage_required: coverage,
      index_status: !observations.length ? "no_data" : currentPrice === null ? "insufficient_coverage" : "available",
      highest_market: sorted.length ? { market_name: sorted.at(-1)!.market_name, modal_price: sorted.at(-1)!.modal_price } : null,
      lowest_market: sorted.length ? { market_name: sorted[0].market_name, modal_price: sorted[0].modal_price } : null,
      source_count: new Set(comparable.map((row) => row.source_name)).size,
    },
  });
});

app.get("/admin/quality", async (c) => {
  if (!isAuthorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) {
    return c.json({ error: "A valid reviewer token is required." }, 401);
  }
  const result = await c.env.DB.prepare(
    `SELECT o.id, o.reporting_date, m.name AS market_name, m.district, m.state, o.variety_name,
            o.minimum_price, o.maximum_price, o.modal_price, o.price_unit,
            s.name AS source_name, o.source_record_id, o.validation_status, o.validation_message,
            o.raw_payload, o.original_unit, o.ingested_at
     FROM market_price_observations o
     JOIN markets m ON m.id = o.market_id
     JOIN data_sources s ON s.id = o.source_id
     WHERE o.validation_status IN ('validated', 'review_required')
     ORDER BY o.reporting_date DESC, o.ingested_at DESC
     LIMIT 500`,
  ).all();
  return c.json({ data: result.results, count: result.results.length });
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
  const jobId = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO ingestion_jobs (id, source_id, status, received_count) VALUES (?, ?, 'running', ?)",
  ).bind(jobId, source.id, parsed.data.records.length).run();
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
             validation_message, raw_payload
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        "UPDATE ingestion_jobs SET status = 'completed', inserted_count = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).bind(insertedCount, jobId),
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
    return c.json({ error: "Import failed; completed batches remain recorded in the ingestion job.", job_id: jobId, inserted_count: insertedCount }, 500);
  }
  return c.json({
    job_id: jobId,
    received_count: parsed.data.records.length,
    inserted_count: insertedCount,
    duplicate_count: duplicateCount,
    corrected_count: correctedCount,
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

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env["Bindings"], _ctx: ExecutionContext) {
    const now = new Date();
    const errors: unknown[] = [];
    if (env.INTELLIGENCE_SCHEDULE_ENABLED === "true") {
      try { await refreshSirsiWeather(env.DB); }
      catch (error) { console.error("Scheduled Sirsi weather refresh failed", error); errors.push(error); }
      try {
        const result = await refreshPib(env.DB);
        if (result.failures.length) throw new Error(result.failures.join("; "));
      } catch (error) { console.error("Scheduled official bulletin refresh failed", error); errors.push(error); }
    }
    if (env.MAMCOS_SCHEDULE_ENABLED === "true") {
      try { await refreshMamcos(env.DB); }
      catch (error) { console.error("Scheduled MAMCOS refresh failed", error); errors.push(error); }
    }
    for (const offset of [2, 1]) {
      try {
        await refreshMonthly(env.DB, previousMonth(now, offset), env.REFERENCE_STATE ?? "Karnataka");
      } catch (error) {
        console.error("Scheduled monthly refresh failed", error);
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, "Source refresh schedule failed.");
  },
};

export { app };

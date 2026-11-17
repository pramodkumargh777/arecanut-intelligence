/**
 * AGMARKNET 2.0 market-wise wholesale arrivals (weekly and monthly reports), filled by
 * data-platform/connectors/agmarknet_v2/arrivals.py. See docs/AGMARKNET_V2_ARRIVALS.md.
 *
 * Kept apart from every price path: rows go only to agmarknet_v2_fetches and market_arrival_periods (migration 0026),
 * never to market_price_observations or market_arrivals, so the reference index and the daily arrival imports are
 * untouched. The import stores each source response verbatim and accepts a record only if the stored response itself
 * carries that value for that market and period.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./index";
import { bearerMatches } from "./auth";
import { daysBetween, isCalendarDate, istDate, toTonnes } from "./supply";

export const AGMARKNET_V2_ARRIVALS_SOURCE = "agmarknet_v2_arrivals";
export const AGMARKNET_V2_SOURCE_ID = "source-agmarknet-v2-arrivals";
export const AGMARKNET_V2_SOURCE_NAME = "AGMARKNET monthly arrivals report";
export const AGMARKNET_V2_SOURCE_URL = "https://agmarknet.gov.in/";
/** AGMARKNET 2.0 go-live, from the source's own filter notes. */
export const AGMARKNET_V2_GO_LIVE = "2025-11-07";
export const MAX_FETCHES_PER_IMPORT = 5;
const ENDPOINTS = ["wholesale-arrivals-monthly", "wholesale-arrivals-weekly"] as const;
const API_PREFIX = "https://api.agmarknet.gov.in/v1/price-trend/";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const pad = (value: number) => String(value).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** AGMARKNET's month-relative weeks: 1-8, 9-15, 16-23 and 24 to month end. */
export function agmarknetWeek(year: number, month: number, week: number) {
  const bounds = [[1, 8], [9, 15], [16, 23], [24, lastDay(year, month)]][week - 1];
  if (!bounds) throw new Error("AGMARKNET weeks are numbered 1 to 4.");
  return { start: `${year}-${pad(month)}-${pad(bounds[0])}`, end: `${year}-${pad(month)}-${pad(bounds[1])}` };
}

export function expectedPeriod(endpoint: typeof ENDPOINTS[number], year: number, month: number, week: number | null) {
  const monthName = MONTHS[month - 1];
  if (endpoint === "wholesale-arrivals-monthly") {
    const title = monthName[0].toUpperCase() + monthName.slice(1);
    return { period_type: "month" as const, period_week: null, start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(lastDay(year, month))}`,
      column_key: `arrivals_${monthName}_${year}`, label_prefix: `Arrivals ${title}, ${year} (`, title_suffix: `${title}, ${year}` };
  }
  const { start, end } = agmarknetWeek(year, month, week ?? 0);
  const abbreviation = monthName.slice(0, 3);
  const [from, to] = [Number(start.slice(8)), Number(end.slice(8))];
  const fullName = monthName[0].toUpperCase() + monthName.slice(1);
  return { period_type: "agm_week" as const, period_week: week, start, end, column_key: `arrivals_${from}_${to}_${abbreviation}_${year}`,
    label_prefix: `Arrivals ${from}-${to} ${abbreviation[0].toUpperCase()}${abbreviation.slice(1)} ${year} (`, title_suffix: `Week ${week} of ${fullName}, ${year}` };
}

const sha256Hex = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");

const day = z.string().refine(isCalendarDate, "Must be a YYYY-MM-DD calendar date.");
const recordSchema = z.object({
  source_commodity_name: z.string().trim().min(1).max(120),
  state: z.string().trim().min(2).max(80),
  source_district_name: z.string().trim().min(1).max(120),
  source_market_name: z.string().min(1).max(200),
  period_type: z.enum(["month", "agm_week"]),
  period_start: day,
  period_end: day,
  period_week: z.number().int().min(1).max(4).nullable(),
  source_period_label: z.string().min(1).max(200),
  source_column_key: z.string().regex(/^arrivals_[a-z0-9_]+$/).max(80),
  value_status: z.enum(["reported", "not_reported"]),
  quantity_original: z.number().finite().nonnegative().nullable(),
  unit_original: z.string().min(1).max(40),
  quantity_tonnes: z.number().finite().nonnegative().nullable(),
}).strict();
const paramsSchema = z.object({
  report_mode: z.literal("Marketwise"),
  commodity: z.string().regex(/^\d{1,6}$/),
  year: z.string().regex(/^\d{4}$/),
  month: z.string().regex(/^(?:[1-9]|1[0-2])$/),
  week: z.string().regex(/^[1-4]$/).optional(),
  state: z.string().regex(/^\d{1,6}$/),
  district: z.string().regex(/^\d{1,6}$/),
}).strict();
const fetchSchema = z.object({
  endpoint: z.enum(ENDPOINTS),
  request_url: z.string().url().max(500),
  request_params: paramsSchema,
  http_status: z.literal(200),
  content_type: z.string().max(100).refine((value) => value.toLowerCase().includes("application/json"), "Only JSON responses are accepted."),
  response_body: z.string().min(2).max(200_000),
  fetched_at: z.string().datetime({ offset: true }),
  parser_version: z.string().trim().min(1).max(40),
  records: z.array(recordSchema).max(60),
}).strict();
const importSchema = z.object({ fetches: z.array(fetchSchema).min(1).max(MAX_FETCHES_PER_IMPORT) }).strict();
type FetchInput = z.infer<typeof fetchSchema>;
type RecordInput = z.infer<typeof recordSchema>;

type SourceResponse = { success?: unknown; title?: unknown; data?: { key?: string; columns?: { key?: string; title?: string }[] }[]; rows?: Record<string, unknown>[] };

/** Every problem with one fetch, checked against the stored response itself. Empty when the fetch can be stored. */
export function fetchProblems(input: FetchInput, today: string): string[] {
  const problems: string[] = [];
  const params = input.request_params;
  let url: URL;
  try { url = new URL(input.request_url); } catch { return ["request_url is not a URL."]; }
  if (`${url.origin}${url.pathname}` !== `${API_PREFIX}${input.endpoint}`) problems.push("request_url does not match the endpoint.");
  const query = Object.fromEntries(url.searchParams.entries());
  if (JSON.stringify(Object.entries(query).sort()) !== JSON.stringify(Object.entries(params).sort())) problems.push("request_url parameters do not match request_params.");
  if ((input.endpoint === "wholesale-arrivals-weekly") !== (params.week !== undefined)) problems.push("Only weekly requests carry a week.");
  if (problems.length) return problems;
  const period = expectedPeriod(input.endpoint, Number(params.year), Number(params.month), params.week ? Number(params.week) : null);
  if (period.end >= today) problems.push(`Period ${period.start} to ${period.end} has not closed (IST); open periods are partial totals.`);
  let body: SourceResponse;
  try { body = JSON.parse(input.response_body) as SourceResponse; } catch { return [...problems, "response_body is not JSON."]; }
  if (body.success !== true) return [...problems, "The source did not report success."];
  if (typeof body.title !== "string" || !body.title.trimEnd().endsWith(period.title_suffix)) {
    return [...problems, `Report title is not for ${period.title_suffix}.`];
  }
  // The first arrivals column is the report's own period; later ones are comparison periods.
  const column = (body.data ?? []).flatMap((group) => group.columns ?? []).find((item) => item.key?.startsWith("arrivals_"));
  if (column?.key !== period.column_key || !column.title?.startsWith(period.label_prefix)) {
    return [...problems, `The response's current column is not ${period.column_key}.`];
  }
  const unit = /\(([^()]+)\)\s*$/.exec(column.title)?.[1];
  if (unit !== "Metric Tonnes") problems.push(`Unit "${unit ?? "missing"}" is not the verified "Metric Tonnes".`);
  const rows = (body.rows ?? []).filter((row) => typeof row.market === "string" && row.market.trim() !== "Total");
  const byMarket = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) byMarket.set(row.market as string, [...(byMarket.get(row.market as string) ?? []), row]);
  for (const [market, list] of byMarket) {
    if (new Set(list.map((row) => JSON.stringify(row[period.column_key] ?? null))).size > 1) problems.push(`${market} appears twice with different values.`);
  }
  if (input.records.length !== byMarket.size) problems.push(`The response lists ${byMarket.size} market(s) but ${input.records.length} record(s) were sent.`);
  const seen = new Set<string>();
  for (const record of input.records) {
    const label = record.source_market_name;
    if (seen.has(label)) { problems.push(`${label} was sent twice.`); continue; }
    seen.add(label);
    if (record.period_type !== period.period_type || record.period_start !== period.start || record.period_end !== period.end
      || record.period_week !== period.period_week) problems.push(`${label}: period does not match the request.`);
    if (record.source_column_key !== column.key || record.source_period_label !== column.title) problems.push(`${label}: column does not match the response.`);
    if (record.unit_original !== unit) problems.push(`${label}: unit does not match the response.`);
    const row = byMarket.get(label)?.[0];
    if (!row) { problems.push(`${label}: market is not in the response.`); continue; }
    const value = row[period.column_key];
    if (value === null || value === undefined) {
      if (record.value_status !== "not_reported" || record.quantity_original !== null || record.quantity_tonnes !== null) problems.push(`${label}: the source reports no value.`);
    } else if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      problems.push(`${label}: source value ${JSON.stringify(value)} is not a non-negative number.`);
    } else if (record.value_status !== "reported" || record.quantity_original !== value) {
      problems.push(`${label}: quantity does not match the source value ${value}.`);
    } else if (record.quantity_tonnes !== toTonnes(value, unit ?? "").tonnes) {
      problems.push(`${label}: tonnes do not match the converted source value.`);
    }
  }
  return problems;
}

export const agmarknetV2ArrivalRoutes = new Hono<Env>();

/** What has been fetched, so the connector only asks the source for periods it has not stored yet. */
agmarknetV2ArrivalRoutes.get("/admin/agmarknet-v2/arrivals/coverage", async (c) => {
  if (!bearerMatches(c.req.header("Authorization"), c.env.INGESTION_TOKEN)) return c.json({ error: "A valid ingestion token is required." }, 401);
  const db = c.env.DB;
  const [fetched, stored] = await db.batch([
    db.prepare(`SELECT DISTINCT endpoint, json_extract(request_params, '$.state') AS state, json_extract(request_params, '$.district') AS district,
        json_extract(request_params, '$.year') AS year, json_extract(request_params, '$.month') AS month, json_extract(request_params, '$.week') AS week
      FROM agmarknet_v2_fetches ORDER BY endpoint, year, month, week, district`),
    db.prepare(`SELECT period_type, MIN(period_start) AS earliest, MAX(period_end) AS latest, COUNT(*) AS rows
      FROM market_arrival_periods_current GROUP BY period_type`),
  ]);
  return c.json({ fetched: fetched.results, stored: stored.results });
});

agmarknetV2ArrivalRoutes.post("/admin/agmarknet-v2/arrivals/import", async (c) => {
  if (!bearerMatches(c.req.header("Authorization"), c.env.INGESTION_TOKEN)) return c.json({ error: "A valid ingestion token is required." }, 401);
  if (c.env.AGMARKNET_V2_ARRIVALS_IMPORT_ENABLED === "false") return c.json({ error: "AGMARKNET 2.0 arrival imports are switched off." }, 503);
  const parsed = importSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid AGMARKNET 2.0 arrivals import.", details: parsed.error.issues.slice(0, 20) }, 400);
  const today = istDate(new Date());
  const rejected = parsed.data.fetches.map((input, index) => ({ index, request_url: input.request_url, problems: fetchProblems(input, today) }))
    .filter((item) => item.problems.length);
  // All or nothing: a request with any inconsistent fetch stores nothing, so evidence and records never diverge.
  if (rejected.length) return c.json({ error: "Fetches do not match their source responses; nothing was stored.", rejected }, 422);
  const db = c.env.DB;
  const identity = (input: FetchInput, record: RecordInput) => [input.request_params.state, input.request_params.district, record.source_market_name,
    record.period_type, record.period_start].join("\u0000");
  const keys = parsed.data.fetches.flatMap((input) => input.records.map((record) => {
    const [state, district, market, type, start] = identity(input, record).split("\u0000");
    return { state: Number(state), district: Number(district), market, type, start };
  }));
  const latest = new Map<string, { version_number: number; value_status: string; quantity_original: number | null }>();
  if (keys.length) {
    const rows = await db.prepare(`SELECT p.source_state_id, p.source_district_id, p.source_market_name, p.period_type, p.period_start,
        p.version_number, p.value_status, p.quantity_original
      FROM json_each(?) k JOIN market_arrival_periods p ON p.source_key = ? AND p.source_state_id = json_extract(k.value, '$.state')
        AND p.source_district_id = json_extract(k.value, '$.district') AND p.source_market_name = json_extract(k.value, '$.market')
        AND p.period_type = json_extract(k.value, '$.type') AND p.period_start = json_extract(k.value, '$.start')
      WHERE p.version_number = (SELECT MAX(q.version_number) FROM market_arrival_periods q WHERE q.source_key = p.source_key
        AND q.source_state_id = p.source_state_id AND q.source_district_id = p.source_district_id AND q.source_market_name = p.source_market_name
        AND q.period_type = p.period_type AND q.period_start = p.period_start)`)
      .bind(JSON.stringify(keys), AGMARKNET_V2_ARRIVALS_SOURCE)
      .all<{ source_state_id: number; source_district_id: number; source_market_name: string; period_type: string; period_start: string;
        version_number: number; value_status: string; quantity_original: number | null }>();
    for (const row of rows.results) {
      latest.set([row.source_state_id, row.source_district_id, row.source_market_name, row.period_type, row.period_start].join("\u0000"), row);
    }
  }
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  let inserted = 0, duplicates = 0, revised = 0, newFetches = 0;
  for (const input of parsed.data.fetches) {
    const responseSha = await sha256Hex(input.response_body);
    const fetchId = await sha256Hex(`${input.request_url}\u0000${responseSha}`);
    const existingFetch = await db.prepare("SELECT 1 AS found FROM agmarknet_v2_fetches WHERE id = ?").bind(fetchId).first();
    if (!existingFetch) {
      newFetches += 1;
      const title = (() => { try { const value = (JSON.parse(input.response_body) as SourceResponse).title; return typeof value === "string" ? value.slice(0, 300) : null; } catch { return null; } })();
      statements.push(db.prepare(`INSERT OR IGNORE INTO agmarknet_v2_fetches (id, endpoint, request_url, request_params, http_status, content_type,
          response_sha256, response_bytes, response_body, source_title, parser_version, first_fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(fetchId, input.endpoint, input.request_url, JSON.stringify(input.request_params), input.http_status, input.content_type, responseSha,
          new TextEncoder().encode(input.response_body).length, input.response_body, title, input.parser_version, input.fetched_at));
    }
    for (const record of input.records) {
      const key = identity(input, record);
      const prior = latest.get(key);
      if (prior && prior.value_status === record.value_status && prior.quantity_original === record.quantity_original) { duplicates += 1; continue; }
      const version = (prior?.version_number ?? 0) + 1;
      if (prior) revised += 1; else inserted += 1;
      latest.set(key, { version_number: version, value_status: record.value_status, quantity_original: record.quantity_original });
      const id = await sha256Hex(JSON.stringify([AGMARKNET_V2_ARRIVALS_SOURCE, ...key.split("\u0000"), version, record.value_status, record.quantity_original]));
      statements.push(db.prepare(`INSERT INTO market_arrival_periods (id, source_key, fetch_id, commodity_code, source_commodity_id, source_commodity_name,
          state, source_state_id, source_district_id, source_district_name, source_market_name, period_type, period_start, period_end, period_week,
          source_period_label, source_column_key, value_status, quantity_original, unit_original, quantity_tonnes, unit_status, version_number, first_seen_at)
        VALUES (?, ?, ?, 'arecanut', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, AGMARKNET_V2_ARRIVALS_SOURCE, fetchId, Number(input.request_params.commodity), record.source_commodity_name, record.state,
          Number(input.request_params.state), Number(input.request_params.district), record.source_district_name, record.source_market_name,
          record.period_type, record.period_start, record.period_end, record.period_week, record.source_period_label, record.source_column_key,
          record.value_status, record.quantity_original, record.unit_original, record.quantity_tonnes,
          record.value_status === "reported" ? "converted" : "not_applicable", version, now));
    }
  }
  // D1 batches are atomic: either every new fetch and record of this request is stored, or none is.
  if (statements.length) await db.batch(statements);
  return c.json({ received_fetches: parsed.data.fetches.length, new_fetches: newFetches,
    received_records: parsed.data.fetches.reduce((sum, input) => sum + input.records.length, 0), inserted, revised, duplicates }, 201);
});

/** Run summaries in the shared source_ingestion_runs table, under this source only. */
const runSchema = z.object({
  mode: z.enum(["daily", "backfill", "replay"]),
  status: z.enum(["completed", "completed_with_rejections", "no_data", "failed"]),
  started_at: z.string().datetime({ offset: true }),
  completed_at: z.string().datetime({ offset: true }),
  request_filters: z.record(z.string().max(40), z.string().max(120)).default({}),
  fetched_count: z.number().int().nonnegative(),
  accepted_count: z.number().int().nonnegative(),
  rejected_count: z.number().int().nonnegative(),
  inserted_count: z.number().int().nonnegative(),
  duplicate_count: z.number().int().nonnegative(),
  corrected_count: z.number().int().nonnegative(),
  market_count: z.number().int().nonnegative(),
  reporting_dates: z.array(day).max(400),
  rejected_sample: z.array(z.object({ source_record_id: z.string().max(256).nullable(),
    reasons: z.array(z.object({ code: z.string().max(40), message: z.string().max(300), severity: z.string().max(10) })).max(10) })).max(25).default([]),
  error_message: z.string().max(1000).nullable(),
}).strict().refine((run) => run.started_at <= run.completed_at, { message: "started_at must not be after completed_at." });

agmarknetV2ArrivalRoutes.post("/admin/agmarknet-v2/arrivals/runs", async (c) => {
  if (!bearerMatches(c.req.header("Authorization"), c.env.INGESTION_TOKEN)) return c.json({ error: "A valid ingestion token is required." }, 401);
  const parsed = runSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid run payload.", details: parsed.error.issues.slice(0, 20) }, 400);
  const run = parsed.data, id = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO source_ingestion_runs (id, source_id, resource_id, mode, status, started_at, completed_at, request_filters,
      fetched_count, accepted_count, rejected_count, inserted_count, duplicate_count, corrected_count, market_count, reporting_dates, rejected_sample, error_message)
    VALUES (?, ?, 'v1/price-trend/wholesale-arrivals', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, AGMARKNET_V2_SOURCE_ID, run.mode, run.status, run.started_at, run.completed_at, JSON.stringify(run.request_filters), run.fetched_count,
      run.accepted_count, run.rejected_count, run.inserted_count, run.duplicate_count, run.corrected_count, run.market_count,
      JSON.stringify(run.reporting_dates), JSON.stringify(run.rejected_sample), run.error_message).run();
  return c.json({ id }, 201);
});

const MAX_PERIOD_RANGE_DAYS = { month: 6000, agm_week: 1100 } as const;

/** Public read of the stored periods with their provenance; AGMARKNET weeks are reported as published. */
agmarknetV2ArrivalRoutes.get("/supply/arrival-periods", async (c) => {
  const periodType = c.req.query("period_type") ?? "month";
  if (periodType !== "month" && periodType !== "agm_week") return c.json({ error: "period_type must be month or agm_week." }, 400);
  const to = c.req.query("to") ?? istDate(new Date());
  const from = c.req.query("from") ?? (periodType === "month" ? `${Number(to.slice(0, 4)) - 1}${to.slice(4, 7)}-01` : to.slice(0, 7) + "-01");
  if (!isCalendarDate(from) || !isCalendarDate(to)) return c.json({ error: "from and to must be YYYY-MM-DD calendar dates." }, 400);
  if (from > to) return c.json({ error: "from must not be after to." }, 400);
  if (daysBetween(from, to) > MAX_PERIOD_RANGE_DAYS[periodType]) return c.json({ error: `Date ranges are limited to ${MAX_PERIOD_RANGE_DAYS[periodType]} days.` }, 400);
  const state = c.req.query("state") ?? "Karnataka", district = c.req.query("district"), market = c.req.query("market");
  const filters = ["p.commodity_code = 'arecanut'", "p.state = ?", "p.period_type = ?", "p.period_start >= ?", "p.period_end <= ?"];
  const args: (string | number)[] = [state, periodType, from, to];
  if (district) { filters.push("p.district = ?"); args.push(district); }
  if (market) { filters.push("p.market = ?"); args.push(market); }
  const rows = await c.env.DB.prepare(`SELECT p.district, p.market, p.source_district_name, p.source_market_name, p.mapping_status, p.market_id,
      p.period_type, p.period_start, p.period_end, p.period_week, p.source_period_label, p.value_status, p.quantity_original, p.unit_original,
      p.quantity_tonnes, p.version_number, p.era, f.request_url AS source_request_url, f.first_fetched_at AS fetched_at
    FROM market_arrival_periods_current p JOIN agmarknet_v2_fetches f ON f.id = p.fetch_id
    WHERE ${filters.join(" AND ")} ORDER BY p.period_start, p.district, p.market LIMIT 5000`).bind(...args).all();
  return c.json({
    commodity: "arecanut", state, period_type: periodType, requested_range: { from, to }, unit: "tonnes (source: Metric Tonnes)",
    source: { key: AGMARKNET_V2_ARRIVALS_SOURCE, name: AGMARKNET_V2_SOURCE_NAME, url: AGMARKNET_V2_SOURCE_URL, publisher: "Directorate of Marketing & Inspection" },
    periods: rows.results,
    notes: [
      "Only closed periods are stored; the source's current month and week are partial totals.",
      "AGMARKNET weeks are month-relative (days 1-8, 9-15, 16-23 and 24 to month end), not Monday weeks, and differ in length.",
      `AGMARKNET 2.0 went live on ${AGMARKNET_V2_GO_LIVE}; October 2025 is under-reported in every market (era "cutover"), so comparisons across it are not like for like.`,
      "value_status not_reported means the market published no figure for the period; it is not zero.",
    ],
  });
});

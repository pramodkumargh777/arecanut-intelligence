import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./index";
import { bearerMatches } from "./auth";

export const sourceStatusRoutes = new Hono<Env>();
const STATUS_SOURCES = ["agmarknet", "agmarknet_csv"] as const;
const authorized = (header: string | undefined, token: string | undefined) => bearerMatches(header, token);
const count = z.number().int().nonnegative().max(10_000_000);
const isoTimestamp = z.string().datetime({ offset: true });
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const sourceRunSchema = z.object({
  source_key: z.enum(STATUS_SOURCES),
  resource_id: z.string().trim().min(1).max(64).nullable(),
  mode: z.enum(["daily", "backfill", "csv", "replay"]),
  status: z.enum(["completed", "completed_with_rejections", "no_data", "failed"]),
  started_at: isoTimestamp,
  completed_at: isoTimestamp,
  source_updated_at: isoTimestamp.nullable().optional(),
  request_filters: z.record(z.string().max(40), z.string().max(120)).nullable().optional(),
  source_total: count.nullable().optional(),
  fetched_count: count,
  out_of_scope_count: count.default(0),
  accepted_count: count,
  review_required_count: count,
  rejected_count: count,
  inserted_count: count,
  duplicate_count: count,
  corrected_count: count,
  market_count: count,
  reporting_dates: z.array(calendarDate).max(400),
  import_job_ids: z.array(z.string().uuid()).max(2_000),
  rejected_sample: z.array(z.object({
    source_record_id: z.string().max(256).nullable(),
    reasons: z.array(z.object({ code: z.string().max(40), message: z.string().max(300), severity: z.string().max(10) })).max(10),
  })).max(25),
  error_message: z.string().max(1_000).nullable(),
}).refine((run) => run.started_at <= run.completed_at, { message: "started_at must not be after completed_at." });

sourceStatusRoutes.post("/admin/source-runs", async (c) => {
  if (!authorized(c.req.header("Authorization"), c.env.INGESTION_TOKEN)) {
    return c.json({ error: "A valid ingestion token is required." }, 401);
  }
  const parsed = sourceRunSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid source run payload.", details: parsed.error.issues }, 400);
  const run = parsed.data;
  const source = await c.env.DB.prepare("SELECT id FROM data_sources WHERE source_key = ?")
    .bind(run.source_key).first<{ id: string }>();
  if (!source) return c.json({ error: "Unknown source." }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO source_ingestion_runs (id, source_id, resource_id, mode, status, started_at, completed_at,
       source_updated_at, request_filters, source_total, fetched_count, out_of_scope_count, accepted_count,
       review_required_count, rejected_count, inserted_count, duplicate_count, corrected_count, market_count,
       reporting_dates, import_job_ids, rejected_sample, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, source.id, run.resource_id, run.mode, run.status, run.started_at, run.completed_at,
    run.source_updated_at ?? null, JSON.stringify(run.request_filters ?? {}), run.source_total ?? null,
    run.fetched_count, run.out_of_scope_count, run.accepted_count, run.review_required_count, run.rejected_count,
    run.inserted_count, run.duplicate_count, run.corrected_count, run.market_count,
    JSON.stringify(run.reporting_dates), JSON.stringify(run.import_job_ids), JSON.stringify(run.rejected_sample),
    run.error_message,
  ).run();
  return c.json({ id }, 201);
});

type RunRow = Record<string, unknown> & { source_key: string; request_filters: string; reporting_dates: string; import_job_ids: string; rejected_sample: string };

sourceStatusRoutes.get("/admin/source-status", async (c) => {
  if (!authorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) {
    return c.json({ error: "A valid reviewer token is required." }, 401);
  }
  const state = c.env.REFERENCE_STATE ?? "Karnataka";
  const [sources, observations, latest, runs] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT id, source_key, name, source_type, is_enabled FROM data_sources
      WHERE source_key IN (?, ?) ORDER BY source_key`).bind(...STATUS_SOURCES),
    c.env.DB.prepare(`SELECT s.source_key, o.validation_status, COUNT(*) AS count
      FROM market_price_observations o JOIN data_sources s ON s.id = o.source_id
      WHERE s.source_key IN (?, ?) GROUP BY s.source_key, o.validation_status`).bind(...STATUS_SOURCES),
    // Narrow projection (no raw payloads) and one aggregate pass instead of correlated re-scans.
    c.env.DB.prepare(`WITH current AS (
        SELECT s.source_key, o.reporting_date, o.market_id, o.platform_fetched_at, o.ingested_at FROM market_price_observations o
        JOIN data_sources s ON s.id = o.source_id JOIN markets m ON m.id = o.market_id
        WHERE s.source_key IN (?, ?) AND m.state = ? AND o.validation_status != 'superseded'
      ), stats AS (SELECT source_key, MAX(reporting_date) AS latest, MIN(reporting_date) AS earliest,
          COUNT(DISTINCT reporting_date) AS dates FROM current GROUP BY source_key)
      SELECT st.source_key, st.latest AS latest_reporting_date,
        COUNT(*) AS latest_date_observations, COUNT(DISTINCT c.market_id) AS latest_date_markets,
        MAX(c.platform_fetched_at) AS latest_platform_fetch, MAX(c.ingested_at) AS latest_ingested_at,
        st.dates AS reporting_date_count, st.earliest AS earliest_reporting_date
      FROM stats st JOIN current c ON c.source_key = st.source_key AND c.reporting_date = st.latest
      GROUP BY st.source_key`).bind(...STATUS_SOURCES, state),
    c.env.DB.prepare(`SELECT r.id, s.source_key, r.resource_id, r.mode, r.status, r.started_at, r.completed_at,
        r.source_updated_at, r.request_filters, r.source_total, r.fetched_count, r.out_of_scope_count, r.accepted_count,
        r.review_required_count, r.rejected_count, r.inserted_count, r.duplicate_count, r.corrected_count,
        r.market_count, r.reporting_dates, r.import_job_ids, r.rejected_sample, r.error_message
      FROM source_ingestion_runs r JOIN data_sources s ON s.id = r.source_id
      ORDER BY r.completed_at DESC LIMIT 10`),
  ]);
  const parseRun = (row: RunRow) => ({
    ...row,
    request_filters: JSON.parse(row.request_filters),
    reporting_dates: JSON.parse(row.reporting_dates),
    import_job_ids: JSON.parse(row.import_job_ids),
    rejected_sample: JSON.parse(row.rejected_sample),
  });
  const statusCounts = observations.results as { source_key: string; validation_status: string; count: number }[];
  const latestRows = latest.results as Record<string, unknown>[];
  const recentRuns = (runs.results as RunRow[]).map(parseRun);
  return c.json({
    reference_state: state,
    sources: (sources.results as { source_key: string }[]).map((source) => ({
      ...source,
      observation_counts: Object.fromEntries(statusCounts.filter((row) => row.source_key === source.source_key)
        .map((row) => [row.validation_status, row.count])),
      coverage: latestRows.find((row) => row.source_key === source.source_key) ?? null,
      last_run: recentRuns.find((run) => run.source_key === source.source_key) ?? null,
    })),
    recent_runs: recentRuns,
    limitations: [
      "The data.gov.in current-daily resource returns only the latest arrival date; history accumulates only from scheduled runs, archived replays or official CSV exports.",
      "The resource publishes no price unit, arrival quantity or record identifier. The unit is an operator-confirmed configuration and record IDs are derived from the market/variety/grade/date key.",
    ],
  });
});

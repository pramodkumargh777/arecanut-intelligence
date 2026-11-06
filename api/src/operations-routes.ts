import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./index";
import {
  ARCHIVE_CATEGORIES, ArchiveUnavailableError, MAX_UPLOAD_BYTES, archiveConfigured, archiveReadMessage, archiveStatus,
  purgeExpiredTemporary, putArchiveObject, readArchiveRow, syncArchive, type ArchiveCategory, type ArchiveRow,
} from "./archive";
import { rebuildSummaries } from "./summaries";
import { resolveCommodity } from "./commodity-routes";
import { bearerMatches } from "./auth";

/** Reviewer-only operational endpoints: ingestion jobs, error log, storage/archive and reprocessing controls. */
export const operationsRoutes = new Hono<Env>();

operationsRoutes.use("/admin/*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const owned = ["/admin/ingestion/", "/admin/operations/", "/admin/storage/", "/admin/summaries/", "/admin/archive/", "/admin/retention/"]
    .some((prefix) => path.includes(prefix));
  if (owned && (!bearerMatches(c.req.header("Authorization"), c.env.ADMIN_TOKEN))) {
    return c.json({ error: "A valid reviewer token is required." }, 401);
  }
  await next();
});

function page(c: { req: { query: (key: string) => string | undefined } }, fallback = 50, maximum = 200) {
  const limit = Number(c.req.query("limit") ?? fallback);
  const offset = Number(c.req.query("offset") ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) return null;
  return { limit, offset };
}

operationsRoutes.get("/admin/ingestion/jobs", async (c) => {
  const paging = page(c);
  if (!paging) return c.json({ error: "limit must be 1-200 and offset a non-negative integer." }, 400);
  const status = c.req.query("status");
  if (status && !["running", "completed", "failed"].includes(status)) return c.json({ error: "Unknown job status." }, 400);
  const where = status ? "WHERE j.status = ?" : "";
  const values = status ? [status] : [];
  const [rows, total] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(`SELECT j.id, s.source_key, j.status, j.received_count, j.inserted_count, j.duplicate_count, j.corrected_count,
        j.error_message, j.started_at, j.completed_at, j.idempotency_key, j.content_sha256, j.source_file_name, j.reprocess_of
      FROM ingestion_jobs j JOIN data_sources s ON s.id = j.source_id ${where}
      ORDER BY j.started_at DESC, j.id LIMIT ? OFFSET ?`).bind(...values, paging.limit, paging.offset),
    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM ingestion_jobs j ${where}`).bind(...values),
  ]);
  return c.json({ data: rows.results, total: Number(total.results[0]?.total ?? 0), ...paging });
});

operationsRoutes.get("/admin/ingestion/jobs/:id", async (c) => {
  const [job, logs, observations] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(`SELECT j.*, s.source_key FROM ingestion_jobs j JOIN data_sources s ON s.id = j.source_id WHERE j.id = ?`).bind(c.req.param("id")),
    c.env.DB.prepare("SELECT level, message, created_at FROM ingestion_job_logs WHERE job_id = ? ORDER BY created_at, id LIMIT 200").bind(c.req.param("id")),
    c.env.DB.prepare(`SELECT validation_status, COUNT(*) AS count FROM market_price_observations WHERE ingestion_job_id = ?
      GROUP BY validation_status ORDER BY validation_status`).bind(c.req.param("id")),
  ]);
  if (!job.results.length) return c.json({ error: "Ingestion job not found." }, 404);
  return c.json({ job: job.results[0], logs: logs.results, observations_by_status: observations.results });
});

operationsRoutes.get("/admin/operations/errors", async (c) => {
  const paging = page(c);
  if (!paging) return c.json({ error: "limit must be 1-200 and offset a non-negative integer." }, 400);
  const component = c.req.query("component");
  if (component && !["scheduled", "archive", "retention", "import", "summary_cache"].includes(component)) {
    return c.json({ error: "Unknown component." }, 400);
  }
  const where = component ? "WHERE component = ?" : "";
  const values = component ? [component] : [];
  const [rows, total] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(`SELECT id, occurred_at, component, source_key, message, detail_json FROM operational_errors ${where}
      ORDER BY occurred_at DESC, id LIMIT ? OFFSET ?`).bind(...values, paging.limit, paging.offset),
    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM operational_errors ${where}`).bind(...values),
  ]);
  return c.json({ data: rows.results, total: Number(total.results[0]?.total ?? 0), ...paging });
});

operationsRoutes.get("/admin/storage/status", async (c) => {
  const [tables, cache] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(`SELECT (SELECT COUNT(*) FROM market_price_observations) AS market_price_observations,
      (SELECT COUNT(*) FROM cooperative_quotes) AS cooperative_quotes, (SELECT COUNT(*) FROM monthly_price_versions) AS monthly_price_versions,
      (SELECT COUNT(*) FROM ingestion_jobs) AS ingestion_jobs, (SELECT COUNT(*) FROM archive_objects) AS archive_objects`),
    c.env.DB.prepare(`SELECT (SELECT COUNT(*) FROM market_daily_summaries) AS summary_rows,
      (SELECT COUNT(*) FROM market_summary_dirty) AS dirty_dates, (SELECT MAX(refreshed_at) FROM market_daily_summaries) AS last_refreshed_at`),
  ]);
  return c.json({ row_counts: tables.results[0], summary_cache: cache.results[0], archive: await archiveStatus(c.env) });
});

const rebuildSchema = z.object({
  commodity: z.string().trim().min(1).max(60).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  variety: z.string().trim().min(1).max(160).optional(),
}).strict().refine((value) => value.from <= value.to, "from must not be after to")
  .refine((value) => (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 <= 3660, "range must not exceed 3660 days");

operationsRoutes.post("/admin/summaries/rebuild", async (c) => {
  const parsed = rebuildSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Provide from/to (YYYY-MM-DD, at most 3660 days) and optional commodity/variety.", details: parsed.error.issues }, 400);
  const commodity = await resolveCommodity(c.env.DB, parsed.data.commodity);
  if (!commodity) return c.json({ error: "Unknown commodity." }, 400);
  const result = await rebuildSummaries(c.env.DB, commodity.canonical_name, parsed.data.from, parsed.data.to, parsed.data.variety);
  return c.json({ commodity: commodity.code, ...parsed.data, ...result,
    note: "Derived cache only. Source observations are never modified by a rebuild." });
});

operationsRoutes.post("/admin/archive/sync", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { limit?: unknown };
  const limit = body.limit === undefined ? 5 : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) return c.json({ error: "limit must be an integer from 1 to 20." }, 400);
  return c.json(await syncArchive(c.env, { limit }));
});

operationsRoutes.post("/admin/retention/purge", async (c) => c.json(await purgeExpiredTemporary(c.env)));

const MANUAL_LINK_TABLES = ["quality_inspections", "ingestion_jobs", "source_ingestion_runs", "intelligence_bulletins"] as const;

operationsRoutes.post("/admin/archive/objects", async (c) => {
  if (!archiveConfigured(c.env)) return c.json({ error: "R2 archive is not configured for this environment (no ARCHIVE binding)." }, 503);
  const category = c.req.query("category") as ArchiveCategory | undefined;
  if (!category || !(ARCHIVE_CATEGORIES as readonly string[]).includes(category)) {
    return c.json({ error: `category must be one of ${ARCHIVE_CATEGORIES.join(", ")}.` }, 400);
  }
  const mimeType = (c.req.header("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (!/^[a-z]+\/[a-z0-9.+-]+$/.test(mimeType)) return c.json({ error: "A Content-Type header is required." }, 400);
  const declared = Number(c.req.header("Content-Length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES) return c.json({ error: `Objects are limited to ${MAX_UPLOAD_BYTES} bytes.` }, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.byteLength) return c.json({ error: "Empty upload." }, 400);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return c.json({ error: `Objects are limited to ${MAX_UPLOAD_BYTES} bytes.` }, 413);
  const relatedTable = c.req.query("related_table")?.trim() || null;
  // Evidence tables (cooperative_fetches, monthly_refresh_runs, intelligence_captures) are linked only by the
  // verified archive sync, because offload guards and fallback readers trust those links.
  if (relatedTable && !(MANUAL_LINK_TABLES as readonly string[]).includes(relatedTable)) {
    return c.json({ error: `related_table must be one of ${MANUAL_LINK_TABLES.join(", ")}.` }, 400);
  }
  const sourceKey = c.req.query("source_key")?.trim().slice(0, 60) || null;
  const fileName = c.req.query("file_name")?.trim().slice(0, 260) || null;
  try {
    const row = await putArchiveObject(c.env, { content: bytes, mimeType, category, sourceKey, originalFileName: fileName,
      relatedTable, relatedId: c.req.query("related_id")?.slice(0, 128) || null });
    return c.json(row, row.created ? 201 : 200);
  } catch (error) {
    if (error instanceof ArchiveUnavailableError) return c.json({ error: error.message }, 503);
    throw error;
  }
});

operationsRoutes.get("/admin/archive/objects", async (c) => {
  const paging = page(c);
  if (!paging) return c.json({ error: "limit must be 1-200 and offset a non-negative integer." }, 400);
  const filters: string[] = [];
  const values: string[] = [];
  for (const key of ["category", "source_key", "status", "storage"] as const) {
    const value = c.req.query(key);
    if (value) { filters.push(`${key} = ?`); values.push(value); }
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const [rows, total] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(`SELECT * FROM archive_objects ${where} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`).bind(...values, paging.limit, paging.offset),
    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM archive_objects ${where}`).bind(...values),
  ]);
  return c.json({ data: rows.results, total: Number(total.results[0]?.total ?? 0), ...paging });
});

async function findObject(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM archive_objects WHERE id = ?").bind(id).first<ArchiveRow>();
}

operationsRoutes.get("/admin/archive/objects/:id", async (c) => {
  const row = await findObject(c.env.DB, c.req.param("id"));
  return row ? c.json(row) : c.json({ error: "Archive object not found." }, 404);
});

operationsRoutes.get("/admin/archive/objects/:id/content", async (c) => {
  const row = await findObject(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "Archive object not found." }, 404);
  if (row.storage === "d1_inline") return c.json({ error: "This evidence is stored inline in D1; read it through its source endpoint.", related_table: row.related_table, related_id: row.related_id }, 409);
  const result = await readArchiveRow(c.env, row);
  if (result.status === "ok") {
    return new Response(result.bytes, { headers: { "Content-Type": row.mime_type, "X-Content-SHA256": row.sha256,
      "Content-Disposition": "attachment", "X-Content-Type-Options": "nosniff" } });
  }
  const status = result.status === "unconfigured" ? 503 : result.status === "hash_mismatch" ? 409 : result.status === "expired" ? 410 : 404;
  return c.json({ error: archiveReadMessage(result), status: result.status }, status);
});

operationsRoutes.post("/admin/archive/objects/:id/verify", async (c) => {
  const row = await findObject(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "Archive object not found." }, 404);
  if (row.storage === "d1_inline") return c.json({ id: row.id, status: "not_applicable", note: "Inline D1 evidence; integrity is checked against recorded hashes during archive sync." });
  const result = await readArchiveRow(c.env, row);
  return c.json({ id: row.id, status: result.status === "ok" ? "verified" : result.status, message: result.status === "ok" ? null : archiveReadMessage(result) });
});

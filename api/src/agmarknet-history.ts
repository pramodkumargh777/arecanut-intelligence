/**
 * Import endpoint for AGMARKNET variety-wise daily history (data.gov.in resource 35985678-…), filled by
 * data-platform/connectors/agmarknet/history.py. It is separate from POST /admin/import so the current-daily
 * feed keeps its own code path and review flow unchanged.
 *
 * Two rules keep the add-on from disturbing existing data:
 * - A record is never inserted for a market, date, variety and grade that another source already holds (for
 *   example the current-daily feed), so readers never see the same mandi price twice.
 * - With AGMARKNET_HISTORY_AUTO_VERIFY="true", a record that passed every connector check is verified at import
 *   and the approval is written to observation_reviews under AGMARKNET_HISTORY_REVIEWER. Flagged records wait in
 *   the Data quality queue like any other.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./index";
import { bearerMatches } from "./auth";
import { priceBasisForSource } from "../../shared/commodities";
import { logOperationalError } from "./archive";

export const AGMARKNET_HISTORY_SOURCE = "agmarknet_history";
export const AGMARKNET_HISTORY_REVIEWER = "auto-validation-history-v1";
/**
 * Seven statements per record plus six per request (three more if it fails) keeps one request at 44 D1 queries or
 * fewer, inside the 50-query limit of Workers Free.
 */
export const HISTORY_IMPORT_MAX_RECORDS = 5;

const historyRecord = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  source_record_id: z.string().min(1).max(256),
  source_resource_id: z.string().trim().min(1).max(64),
  market_id: z.string().regex(/^[a-f0-9]{64}$/),
  market_name: z.string().trim().min(1).max(160),
  district: z.string().trim().min(1).max(160),
  state: z.string().trim().min(1).max(80),
  reporting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  publication_date: z.null().optional(),
  platform_fetched_at: z.string().datetime({ offset: true }).nullable().optional(),
  commodity_name: z.literal("Arecanut"),
  original_commodity_name: z.string().min(1).max(160),
  variety_name: z.string().trim().min(1).max(160),
  original_variety_name: z.string().min(1).max(160),
  grade: z.string().trim().min(1).max(80).nullable().optional(),
  minimum_price: z.number().finite().nonnegative(),
  maximum_price: z.number().finite().nonnegative(),
  modal_price: z.number().finite().nonnegative(),
  arrival_quantity: z.null(),
  arrival_unit: z.null(),
  original_unit: z.string().min(1).max(40),
  price_unit: z.literal("INR/quintal"),
  validation_status: z.enum(["validated", "review_required"]),
  validation_message: z.string().max(500).nullable(),
  raw_payload: z.string().max(20_000),
}).refine((record) => record.validation_status === "review_required"
  || (record.minimum_price <= record.modal_price && record.modal_price <= record.maximum_price),
{ message: "Validated records must satisfy minimum ≤ modal ≤ maximum." });

const historyImport = z.object({
  records: z.array(historyRecord).min(1).max(HISTORY_IMPORT_MAX_RECORDS),
  idempotency_key: z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9:._-]+$/),
}).superRefine((payload, context) => {
  if (new Set(payload.records.map((record) => record.source_record_id)).size !== payload.records.length) {
    context.addIssue({ code: "custom", message: "Each source_record_id may appear once per request." });
  }
});

type HistoryRecord = z.infer<typeof historyRecord>;

/** True when another source already holds this market, date, variety and grade. */
const HELD_ELSEWHERE = `EXISTS (SELECT 1 FROM market_price_observations other
  WHERE other.source_id != ? AND other.market_id = ? AND other.reporting_date = ? AND other.variety_name = ?
    AND COALESCE(other.grade, '') = COALESCE(?, '') AND other.validation_status != 'superseded')`;

function heldElsewhereValues(sourceId: string, record: HistoryRecord) {
  return [sourceId, record.market_id, record.reporting_date, record.variety_name, record.grade ?? null];
}

function recordStatements(db: D1Database, sourceId: string, jobId: string, record: HistoryRecord, autoVerify: boolean) {
  const elsewhere = heldElsewhereValues(sourceId, record);
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO markets (id, name, district, state, mapping_status) VALUES (?, ?, ?, ?, 'unverified')
      ON CONFLICT(id) DO NOTHING`).bind(record.market_id, record.market_name, record.district, record.state),
    db.prepare(`INSERT OR IGNORE INTO market_commodities (market_id, commodity_id, source_key, status)
      SELECT ?, id, ?, 'observed' FROM commodities WHERE canonical_name = ?`)
      .bind(record.market_id, AGMARKNET_HISTORY_SOURCE, record.commodity_name),
    // A changed source value: keep the old version, then supersede it. Never done for a slot held by another source.
    db.prepare(`INSERT INTO source_record_versions (id, observation_id, source_id, source_record_id, version_number, snapshot_payload)
      SELECT ?, o.id, o.source_id, o.source_record_id,
        COALESCE((SELECT MAX(version_number) FROM source_record_versions v
          WHERE v.source_id = o.source_id AND v.source_record_id = o.source_record_id), 0) + 1,
        json_object('id', o.id, 'validation_status', o.validation_status, 'minimum_price', o.minimum_price,
          'modal_price', o.modal_price, 'maximum_price', o.maximum_price, 'raw_payload', o.raw_payload,
          'ingested_at', o.ingested_at, 'validation_message', o.validation_message)
      FROM market_price_observations o WHERE o.source_id = ? AND o.source_record_id = ? AND o.id != ?
        AND o.validation_status != 'superseded' AND NOT ${HELD_ELSEWHERE}`)
      .bind(crypto.randomUUID(), sourceId, record.source_record_id, record.id, ...elsewhere),
    db.prepare(`UPDATE market_price_observations SET validation_status = 'superseded'
      WHERE source_id = ? AND source_record_id = ? AND id != ? AND validation_status != 'superseded' AND NOT ${HELD_ELSEWHERE}`)
      .bind(sourceId, record.source_record_id, record.id, ...elsewhere),
    db.prepare(`INSERT INTO market_price_observations (
        id, source_id, ingestion_job_id, source_record_id, market_id, reporting_date, publication_date, commodity_name,
        original_commodity_name, variety_name, original_variety_name, minimum_price, maximum_price, modal_price,
        arrival_quantity, arrival_unit, original_unit, price_unit, validation_status, validation_message, raw_payload,
        grade, source_resource_id, platform_fetched_at, price_basis)
      SELECT ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?,
        -- Auto-verified in the same write: about a third fewer D1 rows written than inserting, then updating. The
        -- conditions are the verified-price trigger's, so a row that would fail it is stored unverified instead.
        CASE WHEN ? = 1 AND ? IS NULL AND ? <= ? AND ? <= ? AND ? <= date('now') AND ? = 'INR/quintal'
          THEN 'verified' ELSE ? END,
        ?, ?, ?, ?, ?, ?
      WHERE NOT ${HELD_ELSEWHERE}
      ON CONFLICT(id) DO UPDATE SET validation_status = excluded.validation_status,
        validation_message = excluded.validation_message, ingestion_job_id = excluded.ingestion_job_id,
        ingested_at = CURRENT_TIMESTAMP
      WHERE market_price_observations.validation_status = 'superseded'
        AND market_price_observations.source_id = excluded.source_id`)
      .bind(record.id, sourceId, jobId, record.source_record_id, record.market_id, record.reporting_date,
        record.commodity_name, record.original_commodity_name, record.variety_name, record.original_variety_name,
        record.minimum_price, record.maximum_price, record.modal_price, record.original_unit, record.price_unit,
        autoVerify && record.validation_status === "validated" ? 1 : 0, record.validation_message, record.minimum_price,
        record.modal_price, record.modal_price, record.maximum_price, record.reporting_date, record.price_unit,
        record.validation_status,
        record.validation_message, record.raw_payload, record.grade ?? null,
        record.source_resource_id, record.platform_fetched_at ?? null, priceBasisForSource(AGMARKNET_HISTORY_SOURCE),
        ...elsewhere),
  ];
  if (!autoVerify) return statements;
  const reviewId = crypto.randomUUID();
  statements.push(
    // The approval record, only for a row this job stored as verified (a re-import of an existing row adds none).
    db.prepare(`INSERT INTO observation_reviews (id, observation_id, action, reviewer, previous_status, validation_message)
      SELECT ?, ?, 'approve', ?, 'validated', NULL WHERE EXISTS (SELECT 1 FROM market_price_observations
        WHERE id = ? AND source_id = ? AND ingestion_job_id = ? AND validation_status = 'verified')`)
      .bind(reviewId, record.id, AGMARKNET_HISTORY_REVIEWER, record.id, sourceId, jobId),
    // As with a manual approval. A market a reviewer has set to any other status is left alone.
    db.prepare(`UPDATE markets SET mapping_status = 'verified' WHERE id = ? AND mapping_status = 'unverified'
      AND EXISTS (SELECT 1 FROM observation_reviews WHERE id = ?)`).bind(record.market_id, reviewId),
  );
  return statements;
}

export const agmarknetHistoryRoutes = new Hono<Env>();

/** Stored history range; the connector's scheduled backfill works back from earliest_reporting_date. */
agmarknetHistoryRoutes.get("/admin/agmarknet-history/coverage", async (c) => {
  if (!bearerMatches(c.req.header("Authorization"), c.env.INGESTION_TOKEN)) {
    return c.json({ error: "A valid ingestion token is required." }, 401);
  }
  const row = await c.env.DB.prepare(`SELECT MIN(o.reporting_date) AS earliest_reporting_date, MAX(o.reporting_date) AS latest_reporting_date,
      COUNT(*) AS observation_count FROM market_price_observations o JOIN data_sources s ON s.id = o.source_id
    WHERE s.source_key = ? AND o.validation_status != 'superseded'`).bind(AGMARKNET_HISTORY_SOURCE)
    .first<{ earliest_reporting_date: string | null; latest_reporting_date: string | null; observation_count: number }>();
  return c.json(row ?? { earliest_reporting_date: null, latest_reporting_date: null, observation_count: 0 });
});

agmarknetHistoryRoutes.post("/admin/agmarknet-history/import", async (c) => {
  if (!bearerMatches(c.req.header("Authorization"), c.env.INGESTION_TOKEN)) {
    return c.json({ error: "A valid ingestion token is required." }, 401);
  }
  const parsed = historyImport.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid history import payload.", details: parsed.error.issues }, 400);
  const { records, idempotency_key: idempotencyKey } = parsed.data;
  const db = c.env.DB;
  const source = await db.prepare("SELECT id FROM data_sources WHERE source_key = ? AND is_enabled = 1")
    .bind(AGMARKNET_HISTORY_SOURCE).first<{ id: string }>();
  if (!source) return c.json({ error: "The AGMARKNET history source is not enabled. Apply migration 0021." }, 400);
  const prior = await db.prepare(`SELECT id, status, received_count, inserted_count, duplicate_count, corrected_count
      FROM ingestion_jobs WHERE source_id = ? AND idempotency_key = ? AND reprocess_of IS NULL AND status != 'failed'`)
    .bind(source.id, idempotencyKey).first<{ id: string; status: string; received_count: number; inserted_count: number;
      duplicate_count: number | null; corrected_count: number | null }>();
  if (prior?.status === "running") return c.json({ error: "An import with this idempotency key is still running.", job_id: prior.id }, 409);
  if (prior) {
    return c.json({ job_id: prior.id, received_count: prior.received_count, inserted_count: prior.inserted_count,
      duplicate_count: prior.duplicate_count ?? 0, corrected_count: prior.corrected_count ?? 0, replayed: true }, 200);
  }
  const jobId = crypto.randomUUID();
  try {
    await db.prepare(`INSERT INTO ingestion_jobs (id, source_id, status, received_count, idempotency_key)
      VALUES (?, ?, 'running', ?, ?)`).bind(jobId, source.id, records.length, idempotencyKey).run();
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      return c.json({ error: "An import with this idempotency key was registered concurrently; retry to receive its result." }, 409);
    }
    throw error;
  }
  const autoVerify = c.env.AGMARKNET_HISTORY_AUTO_VERIFY === "true";
  try {
    const placeholders = records.map(() => "?").join(", ");
    const existing = new Set((await db.prepare(`SELECT id FROM market_price_observations WHERE id IN (${placeholders})`)
      .bind(...records.map((record) => record.id)).all<{ id: string }>()).results.map((row) => row.id));
    const statements: D1PreparedStatement[] = [];
    const indexes: { supersede: number; insert: number; verify: number | null }[] = [];
    for (const record of records) {
      const start = statements.length;
      statements.push(...recordStatements(db, source.id, jobId, record, autoVerify));
      // The review insert (start + 5) counts verified rows; the reviews table has no triggers, so its count is exact.
      indexes.push({ supersede: start + 3, insert: start + 4, verify: autoVerify ? start + 5 : null });
    }
    const results = await db.batch(statements);
    let inserted = 0, corrected = 0, verified = 0, duplicates = 0, heldElsewhere = 0;
    // D1's meta.changes also counts rows written by triggers (the summary-cache dirty markers), so each statement is
    // read as changed / unchanged. Each touches at most one observation: source_record_id is unique among current rows.
    const changed = (position: number) => results[position].meta.changes > 0 ? 1 : 0;
    records.forEach((record, index) => {
      const at = indexes[index];
      corrected += changed(at.supersede);
      if (changed(at.insert)) inserted += 1;
      else if (existing.has(record.id)) duplicates += 1;
      else heldElsewhere += 1;
      if (at.verify !== null) verified += changed(at.verify);
    });
    const message = `Received ${records.length}; inserted ${inserted}; corrected ${corrected}; duplicates ${duplicates}; `
      + `held by another source ${heldElsewhere}; auto-verified ${verified}.`;
    await db.batch([
      db.prepare("INSERT INTO ingestion_job_logs (id, job_id, level, message) VALUES (?, ?, 'info', ?)").bind(crypto.randomUUID(), jobId, message),
      db.prepare(`UPDATE ingestion_jobs SET status = 'completed', inserted_count = ?, duplicate_count = ?, corrected_count = ?,
        completed_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(inserted, duplicates + heldElsewhere, corrected, jobId),
    ]);
    return c.json({ job_id: jobId, received_count: records.length, inserted_count: inserted, duplicate_count: duplicates,
      held_by_other_source_count: heldElsewhere, corrected_count: corrected, auto_verified_count: verified,
      auto_verify: autoVerify, replayed: false }, 201);
  } catch (error) {
    // D1 batches are atomic, so a failure leaves no partial rows from this request.
    const message = (error instanceof Error ? error.message : "Database insert failed.").slice(0, 500);
    await db.batch([
      db.prepare("INSERT INTO ingestion_job_logs (id, job_id, level, message) VALUES (?, ?, 'error', ?)").bind(crypto.randomUUID(), jobId, message),
      db.prepare(`UPDATE ingestion_jobs SET status = 'failed', inserted_count = 0, error_message = ?, completed_at = CURRENT_TIMESTAMP
        WHERE id = ?`).bind(message, jobId),
    ]);
    await logOperationalError(db, "import", AGMARKNET_HISTORY_SOURCE, message, { job_id: jobId });
    return c.json({ error: "History import failed; nothing from this request was stored.", job_id: jobId }, 500);
  }
});

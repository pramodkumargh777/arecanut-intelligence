/**
 * Optional Cloudflare R2 evidence archive.
 *
 * - Without an ARCHIVE binding everything keeps working: inline D1 evidence is registered as
 *   `d1_inline` rows (hash, size, MIME) and uploads return 503.
 * - With R2, evidence is copied to content-addressed keys and verified by SHA-256 on read.
 * - Inline D1 copies are cleared ("offloaded") only when ARCHIVE_OFFLOAD_MIN_BYTES is set, only for
 *   rows at or above that size, and only after a read-back hash check. Database triggers refuse an
 *   offload without a stored R2 registry row. Nothing is ever deleted except expired temporary objects.
 */
export type ArchiveBindings = {
  DB: D1Database;
  ARCHIVE?: R2Bucket;
  ARCHIVE_OFFLOAD_MIN_BYTES?: string;
  TEMP_RETENTION_DAYS?: string;
};

export const ARCHIVE_CATEGORIES = [
  "source_csv", "source_html", "source_json", "source_pdf", "imported_report", "quality_image", "source_payload", "temporary_processing",
] as const;
export type ArchiveCategory = typeof ARCHIVE_CATEGORIES[number];
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_SYNC_PER_TABLE = 20;
const MAX_TEMP_RETENTION_DAYS = 365;

export class ArchiveUnavailableError extends Error {}

export type ArchiveRow = {
  id: string; storage: "r2" | "d1_inline"; object_key: string; sha256: string; size_bytes: number; mime_type: string;
  category: ArchiveCategory; source_key: string | null; related_table: string | null; related_id: string | null;
  original_file_name: string | null; retention_class: "evidence" | "temporary"; expires_at: string | null;
  status: "stored" | "missing" | "hash_mismatch" | "expired"; last_verified_at: string | null; metadata_json: string | null; created_at: string;
};

export function archiveConfigured(env: ArchiveBindings): env is ArchiveBindings & { ARCHIVE: R2Bucket } {
  return Boolean(env.ARCHIVE);
}

export function tempRetentionDays(env: ArchiveBindings) {
  const parsed = Number(env.TEMP_RETENTION_DAYS ?? 7);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_TEMP_RETENTION_DAYS ? parsed : 7;
}

export function offloadThreshold(env: ArchiveBindings): number | null {
  if (!env.ARCHIVE_OFFLOAD_MIN_BYTES) return null;
  const parsed = Number(env.ARCHIVE_OFFLOAD_MIN_BYTES);
  return Number.isInteger(parsed) && parsed >= 1024 ? parsed : null;
}

export async function sha256Bytes(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const EXTENSIONS: Record<string, string> = {
  "text/csv": "csv", "text/html": "html", "application/json": "json", "application/pdf": "pdf",
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "text/plain": "txt",
};
export function extensionFor(mimeType: string) {
  return EXTENSIONS[mimeType.split(";")[0].trim().toLowerCase()] ?? "bin";
}

/** Content-addressed key: identical bytes in the same category/source share one object. */
export function archiveObjectKey(category: ArchiveCategory, sourceKey: string | null, sha: string, mimeType: string) {
  const source = (sourceKey ?? "unattributed").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 60) || "unattributed";
  return `${category}/${source}/${sha.slice(0, 2)}/${sha}.${extensionFor(mimeType)}`;
}

function toBytes(content: string | ArrayBuffer | Uint8Array) {
  if (typeof content === "string") return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

export type PutInput = {
  content: string | ArrayBuffer | Uint8Array; mimeType: string; category: ArchiveCategory; sourceKey?: string | null;
  relatedTable?: string | null; relatedId?: string | null; originalFileName?: string | null; metadata?: Record<string, unknown>;
};

/** Idempotent upload + registration. Returns the registry row; re-uploading identical bytes is a no-op. */
export async function putArchiveObject(env: ArchiveBindings, input: PutInput): Promise<ArchiveRow & { created: boolean }> {
  if (!archiveConfigured(env)) throw new ArchiveUnavailableError("R2 archive is not configured (no ARCHIVE binding).");
  const bytes = toBytes(input.content);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new RangeError(`Object exceeds ${MAX_UPLOAD_BYTES} bytes.`);
  const sha = await sha256Bytes(bytes);
  const key = archiveObjectKey(input.category, input.sourceKey ?? null, sha, input.mimeType);
  const relatedTable = input.relatedTable ?? null, relatedId = input.relatedId ?? null;
  const existing = await env.DB.prepare(`SELECT * FROM archive_objects WHERE storage = 'r2' AND object_key = ?
    AND related_table IS ? AND related_id IS ? LIMIT 1`).bind(key, relatedTable, relatedId).first<ArchiveRow>();
  if (existing?.status === "stored") return { ...existing, created: false };
  const head = await env.ARCHIVE.head(key);
  if (!head || head.customMetadata?.sha256 !== sha) {
    await env.ARCHIVE.put(key, bytes, { sha256: sha, httpMetadata: { contentType: input.mimeType }, customMetadata: { sha256: sha, category: input.category } });
  }
  const temporary = input.category === "temporary_processing";
  const expiresAt = temporary ? new Date(Date.now() + tempRetentionDays(env) * 86_400_000).toISOString() : null;
  if (existing) {
    await env.DB.prepare("UPDATE archive_objects SET status = 'stored', last_verified_at = ? WHERE id = ?").bind(new Date().toISOString(), existing.id).run();
    return { ...existing, status: "stored", created: false };
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO archive_objects (id, storage, object_key, sha256, size_bytes, mime_type, category, source_key,
      related_table, related_id, original_file_name, retention_class, expires_at, metadata_json, last_verified_at)
    VALUES (?, 'r2', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, key, sha, bytes.byteLength, input.mimeType, input.category, input.sourceKey ?? null, relatedTable, relatedId,
      input.originalFileName ?? null, temporary ? "temporary" : "evidence", expiresAt,
      input.metadata ? JSON.stringify(input.metadata) : null, new Date().toISOString()).run();
  const row = await env.DB.prepare("SELECT * FROM archive_objects WHERE id = ?").bind(id).first<ArchiveRow>();
  return { ...(row as ArchiveRow), created: true };
}

export type ArchiveRead =
  | { status: "ok"; bytes: Uint8Array; row: ArchiveRow }
  | { status: "unconfigured" | "not_archived" }
  | { status: "missing" | "hash_mismatch" | "expired"; row: ArchiveRow };

/** Reads one registry object from R2, verifying its SHA-256 and recording the outcome. */
export async function readArchiveRow(env: ArchiveBindings, row: ArchiveRow): Promise<ArchiveRead> {
  if (row.storage !== "r2") return { status: "not_archived" };
  if (row.status === "expired") return { status: "expired", row };
  if (!archiveConfigured(env)) return { status: "unconfigured" };
  const object = await env.ARCHIVE.get(row.object_key);
  const now = new Date().toISOString();
  if (!object) {
    await env.DB.prepare("UPDATE archive_objects SET status = 'missing', last_verified_at = ? WHERE id = ?").bind(now, row.id).run();
    await logOperationalError(env.DB, "archive", row.source_key, `Archived object is missing from R2: ${row.object_key}`, { archive_id: row.id });
    return { status: "missing", row: { ...row, status: "missing" } };
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (await sha256Bytes(bytes) !== row.sha256) {
    await env.DB.prepare("UPDATE archive_objects SET status = 'hash_mismatch', last_verified_at = ? WHERE id = ?").bind(now, row.id).run();
    await logOperationalError(env.DB, "archive", row.source_key, `Archived object failed SHA-256 verification: ${row.object_key}`, { archive_id: row.id });
    return { status: "hash_mismatch", row: { ...row, status: "hash_mismatch" } };
  }
  await env.DB.prepare("UPDATE archive_objects SET status = 'stored', last_verified_at = ? WHERE id = ?").bind(now, row.id).run();
  return { status: "ok", bytes, row: { ...row, status: "stored" } };
}

/** Fallback reader for evidence whose inline D1 copy was offloaded to R2. */
export async function readRelatedText(env: ArchiveBindings, relatedTable: string, relatedId: string): Promise<ArchiveRead & { text?: string }> {
  const row = await env.DB.prepare(`SELECT * FROM archive_objects WHERE storage = 'r2' AND related_table = ? AND related_id = ?
    ORDER BY CASE status WHEN 'stored' THEN 0 ELSE 1 END, created_at LIMIT 1`).bind(relatedTable, relatedId).first<ArchiveRow>();
  if (!row) return { status: "not_archived" };
  const result = await readArchiveRow(env, row);
  return result.status === "ok" ? { ...result, text: new TextDecoder().decode(result.bytes) } : result;
}

export function archiveReadMessage(result: ArchiveRead) {
  switch (result.status) {
    case "unconfigured": return "The inline copy was offloaded to R2, but no ARCHIVE binding is configured in this environment.";
    case "missing": return "The archived R2 object is missing. The registry row is retained and marked missing; restore it from backup.";
    case "hash_mismatch": return "The archived R2 object failed SHA-256 verification and was not served.";
    case "expired": return "The temporary object expired under the configured retention policy.";
    default: return "No archived copy is registered.";
  }
}

export async function logOperationalError(db: D1Database, component: "scheduled" | "archive" | "retention" | "import" | "summary_cache",
  sourceKey: string | null, message: string, detail?: Record<string, unknown>) {
  try {
    await db.prepare("INSERT INTO operational_errors (id, component, source_key, message, detail_json) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), component, sourceKey, message.slice(0, 2000), detail ? JSON.stringify(detail).slice(0, 8000) : null).run();
  } catch (error) {
    console.error("Could not persist operational error", error);
  }
}

type Candidate = { table: "cooperative_fetches" | "monthly_refresh_runs" | "intelligence_captures"; id: string; source_key: string | null;
  payload: string; expected_sha: string | null; mime_type: string; category: ArchiveCategory; decode_base64: boolean; file_name: string | null };

function cooperativeCategory(source: string, mode: string | null): { category: ArchiveCategory; mime: string } {
  if (mode === "manual_csv") return { category: "source_csv", mime: "text/csv" };
  return source === "tss" ? { category: "source_json", mime: "application/json" } : { category: "source_html", mime: "text/html" };
}

function intelligenceCategory(mediaType: string): { category: ArchiveCategory; mime: string; base64: boolean } {
  const type = mediaType.toLowerCase();
  if (type === "application/pdf;base64") return { category: "source_pdf", mime: "application/pdf", base64: true };
  if (type.includes("html")) return { category: "source_html", mime: "text/html", base64: false };
  if (type.includes("json")) return { category: "source_json", mime: "application/json", base64: false };
  if (type.includes("csv")) return { category: "source_csv", mime: "text/csv", base64: false };
  return { category: "source_payload", mime: "text/plain", base64: false };
}

async function candidates(db: D1Database, storage: "r2" | "d1_inline", limit: number): Promise<Candidate[]> {
  const missing = (table: string, alias: string) => `NOT EXISTS (SELECT 1 FROM archive_objects a WHERE a.related_table = '${table}'
    AND a.related_id = ${alias}.id AND a.storage = '${storage}' AND a.status = 'stored')`;
  const [fetches, reports, captures] = await db.batch<Record<string, string | null>>([
    db.prepare(`SELECT f.id, f.source_key, f.raw_snapshot AS payload, f.snapshot_sha256 AS expected_sha, f.ingest_mode
      FROM cooperative_fetches f WHERE f.raw_snapshot IS NOT NULL AND ${missing("cooperative_fetches", "f")} ORDER BY f.started_at LIMIT ?`).bind(limit),
    db.prepare(`SELECT r.id, 'agmarknet_monthly' AS source_key, r.raw_report AS payload, r.reporting_month
      FROM monthly_refresh_runs r WHERE r.raw_report IS NOT NULL AND ${missing("monthly_refresh_runs", "r")} ORDER BY r.started_at LIMIT ?`).bind(limit),
    db.prepare(`SELECT c.id, c.source_key, c.raw_payload AS payload, c.content_hash AS expected_sha, c.media_type
      FROM intelligence_captures c WHERE ${missing("intelligence_captures", "c")} ORDER BY c.fetched_at LIMIT ?`).bind(limit),
  ]);
  const out: Candidate[] = [];
  for (const row of fetches.results) {
    const { category, mime } = cooperativeCategory(String(row.source_key), row.ingest_mode);
    out.push({ table: "cooperative_fetches", id: String(row.id), source_key: row.source_key, payload: String(row.payload),
      expected_sha: row.expected_sha, mime_type: mime, category, decode_base64: false, file_name: null });
  }
  for (const row of reports.results) {
    out.push({ table: "monthly_refresh_runs", id: String(row.id), source_key: "agmarknet_monthly", payload: String(row.payload),
      expected_sha: null, mime_type: "text/csv", category: "source_csv", decode_base64: false, file_name: `agmarknet-${row.reporting_month}.csv` });
  }
  for (const row of captures.results) {
    const kind = intelligenceCategory(String(row.media_type));
    out.push({ table: "intelligence_captures", id: String(row.id), source_key: row.source_key, payload: String(row.payload),
      expected_sha: row.expected_sha, mime_type: kind.mime, category: kind.category, decode_base64: kind.base64, file_name: null });
  }
  return out;
}

export type SyncResult = { mode: "r2" | "d1_inline"; registered: number; uploaded: number; offloaded: number; skipped: number; errors: string[] };

/** Bounded archive pass (cron and admin-triggered). Each call handles at most `limit` rows per evidence table. */
export async function syncArchive(env: ArchiveBindings, options: { limit?: number } = {}): Promise<SyncResult> {
  const limit = Math.max(1, Math.min(options.limit ?? 5, MAX_SYNC_PER_TABLE));
  const mode = archiveConfigured(env) ? "r2" : "d1_inline";
  const result: SyncResult = { mode, registered: 0, uploaded: 0, offloaded: 0, skipped: 0, errors: [] };
  for (const item of await candidates(env.DB, mode, limit)) {
    try {
      const textSha = await sha256Bytes(new TextEncoder().encode(item.payload));
      if (item.expected_sha && item.expected_sha !== textSha) {
        result.skipped += 1;
        const message = `Inline ${item.table} ${item.id} does not match its recorded SHA-256; not archived.`;
        result.errors.push(message);
        await logOperationalError(env.DB, "archive", item.source_key, message, { table: item.table, id: item.id });
        continue;
      }
      if (mode === "d1_inline") {
        await env.DB.prepare(`INSERT OR IGNORE INTO archive_objects (id, storage, object_key, sha256, size_bytes, mime_type, category, source_key,
            related_table, related_id, original_file_name, retention_class, metadata_json, last_verified_at)
          VALUES (?, 'd1_inline', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'evidence', ?, ?)`)
          .bind(crypto.randomUUID(), `d1://${item.table}/${item.id}`, textSha, new TextEncoder().encode(item.payload).byteLength,
            item.decode_base64 ? "application/pdf;base64" : item.mime_type, item.category, item.source_key, item.table, item.id,
            item.file_name, JSON.stringify({ inline_column: inlineColumn(item.table) }), new Date().toISOString()).run();
        result.registered += 1;
        continue;
      }
      const content = item.decode_base64 ? Uint8Array.from(atob(item.payload), (char) => char.charCodeAt(0)) : item.payload;
      const stored = await putArchiveObject(env, {
        content, mimeType: item.mime_type, category: item.category, sourceKey: item.source_key, relatedTable: item.table, relatedId: item.id,
        originalFileName: item.file_name, metadata: { inline_column: inlineColumn(item.table), inline_text_sha256: textSha, decoded_from_base64: item.decode_base64 },
      });
      if (stored.created) result.uploaded += 1; else result.skipped += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Archive sync failed.";
      result.errors.push(`${item.table} ${item.id}: ${message}`);
      await logOperationalError(env.DB, "archive", item.source_key, message, { table: item.table, id: item.id });
    }
  }
  if (mode === "r2") result.offloaded = await offloadInlineCopies(env, limit, result.errors);
  return result;
}

function inlineColumn(table: Candidate["table"]) {
  return table === "cooperative_fetches" ? "raw_snapshot" : table === "monthly_refresh_runs" ? "raw_report" : "raw_payload";
}

/**
 * Clears inline copies that are large enough and already archived in R2. Intelligence captures are
 * immutable and NOT NULL, so they are never offloaded. Every clear is preceded by an R2 read-back hash check.
 */
async function offloadInlineCopies(env: ArchiveBindings, limit: number, errors: string[]) {
  const threshold = offloadThreshold(env);
  if (threshold === null) return 0;
  let offloaded = 0;
  const targets = [
    { table: "cooperative_fetches", column: "raw_snapshot" },
    { table: "monthly_refresh_runs", column: "raw_report" },
  ] as const;
  for (const target of targets) {
    const rows = await env.DB.prepare(`SELECT t.id, a.id AS archive_id FROM ${target.table} t
      JOIN archive_objects a ON a.related_table = '${target.table}' AND a.related_id = t.id AND a.storage = 'r2' AND a.status = 'stored'
      WHERE t.${target.column} IS NOT NULL AND length(CAST(t.${target.column} AS BLOB)) >= ? LIMIT ?`)
      .bind(threshold, limit).all<{ id: string; archive_id: string }>();
    for (const row of rows.results) {
      const archive = await env.DB.prepare("SELECT * FROM archive_objects WHERE id = ?").bind(row.archive_id).first<ArchiveRow>();
      if (!archive) continue;
      const read = await readArchiveRow(env, archive);
      if (read.status !== "ok") { errors.push(`${target.table} ${row.id}: R2 copy ${read.status}; inline copy retained.`); continue; }
      const inline = await env.DB.prepare(`SELECT ${target.column} AS payload FROM ${target.table} WHERE id = ?`).bind(row.id).first<{ payload: string | null }>();
      if (!inline?.payload || await sha256Bytes(new TextEncoder().encode(inline.payload)) !== archive.sha256) {
        errors.push(`${target.table} ${row.id}: inline and archived hashes differ; inline copy retained.`);
        continue;
      }
      try {
        await env.DB.prepare(`UPDATE ${target.table} SET ${target.column} = NULL WHERE id = ?`).bind(row.id).run();
        offloaded += 1;
      } catch (error) {
        // The evidence guard trigger refuses (e.g. legacy fetch without a recorded snapshot hash); keep the inline copy.
        errors.push(`${target.table} ${row.id}: ${error instanceof Error ? error.message : "offload refused"}; inline copy retained.`);
      }
    }
  }
  return offloaded;
}

/** Marks expired temporary objects and deletes their R2 bytes. Evidence objects are never touched. */
export async function purgeExpiredTemporary(env: ArchiveBindings, now = new Date()): Promise<{ expired: number; errors: string[] }> {
  const rows = await env.DB.prepare(`SELECT * FROM archive_objects WHERE retention_class = 'temporary' AND status = 'stored'
    AND expires_at <= ? ORDER BY expires_at LIMIT 50`).bind(now.toISOString()).all<ArchiveRow>();
  let expired = 0;
  const errors: string[] = [];
  for (const row of rows.results) {
    try {
      if (row.storage === "r2") {
        if (!archiveConfigured(env)) { errors.push("R2 archive is not configured; temporary objects cannot be purged."); break; }
        const shared = await env.DB.prepare(`SELECT 1 FROM archive_objects WHERE object_key = ? AND retention_class = 'evidence' LIMIT 1`)
          .bind(row.object_key).first();
        if (!shared) await env.ARCHIVE.delete(row.object_key);
      }
      await env.DB.prepare("UPDATE archive_objects SET status = 'expired', last_verified_at = ? WHERE id = ?").bind(now.toISOString(), row.id).run();
      expired += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Temporary purge failed.";
      errors.push(message);
      await logOperationalError(env.DB, "retention", row.source_key, message, { archive_id: row.id });
    }
  }
  return { expired, errors };
}

export async function archiveStatus(env: ArchiveBindings) {
  const [byStorage, inline] = await env.DB.batch<Record<string, string | number | null>>([
    env.DB.prepare(`SELECT storage, retention_class, status, COUNT(*) AS objects, COALESCE(SUM(size_bytes), 0) AS bytes
      FROM archive_objects GROUP BY storage, retention_class, status ORDER BY storage, retention_class, status`),
    env.DB.prepare(`SELECT (SELECT COUNT(raw_snapshot) FROM cooperative_fetches) AS cooperative_fetches_inline_rows,
      (SELECT COALESCE(SUM(length(CAST(raw_snapshot AS BLOB))), 0) FROM cooperative_fetches) AS cooperative_fetches_inline_bytes,
      (SELECT COUNT(raw_report) FROM monthly_refresh_runs) AS monthly_reports_inline_rows,
      (SELECT COALESCE(SUM(length(CAST(raw_report AS BLOB))), 0) FROM monthly_refresh_runs) AS monthly_reports_inline_bytes,
      (SELECT COUNT(*) FROM intelligence_captures) AS intelligence_captures_inline_rows,
      (SELECT COALESCE(SUM(length(CAST(raw_payload AS BLOB))), 0) FROM intelligence_captures) AS intelligence_captures_inline_bytes`),
  ]);
  return {
    r2_configured: archiveConfigured(env),
    offload_min_bytes: offloadThreshold(env),
    temp_retention_days: tempRetentionDays(env),
    registry: byStorage.results,
    inline_evidence: inline.results[0],
    policy: "Evidence is never deleted. Inline D1 copies are cleared only after a verified R2 copy exists; only temporary_processing objects expire.",
  };
}

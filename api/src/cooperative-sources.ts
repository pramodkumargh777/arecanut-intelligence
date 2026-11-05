import { z } from "zod";
import { calendarTodayIST, calendarDateToTime, DAY_MS } from "../../shared/dates";
import type { CooperativeSource } from "./cooperative";

export const COOPERATIVE_SOURCES = ["mamcos", "tss", "tumcos"] as const;

export type CooperativeSourceRecord = {
  source_key: CooperativeSource; display_name: string; operator: string; source_url: string; access_method: string;
  commodities: string; robots_status: string; terms_status: string;
  permission_status: "not_requested" | "requested" | "granted" | "denied";
  scheduled_collection_allowed: number; redistribution_allowed: number; permission_reference: string | null;
  unit_evidence: string; notes: string; terms_checked_at: string; updated_at: string;
};

export async function readCooperativeSources(db: D1Database): Promise<CooperativeSourceRecord[]> {
  return (await db.prepare("SELECT * FROM cooperative_sources ORDER BY source_key").all<CooperativeSourceRecord>()).results;
}

export async function readCooperativeSource(db: D1Database, key: CooperativeSource): Promise<CooperativeSourceRecord | null> {
  return db.prepare("SELECT * FROM cooperative_sources WHERE source_key = ?").bind(key).first<CooperativeSourceRecord>();
}

export function permissionLabel(source: Pick<CooperativeSourceRecord, "permission_status" | "redistribution_allowed">): string {
  if (source.permission_status === "granted" && source.redistribution_allowed) return "Permission recorded for collection and redistribution";
  if (source.permission_status === "granted") return "Collection permission recorded; redistribution not confirmed";
  if (source.permission_status === "denied") return "Permission denied";
  if (source.permission_status === "requested") return "Permission requested; not confirmed";
  return "Permission not confirmed";
}

/** Scheduled collection needs both the deployment flag and a recorded grant; manual admin actions are recorded separately. */
export function schedulingDecision(source: CooperativeSourceRecord | null, flagEnabled: boolean): { allowed: boolean; reason: string } {
  if (!flagEnabled) return { allowed: false, reason: "Scheduled collection flag is disabled." };
  if (!source) return { allowed: false, reason: "Source is missing from the cooperative source registry." };
  if (source.permission_status !== "granted" || source.scheduled_collection_allowed !== 1) {
    return { allowed: false, reason: `Scheduled collection blocked: ${permissionLabel(source).toLowerCase()} (permission_status=${source.permission_status}, scheduled_collection_allowed=${source.scheduled_collection_allowed}).` };
  }
  return { allowed: true, reason: "Scheduled collection permitted by recorded permission." };
}

export async function recordBlockedFetch(db: D1Database, source: CooperativeSource, url: string, reason: string) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO cooperative_fetches (id, source_key, source_url, started_at, finished_at, status, error_message, ingest_mode, attempt_count)
    VALUES (?, ?, ?, ?, ?, 'blocked', ?, 'scheduled', 0)`).bind(crypto.randomUUID(), source, url, now, now, reason).run();
}

export const permissionUpdate = z.object({
  permission_status: z.enum(["not_requested", "requested", "granted", "denied"]),
  scheduled_collection_allowed: z.boolean(),
  redistribution_allowed: z.boolean(),
  permission_reference: z.string().trim().min(3).max(500).nullable(),
  terms_status: z.string().trim().min(3).max(1000).optional(),
  notes: z.string().trim().min(3).max(2000).optional(),
  terms_checked_at: z.iso.date().optional(),
}).strict().superRefine((value, context) => {
  if ((value.scheduled_collection_allowed || value.redistribution_allowed) && value.permission_status !== "granted") {
    context.addIssue({ code: "custom", message: "Collection or redistribution can only be allowed when permission is granted." });
  }
  if (value.permission_status === "granted" && !value.permission_reference) {
    context.addIssue({ code: "custom", message: "A granted permission requires a permission reference (letter, email or agreement identifier)." });
  }
});

export async function updateCooperativePermission(db: D1Database, key: CooperativeSource, update: z.infer<typeof permissionUpdate>) {
  const result = await db.prepare(`UPDATE cooperative_sources SET permission_status = ?, scheduled_collection_allowed = ?, redistribution_allowed = ?,
      permission_reference = ?, terms_status = COALESCE(?, terms_status), notes = COALESCE(?, notes),
      terms_checked_at = COALESCE(?, terms_checked_at), updated_at = ?
    WHERE source_key = ?`).bind(
    update.permission_status, update.scheduled_collection_allowed ? 1 : 0, update.redistribution_allowed ? 1 : 0,
    update.permission_reference, update.terms_status ?? null, update.notes ?? null, update.terms_checked_at ?? null,
    new Date().toISOString(), key,
  ).run();
  if (!result.meta.changes) throw new Error("Unknown cooperative source");
  return readCooperativeSource(db, key);
}

type FetchRow = { source_key: CooperativeSource; id: string; status: string; started_at: string; finished_at: string | null; error_message: string | null;
  http_status: number | null; attempt_count: number | null; ingest_mode: string | null; received_count: number | null; inserted_count: number | null; notes: string | null };
type CountRow = { source_key: CooperativeSource; commodity: string; status: string; unit_status: string; count: number; latest: string | null };

export function freshness(latest: string | null, today: string, staleAfterDays: number) {
  if (!latest) return { latest_reporting_date: null, age_days: null, state: "no_data" as const };
  const age = Math.round((calendarDateToTime(today) - calendarDateToTime(latest)) / DAY_MS);
  return { latest_reporting_date: latest, age_days: age, state: age <= staleAfterDays ? "fresh" as const : "stale" as const };
}

export async function cooperativeSourceStatus(db: D1Database, now = new Date()) {
  const today = calendarTodayIST(now);
  const [sources, fetches, counts] = await Promise.all([
    readCooperativeSources(db),
    db.prepare(`SELECT source_key, id, status, started_at, finished_at, error_message, http_status, attempt_count, ingest_mode,
        received_count, inserted_count, notes FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY source_key ORDER BY started_at DESC, rowid DESC) AS position FROM cooperative_fetches)
        WHERE position <= 8 ORDER BY source_key, position`).all<FetchRow>(),
    db.prepare(`SELECT source_key, commodity, status, unit_status, COUNT(*) AS count, MAX(reporting_date) AS latest
        FROM cooperative_quotes WHERE status != 'superseded' GROUP BY source_key, commodity, status, unit_status`).all<CountRow>(),
  ]);
  return {
    generated_at: now.toISOString(), market_calendar_today: today,
    sources: sources.map((source) => {
      const recent = fetches.results.filter((row) => row.source_key === source.source_key);
      const attempts = recent.filter((row) => row.status !== "blocked");
      const lastSuccess = recent.find((row) => row.status === "succeeded") ?? null;
      const rows = counts.results.filter((row) => row.source_key === source.source_key);
      const commodities = [...new Set(rows.map((row) => row.commodity))].sort().map((commodity) => {
        const subset = rows.filter((row) => row.commodity === commodity);
        const latestAny = subset.map((row) => row.latest).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
        const latestValid = subset.filter((row) => row.status !== "invalid" && row.status !== "rejected")
          .map((row) => row.latest).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
        return {
          commodity, freshness: freshness(latestValid ?? latestAny, today, 7),
          by_status: Object.fromEntries([...new Set(subset.map((row) => row.status))].map((status) => [status, subset.filter((row) => row.status === status).reduce((sum, row) => sum + row.count, 0)])),
          by_unit_status: Object.fromEntries([...new Set(subset.map((row) => row.unit_status))].map((unit) => [unit, subset.filter((row) => row.unit_status === unit).reduce((sum, row) => sum + row.count, 0)])),
        };
      });
      return {
        source_key: source.source_key, display_name: source.display_name, operator: source.operator, source_url: source.source_url,
        access_method: source.access_method, commodities: source.commodities,
        availability: attempts[0] ? {
          state: attempts[0].status === "succeeded" ? "available" : attempts[0].status === "running" ? "running" : "failing",
          last_attempt_at: attempts[0].started_at, last_status: attempts[0].status, http_status: attempts[0].http_status,
          attempts: attempts[0].attempt_count,
        } : { state: "never_fetched", last_attempt_at: null, last_status: null, http_status: null, attempts: null },
        last_success_at: lastSuccess?.finished_at ?? null,
        permission: {
          status: source.permission_status, label: permissionLabel(source),
          scheduled_collection_allowed: source.scheduled_collection_allowed === 1, redistribution_allowed: source.redistribution_allowed === 1,
          permission_reference: source.permission_reference, robots_status: source.robots_status, terms_status: source.terms_status,
          terms_checked_at: source.terms_checked_at,
        },
        unit_evidence: source.unit_evidence, notes: source.notes, commodity_status: commodities,
        recent_failures: recent.filter((row) => row.status === "failed" || row.status === "blocked").slice(0, 5).map((row) => ({
          fetch_id: row.id, status: row.status, started_at: row.started_at, ingest_mode: row.ingest_mode, http_status: row.http_status, reason: row.error_message,
        })),
        recent_fetches: recent.map((row) => ({
          fetch_id: row.id, status: row.status, started_at: row.started_at, finished_at: row.finished_at, ingest_mode: row.ingest_mode,
          http_status: row.http_status, attempts: row.attempt_count, received_count: row.received_count, inserted_count: row.inserted_count,
        })),
      };
    }),
  };
}

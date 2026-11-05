import { archiveReadMessage, readRelatedText } from "./archive";
import { z } from "zod";
import { calendarTodayIST } from "../../shared/dates";
import {
  parseMamcos, startCooperativeFetch, storeCooperativeSnapshot, failCooperativeFetch,
  type CooperativeCommodity, type CooperativeQuote, type CooperativeSource, type UnitStatus,
} from "./cooperative";
import { sha256Hex } from "./cooperative-fetch";
import { parseTss, TSS_LOCATIONS, validTssDate, type TssLotAggregate } from "./tss";
import { parseTumcos, tumcosNotes } from "./tumcos";
import { operatorAssumesUnit, PER_KG_PLAUSIBILITY_LIMIT } from "./cooperative-units";

export const CSV_MAX_ROWS = 500;
export const CSV_MAX_BYTES = 512_000;
export const CSV_COLUMNS = [
  "branch", "reporting_date", "commodity", "variety", "minimum_price", "maximum_price", "average_price",
  "declared_unit", "unit_evidence", "source_reference", "source_record_id", "lot_count", "bag_count", "reported_weight",
] as const;
const REQUIRED = ["branch", "reporting_date", "commodity", "variety", "minimum_price", "maximum_price", "average_price", "declared_unit", "source_reference"];

/** RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF and embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, index = 0;
  const source = text.replace(/^\uFEFF/, "");
  while (index < source.length) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 2; continue; }
      if (char === '"') { quoted = false; index += 1; continue; }
      field += char; index += 1; continue;
    }
    if (char === '"') {
      if (field.length) throw new Error(`CSV quote must start a field (row ${rows.length + 1}).`);
      quoted = true; index += 1; continue;
    }
    if (char === ",") { row.push(field); field = ""; index += 1; continue; }
    if (char === "\r" || char === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
      index += char === "\r" && source[index + 1] === "\n" ? 2 : 1; continue;
    }
    field += char; index += 1;
  }
  if (quoted) throw new Error("CSV ends inside a quoted field.");
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

export const importRequest = z.object({
  source: z.enum(["mamcos", "tss", "tumcos"]),
  csv: z.string().min(1).max(CSV_MAX_BYTES),
  authorized_by: z.string().trim().min(2).max(200),
  permission_reference: z.string().trim().min(3).max(500),
  attestation: z.literal(true),
  dry_run: z.boolean().default(false),
}).strict();

function amount(value: string | undefined): number | null {
  const text = (value ?? "").trim().replace(/,/g, "");
  return /^\d+(?:\.\d+)?$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
}
function optionalAmount(value: string | undefined): { value: number | null; ok: boolean } {
  if (!(value ?? "").trim()) return { value: null, ok: true };
  const parsed = amount(value);
  return { value: parsed, ok: parsed !== null };
}
const QUINTAL = /^(?:INR|₹|Rs\.?)\s*\/\s*(?:quintal|qtl)$/i;

export async function parseCooperativeCsv(source: CooperativeSource, csv: string, meta: { importedAt: string; sourceReference: string }) {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error("CSV requires a header row and at least one record.");
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const unknown = header.filter((column) => !(CSV_COLUMNS as readonly string[]).includes(column));
  if (unknown.length) throw new Error(`Unsupported CSV columns: ${unknown.join(", ")}.`);
  const missing = REQUIRED.filter((column) => !header.includes(column));
  if (missing.length) throw new Error(`Missing required CSV columns: ${missing.join(", ")}.`);
  if (new Set(header).size !== header.length) throw new Error("Duplicate CSV column names.");
  if (rows.length - 1 > CSV_MAX_ROWS) throw new Error(`CSV import is limited to ${CSV_MAX_ROWS} records per request.`);
  const today = calendarTodayIST(new Date(meta.importedAt));
  const seen = new Set<string>();
  const quotes: CooperativeQuote[] = [];
  for (const [position, cells] of rows.slice(1).entries()) {
    if (cells.length !== header.length) throw new Error(`CSV row ${position + 2} has ${cells.length} fields; expected ${header.length}.`);
    const record = Object.fromEntries(header.map((column, index) => [column, cells[index].trim()])) as Record<string, string>;
    const problems: string[] = [];
    const flags: string[] = ["manual_csv_import"];
    const commodity = record.commodity.toLowerCase().replace(/\s+/g, "_") as CooperativeCommodity;
    if (commodity !== "arecanut" && commodity !== "black_pepper") problems.push("Unsupported commodity.");
    else if (commodity === "black_pepper" && source !== "tumcos") problems.push("Black pepper is only supported for TUMCOS.");
    if (!validTssDate(record.reporting_date)) problems.push("Invalid reporting date.");
    else if (record.reporting_date > today) problems.push("Future reporting date.");
    if (!record.branch) problems.push("Missing branch or market.");
    if (!record.variety) problems.push("Missing variety.");
    if (source === "tss" && record.branch && !(TSS_LOCATIONS as readonly string[]).includes(record.branch)) problems.push("Unknown TSS location.");
    const minimum = amount(record.minimum_price), maximum = amount(record.maximum_price), average = amount(record.average_price);
    if ([minimum, maximum, average].some((value) => value === null || value <= 0)) problems.push("Missing, non-positive or unsupported price.");
    if (minimum !== null && maximum !== null && average !== null && !(minimum <= average && average <= maximum)) problems.push("Prices do not satisfy minimum <= average <= maximum.");
    const lots = optionalAmount(record.lot_count), bags = optionalAmount(record.bag_count), weight = optionalAmount(record.reported_weight);
    if (!lots.ok || !bags.ok || !weight.ok) problems.push("Unsupported lot, bag or weight value.");
    const declaredUnit = record.declared_unit;
    const evidence = record.unit_evidence ?? "";
    let unitStatus: UnitStatus = "assumed";
    if (source !== "tss" && QUINTAL.test(declaredUnit) && evidence.length >= 10) unitStatus = "source_confirmed";
    const operatorAssumed = unitStatus === "assumed" && operatorAssumesUnit(source) && (source === "tss" || (average !== null && average >= PER_KG_PLAUSIBILITY_LIMIT));
    if (unitStatus === "assumed") flags.push(operatorAssumed ? "unit_operator_assumed" : "unit_not_confirmed");
    const key = JSON.stringify([commodity, record.branch, record.reporting_date, record.variety, record.source_record_id ?? ""]);
    if (seen.has(key)) throw new Error(`Duplicate CSV observation at row ${position + 2}.`);
    seen.add(key);
    const raw = JSON.stringify(record);
    quotes.push({
      id: await sha256Hex(JSON.stringify(["manual_csv", source, key, raw])),
      source_key: source, commodity, branch: record.branch, reporting_date: record.reporting_date,
      variety: record.variety, variety_reported: true,
      minimum_price: minimum, maximum_price: maximum, average_price: average, normal_price: null,
      price_type: "reported_average", price_unit: unitStatus === "source_confirmed" || operatorAssumed ? "INR/quintal" : "unconfirmed",
      source_unit_label: declaredUnit || null, unit_status: unitStatus,
      lot_count: lots.value, bag_count: bags.value, reported_weight: weight.value,
      source_record_id: record.source_record_id ?? "", review_flags: flags,
      source_url: record.source_reference || meta.sourceReference, fetched_at: meta.importedAt, raw_record: raw,
      validation_message: problems.join(" ") || null, status: problems.length ? "invalid" : "pending",
    });
  }
  return quotes;
}

export async function importCooperativeCsv(db: D1Database, request: z.infer<typeof importRequest>) {
  const importedAt = new Date().toISOString();
  const quotes = await parseCooperativeCsv(request.source, request.csv, { importedAt, sourceReference: request.permission_reference });
  const summary = {
    source: request.source, dry_run: request.dry_run, received_count: quotes.length,
    pending_count: quotes.filter((row) => row.status === "pending").length,
    invalid_count: quotes.filter((row) => row.status === "invalid").length,
    rejected: quotes.filter((row) => row.status === "invalid").map((row) => ({ branch: row.branch, reporting_date: row.reporting_date, variety: row.variety, reason: row.validation_message })),
  };
  if (request.dry_run) return { ...summary, fetch_id: null, inserted_count: 0, duplicate_count: 0 };
  const fetchId = await startCooperativeFetch(db, request.source, `manual-csv:${request.permission_reference}`, { mode: "manual_csv" });
  try {
    const inserted = await storeCooperativeSnapshot(db, fetchId, request.source, request.csv, quotes, quotes.length, 0, {
      mode: "manual_csv", attempts: 0, httpStatus: null,
      notes: JSON.stringify({ authorized_by: request.authorized_by, permission_reference: request.permission_reference, attested: true }),
    });
    return { ...summary, fetch_id: fetchId, inserted_count: inserted, duplicate_count: quotes.length - inserted };
  } catch (error) {
    await failCooperativeFetch(db, fetchId, error);
    throw error;
  }
}

type StoredFetch = { id: string; source_key: CooperativeSource; source_url: string; started_at: string; status: string;
  raw_snapshot: string | null; ingest_mode: string | null; requested_date: string | null; notes: string | null };

/** Re-parses an immutable stored snapshot with the current parser. Rows already stored keep their identity and are counted as duplicates. */
export async function replayCooperativeSnapshot(db: D1Database, fetchId: string,
  options: { scope?: "recent" | "full_history"; archive?: R2Bucket } = {}) {
  const stored = await db.prepare(`SELECT id, source_key, source_url, started_at, status, raw_snapshot, ingest_mode, requested_date, notes
    FROM cooperative_fetches WHERE id = ?`).bind(fetchId).first<StoredFetch>();
  if (!stored) throw new Error("Stored fetch not found.");
  if (!stored.raw_snapshot) {
    // Inline copy may have been offloaded to R2 after a verified archive copy was registered.
    const archived = await readRelatedText({ DB: db, ARCHIVE: options.archive }, "cooperative_fetches", stored.id);
    if (archived.status !== "ok" || archived.text === undefined) {
      throw new Error(archived.status === "not_archived" ? "Stored fetch has no raw snapshot to replay." : archiveReadMessage(archived));
    }
    stored.raw_snapshot = archived.text;
  }
  const fetchedAt = stored.started_at;
  let quotes: CooperativeQuote[], received: number, excluded = 0, notes: string | null = null;
  if (stored.ingest_mode === "manual_csv") {
    const reference = stored.notes ? (JSON.parse(stored.notes) as { permission_reference?: string }).permission_reference ?? stored.source_url : stored.source_url;
    quotes = await parseCooperativeCsv(stored.source_key, stored.raw_snapshot, { importedAt: fetchedAt, sourceReference: reference });
    quotes = quotes.map((row) => ({ ...row, review_flags: [...(row.review_flags ?? []), "snapshot_replay"] }));
    received = quotes.length;
  } else if (stored.source_key === "mamcos") {
    quotes = await parseMamcos(stored.raw_snapshot, fetchedAt); received = quotes.length;
  } else if (stored.source_key === "tss") {
    const url = new URL(stored.source_url);
    const location = url.searchParams.get("location") as typeof TSS_LOCATIONS[number] | null;
    const date = url.searchParams.get("date_param") ?? stored.requested_date;
    if (!location || !(TSS_LOCATIONS as readonly string[]).includes(location) || !date) throw new Error("Stored TSS fetch is missing location or date.");
    const aggregates = stored.notes ? (JSON.parse(stored.notes) as { tender_aggregates?: Record<string, TssLotAggregate> }).tender_aggregates : undefined;
    const parsed = await parseTss(JSON.parse(stored.raw_snapshot), location, date, fetchedAt, aggregates ? new Map(Object.entries(aggregates)) : undefined);
    quotes = parsed.quotes; received = parsed.received_count; excluded = parsed.excluded_count; notes = stored.notes;
  } else {
    const parsed = await parseTumcos(stored.raw_snapshot, fetchedAt, options.scope ?? "recent");
    quotes = parsed.quotes; received = parsed.received_count; excluded = parsed.excluded_count; notes = tumcosNotes(parsed);
  }
  const replayId = await startCooperativeFetch(db, stored.source_key, stored.source_url, { mode: "snapshot_replay", replayOf: stored.id, requestedDate: stored.requested_date });
  try {
    const inserted = await storeCooperativeSnapshot(db, replayId, stored.source_key, stored.raw_snapshot, quotes, received, excluded,
      { mode: "snapshot_replay", attempts: 0, httpStatus: null, notes });
    return { fetch_id: replayId, replay_of: stored.id, source: stored.source_key, received_count: received, parsed_count: quotes.length,
      inserted_count: inserted, duplicate_count: quotes.length - inserted, invalid_count: quotes.filter((row) => row.status === "invalid").length };
  } catch (error) {
    await failCooperativeFetch(db, replayId, error);
    throw error;
  }
}

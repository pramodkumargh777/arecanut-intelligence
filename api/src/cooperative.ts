import { z } from "zod";
import { median } from "./domain/analytics";
import { fetchWithRetry, sha256Hex, SourceFetchError } from "./cooperative-fetch";
import { priceBasisForSource } from "../../shared/commodities";
import { publishableUnit } from "./cooperative-units";

export const MAMCOS_URL = "https://mamcos.info/areca-market-rates";
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const sourceRow = z.object({
  itemname: z.string(), minprice: z.string(), maxprice: z.string(), avgprice: z.string(),
  branch: z.string().min(1), Date: z.string(),
});
export type CooperativeSource = "mamcos" | "tss" | "tumcos";
export type CooperativeCommodity = "arecanut" | "black_pepper";
export type IngestMode = "scheduled" | "manual_refresh" | "backfill" | "manual_csv" | "snapshot_replay";
export type UnitStatus = "source_confirmed" | "assumed" | "source_conflict";
export type CooperativeQuote = {
  id: string; source_key: string; branch: string; reporting_date: string; variety: string;
  minimum_price: number | null; maximum_price: number | null; average_price: number | null;
  price_type: "reported_average"; price_unit: "INR/quintal" | "unconfirmed"; source_url: string;
  fetched_at: string; raw_record: string; validation_message: string | null;
  status: string;
  unit_status: UnitStatus;
  normal_price: number | null;
  commodity?: CooperativeCommodity;
  variety_reported?: boolean;
  source_unit_label?: string | null;
  lot_count?: number | null;
  bag_count?: number | null;
  reported_weight?: number | null;
  session_codes?: string | null;
  source_record_id?: string;
  source_published_at?: string | null;
  review_flags?: string[];
};
export type FetchMeta = { mode?: IngestMode; attempts?: number; httpStatus?: number | null; notes?: string | null; requestedDate?: string | null; replayOf?: string | null };

function decodeAttribute(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function reportingDate(value: string): string {
  const match = /^(\d{2})-([A-Za-z]+)-(\d{4})$/.exec(value);
  if (!match) throw new Error(`Unsupported MAMCOS reporting date: ${value}`);
  const month = months.indexOf(match[2]) + 1;
  const date = `${match[3]}-${String(month).padStart(2, "0")}-${match[1]}`;
  if (!month || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Invalid MAMCOS reporting date.");
  return date;
}

export async function parseMamcos(html: string, fetchedAt: string): Promise<CooperativeQuote[]> {
  if (!/All market rates are in\s+(?:₹|INR|Rs\.?)\s+per Quintal/i.test(decodeAttribute(html))) throw new Error("MAMCOS INR/quintal price-unit declaration is missing.");
  let entries: unknown[] | undefined;
  for (const match of html.matchAll(/wire:snapshot="([^"]+)"/g)) {
    const snapshot: unknown = JSON.parse(decodeAttribute(match[1]));
    const parsed = z.object({ data: z.object({ rates: z.tuple([z.array(z.unknown()), z.unknown()]) }) }).safeParse(snapshot);
    if (parsed.success) { entries = parsed.data.data.rates[0]; break; }
  }
  if (!entries?.length) throw new Error("MAMCOS structured rate list is missing or empty.");
  const result: CooperativeQuote[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const row = sourceRow.parse(z.tuple([z.unknown(), z.unknown()]).parse(entry)[0]);
    const branch = row.branch.trim();
    const variety = row.itemname.trim();
    const date = reportingDate(row.Date);
    const values = [row.minprice, row.maxprice, row.avgprice].map((text) => /^\d+(?:\.\d+)?$/.test(text.trim()) && Number.isFinite(Number(text)) ? Number(text) : null);
    const [minimum, maximum, average] = values;
    const problems: string[] = [];
    if (!branch) problems.push("Missing reported branch.");
    if (!variety || variety === "-") problems.push("Missing reported variety.");
    if (values.some((value) => value === null || value <= 0)) problems.push("Missing, non-positive or unsupported price.");
    if (minimum !== null && maximum !== null && average !== null && !(minimum <= average && average <= maximum)) problems.push("Reported prices do not satisfy minimum <= average <= maximum.");
    if (date > fetchedAt.slice(0, 10)) problems.push("Future reporting date.");
    const key = JSON.stringify([branch, date, variety]);
    if (seen.has(key)) throw new Error(`Duplicate MAMCOS branch/date/variety: ${key}`);
    seen.add(key);
    const raw = JSON.stringify(row);
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(["mamcos", key, raw, "INR/quintal", "reported_average"])));
    const id = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    result.push({
      id, source_key: "mamcos", branch, reporting_date: date, variety,
      minimum_price: minimum, maximum_price: maximum, average_price: average,
      price_type: "reported_average", price_unit: "INR/quintal", source_url: MAMCOS_URL,
      fetched_at: fetchedAt, raw_record: raw, validation_message: problems.join(" ") || null,
      status: problems.length ? "invalid" : "pending",
      unit_status: "source_confirmed", normal_price: null,
    });
  }
  return result;
}

export async function startCooperativeFetch(db: D1Database, source: CooperativeSource, url: string, meta: FetchMeta = {}) {
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO cooperative_fetches (id,source_key,source_url,started_at,status,ingest_mode,requested_date,replay_of)
    VALUES (?,?,?,?,'running',?,?,?)`).bind(id, source, url, new Date().toISOString(), meta.mode ?? "manual_refresh",
    meta.requestedDate ?? null, meta.replayOf ?? null).run();
  return id;
}

export async function failCooperativeFetch(db: D1Database, fetchId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const attempts = error instanceof SourceFetchError ? error.attempts : null;
  const httpStatus = error instanceof SourceFetchError ? error.httpStatus : null;
  await db.prepare(`UPDATE cooperative_fetches SET status='failed',finished_at=?,error_message=?,
    attempt_count=COALESCE(?,attempt_count),http_status=? WHERE id=?`)
    .bind(new Date().toISOString(), message.slice(0, 1_000), attempts, httpStatus, fetchId).run();
  return message;
}

export async function refreshMamcos(db: D1Database, options: { mode?: IngestMode; attempts?: number; fetcher?: typeof fetch } = {}) {
  const fetchId = await startCooperativeFetch(db, "mamcos", MAMCOS_URL, { mode: options.mode });
  try {
    const { response, attempts } = await fetchWithRetry(MAMCOS_URL, { headers: { Accept: "text/html" } }, { attempts: options.attempts, fetcher: options.fetcher });
    if (!response.headers.get("content-type")?.includes("text/html")) throw new Error("MAMCOS did not return HTML.");
    const html = await response.text();
    if (html.length > 1_500_000) throw new Error("MAMCOS snapshot exceeds supported size.");
    const fetchedAt = new Date().toISOString();
    const rows = await parseMamcos(html, fetchedAt);
    const inserted = await storeCooperativeSnapshot(db, fetchId, "mamcos", html, rows, rows.length, 0,
      { mode: options.mode, attempts, httpStatus: response.status });
    return { fetch_id: fetchId, attempts, received_count: rows.length, inserted_count: inserted, duplicate_count: rows.length - inserted,
      invalid_count: rows.filter((row) => row.status === "invalid").length };
  } catch (error) {
    await failCooperativeFetch(db, fetchId, error);
    throw error;
  }
}

const STORE_CHUNK = 400;

export async function storeCooperativeSnapshot(db: D1Database, fetchId: string, source: CooperativeSource,
  snapshot: string, rows: CooperativeQuote[], receivedCount = rows.length, excludedCount = 0, meta: FetchMeta = {}) {
    const statements: D1PreparedStatement[] = [];
    const insertionIndexes: number[] = [];
    for (const row of rows) {
      if (row.source_key !== source) throw new Error("Cooperative snapshot rows must belong to the snapshot source.");
      const commodity = row.commodity ?? "arecanut", recordId = row.source_record_id ?? "";
      statements.push(db.prepare(`UPDATE cooperative_quotes SET status='superseded'
        WHERE source_key=? AND commodity=? AND branch=? AND reporting_date=? AND variety=? AND source_record_id=? AND id!=? AND status!='superseded'`)
        .bind(source, commodity, row.branch, row.reporting_date, row.variety, recordId, row.id));
      insertionIndexes.push(statements.length);
      statements.push(db.prepare(`INSERT INTO cooperative_quotes
        (id,source_key,commodity,branch,reporting_date,variety,variety_reported,minimum_price,maximum_price,average_price,price_type,price_unit,
         source_unit_label,unit_status,normal_price,lot_count,bag_count,reported_weight,session_codes,source_record_id,source_published_at,review_flags,
         ingest_mode,source_url,fetched_at,fetch_id,raw_record,validation_message,status,price_basis)
        VALUES (?,?,?,?,?,?,?,?,?,?,'reported_average',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status, fetched_at=excluded.fetched_at,fetch_id=excluded.fetch_id
        WHERE cooperative_quotes.status='superseded'`)
        .bind(row.id, source, commodity, row.branch, row.reporting_date, row.variety, row.variety_reported === false ? 0 : 1,
          row.minimum_price, row.maximum_price, row.average_price, row.price_unit, row.source_unit_label ?? null, row.unit_status,
          row.normal_price, row.lot_count ?? null, row.bag_count ?? null, row.reported_weight ?? null, row.session_codes ?? null,
          recordId, row.source_published_at ?? null, row.review_flags?.length ? JSON.stringify(row.review_flags) : null,
          meta.mode ?? "manual_refresh", row.source_url, row.fetched_at, fetchId, row.raw_record, row.validation_message, row.status,
          priceBasisForSource(source)));
    }
    let inserted = 0;
    for (let start = 0; start < statements.length; start += STORE_CHUNK) {
      const results = await db.batch(statements.slice(start, start + STORE_CHUNK));
      inserted += insertionIndexes.filter((index) => index >= start && index < start + STORE_CHUNK)
        .reduce((sum, index) => sum + results[index - start].meta.changes, 0);
    }
    await db.prepare(`UPDATE cooperative_fetches SET status='succeeded',finished_at=?,raw_snapshot=?,snapshot_sha256=?,received_count=?,
      excluded_count=?,inserted_count=?,attempt_count=?,http_status=?,notes=? WHERE id=?`)
      .bind(new Date().toISOString(), snapshot, await sha256Hex(snapshot), receivedCount, excludedCount, inserted,
        meta.attempts ?? 1, meta.httpStatus ?? null, meta.notes ?? null, fetchId).run();
    return inserted;
}

type BenchmarkRow = Pick<CooperativeQuote, "branch" | "reporting_date" | "average_price" | "unit_status" | "price_unit">;

/** Distinct publishable INR/quintal prices per date and branch. More than one price for a branch and date is a conflict. */
function confirmedPrices(rows: BenchmarkRow[]) {
  const dates = new Map<string, Map<string, Set<number>>>();
  for (const row of rows) {
    if (row.average_price === null || !publishableUnit(row)) continue;
    if (!Number.isFinite(row.average_price) || row.average_price <= 0) {
      throw new Error("Invalid cooperative benchmark observation");
    }
    const branches = dates.get(row.reporting_date) ?? new Map<string, Set<number>>();
    branches.set(row.branch, (branches.get(row.branch) ?? new Set<number>()).add(row.average_price));
    dates.set(row.reporting_date, branches);
  }
  return dates;
}

/** Branch/date pairs left out of the benchmark because verified rows disagree on the price. */
export function cooperativeConflicts(rows: BenchmarkRow[]) {
  return [...confirmedPrices(rows)].flatMap(([reporting_date, branches]) => [...branches]
    .filter(([, prices]) => prices.size > 1)
    .map(([branch, prices]) => ({ reporting_date, branch, prices: [...prices].sort((a, b) => a - b) })))
    .sort((a, b) => a.reporting_date.localeCompare(b.reporting_date) || a.branch.localeCompare(b.branch));
}

export function cooperativeSeries(rows: CooperativeQuote[], coverage: number) {
  if (new Set(rows.map((row) => row.source_key)).size > 1 || new Set(rows.map((row) => row.variety)).size > 1) {
    throw new Error("A cooperative benchmark requires one source and one exact variety");
  }
  if (new Set(rows.map((row) => row.commodity ?? "arecanut")).size > 1) {
    throw new Error("A cooperative benchmark requires one commodity");
  }
  // A conflicted branch is withheld for that date, never averaged or picked; cooperativeConflicts reports it.
  return [...confirmedPrices(rows)].map(([reporting_date, branches]) => {
    const usable = new Map([...branches].filter(([, prices]) => prices.size === 1).map(([branch, prices]) => [branch, [...prices][0]]));
    return { reporting_date, usable };
  }).filter(({ usable }) => usable.size >= coverage).map(({ reporting_date, usable }) => ({
    reporting_date, median_average_price: median([...usable.values()])!, branch_count: usable.size,
    branches: [...usable.keys()].sort(),
  })).sort((a, b) => a.reporting_date.localeCompare(b.reporting_date));
}

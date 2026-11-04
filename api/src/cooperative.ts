import { z } from "zod";
import { median } from "./domain/analytics";

export const MAMCOS_URL = "https://mamcos.info/areca-market-rates";
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const sourceRow = z.object({
  itemname: z.string(), minprice: z.string(), maxprice: z.string(), avgprice: z.string(),
  branch: z.string().min(1), Date: z.string(),
});
export type CooperativeQuote = {
  id: string; source_key: string; branch: string; reporting_date: string; variety: string;
  minimum_price: number | null; maximum_price: number | null; average_price: number | null;
  price_type: "reported_average"; price_unit: "INR/quintal"; source_url: string;
  fetched_at: string; raw_record: string; validation_message: string | null;
  status: string;
  unit_status: "source_confirmed" | "assumed";
  normal_price: number | null;
};

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

export async function refreshMamcos(db: D1Database) {
  const fetchId = crypto.randomUUID();
  await db.prepare(`INSERT INTO cooperative_fetches (id,source_key,source_url,started_at,status)
    VALUES (?,'mamcos',?,?,'running')`).bind(fetchId, MAMCOS_URL, new Date().toISOString()).run();
  try {
    const response = await fetch(MAMCOS_URL, { redirect: "manual", signal: AbortSignal.timeout(60_000), headers: { Accept: "text/html" } });
    if (!response.ok) throw new Error(`MAMCOS returned HTTP ${response.status}`);
    if (!response.headers.get("content-type")?.includes("text/html")) throw new Error("MAMCOS did not return HTML.");
    const html = await response.text();
    if (html.length > 1_500_000) throw new Error("MAMCOS snapshot exceeds supported size.");
    const fetchedAt = new Date().toISOString();
    const rows = await parseMamcos(html, fetchedAt);
    const inserted = await storeCooperativeSnapshot(db, fetchId, "mamcos", html, rows);
    return { received_count: rows.length, inserted_count: inserted, invalid_count: rows.filter((row) => row.status === "invalid").length };
  } catch (error) {
    await db.prepare("UPDATE cooperative_fetches SET status='failed',finished_at=?,error_message=? WHERE id=?")
      .bind(new Date().toISOString(), error instanceof Error ? error.message : String(error), fetchId).run();
    throw error;
  }
}

export async function storeCooperativeSnapshot(db: D1Database, fetchId: string, source: "mamcos" | "tss",
  snapshot: string, rows: CooperativeQuote[], receivedCount = rows.length, excludedCount = 0) {
    const statements: D1PreparedStatement[] = [];
    const insertionIndexes: number[] = [];
    for (const row of rows) {
      statements.push(db.prepare(`UPDATE cooperative_quotes SET status='superseded'
        WHERE source_key=? AND branch=? AND reporting_date=? AND variety=? AND id!=? AND status!='superseded'`)
        .bind(source, row.branch, row.reporting_date, row.variety, row.id));
      insertionIndexes.push(statements.length);
      statements.push(db.prepare(`INSERT INTO cooperative_quotes
        (id,source_key,branch,reporting_date,variety,minimum_price,maximum_price,average_price,price_type,price_unit,source_url,fetched_at,fetch_id,raw_record,validation_message,status,unit_status,normal_price)
        VALUES (?,?,?,?,?,?,?,?,'reported_average','INR/quintal',?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status, fetched_at=excluded.fetched_at,fetch_id=excluded.fetch_id
        WHERE cooperative_quotes.status='superseded'`)
        .bind(row.id, source, row.branch, row.reporting_date, row.variety, row.minimum_price, row.maximum_price, row.average_price,
          row.source_url, row.fetched_at, fetchId, row.raw_record, row.validation_message, row.status, row.unit_status, row.normal_price));
    }
    statements.push(db.prepare(`UPDATE cooperative_fetches SET status='succeeded',finished_at=?,raw_snapshot=?,received_count=?,excluded_count=? WHERE id=?`)
      .bind(new Date().toISOString(), snapshot, receivedCount, excludedCount, fetchId));
    const results = await db.batch(statements);
    const inserted = insertionIndexes.reduce((sum, index) => sum + results[index].meta.changes, 0);
    await db.prepare("UPDATE cooperative_fetches SET inserted_count=? WHERE id=?").bind(inserted, fetchId).run();
    return inserted;
}

export function cooperativeSeries(rows: CooperativeQuote[], coverage: number) {
  const dates = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.average_price === null || row.unit_status !== "source_confirmed") continue;
    const branches = dates.get(row.reporting_date) ?? new Map<string, number>();
    branches.set(row.branch, row.average_price);
    dates.set(row.reporting_date, branches);
  }
  return [...dates].filter(([, branches]) => branches.size >= coverage).map(([reporting_date, branches]) => ({
    reporting_date, median_average_price: median([...branches.values()])!, branch_count: branches.size,
    branches: [...branches.keys()].sort(),
  })).sort((a, b) => a.reporting_date.localeCompare(b.reporting_date));
}

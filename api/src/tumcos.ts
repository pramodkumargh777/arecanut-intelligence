import { z } from "zod";
import { calendarTodayIST, DAY_MS } from "../../shared/dates";
import {
  failCooperativeFetch, startCooperativeFetch, storeCooperativeSnapshot,
  type CooperativeCommodity, type CooperativeQuote, type IngestMode, type UnitStatus,
} from "./cooperative";
import { fetchWithRetry, sha256Hex } from "./cooperative-fetch";

export const TUMCOS_URL = "https://www.tumcos.com/market-rates.php?lang=en";
export const TUMCOS_RECENT_DAYS = 45;
/** Values above this are implausible as INR per kilogram for arecanut or black pepper. */
export const TUMCOS_PER_KG_PLAUSIBILITY_LIMIT = 1_000;

const ARRAYS: { key: string; commodity: CooperativeCommodity; category: string; itemName: string }[] = [
  { key: "arecanut", commodity: "arecanut", category: "Arecanut", itemName: "areca" },
  { key: "blackPepper", commodity: "black_pepper", category: "Black Pepper", itemName: "black pepper" },
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const sourceRecord = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  date: z.string(),
  name: z.string(),
  low: z.union([z.string(), z.number(), z.null()]),
  average: z.union([z.string(), z.number(), z.null()]),
  top: z.union([z.string(), z.number(), z.null()]),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  product_name: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  quality: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
}).passthrough();
type SourceRecord = z.infer<typeof sourceRecord>;

/** Extracts a JSON array literal that follows `key:` inside the embedded chartData object. */
export function extractJsonArray(text: string, key: string, from = 0): unknown[] | null {
  const keyAt = text.slice(from).search(new RegExp(`\\b${key}\\s*:\\s*\\[`));
  if (keyAt < 0) return null;
  const open = text.indexOf("[", from + keyAt);
  let depth = 0, inString = false, escaped = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]" && --depth === 0) {
      const parsed: unknown = JSON.parse(text.slice(open, index + 1));
      return Array.isArray(parsed) ? parsed : null;
    }
  }
  throw new Error(`TUMCOS ${key} array is not terminated.`);
}

function amount(value: string | number | null): number | null {
  if (value === null) return null;
  const text = String(value).trim();
  return /^\d+(?:\.\d+)?$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
}

function realDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function textContent(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

/** Reads the page-level "Last Updated" label. It is metadata only and is never used as a market date. */
export function tumcosPageLastUpdated(html: string): { label: string; date: string | null } | null {
  const match = /Last Updated:\s*([^<]+?)\s*</i.exec(html);
  if (!match) return null;
  const parts = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/.exec(match[1].trim());
  const month = parts ? MONTHS.indexOf(parts[2]) + 1 : 0;
  const date = parts && month ? `${parts[3]}-${String(month).padStart(2, "0")}-${parts[1].padStart(2, "0")}` : null;
  return { label: match[1].trim(), date: date && realDate(date) ? date : null };
}

export type TumcosTableRow = { product: string; average: number | null; high: number | null; low: number | null; date: string | null; location: string };

/** Parses the visible "Market Rates" table, used only to cross-check the embedded record arrays. */
export function parseTumcosTable(html: string): TumcosTableRow[] {
  return [...html.matchAll(/<tr class="market-row[\s\S]*?<\/tr>/g)].map((match) => {
    const cells = [...match[0].matchAll(/<td[\s\S]*?<\/td>/g)].map((cell) => textContent(cell[0]));
    const money = (value: string | undefined) => amount((value ?? "").replace(/[₹,\s]/g, "") || null);
    const parsedDate = /^([A-Za-z]{3}) (\d{2}), (\d{4})$/.exec(cells[6] ?? "");
    const month = parsedDate ? MONTHS.indexOf(parsedDate[1]) + 1 : 0;
    const date = parsedDate && month ? `${parsedDate[3]}-${String(month).padStart(2, "0")}-${parsedDate[2]}` : null;
    return {
      product: (cells[0] ?? "").split(" ")[0] === "Black" ? "Black Pepper" : (cells[0] ?? "").split(" ")[0],
      average: money(cells[1]), high: money(cells[2]), low: money(cells[3]),
      date: date && realDate(date) ? date : null, location: (cells[7] ?? "").replace(/Karnataka, India$/, "").trim(),
    };
  });
}

export type TumcosParseResult = {
  quotes: CooperativeQuote[]; received_count: number; excluded_count: number;
  page_last_updated: { label: string; date: string | null } | null; latest_record_date: string | null;
  stale_page_metadata: boolean;
  table_check: { rows: number; matched: number; unmatched: TumcosTableRow[] };
};

export async function parseTumcos(html: string, fetchedAt: string, scope: "recent" | "full_history" = "recent"): Promise<TumcosParseResult> {
  const chartAt = html.indexOf("const chartData");
  if (chartAt < 0) throw new Error("TUMCOS embedded chartData records are missing.");
  const todayIST = calendarTodayIST(new Date(fetchedAt));
  const recentFrom = new Date(Date.parse(`${todayIST}T00:00:00Z`) - TUMCOS_RECENT_DAYS * DAY_MS).toISOString().slice(0, 10);
  const parsed: { record: SourceRecord; raw: unknown; spec: typeof ARRAYS[number] }[] = [];
  for (const spec of ARRAYS) {
    const records = extractJsonArray(html, spec.key, chartAt);
    if (records === null) throw new Error(`TUMCOS ${spec.key} record array is missing.`);
    for (const raw of records) parsed.push({ record: sourceRecord.parse(raw), raw, spec });
  }
  if (!parsed.length) throw new Error("TUMCOS published no market-rate records.");
  const seenIds = new Set<string>();
  const perDate = new Map<string, number>();
  for (const { record, spec } of parsed) {
    const key = `${spec.commodity}|${record.id}`;
    if (seenIds.has(key)) throw new Error(`Duplicate TUMCOS source record id ${record.id} in ${spec.key}.`);
    seenIds.add(key);
    const dateKey = `${spec.commodity}|${(record.location ?? "").trim()}|${record.date.slice(0, 10)}`;
    perDate.set(dateKey, (perDate.get(dateKey) ?? 0) + 1);
  }
  const quotes: CooperativeQuote[] = [];
  let excluded = 0;
  for (const { record, raw, spec } of parsed) {
    const reportingDate = record.date.slice(0, 10);
    if (scope === "recent" && realDate(reportingDate) && reportingDate < recentFrom) { excluded += 1; continue; }
    const problems: string[] = [];
    const flags: string[] = ["variety_not_reported"];
    const branch = (record.location ?? "").trim();
    const itemName = record.name.trim();
    if (!/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?$/.test(record.date) || !realDate(reportingDate)) problems.push("Invalid source record date.");
    else if (reportingDate > todayIST) problems.push("Future reporting date.");
    if (!branch) problems.push("Missing reported market location.");
    const declaredCommodity = [record.category, record.product_name].filter(Boolean).map((value) => value!.trim());
    if (declaredCommodity.some((value) => value !== spec.category)) problems.push(`Source category ${JSON.stringify(declaredCommodity.join(" / "))} does not match the ${spec.category} record list.`);
    if (itemName.toLowerCase() !== spec.itemName) problems.push(`Source item name ${JSON.stringify(itemName)} conflicts with the ${spec.category} record list; commodity is not reassigned.`);
    const minimum = amount(record.low), maximum = amount(record.top), average = amount(record.average);
    if ([minimum, maximum, average].some((value) => value === null || value <= 0)) problems.push("Missing, non-positive or unsupported price.");
    if (minimum !== null && maximum !== null && average !== null && !(minimum <= average && average <= maximum)) problems.push("Reported prices do not satisfy low <= average <= high.");
    const declaredUnit = record.unit?.trim() || null;
    let unitStatus: UnitStatus = "assumed";
    let priceUnit: CooperativeQuote["price_unit"] = "unconfirmed";
    if (declaredUnit && /quintal|qtl/i.test(declaredUnit)) { unitStatus = "source_confirmed"; priceUnit = "INR/quintal"; }
    else if (declaredUnit && /^kg$/i.test(declaredUnit) && [minimum, maximum, average].some((value) => value !== null && value >= TUMCOS_PER_KG_PLAUSIBILITY_LIMIT)) {
      unitStatus = "source_conflict";
      flags.push("declared_unit_conflicts_with_magnitude");
    } else flags.push("unit_not_confirmed");
    if ((perDate.get(`${spec.commodity}|${branch}|${reportingDate}`) ?? 0) > 1) flags.push("multiple_source_records_same_date");
    const rawRecord = JSON.stringify(raw);
    quotes.push({
      id: await sha256Hex(JSON.stringify(["tumcos", spec.commodity, record.id, rawRecord])),
      source_key: "tumcos", commodity: spec.commodity, branch: branch || "(not reported)", reporting_date: reportingDate,
      variety: itemName || "(not reported)", variety_reported: false,
      minimum_price: minimum, maximum_price: maximum, average_price: average, normal_price: null,
      price_type: "reported_average", price_unit: priceUnit, source_unit_label: declaredUnit, unit_status: unitStatus,
      source_record_id: record.id, source_published_at: record.created_at ?? null, review_flags: flags,
      source_url: TUMCOS_URL, fetched_at: fetchedAt, raw_record: rawRecord,
      validation_message: problems.join(" ") || null, status: problems.length ? "invalid" : "pending",
    });
  }
  const validDates = parsed.map(({ record }) => record.date.slice(0, 10)).filter(realDate).sort();
  const latest = validDates.at(-1) ?? null;
  const pageLastUpdated = tumcosPageLastUpdated(html);
  const table = parseTumcosTable(html);
  const unmatched = table.filter((row) => !parsed.some(({ record, spec }) => spec.category === row.product
    && record.date.slice(0, 10) === row.date && (record.location ?? "").trim() === row.location
    && amount(record.average) === row.average && amount(record.top) === row.high && amount(record.low) === row.low));
  return {
    quotes, received_count: parsed.length, excluded_count: excluded, page_last_updated: pageLastUpdated, latest_record_date: latest,
    stale_page_metadata: Boolean(pageLastUpdated?.date && latest && pageLastUpdated.date < latest),
    table_check: { rows: table.length, matched: table.length - unmatched.length, unmatched },
  };
}

export async function refreshTumcos(db: D1Database, options: { scope?: "recent" | "full_history"; mode?: IngestMode; attempts?: number; fetcher?: typeof fetch } = {}) {
  const mode = options.mode ?? (options.scope === "full_history" ? "backfill" : "manual_refresh");
  const fetchId = await startCooperativeFetch(db, "tumcos", TUMCOS_URL, { mode });
  try {
    const { response, attempts } = await fetchWithRetry(TUMCOS_URL, { headers: { Accept: "text/html" } }, { attempts: options.attempts, fetcher: options.fetcher });
    if (!response.headers.get("content-type")?.includes("text/html")) throw new Error("TUMCOS did not return HTML.");
    const html = await response.text();
    if (html.length > 1_500_000) throw new Error("TUMCOS snapshot exceeds supported size.");
    const parsed = await parseTumcos(html, new Date().toISOString(), options.scope ?? "recent");
    const notes = tumcosNotes(parsed);
    const inserted = await storeCooperativeSnapshot(db, fetchId, "tumcos", html, parsed.quotes, parsed.received_count, parsed.excluded_count,
      { mode, attempts, httpStatus: response.status, notes });
    return { fetch_id: fetchId, attempts, ...tumcosSummary(parsed, inserted) };
  } catch (error) {
    await failCooperativeFetch(db, fetchId, error);
    throw error;
  }
}

export function tumcosNotes(parsed: TumcosParseResult): string {
  return JSON.stringify({
    page_last_updated: parsed.page_last_updated, latest_record_date: parsed.latest_record_date,
    stale_page_metadata: parsed.stale_page_metadata, table_check: parsed.table_check,
  });
}

export function tumcosSummary(parsed: TumcosParseResult, inserted: number) {
  const by = (commodity: CooperativeCommodity) => parsed.quotes.filter((row) => row.commodity === commodity);
  return {
    received_count: parsed.received_count, in_scope_count: parsed.quotes.length, excluded_count: parsed.excluded_count,
    inserted_count: inserted, duplicate_count: parsed.quotes.length - inserted,
    invalid_count: parsed.quotes.filter((row) => row.status === "invalid").length,
    commodities: { arecanut: by("arecanut").length, black_pepper: by("black_pepper").length },
    unit_conflict_count: parsed.quotes.filter((row) => row.unit_status === "source_conflict").length,
    latest_record_date: parsed.latest_record_date, page_last_updated: parsed.page_last_updated?.label ?? null,
    stale_page_metadata: parsed.stale_page_metadata, table_check: { rows: parsed.table_check.rows, matched: parsed.table_check.matched },
  };
}

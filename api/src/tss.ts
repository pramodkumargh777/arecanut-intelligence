import { z } from "zod";
import { failCooperativeFetch, startCooperativeFetch, storeCooperativeSnapshot, type CooperativeQuote, type IngestMode } from "./cooperative";
import { fetchWithRetry, sha256Hex } from "./cooperative-fetch";

export const TSS_LOCATIONS = ["Sirsi", "Siddapur", "Yellapur"] as const;
export const TSS_VARIETIES = ["RASHI", "BETTE", "CHALI", "MURI", "KOLE", "ARECANUT"] as const;
const allowedVarieties = new Set<string>(TSS_VARIETIES);
const rateValue = z.union([z.number(), z.string(), z.null()]);
const rowSchema = z.object({
  date1: z.string(), iname: z.string(), iname_en: z.string().optional(), itemcode: z.union([z.number(), z.string()]),
  mnrate: rateValue, mxrate: rateValue, avgrate: rateValue, norrate: rateValue,
}).passthrough();
export function validTssDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))
    && new Date(date).toISOString().slice(0, 10) === date;
}
export function tssUrl(location: string, date: string) {
  return `https://webapi.tssindia.in/getrateshomepage?${new URLSearchParams({ location, date_param: date, tabIndex: "0" })}`;
}
export function tssTenderUrl(location: string, date: string) {
  return `https://webapi.tssindia.in/gettenderdetails?${new URLSearchParams({ location, date_param: date, tabIndex: "1" })}`;
}

/** Per-variety tender aggregate. Seller/buyer identities and account numbers are deliberately not retained. */
export type TssLotAggregate = { lot_count: number; bag_count: number; reported_weight: number; session_codes: string[] };
const tenderRow = z.object({
  date1: z.string(), item_en: z.string().nullable().optional(), vname: z.string().nullable().optional(),
  bags: z.union([z.number(), z.string(), z.null()]).optional(), weight: z.union([z.number(), z.string(), z.null()]).optional(),
  typ: z.string().nullable().optional(),
}).passthrough();

export function aggregateTssLots(payload: unknown, requestedDate: string) {
  const report = z.object({ success: z.literal(true), data: z.array(tenderRow) }).parse(payload);
  const lots = new Map<string, TssLotAggregate>();
  let skipped = 0;
  for (const row of report.data) {
    const variety = (row.item_en || row.vname || "").trim();
    const bags = price(row.bags ?? null), weight = price(row.weight ?? null);
    if (row.date1 !== requestedDate || !allowedVarieties.has(variety) || bags === null || weight === null) { skipped += 1; continue; }
    const current = lots.get(variety) ?? { lot_count: 0, bag_count: 0, reported_weight: 0, session_codes: [] };
    current.lot_count += 1;
    current.bag_count += bags;
    current.reported_weight = Math.round((current.reported_weight + weight) * 1000) / 1000;
    const code = row.typ?.trim();
    if (code && !current.session_codes.includes(code)) current.session_codes = [...current.session_codes, code].sort();
    lots.set(variety, current);
  }
  return { lots, tender_row_count: report.data.length, skipped_row_count: skipped };
}
function price(value: string | number | null): number | null {
  if (value === null || (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim()))) return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export async function parseTss(payload: unknown, location: typeof TSS_LOCATIONS[number], requestedDate: string, fetchedAt: string,
  lots?: Map<string, TssLotAggregate>) {
  if (!validTssDate(requestedDate)) throw new Error("Invalid TSS requested date.");
  const report = z.object({ success: z.literal(true), data: z.array(rowSchema) }).parse(payload);
  const quotes: CooperativeQuote[] = [];
  const seen = new Set<string>();
  for (const row of report.data) {
    if (!validTssDate(row.date1) || row.date1 !== requestedDate) throw new Error("TSS returned a different reporting date.");
    const variety = (row.iname_en || row.iname).trim();
    if (!allowedVarieties.has(variety)) continue;
    if (seen.has(variety)) throw new Error("Duplicate TSS location/date/variety.");
    seen.add(variety);
    const minimum = price(row.mnrate), maximum = price(row.mxrate), average = price(row.avgrate);
    const problems: string[] = [];
    if ([minimum, maximum, average].some((value) => value === null || value <= 0)) problems.push("Missing, non-positive or unsupported price.");
    if (minimum !== null && maximum !== null && average !== null && !(minimum <= average && average <= maximum)) problems.push("Reported prices do not satisfy minimum <= average <= maximum.");
    if (row.date1 > fetchedAt.slice(0, 10)) problems.push("Future reporting date.");
    const raw = JSON.stringify(row);
    const lot = lots?.get(variety);
    const identity = JSON.stringify(["tss", location, row.date1, variety, raw, "INR/quintal", "assumed", "reported_average",
      ...(lot ? [lot] : [])]);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
    const id = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    quotes.push({
      id, source_key: "tss", branch: location, reporting_date: row.date1, variety,
      minimum_price: minimum, maximum_price: maximum, average_price: average, normal_price: price(row.norrate),
      price_type: "reported_average", price_unit: "INR/quintal", unit_status: "assumed",
      source_url: tssUrl(location, requestedDate), fetched_at: fetchedAt, raw_record: raw,
      validation_message: problems.join(" ") || null, status: problems.length ? "invalid" : "pending",
      ...(lot ? {
        lot_count: lot.lot_count, bag_count: lot.bag_count, reported_weight: lot.reported_weight,
        session_codes: lot.session_codes.join(",") || null, review_flags: ["quantity_unit_unconfirmed"],
      } : {}),
    });
  }
  return { quotes, received_count: report.data.length, excluded_count: report.data.length - quotes.length };
}

export type TssRefreshOptions = { mode?: IngestMode; attempts?: number; includeLots?: boolean; fetcher?: typeof fetch };

export async function refreshTss(db: D1Database, date: string, options: TssRefreshOptions = {}) {
  const summary = { received_count: 0, inserted_count: 0, duplicate_count: 0, invalid_count: 0, excluded_count: 0, lot_rows_aggregated: 0, attempts: 0 };
  const errors: string[] = [];
  for (const location of TSS_LOCATIONS) {
    const url = tssUrl(location, date);
    const id = await startCooperativeFetch(db, "tss", url, { mode: options.mode, requestedDate: date });
    try {
      const { response, attempts } = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, { attempts: options.attempts, fetcher: options.fetcher });
      summary.attempts += attempts;
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("TSS did not return JSON.");
      const snapshot = await response.text();
      if (snapshot.length > 1_500_000) throw new Error("TSS snapshot exceeds supported size.");
      let lots: Map<string, TssLotAggregate> | undefined;
      let notes: string | null = null;
      if (options.includeLots) {
        const tender = await fetchWithRetry(tssTenderUrl(location, date), { headers: { Accept: "application/json" } },
          { attempts: options.attempts, timeoutMs: 90_000, fetcher: options.fetcher });
        summary.attempts += tender.attempts;
        const tenderText = await tender.response.text();
        if (tenderText.length > 3_000_000) throw new Error("TSS tender snapshot exceeds supported size.");
        const aggregated = aggregateTssLots(JSON.parse(tenderText), date);
        lots = aggregated.lots;
        summary.lot_rows_aggregated += aggregated.tender_row_count - aggregated.skipped_row_count;
        notes = JSON.stringify({
          tender_url: tssTenderUrl(location, date), tender_sha256: await sha256Hex(tenderText),
          tender_row_count: aggregated.tender_row_count, tender_rows_outside_scope: aggregated.skipped_row_count,
          tender_aggregates: Object.fromEntries(aggregated.lots),
          privacy: "Lot-level tender rows contain seller/buyer identities and are not stored; only per-variety aggregates are kept.",
          quantity_units: "Bag and weight units are not published by TSS and remain unconfirmed.",
        });
      }
      const parsed = await parseTss(JSON.parse(snapshot), location, date, new Date().toISOString(), lots);
      const inserted = await storeCooperativeSnapshot(db, id, "tss", snapshot, parsed.quotes, parsed.received_count, parsed.excluded_count,
        { mode: options.mode, attempts, httpStatus: response.status, notes });
      summary.inserted_count += inserted;
      summary.duplicate_count += parsed.quotes.length - inserted;
      summary.received_count += parsed.received_count;
      summary.excluded_count += parsed.excluded_count;
      summary.invalid_count += parsed.quotes.filter((row) => row.status === "invalid").length;
    } catch (error) {
      errors.push(`${location}: ${await failCooperativeFetch(db, id, error)}`);
    }
  }
  if (errors.length) throw new Error(`TSS refresh incomplete. Successful locations were retained. ${errors.join("; ")}`);
  return summary;
}

export const TSS_BACKFILL_MAX_DAYS = 5;

export function tssBackfillDates(start: string, end: string): string[] {
  if (!validTssDate(start) || !validTssDate(end) || start > end) throw new Error("Provide a valid start date on or before the end date.");
  const dates: string[] = [];
  for (let day = new Date(`${start}T00:00:00Z`); day.toISOString().slice(0, 10) <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(day.toISOString().slice(0, 10));
    if (dates.length > TSS_BACKFILL_MAX_DAYS) throw new Error(`TSS backfill is limited to ${TSS_BACKFILL_MAX_DAYS} reporting dates per request.`);
  }
  return dates;
}

/** Bounded historical backfill by requesting each past reporting date from the same public endpoint. Empty dates stay empty. */
export async function backfillTss(db: D1Database, start: string, end: string, options: Omit<TssRefreshOptions, "mode" | "includeLots"> = {}) {
  const results: { date: string; status: "succeeded" | "failed"; detail: Awaited<ReturnType<typeof refreshTss>> | string }[] = [];
  for (const date of tssBackfillDates(start, end)) {
    try { results.push({ date, status: "succeeded", detail: await refreshTss(db, date, { ...options, attempts: Math.min(options.attempts ?? 2, 2), mode: "backfill" }) }); }
    catch (error) { results.push({ date, status: "failed", detail: error instanceof Error ? error.message : String(error) }); }
  }
  return { dates: results.length, succeeded: results.filter((row) => row.status === "succeeded").length, results };
}

import { z } from "zod";
import { calendarTodayIST } from "../../shared/dates";
import { failCooperativeFetch, startCooperativeFetch, storeCooperativeSnapshot, type CooperativeQuote, type IngestMode } from "./cooperative";
import { fetchWithRetry, sha256Hex } from "./cooperative-fetch";

/**
 * TMS Sirsi (Sirsi Taluka Agricultural Produce Co-operative Marketing Society). Its public member portal shows the day's
 * general tender rates from a JSON endpoint without a login. One request returns the rates for the latest tender day on
 * or before the requested date, with that day's tender lots. The average is the plain mean of the lot rates and the
 * minimum and maximum are the lowest and highest lot, so it is a tender average like TSS's, not a branch average.
 */
export const TMS_PORTAL_URL = "https://members.tmssirsi.com/";
export const TMS_BRANCH = "Sirsi";
export const tmsBundleUrl = (date: string) =>
  `https://members.tmssirsi.com/api/onprem/api/market-rates/bundle?${new URLSearchParams({ date, type: "general" })}`;

/** The portal's own statement of the unit. Without it nothing is stored, as for MAMCOS. */
const UNIT_DECLARATION = /Rates in\s*(?:₹|INR|Rs\.?)\s*\/\s*quintal/i;
/** TMS also trades pepper and farm supplies. None has appeared in the rate list, but one would not be filed as arecanut. */
const NOT_ARECANUT = /pepper|menasu|coconut|copra|cocoa|cattle|cement/i;
/** The lot mean is compared with the published average to this many rupees, allowing for the source's rounding. */
const LOT_MEAN_TOLERANCE = 1;

export function tmsUnitDeclared(html: string): boolean {
  return UNIT_DECLARATION.test(html.replace(/&#x20B9;|&#8377;/gi, "₹"));
}

export function validTmsDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

const amount = z.union([z.number(), z.string(), z.null()]).transform((value) => {
  if (value === null) return null;
  const text = String(value).trim();
  return /^\d+(?:\.\d+)?$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
});
const rateRow = z.object({
  code: z.union([z.number(), z.string()]).transform(String), item: z.string(),
  minimum: amount, maximum: amount, average: amount,
}).passthrough();
const lotRow = z.object({ item: z.string(), bags: amount, rate: amount, quantity: amount }).passthrough();
const bundle = z.object({
  requestedDate: z.string(), effectiveDate: z.string().nullable(), priorDate: z.string().nullable().optional(),
  rates: z.array(z.unknown()), lots: z.array(z.unknown()).default([]),
}).passthrough();

/** Per-variety totals of the day's tender lots. Lot rows carry no seller or buyer identity. */
export type TmsLotAggregate = { lot_count: number; bag_count: number; reported_weight: number; lowest: number; highest: number; mean: number };

export function aggregateTmsLots(lots: unknown[]): Map<string, TmsLotAggregate> {
  const byItem = new Map<string, { rates: number[]; bags: number; weight: number }>();
  for (const raw of lots) {
    const lot = lotRow.parse(raw);
    if (lot.rate === null) continue;
    const item = lot.item.trim();
    const current = byItem.get(item) ?? { rates: [], bags: 0, weight: 0 };
    current.rates.push(lot.rate);
    current.bags += lot.bags ?? 0;
    current.weight += lot.quantity ?? 0;
    byItem.set(item, current);
  }
  return new Map([...byItem].map(([item, { rates, bags, weight }]) => [item, {
    lot_count: rates.length, bag_count: bags, reported_weight: Math.round(weight * 1000) / 1000,
    lowest: Math.min(...rates), highest: Math.max(...rates), mean: rates.reduce((sum, rate) => sum + rate, 0) / rates.length,
  }]));
}

export type TmsParseResult = {
  quotes: CooperativeQuote[]; received_count: number; excluded_count: number;
  requested_date: string; effective_date: string | null; prior_date: string | null;
  lot_rows: number; lot_mismatches: string[];
};

export async function parseTms(payload: unknown, requestedDate: string, fetchedAt: string): Promise<TmsParseResult> {
  if (!validTmsDate(requestedDate)) throw new Error("Invalid TMS requested date.");
  const report = bundle.parse(payload);
  if (report.requestedDate !== requestedDate) throw new Error("TMS answered for a different requested date.");
  const empty = { quotes: [], received_count: 0, excluded_count: 0, requested_date: requestedDate, effective_date: null,
    prior_date: report.priorDate ?? null, lot_rows: report.lots.length, lot_mismatches: [] };
  // No tender on or before the requested date: nothing to record, which is not a failure.
  if (!report.effectiveDate || !report.rates.length) return empty;
  const date = report.effectiveDate;
  if (!validTmsDate(date)) throw new Error("TMS returned an invalid tender date.");
  if (date > requestedDate) throw new Error("TMS returned a tender date after the requested date.");
  const today = calendarTodayIST(new Date(fetchedAt));
  const lots = aggregateTmsLots(report.lots);
  const quotes: CooperativeQuote[] = [];
  const seen = new Set<string>();
  const mismatches: string[] = [];
  let excluded = 0;
  for (const raw of report.rates) {
    const row = rateRow.parse(raw);
    const variety = row.item.trim();
    if (NOT_ARECANUT.test(variety)) { excluded += 1; continue; }
    if (seen.has(variety)) throw new Error(`Duplicate TMS item ${JSON.stringify(variety)} on ${date}.`);
    seen.add(variety);
    const { minimum, maximum, average } = row;
    const problems: string[] = [];
    if (!variety) problems.push("Missing reported variety.");
    if ([minimum, maximum, average].some((value) => value === null || value <= 0)) problems.push("Missing, non-positive or unsupported price.");
    if (minimum !== null && maximum !== null && average !== null && !(minimum <= average && average <= maximum)) problems.push("Reported prices do not satisfy minimum <= average <= maximum.");
    if (date > today) problems.push("Future reporting date.");
    const lot = lots.get(variety);
    const flags: string[] = [];
    // The published figures are derived from the lots; a disagreement means one of them changed, so a person checks.
    if (lot && (lot.lowest !== minimum || lot.highest !== maximum || average === null || Math.abs(lot.mean - average) > LOT_MEAN_TOLERANCE)) {
      flags.push("lot_aggregate_mismatch");
      mismatches.push(variety);
    }
    const rawRecord = JSON.stringify(row);
    const totals = lot ? { lot_count: lot.lot_count, bag_count: lot.bag_count, reported_weight: lot.reported_weight } : null;
    quotes.push({
      id: await sha256Hex(JSON.stringify(["tms", TMS_BRANCH, date, row.code, rawRecord, "INR/quintal", "source_confirmed", totals])),
      source_key: "tms", commodity: "arecanut", branch: TMS_BRANCH, reporting_date: date, variety,
      minimum_price: minimum, maximum_price: maximum, average_price: average, normal_price: null,
      price_type: "reported_average", price_unit: "INR/quintal", unit_status: "source_confirmed", source_unit_label: "₹/quintal",
      source_record_id: row.code, source_url: tmsBundleUrl(date), fetched_at: fetchedAt, raw_record: rawRecord,
      validation_message: problems.join(" ") || null, status: problems.length ? "invalid" : "pending",
      ...(totals ?? {}), ...(flags.length ? { review_flags: flags } : {}),
    });
  }
  return { quotes, received_count: report.rates.length, excluded_count: excluded, requested_date: requestedDate, effective_date: date,
    prior_date: report.priorDate ?? null, lot_rows: report.lots.length, lot_mismatches: mismatches };
}

export type TmsRefreshOptions = { mode?: IngestMode; attempts?: number; fetcher?: typeof fetch; unitCheckedAt?: string };

/** Fails closed when the portal no longer states its unit. Returns when the check was made, for the fetch record. */
export async function checkTmsUnit(options: Pick<TmsRefreshOptions, "attempts" | "fetcher"> = {}) {
  const { response } = await fetchWithRetry(TMS_PORTAL_URL, { headers: { Accept: "text/html" } }, { attempts: options.attempts, fetcher: options.fetcher });
  const html = await response.text();
  if (html.length > 2_000_000) throw new Error("TMS portal page exceeds supported size.");
  if (!tmsUnitDeclared(html)) throw new Error("TMS portal no longer states \"Rates in ₹/quintal\"; nothing was stored.");
  return new Date().toISOString();
}

export async function refreshTms(db: D1Database, date: string, options: TmsRefreshOptions = {}) {
  if (!validTmsDate(date)) throw new Error("Invalid TMS requested date.");
  const url = tmsBundleUrl(date);
  const fetchId = await startCooperativeFetch(db, "tms", url, { mode: options.mode, requestedDate: date });
  try {
    const unitCheckedAt = options.unitCheckedAt ?? await checkTmsUnit(options);
    const { response, attempts } = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, { attempts: options.attempts, fetcher: options.fetcher });
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("TMS did not return JSON.");
    const snapshot = await response.text();
    if (snapshot.length > 3_000_000) throw new Error("TMS snapshot exceeds supported size.");
    const parsed = await parseTms(JSON.parse(snapshot), date, new Date().toISOString());
    const notes = JSON.stringify({
      requested_date: parsed.requested_date, effective_date: parsed.effective_date, prior_date: parsed.prior_date,
      unit_declaration: { url: TMS_PORTAL_URL, text: "Rates in ₹/quintal", checked_at: unitCheckedAt },
      lot_rows: parsed.lot_rows, lot_aggregate_mismatches: parsed.lot_mismatches,
      quantity_units: "Lot quantity is not labelled by TMS; it is kept as reported and treated as unconfirmed.",
    });
    const inserted = await storeCooperativeSnapshot(db, fetchId, "tms", snapshot, parsed.quotes, parsed.received_count, parsed.excluded_count,
      { mode: options.mode, attempts, httpStatus: response.status, notes, requestedDate: date });
    return {
      fetch_id: fetchId, attempts, requested_date: date, effective_date: parsed.effective_date,
      received_count: parsed.received_count, excluded_count: parsed.excluded_count, inserted_count: inserted,
      duplicate_count: parsed.quotes.length - inserted, invalid_count: parsed.quotes.filter((row) => row.status === "invalid").length,
      lot_aggregate_mismatches: parsed.lot_mismatches,
    };
  } catch (error) {
    await failCooperativeFetch(db, fetchId, error);
    throw error;
  }
}

export const TMS_BACKFILL_MAX_DAYS = 31;

export function tmsBackfillDates(start: string, end: string): string[] {
  if (!validTmsDate(start) || !validTmsDate(end) || start > end) throw new Error("Provide a valid start date on or before the end date.");
  const dates: string[] = [];
  for (let day = new Date(`${start}T00:00:00Z`); day.toISOString().slice(0, 10) <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(day.toISOString().slice(0, 10));
    if (dates.length > TMS_BACKFILL_MAX_DAYS) throw new Error(`TMS backfill is limited to ${TMS_BACKFILL_MAX_DAYS} dates per request.`);
  }
  return dates;
}

/**
 * Past tender days, one request per date. A date without a tender returns the previous tender day again, which is
 * recognised as a duplicate and stored once. The unit statement is checked once for the whole run.
 */
export async function backfillTms(db: D1Database, start: string, end: string, options: Omit<TmsRefreshOptions, "mode" | "unitCheckedAt"> = {}) {
  const dates = tmsBackfillDates(start, end);
  const unitCheckedAt = await checkTmsUnit(options);
  const results: { date: string; status: "succeeded" | "failed"; detail: Awaited<ReturnType<typeof refreshTms>> | string }[] = [];
  for (const date of dates) {
    try { results.push({ date, status: "succeeded", detail: await refreshTms(db, date, { ...options, attempts: Math.min(options.attempts ?? 2, 2), mode: "backfill", unitCheckedAt }) }); }
    catch (error) { results.push({ date, status: "failed", detail: error instanceof Error ? error.message : String(error) }); }
  }
  return { dates: results.length, succeeded: results.filter((row) => row.status === "succeeded").length, results };
}

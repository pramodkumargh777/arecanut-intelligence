import { z } from "zod";
import { storeCooperativeSnapshot, type CooperativeQuote } from "./cooperative";

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
function price(value: string | number | null): number | null {
  if (value === null || (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim()))) return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export async function parseTss(payload: unknown, location: typeof TSS_LOCATIONS[number], requestedDate: string, fetchedAt: string) {
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
    const identity = JSON.stringify(["tss", location, row.date1, variety, raw, "INR/quintal", "assumed", "reported_average"]);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
    const id = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    quotes.push({
      id, source_key: "tss", branch: location, reporting_date: row.date1, variety,
      minimum_price: minimum, maximum_price: maximum, average_price: average, normal_price: price(row.norrate),
      price_type: "reported_average", price_unit: "INR/quintal", unit_status: "assumed",
      source_url: tssUrl(location, requestedDate), fetched_at: fetchedAt, raw_record: raw,
      validation_message: problems.join(" ") || null, status: problems.length ? "invalid" : "pending",
    });
  }
  return { quotes, received_count: report.data.length, excluded_count: report.data.length - quotes.length };
}

export async function refreshTss(db: D1Database, date: string) {
  const summary = { received_count: 0, inserted_count: 0, invalid_count: 0, excluded_count: 0 };
  const errors: string[] = [];
  for (const location of TSS_LOCATIONS) {
    const id = crypto.randomUUID(), url = tssUrl(location, date);
    await db.prepare(`INSERT INTO cooperative_fetches (id,source_key,source_url,started_at,status)
      VALUES (?,'tss',?,?,'running')`).bind(id, url, new Date().toISOString()).run();
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(60_000), headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`TSS returned HTTP ${response.status}`);
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("TSS did not return JSON.");
      const snapshot = await response.text();
      if (snapshot.length > 1_500_000) throw new Error("TSS snapshot exceeds supported size.");
      const parsed = await parseTss(JSON.parse(snapshot), location, date, new Date().toISOString());
      summary.inserted_count += await storeCooperativeSnapshot(db, id, "tss", snapshot, parsed.quotes, parsed.received_count, parsed.excluded_count);
      summary.received_count += parsed.received_count;
      summary.excluded_count += parsed.excluded_count;
      summary.invalid_count += parsed.quotes.filter((row) => row.status === "invalid").length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.prepare("UPDATE cooperative_fetches SET status='failed',finished_at=?,error_message=? WHERE id=?")
        .bind(new Date().toISOString(), message, id).run();
      errors.push(`${location}: ${message}`);
    }
  }
  if (errors.length) throw new Error(`TSS refresh incomplete. Successful locations were retained. ${errors.join("; ")}`);
  return summary;
}

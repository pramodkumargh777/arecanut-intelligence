/**
 * Daily arecanut arrivals (docs/DAILY_ARRIVALS.md), from two sources:
 * - krama_arrivals: KRAMA's public Commoditywise Daily Report (Department of Agricultural Marketing, Karnataka), fetched
 *   by data-platform/connectors/krama. The primary daily source; it must run from a network KRAMA accepts.
 * - agmarknet_v2_daily: AGMARKNET 2.0's date-wise report, fetched in an operator's logged-in session
 *   (data-platform/connectors/agmarknet_v2/run_daily_arrivals.py). Secondary.
 *
 * The connectors send each source document verbatim (KRAMA's heading and report table; AGMARKNET's JSON). This module
 * parses it itself, so stored rows always follow from stored evidence. A document is a complete snapshot of its dates;
 * migration 0027's view picks the latest reported one. Nothing here touches price observations or market_arrivals.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import { bearerMatches } from "./auth";
import { bucketSql, isCalendarDate, istDate, toTonnes, daysBetween } from "./supply";

export const DAILY_SOURCES = {
  krama_arrivals: { id: "source-krama-arrivals", name: "KRAMA daily arrivals (Karnataka Agricultural Marketing Department)",
    url: "https://krama.karnataka.gov.in/Reports/Main_rep", publisher: "Department of Agricultural Marketing, Government of Karnataka",
    note: "Public KRAMA Commoditywise Daily Report (no login); arrivals as published in quintals." },
  agmarknet_v2_daily: { id: "source-agmarknet-v2-daily", name: "AGMARKNET daily arrivals",
    url: "https://agmarknet.gov.in/", publisher: "Directorate of Marketing & Inspection",
    note: "AGMARKNET 2.0 date-wise report fetched in a logged-in session; arrivals in metric tonnes. Used for dates KRAMA does not cover." },
} as const;
export type DailySourceKey = keyof typeof DAILY_SOURCES;
export const DAILY_SOURCE_KEYS = Object.keys(DAILY_SOURCES) as DailySourceKey[];
export const MAX_DOCUMENTS_PER_IMPORT = 10;
const ROWS_PER_INSERT = 400;
const KRAMA_HEADER = ["Market", "Variety", "Grade", "Arrivals", "Units", "Min (Rs.)", "Max (Rs.)", "Modal (Rs.)"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const STATE = "Karnataka";

export type DailyRow = {
  source_market_name: string; observation_date: string; variety: string; grade: string | null;
  quantity_original: number; unit_original: string; quantity_tonnes: number | null; unit_status: "converted" | "unknown_unit";
  minimum_price: number | null; maximum_price: number | null; modal_price: number | null; price_unit: "INR/quintal" | null;
};
export type Parsed = { status: "reported" | "not_reported"; rows: DailyRow[]; rejected: { row: string; reason: string }[]; problems: string[] };

const sha256Hex = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");
const decodeEntities = (text: string) => text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
const cellText = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const isoFromDmy = (text: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const numberOrNull = (text: string): number | null | "invalid" => {
  if (text === "") return null;
  if (!/^\d+(\.\d+)?$/.test(text)) return "invalid";
  return Number(text);
};

/** Collapses identical repeats; rows that repeat an identity with different values are all rejected. */
function dedupe(rows: DailyRow[], rejected: Parsed["rejected"]) {
  const groups = new Map<string, DailyRow[]>();
  for (const row of rows) {
    const key = [row.source_market_name, row.observation_date, row.variety, row.grade ?? ""].join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const kept: DailyRow[] = [];
  for (const [key, group] of groups) {
    if (new Set(group.map((row) => JSON.stringify(row))).size === 1) kept.push(group[0]);
    else rejected.push({ row: key.replaceAll("\u0000", " | "), reason: `Reported ${group.length} times with different values; none stored.` });
  }
  return kept;
}

/** KRAMA: heading, commodity line and report table, checked against the requested date. */
export function parseKrama(payloadText: string, date: string): Parsed {
  let payload: { status?: string; date?: string; heading?: string; commodity?: string; table_html?: string; evidence?: string };
  try { payload = JSON.parse(payloadText); } catch { return { status: "reported", rows: [], rejected: [], problems: ["Payload is not JSON."] }; }
  if (payload.date !== date) return { status: "reported", rows: [], rejected: [], problems: ["Payload date does not match the document period."] };
  if (payload.status === "not_reported") {
    // Either arecanut is absent from the day's commodity list, or KRAMA's own report for the date says it holds no data.
    const listed = payload.evidence === `Commodities Reported on ${ddmmyyyy(date)}`;
    const empty = payload.evidence === "No Data Found For The Commodity" && payload.commodity === "COMMODITY: Arecanut"
      && payload.heading === `MARKETWISE REPORT FOR VARIOUS COMMODITIES AS ON ${ddmmyyyy(date)}`;
    return listed || empty
      ? { status: "not_reported", rows: [], rejected: [], problems: [] }
      : { status: "not_reported", rows: [], rejected: [], problems: ["A not-reported day needs the source's own date line or its no-data report."] };
  }
  const problems: string[] = [];
  if (payload.heading !== `MARKETWISE REPORT FOR VARIOUS COMMODITIES AS ON ${ddmmyyyy(date)}`) problems.push("Report heading is not for the requested date.");
  if (payload.commodity !== "COMMODITY: Arecanut") problems.push("Report is not for arecanut.");
  const table = payload.table_html ?? "";
  if (!/^<table\b[\s\S]*<\/table>$/.test(table) || (table.match(/<table\b/g) ?? []).length !== 1) problems.push("Payload does not hold exactly one report table.");
  const header = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((match) => cellText(match[1]));
  if (JSON.stringify(header) !== JSON.stringify(KRAMA_HEADER)) problems.push(`Table columns ${JSON.stringify(header)} are not the verified ones.`);
  if (problems.length) return { status: "reported", rows: [], rejected: [], problems };
  const rows: DailyRow[] = [], rejected: Parsed["rejected"] = [];
  for (const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cellText(cell[1]));
    if (!cells.length) continue;
    const label = cells.join(" | ");
    if (cells.length !== 8) { rejected.push({ row: label, reason: "Row does not have 8 cells." }); continue; }
    const [market, variety, grade, arrivals, unit, min, max, modal] = cells;
    const quantity = numberOrNull(arrivals), prices = [min, max, modal].map(numberOrNull);
    if (!market || !variety) { rejected.push({ row: label, reason: "Market or variety is missing." }); continue; }
    if (quantity === null || quantity === "invalid") { rejected.push({ row: label, reason: "Arrivals is not a number." }); continue; }
    if (!unit) { rejected.push({ row: label, reason: "Unit is missing." }); continue; }
    if (prices.includes("invalid")) { rejected.push({ row: label, reason: "A price is not a number." }); continue; }
    const converted = toTonnes(quantity, unit);
    const [minimum, maximum, modalPrice] = prices as (number | null)[];
    rows.push({ source_market_name: market, observation_date: date, variety, grade: grade || null, quantity_original: quantity,
      unit_original: unit, quantity_tonnes: converted.tonnes, unit_status: converted.status, minimum_price: minimum, maximum_price: maximum,
      modal_price: modalPrice, price_unit: prices.some((price) => price !== null) ? "INR/quintal" : null });
  }
  return { status: "reported", rows: dedupe(rows, rejected), rejected, problems: [] };
}

type AgmarknetDatewise = { success?: unknown; title?: unknown; columns?: { key?: string; title?: string }[];
  markets?: { marketName?: unknown; dates?: { arrivalDate?: unknown; data?: Record<string, unknown>[] }[] }[] };

/** AGMARKNET date-wise JSON for one month, checked against the requested month. */
export function parseAgmarknetDatewise(payloadText: string, start: string, end: string): Parsed {
  let body: AgmarknetDatewise;
  try { body = JSON.parse(payloadText); } catch { return { status: "reported", rows: [], rejected: [], problems: ["Payload is not JSON."] }; }
  const problems: string[] = [];
  const month = `${MONTHS[Number(start.slice(5, 7)) - 1]}, ${start.slice(0, 4)}`;
  if (body.success !== true) problems.push("The source did not report success.");
  if (typeof body.title !== "string" || !body.title.includes(` on ${month} `) || !body.title.includes("Arecanut(Betelnut/Supari)")
    || !body.title.includes("Karnataka")) problems.push(`Report title is not Karnataka arecanut for ${month}.`);
  const titles = Object.fromEntries((body.columns ?? []).map((column) => [column.key, column.title]));
  if (titles.arrivals !== "Arrivals (Metric Tonnes)" || titles.modalPrice !== "Modal Price (Rs./Quintal)") problems.push("Column units are not the verified ones.");
  if (!Array.isArray(body.markets)) problems.push("Response has no markets.");
  if (problems.length) return { status: "reported", rows: [], rejected: [], problems };
  const rows: DailyRow[] = [], rejected: Parsed["rejected"] = [];
  const price = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  for (const market of body.markets!) {
    const name = typeof market.marketName === "string" ? market.marketName.trim() : "";
    for (const day of market.dates ?? []) {
      const date = typeof day.arrivalDate === "string" ? isoFromDmy(day.arrivalDate) : null;
      for (const item of day.data ?? []) {
        const label = `${name} | ${String(day.arrivalDate)} | ${String(item.variety)}`;
        if (!name || !date || date < start || date > end) { rejected.push({ row: label, reason: "Market or date is missing or outside the month." }); continue; }
        const variety = typeof item.variety === "string" ? item.variety.trim() : "";
        const arrivals = item.arrivals;
        if (!variety) { rejected.push({ row: label, reason: "Variety is missing." }); continue; }
        if (typeof arrivals !== "number" || !Number.isFinite(arrivals) || arrivals < 0) { rejected.push({ row: label, reason: "Arrivals is not a non-negative number." }); continue; }
        // Floating-point noise in the source (0.7000000000000001) is rounded to what the source means.
        const quantity = Number(arrivals.toFixed(4));
        const [minimum, maximum, modal] = [item.minimumPrice, item.maximumPrice, item.modalPrice].map(price);
        rows.push({ source_market_name: name, observation_date: date, variety, grade: null, quantity_original: quantity, unit_original: "Metric Tonnes",
          quantity_tonnes: quantity, unit_status: "converted", minimum_price: minimum, maximum_price: maximum, modal_price: modal,
          price_unit: [minimum, maximum, modal].some((value) => value !== null) ? "INR/quintal" : null });
      }
    }
  }
  return { status: "reported", rows: dedupe(rows, rejected), rejected, problems: [] };
}

const day = z.string().refine(isCalendarDate, "Must be a YYYY-MM-DD calendar date.");
const documentSchema = z.object({
  request_url: z.string().url().max(500),
  request_params: z.record(z.string().max(40), z.string().max(40)),
  period_start: day,
  period_end: day,
  fetched_at: z.string().datetime({ offset: true }),
  raw_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  raw_bytes: z.number().int().positive().max(20_000_000),
  payload_format: z.enum(["krama_commodity_table/1", "agmarknet_datewise_json/1"]),
  parser_version: z.string().trim().min(1).max(40),
  payload: z.string().min(2).max(1_500_000),
}).strict();
const importSchema = z.object({ source_key: z.enum(["krama_arrivals", "agmarknet_v2_daily"]),
  documents: z.array(documentSchema).min(1).max(MAX_DOCUMENTS_PER_IMPORT) }).strict();
type DocumentInput = z.infer<typeof documentSchema>;

/** Request checks plus the parsed rows; problems mean the document is refused. */
export function parseDocument(sourceKey: DailySourceKey, input: DocumentInput, today: string): Parsed {
  const refuse = (problem: string): Parsed => ({ status: "reported", rows: [], rejected: [], problems: [problem] });
  if (input.period_end > today) return refuse("The document covers dates after today (IST).");
  let url: URL;
  try { url = new URL(input.request_url); } catch { return refuse("request_url is not a URL."); }
  const params = input.request_params;
  if (sourceKey === "krama_arrivals") {
    if (input.payload_format !== "krama_commodity_table/1") return refuse("KRAMA documents use krama_commodity_table/1.");
    if (`${url.origin}${url.pathname}` !== "https://krama.karnataka.gov.in/reports/CommadityRep") return refuse("request_url is not KRAMA's commodity report.");
    if (input.period_start !== input.period_end) return refuse("A KRAMA document covers one date.");
    if (params.report !== "C" || params.commodity !== "140" || params.date !== ddmmyyyy(input.period_start) || Object.keys(params).length !== 3) {
      return refuse("request_params are not KRAMA's arecanut Commoditywise Daily Report for the document date.");
    }
    return parseKrama(input.payload, input.period_start);
  }
  if (input.payload_format !== "agmarknet_datewise_json/1") return refuse("AGMARKNET documents use agmarknet_datewise_json/1.");
  if (`${url.origin}${url.pathname}` !== "https://api.agmarknet.gov.in/v1/prices-and-arrivals/date-wise/specific-commodity") return refuse("request_url is not AGMARKNET's date-wise report.");
  const [year, month] = [Number(input.period_start.slice(0, 4)), Number(input.period_start.slice(5, 7))];
  const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  if (input.period_start.slice(8) !== "01" || input.period_end !== lastDay) return refuse("An AGMARKNET document covers one whole month.");
  if (params.year !== String(year) || params.month !== String(month) || params.stateId !== "16" || params.commodityId !== "118") {
    return refuse("request_params are not AGMARKNET's Karnataka arecanut report for the document month.");
  }
  if (Object.fromEntries(url.searchParams).year !== params.year || Object.fromEntries(url.searchParams).month !== params.month) return refuse("request_url and request_params differ.");
  return parseAgmarknetDatewise(input.payload, input.period_start, input.period_end);
}

const rowKey = (row: { source_market_name: string; observation_date: string; variety: string; grade: string | null }) =>
  [row.source_market_name, row.observation_date, row.variety, row.grade ?? ""].join("\u0000");
const rowValue = (row: Pick<DailyRow, "quantity_original" | "unit_original" | "minimum_price" | "maximum_price" | "modal_price">) =>
  JSON.stringify([row.quantity_original, row.unit_original, row.minimum_price, row.maximum_price, row.modal_price]);

export const dailyArrivalRoutes = new Hono<Env>();

dailyArrivalRoutes.post("/admin/arrivals/daily/import", async (c) => {
  if (!bearerMatches(c.req.header("Authorization"), c.env.INGESTION_TOKEN)) return c.json({ error: "A valid ingestion token is required." }, 401);
  if (c.env.DAILY_ARRIVALS_IMPORT_ENABLED === "false") return c.json({ error: "Daily arrival imports are switched off." }, 503);
  const parsed = importSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid daily arrivals import.", details: parsed.error.issues.slice(0, 20) }, 400);
  const { source_key: sourceKey, documents } = parsed.data;
  const db = c.env.DB, today = istDate(new Date()), now = new Date().toISOString();
  const results = documents.map((input) => ({ input, parsed: parseDocument(sourceKey, input, today) }));
  const refused = results.filter((item) => item.parsed.problems.length)
    .map((item) => ({ period_start: item.input.period_start, request_url: item.input.request_url, problems: item.parsed.problems }));
  // All or nothing: a request with any unrecognised document stores nothing.
  if (refused.length) return c.json({ error: "Documents do not match the verified source layout; nothing was stored.", refused }, 422);
  const totals = { documents_new: 0, inserted: 0, revised: 0, duplicates: 0, removed: 0, rejected_rows: 0 };
  const rejected: { period_start: string; row: string; reason: string }[] = [];
  const statements: D1PreparedStatement[] = [];
  for (const { input, parsed: doc } of results) {
    totals.rejected_rows += doc.rejected.length;
    rejected.push(...doc.rejected.slice(0, 20).map((item) => ({ period_start: input.period_start, ...item })));
    const payloadSha = await sha256Hex(input.payload);
    const id = await sha256Hex(`${sourceKey}\u0000${input.request_url}\u0000${payloadSha}`);
    if (await db.prepare("SELECT 1 AS found FROM arrival_daily_documents WHERE id = ?").bind(id).first()) {
      totals.duplicates += doc.rows.length;
      continue;
    }
    // Compared with the current snapshot of the same dates, to report what this document changes. commodity_code and
    // state let this use market_arrival_days_scope; without them it scans every stored row, for every document.
    const previous = doc.status === "reported" ? (await db.prepare(`SELECT source_market_name, observation_date, variety, grade, quantity_original,
        unit_original, minimum_price, maximum_price, modal_price FROM market_arrival_days_current
      WHERE commodity_code = 'arecanut' AND state = ? AND source_key = ? AND observation_date BETWEEN ? AND ?`)
      .bind(STATE, sourceKey, input.period_start, input.period_end)
      .all<DailyRow>()).results : [];
    const before = new Map(previous.map((row) => [rowKey(row), rowValue(row)]));
    for (const row of doc.rows) {
      const prior = before.get(rowKey(row));
      if (prior === undefined) totals.inserted += 1;
      else if (prior === rowValue(row)) totals.duplicates += 1;
      else totals.revised += 1;
      before.delete(rowKey(row));
    }
    if (doc.status === "reported") totals.removed += before.size;
    totals.documents_new += 1;
    statements.push(db.prepare(`INSERT OR IGNORE INTO arrival_daily_documents (id, source_key, request_url, request_params, period_start, period_end,
        status, row_count, raw_sha256, raw_bytes, payload_format, payload, payload_sha256, parser_version, fetched_at, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, sourceKey, input.request_url, JSON.stringify(input.request_params), input.period_start, input.period_end, doc.status,
        doc.rows.length, input.raw_sha256, input.raw_bytes, input.payload_format, input.payload, payloadSha, input.parser_version,
        input.fetched_at, now));
    for (let offset = 0; offset < doc.rows.length; offset += ROWS_PER_INSERT) {
      const chunk = await Promise.all(doc.rows.slice(offset, offset + ROWS_PER_INSERT).map(async (row) => ({
        ...row, id: await sha256Hex(`${id}\u0000${rowKey(row)}`) })));
      // One statement per chunk keeps a month of AGMARKNET rows well inside D1's per-request query limit.
      statements.push(db.prepare(`INSERT INTO market_arrival_days (id, document_id, source_key, commodity_code, state, source_market_name,
          observation_date, variety, grade, quantity_original, unit_original, quantity_tonnes, unit_status, minimum_price, maximum_price,
          modal_price, price_unit)
        SELECT json_extract(value, '$.id'), ?, ?, 'arecanut', ?, json_extract(value, '$.source_market_name'),
          json_extract(value, '$.observation_date'), json_extract(value, '$.variety'), json_extract(value, '$.grade'),
          json_extract(value, '$.quantity_original'), json_extract(value, '$.unit_original'), json_extract(value, '$.quantity_tonnes'),
          json_extract(value, '$.unit_status'), json_extract(value, '$.minimum_price'), json_extract(value, '$.maximum_price'),
          json_extract(value, '$.modal_price'), json_extract(value, '$.price_unit')
        FROM json_each(?)`).bind(id, sourceKey, STATE, JSON.stringify(chunk)));
    }
  }
  // D1 batches are atomic: every new document of this request is stored with all its rows, or nothing is.
  if (statements.length) await db.batch(statements);
  return c.json({ source_key: sourceKey, received_documents: documents.length, ...totals, rejected }, 201);
});

dailyArrivalRoutes.get("/admin/arrivals/daily/coverage", async (c) => {
  if (!bearerMatches(c.req.header("Authorization"), c.env.INGESTION_TOKEN)) return c.json({ error: "A valid ingestion token is required." }, 401);
  const sourceKey = c.req.query("source_key") ?? "krama_arrivals";
  if (!(DAILY_SOURCE_KEYS as string[]).includes(sourceKey)) return c.json({ error: "Unknown daily arrivals source." }, 400);
  const db = c.env.DB;
  const [dates, summary, unmapped] = await db.batch([
    db.prepare(`SELECT DISTINCT period_start AS day FROM arrival_daily_documents WHERE source_key = ? AND period_start = period_end ORDER BY day`).bind(sourceKey),
    db.prepare(`SELECT MIN(period_start) AS earliest, MAX(period_end) AS latest, COUNT(*) AS documents, SUM(status = 'not_reported') AS not_reported
      FROM arrival_daily_documents WHERE source_key = ?`).bind(sourceKey),
    db.prepare(`SELECT source_market_name FROM (SELECT source_market_name FROM market_arrival_days WHERE source_key = ? GROUP BY source_market_name) r
      WHERE NOT EXISTS (SELECT 1 FROM arrival_market_aliases a WHERE a.source_key = ? AND a.source_market_name = r.source_market_name)`)
      .bind(sourceKey, sourceKey),
  ]);
  return c.json({ source_key: sourceKey, ...(summary.results[0] as object), fetched_dates: (dates.results as { day: string }[]).map((row) => row.day),
    unmapped_markets: (unmapped.results as { source_market_name: string }[]).map((row) => row.source_market_name) });
});

const runSchema = z.object({
  source_key: z.enum(["krama_arrivals", "agmarknet_v2_daily"]),
  mode: z.enum(["daily", "backfill", "replay"]),
  status: z.enum(["completed", "completed_with_rejections", "no_data", "failed"]),
  started_at: z.string().datetime({ offset: true }),
  completed_at: z.string().datetime({ offset: true }),
  fetched_count: z.number().int().nonnegative(),
  accepted_count: z.number().int().nonnegative(),
  rejected_count: z.number().int().nonnegative(),
  inserted_count: z.number().int().nonnegative(),
  duplicate_count: z.number().int().nonnegative(),
  corrected_count: z.number().int().nonnegative(),
  reporting_dates: z.array(day).max(400),
  error_message: z.string().max(1000).nullable(),
}).strict().refine((run) => run.started_at <= run.completed_at, { message: "started_at must not be after completed_at." });

dailyArrivalRoutes.post("/admin/arrivals/daily/runs", async (c) => {
  if (!bearerMatches(c.req.header("Authorization"), c.env.INGESTION_TOKEN)) return c.json({ error: "A valid ingestion token is required." }, 401);
  const parsed = runSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid run payload.", details: parsed.error.issues.slice(0, 20) }, 400);
  const run = parsed.data, id = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO source_ingestion_runs (id, source_id, resource_id, mode, status, started_at, completed_at, request_filters,
      fetched_count, accepted_count, rejected_count, inserted_count, duplicate_count, corrected_count, reporting_dates, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, '{"state":"Karnataka","commodity":"arecanut"}', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, DAILY_SOURCES[run.source_key].id, run.source_key === "krama_arrivals" ? "krama/CommadityRep" : "v1/prices-and-arrivals/date-wise",
      run.mode, run.status, run.started_at, run.completed_at, run.fetched_count, run.accepted_count, run.rejected_count, run.inserted_count,
      run.duplicate_count, run.corrected_count, JSON.stringify(run.reporting_dates), run.error_message).run();
  return c.json({ id }, 201);
});

const aliasSchema = z.object({
  source_key: z.enum(["krama_arrivals", "agmarknet_v2_daily"]),
  source_market_name: z.string().trim().min(1).max(200),
  district: z.string().trim().min(2).max(100),
  market: z.string().trim().min(2).max(200),
  mapping_status: z.enum(["verified", "inferred"]),
  evidence: z.string().trim().min(10).max(500),
}).strict();

/** A new or corrected market mapping, stored as the next version (reviewer token). */
dailyArrivalRoutes.post("/admin/arrivals/market-aliases", async (c) => {
  if (!bearerMatches(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json({ error: "A valid reviewer token is required." }, 401);
  const parsed = aliasSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid market alias.", details: parsed.error.issues.slice(0, 20) }, 400);
  const alias = parsed.data;
  const district = await c.env.DB.prepare("SELECT district FROM geography_aliases WHERE state = ? AND alias_key = lower(?)")
    .bind(STATE, alias.district).first<{ district: string }>();
  if (!district) return c.json({ error: `District "${alias.district}" is not in the verified ${STATE} district list.` }, 400);
  const prior = await c.env.DB.prepare("SELECT MAX(version) AS version FROM arrival_market_aliases WHERE source_key = ? AND source_market_name = ?")
    .bind(alias.source_key, alias.source_market_name).first<{ version: number | null }>();
  const version = (prior?.version ?? 0) + 1;
  await c.env.DB.prepare(`INSERT INTO arrival_market_aliases (source_key, source_market_name, district, market, mapping_status, evidence, version, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(alias.source_key, alias.source_market_name, district.district, alias.market, alias.mapping_status,
    alias.evidence, version, new Date().toISOString()).run();
  return c.json({ ...alias, district: district.district, version }, 201);
});

/**
 * The daily rows /supply/arrivals uses. KRAMA wins a whole date: AGMARKNET daily rows count only for dates KRAMA has no
 * reported rows for. A market-day that daily file imports (market_arrivals) already cover is left out.
 */
export function pickedDailySql(filters: { state: string; from: string; to: string; district?: string; market?: string; source?: string }) {
  const args: (string | number)[] = ["arecanut", filters.state, filters.from, filters.to];
  const extra: string[] = [];
  if (filters.source) { extra.push("c.source_key = ?"); args.push(filters.source); }
  if (filters.district) { extra.push("c.district = ?"); args.push(filters.district); }
  if (filters.market) { extra.push("c.market = ?"); args.push(filters.market); }
  const sql = `WITH cur AS (SELECT * FROM market_arrival_days_current WHERE commodity_code = ? AND state = ? AND observation_date BETWEEN ? AND ?),
    krama_dates AS (SELECT DISTINCT observation_date FROM cur WHERE source_key = 'krama_arrivals'),
    picked AS (SELECT c.* FROM cur c WHERE (c.source_key = 'krama_arrivals' OR c.observation_date NOT IN (SELECT observation_date FROM krama_dates))
      AND NOT EXISTS (SELECT 1 FROM market_arrivals a WHERE a.measure = 'arrival' AND a.commodity_code = c.commodity_code AND a.state = c.state
        AND lower(a.market) = lower(c.market) AND a.observation_date = c.observation_date)
      ${extra.length ? `AND ${extra.join(" AND ")}` : ""})`;
  return { sql, args };
}

type Row = Record<string, string | number | null>;
export async function dailyArrivalBuckets(db: D1Database, query: { granularity: string; state: string; from: string; to: string;
  district?: string; market?: string; source?: string }) {
  const { sql, args } = pickedDailySql(query);
  const bucket = bucketSql(query.granularity as "daily", "observation_date");
  const [series, markets, sources] = await db.batch([
    db.prepare(`${sql} SELECT 'arrival' AS measure, ${bucket} AS bucket, MIN(observation_date) AS first_date, MAX(observation_date) AS last_date,
      ROUND(SUM(quantity_tonnes), 3) AS quantity_tonnes, COUNT(*) AS records, SUM(unit_status = 'unknown_unit') AS unknown_unit_records,
      COUNT(DISTINCT market) AS markets_reporting, COUNT(DISTINCT observation_date) AS reporting_days
      FROM picked GROUP BY bucket ORDER BY bucket LIMIT 5000`).bind(...args),
    db.prepare(`${sql} SELECT 'arrival' AS measure, market, district, COUNT(DISTINCT observation_date) AS reporting_days,
      ROUND(SUM(quantity_tonnes), 3) AS quantity_tonnes, SUM(unit_status = 'unknown_unit') AS unknown_unit_records
      FROM picked GROUP BY market, district ORDER BY quantity_tonnes DESC LIMIT 50`).bind(...args),
    db.prepare(`${sql} SELECT source_key, MAX(imported_at) AS imported_at FROM picked GROUP BY source_key`).bind(...args),
  ]);
  return { series: series.results as Row[], markets: markets.results as Row[],
    sources: (sources.results as { source_key: DailySourceKey; imported_at: string }[]).map((row) => ({
      id: DAILY_SOURCES[row.source_key].id, source_key: row.source_key, source_name: DAILY_SOURCES[row.source_key].name,
      source_url: DAILY_SOURCES[row.source_key].url, file_name: null, imported_at: row.imported_at, authorization_note: DAILY_SOURCES[row.source_key].note })) };
}

const MAX_DAY_RANGE = 31;

/** Public read of the stored daily rows as published, with provenance; the same precedence as the Supply page. */
dailyArrivalRoutes.get("/supply/arrival-days", async (c) => {
  const to = c.req.query("to") ?? istDate(new Date());
  const from = c.req.query("from") ?? to;
  if (!isCalendarDate(from) || !isCalendarDate(to)) return c.json({ error: "from and to must be YYYY-MM-DD calendar dates." }, 400);
  if (from > to) return c.json({ error: "from must not be after to." }, 400);
  if (daysBetween(from, to) >= MAX_DAY_RANGE) return c.json({ error: `Date ranges are limited to ${MAX_DAY_RANGE} days.` }, 400);
  const source = c.req.query("source");
  if (source && !(DAILY_SOURCE_KEYS as string[]).includes(source)) return c.json({ error: "Unknown daily arrivals source." }, 400);
  const state = c.req.query("state") ?? STATE;
  const { sql, args } = pickedDailySql({ state, from, to, district: c.req.query("district"), market: c.req.query("market"), source });
  const rows = await c.env.DB.prepare(`${sql} SELECT observation_date, district, market, source_market_name, mapping_status, variety, grade,
      quantity_original, unit_original, quantity_tonnes, unit_status, minimum_price, maximum_price, modal_price, price_unit, source_key,
      request_url AS source_request_url, fetched_at FROM picked ORDER BY observation_date, district, market, variety, grade LIMIT 10000`)
    .bind(...args).all();
  return c.json({ commodity: "arecanut", state, requested_range: { from, to }, unit: "tonnes (quantity_original and unit_original as published)",
    sources: DAILY_SOURCE_KEYS.map((key) => ({ key, name: DAILY_SOURCES[key].name, url: DAILY_SOURCES[key].url, publisher: DAILY_SOURCES[key].publisher })),
    rows: rows.results,
    notes: ["KRAMA is used for every date it reports; AGMARKNET 2.0 daily rows fill only dates KRAMA does not cover.",
      "Prices here are the arrival reports' own figures; they are not part of the reference index.",
      "mapping_status unmapped means the source market name has no district mapping yet; it still counts in state totals."] });
});

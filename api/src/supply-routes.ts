import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./index";
import { hashText } from "./intelligence-routes";
import {
  ESTIMATE_TYPES, HAZARDS, IMD_SEASONS, addDays, approvalProblems, bucketSql, collapseVintages, conditionSchema, currentSeries,
  daysBetween, districtResolver, evaluateRule, forecastEligibility, freshness, growthSeries, isCalendarDate, istDate,
  parseReportingYear, preferredDays, publishedRules, revisionHistory, ruleStatus, seasonalSummary, toTonnes,
  type EstimateRow, type FieldReport, type ReviewRow, type RuleRow, type WeatherDay,
} from "./supply";
import { bearerMatches } from "./auth";

export const supplyRoutes = new Hono<Env>();
const bearer = (header: string | undefined, token: string | undefined) => bearerMatches(header, token);
const COMMODITY = "arecanut";
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const https = z.string().url().max(500).refine((value) => value.startsWith("https://"), "Must be an https URL.");
const day = z.string().refine(isCalendarDate, "Must be a YYYY-MM-DD calendar date.");
const issues = (error: z.ZodError) => error.issues.slice(0, 20).map((issue) => `${issue.path.join(".")}: ${issue.message}`);

export const DATA_TYPE_LABELS: Record<string, string> = {
  station_measurement: "Physical weather-station measurement (authorized official import).",
  reanalysis: "ERA5 reanalysis via the Open-Meteo archive: model-derived grid estimate, not a station observation. Recent values are preliminary (ERA5T) and may be revised.",
  model_grid: "Open-Meteo numerical-model grid estimate near Sirsi: not a physical station observation.",
  official_forecast: "Official forecast issued by the provider.",
};

// ------------------------------------------------------------------------------------------------
// A. Production
async function estimateRows(db: D1Database) {
  return (await db.prepare(`SELECT * FROM production_estimates WHERE commodity_code=? ORDER BY reporting_year, recorded_at`)
    .bind(COMMODITY).all<EstimateRow>()).results;
}
const sourcesOf = (rows: EstimateRow[]) => {
  const map = new Map<string, { publisher: string; source_url: string; source_key: string; latest_recorded_at: string; publication_date: string | null }>();
  for (const row of rows) {
    const existing = map.get(row.source_url);
    if (!existing || row.recorded_at > existing.latest_recorded_at) {
      map.set(row.source_url, { publisher: row.publisher, source_url: row.source_url, source_key: row.source_key, latest_recorded_at: row.recorded_at, publication_date: row.publication_date });
    }
  }
  return [...map.values()];
};
const periodOf = (years: string[]) => years.length ? { from: [...years].sort()[0], to: [...years].sort().at(-1)!, kind: "agricultural_year" } : null;

function seriesGrowth(series: ReturnType<typeof currentSeries>) {
  const pick = (field: "production_thousand_tonnes" | "area_thousand_hectares" | "yield_kg_hectare") =>
    growthSeries(series.map((row) => ({ reporting_year: row.reporting_year, value: row[field], estimate_type: row.estimate_type })));
  return { production: pick("production_thousand_tonnes"), area: pick("area_thousand_hectares"), yield: pick("yield_kg_hectare") };
}

supplyRoutes.get("/supply/production", async (c) => {
  const geography = c.req.query("geography") ?? "Karnataka";
  const compare = c.req.query("compare") ?? "All India";
  const rows = await estimateRows(c.env.DB);
  const nonDistrict = rows.filter((row) => row.geography_level !== "district");
  const geographies = [...new Set(nonDistrict.map((row) => row.geography))].sort((a, b) => (a === "All India" ? -1 : b === "All India" ? 1 : a.localeCompare(b)));
  if (!geographies.includes(geography)) {
    return c.json({ error: "No production estimates exist for this geography.", geographies }, geographies.length ? 404 : 200);
  }
  const selected = collapseVintages(nonDistrict.filter((row) => row.geography === geography));
  const comparison = compare !== geography && geographies.includes(compare) ? collapseVintages(nonDistrict.filter((row) => row.geography === compare)) : [];
  const current = currentSeries(selected), comparisonCurrent = currentSeries(comparison);
  const share = current.map((row) => {
    const base = comparisonCurrent.find((item) => item.reporting_year === row.reporting_year);
    const valid = base && row.production_thousand_tonnes !== null && base.production_thousand_tonnes && base.production_thousand_tonnes > 0;
    return { reporting_year: row.reporting_year, percent: valid ? Number(((row.production_thousand_tonnes! / base!.production_thousand_tonnes!) * 100).toFixed(2)) : null,
      estimate_types: base ? [row.estimate_type, base.estimate_type] : [row.estimate_type],
      note: base && base.estimate_type !== row.estimate_type ? "Estimate stages differ between the two geographies." : null };
  });
  const districtRows = geography === "All India" ? [] : rows.filter((row) => row.geography_level === "district" && row.state === geography);
  const years = current.map((row) => row.reporting_year);
  return c.json({
    commodity: COMMODITY, geography, comparison_geography: comparison.length ? compare : null, geographies,
    unit: { area: "thousand hectares", production: "thousand tonnes", yield: "kg/hectare" },
    reporting_period: periodOf(years),
    sources: sourcesOf([...selected, ...comparison]),
    current, comparison_current: comparisonCurrent, share_of_comparison: comparison.length ? share : [],
    revisions: revisionHistory(selected).filter((row) => row.previous_estimate_type !== null),
    vintages: selected.length,
    growth: seriesGrowth(current),
    districts: {
      available: new Set(districtRows.map((row) => row.district)).size,
      message: districtRows.length ? null
        : "No original district-level production records have been imported for this geography. Areca Pulse never apportions state totals to districts.",
    },
    forecast: forecastEligibility("production", years.length),
    notes: [
      "Current values use the most mature estimate stage available (final > third > second > first advance > unspecified).",
      "Growth rates that span different estimate stages are flagged as mixed; advance estimates are commonly revised.",
    ],
  });
});

supplyRoutes.get("/supply/production/districts", async (c) => {
  const state = c.req.query("state") ?? "Karnataka";
  const rows = (await estimateRows(c.env.DB)).filter((row) => row.geography_level === "district" && row.state === state);
  if (!rows.length) {
    return c.json({ state, districts: [], reporting_period: null, sources: [],
      message: "No original district-level production records have been imported. District analysis appears only when a publisher reports district figures; state totals are never apportioned." });
  }
  const districts = [...new Set(rows.map((row) => row.district!))].sort().map((district) => {
    const current = currentSeries(collapseVintages(rows.filter((row) => row.district === district)));
    return { district, current, growth: seriesGrowth(current) };
  });
  return c.json({ state, districts, reporting_period: periodOf([...new Set(rows.map((row) => row.reporting_year))]), sources: sourcesOf(rows), message: null });
});

const productionDocumentSchema = z.object({
  source_key: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  publisher: z.string().trim().min(3).max(200),
  title: z.string().trim().min(3).max(300),
  source_url: https,
  publication_date: day.optional(),
  publication_precision: z.enum(["day", "month", "year"]).optional(),
  content_sha256: sha256,
  archive_object_key: z.string().max(500).optional(),
  records: z.array(z.object({
    reporting_year: z.string(),
    geography_level: z.enum(["country", "state", "district"]),
    state: z.string().trim().min(2).max(100).optional(),
    district: z.string().trim().min(2).max(100).optional(),
    estimate_type: z.enum(ESTIMATE_TYPES),
    estimate_label: z.string().trim().min(1).max(200),
    area_thousand_hectares: z.number().finite().min(0).nullable().optional(),
    production_thousand_tonnes: z.number().finite().min(0).nullable().optional(),
    yield_kg_hectare: z.number().finite().min(0).nullable().optional(),
    source_row_reference: z.string().trim().min(1).max(200),
  }).strict()).min(1).max(500),
}).strict().refine((value) => (value.publication_date === undefined) === (value.publication_precision === undefined), "publication_date and publication_precision go together.");

supplyRoutes.post("/admin/supply/production/documents", async (c) => {
  if (!bearer(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json({ error: "A valid admin token is required." }, 401);
  const parsed = productionDocumentSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid production document.", issues: issues(parsed.error) }, 400);
  const doc = parsed.data;
  const existing = await c.env.DB.prepare("SELECT id FROM production_estimate_documents WHERE source_key=? AND content_sha256=?")
    .bind(doc.source_key, doc.content_sha256).first<{ id: string }>();
  if (existing) return c.json({ status: "already_imported", document_id: existing.id });
  const problems: string[] = [];
  const resolvers = new Map<string, Awaited<ReturnType<typeof districtResolver>>>();
  const records = [];
  const seen = new Set<string>();
  for (const [index, record] of doc.records.entries()) {
    const at = `records.${index}`;
    if (parseReportingYear(record.reporting_year) === null) problems.push(`${at}: reporting_year must be YYYY-YY with consecutive years.`);
    if (record.area_thousand_hectares == null && record.production_thousand_tonnes == null && record.yield_kg_hectare == null) problems.push(`${at}: at least one measure is required.`);
    if (record.geography_level === "country" && (record.state || record.district)) problems.push(`${at}: country rows cannot name a state or district.`);
    if (record.geography_level === "state" && (!record.state || record.district)) problems.push(`${at}: state rows need a state and no district.`);
    let district: string | null = null;
    if (record.geography_level === "district") {
      if (!record.state || !record.district) problems.push(`${at}: district rows need the state and the district exactly as published.`);
      else {
        if (!resolvers.has(record.state)) resolvers.set(record.state, await districtResolver(c.env.DB, record.state));
        district = resolvers.get(record.state)!(record.district);
        if (!district) problems.push(`${at}: district "${record.district}" is not in the verified ${record.state} district list.`);
      }
    }
    const key = [record.reporting_year, record.geography_level, record.state ?? "", district ?? ""].join("|");
    if (seen.has(key)) problems.push(`${at}: duplicate geography and year within the document.`);
    seen.add(key);
    records.push({ ...record, district });
  }
  if (problems.length) return c.json({ error: "Production document rejected; nothing was stored.", problems: problems.slice(0, 50) }, 422);
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO production_estimate_documents(id,source_key,publisher,title,source_url,publication_date,publication_precision,content_sha256,archive_object_key,imported_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id, doc.source_key, doc.publisher, doc.title, doc.source_url, doc.publication_date ?? null,
      doc.publication_precision ?? null, doc.content_sha256, doc.archive_object_key ?? null, now),
    ...records.map((record) => c.env.DB.prepare(`INSERT INTO production_estimate_records(document_id,commodity_code,reporting_year,geography_level,state,district,
      estimate_type,estimate_label,area_thousand_hectares,production_thousand_tonnes,yield_kg_hectare,source_row_reference) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, COMMODITY, record.reporting_year, record.geography_level, record.geography_level === "country" ? null : record.state!, record.district,
        record.estimate_type, record.estimate_label, record.area_thousand_hectares ?? null, record.production_thousand_tonnes ?? null,
        record.yield_kg_hectare ?? null, record.source_row_reference)),
  ]);
  return c.json({ status: "imported", document_id: id, records: records.length }, 201);
});

// ------------------------------------------------------------------------------------------------
// B. Arrivals and traded quantities
const ARRIVAL_SOURCES = ["agmarknet", "enam", "other_official"] as const;
const arrivalImportSchema = z.object({
  source_key: z.enum(ARRIVAL_SOURCES),
  source_name: z.string().trim().min(3).max(200),
  source_url: https,
  authorization_note: z.string().trim().min(10).max(1000),
  file_name: z.string().trim().min(1).max(300),
  content_sha256: sha256,
  state: z.string().trim().min(2).max(100).default("Karnataka"),
  rows: z.array(z.object({
    row_number: z.number().int().min(1),
    measure: z.enum(["arrival", "traded"]),
    district: z.string().max(100),
    market: z.string().max(200),
    variety: z.string().max(200).nullable().optional(),
    observation_date: z.string().max(20),
    quantity: z.number(),
    unit: z.string().max(50),
  }).strict()).min(1).max(2000),
}).strict();

supplyRoutes.post("/ingest/arrivals", async (c) => {
  if (!bearer(c.req.header("Authorization"), c.env.INGESTION_TOKEN)) return c.json({ error: "A valid ingestion token is required." }, 401);
  const parsed = arrivalImportSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid arrivals import.", issues: issues(parsed.error) }, 400);
  const body = parsed.data, db = c.env.DB;
  const existing = await db.prepare("SELECT id, accepted_rows, duplicate_rows, rejected_rows FROM arrival_import_batches WHERE source_key=? AND content_sha256=?")
    .bind(body.source_key, body.content_sha256).first<{ id: string; accepted_rows: number; duplicate_rows: number; rejected_rows: number }>();
  if (existing) return c.json({ status: "already_imported", batch_id: existing.id, accepted: existing.accepted_rows, duplicates: existing.duplicate_rows, rejected: existing.rejected_rows });
  const resolve = await districtResolver(db, body.state);
  const today = istDate(new Date());
  const rejections: { row_number: number; reason: string }[] = [];
  type Accepted = { row_number: number; measure: string; district: string; market: string; variety: string | null; date: string; quantity: number; unit: string; tonnes: number | null; status: string };
  const accepted = new Map<string, Accepted>();
  let duplicates = 0;
  const identity = (row: { measure: string; market: string; variety: string | null; date: string }) => [row.measure, row.market.toLowerCase(), (row.variety ?? "").toLowerCase(), row.date].join("\u0000");
  const valueOf = (row: { quantity: number; unit: string }) => `${row.quantity}|${row.unit.trim().toLowerCase()}`;
  for (const row of body.rows) {
    const reject = (reason: string) => rejections.push({ row_number: row.row_number, reason });
    const district = resolve(row.district), market = row.market.trim(), variety = row.variety?.trim() || null, unit = row.unit.trim();
    if (!district) { reject(`District "${row.district}" is not in the verified ${body.state} district list.`); continue; }
    if (!market) { reject("Market name is missing."); continue; }
    if (!isCalendarDate(row.observation_date)) { reject("observation_date must be a YYYY-MM-DD calendar date."); continue; }
    if (row.observation_date > today) { reject("observation_date is in the future (IST)."); continue; }
    if (!Number.isFinite(row.quantity) || row.quantity < 0) { reject("Quantity must be a non-negative number."); continue; }
    if (!unit) { reject("Unit is missing; quantities without a unit are not stored."); continue; }
    const candidate = { row_number: row.row_number, measure: row.measure, district, market, variety, date: row.observation_date, quantity: row.quantity, unit };
    const key = identity(candidate), prior = accepted.get(key);
    if (prior) {
      if (valueOf(prior) === valueOf(candidate)) duplicates += 1;
      else reject(`Conflicts with row ${prior.row_number}: same market, measure, variety and date with a different quantity.`);
      continue;
    }
    const converted = toTonnes(row.quantity, unit);
    accepted.set(key, { ...candidate, tonnes: converted.tonnes, status: converted.status });
  }
  const dates = [...accepted.values()].map((row) => row.date).sort();
  if (dates.length) {
    const stored = await db.prepare(`SELECT measure, market, variety, observation_date AS date, quantity_original AS quantity, unit_original AS unit
      FROM market_arrivals WHERE source_key=? AND commodity_code=? AND state=? AND observation_date BETWEEN ? AND ?`)
      .bind(body.source_key, COMMODITY, body.state, dates[0], dates.at(-1)!).all<{ measure: string; market: string; variety: string | null; date: string; quantity: number; unit: string }>();
    for (const row of stored.results) {
      const key = identity(row), candidate = accepted.get(key);
      if (!candidate) continue;
      accepted.delete(key);
      if (valueOf(row) === valueOf(candidate)) duplicates += 1;
      else rejections.push({ row_number: candidate.row_number, reason: "Conflicts with a previously imported value for the same market, measure, variety and date; stored evidence is never overwritten." });
    }
  }
  const id = crypto.randomUUID(), rows = [...accepted.values()];
  rejections.sort((a, b) => a.row_number - b.row_number);
  await db.batch([
    db.prepare(`INSERT INTO arrival_import_batches(id,source_key,source_name,source_url,authorization_note,file_name,content_sha256,submitted_rows,accepted_rows,duplicate_rows,rejected_rows,rejections_json,imported_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, body.source_key, body.source_name, body.source_url, body.authorization_note, body.file_name,
      body.content_sha256, body.rows.length, rows.length, duplicates, rejections.length, JSON.stringify(rejections.slice(0, 500)), new Date().toISOString()),
    ...rows.map((row) => db.prepare(`INSERT INTO market_arrivals(batch_id,source_key,measure,commodity_code,state,district,market,variety,observation_date,
      quantity_original,unit_original,quantity_tonnes,unit_status,source_row_number) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, body.source_key, row.measure, COMMODITY, body.state, row.district, row.market, row.variety, row.date, row.quantity, row.unit, row.tonnes, row.status, row.row_number)),
  ]);
  return c.json({ status: "imported", batch_id: id, submitted: body.rows.length, accepted: rows.length, duplicates, rejected: rejections.length,
    unknown_unit: rows.filter((row) => row.status === "unknown_unit").length, rejections: rejections.slice(0, 100) }, 201);
});

const MAX_RANGE_DAYS = 1100;
function dateRange(from: string | undefined, to: string | undefined, defaultDays: number) {
  const end = to ?? istDate(new Date());
  const start = from ?? addDays(end, -(defaultDays - 1));
  if (!isCalendarDate(start) || !isCalendarDate(end)) return { error: "from and to must be YYYY-MM-DD calendar dates." };
  if (start > end) return { error: "from must not be after to." };
  if (daysBetween(start, end) > MAX_RANGE_DAYS) return { error: `Date ranges are limited to ${MAX_RANGE_DAYS} days.` };
  return { from: start, to: end };
}

supplyRoutes.get("/supply/arrivals", async (c) => {
  const granularity = c.req.query("granularity") ?? "weekly";
  if (!["daily", "weekly", "monthly", "seasonal"].includes(granularity)) return c.json({ error: "granularity must be daily, weekly, monthly or seasonal." }, 400);
  const range = dateRange(c.req.query("from"), c.req.query("to"), 365);
  if ("error" in range) return c.json({ error: range.error }, 400);
  const state = c.req.query("state") ?? "Karnataka", district = c.req.query("district"), market = c.req.query("market"), source = c.req.query("source");
  if (source && !(ARRIVAL_SOURCES as readonly string[]).includes(source)) return c.json({ error: "Unknown arrival source." }, 400);
  const filters = ["commodity_code=?", "state=?", "observation_date BETWEEN ? AND ?"], args: (string | number)[] = [COMMODITY, state, range.from, range.to];
  if (district) { filters.push("district=?"); args.push(district); }
  if (market) { filters.push("market=?"); args.push(market); }
  if (source) { filters.push("source_key=?"); args.push(source); }
  const where = filters.join(" AND ");
  const bucket = bucketSql(granularity as "daily", "observation_date");
  const db = c.env.DB;
  const [series, markets, batches, history] = await db.batch([
    db.prepare(`SELECT measure, ${bucket} AS bucket, MIN(observation_date) AS first_date, MAX(observation_date) AS last_date,
      ROUND(SUM(quantity_tonnes), 3) AS quantity_tonnes, COUNT(*) AS records, SUM(unit_status='unknown_unit') AS unknown_unit_records,
      COUNT(DISTINCT market) AS markets_reporting, COUNT(DISTINCT observation_date) AS reporting_days
      FROM market_arrivals WHERE ${where} GROUP BY measure, bucket ORDER BY measure, bucket LIMIT 5000`).bind(...args),
    db.prepare(`SELECT measure, market, district, COUNT(DISTINCT observation_date) AS reporting_days, ROUND(SUM(quantity_tonnes), 3) AS quantity_tonnes,
      SUM(unit_status='unknown_unit') AS unknown_unit_records FROM market_arrivals WHERE ${where} GROUP BY measure, market, district
      ORDER BY quantity_tonnes DESC LIMIT 50`).bind(...args),
    db.prepare(`SELECT DISTINCT b.id, b.source_key, b.source_name, b.source_url, b.file_name, b.imported_at, b.authorization_note
      FROM arrival_import_batches b JOIN market_arrivals a ON a.batch_id=b.id WHERE ${where.replace(/(commodity_code|state|observation_date|district|market|source_key)/g, "a.$1")}
      ORDER BY b.imported_at DESC LIMIT 50`).bind(...args),
    db.prepare(`SELECT COUNT(DISTINCT ${bucketSql("weekly", "observation_date")}) AS weeks FROM market_arrivals WHERE commodity_code=? AND state=? AND measure='arrival'`).bind(COMMODITY, state),
  ]);
  const rows = series.results as Record<string, string | number | null>[];
  const actual = rows.flatMap((row) => [row.first_date as string, row.last_date as string]).sort();
  return c.json({
    commodity: COMMODITY, state, district: district ?? null, market: market ?? null, granularity, requested_range: range,
    reporting_period: actual.length ? { from: actual[0], to: actual.at(-1) } : null,
    unit: "tonnes (only rows with an explicit tonne, quintal or kilogram unit are summed)",
    measures: {
      arrival: rows.filter((row) => row.measure === "arrival"),
      traded: rows.filter((row) => row.measure === "traded"),
    },
    markets: markets.results, sources: batches.results,
    seasons: granularity === "seasonal" ? IMD_SEASONS : undefined,
    forecast: forecastEligibility("arrivals", Number((history.results[0] as { weeks: number } | undefined)?.weeks ?? 0)),
    message: rows.length ? null
      : "No arrival or traded-quantity records exist for this selection. The AGMARKNET daily API resource carries no arrival quantities, and eNAM offers no public API; records appear only after an authorized file import.",
    notes: ["Arrivals and traded quantities are separate measures and are never added together.",
      "Weekly buckets start on Monday; seasons follow IMD meteorological seasons, not the arecanut harvest calendar."],
  });
});

supplyRoutes.get("/supply/arrivals/price-comparison", async (c) => {
  const range = dateRange(c.req.query("from"), c.req.query("to"), 365);
  if ("error" in range) return c.json({ error: range.error }, 400);
  const state = c.req.query("state") ?? "Karnataka";
  const rows = await c.env.DB.prepare(`SELECT a.observation_date, a.market, a.district, a.variety, a.quantity_original, a.unit_original, a.quantity_tonnes,
      o.minimum_price, o.maximum_price, o.modal_price, o.price_unit, o.price_basis, o.source_record_id
    FROM market_arrivals a
    JOIN markets m ON m.state=a.state AND lower(m.name)=lower(a.market)
    JOIN market_price_observations o ON o.market_id=m.id AND o.reporting_date=a.observation_date AND o.original_variety_name=a.variety
    WHERE a.source_key='agmarknet' AND a.measure='arrival' AND a.commodity_code=? AND a.state=? AND a.variety IS NOT NULL
      AND a.observation_date BETWEEN ? AND ? AND o.source_id='source-agmarknet' AND o.validation_status='verified'
      AND m.mapping_status='verified' AND o.commodity_name='Arecanut'
    ORDER BY a.observation_date DESC, a.market LIMIT 500`).bind(COMMODITY, state, range.from, range.to).all();
  return c.json({ state, requested_range: range, pairs: rows.results,
    method: "Pairs AGMARKNET arrivals with reviewer-verified AGMARKNET price observations for the same market, reporting date and exact source variety. Rows without a variety are not paired.",
    caution: "Co-movement between arrivals and prices is descriptive only and does not establish cause.",
    message: rows.results.length ? null : "No same-day, same-variety AGMARKNET arrival and price pairs exist for this range." });
});

// ------------------------------------------------------------------------------------------------
// C. Weather
async function historyDays(db: D1Database, state: string, district: string, from: string, to: string) {
  const [model, imported] = await db.batch([
    db.prepare(`SELECT day, provider, data_type, rainfall_mm, temperature_max_c, temperature_min_c, relative_humidity_pct, evidence_id, retrieved_at, source_url
      FROM weather_model_capture_days v WHERE kind='recent_model' AND state=? AND district=? AND day BETWEEN ? AND ?
        AND retrieved_at=(SELECT MAX(o.retrieved_at) FROM weather_model_capture_days o WHERE o.kind='recent_model' AND o.day=v.day)
      ORDER BY day`).bind(state, district, from, to),
    db.prepare(`SELECT h.observation_date AS day, h.provider, h.data_type, h.rainfall_mm, h.temperature_max_c, h.temperature_min_c, h.relative_humidity_pct,
        'batch:' || h.batch_id AS evidence_id, b.imported_at AS retrieved_at, b.source_url, h.station_id, h.station_name, h.location_key
      FROM weather_history_records h JOIN weather_import_batches b ON b.id=h.batch_id
      WHERE h.state=? AND h.district=? AND h.observation_date BETWEEN ? AND ? ORDER BY h.observation_date LIMIT 5000`).bind(state, district, from, to),
  ]);
  return [...model.results, ...imported.results] as (WeatherDay & { source_url: string })[];
}

supplyRoutes.get("/supply/weather", async (c) => {
  const state = c.req.query("state") ?? "Karnataka", district = c.req.query("district") ?? "Uttara Kannada";
  const range = dateRange(c.req.query("from"), c.req.query("to"), 120);
  if ("error" in range) return c.json({ error: range.error }, 400);
  const db = c.env.DB, now = new Date(), today = istDate(now);
  const days = await historyDays(db, state, district, range.from, range.to);
  const [modelForecast, officialForecast, warnings, latest, districts] = await db.batch([
    db.prepare(`SELECT day AS target_date, provider, data_type, rainfall_mm, temperature_max_c, temperature_min_c, relative_humidity_pct, retrieved_at AS issued_at, source_url
      FROM weather_model_capture_days WHERE kind='forecast_model' AND state=? AND district=?
        AND retrieved_at=(SELECT MAX(retrieved_at) FROM weather_model_capture_days WHERE kind='forecast_model') ORDER BY day`).bind(state, district),
    db.prepare(`SELECT f.target_date, f.provider, f.data_type, f.rainfall_mm, f.temperature_max_c, f.temperature_min_c, f.relative_humidity_pct, f.issued_at, b.source_url
      FROM weather_forecast_records f JOIN weather_import_batches b ON b.id=f.batch_id
      WHERE f.state=? AND f.district=? AND f.target_date>=? AND f.issued_at=(SELECT MAX(o.issued_at) FROM weather_forecast_records o
        WHERE o.provider=f.provider AND o.location_key=f.location_key AND o.target_date=f.target_date) ORDER BY f.target_date LIMIT 60`).bind(state, district, today),
    db.prepare(`SELECT w.provider, w.issued_at, w.valid_from, w.valid_to, w.warning_level, w.phenomena, w.source_text, b.source_url
      FROM weather_warnings w JOIN weather_import_batches b ON b.id=w.batch_id WHERE w.state=? AND w.district=? AND w.valid_to>=? ORDER BY w.valid_from LIMIT 50`).bind(state, district, today),
    db.prepare(`SELECT 'open_meteo_model_capture' AS dataset, MAX(retrieved_at) AS latest FROM weather_model_capture_days WHERE state=? AND district=?
      UNION ALL SELECT 'imported_' || b.provider || '_' || b.dataset, MAX(b.imported_at) FROM weather_import_batches b
        WHERE EXISTS (SELECT 1 FROM weather_history_records h WHERE h.batch_id=b.id AND h.state=? AND h.district=?)
           OR EXISTS (SELECT 1 FROM weather_forecast_records f WHERE f.batch_id=b.id AND f.state=? AND f.district=?)
           OR EXISTS (SELECT 1 FROM weather_warnings w WHERE w.batch_id=b.id AND w.state=? AND w.district=?)
        GROUP BY b.provider, b.dataset`).bind(state, district, state, district, state, district, state, district),
    db.prepare("SELECT district FROM geography_districts WHERE state=? ORDER BY district").bind(state),
  ]);
  const latestRows = (latest.results as { dataset: string; latest: string | null }[]);
  const modelLatest = latestRows.find((row) => row.dataset === "open_meteo_model_capture")?.latest ?? null;
  const dataTypes = [...new Set(days.map((row) => row.data_type))];
  return c.json({
    state, district, districts: (districts.results as { district: string }[]).map((row) => row.district), requested_range: range,
    reporting_period: days.length ? { from: days.map((row) => row.day).sort()[0], to: days.map((row) => row.day).sort().at(-1) } : null,
    history: days.sort((a, b) => a.day.localeCompare(b.day) || a.data_type.localeCompare(b.data_type)),
    forecasts: { model: modelForecast.results, official: officialForecast.results },
    warnings: warnings.results,
    seasonal: seasonalSummary(days),
    freshness: {
      model_capture: { ...freshness(modelLatest, now), latest: modelLatest },
      imports: latestRows.filter((row) => row.dataset !== "open_meteo_model_capture").map((row) => ({ dataset: row.dataset, latest: row.latest,
        note: "Imported datasets are refreshed manually; age reflects the last authorized import." })),
    },
    data_types: Object.fromEntries([...dataTypes, ...(modelForecast.results.length ? ["model_grid"] : []), ...(officialForecast.results.length ? ["official_forecast"] : [])]
      .map((type) => [type, DATA_TYPE_LABELS[type] ?? type])),
    message: days.length || modelForecast.results.length ? null
      : `No weather records exist for ${district}. The Open-Meteo development capture covers only a grid point near Sirsi (Uttara Kannada); IMD station data requires approved API access or an authorized import.`,
    notes: ["Observation-type datasets and forecasts are stored and shown separately.",
      "Seasons follow IMD meteorological definitions. Seasons with missing days are marked incomplete."],
  });
});

const weatherImportSchema = z.object({
  provider: z.enum(["imd", "open_meteo", "other_official"]),
  dataset: z.enum(["history", "forecast", "warning"]),
  source_url: https,
  authorization_note: z.string().trim().min(10).max(1000),
  content_sha256: sha256,
  state: z.string().trim().min(2).max(100).default("Karnataka"),
  history: z.array(z.object({
    data_type: z.enum(["station_measurement", "model_grid", "reanalysis"]),
    location_key: z.string().regex(/^[a-z0-9_:-]{2,80}$/), station_id: z.string().max(80).optional(), station_name: z.string().max(200).optional(),
    district: z.string().max(100), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(),
    observation_date: day, rainfall_mm: z.number().min(0).nullable().optional(), temperature_max_c: z.number().min(-20).max(60).nullable().optional(),
    temperature_min_c: z.number().min(-20).max(60).nullable().optional(), relative_humidity_pct: z.number().min(0).max(100).nullable().optional(),
  }).strict()).max(5000).optional(),
  forecasts: z.array(z.object({
    data_type: z.enum(["official_forecast", "model_grid"]), location_key: z.string().regex(/^[a-z0-9_:-]{2,80}$/), district: z.string().max(100),
    issued_at: z.string().datetime({ offset: true }), target_date: day, rainfall_mm: z.number().min(0).nullable().optional(),
    temperature_max_c: z.number().min(-20).max(60).nullable().optional(), temperature_min_c: z.number().min(-20).max(60).nullable().optional(),
    relative_humidity_pct: z.number().min(0).max(100).nullable().optional(),
  }).strict()).max(5000).optional(),
  warnings: z.array(z.object({
    district: z.string().max(100), issued_at: z.string().datetime({ offset: true }), valid_from: day, valid_to: day,
    warning_level: z.enum(["green", "yellow", "orange", "red", "unspecified"]), phenomena: z.string().trim().min(2).max(300), source_text: z.string().trim().min(2).max(4000),
  }).strict()).max(2000).optional(),
}).strict().refine((value) => {
  const lists = { history: value.history, forecast: value.forecasts, warning: value.warnings };
  return Boolean(lists[value.dataset]?.length) && Object.entries(lists).every(([key, list]) => key === value.dataset || !list);
}, "Provide exactly the record list matching the dataset (history, forecasts or warnings).");

supplyRoutes.post("/admin/supply/weather/imports", async (c) => {
  if (!bearer(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json({ error: "A valid admin token is required." }, 401);
  const parsed = weatherImportSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid weather import.", issues: issues(parsed.error) }, 400);
  const body = parsed.data, db = c.env.DB;
  if (body.provider === "open_meteo" && body.history?.some((row) => row.data_type === "station_measurement")) {
    return c.json({ error: "Open-Meteo provides model and reanalysis data, never station measurements." }, 422);
  }
  if (body.history?.some((row) => row.data_type === "station_measurement" && (!row.station_id || !row.station_name))) {
    return c.json({ error: "Station measurements need station_id and station_name." }, 422);
  }
  const existing = await db.prepare("SELECT id FROM weather_import_batches WHERE provider=? AND dataset=? AND content_sha256=?")
    .bind(body.provider, body.dataset, body.content_sha256).first<{ id: string }>();
  if (existing) return c.json({ status: "already_imported", batch_id: existing.id });
  const resolve = await districtResolver(db, body.state);
  const list = (body.history ?? body.forecasts ?? body.warnings)!;
  const unmapped = [...new Set(list.map((row) => row.district).filter((name) => !resolve(name)))];
  if (unmapped.length) return c.json({ error: "Unmapped districts; nothing was stored.", districts: unmapped.slice(0, 20) }, 422);
  const id = crypto.randomUUID();
  const statements = [db.prepare(`INSERT INTO weather_import_batches(id,provider,dataset,source_url,authorization_note,content_sha256,row_count,imported_at) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(id, body.provider, body.dataset, body.source_url, body.authorization_note, body.content_sha256, list.length, new Date().toISOString())];
  if (body.history) statements.push(...body.history.map((row) => db.prepare(`INSERT OR IGNORE INTO weather_history_records(batch_id,provider,data_type,location_key,station_id,station_name,
    district,state,latitude,longitude,observation_date,rainfall_mm,temperature_max_c,temperature_min_c,relative_humidity_pct) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, body.provider, row.data_type, row.location_key, row.station_id ?? null, row.station_name ?? null, resolve(row.district), body.state,
      row.latitude ?? null, row.longitude ?? null, row.observation_date, row.rainfall_mm ?? null, row.temperature_max_c ?? null, row.temperature_min_c ?? null, row.relative_humidity_pct ?? null)));
  if (body.forecasts) statements.push(...body.forecasts.map((row) => db.prepare(`INSERT OR IGNORE INTO weather_forecast_records(batch_id,provider,data_type,location_key,district,state,
    issued_at,target_date,rainfall_mm,temperature_max_c,temperature_min_c,relative_humidity_pct) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, body.provider, row.data_type, row.location_key, resolve(row.district), body.state, row.issued_at, row.target_date, row.rainfall_mm ?? null,
      row.temperature_max_c ?? null, row.temperature_min_c ?? null, row.relative_humidity_pct ?? null)));
  if (body.warnings) statements.push(...body.warnings.map((row) => db.prepare(`INSERT OR IGNORE INTO weather_warnings(batch_id,provider,district,state,issued_at,valid_from,valid_to,
    warning_level,phenomena,source_text) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, body.provider, resolve(row.district), body.state, row.issued_at, row.valid_from, row.valid_to, row.warning_level, row.phenomena, row.source_text)));
  try {
    const results = await db.batch(statements);
    const stored = results.slice(1).reduce((sum, result) => sum + Number(result.meta?.changes ?? 0), 0);
    return c.json({ status: "imported", batch_id: id, submitted: list.length, stored, skipped_existing: list.length - stored }, 201);
  } catch (error) {
    return c.json({ error: "Weather import rejected by data constraints; nothing was stored.", detail: String((error as Error).message).slice(0, 300) }, 422);
  }
});

export const SIRSI_REFERENCE = { latitude: 14.6195, longitude: 74.8354, district: "Uttara Kannada", state: "Karnataka", location_key: "sirsi_reference" };
export const OPEN_METEO_ARCHIVE_LAG_DAYS = 6;
const archiveSchema = z.object({
  start_date: z.array(z.string()).optional(),
  daily: z.object({
    time: z.array(z.string()), temperature_2m_max: z.array(z.number().nullable()), temperature_2m_min: z.array(z.number().nullable()),
    precipitation_sum: z.array(z.number().nullable()), relative_humidity_2m_mean: z.array(z.number().nullable()).optional(),
  }),
  latitude: z.number(), longitude: z.number(),
});
export function parseArchive(json: unknown, from: string, to: string) {
  const parsed = archiveSchema.parse(json), daily = parsed.daily, length = daily.time.length;
  for (const list of [daily.temperature_2m_max, daily.temperature_2m_min, daily.precipitation_sum, daily.relative_humidity_2m_mean ?? daily.time]) {
    if (list.length !== length) throw new Error("Open-Meteo archive arrays have inconsistent lengths.");
  }
  return { latitude: parsed.latitude, longitude: parsed.longitude, rows: daily.time.map((date, index) => {
    if (!isCalendarDate(date) || date < from || date > to) throw new Error(`Unexpected archive date ${date}.`);
    const humidity = daily.relative_humidity_2m_mean?.[index] ?? null;
    if (humidity !== null && (humidity < 0 || humidity > 100)) throw new Error("Humidity outside 0-100%.");
    const rain = daily.precipitation_sum[index];
    if (rain !== null && rain < 0) throw new Error("Negative rainfall.");
    return { date, maximum: daily.temperature_2m_max[index], minimum: daily.temperature_2m_min[index], rain, humidity };
  }).filter((row) => row.maximum !== null || row.minimum !== null || row.rain !== null || row.humidity !== null) };
}

supplyRoutes.post("/admin/supply/weather/open-meteo-archive", async (c) => {
  if (!bearer(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json({ error: "A valid admin token is required." }, 401);
  if (c.env.OPEN_METEO_ENABLED === "false") return c.json({ error: "Open-Meteo is disabled for this deployment (OPEN_METEO_ENABLED=false)." }, 409);
  const body = z.object({ from: day, to: day }).strict().safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Provide from and to as YYYY-MM-DD.", issues: issues(body.error) }, 400);
  const { from, to } = body.data, latestAllowed = addDays(istDate(new Date()), -OPEN_METEO_ARCHIVE_LAG_DAYS);
  if (from > to || to > latestAllowed || daysBetween(from, to) > 365) {
    return c.json({ error: `Range must be at most 366 days and end on or before ${latestAllowed} (archive publication lag).` }, 400);
  }
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${SIRSI_REFERENCE.latitude}&longitude=${SIRSI_REFERENCE.longitude}&start_date=${from}&end_date=${to}`
    + "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean&timezone=Asia%2FKolkata";
  let raw: string;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(45_000), headers: { Accept: "application/json" } });
    raw = await response.text();
    if (!response.ok) return c.json({ error: `Open-Meteo archive returned HTTP ${response.status}.`, detail: raw.slice(0, 300) }, 502);
  } catch (error) {
    return c.json({ error: "Open-Meteo archive request failed.", detail: String((error as Error).message).slice(0, 200) }, 502);
  }
  let archive: ReturnType<typeof parseArchive>;
  try { archive = parseArchive(JSON.parse(raw), from, to); } catch (error) {
    return c.json({ error: "Open-Meteo archive response failed validation.", detail: String((error as Error).message).slice(0, 300) }, 502);
  }
  const db = c.env.DB, sha = await hashText(raw);
  const existing = await db.prepare("SELECT id FROM weather_import_batches WHERE provider='open_meteo' AND dataset='history' AND content_sha256=?").bind(sha).first<{ id: string }>();
  if (existing) return c.json({ status: "already_imported", batch_id: existing.id });
  const id = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(`INSERT INTO weather_import_batches(id,provider,dataset,source_url,authorization_note,content_sha256,row_count,imported_at) VALUES(?,?,?,?,?,?,?,?)`)
      .bind(id, "open_meteo", "history", url, "Open-Meteo free API for non-commercial use; attribution CC BY 4.0 (open-meteo.com). Development source only.", sha, archive.rows.length, new Date().toISOString()),
    ...archive.rows.map((row) => db.prepare(`INSERT OR IGNORE INTO weather_history_records(batch_id,provider,data_type,location_key,district,state,latitude,longitude,observation_date,
      rainfall_mm,temperature_max_c,temperature_min_c,relative_humidity_pct) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, "open_meteo", "reanalysis", SIRSI_REFERENCE.location_key, SIRSI_REFERENCE.district, SIRSI_REFERENCE.state, archive.latitude, archive.longitude,
        row.date, row.rain, row.maximum, row.minimum, row.humidity)),
  ]);
  const stored = results.slice(1).reduce((sum, result) => sum + Number(result.meta?.changes ?? 0), 0);
  return c.json({ status: "imported", batch_id: id, days: archive.rows.length, stored, skipped_existing: archive.rows.length - stored,
    grid: { latitude: archive.latitude, longitude: archive.longitude }, data_type: "reanalysis" }, 201);
});

// ------------------------------------------------------------------------------------------------
// D. Crop risk
async function loadRules(db: D1Database) {
  const [rules, reviews] = await db.batch([
    db.prepare("SELECT * FROM crop_risk_rules WHERE commodity_code=? ORDER BY rule_key, version").bind(COMMODITY),
    db.prepare("SELECT * FROM crop_risk_rule_reviews ORDER BY reviewed_at, rowid"),
  ]);
  return { rules: rules.results as RuleRow[], reviews: reviews.results as ReviewRow[] };
}

supplyRoutes.get("/supply/risk/rules", async (c) => {
  const { rules, reviews } = await loadRules(c.env.DB);
  const latestVersion = new Map<string, number>();
  for (const rule of rules) latestVersion.set(rule.rule_key, Math.max(latestVersion.get(rule.rule_key) ?? 0, rule.version));
  return c.json({ rules: rules.map((rule) => {
    const ruleReviews = reviews.filter((review) => review.rule_id === rule.id);
    return { ...rule, weather_conditions: rule.weather_conditions_json ? JSON.parse(rule.weather_conditions_json) : null, citations: JSON.parse(rule.citations_json),
      status: ruleStatus(ruleReviews), latest_version: latestVersion.get(rule.rule_key) === rule.version, reviews: ruleReviews,
      approval_blockers: approvalProblems(rule) };
  }), policy: "Rules are drafts until a qualified agricultural expert approves them. Only expert-approved rules generate advisories." });
});

const ruleVersionSchema = z.object({
  rule_key: z.string().regex(/^[a-z0-9-]{3,80}$/),
  hazard_key: z.enum(HAZARDS).optional(), hazard_name: z.string().trim().min(3).max(200).optional(),
  hazard_type: z.enum(["disease", "pest"]).optional(), causal_agent: z.string().trim().max(300).nullable().optional(),
  source_summary: z.string().trim().min(20).max(4000),
  weather_relevance: z.enum(["weather_linked", "not_weather_driven", "unknown"]),
  weather_conditions: conditionSchema.nullable().optional(),
  field_evidence_required: z.string().trim().min(10).max(2000),
  management_guidance: z.string().trim().min(10).max(4000).nullable().optional(),
  citations: z.array(z.object({ publisher: z.string().trim().min(3).max(200), title: z.string().trim().min(3).max(300), url: https,
    pages: z.string().max(50).optional() }).strict()).max(10),
  citation_status: z.enum(["verified", "unverified"]),
  created_by: z.string().trim().min(3).max(200),
}).strict().refine((value) => value.weather_relevance === "weather_linked" || !value.weather_conditions, "Only weather-linked rules can carry weather conditions.")
  .refine((value) => value.citation_status === "unverified" || value.citations.length > 0, "Verified rules need at least one citation.");

supplyRoutes.post("/admin/supply/risk/rules", async (c) => {
  if (!bearer(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json({ error: "A valid admin token is required." }, 401);
  const parsed = ruleVersionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid rule version.", issues: issues(parsed.error) }, 400);
  const body = parsed.data, db = c.env.DB;
  const previous = await db.prepare("SELECT * FROM crop_risk_rules WHERE rule_key=? ORDER BY version DESC LIMIT 1").bind(body.rule_key).first<RuleRow>();
  const hazardKey = body.hazard_key ?? previous?.hazard_key, hazardName = body.hazard_name ?? previous?.hazard_name, hazardType = body.hazard_type ?? previous?.hazard_type;
  if (!hazardKey || !hazardName || !hazardType) return c.json({ error: "New rule keys need hazard_key, hazard_name and hazard_type." }, 400);
  if (previous && hazardKey !== previous.hazard_key) return c.json({ error: "A rule key cannot change hazard; create a new rule key." }, 409);
  const version = (previous?.version ?? 0) + 1, id = `${body.rule_key}-v${version}`;
  await db.prepare(`INSERT INTO crop_risk_rules(id,rule_key,version,commodity_code,hazard_key,hazard_name,hazard_type,causal_agent,source_summary,weather_relevance,
    weather_conditions_json,field_evidence_required,management_guidance,citations_json,citation_status,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, body.rule_key, version, COMMODITY, hazardKey, hazardName, hazardType, body.causal_agent === undefined ? previous?.causal_agent ?? null : body.causal_agent,
      body.source_summary, body.weather_relevance, body.weather_conditions ? JSON.stringify(body.weather_conditions) : null, body.field_evidence_required,
      body.management_guidance ?? null, JSON.stringify(body.citations), body.citation_status, new Date().toISOString(), body.created_by).run();
  return c.json({ status: "draft_created", id, version, message: "New versions are drafts until reviewed by a qualified expert." }, 201);
});

const reviewSchema = z.object({
  decision: z.enum(["approve", "reject", "retire"]),
  reviewer_name: z.string().trim().min(3).max(200),
  reviewer_qualification: z.string().trim().min(5).max(300),
  note: z.string().trim().min(10).max(2000),
}).strict();

supplyRoutes.post("/admin/supply/risk/rules/:id/review", async (c) => {
  if (!bearer(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json({ error: "A valid admin token is required." }, 401);
  const parsed = reviewSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid review.", issues: issues(parsed.error) }, 400);
  const db = c.env.DB, rule = await db.prepare("SELECT * FROM crop_risk_rules WHERE id=?").bind(c.req.param("id")).first<RuleRow>();
  if (!rule) return c.json({ error: "Rule not found." }, 404);
  if (parsed.data.decision === "approve") {
    const latest = await db.prepare("SELECT MAX(version) AS version FROM crop_risk_rules WHERE rule_key=?").bind(rule.rule_key).first<{ version: number }>();
    if (latest && latest.version !== rule.version) return c.json({ error: "Only the latest version of a rule can be approved." }, 409);
    const problems = approvalProblems(rule);
    if (problems.length) return c.json({ error: "Rule cannot be approved.", problems }, 422);
  }
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO crop_risk_rule_reviews(id,rule_id,decision,reviewer_name,reviewer_qualification,note,reviewed_at) VALUES(?,?,?,?,?,?,?)")
    .bind(id, rule.id, parsed.data.decision, parsed.data.reviewer_name, parsed.data.reviewer_qualification, parsed.data.note, new Date().toISOString()).run();
  return c.json({ status: "recorded", review_id: id, rule_id: rule.id, decision: parsed.data.decision }, 201);
});

const fieldReportSchema = z.object({
  hazard_key: z.enum(HAZARDS), state: z.string().trim().min(2).max(100).default("Karnataka"), district: z.string().max(100),
  location_detail: z.string().trim().min(3).max(300), observed_on: day,
  reporter_role: z.enum(["farmer", "extension_officer", "scientist", "other"]),
  symptoms_observed: z.string().trim().min(10).max(4000),
  palms_inspected: z.number().int().positive().optional(), palms_affected: z.number().int().min(0).optional(),
  evidence_url: https.optional(),
}).strict().refine((value) => value.palms_affected === undefined || value.palms_inspected === undefined || value.palms_affected <= value.palms_inspected,
  "palms_affected cannot exceed palms_inspected.");

supplyRoutes.post("/ingest/risk/field-reports", async (c) => {
  if (!bearer(c.req.header("Authorization"), c.env.INGESTION_TOKEN)) return c.json({ error: "A valid ingestion token is required." }, 401);
  const parsed = fieldReportSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid field report.", issues: issues(parsed.error) }, 400);
  const body = parsed.data;
  if (body.observed_on > istDate(new Date())) return c.json({ error: "observed_on cannot be in the future (IST)." }, 400);
  const district = (await districtResolver(c.env.DB, body.state))(body.district);
  if (!district) return c.json({ error: `District "${body.district}" is not in the verified ${body.state} district list.` }, 422);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO crop_field_reports(id,hazard_key,state,district,location_detail,observed_on,reporter_role,symptoms_observed,palms_inspected,
    palms_affected,evidence_url,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, body.hazard_key, body.state, district, body.location_detail, body.observed_on,
    body.reporter_role, body.symptoms_observed, body.palms_inspected ?? null, body.palms_affected ?? null, body.evidence_url ?? null, new Date().toISOString()).run();
  return c.json({ status: "pending_review", id, district }, 201);
});

supplyRoutes.post("/admin/supply/risk/field-reports/:id/review", async (c) => {
  if (!bearer(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json({ error: "A valid admin token is required." }, 401);
  const parsed = z.object({ decision: z.enum(["verified", "rejected"]), reviewed_by: z.string().trim().min(3).max(200), note: z.string().trim().min(10).max(2000) })
    .strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid review.", issues: issues(parsed.error) }, 400);
  const result = await c.env.DB.prepare(`UPDATE crop_field_reports SET verification_status=?, reviewed_by=?, review_note=?, reviewed_at=? WHERE id=? AND verification_status='pending'`)
    .bind(parsed.data.decision, parsed.data.reviewed_by, parsed.data.note, new Date().toISOString(), c.req.param("id")).run();
  if (!Number(result.meta?.changes ?? 0)) return c.json({ error: "Report not found or already reviewed." }, 409);
  return c.json({ status: parsed.data.decision, id: c.req.param("id") });
});

supplyRoutes.get("/supply/risk/field-reports", async (c) => {
  const status = c.req.query("status");
  if (status && !["pending", "verified", "rejected"].includes(status)) return c.json({ error: "Unknown status." }, 400);
  const rows = await c.env.DB.prepare(`SELECT id, hazard_key, state, district, observed_on, reporter_role, symptoms_observed, palms_inspected, palms_affected,
    verification_status, reviewed_at FROM crop_field_reports ${status ? "WHERE verification_status=?" : ""} ORDER BY observed_on DESC LIMIT 200`)
    .bind(...(status ? [status] : [])).all();
  return c.json({ reports: rows.results });
});

supplyRoutes.get("/supply/risk/advisories", async (c) => {
  const state = c.req.query("state") ?? "Karnataka", district = c.req.query("district") ?? "Uttara Kannada";
  const asOf = c.req.query("as_of") ?? addDays(istDate(new Date()), -1);
  if (!isCalendarDate(asOf)) return c.json({ error: "as_of must be YYYY-MM-DD." }, 400);
  const db = c.env.DB;
  const { rules, reviews } = await loadRules(db);
  const published = publishedRules(rules, reviews);
  const days = preferredDays(await historyDays(db, state, district, addDays(asOf, -59), asOf));
  const reports = (await db.prepare(`SELECT id, hazard_key, observed_on, verification_status, reporter_role FROM crop_field_reports
    WHERE state=? AND district=? AND observed_on BETWEEN ? AND ?`).bind(state, district, addDays(asOf, -59), asOf).all<FieldReport>()).results;
  const advisories = published.map((rule) => evaluateRule(rule, days, reports, asOf));
  return c.json({
    state, district, as_of: asOf, advisories,
    rules: { total_versions: rules.length, published: published.length, awaiting_review: rules.filter((rule) => ruleStatus(reviews.filter((review) => review.rule_id === rule.id)) === "draft").length },
    weather_basis: { days: days.length, data_types: [...new Set(days.map((row) => row.data_type))].map((type) => ({ type, label: DATA_TYPE_LABELS[type] ?? type })),
      period: days.length ? { from: days[0].day, to: days.at(-1)!.day } : null },
    message: published.length ? null : "No crop-risk rule has been approved by a qualified expert, so no advisory is issued.",
    disclaimer: "Areca Pulse advisories are not diagnoses. Weather can indicate conditions that published research associates with a hazard; only field inspection and laboratory confirmation can establish presence. Consult ICAR-CPCRI or the State Horticulture Department before applying any treatment.",
  });
});

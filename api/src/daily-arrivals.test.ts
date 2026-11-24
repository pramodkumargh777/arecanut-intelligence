import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations, LocalDatabase } from "./test-support/local-d1";
import { app, type Env } from "./index";
import { parseAgmarknetDatewise, parseKrama, recentArrivals, seasonPattern, type MonthTotal } from "./daily-arrivals";
import { defaultArrivalWindow } from "./supply-routes";
import { arrivalRows } from "../../frontend/src/services/supply";

// Real source pages/responses (KRAMA 13 Nov 2026; AGMARKNET date-wise October 2026, Sirsi and Yellapur only). Everything
// else is synthetic and lives only in this in-memory database.
const KRAMA_PAGE = readFileSync("src/fixtures/krama/commodity-arecanut-2026-11-13.html", "utf8");
const AGM_MONTH = readFileSync("src/fixtures/agmarknet-v2/datewise-2026-10-sirsi-yellapur.json", "utf8");
const KRAMA_TABLE = /<table\b[\s\S]*?<\/table>/.exec(KRAMA_PAGE)![0];

let db: LocalDatabase;
let env: Env["Bindings"];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T06:00:00Z"));
  db = applyMigrations(new LocalDatabase());
  env = { DB: db as unknown as D1Database, INGESTION_TOKEN: "import", ADMIN_TOKEN: "review" };
});
afterEach(() => { db.sqlite.close(); vi.useRealTimers(); });

const bearer = (token: string) => ({ Authorization: ["Bearer", token].join(" ") });
const post = (path: string, body: unknown, token = "import") => app.request(`/api/v1${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...bearer(token) }, body: JSON.stringify(body) }, env);
const get = async <T = any>(path: string) => (await app.request(`/api/v1${path}`, { headers: bearer("import") }, env)).json() as Promise<T>;
const count = (sql: string) => Number((db.sqlite.prepare(sql).get() as { n: number }).n);
const dmy = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function kramaDoc(date: string, table = KRAMA_TABLE.replaceAll("13/11/2026", dmy(date)), overrides: Record<string, unknown> = {}, fetchedAt = "2026-11-17T05:00:00Z") {
  const payload = { status: "reported", date, heading: `MARKETWISE REPORT FOR VARIOUS COMMODITIES AS ON ${dmy(date)}`, commodity: "COMMODITY: Arecanut",
    table_html: table, ...overrides };
  return { request_url: "https://krama.karnataka.gov.in/reports/CommadityRep", request_params: { report: "C", date: dmy(date), commodity: "140" },
    period_start: date, period_end: date, fetched_at: fetchedAt, raw_sha256: "a".repeat(64), raw_bytes: 64480,
    payload_format: "krama_commodity_table/1", parser_version: "test/1", payload: JSON.stringify(payload) };
}
function agmDoc(body = AGM_MONTH, fetchedAt = "2026-11-17T05:00:00Z") {
  return { request_url: "https://api.agmarknet.gov.in/v1/prices-and-arrivals/date-wise/specific-commodity?year=2026&month=10&includeExcel=false&stateId=16&commodityId=118",
    request_params: { year: "2026", month: "10", includeExcel: "false", stateId: "16", commodityId: "118" }, period_start: "2026-10-01",
    period_end: "2026-10-31", fetched_at: fetchedAt, raw_sha256: "b".repeat(64), raw_bytes: body.length, payload_format: "agmarknet_datewise_json/1",
    parser_version: "test/1", payload: body };
}
/** A KRAMA table with the verified header and the given rows. */
const table = (rows: string[][]) => `<table>\n<tr><th>Market</th><th>Variety</th><th>Grade</th><th>Arrivals</th><th>Units</th><th>Min (Rs.)</th><th>Max (Rs.)</th><th>Modal (Rs.)</th></tr>${
  rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}\n</table>`;

describe("parsers", () => {
  it("reads KRAMA's report table as published, quintals converted to tonnes", () => {
    const parsed = parseKrama(kramaDoc("2026-11-13").payload, "2026-11-13");
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows.length).toBeGreaterThan(70);
    expect(parsed.rows.find((row) => row.source_market_name === "SIRSI" && row.variety === "Bette")).toEqual({
      source_market_name: "SIRSI", observation_date: "2026-11-13", variety: "Bette", grade: "Average", quantity_original: 4, unit_original: "Quintal",
      quantity_tonnes: 0.4, unit_status: "converted", minimum_price: 36399, maximum_price: 44116, modal_price: 40171, price_unit: "INR/quintal" });
    expect(parsed.rows.every((row) => row.unit_original === "Quintal")).toBe(true);
  });

  it("keeps blank KRAMA prices blank and rejects rows without a number of arrivals", () => {
    const parsed = parseKrama(kramaDoc("2026-11-13", table([["BANTWALA", "Coca", "FAQ", "450", "Quintal", "", "25000", ""],
      ["SIRSI", "Rashi", "Average", "", "Quintal", "1", "2", "1"], ["KUMTA", "Chali", "Average", "12", "Bags", "1", "2", "1"]])).payload, "2026-11-13");
    expect(parsed.rows[0]).toMatchObject({ quantity_tonnes: 45, minimum_price: null, maximum_price: 25000, modal_price: null });
    expect(parsed.rows[1]).toMatchObject({ unit_original: "Bags", unit_status: "unknown_unit", quantity_tonnes: null });
    expect(parsed.rejected).toEqual([expect.objectContaining({ reason: "Arrivals is not a number." })]);
  });

  it("accepts KRAMA's own no-data report as a not-reported day, and nothing vaguer", () => {
    const noData = (extra: Record<string, unknown>) => JSON.stringify({ status: "not_reported", date: "2026-08-23",
      evidence: "No Data Found For The Commodity", heading: "MARKETWISE REPORT FOR VARIOUS COMMODITIES AS ON 23/08/2026",
      commodity: "COMMODITY: Arecanut", ...extra });
    expect(parseKrama(noData({}), "2026-08-23")).toEqual({ status: "not_reported", rows: [], rejected: [], problems: [] });
    expect(parseKrama(noData({ heading: "MARKETWISE REPORT FOR VARIOUS COMMODITIES AS ON 22/08/2026" }), "2026-08-23").problems).toHaveLength(1);
    expect(parseKrama(noData({ evidence: "nothing" }), "2026-08-23").problems).toHaveLength(1);
  });

  it("refuses KRAMA pages for another date, commodity or layout", () => {
    expect(parseKrama(kramaDoc("2026-11-13").payload, "2026-11-14").problems).toEqual(["Payload date does not match the document period."]);
    expect(parseKrama(kramaDoc("2026-11-13", undefined, { heading: "MARKETWISE REPORT FOR VARIOUS COMMODITIES AS ON 12/11/2026" }).payload, "2026-11-13").problems)
      .toContain("Report heading is not for the requested date.");
    expect(parseKrama(kramaDoc("2026-11-13", undefined, { commodity: "COMMODITY: Coconut" }).payload, "2026-11-13").problems).toContain("Report is not for arecanut.");
    expect(parseKrama(kramaDoc("2026-11-13", KRAMA_TABLE.replace("Arrivals", "Arrival Qty")).payload, "2026-11-13").problems.join(" ")).toContain("not the verified ones");
  });

  it("reads AGMARKNET date-wise rows and rounds floating-point noise", () => {
    const parsed = parseAgmarknetDatewise(AGM_MONTH, "2026-10-01", "2026-10-31");
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows).toHaveLength(57);
    expect(parsed.rows.find((row) => row.source_market_name === "Sirsi APMC" && row.observation_date === "2026-10-01" && row.variety === "Rashi"))
      .toMatchObject({ quantity_original: 6.5, unit_original: "Metric Tonnes", quantity_tonnes: 6.5, grade: null, modal_price: 45477 });
    expect(parseAgmarknetDatewise(AGM_MONTH, "2026-09-01", "2026-09-30").problems.join(" ")).toContain("not Karnataka arecanut for September, 2026");
  });
});

describe("POST /admin/arrivals/daily/import", () => {
  it("requires the ingestion token and can be switched off", async () => {
    expect((await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [kramaDoc("2026-11-13")] }, "wrong")).status).toBe(401);
    env.DAILY_ARRIVALS_IMPORT_ENABLED = "false";
    expect((await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [kramaDoc("2026-11-13")] })).status).toBe(503);
  });

  it("stores the document verbatim and its rows once; a repeat changes nothing", async () => {
    const first = await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [kramaDoc("2026-11-13")] });
    expect(first.status).toBe(201);
    const result = await first.json() as any;
    expect(result).toMatchObject({ documents_new: 1, revised: 0, removed: 0, rejected_rows: 0 });
    expect(result.inserted).toBe(count("SELECT COUNT(*) AS n FROM market_arrival_days"));
    expect((db.sqlite.prepare("SELECT payload FROM arrival_daily_documents").get() as any).payload).toBe(kramaDoc("2026-11-13").payload);
    const again = await (await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [kramaDoc("2026-11-13")] })).json() as any;
    expect(again).toMatchObject({ documents_new: 0, inserted: 0, duplicates: result.inserted });
    expect(count("SELECT COUNT(*) AS n FROM arrival_daily_documents")).toBe(1);
  });

  it("treats a newer page as the date's snapshot: revisions and removals, with the old rows kept", async () => {
    await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [kramaDoc("2026-11-13", table([
      ["SIRSI", "Bette", "Average", "4", "Quintal", "36399", "44116", "40171"], ["KUMTA", "Chali", "Average", "175", "Quintal", "36019", "42529", "40859"]]))] });
    const revised = await (await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [kramaDoc("2026-11-13", table([
      ["SIRSI", "Bette", "Average", "6", "Quintal", "36399", "44116", "40171"], ["SIRSI", "Rashi", "Average", "30", "Quintal", "1", "2", "1"]]),
    {}, "2026-11-17T06:00:00Z")] })).json() as any;
    expect(revised).toMatchObject({ documents_new: 1, inserted: 1, revised: 1, removed: 1 });
    expect(db.sqlite.prepare("SELECT market, variety, quantity_tonnes FROM market_arrival_days_current ORDER BY variety").all())
      .toEqual([{ market: "Sirsi APMC", variety: "Bette", quantity_tonnes: 0.6 }, { market: "Sirsi APMC", variety: "Rashi", quantity_tonnes: 3 }]);
    expect(count("SELECT COUNT(*) AS n FROM market_arrival_days")).toBe(4);
  });

  it("never lets a 'not reported' page hide a reported day", async () => {
    await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [kramaDoc("2026-11-13")] });
    const before = count("SELECT COUNT(*) AS n FROM market_arrival_days_current");
    const empty = { ...kramaDoc("2026-11-13"), fetched_at: "2026-11-17T07:00:00Z",
      payload: JSON.stringify({ status: "not_reported", date: "2026-11-13", evidence: "Commodities Reported on 13/11/2026" }) };
    expect((await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [empty] })).status).toBe(201);
    expect(count("SELECT COUNT(*) AS n FROM market_arrival_days_current")).toBe(before);
    expect((await get("/admin/arrivals/daily/coverage?source_key=krama_arrivals")).fetched_dates).toEqual(["2026-11-13"]);
  });

  it("refuses the whole request when any document is wrong, and future dates", async () => {
    const wrongParams = { ...kramaDoc("2026-11-12"), request_params: { report: "C", date: "13/11/2026", commodity: "140" } };
    const response = await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [kramaDoc("2026-11-13"), wrongParams] });
    expect(response.status).toBe(422);
    expect(count("SELECT COUNT(*) AS n FROM arrival_daily_documents")).toBe(0);
    expect((await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [kramaDoc("2026-11-18")] })).status).toBe(422);
    expect((await post("/admin/arrivals/daily/import", { source_key: "agmarknet_v2_daily", documents: [kramaDoc("2026-11-13")] })).status).toBe(422);
    const foreign = { ...agmDoc(), request_url: agmDoc().request_url.replace("api.agmarknet.gov.in", "example.com") };
    expect((await post("/admin/arrivals/daily/import", { source_key: "agmarknet_v2_daily", documents: [foreign] })).status).toBe(422);
  });

  it("makes documents, rows and aliases append-only", async () => {
    await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [kramaDoc("2026-11-13")] });
    expect(() => db.sqlite.exec("UPDATE market_arrival_days SET quantity_original = 1")).toThrow(/append-only/);
    expect(() => db.sqlite.exec("DELETE FROM market_arrival_days")).toThrow(/append-only/);
    expect(() => db.sqlite.exec("UPDATE arrival_daily_documents SET payload = 'x'")).toThrow(/immutable/);
    expect(() => db.sqlite.exec("DELETE FROM arrival_market_aliases")).toThrow(/versioned/);
  });

  it("never touches price observations, the reference-index cache, file imports or AGMARKNET 2.0 periods", async () => {
    const tables = ["market_price_observations", "market_daily_summaries", "market_arrivals", "arrival_import_batches", "monthly_variety_prices",
      "ingestion_jobs", "market_arrival_periods"];
    const snapshot = () => tables.map((name) => JSON.stringify(db.sqlite.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()));
    const before = snapshot();
    await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [kramaDoc("2026-11-13")] });
    await post("/admin/arrivals/daily/import", { source_key: "agmarknet_v2_daily", documents: [agmDoc()] });
    expect(snapshot()).toEqual(before);
  });
});

describe("market mapping", () => {
  it("maps KRAMA and AGMARKNET names to one AGMARKNET market and district", async () => {
    await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [kramaDoc("2026-11-13")] });
    await post("/admin/arrivals/daily/import", { source_key: "agmarknet_v2_daily", documents: [agmDoc()] });
    const map = (source: string, name: string) => db.sqlite.prepare("SELECT DISTINCT market, district, mapping_status FROM market_arrival_days_current WHERE source_key=? AND source_market_name=?").get(source, name);
    expect(map("krama_arrivals", "SIRSI")).toEqual({ market: "Sirsi APMC", district: "Uttara Kannada", mapping_status: "verified" });
    expect(map("krama_arrivals", "YELLAPURA")).toEqual({ market: "Yellapur APMC", district: "Uttara Kannada", mapping_status: "verified" });
    expect(map("krama_arrivals", "SHIVAMOGGA")).toEqual({ market: "Shimoga APMC", district: "Shivamogga", mapping_status: "verified" });
    expect(map("agmarknet_v2_daily", "Sirsi APMC")).toEqual({ market: "Sirsi APMC", district: "Uttara Kannada", mapping_status: "verified" });
    expect((await get("/admin/arrivals/daily/coverage?source_key=krama_arrivals")).unmapped_markets).toEqual([]);
  });

  it("adds a corrected mapping as a new version (reviewer token, verified district)", async () => {
    const alias = { source_key: "krama_arrivals", source_market_name: "NEW MARKET", district: "uttara kannada", market: "New APMC", mapping_status: "inferred",
      evidence: "Operator check against the KRAMA market profile." };
    expect((await post("/admin/arrivals/market-aliases", alias)).status).toBe(401);
    expect((await post("/admin/arrivals/market-aliases", { ...alias, district: "Atlantis" }, "review")).status).toBe(400);
    expect(await (await post("/admin/arrivals/market-aliases", alias, "review")).json()).toMatchObject({ district: "Uttara Kannada", version: 1 });
    expect(await (await post("/admin/arrivals/market-aliases", { ...alias, market: "Newer APMC" }, "review")).json()).toMatchObject({ version: 2 });
  });
});

describe("GET /supply/arrivals with daily arrivals", () => {
  const supply = (query: string) => get(`/supply/arrivals?${query}`);
  const oct1 = (rows: string[][]) => kramaDoc("2026-10-01", table(rows));

  it("is unchanged while the flag is off", async () => {
    const before = await supply("granularity=weekly&from=2026-09-28&to=2026-11-17");
    await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [kramaDoc("2026-11-13")] });
    expect(await supply("granularity=weekly&from=2026-09-28&to=2026-11-17")).toEqual(before);
    expect((await app.request("/api/v1/supply/arrivals?source=krama_arrivals", {}, env)).status).toBe(400);
  });

  it("uses KRAMA for every date it reports and AGMARKNET daily only for the other dates", async () => {
    env.DAILY_ARRIVALS_IN_SUPPLY = "true";
    await post("/admin/arrivals/daily/import", { source_key: "agmarknet_v2_daily", documents: [agmDoc()] });
    await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [oct1([["SIRSI", "Rashi", "Average", "65", "Quintal", "44299", "48900", "45477"]])] });
    const daily = await supply("granularity=daily&from=2026-10-01&to=2026-10-02");
    const agmOct2 = parseAgmarknetDatewise(AGM_MONTH, "2026-10-01", "2026-10-31").rows.filter((row) => row.observation_date === "2026-10-02")
      .reduce((sum, row) => sum + row.quantity_tonnes!, 0);
    expect(daily.measures.arrival).toEqual([
      expect.objectContaining({ bucket: "2026-10-01", quantity_tonnes: 6.5, markets_reporting: 1, reporting_days: 1 }),
      expect.objectContaining({ bucket: "2026-10-02", quantity_tonnes: Number(agmOct2.toFixed(3)) }),
    ]);
    expect(daily.sources.map((source: any) => source.source_key).sort()).toEqual(["agmarknet_v2_daily", "krama_arrivals"]);
    expect(daily.markets[0]).toMatchObject({ market: "Sirsi APMC", district: "Uttara Kannada" });
    const onlyKrama = await supply("granularity=daily&from=2026-10-01&to=2026-10-02&source=krama_arrivals");
    expect(onlyKrama.measures.arrival).toHaveLength(1);
    const district = await supply("granularity=monthly&from=2026-10-01&to=2026-10-31&district=Shivamogga");
    expect(district.measures.arrival).toEqual([]);
  });

  it("leaves a month with daily arrivals to the daily rows instead of AGMARKNET's monthly total", async () => {
    env.DAILY_ARRIVALS_IN_SUPPLY = "true";
    env.AGMARKNET_V2_ARRIVALS_IN_SUPPLY = "true";
    const monthly = readFileSync("src/fixtures/agmarknet-v2/monthly-2026-10-uttara-kannada.json", "utf8");
    const params = { report_mode: "Marketwise", commodity: "118", year: "2026", month: "10", state: "16", district: "257" };
    const records = JSON.parse(monthly).rows.map((row: any) => ({ source_commodity_name: "Arecanut(Betelnut/Supari)", state: "Karnataka",
      source_district_name: "Uttara Kannada", source_market_name: row.market, period_type: "month", period_start: "2026-10-01", period_end: "2026-10-31",
      period_week: null, source_period_label: "Arrivals October, 2026 (Metric Tonnes)", source_column_key: "arrivals_october_2026",
      value_status: row.arrivals_october_2026 === null ? "not_reported" : "reported", quantity_original: row.arrivals_october_2026,
      unit_original: "Metric Tonnes", quantity_tonnes: row.arrivals_october_2026 }));
    expect((await post("/admin/agmarknet-v2/arrivals/import", { fetches: [{ endpoint: "wholesale-arrivals-monthly",
      request_url: `https://api.agmarknet.gov.in/v1/price-trend/wholesale-arrivals-monthly?${new URLSearchParams(params)}`, request_params: params,
      http_status: 200, content_type: "application/json", response_body: monthly, fetched_at: "2026-11-17T05:00:00Z", parser_version: "test/1", records }] })).status).toBe(201);
    const withoutDaily = await supply("granularity=monthly&from=2026-10-01&to=2026-10-31");
    expect(withoutDaily.measures.arrival[0]).toMatchObject({ quantity_tonnes: 2506.4 });
    await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [oct1([["SIRSI", "Rashi", "Average", "65", "Quintal", "1", "2", "1"]])] });
    const withDaily = await supply("granularity=monthly&from=2026-10-01&to=2026-10-31");
    expect(withDaily.measures.arrival).toEqual([expect.objectContaining({ bucket: "2026-10", quantity_tonnes: 6.5, markets_reporting: 1 })]);
  });

  it("falls back to the previous response if the new tables are missing (code deployed before its migration)", async () => {
    const before = await supply("granularity=monthly");
    env.DAILY_ARRIVALS_IN_SUPPLY = "true";
    env.AGMARKNET_V2_ARRIVALS_IN_SUPPLY = "true";
    db.sqlite.exec("DROP VIEW market_arrival_days_current; DROP VIEW market_arrival_periods_current");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await app.request("/api/v1/supply/arrivals?granularity=monthly", {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(before);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("does not count a market-day twice when a daily file import covers it", async () => {
    env.DAILY_ARRIVALS_IN_SUPPLY = "true";
    await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [oct1([["SIRSI", "Rashi", "Average", "65", "Quintal", "1", "2", "1"],
      ["KUMTA", "Chali", "Average", "10", "Quintal", "1", "2", "1"]])] });
    expect((await post("/ingest/arrivals", { source_key: "agmarknet", source_name: "AGMARKNET market arrivals report", source_url: "https://agmarknet.gov.in/",
      authorization_note: "Authorized test import for integrity checks.", file_name: "arrivals.csv", content_sha256: "c".repeat(64),
      rows: [{ row_number: 1, measure: "arrival", district: "Uttara Kannada", market: "Sirsi APMC", observation_date: "2026-10-01", quantity: 5, unit: "tonnes" }] })).status).toBe(201);
    const daily = await supply("granularity=daily&from=2026-10-01&to=2026-10-01");
    expect(daily.measures.arrival).toEqual([expect.objectContaining({ quantity_tonnes: 6, markets_reporting: 2 })]);
  });
});

describe("index usage", () => {
  it("imports and the Supply page never scan the daily rows, whatever their number", async () => {
    env.DAILY_ARRIVALS_IN_SUPPLY = "true";
    env.AGMARKNET_V2_ARRIVALS_IN_SUPPLY = "true";
    await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [kramaDoc("2026-11-12"), kramaDoc("2026-11-13")] });
    const statements: string[] = [];
    const prepare = db.prepare.bind(db);
    db.prepare = (sql: string) => { statements.push(sql); return prepare(sql); };
    await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [kramaDoc("2026-11-11"), kramaDoc("2026-11-13", undefined, {}, "2026-11-17T06:00:00Z")] });
    await post("/admin/arrivals/daily/import", { source_key: "agmarknet_v2_daily", documents: [agmDoc()] });
    for (const granularity of ["daily", "weekly", "monthly", "seasonal"]) await get(`/supply/arrivals?granularity=${granularity}`);
    await get("/supply/arrival-days?from=2026-11-13&to=2026-11-13");
    db.prepare = prepare;
    const scans = statements.filter((sql) => /market_arrival_days/.test(sql) && !/^\s*INSERT/i.test(sql)).flatMap((sql) => {
      const args = (sql.match(/\?/g) ?? []).map(() => "x");
      const plan = (db.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[]).map((row) => row.detail);
      return plan.filter((step) => /^SCAN (r|c|market_arrival_days)\b/.test(step)).map((step) => `${step} :: ${sql.replace(/\s+/g, " ").slice(0, 160)}`);
    });
    expect(statements.some((sql) => /FROM market_arrival_days_current\s+WHERE commodity_code/.test(sql))).toBe(true);
    expect(scans).toEqual([]);
  });
});

describe("Supply page windows and ordering", () => {
  it("shows whole periods only when no dates are asked for", () => {
    expect(defaultArrivalWindow("daily", "2026-11-17")).toEqual({ from: "2026-10-18", to: "2026-11-17" });
    expect(defaultArrivalWindow("weekly", "2026-11-17")).toEqual({ from: "2026-05-18", to: "2026-11-15" });     // 26 Monday weeks
    expect(defaultArrivalWindow("weekly", "2026-11-16")).toEqual({ from: "2026-05-18", to: "2026-11-15" });     // a Monday
    expect(defaultArrivalWindow("monthly", "2026-11-17")).toEqual({ from: "2025-11-01", to: "2026-10-31" });    // 12 months
    expect(defaultArrivalWindow("monthly", "2027-01-05")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(defaultArrivalWindow("seasonal", "2026-11-17")).toEqual({ from: "2025-10-01", to: "2026-09-30" });   // 4 seasons
    expect(defaultArrivalWindow("seasonal", "2026-03-01")).toEqual({ from: "2025-03-01", to: "2026-02-28" });
  });

  it("returns seasons in calendar order, not by name", async () => {
    env.DAILY_ARRIVALS_IN_SUPPLY = "true";
    const days = ["2025-10-02", "2026-01-15", "2026-04-15", "2026-07-15"];
    await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: days.map((day) => kramaDoc(day,
      table([["SIRSI", "Rashi", "Average", "10", "Quintal", "1", "2", "1"]]))) });
    const body = await get("/supply/arrivals?granularity=seasonal");
    const order = ["2025-post_monsoon", "2026-winter", "2026-pre_monsoon", "2026-southwest_monsoon"];
    expect(body.measures.arrival.map((row: any) => row.bucket)).toEqual(order);
    expect(arrivalRows(body.measures).map((row) => row.bucket)).toEqual(order);
    expect(body.requested_range).toEqual({ from: "2025-10-01", to: "2026-09-30" });
  });
});

describe("GET /supply/arrival-days", () => {
  it("returns rows as published with provenance, under the same precedence", async () => {
    await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [kramaDoc("2026-11-13")] });
    const body = await get("/supply/arrival-days?from=2026-11-13&to=2026-11-13&market=Sirsi%20APMC");
    expect(body.rows.find((row: any) => row.variety === "Bette")).toMatchObject({ source_market_name: "SIRSI", district: "Uttara Kannada",
      quantity_original: 4, unit_original: "Quintal", quantity_tonnes: 0.4, source_key: "krama_arrivals",
      source_request_url: "https://krama.karnataka.gov.in/reports/CommadityRep" });
    expect((await app.request("/api/v1/supply/arrival-days?from=2026-01-01&to=2026-11-13", {}, env)).status).toBe(400);
  });
});

describe("monthly arrival totals", () => {
  const sirsi = (date: string, quintals: string) => kramaDoc(date, table([["SIRSI", "Bette", "Average", quintals, "Quintal", "100", "200", "150"],
    ["SHIVAMOGGA", "Rashi", "Average", "30", "Quintal", "100", "200", "150"]]));
  const totals = () => db.sqlite.prepare("SELECT scope, market, month, quantity_tonnes, reporting_days, records FROM arrival_month_totals ORDER BY month, scope, market").all();

  it("refreshes the months each import touches, the latest document of a date winning", async () => {
    await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [sirsi("2026-10-30", "40"), sirsi("2026-11-02", "10")] });
    expect(totals()).toEqual([
      { scope: "market", market: "Shimoga APMC", month: "2026-10", quantity_tonnes: 3, reporting_days: 1, records: 1 },
      { scope: "market", market: "Sirsi APMC", month: "2026-10", quantity_tonnes: 4, reporting_days: 1, records: 1 },
      { scope: "state", market: "", month: "2026-10", quantity_tonnes: 7, reporting_days: 1, records: 2 },
      { scope: "market", market: "Shimoga APMC", month: "2026-11", quantity_tonnes: 3, reporting_days: 1, records: 1 },
      { scope: "market", market: "Sirsi APMC", month: "2026-11", quantity_tonnes: 1, reporting_days: 1, records: 1 },
      { scope: "state", market: "", month: "2026-11", quantity_tonnes: 4, reporting_days: 1, records: 2 },
    ]);
    // A later re-read of 2 Nov with a corrected figure replaces that day's contribution, not adds to it.
    await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [{ ...sirsi("2026-11-02", "25"), fetched_at: "2026-11-17T05:30:00Z" }] });
    expect(totals().filter((row: any) => row.month === "2026-11" && row.scope === "state")).toEqual([
      { scope: "state", market: "", month: "2026-11", quantity_tonnes: 5.5, reporting_days: 1, records: 2 }]);
    expect(totals().filter((row: any) => row.month === "2026-10")).toHaveLength(3);
  });

  it("serves the season pattern and recent activity from the stored days", async () => {
    await post("/admin/arrivals/daily/import", { source_key: "krama_arrivals", documents: [sirsi("2026-11-16", "40"), sirsi("2026-11-17", "60")] });
    const recent = await get("/supply/arrivals/recent");
    expect(recent).toMatchObject({ latest_date: "2026-11-17", unit: "quintal", week: { from: "2026-11-11", to: "2026-11-17" },
      state: { latest_quintals: 90, week_quintals: 160, markets_reporting_latest: 2 } });
    expect(recent.markets[0]).toMatchObject({ market: "Sirsi APMC", district: "Uttara Kannada", latest_quintals: 60, week_quintals: 100, week_days: 2,
      usual_quintals: null, days: [{ date: "2026-11-16", quintals: 40 }, { date: "2026-11-17", quintals: 60 }] });
    const season = await get("/supply/arrivals/season?market=Sirsi%20APMC");
    expect(season).toMatchObject({ scope: "market", market: "Sirsi APMC", years_used: [], peak_month: null, like_for_like: null,
      in_progress: { month: "2026-11", quantity_tonnes: 10, reporting_days: 2, days_in_month: 30 } });
  });
});

describe("recentArrivals", () => {
  const day = (market: string, date: string, tonnes: number) => ({ market, district: "D", observation_date: date, tonnes });
  it("compares the latest day with the market's usual reporting day before the week", () => {
    const baseline = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-27"].map((date) => day("A", date, 20));
    const result = recentArrivals([...baseline, day("A", "2026-11-16", 30), day("A", "2026-11-17", 41.2), day("B", "2026-11-15", 50), day("B", "2026-10-01", 99)], "2026-11-17");
    expect(result.markets.map((row) => row.market)).toEqual(["A", "B"]);
    expect(result.markets[0]).toMatchObject({ latest_quintals: 412, last_date: "2026-11-17", week_quintals: 712, week_days: 2, usual_quintals: 200, usual_days: 6 });
    // B reported this week but not on the latest day, and has too few earlier days for a usual level (1 Oct is outside the window).
    expect(result.markets[1]).toMatchObject({ latest_quintals: null, last_date: "2026-11-15", last_quintals: 500, usual_quintals: null, usual_days: 0 });
    expect(result.state).toEqual({ latest_quintals: 412, week_quintals: 1212, previous_week_quintals: 0, markets_reporting_latest: 1 });
  });
});

describe("seasonPattern", () => {
  const monthsOf = (year: number, last = 12) => Array.from({ length: last }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
  // A peak in March, a trough in August, years growing in size (more markets reporting) without changing the shape.
  const shape = [10, 12, 16, 14, 9, 6, 5, 4, 6, 8, 9, 11];
  const full = (year: number, scale: number): MonthTotal[] => monthsOf(year).map((month, index) => ({ month, quantity_tonnes: shape[index] * scale, reporting_days: 28 }));

  it("uses only complete past years, as shares of each year, and compares this year like for like", () => {
    const partialYear = monthsOf(2020).map((month, index) => ({ month, quantity_tonnes: 999, reporting_days: index === 5 ? 10 : 28 }));
    const current = [...monthsOf(2026, 10).map((month, index) => ({ month, quantity_tonnes: shape[index] * 3000, reporting_days: 30 })),
      { month: "2026-11", quantity_tonnes: 7000, reporting_days: 24 }];
    const rows = [...partialYear, ...full(2021, 1000), ...full(2022, 1200), ...full(2023, 900), ...full(2024, 2000), ...full(2025, 2400), ...current];
    // Last year one market reported; this year a second joined. Only the first counts in the comparison.
    const markets = [...full(2025, 2400).map((row) => ({ market: "A", ...row })), ...current.slice(0, 10).map((row) => ({ market: "A", month: row.month, quantity_tonnes: row.quantity_tonnes! / 2 })),
      ...current.slice(0, 10).map((row) => ({ market: "B", month: row.month, quantity_tonnes: row.quantity_tonnes! / 2 }))];
    const result = seasonPattern(rows, rows, "2026-11-24", markets);
    expect(result.years_used).toEqual([2021, 2022, 2023, 2024, 2025]);
    // Every year has the same shape, so March is 16 of 110 parts in every year.
    expect(result.share[2]).toEqual({ month: 3, median: 14.5, low: 14.5, high: 14.5 });
    expect(result.peak_month).toBe(3);
    expect(result.quiet_month).toBe(8);
    expect(result.previous_share?.year).toBe(2025);
    expect(result.like_for_like).toEqual({ year: 2026, previous_year: 2025, through_month: 10, current_tonnes: 135000, previous_tonnes: 216000,
      change_percent: -37.5, markets: 1 });
    // November 2026 is still in progress on 24 Nov (even with 80% of its days in), so it is not counted as a finished month.
    expect(result.in_progress).toEqual({ month: "2026-11", quantity_tonnes: 7000, reporting_days: 24, days_in_month: 30 });
  });

  it("keeps one odd year out of the range", () => {
    const rows = [...full(2021, 1000), ...full(2022, 1000), ...full(2023, 1000), ...full(2024, 1000),
      ...full(2025, 1000).map((row) => row.month === "2025-10" ? { ...row, quantity_tonnes: 200000 } : row), { month: "2026-01", quantity_tonnes: 1, reporting_days: 5 }];
    const october = seasonPattern(rows, rows, "2026-01-05").share[9];
    expect(october.median).toBe(7.3);
    expect(october.high).toBe(7.3);
  });
});

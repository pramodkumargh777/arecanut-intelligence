import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations, LocalDatabase } from "./test-support/local-d1";
import { app, type Env } from "./index";
import { agmarknetWeek, expectedPeriod, fetchProblems } from "./agmarknet-v2-arrivals";
import { mergeBuckets } from "./supply-routes";

// Responses captured from api.agmarknet.gov.in on 2026-11-17; everything else is synthetic and lives only in memory.
const MONTHLY = readFileSync("src/fixtures/agmarknet-v2/monthly-2026-10-uttara-kannada.json", "utf8");
const WEEKLY = readFileSync("src/fixtures/agmarknet-v2/weekly-2026-11-w2-uttara-kannada.json", "utf8");
const BASE = "https://api.agmarknet.gov.in/v1/price-trend/";

let db: LocalDatabase;
let env: Env["Bindings"];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T06:00:00Z"));
  db = applyMigrations(new LocalDatabase());
  env = { DB: db as unknown as D1Database, INGESTION_TOKEN: "import", ADMIN_TOKEN: "review" };
});
afterEach(() => { db.sqlite.close(); vi.useRealTimers(); });

const auth = { Authorization: ["Bearer", "import"].join(" ") };
const post = (path: string, body: unknown) => app.request(`/api/v1${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify(body) }, env);
const get = async <T = any>(path: string) => (await app.request(`/api/v1${path}`, { headers: auth }, env)).json() as Promise<T>;

type Params = { year: number; month: number; week?: number; district: number; districtName: string };
/** Builds the payload the Python connector sends for one response body. */
function fetchPayload(body: string, p: Params, edit?: (records: any[]) => void) {
  const endpoint = p.week ? "wholesale-arrivals-weekly" : "wholesale-arrivals-monthly";
  const params: Record<string, string> = { report_mode: "Marketwise", commodity: "118", year: String(p.year), month: String(p.month),
    ...(p.week ? { week: String(p.week) } : {}), state: "16", district: String(p.district) };
  const period = expectedPeriod(endpoint, p.year, p.month, p.week ?? null);
  const parsed = JSON.parse(body);
  const column = parsed.data.flatMap((group: any) => group.columns).find((item: any) => item.key === period.column_key);
  const records = parsed.rows.map((row: any) => {
    const value = row[period.column_key];
    return { source_commodity_name: "Arecanut(Betelnut/Supari)", state: "Karnataka", source_district_name: p.districtName,
      source_market_name: row.market, period_type: period.period_type, period_start: period.start, period_end: period.end,
      period_week: period.period_week, source_period_label: column.title, source_column_key: period.column_key,
      value_status: value === null ? "not_reported" : "reported", quantity_original: value, unit_original: "Metric Tonnes", quantity_tonnes: value };
  });
  edit?.(records);
  return { endpoint, request_url: `${BASE}${endpoint}?${new URLSearchParams(params)}`, request_params: params, http_status: 200,
    content_type: "application/json", response_body: body, fetched_at: "2026-11-17T05:00:00Z", parser_version: "test/1", records };
}
const OCT = { year: 2026, month: 10, district: 257, districtName: "Uttara Kannada" };
const NOV_W2 = { year: 2026, month: 11, week: 2, district: 257, districtName: "Uttara Kannada" };
const count = (table: string) => Number(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);
const snapshot = (table: string) => JSON.stringify(db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());

describe("AGMARKNET 2.0 periods", () => {
  it("keeps every migration's LIKE/GLOB pattern within D1's 50-byte limit", () => {
    for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql"))) {
      const sql = readFileSync(`migrations/${file}`, "utf8").replace(/--.*$/gm, "");
      for (const match of sql.matchAll(/\b(?:LIKE|GLOB)\s+'((?:[^']|'')*)'/gi)) {
        expect(Buffer.byteLength(match[1]), `${file}: ${match[1]}`).toBeLessThanOrEqual(50);
      }
    }
  });
  it("uses month-relative weeks that tile the month", () => {
    expect(agmarknetWeek(2026, 10, 1)).toEqual({ start: "2026-10-01", end: "2026-10-08" });
    expect(agmarknetWeek(2026, 10, 4)).toEqual({ start: "2026-10-24", end: "2026-10-31" });
    expect(agmarknetWeek(2026, 9, 4)).toEqual({ start: "2026-09-24", end: "2026-09-30" });
    expect(agmarknetWeek(2028, 2, 4)).toEqual({ start: "2028-02-24", end: "2028-02-29" });
    expect(() => agmarknetWeek(2026, 10, 5)).toThrow();
  });
  it("derives the source's column keys and titles", () => {
    expect(expectedPeriod("wholesale-arrivals-monthly", 2026, 10, null)).toMatchObject({ column_key: "arrivals_october_2026", label_prefix: "Arrivals October, 2026 (" });
    expect(expectedPeriod("wholesale-arrivals-weekly", 2026, 11, 2)).toMatchObject({ column_key: "arrivals_9_15_nov_2026", label_prefix: "Arrivals 9-15 Nov 2026 (" });
  });
});

describe("POST /admin/agmarknet-v2/arrivals/import", () => {
  it("requires the ingestion token", async () => {
    const response = await app.request("/api/v1/admin/agmarknet-v2/arrivals/import", { method: "POST", body: "{}" }, env);
    expect(response.status).toBe(401);
  });

  it("stores the response verbatim with every market, and replays as duplicates", async () => {
    const first = await post("/admin/agmarknet-v2/arrivals/import", { fetches: [fetchPayload(MONTHLY, OCT)] });
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ new_fetches: 1, received_records: 6, inserted: 6, revised: 0, duplicates: 0 });
    const evidence = db.sqlite.prepare("SELECT response_body, response_sha256, endpoint FROM agmarknet_v2_fetches").get() as any;
    expect(evidence.response_body).toBe(MONTHLY);
    expect(evidence.response_sha256).toMatch(/^[0-9a-f]{64}$/);
    const sirsi = db.sqlite.prepare("SELECT * FROM market_arrival_periods_current WHERE market='Sirsi APMC'").get() as any;
    expect(sirsi).toMatchObject({ period_type: "month", period_start: "2026-10-01", period_end: "2026-10-31", quantity_original: 1175.3,
      quantity_tonnes: 1175.3, unit_original: "Metric Tonnes", value_status: "reported", version_number: 1, era: "agmarknet_2", district: "Uttara Kannada" });
    const again = await post("/admin/agmarknet-v2/arrivals/import", { fetches: [fetchPayload(MONTHLY, OCT)] });
    expect(await again.json()).toMatchObject({ new_fetches: 0, inserted: 0, duplicates: 6 });
    expect(count("market_arrival_periods")).toBe(6);
    expect(count("agmarknet_v2_fetches")).toBe(1);
  });

  it("keeps not-reported markets as not reported, never as zero", async () => {
    const body = WEEKLY.replace('"arrivals_9_15_nov_2026":0.2', '"arrivals_9_15_nov_2026":null');
    expect(body).not.toBe(WEEKLY);
    expect((await post("/admin/agmarknet-v2/arrivals/import", { fetches: [fetchPayload(body, NOV_W2)] })).status).toBe(201);
    expect(db.sqlite.prepare("SELECT value_status, quantity_original, quantity_tonnes, unit_status FROM market_arrival_periods WHERE source_market_name='Haliyala APMC'").get())
      .toEqual({ value_status: "not_reported", quantity_original: null, quantity_tonnes: null, unit_status: "not_applicable" });
    // A record claiming zero for a market the source left blank is refused.
    const zero = fetchPayload(body, NOV_W2, (records) => Object.assign(records.find((r) => r.source_market_name === "Haliyala APMC"),
      { value_status: "reported", quantity_original: 0, quantity_tonnes: 0 }));
    expect(fetchProblems(zero as any, "2026-11-17").join(" ")).toContain("Haliyala APMC: the source reports no value");
  });

  it("stores a changed source value as a new version and keeps the old one", async () => {
    await post("/admin/agmarknet-v2/arrivals/import", { fetches: [fetchPayload(MONTHLY, OCT)] });
    const revisedBody = MONTHLY.replace('"arrivals_october_2026":1175.3', '"arrivals_october_2026":1180.0');
    expect(revisedBody).not.toBe(MONTHLY);
    const result = await post("/admin/agmarknet-v2/arrivals/import", { fetches: [fetchPayload(revisedBody, OCT)] });
    expect(await result.json()).toMatchObject({ new_fetches: 1, inserted: 0, revised: 1, duplicates: 5 });
    const versions = db.sqlite.prepare("SELECT version_number, quantity_original FROM market_arrival_periods WHERE source_market_name='Sirsi APMC' ORDER BY version_number").all();
    expect(versions).toEqual([{ version_number: 1, quantity_original: 1175.3 }, { version_number: 2, quantity_original: 1180 }]);
    expect(db.sqlite.prepare("SELECT quantity_original FROM market_arrival_periods_current WHERE market='Sirsi APMC'").get()).toEqual({ quantity_original: 1180 });
  });

  it("rejects the whole request when a record disagrees with the stored response", async () => {
    const bad = fetchPayload(MONTHLY, OCT, (records) => { records.find((r) => r.source_market_name === "Sirsi APMC").quantity_original = 9999; });
    const response = await post("/admin/agmarknet-v2/arrivals/import", { fetches: [fetchPayload(WEEKLY, NOV_W2), bad] });
    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).toContain("Sirsi APMC: quantity does not match");
    expect(count("market_arrival_periods") + count("agmarknet_v2_fetches")).toBe(0);
  });

  it("rejects dropped markets, foreign hosts, mismatched parameters and periods that have not closed", async () => {
    const dropped = fetchPayload(MONTHLY, OCT, (records) => records.pop());
    const host = { ...fetchPayload(MONTHLY, OCT), request_url: fetchPayload(MONTHLY, OCT).request_url.replace("api.agmarknet.gov.in", "example.com") };
    const wrongDistrict = { ...fetchPayload(MONTHLY, OCT), request_url: fetchPayload(MONTHLY, OCT).request_url.replace("district=257", "district=266") };
    for (const fetch of [dropped, host, wrongDistrict]) {
      expect((await post("/admin/agmarknet-v2/arrivals/import", { fetches: [fetch] })).status).toBe(422);
    }
    vi.setSystemTime(new Date("2026-10-20T06:00:00Z"));
    const open = await post("/admin/agmarknet-v2/arrivals/import", { fetches: [fetchPayload(MONTHLY, OCT)] });
    expect(open.status).toBe(422);
    expect(JSON.stringify(await open.json())).toContain("has not closed");
    expect(count("market_arrival_periods")).toBe(0);
  });

  it("checks the unit in the column title", () => {
    const body = MONTHLY.replace("Arrivals October, 2026 (Metric Tonnes)", "Arrivals October, 2026 (Quintal)");
    const payload = fetchPayload(body, OCT) as any;
    expect(fetchProblems(payload, "2026-11-17").join(" ")).toContain('Unit "Quintal"');
  });

  it("refuses a report for another period, including its comparison columns", () => {
    // October's report also carries September as its previous-month column; it must not be stored as September.
    const asSeptember = fetchPayload(MONTHLY, { ...OCT, month: 9 }, (records) => records.forEach((record) => {
      Object.assign(record, { period_start: "2026-09-01", period_end: "2026-09-30", source_column_key: "arrivals_september_2026",
        source_period_label: "Arrivals September, 2026 (Metric Tonnes)" });
    })) as any;
    expect(fetchProblems(asSeptember, "2026-11-17").join(" ")).toContain("Report title is not for September, 2026");
    const retitled = fetchPayload(MONTHLY.replace("– October, 2026", "– September, 2026"), { ...OCT, month: 9 }) as any;
    expect(fetchProblems(retitled, "2026-11-17").join(" ")).toContain("current column is not arrivals_september_2026");
  });

  it("can be switched off", async () => {
    env.AGMARKNET_V2_ARRIVALS_IMPORT_ENABLED = "false";
    expect((await post("/admin/agmarknet-v2/arrivals/import", { fetches: [fetchPayload(MONTHLY, OCT)] })).status).toBe(503);
  });

  it("makes fetch evidence, periods and aliases append-only", async () => {
    await post("/admin/agmarknet-v2/arrivals/import", { fetches: [fetchPayload(MONTHLY, OCT)] });
    expect(() => db.sqlite.exec("UPDATE market_arrival_periods SET quantity_original = 1")).toThrow(/append-only/);
    expect(() => db.sqlite.exec("DELETE FROM market_arrival_periods")).toThrow(/append-only/);
    expect(() => db.sqlite.exec("UPDATE agmarknet_v2_fetches SET response_body = 'x'")).toThrow(/immutable/);
    expect(() => db.sqlite.exec("DELETE FROM agmarknet_v2_fetches")).toThrow(/immutable/);
    expect(() => db.sqlite.exec("DELETE FROM agmarknet_v2_market_aliases")).toThrow(/versioned/);
  });

  it("maps renamed source markets to the current AGMARKNET name", async () => {
    const body = JSON.stringify({ success: true, title: "Market-wise Wholesale Arrivals Monthly Analysis for Arecanut(Betelnut/Supari) in Shivamogga, Karnataka – January, 2020",
      data: [{ key: "arrivals", columns: [{ key: "arrivals_january_2020", title: "Arrivals January, 2020 (Metric Tonnes)" }] }],
      rows: [{ market: "Hosanagar APMC", arrivals_january_2020: 795.0 }, { market: "Shimogga(Theertahalli) APMC", arrivals_january_2020: 400.0 }] });
    const response = await post("/admin/agmarknet-v2/arrivals/import", { fetches: [fetchPayload(body, { year: 2020, month: 1, district: 266, districtName: "Shivamogga" })] });
    expect(response.status).toBe(201);
    const rows = db.sqlite.prepare("SELECT source_market_name, market, mapping_status, era FROM market_arrival_periods_current ORDER BY market").all();
    expect(rows).toEqual([
      { source_market_name: "Shimogga(Theertahalli) APMC", market: "APMC THIRTHAHALLI", mapping_status: "alias_verified", era: "agmarknet_1_legacy" },
      { source_market_name: "Hosanagar APMC", market: "Hosanagara APMC", mapping_status: "alias_verified", era: "agmarknet_1_legacy" },
    ]);
  });

  it("never touches price observations, the reference-index cache or daily arrival imports", async () => {
    const tables = ["market_price_observations", "market_daily_summaries", "market_arrivals", "arrival_import_batches", "monthly_variety_prices", "ingestion_jobs"];
    const before = tables.map(snapshot);
    await post("/admin/agmarknet-v2/arrivals/import", { fetches: [fetchPayload(MONTHLY, OCT), fetchPayload(WEEKLY, NOV_W2)] });
    expect(tables.map(snapshot)).toEqual(before);
  });

  it("reports coverage and records runs under its own source", async () => {
    await post("/admin/agmarknet-v2/arrivals/import", { fetches: [fetchPayload(MONTHLY, OCT), fetchPayload(WEEKLY, NOV_W2)] });
    const coverage = await get("/admin/agmarknet-v2/arrivals/coverage");
    expect(coverage.fetched).toEqual(expect.arrayContaining([
      expect.objectContaining({ endpoint: "wholesale-arrivals-monthly", district: "257", year: "2026", month: "10", week: null }),
      expect.objectContaining({ endpoint: "wholesale-arrivals-weekly", district: "257", year: "2026", month: "11", week: "2" }),
    ]));
    const run = await post("/admin/agmarknet-v2/arrivals/runs", { mode: "daily", status: "completed", started_at: "2026-11-17T05:00:00Z",
      completed_at: "2026-11-17T05:01:00Z", fetched_count: 2, accepted_count: 12, rejected_count: 0, inserted_count: 12, duplicate_count: 0,
      corrected_count: 0, market_count: 6, reporting_dates: ["2026-10-01", "2026-11-09"], error_message: null });
    expect(run.status).toBe(201);
    expect(db.sqlite.prepare("SELECT source_id, resource_id FROM source_ingestion_runs").get())
      .toEqual({ source_id: "source-agmarknet-v2-arrivals", resource_id: "v1/price-trend/wholesale-arrivals" });
  });
});

describe("GET /supply/arrivals with AGMARKNET 2.0", () => {
  const supply = (query: string) => get(`/supply/arrivals?${query}`);

  it("is unchanged while the flag is off", async () => {
    const before = await supply("granularity=monthly");
    await post("/admin/agmarknet-v2/arrivals/import", { fetches: [fetchPayload(MONTHLY, OCT)] });
    expect(await supply("granularity=monthly")).toEqual(before);
    expect((await app.request("/api/v1/supply/arrivals?source=agmarknet_v2_arrivals", {}, env)).status).toBe(400);
  });

  it("adds closed-month totals in monthly and seasonal views when the flag is on", async () => {
    env.AGMARKNET_V2_ARRIVALS_IN_SUPPLY = "true";
    await post("/admin/agmarknet-v2/arrivals/import", { fetches: [fetchPayload(MONTHLY, OCT), fetchPayload(WEEKLY, NOV_W2)] });
    const monthly = await supply("granularity=monthly");
    expect(monthly.measures.arrival).toEqual([expect.objectContaining({ bucket: "2026-10", quantity_tonnes: 2506.4, markets_reporting: 6,
      first_date: "2026-10-01", last_date: "2026-10-31", unknown_unit_records: 0 })]);
    expect(monthly.measures.traded).toEqual([]);
    expect(monthly.sources).toEqual([expect.objectContaining({ source_key: "agmarknet_v2_arrivals", source_name: "AGMARKNET monthly arrivals report" })]);
    expect(monthly.markets[0]).toMatchObject({ market: "Sirsi APMC", quantity_tonnes: 1175.3 });
    expect(monthly.reporting_period).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthly.message).toBeNull();
    // The default seasonal window holds completed seasons only, so the running post-monsoon season needs explicit dates.
    expect((await supply("granularity=seasonal")).measures.arrival).toEqual([]);
    const seasonal = await supply("granularity=seasonal&from=2026-10-01&to=2026-11-16");
    expect(seasonal.measures.arrival).toEqual([expect.objectContaining({ bucket: "2026-post_monsoon", quantity_tonnes: 2506.4 })]);
    // AGMARKNET weeks are not Monday weeks: weekly and daily views get no rows, but keep the source so the section stays.
    const weekly = await supply("granularity=weekly");
    expect(weekly.measures.arrival).toEqual([]);
    expect(weekly.sources).toHaveLength(1);
    const filtered = await supply("granularity=monthly&market=Kumta%20APMC");
    expect(filtered.measures.arrival[0]).toMatchObject({ quantity_tonnes: 427.3, markets_reporting: 1 });
    expect((await supply("granularity=monthly&source=enam")).measures.arrival).toEqual([]);
  });

  it("does not count a market-month twice when daily file imports cover it", async () => {
    env.AGMARKNET_V2_ARRIVALS_IN_SUPPLY = "true";
    await post("/admin/agmarknet-v2/arrivals/import", { fetches: [fetchPayload(MONTHLY, OCT)] });
    const file = await post("/ingest/arrivals", { source_key: "agmarknet", source_name: "AGMARKNET market arrivals report", source_url: "https://agmarknet.gov.in/",
      authorization_note: "Authorized test import for integrity checks.", file_name: "arrivals.csv", content_sha256: "a".repeat(64),
      rows: [{ row_number: 1, measure: "arrival", district: "Uttara Kannada", market: "Sirsi APMC", observation_date: "2026-10-05", quantity: 100, unit: "tonnes" }] });
    expect(file.status).toBe(201);
    const monthly = await supply("granularity=monthly");
    expect(monthly.measures.arrival).toEqual([expect.objectContaining({ bucket: "2026-10", quantity_tonnes: Number((2506.4 - 1175.3 + 100).toFixed(3)), markets_reporting: 6 })]);
    expect(monthly.sources.map((source: any) => source.source_key).sort()).toEqual(["agmarknet", "agmarknet_v2_arrivals"]);
  });

  it("merges buckets without mixing measures", () => {
    const merged = mergeBuckets(
      [{ measure: "traded", bucket: "2026-10", first_date: "2026-10-02", last_date: "2026-10-03", quantity_tonnes: 5, records: 1, markets_reporting: 1 }],
      [{ measure: "arrival", bucket: "2026-10", first_date: "2026-10-01", last_date: "2026-10-31", quantity_tonnes: 10, records: 2, markets_reporting: 2 }]);
    expect(merged.map((row) => [row.measure, row.quantity_tonnes])).toEqual([["arrival", 10], ["traded", 5]]);
  });
});

describe("GET /supply/arrival-periods", () => {
  it("returns AGMARKNET weeks as published, with provenance and era", async () => {
    await post("/admin/agmarknet-v2/arrivals/import", { fetches: [fetchPayload(MONTHLY, OCT), fetchPayload(WEEKLY, NOV_W2)] });
    const weekly = await get("/supply/arrival-periods?period_type=agm_week&from=2026-11-01&to=2026-11-30");
    expect(weekly.periods.length).toBe(6);
    expect(weekly.periods.find((row: any) => row.market === "Sirsi APMC")).toMatchObject({ period_start: "2026-11-09", period_end: "2026-11-15",
      period_week: 2, quantity_tonnes: 79, era: "agmarknet_2", source_request_url: expect.stringContaining("week=2") });
    const monthly = await get("/supply/arrival-periods?period_type=month&from=2026-01-01&to=2026-10-31&district=Uttara%20Kannada");
    expect(monthly.periods).toHaveLength(6);
    expect((await app.request("/api/v1/supply/arrival-periods?period_type=day", {}, env)).status).toBe(400);
  });
});

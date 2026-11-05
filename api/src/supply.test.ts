import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations, LocalDatabase } from "./test-support/local-d1";
import { app, type Env } from "./index";
import {
  bucketSql, collapseVintages, currentSeries, districtKey, evaluateRule, forecastEligibility, freshness, growthSeries, imdSeason, istDate,
  parseReportingYear, preferredDays, publishedRules, revisionHistory, seasonalSummary, toTonnes, weekStart,
  type EstimateRow, type RuleRow, type WeatherDay,
} from "./supply";
import { parseArchive } from "./supply-routes";
import { parseWeather } from "./intelligence-sources";

// Synthetic values below exist only in this isolated in-memory database; they never reach production history.
let db: LocalDatabase;
let env: Env["Bindings"];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T06:00:00Z"));
  db = applyMigrations(new LocalDatabase());
  env = { DB: db as unknown as D1Database, INGESTION_TOKEN: "import", ADMIN_TOKEN: "review" };
});
afterEach(() => { db.sqlite.close(); vi.useRealTimers(); });

const SHA = (c: string) => c.repeat(64);
const authHeader = (token: string) => ({ Authorization: ["Bearer", token].join(" ") });
const post = (path: string, body: unknown, token?: string) => app.request(`/api/v1${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(token ? authHeader(token) : {}) }, body: JSON.stringify(body),
}, env);
const get = async <T = any>(path: string) => (await app.request(`/api/v1${path}`, {}, env)).json() as Promise<T>;

function seedDasd(id: string, fetchedAt: string, publication: string | null, rows: [string, string, string, number | null][]) {
  db.sqlite.prepare(`INSERT INTO intelligence_captures(id,source_key,domain,source_url,fetched_at,publication_period,media_type,raw_payload,content_hash,row_count)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, "dasd_latest", "production", "https://dasd.gov.in/example", fetchedAt, publication, "text/html", "<table/>", id.padEnd(64, "0"), rows.length);
  for (const [geography, period, status, production] of rows) {
    db.sqlite.prepare("INSERT INTO production_records VALUES(?,?,?,?,?,?,?)").run(id, geography, period, status, 100, production, production === null ? null : 1000);
  }
}

const estimate = (overrides: Partial<EstimateRow>): EstimateRow => ({
  evidence_id: "x", source_key: "dasd", publisher: "DASD", source_url: "https://dasd.gov.in", commodity_code: "arecanut", reporting_year: "2023-24",
  geography_level: "state", state: "Karnataka", district: null, geography: "Karnataka", estimate_type: "unspecified", estimate_label: "",
  area_thousand_hectares: 100, production_thousand_tonnes: 500, yield_kg_hectare: 5000, publication_date: null, publication_precision: null,
  recorded_at: "2026-01-01T00:00:00Z", content_sha256: "a", ...overrides,
});

describe("date alignment", () => {
  it("uses the IST calendar date around midnight", () => {
    expect(istDate(new Date("2026-11-04T18:29:59Z"))).toBe("2026-11-04");
    expect(istDate(new Date("2026-11-04T18:30:00Z"))).toBe("2026-11-05");
  });
  it("validates agricultural reporting years", () => {
    expect(parseReportingYear("2024-25")).toBe(2024);
    expect(parseReportingYear("1999-00")).toBe(1999);
    expect(parseReportingYear("2024-26")).toBeNull();
    expect(parseReportingYear("2024")).toBeNull();
  });
  it("buckets weeks from Monday and seasons by IMD definitions in JS and SQL alike", () => {
    expect(weekStart("2026-11-05")).toBe("2026-11-02");
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
    expect(imdSeason("2026-02-28")).toMatchObject({ season: "winter", start: "2026-01-01", end: "2026-02-28" });
    expect(imdSeason("2024-02-10").end).toBe("2024-02-29");
    expect(imdSeason("2026-07-15")).toMatchObject({ season: "southwest_monsoon", start: "2026-06-01", end: "2026-09-30" });
    expect(imdSeason("2026-12-31")).toMatchObject({ season: "post_monsoon", end: "2026-12-31" });
    for (const day of ["2026-11-01", "2026-11-05", "2024-02-29", "2026-01-01"]) {
      const row = db.sqlite.prepare(`SELECT ${bucketSql("weekly", "?1")} AS week, ${bucketSql("seasonal", "?1")} AS season`).get(day) as { week: string; season: string };
      expect(row.week).toBe(weekStart(day));
      expect(row.season).toBe(imdSeason(day).key);
    }
  });
});

describe("revised government statistics", () => {
  it("collapses repeated identical captures and selects the most mature estimate", () => {
    const rows = [
      estimate({ estimate_type: "unspecified", recorded_at: "2026-01-01T00:00:00Z", production_thousand_tonnes: 900 }),
      estimate({ estimate_type: "unspecified", recorded_at: "2026-02-01T00:00:00Z", production_thousand_tonnes: 900 }),
      estimate({ estimate_type: "second_advance", recorded_at: "2026-03-01T00:00:00Z", production_thousand_tonnes: 950, publication_date: "2026-03" }),
      estimate({ estimate_type: "final", recorded_at: "2026-05-01T00:00:00Z", production_thousand_tonnes: 970, publication_date: "2026-05" }),
    ];
    const vintages = collapseVintages(rows);
    expect(vintages).toHaveLength(3);
    expect(vintages[0]).toMatchObject({ captures: 2, first_recorded_at: "2026-01-01T00:00:00Z" });
    const [current] = currentSeries(vintages);
    expect(current).toMatchObject({ estimate_type: "final", production_thousand_tonnes: 970, vintages: 3, revised: true });
    const revisions = revisionHistory(vintages);
    expect(revisions.map((row) => row.change_production_thousand_tonnes)).toEqual([null, 50, 20]);
  });
  it("computes growth only between consecutive years and flags mixed estimate stages", () => {
    const growth = growthSeries([
      { reporting_year: "2021-22", value: 100, estimate_type: "final" },
      { reporting_year: "2022-23", value: 110, estimate_type: "final" },
      { reporting_year: "2024-25", value: 121, estimate_type: "second_advance" },
    ]);
    expect(growth.yoy[0]).toMatchObject({ percent: 10, mixed_estimate_types: false });
    expect(growth.yoy[1]).toMatchObject({ percent: null, reason: "Reporting years are not consecutive." });
    expect(growth.cagr).toMatchObject({ years: 3, mixed_estimate_types: true });
    expect(growth.cagr!.percent).toBeCloseTo(6.56, 1);
    expect(growthSeries([{ reporting_year: "2021-22", value: 0, estimate_type: "final" }, { reporting_year: "2022-23", value: 5, estimate_type: "final" }]).yoy[0].percent).toBeNull();
  });
  it("serves Karnataka by default with India-wide comparison, revisions, sources and forecast suppression", async () => {
    seedDasd("cap-1", "2026-01-10T00:00:00Z", null, [["Karnataka", "2023-24", "", 900], ["All India", "2023-24", "", 1400], ["Karnataka", "2024-25", "", 950]]);
    seedDasd("cap-2", "2026-02-10T00:00:00Z", null, [["Karnataka", "2023-24", "", 900], ["All India", "2023-24", "", 1400], ["Karnataka", "2024-25", "", 950]]);
    seedDasd("cap-3", "2026-06-10T00:00:00Z", "2026-05", [["Karnataka", "2024-25", "Final", 960], ["All India", "2024-25", "Final", 1500]]);
    const body = await get("/supply/production");
    expect(body.geography).toBe("Karnataka");
    expect(body.comparison_geography).toBe("All India");
    expect(body.geographies).toEqual(["All India", "Karnataka"]);
    expect(body.current.map((row: any) => [row.reporting_year, row.estimate_type, row.production_thousand_tonnes]))
      .toEqual([["2023-24", "unspecified", 900], ["2024-25", "final", 960]]);
    expect(body.current[0].vintages).toBe(1);
    expect(body.revisions).toHaveLength(1);
    expect(body.revisions[0]).toMatchObject({ reporting_year: "2024-25", previous_estimate_type: "unspecified", change_production_thousand_tonnes: 10 });
    expect(body.share_of_comparison[1]).toMatchObject({ reporting_year: "2024-25", percent: 64 });
    expect(body.reporting_period).toEqual({ from: "2023-24", to: "2024-25", kind: "agricultural_year" });
    expect(body.sources[0].source_url).toBe("https://dasd.gov.in/example");
    expect(body.forecast.status).toBe("suppressed");
    expect(body.districts.message).toMatch(/never apportions/);
  });
});

describe("missing datasets", () => {
  it("returns explicit empty states rather than fabricated values", async () => {
    const production = await get("/supply/production");
    expect(production.geographies).toEqual([]);
    const districts = await get("/supply/production/districts?state=Karnataka");
    expect(districts.districts).toEqual([]);
    expect(districts.message).toMatch(/never apportioned/);
    const arrivals = await get("/supply/arrivals");
    expect(arrivals.measures).toEqual({ arrival: [], traded: [] });
    expect(arrivals.reporting_period).toBeNull();
    expect(arrivals.forecast).toMatchObject({ status: "suppressed", points: 0 });
    const weather = await get("/supply/weather?district=Hassan");
    expect(weather.history).toEqual([]);
    expect(weather.message).toMatch(/No weather records exist for Hassan/);
    const advisories = await get("/supply/risk/advisories");
    expect(advisories.advisories).toEqual([]);
    expect(advisories.message).toMatch(/No crop-risk rule has been approved/);
  });
  it("suppresses forecasts below the minimum history", () => {
    expect(forecastEligibility("production", 5).status).toBe("suppressed");
    expect(forecastEligibility("production", 15).status).toBe("eligible_for_evaluation");
    expect(forecastEligibility("arrivals", 103).status).toBe("suppressed");
  });
});

describe("geographical mappings", () => {
  it("normalizes verified aliases and rejects unknown districts", async () => {
    expect(districtKey("  Shimoga District ")).toBe("shimoga");
    const doc = {
      source_key: "horticulture_dept", publisher: "Department of Horticulture, Karnataka", title: "District-wise arecanut area and production",
      source_url: "https://horticulturedir.karnataka.gov.in/example.pdf", publication_date: "2026-03-01", publication_precision: "day", content_sha256: SHA("b"),
      records: [
        { reporting_year: "2023-24", geography_level: "district", state: "Karnataka", district: "Shimoga", estimate_type: "final", estimate_label: "Final", production_thousand_tonnes: 120, source_row_reference: "Table 2 row 5" },
        { reporting_year: "2023-24", geography_level: "district", state: "Karnataka", district: "Atlantis", estimate_type: "final", estimate_label: "Final", production_thousand_tonnes: 1, source_row_reference: "Table 2 row 6" },
      ],
    };
    expect((await post("/admin/supply/production/documents", doc)).status).toBe(401);
    const rejected = await post("/admin/supply/production/documents", doc, "review");
    expect(rejected.status).toBe(422);
    expect(JSON.stringify(await rejected.json())).toMatch(/Atlantis/);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM production_estimate_documents").get()).toEqual({ n: 0 });
    const ok = await post("/admin/supply/production/documents", { ...doc, records: [doc.records[0]] }, "review");
    expect(ok.status).toBe(201);
    expect(((await (await post("/admin/supply/production/documents", { ...doc, records: [doc.records[0]] }, "review")).json()) as any).status).toBe("already_imported");
    const districts = await get("/supply/production/districts?state=Karnataka");
    expect(districts.districts.map((row: any) => row.district)).toEqual(["Shivamogga"]);
    expect(districts.sources[0].publication_date).toBe("2026-03-01");
    expect(() => db.sqlite.prepare("DELETE FROM production_estimate_records").run()).toThrow(/append-only/);
  });
  it("only returns district rows that originate from district-level source records", async () => {
    seedDasd("cap-1", "2026-01-10T00:00:00Z", null, [["Karnataka", "2023-24", "", 900]]);
    const body = await get("/supply/production/districts?state=Karnataka");
    expect(body.districts).toEqual([]);
  });
});

describe("arrivals", () => {
  const batch = (rows: any[], sha = SHA("c")) => ({
    source_key: "agmarknet", source_name: "AGMARKNET market arrivals report", source_url: "https://agmarknet.gov.in/", file_name: "arrivals.csv",
    authorization_note: "Downloaded manually from the public AGMARKNET report page by the operator.", content_sha256: sha, rows,
  });
  const row = (n: number, overrides: any = {}) => ({ row_number: n, measure: "arrival", district: "Shimoga", market: "Shimoga", variety: "Rashi",
    observation_date: "2026-11-02", quantity: 120, unit: "Quintal", ...overrides });

  it("converts only explicit units and keeps unknown units unconverted", () => {
    expect(toTonnes(120, "Quintal")).toEqual({ tonnes: 12, status: "converted" });
    expect(toTonnes(2500, "kg")).toEqual({ tonnes: 2.5, status: "converted" });
    expect(toTonnes(3, "Metric Tonnes")).toEqual({ tonnes: 3, status: "converted" });
    expect(toTonnes(3, "MT")).toEqual({ tonnes: null, status: "unknown_unit" });
    expect(toTonnes(3, "bags")).toEqual({ tonnes: null, status: "unknown_unit" });
  });
  it("imports atomically, detects duplicates and conflicts and keeps measures separate", async () => {
    const response = await post("/ingest/arrivals", batch([
      row(1), row(2), row(3, { quantity: 999 }), row(4, { measure: "traded", quantity: 80 }), row(5, { district: "Atlantis" }),
      row(6, { observation_date: "2026-11-06" }), row(7, { market: "Sagar", unit: "bags", quantity: 40 }), row(8, { observation_date: "2026-11-01" }),
    ]), "import");
    expect(response.status).toBe(201);
    const body = await response.json() as any;
    expect(body).toMatchObject({ accepted: 4, duplicates: 1, rejected: 3, unknown_unit: 1 });
    expect(body.rejections.map((item: any) => item.row_number)).toEqual([3, 5, 6]);
    const again = await post("/ingest/arrivals", batch([row(1, { quantity: 121 }), row(9, { observation_date: "2026-10-30" })], SHA("d")), "import");
    expect(await again.json()).toMatchObject({ accepted: 1, rejected: 1 });
    expect((await (await post("/ingest/arrivals", batch([row(1)], SHA("d")), "import")).json() as any).status).toBe("already_imported");

    const weekly = await get("/supply/arrivals?granularity=weekly&from=2026-10-01&to=2026-11-05");
    expect(weekly.measures.arrival.map((item: any) => [item.bucket, item.quantity_tonnes, item.unknown_unit_records, item.markets_reporting]))
      .toEqual([["2026-10-26", 24, 0, 1], ["2026-11-02", 12, 1, 2]]);
    expect(weekly.measures.traded).toHaveLength(1);
    expect(weekly.measures.traded[0].quantity_tonnes).toBe(8);
    expect(weekly.sources).toHaveLength(2);
    const monthly = await get("/supply/arrivals?granularity=monthly&from=2026-10-01&to=2026-11-05");
    expect(monthly.measures.arrival.map((item: any) => item.bucket)).toEqual(["2026-10", "2026-11"]);
    expect((await app.request("/api/v1/supply/arrivals?from=2020-01-01&to=2026-11-05", {}, env)).status).toBe(400);
  });
  it("pairs arrivals with validated AGMARKNET prices only on the same market, date and variety", async () => {
    await post("/ingest/arrivals", batch([row(1), row(2, { variety: null, market: "Shimoga", observation_date: "2026-11-03" })]), "import");
    db.sqlite.prepare("INSERT OR IGNORE INTO markets(id,name,district,state) VALUES('test-market-shimoga','Shimoga','Shivamogga','Karnataka')").run();
    const market = db.sqlite.prepare("SELECT id FROM markets WHERE name='Shimoga' AND state='Karnataka'").get() as { id: string } | undefined;
    expect(market).toBeDefined();
    db.sqlite.prepare(`INSERT INTO market_price_observations(id,source_id,source_record_id,market_id,reporting_date,commodity_name,original_commodity_name,variety_name,
      original_variety_name,minimum_price,maximum_price,modal_price,original_unit,price_unit,validation_status,raw_payload,price_basis)
      VALUES('o1','source-agmarknet','r1',?,'2026-11-02','Arecanut','Arecanut(Betelnut/Supari)','Rashi','Rashi',40000,50000,45000,'Rs/Quintal','INR/quintal','validated','{}','APMC_MODAL')`).run(market!.id);
    const body = await get("/supply/arrivals/price-comparison?from=2026-10-01&to=2026-11-05");
    expect(body.pairs).toHaveLength(1);
    expect(body.pairs[0]).toMatchObject({ observation_date: "2026-11-02", modal_price: 45000, price_basis: "APMC_MODAL", quantity_tonnes: 12 });
    expect(body.caution).toMatch(/does not establish cause/);
  });
});

describe("weather freshness and provenance", () => {
  const now = new Date("2026-11-05T06:00:00Z");
  it("classifies freshness", () => {
    expect(freshness(null, now).status).toBe("missing");
    expect(freshness("2026-11-04T19:00:00Z", now).status).toBe("fresh");
    expect(freshness("2026-11-03T12:00:00Z", now)).toMatchObject({ status: "stale", age_hours: 42 });
  });
  it("parses optional humidity and rejects inconsistent humidity", () => {
    const time = Array.from({ length: 14 }, (_, index) => new Date(Date.UTC(2026, 9, 29 + index)).toISOString().slice(0, 10));
    const series = (value: number) => time.map(() => value);
    const base = { latitude: 14.6, longitude: 74.8, elevation: 595, timezone: "Asia/Kolkata",
      daily_units: { time: "iso8601", temperature_2m_max: "°C", temperature_2m_min: "°C", precipitation_sum: "mm", relative_humidity_2m_mean: "%" },
      daily: { time, temperature_2m_max: series(30), temperature_2m_min: series(20), precipitation_sum: series(1), relative_humidity_2m_mean: series(85) } };
    const parsed = parseWeather(base, "2026-11-05T06:00:00Z");
    expect(parsed.rows.every((row) => row.humidity === 85)).toBe(true);
    const { relative_humidity_2m_mean: _humidity, ...dailyWithoutHumidity } = base.daily;
    const { relative_humidity_2m_mean: _unit, ...unitsWithoutHumidity } = base.daily_units;
    expect(parseWeather({ ...base, daily_units: unitsWithoutHumidity, daily: dailyWithoutHumidity }, "2026-11-05T06:00:00Z").rows[0].humidity).toBeNull();
    expect(() => parseWeather({ ...base, daily_units: unitsWithoutHumidity }, "2026-11-05T06:00:00Z")).toThrow(/Incomplete/);
    expect(() => parseWeather({ ...base, daily: { ...base.daily, relative_humidity_2m_mean: [...series(85).slice(1), 120] } }, "2026-11-05T06:00:00Z")).toThrow();
  });
  it("validates Open-Meteo archive payloads", () => {
    const daily = { time: ["2025-06-01", "2025-06-02"], temperature_2m_max: [29, 28], temperature_2m_min: [22, 22], precipitation_sum: [40, 55], relative_humidity_2m_mean: [92, 95] };
    expect(parseArchive({ latitude: 14.65, longitude: 74.86, daily }, "2025-06-01", "2025-06-02").rows).toHaveLength(2);
    expect(() => parseArchive({ latitude: 14.65, longitude: 74.86, daily }, "2025-06-02", "2025-06-02")).toThrow(/Unexpected archive date/);
    expect(() => parseArchive({ latitude: 1, longitude: 1, daily: { ...daily, precipitation_sum: [1] } }, "2025-06-01", "2025-06-02")).toThrow(/inconsistent/);
  });
  it("keeps model, station and forecast datasets separate and labelled", async () => {
    db.sqlite.prepare(`INSERT INTO intelligence_captures(id,source_key,domain,source_url,fetched_at,media_type,raw_payload,content_hash,row_count)
      VALUES('w1','sirsi_weather','weather','https://api.open-meteo.com/v1/forecast','2026-11-04T20:00:00Z','application/json','{}',?,2)`).run(SHA("e"));
    db.sqlite.prepare(`INSERT INTO weather_records(capture_id,date,kind,temperature_max_c,temperature_min_c,precipitation_mm,grid_latitude,grid_longitude,elevation_m,relative_humidity_mean_pct)
      VALUES('w1','2026-11-04','recent_model',30,20,5,14.6,74.8,595,88),('w1','2026-11-06','forecast_model',29,20,12,14.6,74.8,595,90)`).run();
    const imd = await post("/admin/supply/weather/imports", {
      provider: "imd", dataset: "history", source_url: "https://mausam.imd.gov.in/", authorization_note: "Supplied under IMD data-supply approval ref. TEST.",
      content_sha256: SHA("f"), history: [{ data_type: "station_measurement", location_key: "imd_aws_sirsi", station_id: "AWS-1", station_name: "Sirsi AWS",
        district: "uttara kannada", observation_date: "2026-11-04", rainfall_mm: 7, temperature_max_c: 29, temperature_min_c: 21, relative_humidity_pct: 90 }],
    }, "review");
    expect(imd.status).toBe(201);
    const missingStation = await post("/admin/supply/weather/imports", {
      provider: "imd", dataset: "history", source_url: "https://mausam.imd.gov.in/", authorization_note: "Supplied under IMD data-supply approval ref. TEST.",
      content_sha256: SHA("1"), history: [{ data_type: "station_measurement", location_key: "x1", district: "Uttara Kannada", observation_date: "2026-11-04" }],
    }, "review");
    expect(missingStation.status).toBe(422);
    const fakeStation = await post("/admin/supply/weather/imports", {
      provider: "open_meteo", dataset: "history", source_url: "https://open-meteo.com/", authorization_note: "Open-Meteo non-commercial terms.",
      content_sha256: SHA("2"), history: [{ data_type: "station_measurement", location_key: "x1", station_id: "1", station_name: "x", district: "Uttara Kannada", observation_date: "2026-11-04" }],
    }, "review");
    expect(fakeStation.status).toBe(422);
    const body = await get("/supply/weather?district=Uttara Kannada&from=2026-11-01&to=2026-11-05");
    expect(body.history.map((row: any) => row.data_type)).toEqual(["model_grid", "station_measurement"]);
    expect(body.forecasts.model.map((row: any) => row.target_date)).toEqual(["2026-11-06"]);
    expect(body.data_types.model_grid).toMatch(/not a physical station observation/);
    expect(body.freshness.model_capture.status).toBe("fresh");
    expect(body.seasonal[0]).toMatchObject({ season: "post_monsoon", complete: false });
    const preferred = preferredDays(body.history);
    expect(preferred).toHaveLength(1);
    expect(preferred[0].data_type).toBe("station_measurement");
  });
  it("summarises seasons with explicit coverage", () => {
    const days: WeatherDay[] = Array.from({ length: 59 }, (_, index) => ({ day: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10), data_type: "reanalysis",
      provider: "open_meteo", rainfall_mm: index % 2 ? 3 : 0, temperature_max_c: 30, temperature_min_c: 18, relative_humidity_pct: 60, evidence_id: "e", retrieved_at: null }));
    const [winter] = seasonalSummary(days);
    expect(winter).toMatchObject({ expected_days: 59, days_with_data: 59, complete: true, rainy_days_2_5mm: 29, rainfall_total_mm: 87 });
    expect(seasonalSummary(days.slice(1))[0].complete).toBe(false);
  });
});

describe("crop risk rules", () => {
  const conditions = { window_days: 7, months: [6, 7, 8, 9], min_rainy_days: 5, rainy_day_threshold_mm: 2.5, min_coverage_ratio: 0.8 };
  const review = (id: string, decision = "approve") => post(`/admin/supply/risk/rules/${id}/review`,
    { decision, reviewer_name: "Dr Test Reviewer", reviewer_qualification: "Plant pathologist (test fixture)", note: "Reviewed against cited CPCRI publication." }, "review");

  it("seeds draft rules only and blocks approval of unverified or incomplete rules", async () => {
    const rules = await get("/supply/risk/rules");
    expect(rules.rules).toHaveLength(5);
    expect(rules.rules.every((rule: any) => rule.status === "draft" && rule.management_guidance === null)).toBe(true);
    const mildew = await review("arecanut-areolate-mildew-v1");
    expect(mildew.status).toBe(422);
    expect(JSON.stringify(await mildew.json())).toMatch(/verified primary citation/);
    const fruitRot = await review("arecanut-fruit-rot-v1");
    expect(fruitRot.status).toBe(422);
    expect(JSON.stringify(await fruitRot.json())).toMatch(/reviewer-specified weather conditions/);
    expect(() => db.sqlite.prepare("UPDATE crop_risk_rules SET citation_status='verified'").run()).toThrow(/versioned/);
  });

  it("requires expert approval and never diagnoses from weather alone", async () => {
    const created = await post("/admin/supply/risk/rules", {
      rule_key: "arecanut-fruit-rot", source_summary: "Same CPCRI summary with reviewer-specified test thresholds.", weather_relevance: "weather_linked",
      weather_conditions: conditions, field_evidence_required: "Water-soaked lesions on nuts near the perianth.",
      citations: [{ publisher: "ICAR-CPCRI", title: "Disease management strategies", url: "https://cpcri.gov.in/example.pdf" }],
      citation_status: "verified", created_by: "test-admin",
    }, "review");
    expect(created.status).toBe(201);
    expect(((await get("/supply/risk/advisories?district=Uttara Kannada&as_of=2026-07-10")).advisories)).toEqual([]);
    expect((await review("arecanut-fruit-rot-v1")).status).toBe(409);
    expect((await review("arecanut-fruit-rot-v2")).status).toBe(201);

    const batchId = "wb1";
    db.sqlite.prepare(`INSERT INTO weather_import_batches VALUES(?, 'imd', 'history', 'https://mausam.imd.gov.in/', 'Supplied under test approval.', ?, 7, '2026-07-11T00:00:00Z')`).run(batchId, SHA("9"));
    for (let i = 4; i <= 10; i++) {
      db.sqlite.prepare(`INSERT INTO weather_history_records(batch_id,provider,data_type,location_key,station_id,station_name,district,state,observation_date,rainfall_mm,temperature_max_c,temperature_min_c,relative_humidity_pct)
        VALUES(?, 'imd', 'station_measurement', 'aws1', 'AWS-1', 'Sirsi AWS', 'Uttara Kannada', 'Karnataka', ?, 20, 27, 22, 95)`).run(batchId, `2026-07-${String(i).padStart(2, "0")}`);
    }
    const watch = await get("/supply/risk/advisories?district=Uttara Kannada&as_of=2026-07-10");
    expect(watch.advisories).toHaveLength(1);
    expect(watch.advisories[0]).toMatchObject({ level: "weather_watch", version: 2 });
    expect(watch.advisories[0].message).toMatch(/not a diagnosis/);
    expect(watch.weather_basis.data_types[0].type).toBe("station_measurement");
    expect(JSON.stringify(watch)).not.toMatch(/"level":"diagnos/);

    const insufficient = await get("/supply/risk/advisories?district=Uttara Kannada&as_of=2026-07-20");
    expect(insufficient.advisories[0].level).toBe("insufficient_data");
    const offSeason = await get("/supply/risk/advisories?district=Uttara Kannada&as_of=2026-11-04");
    expect(offSeason.advisories[0].weather.status).toBe("out_of_season");

    const report = await post("/ingest/risk/field-reports", { hazard_key: "fruit_rot_mahali", district: "Uttara Kannada", location_detail: "Sirsi taluk",
      observed_on: "2026-07-09", reporter_role: "extension_officer", symptoms_observed: "Water-soaked lesions and nut shedding on several palms.",
      palms_inspected: 20, palms_affected: 6 }, "import");
    expect(report.status).toBe(201);
    const { id } = await report.json() as { id: string };
    expect((await get("/supply/risk/advisories?district=Uttara Kannada&as_of=2026-07-10")).advisories[0].level).toBe("weather_watch");
    const verify = () => post(`/admin/supply/risk/field-reports/${id}/review`, { decision: "verified", reviewed_by: "Extension officer (test)", note: "Photographs reviewed and consistent." }, "review");
    expect((await verify()).status).toBe(200);
    expect((await verify()).status).toBe(409);
    const reported = await get("/supply/risk/advisories?district=Uttara Kannada&as_of=2026-07-10");
    expect(reported.advisories[0].level).toBe("field_reported");
    expect(reported.advisories[0].message).toMatch(/not a laboratory diagnosis/);
    expect(() => db.sqlite.prepare("UPDATE crop_field_reports SET symptoms_observed='x'").run()).toThrow(/immutable/);

    // A later draft does not unpublish the approved version; retiring it does.
    await post("/admin/supply/risk/rules", { rule_key: "arecanut-fruit-rot", source_summary: "Draft revision awaiting expert review of thresholds.",
      weather_relevance: "weather_linked", weather_conditions: { ...conditions, min_rainy_days: 7 }, field_evidence_required: "Lesions on nuts near the perianth.",
      citations: [{ publisher: "ICAR-CPCRI", title: "Disease management strategies", url: "https://cpcri.gov.in/example.pdf" }], citation_status: "verified", created_by: "test-admin" }, "review");
    expect((await get("/supply/risk/advisories?district=Uttara Kannada&as_of=2026-07-10")).advisories[0].version).toBe(2);
    expect((await review("arecanut-fruit-rot-v2", "retire")).status).toBe(201);
    expect((await get("/supply/risk/advisories?district=Uttara Kannada&as_of=2026-07-10")).advisories).toEqual([]);
  });

  it("evaluates non-weather rules only from verified field evidence", () => {
    const rule = { id: "yld-v2", rule_key: "yld", version: 2, hazard_key: "yellow_leaf_disease", hazard_name: "YLD", hazard_type: "disease", causal_agent: null,
      source_summary: "", weather_relevance: "not_weather_driven", weather_conditions_json: null, field_evidence_required: "Yellowing", management_guidance: null,
      citations_json: "[]", citation_status: "verified", created_at: "", created_by: "" } as RuleRow;
    expect(evaluateRule(rule, [], [], "2026-11-04")).toMatchObject({ level: "no_advisory", weather: { status: "not_applicable" } });
    expect(evaluateRule(rule, [], [{ id: "r", hazard_key: "yellow_leaf_disease", observed_on: "2026-10-20", verification_status: "pending", reporter_role: "farmer" }], "2026-11-04").level).toBe("no_advisory");
    expect(publishedRules([rule], [])).toEqual([]);
  });

  it("rejects field reports from unmapped districts or future dates", async () => {
    const base = { hazard_key: "bud_rot", district: "Atlantis", location_detail: "x village", observed_on: "2026-11-01", reporter_role: "farmer", symptoms_observed: "Spindle leaf yellowing then browning." };
    expect((await post("/ingest/risk/field-reports", base, "import")).status).toBe(422);
    expect((await post("/ingest/risk/field-reports", { ...base, district: "Shivamoga", observed_on: "2026-11-06" }, "import")).status).toBe(400);
    expect((await post("/ingest/risk/field-reports", { ...base, district: "Shivamoga" }, "import")).status).toBe(201);
  });
});

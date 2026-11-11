import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, LocalDatabase } from "./test-support/local-d1";
import { app, type Env } from "./index";

let db: LocalDatabase;
let env: Env["Bindings"];
const get = async (path: string) => (await app.request(`/api/v1${path}`, {}, env)).json() as Promise<Record<string, any>>;

beforeEach(() => {
  db = applyMigrations(new LocalDatabase());
  env = { DB: db as unknown as D1Database, INGESTION_TOKEN: "import", ADMIN_TOKEN: "review" };
  db.sqlite.exec(`INSERT INTO monthly_refresh_runs (id,reporting_month,state,source_url,started_at,finished_at,status)
    VALUES ('r1','2025-12','Karnataka','https://agmarknet','2026-01-05T00:00:00Z','2026-01-05T00:00:00Z','succeeded')`);
  const report = db.sqlite.prepare(`INSERT INTO monthly_variety_prices (reporting_month,state,variety_name,weighted_price,price_unit,source_url,fetched_at,refresh_run_id)
    VALUES (?, 'Karnataka', ?, ?, 'INR/quintal', 'https://agmarknet', '2026-01-05T00:00:00Z', 'r1')`);
  report.run("2025-12", "Rashi", 50000);
  report.run("2025-12", "Bette", 40000);
  const long = db.sqlite.prepare(`INSERT INTO monthly_apmc_prices VALUES ('Karnataka', ?, ?, ?, 3, 40, 'v1', '2026-11-11T00:00:00Z')`);
  long.run("2015-01", "Rashi", 30000);
  long.run("2025-12", "Rashi", 49500);
  long.run("2025-12", "Bette", 39000);
  const series = db.sqlite.prepare(`INSERT INTO monthly_apmc_series VALUES ('Karnataka', ?, '2015-01', '2025-12', 2, 70, ?, 80, 0.6, ?, 'v1', '2026-11-11T00:00:00Z')`);
  series.run("Rashi", 0.6, 1);
  series.run("Bette", 7.1, 0);
});

describe("long monthly history", () => {
  it("serves the APMC median series only when asked and only for varieties that track the report", async () => {
    const rashi = await get("/history/monthly?from=2015-01&to=2025-12&variety=Rashi&basis=long");
    expect(rashi.basis).toBe("MONTHLY_APMC_MODAL_MEDIAN");
    const observed = rashi.points.filter((point: { weighted_price: number | null }) => point.weighted_price !== null);
    expect(observed.map((point: { weighted_price: number }) => point.weighted_price)).toEqual([30000, 49500]);
    expect(rashi.versions).toEqual([]);
    // Report-only varieties stay listed alongside the long ones.
    expect(rashi.variety_coverage.map((row: { variety: string }) => row.variety)).toEqual(["Bette", "Rashi"]);
    expect(rashi.long_history.median_abs_gap_pct).toBe(0.6);
    // A variety that does not track the report stays on the report, even when asked.
    const bette = await get("/history/monthly?from=2015-01&to=2025-12&variety=Bette&basis=long");
    expect(bette.basis).toBe("MONTHLY_STATE_WEIGHTED_AVERAGE");
    expect(bette.from).toBe("2025-12");
    expect(bette.points[0].weighted_price).toBe(40000);
    expect(bette.long_history_varieties).toEqual(["Rashi"]);
    // Without the option nothing changes.
    const plain = await get("/history/monthly?from=2025-12&to=2025-12&variety=Rashi");
    expect(plain.basis).toBe("MONTHLY_STATE_WEIGHTED_AVERAGE");
    expect(plain.points[0].weighted_price).toBe(50000);
  });

  it("falls back to the report when a newer report month has arrived since the long series was loaded", async () => {
    db.sqlite.exec(`INSERT INTO monthly_refresh_runs (id,reporting_month,state,source_url,started_at,finished_at,status)
      VALUES ('r2','2026-01','Karnataka','https://agmarknet','2026-02-05T00:00:00Z','2026-02-05T00:00:00Z','succeeded');
      INSERT INTO monthly_variety_prices (reporting_month,state,variety_name,weighted_price,price_unit,source_url,fetched_at,refresh_run_id)
      VALUES ('2026-01','Karnataka','Rashi',51000,'INR/quintal','https://agmarknet','2026-02-05T00:00:00Z','r2')`);
    const rashi = await get("/history/monthly?from=2025-12&to=2025-12&variety=Rashi&basis=long");
    expect(rashi.basis).toBe("MONTHLY_STATE_WEIGHTED_AVERAGE");
  });

  it("falls back to the report when the long series is not loaded", async () => {
    db.sqlite.exec("DELETE FROM monthly_apmc_series");
    const rashi = await get("/history/monthly?from=2025-12&to=2025-12&variety=Rashi&basis=long");
    expect(rashi.basis).toBe("MONTHLY_STATE_WEIGHTED_AVERAGE");
    expect(rashi.points[0].weighted_price).toBe(50000);
  });
});

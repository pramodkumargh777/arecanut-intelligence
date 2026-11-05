import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, LocalDatabase } from "./test-support/local-d1";
import { app, type Env } from "./index";
import { payloadProblems, reconcileForecastOutcomes, statusDecision, type ExperimentPayload } from "./forecasting";

// Synthetic values below exist only in this isolated in-memory database; they never reach production history.
let db: LocalDatabase;
let env: Env["Bindings"];
beforeEach(() => {
  db = applyMigrations(new LocalDatabase());
  env = { DB: db as unknown as D1Database, INGESTION_TOKEN: "import", ADMIN_TOKEN: "review" };
});
afterEach(() => db.sqlite.close());

const SHA = "a".repeat(64);
const authHeader = (token: string) => ({ Authorization: ["Bearer", token].join(" ") });
const post = (path: string, body: unknown, token?: string) => app.request(`/api/v1${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(token ? authHeader(token) : {}) }, body: JSON.stringify(body),
}, env);
const get = async <T = any>(path: string) => (await app.request(`/api/v1${path}`, {}, env)).json() as Promise<T>;

function seedMonth(month: string, price: number, variety = "Rashi") {
  const id = `run-${month}-${variety}`;
  db.sqlite.prepare("INSERT OR IGNORE INTO monthly_refresh_runs(id,reporting_month,state,source_url,started_at,status) VALUES(?,?,'Karnataka','https://example.com','2026-11-01','succeeded')").run(id, month);
  db.sqlite.prepare("INSERT INTO monthly_variety_prices VALUES(?,'Karnataka',?,?,'INR/quintal','https://example.com','2026-11-01',?)").run(month, variety, price, id);
}

const nextMonth = (month: string) => {
  const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7);
};

function payload(origin: string, last: number, opts: { theta?: number; idSuffix?: string; candidate?: boolean } = {}): ExperimentPayload {
  const id = `fx-20261105T0${origin.slice(5, 7)}000Z-${(opts.idSuffix ?? origin.replace("-", "")).padEnd(10, "0").slice(0, 10)}`;
  const base = { dataset_key: "monthly_reference", series_id: "KA|Rashi", market: "Karnataka", variety: "Rashi", grade: null,
    price_basis: "MONTHLY_STATE_WEIGHTED_AVERAGE" as const, horizon: 1 };
  const metrics = { mae: 100, rmse: 120, wape: 0.01, mase: 0.5, directional_accuracy: null, interval_coverage: 0.8,
    interval_width: 1000, dm_statistic: null, p_value: null, p_value_holm: null, mae_skill_vs_baseline: null };
  const candidate = opts.candidate ?? true;
  const pred = (model: string, median: number, status: "reference" | "candidate" | "not_better_than_baseline") => ({
    ...base, unit: "INR/quintal" as const, model, model_version: `${model}-1`, origin_period: origin, target_period: nextMonth(origin),
    median, lower: median - 500, upper: median + 500, interval_level: 80, last_observed_value: last, input_data_version: SHA,
    evaluation_status: status, coverage_status: "consistent_with_nominal" as const,
  });
  return {
    experiment: { id, engine_version: "ani-forecasting-test", created_at: "2026-11-05T00:00:00Z", config_hash: SHA,
      vintage_mode: "revised", dataset_key: "monthly_reference", price_basis: "MONTHLY_STATE_WEIGHTED_AVERAGE",
      input_data_version: SHA, origin_period: origin, origins_evaluated: 30 },
    datasets: [{ key: "monthly_reference", price_basis: "MONTHLY_STATE_WEIGHTED_AVERAGE", frequency: "monthly", unit: "INR/quintal",
      unit_status: "derived_report", provenance: "database", data_version: SHA, suppressed: false, suppression_reasons: [],
      publication_eligible: true, series_total: 1, series_eligible: 1, observations: 40, notes: [] }],
    evaluations: [
      { ...base, model: "last_value", model_version: "last_value-1", baseline_model: "last_value", status: "reference", reasons: [], n: 30,
        ...metrics, coverage_status: "consistent_with_nominal" },
      { ...base, model: "theta", model_version: "theta-1", baseline_model: "last_value",
        status: candidate ? "candidate" : "not_better_than_baseline", reasons: candidate ? [] : ["improvement_not_significant_after_holm"],
        n: 30, ...metrics, dm_statistic: 3.1, p_value: 0.002, p_value_holm: candidate ? 0.01 : 0.4, mae_skill_vs_baseline: 0.12,
        coverage_status: "consistent_with_nominal" },
    ],
    predictions: [pred("last_value", last, "reference"), pred("theta", opts.theta ?? last, candidate ? "candidate" : "not_better_than_baseline")],
  };
}

describe("forecasting experiment publication", () => {
  it("requires the ingestion token and a valid payload", async () => {
    seedMonth("2026-10", 50000);
    expect((await post("/admin/forecasting/experiments", payload("2026-10", 50000))).status).toBe(401);
    expect((await post("/admin/forecasting/experiments", payload("2026-10", 50000), "review")).status).toBe(401);
    expect((await post("/admin/forecasting/experiments", { experiment: {} }, "import")).status).toBe(400);
  });

  it("refuses synthetic datasets, ineligible datasets, mixed bases and unsupported candidates", async () => {
    seedMonth("2026-10", 50000);
    const synthetic = payload("2026-10", 50000); synthetic.datasets[0].provenance = "synthetic_test";
    expect(payloadProblems(synthetic)).toContain("synthetic_or_non_database_dataset");
    const response = await post("/admin/forecasting/experiments", synthetic, "import");
    expect(response.status).toBe(422);

    const suppressed = payload("2026-10", 50000); suppressed.datasets[0].suppressed = true;
    expect(payloadProblems(suppressed)).toContain("evaluated_dataset_suppressed_or_ineligible");

    const mixed = payload("2026-10", 50000); mixed.predictions[1].price_basis = "APMC_MODAL";
    expect(payloadProblems(mixed)).toContain("rows_mix_datasets_or_price_bases");

    const weak = payload("2026-10", 50000); weak.evaluations[1].p_value_holm = 0.2;
    expect(payloadProblems(weak)).toContain("candidate_without_passing_evaluation");

    const relabelled = payload("2026-10", 50000, { candidate: false }); relabelled.predictions[1].evaluation_status = "candidate";
    expect(payloadProblems(relabelled)).toContain("prediction_status_does_not_match_evaluation");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM forecast_experiments").get()).toEqual({ n: 0 });
  });

  it("stores once, reports duplicates idempotently and rejects a changed payload under the same id", async () => {
    seedMonth("2026-10", 50000);
    const body = payload("2026-10", 50000);
    const first = await post("/admin/forecasting/experiments", body, "import");
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ status: "stored", predictions: 2, evaluations: 2 });
    const again = await post("/admin/forecasting/experiments", body, "import");
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ status: "duplicate" });
    const changed = payload("2026-10", 50000, { theta: 50100 });
    expect((await post("/admin/forecasting/experiments", changed, "import")).status).toBe(409);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM forecast_predictions").get()).toEqual({ n: 2 });
  });

  it("anchors predictions on a stored observation and refuses already-observed targets", async () => {
    seedMonth("2026-10", 50000);
    const wrongOrigin = await post("/admin/forecasting/experiments", payload("2026-10", 49000), "import");
    expect(wrongOrigin.status).toBe(422);
    expect(await wrongOrigin.json()).toMatchObject({ problems: ["Forecast origin does not match a stored observation"] });
    seedMonth("2026-11", 51000);
    const observed = await post("/admin/forecasting/experiments", payload("2026-10", 50000), "import");
    expect(observed.status).toBe(422);
    expect(await observed.json()).toMatchObject({ problems: ["Forecast target is already observed"] });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM forecast_experiments").get()).toEqual({ n: 0 });
  });

  it("keeps experiments, predictions, outcomes and events immutable", async () => {
    seedMonth("2026-10", 50000);
    expect((await post("/admin/forecasting/experiments", payload("2026-10", 50000), "import")).status).toBe(201);
    expect(() => db.sqlite.exec("UPDATE forecast_predictions SET median = 1")).toThrow(/immutable/);
    expect(() => db.sqlite.exec("DELETE FROM forecast_predictions")).toThrow(/immutable/);
    expect(() => db.sqlite.exec("UPDATE forecast_experiments SET origin_period = '2026-09'")).toThrow(/immutable/);
    expect(() => db.sqlite.exec("DELETE FROM forecast_model_evaluations")).toThrow(/immutable/);
  });
});

describe("prospective reconciliation", () => {
  it("matches outcomes, validates a candidate only after enough paired outcomes, and exposes performance", async () => {
    let month = "2026-01", price = 50000;
    seedMonth(month, price);
    for (let step = 0; step < 6; step++) {
      const actual = price + 1000;
      // The candidate sits closer to the realised value than the last-value baseline.
      expect((await post("/admin/forecasting/experiments", payload(month, price, { theta: price + 800 }), "import")).status).toBe(201);
      month = nextMonth(month); price = actual; seedMonth(month, price);
      const result = await reconcileForecastOutcomes(env.DB);
      expect(result.matched_outcomes).toBe(2);
      if (step < 5) expect(result.events).toEqual([]);
      else expect(result.events).toEqual([expect.objectContaining({ model: "theta", event: "validated" })]);
    }
    expect((await reconcileForecastOutcomes(env.DB)).matched_outcomes).toBe(0);
    const performance = await get("/forecasting/performance");
    const theta = performance.keys.find((k: { model: string }) => k.model === "theta");
    expect(theta).toMatchObject({ outcomes: 6, paired: 6, effective_status: "validated", mae: 200, baseline_mae: 1000 });
    expect(theta.mae_ratio).toBeCloseTo(0.2);

    const predictions = await get("/forecasting/predictions?limit=1");
    expect(predictions.data).toHaveLength(1);
    expect(predictions.next_after).not.toBeNull();
    const all = await get("/forecasting/predictions?model=theta");
    expect(all.data[0]).toMatchObject({ effective_status: "validated", publication: "validated_forecast", actual_value: 56000, absolute_error: 200, within_interval: 1 });

    const revoke = await post("/admin/forecasting/models/revoke", { series_id: "KA|Rashi", horizon: 1, model: "theta",
      model_version: "theta-1", reason: "Reviewer revoked after source methodology change." }, "review");
    expect(revoke.status).toBe(201);
    expect((await get("/forecasting/predictions?model=theta")).data[0]).toMatchObject({ effective_status: "revoked", publication: "not_published" });
    expect((await post("/admin/forecasting/models/revoke", { series_id: "KA|Rashi", horizon: 1, model: "theta",
      model_version: "theta-1", reason: "x" }, "import")).status).toBe(401);
  });

  it("revokes degraded models and leaves undecided keys alone", () => {
    const base = { effective_status: "validated", paired: 8, coverage: 0.8 };
    expect(statusDecision({ ...base, mae_ratio: 0.9, recent_mae_ratio: 0.95 })).toBeNull();
    expect(statusDecision({ ...base, mae_ratio: 0.95, recent_mae_ratio: 1.3 })).toMatchObject({ event: "revoked" });
    expect(statusDecision({ ...base, mae_ratio: 0.9, recent_mae_ratio: 0.9, coverage: 0.4 })).toMatchObject({ event: "revoked" });
    expect(statusDecision({ ...base, effective_status: "candidate", paired: 5, mae_ratio: 0.5, recent_mae_ratio: 0.5 })).toBeNull();
    expect(statusDecision({ ...base, effective_status: "candidate", mae_ratio: 1.05, recent_mae_ratio: 1.0 })).toBeNull();
    expect(statusDecision({ ...base, effective_status: "reference", mae_ratio: 2, recent_mae_ratio: 2 })).toBeNull();
    expect(statusDecision({ ...base, effective_status: "revoked", mae_ratio: 0.1, recent_mae_ratio: 0.1 })).toBeNull();
  });

  it("returns an empty overview before any experiment is stored and lists limitations", async () => {
    const overview = await get("/forecasting/overview");
    expect(overview.experiment).toBeNull();
    expect(overview.limitations.join(" ")).toMatch(/revised history/);
    expect((await get("/forecasting/evaluations")).data).toEqual([]);
  });
});

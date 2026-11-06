import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, LocalDatabase } from "./test-support/local-d1";
import { app, type Env } from "./index";
import { reconcileForecastOutcomes } from "./forecasting";
import { publishableUnit } from "./cooperative-units";

// Operator decision of 2026-11-05: TSS and TUMCOS are INR/quintal, recorded as an assumption rather than a source fact.
const BEFORE = "0019_assistant_documents.sql";
let db: LocalDatabase;
let env: Env["Bindings"];
const get = async <T = any>(path: string) => (await app.request(`/api/v1${path}`, {}, env)).json() as Promise<T>;

function quote(id: string, source: string, values: { commodity?: string; branch?: string; date?: string; variety?: string; average?: number; unit?: string; unitStatus?: string; status: string; label?: string }) {
  const average = values.average ?? 45000;
  db.sqlite.prepare(`INSERT INTO cooperative_quotes (id, source_key, commodity, branch, reporting_date, variety, minimum_price, maximum_price, average_price,
      price_type, price_unit, source_unit_label, unit_status, source_url, fetched_at, fetch_id, raw_record, status, source_record_id, price_basis)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reported_average', ?, ?, ?, 'https://example.org/source', '2025-10-02T00:00:00Z', 'fetch-1', ?, ?, '', ?)`)
    .run(id, source, values.commodity ?? "arecanut", values.branch ?? "Channagiri", values.date ?? "2025-10-01", values.variety ?? "areca", average - 100, average + 100, average,
      values.unit ?? "unconfirmed", values.label ?? null, values.unitStatus ?? "source_conflict", JSON.stringify({ id, unit: values.label ?? null }), values.status,
      source === "tss" ? "COOPERATIVE_TENDER_AVERAGE" : "COOPERATIVE_AVERAGE");
}

function seedFetch() {
  db.sqlite.prepare("INSERT INTO cooperative_fetches (id, source_key, source_url, started_at, status) VALUES ('fetch-1', 'tumcos', 'https://example.org/source', '2025-10-02T00:00:00Z', 'succeeded')").run();
}

describe("migration 0020 on existing data", () => {
  beforeEach(() => {
    db = applyMigrations(new LocalDatabase(), BEFORE);
    env = { DB: db as never, ADMIN_TOKEN: "review", REFERENCE_STATE: "Karnataka" };
    seedFetch();
    quote("tum-accepted", "tumcos", { status: "accepted_unit_unconfirmed", label: "kg" });
    quote("tum-pending", "tumcos", { status: "pending", date: "2025-10-02", label: "kg" });
    quote("tum-perkg", "tumcos", { status: "accepted_unit_unconfirmed", date: "2025-10-03", average: 480, unitStatus: "assumed", label: "kg" });
    quote("tum-pepper", "tumcos", { status: "pending", commodity: "black_pepper", variety: "black pepper", average: 68000, label: "kg" });
    quote("tss-accepted", "tss", { status: "accepted_unit_unconfirmed", branch: "Sirsi", variety: "RASHI", unit: "INR/quintal", unitStatus: "assumed" });
    quote("tss-pending", "tss", { status: "pending", branch: "Siddapur", variety: "RASHI", unit: "INR/quintal", unitStatus: "assumed" });
    quote("mamcos-kept", "mamcos", { status: "accepted_unit_unconfirmed", branch: "Sirsi", variety: "RASHI EDI", unitStatus: "assumed" });
    applyMigrations(db, undefined, BEFORE);
  });
  const row = (id: string) => db.sqlite.prepare("SELECT status, price_unit, unit_status, source_unit_label, raw_record FROM cooperative_quotes WHERE id=?").get(id);

  it("publishes rows reviewers already accepted, records why, and keeps the source's own label", () => {
    expect(row("tum-accepted")).toMatchObject({ status: "verified", price_unit: "INR/quintal", unit_status: "assumed", source_unit_label: "kg" });
    expect(String(row("tum-accepted")?.raw_record)).toContain("kg");
    expect(row("tss-accepted")).toMatchObject({ status: "verified", price_unit: "INR/quintal", unit_status: "assumed" });
    expect(db.sqlite.prepare("SELECT reviewer, previous_status, new_status FROM cooperative_reviews WHERE quote_id='tum-accepted'").get())
      .toEqual({ reviewer: "operator-unit-decision-2026-11-05", previous_status: "accepted_unit_unconfirmed", new_status: "verified" });
  });

  it("leaves the review gate in place: pending rows get the unit but stay unpublished", () => {
    expect(row("tum-pending")).toMatchObject({ status: "pending", price_unit: "INR/quintal", unit_status: "assumed" });
    expect(row("tss-pending")).toMatchObject({ status: "pending", price_unit: "INR/quintal" });
    expect(row("tum-pepper")).toMatchObject({ status: "pending", price_unit: "INR/quintal" });
  });

  it("does not publish values that could be per kg, or sources outside the decision", () => {
    expect(row("tum-perkg")).toMatchObject({ status: "accepted_unit_unconfirmed", price_unit: "unconfirmed" });
    expect(row("mamcos-kept")).toMatchObject({ status: "accepted_unit_unconfirmed", price_unit: "unconfirmed" });
    expect(() => db.sqlite.prepare("UPDATE cooperative_quotes SET status='verified' WHERE id='tum-perkg'").run()).toThrow("Only INR/quintal");
  });

  it("makes the public feeds, unified view and capability agree", async () => {
    const tumcos = await get("/cooperative/prices?source=tumcos");
    expect(tumcos.data.map((item: { id: string }) => item.id)).toEqual(["tum-accepted"]);
    expect(tumcos.publication).toMatchObject({ published: true, blocked_reason: null, awaiting_review_count: 1 });
    expect(tumcos.availability).toContain("operator assumption");
    const pepper = await get("/cooperative/prices?source=tumcos&commodity=black_pepper");
    expect(pepper.publication).toMatchObject({ published: false, awaiting_review_count: 1, blocked_reason: expect.stringContaining("reviewer approval") });
    expect(db.sqlite.prepare("SELECT normalized_unit, published FROM price_observations WHERE observation_id='tss-accepted'").get()).toEqual({ normalized_unit: "INR/quintal", published: 1 });
    expect(db.sqlite.prepare("SELECT normalized_unit, published FROM price_observations WHERE observation_id='tum-perkg'").get()).toEqual({ normalized_unit: null, published: 0 });
    expect(db.sqlite.prepare("SELECT status FROM commodity_capabilities WHERE commodity_id='commodity-black-pepper' AND capability='cooperative_tumcos'").get()).toEqual({ status: "available" });
    const decisions = await get<{ cooperative: { id: string }[] }>("/decisions/prices");
    expect(decisions.cooperative.map((item) => item.id).sort()).toEqual(["tss-accepted", "tum-accepted"]);
  });
});

describe("forecasting with operator-assumed units", () => {
  const prediction = (series: string, basis: string, market: string, variety: string, origin: string, target: string, last: number) => db.sqlite.prepare(`INSERT INTO forecast_predictions
    (experiment_id, dataset_key, series_id, market, variety, price_basis, unit, model, model_version, forecast_created_at, origin_period, target_period, horizon, median, lower_bound, upper_bound,
     interval_level, last_observed_value, input_data_version, evaluation_status, coverage_status)
    VALUES ('fx-test-0001', 'ds', ?, ?, ?, ?, 'INR/quintal', 'last_value', 'v1', '2025-10-02T00:00:00Z', ?, ?, 1, ?, ?, ?, 80, ?, ?, 'reference', 'not_evaluated')`)
    .run(series, market, variety, basis, origin, target, last, last - 500, last + 500, last, "a".repeat(64));

  beforeEach(() => {
    db = applyMigrations(new LocalDatabase(), BEFORE);
    env = { DB: db as never, REFERENCE_STATE: "Karnataka" };
    seedFetch();
    db.sqlite.prepare(`INSERT INTO forecast_experiments (id, engine_version, created_at, config_hash, payload_sha256, vintage_mode, dataset_key, price_basis, input_data_version, origin_period, origins_evaluated, metadata_json)
      VALUES ('fx-test-0001', 'e1', '2025-10-02T00:00:00Z', ?, ?, 'revised', 'ds', 'COOPERATIVE_AVERAGE', ?, '2025-10-01', 1, '{}')`).run("a".repeat(64), "b".repeat(64), "a".repeat(64));
    // Evidence created before the rebuild must survive it unchanged, including the outcome link.
    quote("m-origin", "mamcos", { branch: "Sirsi", variety: "RASHI EDI", unit: "INR/quintal", unitStatus: "source_confirmed", status: "verified" });
    prediction("mamcos|Sirsi|RASHI EDI", "COOPERATIVE_AVERAGE", "Sirsi", "RASHI EDI", "2025-10-01", "2025-10-02", 45000);
    quote("m-target", "mamcos", { branch: "Sirsi", variety: "RASHI EDI", date: "2025-10-02", average: 45100, unit: "INR/quintal", unitStatus: "source_confirmed", status: "verified" });
  });

  it("keeps stored predictions, outcomes and immutability through the table rebuild", async () => {
    await reconcileForecastOutcomes(db as never);
    const before = db.sqlite.prepare("SELECT o.prediction_id, o.actual_value, p.series_id FROM forecast_outcomes o JOIN forecast_predictions p ON p.id=o.prediction_id").all();
    expect(before).toHaveLength(1);
    applyMigrations(db, undefined, BEFORE);
    expect(db.sqlite.prepare("SELECT o.prediction_id, o.actual_value, p.series_id FROM forecast_outcomes o JOIN forecast_predictions p ON p.id=o.prediction_id").all()).toEqual(before);
    expect(() => db.sqlite.exec("DELETE FROM forecast_predictions")).toThrow("immutable");
    expect(() => db.sqlite.exec("DELETE FROM forecast_outcomes")).toThrow("immutable");
    expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("accepts a TSS prediction anchored on a verified row, refuses an unanchored one, and matches its outcome", async () => {
    applyMigrations(db, undefined, BEFORE);
    quote("t-origin", "tss", { branch: "Sirsi", variety: "RASHI", unit: "INR/quintal", unitStatus: "assumed", status: "verified" });
    expect(() => prediction("tss|Sirsi|RASHI", "COOPERATIVE_TENDER_AVERAGE", "Sirsi", "RASHI", "2025-10-01", "2025-10-02", 99999)).toThrow("does not match a stored observation");
    prediction("tss|Sirsi|RASHI", "COOPERATIVE_TENDER_AVERAGE", "Sirsi", "RASHI", "2025-10-01", "2025-10-02", 45000);
    quote("t-target", "tss", { branch: "Sirsi", variety: "RASHI", date: "2025-10-02", average: 45200, unit: "INR/quintal", unitStatus: "assumed", status: "verified" });
    await reconcileForecastOutcomes(db as never);
    expect(db.sqlite.prepare("SELECT o.actual_value, o.source_table FROM forecast_outcomes o JOIN forecast_predictions p ON p.id=o.prediction_id WHERE p.series_id='tss|Sirsi|RASHI'").get())
      .toEqual({ actual_value: 45200, source_table: "cooperative_quotes" });
  });
});

describe("publishableUnit", () => {
  it("accepts INR/quintal that is confirmed or assumed, and nothing else", () => {
    expect(publishableUnit({ unit_status: "source_confirmed", price_unit: "INR/quintal" })).toBe(true);
    expect(publishableUnit({ unit_status: "assumed", price_unit: "INR/quintal" })).toBe(true);
    expect(publishableUnit({ unit_status: "assumed", price_unit: "unconfirmed" })).toBe(false);
    expect(publishableUnit({ unit_status: "source_conflict", price_unit: "INR/quintal" })).toBe(false);
  });
});

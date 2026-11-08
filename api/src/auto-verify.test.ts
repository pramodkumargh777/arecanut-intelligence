import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, LocalDatabase } from "./test-support/local-d1";
import { app, type Env } from "./index";
import { AGMARKNET_DAILY_REVIEWER, autoVerifyPendingDaily } from "./auto-verify";

let db: LocalDatabase;
let env: Env["Bindings"];
beforeEach(() => {
  db = applyMigrations(new LocalDatabase());
  env = { DB: db as unknown as D1Database, INGESTION_TOKEN: "import", ADMIN_TOKEN: "review", MIN_INDEX_MARKETS: "1",
    AGMARKNET_DAILY_AUTO_VERIFY: "true" };
});
afterEach(() => db.sqlite.close());

function record(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, source_record_id: `source-${id}`, market_id: "market-1", market_name: "Sirsi APMC", district: "Uttara Kannada",
    state: "Karnataka", reporting_date: "2026-11-04", commodity_name: "Arecanut", original_commodity_name: "Arecanut(Betelnut/Supari)",
    variety_name: "Rashi", original_variety_name: "Rashi", grade: "Local", minimum_price: 43000, maximum_price: 47000,
    modal_price: 45000, arrival_quantity: null, arrival_unit: null, original_unit: "Rs./Quintal", price_unit: "INR/quintal",
    validation_status: "validated", validation_message: null, raw_payload: JSON.stringify({ id }), ...overrides,
  };
}
const ingest = (records: unknown[], source_key = "agmarknet") => app.request("/api/v1/admin/import", {
  method: "POST", headers: { Authorization: "Bearer import", "Content-Type": "application/json" },
  body: JSON.stringify({ source_key, records }),
}, env);
const statuses = () => Object.fromEntries((db.sqlite.prepare("SELECT id, validation_status FROM market_price_observations ORDER BY id")
  .all() as { id: string; validation_status: string }[]).map((row) => [row.id, row.validation_status]));
const reviews = () => db.sqlite.prepare("SELECT observation_id, reviewer, previous_status FROM observation_reviews ORDER BY observation_id").all();
const published = async () => ((await (await app.request("/api/v1/prices?include_count=true", {}, env)).json()) as { count: number }).count;

describe("AGMARKNET daily auto-verification", () => {
  it("publishes clean rows at import, records each approval and leaves flagged rows for review", async () => {
    const response = await ingest([
      record("a"),
      record("b", { variety_name: "Bette", original_variety_name: "Bette" }),
      record("c", { variety_name: "Chali", original_variety_name: "Chali", validation_status: "review_required",
        validation_message: "Prices violate order.", minimum_price: 46000 }),
    ]);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ inserted_count: 3, auto_verified_count: 2 });
    expect(statuses()).toEqual({ a: "verified", b: "verified", c: "review_required" });
    expect(reviews()).toEqual([
      { observation_id: "a", reviewer: AGMARKNET_DAILY_REVIEWER, previous_status: "validated" },
      { observation_id: "b", reviewer: AGMARKNET_DAILY_REVIEWER, previous_status: "validated" },
    ]);
    expect(db.sqlite.prepare("SELECT mapping_status FROM markets WHERE id = 'market-1'").get()).toEqual({ mapping_status: "verified" });
    expect(await published()).toBe(2);
  });

  it("changes nothing when switched off", async () => {
    env.AGMARKNET_DAILY_AUTO_VERIFY = "false";
    const body = await (await ingest([record("a")])).json();
    expect(body).not.toHaveProperty("auto_verified_count");
    expect(statuses()).toEqual({ a: "validated" });
    expect(reviews()).toEqual([]);
  });

  it("applies only to the current-daily source, not to manual CSV imports", async () => {
    await ingest([record("a")], "agmarknet_csv");
    expect(statuses()).toEqual({ a: "validated" });
  });

  it("verifies the backlog imported while it was off, once", async () => {
    env.AGMARKNET_DAILY_AUTO_VERIFY = "false";
    await ingest([record("a"), record("b", { reporting_date: "2026-11-05" })]);
    expect(await autoVerifyPendingDaily(env.DB)).toBe(2);
    expect(statuses()).toEqual({ a: "verified", b: "verified" });
    expect(await autoVerifyPendingDaily(env.DB)).toBe(0);
    expect(reviews()).toHaveLength(2);
  });

  it("never verifies a second row for a slot that already has a verified price", async () => {
    env.AGMARKNET_DAILY_AUTO_VERIFY = "false";
    await ingest([record("csv-a", { source_record_id: "csv-1" })], "agmarknet_csv");
    db.sqlite.exec("UPDATE market_price_observations SET validation_status = 'verified' WHERE id = 'csv-a'");
    await ingest([record("a")]);
    expect(await autoVerifyPendingDaily(env.DB)).toBe(0);
    expect(statuses()).toEqual({ a: "validated", "csv-a": "verified" });
  });

  it("does not touch rejected rows or future dates", async () => {
    env.AGMARKNET_DAILY_AUTO_VERIFY = "false";
    await ingest([record("a"), record("b", { reporting_date: "2999-01-01" })]);
    db.sqlite.exec("UPDATE market_price_observations SET validation_status = 'rejected' WHERE id = 'a'");
    expect(await autoVerifyPendingDaily(env.DB)).toBe(0);
    expect(statuses()).toEqual({ a: "rejected", b: "validated" });
  });

  it("reports an exact count when D1 also counts rows written by triggers", async () => {
    db.countTriggerChanges = true;
    const body = await (await ingest([record("a"), record("b", { variety_name: "Bette", original_variety_name: "Bette" })])).json();
    expect(body).toMatchObject({ inserted_count: 2, auto_verified_count: 2 });
  });
});

describe("POST /admin/agmarknet/auto-verify", () => {
  const run = (token = "review") => app.request("/api/v1/admin/agmarknet/auto-verify", { method: "POST", headers: { Authorization: `Bearer ${token}` } }, env);
  it("verifies the waiting backlog for a reviewer, and refuses without the token or the switch", async () => {
    env.AGMARKNET_DAILY_AUTO_VERIFY = "false";
    await ingest([record("a")]);
    expect((await run()).status).toBe(409);
    env.AGMARKNET_DAILY_AUTO_VERIFY = "true";
    expect((await run("import")).status).toBe(401);
    const response = await run();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ auto_verified_count: 1, reviewer: AGMARKNET_DAILY_REVIEWER });
    expect(statuses()).toEqual({ a: "verified" });
  });
});

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, LocalDatabase } from "./test-support/local-d1";
import { app, type Env } from "./index";
import { AGMARKNET_HISTORY_REVIEWER } from "./agmarknet-history";

let db: LocalDatabase;
let env: Env["Bindings"];
beforeEach(() => {
  db = applyMigrations(new LocalDatabase());
  env = { DB: db as unknown as D1Database, INGESTION_TOKEN: "import", ADMIN_TOKEN: "review", MIN_INDEX_MARKETS: "1",
    AGMARKNET_HISTORY_AUTO_VERIFY: "true" };
});
afterEach(() => db.sqlite.close());

const hex = (value: string) => createHash("sha256").update(value).digest("hex");
const SIRSI = hex("karnataka|uttara kannada|sirsi apmc");

function record(overrides: Record<string, unknown> = {}) {
  const base = {
    id: hex("history-a"), source_record_id: "datagovin:35985678:sirsi-rashi-2026-10-15",
    source_resource_id: "35985678-0d79-46b4-9ed6-6f13308a1d24", market_id: SIRSI, market_name: "Sirsi APMC",
    district: "Uttara Kannada", state: "Karnataka", reporting_date: "2026-10-15", publication_date: null,
    platform_fetched_at: "2026-11-08T05:00:00Z", commodity_name: "Arecanut", original_commodity_name: "Arecanut(Betelnut/Supari)",
    variety_name: "Rashi", original_variety_name: "Rashi", grade: "Local", minimum_price: 43000, maximum_price: 47000,
    modal_price: 45000, arrival_quantity: null, arrival_unit: null, original_unit: "Rs./Quintal", price_unit: "INR/quintal",
    validation_status: "validated", validation_message: null, raw_payload: JSON.stringify({ Market: "Sirsi" }),
  };
  return { ...base, ...overrides };
}

async function post(path: string, body: unknown, token = "import") {
  return app.request(`/api/v1${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }, env);
}
const importHistory = (records: unknown[], key = `test:${hex(JSON.stringify(records)).slice(0, 16)}`) =>
  post("/admin/agmarknet-history/import", { records, idempotency_key: key });
const rows = () => db.sqlite.prepare(`SELECT o.id, s.source_key, o.validation_status FROM market_price_observations o
  JOIN data_sources s ON s.id = o.source_id ORDER BY s.source_key, o.id`).all();
const publicPrices = async () => (await (await app.request("/api/v1/prices?include_count=true", {}, env)).json()) as { count: number; data: unknown[] };

describe("AGMARKNET history import", () => {
  it("verifies a clean record, records the automatic approval and publishes it", async () => {
    const response = await importHistory([record()]);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ inserted_count: 1, auto_verified_count: 1, held_by_other_source_count: 0 });
    expect(rows()).toEqual([{ id: hex("history-a"), source_key: "agmarknet_history", validation_status: "verified" }]);
    expect(db.sqlite.prepare("SELECT reviewer, action FROM observation_reviews").all())
      .toEqual([{ reviewer: AGMARKNET_HISTORY_REVIEWER, action: "approve" }]);
    expect(db.sqlite.prepare("SELECT mapping_status FROM markets WHERE id = ?").get(SIRSI)).toEqual({ mapping_status: "verified" });
    expect((await publicPrices()).count).toBe(1);
  });

  it("reports exact counts when D1 also counts rows written by triggers", async () => {
    db.countTriggerChanges = true;
    const records = [0, 1, 2].map((day) => record({ id: hex(`d${day}`), source_record_id: `d${day}`, reporting_date: `2026-10-1${day}` }));
    expect(await (await importHistory(records)).json()).toMatchObject({ inserted_count: 3, auto_verified_count: 3 });
    const correction = await importHistory([record({ id: hex("d0-b"), source_record_id: "d0", reporting_date: "2026-10-10", modal_price: 46000 })]);
    expect(await correction.json()).toMatchObject({ inserted_count: 1, corrected_count: 1, auto_verified_count: 1 });
  });

  it("never adds a market/date/variety/grade that the current-daily feed already holds", async () => {
    const daily = { ...record({ id: hex("daily-a"), source_record_id: "datagovin:9ef84268:sirsi-rashi-2026-10-15" }) };
    delete (daily as Record<string, unknown>).publication_date;
    const imported = await post("/admin/import", { source_key: "agmarknet", records: [daily] });
    expect(imported.status).toBe(201);
    const response = await importHistory([record()]);
    expect(await response.json()).toMatchObject({ inserted_count: 0, held_by_other_source_count: 1, auto_verified_count: 0 });
    // The daily row is untouched and still waits for its own review.
    expect(rows()).toEqual([{ id: hex("daily-a"), source_key: "agmarknet", validation_status: "validated" }]);
  });

  it("still fills the same market on a date the daily feed does not have", async () => {
    await post("/admin/import", { source_key: "agmarknet", records: [record({ id: hex("daily-a"), source_record_id: "daily-1" })] });
    const response = await importHistory([record({ reporting_date: "2026-10-16", source_record_id: "history-16" })]);
    expect(await response.json()).toMatchObject({ inserted_count: 1, auto_verified_count: 1 });
  });

  it("leaves flagged records in the review queue", async () => {
    const response = await importHistory([record({ validation_status: "review_required", validation_message: "Prices violate order.",
      minimum_price: 48000 })]);
    expect(await response.json()).toMatchObject({ inserted_count: 1, auto_verified_count: 0 });
    expect(rows()).toEqual([{ id: hex("history-a"), source_key: "agmarknet_history", validation_status: "review_required" }]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM observation_reviews").get()).toEqual({ count: 0 });
    expect((await publicPrices()).count).toBe(0);
  });

  it("replays a repeated request and counts an identical re-import as a duplicate", async () => {
    await importHistory([record()], "test:key-one");
    const replay = await importHistory([record()], "test:key-one");
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true });
    const again = await importHistory([record()], "test:key-two");
    expect(await again.json()).toMatchObject({ inserted_count: 0, duplicate_count: 1, held_by_other_source_count: 0 });
    expect(rows()).toHaveLength(1);
  });

  it("supersedes a corrected source value, keeps its version and verifies the correction", async () => {
    await importHistory([record()]);
    const response = await importHistory([record({ id: hex("history-b"), modal_price: 46000 })]);
    expect(await response.json()).toMatchObject({ inserted_count: 1, corrected_count: 1, auto_verified_count: 1 });
    expect(rows()).toEqual([
      { id: hex("history-a"), source_key: "agmarknet_history", validation_status: "superseded" },
      { id: hex("history-b"), source_key: "agmarknet_history", validation_status: "verified" },
    ].sort((a, b) => a.id.localeCompare(b.id)));
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM source_record_versions").get()).toEqual({ count: 1 });
  });

  it("sends everything to review when auto-verify is off", async () => {
    env.AGMARKNET_HISTORY_AUTO_VERIFY = "false";
    const response = await importHistory([record()]);
    expect(await response.json()).toMatchObject({ inserted_count: 1, auto_verified_count: 0, auto_verify: false });
    expect(rows()).toEqual([{ id: hex("history-a"), source_key: "agmarknet_history", validation_status: "validated" }]);
  });

  it("rejects bad tokens and requests larger than the D1-safe batch", async () => {
    expect((await post("/admin/agmarknet-history/import", { records: [record()], idempotency_key: "test:key-one" }, "wrong")).status).toBe(401);
    const many = Array.from({ length: 6 }, (_, index) => record({ id: hex(`r${index}`), source_record_id: `r${index}` }));
    expect((await importHistory(many)).status).toBe(400);
  });

  it("lists the history source in the data-source status", async () => {
    await importHistory([record()]);
    const status = await (await app.request("/api/v1/admin/source-status", { headers: { Authorization: "Bearer review" } }, env)).json() as {
      sources: { source_key: string; observation_counts: Record<string, number> }[] };
    expect(status.sources.map((source) => source.source_key)).toEqual(["agmarknet", "agmarknet_csv", "agmarknet_history"]);
    expect(status.sources.find((source) => source.source_key === "agmarknet_history")?.observation_counts).toEqual({ verified: 1 });
  });
});

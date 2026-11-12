import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app, type Env } from "./index";
import { applyMigrations, LocalDatabase } from "./test-support/local-d1";

let db: LocalDatabase;
let env: Env["Bindings"];

function quote(id: string, { source = "mamcos", branch = "SHIVAMOGGA", date = "2026-11-10", variety = "RASHI EDI", average = 46000, status = "verified" } = {}) {
  db.sqlite.prepare(`INSERT INTO cooperative_quotes (id, source_key, commodity, branch, reporting_date, variety, minimum_price, maximum_price, average_price,
      price_type, price_unit, unit_status, source_url, fetched_at, fetch_id, raw_record, status, source_record_id, price_basis)
    VALUES (?, ?, 'arecanut', ?, ?, ?, ?, ?, ?, 'reported_average', 'INR/quintal', ?, 'https://example.org/source', '2026-11-10T12:00:00Z', 'f', ?, ?, ?, ?)`)
    .run(id, source, branch, date, variety, average - 1000, average + 1000, average, source === "tss" ? "assumed" : "source_confirmed", JSON.stringify({ id }), status, id,
      source === "tss" ? "COOPERATIVE_TENDER_AVERAGE" : "COOPERATIVE_AVERAGE");
}
const get = async (query: string) => {
  const response = await app.request(`/api/v1/cooperative/branch-latest?${query}`, {}, env);
  return { status: response.status, body: await response.json() as { data: { id: string; variety: string; reporting_date: string }[]; window: { from: string; to: string } } };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-11T15:00:00Z"));
  db = applyMigrations(new LocalDatabase());
  env = { DB: db as never };
  db.sqlite.prepare("INSERT INTO cooperative_fetches (id, source_key, source_url, started_at, status) VALUES ('f', 'mamcos', 'https://example.org', '2026-11-10T12:00:00Z', 'succeeded')").run();
});
afterEach(() => { db.sqlite.close(); vi.useRealTimers(); });

describe("a branch's latest rates", () => {
  it("returns the newest verified rate of each variety at that branch, each with its own date", async () => {
    quote("rashi-old", { date: "2026-11-07", average: 45000 });
    quote("rashi-new", { date: "2026-11-10" });
    quote("chali", { variety: "CHALI", date: "2026-11-08", average: 41000 });
    const { status, body } = await get("source=mamcos&branch=SHIVAMOGGA");
    expect(status).toBe(200);
    expect(body.data.map((row) => [row.variety, row.id, row.reporting_date])).toEqual([["CHALI", "chali", "2026-11-08"], ["RASHI EDI", "rashi-new", "2026-11-10"]]);
    expect(body.window).toEqual({ from: "2026-09-28", to: "2026-11-11", days: 45 });
  });

  it("leaves out unpublished rows, other branches, other sources and rates older than the window", async () => {
    quote("pending", { status: "pending", date: "2026-11-11" });
    quote("other-branch", { branch: "SAGARA" });
    quote("other-source", { source: "tss", branch: "SHIVAMOGGA", variety: "RASHI" });
    quote("too-old", { variety: "BETTE", date: "2026-09-01" });
    quote("current", { date: "2026-11-09" });
    expect((await get("source=mamcos&branch=SHIVAMOGGA")).body.data.map((row) => row.id)).toEqual(["current"]);
  });

  it("matches the branch exactly as the source spells it", async () => {
    quote("sirsi", { source: "tss", branch: "Sirsi", variety: "RASHI" });
    expect((await get("source=tss&branch=Sirsi")).body.data).toHaveLength(1);
    expect((await get("source=tss&branch=SIRSI")).body.data).toHaveLength(0);
  });

  it("rejects an unknown source or a missing branch", async () => {
    expect((await get("source=apmc&branch=Sirsi")).status).toBe(400);
    expect((await get("source=tss")).status).toBe(400);
    expect((await get(`source=tss&branch=${"x".repeat(61)}`)).status).toBe(400);
  });
});

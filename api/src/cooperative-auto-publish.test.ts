import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app, type Env } from "./index";
import { applyMigrations, LocalDatabase } from "./test-support/local-d1";
import { AUTO_REVIEWER, autoPublishPending, holdReason, type PendingQuote } from "./cooperative-auto-publish";

const NOW = new Date("2026-11-06T14:30:00Z");
const TODAY = "2026-11-06";
let db: LocalDatabase;
let env: Env["Bindings"];

type Seed = { id: string; source?: string; branch?: string; date?: string; variety?: string; average?: number; status?: string; unit?: string; unitStatus?: string; flags?: string[]; message?: string; commodity?: string };
function quote({ id, source = "mamcos", branch = "SAGARA", date = "2026-11-05", variety = "RASHI EDI", average = 46000, status = "pending", unit = "INR/quintal", unitStatus = "source_confirmed", flags, message, commodity = "arecanut" }: Seed) {
  db.sqlite.prepare(`INSERT INTO cooperative_quotes (id, source_key, commodity, branch, reporting_date, variety, minimum_price, maximum_price, average_price,
      price_type, price_unit, unit_status, source_url, fetched_at, fetch_id, raw_record, status, source_record_id, price_basis, review_flags, validation_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reported_average', ?, ?, 'https://example.org/source', '2026-11-05T12:00:00Z', 'f', ?, ?, ?, ?, ?, ?)`)
    .run(id, source, commodity, branch, date, variety, average - 1000, average + 1000, average, unit, unitStatus, JSON.stringify({ id }), status, id,
      source === "tss" ? "COOPERATIVE_TENDER_AVERAGE" : "COOPERATIVE_AVERAGE", flags ? JSON.stringify(flags) : null, message ?? null);
}
const history = (source = "mamcos", variety = "RASHI EDI") => {
  for (const [index, branch] of ["KOPPA", "SORABA", "SHIVAMOGGA"].entries()) quote({ id: `old-${source}-${variety}-${index}`, source, branch, variety, date: "2026-11-02", status: "verified" });
};
const statusOf = (id: string) => (db.sqlite.prepare("SELECT status FROM cooperative_quotes WHERE id=?").get(id) as { status: string }).status;

beforeEach(() => {
  db = applyMigrations(new LocalDatabase());
  env = { DB: db as never, ADMIN_TOKEN: "review" };
  db.sqlite.prepare("INSERT INTO cooperative_fetches (id, source_key, source_url, started_at, status) VALUES ('f', 'mamcos', 'https://example.org', '2026-11-05T12:00:00Z', 'succeeded')").run();
});
afterEach(() => { db.sqlite.close(); vi.useRealTimers(); });

describe("which quotations wait for a person", () => {
  const row: PendingQuote = { id: "x", commodity: "arecanut", branch: "SAGARA", reporting_date: "2026-11-05", variety: "RASHI EDI", minimum_price: 45000, maximum_price: 47000, average_price: 46000,
    price_unit: "INR/quintal", unit_status: "source_confirmed", validation_message: null, review_flags: null };
  it("accepts an ordinary quotation, including at the edge of the allowed move", () => {
    expect(holdReason(row, 46000, TODAY)).toBeNull();
    expect(holdReason({ ...row, average_price: 46000 }, 38334, TODAY)).toBeNull();
  });
  it.each<[string, Partial<PendingQuote>, number | null, string]>([
    ["a failed validation", { validation_message: "bad" }, 46000, "validation"],
    ["a missing average", { average_price: null }, 46000, "range"],
    ["an average outside its range", { average_price: 48000 }, 46000, "range"],
    ["a future date", { reporting_date: "2026-11-07" }, 46000, "future"],
    ["an unconfirmed unit", { price_unit: "unconfirmed" }, 46000, "unit"],
    ["an unknown review flag", { review_flags: JSON.stringify(["multiple_source_records_same_date"]) }, 46000, "multiple_source_records_same_date"],
    ["no recent quotes to compare with", {}, null, "too few"],
    ["a jump of more than 20%", {}, 38000, "more than 20%"],
    ["a drop of more than 20%", {}, 58000, "more than 20%"],
  ])("holds %s", (_name, change, reference, expected) => {
    expect(holdReason({ ...row, ...change }, reference, TODAY)).toContain(expected);
  });
  it("accepts the flag that records the operator's TUMCOS unit decision", () => {
    expect(holdReason({ ...row, unit_status: "assumed", review_flags: JSON.stringify(["declared_unit_conflicts_with_magnitude"]) }, 46000, TODAY)).toBeNull();
  });
});

describe("auto-publishing", () => {
  it("publishes a good quote with an audit entry under its own reviewer name", async () => {
    history();
    quote({ id: "good" });
    expect(await autoPublishPending(db as never, "mamcos", NOW)).toEqual({ published: 1, held: [] });
    expect(statusOf("good")).toBe("verified");
    expect(db.sqlite.prepare("SELECT action, reviewer, previous_status, new_status FROM cooperative_reviews WHERE quote_id='good'").get())
      .toEqual({ action: "approve", reviewer: AUTO_REVIEWER, previous_status: "pending", new_status: "verified" });
  });

  it("keeps a suspicious price in the queue and publishes the rest", async () => {
    history();
    quote({ id: "good" });
    quote({ id: "spike", branch: "KOPPA", average: 90000 });
    const result = await autoPublishPending(db as never, "mamcos", NOW);
    expect(result.published).toBe(1);
    expect(result.held).toEqual([{ id: "spike", reason: expect.stringContaining("more than 20%") }]);
    expect(statusOf("spike")).toBe("pending");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM cooperative_reviews WHERE quote_id='spike'").get()).toEqual({ n: 0 });
  });

  it("will not publish over a different verified price for the same branch and date", async () => {
    history();
    quote({ id: "first", branch: "SAGARA", status: "verified", average: 46000 });
    quote({ id: "second", branch: "SAGARA", average: 46500 });
    expect((await autoPublishPending(db as never, "mamcos", NOW)).published).toBe(0);
    expect(statusOf("second")).toBe("pending");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM cooperative_reviews WHERE quote_id='second'").get()).toEqual({ n: 0 });
  });

  it("holds a variety seen too rarely to judge, and starts publishing once there is enough to compare", async () => {
    quote({ id: "a", variety: "HASA" });
    expect((await autoPublishPending(db as never, "mamcos", NOW)).held[0].reason).toContain("too few");
    quote({ id: "b", variety: "HASA", branch: "KOPPA" });
    quote({ id: "c", variety: "HASA", branch: "SORABA" });
    expect((await autoPublishPending(db as never, "mamcos", NOW)).published).toBe(3);
  });

  it("compares within one variety and source, and touches no other source", async () => {
    history();
    quote({ id: "chali", variety: "CHALI", average: 20000 });
    quote({ id: "tss-row", source: "tss", branch: "Sirsi", variety: "RASHI", unitStatus: "assumed" });
    const result = await autoPublishPending(db as never, "mamcos", NOW);
    expect(result.held.map((row) => row.id)).toEqual(["chali"]);
    expect(statusOf("tss-row")).toBe("pending");
  });

  it("leaves old backlog and invalid rows for a person", async () => {
    history();
    quote({ id: "old", date: "2026-09-01" });
    quote({ id: "broken", status: "invalid", message: "Reported prices do not satisfy minimum <= average <= maximum." });
    expect(await autoPublishPending(db as never, "mamcos", NOW)).toEqual({ published: 0, held: [] });
    expect(statusOf("old")).toBe("pending");
    expect(statusOf("broken")).toBe("invalid");
  });

  it("shows published rows to readers and leaves held rows out", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    history();
    quote({ id: "good", branch: "SAGARA", average: 46200 });
    quote({ id: "spike", branch: "SRINGERI", average: 90000 });
    await autoPublishPending(db as never, "mamcos", NOW);
    const body = await (await app.request("/api/v1/cooperative/prices?source=mamcos", {}, env)).json() as any;
    const branches = body.latest_by_branch.map((row: any) => row.branch);
    expect(branches).toContain("SAGARA");
    expect(branches).not.toContain("SRINGERI");
  });
});

describe("what readers see about collection", () => {
  it("does not show a permission-blocked run as the last fetch", async () => {
    db.sqlite.prepare("INSERT INTO cooperative_fetches (id, source_key, source_url, started_at, finished_at, status, error_message, ingest_mode, attempt_count) VALUES ('b', 'mamcos', 'https://example.org', '2026-11-06T03:30:00Z', '2026-11-06T03:30:00Z', 'blocked', 'Scheduled collection blocked', 'scheduled', 0)").run();
    const body = await (await app.request("/api/v1/cooperative/prices?source=mamcos", {}, env)).json() as any;
    expect(body.last_fetch.status).toBe("succeeded");
    expect(JSON.stringify(body.recent_fetches)).not.toContain("blocked");
  });
});

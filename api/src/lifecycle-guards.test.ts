import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app, type Env } from "./index";
import { applyMigrations, LocalDatabase } from "./test-support/local-d1";
import { HELD_QUOTE_AUTO_REJECT_DAYS, RUN_STALE_AFTER_MINUTES } from "../../shared/lifecycles";

let db: LocalDatabase;
let env: Env["Bindings"];
beforeEach(() => {
  db = applyMigrations(new LocalDatabase());
  env = { DB: db as unknown as D1Database, INGESTION_TOKEN: "import", ADMIN_TOKEN: "review", MIN_INDEX_MARKETS: "3", COOPERATIVE_FETCH_ATTEMPTS: "1" };
});
afterEach(() => db.sqlite.close());

const request = (path: string, init: { method?: string; token?: string; body?: unknown } = {}) => app.request(`/api/v1${path}`, {
  method: init.method ?? "GET",
  headers: { Authorization: `Bearer ${init.token ?? "review"}`, "Content-Type": "application/json" },
  ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
}, env);
const one = <T>(sql: string, ...args: (string | number)[]) => db.sqlite.prepare(sql).get(...args) as T;
/** SQLite CURRENT_TIMESTAMP text for `minutes` ago, as ingestion_jobs.started_at stores it. */
const sqliteAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString().replace("T", " ").slice(0, 19);

const observation = {
  id: "a", source_record_id: "source-1", market_id: "market-1", market_name: "Sagar", district: "Shivamogga", state: "Karnataka",
  reporting_date: "2026-10-30", commodity_name: "Arecanut", original_commodity_name: "Arecanut(Betelnut/Supari)",
  variety_name: "Rashi", original_variety_name: "Rashi", minimum_price: 40000, maximum_price: 50000, modal_price: 44000,
  arrival_quantity: null, arrival_unit: null, original_unit: "Rs./Quintal", price_unit: "INR/quintal",
  validation_status: "validated", validation_message: null, raw_payload: "{}",
};
const importWithKey = (key: string) => request("/admin/import", { method: "POST", token: "import", body: { source_key: "agmarknet_csv", idempotency_key: key, records: [observation] } });

describe("abandoned import jobs (ingestionJob.stale)", () => {
  function runningJob(key: string, startedMinutesAgo: number) {
    const source = one<{ id: string }>("SELECT id FROM data_sources WHERE source_key = 'agmarknet_csv'");
    db.sqlite.prepare("INSERT INTO ingestion_jobs (id, source_id, status, received_count, idempotency_key, started_at) VALUES (?, ?, 'running', 1, ?, ?)")
      .run(`job-${key}`, source.id, key, sqliteAgo(startedMinutesAgo));
  }

  it("refuses a retry while the job may still be running, and says when it may be retried", async () => {
    runningJob("import-key-1", 5);
    const response = await importWithKey("import-key-1");
    expect(response.status).toBe(409);
    const body = await response.json() as { error: string; job_id: string; retry_after: string };
    expect(body.job_id).toBe("job-import-key-1");
    expect(Date.parse(body.retry_after) - Date.now()).toBeGreaterThan((RUN_STALE_AFTER_MINUTES - 6) * 60_000);
    expect(body.error).toContain(body.retry_after);
    expect(one<{ status: string }>("SELECT status FROM ingestion_jobs WHERE id = 'job-import-key-1'").status).toBe("running");
  });

  it("releases a job abandoned past the limit, records why, and runs the retry", async () => {
    runningJob("import-key-2", RUN_STALE_AFTER_MINUTES + 1);
    const response = await importWithKey("import-key-2");
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ inserted_count: 1, replayed: false, reprocess_of: null });
    expect(one("SELECT status, error_message FROM ingestion_jobs WHERE id = 'job-import-key-2'"))
      .toEqual({ status: "failed", error_message: expect.stringContaining("Abandoned") });
    expect(one("SELECT level FROM ingestion_job_logs WHERE job_id = 'job-import-key-2'")).toEqual({ level: "warning" });
    // The new job owns the key now, so a further retry replays its result.
    expect(await (await importWithKey("import-key-2")).json()).toMatchObject({ replayed: true });
  });
});

describe("review refusals name the record's current state", () => {
  it("tells a second reviewer the observation was already decided, keeping the 404 contract", async () => {
    expect((await importWithKey("import-key-3")).status).toBe(201);
    const review = (action: string) => request("/admin/observations/a/review", { method: "POST", body: { action } });
    expect((await review("reject")).status).toBe(200);
    const again = await review("approve");
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: "Observation is already rejected; nothing was changed. Reload the queue.", current_status: "rejected" });
    const missing = await request("/admin/observations/nope/review", { method: "POST", body: { action: "approve" } });
    expect(await missing.json()).toEqual({ error: "Observation not found.", current_status: null });
  });
});

describe("held cooperative quotations (cooperativeQuote substate 'held')", () => {
  const today = new Date().toISOString().slice(0, 10);
  function quote(id: string, hold: { reason: string; at: string } | null) {
    db.sqlite.prepare(`INSERT INTO cooperative_fetches (id, source_key, source_url, started_at, status) VALUES (?, 'mamcos', 'https://example.org', ?, 'succeeded')`)
      .run(`fetch-${id}`, `${today}T00:00:00Z`);
    db.sqlite.prepare(`INSERT INTO cooperative_quotes (id, source_key, commodity, branch, reporting_date, variety, minimum_price, maximum_price, average_price,
        price_type, price_unit, unit_status, source_url, fetched_at, fetch_id, raw_record, status, source_record_id, price_basis, hold_reason, held_at)
      VALUES (?, 'mamcos', 'arecanut', ?, ?, 'RASHI EDI', 45000, 47000, 46000, 'reported_average', 'INR/quintal', 'source_confirmed',
        'https://example.org', ?, ?, '{}', 'pending', ?, 'COOPERATIVE_AVERAGE', ?, ?)`)
      .run(id, `BRANCH-${id}`, today, `${today}T00:00:00Z`, `fetch-${id}`, id, hold?.reason ?? null, hold?.at ?? null);
  }
  const holdOf = (id: string) => one<{ status: string; hold_reason: string | null; held_at: string | null }>("SELECT status, hold_reason, held_at FROM cooperative_quotes WHERE id = ?", id);

  it("shows reviewers why a quotation is held and when it will be rejected automatically", async () => {
    quote("held", { reason: "average 46000 is more than 20% from the recent branch median 30000", at: "2026-11-01T03:00:00.000Z" });
    quote("plain", null);
    const queue = await (await request("/admin/cooperative/quality")).json() as { data: { id: string; hold_reason: string | null; auto_reject_at: string | null }[] };
    const byId = Object.fromEntries(queue.data.map((row) => [row.id, row]));
    expect(byId.held).toMatchObject({ hold_reason: expect.stringContaining("more than 20%"), auto_reject_at: new Date(Date.parse("2026-11-01T03:00:00.000Z") + HELD_QUOTE_AUTO_REJECT_DAYS * 86_400_000).toISOString() });
    expect(byId.plain).toMatchObject({ hold_reason: null, auto_reject_at: null });
  });

  it("ends the hold on approval, as auto-publish does, and keeps it as the audit trail on rejection", async () => {
    quote("approve-me", { reason: "review flag: x", at: "2026-11-01T03:00:00.000Z" });
    quote("reject-me", { reason: "review flag: y", at: "2026-11-01T03:00:00.000Z" });
    expect((await request("/admin/cooperative/approve-me/review", { method: "POST", body: { action: "approve" } })).status).toBe(200);
    expect((await request("/admin/cooperative/reject-me/review", { method: "POST", body: { action: "reject" } })).status).toBe(200);
    expect(holdOf("approve-me")).toEqual({ status: "verified", hold_reason: null, held_at: null });
    expect(holdOf("reject-me")).toEqual({ status: "rejected", hold_reason: "review flag: y", held_at: "2026-11-01T03:00:00.000Z" });
    const again = await request("/admin/cooperative/approve-me/review", { method: "POST", body: { action: "reject" } });
    expect(again.status).toBe(404);
    expect(await again.json()).toMatchObject({ current_status: "verified" });
  });
});

describe("stalled cooperative fetches (cooperativeFetch.stale)", () => {
  const availability = async () => {
    const body = await (await request("/admin/cooperative/sources")).json() as { sources: { source_key: string; availability: { state: string } }[] };
    return body.sources.find((source) => source.source_key === "mamcos")!.availability.state;
  };
  const fetchStarted = (minutesAgo: number) => db.sqlite.prepare(`INSERT INTO cooperative_fetches (id, source_key, source_url, started_at, status)
    VALUES (?, 'mamcos', 'https://example.org', ?, 'running')`).run(`run-${minutesAgo}`, new Date(Date.now() - minutesAgo * 60_000).toISOString());

  it("reports a fetch in progress as running", async () => {
    fetchStarted(2);
    expect(await availability()).toBe("running");
  });
  it("reports a fetch with no outcome past the limit as stalled, not running forever", async () => {
    fetchStarted(RUN_STALE_AFTER_MINUTES + 5);
    expect(await availability()).toBe("stalled");
  });
});

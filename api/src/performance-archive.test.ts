import type { SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations, LocalDatabase } from "./test-support/local-d1";
import worker, { app, type Env } from "./index";
import { buildReferenceSeries, type Observation } from "./domain/analytics";
import { purgeExpiredTemporary, readRelatedText, sha256Bytes, syncArchive } from "./archive";
import { refreshDirtySummaries } from "./summaries";

/** In-memory R2 stand-in covering the methods the archive module uses. */
class FakeR2 {
  objects = new Map<string, { bytes: Uint8Array; customMetadata: Record<string, string>; contentType?: string }>();
  puts = 0;
  async head(key: string) {
    const object = this.objects.get(key);
    return object ? { key, size: object.bytes.byteLength, customMetadata: object.customMetadata } : null;
  }
  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    return { key, size: object.bytes.byteLength, customMetadata: object.customMetadata,
      arrayBuffer: async () => object.bytes.slice().buffer, text: async () => new TextDecoder().decode(object.bytes) };
  }
  async put(key: string, value: Uint8Array | ArrayBuffer | string, options?: { customMetadata?: Record<string, string>; httpMetadata?: { contentType?: string } }) {
    this.puts += 1;
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value instanceof Uint8Array ? value : new Uint8Array(value));
    this.objects.set(key, { bytes: bytes.slice(), customMetadata: options?.customMetadata ?? {}, contentType: options?.httpMetadata?.contentType });
    return { key };
  }
  async delete(key: string) { this.objects.delete(key); }
}

let db: LocalDatabase;
let env: Env["Bindings"];
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
beforeEach(() => {
  db = applyMigrations(new LocalDatabase());
  env = { DB: db as unknown as D1Database, INGESTION_TOKEN: "import", ADMIN_TOKEN: "review", MIN_INDEX_MARKETS: "3", COOPERATIVE_FETCH_ATTEMPTS: "1" };
});
afterEach(() => { db.sqlite.close(); vi.useRealTimers(); });

const get = (path: string, headers: Record<string, string> = {}) => app.request(`/api/v1${path}`, { headers }, env);
const post = (path: string, body: unknown, token = "import") => app.request(`/api/v1${path}`, {
  method: "POST", headers: { ...auth(token), "Content-Type": "application/json" }, body: JSON.stringify(body) }, env);

function record(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, source_record_id: `src-${id}`, market_id: "market-1", market_name: "Sagar", district: "Shivamogga", state: "Karnataka",
    reporting_date: "2026-10-30", commodity_name: "Arecanut", original_commodity_name: "Arecanut(Betelnut/Supari)",
    variety_name: "Rashi", original_variety_name: "Rashi", minimum_price: 40000, maximum_price: 50000, modal_price: 44000,
    arrival_quantity: null, arrival_unit: null, original_unit: "Rs./Quintal", price_unit: "INR/quintal",
    validation_status: "validated", validation_message: null, raw_payload: JSON.stringify({ id }), ...overrides,
  };
}

/** Bulk fixture: verified observations for verified markets, inserted directly by cloning a reviewed row. */
async function seedVerified(rows: { id: string; date: string; market: number; price: number; variety?: string; ingested?: string }[], markets = 4) {
  expect((await post("/admin/import", { source_key: "agmarknet_csv", records: [record("seed")] })).status).toBe(201);
  expect((await post("/admin/observations/seed/review", { action: "approve" }, "review")).status).toBe(200);
  for (let market = 2; market <= markets; market += 1) {
    db.sqlite.prepare("INSERT OR IGNORE INTO markets(id,name,district,state,mapping_status) VALUES(?,?, 'Shivamogga','Karnataka','verified')")
      .run(`market-${market}`, `Market ${market}`);
  }
  const base = db.sqlite.prepare("SELECT * FROM market_price_observations WHERE id = 'seed'").get()!;
  db.sqlite.exec("UPDATE market_price_observations SET validation_status = 'rejected' WHERE id = 'seed'");
  const columns = Object.keys(base);
  const insert = db.sqlite.prepare(`INSERT INTO market_price_observations (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
  db.sqlite.exec("BEGIN");
  for (const row of rows) {
    const value = { ...base, id: row.id, source_record_id: `src-${row.id}`, market_id: `market-${row.market}`, reporting_date: row.date,
      modal_price: row.price, minimum_price: 1, maximum_price: 1_000_000, variety_name: row.variety ?? "Rashi",
      ingested_at: row.ingested ?? "2026-11-01T00:00:00.000Z" };
    insert.run(...columns.map((column) => value[column as keyof typeof value] as SQLInputValue));
  }
  db.sqlite.exec("COMMIT");
}

const monthly = (id: string, report: string) => db.sqlite.prepare(`INSERT INTO monthly_refresh_runs (id, reporting_month, state, source_url, started_at, finished_at, status, record_count, raw_report)
    VALUES (?, '2026-10', 'Karnataka', 'https://agmarknet.gov.in', '2026-11-01T00:00:00Z', '2026-11-01T00:01:00Z', 'succeeded', 1, ?)`).run(id, report);

const isoDay = (offset: number, start = "2015-06-01") => new Date(Date.parse(`${start}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

/** Reference series computed directly from the evidence table with the original domain function. */
function expectedSeries(variety = "Rashi") {
  const rows = db.sqlite.prepare(`SELECT o.*, o.ingested_at AS ingestion_timestamp FROM market_price_observations o JOIN markets m ON m.id = o.market_id
    WHERE o.validation_status = 'verified' AND m.mapping_status = 'verified' AND m.state = 'Karnataka' AND o.variety_name = ?
    ORDER BY o.reporting_date, o.id`).all(variety) as unknown as Observation[];
  return buildReferenceSeries(rows, 3);
}

describe("summary cache equivalence", () => {
  it("matches buildReferenceSeries after inserts, reviews, corrections and market mapping changes", async () => {
    const rows = [];
    let n = 0;
    for (let day = 0; day < 40; day += 1) {
      for (let market = 1; market <= 4; market += 1) {
        if ((day + market) % 5 === 0) continue;
        rows.push({ id: `r${n++}`, date: isoDay(day, "2026-08-01"), market, price: 40000 + ((day * 37 + market * 101) % 900) });
        if (market === 2 && day % 3 === 0) rows.push({ id: `r${n++}`, date: isoDay(day, "2026-08-01"), market, price: 39000, ingested: "2026-11-02T00:00:00.000Z" });
      }
    }
    await seedVerified(rows);
    const read = async () => (await (await get("/analytics/reference-index?variety=Rashi")).json() as { data: unknown[] }).data;
    expect(await read()).toEqual(expectedSeries());
    // Reviewer withdrawal, a later correction and a market losing verified mapping all invalidate cached dates.
    db.sqlite.exec("UPDATE market_price_observations SET validation_status = 'rejected' WHERE id IN ('r5', 'r9', 'r40')");
    db.sqlite.exec("UPDATE market_price_observations SET modal_price = 41234 WHERE id = 'r12'");
    expect(await read()).toEqual(expectedSeries());
    db.sqlite.exec("UPDATE markets SET mapping_status = 'unverified' WHERE id = 'market-3'");
    expect(await read()).toEqual(expectedSeries());
    db.sqlite.exec("UPDATE markets SET mapping_status = 'verified' WHERE id = 'market-3'");
    expect(await read()).toEqual(expectedSeries());
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM market_summary_dirty").get()?.n).toBe(0);
  });

  it("rebuilds a bounded range on operator request and requires the reviewer token", async () => {
    await seedVerified([1, 2, 3].map((market) => ({ id: `x${market}`, date: "2026-10-01", market, price: 40000 + market })));
    await refreshDirtySummaries(env.DB, "Arecanut");
    db.sqlite.exec("DELETE FROM market_daily_summaries");
    expect((await post("/admin/summaries/rebuild", { from: "2026-10-01", to: "2026-10-01" }, "wrong")).status).toBe(401);
    const response = await post("/admin/summaries/rebuild", { from: "2026-10-01", to: "2026-10-01" }, "review");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ written: 1 });
    expect((await post("/admin/summaries/rebuild", { from: "2010-01-01", to: "2026-10-01" }, "review")).status).toBe(400);
  });
});

describe("pagination and bounded responses", () => {
  it("walks /prices with a keyset cursor without gaps or duplicates", async () => {
    const rows = [];
    for (let day = 0; day < 30; day += 1) for (let market = 1; market <= 4; market += 1) rows.push({ id: `p${day}-${market}`, date: isoDay(day, "2026-09-01"), market, price: 40000 + day });
    await seedVerified(rows);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response = await get(`/prices?limit=25&include_count=false${cursor ? `&cursor=${cursor}` : ""}`);
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { id: string; reporting_date: string }[]; next_cursor: string | null; count: number | null };
      expect(body.count).toBeNull();
      expect(body.data.length).toBeLessThanOrEqual(25);
      seen.push(...body.data.map((row) => row.id));
      cursor = body.next_cursor;
      pages += 1;
    } while (cursor && pages < 20);
    expect(pages).toBe(5);
    expect(new Set(seen).size).toBe(120);
    expect(seen.length).toBe(120);
    const ordered = db.sqlite.prepare(`SELECT o.id FROM market_price_observations o JOIN markets m ON m.id = o.market_id
      WHERE o.validation_status = 'verified' ORDER BY o.reporting_date DESC, m.name, o.id`).all().map((row) => row.id);
    expect(seen).toEqual(ordered);
  });

  it("rejects ambiguous or oversized paging requests", async () => {
    expect((await get("/prices?cursor=abc&offset=10")).status).toBe(400);
    expect((await get(`/prices?q=${"x".repeat(101)}`)).status).toBe(400);
    expect((await get("/prices?cursor=not-a-cursor")).status).toBe(400);
    expect((await get("/prices?limit=100000")).status).toBe(400);
    expect((await get("/prices?limit=0")).status).toBe(400);
    expect(await (await get("/prices?limit=1000")).json()).toMatchObject({ limit: 1000 });
  });

  it("sorts /prices server-side by whitelisted keys with stable offset paging", async () => {
    const rows = [];
    for (let day = 0; day < 6; day += 1) for (let market = 1; market <= 4; market += 1) rows.push({ id: `s${day}-${market}`, date: isoDay(day, "2026-09-01"), market, price: 40000 + ((day * 7 + market * 13) % 11) * 100 });
    await seedVerified(rows);
    const read = async (query: string) => {
      const response = await get(`/prices?${query}`);
      expect(response.status).toBe(200);
      return await response.json() as { data: { id: string; modal_price: number; market_name: string }[]; next_cursor: string | null; has_more: boolean; count: number };
    };
    const ascending = [...(await read("sort=modal_price&order=asc&limit=10")).data, ...(await read("sort=modal_price&order=asc&limit=10&offset=10")).data, ...(await read("sort=modal_price&order=asc&limit=10&offset=20")).data];
    expect(new Set(ascending.map((row) => row.id)).size).toBe(24);
    expect(ascending.map((row) => row.modal_price)).toEqual([...ascending.map((row) => row.modal_price)].sort((a, b) => a - b));
    const first = await read("sort=modal_price&order=desc&limit=5");
    expect(first.data[0].modal_price).toBe(Math.max(...rows.map((row) => row.price)));
    expect(first.next_cursor).toBeNull();
    expect(first.has_more).toBe(true);
    const byMarket = (await read("sort=market_name&limit=24")).data.map((row) => row.market_name);
    expect(byMarket).toEqual([...byMarket].sort((a, b) => a.localeCompare(b)));
    expect((await read("sort=reporting_date&order=desc&limit=5")).next_cursor).not.toBeNull();
    expect((await get("/prices?sort=modal_price;DROP TABLE markets")).status).toBe(400);
    expect((await get("/prices?sort=modal_price&order=sideways")).status).toBe(400);
    const cursor = (await read("limit=5")).next_cursor!;
    expect((await get(`/prices?sort=modal_price&cursor=${cursor}`)).status).toBe(400);
  });

  it("paginates the admin quality queue with a total", async () => {
    const records = Array.from({ length: 7 }, (_, index) => record(`q${index}`, { source_record_id: `q${index}`, validation_status: "review_required", validation_message: "check" }));
    expect((await post("/admin/import", { source_key: "agmarknet_csv", records })).status).toBe(201);
    const body = await (await get("/admin/quality?limit=3&offset=3", auth("review"))).json() as { data: unknown[]; total: number; limit: number; offset: number };
    expect([body.data.length, body.total, body.limit, body.offset]).toEqual([3, 7, 3, 3]);
    expect((await get("/admin/quality?limit=201", auth("review"))).status).toBe(400);
  });
});

describe("large date ranges and server-side chart aggregation", () => {
  beforeEach(async () => {
    const rows = [];
    for (let day = 0; day < 3650; day += 1) {
      // Sparse: skip every seventh day entirely, and leave every 11th day with only two markets (withheld).
      if (day % 7 === 6) continue;
      for (let market = 1; market <= (day % 11 === 0 ? 2 : 3); market += 1) rows.push({ id: `l${day}-${market}`, date: isoDay(day), market, price: 30000 + day + market });
    }
    await seedVerified(rows);
  });

  it("aggregates ten years into monthly buckets quickly without interpolating gaps", async () => {
    const started = performance.now();
    const response = await get("/charts/reference?variety=Rashi&from=2015-06-01&to=2025-05-31&interval=monthly");
    const elapsed = performance.now() - started;
    expect(response.status).toBe(200);
    const body = await response.json() as { points: { bucket_start: string; reporting_days: number; first_reporting_date: string }[]; covered_days: number; withheld_days: number };
    expect(body.points.length).toBe(120);
    expect(body.points.every((point) => point.bucket_start.endsWith("-01"))).toBe(true);
    const withheld = Array.from({ length: 3650 }, (_, day) => day).filter((day) => day % 7 !== 6 && day % 11 === 0).length;
    const covered = Array.from({ length: 3650 }, (_, day) => day).filter((day) => day % 7 !== 6 && day % 11 !== 0).length;
    expect([body.covered_days, body.withheld_days]).toEqual([covered, withheld]);
    expect(body.points.reduce((sum, point) => sum + point.reporting_days, 0)).toBe(covered);
    // Generous bound for CI: includes the first cache refresh of ~9,000 observations.
    expect(elapsed).toBeLessThan(5000);
    const warm = performance.now();
    expect((await get("/charts/reference?variety=Rashi&from=2015-06-01&to=2025-05-31&interval=weekly")).status).toBe(200);
    expect(performance.now() - warm).toBeLessThan(1000);
  });

  it("uses Monday-start weekly buckets and rejects spans above ten years", async () => {
    const body = await (await get("/charts/reference?variety=Rashi&from=2017-01-02&to=2017-01-15&interval=weekly")).json() as { points: { bucket_start: string; first_reporting_date: string; last_reporting_date: string }[] };
    expect(body.points.map((point) => point.bucket_start)).toEqual(["2017-01-02", "2017-01-09"]);
    // Mon-Sat report; day 583 (2017-01-04) has two markets and is withheld; 2017-01-08 is a non-reporting Sunday.
    expect(body.points[0]).toMatchObject({ first_reporting_date: "2017-01-02", last_reporting_date: "2017-01-07", reporting_days: 5 });
    expect((await get("/charts/reference?variety=Rashi&from=2010-01-01&to=2025-05-31&interval=monthly")).status).toBe(400);
    expect((await get("/charts/reference?variety=Rashi&from=2026-01-02&to=2026-01-01")).status).toBe(400);
    expect((await get("/charts/reference?variety=Rashi&from=2026-01-01&to=2026-01-31&interval=hourly")).status).toBe(400);
    expect((await get("/charts/reference?from=2026-01-01&to=2026-01-31")).status).toBe(400);
  });

  it("bounds the daily reference series and flags truncation", async () => {
    const body = await (await get("/analytics/reference-index?variety=Rashi")).json() as { data: { reporting_date: string }[]; truncated: boolean };
    expect(body.data.length).toBeLessThanOrEqual(4000);
    const last = [...Array(3650).keys()].reverse().find((day) => day % 7 !== 6 && day % 11 !== 0)!;
    expect(body.data.at(-1)?.reporting_date).toBe(isoDay(last));
    const ranged = await (await get("/analytics/reference-index?variety=Rashi&from=2024-01-01&to=2024-01-31")).json() as { data: { reporting_date: string }[]; truncated: boolean };
    expect(ranged.truncated).toBe(false);
    expect(ranged.data.length).toBeGreaterThan(20);
    expect(ranged.data.every((point) => point.reporting_date.startsWith("2024-01"))).toBe(true);
  });
});

describe("index usage", () => {
  const plan = (sql: string) => (db.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((row) => row.detail);
  it("serves published read paths from indexes rather than full observation scans", async () => {
    const statements: string[] = [];
    const prepare = db.prepare.bind(db);
    db.prepare = (sql: string) => { statements.push(sql); return prepare(sql); };
    await seedVerified([1, 2, 3].map((market) => ({ id: `i${market}`, date: "2026-10-01", market, price: 40000 })));
    statements.length = 0;
    for (const path of ["/prices?limit=10", "/analytics/reference-index?variety=Rashi", "/overview?variety=Rashi",
      "/charts/reference?variety=Rashi&from=2026-01-01&to=2026-12-31", "/varieties"]) {
      expect((await get(path)).status).toBe(200);
    }
    expect((await get("/admin/quality", auth("review"))).status).toBe(200);
    expect(statements.length).toBeGreaterThan(5);
    const fullScans = statements.filter((sql) => /^\s*(WITH|SELECT)/i.test(sql))
      .flatMap((sql) => plan(sql).filter((detail) => /^SCAN (o|market_price_observations|market_daily_summaries)$/.test(detail)).map((detail) => `${detail} :: ${sql.slice(0, 120)}`));
    expect(fullScans).toEqual([]);
    expect(plan("SELECT reporting_date FROM market_daily_summaries WHERE commodity_name='Arecanut' AND state='Karnataka' AND variety_name='Rashi' AND reporting_date BETWEEN '2026-01-01' AND '2026-12-31'").join())
      .toMatch(/SEARCH market_daily_summaries USING PRIMARY KEY/);
    expect(plan("SELECT id FROM market_price_observations WHERE validation_status IN ('validated','review_required') ORDER BY ingested_at DESC LIMIT 100").join())
      .toMatch(/idx_observations_review_queue/);
  });
});

describe("evidence retention guards", () => {
  it("refuses deletion of observations, audit rows, archive registry rows and error logs", async () => {
    await seedVerified([{ id: "g1", date: "2026-10-01", market: 1, price: 40000 }]);
    expect(() => db.sqlite.exec("DELETE FROM market_price_observations WHERE id = 'g1'")).toThrow(/retained evidence/);
    expect(() => db.sqlite.exec("DELETE FROM ingestion_jobs")).toThrow(/retained audit/);
    db.sqlite.exec("INSERT INTO operational_errors (id, component, message) VALUES ('e1', 'archive', 'x')");
    expect(() => db.sqlite.exec("DELETE FROM operational_errors")).toThrow(/retained/);
    db.sqlite.exec(`INSERT INTO archive_objects (id, storage, object_key, sha256, size_bytes, mime_type, category, retention_class)
      VALUES ('a1', 'r2', 'k', '${"a".repeat(64)}', 1, 'text/csv', 'source_csv', 'evidence')`);
    expect(() => db.sqlite.exec("DELETE FROM archive_objects")).toThrow();
    expect(() => db.sqlite.exec(`UPDATE archive_objects SET sha256 = '${"b".repeat(64)}'`)).toThrow(/immutable/);
  });

  it("only clears inline snapshots after a matching stored R2 copy is registered", async () => {
    const snapshot = "<html>rates</html>";
    const sha = await sha256Bytes(new TextEncoder().encode(snapshot));
    db.sqlite.prepare(`INSERT INTO cooperative_fetches (id, source_key, source_url, started_at, status, raw_snapshot, snapshot_sha256)
      VALUES ('f1', 'mamcos', 'https://mamcos.info/areca-market-rates', '2026-11-01T00:00:00Z', 'succeeded', ?, ?)`).run(snapshot, sha);
    expect(() => db.sqlite.exec("UPDATE cooperative_fetches SET raw_snapshot = NULL WHERE id = 'f1'")).toThrow(/verified R2 archive copy/);
    expect(() => db.sqlite.exec("UPDATE cooperative_fetches SET raw_snapshot = 'changed' WHERE id = 'f1'")).toThrow(/immutable/);
    db.sqlite.prepare(`INSERT INTO archive_objects (id, storage, object_key, sha256, size_bytes, mime_type, category, retention_class, related_table, related_id, status)
      VALUES ('wrong', 'r2', 'k1', ?, 1, 'text/html', 'source_html', 'evidence', 'cooperative_fetches', 'f1', 'stored')`).run("c".repeat(64));
    expect(() => db.sqlite.exec("UPDATE cooperative_fetches SET raw_snapshot = NULL WHERE id = 'f1'")).toThrow(/verified R2 archive copy/);
  });
});

describe("optional R2 archive", () => {

  it("works without an ARCHIVE binding: uploads return 503 and evidence is registered inline", async () => {
    monthly("m1", "a,b\n1,2\n");
    const upload = await app.request("/api/v1/admin/archive/objects?category=quality_image", {
      method: "POST", headers: { ...auth("review"), "Content-Type": "image/png" }, body: new Uint8Array([1, 2, 3]) }, env);
    expect(upload.status).toBe(503);
    const sync = await post("/admin/archive/sync", { limit: 5 }, "review");
    expect(await sync.json()).toMatchObject({ mode: "d1_inline", registered: 1, uploaded: 0, offloaded: 0 });
    expect(await (await post("/admin/archive/sync", { limit: 5 }, "review")).json()).toMatchObject({ registered: 0 });
    const list = await (await get("/admin/archive/objects?storage=d1_inline", auth("review"))).json() as { data: { id: string; object_key: string }[] };
    expect(list.data[0].object_key).toBe("d1://monthly_refresh_runs/m1");
    expect((await get(`/admin/archive/objects/${list.data[0].id}/content`, auth("review"))).status).toBe(409);
    expect((await get("/history/monthly/snapshots/m1")).status).toBe(200);
    const status = await (await get("/admin/storage/status", auth("review"))).json() as { archive: { r2_configured: boolean } };
    expect(status.archive.r2_configured).toBe(false);
  });

  it("uploads idempotently, verifies hashes, and reports missing or corrupted objects", async () => {
    const bucket = new FakeR2();
    env.ARCHIVE = bucket as unknown as R2Bucket;
    const send = () => app.request("/api/v1/admin/archive/objects?category=quality_image&source_key=lab&file_name=sample.png", {
      method: "POST", headers: { ...auth("review"), "Content-Type": "image/png" }, body: new Uint8Array([9, 8, 7]) }, env);
    const first = await send();
    expect(first.status).toBe(201);
    const row = await first.json() as { id: string; object_key: string; sha256: string };
    expect(row.object_key).toMatch(new RegExp(`^quality_image/lab/${row.sha256.slice(0, 2)}/${row.sha256}\\.png$`));
    expect((await send()).status).toBe(200);
    expect(bucket.puts).toBe(1);
    const content = await get(`/admin/archive/objects/${row.id}/content`, auth("review"));
    expect([...new Uint8Array(await content.arrayBuffer())]).toEqual([9, 8, 7]);
    bucket.objects.get(row.object_key)!.bytes = new Uint8Array([0]);
    expect((await get(`/admin/archive/objects/${row.id}/content`, auth("review"))).status).toBe(409);
    bucket.objects.delete(row.object_key);
    expect((await get(`/admin/archive/objects/${row.id}/content`, auth("review"))).status).toBe(404);
    expect(db.sqlite.prepare("SELECT status FROM archive_objects WHERE id = ?").get(row.id)?.status).toBe("missing");
    const errors = await (await get("/admin/operations/errors?component=archive", auth("review"))).json() as { total: number };
    expect(errors.total).toBe(2);
    const rejected = await app.request("/api/v1/admin/archive/objects?category=source_csv&related_table=monthly_refresh_runs&related_id=m1", {
      method: "POST", headers: { ...auth("review"), "Content-Type": "text/csv" }, body: "forged" }, env);
    expect(rejected.status).toBe(400);
  });

  it("offloads large inline copies only after a verified R2 read-back and serves them through the fallback reader", async () => {
    const bucket = new FakeR2();
    env.ARCHIVE = bucket as unknown as R2Bucket;
    env.ARCHIVE_OFFLOAD_MIN_BYTES = "1024";
    const report = `header\n${"row,1\n".repeat(400)}`;
    monthly("m2", report);
    monthly("small", "a\n");
    const snapshot = `<html>${"x".repeat(2000)}</html>`;
    const sha = await sha256Bytes(new TextEncoder().encode(snapshot));
    db.sqlite.prepare(`INSERT INTO cooperative_fetches (id, source_key, source_url, started_at, status, raw_snapshot, snapshot_sha256)
      VALUES ('f2', 'mamcos', 'https://mamcos.info/areca-market-rates', '2026-11-01T00:00:00Z', 'succeeded', ?, ?)`).run(snapshot, sha);
    const result = await syncArchive(env, { limit: 5 });
    expect(result).toMatchObject({ mode: "r2", uploaded: 3, offloaded: 2, errors: [] });
    expect(db.sqlite.prepare("SELECT raw_report FROM monthly_refresh_runs WHERE id = 'm2'").get()?.raw_report).toBeNull();
    expect(db.sqlite.prepare("SELECT raw_report FROM monthly_refresh_runs WHERE id = 'small'").get()?.raw_report).toBe("a\n");
    const served = await get("/history/monthly/snapshots/m2");
    expect(served.status).toBe(200);
    expect(await served.text()).toBe(report);
    expect((await readRelatedText(env, "cooperative_fetches", "f2")).text).toBe(snapshot);
    // Without the binding the offloaded copy is unavailable but never silently replaced.
    const unconfigured = { ...env, ARCHIVE: undefined };
    expect((await app.request("/api/v1/history/monthly/snapshots/m2", {}, unconfigured)).status).toBe(503);
    bucket.objects.clear();
    expect((await get("/history/monthly/snapshots/m2")).status).toBe(404);
  });

  it("retains inline copies when the R2 copy cannot be verified", async () => {
    const bucket = new FakeR2();
    env.ARCHIVE = bucket as unknown as R2Bucket;
    monthly("m3", `h\n${"v,2\n".repeat(400)}`);
    expect(await syncArchive(env, { limit: 5 })).toMatchObject({ uploaded: 1, offloaded: 0 });
    for (const object of bucket.objects.values()) object.bytes = new Uint8Array([1]);
    env.ARCHIVE_OFFLOAD_MIN_BYTES = "1024";
    const result = await syncArchive(env, { limit: 5 });
    expect(result.offloaded).toBe(0);
    expect(result.errors.join()).toMatch(/hash_mismatch; inline copy retained/);
    expect(db.sqlite.prepare("SELECT raw_report IS NOT NULL AS kept FROM monthly_refresh_runs WHERE id = 'm3'").get()?.kept).toBe(1);
  });

  it("expires only temporary objects past retention and keeps shared evidence bytes", async () => {
    const bucket = new FakeR2();
    env.ARCHIVE = bucket as unknown as R2Bucket;
    env.TEMP_RETENTION_DAYS = "2";
    const upload = (category: string, body: string) => app.request(`/api/v1/admin/archive/objects?category=${category}`, {
      method: "POST", headers: { ...auth("review"), "Content-Type": "application/json" }, body }, env);
    const temporary = await (await upload("temporary_processing", "{\"tmp\":1}")).json() as { id: string; object_key: string; expires_at: string };
    const evidence = await (await upload("source_payload", "{\"keep\":1}")).json() as { id: string; object_key: string; expires_at: string | null };
    expect(evidence.expires_at).toBeNull();
    expect(await purgeExpiredTemporary(env, new Date(Date.now() + 86_400_000))).toMatchObject({ expired: 0 });
    expect(await purgeExpiredTemporary(env, new Date(Date.now() + 3 * 86_400_000))).toMatchObject({ expired: 1, errors: [] });
    expect(bucket.objects.has(temporary.object_key)).toBe(false);
    expect(bucket.objects.has(evidence.object_key)).toBe(true);
    expect((await get(`/admin/archive/objects/${temporary.id}/content`, auth("review"))).status).toBe(410);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM archive_objects").get()?.n).toBe(2);
  });
});

describe("idempotent imports and operations endpoints", () => {
  it("replays a completed key, links reprocessing, and refuses a running key", async () => {
    const body = { source_key: "agmarknet_csv", records: [record("k1")], idempotency_key: "csv:test:b0", content_sha256: "d".repeat(64), source_file_name: "export.csv" };
    const first = await post("/admin/import", body);
    expect(first.status).toBe(201);
    const created = await first.json() as { job_id: string; replayed: boolean };
    expect(created.replayed).toBe(false);
    const replay = await post("/admin/import", body);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ job_id: created.job_id, replayed: true, inserted_count: 1 });
    const reprocess = await post("/admin/import", { ...body, reprocess: true });
    expect(reprocess.status).toBe(201);
    expect(await reprocess.json()).toMatchObject({ reprocess_of: created.job_id, duplicate_count: 1, inserted_count: 0 });
    db.sqlite.prepare("UPDATE ingestion_jobs SET status = 'running' WHERE id = ?").run(created.job_id);
    expect((await post("/admin/import", body)).status).toBe(409);
    const jobs = await (await get("/admin/ingestion/jobs?limit=10", auth("review"))).json() as { data: { idempotency_key: string; content_sha256: string }[]; total: number };
    expect(jobs.total).toBe(2);
    expect(jobs.data.every((job) => job.content_sha256 === "d".repeat(64))).toBe(true);
    const detail = await (await get(`/admin/ingestion/jobs/${created.job_id}`, auth("review"))).json() as { job: { id: string } };
    expect(detail.job.id).toBe(created.job_id);
    expect((await post("/admin/import", { ...body, idempotency_key: "bad key with spaces" })).status).toBe(400);
  });

  it("requires the reviewer token on every operations endpoint", async () => {
    for (const path of ["/admin/ingestion/jobs", "/admin/operations/errors", "/admin/storage/status", "/admin/archive/objects"]) {
      expect((await get(path)).status).toBe(401);
      expect((await get(path, auth("import"))).status).toBe(401);
    }
    for (const path of ["/admin/archive/sync", "/admin/retention/purge", "/admin/summaries/rebuild"]) {
      expect((await post(path, {}, "import")).status).toBe(401);
    }
  });

  it("persists scheduled maintenance failures without failing the source schedule", async () => {
    const failing = { ...env, ARCHIVE_SCHEDULE_ENABLED: "true", ARCHIVE: { head: () => { throw new Error("r2 down"); } } as unknown as R2Bucket };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T03:30:00Z"));
    monthly("m4", "a\n");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await worker.scheduled({} as ScheduledEvent, failing, {} as ExecutionContext).catch(() => undefined);
    fetchMock.mockRestore(); log.mockRestore(); warn.mockRestore();
    const errors = db.sqlite.prepare("SELECT component, message FROM operational_errors WHERE component = 'archive'").all();
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("backup restore check", () => {
  it("replays a dump with a child-before-parent order and detects tampering and count drift", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    // @ts-expect-error untyped repository script
    const { restoreCheck } = await import("../../scripts/d1-restore-check.mjs");
    const dir = mkdtempSync(join(tmpdir(), "ani-restore-"));
    const dump = `PRAGMA foreign_keys=OFF;
CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id));
INSERT INTO child VALUES ('c1','p1');
CREATE TABLE parent (id TEXT PRIMARY KEY);
INSERT INTO parent VALUES ('p1');
`;
    writeFileSync(join(dir, "dump.sql"), dump);
    const sha = createHash("sha256").update(dump).digest("hex");
    const manifest = (counts: Record<string, number>, digest = sha) => {
      const path = join(dir, `m-${Math.random()}.json`);
      writeFileSync(path, JSON.stringify({ format: "ani-d1-backup/1", dump_file: "dump.sql", dump_sha256: digest, table_counts: counts }));
      return path;
    };
    expect(restoreCheck(manifest({ child: 1, parent: 1 }))).toMatchObject({ ok: true, tables: 2, rows: 2 });
    expect(restoreCheck(manifest({ child: 2, parent: 1 })).ok).toBe(false);
    expect(restoreCheck(manifest({ child: 1, parent: 1 }, "0".repeat(64))).ok).toBe(false);
    writeFileSync(join(dir, "dump.sql"), dump.replace("INSERT INTO parent VALUES ('p1');", ""));
    const orphan = restoreCheck(manifest({ child: 1, parent: 0 }, createHash("sha256").update(dump.replace("INSERT INTO parent VALUES ('p1');", "")).digest("hex")));
    expect(orphan.ok).toBe(false);
    expect(orphan.failures.join()).toMatch(/foreign/i);
  });
});

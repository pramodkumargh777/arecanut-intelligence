import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app, type Env } from "./index";
import { parseCsv } from "./monthly";
import { toCsv } from "../../frontend/src/services/csv";
import { refreshMonthly } from "./monthly";

class LocalStatement {
  constructor(private db: LocalDatabase, private sql: string, private args: SQLInputValue[] = []) {}
  bind(...args: SQLInputValue[]) { return new LocalStatement(this.db, this.sql, args); }
  execute() {
    const rows = this.db.sqlite.prepare(this.sql).all(...this.args);
    const changes = Number(this.db.sqlite.prepare("SELECT changes() AS count").get()?.count ?? 0);
    return { results: rows, success: true, meta: { changes } };
  }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
  async first() {
    const row = this.execute().results[0] ?? null;
    if (this.sql.startsWith("SELECT * FROM market_price_observations") && this.db.afterObservationRead) {
      const callback = this.db.afterObservationRead;
      this.db.afterObservationRead = undefined;
      await callback();
    }
    return row;
  }
}

class LocalDatabase {
  sqlite = new DatabaseSync(":memory:");
  afterObservationRead?: () => Promise<void>;
  prepare(sql: string) { return new LocalStatement(this, sql); }
  async batch(statements: LocalStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

let db: LocalDatabase;
let env: Env["Bindings"];
beforeEach(() => {
  db = new LocalDatabase();
  for (const file of readdirSync("migrations").filter((file) => file.endsWith(".sql")).sort()) {
    db.sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  // The adapter implements the D1 methods exercised by the actual HTTP handlers.
  env = { DB: db as unknown as D1Database, INGESTION_TOKEN: "import", ADMIN_TOKEN: "review", MIN_INDEX_MARKETS: "3" };
});
afterEach(() => { db.sqlite.close(); vi.unstubAllGlobals(); });

function record(id = "a", modal = 44000) {
  return {
    id, source_record_id: "source-1", market_id: "market-1", market_name: "Sagar", district: "Shivamogga", state: "Karnataka",
    reporting_date: "2026-10-30", commodity_name: "Arecanut", original_commodity_name: "Arecanut(Betelnut/Supari)",
    variety_name: "Rashi", original_variety_name: "Rashi", minimum_price: 40000, maximum_price: 50000, modal_price: modal,
    arrival_quantity: null, arrival_unit: null, original_unit: "Rs./Quintal", price_unit: "INR/quintal",
    validation_status: "validated", validation_message: null as string | null, raw_payload: JSON.stringify({ modal }),
  };
}
async function post(path: string, body: unknown, token = "import") {
  return app.request(`/api/v1${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }, env);
}
const ingest = (rows = [record()]) => post("/admin/import", { source_key: "agmarknet_csv", records: rows });
const review = (id: string, action = "approve") => post(`/admin/observations/${id}/review`, { action }, "review");

describe("actual daily handlers with migrated SQLite", () => {
  it("supports A → B → A replay and idempotent repeats without losing the current record", async () => {
    expect((await ingest()).status).toBe(201);
    expect((await review("a")).status).toBe(200);
    expect((await ingest([record("b", 45000)])).status).toBe(201);
    const replay = await ingest();
    expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ inserted_count: 1, corrected_count: 1 });
    expect(db.sqlite.prepare("SELECT id, validation_status FROM market_price_observations WHERE validation_status != 'superseded'").all())
      .toEqual([{ id: "a", validation_status: "validated" }]);
    expect(await (await ingest()).json()).toMatchObject({ inserted_count: 0, corrected_count: 0, duplicate_count: 1 });
    expect((await review("a")).status).toBe(200);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM source_record_versions").get()?.count).toBe(2);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM observation_reviews").get()?.count).toBe(2);
  });
  it("does not resurrect a superseded record when a correction arrives during review", async () => {
    await ingest();
    db.afterObservationRead = async () => { expect((await ingest([record("b", 45000)])).status).toBe(201); };
    expect((await review("a")).status).toBe(409);
    expect((await review("b")).status).toBe(200);
    expect(db.sqlite.prepare("SELECT id FROM market_price_observations WHERE validation_status = 'verified'").all()).toEqual([{ id: "b" }]);
    expect(db.sqlite.prepare("SELECT observation_id FROM observation_reviews").all()).toEqual([{ observation_id: "b" }]);
  });
  it("rejects invalid publication even for review_required rows, retaining evidence and a rejection audit", async () => {
    const invalid = { ...record(), minimum_price: 49000, modal_price: 45000, validation_status: "review_required", validation_message: "Invalid source range" };
    expect((await ingest([invalid])).status).toBe(201);
    expect((await review("a")).status).toBe(409);
    const queue = await (await app.request("/api/v1/admin/quality", { headers: { Authorization: "Bearer review" } }, env)).json();
    expect(queue).toMatchObject({ data: [{ validation_message: "Invalid source range", raw_payload: invalid.raw_payload, original_unit: "Rs./Quintal" }] });
    expect((await review("a", "reject")).status).toBe(200);
    expect(db.sqlite.prepare("SELECT action, previous_status, validation_message, reviewer FROM observation_reviews").get())
      .toEqual({ action: "reject", previous_status: "review_required", validation_message: "Invalid source range", reviewer: "shared-reviewer-token" });
    expect(() => db.sqlite.exec("UPDATE market_price_observations SET validation_status = 'verified'")).toThrow("Invalid observation");
  });
  it("accepts capitalization changes for the same market ID", async () => {
    await ingest();
    const corrected = { ...record("b", 45000), market_name: "SAGAR" };
    expect((await ingest([corrected])).status).toBe(201);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM markets").get()?.count).toBe(1);
  });
  it("does not publish future reports or allow duplicate reviews", async () => {
    const future = { ...record(), reporting_date: "9999-01-01", validation_status: "review_required" };
    expect((await ingest([future])).status).toBe(201);
    expect((await review("a")).status).toBe(409);
    expect((await review("a", "reject")).status).toBe(200);
    expect((await review("a", "reject")).status).toBe(404);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM observation_reviews").get()?.count).toBe(1);
  });
  it("populates every daily read surface only after review, with the three-market rule intact", async () => {
    const rows = [];
    for (let day = 29; day <= 30; day++) {
      for (let market = 1; market <= 3; market++) {
        rows.push({ ...record(`day-${day}-market-${market}`, 42000 + market * 1000 + (day - 29) * 100),
          source_record_id: `${day}-${market}`, reporting_date: `2026-10-${day}`,
          market_id: `market-${market}`, market_name: `Market ${market}` });
      }
    }
    expect((await ingest(rows)).status).toBe(201);
    expect(await (await app.request("/api/v1/prices", {}, env)).json()).toMatchObject({ count: 0 });
    for (const row of rows) expect((await review(row.id)).status).toBe(200);
    expect(await (await app.request("/api/v1/prices", {}, env)).json()).toMatchObject({ count: 6 });
    expect(await (await app.request("/api/v1/varieties", {}, env)).json()).toEqual({ data: ["Rashi"] });
    const markets = await app.request("/api/v1/markets", {}, env);
    expect(await markets.json()).toMatchObject({ data: [{ name: "Market 1" }, { name: "Market 2" }, { name: "Market 3" }] });
    expect(await (await app.request("/api/v1/analytics/reference-index?variety=Rashi", {}, env)).json()).toMatchObject({
      minimum_market_coverage: 3, data: [
        { reporting_date: "2026-10-29", market_count: 3, median_modal_price: 44000 },
        { reporting_date: "2026-10-30", market_count: 3, median_modal_price: 44100 },
      ],
    });
    expect(await (await app.request("/api/v1/overview?variety=Rashi", {}, env)).json()).toMatchObject({
      data: { reference_price: 44100, previous_reference_price: 44000, absolute_change: 100, reporting_markets: 3, index_status: "available" },
    });
    expect(await (await app.request("/api/v1/analytics/market-comparison?variety=Rashi", {}, env)).json()).toMatchObject({
      data: [{ market_name: "Market 3", modal_price: 45100 }, { market_name: "Market 2", modal_price: 44100 }, { market_name: "Market 1", modal_price: 43100 }],
    });
  });
  it("serializes concurrent corrections with a single active version", async () => {
    await ingest();
    const responses = await Promise.all([ingest([record("b", 45000)]), ingest([record("c", 46000)])]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM market_price_observations WHERE validation_status != 'superseded'").get()?.count).toBe(1);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM source_record_versions").get()?.count).toBe(2);
  });
  it("keeps all constituents beyond 10,000 rows and uses the latest eligible prior index", async () => {
    await ingest(); await review("a");
    const base = db.sqlite.prepare("SELECT * FROM market_price_observations").get()!;
    const columns = Object.keys(base);
    const insert = db.sqlite.prepare(`INSERT INTO market_price_observations (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
    const add = (i: number, date: string, price: number, market: string) => {
      const row = { ...base, id: `row-${i}`, source_record_id: `src-${i}`, market_id: market, reporting_date: date, modal_price: price, minimum_price: 0, maximum_price: 100000 };
      insert.run(...columns.map((column) => row[column as keyof typeof row] as SQLInputValue));
    };
    db.sqlite.exec("DELETE FROM observation_reviews; DELETE FROM market_price_observations");
    for (let i = 1; i < 4; i++) db.sqlite.prepare("INSERT INTO markets(id,name,district,state,mapping_status) VALUES(?,?, 'Shivamogga','Karnataka','verified')").run(`market-${i + 1}`, `Market ${i}`);
    for (let i = 0; i < 4; i++) add(i, "2026-10-01", [100, 200, 1000, 2000][i], `market-${i + 1}`);
    for (let i = 4; i < 10002; i++) add(i, "2026-10-02", 40000, `market-${i % 4 + 1}`);
    const response = await app.request("/api/v1/analytics/reference-index?variety=Rashi", {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: [
      { reporting_date: "2026-10-01", market_count: 4, median_modal_price: 600 },
      { reporting_date: "2026-10-02", market_count: 4, median_modal_price: 40000 },
    ] });
    add(10002, "2026-10-03", 41000, "market-1");
    const overview = await (await app.request("/api/v1/overview?variety=Rashi", {}, env)).json();
    expect(overview).toMatchObject({ data: { reference_price: null, previous_reference_price: 40000, index_status: "insufficient_coverage" } });
  });
});

it("round-trips CSV quotes, newlines and commas with a CSV parser", () => {
  const rows = [["market", "price"], ['Sagar "APMC", Main\nYard', 44000]];
  expect(parseCsv(toCsv(rows))).toEqual([["market", "price"], ['Sagar "APMC", Main\nYard', "44000"]]);
});

describe("cooperative source publication and provenance", () => {
  const makeHtml = (price = 44000) => {
    const rows = [
      { itemname: "RASHI EDI", minprice: "40000", maxprice: "50000", avgprice: String(price), branch: "SHIVAMOGGA", Date: "02-November-2026" },
      { itemname: "RASHI EDI", minprice: "40000", maxprice: "50000", avgprice: "45000", branch: "SAGARA", Date: "02-November-2026" },
      { itemname: "RASHI EDI", minprice: "40000", maxprice: "50000", avgprice: "46000", branch: "Tarikere", Date: "02-November-2026" },
      { itemname: "BETTE", minprice: "40000", maxprice: "50000", avgprice: "51000", branch: "JAYAPURA", Date: "02-November-2026" },
    ];
    return `<div wire:snapshot="${JSON.stringify({ data: { rates: [rows.map((row) => [row, {}]), {}] } }).replace(/"/g, "&quot;")}"></div>All market rates are in ₹ per Quintal`;
  };
  it("archives, deduplicates, reviews, publishes and corrects average quotations separately from modal prices", async () => {
    let html = makeHtml();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(html, { headers: { "content-type": "text/html" } })));
    const refresh = () => post("/admin/cooperative/refresh", {}, "review");
    expect(await (await refresh()).json()).toMatchObject({ received_count: 4, inserted_count: 4, invalid_count: 1 });
    expect(await (await refresh()).json()).toMatchObject({ inserted_count: 0 });
    const getQuotes = () => app.request("/api/v1/cooperative/prices?source=mamcos", {}, env);
    expect(await (await getQuotes()).json()).toMatchObject({ data: [] });
    const quotes = db.sqlite.prepare("SELECT id,status FROM cooperative_quotes").all();
    expect(() => db.sqlite.prepare("UPDATE cooperative_quotes SET status='verified' WHERE status='invalid'").run()).toThrow("cannot be published");
    expect(() => db.sqlite.prepare(`INSERT INTO cooperative_quotes
      (id,source_key,branch,reporting_date,variety,minimum_price,maximum_price,average_price,
       price_type,price_unit,source_url,fetched_at,fetch_id,raw_record,validation_message,status)
      SELECT 'invalid-copy',source_key,branch,reporting_date,variety,minimum_price,maximum_price,average_price,
      price_type,price_unit,source_url,fetched_at,fetch_id,raw_record,validation_message,'verified'
      FROM cooperative_quotes WHERE status='invalid'`).run()).toThrow("cannot be published");
    for (const quote of quotes) {
      const response = await post(`/admin/cooperative/${quote.id}/review`, { action: "approve" }, "review");
      expect(response.status).toBe(quote.status === "invalid" ? 409 : 200);
    }
    expect(await (await getQuotes()).json()).toMatchObject({
      variety: "RASHI EDI", reference_price: 45000, minimum_branch_coverage: 3,
      series: [{ reporting_date: "2026-11-02", branch_count: 3, median_average_price: 45000 }],
    });

    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM market_price_observations").get()?.count).toBe(0);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM cooperative_reviews").get()?.count).toBe(3);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM cooperative_fetches WHERE raw_snapshot IS NOT NULL").get()?.count).toBe(2);
    html = makeHtml(44500);
    expect(await (await refresh()).json()).toMatchObject({ inserted_count: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM cooperative_quotes WHERE status='superseded'").get()?.count).toBe(1);
    expect(await (await getQuotes()).json()).toMatchObject({ reference_price: null });
    html = makeHtml();
    expect(await (await refresh()).json()).toMatchObject({ inserted_count: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM cooperative_quotes WHERE status='pending'").get()?.count).toBe(1);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM cooperative_quotes WHERE status!='superseded'").get()?.count).toBe(4);
  });
  it("does not erase prior snapshots on source failures, rejects unauthenticated refresh and exposes failed status", async () => {
    expect((await post("/admin/cooperative/refresh", {})).status).toBe(401);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("source unavailable", { status: 503 })));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post("/admin/cooperative/refresh", {}, "review")).status).toBe(502);
    log.mockRestore();
    expect(db.sqlite.prepare("SELECT status FROM cooperative_fetches").get()?.status).toBe("failed");
    expect((await app.request("/api/v1/cooperative/prices?source=unknown", {}, env)).status).toBe(400);
  });
});

describe("TSS source routes with migrated storage", () => {
  const row = { date1: "2026-11-03", iname: "RASHI", iname_en: "RASHI", itemcode: 1, mnrate: 44099, mxrate: 47299, avgrate: 46055, norrate: 45699 };
  const refresh = (body: unknown = { date: "2026-11-03", accept_assumed_unit: true }) => post("/admin/cooperative/tss/refresh", body, "review");
  it("requires authentication and explicit assumed-unit acknowledgement; rejects invalid dates", async () => {
    expect((await post("/admin/cooperative/tss/refresh", {})).status).toBe(401);
    for (const body of [{ date: "2026-11-03" }, { date: "2026-02-31", accept_assumed_unit: true }, { date: "9999-01-01", accept_assumed_unit: true }]) {
      expect((await refresh(body)).status).toBe(400);
    }
  });
  it("publishes only reviewed supported items with assumed units and no benchmark contamination", async () => {
    let average = 46055;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      success: true, data: [{ ...row, avgrate: average }, { ...row, iname_en: "PEPPER" }],
    }), { headers: { "content-type": "application/json" } })));
    expect(await (await refresh()).json()).toMatchObject({ received_count: 6, inserted_count: 3, excluded_count: 3 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM cooperative_fetches WHERE raw_snapshot LIKE '%PEPPER%'").get()?.count).toBe(3);
    const read = () => app.request("/api/v1/cooperative/prices?source=tss", {}, env);
    expect(await (await read()).json()).toMatchObject({ data: [], series: [] });
    const quotes = db.sqlite.prepare("SELECT id FROM cooperative_quotes WHERE source_key='tss'").all();
    for (const quote of quotes) expect((await post(`/admin/cooperative/${quote.id}/review`, { action: "approve" }, "review")).status).toBe(200);
    const published = await (await read()).json();
    expect(published).toMatchObject({ variety: "RASHI", series: [], reference_price: null,
      data: expect.arrayContaining([expect.objectContaining({ unit_status: "assumed", normal_price: 45699, average_price: 46055 })]) });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM cooperative_quotes WHERE status='verified'").get()?.count).toBe(3);
    expect(() => db.sqlite.prepare("UPDATE cooperative_quotes SET unit_status='source_confirmed' WHERE source_key='tss'").run()).toThrow("explicitly assumed");
    expect(await (await refresh()).json()).toMatchObject({ inserted_count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM cooperative_quotes WHERE status='verified'").get()?.count).toBe(3);
    average = 46500;
    expect(await (await refresh()).json()).toMatchObject({ inserted_count: 3 });
    expect(await (await read()).json()).toMatchObject({ data: [], series: [] });
    average = 46055;
    expect(await (await refresh()).json()).toMatchObject({ inserted_count: 3 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM cooperative_quotes WHERE status='pending'").get()?.count).toBe(3);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM market_price_observations").get()?.count).toBe(0);
    expect(await (await app.request("/api/v1/cooperative/prices?source=mamcos", {}, env)).json()).toMatchObject({ data: [] });
  });
  it("retains successful locations and records failed locations explicitly on a partial refresh", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => url.includes("Siddapur")
      ? new Response("unavailable", { status: 503 })
      : new Response(JSON.stringify({ success: true, data: [row] }), { headers: { "content-type": "application/json" } })));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await refresh()).status).toBe(502);
    log.mockRestore();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM cooperative_fetches WHERE status='succeeded'").get()?.count).toBe(2);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM cooperative_fetches WHERE status='failed'").get()?.count).toBe(1);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM cooperative_quotes WHERE status='pending'").get()?.count).toBe(2);
  });
});

describe("historical snapshots and private calculation persistence", () => {
  const monthlyReport = (value: string, includeRashi = true) => `,,,"State/UT-wise & Variety-wise Prices Monthly Analysis for Arecanut(Betelnut/Supari) - October, 2026",,
Variety,"Prices October, 2026 (Rs./Quintal)","Prices September, 2026 (Rs./Quintal)","Prices October, 2025 (Rs./Quintal)",Change (Over Previous Month),Change (Over Previous Year)
Karnataka,,,,,
${includeRashi ? `Rashi,${value},-,-,-,-\n` : ""}Other,100,-,-,-,-
Note:
Weighted Average Price = ∑(arrival quantity * modal price) / ∑arrival quantity
`;
  it("retains corrected, repeated, null and removed-variety monthly snapshots without filling calendar gaps", async () => {
    let text = monthlyReport("47174.91");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(text, { headers: { "content-type": "text/csv" } })));
    await refreshMonthly(env.DB, "2026-10", "Karnataka");
    text = monthlyReport("48000");
    await refreshMonthly(env.DB, "2026-10", "Karnataka");
    await refreshMonthly(env.DB, "2026-10", "Karnataka");
    text = monthlyReport("-");
    await refreshMonthly(env.DB, "2026-10", "Karnataka");
    const read = () => app.request("/api/v1/history/monthly?from=2026-09&to=2026-10&variety=Rashi", {}, env);
    expect(await (await read()).json()).toMatchObject({
      observed_months: 0, reporting_months: 1, expected_months: 2,
      points: [{ reporting_month: "2026-09", status: "report_missing" }, { reporting_month: "2026-10", status: "price_missing" }],
      versions: expect.arrayContaining([expect.objectContaining({ weighted_price: 47174.91 }), expect.objectContaining({ weighted_price: 48000 }), expect.objectContaining({ weighted_price: null })]),
    });
    text = monthlyReport("1", false);
    await refreshMonthly(env.DB, "2026-10", "Karnataka");
    expect(await (await read()).json()).toMatchObject({ points: [{ status: "report_missing" }, { status: "variety_missing" }],
      versions: expect.arrayContaining([expect.objectContaining({ variety_present: 0 })]) });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM monthly_price_versions WHERE variety_name='Rashi'").get()?.count).toBe(4);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM monthly_refresh_runs WHERE raw_report IS NOT NULL").get()?.count).toBe(5);
    const firstCapture = db.sqlite.prepare("SELECT id FROM monthly_refresh_runs ORDER BY rowid LIMIT 1").get()?.id;
    const archived = await app.request(`/api/v1/history/monthly/snapshots/${firstCapture}`, {}, env);
    expect(archived.status).toBe(200);
    expect(await archived.text()).toContain("47174.91");
    const compact = await (await app.request("/api/v1/monthly-prices?month=2026-10&variety=Rashi", {}, env)).json();
    expect(compact).toMatchObject({ history: expect.arrayContaining([expect.objectContaining({ reporting_month: "2026-09", weighted_price: null, fetched_at: null })]) });
    expect((await app.request("/api/v1/history/monthly/snapshots/missing", {}, env)).status).toBe(404);
    expect((await app.request("/api/v1/history/monthly?from=2026-10&to=2026-09", {}, env)).status).toBe(400);
    expect((await app.request("/api/v1/history/aggregates?source=tss&variety=RASHI&branch=Sirsi&from=2026-02-31&to=2026-03-01&interval=weekly", {}, env)).status).toBe(400);
  });
  const inputs = {
    name: "Synthetic persistence regression only", quantity_quintals: 10, commission_percent: 2, transport_cost: 1000, other_selling_cost: 500,
    area_hectares: 2, production_cost: 250000, byproduct_income: 10000, hold_days: 90, annual_finance_percent: 10,
    storage_cost: 2000, weight_loss_percent: 2, scenario_price: 52000, price: { kind: "manual", value: 50000 },
  };
  it("authenticates private scenario read/save, recomputes results server-side and preserves snapshots", async () => {
    expect((await post("/admin/decisions", inputs)).status).toBe(401);
    expect((await app.request("/api/v1/admin/decisions", {}, env)).status).toBe(401);
    expect((await post("/decisions/calculate", { ...inputs, quantity_quintals: 0 })).status).toBe(400);
    expect((await post("/decisions/calculate", { ...inputs, production_cost: 1e-300, price: { kind: "manual", value: 1e8 } })).status).toBe(422);
    expect(await (await post("/decisions/calculate", inputs)).json()).toMatchObject({ results: { net_realization: 488500, farm_profit: 248500 } });
    const saved = await post("/admin/decisions", inputs, "review");
    expect(saved.status).toBe(201);
    const stored = await saved.json();
    expect(stored).toMatchObject({ inputs, price: { value: 50000, unit_status: "user_entered" }, results: { net_realization: 488500 }, formula_version: "net-realization-v1" });
    const reloaded = await app.request("/api/v1/admin/decisions", { headers: { Authorization: "Bearer review" } }, env);
    expect(await reloaded.json()).toMatchObject({ data: [stored] });
    expect((await post("/admin/decisions", { ...inputs, results: { net_realization: 1e9 } }, "review")).status).toBe(400);
    expect((await post("/decisions/calculate", { ...inputs, price: { kind: "cooperative", id: "missing" } })).status).toBe(409);
  });
  it("pins a monthly price version and keeps a saved scenario unchanged after correction", async () => {
    let text = monthlyReport("50000");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(text, { headers: { "content-type": "text/csv" } })));
    await refreshMonthly(env.DB, "2026-10", "Karnataka");
    const version = db.sqlite.prepare("SELECT refresh_run_id FROM monthly_variety_prices WHERE variety_name='Rashi'").get()?.refresh_run_id;
    const sourced = { ...inputs, price: { kind: "monthly", month: "2026-10", variety: "Rashi", refresh_run_id: version } };
    expect((await post("/admin/decisions", sourced, "review")).status).toBe(201);
    text = monthlyReport("60000");
    await refreshMonthly(env.DB, "2026-10", "Karnataka");
    expect((await post("/decisions/calculate", sourced)).status).toBe(409);
    const reloaded = await app.request("/api/v1/admin/decisions", { headers: { Authorization: "Bearer review" } }, env);
    expect(await reloaded.json()).toMatchObject({ data: [{ price: { value: 50000, price_type: "monthly_weighted_modal" }, results: { net_realization: 488500 } }] });
    const publicOptions = await app.request("/api/v1/decisions/prices", {}, env);
    expect(await publicOptions.json()).toMatchObject({ monthly: expect.arrayContaining([expect.objectContaining({ weighted_price: 60000 })]) });
  });
});

describe("independent intelligence handlers and evaluated forecasts", () => {
  it("isolates quality report submission, review and immutable evidence from market-price review", async () => {
    const input = { lot_id: "TEST ONLY", variety: "Rashi", location: "Sirsi", sampled_on: "2026-10-01", reported_on: "2026-10-02",
      laboratory: "Synthetic test lab", report_reference: "test-1", evidence_url: "https://example.com/report",
      moisture_percent: 8, defects_percent: null, notes: "Synthetic regression only, never persisted to demo." };
    expect((await post("/admin/intelligence/quality", input)).status).toBe(401);
    expect((await post("/admin/intelligence/quality", { ...input, evidence_url: "javascript:alert(1)" }, "review")).status).toBe(400);
    expect((await post("/admin/intelligence/quality", { ...input, sampled_on: "2026-02-30" }, "review")).status).toBe(400);
    expect((await post("/admin/intelligence/quality", { ...input, moisture_percent: null }, "review")).status).toBe(400);
    const response = await post("/admin/intelligence/quality", input, "review");
    expect(response.status).toBe(201);
    const body = await response.json() as { id: string };
    expect((await post("/admin/intelligence/quality", input, "review")).status).toBe(409);
    expect(await (await app.request("/api/v1/intelligence/quality/records", {}, env)).json()).toMatchObject({ data: [] });
    expect((await post(`/admin/intelligence/quality/${body.id}/review`, { action: "verify", note: "" }, "review")).status).toBe(400);
    expect((await post(`/admin/intelligence/quality/${body.id}/review`, { action: "verify", note: "Evidence checked in test." }, "review")).status).toBe(200);
    expect(await (await app.request("/api/v1/intelligence/quality/records", {}, env)).json()).toMatchObject({ data: [{ ...input, status: "verified", review_note: "Evidence checked in test." }] });
    expect((await post(`/admin/intelligence/quality/${body.id}/review`, { action: "reject", note: "Stale action" }, "review")).status).toBe(409);
    expect(() => db.sqlite.exec("UPDATE quality_inspections SET moisture_percent=1")).toThrow("immutable");
    expect((await ingest()).status).toBe(201);
    expect((await app.request("/api/v1/admin/intelligence/quality", {}, env)).status).toBe(401);
  });
  it("archives Sirsi model output atomically, retaining good data and explicit audit after source failure", async () => {
    const dates = Array.from({ length: 14 }, (_, index) => new Date(Date.UTC(2026, 9, 28 + index)).toISOString().slice(0, 10));
    const body = { latitude: 14.65, longitude: 74.86, elevation: 595, timezone: "Asia/Kolkata",
      daily_units: { time: "iso8601", temperature_2m_max: "°C", temperature_2m_min: "°C", precipitation_sum: "mm" },
      daily: { time: dates, temperature_2m_max: dates.map(() => 30), temperature_2m_min: dates.map(() => 20), precipitation_sum: dates.map(() => 0) } };
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-04T00:00:00Z"));
    try {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
      expect((await post("/admin/intelligence/weather/refresh", {}, "review")).status).toBe(201);
      let data = await (await app.request("/api/v1/intelligence/weather", {}, env)).json() as { data: { capture_id: string }[] };
      expect(data.data).toHaveLength(14);
      const capture = await app.request(`/api/v1/intelligence/captures/${data.data[0].capture_id}`, {}, env);
      expect(JSON.parse(await capture.text())).toEqual(body);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 })));
      expect((await post("/admin/intelligence/weather/refresh", {}, "review")).status).toBe(502);
      data = await (await app.request("/api/v1/intelligence/weather", {}, env)).json() as typeof data;
      expect(data.data).toHaveLength(14);
      expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM intelligence_refresh_runs WHERE status='failed'").get()?.count).toBe(1);
      expect(() => db.sqlite.exec("UPDATE intelligence_captures SET raw_payload='changed'")).toThrow("immutable");
      expect((await app.request("/api/v1/intelligence/captures/missing", {}, env)).status).toBe(404);
    } finally { vi.useRealTimers(); }
  });
  it("stores separately dated news/policy records, safe archive downloads and partial source failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("dasd.kerala")) return new Response('<h1>Second Advance Estimates for 2025-26</h1><span itemprop="datePublished"> July 18, 2026 </span>Spices-Areca-Betel-2025-26-Second-Advance-consolidated.pdf');
      const id = url.includes("2159561") ? "2159561" : "2156521";
      return new Response(`<h1>Areca nut ${id === "2156521" ? "tariff notification" : "development meeting"}</h1>14 AUG 2025 7:14PM Release ID ${id}
        ${id === "2159561" ? "In 2023-24, India exported 10,637 tonnes of areca nuts worth ₹400 crore." : ""}`);
    }));
    expect((await post("/admin/intelligence/news/refresh", {}, "review")).status).toBe(201);
    const news = await (await app.request("/api/v1/intelligence/news", {}, env)).json() as { data: { capture_id: string }[] };
    expect(news.data).toHaveLength(3);
    expect(await (await app.request("/api/v1/intelligence/trade", {}, env)).json()).toMatchObject({ data: [{ direction: "Export", quantity_tonnes: 10637, value_inr_lakh: 40000 }] });
    expect(await (await app.request("/api/v1/intelligence/policy", {}, env)).json()).toMatchObject({ data: [{ published_on: "2025-08-14", is_policy: 1 }] });
    const capture = await app.request(`/api/v1/intelligence/captures/${news.data[0].capture_id}`, {}, env);
    expect(capture.headers.get("content-type")).toBe("application/octet-stream");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 })));
    expect((await post("/admin/intelligence/news/refresh", {}, "review")).status).toBe(502);
    expect((await (await app.request("/api/v1/intelligence/news", {}, env)).json() as typeof news).data).toHaveLength(3);
  });
  it("gates forecast publication, persists evaluated source inputs and suppresses revised-history snapshots", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-04T00:00:00Z"));
    try {
      expect((await post("/admin/forecasts/evaluate", { variety: "Rashi" })).status).toBe(401);
      expect(await (await app.request("/api/v1/forecasts?variety=Rashi", {}, env)).json()).toMatchObject({ status: "not_evaluated", forecast: null });
      expect(await (await post("/admin/forecasts/evaluate", { variety: "Rashi" }, "review")).json()).toMatchObject({ status: "withheld", forecast: null });
      for (let index = 0; index < 70; index++) {
        const month = new Date(Date.UTC(2021, index, 1)).toISOString().slice(0, 7), id = `test-${index}`;
        db.sqlite.prepare("INSERT INTO monthly_refresh_runs(id,reporting_month,state,source_url,started_at,status) VALUES(?,?,'Karnataka','https://example.com','2026-11-01','succeeded')").run(id, month);
        db.sqlite.prepare("INSERT INTO monthly_variety_prices VALUES(?,'Karnataka','Rashi',50000,'INR/quintal','https://example.com','2026-11-01',?)").run(month, id);
      }
      db.sqlite.exec("INSERT INTO monthly_price_versions SELECT refresh_run_id,reporting_month,state,variety_name,weighted_price,price_unit,source_url,fetched_at FROM monthly_variety_prices");
      const saved = await post("/admin/forecasts/evaluate", { variety: "Rashi" }, "review");
      expect(saved.status).toBe(201);
      expect(await saved.json()).toMatchObject({ status: "published", forecast: { reporting_month: "2026-11", point: 50000 } });
      expect(await (await app.request("/api/v1/forecasts?variety=Rashi", {}, env)).json()).toMatchObject({ status: "published", stale: false });
      db.sqlite.exec("UPDATE monthly_variety_prices SET weighted_price=51000 WHERE reporting_month='2026-10'");
      expect(await (await app.request("/api/v1/forecasts?variety=Rashi", {}, env)).json()).toMatchObject({ status: "stale", stale: true, forecast: null, stale_reasons: ["source_history_changed"] });
      expect(() => db.sqlite.exec("UPDATE forecast_snapshots SET formula_version='tampered'")).toThrow("immutable");
    } finally { vi.useRealTimers(); }
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations, LocalDatabase } from "./test-support/local-d1";
import { app, type Env } from "./index";
import { refreshMonthly } from "./monthly";
import { searchDocuments } from "./assistant/retrieval";

// End-to-end regressions over the real migrations for failures that unit tests of each module did not catch.
let db: LocalDatabase;
let env: Env["Bindings"];
const authHeader = (token: string) => ({ Authorization: ["Bearer", token].join(" ") });
const post = (path: string, body: unknown, token: string) => app.request(`/api/v1${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...authHeader(token) }, body: JSON.stringify(body),
}, env);
const get = async <T = any>(path: string) => (await app.request(`/api/v1${path}`, {}, env)).json() as Promise<T>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  db = applyMigrations(new LocalDatabase());
  env = { DB: db as never, ADMIN_TOKEN: "review", INGESTION_TOKEN: "import", REFERENCE_STATE: "Karnataka" };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("daily monthly refresh and published forecasts", () => {
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const label = (year: number, month: number) => `${MONTHS[month - 1]}, ${year}`;
  let override: number | null = null;
  const price = (year: number, month: number) => (year === 2026 && month === 10 && override) || 40000 + (year - 2021) * 1200 + month * 37;

  function stubSource() {
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input), year = Number(url.searchParams.get("year")), month = Number(url.searchParams.get("month"));
      const [prevYear, prevMonth] = month === 1 ? [year - 1, 12] : [year, month - 1];
      return new Response([
        `"State/UT-wise & Variety-wise Prices Monthly Analysis for Arecanut(Betelnut/Supari) - ${label(year, month)}"`,
        `Variety,"Prices ${label(year, month)} (Rs./Quintal)","Prices ${label(prevYear, prevMonth)} (Rs./Quintal)","Prices ${label(year - 1, month)} (Rs./Quintal)",Change (Over Previous Month),Change (Over Previous Year)`,
        "Karnataka,,,,,", `Rashi,${price(year, month)},1,1,0,0`, "Note:",
        "Weighted Average Price = ∑(arrival quantity * modal price) / ∑ arrival quantity",
      ].join("\n"), { headers: { "content-type": "text/csv" } });
    });
  }

  it("keeps a forecast published through an unchanged re-fetch and suppresses it when a price is revised", async () => {
    override = null;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T06:00:00Z"));
    stubSource();
    for (let year = 2021; year <= 2026; year += 1) {
      for (let month = 1; month <= (year === 2026 ? 10 : 12); month += 1) {
        await refreshMonthly(db as never, `${year}-${String(month).padStart(2, "0")}`, "Karnataka");
      }
    }
    expect((await post("/admin/forecasts/evaluate", { variety: "Rashi" }, "review")).status).toBe(201);
    expect(await get("/forecasts?variety=Rashi")).toMatchObject({ status: "published", stale: false });

    // What the scheduled handler does every day.
    await refreshMonthly(db as never, "2026-09", "Karnataka");
    await refreshMonthly(db as never, "2026-10", "Karnataka");
    const after = await get("/forecasts?variety=Rashi");
    expect(after).toMatchObject({ status: "published", stale: false, stale_reasons: [] });
    expect(after.forecast).toMatchObject({ reporting_month: "2026-11" });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM monthly_price_versions WHERE reporting_month='2026-10'").get()).toEqual({ n: 2 });

    override = 99000;
    await refreshMonthly(db as never, "2026-10", "Karnataka");
    expect(await get("/forecasts?variety=Rashi")).toMatchObject({ status: "stale", forecast: null, stale_reasons: ["source_history_changed"] });
  });
});

describe("public arrival and price pairs", () => {
  const record = {
    id: "obs-1", source_record_id: "rec-1", market_id: "m-sirsi", market_name: "Sirsi", district: "Uttara Kannada", state: "Karnataka",
    reporting_date: "2025-10-01", publication_date: null, commodity_name: "Arecanut", original_commodity_name: "Arecanut(Betelnut/Supari)",
    variety_name: "Rashi", original_variety_name: "Rashi", minimum_price: 40000, maximum_price: 50000, modal_price: 45000,
    arrival_quantity: null, arrival_unit: null, original_unit: "Rs./Quintal", price_unit: "INR/quintal", validation_status: "validated",
    validation_message: null, raw_payload: "{}",
  };

  it("never exposes a price before review approves it", async () => {
    expect((await post("/admin/import", { source_key: "agmarknet", records: [record] }, "import")).status).toBe(201);
    expect((await post("/ingest/arrivals", {
      source_key: "agmarknet", source_name: "AGMARKNET", source_url: "https://example.org/a.csv", authorization_note: "Authorized export for testing",
      file_name: "a.csv", content_sha256: "c".repeat(64),
      rows: [{ row_number: 1, measure: "arrival", district: "Uttara Kannada", market: "Sirsi", variety: "Rashi", observation_date: "2025-10-01", quantity: 10, unit: "quintal" }],
    }, "import")).status).toBe(201);
    const pairs = "/supply/arrivals/price-comparison?from=2025-09-01&to=2025-10-31";
    expect((await get(pairs)).pairs).toEqual([]);

    expect((await post("/admin/observations/obs-1/review", { action: "approve" }, "review")).status).toBe(200);
    expect((await get(pairs)).pairs).toEqual([expect.objectContaining({ modal_price: 45000 })]);
    expect((await get("/prices")).data).toHaveLength(1);
  });
});

describe("conflicting cooperative prices", () => {
  const VARIETY = "RASHI%20EDI";
  const csvRow = (branch: string, average: number, recordId: string) =>
    `${branch},2025-10-01,arecanut,RASHI EDI,40000,50000,${average},INR/quintal,Publisher rate sheet,https://example.org/${recordId},${recordId}`;
  async function importRows(rows: string[]) {
    const csv = ["branch,reporting_date,commodity,variety,minimum_price,maximum_price,average_price,declared_unit,unit_evidence,source_reference,source_record_id", ...rows].join("\n");
    expect((await post("/admin/cooperative/import", { source: "mamcos", csv, authorized_by: "Reviewer", permission_reference: "PR-1", attestation: true }, "review")).status).toBe(200);
    const queue = await (await app.request("/api/v1/admin/cooperative/quality?source=mamcos", { headers: authHeader("review") }, env)).json() as { data: { id: string; average_price: number }[] };
    return (average: number) => queue.data.find((row) => row.average_price === average)!.id;
  }
  const approve = (id: string) => post(`/admin/cooperative/${id}/review`, { action: "approve" }, "review");

  it("refuses to publish a second price for one branch and date, and still allows rejecting it", async () => {
    const idFor = await importRows([csvRow("Sirsi", 45000, "sheet-1"), csvRow("Sirsi", 46000, "sheet-2")]);
    expect((await approve(idFor(45000))).status).toBe(200);
    const refused = await approve(idFor(46000));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: expect.stringContaining("different verified price") });
    expect((await app.request(`/api/v1/cooperative/prices?source=mamcos&variety=${VARIETY}`, {}, env)).status).toBe(200);
    expect((await post(`/admin/cooperative/${idFor(46000)}/review`, { action: "reject" }, "review")).status).toBe(200);
  });

  it("allows a second row that repeats the same price", async () => {
    const idFor = await importRows([csvRow("Sirsi", 45000, "sheet-1")]);
    expect((await approve(idFor(45000))).status).toBe(200);
    const again = await importRows([csvRow("Sirsi", 45000, "sheet-2")]);
    expect((await approve(again(45000))).status).toBe(200);
    expect(await get(`/cooperative/prices?source=mamcos&variety=${VARIETY}`)).toMatchObject({ benchmark_conflicts: [] });
  });

  it("keeps the public route working for conflicts that already exist, withholding only that branch", async () => {
    const idFor = await importRows([csvRow("Sirsi", 45000, "s1"), csvRow("Sagara", 46000, "s2"), csvRow("Tarikere", 47000, "s3"), csvRow("Shivamogga", 48000, "s4"), csvRow("Sirsi", 49000, "s5")]);
    for (const average of [45000, 46000, 47000, 48000]) expect((await approve(idFor(average))).status).toBe(200);
    db.sqlite.prepare("UPDATE cooperative_quotes SET status='verified' WHERE id=?").run(idFor(49000));

    const response = await app.request(`/api/v1/cooperative/prices?source=mamcos&variety=${VARIETY}`, {}, env);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.benchmark_conflicts).toEqual([{ reporting_date: "2025-10-01", branch: "Sirsi", prices: [45000, 49000] }]);
    expect(body.series[0]).toMatchObject({ branch_count: 3, median_average_price: 47000 });
    expect(body.series[0].branches).not.toContain("Sirsi");
  });
});

describe("document ingestion failures", () => {
  const SHA = (char: string) => char.repeat(64);
  const payload = (sha: string, word: string, count: number) => ({
    ingestion_job_id: "test-job-1",
    document: {
      id: `guide-${sha.slice(0, 12)}`, title: "Guide", publisher: "ICAR-CPCRI", document_type: "cpcri_publication", language: "en",
      source_url: "https://example.org/guide.pdf", publication_date: "2025", publication_date_basis: "stated", mime_type: "application/pdf",
      content_sha256: sha, page_count: 3, reuse_note: null, fetched_at: "2026-11-01T00:00:00Z",
    },
    chunks: Array.from({ length: count }, (_, index) => ({ chunk_index: index, page_from: 1, page_to: 1, heading: null, text: `${word} passage ${index}` })),
  });
  const documents = () => db.sqlite.prepare(`SELECT d.content_sha256 AS sha, d.status, COUNT(c.id) AS chunks FROM documents d
    LEFT JOIN document_chunks c ON c.document_id = d.id GROUP BY d.id ORDER BY d.ingested_at, d.id`).all().map((row) => ({ ...row, sha: String(row.sha)[0] }));
  const failBatchNumber = (target: number) => {
    const original = db.batch.bind(db);
    let calls = 0;
    return vi.spyOn(db, "batch").mockImplementation(async (statements) => {
      calls += 1;
      if (calls === target) throw new Error("simulated D1 failure");
      return original(statements);
    });
  };

  // 60 chunks: batch 1 and 2 write chunks, batch 3 publishes.
  it.each([["writing chunks", 2], ["publishing", 3]])("keeps the old version live when %s fails, and a retry completes the upload", async (_phase, target) => {
    expect((await post("/admin/documents", payload(SHA("a"), "original", 2), "review")).status).toBe(201);
    const spy = failBatchNumber(target as number);
    const failed = await post("/admin/documents", payload(SHA("b"), "revised", 60), "review");
    spy.mockRestore();

    expect(failed.status).toBe(409);
    expect(documents().find((row) => row.sha === "a")).toMatchObject({ status: "active", chunks: 2 });
    expect(documents().find((row) => row.sha === "b")).toMatchObject({ status: "withdrawn" });
    expect((await searchDocuments(env.DB, "original")).hits).not.toEqual([]);
    expect((await searchDocuments(env.DB, "revised")).hits).toEqual([]);

    const retry = await post("/admin/documents", payload(SHA("b"), "revised", 60), "review");
    expect(retry.status).toBe(201);
    expect(await retry.json()).toMatchObject({ status: "ingested", chunks: 60, withdrawn_versions: [`guide-${SHA("a").slice(0, 12)}`] });
    expect(documents()).toEqual([{ sha: "a", status: "withdrawn", chunks: 2 }, { sha: "b", status: "active", chunks: 60 }]);
    expect((await searchDocuments(env.DB, "original")).hits).toEqual([]);
    expect((await searchDocuments(env.DB, "revised")).hits).not.toEqual([]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM document_chunks_fts").get()).toEqual({ n: 60 });
  });

  it("repairs a partially stored active document left by an earlier failure", async () => {
    expect((await post("/admin/documents", payload(SHA("a"), "original", 2), "review")).status).toBe(201);
    const complete = await post("/admin/documents", payload(SHA("a"), "original", 5), "review");
    expect(complete.status).toBe(201);
    expect(documents()).toEqual([{ sha: "a", status: "active", chunks: 5 }]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM document_chunks_fts").get()).toEqual({ n: 5 });
  });

  it("restores an earlier file when the source goes back to it", async () => {
    expect((await post("/admin/documents", payload(SHA("a"), "original", 2), "review")).status).toBe(201);
    expect((await post("/admin/documents", payload(SHA("b"), "revised", 2), "review")).status).toBe(201);
    expect((await post("/admin/documents", payload(SHA("a"), "original", 2), "review")).status).toBe(201);
    expect(documents()).toEqual([{ sha: "a", status: "active", chunks: 2 }, { sha: "b", status: "withdrawn", chunks: 2 }]);
    expect((await searchDocuments(env.DB, "original")).hits).not.toEqual([]);
    expect((await searchDocuments(env.DB, "revised")).hits).toEqual([]);
  });

  it("refuses to mix differently chunked text into a stored file", async () => {
    expect((await post("/admin/documents", payload(SHA("a"), "original", 2), "review")).status).toBe(201);
    expect((await post("/admin/documents", payload(SHA("a"), "rechunked", 5), "review")).status).toBe(409);
    expect(documents()).toEqual([{ sha: "a", status: "active", chunks: 2 }]);
  });
});

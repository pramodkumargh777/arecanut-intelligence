import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { app, type Env } from "./index";
import { applyMigrations, LocalDatabase } from "./test-support/local-d1";
import { autoPublishPending } from "./cooperative-auto-publish";
import { replayCooperativeSnapshot } from "./cooperative-import";
import { aggregateTmsLots, parseTms, refreshTms, tmsBackfillDates, tmsBundleUrl, tmsUnitDeclared, TMS_BACKFILL_MAX_DAYS, TMS_PORTAL_URL } from "./tms";

// Trimmed excerpt of the public TMS Sirsi bundle for 2026-11-13: five varieties and all of their lots, values unmodified.
const fixture = readFileSync(new URL("./fixtures/tms-bundle-2026-11-13.json", import.meta.url), "utf8");
const bundle = () => JSON.parse(fixture) as { requestedDate: string; effectiveDate: string | null; rates: { item: string; average: number; code: number }[]; lots: unknown[] };
const FETCHED = "2026-11-13T15:00:00Z";
const PORTAL = "<p>Arecanut Market Rates</p><p>Rates in ₹/quintal · Subject to change without notice</p>";

/** Serves the portal page and the bundle the way the live site does. */
function fakeTms(payload: unknown = bundle(), portal = PORTAL) {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url === TMS_PORTAL_URL) return new Response(portal, { headers: { "content-type": "text/html; charset=utf-8" } });
    const date = new URL(url).searchParams.get("date")!;
    const body = typeof payload === "object" && payload ? { ...payload, requestedDate: date } : payload;
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetcher, calls };
}

describe("TMS Sirsi tender parser", () => {
  it("reads each variety's tender average, range and lot totals for the tender day", async () => {
    const parsed = await parseTms(bundle(), "2026-11-13", FETCHED);
    expect(parsed).toMatchObject({ received_count: 5, excluded_count: 0, effective_date: "2026-11-13", lot_mismatches: [] });
    const rashi = parsed.quotes.find((quote) => quote.variety === "RASHI")!;
    expect(rashi).toMatchObject({
      source_key: "tms", commodity: "arecanut", branch: "Sirsi", reporting_date: "2026-11-13", source_record_id: "1",
      minimum_price: 37399, maximum_price: 47320, average_price: 44928.4, price_unit: "INR/quintal", unit_status: "source_confirmed",
      source_unit_label: "₹/quintal", lot_count: 10, bag_count: 20, reported_weight: 1188.7, status: "pending", validation_message: null,
      source_url: tmsBundleUrl("2026-11-13"),
    });
    expect(rashi.review_flags).toBeUndefined();
    expect(JSON.parse(rashi.raw_record)).toMatchObject({ code: "1", item: "RASHI", average: 44928.4 });
  });

  it("confirms that the published average is the plain mean of the lot rates", () => {
    const lots = aggregateTmsLots(bundle().lots);
    for (const rate of bundle().rates) expect(lots.get(rate.item)!.mean).toBeCloseTo(rate.average, 6);
  });

  it("files rates under the tender day TMS answers with, not the day asked for", async () => {
    const parsed = await parseTms({ ...bundle(), requestedDate: "2026-11-15" }, "2026-11-15", "2026-11-15T04:00:00Z");
    expect(parsed.effective_date).toBe("2026-11-13");
    expect(new Set(parsed.quotes.map((quote) => quote.reporting_date))).toEqual(new Set(["2026-11-13"]));
  });

  it("records nothing, without failing, when there is no tender day to report", async () => {
    const parsed = await parseTms({ ...bundle(), effectiveDate: null, rates: [], lots: [] }, "2026-11-13", FETCHED);
    expect(parsed).toMatchObject({ quotes: [], received_count: 0, effective_date: null });
  });

  it("rejects answers for another requested date or a tender day after it", async () => {
    await expect(parseTms(bundle(), "2026-11-12", FETCHED)).rejects.toThrow("different requested date");
    await expect(parseTms({ ...bundle(), requestedDate: "2026-11-12" }, "2026-11-12", FETCHED)).rejects.toThrow("after the requested date");
  });

  it("holds a variety whose published figures no longer match its lots", async () => {
    const payload = bundle();
    payload.rates[0] = { ...payload.rates[0], average: payload.rates[0].average + 500 };
    const parsed = await parseTms(payload, "2026-11-13", FETCHED);
    expect(parsed.lot_mismatches).toEqual([payload.rates[0].item]);
    expect(parsed.quotes[0].review_flags).toEqual(["lot_aggregate_mismatch"]);
  });

  it("marks inconsistent prices invalid and keeps non-arecanut items out", async () => {
    const payload = bundle();
    payload.rates.push({ code: 900, item: "PEPPER", minimum: 60000, maximum: 61000, average: 60500 } as never);
    payload.rates[1] = { ...payload.rates[1], average: 1 };
    const parsed = await parseTms(payload, "2026-11-13", FETCHED);
    expect(parsed.excluded_count).toBe(1);
    expect(parsed.quotes.some((quote) => quote.variety === "PEPPER")).toBe(false);
    expect(parsed.quotes[1]).toMatchObject({ status: "invalid" });
    expect(parsed.quotes[1].validation_message).toContain("minimum <= average <= maximum");
  });

  it("refuses duplicate varieties in one tender day", async () => {
    const payload = bundle();
    payload.rates.push({ ...payload.rates[0], code: 999 });
    await expect(parseTms(payload, "2026-11-13", FETCHED)).rejects.toThrow("Duplicate TMS item");
  });

  it("recognises the portal's unit statement, including an encoded rupee sign", () => {
    expect(tmsUnitDeclared(PORTAL)).toBe(true);
    expect(tmsUnitDeclared("Rates in &#8377;/quintal")).toBe(true);
    expect(tmsUnitDeclared("Rates in ₹/kg")).toBe(false);
    expect(tmsUnitDeclared("Arecanut Market Rates")).toBe(false);
  });

  it("bounds a backfill request", () => {
    expect(tmsBackfillDates("2026-11-01", "2026-11-03")).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(() => tmsBackfillDates("2026-01-01", "2026-12-31")).toThrow(`${TMS_BACKFILL_MAX_DAYS} dates`);
    expect(() => tmsBackfillDates("2026-11-05", "2026-11-01")).toThrow();
  });
});

describe("TMS Sirsi collection", () => {
  let db: LocalDatabase;
  beforeEach(() => { db = applyMigrations(new LocalDatabase()); });
  afterEach(() => { db.sqlite.close(); vi.useRealTimers(); });
  const rows = () => db.sqlite.prepare("SELECT variety, status, price_basis, unit_status, lot_count FROM cooperative_quotes WHERE source_key='tms' ORDER BY variety").all() as
    { variety: string; status: string; price_basis: string; unit_status: string; lot_count: number }[];

  it("is registered as a separate source, blocked from schedules until permission is recorded", () => {
    expect(db.sqlite.prepare("SELECT permission_status, scheduled_collection_allowed FROM cooperative_sources WHERE source_key='tms'").get())
      .toEqual({ permission_status: "not_requested", scheduled_collection_allowed: 0 });
    expect(db.sqlite.prepare("SELECT status FROM commodity_capabilities WHERE commodity_id='commodity-arecanut' AND capability='cooperative_tms'").get())
      .toEqual({ status: "available" });
  });

  it("stores a tender day as tender averages, publishes it on the usual checks, and stores a repeat once", async () => {
    const { fetcher, calls } = fakeTms();
    const first = await refreshTms(db as never, "2026-11-13", { fetcher, attempts: 1 });
    expect(first).toMatchObject({ effective_date: "2026-11-13", received_count: 5, inserted_count: 5, invalid_count: 0 });
    expect(calls[0]).toBe(TMS_PORTAL_URL);
    expect(rows().every((row) => row.price_basis === "COOPERATIVE_TENDER_AVERAGE" && row.unit_status === "source_confirmed")).toBe(true);
    const fetch = db.sqlite.prepare("SELECT status, requested_date, notes FROM cooperative_fetches WHERE source_key='tms'").get() as { status: string; requested_date: string; notes: string };
    expect(fetch).toMatchObject({ status: "succeeded", requested_date: "2026-11-13" });
    expect(JSON.parse(fetch.notes)).toMatchObject({ effective_date: "2026-11-13", unit_declaration: { text: "Rates in ₹/quintal" } });

    const published = await autoPublishPending(db as never, "tms", new Date("2026-11-13T15:00:00Z"));
    expect(published).toMatchObject({ published: 5, held: [] });
    expect(rows().map((row) => row.status)).toEqual(["verified", "verified", "verified", "verified", "verified"]);

    // A Sunday request answers with Friday's tender again; nothing new is stored.
    const repeat = await refreshTms(db as never, "2026-11-15", { fetcher, attempts: 1 });
    expect(repeat).toMatchObject({ effective_date: "2026-11-13", inserted_count: 0, duplicate_count: 5 });
    expect(rows()).toHaveLength(5);
  });

  it("stores nothing when the portal stops stating its unit", async () => {
    const { fetcher } = fakeTms(bundle(), "<p>Arecanut Market Rates</p>");
    await expect(refreshTms(db as never, "2026-11-13", { fetcher, attempts: 1 })).rejects.toThrow("no longer states");
    expect(rows()).toEqual([]);
    expect(db.sqlite.prepare("SELECT status FROM cooperative_fetches WHERE source_key='tms'").get()).toEqual({ status: "failed" });
  });

  it("replays a stored TMS snapshot with the TMS parser", async () => {
    const { fetcher } = fakeTms();
    const { fetch_id } = await refreshTms(db as never, "2026-11-13", { fetcher, attempts: 1 });
    const replay = await replayCooperativeSnapshot(db as never, fetch_id);
    expect(replay).toMatchObject({ source: "tms", received_count: 5, parsed_count: 5, inserted_count: 0, duplicate_count: 5 });
  });

  it("enforces the tender price basis for TMS in the database", () => {
    db.sqlite.prepare("INSERT INTO cooperative_fetches (id, source_key, source_url, started_at, status) VALUES ('f', 'tms', 'u', '2026-11-13T12:00:00Z', 'succeeded')").run();
    const insert = (basis: string) => db.sqlite.prepare(`INSERT INTO cooperative_quotes (id, source_key, branch, reporting_date, variety, minimum_price, maximum_price,
      average_price, price_type, price_unit, unit_status, source_url, fetched_at, fetch_id, raw_record, status, price_basis)
      VALUES (?, 'tms', 'Sirsi', '2026-11-13', 'RASHI', 1, 3, 2, 'reported_average', 'INR/quintal', 'source_confirmed', 'u', 'x', 'f', '{}', 'pending', ?)`).run(basis, basis);
    expect(() => insert("COOPERATIVE_AVERAGE")).toThrow("price basis does not match");
    expect(() => insert("COOPERATIVE_TENDER_AVERAGE")).not.toThrow();
  });

  it("serves TMS through the public prices endpoint once published", async () => {
    const { fetcher } = fakeTms();
    await refreshTms(db as never, "2026-11-13", { fetcher, attempts: 1 });
    await autoPublishPending(db as never, "tms", new Date("2026-11-13T15:00:00Z"));
    const response = await app.request("/api/v1/cooperative/prices?source=tms", {}, { DB: db as never } as Env["Bindings"]);
    expect(response.status).toBe(200);
    const body = await response.json() as { variety: string; latest_by_branch: { branch: string; average_price: number; price_basis: string }[]; methodology: string };
    expect(body.variety).toBe("RASHI");
    expect(body.latest_by_branch).toEqual([expect.objectContaining({ branch: "Sirsi", average_price: 44928.4, price_basis: "COOPERATIVE_TENDER_AVERAGE" })]);
    expect(body.methodology).toContain("plain mean of the day's tender lot rates");
  });

  it("is skipped and logged by the schedule while no permission is recorded", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    try {
      await worker.scheduled({ cron: "30 14 * * *" } as ScheduledEvent, { DB: db as never, TMS_SCHEDULE_ENABLED: "true" } as Env["Bindings"], {} as ExecutionContext);
    } finally { vi.unstubAllGlobals(); }
    expect(fetcher).not.toHaveBeenCalled();
    expect(db.sqlite.prepare("SELECT status, error_message FROM cooperative_fetches WHERE source_key='tms'").get())
      .toMatchObject({ status: "blocked", error_message: expect.stringContaining("Scheduled collection blocked") });
  });
});

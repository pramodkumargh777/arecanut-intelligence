import { describe, expect, it } from "vitest";
import { aggregateTssLots, parseTss, TSS_BACKFILL_MAX_DAYS, TSS_LOCATIONS, tssBackfillDates, tssUrl, validTssDate } from "./tss";
import { cooperativeSeries } from "./cooperative";

const row = { date1: "2026-11-03", iname: "RASHI", iname_en: "RASHI", itemcode: 1, mnrate: 44099, mxrate: 47299, avgrate: 46055, norrate: 45699 };
const report = (rows = [row]) => ({ success: true, data: rows });
const parse = (payload: unknown) => parseTss(payload, "Sirsi", "2026-11-03", "2026-11-03T18:00:00Z");

describe("TSS reported averages with explicit unit assumption", () => {
  it("preserves reported average, normal rate, exact label and original payload separately", async () => {
    const parsed = await parse(report());
    expect(parsed.quotes[0]).toMatchObject({
      source_key: "tss", branch: "Sirsi", variety: "RASHI", reporting_date: "2026-11-03",
      minimum_price: 44099, maximum_price: 47299, average_price: 46055, normal_price: 45699,
      price_type: "reported_average", price_unit: "INR/quintal", unit_status: "assumed", status: "pending",
      source_url: tssUrl("Sirsi", "2026-11-03"),
    });
    expect(JSON.parse(parsed.quotes[0].raw_record)).toEqual(row);
  });
  it("archives but excludes pepper, ambiguous and unsupported items without alias merging", async () => {
    const parsed = await parse(report([row, ...["PEPPER", "RAW PEPPER", "SHAN BALE", "K.G.", "NEW RASHI", "FRESH RAW ARECA"].map((iname) => ({ ...row, iname, iname_en: iname }))]));
    expect(parsed.received_count).toBe(7);
    expect(parsed.excluded_count).toBe(6);
    expect(parsed.quotes).toHaveLength(1);
  });
  it("does not substitute normal rates for missing or zero averages", async () => {
    const parsed = await parse(report([{ ...row, avgrate: 0 }]));
    expect(parsed.quotes[0]).toMatchObject({ average_price: 0, normal_price: 45699, status: "invalid" });
  });
  it("validates ranges and rejects non-numeric values instead of coercing empty strings", async () => {
    const parsed = await parse({ success: true, data: [{ ...row, mnrate: "", avgrate: null }, { ...row, iname_en: "BETTE", avgrate: 99999 }] });
    expect(parsed.quotes.map((quote) => quote.status)).toEqual(["invalid", "invalid"]);
    expect(parsed.quotes[0].minimum_price).toBeNull();
  });
  it("rejects period mismatch, duplicate keys and source errors", async () => {
    await expect(parse(report([{ ...row, date1: "2026-11-02" }]))).rejects.toThrow("different reporting date");
    await expect(parse(report([row, row]))).rejects.toThrow("Duplicate");
    await expect(parse({ success: false, data: [] })).rejects.toThrow();
    expect(validTssDate("2026-02-31")).toBe(false);
    expect(validTssDate("2026-11-03")).toBe(true);
  });
  it("preserves empty reporting days and flags future observations", async () => {
    expect(await parse(report([]))).toMatchObject({ quotes: [], received_count: 0, excluded_count: 0 });
    const parsed = await parseTss(report(), "Sirsi", "2026-11-03", "2026-11-02T18:00:00Z");
    expect(parsed.quotes[0].validation_message).toContain("Future");
  });
  it("deduplicates unchanged snapshots but versions raw-field and location corrections", async () => {
    const a = (await parse(report())).quotes[0];
    const repeat = (await parse(report())).quotes[0];
    const corrected = (await parse(report([{ ...row, norrate: 45000 }]))).quotes[0];
    const elsewhere = (await parseTss(report(), "Siddapur", "2026-11-03", "2026-11-03T18:00:00Z")).quotes[0];
    expect(a.id).toBe(repeat.id);
    expect(a.id).not.toBe(corrected.id);
    expect(a.id).not.toBe(elsewhere.id);
  });
  it("excludes assumed-unit rows at the benchmark calculation boundary", async () => {
    const quotes = await Promise.all(TSS_LOCATIONS.map((location) =>
      parseTss(report(), location, "2026-11-03", "2026-11-03T18:00:00Z")));
    expect(cooperativeSeries(quotes.flatMap((parsed) => parsed.quotes), 3)).toEqual([]);
  });
});

describe("TSS tender lot aggregation", () => {
  // Field names follow the public tender endpoint; identity values here are synthetic placeholders.
  const lot = { date1: "2026-11-03", typ: "A", acno: "ACC-1", lotno: 1, vname: "RASHI", rate: "46000", bags: 1, weight: "82.500",
    buyer: "BUYER-X", seller_name: "Seller Person", seller_name_en: "Seller Person", seller_name_kn: "x", item_en: "RASHI", itemcode: 1 };
  it("aggregates lots, bags and weight per exact variety and drops all personal fields", () => {
    const result = aggregateTssLots({ success: true, data: [lot, { ...lot, typ: "S", bags: 2, weight: "160.250" },
      { ...lot, item_en: "PEPPER" }, { ...lot, date1: "2026-11-02" }, { ...lot, weight: "" }] }, "2026-11-03");
    expect(Object.fromEntries(result.lots)).toEqual({ RASHI: { lot_count: 2, bag_count: 3, reported_weight: 242.75, session_codes: ["A", "S"] } });
    expect(result).toMatchObject({ tender_row_count: 5, skipped_row_count: 3 });
    expect(JSON.stringify(Object.fromEntries(result.lots))).not.toMatch(/Seller|BUYER|ACC-1/);
  });
  it("attaches lot aggregates to the matching quotation with an unconfirmed quantity unit", async () => {
    const lots = aggregateTssLots({ success: true, data: [lot] }, "2026-11-03").lots;
    const parsed = await parseTss(report(), "Sirsi", "2026-11-03", "2026-11-03T18:00:00Z", lots);
    expect(parsed.quotes[0]).toMatchObject({ lot_count: 1, bag_count: 1, reported_weight: 82.5, session_codes: "A", review_flags: ["quantity_unit_unconfirmed"] });
    expect(parsed.quotes[0].raw_record).not.toContain("Seller");
    expect(parsed.quotes[0].id).not.toBe((await parse(report())).quotes[0].id);
  });
  it("bounds historical backfill to a small number of real dates", () => {
    expect(tssBackfillDates("2026-10-30", "2026-11-03")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(() => tssBackfillDates("2026-10-01", "2026-11-03")).toThrow(`${TSS_BACKFILL_MAX_DAYS} reporting dates`);
    expect(() => tssBackfillDates("2026-11-03", "2026-11-01")).toThrow("start date");
  });
});

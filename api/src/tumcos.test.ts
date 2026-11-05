import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractJsonArray, parseTumcos, parseTumcosTable, tumcosPageLastUpdated, TUMCOS_URL } from "./tumcos";
import { cooperativeSeries } from "./cooperative";

// Trimmed excerpt of the public TUMCOS page captured 2026-11-04; record values are unmodified.
const html = readFileSync(new URL("./fixtures/tumcos-market-rates.html", import.meta.url), "utf8");
const FETCHED = "2026-11-04T12:00:00Z";

describe("TUMCOS market-rate parser", () => {
  it("reads every embedded record with source IDs, commodity, location and raw provenance", async () => {
    const parsed = await parseTumcos(html, FETCHED, "full_history");
    expect(parsed.received_count).toBe(8);
    const latest = parsed.quotes.find((quote) => quote.source_record_id === "1131")!;
    expect(latest).toMatchObject({
      source_key: "tumcos", commodity: "arecanut", branch: "Channagiri", reporting_date: "2026-11-04",
      minimum_price: 43000, average_price: 48170, maximum_price: 50512, price_type: "reported_average",
      source_published_at: "2026-11-04 16:07:15", source_url: TUMCOS_URL, variety: "areca", variety_reported: false, status: "pending",
    });
    expect(JSON.parse(latest.raw_record)).toMatchObject({ id: "1131", unit: "kg", quality: "Karnataka, India" });
    expect(parsed.quotes.filter((quote) => quote.commodity === "black_pepper").map((quote) => quote.source_record_id)).toEqual(["303", "4"]);
  });
  it("treats per-quintal-sized values as INR/quintal by operator assumption, keeping the source label and flag", async () => {
    const parsed = await parseTumcos(html, FETCHED, "full_history");
    for (const quote of parsed.quotes) {
      expect(quote).toMatchObject({ price_unit: "INR/quintal", unit_status: "assumed", source_unit_label: "kg" });
      expect(quote.review_flags).toContain("declared_unit_conflicts_with_magnitude");
      expect(quote.review_flags).toContain("variety_not_reported");
    }
    expect(cooperativeSeries(parsed.quotes.filter((quote) => quote.commodity === "arecanut" && quote.variety === "areca"), 1)).not.toEqual([]);
  });
  it("marks commodity conflicts invalid instead of reassigning them", async () => {
    const parsed = await parseTumcos(html, FETCHED, "full_history");
    const pepperInAreca = parsed.quotes.find((quote) => quote.source_record_id === "1085")!;
    expect(pepperInAreca).toMatchObject({ commodity: "arecanut", status: "invalid", variety: "black pepper" });
    expect(pepperInAreca.validation_message).toContain("conflicts with the Arecanut record list");
    const arecaInPepper = parsed.quotes.find((quote) => quote.commodity === "black_pepper" && quote.source_record_id === "4")!;
    expect(arecaInPepper.status).toBe("invalid");
  });
  it("flags multiple records on one date and invalid price ordering without deleting them", async () => {
    const parsed = await parseTumcos(html, FETCHED, "full_history");
    const sameDate = parsed.quotes.filter((quote) => quote.reporting_date === "2026-07-06");
    expect(sameDate).toHaveLength(2);
    for (const quote of sameDate) expect(quote.review_flags).toContain("multiple_source_records_same_date");
    const misordered = parsed.quotes.find((quote) => quote.source_record_id === "245")!;
    expect(misordered).toMatchObject({ status: "invalid", minimum_price: 370099 });
    expect(misordered.validation_message).toContain("low <= average <= high");
  });
  it("uses record dates, not the stale page-level Last Updated label", async () => {
    const parsed = await parseTumcos(html, FETCHED, "recent");
    expect(parsed.page_last_updated).toEqual({ label: "03 Apr 2026", date: "2026-04-03" });
    expect(parsed.latest_record_date).toBe("2026-11-04");
    expect(parsed.stale_page_metadata).toBe(true);
    expect(parsed.quotes.map((quote) => quote.source_record_id)).toEqual(["1131", "1130", "303"]);
    expect(parsed.excluded_count).toBe(5);
  });
  it("cross-checks the visible table against the embedded records", async () => {
    expect(parseTumcosTable(html)).toEqual([
      expect.objectContaining({ product: "Arecanut", average: 48170, high: 50512, low: 43000, date: "2026-11-04", location: "Channagiri" }),
      expect.objectContaining({ product: "Black Pepper", location: "Channagiri" }),
    ]);
    const parsed = await parseTumcos(html, FETCHED, "recent");
    expect(parsed.table_check).toMatchObject({ rows: 2, matched: 2, unmatched: [] });
    const tampered = html.replace("₹48,170.00", "₹48,171.00");
    expect((await parseTumcos(tampered, FETCHED, "recent")).table_check.matched).toBe(1);
  });
  it("produces stable identities for repeated fetches and new identities for source corrections", async () => {
    const a = await parseTumcos(html, FETCHED, "recent");
    const b = await parseTumcos(html, "2026-11-04T13:00:00Z", "recent");
    expect(a.quotes.map((quote) => quote.id)).toEqual(b.quotes.map((quote) => quote.id));
    const corrected = await parseTumcos(html.replace('"average":"48170"', '"average":"48100"'), FETCHED, "recent");
    expect(corrected.quotes[0].id).not.toBe(a.quotes[0].id);
  });
  it("flags future-dated records and fails closed when the record arrays are missing", async () => {
    const early = await parseTumcos(html, "2026-11-01T00:00:00Z", "recent");
    expect(early.quotes.find((quote) => quote.source_record_id === "1131")).toMatchObject({ status: "invalid", validation_message: "Future reporting date." });
    await expect(parseTumcos("<html>Market Rates</html>", FETCHED)).rejects.toThrow("chartData");
    await expect(parseTumcos(html.replace("blackPepper:", "pepper:"), FETCHED)).rejects.toThrow("blackPepper");
    expect(tumcosPageLastUpdated("<p>none</p>")).toBeNull();
    expect(extractJsonArray('x = { a: [{"v":"]"}, [1]] }', "a")).toEqual([{ v: "]" }, [1]]);
  });
});

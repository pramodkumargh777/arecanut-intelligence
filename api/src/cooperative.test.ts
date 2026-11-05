import { describe, expect, it } from "vitest";
import { cooperativeSeries, parseMamcos } from "./cooperative";

const row = { itemname: "RASHI EDI", minprice: "39089", maxprice: "49389", avgprice: "48089", branch: "SHIVAMOGGA", Date: "02-November-2026" };
function html(rows: typeof row[]) {
  const snapshot = JSON.stringify({ data: { rates: [rows.map((entry) => [entry, { s: "arr" }]), { s: "clctn" }] } })
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<div wire:snapshot="${snapshot}"></div>All market rates are in ₹ per Quintal`;
}
describe("MAMCOS published snapshot parser", () => {
  it("preserves exact varieties, each branch date, explicit units and average semantics", async () => {
    const quotes = await parseMamcos(html([row, { ...row, branch: "SAGARA", Date: "03-November-2026", itemname: "NEW RASHIEDI" }]), "2026-11-04T00:00:00Z");
    expect(quotes[0]).toMatchObject({ reporting_date: "2026-11-02", average_price: 48089, price_type: "reported_average", price_unit: "INR/quintal", status: "pending" });
    expect(quotes[1]).toMatchObject({ reporting_date: "2026-11-03", branch: "SAGARA", variety: "NEW RASHIEDI" });
    expect(quotes[0]).not.toHaveProperty("modal_price");
    expect(JSON.parse(quotes[0].raw_record)).toEqual(row);
  });
  it("flags missing placeholders, zero averages and out-of-range averages", async () => {
    const quotes = await parseMamcos(html([
      { ...row, itemname: "", minprice: "", maxprice: "", avgprice: "" },
      { ...row, itemname: "BETTE", avgprice: "0" },
      { ...row, itemname: "GORABALU", avgprice: "50000" },
    ]), "2026-11-04T00:00:00Z");
    expect(quotes.map((quote) => quote.status)).toEqual(["invalid", "invalid", "invalid"]);
    expect(quotes[0].average_price).toBeNull();
  });
  it("changes version identity on correction, but not repeated fetch time", async () => {
    const a = (await parseMamcos(html([row]), "2026-11-04T00:00:00Z"))[0];
    const b = (await parseMamcos(html([row]), "2026-11-05T00:00:00Z"))[0];
    const c = (await parseMamcos(html([{ ...row, avgprice: "48000" }]), "2026-11-05T00:00:00Z"))[0];
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
  });
  it("fails closed on missing units, structure, duplicate keys and invalid dates", async () => {
    await expect(parseMamcos(html([row]).replace("per Quintal", "per kg"), "2026-11-04T00:00:00Z")).rejects.toThrow("unit");
    await expect(parseMamcos(html([row]).replace("₹", "USD"), "2026-11-04T00:00:00Z")).rejects.toThrow("unit");
    await expect(parseMamcos("All market rates are in per Quintal", "2026-11-04T00:00:00Z")).rejects.toThrow("missing");
    await expect(parseMamcos(html([row, row]), "2026-11-04T00:00:00Z")).rejects.toThrow("Duplicate");
    await expect(parseMamcos(html([{ ...row, Date: "31-February-2026" }]), "2026-11-04T00:00:00Z")).rejects.toThrow("date");
  });
  it("flags future dates and does not infer a benchmark below three branches", async () => {
    const quotes = await parseMamcos(html([row]), "2026-11-01T00:00:00Z");
    expect(quotes[0].status).toBe("invalid");
    expect(cooperativeSeries(quotes, 3)).toEqual([]);
  });
  it("calculates medians by exact date with disclosed branch constituents", async () => {
    const quotes = await parseMamcos(html([row, { ...row, branch: "SAGARA", avgprice: "46448" }, { ...row, branch: "Tarikere", avgprice: "45793" }]), "2026-11-04T00:00:00Z");
    expect(cooperativeSeries(quotes, 3)).toEqual([{
      reporting_date: "2026-11-02", median_average_price: 46448, branch_count: 3, branches: ["SAGARA", "SHIVAMOGGA", "Tarikere"],
    }]);
  });
  it("counts branches once, withholds sparse dates, and never blends source, variety or assumed units", async () => {
    const quotes = await parseMamcos(html([row, { ...row, branch: "SAGARA" }, { ...row, branch: "Tarikere" }]), "2026-11-04T00:00:00Z");
    const later = { ...quotes[0], reporting_date: "2026-11-03" };
    expect(cooperativeSeries([...quotes, quotes[0], later], 3)).toHaveLength(1);
    expect(cooperativeSeries([...quotes, quotes[0]], 3)[0].branch_count).toBe(3);
    expect(cooperativeSeries(quotes.map((quote) => ({ ...quote, unit_status: "assumed" })), 3)).toEqual([]);
    expect(() => cooperativeSeries([...quotes, { ...later, source_key: "tss" }], 3)).toThrow("one source");
    expect(() => cooperativeSeries([...quotes, { ...later, variety: "BETTE" }], 3)).toThrow("exact variety");
    expect(() => cooperativeSeries([...quotes, { ...quotes[0], average_price: 48000 }], 3)).toThrow("Conflicting");
  });
});

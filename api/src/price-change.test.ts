import { describe, expect, it } from "vitest";
import { marketBreadth, priceChange, type DatedPrice } from "../../shared/price-change";

const row = (reporting_date: string, average_price: number | null, branch = "SAGARA", variety = "RASHI EDI"): DatedPrice => ({ branch, variety, reporting_date, average_price });

describe("change from a branch's previous report", () => {
  it("compares with the most recent earlier report, not the oldest", () => {
    const history = [row("2026-10-30", 45000), row("2026-11-02", 46000), row("2026-11-03", 46920)];
    expect(priceChange(row("2026-11-03", 46920), history)).toEqual({ amount: 920, percent: 2, previous_date: "2026-11-02", previous_price: 46000 });
  });

  it("shows a fall as negative", () => {
    expect(priceChange(row("2026-11-03", 45540), [row("2026-11-02", 46000)])).toMatchObject({ amount: -460, percent: -1 });
  });

  it("only ever compares a branch with itself, in the same variety", () => {
    const history = [row("2026-11-02", 40000, "KOPPA"), row("2026-11-02", 30000, "SAGARA", "CHALI")];
    expect(priceChange(row("2026-11-03", 46000), history)).toBeNull();
  });

  it("treats spellings of one label as the same variety", () => {
    expect(priceChange(row("2026-11-03", 46000, "SAGARA", "NEW RASHIEDI"), [row("2026-11-02", 46000, "SAGARA", "NEWRASHIEDI")])).toMatchObject({ amount: 0, percent: 0 });
  });

  it("gives nothing for a first report, a same-day row, an empty price or a very old report", () => {
    expect(priceChange(row("2026-11-03", 46000), [])).toBeNull();
    expect(priceChange(row("2026-11-03", 46000), [row("2026-11-03", 45000)])).toBeNull();
    expect(priceChange(row("2026-11-03", null), [row("2026-11-02", 45000)])).toBeNull();
    expect(priceChange(row("2026-11-03", 46000), [row("2026-11-02", null)])).toBeNull();
    expect(priceChange(row("2026-11-03", 46000), [row("2026-09-01", 45000)])).toBeNull();
    expect(priceChange(row("2026-11-03", 46000), [row("2026-10-04", 45000)])).not.toBeNull();
  });
});

describe("market breadth", () => {
  const change = (amount: number, percent: number) => ({ amount, percent, previous_date: "2026-11-02", previous_price: 46000 });
  it("counts rises and falls and takes the middle change, leaving out branches with no earlier report", () => {
    expect(marketBreadth([change(100, 1), change(200, 3), change(-50, -0.5), null])).toEqual({ up: 2, down: 1, flat: 0, median_percent: 1 });
    expect(marketBreadth([change(100, 1), change(0, 0)])).toEqual({ up: 1, down: 0, flat: 1, median_percent: 0.5 });
  });
  it("has no median when nothing can be compared", () => {
    expect(marketBreadth([null, null])).toEqual({ up: 0, down: 0, flat: 0, median_percent: null });
  });
});

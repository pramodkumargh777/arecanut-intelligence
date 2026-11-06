import { describe, expect, it } from "vitest";
import { holdBreakEvenPercent, holdHistory, isIsolatedSpike, type HoldPoint } from "../../shared/hold-history";

// Rashi Karnataka monthly prices as published by AGMARKNET for November and the months compared with it.
const RASHI: Record<string, number> = {
  "2021-11": 46078.93, "2022-02": 45363.66, "2022-05": 49353.87,
  "2022-11": 45976.37, "2023-02": 45168.05, "2023-05": 47227.6,
  "2023-11": 46302.26, "2023-12": 47410.63, "2024-01": 36367.18, "2024-02": 47117.44, "2024-05": 47885.79,
  "2024-11": 47306.28, "2025-02": 47098.01, "2025-05": 50099.1,
  "2025-11": 57808.92, "2026-02": 54703.47, "2026-05": 52016.09,
};
const flagged = (code: string[]) => code.map((value) => ({ code: value }));
const points: HoldPoint[] = Object.entries(RASHI).map(([reporting_month, weighted_price]) => ({
  reporting_month, weighted_price,
  review_flags: reporting_month === "2024-01" ? flagged(["large_change_from_previous", "large_change_to_next"])
    : reporting_month === "2023-12" ? flagged(["large_change_to_next"]) : reporting_month === "2024-02" ? flagged(["large_change_from_previous"]) : [],
}));

describe("past-years hold history", () => {
  const history = holdHistory(points, 11, [3, 6]);
  const summary = (months: number) => history.summaries.find((item) => item.months === months)!;

  it("reproduces the November Rashi record", () => {
    expect(history.years.map((year) => year.start_month)).toEqual(["2021-11", "2022-11", "2023-11", "2024-11", "2025-11"]);
    expect(history.years.map((year) => year.changes[0].percent)).toEqual([-1.6, -1.8, 1.8, -0.4, -5.4]);
    expect(history.years.map((year) => year.changes[1].percent)).toEqual([7.1, 2.7, 3.4, 5.9, -10]);
    expect(summary(3)).toEqual({ months: 3, years: 5, rose: 1, median_percent: -1.6, lowest_percent: -5.4, highest_percent: 1.8 });
    expect(summary(6)).toEqual({ months: 6, years: 5, rose: 4, median_percent: 3.4, lowest_percent: -10, highest_percent: 7.1 });
    expect(history).toMatchObject({ first_month: "2021-11", last_month: "2026-05" });
  });

  it("leaves out a one-month spike but keeps a single large step", () => {
    expect(isIsolatedSpike(points.find((point) => point.reporting_month === "2024-01")!)).toBe(true);
    expect(isIsolatedSpike(points.find((point) => point.reporting_month === "2023-12")!)).toBe(false);
    expect(history.excluded_months).toEqual(["2024-01"]);
    const twoMonths = holdHistory(points, 11, [2]).years.find((year) => year.start_month === "2023-11")!;
    expect(twoMonths.changes[0]).toMatchObject({ target_month: "2024-01", percent: null, excluded: true });
    const fromSpike = holdHistory(points, 1, [1]);
    expect(fromSpike.years[0].changes[0]).toMatchObject({ percent: null, excluded: true });
    expect(fromSpike.summaries[0].years).toBe(0);
  });

  it("gives no summary from fewer than three years, and never fills a missing month", () => {
    const short = points.filter((point) => point.reporting_month < "2023-06");
    const result = holdHistory(short, 11, [3]);
    expect(result.summaries[0]).toEqual({ months: 3, years: 2, rose: 0, median_percent: null, lowest_percent: null, highest_percent: null });
    const gap = holdHistory([{ reporting_month: "2021-11", weighted_price: 100 }, { reporting_month: "2022-02", weighted_price: null }], 11, [3]);
    expect(gap.years).toEqual([]);
  });

  it("ignores years whose later months have not happened yet", () => {
    const history2026 = holdHistory([...points, { reporting_month: "2026-11", weighted_price: 47000 }], 11, [3]);
    expect(history2026.years.map((year) => year.start_month)).not.toContain("2026-11");
  });
});

describe("rise needed to cover the cost of waiting", () => {
  const costs = { annualInterestPercent: 0, weightLossPercent: 0, storagePerQuintalPerMonth: 0 };
  it("is zero when waiting costs nothing", () => {
    expect(holdBreakEvenPercent(3, 47000, costs)).toBe(0);
  });
  it("adds interest, storage and weight loss", () => {
    expect(holdBreakEvenPercent(3, 47000, { ...costs, annualInterestPercent: 10 })).toBe(2.5);
    expect(holdBreakEvenPercent(2, 50000, { ...costs, storagePerQuintalPerMonth: 250 })).toBe(1);
    expect(holdBreakEvenPercent(3, 47000, { ...costs, weightLossPercent: 1 })).toBe(1);
    expect(holdBreakEvenPercent(6, 50000, { annualInterestPercent: 10, weightLossPercent: 2, storagePerQuintalPerMonth: 100 })).toBe(8.4);
  });
  it("refuses inputs that cannot give a real answer", () => {
    expect(holdBreakEvenPercent(3, 0, costs)).toBeNull();
    expect(holdBreakEvenPercent(3, 47000, { ...costs, weightLossPercent: 100 })).toBeNull();
    expect(holdBreakEvenPercent(3, 47000, { ...costs, annualInterestPercent: -1 })).toBeNull();
    expect(holdBreakEvenPercent(3, 47000, { ...costs, annualInterestPercent: Number.NaN })).toBeNull();
  });
});

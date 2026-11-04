import { describe, expect, it } from "vitest";
import { aggregateDaily, monthRange, monthlyAnalytics } from "./history";
const row = (month: string, value: number | null) => ({ reporting_month: month, weighted_price: value,
  fetched_at: "2026-11-03T00:00:00Z", source_url: "https://api.agmarknet.gov.in/report", refresh_run_id: `run-${month}` });
describe("calendar monthly historical analytics", () => {
  it("preserves calendar gaps, missing varieties and null prices separately", () => {
    const data = monthlyAnalytics("2025-01", "2025-04", [row("2025-01", 100), row("2025-03", null)],
      ["2025-01", "2025-02", "2025-03"], [{ reporting_month: "2025-04", status: "failed", error_message: "HTTP 503", started_at: "now" }]);
    expect(data.points.map((point) => point.status)).toEqual(["observed", "variety_missing", "price_missing", "report_missing"]);
    expect(data.observed_months).toBe(1); expect(data.expected_months).toBe(4);
    expect(data.points[3].latest_attempt?.error_message).toBe("HTTP 503");
    expect(data.points.every((point) => point.rolling_3 === null && point.yoy_percent === null && point.volatility_percent === null)).toBe(true);
  });
  it("computes consecutive means and exact year-on-year, not previous available observation", () => {
    const months = monthRange("2024-01", "2025-01");
    const prices = months.map((month, index) => row(month, (index + 1) * 100));
    const data = monthlyAnalytics(months[0], months.at(-1)!, prices, months, []);
    expect(data.points[2].rolling_3).toBe(200);
    expect(data.points[11].rolling_12).toBe(650);
    expect(data.points[12].yoy_percent).toBe(1200);
    expect(data.points[11].volatility_percent).toBeNull();
    const returns = Array.from({ length: 12 }, (_, index) => Math.log((index + 2) / (index + 1)));
    const mean = returns.reduce((sum, value) => sum + value, 0) / 12;
    const expected = Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 11) * Math.sqrt(12) * 100;
    expect(data.points[12].volatility_percent).toBeCloseTo(expected, 10);
    const missing = monthlyAnalytics(months[0], months.at(-1)!, prices.filter((price) => price.reporting_month !== "2024-05"), months, []);
    expect(missing.points[12].volatility_percent).toBeNull();
    expect(missing.points[6].rolling_3).toBeNull();
  });
  it("publishes seasonal indices only with 3 complete years and normalizes each year independently", () => {
    const months = monthRange("2021-01", "2023-12");
    const prices = months.map((month) => row(month, Number(month.slice(0, 4)) * Number(month.slice(5))));
    const data = monthlyAnalytics("2021-01", "2023-12", prices, months, []);
    expect(data.seasonal_years).toEqual(["2021", "2022", "2023"]);
    expect(data.seasonal[0].index).toBeCloseTo(100 / 6.5);
    expect(data.seasonal[11].index).toBeCloseTo(1200 / 6.5);
    const incomplete = monthlyAnalytics("2021-01", "2023-12", prices.filter((price) => price.reporting_month !== "2023-07"), months, []);
    expect(incomplete.seasonal[0]).toMatchObject({ complete_years: 2, index: null });
  });
  it("handles zero prices without infinite year-on-year or volatility", () => {
    const months = monthRange("2024-01", "2025-01"), prices = months.map((month) => row(month, 0));
    const data = monthlyAnalytics(months[0], months.at(-1)!, prices, months, []);
    expect(data.points.at(-1)).toMatchObject({ yoy_percent: null, volatility_percent: null });
  });
  it("uses stored lookback before the visible filter without dropping those statistics", () => {
    const months = monthRange("2024-01", "2025-01"), prices = months.map((month) => row(month, 100));
    const data = monthlyAnalytics("2025-01", "2025-01", prices, months, []);
    expect(data.points).toHaveLength(1);
    expect(data.points[0]).toMatchObject({ rolling_3: 100, rolling_12: 100, yoy_percent: 0, volatility_percent: 0 });
    expect(data.seasonal_years).toEqual([]);
  });
});
describe("captured daily period aggregation", () => {
  const rows = [
    { reporting_date: "2026-11-02", average_price: 45000, fetched_at: "2026-11-03", source_url: "source", unit_status: "assumed" },
    { reporting_date: "2026-11-03", average_price: 47000, fetched_at: "2026-11-04", source_url: "source", unit_status: "assumed" },
  ];
  it("uses Monday periods, counts captured days and preserves empty weeks", () => {
    const data = aggregateDaily(rows, "2026-10-26", "2026-11-08", "weekly");
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ period: "2026-10-26", mean_average_price: null, reporting_days: 0, calendar_days: 7 });
    expect(data[1]).toMatchObject({ period: "2026-11-02", mean_average_price: 46000, reporting_days: 2, calendar_days: 7, unit_status: "assumed", fetched_at: "2026-11-04" });
  });
  it("clips calendar denominators to selected range and does not invent monthly arrivals weights", () => {
    const data = aggregateDaily(rows, "2026-10-31", "2026-11-03", "monthly");
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ mean_average_price: null, calendar_days: 1 });
    expect(data[1]).toMatchObject({ mean_average_price: 46000, reporting_days: 2, calendar_days: 3 });
  });
});

import { describe, expect, it } from "vitest";
import { buildOutlook, probabilityBelow, recentVolatility, type OutlookCalibration } from "./outlook";
import { monthlyVolatility } from "../../shared/volatility";

const grid = Array.from({ length: 19 }, (_, i) => Math.round((0.05 + i * 0.05) * 100) / 100);
const symmetric = (spread: number) => grid.map((q) => (q - 0.5) * spread);
const calibration: OutlookCalibration = {
  level: 80, grid, vol_window: 12, point_rule: "baseline",
  horizons: [
    { horizon: 1, quantiles: symmetric(3), n: 500, series: 17, test: { n: 190, from: "2025-11", coverage: 0.81, direction_brier: 0.24, climatology_brier: 0.25, median_width_pct: 8 } },
    { horizon: 3, quantiles: symmetric(6), n: 480, series: 17 },
  ],
};
const months = Array.from({ length: 24 }, (_, i) => `20${24 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`);
const prices = (values: number[]) => values.map((weighted_price, i) => ({ reporting_month: months[i], weighted_price }));

describe("price outlook", () => {
  it("measures volatility from monthly log returns and floors a flat history", () => {
    expect(recentVolatility(Array(13).fill(100))).toBe(0.01);
    expect(recentVolatility([100, 110, 100, 110, 100, 110, 100])).toBeGreaterThan(0.09);
    expect(recentVolatility([100, 101])).toBeNull();
    // A steady fall is exactly what carrying the price forward misses, so it counts in full.
    expect(recentVolatility(Array.from({ length: 13 }, (_, i) => 100 * 0.98 ** i))).toBeCloseTo(-Math.log(0.98), 6);
  });

  it("measures exponentially weighted volatility exactly as the engine does", () => {
    // Same vector and values as tests/data/test_forecasting.py.
    const vector = [100, 110, 99, 105, 120, 118, 125, 130, 128, 140];
    expect(monthlyVolatility(vector, { vol_window: 12, vol_method: "ewma", vol_lambda: 0.94, vol_max_returns: 60 })).toBeCloseTo(0.07572084568692844, 12);
    expect(monthlyVolatility(vector, { vol_window: 12 })).toBeCloseTo(0.07809558451813842, 12);
    expect(monthlyVolatility(vector.slice(0, 6), { vol_window: 12, vol_method: "ewma" })).toBeNull();
  });

  it("measures today's volatility with the method the ranges were fitted with, rms for older calibrations", () => {
    const args = { prices: prices(Array.from({ length: 24 }, (_, i) => 40000 * (i < 10 ? 1 : 1.3))), experimentId: "fx", calibratedAt: "x",
      baselines: new Map(), validated: new Map() };
    const old = buildOutlook({ ...args, calibration })!;
    const ewma = buildOutlook({ ...args, calibration: { ...calibration, vol_method: "ewma", vol_lambda: 0.94, vol_max_returns: 60 } })!;
    expect(old.volatility).toEqual({ vol_window: 12, vol_method: "rms" });
    // The 30% step is 13 months back: forgotten by the 12-month measure, fading in the weighted one.
    expect(old.volatility_percent).toBe(1);
    expect(ewma.volatility).toEqual({ vol_window: 12, vol_method: "ewma", vol_lambda: 0.94, vol_max_returns: 60 });
    // 23 returns, the step 13 back: weight 0.94^13 out of the sum of 0.94^0..0.94^22.
    const total = Array.from({ length: 23 }, (_, k) => 0.94 ** k).reduce((a, b) => a + b, 0);
    expect(ewma.volatility_percent).toBeCloseTo(100 * Math.sqrt(0.94 ** 13 * Math.log(1.3) ** 2 / total), 9);
    expect(ewma.horizons[0].upper - ewma.horizons[0].lower).toBeGreaterThan(old.horizons[0].upper - old.horizons[0].lower);
  });

  it("interpolates the error distribution and keeps half of each tail beyond the grid", () => {
    expect(probabilityBelow(0, symmetric(3), grid)).toBeCloseTo(0.5, 6);
    expect(probabilityBelow(-10, symmetric(3), grid)).toBeCloseTo(0.025, 6);
    expect(probabilityBelow(10, symmetric(3), grid)).toBeCloseTo(0.975, 6);
  });

  it("carries the last price forward with a percentage range that widens with horizon and volatility", () => {
    const calm = buildOutlook({ prices: prices(Array.from({ length: 24 }, (_, i) => 40000 * (1 + 0.01 * (i % 2)))),
      calibration, experimentId: "fx", calibratedAt: "2026-11-09", baselines: new Map([[1, "last_value"], [3, "last_value"]]), validated: new Map() })!;
    const choppy = buildOutlook({ prices: prices(Array.from({ length: 24 }, (_, i) => 40000 * (1 + 0.08 * (i % 2)))),
      calibration, experimentId: "fx", calibratedAt: "2026-11-09", baselines: new Map(), validated: new Map() })!;
    const [h1, h3] = calm.horizons;
    expect(calm.last_month).toBe("2025-12");
    expect(h1.target_month).toBe("2026-01");
    expect(h1.point).toBe(calm.last_price);
    expect(h1.lower).toBeLessThan(h1.point);
    expect(h1.upper).toBeGreaterThan(h1.point);
    expect(h3.upper - h3.lower).toBeGreaterThan(h1.upper - h1.lower);
    expect(choppy.horizons[0].upper - choppy.horizons[0].lower).toBeGreaterThan(h1.upper - h1.lower);
    expect(h1.chance_higher).toBeCloseTo(0.5, 6);
    expect(h1.tested).toEqual({ coverage: 0.81, months: 190, from: "2025-11", direction_skill: expect.closeTo(0.04, 6) });
    expect(h3.tested).toBeNull();
  });

  it("uses a seasonal rule or a validated model when the engine says so", () => {
    const values = Array.from({ length: 24 }, (_, i) => 40000 + (i % 12) * 500);
    const seasonal = buildOutlook({ prices: prices(values), calibration, experimentId: "fx", calibratedAt: "x",
      baselines: new Map([[1, "seasonal_naive"]]), validated: new Map([[3, { model: "ensemble", median: 52000 }]]) })!;
    expect(seasonal.horizons[0]).toMatchObject({ model: "seasonal_naive", point: 40000 });
    expect(seasonal.horizons[0].chance_higher).toBeLessThan(0.1);
    expect(seasonal.horizons[1]).toMatchObject({ model: "ensemble", point: 52000 });
  });

  it("names the longer history behind the range widths, and nothing when the ranges come from the official prices", () => {
    const args = { prices: prices(Array.from({ length: 24 }, (_, i) => 40000 * (1 + 0.01 * (i % 2)))), experimentId: "fx", calibratedAt: "x",
      baselines: new Map(), validated: new Map() };
    expect(buildOutlook({ ...args, calibration })!.calibration_history).toBeNull();
    const longer = buildOutlook({ ...args, calibration: { ...calibration, calibration: { dataset: "monthly_from_daily", price_basis: "MONTHLY_APMC_MODAL_MEDIAN",
      centred: true, origins: ["2017-11", "2026-09"], series: 11, tested_on: "monthly_reference" } } })!;
    expect(longer.calibration_history).toEqual({ price_basis: "MONTHLY_APMC_MODAL_MEDIAN", from: "2017-11", to: "2026-09", series: 11 });
  });
});

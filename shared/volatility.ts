/**
 * Monthly price volatility for the outlook ranges. One definition shared by the Worker (api/src/outlook.ts) and the
 * Forecasts page, mirrored by data-platform/forecasting/outlook.py, which fits the ranges with the same method and
 * names it in the calibration.
 *
 * Both methods measure log returns around zero, not around their average: the point forecasts carry a price forward,
 * so a steady trend is exactly the kind of move they miss and must count as volatility.
 * - `rms`: root-mean-square of the last `vol_window` monthly log returns (equal weights).
 * - `ewma`: exponentially weighted, RiskMetrics style, over at most `vol_max_returns` returns; the newest return has
 *   weight 1, the one before `vol_lambda`, then `vol_lambda`², and so on.
 * Both need at least half of `vol_window` returns and are floored at 1%.
 */
export type VolatilitySpec = {
  vol_window: number;
  /** Absent in calibrations published before the method was recorded; those used `rms`. */
  vol_method?: "rms" | "ewma";
  vol_lambda?: number;
  vol_max_returns?: number;
};

export const MIN_VOLATILITY = 0.01;
export const DEFAULT_EWMA_LAMBDA = 0.94;
export const DEFAULT_EWMA_MAX_RETURNS = 60;

export function monthlyVolatility(prices: number[], spec: VolatilitySpec = { vol_window: 12 }): number | null {
  const returns = prices.slice(1).map((value, i) => Math.log(value / prices[i]));
  if (spec.vol_method === "ewma") {
    const lambda = spec.vol_lambda ?? DEFAULT_EWMA_LAMBDA;
    const recent = returns.slice(-(spec.vol_max_returns ?? DEFAULT_EWMA_MAX_RETURNS));
    if (recent.length < spec.vol_window / 2 || !(lambda > 0 && lambda < 1)) return null;
    let weighted = 0, total = 0;
    recent.forEach((value, i) => {
      const weight = lambda ** (recent.length - 1 - i);
      weighted += weight * value ** 2;
      total += weight;
    });
    return Math.max(Math.sqrt(weighted / total), MIN_VOLATILITY);
  }
  const recent = returns.slice(-spec.vol_window);
  if (recent.length < spec.vol_window / 2) return null;
  return Math.max(Math.sqrt(recent.reduce((sum, value) => sum + value ** 2, 0) / recent.length), MIN_VOLATILITY);
}

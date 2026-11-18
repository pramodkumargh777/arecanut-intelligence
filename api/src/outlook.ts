import { shiftCalendarMonth } from "../../shared/dates";
import { monthlyVolatility, type VolatilitySpec } from "../../shared/volatility";

/**
 * Live price outlook for one variety, 1–6 months ahead. The forecasting engine publishes, per horizon, the quantiles of
 * its pooled walk-forward errors on the log scale divided by each series' recent volatility (data-platform/forecasting/
 * outlook.py). This module applies them to today's official prices: the point is the series' baseline rule (or a
 * prospectively validated model's stored forecast), the range is point × exp(volatility × quantile), and the chance of
 * ending higher than the last official price comes from the same error distribution. Because only the calibration
 * comes from the engine, the outlook stays current as each month's official price arrives.
 */

export type OutlookCalibration = VolatilitySpec & {
  level: number; grid: number[]; point_rule: string;
  horizons: { horizon: number; quantiles: number[]; n: number; series: number;
    test?: { n: number; from: string; coverage: number; direction_brier: number; climatology_brier: number; median_width_pct: number } }[];
  /** Present when the quantiles were fitted on a longer series' errors (data-platform/forecasting/outlook.py). */
  calibration?: { dataset: string; price_basis: string; centred: boolean; origins: [string, string] | null; series: number; tested_on: string };
};

export type OutlookHorizon = {
  horizon: number; target_month: string; model: string; point: number; lower: number; upper: number; chance_higher: number;
  /** Range multipliers on the volatility scale: lower = point × exp(vol × band[0]), upper = point × exp(vol × band[1]). */
  band: [number, number];
  tested: { coverage: number; months: number; from: string; direction_skill: number | null } | null;
};

export type Outlook = {
  experiment_id: string; calibrated_at: string; level: number; last_month: string; last_price: number;
  volatility_percent: number; horizons: OutlookHorizon[]; point_rule: string;
  /** How `volatility_percent` was measured: the method the engine fitted the ranges with (shared/volatility.ts). */
  volatility: Required<Pick<VolatilitySpec, "vol_window" | "vol_method">> & Pick<VolatilitySpec, "vol_lambda" | "vol_max_returns">;
  /** The forecast origins whose errors set the range widths, when they come from a longer series than the official prices. */
  calibration_history?: { price_basis: string; from: string; to: string; series: number } | null;
};

/** Equal-weight volatility of the last `window` monthly log returns (the `rms` method of shared/volatility.ts). */
export function recentVolatility(prices: number[], window = 12): number | null {
  return monthlyVolatility(prices, { vol_window: window });
}

/** Linear interpolation of the quantile function; the outer tails hold half the remaining probability. */
export function probabilityBelow(z: number, quantiles: number[], grid: number[]): number {
  if (z <= quantiles[0]) return grid[0] / 2;
  if (z >= quantiles.at(-1)!) return 1 - (1 - grid.at(-1)!) / 2;
  for (let i = 1; i < quantiles.length; i++) {
    if (z <= quantiles[i]) {
      const span = quantiles[i] - quantiles[i - 1];
      return span > 0 ? grid[i - 1] + (grid[i] - grid[i - 1]) * (z - quantiles[i - 1]) / span : grid[i];
    }
  }
  return grid.at(-1)!;
}

export function buildOutlook({ prices, calibration, experimentId, calibratedAt, baselines, validated }: {
  prices: { reporting_month: string; weighted_price: number | null }[];
  calibration: OutlookCalibration; experimentId: string; calibratedAt: string;
  /** Baseline rule per horizon for this series, from the engine's evaluation. */
  baselines: Map<number, string>;
  /** Point from a prospectively validated model, keyed by horizon, for forecasts made from the latest month. */
  validated: Map<number, { model: string; median: number }>;
}): Outlook | null {
  const observed = prices.filter((row): row is { reporting_month: string; weighted_price: number } => row.weighted_price != null && row.weighted_price > 0)
    .sort((a, b) => a.reporting_month.localeCompare(b.reporting_month));
  const last = observed.at(-1);
  const vol = monthlyVolatility(observed.map((row) => row.weighted_price), calibration);
  if (!last || vol === null) return null;
  const byMonth = new Map(observed.map((row) => [row.reporting_month, row.weighted_price]));
  const tail = (100 - calibration.level) / 200;
  const lo = calibration.grid.findIndex((q) => Math.abs(q - tail) < 1e-6), hi = calibration.grid.findIndex((q) => Math.abs(q - (1 - tail)) < 1e-6);
  if (lo < 0 || hi < 0) return null;
  const horizons: OutlookHorizon[] = [];
  for (const entry of calibration.horizons) {
    const target = shiftCalendarMonth(last.reporting_month, entry.horizon);
    const rule = baselines.get(entry.horizon) ?? "last_value";
    const challenger = validated.get(entry.horizon);
    const seasonal = byMonth.get(shiftCalendarMonth(target, -12));
    const model = challenger ? challenger.model : rule === "seasonal_naive" && seasonal ? "seasonal_naive" : "last_value";
    const point = challenger ? challenger.median : model === "seasonal_naive" ? seasonal! : last.weighted_price;
    const move = Math.log(point / last.weighted_price);
    const test = entry.test;
    horizons.push({
      horizon: entry.horizon, target_month: target, model, point,
      lower: point * Math.exp(vol * entry.quantiles[lo]), upper: point * Math.exp(vol * entry.quantiles[hi]),
      chance_higher: 1 - probabilityBelow(-move / vol, entry.quantiles, calibration.grid), band: [entry.quantiles[lo], entry.quantiles[hi]],
      tested: test ? { coverage: test.coverage, months: test.n, from: test.from,
        direction_skill: test.climatology_brier > 0 ? 1 - test.direction_brier / test.climatology_brier : null } : null,
    });
  }
  const history = calibration.calibration;
  return { experiment_id: experimentId, calibrated_at: calibratedAt, level: calibration.level, last_month: last.reporting_month,
    last_price: last.weighted_price, volatility_percent: vol * 100, horizons, point_rule: calibration.point_rule,
    volatility: calibration.vol_method === "ewma"
      ? { vol_window: calibration.vol_window, vol_method: "ewma", vol_lambda: calibration.vol_lambda, vol_max_returns: calibration.vol_max_returns }
      : { vol_window: calibration.vol_window, vol_method: "rms" },
    calibration_history: history?.origins ? { price_basis: history.price_basis, from: history.origins[0], to: history.origins[1], series: history.series } : null };
}

/** Reads the latest engine calibration and this variety's baselines and validated models, then builds the outlook. */
export async function loadOutlook(db: D1Database, variety: string, prices: { reporting_month: string; weighted_price: number | null }[]) {
  const experiment = await db.prepare(`SELECT id, created_at, metadata_json FROM forecast_experiments ORDER BY received_at DESC, id DESC LIMIT 1`)
    .first<{ id: string; created_at: string; metadata_json: string }>();
  if (typeof experiment?.metadata_json !== "string") return null;
  const calibration = (JSON.parse(experiment.metadata_json) as { outlook?: OutlookCalibration }).outlook;
  if (!calibration?.horizons?.length) return null;
  const last = prices.filter((row) => row.weighted_price != null).map((row) => row.reporting_month).sort().at(-1);
  const [baselineRows, validatedRows] = await db.batch([
    db.prepare(`SELECT horizon, MIN(baseline_model) AS baseline_model FROM forecast_model_evaluations
      WHERE experiment_id=? AND variety=? GROUP BY horizon`).bind(experiment.id, variety),
    // A model counts only while its latest event is 'validated', and only with a forecast saved from the latest month on
    // the official monthly basis. Reruns for the same month repeat the forecast; the first one made is used.
    db.prepare(`SELECT p.horizon, p.model, p.median FROM forecast_predictions p
      JOIN (SELECT series_id, horizon, model, model_version, MAX(id) AS id FROM forecast_model_events
        GROUP BY series_id, horizon, model, model_version) e
        ON e.series_id=p.series_id AND e.horizon=p.horizon AND e.model=p.model AND e.model_version=p.model_version
      JOIN forecast_model_events latest ON latest.id=e.id AND latest.event='validated'
      WHERE p.variety=? AND p.origin_period=? AND p.price_basis='MONTHLY_STATE_WEIGHTED_AVERAGE'
        AND p.id = (SELECT MIN(f.id) FROM forecast_predictions f WHERE f.series_id=p.series_id AND f.horizon=p.horizon
          AND f.model=p.model AND f.model_version=p.model_version AND f.origin_period=p.origin_period)`).bind(variety, last ?? ""),
  ]) as [D1Result<{ horizon: number; baseline_model: string }>, D1Result<{ horizon: number; model: string; median: number }>];
  return buildOutlook({
    prices, calibration, experimentId: experiment.id, calibratedAt: experiment.created_at,
    baselines: new Map(baselineRows.results.map((row) => [row.horizon, row.baseline_model])),
    validated: new Map(validatedRows.results.map((row) => [row.horizon, { model: row.model, median: row.median }])),
  });
}

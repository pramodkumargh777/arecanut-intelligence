// What happened to the price in past years after a given month. Shared by the sell-or-hold page and the assistant.
// This is a record of past years, not a forecast: nothing here says what the price will do or what anyone should do.
import { shiftCalendarMonth } from "./dates";

export type HoldPoint = { reporting_month: string; weighted_price: number | null; review_flags?: { code: string }[] };

export const HOLD_HORIZONS = [1, 2, 3, 4, 6] as const;
/** Fewer years than this is an anecdote, so no summary is given. */
export const MIN_HOLD_YEARS = 3;

/**
 * A month out of line with the months on both sides, such as Rashi at ₹36,367 between ₹47,411 and ₹47,117 in January
 * 2024. That may be a data problem, and it would distort every comparison that touches it, so those are left out and
 * named. A single large step stays in, because a real market can move that way and stay there.
 */
export function isIsolatedSpike(point: HoldPoint): boolean {
  const codes = (point.review_flags ?? []).map((flag) => flag.code);
  return codes.includes("large_change_from_previous") && codes.includes("large_change_to_next");
}

const round1 = (value: number) => Math.round(value * 10) / 10;

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export type HoldChange = { months: number; target_month: string; percent: number | null; excluded: boolean };
export type HoldYear = { start_month: string; start_price: number; changes: HoldChange[] };
export type HoldSummary = { months: number; years: number; rose: number; median_percent: number | null; lowest_percent: number | null; highest_percent: number | null };
export type HoldHistory = { years: HoldYear[]; summaries: HoldSummary[]; excluded_months: string[]; first_month: string | null; last_month: string | null };

/** For each past year: the change from `startMonth` (1–12) to each later horizon. Unreported months stay empty, never filled. */
export function holdHistory(points: HoldPoint[], startMonth: number, horizons: readonly number[] = HOLD_HORIZONS): HoldHistory {
  const byMonth = new Map(points.map((point) => [point.reporting_month, point]));
  const usable = (point: HoldPoint | undefined): point is HoldPoint & { weighted_price: number } =>
    Boolean(point && point.weighted_price !== null && point.weighted_price > 0);
  const excluded = new Set(points.filter((point) => usable(point) && isIsolatedSpike(point)).map((point) => point.reporting_month));
  const years: HoldYear[] = [];
  for (const point of points) {
    if (Number(point.reporting_month.slice(5)) !== startMonth || !usable(point)) continue;
    const startExcluded = excluded.has(point.reporting_month);
    const changes = horizons.map((months) => {
      const target_month = shiftCalendarMonth(point.reporting_month, months);
      const target = byMonth.get(target_month);
      const isExcluded = startExcluded || excluded.has(target_month);
      return { months, target_month, excluded: isExcluded, percent: usable(target) && !isExcluded ? round1((target.weighted_price / point.weighted_price - 1) * 100) : null };
    });
    if (changes.some((change) => change.percent !== null || change.excluded)) years.push({ start_month: point.reporting_month, start_price: point.weighted_price, changes });
  }
  const summaries = horizons.map((months) => {
    const values = years.flatMap((year) => year.changes.filter((change) => change.months === months && change.percent !== null).map((change) => change.percent!));
    const enough = values.length >= MIN_HOLD_YEARS;
    return {
      months, years: values.length, rose: values.filter((value) => value > 0).length,
      median_percent: enough ? round1(medianOf(values)) : null,
      lowest_percent: enough ? Math.min(...values) : null, highest_percent: enough ? Math.max(...values) : null,
    };
  });
  const touched = years.flatMap((year) => year.changes.map((change) => change.target_month).filter((month) => byMonth.has(month)));
  return {
    years, summaries, excluded_months: [...excluded].sort(),
    first_month: years[0]?.start_month ?? null, last_month: [...touched].sort().at(-1) ?? null,
  };
}

export type HoldCosts = { annualInterestPercent: number; weightLossPercent: number; storagePerQuintalPerMonth: number };

/**
 * How much the price must rise over `months` for holding to match selling now: interest on the money tied up, weight
 * lost in storage and storage cost, all from the reader's own figures. Null when the inputs cannot give a real answer.
 */
export function holdBreakEvenPercent(months: number, price: number, costs: HoldCosts): number | null {
  const { annualInterestPercent: interest, weightLossPercent: weightLoss, storagePerQuintalPerMonth: storage } = costs;
  if (!(price > 0) || !Number.isFinite(interest) || !Number.isFinite(weightLoss) || !Number.isFinite(storage)
    || interest < 0 || storage < 0 || weightLoss < 0 || weightLoss >= 100) return null;
  const needed = (price * (1 + (interest / 100) * (months / 12)) + storage * months) / (1 - weightLoss / 100);
  return round1((needed / price - 1) * 100);
}

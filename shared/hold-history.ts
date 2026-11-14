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

export type SeasonalPattern = {
  first_year: number; last_year: number; years: number;
  /** Two neighbouring calendar months (1–12) with the highest and the lowest typical price, or null when no season stands out. */
  high: [number, number] | null; low: [number, number] | null;
  /** How far the high months typically sat above the low months, in whole percent. */
  spread_percent: number;
  /** Years in which the high months really were above the low months. */
  consistent_years: number;
};

/** A season must be at least this far apart, and hold in more than half the years, to be called usual. */
const MIN_SEASON_SPREAD_PERCENT = 3;
/** A year needs most of its months to give a fair yearly average to compare each month against. */
const MIN_MONTHS_IN_YEAR = 10;

/**
 * Which two neighbouring months have usually been highest and lowest. Each month is compared with its own year's
 * average, so a year that was dear or cheap overall does not tilt the result. One-month spikes are left out. This
 * describes past seasons only; null when there are too few years to say anything.
 */
export function seasonalPattern(points: HoldPoint[]): SeasonalPattern | null {
  const usable = points.filter((point) => point.weighted_price !== null && point.weighted_price > 0 && !isIsolatedSpike(point));
  const byYear = new Map<number, Map<number, number>>();
  for (const point of usable) {
    const year = Number(point.reporting_month.slice(0, 4));
    if (!byYear.has(year)) byYear.set(year, new Map());
    byYear.get(year)!.set(Number(point.reporting_month.slice(5)), point.weighted_price!);
  }
  const years = [...byYear].filter(([, months]) => months.size >= MIN_MONTHS_IN_YEAR).sort(([a], [b]) => a - b)
    .map(([year, months]) => {
      const mean = [...months.values()].reduce((sum, value) => sum + value, 0) / months.size;
      return { year, index: new Map([...months].map(([month, price]) => [month, price / mean])) };
    });
  if (years.length < MIN_HOLD_YEARS) return null;
  const typical = new Map<number, number>();
  for (let month = 1; month <= 12; month++) {
    const values = years.flatMap((year) => year.index.has(month) ? [year.index.get(month)!] : []);
    if (values.length >= MIN_HOLD_YEARS) typical.set(month, medianOf(values));
  }
  // Pairs wrap from December to January, since the crop year does not follow the calendar.
  const pairs = Array.from({ length: 12 }, (_, i) => [i + 1, (i + 1) % 12 + 1] as [number, number])
    .filter(([a, b]) => typical.has(a) && typical.has(b))
    .map((pair) => ({ pair, value: (typical.get(pair[0])! + typical.get(pair[1])!) / 2 }));
  const base = { first_year: years[0].year, last_year: years.at(-1)!.year, years: years.length };
  if (pairs.length < 2) return null;
  const high = pairs.reduce((best, item) => item.value > best.value ? item : best);
  const low = pairs.reduce((best, item) => item.value < best.value ? item : best);
  const spread = Math.round((high.value / low.value - 1) * 100);
  const pairIndex = (index: Map<number, number>, [a, b]: [number, number]) => index.has(a) && index.has(b) ? (index.get(a)! + index.get(b)!) / 2 : null;
  const compared = years.flatMap((year) => {
    const h = pairIndex(year.index, high.pair), l = pairIndex(year.index, low.pair);
    return h === null || l === null ? [] : [h > l];
  });
  const consistent = compared.filter(Boolean).length;
  if (spread < MIN_SEASON_SPREAD_PERCENT || consistent * 2 <= compared.length)
    return { ...base, high: null, low: null, spread_percent: spread, consistent_years: consistent };
  return { ...base, years: compared.length, high: high.pair, low: low.pair, spread_percent: spread, consistent_years: consistent };
}

/** Where today's price stands, and what followed similar moments before. Past outcomes only; never a forecast. */
export type PriceContext = {
  latest_month: string; price: number;
  /** Latest price against the average of the 12 months before it, as a fraction (−0.12 = 12% below). */
  vs_year_average: number;
  band: "above" | "near" | "below";
  /** Against the same month a year earlier, as a fraction, or null without that month. */
  vs_last_year: number | null;
  /** Where the price sits in its last 24 months. */
  range: "lowest" | "near_low" | "highest" | "near_high" | null;
  /** Past stretches in the same band, and how many were higher `months` later. */
  analogue: { months: 3 | 6; cases: number; higher: number; median_change: number } | null;
  /** The median size of a 3-month move, as a fraction, either way. */
  typical_move: number | null;
};

/** How far from the yearly average counts as above or below it. */
const BAND = 0.05;
/** Fewer similar past stretches than this is an anecdote, so no comparison is given. */
const MIN_ANALOGUES = 5;

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

export function priceContext(points: HoldPoint[]): PriceContext | null {
  const usable = points.filter((point) => point.weighted_price !== null && point.weighted_price > 0 && !isIsolatedSpike(point));
  if (!usable.length) return null;
  const price = new Map(usable.map((point) => [monthIndex(point.reporting_month), point.weighted_price!]));
  const latestPoint = usable.reduce((latest, point) => point.reporting_month > latest.reporting_month ? point : latest);
  const last = monthIndex(latestPoint.reporting_month);
  // The average of the 12 months before a month; at least 9 of them must exist to call it a yearly average.
  const yearRatio = (month: number) => {
    const before = Array.from({ length: 12 }, (_, offset) => price.get(month - 12 + offset)).filter((value): value is number => value !== undefined);
    return before.length >= 9 ? price.get(month)! / (before.reduce((sum, value) => sum + value, 0) / before.length) : null;
  };
  const ratio = yearRatio(last);
  if (ratio === null) return null;
  const bandOf = (value: number): PriceContext["band"] => value > 1 + BAND ? "above" : value < 1 - BAND ? "below" : "near";
  const band = bandOf(ratio);
  const recent = Array.from({ length: 24 }, (_, offset) => price.get(last - 23 + offset)).filter((value): value is number => value !== undefined);
  const low = Math.min(...recent), high = Math.max(...recent), now = price.get(last)!;
  const position = high > low ? (now - low) / (high - low) : null;
  const range = recent.length < 18 || position === null ? null : now <= low ? "lowest" : now >= high ? "highest" : position <= 0.15 ? "near_low" : position >= 0.85 ? "near_high" : null;
  // Similar moments: earlier months in the same band, each at least `months` after the previous one counted, so one
  // long stretch is not counted many times. The longer wait is preferred when there are enough of them.
  const analogueFor = (months: 3 | 6) => {
    const changes: number[] = [];
    let previous = -Infinity;
    for (const month of [...price.keys()].sort((a, b) => a - b)) {
      if (month + months > last - 1 || month - previous < months || !price.has(month + months)) continue;
      const earlier = yearRatio(month);
      if (earlier === null || bandOf(earlier) !== band) continue;
      changes.push(price.get(month + months)! / price.get(month)! - 1);
      previous = month;
    }
    return changes.length >= MIN_ANALOGUES
      ? { months, cases: changes.length, higher: changes.filter((change) => change > 0).length, median_change: medianOf(changes) }
      : null;
  };
  const moves = [...price.keys()].filter((month) => price.has(month + 3)).map((month) => Math.abs(price.get(month + 3)! / price.get(month)! - 1));
  return {
    latest_month: latestPoint.reporting_month, price: now, vs_year_average: ratio - 1, band,
    vs_last_year: price.has(last - 12) ? now / price.get(last - 12)! - 1 : null,
    range, analogue: analogueFor(6) ?? analogueFor(3), typical_move: moves.length >= 12 ? medianOf(moves) : null,
  };
}

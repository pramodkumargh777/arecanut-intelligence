import { calendarDateToTime, DAY_MS } from "../../../shared/dates";

/** Pure, framework-free helpers behind the analytics, scorecard and comparison views. No value is ever imputed. */

export type SortDirection = "asc" | "desc";

/** Compares two optional values; missing values always sort last regardless of direction. */
export function compareNullable(a: number | string | null | undefined, b: number | string | null | undefined, direction: SortDirection): number {
  const aMissing = a === null || a === undefined || (typeof a === "number" && Number.isNaN(a));
  const bMissing = b === null || b === undefined || (typeof b === "number" && Number.isNaN(b));
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
  const result = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
  return direction === "asc" ? result : -result;
}

export function sortRows<T>(rows: readonly T[], value: (row: T) => number | string | null | undefined, direction: SortDirection): T[] {
  return rows.map((row, index) => ({ row, index }))
    .sort((a, b) => compareNullable(value(a.row), value(b.row), direction) || a.index - b.index)
    .map(({ row }) => row);
}

export type DatePreset = "all" | "7d" | "30d" | "90d" | "365d" | "ytd" | "custom";
/** Reporting-period choices; their labels live in the shared copy (COMMON.datePresets) in both languages. */
export const DATE_PRESETS: { value: DatePreset }[] = (["all", "7d", "30d", "90d", "365d", "ytd", "custom"] as const).map((value) => ({ value }));

/** Inclusive calendar range for a preset, anchored to an IST market-calendar date (YYYY-MM-DD). */
export function presetRange(preset: DatePreset, today: string): { from: string; to: string } | null {
  if (preset === "all" || preset === "custom") return null;
  if (preset === "ytd") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  const days = Number(preset.replace("d", ""));
  return { from: new Date(calendarDateToTime(today) - (days - 1) * DAY_MS).toISOString().slice(0, 10), to: today };
}

export type FreshnessState = "fresh" | "stale" | "no_data";
/** Age of the latest market reporting date (not fetch time) relative to the IST calendar date. */
export function reportingFreshness(latest: string | null | undefined, today: string, staleAfterDays: number): { state: FreshnessState; ageDays: number | null } {
  if (!latest) return { state: "no_data", ageDays: null };
  const ageDays = Math.max(0, Math.round((calendarDateToTime(today) - calendarDateToTime(latest.slice(0, 10))) / DAY_MS));
  return { state: ageDays <= staleAfterDays ? "fresh" : "stale", ageDays };
}

export type CompletenessState = "complete" | "partial" | "no_data";
export function completeness(observed: number, expected: number): { percent: number | null; state: CompletenessState } {
  if (expected <= 0 || observed <= 0) return { percent: expected > 0 ? 0 : null, state: "no_data" };
  const percent = Math.min(100, observed / expected * 100);
  return { percent, state: observed >= expected ? "complete" : "partial" };
}

/** Linear-interpolated quantile of a sorted array (p in [0, 1]). */
export function quantile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export type Distribution = { count: number; mean: number | null; median: number | null; min: number | null; max: number | null; q1: number | null; q3: number | null; stdev: number | null; cvPercent: number | null };
export function describe(values: readonly (number | null | undefined)[]): Distribution {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  const count = numbers.length;
  if (!count) return { count: 0, mean: null, median: null, min: null, max: null, q1: null, q3: null, stdev: null, cvPercent: null };
  const mean = numbers.reduce((sum, value) => sum + value, 0) / count;
  const stdev = count > 1 ? Math.sqrt(numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1)) : null;
  return { count, mean, median: quantile(numbers, 0.5), min: numbers[0], max: numbers[count - 1], q1: quantile(numbers, 0.25), q3: quantile(numbers, 0.75),
    stdev, cvPercent: stdev !== null && mean !== 0 ? stdev / mean * 100 : null };
}

/** Equal-width bins between the observed min and max; every observation falls in exactly one bin. */
export function histogram(values: readonly number[], binCount = 8): { from: number; to: number; count: number }[] {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (!numbers.length) return [];
  const min = Math.min(...numbers), max = Math.max(...numbers);
  if (min === max) return [{ from: min, to: max, count: numbers.length }];
  const bins = Math.max(1, Math.floor(binCount));
  const width = (max - min) / bins;
  const result = Array.from({ length: bins }, (_, index) => ({ from: min + index * width, to: index === bins - 1 ? max : min + (index + 1) * width, count: 0 }));
  for (const value of numbers) result[Math.min(bins - 1, Math.floor((value - min) / width))].count += 1;
  return result;
}

/** Calendar-year rows of 12 monthly values; missing months stay null. */
export function yearMonthMatrix(points: readonly { reporting_month: string; weighted_price: number | null }[]): { year: string; values: (number | null)[]; observed: number }[] {
  const years = new Map<string, (number | null)[]>();
  for (const point of points) {
    const year = point.reporting_month.slice(0, 4), month = Number(point.reporting_month.slice(5, 7));
    if (!/^\d{4}$/.test(year) || month < 1 || month > 12) continue;
    const row = years.get(year) ?? Array<number | null>(12).fill(null);
    row[month - 1] = point.weighted_price ?? null;
    years.set(year, row);
  }
  return [...years.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([year, values]) => ({ year, values, observed: values.filter((value) => value !== null).length }));
}

/** Range within one quotation (maximum − minimum) and as a share of its central value. */
export function quoteSpread(row: { minimum_price: number | null; maximum_price: number | null }, central: number | null): { spread: number | null; percent: number | null } {
  if (row.minimum_price === null || row.maximum_price === null || row.maximum_price < row.minimum_price) return { spread: null, percent: null };
  const spread = row.maximum_price - row.minimum_price;
  return { spread, percent: central ? spread / central * 100 : null };
}

/** Highest-to-lowest spread across a same-date cross-section. */
export function crossSectionSpread(values: readonly (number | null | undefined)[]): { high: number | null; low: number | null; spread: number | null; percent: number | null; count: number } {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!numbers.length) return { high: null, low: null, spread: null, percent: null, count: 0 };
  const high = Math.max(...numbers), low = Math.min(...numbers);
  return { high, low, spread: high - low, percent: low > 0 ? (high - low) / low * 100 : null, count: numbers.length };
}

export type RankedRow = { key: string; label: string; detail: string; reporting_date: string; minimum: number | null; central: number; maximum: number | null };
/** Ranks only rows sharing the selected reporting date (or all rows when null), highest central value first. */
export function rankSameDate<T>(rows: readonly T[], toRanked: (row: T) => RankedRow | null, date: string | null): RankedRow[] {
  const ranked = rows.map(toRanked).filter((row): row is RankedRow => row !== null && Number.isFinite(row.central) && (!date || row.reporting_date === date));
  return sortRows(ranked, (row) => row.central, "desc");
}

export type QualityCheck = { code: string; label: string; ok: boolean | null };
/** Observable quality checks for a published observation; null means the attribute was not reported. */
export function observationQuality(row: { minimum_price: number | null; maximum_price: number | null; modal_price: number; original_unit?: string | null; price_unit: string; arrival_quantity: number | null; source_record_id?: string | null }): QualityCheck[] {
  const bounded = row.minimum_price !== null && row.maximum_price !== null;
  return [
    { code: "range", label: bounded ? "Modal within reported min–max" : "Min/max not reported", ok: bounded ? row.minimum_price! <= row.modal_price && row.modal_price <= row.maximum_price! : null },
    { code: "unit", label: row.original_unit ? `Unit normalized from ${row.original_unit}` : "Source unit not recorded", ok: row.original_unit ? true : null },
    { code: "arrivals", label: row.arrival_quantity !== null ? "Arrival quantity reported" : "Arrival quantity not reported", ok: row.arrival_quantity !== null ? true : null },
    { code: "provenance", label: row.source_record_id ? "Source record ID retained" : "No source record ID", ok: Boolean(row.source_record_id) },
  ];
}

export type ForecastStatus = "validated" | "candidate" | "reference_only" | "not_evaluated";
/** Summarizes the strongest status any model has earned; never upgrades a reference baseline. */
export function forecastValidationStatus(counts: Partial<Record<string, number>> | undefined, validatedEvents = 0): ForecastStatus {
  if (!counts || !Object.values(counts).some((value) => (value ?? 0) > 0)) return "not_evaluated";
  if (validatedEvents > 0) return "validated";
  if ((counts.candidate ?? 0) > 0) return "candidate";
  return "reference_only";
}


import { calendarDateToTime, DAY_MS, shiftCalendarMonth } from "../../../shared/dates";

export type ChartObservation = { reporting_date: string; value: number; constituents: number };

export function buildChartData(points: ChartObservation[], interval: "daily" | "monthly", range?: { from: string; to: string }) {
  const ordered = [...points].sort((a, b) => a.reporting_date.localeCompare(b.reporting_date));
  const ordinal = (date: string) => {
    const time = calendarDateToTime(date);
    if (interval === "monthly" && !date.endsWith("-01")) throw new Error("Monthly observations must use the first of the reporting month");
    return interval === "daily" ? time / DAY_MS : Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  };
  const series: [number, number | null][] = [];
  ordered.forEach((point, index) => {
    if (!Number.isFinite(point.value)) throw new Error(`Invalid chart price for ${point.reporting_date}`);
    const position = ordinal(point.reporting_date);
    const previous = ordered[index - 1];
    if (previous) {
      const distance = position - ordinal(previous.reporting_date);
      if (distance <= 0) throw new Error(`Duplicate chart reporting date: ${point.reporting_date}`);
      if (distance > 1) {
        const gap = interval === "daily" ? calendarDateToTime(previous.reporting_date) + DAY_MS
          : calendarDateToTime(`${shiftCalendarMonth(previous.reporting_date.slice(0, 7), 1)}-01`);
        series.push([gap, null]);
      }
    }
    series.push([calendarDateToTime(point.reporting_date), point.value]);
  });
  const from = range?.from ?? ordered[0]?.reporting_date;
  const to = range?.to ?? ordered.at(-1)?.reporting_date;
  const expected = from && to ? ordinal(to) - ordinal(from) + 1 : 0;
  if (expected < 0 || (from && to && (from > to || ordered.some((point) => point.reporting_date < from || point.reporting_date > to)))) {
    throw new Error("Chart observations must fall within an ascending calendar range");
  }
  return { ordered, series, from, to, observations: ordered.length, missing: expected - ordered.length };
}

type ChartPoint = [number, number | null];
const GAP_LIMIT_DAYS = { daily: 7, monthly: 93 } as const;

/** Joins reports across a short gap (weekend, holiday, one missing month); a longer gap stays a visible break. No value is added. */
export function connectShortGaps(series: ChartPoint[], interval: "daily" | "monthly"): ChartPoint[] {
  return series.filter(([, value], index) => {
    if (value !== null) return true;
    const previous = series[index - 1], next = series[index + 1];
    return !previous || !next || (next[0] - previous[0]) / DAY_MS > GAP_LIMIT_DAYS[interval];
  });
}

/** Calendar periods with no report, so a caption can name them instead of only counting them. */
export function missingPeriods(points: ChartObservation[], interval: "daily" | "monthly", range?: { from: string; to: string }): string[] {
  const reported = new Set(points.map((point) => point.reporting_date));
  const from = range?.from ?? points[0]?.reporting_date, to = range?.to ?? points.at(-1)?.reporting_date;
  if (!from || !to) return [];
  const missing: string[] = [];
  for (let date = from; date <= to; date = interval === "daily"
    ? new Date(calendarDateToTime(date) + DAY_MS).toISOString().slice(0, 10)
    : `${shiftCalendarMonth(date.slice(0, 7), 1)}-01`) {
    if (!reported.has(date)) missing.push(date);
  }
  return missing;
}

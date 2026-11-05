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

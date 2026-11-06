// Share-market style movement for cooperative rates. A branch is only ever compared with itself, for the same source
// and variety, so a change means the price moved and not that a different mix of branches reported.
import { calendarDateToTime, DAY_MS } from "./dates";

export type DatedPrice = { branch: string; variety: string; reporting_date: string; average_price: number | null };
export type PriceChange = { amount: number; percent: number; previous_date: string; previous_price: number };
export type MarketBreadth = { up: number; down: number; flat: number; median_percent: number | null };

/** A report older than this says little about the current move, so no change is shown. */
export const MAX_CHANGE_GAP_DAYS = 30;

/** Ignores case and spacing, so NEW RASHIEDI and NEWRASHIEDI are one label. */
export const varietyKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Change from the same branch's previous report. Null for a first report, or when that report is too old. */
export function priceChange(latest: DatedPrice, history: DatedPrice[], maxGapDays = MAX_CHANGE_GAP_DAYS): PriceChange | null {
  if (latest.average_price === null) return null;
  const previous = history
    .filter((row) => row.branch === latest.branch && varietyKey(row.variety) === varietyKey(latest.variety)
      && row.reporting_date < latest.reporting_date && row.average_price !== null && row.average_price > 0)
    .sort((a, b) => b.reporting_date.localeCompare(a.reporting_date))[0];
  if (!previous) return null;
  const gap = (calendarDateToTime(latest.reporting_date) - calendarDateToTime(previous.reporting_date)) / DAY_MS;
  if (gap > maxGapDays) return null;
  const amount = latest.average_price - previous.average_price!;
  return { amount, percent: Math.round((amount / previous.average_price!) * 1000) / 10, previous_date: previous.reporting_date, previous_price: previous.average_price! };
}

/** How many branches rose and fell, and the middle branch's change. Branches with no earlier report are not counted. */
export function marketBreadth(changes: (PriceChange | null)[]): MarketBreadth {
  const known = changes.filter((change): change is PriceChange => change !== null);
  const percents = known.map((change) => change.percent).sort((a, b) => a - b);
  const middle = Math.floor(percents.length / 2);
  const median = !percents.length ? null : percents.length % 2 ? percents[middle] : (percents[middle - 1] + percents[middle]) / 2;
  return {
    up: known.filter((change) => change.amount > 0).length,
    down: known.filter((change) => change.amount < 0).length,
    flat: known.filter((change) => change.amount === 0).length,
    median_percent: median === null ? null : Math.round(median * 10) / 10,
  };
}

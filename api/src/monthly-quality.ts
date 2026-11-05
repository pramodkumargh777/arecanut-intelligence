import { shiftCalendarMonth } from "../../shared/dates";

export const MONTHLY_ANOMALY_THRESHOLD = 0.2;
export const MONTHLY_REVIEW_METHOD = "monthly-adjacent-change-v1";
export type MonthlyReviewPrice = { reporting_month: string; weighted_price: number | null; price_unit?: string };
export type ReviewFlag = { code: string; explanation: string };

export function monthlyReviewFlags(row: MonthlyReviewPrice, prices: Map<string, MonthlyReviewPrice>): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  const value = row.weighted_price;
  if (row.price_unit && row.price_unit !== "INR/quintal") {
    flags.push({ code: "unexpected_unit", explanation: `Stored unit ${row.price_unit} differs from the monthly source contract INR/quintal. Inspect source evidence before use.` });
  }
  if (value === null) return flags;
  if (!Number.isFinite(value) || value <= 0) {
    flags.push({ code: "nonpositive_price", explanation: "Non-positive or invalid stored price. Preserved for source review; not replaced or removed." });
    return flags;
  }
  if (row.price_unit && row.price_unit !== "INR/quintal") return flags;
  for (const offset of [-1, 1]) {
    const adjacent = prices.get(shiftCalendarMonth(row.reporting_month, offset));
    if (adjacent?.weighted_price == null || adjacent.weighted_price <= 0
      || (adjacent.price_unit && adjacent.price_unit !== "INR/quintal")) continue;
    const previous = offset === -1 ? adjacent.weighted_price : value;
    const next = offset === -1 ? value : adjacent.weighted_price;
    const change = (next - previous) / previous;
    if (Math.abs(change) + Number.EPSILON >= MONTHLY_ANOMALY_THRESHOLD) {
      flags.push({
        code: offset === -1 ? "large_change_from_previous" : "large_change_to_next",
        explanation: `${(change * 100).toFixed(2)}% change ${offset === -1 ? `from ${adjacent.reporting_month} (${previous}) to this month (${next})` : `from this month (${previous}) to ${adjacent.reporting_month} (${next})`} INR/quintal. Meets the 20% adjacent-calendar-month review threshold. This is not proof of an erroneous price; arrival mix or publisher revisions may affect weighted prices. Inspect exact variety, unit and archived source.`,
      });
    }
  }
  return flags;
}

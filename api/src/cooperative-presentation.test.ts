import { describe, expect, it } from "vitest";
import { formatCalendarDate } from "../../shared/dates";
import { describeFreshness, reviewFlags, unitConfirmed } from "../../frontend/src/services/cooperative";

describe("cooperative review presentation", () => {
  it("treats only source-confirmed INR/quintal as publishable", () => {
    expect(unitConfirmed({ unit_status: "source_confirmed", price_unit: "INR/quintal" })).toBe(true);
    expect(unitConfirmed({ unit_status: "assumed", price_unit: "INR/quintal" })).toBe(false);
    expect(unitConfirmed({ unit_status: "source_conflict", price_unit: "unconfirmed" })).toBe(false);
    expect(unitConfirmed({ unit_status: "source_confirmed", price_unit: "INR/kg" })).toBe(false);
  });

  it("reads stored review flags without trusting malformed JSON", () => {
    expect(reviewFlags('["variety_not_reported","declared_unit_conflicts_with_magnitude"]')).toEqual(["variety_not_reported", "declared_unit_conflicts_with_magnitude"]);
    expect(reviewFlags('["ok", 3, null]')).toEqual(["ok"]);
    expect(reviewFlags("{not json")).toEqual([]);
    expect(reviewFlags('{"a":1}')).toEqual([]);
    expect(reviewFlags(null)).toEqual([]);
  });

  it("describes freshness from market reporting dates, not fetch times", () => {
    expect(describeFreshness({ freshness: { latest_reporting_date: null, age_days: null, state: "no_data" } })).toBe("No stored reporting dates");
    expect(describeFreshness({ freshness: { latest_reporting_date: "2026-11-04", age_days: 0, state: "fresh" } }))
      .toBe(`Fresh · latest market reporting date ${formatCalendarDate("2026-11-04")} (0 days old)`);
    expect(describeFreshness({ freshness: { latest_reporting_date: "2026-10-26", age_days: 9, state: "stale" } }))
      .toBe(`Stale · latest market reporting date ${formatCalendarDate("2026-10-26")} (9 days old)`);
    expect(describeFreshness({ freshness: { latest_reporting_date: "2026-11-03", age_days: 1, state: "fresh" } })).toContain("(1 day old)");
  });
});

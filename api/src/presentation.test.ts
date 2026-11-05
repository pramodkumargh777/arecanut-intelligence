import { afterEach, describe, expect, it } from "vitest";
import { calendarDateToTime, calendarTodayIST, completedMonthIST, formatCalendarDate, formatCalendarMonth, formatChartDate, formatTimestampIST, timestampToTime } from "../../shared/dates";
import { buildChartData } from "../../frontend/src/services/chart";
import { defaultGeography } from "../../frontend/src/services/intelligence";
import { completedMonth } from "./forecast";
import { previousMonth } from "./monthly";

const originalTimezone = process.env.TZ;
afterEach(() => { process.env.TZ = originalTimezone; });

describe("calendar dates and explicit IST timestamps", () => {
  it.each(["UTC", "Asia/Kolkata", "America/Los_Angeles"])("preserves reporting dates and years in %s", (zone) => {
    process.env.TZ = zone;
    expect(formatCalendarDate("2024-01-01")).toBe("1 Jan 2024");
    expect(formatChartDate(calendarDateToTime("2024-01-01"))).toBe("1 Jan 2024");
    expect(formatChartDate(calendarDateToTime("2025-01-01"))).toBe("1 Jan 2025");
    expect(formatCalendarMonth("2024-01")).toBe("Jan 2024");
    expect(formatCalendarMonth("2025-01")).toBe("Jan 2025");
    expect(formatTimestampIST("2026-11-03T20:00:00Z")).toBe("4 Nov 2026, 01:30:00 IST");
    expect(formatTimestampIST("2026-11-03 20:00:00")).toBe("4 Nov 2026, 01:30:00 IST");
    expect(formatTimestampIST("2026-11-04T01:30:00+05:30")).toBe("4 Nov 2026, 01:30:00 IST");
  });
  it("rejects invalid or ambiguous inputs rather than rolling dates or guessing a timezone", () => {
    for (const date of ["2025-02-29", "2024-02-30", "2024-13-01", "01/02/2024", "2024-01", "2024-01-01T00:00:00Z"]) {
      expect(() => calendarDateToTime(date)).toThrow();
    }
    expect(formatCalendarDate("2024-02-29")).toBe("29 Feb 2024");
    for (const time of ["2026-11-04", "2026-11-04T00:00:00", "2026-02-30T00:00:00Z", "2026-11-04T24:00:00Z", "2026-11-04T01:60:00Z", "bad"]) {
      expect(() => timestampToTime(time)).toThrow();
    }
  });
  it("aligns frontend, monthly API and forecast execution at IST month/year boundaries", () => {
    const now = new Date("2025-12-31T18:30:00Z");
    expect(calendarTodayIST(now)).toBe("2026-01-01");
    expect(completedMonthIST(now)).toBe("2025-12");
    expect(previousMonth(now)).toBe("2025-12");
    expect(completedMonth(now.toISOString())).toBe("2025-12");
    expect(completedMonthIST(new Date("2025-12-31T18:29:59Z"))).toBe("2025-11");
  });
});

describe("sparse chart observations", () => {
  const point = (date: string, value = 45000) => ({ reporting_date: date, value, constituents: 3 });
  it("breaks lines across daily gaps and counts calendar absence without interpolating", () => {
    const chart = buildChartData([point("2026-11-03"), point("2026-10-31")], "daily");
    expect(chart.observations).toBe(2); expect(chart.missing).toBe(2);
    expect(chart.series).toEqual([
      [calendarDateToTime("2026-10-31"), 45000],
      [calendarDateToTime("2026-11-01"), null],
      [calendarDateToTime("2026-11-03"), 45000],
    ]);
  });
  it("uses true calendar months, preserving leap years and year transitions", () => {
    const chart = buildChartData([point("2023-12-01"), point("2024-01-01"), point("2024-03-01")], "monthly",
      { from: "2023-11-01", to: "2024-04-01" });
    expect(chart.observations).toBe(3); expect(chart.missing).toBe(3);
    expect(chart.series.map(([time, value]) => [formatChartDate(time), value])).toEqual([
      ["1 Dec 2023", 45000], ["1 Jan 2024", 45000], ["1 Feb 2024", null], ["1 Mar 2024", 45000],
    ]);
  });
  it("keeps a single observation as a marker and handles empty selected ranges", () => {
    expect(buildChartData([point("2026-11-03")], "daily")).toMatchObject({ observations: 1, missing: 0 });
    expect(buildChartData([], "monthly", { from: "2024-01-01", to: "2024-12-01" })).toMatchObject({ observations: 0, missing: 12, series: [] });
    expect(buildChartData([], "daily")).toMatchObject({ observations: 0, missing: 0, series: [] });
  });
  it("rejects duplicate dates, non-finite values and out-of-range dates explicitly", () => {
    expect(() => buildChartData([point("2024-01-01"), point("2024-01-01")], "daily")).toThrow("Duplicate");
    expect(() => buildChartData([point("2024-01-01", NaN)], "monthly")).toThrow("price");
    expect(() => buildChartData([point("2024-01-02")], "monthly")).toThrow("first");
    expect(() => buildChartData([point("2024-01-01")], "monthly", { from: "2024-02-01", to: "2024-03-01" })).toThrow("range");
    expect(() => buildChartData([], "daily", { from: "2024-01-02", to: "2024-01-01" })).toThrow("range");
  });
});

it("defaults production and reset geography to Karnataka without restricting other modules", () => {
  expect(defaultGeography("production")).toBe("Karnataka");
  expect(defaultGeography("trade")).toBe("");
  expect(defaultGeography("weather")).toBe("");
});

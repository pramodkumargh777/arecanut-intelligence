import { describe as suite, expect, it } from "vitest";
import {
  completeness, crossSectionSpread, describe, forecastValidationStatus, histogram, observationQuality, presetRange, quantile,
  quoteSpread, rankSameDate, reportingFreshness, sortRows, yearMonthMatrix,
} from "../../frontend/src/services/insights";
import { csvCell, toCsv } from "../../frontend/src/services/csv";
import { createProfile, EMPTY_STORE, parseStore, profileSearch, removeProfile, upsertProfile, WORKSPACE_STORAGE_KEY, loadStore, saveStore } from "../../frontend/src/services/workspace";

suite("sorting", () => {
  it("keeps missing values last in both directions and is stable", () => {
    const rows = [{ id: "a", v: 2 }, { id: "b", v: null }, { id: "c", v: 5 }, { id: "d", v: 2 }];
    expect(sortRows(rows, (row) => row.v, "asc").map((row) => row.id)).toEqual(["a", "d", "c", "b"]);
    expect(sortRows(rows, (row) => row.v, "desc").map((row) => row.id)).toEqual(["c", "a", "d", "b"]);
  });
  it("sorts strings with localeCompare", () => {
    expect(sortRows(["Sagara", "Bhadravathi", "Sirsi"], (value) => value, "asc")).toEqual(["Bhadravathi", "Sagara", "Sirsi"]);
  });
});

suite("date presets and freshness", () => {
  it("builds inclusive calendar ranges anchored to the IST date", () => {
    expect(presetRange("7d", "2026-11-05")).toEqual({ from: "2026-10-30", to: "2026-11-05" });
    expect(presetRange("30d", "2026-03-01")).toEqual({ from: "2026-01-31", to: "2026-03-01" });
    expect(presetRange("365d", "2024-12-31")).toEqual({ from: "2024-01-02", to: "2024-12-31" });
    expect(presetRange("ytd", "2026-11-05")).toEqual({ from: "2026-01-01", to: "2026-11-05" });
    expect(presetRange("all", "2026-11-05")).toBeNull();
    expect(presetRange("custom", "2026-11-05")).toBeNull();
  });
  it("measures reporting-date age, not fetch time", () => {
    expect(reportingFreshness("2026-11-03", "2026-11-05", 3)).toEqual({ state: "fresh", ageDays: 2 });
    expect(reportingFreshness("2026-10-25", "2026-11-05", 3)).toEqual({ state: "stale", ageDays: 11 });
    expect(reportingFreshness("2026-11-05T23:30:00+05:30", "2026-11-05", 3)).toEqual({ state: "fresh", ageDays: 0 });
    expect(reportingFreshness(null, "2026-11-05", 3)).toEqual({ state: "no_data", ageDays: null });
  });
  it("reports completeness without exceeding 100%", () => {
    expect(completeness(70, 70)).toEqual({ percent: 100, state: "complete" });
    expect(completeness(3, 12)).toEqual({ percent: 25, state: "partial" });
    expect(completeness(0, 12)).toEqual({ percent: 0, state: "no_data" });
    expect(completeness(0, 0)).toEqual({ percent: null, state: "no_data" });
  });
});

suite("distribution statistics", () => {
  it("ignores missing values instead of treating them as zero", () => {
    const stats = describe([10, null, 20, undefined, 30, Number.NaN, 40]);
    expect(stats.count).toBe(4);
    expect(stats.mean).toBe(25);
    expect(stats.median).toBe(25);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(40);
    expect(stats.q1).toBe(17.5);
    expect(stats.stdev).toBeCloseTo(12.9099, 4);
    expect(stats.cvPercent).toBeCloseTo(51.64, 2);
    expect(describe([]).mean).toBeNull();
    expect(describe([5]).stdev).toBeNull();
  });
  it("interpolates quantiles", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([], 0.5)).toBeNull();
  });
  it("puts every value in exactly one histogram bin", () => {
    const values = [1, 2, 2, 3, 9, 10];
    const bins = histogram(values, 3);
    expect(bins).toHaveLength(3);
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(values.length);
    expect(bins[0].from).toBe(1);
    expect(bins[2].to).toBe(10);
    expect(histogram([7, 7])).toEqual([{ from: 7, to: 7, count: 2 }]);
    expect(histogram([])).toEqual([]);
  });
});

suite("year-month matrix", () => {
  it("leaves missing months null and counts observed months", () => {
    const matrix = yearMonthMatrix([
      { reporting_month: "2024-01", weighted_price: 100 }, { reporting_month: "2024-03", weighted_price: null },
      { reporting_month: "2023-12", weighted_price: 90 }, { reporting_month: "bad", weighted_price: 1 },
    ]);
    expect(matrix.map((row) => row.year)).toEqual(["2023", "2024"]);
    expect(matrix[1].values[0]).toBe(100);
    expect(matrix[1].values[1]).toBeNull();
    expect(matrix[1].observed).toBe(1);
    expect(matrix[0].values[11]).toBe(90);
  });
});

suite("spreads and same-date ranking", () => {
  it("computes quote spreads only for valid ranges", () => {
    expect(quoteSpread({ minimum_price: 40000, maximum_price: 50000 }, 45000)).toEqual({ spread: 10000, percent: 10000 / 45000 * 100 });
    expect(quoteSpread({ minimum_price: 50000, maximum_price: 40000 }, 45000)).toEqual({ spread: null, percent: null });
    expect(quoteSpread({ minimum_price: null, maximum_price: 40000 }, 45000).spread).toBeNull();
  });
  it("computes cross-section spread over reported values only", () => {
    expect(crossSectionSpread([50000, null, 40000, 45000])).toEqual({ high: 50000, low: 40000, spread: 10000, percent: 25, count: 3 });
    expect(crossSectionSpread([null]).count).toBe(0);
  });
  it("never ranks observations from different reporting dates together", () => {
    const rows = [
      { key: "a", date: "2026-11-03", value: 48000 }, { key: "b", date: "2026-11-03", value: 51000 }, { key: "c", date: "2026-11-02", value: 60000 },
    ];
    const ranked = rankSameDate(rows, (row) => ({ key: row.key, label: row.key, detail: "", reporting_date: row.date, minimum: null, central: row.value, maximum: null }), "2026-11-03");
    expect(ranked.map((row) => row.key)).toEqual(["b", "a"]);
  });
});

suite("observation quality", () => {
  it("reports unreported attributes as unknown, not failed", () => {
    const checks = observationQuality({ minimum_price: null, maximum_price: null, modal_price: 45000, original_unit: null, price_unit: "INR/quintal", arrival_quantity: null, source_record_id: "r1" });
    expect(checks.find((check) => check.code === "range")?.ok).toBeNull();
    expect(checks.find((check) => check.code === "unit")?.ok).toBeNull();
    expect(checks.find((check) => check.code === "arrivals")?.ok).toBeNull();
    expect(checks.find((check) => check.code === "provenance")?.ok).toBe(true);
  });
  it("flags a modal price outside its reported range", () => {
    const checks = observationQuality({ minimum_price: 40000, maximum_price: 44000, modal_price: 45000, original_unit: "Rs./Quintal", price_unit: "INR/quintal", arrival_quantity: 12, source_record_id: null });
    expect(checks.find((check) => check.code === "range")?.ok).toBe(false);
    expect(checks.find((check) => check.code === "provenance")?.ok).toBe(false);
  });
});

suite("forecast validation status", () => {
  it("never reports validated without prospective validation events", () => {
    expect(forecastValidationStatus(undefined)).toBe("not_evaluated");
    expect(forecastValidationStatus({ candidate: 0, reference: 0 })).toBe("not_evaluated");
    expect(forecastValidationStatus({ candidate: 4, reference: 10 })).toBe("candidate");
    expect(forecastValidationStatus({ not_better_than_baseline: 255, reference: 10 })).toBe("reference_only");
    expect(forecastValidationStatus({ candidate: 4 }, 1)).toBe("validated");
  });
});

suite("CSV export", () => {
  it("neutralizes spreadsheet formulas but keeps negative numbers", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(null)).toBe("");
    expect(toCsv([["a", "b,c"], [1, "line\nbreak"]])).toBe("a,\"b,c\"\r\n1,\"line\nbreak\"");
  });
});

suite("workspace profiles", () => {
  const now = new Date("2026-11-05T06:00:00Z");
  it("creates profiles from role templates", () => {
    const profile = createProfile("analyst", "Research desk", now, "p1");
    expect(profile).toMatchObject({ feed: "official", datePreset: "365d", commodity: "arecanut" });
    expect(profile.sections).toContain("forecast_status");
  });
  it("discards malformed or tampered storage", () => {
    expect(parseStore(null)).toEqual(EMPTY_STORE);
    expect(parseStore("{not json")).toEqual(EMPTY_STORE);
    expect(parseStore(JSON.stringify({ version: 1, activeId: null, profiles: [{ id: "x", name: "<script>", role: "admin" }] }))).toEqual(EMPTY_STORE);
  });
  it("round-trips through storage and repairs a dangling active id", () => {
    const memory = new Map<string, string>();
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) };
    let store = upsertProfile(EMPTY_STORE, createProfile("grower", "Sagara growers", now, "p1"));
    store = upsertProfile(store, createProfile("trader", "Desk", now, "p2"));
    expect(saveStore({ ...store, activeId: "missing" }, storage)).toBe(true);
    expect(memory.has(WORKSPACE_STORAGE_KEY)).toBe(true);
    const loaded = loadStore(storage);
    expect(loaded.profiles).toHaveLength(2);
    expect(loaded.activeId).toBe("p1");
    expect(removeProfile(loaded, "p1").activeId).toBe("p2");
  });
  it("updates in place and caps the number of profiles", () => {
    let store = EMPTY_STORE;
    for (let index = 0; index < 20; index += 1) store = upsertProfile(store, createProfile("grower", `P${index}`, now, `p${index}`));
    expect(() => upsertProfile(store, createProfile("grower", "Overflow", now, "p20"))).toThrow(/at most 20/);
    const renamed = upsertProfile(store, { ...store.profiles[0], name: "Renamed" });
    expect(renamed.profiles).toHaveLength(20);
    expect(renamed.profiles[0].name).toBe("Renamed");
  });
  it("builds shortcut query strings the market pages already read", () => {
    expect(profileSearch({ commodity: "arecanut", feed: "mamcos", variety: "Rashi" })).toBe("?feed=mamcos&variety=Rashi");
    expect(profileSearch({ commodity: "black_pepper", feed: "tumcos", variety: "" })).toBe("?commodity=black_pepper&feed=tumcos");
  });
});

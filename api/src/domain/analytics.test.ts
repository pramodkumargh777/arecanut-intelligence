import { describe, expect, it } from "vitest";
import { buildReferenceSeries, median, percentageChange, type Observation } from "./analytics";

const observation = (id: string, market: string, date: string, price: number): Observation => ({
  id,
  reporting_date: date,
  market_id: market,
  market_name: market,
  district: "Test district",
  variety_name: "Rashi",
  minimum_price: price - 10,
  maximum_price: price + 10,
  modal_price: price,
  arrival_quantity: null,
  price_unit: "INR/quintal",
  source_name: "AGMARKNET",
  source_record_id: id,
  ingestion_timestamp: `${date}T12:00:00Z`,
});

describe("market analytics", () => {
  it("calculates an odd and even median without mutating input", () => {
    const values = [5, 1, 3, 2];
    expect(median([5, 1, 3])).toBe(3);
    expect(median(values)).toBe(2.5);
    expect(values).toEqual([5, 1, 3, 2]);
    expect(median([])).toBeNull();
  });

  it("withholds daily index values below configured market coverage", () => {
    const points = [
      observation("a", "m1", "2025-01-01", 100),
      observation("b", "m2", "2025-01-01", 120),
      observation("c", "m3", "2025-01-02", 90),
    ];
    expect(buildReferenceSeries(points, 2)).toEqual([
      { reporting_date: "2025-01-01", median_modal_price: 110, market_count: 2 },
    ]);
  });

  it("uses one observation per market for a daily median", () => {
    const points = [
      observation("a", "m1", "2025-01-01", 100),
      observation("b", "m1", "2025-01-01", 130),
      observation("c", "m2", "2025-01-01", 120),
    ];
    points[0].ingestion_timestamp = "2025-01-01T12:00:00Z";
    points[1].ingestion_timestamp = "2025-01-01T13:00:00Z";
    points[2].ingestion_timestamp = "2025-01-01T12:00:00Z";
    const result = buildReferenceSeries(points, 2);
    expect(result[0].market_count).toBe(2);
    expect(result[0].median_modal_price).toBe(125);
  });

  it("returns no percentage for missing or zero baselines", () => {
    expect(percentageChange(120, 100)).toBe(20);
    expect(percentageChange(120, 0)).toBeNull();
    expect(percentageChange(null, 100)).toBeNull();
  });
});

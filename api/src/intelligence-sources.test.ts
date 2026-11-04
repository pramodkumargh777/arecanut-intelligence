import { describe, expect, it } from "vitest";
import { parseDasd, parsePib, parsePibExport, parseDasdNews, parseWeather, validDay, type PdfItem } from "./intelligence-sources";

function weather() {
  const days = Array.from({ length: 14 }, (_, index) => new Date(Date.UTC(2026, 9, 28 + index)).toISOString().slice(0, 10));
  return { latitude: 14.657, longitude: 74.86, elevation: 595, timezone: "Asia/Kolkata",
    daily_units: { time: "iso8601", temperature_2m_max: "°C", temperature_2m_min: "°C", precipitation_sum: "mm" },
    daily: { time: days, temperature_2m_max: days.map(() => 30), temperature_2m_min: days.map(() => 20), precipitation_sum: days.map(() => 0) } };
}
describe("independent source parsing", () => {
  it("preserves weather zeros, date scope and model-only labels", () => {
    const data = parseWeather(weather(), "2026-11-03T19:30:00Z");
    expect(data.rows).toHaveLength(14);
    expect(data.rows.find((row) => row.date === "2026-11-03")).toMatchObject({ rain: 0, kind: "recent_model" });
    expect(data.rows.find((row) => row.date === "2026-11-04")).toMatchObject({ kind: "forecast_model" });
  });
  it("rejects stale dates, shifted grids, unit changes and partial weather arrays", () => {
    expect(() => parseWeather(weather(), "2027-01-01T00:00:00Z")).toThrow("stale");
    expect(() => parseWeather({ ...weather(), latitude: 15.5 }, "2026-11-04T00:00:00Z")).toThrow("Sirsi");
    expect(() => parseWeather({ ...weather(), daily_units: { ...weather().daily_units, precipitation_sum: "inch" } }, "2026-11-04T00:00:00Z")).toThrow();
    const value = weather(); value.daily.temperature_2m_max.pop();
    expect(() => parseWeather(value, "2026-11-04T00:00:00Z")).toThrow("Incomplete");
  });
  it("rejects invalid date/temperature/rain data without turning it into zero", () => {
    const value = weather(); value.daily.precipitation_sum[0] = -1;
    expect(() => parseWeather(value, "2026-11-04T00:00:00Z")).toThrow("Invalid");
    expect(validDay("2026-02-30")).toBe(false);
    expect(validDay("2024-02-29")).toBe(true);
  });
  it("extracts dated official release titles without treating fetch date as publication", () => {
    expect(parsePib('<h1>Areca Nut tariff notification</h1>Posted On: 14 AUG 2025 7:14PM Release ID: 2156521', "2156521"))
      .toEqual({ title: "Areca Nut tariff notification", published: "2025-08-14", is_policy: true });
    expect(() => parsePib('<h1>Areca nut development</h1>Release ID: 2159561', "2159561")).toThrow("publication date");
    expect(() => parsePib('<h1>Unrelated title</h1>14 AUG 2025 7:14PM 2156521', "2156521")).toThrow();
  });
  it("preserves an announcement's calendar date across local timezones and converts explicit export crore units", () => {
    expect(parseDasdNews('<h1>Second Advance Estimates for 2025-26</h1><span itemprop="datePublished"> July 18, 2026 </span>Spices-Areca-Betel-2025-26-Second-Advance-consolidated.pdf'))
      .toMatchObject({ published: "2026-07-18" });
    expect(parsePibExport("In 2023&ndash;24, India exported 10,637 tonnes of areca nuts worth ₹400 crore."))
      .toEqual({ period: "2023-24", quantity: 10637, value_lakh: 40000 });
    expect(parsePibExport("India exported nuts worth 400.")).toBeNull();
  });
  it("rejects commodity/period or unit layout drift in PDF tables", () => {
    const items: PdfItem[] = [{ str: "Import of arecanut 2021-22 2022-23 2023-24 2024-25", x: 0, y: 1 }];
    expect(() => parseDasd("trade_imports", items)).toThrow("units");
    expect(() => parseDasd("production_latest", items)).toThrow("reporting years");
  });
  it("uses PDF positions to preserve missing partner periods instead of shifting values left", () => {
    const items: PdfItem[] = [{ str: "Import of arecanut 2021-22 2022-23 2023-24 2024-25 Quantity (tonnes) Value (Rs. Lakhs) Source: Dept of Commerce", x: 0, y: 900 }];
    ["Bangladesh", "Indonesia", "Sri Lanka", "Myanmar", "Bhutan", "UAE", "Total"].forEach((partner, i) => {
      const y = 800 - i * 30;
      items.push({ str: partner, x: 10, y });
      for (let j = partner === "Bangladesh" ? 2 : 0; j < 8; j++) items.push({ str: partner === "Total" ? "100" : "10", x: 100 + j * 50, y: partner === "Total" ? y - 8 : y });
    });
    const parsed = parseDasd("trade_imports", items);
    expect(parsed.domain).toBe("trade");
    if (parsed.domain === "trade") {
      expect(parsed.rows.find((row) => row.partner === "Bangladesh" && row.period === "2021-22")).toMatchObject({ quantity: null, value: null });
      expect(parsed.rows.find((row) => row.partner === "Bangladesh" && row.period === "2022-23")).toMatchObject({ quantity: 10, value: 10 });
    }
    items.push({ str: "11", x: 200, y: 800 });
    expect(() => parseDasd("trade_imports", items)).toThrow("duplicated");
  });
});

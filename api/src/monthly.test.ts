import { describe, expect, it, vi, afterEach } from "vitest";
import { MONTHLY_METHOD, monthlySourceUrl, parseCsv, parseMonthlyEvidence, parseMonthlyReport, previousMonth, refreshMonthly } from "./monthly";

const report = `,,,"State/UT-wise & Variety-wise Prices Monthly Analysis for Arecanut(Betelnut/Supari) - October, 2026",,
Variety,"Prices October, 2026 (Rs./Quintal)","Prices September, 2026 (Rs./Quintal)","Prices October, 2025 (Rs./Quintal)",Change (Over Previous Month),Change (Over Previous Year)
Goa,,,,,
Rashi,38128.08,38200.0,40280.0,-0.2%,-5.3%
Karnataka,,,,,
Rashi,47174.91,47805.13,58193.68,-1.3%,-18.9%
Pylone,-,-,3500.0,-,-
Average,32699.17,34072.8,38316.62,-,-

Note:
Weighted Average Price = ∑(arrival quantity * modal price) / ∑arrival quantity
Change (Over Previous Month) = [Price - Price(Over Previous Month)/Price(Over Previous Month)] * 100
`;

afterEach(() => vi.unstubAllGlobals());

describe("monthly report parsing", () => {
  it("retains the raw primary source token and declared unit without scaling or importing comparison prices", () => {
    expect(parseMonthlyEvidence(report, "2026-10")[1]).toMatchObject({
      state: "Karnataka", variety_name: "Rashi", source_value: "47174.91", weighted_price: 47174.91,
      source_unit: "Rs./Quintal", source_columns: ["Rashi", "47174.91", "47805.13", "58193.68", "-1.3%", "-18.9%"],
    });
    expect(parseMonthlyEvidence(report, "2026-10")[2]).toMatchObject({ source_value: "-", weighted_price: null });
  });
  it("preserves state and variety, ignores comparisons and totals, retains missing primary prices", () => {
    expect(parseMonthlyReport(report, "2026-10")).toEqual([
      { state: "Goa", variety_name: "Rashi", weighted_price: 38128.08 },
      { state: "Karnataka", variety_name: "Rashi", weighted_price: 47174.91 },
      { state: "Karnataka", variety_name: "Pylone", weighted_price: null },
    ]);
    expect(MONTHLY_METHOD).toContain("Not a daily");
  });
  it("accepts BOM and CRLF, escaped quotes, commas and newlines in quoted CSV fields", () => {
    expect(parseMonthlyReport("\uFEFF" + report.replace(/\n/g, "\r\n"), "2026-10")).toHaveLength(3);
    expect(parseCsv('"a,b","c""d","e\nf"\r\n')).toEqual([["a,b", 'c"d', "e\nf"]]);
    expect(() => parseCsv('"broken')).toThrow("Unterminated");
    expect(() => parseCsv('"closed"bad')).toThrow("Malformed");
  });
  it.each([
    ["wrong period", report, "2026-09"],
    ["wrong unit", report.replaceAll("Rs./Quintal", "USD/Quintal"), "2026-10"],
    ["wrong comparison period", report.replace("September, 2026", "August, 2026"), "2026-10"],
    ["bad price", report.replace("47174.91", "NaN"), "2026-10"],
    ["negative price", report.replace("47174.91", "-1"), "2026-10"],
    ["duplicate", report.replace("Pylone,-,-,3500.0,-,-", "Rashi,1,-,-,-,-"), "2026-10"],
    ["missing methodology", report.replace("Weighted Average Price", "Other Price"), "2026-10"],
    ["bad month", report, "2026-13"],
  ])("rejects %s", (_name, text, month) => {
    expect(() => parseMonthlyReport(text, month)).toThrow();
  });
  it("calculates completed months across year boundaries and builds a fixed official endpoint", () => {
    expect(previousMonth(new Date("2026-01-03T00:00:00Z"))).toBe("2025-12");
    const url = new URL(monthlySourceUrl("2026-10"));
    expect(url.hostname).toBe("api.agmarknet.gov.in");
    expect(url.searchParams.get("commodity")).toBe("118");
    expect(url.searchParams.get("month")).toBe("10");
    expect(() => monthlySourceUrl("bad")).toThrow();
  });
});

function database() {
  const statement = {
    bind: vi.fn(), run: vi.fn().mockResolvedValue({ success: true }),
  };
  statement.bind.mockReturnValue(statement);
  const db = {
    prepare: vi.fn().mockReturnValue(statement),
    batch: vi.fn().mockResolvedValue([]),
  } as Pick<D1Database, "prepare" | "batch">;
  return { db, statement };
}

describe("monthly refresh", () => {
  it("atomically replaces a month's snapshot and records its original report", async () => {
    const { db, statement } = database();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(report, { headers: { "content-type": "text/csv" } })));
    expect(await refreshMonthly(db, "2026-10", "Karnataka")).toEqual({ reporting_month: "2026-10", record_count: 2 });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("api.agmarknet.gov.in"), expect.objectContaining({
      redirect: "manual", headers: { Accept: "*/*" },
    }));
    expect(db.batch).toHaveBeenCalledOnce();
    expect(vi.mocked(db.batch).mock.calls[0][0]).toHaveLength(5);
    expect(statement.bind).toHaveBeenCalledWith(expect.any(String), 2, report, expect.any(String));
    await refreshMonthly(db, "2026-10", "Karnataka");
    expect(db.batch).toHaveBeenCalledTimes(2);
  });
  it.each([
    new Response(null, { status: 302, headers: { location: "https://example.com" } }),
    new Response("denied", { status: 403 }),
    new Response("<html>login</html>", { headers: { "content-type": "text/html" } }),
    new Response(report.replace("October, 2026", "February, 2022"), { headers: { "content-type": "text/csv" } }),
  ])("preserves existing observations and records a failed source response", async (response) => {
    const { db } = database();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(refreshMonthly(db, "2026-10", "Karnataka")).rejects.toThrow();
    expect(db.batch).not.toHaveBeenCalled();
    expect(db.prepare).toHaveBeenLastCalledWith(expect.stringContaining("status = 'failed'"));
  });
  it("rejects a report without the configured state", async () => {
    const { db } = database();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(report, { headers: { "content-type": "text/csv" } })));
    await expect(refreshMonthly(db, "2026-10", "Missing")).rejects.toThrow("no Missing");
    expect(db.batch).not.toHaveBeenCalled();
  });
});

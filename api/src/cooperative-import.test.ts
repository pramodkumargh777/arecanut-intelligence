import { describe, expect, it } from "vitest";
import { CSV_MAX_ROWS, parseCooperativeCsv, parseCsv } from "./cooperative-import";

const header = "branch,reporting_date,commodity,variety,minimum_price,maximum_price,average_price,declared_unit,unit_evidence,source_reference";
const meta = { importedAt: "2026-11-04T10:00:00Z", sourceReference: "letter-1" };
const csv = (...rows: string[]) => [header, ...rows].join("\r\n");

describe("authorized cooperative CSV import", () => {
  it("parses RFC 4180 quoting, escaped quotes, embedded newlines and BOM", () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi""\nthere"\n')).toEqual([["a", "b"], ["x, y", 'say "hi"\nthere']]);
    expect(() => parseCsv('a,"b')).toThrow("quoted");
  });
  it("confirms INR/quintal only for a declared unit with evidence, and never for TSS", async () => {
    const row = 'SHIVAMOGGA,2026-11-02,arecanut,RASHI EDI,39089,49389,48089,INR/quintal,"Page states ₹ per Quintal",mamcos-sheet-1';
    const [confirmed] = await parseCooperativeCsv("mamcos", csv(row), meta);
    expect(confirmed).toMatchObject({ unit_status: "source_confirmed", price_unit: "INR/quintal", status: "pending", variety: "RASHI EDI" });
    const [noEvidence] = await parseCooperativeCsv("mamcos", csv(row.replace('"Page states ₹ per Quintal"', "")), meta);
    expect(noEvidence).toMatchObject({ unit_status: "assumed", price_unit: "unconfirmed" });
    const [tss] = await parseCooperativeCsv("tss", csv(row.replace("SHIVAMOGGA", "Sirsi")), meta);
    expect(tss).toMatchObject({ unit_status: "assumed", price_unit: "unconfirmed" });
    expect(tss.review_flags).toContain("tss_unit_never_confirmed");
  });
  it("keeps invalid rows for review with reasons instead of dropping them", async () => {
    const rows = await parseCooperativeCsv("mamcos", csv(
      "SHIVAMOGGA,2026-02-31,arecanut,RASHI,1,2,3,INR/quintal,,ref",
      "SHIVAMOGGA,2026-11-05,arecanut,RASHI,1,3,2,INR/quintal,,ref",
      "SHIVAMOGGA,2026-11-03,black_pepper,PEPPER,1,3,2,INR/quintal,,ref",
      "SHIVAMOGGA,2026-11-03,arecanut,RASHI,0,3,2,INR/quintal,,ref",
    ), meta);
    expect(rows.map((row) => row.status)).toEqual(["invalid", "invalid", "invalid", "invalid"]);
    expect(rows.map((row) => row.validation_message)).toEqual([
      expect.stringContaining("Invalid reporting date"), expect.stringContaining("Future"),
      expect.stringContaining("only supported for TUMCOS"), expect.stringContaining("non-positive"),
    ]);
  });
  it("supports black pepper for TUMCOS and preserves raw input", async () => {
    const [pepper] = await parseCooperativeCsv("tumcos", csv("Channagiri,2026-10-26,black pepper,black pepper,60000,70000,66000,INR/quintal,Signed rate sheet,ref"), meta);
    expect(pepper).toMatchObject({ commodity: "black_pepper", source_key: "tumcos", status: "pending" });
    expect(JSON.parse(pepper.raw_record)).toMatchObject({ branch: "Channagiri", declared_unit: "INR/quintal" });
  });
  it("fails closed on unknown or missing columns, duplicates, ragged rows and oversized files", async () => {
    await expect(parseCooperativeCsv("mamcos", `${header},password\r\nA,2026-11-01,arecanut,R,1,3,2,INR/quintal,,ref,x`, meta)).rejects.toThrow("Unsupported CSV columns");
    await expect(parseCooperativeCsv("mamcos", "branch,reporting_date\r\nA,2026-11-01", meta)).rejects.toThrow("Missing required");
    const row = "SHIVAMOGGA,2026-11-02,arecanut,RASHI,1,3,2,INR/quintal,,ref";
    await expect(parseCooperativeCsv("mamcos", csv(row, row), meta)).rejects.toThrow("Duplicate CSV observation");
    await expect(parseCooperativeCsv("mamcos", csv("A,B"), meta)).rejects.toThrow("fields");
    await expect(parseCooperativeCsv("mamcos", csv(...Array.from({ length: CSV_MAX_ROWS + 1 }, (_, index) => row.replace("RASHI", `R${index}`))), meta)).rejects.toThrow("limited");
  });
});

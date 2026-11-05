import { calendarTodayIST, shiftCalendarMonth } from "../../shared/dates";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTHLY_METHOD = "State/UT and variety-level arrival-weighted modal price: sum(arrival quantity * modal price) / sum(arrival quantity). Not a daily market quotation.";

export type MonthlyRow = {
  state: string;
  variety_name: string;
  weighted_price: number | null;
};

export function validMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 2010;
}

export function previousMonth(now: Date, offset = 1): string {
  return shiftCalendarMonth(calendarTodayIST(now).slice(0, 7), -offset);
}

function monthLabel(month: string): string {
  return `${MONTHS[Number(month.slice(5)) - 1]}, ${month.slice(0, 4)}`;
}

export function monthlySourceUrl(month: string): string {
  if (!validMonth(month)) throw new Error("Invalid reporting month.");
  const url = new URL("https://api.agmarknet.gov.in/v1/price-trend/varietywise-prices-monthly");
  url.search = new URLSearchParams({
    report_mode: "Statewise", commodity: "118", year: month.slice(0, 4),
    month: String(Number(month.slice(5))), export: "true", downloadformat: "csv", state: "0", district: "0",
  }).toString();
  return url.toString();
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += ch;
    } else if (ch === '"' && !field && !closed) {
      quoted = true;
    } else if (ch === ",") {
      row.push(field.trim()); field = ""; closed = false;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field.trim()); rows.push(row); row = []; field = ""; closed = false;
    } else {
      if (ch === '"' || (closed && ch.trim())) throw new Error("Malformed CSV quoting.");
      field += ch;
    }
  }
  if (quoted) throw new Error("Unterminated CSV field.");
  if (field || row.length || closed) { row.push(field.trim()); rows.push(row); }
  return rows;
}

export type MonthlyEvidence = MonthlyRow & { source_value: string; source_unit: "Rs./Quintal"; source_columns: string[] };

export function parseMonthlyEvidence(text: string, requestedMonth: string): MonthlyEvidence[] {
  if (!validMonth(requestedMonth)) throw new Error("Invalid reporting month.");
  const rows = parseCsv(text);
  const title = rows.shift()?.filter(Boolean);
  const expectedTitle = `State/UT-wise & Variety-wise Prices Monthly Analysis for Arecanut(Betelnut/Supari) - ${monthLabel(requestedMonth)}`;
  if (title?.length !== 1 || title[0] !== expectedTitle) throw new Error("Report title does not match the requested commodity and month.");
  const [year, month] = requestedMonth.split("-").map(Number);
  const previous = previousMonth(new Date(Date.UTC(year, month - 1, 1)));
  const lastYear = `${year - 1}-${String(month).padStart(2, "0")}`;
  const headers = rows.shift();
  const expected = ["Variety", `Prices ${monthLabel(requestedMonth)} (Rs./Quintal)`, `Prices ${monthLabel(previous)} (Rs./Quintal)`,
    `Prices ${monthLabel(lastYear)} (Rs./Quintal)`, "Change (Over Previous Month)", "Change (Over Previous Year)"];
  if (!headers || headers.length !== expected.length || headers.some((value, i) => value !== expected[i])) {
    throw new Error("Unexpected monthly report columns, periods or price units.");
  }
  const result: MonthlyEvidence[] = [];
  const keys = new Set<string>();
  const states = new Set<string>();
  let state = "";
  let notes = false;
  let methodology = false;
  for (const row of rows) {
    if (!row.some(Boolean)) continue;
    if (row[0] === "Note:") { notes = true; continue; }
    if (notes) {
      if (row.join(",").replace(/\s/g, "") === "WeightedAveragePrice=∑(arrivalquantity*modalprice)/∑arrivalquantity") methodology = true;
      continue;
    }
    if (row.length !== 6) throw new Error("Unexpected monthly report row width.");
    if (row[0] === "Average") continue;
    if (row.slice(1).every((value) => !value)) {
      if (!row[0] || states.has(row[0])) throw new Error("Invalid or repeated state section.");
      state = row[0]; states.add(state); continue;
    }
    if (!state || !row[0]) throw new Error("Variety row is missing its state or name.");
    const key = JSON.stringify([state, row[0]]);
    if (keys.has(key)) throw new Error(`Duplicate variety in ${state}: ${row[0]}`);
    keys.add(key);
    const value = row[1];
    if (value !== "-" && (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))) {
      throw new Error(`Invalid weighted price for ${state}: ${row[0]}`);
    }
    result.push({ state, variety_name: row[0], weighted_price: value === "-" ? null : Number(value),
      source_value: value, source_unit: "Rs./Quintal", source_columns: row });
  }
  if (!methodology || !result.length) throw new Error("Missing weighted-price methodology or observations.");
  return result;
}

export function parseMonthlyReport(text: string, requestedMonth: string): MonthlyRow[] {
  return parseMonthlyEvidence(text, requestedMonth).map(({ state, variety_name, weighted_price }) => ({ state, variety_name, weighted_price }));
}

export async function refreshMonthly(db: Pick<D1Database, "prepare" | "batch">, month: string, state: string): Promise<{ reporting_month: string; record_count: number }> {
  const id = crypto.randomUUID();
  const sourceUrl = monthlySourceUrl(month);
  await db.prepare(`INSERT INTO monthly_refresh_runs (id, reporting_month, state, source_url, started_at, status)
    VALUES (?, ?, ?, ?, ?, 'running')`).bind(id, month, state, sourceUrl, new Date().toISOString()).run();
  try {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000), redirect: "manual", headers: { Accept: "*/*" } });
    if (!response.ok) throw new Error(`Monthly source returned HTTP ${response.status}.`);
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/csv")) throw new Error("Monthly source did not return CSV.");
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error("Monthly report exceeds the supported size.");
    const rows = parseMonthlyReport(text, month).filter((row) => row.state === state);
    if (!rows.length) throw new Error(`Report contains no ${state} variety rows.`);
    const fetchedAt = new Date().toISOString();
    await db.batch([
      db.prepare("DELETE FROM monthly_variety_prices WHERE reporting_month = ? AND state = ?").bind(month, state),
      ...rows.map((row) => db.prepare(`INSERT INTO monthly_variety_prices
        (reporting_month, state, variety_name, weighted_price, price_unit, source_url, fetched_at, refresh_run_id)
        VALUES (?, ?, ?, ?, 'INR/quintal', ?, ?, ?)`)
        .bind(month, state, row.variety_name, row.weighted_price, sourceUrl, fetchedAt, id)),
      db.prepare(`INSERT INTO monthly_price_versions
        SELECT refresh_run_id,reporting_month,state,variety_name,weighted_price,price_unit,source_url,fetched_at
        FROM monthly_variety_prices WHERE refresh_run_id=?`).bind(id),
      db.prepare(`UPDATE monthly_refresh_runs SET status = 'succeeded', finished_at = ?, record_count = ?, raw_report = ? WHERE id = ?`)
        .bind(fetchedAt, rows.length, text, id),
    ]);
    return { reporting_month: month, record_count: rows.length };
  } catch (error) {
    await db.prepare("UPDATE monthly_refresh_runs SET status = 'failed', finished_at = ?, error_message = ? WHERE id = ?")
      .bind(new Date().toISOString(), error instanceof Error ? error.message : String(error), id).run();
    throw error;
  }
}

import { readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";

const [from = "2021-01", to = "2026-10"] = process.argv.slice(2);
const valid = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= "2010-01";
const completed = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
if (!valid(from) || !valid(to) || from > to || to > completed) throw new Error("Provide completed YYYY-MM months from 2010 onward, in ascending order.");
const vars = readFileSync(new URL("../api/.dev.vars", import.meta.url), "utf8");
const token = vars.match(/^ADMIN_TOKEN=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!token) throw new Error("Local ADMIN_TOKEN missing.");
const base = "http://127.0.0.1:8787/api/v1";
const existingResponse = await fetch(`${base}/monthly-prices`);
if (!existingResponse.ok) throw new Error("Start the local API before backfill.");
const existing = new Set((await existingResponse.json()).months);
const failures = [];
const pending = [];
for (let month = from; month <= to;) {
  if (existing.has(month)) console.log(`${month}: already stored; skipped (use manual refresh for revisions)`);
  else pending.push(month);
  const [year, value] = month.split("-").map(Number);
  month = new Date(Date.UTC(year, value, 1)).toISOString().slice(0, 7);
}
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
async function worker() {
  while (pending.length && !stopping) {
    const month = pending.shift();
    try {
      const response = await fetch(`${base}/admin/monthly/refresh`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ month }), signal: AbortSignal.timeout(90_000),
      });
      const text = await response.text();
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error(`HTTP ${response.status}: non-JSON API response (the local Worker may have restarted).`);
      const body = JSON.parse(text);
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      console.log(`${month}: ${body.record_count} variety rows stored`);
    } catch (error) {
      failures.push(month);
      console.error(`${month}: FAILED: ${error.message}`);
    }
    await setTimeout(1000);
  }
}
await Promise.all([worker(), worker()]);
console.log(JSON.stringify({ from, to, failed_months: failures, interrupted: stopping, remaining_months: pending.length, resumable: true }));
if (failures.length || stopping) process.exitCode = 1;

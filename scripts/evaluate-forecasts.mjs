import { readFileSync } from "node:fs";
const vars = readFileSync(new URL("../api/.dev.vars", import.meta.url), "utf8");
const token = vars.match(/^ADMIN_TOKEN=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!token) throw new Error("Local ADMIN_TOKEN missing.");
const base = "http://127.0.0.1:8787/api/v1";
const selected = process.argv[2] ?? "Rashi";
const varieties = selected === "--all"
  ? await fetch(`${base}/monthly-prices`).then(async (response) => {
    if (!response.ok) throw new Error(`Monthly source list HTTP ${response.status}`);
    return (await response.json()).data.map((row) => row.variety_name);
  }) : [selected];
let failed = false;
for (const variety of varieties) {
  try {
    const response = await fetch(`${base}/admin/forecasts/evaluate`, { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ variety }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    const results = body.snapshot.results;
    console.log(JSON.stringify({ variety, status: body.status, history_months: results.history.count,
      reasons: results.reasons, model: results.evaluation?.selected_model ?? null,
      holdout_mae: results.evaluation?.holdout.selected.mae ?? null, forecast: body.forecast }));
  } catch (error) { failed = true; console.error(`${variety}: ${error.message}`); }
}
if (failed) process.exitCode = 1;

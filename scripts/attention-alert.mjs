#!/usr/bin/env node
/**
 * Daily health check for .github/workflows/attention-alert.yml. Everything routine runs on its own: rates publish
 * automatically, doubtful ones are rejected after two weeks, flagged AGMARKNET rows close themselves. This reports only
 * what a person must fix, and prints nothing when all is well:
 *   - a cooperative source whose collection has not succeeded for COLLECTION_STALE_HOURS (site down or changed layout),
 *   - AGMARKNET ingestion that has not completed for INGESTION_STALE_HOURS,
 *   - a burst of held rates from one source (HELD_BURST in two days), which means a format or unit change, not odd lots.
 * Reads production D1 through wrangler. Read only.
 *
 *   node scripts/attention-alert.mjs              # check production (needs CLOUDFLARE_API_TOKEN / ACCOUNT_ID)
 *   node scripts/attention-alert.mjs state.json   # check a saved state: { "collections": [...], "ingestion": [...], "held": [...] }
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const COLLECTION_STALE_HOURS = 36;
export const INGESTION_STALE_HOURS = 48;
export const HELD_BURST = 30;
const SOURCES = { mamcos: "MAMCOS", tss: "TSS", tumcos: "TUMCOS" };

const QUERIES = {
  collections: "SELECT source_key, MAX(started_at) AS last_success FROM cooperative_fetches WHERE status='succeeded' GROUP BY source_key",
  ingestion: "SELECT MAX(completed_at) AS last_completed FROM ingestion_jobs WHERE status='completed'",
  held: `SELECT source_key, COUNT(*) AS n, MIN(hold_reason) AS example FROM cooperative_quotes
    WHERE status='pending' AND hold_reason IS NOT NULL AND reporting_date >= date('now','-2 day') GROUP BY source_key`,
};

const parseTime = (value) => value ? new Date(/[TZ]/.test(value) ? value : `${value.replace(" ", "T")}Z`) : null;
const hoursSince = (value, now) => { const time = parseTime(value); return time ? (now - time) / 3_600_000 : Infinity; };
const when = (value) => value ? parseTime(value).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "never";

/** The problems found, as Markdown list items; empty when nothing needs a person. */
export function problems(state, now = new Date()) {
  const found = [];
  for (const [key, label] of Object.entries(SOURCES)) {
    const last = state.collections.find((row) => row.source_key === key)?.last_success ?? null;
    if (hoursSince(last, now) > COLLECTION_STALE_HOURS) {
      found.push(`**${label} collection has not succeeded since ${when(last)}.** Its website may be down or may have changed layout. Its rates on the site are getting old.`);
    }
  }
  const ingested = state.ingestion[0]?.last_completed ?? null;
  if (hoursSince(ingested, now) > INGESTION_STALE_HOURS) {
    found.push(`**AGMARKNET ingestion has not completed since ${when(ingested)}.** Check the "AGMARKNET ingestion" workflow runs and the data.gov.in key.`);
  }
  for (const row of state.held) {
    if (row.n >= HELD_BURST) {
      found.push(`**${row.n} ${SOURCES[row.source_key] ?? row.source_key} rates from the last two days were held** (e.g. "${row.example}"). That many usually means the source changed its format or unit.`);
    }
  }
  return found;
}

export function report(found, siteUrl = "") {
  if (!found.length) return "";
  const lines = ["Something needs a person. Everything else is running on its own.", "", ...found.map((item) => `- ${item}`)];
  if (siteUrl) lines.push("", `Details: ${siteUrl.replace(/\/$/, "")}/data-quality`);
  return lines.join("\n");
}

function query(sql) {
  const output = execFileSync("npx", ["wrangler", "d1", "execute", "ani-market-data", "--remote", "--json", "--config", "api/wrangler.toml", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(output)[0].results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  const state = file ? JSON.parse(readFileSync(file, "utf8")) : Object.fromEntries(Object.entries(QUERIES).map(([key, sql]) => [key, query(sql)]));
  process.stdout.write(report(problems(state), process.env.SITE_URL ?? ""));
}

#!/usr/bin/env node
// Builds one SQL file that loads the local database into an EMPTY production D1 database.
// Usage: npm run db:prepare-import -- [--output backups/production-import.sql]
//
// `npm run db:backup` is for restore checks, and its file cannot do this job: it omits indexes, triggers and views,
// creates some tables after tables that reference them, and has rows over D1's 100 KB statement limit. This file:
//   1. creates every table first, so the order of references no longer matters;
//   2. loads the rows, splitting long text across statements;
//   3. adds indexes, views and triggers last, so the append-only guards do not refuse historical rows.
// Local test logs are not copied, and the FTS index is rebuilt afterwards with POST /admin/documents/reindex.
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const STATE_DIR = "api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject";
/** Rows that describe local testing, not market data. Their tables are still created. */
const SKIP_ROWS = new Set(["assistant_interactions", "assistant_rate_limits"]);
/** D1 refuses statements over 100,000 bytes; one character is at most 4 bytes in UTF-8. */
const CHUNK_CHARACTERS = 20_000;

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const output = arg("--output", "backups/production-import.sql");

const candidates = readdirSync(STATE_DIR).filter((name) => name.endsWith(".sqlite")).map((name) => join(STATE_DIR, name));
if (!candidates.length) throw new Error(`No local database in ${STATE_DIR}. Run npm run db:migrate:local first.`);
const file = candidates.sort((a, b) => statSync(b).size - statSync(a).size)[0];
const db = new DatabaseSync(file, { readOnly: true });

const quoteName = (name) => `"${name.replace(/"/g, '""')}"`;
const quoteText = (value) => `'${value.replace(/'/g, "''")}'`;
function literal(value) {
  if (value === null) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "string") return quoteText(value);
  throw new Error("BLOB values are not supported by this export.");
}

// The FTS index and its shadow tables are derived from document_chunks and rebuilt after the import.
const derived = (name) => /^document_chunks_fts/.test(name) || /^sqlite_/.test(name) || /^_cf_/.test(name);
const objects = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL").all();
const tables = objects.filter((row) => row.type === "table" && !derived(row.name));

const lines = ["PRAGMA defer_foreign_keys=TRUE;", ...tables.map((table) => `${table.sql};`)];
const summary = { tables: tables.length, rows: 0, split_rows: 0, skipped_rows: 0, indexes: 0, views: 0, triggers: 0 };

for (const table of tables) {
  if (SKIP_ROWS.has(table.name)) {
    summary.skipped_rows += db.prepare(`SELECT COUNT(*) AS count FROM ${quoteName(table.name)}`).get().count;
    continue;
  }
  const columns = db.prepare(`PRAGMA table_info(${quoteName(table.name)})`).all().map((column) => column.name);
  const hasRowid = !/WITHOUT\s+ROWID/i.test(table.sql);
  const selected = [...(hasRowid ? ["rowid AS __import_rowid"] : []), ...columns.map(quoteName)].join(", ");
  for (const row of db.prepare(`SELECT ${selected} FROM ${quoteName(table.name)}`).iterate()) {
    summary.rows += 1;
    const long = columns.filter((column) => typeof row[column] === "string" && row[column].length > CHUNK_CHARACTERS);
    const first = columns.map((column) => (long.includes(column) ? quoteText(row[column].slice(0, CHUNK_CHARACTERS)) : literal(row[column])));
    if (!long.length) {
      lines.push(`INSERT INTO ${quoteName(table.name)} (${columns.map(quoteName).join(",")}) VALUES (${first.join(",")});`);
      continue;
    }
    if (!hasRowid) throw new Error(`${table.name} has text too long for one statement and no rowid to continue it by.`);
    summary.split_rows += 1;
    lines.push(`INSERT INTO ${quoteName(table.name)} (rowid,${columns.map(quoteName).join(",")}) VALUES (${row.__import_rowid},${first.join(",")});`);
    for (const column of long) {
      for (let start = CHUNK_CHARACTERS; start < row[column].length; start += CHUNK_CHARACTERS) {
        const part = quoteText(row[column].slice(start, start + CHUNK_CHARACTERS));
        lines.push(`UPDATE ${quoteName(table.name)} SET ${quoteName(column)} = ${quoteName(column)} || ${part} WHERE rowid = ${row.__import_rowid};`);
      }
    }
  }
}

for (const type of ["index", "view", "trigger"]) {
  for (const object of objects.filter((row) => row.type === type && !derived(row.name) && !derived(row.tbl_name))) {
    lines.push(`${object.sql};`);
    summary[type === "index" ? "indexes" : `${type}s`] += 1;
  }
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${lines.join("\n")}\n`);
console.log(JSON.stringify({ output, bytes: statSync(output).size, ...summary }));

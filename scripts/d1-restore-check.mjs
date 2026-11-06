// Verify that a D1 SQL dump restores cleanly, without touching any D1 database.
// Usage: npm run db:restore-check -- backups/<name>.manifest.json [--write restored.sqlite]
// Checks: dump SHA-256 matches the manifest, the SQL replays into a fresh SQLite database,
// PRAGMA integrity_check / foreign_key_check pass, and every table's row count matches the manifest.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function restoreCheck(manifestPath, { write } = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.format !== "ani-d1-backup/1") throw new Error(`Unsupported manifest format: ${manifest.format}`);
  const dumpPath = resolve(dirname(manifestPath), manifest.dump_file);
  const dump = readFileSync(dumpPath);
  const sha256 = createHash("sha256").update(dump).digest("hex");
  const failures = [];
  if (sha256 !== manifest.dump_sha256) failures.push(`dump sha256 ${sha256} does not match manifest ${manifest.dump_sha256}`);
  // Exports emit tables in creation order, so a rebuilt parent can follow its children; enforcement is
  // off during replay and the explicit foreign_key_check below still reports every violation.
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  try {
    db.exec(dump.toString("utf8"));
  } catch (error) {
    failures.push(`dump did not replay: ${error.message}`);
    return { ok: false, failures, sha256 };
  }
  const integrity = db.prepare("PRAGMA integrity_check").all().map((row) => row.integrity_check);
  if (integrity.join() !== "ok") failures.push(`integrity_check: ${integrity.join("; ")}`);
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.length) failures.push(`foreign_key_check reported ${foreignKeys.length} violation(s)`);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
    .all().map((row) => row.name);
  const counts = Object.fromEntries(tables.map((name) => [name, db.prepare(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`).get().n]));
  if (manifest.table_counts) {
    for (const [name, expected] of Object.entries(manifest.table_counts)) {
      if (counts[name] !== expected) failures.push(`${name}: restored ${counts[name] ?? "missing"} row(s), manifest ${expected}`);
    }
  }
  if (write) {
    if (existsSync(write)) throw new Error(`Refusing to overwrite ${write}`);
    db.exec(`VACUUM INTO '${String(write).replaceAll("'", "''")}'`);
  }
  db.close();
  return { ok: failures.length === 0, failures, sha256, tables: tables.length, rows: Object.values(counts).reduce((a, b) => a + b, 0), counts };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [manifestPath, ...rest] = process.argv.slice(2);
  if (!manifestPath) { console.error("Usage: d1-restore-check.mjs <manifest.json> [--write restored.sqlite]"); process.exit(2); }
  const writeIndex = rest.indexOf("--write");
  const result = restoreCheck(resolve(manifestPath), { write: writeIndex >= 0 ? resolve(rest[writeIndex + 1]) : undefined });
  const { counts, ...summary } = result;
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

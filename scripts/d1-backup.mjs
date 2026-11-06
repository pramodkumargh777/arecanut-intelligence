// Export the ANI D1 database to a SQL dump with a SHA-256 manifest and per-table row counts.
// Usage: npm run db:backup -- [--remote] [--output-dir backups] [--skip-counts]
// Local is the default. Remote exports read every row (counts against the D1 rows-read allowance)
// and briefly block writes on the database while the export runs; schedule them off-peak.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(root, "api");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const target = flag("--remote") ? "remote" : "local";
const database = option("--database", "ani-market-data");
if (!/^[A-Za-z0-9_-]+$/.test(database)) throw new Error("Invalid database name.");
const outputDir = resolve(root, option("--output-dir", "backups"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dumpPath = join(outputDir, `${database}-${target}-${stamp}.sql`);
mkdirSync(outputDir, { recursive: true });

const wrangler = (...wranglerArgs) => execFileSync("npx", ["wrangler", ...wranglerArgs, `--${target}`, "--config", "wrangler.toml"],
  { cwd: apiDir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 });
const query = (sql) => JSON.parse(wrangler("d1", "execute", database, "--json", "--command", sql))[0].results;

// D1 refuses to export databases containing virtual tables (the assistant's FTS5 index). That index is derived
// from document_chunks, so export every other table explicitly and rebuild it after restore via
// POST /api/v1/admin/documents/reindex.
const schema = query("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
const virtualTables = schema.filter((row) => /^CREATE VIRTUAL TABLE/i.test(row.sql ?? "")).map((row) => row.name);
const isDerived = (name) => virtualTables.some((vt) => name === vt || name.startsWith(`${vt}_`));
const excludedTables = schema.map((row) => row.name).filter(isDerived);
const exportTables = schema.map((row) => row.name).filter((name) => !isDerived(name) && /^[A-Za-z0-9_]+$/.test(name));
wrangler("d1", "export", database, "--output", dumpPath, "-y", ...(excludedTables.length ? exportTables.flatMap((name) => ["--table", name]) : []));
const bytes = readFileSync(dumpPath);
const manifest = {
  format: "ani-d1-backup/1",
  created_at: new Date().toISOString(),
  database,
  target,
  dump_file: relative(outputDir, dumpPath),
  dump_bytes: statSync(dumpPath).size,
  dump_sha256: createHash("sha256").update(bytes).digest("hex"),
  table_counts: null,
  excluded_tables: excludedTables,
  notes: "Restore-check with: npm run db:restore-check -- <manifest>. R2 archive objects are not inside this dump; archive_objects rows reference them."
    + (excludedTables.length ? " Derived FTS5 tables are excluded; after restore call POST /api/v1/admin/documents/reindex, which recreates and repopulates them." : ""),
};
if (!flag("--skip-counts")) {
  const tables = exportTables;
  manifest.table_counts = {};
  // Scalar subqueries rather than UNION ALL: D1 rejects long compound SELECTs.
  for (let index = 0; index < tables.length; index += 20) {
    const chunk = tables.slice(index, index + 20);
    Object.assign(manifest.table_counts, query(`SELECT ${chunk.map((name) => `(SELECT COUNT(*) FROM "${name}") AS "${name}"`).join(", ")}`)[0]);
  }
}
const manifestPath = dumpPath.replace(/\.sql$/, ".manifest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ manifest: relative(root, manifestPath), dump: relative(root, dumpPath), sha256: manifest.dump_sha256,
  bytes: manifest.dump_bytes, tables: manifest.table_counts ? Object.keys(manifest.table_counts).length : null }));

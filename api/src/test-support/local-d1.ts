import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

// In-memory adapter implementing the D1 methods exercised by the HTTP handlers, backed by the real migrations.
export class LocalStatement {
  constructor(private db: LocalDatabase, private sql: string, private args: SQLInputValue[] = []) {}
  bind(...args: SQLInputValue[]) { return new LocalStatement(this.db, this.sql, args); }
  execute() {
    const totalBefore = this.db.countTriggerChanges ? this.totalChanges() : 0;
    const rows = this.db.sqlite.prepare(this.sql).all(...this.args);
    // D1 reports rows written by triggers in meta.changes too; SQLite's changes() does not. Opt-in, see LocalDatabase.
    const changes = this.db.countTriggerChanges
      ? this.totalChanges() - totalBefore
      : Number(this.db.sqlite.prepare("SELECT changes() AS count").get()?.count ?? 0);
    return { results: rows, success: true, meta: { changes } };
  }
  private totalChanges() { return Number(this.db.sqlite.prepare("SELECT total_changes() AS count").get()?.count ?? 0); }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
  async first() {
    const row = this.execute().results[0] ?? null;
    if (this.sql.startsWith("SELECT * FROM market_price_observations") && this.db.afterObservationRead) {
      const callback = this.db.afterObservationRead;
      this.db.afterObservationRead = undefined;
      await callback();
    }
    return row;
  }
}

export class LocalDatabase {
  sqlite = new DatabaseSync(":memory:");
  afterObservationRead?: () => Promise<void>;
  /** When true, meta.changes includes rows written by triggers, as on Cloudflare D1. */
  countTriggerChanges = false;
  prepare(sql: string) { return new LocalStatement(this, sql); }
  async batch(statements: LocalStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

/** Apply migrations in order. `through` stops after the named migration file (inclusive), for upgrade tests. */
export function applyMigrations(db: LocalDatabase, through?: string, after?: string) {
  for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    if (after && file <= after) continue;
    db.sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
    if (through && file === through) break;
  }
  return db;
}

import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canTransition, isStale, LIFECYCLES, reviewQueueStates, sqlStates, statesBefore, statesOf, terminalStates, type Lifecycle,
} from "../../shared/lifecycles";
import { applyMigrations, LocalDatabase } from "./test-support/local-d1";
import { scanSource, scanTree } from "./test-support/lifecycle-scan";

const entries = Object.entries(LIFECYCLES) as [string, Lifecycle][];
const DOC_PATH = "../docs/LIFECYCLES.md";

function schemaStates(db: LocalDatabase, table: string, column: string) {
  const row = db.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string } | undefined;
  if (!row) throw new Error(`Table ${table} does not exist after migrations.`);
  const check = new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, "i").exec(row.sql);
  if (!check) throw new Error(`${table}.${column} has no CHECK (... IN (...)) constraint.`);
  return [...check[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

describe("record lifecycles (shared/lifecycles.ts)", () => {
  const db = applyMigrations(new LocalDatabase());

  it.each(entries)("%s lists exactly the states the migrated schema allows", (_name, lifecycle) => {
    expect(new Set(statesOf(lifecycle))).toEqual(new Set(schemaStates(db, lifecycle.table, lifecycle.column)));
  });

  it.each(entries)("%s is a connected graph: every state is a start, reachable, or marked unreachable", (_name, lifecycle) => {
    const states = new Set<string>(statesOf(lifecycle));
    for (const state of [...lifecycle.initial, ...(lifecycle.unreachable ?? [])]) expect(states).toContain(state);
    for (const transition of lifecycle.transitions) {
      expect(states).toContain(transition.to);
      for (const from of transition.from) {
        expect(states).toContain(from);
        expect(from, `${lifecycle.table}: '${from}' -> itself is implicit and should not be declared`).not.toBe(transition.to);
      }
    }
    const reachable = new Set<string>(lifecycle.initial);
    for (let grew = true; grew;) {
      grew = false;
      for (const transition of lifecycle.transitions) {
        if (!reachable.has(transition.to) && transition.from.some((from) => reachable.has(from))) { reachable.add(transition.to); grew = true; }
      }
    }
    const unreachable = new Set<string>(lifecycle.unreachable ?? []);
    for (const state of states) expect(reachable.has(state) !== unreachable.has(state), `${lifecycle.table}.${state}`).toBe(true);
    if (lifecycle.stale) expect(states).toContain(lifecycle.stale.state);
  });

  it.each(entries)("%s: every literal status write in api/src is a declared start or transition", (_name, lifecycle) => {
    const found = scanTree("src", lifecycle);
    expect(found.violations).toEqual([]);
  });

  it("finds the write sites it guards, so a broken scanner cannot pass silently", () => {
    const totals = entries.map(([, lifecycle]) => scanTree("src", lifecycle));
    expect(totals.reduce((sum, found) => sum + found.updates, 0)).toBeGreaterThanOrEqual(25);
    expect(totals.reduce((sum, found) => sum + found.inserts, 0)).toBeGreaterThanOrEqual(8);
  });

  it("reports undeclared states, transitions and starting values", () => {
    const quote = LIFECYCLES.cooperativeQuote;
    const source = [
      "db.prepare(`UPDATE cooperative_quotes SET status='verified' WHERE id=? AND status='rejected'`);",
      "db.prepare(\"UPDATE cooperative_quotes SET status = 'archived' WHERE id = ?\");",
      "db.prepare(`INSERT INTO cooperative_quotes (id, status) VALUES (?, 'verified')`);",
      // Allowed: a subquery about other rows, and a declared transition.
      "db.prepare(`UPDATE cooperative_quotes SET status='verified' WHERE id=? AND status='pending' AND NOT EXISTS (SELECT 1 FROM cooperative_quotes other WHERE other.status='rejected')`);",
    ].join("\n");
    expect(scanSource(source, "example.ts", quote).violations.map((violation) => [violation.line, violation.message])).toEqual([
      [1, "cooperative_quotes.status: 'rejected' -> 'verified' is not a declared transition"],
      [2, "cooperative_quotes.status: 'archived' is not a declared state"],
      [3, "cooperative_quotes.status: rows may not start as 'verified'"],
    ]);
  });

  it("derives the review queues and decisions the API uses", () => {
    expect(reviewQueueStates(LIFECYCLES.observation)).toEqual(["validated", "review_required"]);
    expect(reviewQueueStates(LIFECYCLES.cooperativeQuote)).toEqual(["pending", "invalid"]);
    expect(statesBefore(LIFECYCLES.cooperativeQuote, "verified", "reviewer")).toEqual(["pending"]);
    expect(canTransition(LIFECYCLES.cooperativeQuote, "invalid", "verified")).toBe(false);
    expect(canTransition(LIFECYCLES.cooperativeQuote, "invalid", "rejected", "reviewer")).toBe(true);
    expect(canTransition(LIFECYCLES.cooperativeQuote, "invalid", "rejected", "automation")).toBe(false);
    expect(terminalStates(LIFECYCLES.cropFieldReport)).toEqual(["verified", "rejected"]);
    expect(sqlStates(["validated", "review_required"])).toBe("'validated', 'review_required'");
    expect(() => sqlStates(["x'); DROP TABLE markets; --"])).toThrow(/Not a lifecycle state/);
  });

  it("treats a run as stale only in its stale-prone state and after the limit, for both timestamp formats", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    expect(isStale(LIFECYCLES.cooperativeFetch, "running", "2026-11-18T11:29:00Z", now)).toBe(true);
    expect(isStale(LIFECYCLES.cooperativeFetch, "running", "2026-11-18T11:45:00Z", now)).toBe(false);
    expect(isStale(LIFECYCLES.cooperativeFetch, "failed", "2026-11-17T00:00:00Z", now)).toBe(false);
    expect(isStale(LIFECYCLES.ingestionJob, "running", "2026-11-18 11:00:00", now)).toBe(true);
    expect(isStale(LIFECYCLES.monthlyRefreshRun, "running", "2026-11-01T00:00:00Z", now)).toBe(false);
    expect(isStale(LIFECYCLES.cooperativeFetch, "running", null, now)).toBe(false);
  });

  it("docs/LIFECYCLES.md matches the registry (regenerate with `npm run docs:lifecycles`)", () => {
    const rendered = renderLifecycleDocs();
    if (process.env.UPDATE_LIFECYCLE_DOCS === "1") writeFileSync(DOC_PATH, rendered);
    expect(readFileSync(DOC_PATH, "utf8")).toBe(rendered);
  });
});

const ACTOR_LABEL = { reviewer: "reviewer", automation: "automatic", import: "import", operator: "operator", system: "run" } as const;
const code = (value: string) => `\`${value}\``;

function renderLifecycleDocs() {
  const sections = entries.map(([name, lifecycle]) => {
    const diagram = ["stateDiagram-v2", "  direction LR",
      ...lifecycle.initial.map((state) => `  [*] --> ${state}`),
      ...lifecycle.transitions.flatMap((transition) => transition.from.map((from) => `  ${from} --> ${transition.to}: ${transition.on} (${ACTOR_LABEL[transition.by]})`)),
      ...terminalStates(lifecycle).filter((state) => !(lifecycle.unreachable ?? []).includes(state)).map((state) => `  ${state} --> [*]`),
    ];
    const states = statesOf(lifecycle).map((state) => {
      const marks = [lifecycle.initial.includes(state) ? "start" : "", terminalStates(lifecycle).includes(state) ? "final" : "",
        lifecycle.unreachable?.includes(state) ? "unreachable" : ""].filter(Boolean);
      return `| ${code(state)} | ${marks.join(", ")} | ${lifecycle.states[state]} |`;
    });
    const transitions = lifecycle.transitions.map((transition) =>
      `| ${transition.from.map(code).join(", ")} | ${code(transition.to)} | ${transition.on} | ${transition.by} | ${transition.note ?? ""} |`);
    return [
      `## ${name}: ${code(`${lifecycle.table}.${lifecycle.column}`)}`, "", lifecycle.summary, "",
      "```mermaid", ...diagram, "```", "",
      "| State | Role | Meaning |", "|---|---|---|", ...states, "",
      ...(lifecycle.substates ? [...Object.entries(lifecycle.substates).map(([substate, meaning]) => `**Sub-state ${code(substate)}:** ${meaning}`), ""] : []),
      ...(lifecycle.stale ? [`**Abandoned runs:** a row still ${code(lifecycle.stale.state)} after ${lifecycle.stale.afterMinutes} minutes was abandoned. ${lifecycle.stale.handling}`, ""] : []),
      "| From | To | Event | By | Note |", "|---|---|---|---|---|", ...transitions, "",
    ].join("\n");
  });
  return [
    "# Record lifecycles",
    "",
    "<!-- Generated from shared/lifecycles.ts by `npm run docs:lifecycles`. Do not edit by hand. -->",
    "",
    "Each status column below changes only along the transitions listed. `shared/lifecycles.ts` is the source of truth;",
    "`api/src/lifecycles.test.ts` checks it against the migrated schema (the CHECK constraints) and against every literal",
    "status write in `api/src`, and fails when this page is out of date.",
    "",
    "Every transition is written as a guarded update (`... WHERE id = ? AND status = '<from>'`), so two reviewers, or a",
    "reviewer and an automatic pass, cannot both move one record. The second is refused, and the response names the",
    "record's state now (`current_status`).",
    "",
    "Actors: **reviewer**, a person with the reviewer token; **automation**, scheduled checks; **import**, connector and",
    "upload writes; **operator**, configuration by an administrator; **system**, run bookkeeping.",
    "",
    ...sections,
  ].join("\n");
}

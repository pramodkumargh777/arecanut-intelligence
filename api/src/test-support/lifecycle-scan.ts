import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { canTransition, statesOf, type Lifecycle } from "../../../shared/lifecycles";

/** A literal status write found in source that the lifecycle does not declare. */
export type LifecycleViolation = { file: string; line: number; message: string };
export type ScanResult = { updates: number; inserts: number; violations: LifecycleViolation[] };

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A column reference not qualified by another alias (so `other.status` in a subquery is ignored). */
const column = (name: string) => `(?<![.\\w])${escape(name)}`;
const literals = (list: string) => [...list.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);

/** SQL ends where its JavaScript string does: SQL here quotes values with ' and never contains " or `. */
function statementAt(text: string, start: number) {
  const end = text.slice(start).search(/[`"]/);
  return text.slice(start, end === -1 ? undefined : start + end);
}

function splitTopLevel(list: string) {
  const parts: string[] = [];
  let depth = 0, current = "";
  for (const char of list) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) { parts.push(current.trim()); current = ""; continue; }
    if (depth < 0) break;
    current += char;
  }
  parts.push(current.trim());
  return parts;
}

/** Which states a WHERE clause restricts the row to, or null when it does not mention the column. */
function fromStates(where: string, lifecycle: Lifecycle): string[] | null {
  const name = column(lifecycle.column);
  const equal = new RegExp(`${name}\\s*=\\s*'([a-z_]+)'`).exec(where);
  if (equal) return [equal[1]];
  const notEqual = new RegExp(`${name}\\s*(?:!=|<>)\\s*'([a-z_]+)'`).exec(where);
  if (notEqual) return statesOf(lifecycle).filter((state) => state !== notEqual[1]);
  const within = new RegExp(`${name}\\s+IN\\s*\\(([^)]*)\\)`).exec(where);
  return within ? literals(within[1]) : null;
}

/** Checks literal writes in `text` against `lifecycle`. Parameterized writes (`SET status = ?`) are left to tests. */
export function scanSource(text: string, file: string, lifecycle: Lifecycle): ScanResult {
  const result: ScanResult = { updates: 0, inserts: 0, violations: [] };
  const lineOf = (index: number) => text.slice(0, index).split("\n").length;
  const report = (index: number, message: string) => result.violations.push({ file, line: lineOf(index), message: `${lifecycle.table}.${lifecycle.column}: ${message}` });
  const declared = new Set<string>(statesOf(lifecycle));

  for (const match of text.matchAll(new RegExp(`UPDATE\\s+${escape(lifecycle.table)}\\s+SET\\b`, "g"))) {
    const sql = statementAt(text, match.index);
    const [set, ...rest] = sql.split(/\bWHERE\b/);
    const target = new RegExp(`${column(lifecycle.column)}\\s*=\\s*'([a-z_]+)'`).exec(set)?.[1];
    if (!target) continue;
    result.updates += 1;
    if (!declared.has(target)) { report(match.index, `'${target}' is not a declared state`); continue; }
    // Subqueries test other rows, not this one.
    const where = rest.join("WHERE").split(/\(\s*SELECT\b/i)[0];
    const sources = fromStates(where, lifecycle);
    if (sources === null) {
      if (!lifecycle.transitions.some((transition) => transition.to === target)) report(match.index, `no transition leads to '${target}'`);
      continue;
    }
    for (const source of sources) {
      if (source !== target && !canTransition(lifecycle, source, target)) report(match.index, `'${source}' -> '${target}' is not a declared transition`);
    }
  }

  const insert = new RegExp(`INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${escape(lifecycle.table)}\\s*\\(([^)]*)\\)\\s*VALUES\\s*\\(`, "g");
  for (const match of text.matchAll(insert)) {
    const columns = match[1].split(",").map((name) => name.trim());
    const position = columns.indexOf(lifecycle.column);
    if (position === -1) continue;
    const values = splitTopLevel(statementAt(text, match.index + match[0].length));
    const value = /^'([a-z_]+)'$/.exec(values[position] ?? "")?.[1];
    if (!value) continue;
    result.inserts += 1;
    if (!(lifecycle.initial as readonly string[]).includes(value)) report(match.index, `rows may not start as '${value}'`);
  }
  return result;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "test-support" || name === "fixtures" ? [] : sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

/** Scans every non-test TypeScript file under `root` (api/src). */
export function scanTree(root: string, lifecycle: Lifecycle): ScanResult {
  const total: ScanResult = { updates: 0, inserts: 0, violations: [] };
  for (const path of sourceFiles(root)) {
    const found = scanSource(readFileSync(path, "utf8"), relative(root, path), lifecycle);
    total.updates += found.updates;
    total.inserts += found.inserts;
    total.violations.push(...found.violations);
  }
  return total;
}

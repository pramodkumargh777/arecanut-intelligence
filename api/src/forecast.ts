import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./index";
import { calendarDateToTime, completedMonthIST, shiftCalendarMonth, timestampToTime } from "../../shared/dates";

export const FORECAST_VERSION = "monthly-baselines-v1";
export const FORECAST_STATE = "Karnataka";
export const FORECAST_START = "2021-01";
export const FORECAST_SCHEMA = `
CREATE TABLE forecast_snapshots (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state = 'Karnataka'),
  variety_name TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  formula_version TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  results_json TEXT NOT NULL
);
CREATE INDEX forecast_snapshot_latest ON forecast_snapshots(state, variety_name, evaluated_at DESC, id DESC);
CREATE TRIGGER forecast_snapshot_no_update BEFORE UPDATE ON forecast_snapshots
BEGIN SELECT RAISE(ABORT, 'Forecast snapshots are immutable'); END;
CREATE TRIGGER forecast_snapshot_no_delete BEFORE DELETE ON forecast_snapshots
BEGIN SELECT RAISE(ABORT, 'Forecast snapshots are immutable'); END;
`;

export type MonthlyForecastInput = {
  reporting_month: string;
  state: string;
  variety_name: string;
  weighted_price: number | null;
  price_unit: string;
  source_url: string;
  fetched_at: string;
  refresh_run_id: string;
};
export type ForecastInputs = { prices: MonthlyForecastInput[]; versions: MonthlyForecastInput[] };
export type ForecastModel = "last_value" | "seasonal_naive";
export type Metrics = { count: number; mae: number; rmse: number; smape_percent: number };
export type BacktestPoint = {
  reporting_month: string; training_through: string; actual: number;
  last_value: number; seasonal_naive: number;
};
const BLOCK = 12;
const INITIAL_HISTORY = 24;
export const MIN_FORECAST_MONTHS = INITIAL_HISTORY + BLOCK * 3;
export const INTERVAL_LEVEL = 0.8;
export const FORECAST_LIMITATIONS = [
  "Experimental reference baselines, not proven predictive models. Last value repeats the latest observed monthly price; seasonal naive repeats the same month last year. No prospective predictive advantage is established.",
  "Rolling-origin backtests use current revised history, not as-of source vintages; vintage leakage is not ruled out.",
  "Monthly Karnataka exact-variety weighted prices only; no official daily, assumed-unit or TSS blending.",
  "Only the next reporting month is evaluated; this is not a multi-step or daily forecast.",
  "Empirical absolute-residual intervals use only 12 pre-holdout errors. Serial dependence, model selection and small samples prevent a guaranteed coverage claim.",
  "Holdout results are a retrospective publication gate, not evidence of prospective trading returns. Repeated evaluation can reuse the same holdout.",
];

export function shiftMonth(month: string, offset: number): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Number.isInteger(offset)) throw new Error("Invalid month");
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + offset, 1)).toISOString().slice(0, 7);
}
export function completedMonth(asOf: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    calendarDateToTime(asOf);
    return shiftCalendarMonth(asOf.slice(0, 7), -1);
  }
  return completedMonthIST(new Date(timestampToTime(asOf)));
}

function normalizedRow(row: MonthlyForecastInput): MonthlyForecastInput {
  return {
    reporting_month: row.reporting_month, state: row.state, variety_name: row.variety_name,
    weighted_price: row.weighted_price, price_unit: row.price_unit, source_url: row.source_url,
    fetched_at: row.fetched_at, refresh_run_id: row.refresh_run_id,
  };
}
export function canonicalInputs(inputs: ForecastInputs): string {
  const sorted = (rows: MonthlyForecastInput[]) => rows.map(normalizedRow)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));
  return JSON.stringify({ prices: sorted(inputs.prices), versions: sorted(inputs.versions) });
}
export async function sourceFingerprint(inputs: ForecastInputs): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalInputs(inputs)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function score(actual: number[], predicted: number[]): Metrics {
  if (!actual.length || actual.length !== predicted.length
    || actual.some((value) => !Number.isFinite(value) || value <= 0)
    || predicted.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error("Invalid scoring data");
  const errors = actual.map((value, i) => Math.abs(value - predicted[i]));
  return {
    count: actual.length,
    mae: errors.reduce((a, b) => a + b, 0) / actual.length,
    rmse: Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / actual.length),
    smape_percent: actual.reduce((sum, value, i) => sum + 200 * errors[i] / (value + predicted[i]), 0) / actual.length,
  };
}

// Each target uses only earlier calendar months; gaps are rejected before this is called.
export function rollingOrigins(rows: MonthlyForecastInput[], from: number, to: number): BacktestPoint[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 12 || to > rows.length || from >= to) {
    throw new Error("Invalid rolling-origin range");
  }
  const ordered = [...rows].sort((a, b) => a.reporting_month.localeCompare(b.reporting_month));
  if (ordered.some((row, i) => !Number.isFinite(row.weighted_price) || row.weighted_price! <= 0
    || (i > 0 && shiftMonth(ordered[i - 1].reporting_month, 1) !== row.reporting_month))) {
    throw new Error("Rolling origins require contiguous positive monthly prices");
  }
  return ordered.slice(from, to).map((row, i) => ({
    reporting_month: row.reporting_month, training_through: ordered[from + i - 1].reporting_month,
    actual: row.weighted_price!, last_value: ordered[from + i - 1].weighted_price!,
    seasonal_naive: ordered[from + i - 12].weighted_price!,
  }));
}
export function empiricalRadius(errors: number[], level = INTERVAL_LEVEL): number {
  if (!errors.length || errors.some((error) => !Number.isFinite(error) || error < 0) || level <= 0 || level >= 1) {
    throw new Error("Invalid interval calibration");
  }
  const rank = Math.ceil((errors.length + 1) * level);
  if (rank > errors.length) throw new Error("Too few calibration errors for a finite interval");
  return [...errors].sort((a, b) => a - b)[rank - 1];
}
export function doesNotDeteriorate(candidate: Metrics, naive: Metrics): boolean {
  return candidate.mae <= naive.mae + 1e-9 && candidate.rmse <= naive.rmse + 1e-9
    && candidate.smape_percent <= naive.smape_percent + 1e-9;
}

export function evaluateForecast(inputs: ForecastInputs, variety: string, asOf: string) {
  const rows = [...inputs.prices].sort((a, b) => a.reporting_month.localeCompare(b.reporting_month));
  const completed = completedMonth(asOf);
  const issues: string[] = [];
  if (rows.length < MIN_FORECAST_MONTHS) issues.push("insufficient_history");
  if (rows.some((row) => row.state !== FORECAST_STATE || row.variety_name !== variety
    || row.price_unit !== "INR/quintal")) issues.push("invalid_scope_or_unit");
  if (rows.some((row) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.reporting_month)
    || row.reporting_month < FORECAST_START || row.reporting_month > completed)) issues.push("invalid_reporting_period");
  if (rows.some((row) => row.weighted_price === null || !Number.isFinite(row.weighted_price) || row.weighted_price <= 0)) {
    issues.push("nonpositive_or_missing_price");
  }
  if (!issues.includes("invalid_reporting_period") && rows.some((row, i) =>
    i > 0 && shiftMonth(rows[i - 1].reporting_month, 1) !== row.reporting_month)) issues.push("calendar_gap_or_duplicate");
  if (!rows.length || rows.at(-1)!.reporting_month !== completed) issues.push("stale_history");
  if (rows.some((row) => !row.refresh_run_id || !row.fetched_at || !row.source_url
    || !Number.isFinite(Date.parse(row.fetched_at))
    || !inputs.versions.some((version) => JSON.stringify(normalizedRow(row)) === JSON.stringify(normalizedRow(version))))) {
    issues.push("missing_capture_provenance");
  }
  const gates = {
    history_sufficient: rows.length >= MIN_FORECAST_MONTHS,
    history_valid: !issues.some((issue) => issue !== "insufficient_history" && issue !== "stale_history"),
    history_fresh: !issues.includes("stale_history"),
    evaluation_sufficient: false, performance_not_worse_than_naive: false,
  };
  const base = {
    formula_version: FORECAST_VERSION, state: FORECAST_STATE, variety, price_unit: "INR/quintal",
    horizon_months: 1, evaluated_as_of: asOf,
    history: { count: rows.length, from: rows[0]?.reporting_month ?? null, through: rows.at(-1)?.reporting_month ?? null },
    limitations: FORECAST_LIMITATIONS,
  };
  if (issues.length) return { ...base, publishable: false, reasons: issues, gates, evaluation: null, forecast: null };
  const n = rows.length;
  const validation = rollingOrigins(rows, n - 36, n - 24);
  const calibration = rollingOrigins(rows, n - 24, n - 12);
  const holdout = rollingOrigins(rows, n - 12, n);
  const metrics = (points: BacktestPoint[], model: ForecastModel) => score(points.map((p) => p.actual), points.map((p) => p[model]));
  const validationScores = { last_value: metrics(validation, "last_value"), seasonal_naive: metrics(validation, "seasonal_naive") };
  const selected: ForecastModel = validationScores.seasonal_naive.mae < validationScores.last_value.mae ? "seasonal_naive" : "last_value";
  const radius = empiricalRadius(calibration.map((point) => Math.abs(point.actual - point[selected])));
  const selectedScores = metrics(holdout, selected), naiveScores = metrics(holdout, "last_value");
  const performance = doesNotDeteriorate(selectedScores, naiveScores);
  const covered = holdout.filter((point) => Math.abs(point.actual - point[selected]) <= radius).length;
  gates.evaluation_sufficient = validation.length === BLOCK && calibration.length === BLOCK && holdout.length === BLOCK;
  gates.performance_not_worse_than_naive = performance;
  const point = selected === "last_value" ? rows[n - 1].weighted_price! : rows[n - 12].weighted_price!;
  return {
    ...base, publishable: performance, reasons: performance ? [] : ["holdout_performance_deteriorated"], gates,
    evaluation: {
      selection_rule: "Lowest pre-test validation MAE; ties choose last_value. Calibration and holdout never select the model.",
      initial_training_months: n - 36, selected_model: selected,
      label: selected === "last_value" ? "Experimental last-value reference; no demonstrated predictive edge" : "Experimental seasonal-naive monthly reference",
      validation: { points: validation, metrics: validationScores },
      calibration: { points: calibration, count: calibration.length, absolute_residual_radius: radius,
        nominal_coverage: INTERVAL_LEVEL, quantile_rank: Math.ceil((calibration.length + 1) * INTERVAL_LEVEL) },
      holdout: { points: holdout, selected: selectedScores, naive: naiveScores,
        covered, interval_coverage: covered / holdout.length,
        mae_skill_vs_naive: naiveScores.mae > 0 ? 1 - selectedScores.mae / naiveScores.mae : null },
    },
    forecast: performance ? {
      reporting_month: shiftMonth(rows[n - 1].reporting_month, 1), model: selected, point,
      lower: Math.max(0, point - radius), upper: point + radius,
      nominal_coverage: INTERVAL_LEVEL, method: "Pre-holdout absolute-error empirical order statistic",
    } : null,
  };
}

type SnapshotRow = {
  id: string; state: string; variety_name: string; evaluated_at: string; formula_version: string;
  source_fingerprint: string; inputs_json: string; results_json: string;
};
async function loadInputs(db: D1Database, variety: string, asOf: string): Promise<ForecastInputs> {
  // One SQLite statement reads current prices and capture versions consistently.
  const columns = "reporting_month,state,variety_name,weighted_price,price_unit,source_url,fetched_at,refresh_run_id";
  const result = await db.prepare(`SELECT 'price' AS kind,${columns} FROM monthly_variety_prices
    WHERE state=? AND variety_name=? AND reporting_month BETWEEN ? AND ?
    UNION ALL SELECT 'version' AS kind,${columns} FROM monthly_price_versions
    WHERE state=? AND variety_name=? AND reporting_month BETWEEN ? AND ?`)
    .bind(FORECAST_STATE, variety, FORECAST_START, completedMonth(asOf),
      FORECAST_STATE, variety, FORECAST_START, completedMonth(asOf)).all<MonthlyForecastInput & { kind: string }>();
  return {
    prices: result.results.filter((row) => row.kind === "price").map(normalizedRow),
    versions: result.results.filter((row) => row.kind === "version").map(normalizedRow),
  };
}
export function snapshotStaleReasons(
  snapshot: { source_fingerprint: string; formula_version: string },
  currentFingerprint: string, inputs: ForecastInputs, asOf: string,
): string[] {
  const reasons: string[] = [];
  if (snapshot.source_fingerprint !== currentFingerprint) reasons.push("source_history_changed");
  if (snapshot.formula_version !== FORECAST_VERSION) reasons.push("formula_version_changed");
  const latest = inputs.prices.map((row) => row.reporting_month).sort().at(-1);
  if (latest !== completedMonth(asOf)) reasons.push("stale_history");
  return reasons;
}

const varietySchema = z.string().min(1).max(160).refine((value) => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
const requestSchema = z.object({ variety: varietySchema.default("Rashi") }).strict();
export const forecastRoutes = new Hono<Env>();
forecastRoutes.get("/forecasts", async (c) => {
  const parsed = requestSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "Provide only an exact variety name (maximum 160 characters)." }, 400);
  const row = await c.env.DB.prepare(`SELECT * FROM forecast_snapshots WHERE state=? AND variety_name=?
    ORDER BY evaluated_at DESC,rowid DESC LIMIT 1`).bind(FORECAST_STATE, parsed.data.variety).first<SnapshotRow>();
  if (!row) return c.json({ status: "not_evaluated", state: FORECAST_STATE, variety: parsed.data.variety,
    snapshot: null, stale: false, stale_reasons: [], forecast: null });
  const asOf = new Date().toISOString();
  const current = await loadInputs(c.env.DB, parsed.data.variety, asOf);
  const reasons = snapshotStaleReasons(row, await sourceFingerprint(current), current, asOf);
  const results = JSON.parse(row.results_json) as ReturnType<typeof evaluateForecast>;
  return c.json({
    status: reasons.length ? "stale" : results.publishable ? "published" : "withheld",
    snapshot: {
      id: row.id, state: row.state, variety: row.variety_name, evaluated_at: row.evaluated_at,
      formula_version: row.formula_version, source_fingerprint: row.source_fingerprint,
      inputs: JSON.parse(row.inputs_json) as ForecastInputs, results,
    },
    stale: reasons.length > 0, stale_reasons: reasons, forecast: reasons.length ? null : results.forecast,
  });
});
forecastRoutes.post("/admin/forecasts/evaluate", async (c) => {
  const token = c.env.ADMIN_TOKEN;
  if (!token || c.req.header("Authorization") !== `Bearer ${token}`) {
    return c.json({ error: "A valid reviewer token is required." }, 401);
  }
  const parsed = requestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Provide only an exact variety name (maximum 160 characters)." }, 400);
  const evaluatedAt = new Date().toISOString();
  const inputs = await loadInputs(c.env.DB, parsed.data.variety, evaluatedAt);
  const fingerprint = await sourceFingerprint(inputs);
  const results = evaluateForecast(inputs, parsed.data.variety, evaluatedAt);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO forecast_snapshots
    (id,state,variety_name,evaluated_at,formula_version,source_fingerprint,inputs_json,results_json)
    VALUES (?,?,?,?,?,?,?,?)`).bind(id, FORECAST_STATE, parsed.data.variety, evaluatedAt, FORECAST_VERSION,
    fingerprint, canonicalInputs(inputs), JSON.stringify(results)).run();
  return c.json({ status: results.publishable ? "published" : "withheld",
    snapshot: { id, state: FORECAST_STATE, variety: parsed.data.variety, evaluated_at: evaluatedAt,
      formula_version: FORECAST_VERSION, source_fingerprint: fingerprint,
      inputs: JSON.parse(canonicalInputs(inputs)) as ForecastInputs, results },
    stale: false, stale_reasons: [], forecast: results.forecast }, 201);
});

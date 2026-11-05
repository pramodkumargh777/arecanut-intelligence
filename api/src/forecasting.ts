import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./index";

// Experimental forecasting engine (data-platform/forecasting). The monthly-baselines-v1 snapshots in
// forecast.ts remain the published reference; nothing here modifies them.

export const FORECASTING_POLICY = {
  validation_min_outcomes: 6,
  validation_max_mae_ratio: 1.0,
  validation_min_coverage: 0.6,
  revocation_mae_ratio: 1.1,
  revocation_min_coverage: 0.5,
  candidate_min_points: 24,
  candidate_alpha: 0.05,
} as const;

export const FORECASTING_LIMITATIONS = [
  "Experimental models are compared with the stronger of last-value and seasonal-naive on identical walk-forward points.",
  "Historical backtests use revised history because stored capture vintages begin in November 2026; vintage leakage is not ruled out.",
  "A model is 'candidate' only after a Holm-adjusted Diebold-Mariano test and an interval-coverage check; it becomes 'validated' only after prospective outcomes confirm it, and is revoked if it degrades.",
  "Each dataset uses one price basis. Monthly state weighted averages, APMC modal, cooperative averages and TSS tender averages are never combined.",
  "Forecasts are ranges with an 80% nominal interval, not statements that prices will rise or fall.",
];

const MONTHLY_BASIS = "MONTHLY_STATE_WEIGHTED_AVERAGE";
const BASES = [MONTHLY_BASIS, "APMC_MODAL", "COOPERATIVE_AVERAGE"] as const;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/;
const SHA = /^[0-9a-f]{64}$/;
const text = (max: number) => z.string().min(1).max(max).refine((v) => v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v));
const finite = z.number().finite();
const nullableFinite = finite.nullable();
const coverageStatus = z.enum(["consistent_with_nominal", "below_nominal", "not_evaluated"]);

const evaluationSchema = z.object({
  dataset_key: text(80), series_id: text(300), market: text(160), variety: text(160), grade: text(80).nullable(),
  price_basis: z.enum(BASES), horizon: z.number().int().min(1).max(366), model: text(60), model_version: text(120),
  baseline_model: z.enum(["last_value", "seasonal_naive"]),
  status: z.enum(["reference", "candidate", "not_better_than_baseline"]), reasons: z.array(text(200)).max(20),
  n: z.number().int().min(0), mae: nullableFinite, rmse: nullableFinite, wape: nullableFinite, mase: nullableFinite,
  directional_accuracy: nullableFinite, interval_coverage: nullableFinite, interval_width: nullableFinite,
  dm_statistic: nullableFinite, p_value: nullableFinite, p_value_holm: nullableFinite,
  mae_skill_vs_baseline: nullableFinite, coverage_status: coverageStatus,
}).strict();

const predictionSchema = z.object({
  dataset_key: text(80), series_id: text(300), market: text(160), variety: text(160), grade: text(80).nullable(),
  price_basis: z.enum(BASES), unit: z.literal("INR/quintal"), model: text(60), model_version: text(120),
  origin_period: z.string().regex(PERIOD), target_period: z.string().regex(PERIOD),
  horizon: z.number().int().min(1).max(366), median: finite.positive(), lower: finite.min(0), upper: finite.positive(),
  interval_level: z.number().int().min(50).max(99), last_observed_value: finite.positive(),
  input_data_version: z.string().regex(SHA),
  evaluation_status: z.enum(["reference", "candidate", "not_better_than_baseline", "not_evaluated"]),
  coverage_status: coverageStatus,
}).strict();

const datasetSchema = z.object({
  key: text(80), price_basis: text(60), frequency: z.enum(["monthly", "daily"]), unit: text(40), unit_status: text(40),
  provenance: z.enum(["database", "synthetic_test"]), data_version: z.string().regex(SHA), suppressed: z.boolean(),
  suppression_reasons: z.array(text(200)).max(20), publication_eligible: z.boolean(),
  series_total: z.number().int().min(0), series_eligible: z.number().int().min(0), observations: z.number().int().min(0),
  notes: z.array(z.string().max(500)).max(20),
}).strict();

export const experimentPayloadSchema = z.object({
  experiment: z.object({
    id: z.string().regex(/^fx-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{10}$/), engine_version: text(60),
    created_at: z.string().datetime(), config_hash: z.string().regex(SHA), vintage_mode: z.enum(["revised", "strict"]),
    dataset_key: text(80), price_basis: z.enum(BASES), input_data_version: z.string().regex(SHA),
    origin_period: z.string().regex(PERIOD), origins_evaluated: z.number().int().min(0),
  }).passthrough(),
  datasets: z.array(datasetSchema).min(1).max(20),
  evaluations: z.array(evaluationSchema).max(5000),
  predictions: z.array(predictionSchema).min(1).max(2000),
}).strict();
export type ExperimentPayload = z.infer<typeof experimentPayloadSchema>;

async function sha256Hex(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Server-side publication rules; returns problems (empty when acceptable). Database triggers add origin/target checks. */
export function payloadProblems(payload: ExperimentPayload): string[] {
  const problems: string[] = [];
  const { experiment } = payload;
  if (payload.datasets.some((d) => d.provenance !== "database")) problems.push("synthetic_or_non_database_dataset");
  const evaluated = payload.datasets.find((d) => d.key === experiment.dataset_key);
  if (!evaluated) problems.push("evaluated_dataset_missing_from_manifest");
  else {
    if (evaluated.suppressed || !evaluated.publication_eligible) problems.push("evaluated_dataset_suppressed_or_ineligible");
    if (evaluated.price_basis !== experiment.price_basis) problems.push("dataset_basis_mismatch");
    if (evaluated.data_version !== experiment.input_data_version) problems.push("dataset_version_mismatch");
  }
  const rows = [...payload.evaluations, ...payload.predictions];
  if (rows.some((r) => r.dataset_key !== experiment.dataset_key || r.price_basis !== experiment.price_basis)) {
    problems.push("rows_mix_datasets_or_price_bases");
  }
  if (payload.predictions.some((p) => p.input_data_version !== experiment.input_data_version
    || p.origin_period !== experiment.origin_period)) problems.push("prediction_version_or_origin_mismatch");
  if (payload.predictions.some((p) => !(p.lower <= p.median && p.median <= p.upper))) problems.push("invalid_interval");
  if (payload.predictions.some((p) => p.target_period <= p.origin_period)) problems.push("target_not_after_origin");
  const policy = FORECASTING_POLICY;
  for (const e of payload.evaluations) {
    if (e.status !== "candidate") continue;
    const passes = e.reasons.length === 0 && e.n >= policy.candidate_min_points && e.p_value_holm !== null
      && e.p_value_holm < policy.candidate_alpha && (e.mae_skill_vs_baseline ?? 0) > 0
      && e.coverage_status === "consistent_with_nominal";
    if (!passes) { problems.push("candidate_without_passing_evaluation"); break; }
  }
  const statuses = new Map(payload.evaluations.map((e) => [`${e.series_id}\u0000${e.horizon}\u0000${e.model}`, e.status]));
  if (payload.predictions.some((p) => (statuses.get(`${p.series_id}\u0000${p.horizon}\u0000${p.model}`) ?? "not_evaluated") !== p.evaluation_status)) {
    problems.push("prediction_status_does_not_match_evaluation");
  }
  return problems;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const EVALUATION_COLUMNS = ["dataset_key", "series_id", "market", "variety", "grade", "price_basis", "horizon", "model",
  "model_version", "baseline_model", "status", "n", "mae", "rmse", "wape", "mase", "directional_accuracy",
  "interval_coverage", "interval_width", "dm_statistic", "p_value", "p_value_holm", "mae_skill_vs_baseline", "coverage_status"];
const PREDICTION_COLUMNS = ["dataset_key", "series_id", "market", "variety", "grade", "price_basis", "unit", "model",
  "model_version", "origin_period", "target_period", "horizon", "median", "interval_level", "last_observed_value",
  "input_data_version", "evaluation_status", "coverage_status"];

export async function storeExperiment(db: D1Database, payload: ExperimentPayload) {
  const canonical = JSON.stringify(payload);
  const sha = await sha256Hex(canonical);
  const existing = await db.prepare("SELECT payload_sha256 FROM forecast_experiments WHERE id = ?")
    .bind(payload.experiment.id).first<{ payload_sha256: string }>();
  if (existing) return { status: existing.payload_sha256 === sha ? "duplicate" as const : "conflict" as const, sha };
  const { experiment } = payload;
  const { id, engine_version, created_at, config_hash, vintage_mode, dataset_key, price_basis, input_data_version,
    origin_period, origins_evaluated, ...metadata } = experiment;
  const statements = [db.prepare(`INSERT INTO forecast_experiments (id, engine_version, created_at, config_hash, payload_sha256,
    vintage_mode, dataset_key, price_basis, input_data_version, origin_period, origins_evaluated, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, engine_version, created_at, config_hash, sha, vintage_mode,
    dataset_key, price_basis, input_data_version, origin_period, origins_evaluated,
    JSON.stringify({ ...metadata, datasets: payload.datasets }))];
  const extract = (columns: string[]) => columns.map((c) => `json_extract(value, '$.${c}')`).join(", ");
  for (const part of chunks(payload.evaluations, 250)) {
    statements.push(db.prepare(`INSERT INTO forecast_model_evaluations (experiment_id, ${EVALUATION_COLUMNS.join(", ")}, reasons_json)
      SELECT ?, ${extract(EVALUATION_COLUMNS)}, json_extract(value, '$.reasons') FROM json_each(?)`)
      .bind(id, JSON.stringify(part.map((e) => ({ ...e, reasons: JSON.stringify(e.reasons) })))));
  }
  for (const part of chunks(payload.predictions, 250)) {
    statements.push(db.prepare(`INSERT INTO forecast_predictions (experiment_id, forecast_created_at, ${PREDICTION_COLUMNS.join(", ")},
      lower_bound, upper_bound) SELECT ?, ?, ${extract(PREDICTION_COLUMNS)}, json_extract(value, '$.lower'),
      json_extract(value, '$.upper') FROM json_each(?)`).bind(id, created_at, JSON.stringify(part)));
  }
  await db.batch(statements);
  return { status: "stored" as const, sha };
}

// ---------- Prospective reconciliation ----------

const OUTCOME_SQL = [
  `INSERT OR IGNORE INTO forecast_outcomes (prediction_id, actual_value, actual_captured_at, error, absolute_error, within_interval, source_table)
   SELECT p.id, m.weighted_price, m.fetched_at, m.weighted_price - p.median, abs(m.weighted_price - p.median),
     CASE WHEN m.weighted_price BETWEEN p.lower_bound AND p.upper_bound THEN 1 ELSE 0 END, 'monthly_variety_prices'
   FROM forecast_predictions p JOIN monthly_variety_prices m ON m.state = 'Karnataka' AND m.variety_name = p.variety
     AND m.reporting_month = p.target_period AND m.price_unit = 'INR/quintal' AND m.weighted_price > 0
   WHERE p.price_basis = '${MONTHLY_BASIS}' AND NOT EXISTS (SELECT 1 FROM forecast_outcomes o WHERE o.prediction_id = p.id)`,
  `INSERT OR IGNORE INTO forecast_outcomes (prediction_id, actual_value, actual_captured_at, error, absolute_error, within_interval, source_table)
   SELECT p.id, o.modal_price, o.platform_fetched_at, o.modal_price - p.median, abs(o.modal_price - p.median),
     CASE WHEN o.modal_price BETWEEN p.lower_bound AND p.upper_bound THEN 1 ELSE 0 END, 'market_price_observations'
   FROM forecast_predictions p JOIN market_price_observations o ON o.validation_status = 'validated' AND o.price_basis = 'APMC_MODAL'
     AND o.market_id || '|' || o.variety_name || '|' || COALESCE(o.grade, '-') = p.series_id AND o.reporting_date = p.target_period
     AND o.price_unit = 'INR/quintal' AND o.modal_price > 0
   WHERE p.price_basis = 'APMC_MODAL' AND NOT EXISTS (SELECT 1 FROM forecast_outcomes x WHERE x.prediction_id = p.id)`,
  `INSERT OR IGNORE INTO forecast_outcomes (prediction_id, actual_value, actual_captured_at, error, absolute_error, within_interval, source_table)
   SELECT p.id, q.average_price, q.fetched_at, q.average_price - p.median, abs(q.average_price - p.median),
     CASE WHEN q.average_price BETWEEN p.lower_bound AND p.upper_bound THEN 1 ELSE 0 END, 'cooperative_quotes'
   FROM forecast_predictions p JOIN cooperative_quotes q ON q.source_key = 'mamcos' AND q.commodity = 'arecanut' AND q.status = 'verified'
     AND q.price_basis = 'COOPERATIVE_AVERAGE' AND q.price_unit = 'INR/quintal'
     AND q.unit_status = 'source_confirmed' AND 'mamcos|' || q.branch || '|' || q.variety = p.series_id
     AND q.reporting_date = p.target_period AND q.average_price > 0
   WHERE p.price_basis = 'COOPERATIVE_AVERAGE' AND NOT EXISTS (SELECT 1 FROM forecast_outcomes x WHERE x.prediction_id = p.id)`,
];

type OutcomeRow = {
  dataset_key: string; series_id: string; variety: string; horizon: number; model: string; model_version: string;
  target_period: string; absolute_error: number; within_interval: number; baseline_error: number | null;
  evaluation_status: string;
};
export type PerformanceKey = {
  dataset_key: string; series_id: string; variety: string; horizon: number; model: string; model_version: string;
  outcomes: number; mae: number; coverage: number; paired: number; paired_mae: number | null; baseline_mae: number | null;
  mae_ratio: number | null; recent_mae_ratio: number | null; backtest_status: string; effective_status: string;
  last_event: { event: string; reason: string; created_at: string } | null;
};

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

export async function forecastPerformance(db: D1Database, limit = 20000) {
  const [outcomes, events] = await db.batch([
    db.prepare(`SELECT p.dataset_key, p.series_id, p.variety, p.horizon, p.model, p.model_version, p.target_period,
      o.absolute_error, o.within_interval, bo.absolute_error AS baseline_error, e.status AS evaluation_status
      FROM forecast_outcomes o JOIN forecast_predictions p ON p.id = o.prediction_id
      JOIN forecast_model_evaluations e ON e.experiment_id = p.experiment_id AND e.series_id = p.series_id
        AND e.horizon = p.horizon AND e.model = p.model
      LEFT JOIN forecast_predictions bp ON bp.experiment_id = p.experiment_id AND bp.series_id = p.series_id
        AND bp.horizon = p.horizon AND bp.model = e.baseline_model
      LEFT JOIN forecast_outcomes bo ON bo.prediction_id = bp.id
      ORDER BY p.target_period, p.id LIMIT ?`).bind(limit + 1),
    db.prepare(`SELECT series_id, horizon, model, model_version, event, reason, created_at FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY series_id, horizon, model, model_version ORDER BY id DESC) AS rn
      FROM forecast_model_events) WHERE rn = 1`),
  ]) as [D1Result<OutcomeRow>, D1Result<{ series_id: string; horizon: number; model: string; model_version: string; event: string; reason: string; created_at: string }>];
  const truncated = outcomes.results.length > limit;
  const rows = outcomes.results.slice(0, limit);
  const latestEvent = new Map(events.results.map((e) => [`${e.series_id}\u0000${e.horizon}\u0000${e.model}\u0000${e.model_version}`, e]));
  const groups = new Map<string, OutcomeRow[]>();
  for (const row of rows) {
    const key = `${row.series_id}\u0000${row.horizon}\u0000${row.model}\u0000${row.model_version}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const keys: PerformanceKey[] = [];
  for (const [key, list] of groups) {
    const paired = list.filter((r) => r.baseline_error !== null);
    const recent = paired.slice(-FORECASTING_POLICY.validation_min_outcomes);
    const ratio = (items: OutcomeRow[]) => {
      if (!items.length) return null;
      const base = mean(items.map((r) => r.baseline_error!));
      return base > 0 ? mean(items.map((r) => r.absolute_error)) / base : null;
    };
    const event = latestEvent.get(key) ?? null;
    const backtest = list.at(-1)!.evaluation_status;
    keys.push({
      dataset_key: list[0].dataset_key, series_id: list[0].series_id, variety: list[0].variety, horizon: list[0].horizon,
      model: list[0].model, model_version: list[0].model_version, outcomes: list.length,
      mae: mean(list.map((r) => r.absolute_error)), coverage: mean(list.map((r) => r.within_interval)),
      paired: paired.length, paired_mae: paired.length ? mean(paired.map((r) => r.absolute_error)) : null,
      baseline_mae: paired.length ? mean(paired.map((r) => r.baseline_error!)) : null,
      mae_ratio: ratio(paired), recent_mae_ratio: ratio(recent), backtest_status: backtest,
      effective_status: event?.event ?? backtest,
      last_event: event ? { event: event.event, reason: event.reason, created_at: event.created_at } : null,
    });
  }
  keys.sort((a, b) => a.series_id.localeCompare(b.series_id) || a.horizon - b.horizon || a.model.localeCompare(b.model));
  return { keys, truncated, outcomes: rows.length };
}

/** Decide validation/revocation for one model key from its prospective outcomes. Pure for testing. */
export function statusDecision(key: Pick<PerformanceKey, "effective_status" | "paired" | "mae_ratio" | "recent_mae_ratio" | "coverage">) {
  const p = FORECASTING_POLICY;
  if (key.effective_status !== "candidate" && key.effective_status !== "validated") return null;
  if (key.paired < p.validation_min_outcomes || key.mae_ratio === null) return null;
  const degraded = key.mae_ratio > p.revocation_mae_ratio || (key.recent_mae_ratio ?? 0) > p.revocation_mae_ratio
    || key.coverage < p.revocation_min_coverage;
  if (degraded) {
    return { event: "revoked" as const, reason: `Prospective MAE ratio ${key.mae_ratio.toFixed(3)} (recent ${key.recent_mae_ratio?.toFixed(3) ?? "n/a"}) or coverage ${key.coverage.toFixed(2)} breached revocation limits.` };
  }
  if (key.effective_status === "candidate" && key.mae_ratio <= p.validation_max_mae_ratio && key.coverage >= p.validation_min_coverage) {
    return { event: "validated" as const, reason: `Prospective MAE ratio ${key.mae_ratio.toFixed(3)} over ${key.paired} paired outcomes with coverage ${key.coverage.toFixed(2)}.` };
  }
  return null;
}

export async function reconcileForecastOutcomes(db: D1Database) {
  const inserted = await db.batch(OUTCOME_SQL.map((sql) => db.prepare(sql)));
  const matched = inserted.reduce((sum, r) => sum + Number(r.meta?.changes ?? 0), 0);
  const performance = await forecastPerformance(db);
  const decisions = performance.keys.map((key) => ({ key, decision: statusDecision(key) }))
    .filter((d): d is { key: PerformanceKey; decision: NonNullable<ReturnType<typeof statusDecision>> } => d.decision !== null);
  if (decisions.length) {
    await db.batch(decisions.map(({ key, decision }) => db.prepare(`INSERT INTO forecast_model_events
      (dataset_key, series_id, horizon, model, model_version, event, reason, evidence_json, actor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reconciliation')`).bind(key.dataset_key, key.series_id, key.horizon, key.model,
      key.model_version, decision.event, decision.reason, JSON.stringify({ paired: key.paired, mae_ratio: key.mae_ratio,
        recent_mae_ratio: key.recent_mae_ratio, coverage: key.coverage, outcomes: key.outcomes }))));
  }
  return { matched_outcomes: matched, events: decisions.map(({ key, decision }) => ({ series_id: key.series_id,
    horizon: key.horizon, model: key.model, model_version: key.model_version, ...decision })) };
}

// ---------- Routes ----------

export const forecastingRoutes = new Hono<Env>();
const bearer = (header: string | undefined, token: string | undefined) => Boolean(token && header === `Bearer ${token}`);

forecastingRoutes.post("/admin/forecasting/experiments", async (c) => {
  if (!bearer(c.req.header("Authorization"), c.env.INGESTION_TOKEN)) return c.json({ error: "A valid ingestion token is required." }, 401);
  const parsed = experimentPayloadSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Invalid experiment payload.", issues: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
  }
  const problems = payloadProblems(parsed.data);
  if (problems.length) return c.json({ error: "Experiment refused by publication rules.", problems }, 422);
  try {
    const result = await storeExperiment(c.env.DB, parsed.data);
    if (result.status === "conflict") return c.json({ error: "Experiment id already stored with a different payload." }, 409);
    return c.json({ status: result.status, experiment_id: parsed.data.experiment.id, payload_sha256: result.sha,
      evaluations: parsed.data.evaluations.length, predictions: parsed.data.predictions.length }, result.status === "stored" ? 201 : 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const known = ["Forecast origin does not match a stored observation", "Forecast target is already observed",
      "Monthly forecast series must be Karnataka exact-variety series"].find((m) => message.includes(m));
    if (known) return c.json({ error: "Experiment refused by database guard.", problems: [known] }, 422);
    throw error;
  }
});

forecastingRoutes.get("/forecasting/overview", async (c) => {
  const [latest, counts, totals] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT id, engine_version, created_at, received_at, config_hash, payload_sha256, vintage_mode, dataset_key,
      price_basis, input_data_version, origin_period, origins_evaluated, metadata_json FROM forecast_experiments
      ORDER BY received_at DESC, id DESC LIMIT 1`),
    c.env.DB.prepare(`SELECT status, COUNT(*) AS count FROM forecast_model_evaluations WHERE experiment_id =
      (SELECT id FROM forecast_experiments ORDER BY received_at DESC, id DESC LIMIT 1) GROUP BY status`),
    c.env.DB.prepare(`SELECT (SELECT COUNT(*) FROM forecast_experiments) AS experiments,
      (SELECT COUNT(*) FROM forecast_predictions) AS predictions, (SELECT COUNT(*) FROM forecast_outcomes) AS outcomes,
      (SELECT COUNT(*) FROM forecast_model_events WHERE event = 'validated') AS validated_events,
      (SELECT COUNT(*) FROM forecast_model_events WHERE event = 'revoked') AS revoked_events`),
  ]) as [D1Result<Record<string, unknown> & { metadata_json: string }>, D1Result<{ status: string; count: number }>, D1Result<Record<string, number>>];
  const row = latest.results[0];
  const { metadata_json, ...experiment } = row ?? { metadata_json: "null" };
  return c.json({
    experiment: row ? { ...experiment, metadata: JSON.parse(metadata_json) } : null,
    status_counts: Object.fromEntries(counts.results.map((r) => [r.status, r.count])),
    totals: totals.results[0], policy: FORECASTING_POLICY, limitations: FORECASTING_LIMITATIONS,
  });
});

const pageSchema = z.object({
  experiment_id: z.string().max(80).optional(), series_id: z.string().max(300).optional(), model: z.string().max(60).optional(),
  status: z.enum(["reference", "candidate", "not_better_than_baseline"]).optional(),
  horizon: z.coerce.number().int().min(1).max(366).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100), after: z.coerce.number().int().min(0).default(0),
}).strict();

async function latestExperimentId(db: D1Database, requested?: string) {
  if (requested) return requested;
  const row = await db.prepare("SELECT id FROM forecast_experiments ORDER BY received_at DESC, id DESC LIMIT 1").first<{ id: string }>();
  return row?.id ?? null;
}

forecastingRoutes.get("/forecasting/evaluations", async (c) => {
  const parsed = pageSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "Invalid filters." }, 400);
  const q = parsed.data;
  const experimentId = await latestExperimentId(c.env.DB, q.experiment_id);
  if (!experimentId) return c.json({ experiment_id: null, data: [], next_after: null });
  const where = ["experiment_id = ?", "id > ?"];
  const values: (string | number)[] = [experimentId, q.after];
  if (q.series_id) { where.push("series_id = ?"); values.push(q.series_id); }
  if (q.model) { where.push("model = ?"); values.push(q.model); }
  if (q.status) { where.push("status = ?"); values.push(q.status); }
  if (q.horizon) { where.push("horizon = ?"); values.push(q.horizon); }
  const rows = await c.env.DB.prepare(`SELECT * FROM forecast_model_evaluations WHERE ${where.join(" AND ")} ORDER BY id LIMIT ?`)
    .bind(...values, q.limit + 1).all<Record<string, unknown> & { id: number; reasons_json: string }>();
  const page = rows.results.slice(0, q.limit);
  return c.json({
    experiment_id: experimentId,
    data: page.map(({ reasons_json, ...rest }) => ({ ...rest, reasons: JSON.parse(reasons_json) })),
    next_after: rows.results.length > q.limit ? page.at(-1)!.id : null,
  });
});

forecastingRoutes.get("/forecasting/predictions", async (c) => {
  const parsed = pageSchema.omit({ status: true }).safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "Invalid filters." }, 400);
  const q = parsed.data;
  const experimentId = await latestExperimentId(c.env.DB, q.experiment_id);
  if (!experimentId) return c.json({ experiment_id: null, data: [], next_after: null });
  const where = ["p.experiment_id = ?", "p.id > ?"];
  const values: (string | number)[] = [experimentId, q.after];
  if (q.series_id) { where.push("p.series_id = ?"); values.push(q.series_id); }
  if (q.model) { where.push("p.model = ?"); values.push(q.model); }
  if (q.horizon) { where.push("p.horizon = ?"); values.push(q.horizon); }
  const rows = await c.env.DB.prepare(`SELECT p.id, p.series_id, p.market, p.variety, p.grade, p.price_basis, p.unit, p.model,
      p.model_version, p.forecast_created_at, p.origin_period, p.target_period, p.horizon, p.median, p.lower_bound, p.upper_bound,
      p.interval_level, p.last_observed_value, p.input_data_version, p.evaluation_status, p.coverage_status,
      o.actual_value, o.absolute_error, o.within_interval, o.matched_at,
      (SELECT e.event FROM forecast_model_events e WHERE e.series_id = p.series_id AND e.horizon = p.horizon
        AND e.model = p.model AND e.model_version = p.model_version ORDER BY e.id DESC LIMIT 1) AS latest_event
    FROM forecast_predictions p LEFT JOIN forecast_outcomes o ON o.prediction_id = p.id
    WHERE ${where.join(" AND ")} ORDER BY p.id LIMIT ?`).bind(...values, q.limit + 1)
    .all<Record<string, unknown> & { id: number; evaluation_status: string; latest_event: string | null }>();
  const page = rows.results.slice(0, q.limit);
  return c.json({
    experiment_id: experimentId,
    data: page.map((row) => {
      const effective = row.latest_event ?? row.evaluation_status;
      const publication = effective === "validated" ? "validated_forecast" : effective === "candidate" ? "experimental_candidate"
        : effective === "reference" ? "reference_baseline" : "not_published";
      return { ...row, effective_status: effective, publication };
    }),
    next_after: rows.results.length > q.limit ? page.at(-1)!.id : null,
  });
});

forecastingRoutes.get("/forecasting/performance", async (c) => {
  const result = await forecastPerformance(c.env.DB);
  return c.json({ ...result, policy: FORECASTING_POLICY });
});

const adminOnly = (c: { env: Env["Bindings"]; req: { header: (name: string) => string | undefined } }) =>
  bearer(c.req.header("Authorization"), c.env.ADMIN_TOKEN);

forecastingRoutes.post("/admin/forecasting/reconcile", async (c) => {
  if (!adminOnly(c)) return c.json({ error: "A valid reviewer token is required." }, 401);
  return c.json(await reconcileForecastOutcomes(c.env.DB));
});

const revokeSchema = z.object({
  series_id: text(300), horizon: z.number().int().min(1).max(366), model: text(60), model_version: text(120),
  reason: text(500),
}).strict();
forecastingRoutes.post("/admin/forecasting/models/revoke", async (c) => {
  if (!adminOnly(c)) return c.json({ error: "A valid reviewer token is required." }, 401);
  const parsed = revokeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Provide series_id, horizon, model, model_version and reason." }, 400);
  const p = parsed.data;
  const known = await c.env.DB.prepare(`SELECT dataset_key FROM forecast_predictions WHERE series_id = ? AND horizon = ?
    AND model = ? AND model_version = ? LIMIT 1`).bind(p.series_id, p.horizon, p.model, p.model_version).first<{ dataset_key: string }>();
  if (!known) return c.json({ error: "No stored predictions for that model key." }, 404);
  await c.env.DB.prepare(`INSERT INTO forecast_model_events (dataset_key, series_id, horizon, model, model_version, event, reason,
    evidence_json, actor) VALUES (?, ?, ?, ?, ?, 'revoked', ?, '{}', 'reviewer')`)
    .bind(known.dataset_key, p.series_id, p.horizon, p.model, p.model_version, p.reason).run();
  return c.json({ status: "revoked" }, 201);
});

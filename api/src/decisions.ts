import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./index";

const nonnegative = z.number().finite().min(0).max(1e12);
export const calculationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  quantity_quintals: z.number().finite().min(0.0001).max(1e7),
  commission_percent: z.number().finite().min(0).max(99),
  transport_cost: nonnegative, other_selling_cost: nonnegative,
  area_hectares: z.number().finite().min(0.0001).max(1e7),
  production_cost: nonnegative, byproduct_income: nonnegative,
  hold_days: z.number().int().min(1).max(3650),
  annual_finance_percent: z.number().finite().min(0).max(100),
  storage_cost: nonnegative, weight_loss_percent: z.number().finite().min(0).max(99),
  scenario_price: z.number().finite().min(0.01).max(1e8),
  price: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("cooperative"), id: z.string().min(1).max(128) }).strict(),
    z.object({ kind: z.literal("monthly"), month: z.string().regex(/^\d{4}-\d{2}$/), variety: z.string().min(1).max(160), refresh_run_id: z.string().min(1).max(128) }).strict(),
    z.object({ kind: z.literal("manual"), value: z.number().finite().min(0.01).max(1e8) }).strict(),
  ]),
}).strict();
export type CalculationInputs = z.infer<typeof calculationSchema>;
export type PriceSnapshot = { value: number; source: string; reporting_period: string | null; fetched_at: string | null;
  source_url: string | null; variety: string | null; branch: string | null; state: string | null; unit_status: string; price_type: string; reference_id: string | null };
export const FORMULA_VERSION = "net-realization-v1";
class CalculationMagnitudeError extends Error {}

export function calculateDecision(input: CalculationInputs, price: PriceSnapshot) {
  const gross = input.quantity_quintals * price.value;
  const sellingCosts = gross * input.commission_percent / 100 + input.transport_cost + input.other_selling_cost;
  const net = gross - sellingCosts;
  const profit = net + input.byproduct_income - input.production_cost;
  const remaining = input.quantity_quintals * (1 - input.weight_loss_percent / 100);
  const finance = Math.max(0, net) * input.annual_finance_percent / 100 * input.hold_days / 365;
  const holdNet = remaining * input.scenario_price * (1 - input.commission_percent / 100)
    - input.transport_cost - input.other_selling_cost - input.storage_cost - finance;
  const breakEven = (net + input.transport_cost + input.other_selling_cost + input.storage_cost + finance)
    / (remaining * (1 - input.commission_percent / 100));
  const unchangedHoldNet = remaining * price.value * (1 - input.commission_percent / 100)
    - input.transport_cost - input.other_selling_cost - input.storage_cost - finance;
  const results = {
    gross_realization: gross, selling_costs: sellingCosts, net_realization: net,
    net_per_quintal: net / input.quantity_quintals,
    farm_profit: profit, profit_per_hectare: profit / input.area_hectares,
    roi_percent: input.production_cost > 0 ? profit / input.production_cost * 100 : null,
    remaining_quintals: remaining, finance_cost: finance, hold_net_realization: holdNet,
    hold_advantage: holdNet - net, break_even_hold_price: breakEven,
    hold_unchanged_net_realization: unchangedHoldNet, hold_unchanged_advantage: unchangedHoldNet - net,
    break_even_increase_percent: (breakEven / price.value - 1) * 100,
    farm_break_even_price: Math.max(0, (input.production_cost - input.byproduct_income + input.transport_cost + input.other_selling_cost)
      / (input.quantity_quintals * (1 - input.commission_percent / 100))),
  };
  if (Object.values(results).some((value) => value !== null && !Number.isFinite(value))) {
    throw new CalculationMagnitudeError("Inputs produce unsupported numerical magnitudes. Use practical quantities, prices and costs.");
  }
  return results;
}
async function resolvePrice(db: D1Database, ref: CalculationInputs["price"], state: string): Promise<PriceSnapshot | null> {
  if (ref.kind === "manual") return { value: ref.value, source: "User-entered scenario", reporting_period: null, fetched_at: null,
    source_url: null, variety: null, branch: null, state: null, unit_status: "user_entered", price_type: "user_price", reference_id: null };
  if (ref.kind === "cooperative") {
    const row = await db.prepare(`SELECT * FROM cooperative_quotes WHERE id=? AND status='verified' AND average_price>0`).bind(ref.id)
      .first<{ average_price: number; source_key: string; reporting_date: string; fetched_at: string; source_url: string; variety: string; branch: string; unit_status: string; id: string }>();
    return row ? { value: row.average_price, source: row.source_key.toUpperCase(), reporting_period: row.reporting_date,
      fetched_at: row.fetched_at, source_url: row.source_url, variety: row.variety, branch: row.branch, state: null, unit_status: row.unit_status, price_type: "reported_average", reference_id: row.id } : null;
  }
  const row = await db.prepare(`SELECT * FROM monthly_variety_prices WHERE state=? AND reporting_month=? AND variety_name=? AND refresh_run_id=? AND weighted_price>0`)
    .bind(state, ref.month, ref.variety, ref.refresh_run_id).first<{ weighted_price: number; fetched_at: string; source_url: string }>();
  return row ? { value: row.weighted_price, source: "AGMARKNET monthly", reporting_period: ref.month, fetched_at: row.fetched_at,
    source_url: row.source_url, variety: ref.variety, branch: null, state, unit_status: "source_confirmed", price_type: "monthly_weighted_modal", reference_id: ref.refresh_run_id } : null;
}

export const decisionRoutes = new Hono<Env>();
decisionRoutes.onError((error, c) => {
  if (error instanceof CalculationMagnitudeError) return c.json({ error: error.message }, 422);
  throw error;
});
decisionRoutes.get("/decisions/prices", async (c) => {
  const cooperative = await c.env.DB.prepare(`SELECT id,source_key,branch,reporting_date,variety,average_price,unit_status,fetched_at
    FROM cooperative_quotes WHERE status='verified' AND average_price>0 ORDER BY source_key,reporting_date DESC,branch,variety`).all();
  const monthly = await c.env.DB.prepare(`SELECT reporting_month,variety_name,weighted_price,refresh_run_id,fetched_at
    FROM monthly_variety_prices WHERE state=? AND reporting_month=(SELECT MAX(reporting_month) FROM monthly_variety_prices WHERE state=?)
    AND weighted_price>0 ORDER BY variety_name`).bind(c.env.REFERENCE_STATE ?? "Karnataka", c.env.REFERENCE_STATE ?? "Karnataka").all();
  return c.json({ cooperative: cooperative.results, monthly: monthly.results });
});
decisionRoutes.post("/decisions/calculate", async (c) => {
  const input = calculationSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "Provide every required input as a finite number in the stated units. Quantities/area/prices must be positive; costs cannot be negative." }, 400);
  const snapshot = await resolvePrice(c.env.DB, input.data.price, c.env.REFERENCE_STATE ?? "Karnataka");
  if (!snapshot) return c.json({ error: "Selected price was corrected or is no longer published. Reload source prices and select again." }, 409);
  return c.json({ inputs: input.data, price: snapshot, results: calculateDecision(input.data, snapshot), formula_version: FORMULA_VERSION });
});
decisionRoutes.post("/admin/decisions", async (c) => {
  if (!c.env.ADMIN_TOKEN || c.req.header("Authorization") !== `Bearer ${c.env.ADMIN_TOKEN}`) return c.json({ error: "A valid reviewer token is required to store private inputs." }, 401);
  const input = calculationSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "Invalid calculation inputs." }, 400);
  const snapshot = await resolvePrice(c.env.DB, input.data.price, c.env.REFERENCE_STATE ?? "Karnataka");
  if (!snapshot) return c.json({ error: "Source price changed. Reload source prices before saving." }, 409);
  const id = crypto.randomUUID(), created = new Date().toISOString(), results = calculateDecision(input.data, snapshot);
  await c.env.DB.prepare(`INSERT INTO decision_calculations
    (id,name,created_at,inputs_json,price_snapshot_json,results_json,formula_version) VALUES (?,?,?,?,?,?,?)`)
    .bind(id, input.data.name, created, JSON.stringify(input.data), JSON.stringify(snapshot), JSON.stringify(results), FORMULA_VERSION).run();
  return c.json({ id, name: input.data.name, created_at: created, inputs: input.data, price: snapshot, results, formula_version: FORMULA_VERSION }, 201);
});
decisionRoutes.get("/admin/decisions", async (c) => {
  if (!c.env.ADMIN_TOKEN || c.req.header("Authorization") !== `Bearer ${c.env.ADMIN_TOKEN}`) return c.json({ error: "A valid reviewer token is required." }, 401);
  const result = await c.env.DB.prepare("SELECT * FROM decision_calculations ORDER BY created_at DESC LIMIT 100").all<{
    id: string; name: string; created_at: string; inputs_json: string; price_snapshot_json: string; results_json: string; formula_version: string;
  }>();
  return c.json({ data: result.results.map((row) => ({ id: row.id, name: row.name, created_at: row.created_at,
    inputs: JSON.parse(row.inputs_json), price: JSON.parse(row.price_snapshot_json), results: JSON.parse(row.results_json), formula_version: row.formula_version })) });
});

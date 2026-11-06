import { Hono } from "hono";
import {
  CAPABILITIES, DEFAULT_COMMODITY, isPriceBasis,
  type Capability, type CommodityCatalog, type CommodityDef, type GradeDef, type PriceBasis, type UnitDef, type VarietyDef,
} from "../../shared/commodities";
import type { Env } from "./index";

export const commodityRoutes = new Hono<Env>();

export interface ResolvedCommodity { id: string; code: string; canonical_name: string }

/** Resolve a commodity code against the commodity master. Unknown codes return null; callers respond 400. */
export async function resolveCommodity(db: D1Database, code: string | undefined): Promise<ResolvedCommodity | null> {
  const requested = (code ?? DEFAULT_COMMODITY).trim();
  if (!/^[a-z_]{2,40}$/.test(requested)) return null;
  return db.prepare("SELECT id, code, canonical_name FROM commodities WHERE code = ?").bind(requested).first<ResolvedCommodity>();
}

export async function loadCatalog(db: D1Database): Promise<CommodityCatalog> {
  const [commodities, configs, capabilities, varieties, grades, units, bases] = await db.batch([
    db.prepare("SELECT id, code, display_name, category, status, sort_order FROM commodities WHERE code IS NOT NULL ORDER BY sort_order, code"),
    db.prepare("SELECT commodity_id, default_unit_code, currency, grading_system, agmarknet_commodity_code, config_status, notes FROM commodity_configs"),
    db.prepare("SELECT commodity_id, capability, status, note FROM commodity_capabilities"),
    db.prepare(`SELECT id, commodity_id, code, canonical_name AS label, classification_type, unit_code, mapping_status, evidence, sort_order
      FROM varieties ORDER BY sort_order, canonical_name`),
    db.prepare("SELECT id, commodity_id, code, label, grade_type, variety_id, mapping_status, evidence, sort_order FROM grades ORDER BY sort_order, label"),
    db.prepare("SELECT code, label, dimension, base_unit, factor_to_base FROM units ORDER BY dimension, factor_to_base"),
    db.prepare("SELECT code, label, description FROM price_bases ORDER BY sort_order"),
  ]);
  type Row<T> = T & { commodity_id: string };
  const configRows = configs.results as Row<NonNullable<CommodityDef["config"]>>[];
  const capabilityRows = capabilities.results as { commodity_id: string; capability: Capability; status: "available" | "unpublished"; note: string | null }[];
  const varietyRows = varieties.results as Row<VarietyDef>[];
  const gradeRows = grades.results as Row<GradeDef>[];
  const strip = <T extends { commodity_id: string }>({ commodity_id: _ignored, ...rest }: T) => rest;
  return {
    default_commodity: DEFAULT_COMMODITY,
    units: units.results as UnitDef[],
    price_bases: bases.results as CommodityCatalog["price_bases"],
    commodities: (commodities.results as Omit<CommodityDef, "config" | "capabilities" | "varieties" | "grades">[]).map((commodity) => {
      const config = configRows.find((row) => row.commodity_id === commodity.id);
      return {
        ...commodity,
        config: config ? strip(config) : null,
        capabilities: Object.fromEntries(capabilityRows.filter((row) => row.commodity_id === commodity.id && CAPABILITIES.includes(row.capability))
          .map((row) => [row.capability, { status: row.status, note: row.note }])),
        varieties: varietyRows.filter((row) => row.commodity_id === commodity.id).map(strip),
        grades: gradeRows.filter((row) => row.commodity_id === commodity.id).map(strip),
      };
    }),
  };
}

commodityRoutes.get("/commodities", async (c) => c.json(await loadCatalog(c.env.DB)));

function validDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Published observations from every integrated source, each with its own price basis. Bases are never combined. */
commodityRoutes.get("/price-observations", async (c) => {
  const commodity = await resolveCommodity(c.env.DB, c.req.query("commodity"));
  if (!commodity) return c.json({ error: "Unknown commodity." }, 400);
  const limit = Number(c.req.query("limit") ?? 200), offset = Number(c.req.query("offset") ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return c.json({ error: "limit must be an integer from 1 to 1000." }, 400);
  if (!Number.isInteger(offset) || offset < 0 || offset > 2_000_000) return c.json({ error: "offset must be an integer from 0 to 2000000." }, 400);
  const filters = ["published = 1", "commodity_id = ?"];
  const values: (string | number)[] = [commodity.id];
  const basis = c.req.query("price_basis");
  if (basis !== undefined && !isPriceBasis(basis)) return c.json({ error: "Unknown price_basis." }, 400);
  for (const [column, value] of [["price_basis", basis], ["source_key", c.req.query("source")], ["variety_label", c.req.query("variety")],
    ["variety_id", c.req.query("variety_id")], ["grade_label", c.req.query("grade")], ["grade_id", c.req.query("grade_id")]] as const) {
    if (value) { filters.push(`${column} = ?`); values.push(value); }
  }
  for (const [parameter, operator] of [["from", ">="], ["to", "<="]] as const) {
    const value = c.req.query(parameter);
    if (value && !validDate(value)) return c.json({ error: `Invalid ${parameter} date; expected YYYY-MM-DD.` }, 400);
    if (value) { filters.push(`observation_date ${operator} ?`); values.push(value); }
  }
  const where = filters.join(" AND ");
  const [rows, count] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT source_table, observation_id, source_key, commodity_code, original_commodity_label, market_id, market_label, market_kind,
        district, state, variety_id, variety_label, original_variety_label, variety_mapping_status, grade_id, grade_label, price_basis,
        original_unit, normalized_unit, observation_date, minimum_price, maximum_price, modal_price, average_price, quantity, quantity_unit,
        validation_status, source_record_id, source_url
      FROM price_observations WHERE ${where} ORDER BY observation_date DESC, source_key, market_label, variety_label LIMIT ? OFFSET ?`)
      .bind(...values, limit, offset),
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM price_observations WHERE ${where}`).bind(...values),
  ]);
  return c.json({
    commodity: commodity.code,
    data: rows.results,
    count: (count.results[0] as { count: number } | undefined)?.count ?? 0,
    note: "Rows keep their own price basis. APMC modal prices and cooperative averages are separate measures and must not be averaged together.",
  });
});

export interface CommodityValidationReport {
  generated_at: string;
  ok: boolean;
  tables: { table: string; base_rows: number; view_rows: number }[];
  unresolved_commodity_rows: number;
  invalid_price_basis_rows: { table: string; count: number }[];
  tss_rows_without_tender_basis: number;
  rows_missing_original_variety: number;
  daily_rows_variety_changed: number;
  unmapped_variety_labels: { source_key: string; commodity_code: string | null; label: string; rows: number }[];
  unmapped_grade_labels: { source_key: string; label: string; rows: number }[];
  markets_without_commodity_link: number;
  by_commodity_and_basis: { commodity_code: string | null; source_key: string; price_basis: PriceBasis; rows: number; published: number }[];
}

export async function validateCommodityModel(db: D1Database): Promise<CommodityValidationReport> {
  const results = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM market_price_observations"),
    db.prepare("SELECT COUNT(*) AS n FROM cooperative_quotes"),
    db.prepare("SELECT source_table, COUNT(*) AS n FROM price_observations GROUP BY source_table"),
    db.prepare("SELECT COUNT(*) AS n FROM price_observations WHERE commodity_id IS NULL"),
    db.prepare(`SELECT 'market_price_observations' AS tbl, COUNT(*) AS n FROM market_price_observations WHERE price_basis NOT IN ('APMC_MODAL','APMC_MIN_MAX')
      UNION ALL SELECT 'cooperative_quotes', COUNT(*) FROM cooperative_quotes WHERE price_basis NOT IN ('COOPERATIVE_AVERAGE','COOPERATIVE_TENDER_AVERAGE')`),
    db.prepare("SELECT COUNT(*) AS n FROM cooperative_quotes WHERE source_key = 'tss' AND price_basis != 'COOPERATIVE_TENDER_AVERAGE'"),
    db.prepare("SELECT COUNT(*) AS n FROM price_observations WHERE original_variety_label IS NULL"),
    db.prepare("SELECT COUNT(*) AS n FROM market_price_observations WHERE variety_name != original_variety_name"),
    db.prepare(`SELECT source_key, commodity_code, original_variety_label AS label, COUNT(*) AS rows FROM price_observations
      WHERE variety_id IS NULL GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`),
    db.prepare(`SELECT source_key, grade_label AS label, COUNT(*) AS rows FROM price_observations
      WHERE grade_label IS NOT NULL AND grade_id IS NULL GROUP BY 1, 2 ORDER BY 1, 2`),
    db.prepare(`SELECT COUNT(DISTINCT o.market_id) AS n FROM market_price_observations o
      WHERE NOT EXISTS (SELECT 1 FROM market_commodities mc WHERE mc.market_id = o.market_id)`),
    db.prepare(`SELECT commodity_code, source_key, price_basis, COUNT(*) AS rows, SUM(published) AS published FROM price_observations
      GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`),
  ]);
  const n = (index: number) => Number((results[index].results[0] as { n?: number } | undefined)?.n ?? 0);
  const viewCounts = results[2].results as { source_table: string; n: number }[];
  const viewCount = (table: string) => viewCounts.find((row) => row.source_table === table)?.n ?? 0;
  const tables = [
    { table: "market_price_observations", base_rows: n(0), view_rows: viewCount("market_price_observations") },
    { table: "cooperative_quotes", base_rows: n(1), view_rows: viewCount("cooperative_quotes") },
  ];
  const invalid = (results[4].results as { tbl: string; n: number }[]).map((row) => ({ table: row.tbl, count: Number(row.n) }));
  const report: CommodityValidationReport = {
    generated_at: new Date().toISOString(),
    ok: false,
    tables,
    unresolved_commodity_rows: n(3),
    invalid_price_basis_rows: invalid,
    tss_rows_without_tender_basis: n(5),
    rows_missing_original_variety: n(6),
    daily_rows_variety_changed: n(7),
    unmapped_variety_labels: results[8].results as CommodityValidationReport["unmapped_variety_labels"],
    unmapped_grade_labels: results[9].results as CommodityValidationReport["unmapped_grade_labels"],
    markets_without_commodity_link: n(10),
    by_commodity_and_basis: results[11].results as CommodityValidationReport["by_commodity_and_basis"],
  };
  // Unmapped labels are reported for review but do not fail validation: original labels are always preserved.
  report.ok = tables.every((table) => table.base_rows === table.view_rows) && report.unresolved_commodity_rows === 0
    && invalid.every((row) => row.count === 0) && report.tss_rows_without_tender_basis === 0
    && report.rows_missing_original_variety === 0 && report.markets_without_commodity_link === 0;
  return report;
}

commodityRoutes.get("/admin/commodities/validation", async (c) => {
  const token = c.env.ADMIN_TOKEN;
  if (!token || c.req.header("Authorization") !== `Bearer ${token}`) return c.json({ error: "Unauthorized" }, 401);
  return c.json(await validateCommodityModel(c.env.DB));
});

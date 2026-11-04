import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./index";
import { cooperativeSeries, refreshMamcos, type CooperativeQuote } from "./cooperative";
import { refreshTss, validTssDate } from "./tss";

export const cooperativeRoutes = new Hono<Env>();
const sourceSchema = z.enum(["mamcos", "tss"]);
const authorized = (header: string | undefined, token: string | undefined) => Boolean(token && header === `Bearer ${token}`);

cooperativeRoutes.get("/cooperative/prices", async (c) => {
  const source = sourceSchema.safeParse(c.req.query("source") ?? "mamcos");
  if (!source.success) return c.json({ error: "Unsupported cooperative source." }, 400);
  const result = await c.env.DB.prepare(`SELECT id,source_key,branch,reporting_date,variety,minimum_price,maximum_price,average_price,
    price_type,price_unit,unit_status,normal_price,source_url,fetched_at,status FROM cooperative_quotes
    WHERE source_key=? AND status='verified' ORDER BY reporting_date DESC,branch,variety`)
    .bind(source.data).all<CooperativeQuote>();
  const varieties = [...new Set(result.results.map((row) => row.variety))].sort();
  const defaultVariety = source.data === "tss" ? "RASHI" : "RASHI EDI";
  const selected = c.req.query("variety") ?? (varieties.includes(defaultVariety) ? defaultVariety : varieties[0] ?? "");
  const rows = result.results.filter((row) => row.variety === selected);
  const parsedCoverage = Number(c.env.MIN_INDEX_MARKETS ?? 3);
  const coverage = Number.isInteger(parsedCoverage) && parsedCoverage >= 3 && parsedCoverage <= 100 ? parsedCoverage : 3;
  const series = cooperativeSeries(rows, coverage);
  const latestDate = rows[0]?.reporting_date ?? null;
  const latest = series.find((point) => point.reporting_date === latestDate);
  const previous = series.filter((point) => latestDate !== null && point.reporting_date < latestDate).at(-1);
  const latestByBranch = new Map<string, CooperativeQuote>();
  for (const row of rows) if (!latestByBranch.has(row.branch)) latestByBranch.set(row.branch, row);
  const fetchStatus = await c.env.DB.prepare(`SELECT source_key,started_at,finished_at,status,error_message,received_count,inserted_count
    FROM cooperative_fetches WHERE source_key=? ORDER BY started_at DESC LIMIT 1`).bind(source.data).first();
  const recentFetches = await c.env.DB.prepare(`SELECT source_url,started_at,status,error_message,received_count,excluded_count
    FROM cooperative_fetches WHERE source_key=? ORDER BY started_at DESC LIMIT ?`).bind(source.data, source.data === "tss" ? 3 : 1).all();
  const counts = await c.env.DB.prepare(`SELECT status,COUNT(*) AS count FROM cooperative_quotes
    WHERE source_key=? AND status!='superseded' GROUP BY status`).bind(source.data).all();
  return c.json({
    source: source.data, varieties, variety: selected, data: rows, latest_by_branch: [...latestByBranch.values()],
    series, latest_reporting_date: latestDate, reference_price: latest?.median_average_price ?? null,
    previous_reference_price: previous?.median_average_price ?? null,
    minimum_branch_coverage: coverage, last_fetch: fetchStatus, recent_fetches: recentFetches.results, counts: counts.results,
    methodology: source.data === "tss"
      ? "TSS reported averages (avgrate), with normal rates (norrate) preserved separately. INR/quintal is assumed, not source-confirmed. Excluded from verified-unit benchmarks. Only the exact arecanut labels RASHI, BETTE, CHALI, MURI, KOLE and ARECANUT are included; other items are archived but not published."
      : `Median of published cooperative branch averages for one exact variety and reporting date, with at least ${coverage} branches. Not the official APMC modal-price index. Branch constituents can differ between dates; changes do not imply a like-for-like market movement.`,
    availability: source.data === "tss" ? "INR/quintal — assumed, not source-confirmed. Review approval does not confirm the unit." : null,
  });
});

cooperativeRoutes.get("/admin/cooperative/quality", async (c) => {
  if (!authorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json({ error: "A valid reviewer token is required." }, 401);
  const result = await c.env.DB.prepare(`SELECT * FROM cooperative_quotes WHERE status IN ('pending','invalid')
    ORDER BY reporting_date DESC,branch,variety LIMIT 500`).all();
  return c.json({ data: result.results });
});

cooperativeRoutes.post("/admin/cooperative/refresh", async (c) => {
  if (!authorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json({ error: "A valid reviewer token is required." }, 401);
  try { return c.json(await refreshMamcos(c.env.DB)); }
  catch (error) {
    console.error("MAMCOS refresh failed", error);
    return c.json({ error: "MAMCOS refresh failed; prior records were preserved. Check source refresh status." }, 502);
  }
});

cooperativeRoutes.post("/admin/cooperative/tss/refresh", async (c) => {
  if (!authorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json({ error: "A valid reviewer token is required." }, 401);
  const input = z.object({
    date: z.string().refine(validTssDate).refine((value) => value <= new Date().toISOString().slice(0, 10)),
    accept_assumed_unit: z.literal(true),
  }).strict().safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "Provide a real reporting date no later than today (UTC) and accept_assumed_unit: true." }, 400);
  try { return c.json(await refreshTss(c.env.DB, input.data.date)); }
  catch (error) {
    console.error("TSS refresh failed", error);
    return c.json({ error: "TSS refresh incomplete. Successful locations were retained; inspect refresh status before retrying." }, 502);
  }
});

cooperativeRoutes.post("/admin/cooperative/:id/review", async (c) => {
  if (!authorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json({ error: "A valid reviewer token is required." }, 401);
  const payload = z.object({ action: z.enum(["approve", "reject"]) }).strict().safeParse(await c.req.json().catch(() => null));
  if (!payload.success) return c.json({ error: "Action must be approve or reject." }, 400);
  const row = await c.env.DB.prepare("SELECT * FROM cooperative_quotes WHERE id=? AND status IN ('pending','invalid')")
    .bind(c.req.param("id")).first<CooperativeQuote>();
  if (!row) return c.json({ error: "Pending cooperative quotation not found." }, 404);
  if (payload.data.action === "approve" && (row.status !== "pending" || row.validation_message !== null
    || row.average_price === null || row.minimum_price === null || row.maximum_price === null
    || row.minimum_price <= 0 || row.average_price < row.minimum_price || row.average_price > row.maximum_price
    || row.reporting_date > new Date().toISOString().slice(0, 10))) {
    return c.json({ error: "Invalid source quotation cannot be approved. A corrected source record is required." }, 409);
  }
  const status = payload.data.action === "approve" ? "verified" : "rejected";
  const results = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE cooperative_quotes SET status=? WHERE id=? AND status=?")
      .bind(status, row.id, row.status),
    c.env.DB.prepare(`INSERT INTO cooperative_reviews (id,quote_id,action,reviewer,reviewed_at,previous_status)
      SELECT ?,?,?,'shared-reviewer-token',?,? WHERE changes()=1`)
      .bind(crypto.randomUUID(), row.id, payload.data.action, new Date().toISOString(), row.status),
  ]);
  if (!results[0].meta.changes) return c.json({ error: "Quotation changed during review. Reload the queue." }, 409);
  return c.json({ success: true, status });
});

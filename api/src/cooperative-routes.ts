import { Hono } from "hono";
import { z } from "zod";
import { calendarTodayIST } from "../../shared/dates";
import type { Env } from "./index";
import { cooperativeConflicts, cooperativeSeries, refreshMamcos, type CooperativeQuote } from "./cooperative";
import { configuredAttempts } from "./cooperative-fetch";
import { importCooperativeCsv, importRequest, replayCooperativeSnapshot } from "./cooperative-import";
import { cooperativeSourceStatus, permissionLabel, permissionUpdate, readCooperativeSource, updateCooperativePermission } from "./cooperative-sources";
import { publishableUnit } from "./cooperative-units";
import { backfillTss, refreshTss, validTssDate } from "./tss";
import { refreshTumcos } from "./tumcos";
import { bearerMatches } from "./auth";

export const cooperativeRoutes = new Hono<Env>();
const COOPERATIVE_DEFAULT_WINDOW_DAYS = 366;
const COOPERATIVE_MAX_WINDOW_DAYS = 1096;
const COOPERATIVE_ROW_LIMIT = 5000;

const isoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const shiftDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Bounded reporting window. Default: the 366 days ending at the variety's latest verified date.
 * Headline values (latest/previous benchmark) always use the latest-anchored window so a custom
 * range never changes the reported current reference.
 */
async function cooperativeWindow(db: D1Database, source: string, commodity: string, variety: string, from?: string, to?: string) {
  if ((from && !isoDate(from)) || (to && !isoDate(to))) return { error: "Dates must use YYYY-MM-DD format." } as const;
  const latestRow = await db.prepare(`SELECT MAX(reporting_date) AS latest FROM cooperative_quotes
    WHERE source_key=? AND commodity=? AND status='verified' AND variety=?`).bind(source, commodity, variety).first<{ latest: string | null }>();
  const latest = latestRow?.latest ?? null;
  const anchor = latest ?? calendarTodayIST();
  const windowTo = to ?? (from ? shiftDays(from, COOPERATIVE_DEFAULT_WINDOW_DAYS - 1) : anchor);
  const windowFrom = from ?? shiftDays(windowTo, -(COOPERATIVE_DEFAULT_WINDOW_DAYS - 1));
  if (windowFrom > windowTo) return { error: "'from' date must not be after 'to' date." } as const;
  if ((Date.parse(windowTo) - Date.parse(windowFrom)) / 86_400_000 + 1 > COOPERATIVE_MAX_WINDOW_DAYS) {
    return { error: `Date range must not exceed ${COOPERATIVE_MAX_WINDOW_DAYS} days.` } as const;
  }
  return { from: windowFrom, to: windowTo, latest, seriesFrom: shiftDays(anchor, -(COOPERATIVE_DEFAULT_WINDOW_DAYS - 1)), seriesTo: anchor };
}
const sourceSchema = z.enum(["mamcos", "tss", "tumcos"]);
const commoditySchema = z.enum(["arecanut", "black_pepper"]);
const authorized = (header: string | undefined, token: string | undefined) => bearerMatches(header, token);
const DEFAULT_VARIETY: Record<z.infer<typeof sourceSchema>, string> = { mamcos: "RASHI EDI", tss: "RASHI", tumcos: "areca" };

cooperativeRoutes.get("/cooperative/prices", async (c) => {
  const source = sourceSchema.safeParse(c.req.query("source") ?? "mamcos");
  if (!source.success) return c.json({ error: "Unsupported cooperative source." }, 400);
  const commodity = commoditySchema.safeParse(c.req.query("commodity") ?? "arecanut");
  if (!commodity.success || (commodity.data === "black_pepper" && source.data !== "tumcos")) return c.json({ error: "Unsupported commodity for this source." }, 400);
  const varietyRows = await c.env.DB.prepare(`SELECT DISTINCT variety FROM cooperative_quotes
    WHERE source_key=? AND commodity=? AND status='verified' ORDER BY variety`).bind(source.data, commodity.data).all<{ variety: string }>();
  const varieties = varietyRows.results.map((row) => row.variety);
  const defaultVariety = DEFAULT_VARIETY[source.data];
  const selected = c.req.query("variety") ?? (varieties.includes(defaultVariety) ? defaultVariety : varieties[0] ?? "");
  const window = await cooperativeWindow(c.env.DB, source.data, commodity.data, selected, c.req.query("from"), c.req.query("to"));
  if ("error" in window) return c.json({ error: window.error }, 400);
  const limit = Number(c.req.query("limit") ?? COOPERATIVE_ROW_LIMIT);
  if (!Number.isInteger(limit) || limit < 1 || limit > COOPERATIVE_ROW_LIMIT) return c.json({ error: `limit must be 1-${COOPERATIVE_ROW_LIMIT}.` }, 400);
  const quoteColumns = `id,source_key,commodity,branch,reporting_date,variety,minimum_price,maximum_price,average_price,
    price_type,price_basis,price_unit,unit_status,normal_price,source_url,fetched_at,status`;
  const scope = "source_key=? AND commodity=? AND status='verified' AND variety=?";
  const scopeValues = [source.data, commodity.data, selected];
  const [result, seriesRows, latestRows, branchRows] = await c.env.DB.batch<CooperativeQuote & { branch: string }>([
    c.env.DB.prepare(`SELECT ${quoteColumns} FROM cooperative_quotes WHERE ${scope} AND reporting_date BETWEEN ? AND ?
      ORDER BY reporting_date DESC,branch,variety LIMIT ?`).bind(...scopeValues, window.from, window.to, limit + 1),
    // Narrow benchmark query over the latest-anchored headline window, independent of the row limit.
    c.env.DB.prepare(`SELECT source_key,commodity,variety,branch,reporting_date,average_price,unit_status,price_unit FROM cooperative_quotes
      WHERE ${scope} AND reporting_date BETWEEN ? AND ?`).bind(...scopeValues, window.seriesFrom, window.seriesTo),
    c.env.DB.prepare(`SELECT ${quoteColumns} FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY branch ORDER BY reporting_date DESC, variety) AS branch_rank
      FROM cooperative_quotes WHERE ${scope}) WHERE branch_rank = 1 ORDER BY reporting_date DESC, branch`).bind(...scopeValues),
    c.env.DB.prepare(`SELECT DISTINCT branch FROM cooperative_quotes WHERE ${scope} ORDER BY branch`).bind(...scopeValues),
  ]);
  const rows = result.results.slice(0, limit);
  const parsedCoverage = Number(c.env.MIN_INDEX_MARKETS ?? 3);
  const coverage = Number.isInteger(parsedCoverage) && parsedCoverage >= 3 && parsedCoverage <= 100 ? parsedCoverage : 3;
  const headlineSeries = cooperativeSeries(seriesRows.results, coverage);
  const series = headlineSeries.filter((point) => point.reporting_date >= window.from && point.reporting_date <= window.to);
  const latestDate = window.latest;
  const latest = headlineSeries.find((point) => point.reporting_date === latestDate);
  const previous = headlineSeries.filter((point) => latestDate !== null && point.reporting_date < latestDate).at(-1);
  const latestByBranch = latestRows.results;
  const fetchStatus = await c.env.DB.prepare(`SELECT source_key,started_at,finished_at,status,error_message,received_count,inserted_count
    FROM cooperative_fetches WHERE source_key=? AND status!='blocked' ORDER BY started_at DESC LIMIT 1`).bind(source.data).first();
  // A collection blocked by the permission gate is an operator matter, shown under Data quality rather than to readers.
  const recentFetches = await c.env.DB.prepare(`SELECT source_url,started_at,status,error_message,received_count,excluded_count
    FROM cooperative_fetches WHERE source_key=? AND status!='blocked' ORDER BY started_at DESC LIMIT ?`).bind(source.data, source.data === "tss" ? 3 : 1).all();
  const counts = await c.env.DB.prepare(`SELECT status,COUNT(*) AS count FROM cooperative_quotes
    WHERE source_key=? AND commodity=? AND status!='superseded' GROUP BY status`).bind(source.data, commodity.data).all();
  const archived = await c.env.DB.prepare(`SELECT MAX(reporting_date) AS latest FROM cooperative_quotes
    WHERE source_key=? AND commodity=? AND status IN ('pending','accepted_unit_unconfirmed','verified')`).bind(source.data, commodity.data).first<{ latest: string | null }>();
  const awaitingReview = (counts.results as { status: string; count: number }[]).filter((row) => row.status === "pending").reduce((sum, row) => sum + row.count, 0);
  const registry = await readCooperativeSource(c.env.DB, source.data);
  return c.json({
    source: source.data, commodity: commodity.data, varieties, variety: selected, data: rows, latest_by_branch: latestByBranch,
    branches: branchRows.results.map((row) => row.branch),
    window: { from: window.from, to: window.to, default_window_days: COOPERATIVE_DEFAULT_WINDOW_DAYS, max_window_days: COOPERATIVE_MAX_WINDOW_DAYS,
      row_limit: limit, truncated: result.results.length > limit },
    series, latest_reporting_date: latestDate, benchmark_reporting_date: headlineSeries.at(-1)?.reporting_date ?? null,
    source_publication_timestamp: null, reference_price: latest?.median_average_price ?? null,
    previous_reference_price: previous?.median_average_price ?? null,
    minimum_branch_coverage: coverage, benchmark_conflicts: cooperativeConflicts(seriesRows.results),
    last_fetch: fetchStatus, recent_fetches: recentFetches.results, counts: counts.results,
    publication: { published: rows.length > 0, awaiting_review_count: awaitingReview,
      blocked_reason: rows.length || !awaitingReview ? null : `${awaitingReview} quotation${awaitingReview === 1 ? " is" : "s are"} waiting for reviewer approval in Data quality.`,
      latest_archived_reporting_date: archived?.latest ?? null },
    permission: registry ? {
      status: registry.permission_status, label: permissionLabel(registry), operator: registry.operator,
      scheduled_collection_allowed: registry.scheduled_collection_allowed === 1, redistribution_allowed: registry.redistribution_allowed === 1,
      terms_checked_at: registry.terms_checked_at,
    } : null,
    methodology: source.data === "tumcos"
      ? "TUMCOS (Channagiri) publishes low, average and high values per date without a variety. Its page labels values \"kg\"; they are treated as INR/quintal by operator decision because their size is only plausible per quintal. Source records are kept unchanged. They are not APMC modal prices and are not merged with MAMCOS, TSS or AGMARKNET."
      : source.data === "tss"
      ? `TSS reported averages (avgrate), with normal rates (norrate) preserved separately. TSS publishes no unit; INR/quintal is an operator assumption. The benchmark is the median across locations for one exact variety and date, with at least ${coverage} locations. Only the exact arecanut labels RASHI, BETTE, CHALI, MURI, KOLE and ARECANUT are included; other items are archived but not published.`
      : `Median of published cooperative branch averages for one exact variety and reporting date, with at least ${coverage} branches. Not the official APMC modal-price index. Branch constituents can differ between dates; changes do not imply a like-for-like market movement.`,
    availability: source.data === "tss" ? "INR/quintal — operator assumption; TSS publishes no unit."
      : source.data === "tumcos" ? "INR/quintal — operator assumption; the source page labels values \"kg\"." : null,
  });
});

cooperativeRoutes.get("/admin/cooperative/quality", async (c) => {
  if (!authorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json({ error: "A valid reviewer token is required." }, 401);
  const source = c.req.query("source") ? sourceSchema.safeParse(c.req.query("source")) : null;
  if (source && !source.success) return c.json({ error: "Unsupported cooperative source." }, 400);
  const limit = Number(c.req.query("limit") ?? 100), offset = Number(c.req.query("offset") ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) {
    return c.json({ error: "limit must be 1-200 and offset a non-negative integer." }, 400);
  }
  const result = await c.env.DB.prepare(`SELECT id,source_key,commodity,branch,reporting_date,variety,variety_reported,minimum_price,maximum_price,
      average_price,normal_price,price_type,price_unit,source_unit_label,unit_status,lot_count,bag_count,reported_weight,session_codes,
      source_record_id,source_published_at,review_flags,ingest_mode,source_url,fetched_at,fetch_id,raw_record,validation_message,status
    FROM cooperative_quotes WHERE status IN ('pending','invalid') AND (? IS NULL OR source_key=?)
    ORDER BY reporting_date DESC,source_key,commodity,branch,variety,id LIMIT ? OFFSET ?`).bind(source?.data ?? null, source?.data ?? null, limit, offset).all();
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM cooperative_quotes WHERE status IN ('pending','invalid') AND (? IS NULL OR source_key=?)`)
    .bind(source?.data ?? null, source?.data ?? null).first<{ total: number }>();
  return c.json({ data: result.results, total: total?.total ?? 0, limit, offset });
});

cooperativeRoutes.post("/admin/cooperative/refresh", async (c) => {
  if (!authorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json({ error: "A valid reviewer token is required." }, 401);
  try { return c.json(await refreshMamcos(c.env.DB, { attempts: configuredAttempts(c.env.COOPERATIVE_FETCH_ATTEMPTS) })); }
  catch (error) {
    console.error("MAMCOS refresh failed", error);
    return c.json({ error: "MAMCOS refresh failed; prior records were preserved. Check source refresh status." }, 502);
  }
});

cooperativeRoutes.post("/admin/cooperative/tss/refresh", async (c) => {
  if (!authorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json({ error: "A valid reviewer token is required." }, 401);
  const input = z.object({
    date: z.string().refine(validTssDate).refine((value) => value <= calendarTodayIST()),
    accept_assumed_unit: z.boolean().optional(), // Accepted for older clients; the unit decision is now recorded policy.
    include_lots: z.boolean().optional(),
  }).strict().safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "Provide a real reporting date no later than today (IST)." }, 400);
  try {
    return c.json(await refreshTss(c.env.DB, input.data.date, {
      includeLots: input.data.include_lots ?? false, attempts: configuredAttempts(c.env.COOPERATIVE_FETCH_ATTEMPTS),
    }));
  }
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
    || row.reporting_date > calendarTodayIST())) {
    return c.json({ error: "Invalid source quotation cannot be approved. A corrected source record is required." }, 409);
  }
  const status = payload.data.action === "reject" ? "rejected" : publishableUnit(row) ? "verified" : "accepted_unit_unconfirmed";
  const conflict = `SELECT 1 FROM cooperative_quotes other WHERE other.id!=? AND other.source_key=? AND other.commodity=? AND other.branch=?
    AND other.reporting_date=? AND other.variety=? AND other.status='verified' AND other.average_price!=?`;
  const conflictValues = [row.id, row.source_key, row.commodity ?? "arecanut", row.branch, row.reporting_date, row.variety, row.average_price];
  // Checked inside the UPDATE so two concurrent approvals cannot both publish different prices for one branch and date.
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE cooperative_quotes SET status=? WHERE id=? AND status=? AND (?!='verified' OR NOT EXISTS (${conflict}))`)
      .bind(status, row.id, row.status, status, ...conflictValues),
    c.env.DB.prepare(`INSERT INTO cooperative_reviews (id,quote_id,action,reviewer,reviewed_at,previous_status,new_status)
      SELECT ?,?,?,'shared-reviewer-token',?,?,? WHERE changes()=1`)
      .bind(crypto.randomUUID(), row.id, payload.data.action, new Date().toISOString(), row.status, status),
  ]);
  if (!results[0].meta.changes) {
    const conflicted = status === "verified" && await c.env.DB.prepare(conflict).bind(...conflictValues).first();
    return c.json({ error: conflicted
      ? "A different verified price already exists for this branch, date and variety. Reject this quotation or resolve the source conflict first."
      : "Quotation changed during review. Reload the queue." }, 409);
  }
  return c.json({ success: true, status, published: status === "verified",
    note: status === "accepted_unit_unconfirmed" ? "Accepted as a source record, but the unit is unconfirmed, so it is not published as a verified price." : null });
});

const reviewerRequired = { error: "A valid reviewer token is required." };
const failureMessage = (error: unknown) => error instanceof Error ? error.message.slice(0, 500) : "Unknown failure";

cooperativeRoutes.post("/admin/cooperative/tumcos/refresh", async (c) => {
  if (!authorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json(reviewerRequired, 401);
  const input = z.object({ scope: z.enum(["recent", "full_history"]).default("recent") }).strict().safeParse(await c.req.json().catch(() => ({})));
  if (!input.success) return c.json({ error: "scope must be recent or full_history." }, 400);
  try { return c.json(await refreshTumcos(c.env.DB, { scope: input.data.scope, attempts: configuredAttempts(c.env.COOPERATIVE_FETCH_ATTEMPTS) })); }
  catch (error) {
    console.error("TUMCOS refresh failed", error);
    return c.json({ error: `TUMCOS refresh failed; prior records were preserved. Reason: ${failureMessage(error)}` }, 502);
  }
});

cooperativeRoutes.post("/admin/cooperative/tss/backfill", async (c) => {
  if (!authorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json(reviewerRequired, 401);
  const input = z.object({
    start: z.string().refine(validTssDate), end: z.string().refine(validTssDate).refine((value) => value <= calendarTodayIST()),
    accept_assumed_unit: z.boolean().optional(),
  }).strict().safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "Provide start and end dates (end no later than today IST)." }, 400);
  try { return c.json(await backfillTss(c.env.DB, input.data.start, input.data.end, { attempts: configuredAttempts(c.env.COOPERATIVE_FETCH_ATTEMPTS, 2) })); }
  catch (error) { return c.json({ error: failureMessage(error) }, 400); }
});

cooperativeRoutes.post("/admin/cooperative/import", async (c) => {
  if (!authorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json(reviewerRequired, 401);
  const input = importRequest.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "Provide source, csv, authorized_by, permission_reference and attestation: true.", issues: input.error.issues.map((issue) => issue.message) }, 400);
  try { return c.json(await importCooperativeCsv(c.env.DB, input.data)); }
  catch (error) { return c.json({ error: `CSV import rejected: ${failureMessage(error)}` }, 400); }
});

cooperativeRoutes.post("/admin/cooperative/replay/:fetchId", async (c) => {
  if (!authorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json(reviewerRequired, 401);
  const input = z.object({ scope: z.enum(["recent", "full_history"]).optional() }).strict().safeParse(await c.req.json().catch(() => ({})));
  if (!input.success) return c.json({ error: "scope must be recent or full_history." }, 400);
  try { return c.json(await replayCooperativeSnapshot(c.env.DB, c.req.param("fetchId"), { ...input.data, archive: c.env.ARCHIVE })); }
  catch (error) { return c.json({ error: `Snapshot replay failed: ${failureMessage(error)}` }, 422); }
});

cooperativeRoutes.get("/admin/cooperative/sources", async (c) => {
  if (!authorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json(reviewerRequired, 401);
  return c.json(await cooperativeSourceStatus(c.env.DB));
});

cooperativeRoutes.post("/admin/cooperative/sources/:key/permission", async (c) => {
  if (!authorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json(reviewerRequired, 401);
  const key = sourceSchema.safeParse(c.req.param("key"));
  const input = permissionUpdate.safeParse(await c.req.json().catch(() => null));
  if (!key.success) return c.json({ error: "Unsupported cooperative source." }, 400);
  if (!input.success) return c.json({ error: "Invalid permission record.", issues: input.error.issues.map((issue) => issue.message) }, 400);
  return c.json(await updateCooperativePermission(c.env.DB, key.data, input.data));
});

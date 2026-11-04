import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./index";
import { DASD_SOURCES, SIRSI_WEATHER_URL, PIB_RELEASES, DASD_NEWS_URL, parseDasd, pdfItemSchema, parseWeather, parsePib, parsePibExport, parseDasdNews, validDay } from "./intelligence-sources";

const routes = new Hono<Env>();
routes.use("/admin/intelligence/*", async (c, next) => {
  if (!c.env.ADMIN_TOKEN || c.req.header("Authorization") !== `Bearer ${c.env.ADMIN_TOKEN}`) return c.json({ error: "A valid reviewer token is required." }, 401);
  await next();
});
const latestCapture = "c.id=(SELECT id FROM intelligence_captures newer WHERE newer.source_key=c.source_key ORDER BY newer.fetched_at DESC,newer.rowid DESC LIMIT 1)";
export async function hashText(raw: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
type Capture = { source: string; domain: string; url: string; raw: string; type: string; publication: string | null; extraction?: string };
async function captureStatements(db: D1Database, value: Capture, rows: number) {
  const id = crypto.randomUUID(), fetched = new Date().toISOString();
  const statement = db.prepare(`INSERT INTO intelligence_captures
    (id,source_key,domain,source_url,fetched_at,publication_period,media_type,raw_payload,extraction_json,content_hash,row_count)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id, value.source, value.domain, value.url, fetched, value.publication, value.type, value.raw,
      value.extraction ?? null, await hashText(value.raw), rows);
  return { id, fetched, statement };
}
async function runSource(db: D1Database, source: string, operation: () => Promise<{ capture_id: string; count: number }>) {
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO intelligence_refresh_runs(id,source_key,started_at,status) VALUES(?,?,?,'running')").bind(id, source, new Date().toISOString()).run();
  try {
    const result = await operation();
    await db.prepare("UPDATE intelligence_refresh_runs SET status='succeeded',finished_at=?,capture_id=? WHERE id=?")
      .bind(new Date().toISOString(), result.capture_id, id).run();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Source refresh failed.";
    await db.prepare("UPDATE intelligence_refresh_runs SET status='failed',finished_at=?,error_message=? WHERE id=?")
      .bind(new Date().toISOString(), message, id).run();
    throw error;
  }
}
async function fetchText(url: string, type: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000), redirect: "manual", headers: { Accept: type } });
  if (!response.ok) throw new Error(`Publisher returned HTTP ${response.status}.`);
  const text = await response.text();
  if (text.length > 1_500_000) throw new Error("Source exceeds supported capture size.");
  return text;
}
export async function refreshSirsiWeather(db: D1Database) {
  return runSource(db, "sirsi_weather", async () => {
    const raw = await fetchText(SIRSI_WEATHER_URL, "application/json");
    const weather = parseWeather(JSON.parse(raw), new Date().toISOString());
    const capture = await captureStatements(db, { source: "sirsi_weather", domain: "weather", url: SIRSI_WEATHER_URL, raw, type: "application/json", publication: null }, weather.rows.length);
    await db.batch([capture.statement, ...weather.rows.map((row) => db.prepare(`INSERT INTO weather_records VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind(capture.id, row.date, row.kind, row.maximum, row.minimum, row.rain, weather.latitude, weather.longitude, weather.elevation))]);
    return { capture_id: capture.id, count: weather.rows.length };
  });
}
export async function refreshPib(db: D1Database) {
  const results: { release_id: string; capture_id: string; count: number }[] = [], failures: string[] = [];
  for (const id of PIB_RELEASES) {
    try {
      const result = await runSource(db, `pib_${id}`, async () => {
        const url = `https://www.pib.gov.in/PressReleasePage.aspx?PRID=${id}&reg=3&lang=1`;
        const raw = await fetchText(url, "text/html");
        const release = parsePib(raw, id), exported = id === "2159561" ? parsePibExport(raw) : null;
        if (id === "2159561" && !exported) throw new Error("PIB annual export quantity/value sentence changed or is missing; review the source format.");
        const capture = await captureStatements(db, { source: `pib_${id}`, domain: "news", url, raw, type: "text/html", publication: release.published }, 1);
        const statements = [capture.statement, db.prepare("INSERT INTO intelligence_bulletins VALUES(?,?,?,?,?)")
          .bind(capture.id, id, release.title, release.published, release.is_policy ? 1 : 0)];
        if (exported) statements.push(db.prepare("INSERT INTO trade_records(capture_id,partner,period,quantity_tonnes,value_inr_lakh,direction) VALUES(?,'All destinations',?,?,?,'Export')")
          .bind(capture.id, exported.period, exported.quantity, exported.value_lakh));
        await db.batch(statements);
        return { capture_id: capture.id, count: 1 };
      });
      results.push({ release_id: id, ...result });
    } catch (error) { failures.push(`${id}: ${error instanceof Error ? error.message : "Source failed."}`); }
  }
  try {
    const result = await runSource(db, "dasd_news", async () => {
      const raw = await fetchText(DASD_NEWS_URL, "text/html"), article = parseDasdNews(raw);
      const capture = await captureStatements(db, { source: "dasd_news", domain: "news", url: DASD_NEWS_URL, raw, type: "text/html", publication: article.published }, 1);
      await db.batch([capture.statement, db.prepare("INSERT INTO intelligence_bulletins VALUES(?,?,?,?,0)").bind(capture.id, "dasd-2025-26-estimates", article.title, article.published)]);
      return { capture_id: capture.id, count: 1 };
    });
    results.push({ release_id: "dasd-2025-26-estimates", ...result });
  } catch (error) { failures.push(`DASD: ${error instanceof Error ? error.message : "Source failed."}`); }
  return { results, failures };
}
routes.post("/admin/intelligence/dasd", async (c) => {
  const input = z.object({ source: z.enum(["production_history", "production_latest", "trade_imports"]),
    pdf_base64: z.string().min(20).max(950_000).regex(/^[A-Za-z0-9+/]+={0,2}$/), items: z.array(pdfItemSchema).min(20).max(3000) }).strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "Provide a supported DASD PDF and its positioned text extraction." }, 400);
  const { source, pdf_base64, items } = input.data;
  if (!pdf_base64.startsWith("JVBERi0")) return c.json({ error: "Original archive is not a PDF." }, 400);
  try {
    const result = await runSource(c.env.DB, source, async () => {
      const parsed = parseDasd(source, items), config = DASD_SOURCES[source];
      const capture = await captureStatements(c.env.DB, { source, domain: parsed.domain, url: config.url, raw: pdf_base64,
        type: "application/pdf;base64", publication: parsed.publication_period, extraction: JSON.stringify(items) }, parsed.rows.length);
      const statements = parsed.domain === "production" ? parsed.rows.map((row) => c.env.DB.prepare("INSERT INTO production_records VALUES(?,?,?,?,?,?,?)")
        .bind(capture.id, row.geography, row.period, row.estimate_status, row.area, row.production, row.yield))
        : parsed.rows.map((row) => c.env.DB.prepare("INSERT INTO trade_records(capture_id,partner,period,quantity_tonnes,value_inr_lakh) VALUES(?,?,?,?,?)").bind(capture.id, row.partner, row.period, row.quantity, row.value));
      await c.env.DB.batch([capture.statement, ...statements]);
      return { capture_id: capture.id, count: parsed.rows.length };
    });
    return c.json(result, 201);
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : "DASD import failed." }, 422); }
});
routes.post("/admin/intelligence/weather/refresh", async (c) => {
  try { return c.json(await refreshSirsiWeather(c.env.DB), 201); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "Weather refresh failed." }, 502); }
});
routes.post("/admin/intelligence/news/refresh", async (c) => {
  const result = await refreshPib(c.env.DB);
  return result.failures.length ? c.json({ ...result, error: result.failures.join("; ") }, 502) : c.json(result, 201);
});
routes.get("/intelligence/:domain", async (c) => {
  const domain = c.req.param("domain");
  if (!["production", "trade", "weather", "news", "policy"].includes(domain)) return c.json({ error: "Unsupported intelligence domain." }, 400);
  const select = `c.id AS capture_id,c.source_key,c.source_url,c.fetched_at,c.publication_period,c.content_hash`;
  let sql: string;
  if (domain === "production") sql = `SELECT p.*,${select} FROM production_records p JOIN intelligence_captures c ON c.id=p.capture_id
    WHERE ${latestCapture} AND (c.source_key='production_latest' OR p.period<'2024-25'
      OR NOT EXISTS(SELECT 1 FROM intelligence_captures WHERE source_key='production_latest')) ORDER BY p.period DESC,p.geography`;
  else if (domain === "trade") sql = `SELECT t.*,${select} FROM trade_records t JOIN intelligence_captures c ON c.id=t.capture_id WHERE ${latestCapture} ORDER BY t.period DESC,t.partner`;
  else if (domain === "weather") sql = `SELECT w.*,${select} FROM weather_records w JOIN intelligence_captures c ON c.id=w.capture_id WHERE ${latestCapture} ORDER BY w.date`;
  else sql = `SELECT b.*,${select} FROM intelligence_bulletins b JOIN intelligence_captures c ON c.id=b.capture_id WHERE ${latestCapture}${domain === "policy" ? " AND b.is_policy=1" : ""} ORDER BY b.published_on DESC`;
  const data = await c.env.DB.prepare(sql).all();
  const sourceKeys = domain === "production" ? ["production_history", "production_latest"] : domain === "trade" ? ["trade_imports", "pib_2159561"] : domain === "weather" ? ["sirsi_weather"] : [...PIB_RELEASES.map((id) => `pib_${id}`), "dasd_news"];
  const runs = await c.env.DB.prepare(`SELECT * FROM intelligence_refresh_runs WHERE source_key IN (${sourceKeys.map(() => "?").join(",")}) ORDER BY started_at DESC LIMIT 20`).bind(...sourceKeys).all();
  return c.json({ domain, data: data.results, attempts: runs.results,
    coverage: domain === "trade" ? "India imports: selected named partners plus published total including others (DASD/Department of Commerce). Exports: one annual aggregate from PIB, value converted from INR crore to lakh (×100); not a continuous export series. No HS-code split is supplied. Null partner cells are not zero; totals include unlisted partners."
      : domain === "weather" ? "Sirsi town reference 14.6195, 74.8354. Open-Meteo gridded model output, not a farm sensor or observed weather station. Historical model days are not verified observations. API fetch time is not a model issuance timestamp."
      : domain === "production" ? "Annual DASD state/national estimates; source units retained. Historical table does not specify estimate status. Latest table labels 2024-25 Final and 2025-26 Second advance. Missing cells remain null."
      : "Curated official PIB releases and DASD announcements only, not a comprehensive or live news feed. Historical policy notices describe the position on publication date, not necessarily today's law. No inferred sentiment, price impact or health endorsement.",
  });
});
routes.get("/intelligence/captures/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT raw_payload,media_type FROM intelligence_captures WHERE id=?").bind(c.req.param("id")).first<{ raw_payload: string; media_type: string }>();
  if (!row) return c.json({ error: "Source capture not found." }, 404);
  if (row.media_type === "application/pdf;base64") {
    const bytes = Uint8Array.from(atob(row.raw_payload), (char) => char.charCodeAt(0));
    return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="dasd-report.pdf"' } });
  }
  return new Response(row.raw_payload, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": 'attachment; filename="source-capture.txt"', "X-Content-Type-Options": "nosniff" } });
});

const qualitySchema = z.object({
  lot_id: z.string().trim().min(1).max(120), variety: z.string().trim().min(1).max(160), location: z.string().trim().min(1).max(160),
  sampled_on: z.string().refine(validDay), reported_on: z.string().refine(validDay), laboratory: z.string().trim().min(1).max(160),
  report_reference: z.string().trim().min(1).max(160), evidence_url: z.string().url().max(1000).refine((value) => value.startsWith("https://")),
  moisture_percent: z.number().finite().min(0).max(100).nullable(), defects_percent: z.number().finite().min(0).max(100).nullable(),
  notes: z.string().trim().min(1).max(2000),
}).strict().refine((row) => row.sampled_on <= row.reported_on && row.reported_on <= new Date().toISOString().slice(0, 10)
  && (row.moisture_percent !== null || row.defects_percent !== null));
routes.get("/intelligence/quality/records", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM quality_inspections WHERE status='verified' ORDER BY reported_on DESC,id LIMIT 500`).all();
  return c.json({ data: rows.results, limit: 500, coverage: "Lot-specific, reviewer-checked inspection reports only. Moisture and defects are independent measurements; no automatic grade, safety verdict, price premium or forecast is inferred. No report supplied yet means no measured results." });
});
routes.get("/admin/intelligence/quality", async (c) => {
  return c.json({ data: (await c.env.DB.prepare("SELECT * FROM quality_inspections ORDER BY submitted_at DESC,id LIMIT 500").all()).results });
});
routes.post("/admin/intelligence/quality", async (c) => {
  const input = qualitySchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "Provide real lot/report identifiers, HTTPS evidence, valid sampling/report dates and at least one measured percentage (0–100)." }, 400);
  const row = input.data;
  const prior = await c.env.DB.prepare("SELECT id FROM quality_inspections WHERE laboratory=? AND report_reference=? AND lot_id=? AND status!='superseded'")
    .bind(row.laboratory, row.report_reference, row.lot_id).first();
  if (prior) return c.json({ error: "This lot/report already exists. Submit a separately identified corrected laboratory report; existing evidence is not overwritten." }, 409);
  const id = crypto.randomUUID();
  const inserted = await c.env.DB.prepare(`INSERT INTO quality_inspections
    (id,lot_id,variety,location,sampled_on,reported_on,laboratory,report_reference,evidence_url,moisture_percent,defects_percent,notes,submitted_at,status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending') ON CONFLICT DO NOTHING`).bind(id, row.lot_id, row.variety, row.location, row.sampled_on, row.reported_on, row.laboratory,
      row.report_reference, row.evidence_url, row.moisture_percent, row.defects_percent, row.notes, new Date().toISOString()).run();
  if (!inserted.meta.changes) return c.json({ error: "This lot/report was submitted concurrently. Reload the inspection queue." }, 409);
  return c.json({ id, status: "pending" }, 201);
});
routes.post("/admin/intelligence/quality/:id/review", async (c) => {
  const input = z.object({ action: z.enum(["verify", "reject"]), note: z.string().trim().min(1).max(1000) }).strict().safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "Choose verify/reject and record the evidence review note." }, 400);
  const result = await c.env.DB.prepare("UPDATE quality_inspections SET status=?,review_note=?,reviewed_at=? WHERE id=? AND status='pending'")
    .bind(input.data.action === "verify" ? "verified" : "rejected", input.data.note, new Date().toISOString(), c.req.param("id")).run();
  if (!result.meta.changes) return c.json({ error: "Pending report not found or already reviewed." }, 409);
  return c.json({ success: true });
});
export { routes as intelligenceRoutes };

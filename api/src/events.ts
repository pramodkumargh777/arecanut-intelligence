import { Hono } from "hono";
import type { Env } from "./env";
import { bearerMatches } from "./auth";

const events = new Hono<Env>();
const allowedEvents = new Set(["page_view", "variety_save", "share_click", "channel_join_click", "return_visit"]);
const safeText = (v: unknown, max = 120) => typeof v === "string" ? v.trim().slice(0,max) : null;

events.post("/events", async (c) => {
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  const event = safeText(body.event, 40);
  if (!event || !allowedEvents.has(event)) return c.json({ error: "Invalid event" }, 400);
  const anonymousId = safeText(body.anonymous_id, 64);
  if (anonymousId && !/^[a-zA-Z0-9_-]{16,64}$/.test(anonymousId)) return c.json({ error: "Invalid anonymous id" }, 400);
  const page = safeText(body.page_path, 300);
  const pageType = safeText(body.page_type, 60);
  const variety = safeText(body.variety_key, 80);
  const channel = safeText(body.channel, 60);
  const utm = body.utm && typeof body.utm === "object" ? body.utm as Record<string, unknown> : {};
  await c.env.DB.prepare(`INSERT INTO anonymous_events
    (event_name,page_path,page_type,variety_key,channel,anonymous_id,utm_source,utm_medium,utm_campaign,utm_content,utm_term)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(event,page,pageType,variety,channel,anonymousId,
      safeText(utm.source,120),safeText(utm.medium,120),safeText(utm.campaign,160),safeText(utm.content,160),safeText(utm.term,160)).run();
  return c.json({ ok: true }, 202);
});

events.get("/admin/analytics", async (c) => {
  if (!bearerMatches(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json({error:"Unauthorized"},401);
  const days = Math.min(90,Math.max(1,Number(c.req.query("days")||30)));
  if (!Number.isInteger(days)) return c.json({error:"Invalid period"},400);
  const since = `datetime('now', '-' || ? || ' days')`;
  const [summary, trend, features, varieties, acquisition, recent] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT COUNT(*) events, COUNT(DISTINCT anonymous_id) visitors,
      COUNT(DISTINCT CASE WHEN event_name='page_view' THEN anonymous_id END) page_visitors,
      COUNT(DISTINCT CASE WHEN event_name='return_visit' THEN anonymous_id END) returning,
      SUM(CASE WHEN event_name='page_view' THEN 1 ELSE 0 END) page_views
      FROM anonymous_events WHERE created_at >= ${since}`).bind(days),
    c.env.DB.prepare(`SELECT date(created_at) date,COUNT(*) events,COUNT(DISTINCT anonymous_id) visitors,
      SUM(CASE WHEN event_name='page_view' THEN 1 ELSE 0 END) page_views
      FROM anonymous_events WHERE created_at >= ${since} GROUP BY date(created_at) ORDER BY date`).bind(days),
    c.env.DB.prepare(`SELECT event_name,COUNT(*) count FROM anonymous_events WHERE created_at >= ${since}
      GROUP BY event_name ORDER BY count DESC`).bind(days),
    c.env.DB.prepare(`SELECT variety_key,COUNT(*) count FROM anonymous_events WHERE event_name='variety_save'
      AND created_at >= ${since} AND variety_key IS NOT NULL GROUP BY variety_key ORDER BY count DESC LIMIT 20`).bind(days),
    c.env.DB.prepare(`SELECT COALESCE(utm_source,'direct') source,COALESCE(utm_medium,'(none)') medium,
      COALESCE(utm_campaign,'(none)') campaign,COUNT(*) events,COUNT(DISTINCT anonymous_id) visitors
      FROM anonymous_events WHERE created_at >= ${since} GROUP BY source,medium,campaign ORDER BY visitors DESC LIMIT 30`).bind(days),
    c.env.DB.prepare(`SELECT event_name,page_path,page_type,variety_key,channel,utm_source,utm_medium,utm_campaign,created_at
      FROM anonymous_events WHERE created_at >= ${since} ORDER BY created_at DESC LIMIT 50`).bind(days)
  ]);
  return c.json({days,summary:summary.results[0],trend:trend.results,features:features.results,varieties:varieties.results,acquisition:acquisition.results,recent:recent.results});
});
export { events };

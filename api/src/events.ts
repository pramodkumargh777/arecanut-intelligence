import { Hono } from "hono";
import type { Env } from "./env";

const events = new Hono<Env>();
const allowedEvents = new Set(["page_view", "variety_save", "share_click", "channel_join_click", "return_visit"]);
const safeText = (v: unknown, max = 120) => typeof v === "string" ? v.trim().slice(0,max) : null;

events.post("/events", async (c) => {
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  const event = safeText(body.event, 40);
  if (!event || !allowedEvents.has(event)) return c.json({ error: "Invalid event" }, 400);
  const session = safeText(body.anonymous_id, 64);
  if (session && !/^[a-zA-Z0-9_-]{16,64}$/.test(session)) return c.json({ error: "Invalid session" }, 400);
  const page = safeText(body.page_path, 300);
  const pageType = safeText(body.page_type, 60);
  const variety = safeText(body.variety_key, 80);
  const channel = safeText(body.channel, 60);
  const utm = body.utm && typeof body.utm === "object" ? body.utm as Record<string, unknown> : {};
  await c.env.DB.prepare(`INSERT INTO anonymous_events
    (event_name,page_path,page_type,variety_key,channel,session_id,utm_source,utm_medium,utm_campaign,utm_content,utm_term)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(event,page,pageType,variety,channel,session,
      safeText(utm.source,120),safeText(utm.medium,120),safeText(utm.campaign,160),safeText(utm.content,160),safeText(utm.term,160)).run();
  return c.json({ ok: true }, 202);
});
export { events };

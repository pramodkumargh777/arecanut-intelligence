import { Hono } from "hono";
import { cors } from "hono/cors";
import { cooperativeRoutes } from "./cooperative-routes";
import { historyRoutes } from "./history";
import { decisionRoutes } from "./decisions";
import { intelligenceRoutes } from "./intelligence-routes";
import { forecastRoutes } from "./forecast";
import { commodityRoutes } from "./commodity-routes";
import { sourceStatusRoutes } from "./source-status";
import { agmarknetHistoryRoutes } from "./agmarknet-history";
import { agmarknetV2ArrivalRoutes } from "./agmarknet-v2-arrivals";
import { dailyArrivalRoutes } from "./daily-arrivals";
import { operationsRoutes } from "./operations-routes";
import { forecastingRoutes } from "./forecasting";
import { supplyRoutes } from "./supply-routes";
import { createAssistantRoutes } from "./assistant/routes";
import type { Env } from "./env";
import { marketRoutes } from "./market-routes";
import { events } from "./events";
import { EVENING_CRON, scheduled } from "./scheduled";

/**
 * Worker entry: CORS, error handling and route mounting. Market price routes live in market-routes.ts and the cron
 * handler in scheduled.ts. Mount order matters: Hono matches routes in registration order.
 */
export type { Env };

const app = new Hono<Env>().basePath("/api/v1");
app.use("*", async (c, next) => {
  const allowedOrigins = (c.env.CORS_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return cors({ origin: allowedOrigins, allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type", "Authorization"] })(c, next);
});

app.onError((error, c) => {
  console.error("ANI API error", error);
  return c.json({ error: "The request could not be completed." }, 500);
});

app.get("/health", (c) => c.json({ status: "ok", service: "ani-market-api" }));
app.route("/", cooperativeRoutes);
app.route("/", historyRoutes);
app.route("/", decisionRoutes);
app.route("/", sourceStatusRoutes);
app.route("/", agmarknetHistoryRoutes);
app.route("/", agmarknetV2ArrivalRoutes);
app.route("/", dailyArrivalRoutes);
app.route("/", intelligenceRoutes);
app.route("/", forecastRoutes);
app.route("/", forecastingRoutes);
app.route("/", commodityRoutes);
app.route("/", operationsRoutes);
app.route("/", supplyRoutes);
// Tools call existing public endpoints in-process, so the assistant reads exactly what the UI reads.
app.route("/", createAssistantRoutes((path, init, env) => Promise.resolve(app.request(`/api/v1${path}`, init, env))));
app.route("/", marketRoutes);
app.route("/", events);

export { EVENING_CRON };

export default {
  fetch: app.fetch,
  scheduled,
};

export { app };

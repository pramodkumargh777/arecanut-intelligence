import { previousMonth, refreshMonthly } from "./monthly";
import { MAMCOS_URL, refreshMamcos } from "./cooperative";
import { configuredAttempts } from "./cooperative-fetch";
import { readCooperativeSource, recordBlockedFetch, schedulingDecision } from "./cooperative-sources";
import { refreshTss } from "./tss";
import { refreshTumcos, TUMCOS_URL } from "./tumcos";
import { refreshTms, TMS_PORTAL_URL } from "./tms";
import { calendarDateToTime, calendarTodayIST, DAY_MS } from "../../shared/dates";
import { refreshSirsiWeather, refreshPib } from "./intelligence-routes";
import { AUTO_REJECT_AFTER_DAYS, autoPublishPending } from "./cooperative-auto-publish";
import { refreshChangedForecasts } from "./forecast";
import { autoRejectStaleFlagged, autoVerifyPendingDaily, OBSERVATION_AUTO_REJECT_DAYS } from "./auto-verify";
import { refreshAllDirtySummaries } from "./summaries";
import { logOperationalError, purgeExpiredTemporary, syncArchive } from "./archive";
import { reconcileForecastOutcomes } from "./forecasting";
import { referenceState, type Env } from "./env";

/** 20:00 IST, after the day's tenders. Collects cooperative rates only; the 09:00 IST run does everything else. */
export const EVENING_CRON = "30 14 * * *";

/** Cron handler for the wrangler.toml triggers: 09:00 IST runs every refresh, EVENING_CRON only cooperative rates. */
export async function scheduled(event: ScheduledEvent, env: Env["Bindings"], _ctx: ExecutionContext) {
  const now = new Date();
  const errors: unknown[] = [];
  const evening = event.cron === EVENING_CRON;
  if (!evening && env.INTELLIGENCE_SCHEDULE_ENABLED === "true") {
    if (env.OPEN_METEO_ENABLED !== "false") {
      try { await refreshSirsiWeather(env.DB); }
      catch (error) { console.error("Scheduled Sirsi weather refresh failed", error); errors.push(error); }
    }
    try {
      const result = await refreshPib(env.DB);
      if (result.failures.length) throw new Error(result.failures.join("; "));
    } catch (error) { console.error("Scheduled official bulletin refresh failed", error); errors.push(error); }
  }
  const attempts = configuredAttempts(env.COOPERATIVE_FETCH_ATTEMPTS);
  // TSS is requested by date. At 09:00 IST today's tenders have not happened, so the morning run closes out yesterday.
  const today = calendarTodayIST(now);
  const tssDate = evening ? today : new Date(calendarDateToTime(today) - DAY_MS).toISOString().slice(0, 10);
  const cooperative = [
    { key: "mamcos" as const, flag: env.MAMCOS_SCHEDULE_ENABLED, url: MAMCOS_URL, run: () => refreshMamcos(env.DB, { mode: "scheduled", attempts }) },
    { key: "tss" as const, flag: env.TSS_SCHEDULE_ENABLED, url: "https://webapi.tssindia.in/getrateshomepage",
      run: () => refreshTss(env.DB, tssDate, { mode: "scheduled", attempts }) },
    { key: "tumcos" as const, flag: env.TUMCOS_SCHEDULE_ENABLED, url: TUMCOS_URL, run: () => refreshTumcos(env.DB, { mode: "scheduled", scope: "recent", attempts }) },
    // TMS answers with the latest tender day on or before the date asked, so today covers both runs: the morning
    // run records yesterday's tender and the evening run today's.
    { key: "tms" as const, flag: env.TMS_SCHEDULE_ENABLED, url: TMS_PORTAL_URL, run: () => refreshTms(env.DB, today, { mode: "scheduled", attempts }) },
  ];
  for (const source of cooperative) {
    if (source.flag !== "true") continue;
    try {
      const decision = schedulingDecision(await readCooperativeSource(env.DB, source.key), true);
      if (!decision.allowed) {
        console.warn(`Scheduled ${source.key} collection skipped: ${decision.reason}`);
        await recordBlockedFetch(env.DB, source.key, source.url, decision.reason);
        continue;
      }
      await source.run();
    } catch (error) { console.error(`Scheduled ${source.key} refresh failed`, error); errors.push(error); }
    if (env.COOPERATIVE_AUTO_PUBLISH !== "true") continue;
    // Also runs after a partial failure, so rows from locations that succeeded still reach readers.
    try {
      const { published, held, rejected } = await autoPublishPending(env.DB, source.key, now);
      if (published || held.length || rejected) console.log(`${source.key}: ${published} auto-published, ${held.length} held, ${rejected} rejected after ${AUTO_REJECT_AFTER_DAYS} days held`, held.slice(0, 5));
    } catch (error) { console.error(`Scheduled ${source.key} auto-publish failed`, error); errors.push(error); }
  }
  if (evening) {
    try { await refreshAllDirtySummaries(env.DB); }
    catch (error) { await logOperationalError(env.DB, "summary_cache", null, error instanceof Error ? error.message : String(error)); }
    for (const error of errors) await logOperationalError(env.DB, "scheduled", null, error instanceof Error ? error.message : String(error));
    if (errors.length) throw new AggregateError(errors, "Source refresh schedule failed.");
    return;
  }
  for (const offset of [2, 1]) {
    try {
      await refreshMonthly(env.DB, previousMonth(now, offset), referenceState(env));
    } catch (error) {
      console.error("Scheduled monthly refresh failed", error);
      errors.push(error);
    }
  }
  // Catches current-daily rows imported before auto-verification was on, or by an import that failed part-way.
  if (env.AGMARKNET_DAILY_AUTO_VERIFY === "true") {
    try {
      const verified = await autoVerifyPendingDaily(env.DB);
      if (verified) console.log(`AGMARKNET daily: ${verified} pending row(s) auto-verified`);
    } catch (error) { console.error("Scheduled AGMARKNET daily auto-verification failed", error); errors.push(error); }
    try {
      const rejected = await autoRejectStaleFlagged(env.DB);
      if (rejected) console.log(`AGMARKNET: ${rejected} flagged row(s) rejected after waiting ${OBSERVATION_AUTO_REJECT_DAYS} days`);
    } catch (error) { console.error("Scheduled rejection of stale flagged rows failed", error); errors.push(error); }
  }
  // Derived-cache and archive maintenance never fail the source schedule; failures are persisted for operators.
  const maintenance: [string, unknown][] = [];
  try {
    await refreshAllDirtySummaries(env.DB);
  } catch (error) { maintenance.push(["summary_cache", error]); }
  try {
    await reconcileForecastOutcomes(env.DB);
  } catch (error) { maintenance.push(["forecasting", error]); }
  try {
    await refreshChangedForecasts(env.DB, now);
  } catch (error) { maintenance.push(["forecasting", error]); }
  if (env.ARCHIVE_SCHEDULE_ENABLED === "true") {
    try {
      const archive = await syncArchive(env, { limit: 5 });
      if (archive.errors.length) console.warn("Archive sync reported issues", archive.errors);
      const purge = await purgeExpiredTemporary(env);
      if (purge.errors.length) console.warn("Temporary retention purge reported issues", purge.errors);
    } catch (error) { maintenance.push(["archive", error]); }
  }
  for (const [component, error] of maintenance) {
    console.error(`Scheduled ${component} maintenance failed`, error);
    // The error-log component CHECK predates forecasting, so reconciliation failures are logged under "scheduled".
    const logged = component === "forecasting" ? "scheduled" : component as "summary_cache" | "archive";
    await logOperationalError(env.DB, logged, component === "forecasting" ? "forecasting" : null, error instanceof Error ? error.message : String(error));
  }
  for (const error of errors) {
    await logOperationalError(env.DB, "scheduled", null, error instanceof Error ? error.message : String(error));
  }
  if (errors.length) throw new AggregateError(errors, "Source refresh schedule failed.");
}

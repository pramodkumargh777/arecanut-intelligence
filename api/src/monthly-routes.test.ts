import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { app, EVENING_CRON, type Env } from "./index";
import { refreshMonthly } from "./monthly";
import { refreshMamcos } from "./cooperative";
import { autoPublishPending } from "./cooperative-auto-publish";
import { readCooperativeSource, recordBlockedFetch, type CooperativeSourceRecord } from "./cooperative-sources";
import { refreshChangedForecasts } from "./forecast";
import { refreshTss } from "./tss";

vi.mock("./tss", async (importOriginal) => ({
  ...await importOriginal<typeof import("./tss")>(),
  refreshTss: vi.fn(),
}));
vi.mock("./cooperative-auto-publish", () => ({ autoPublishPending: vi.fn() }));
vi.mock("./forecast", async (importOriginal) => ({
  ...await importOriginal<typeof import("./forecast")>(),
  refreshChangedForecasts: vi.fn(),
}));

vi.mock("./monthly", async (importOriginal) => ({
  ...await importOriginal<typeof import("./monthly")>(),
  refreshMonthly: vi.fn(),
}));
vi.mock("./cooperative", async (importOriginal) => ({
  ...await importOriginal<typeof import("./cooperative")>(),
  refreshMamcos: vi.fn(),
}));
vi.mock("./summaries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./summaries")>()),
  refreshAllDirtySummaries: vi.fn(),
}));
vi.mock("./cooperative-sources", async (importOriginal) => ({
  ...await importOriginal<typeof import("./cooperative-sources")>(),
  readCooperativeSource: vi.fn(),
  recordBlockedFetch: vi.fn(),
}));
const granted = { source_key: "mamcos", permission_status: "granted", scheduled_collection_allowed: 1, redistribution_allowed: 0 } as CooperativeSourceRecord;

const env: Env["Bindings"] = { DB: {} as D1Database, ADMIN_TOKEN: "test-reviewer", REFERENCE_STATE: "Karnataka" };
const ctx = {} as ExecutionContext;
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe("monthly refresh HTTP contract", () => {
  it("requires a reviewer token", async () => {
    const response = await app.request("/api/v1/admin/monthly/refresh", { method: "POST" }, env);
    expect(response.status).toBe(401);
    expect(refreshMonthly).not.toHaveBeenCalled();
  });
  it.each([{ month: "2026-13" }, { month: "9999-01" }, { month: "2026-10", url: "https://example.com" }, null])("rejects invalid input %j", async (body) => {
    const response = await app.request("/api/v1/admin/monthly/refresh", {
      method: "POST", headers: { Authorization: "Bearer test-reviewer", "Content-Type": "application/json" }, body: JSON.stringify(body),
    }, env);
    expect(response.status).toBe(400);
    expect(refreshMonthly).not.toHaveBeenCalled();
  });
  it("publishes the authenticated connector result", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T00:00:00Z"));
    vi.mocked(refreshMonthly).mockResolvedValueOnce({ reporting_month: "2026-10", record_count: 28 });
    const response = await app.request("/api/v1/admin/monthly/refresh", {
      method: "POST", headers: { Authorization: "Bearer test-reviewer", "Content-Type": "application/json" }, body: JSON.stringify({ month: "2026-10" }),
    }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reporting_month: "2026-10", record_count: 28 });
    expect(refreshMonthly).toHaveBeenCalledWith(env.DB, "2026-10", "Karnataka");
  });
  it("rejects invalid read periods", async () => {
    expect((await app.request("/api/v1/monthly-prices?month=2026-13", {}, env)).status).toBe(400);
  });
});

describe("monthly scheduler", () => {
  it("refreshes both previous completed months across the year boundary", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-03T03:30:00Z"));
    vi.mocked(refreshMonthly).mockResolvedValue({ reporting_month: "2025-12", record_count: 1 });
    await worker.scheduled({} as ScheduledEvent, env, ctx);
    expect(refreshMonthly).toHaveBeenNthCalledWith(1, env.DB, "2025-11", "Karnataka");
    expect(refreshMonthly).toHaveBeenNthCalledWith(2, env.DB, "2025-12", "Karnataka");
    expect(refreshMamcos).not.toHaveBeenCalled();
  });
  it("attempts the second period even if the first fails, and fails the invocation visibly", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(refreshMonthly).mockRejectedValueOnce(new Error("Source unavailable"))
      .mockResolvedValueOnce({ reporting_month: "2026-10", record_count: 28 });
    await expect(worker.scheduled({} as ScheduledEvent, env, ctx)).rejects.toThrow("schedule failed");
    expect(refreshMonthly).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
  it("collects MAMCOS only when explicitly enabled and permission is recorded", async () => {
    vi.mocked(readCooperativeSource).mockResolvedValueOnce(granted);
    vi.mocked(refreshMamcos).mockResolvedValueOnce({ fetch_id: "f", attempts: 1, received_count: 1, inserted_count: 1, duplicate_count: 0, invalid_count: 0 });
    vi.mocked(refreshMonthly).mockResolvedValue({ reporting_month: "2026-10", record_count: 28 });
    await worker.scheduled({} as ScheduledEvent, { ...env, MAMCOS_SCHEDULE_ENABLED: "true" }, ctx);
    expect(refreshMamcos).toHaveBeenCalledWith(env.DB, { mode: "scheduled", attempts: 3 });
    expect(refreshMonthly).toHaveBeenCalledTimes(2);
  });
  it("asks TSS for yesterday in the morning, because today's tenders have not happened yet", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-06T03:30:00Z"));
    vi.mocked(readCooperativeSource).mockResolvedValueOnce({ ...granted, source_key: "tss" });
    vi.mocked(refreshTss).mockResolvedValueOnce({} as never);
    vi.mocked(refreshMonthly).mockResolvedValue({ reporting_month: "2026-10", record_count: 28 });
    await worker.scheduled({ cron: "30 3 * * *" } as ScheduledEvent, { ...env, TSS_SCHEDULE_ENABLED: "true" }, ctx);
    expect(refreshTss).toHaveBeenCalledWith(env.DB, "2026-11-05", { mode: "scheduled", attempts: 3 });
    expect(refreshMonthly).toHaveBeenCalledTimes(2);
  });
  it("collects only cooperative rates in the evening, using that day's date", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-06T14:30:00Z"));
    vi.mocked(readCooperativeSource).mockResolvedValueOnce({ ...granted, source_key: "tss" });
    vi.mocked(refreshTss).mockResolvedValueOnce({} as never);
    await worker.scheduled({ cron: EVENING_CRON } as ScheduledEvent, { ...env, TSS_SCHEDULE_ENABLED: "true" }, ctx);
    expect(refreshTss).toHaveBeenCalledWith(env.DB, "2026-11-06", { mode: "scheduled", attempts: 3 });
    expect(refreshMonthly).not.toHaveBeenCalled();
    expect(refreshChangedForecasts).not.toHaveBeenCalled();
  });
  it("auto-publishes only for a permitted source and only when switched on", async () => {
    vi.mocked(refreshMonthly).mockResolvedValue({ reporting_month: "2026-10", record_count: 28 });
    vi.mocked(refreshMamcos).mockResolvedValue({ fetch_id: "f", attempts: 1, received_count: 1, inserted_count: 1, duplicate_count: 0, invalid_count: 0 });
    vi.mocked(autoPublishPending).mockResolvedValue({ published: 1, held: [] });

    vi.mocked(readCooperativeSource).mockResolvedValueOnce(granted);
    await worker.scheduled({} as ScheduledEvent, { ...env, MAMCOS_SCHEDULE_ENABLED: "true" }, ctx);
    expect(autoPublishPending).not.toHaveBeenCalled();

    vi.mocked(readCooperativeSource).mockResolvedValueOnce({ ...granted, permission_status: "not_requested", scheduled_collection_allowed: 0 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await worker.scheduled({} as ScheduledEvent, { ...env, MAMCOS_SCHEDULE_ENABLED: "true", COOPERATIVE_AUTO_PUBLISH: "true" }, ctx);
    expect(autoPublishPending).not.toHaveBeenCalled();
    warn.mockRestore();

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(readCooperativeSource).mockResolvedValueOnce(granted);
    await worker.scheduled({} as ScheduledEvent, { ...env, MAMCOS_SCHEDULE_ENABLED: "true", COOPERATIVE_AUTO_PUBLISH: "true" }, ctx);
    expect(autoPublishPending).toHaveBeenCalledWith(env.DB, "mamcos", expect.any(Date));
    log.mockRestore();
  });
  it("does not touch cooperative sources when no schedule flag is enabled", async () => {
    vi.mocked(refreshMonthly).mockResolvedValue({ reporting_month: "2026-10", record_count: 28 });
    await worker.scheduled({} as ScheduledEvent, env, ctx);
    expect(readCooperativeSource).not.toHaveBeenCalled();
    expect(refreshMamcos).not.toHaveBeenCalled();
  });
  it.each(["not_requested", "requested", "denied"] as const)("records a blocked fetch instead of collecting when permission is %s", async (permission_status) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(readCooperativeSource).mockResolvedValueOnce({ ...granted, permission_status, scheduled_collection_allowed: 0 });
    vi.mocked(refreshMonthly).mockResolvedValue({ reporting_month: "2026-10", record_count: 28 });
    await worker.scheduled({} as ScheduledEvent, { ...env, MAMCOS_SCHEDULE_ENABLED: "true" }, ctx);
    expect(refreshMamcos).not.toHaveBeenCalled();
    expect(recordBlockedFetch).toHaveBeenCalledWith(env.DB, "mamcos", expect.any(String), expect.stringContaining("Scheduled collection blocked"));
    expect(refreshMonthly).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
  it("does not suppress monthly collection if enabled MAMCOS collection fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(readCooperativeSource).mockResolvedValueOnce(granted);
    vi.mocked(refreshMamcos).mockRejectedValueOnce(new Error("MAMCOS unavailable"));
    vi.mocked(refreshMonthly).mockResolvedValue({ reporting_month: "2026-10", record_count: 28 });
    await expect(worker.scheduled({} as ScheduledEvent, { ...env, MAMCOS_SCHEDULE_ENABLED: "true" }, ctx)).rejects.toThrow("schedule failed");
    expect(refreshMonthly).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
});

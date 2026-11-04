import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { app, type Env } from "./index";
import { refreshMonthly } from "./monthly";
import { refreshMamcos } from "./cooperative";

vi.mock("./monthly", async (importOriginal) => ({
  ...await importOriginal<typeof import("./monthly")>(),
  refreshMonthly: vi.fn(),
}));
vi.mock("./cooperative", async (importOriginal) => ({
  ...await importOriginal<typeof import("./cooperative")>(),
  refreshMamcos: vi.fn(),
}));

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
  it("collects MAMCOS only when explicitly enabled", async () => {
    vi.mocked(refreshMamcos).mockResolvedValueOnce({ received_count: 1, inserted_count: 1, invalid_count: 0 });
    vi.mocked(refreshMonthly).mockResolvedValue({ reporting_month: "2026-10", record_count: 28 });
    await worker.scheduled({} as ScheduledEvent, { ...env, MAMCOS_SCHEDULE_ENABLED: "true" }, ctx);
    expect(refreshMamcos).toHaveBeenCalledWith(env.DB);
    expect(refreshMonthly).toHaveBeenCalledTimes(2);
  });
  it("does not suppress monthly collection if enabled MAMCOS collection fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(refreshMamcos).mockRejectedValueOnce(new Error("MAMCOS unavailable"));
    vi.mocked(refreshMonthly).mockResolvedValue({ reporting_month: "2026-10", record_count: 28 });
    await expect(worker.scheduled({} as ScheduledEvent, { ...env, MAMCOS_SCHEDULE_ENABLED: "true" }, ctx)).rejects.toThrow("schedule failed");
    expect(refreshMonthly).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
});

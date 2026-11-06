import { describe, expect, it } from "vitest";
import { freshness, permissionLabel, permissionUpdate, schedulingDecision, type CooperativeSourceRecord } from "./cooperative-sources";

const source = { source_key: "tumcos", permission_status: "not_requested", scheduled_collection_allowed: 0, redistribution_allowed: 0 } as CooperativeSourceRecord;

describe("cooperative source permission gate", () => {
  it("blocks scheduled collection without a recorded grant even when the flag is on", () => {
    expect(schedulingDecision(source, false)).toMatchObject({ allowed: false, reason: expect.stringContaining("flag is disabled") });
    expect(schedulingDecision(source, true)).toMatchObject({ allowed: false, reason: expect.stringContaining("permission not confirmed") });
    expect(schedulingDecision({ ...source, permission_status: "granted" }, true).allowed).toBe(false);
    expect(schedulingDecision(null, true).allowed).toBe(false);
    expect(schedulingDecision({ ...source, permission_status: "granted", scheduled_collection_allowed: 1 }, true).allowed).toBe(true);
  });
  it("labels permission states without overstating them", () => {
    expect(permissionLabel(source)).toBe("Permission not confirmed");
    expect(permissionLabel({ ...source, permission_status: "requested" })).toBe("Permission requested; not confirmed");
    expect(permissionLabel({ ...source, permission_status: "granted" })).toBe("Collection permission recorded; redistribution not confirmed");
  });
  it("requires a reference for grants and forbids allowances without a grant", () => {
    const base = { permission_status: "granted", scheduled_collection_allowed: true, redistribution_allowed: false, permission_reference: "Email from TUMCOS secretary 2026-11-10" };
    expect(permissionUpdate.safeParse(base).success).toBe(true);
    expect(permissionUpdate.safeParse({ ...base, permission_reference: null }).success).toBe(false);
    expect(permissionUpdate.safeParse({ ...base, permission_status: "requested" }).success).toBe(false);
    expect(permissionUpdate.safeParse({ ...base, unexpected: 1 }).success).toBe(false);
  });
  it("computes freshness from calendar reporting dates", () => {
    expect(freshness("2026-11-02", "2026-11-04", 7)).toEqual({ latest_reporting_date: "2026-11-02", age_days: 2, state: "fresh" });
    expect(freshness("2026-10-01", "2026-11-04", 7)).toMatchObject({ age_days: 34, state: "stale" });
    expect(freshness(null, "2026-11-04", 7).state).toBe("no_data");
  });
});

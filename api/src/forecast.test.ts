import { describe, expect, it, vi } from "vitest";
import {
  canonicalInputs, completedMonth, doesNotDeteriorate, empiricalRadius, evaluateForecast,
  FORECAST_SCHEMA, FORECAST_VERSION, forecastRoutes, MIN_FORECAST_MONTHS, rollingOrigins,
  score, shiftMonth, snapshotStaleReasons, sourceFingerprint,
  type ForecastInputs, type MonthlyForecastInput,
} from "./forecast";

const AS_OF = "2026-11-03T00:00:00.000Z";
function series(count = 70, price = (i: number) => 40000 + i * 100): ForecastInputs {
  const prices: MonthlyForecastInput[] = Array.from({ length: count }, (_, i) => ({
    reporting_month: shiftMonth("2021-01", i), state: "Karnataka", variety_name: "Rashi",
    weighted_price: price(i), price_unit: "INR/quintal",
    source_url: "https://example.test/monthly", fetched_at: "2026-11-01T00:00:00Z", refresh_run_id: `capture-${i}`,
  }));
  return { prices, versions: prices.map((row) => ({ ...row })) };
}

describe("monthly forecast evaluation", () => {
  it("uses a 70-month exact-variety series, one-step origins and an untouched 12-month holdout", () => {
    const result = evaluateForecast(series(), "Rashi", AS_OF);
    expect(result.history).toEqual({ count: 70, from: "2021-01", through: "2026-10" });
    expect(result.publishable).toBe(true);
    expect(Object.values(result.gates)).toEqual([true, true, true, true, true]);
    expect(result.evaluation?.initial_training_months).toBe(34);
    expect(result.evaluation?.selected_model).toBe("last_value");
    expect(result.evaluation?.label).toContain("no demonstrated predictive edge");
    expect(result.evaluation?.holdout.selected).toEqual(result.evaluation?.holdout.naive);
    expect(result.evaluation?.holdout.interval_coverage).toBe(1);
    expect(result.forecast).toMatchObject({ reporting_month: "2026-11", point: 46900, lower: 46800, upper: 47000 });
    expect(result.evaluation?.validation.points.at(-1)?.reporting_month).toBe("2024-10");
    expect(result.evaluation?.calibration.points[0]?.reporting_month).toBe("2024-11");
    expect(result.evaluation?.holdout.points[0]?.reporting_month).toBe("2025-11");
    expect(result.limitations.join(" ")).toContain("not as-of");
  });

  it("never uses a target or future price in a walk-forward prediction", () => {
    const inputs = series();
    const before = rollingOrigins(inputs.prices, 24, 70);
    inputs.prices[50].weighted_price = 999999;
    const after = rollingOrigins(inputs.prices, 24, 70);
    expect(after.slice(0, 27)).toEqual(before.slice(0, 27).map((point, i) =>
      i === 26 ? { ...point, actual: 999999 } : point));
    expect(after[27].last_value).toBe(999999);
    expect(after[38].seasonal_naive).toBe(999999);
    expect(before.every((p) => shiftMonth(p.training_through, 1) === p.reporting_month)).toBe(true);
  });

  it("freezes selection and empirical radius before holdout even when holdout prices change", () => {
    const inputs = series(70, (i) => 40000 + (i % 12) * 500);
    const before = evaluateForecast(inputs, "Rashi", AS_OF);
    const changed = series(70, (i) => i >= 58 ? 50000 + i * 100 : 40000 + (i % 12) * 500);
    const after = evaluateForecast(changed, "Rashi", AS_OF);
    expect(before.evaluation?.selected_model).toBe("seasonal_naive");
    expect(after.evaluation?.selected_model).toBe(before.evaluation?.selected_model);
    expect(after.evaluation?.validation).toEqual(before.evaluation?.validation);
    expect(after.evaluation?.calibration).toEqual(before.evaluation?.calibration);
    expect(before.publishable).toBe(true);
    expect(after.publishable).toBe(false);
    expect(after.reasons).toContain("holdout_performance_deteriorated");
    expect(after.forecast).toBeNull();
  });

  it.each([
    ["gap", (input: ForecastInputs) => { input.prices.splice(30, 1); }, "calendar_gap_or_duplicate"],
    ["duplicate", (input: ForecastInputs) => { input.prices.push(input.prices[30]); }, "calendar_gap_or_duplicate"],
    ["null", (input: ForecastInputs) => { input.prices[30].weighted_price = null; }, "nonpositive_or_missing_price"],
    ["zero", (input: ForecastInputs) => { input.prices[30].weighted_price = 0; }, "nonpositive_or_missing_price"],
    ["negative", (input: ForecastInputs) => { input.prices[30].weighted_price = -1; }, "nonpositive_or_missing_price"],
    ["nonfinite", (input: ForecastInputs) => { input.prices[30].weighted_price = Infinity; }, "nonpositive_or_missing_price"],
    ["scope", (input: ForecastInputs) => { input.prices[30].state = "Goa"; }, "invalid_scope_or_unit"],
    ["variety", (input: ForecastInputs) => { input.prices[30].variety_name = "Other"; }, "invalid_scope_or_unit"],
    ["unit", (input: ForecastInputs) => { input.prices[30].price_unit = "INR/kg"; }, "invalid_scope_or_unit"],
    ["capture", (input: ForecastInputs) => { input.versions = []; }, "missing_capture_provenance"],
    ["future", (input: ForecastInputs) => { input.prices[69].reporting_month = "2026-11"; }, "invalid_reporting_period"],
    ["bad month", (input: ForecastInputs) => { input.prices[30].reporting_month = "2023-13"; }, "invalid_reporting_period"],
  ])("withholds %s histories", (_label, change, reason) => {
    const inputs = series();
    change(inputs);
    const result = evaluateForecast(inputs, "Rashi", AS_OF);
    expect(result.publishable).toBe(false);
    expect(result.reasons).toContain(reason);
    expect(result.forecast).toBeNull();
  });

  it("requires 60 months and blocks even one completed-month lag", () => {
    expect(MIN_FORECAST_MONTHS).toBe(60);
    expect(evaluateForecast(series(59), "Rashi", AS_OF).reasons).toContain("insufficient_history");
    expect(evaluateForecast(series(60), "Rashi", "2026-01-03T00:00:00Z").publishable).toBe(true);
    expect(evaluateForecast(series(68), "Rashi", AS_OF).reasons).toContain("stale_history");
    const lagged = evaluateForecast(series(69), "Rashi", AS_OF);
    expect(lagged.publishable).toBe(false);
    expect(lagged.reasons).toContain("stale_history");
    expect(lagged.gates.history_fresh).toBe(false);
    expect(lagged.forecast).toBeNull();
    expect(evaluateForecast({ prices: [], versions: [] }, "Rashi", AS_OF).forecast).toBeNull();
    expect(evaluateForecast(series(12), "Rashi", AS_OF).evaluation).toBeNull();
  });

  it("is deterministic and does not mutate inputs, including unsorted histories", () => {
    const inputs = series();
    const copy = structuredClone(inputs);
    expect(evaluateForecast(inputs, "Rashi", AS_OF)).toEqual(evaluateForecast(inputs, "Rashi", AS_OF));
    inputs.prices.reverse();
    expect(evaluateForecast(inputs, "Rashi", AS_OF)).toEqual(evaluateForecast(copy, "Rashi", AS_OF));
    expect(inputs.prices).toEqual([...copy.prices].reverse());
    expect(empiricalRadius([12, 1, 8, 3, 10, 2, 7, 5, 6, 9, 4, 11])).toBe(11);
    expect(() => empiricalRadius([1], 0.95)).toThrow("Too few");
    expect(() => rollingOrigins(copy.prices, 11, 20)).toThrow();
    expect(() => rollingOrigins(copy.prices.filter((_, i) => i !== 14), 12, 20)).toThrow("contiguous");
    expect(completedMonth("2026-01-01T00:00:00Z")).toBe("2025-12");
    expect(() => shiftMonth("2026-13", 1)).toThrow();
  });

  it("reports all holdout metrics against naive and refuses deterioration in any metric", () => {
    expect(score([100, 200], [110, 180])).toEqual({
      count: 2, mae: 15, rmse: Math.sqrt(250), smape_percent: (2000 / 210 + 4000 / 380) / 2,
    });
    const baseline = score([100, 200], [110, 180]);
    expect(doesNotDeteriorate(baseline, baseline)).toBe(true);
    expect(doesNotDeteriorate({ ...baseline, rmse: baseline.rmse + 1 }, baseline)).toBe(false);
    expect(doesNotDeteriorate({ ...baseline, smape_percent: baseline.smape_percent + 1 }, baseline)).toBe(false);
    expect(() => score([], [])).toThrow();
    const constant = evaluateForecast(series(70, () => 40000), "Rashi", AS_OF);
    expect(constant.publishable).toBe(true);
    expect(constant.evaluation?.holdout.mae_skill_vs_naive).toBeNull();
    expect(constant.evaluation?.selected_model).toBe("last_value");
  });
});

describe("snapshot identity and API boundaries", () => {
  it("fingerprints input values and reporting periods independently of order and capture lineage", async () => {
    const input = series();
    const fingerprint = await sourceFingerprint(input);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(await sourceFingerprint({ prices: [...input.prices].reverse(), versions: [...input.versions].reverse() })).toBe(fingerprint);
    expect(canonicalInputs(input)).not.toContain('"kind"');
    for (const change of [
      (copy: ForecastInputs) => { copy.prices[0].weighted_price! += 1; },
      (copy: ForecastInputs) => { copy.prices[0].price_unit = "INR/kg"; },
      (copy: ForecastInputs) => { copy.prices.pop(); },
    ]) {
      const copy = structuredClone(input);
      change(copy);
      expect(await sourceFingerprint(copy)).not.toBe(fingerprint);
    }
    for (const change of [
      (copy: ForecastInputs) => { copy.prices[0].refresh_run_id = "refetched"; copy.prices[0].fetched_at = "2026-11-02T00:00:00Z"; },
      (copy: ForecastInputs) => { copy.versions.push({ ...copy.versions[0], refresh_run_id: "extra" }); },
    ]) {
      const copy = structuredClone(input);
      change(copy);
      expect(await sourceFingerprint(copy)).toBe(fingerprint);
    }
    const snapshot = { source_fingerprint: fingerprint, formula_version: FORECAST_VERSION };
    expect(snapshotStaleReasons(snapshot, fingerprint, input, AS_OF)).toEqual([]);
    expect(snapshotStaleReasons(snapshot, fingerprint, input, "2026-12-01T00:00:00Z")).toEqual(["stale_history"]);
    expect(snapshotStaleReasons(snapshot, "changed", input, AS_OF)).toEqual(["source_history_changed"]);
    expect(snapshotStaleReasons({ ...snapshot, formula_version: "old" }, fingerprint, input, "2027-01-01"))
      .toEqual(["formula_version_changed", "stale_history"]);
  });

  it("rejects missing/unconfigured/wrong admin tokens before touching DB or reading payload", async () => {
    const prepare = vi.fn();
    for (const [token, authorization] of [[undefined, undefined], [undefined, "Bearer undefined"], ["secret", undefined], ["secret", "Bearer wrong"]]) {
      const response = await forecastRoutes.request("/admin/forecasts/evaluate", {
        method: "POST", headers: authorization ? { Authorization: authorization } : {},
        body: JSON.stringify({ variety: "Rashi" }),
      }, { DB: { prepare }, ADMIN_TOKEN: token });
      expect(response.status).toBe(401);
    }
    expect(prepare).not.toHaveBeenCalled();
  });

  it("rejects alternate states, extra fields and nonexact names", async () => {
    const prepare = vi.fn();
    for (const query of ["variety=Rashi&state=Goa", "variety=%20Rashi", `variety=${"x".repeat(161)}`]) {
      expect((await forecastRoutes.request(`/forecasts?${query}`, {}, { DB: { prepare } })).status).toBe(400);
    }
    expect((await forecastRoutes.request("/admin/forecasts/evaluate", {
      method: "POST", headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
      body: JSON.stringify({ variety: "Rashi", state: "Goa" }),
    }, { DB: { prepare }, ADMIN_TOKEN: "secret" })).status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("public GET only reads, defaults to Rashi and never evaluates missing snapshots", async () => {
    const statement = { bind: vi.fn(), first: vi.fn().mockResolvedValue(null) };
    statement.bind.mockReturnValue(statement);
    const prepare = vi.fn().mockReturnValue(statement);
    const response = await forecastRoutes.request("/forecasts", {}, { DB: { prepare } });
    expect(await response.json()).toMatchObject({ status: "not_evaluated", snapshot: null, forecast: null });
    expect(statement.bind).toHaveBeenCalledWith("Karnataka", "Rashi");
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledWith(expect.stringMatching(/^SELECT/));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("ORDER BY evaluated_at DESC,rowid DESC LIMIT 1"));
    expect(FORECAST_SCHEMA).toContain("BEFORE UPDATE");
    expect(FORECAST_SCHEMA).toContain("BEFORE DELETE");
  });

  it("persists the full evaluation and original capture inputs in an insert-only snapshot", async () => {
    const inputs = series(70, () => 40000);
    const statement = {
      bind: vi.fn(), run: vi.fn().mockResolvedValue({ success: true }),
      all: vi.fn().mockResolvedValue({ results: [
        ...inputs.prices.map((row) => ({ ...row, kind: "price" })),
        ...inputs.versions.map((row) => ({ ...row, kind: "version" })),
      ] }),
    };
    statement.bind.mockReturnValue(statement);
    const prepare = vi.fn().mockReturnValue(statement);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(AS_OF));
    try {
      const response = await forecastRoutes.request("/admin/forecasts/evaluate", {
        method: "POST", headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
        body: JSON.stringify({ variety: "Rashi" }),
      }, { DB: { prepare }, ADMIN_TOKEN: "secret" });
      expect(response.status).toBe(201);
      const body = await response.json() as { snapshot: { inputs: ForecastInputs; results: { publishable: boolean } } };
      expect(body.snapshot.inputs.prices).toHaveLength(70);
      expect(body.snapshot.inputs.versions).toHaveLength(70);
      expect(body.snapshot.results.publishable).toBe(true);
      const args = statement.bind.mock.calls[1];
      expect(args.slice(1, 5)).toEqual(["Karnataka", "Rashi", AS_OF, FORECAST_VERSION]);
      expect(JSON.parse(args[6])).toEqual(JSON.parse(canonicalInputs(inputs)));
      expect(JSON.parse(args[7])).toEqual(body.snapshot.results);
      expect(prepare.mock.calls[0][0]).toContain("UNION ALL");
      expect(prepare.mock.calls[1][0]).toMatch(/^INSERT INTO forecast_snapshots/);
      expect(statement.run).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves an evaluated snapshot without computing or writing and suppresses revised forecasts", async () => {
    const inputs = series();
    const fingerprint = await sourceFingerprint(inputs);
    const results = evaluateForecast(inputs, "Rashi", AS_OF);
    const row = {
      id: "snapshot-1", state: "Karnataka", variety_name: "Rashi", evaluated_at: AS_OF,
      formula_version: FORECAST_VERSION, source_fingerprint: fingerprint,
      inputs_json: canonicalInputs(inputs), results_json: JSON.stringify(results),
    };
    const statement = {
      bind: vi.fn(), first: vi.fn().mockResolvedValue(row),
      all: vi.fn().mockImplementation(async () => ({ results: [
        ...inputs.prices.map((price) => ({ ...price, kind: "price" })),
        ...inputs.versions.map((price) => ({ ...price, kind: "version" })),
      ] })),
    };
    statement.bind.mockReturnValue(statement);
    const prepare = vi.fn().mockReturnValue(statement);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(AS_OF));
    try {
      const get = async () => (await forecastRoutes.request("/forecasts?variety=Rashi", {}, { DB: { prepare } })).json();
      const first = await get();
      expect(first).toMatchObject({ status: "published", stale: false, forecast: results.forecast });
      expect(await get()).toEqual(first);
      vi.setSystemTime(new Date("2026-12-01T00:00:00Z"));
      expect(await get()).toMatchObject({
        status: "stale", stale: true, stale_reasons: ["stale_history"], forecast: null,
        snapshot: { results },
      });
      vi.setSystemTime(new Date(AS_OF));
      inputs.prices[0].weighted_price! += 1;
      expect(await get()).toMatchObject({
        status: "stale", stale: true, stale_reasons: ["source_history_changed"], forecast: null,
        snapshot: { results },
      });
      expect(prepare.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

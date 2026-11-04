import { describe, expect, it } from "vitest";
import { calculateDecision, calculationSchema, type CalculationInputs, type PriceSnapshot } from "./decisions";

const inputs: CalculationInputs = {
  name: "Test-only farm", quantity_quintals: 10, commission_percent: 2, transport_cost: 1000, other_selling_cost: 500,
  area_hectares: 2, production_cost: 250000, byproduct_income: 10000,
  hold_days: 90, annual_finance_percent: 10, storage_cost: 2000, weight_loss_percent: 2, scenario_price: 52000,
  price: { kind: "manual", value: 50000 },
};
const price: PriceSnapshot = { value: 50000, source: "User entered", reporting_period: null, fetched_at: null,
  source_url: null, variety: null, branch: null, state: null, unit_status: "user_entered", price_type: "user_price", reference_id: null };
describe("net-realization and hold break-even formulas", () => {
  it("matches independently calculated net receipts, profit and hold scenario cash flow", () => {
    const result = calculateDecision(inputs, price);
    expect(result.gross_realization).toBe(500000);
    expect(result.selling_costs).toBe(11500);
    expect(result.net_realization).toBe(488500);
    expect(result.net_per_quintal).toBe(48850);
    expect(result.farm_profit).toBe(248500);
    expect(result.profit_per_hectare).toBe(124250);
    expect(result.roi_percent).toBeCloseTo(99.4);
    expect(result.remaining_quintals).toBe(9.8);
    expect(result.finance_cost).toBeCloseTo(488500 * 0.1 * 90 / 365);
    expect(result.hold_net_realization).toBeCloseTo(9.8 * 52000 * 0.98 - 1500 - 2000 - 488500 * 0.1 * 90 / 365);
    expect(result.hold_unchanged_net_realization).toBeCloseTo(9.8 * 50000 * 0.98 - 1500 - 2000 - 488500 * 0.1 * 90 / 365);
    expect(result.hold_unchanged_advantage).toBeLessThan(0);
  });
  it("returns a hold break-even price that exactly equalizes net now and hold proceeds", () => {
    const result = calculateDecision(inputs, price);
    const equalized = calculateDecision({ ...inputs, scenario_price: result.break_even_hold_price }, price);
    expect(equalized.hold_advantage).toBeCloseTo(0, 7);
    const farm = calculateDecision(inputs, { ...price, value: result.farm_break_even_price });
    expect(farm.farm_profit).toBeCloseTo(0, 7);
  });
  it("has no holding penalty when shrinkage, storage and finance are zero", () => {
    const result = calculateDecision({ ...inputs, weight_loss_percent: 0, storage_cost: 0, annual_finance_percent: 0, scenario_price: 50000 }, price);
    expect(result.break_even_hold_price).toBeCloseTo(50000);
    expect(result.hold_advantage).toBeCloseTo(0);
  });
  it("does not produce infinite ROI on zero production costs and exposes negative net receipts", () => {
    const result = calculateDecision({ ...inputs, production_cost: 0, transport_cost: 1e6 }, price);
    expect(result.roi_percent).toBeNull();
    expect(result.net_realization).toBeLessThan(0);
    expect(result.finance_cost).toBe(0);
  });
  it.each([
    { quantity_quintals: 0 }, { commission_percent: 100 }, { area_hectares: 0 },
    { quantity_quintals: 1e-300 }, { area_hectares: 1e-300 },
    { weight_loss_percent: 100 }, { storage_cost: -1 }, { hold_days: 0.5 }, { production_cost: Infinity },
    { scenario_price: 0 }, { price: { kind: "manual", value: -1 } }, { extra: "unrecognized" },
  ])("rejects invalid inputs %j", (change) => {
    expect(calculationSchema.safeParse({ ...inputs, ...change }).success).toBe(false);
  });
  it("fails explicitly rather than serializing nonfinite results as null", () => {
    expect(() => calculateDecision({ ...inputs, production_cost: 1e-300 }, { ...price, value: 1e8 }))
      .toThrow("unsupported numerical magnitudes");
  });
});

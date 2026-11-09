import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { toCsv } from "../services/csv";
import type { Calculation, CalculationInputs, PriceReference } from "../services/intelligence";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { defineCopy, useCopy, useFormat } from "../services/language";
import { AboutData } from "../components/AboutData";
import { useReviewerAccess } from "../components/useReviewerAccess";

type NumericKey = Exclude<keyof CalculationInputs, "name" | "price">;
type Section = "net" | "farm" | "hold";
const fields: { key: NumericKey; min: number; max?: number; step?: string; section: Section }[] = [
  { key: "quantity_quintals", min: 0.0001, section: "net" },
  { key: "commission_percent", min: 0, max: 99, section: "net" },
  { key: "transport_cost", min: 0, section: "net" },
  { key: "other_selling_cost", min: 0, section: "net" },
  { key: "area_hectares", min: 0.0001, section: "farm" },
  { key: "production_cost", min: 0, section: "farm" },
  { key: "byproduct_income", min: 0, section: "farm" },
  { key: "hold_days", min: 1, max: 3650, step: "1", section: "hold" },
  { key: "annual_finance_percent", min: 0, max: 100, section: "hold" },
  { key: "storage_cost", min: 0, section: "hold" },
  { key: "weight_loss_percent", min: 0, max: 99, section: "hold" },
  { key: "scenario_price", min: 0.01, section: "hold" },
];
const SECTIONS: Section[] = ["net", "farm", "hold"];
const emptyValues = (): Record<NumericKey, string> => Object.fromEntries(fields.map((field) => [field.key, ""])) as Record<NumericKey, string>;
const money = (value: number) => value.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

const COPY = defineCopy({
  en: {
    fields: {
      quantity_quintals: "Saleable quantity (quintals; 1 quintal = 100 kg)", commission_percent: "Selling commission (%)", transport_cost: "Total transport cost (INR)",
      other_selling_cost: "Other selling costs, total (INR)", area_hectares: "Farm area (hectares)", production_cost: "Production cost for this harvest, excluding selling costs (INR)",
      byproduct_income: "By-product income for this harvest (INR)", hold_days: "Holding period (days)", annual_finance_percent: "Annual opportunity / finance rate (%)",
      storage_cost: "Additional total storage / insurance cost (INR)", weight_loss_percent: "Expected saleable weight loss (%)", scenario_price: "Your future-price scenario (INR/quintal; not a forecast)",
    } as Record<NumericKey, string>,
    sections: {
      net: { title: "Net realization", hint: "Commission applies to gross proceeds; transport and other selling costs are total INR, not per-quintal amounts." },
      farm: { title: "Farm profitability", hint: "Use total costs and area attributable to the supplied saleable harvest. Do not double-count selling costs." },
      hold: { title: "Hold scenario", hint: "Future price, shrinkage and carrying rate are your assumptions. Selling fees/transport are held unchanged. No probability is assigned." },
    } as Record<Section, { title: string; hint: string }>,
    cooperativeOption: (source: string, branch: string, variety: string, date: string, price: string, assumed: boolean) => `${source} · ${branch} · ${variety} · ${date} · ${price} / qtl${assumed ? " — unit by operator assumption" : ""}`,
    monthlyOption: (variety: string, month: string, price: string) => `AGMARKNET monthly · ${variety} · ${month} · ${price} / qtl — state aggregate`,
    selectPrice: "Select an available source price or enter your own price.", everyInput: "Enter every cost and scenario input; use 0 only when the cost genuinely does not apply.",
    finite: "Inputs must be finite numbers.", invalid: "Invalid inputs.",
    title: "Realization & farm profitability", intro: "Your quantities and costs, a traceable source price, and explicit hold scenarios. No predictive recommendation.",
    before: "Before you calculate", beforeText: "No costs or yields are prefilled. Match your exact product grade and reporting date. Published prices are indicative, not a buyer's executable offer. Monthly state averages are not local daily quotations; TSS units remain assumed.",
    priceTitle: "Price reference and scenario", priceHint: "All sale prices are INR/quintal. Enter actual costs for the same harvest and currency.",
    scenarioName: "Scenario name", sourcePrice: "Source price", selectOption: "Select a price — no automatic substitution",
    savedGone: "Saved price no longer current — choose another before recalculating", manualOption: "My own price — user-entered, not sourced", yourPrice: "Your price (INR/quintal)",
    calculating: "Calculating...", calculate: "Calculate actual-input scenario",
    resultsAria: "Calculation results", results: (name: string) => `${name} · Results`,
    savedAt: (time: string) => `Saved snapshot: ${time}. Retained independently of later source corrections.`, notStored: "Calculated but not stored. Save with reviewer access below.",
    exportScenario: "Export scenario CSV",
    priceLine: (price: string, source: string, status: string) => `Price: ${price} / quintal · ${source} · ${status}`,
    reportingPeriod: (period: string) => `Market reporting period: ${period}`, userEntered: "User entered; no reporting date",
    platformFetched: (time: string) => `Platform fetched: ${time}`, notSourced: "Not sourced", evidence: "Source evidence", reportingState: (state: string) => `Source reporting state: ${state}`,
    archived: "Download the archived report used for this calculation", archivedNote: "(unchanged by later source refreshes).",
    assumedNote: "INR/quintal is an operator assumption for this source. All monetary results inherit it.",
    outputsAria: "Decision calculation outputs", outputsCaption: "Scenario arithmetic, not forecasts or personalized investment advice", measure: "Measure", value: "Value",
    measures: {
      gross_realization: "Gross realization", selling_costs: "Selling costs", net_realization: "Net realization now", net_per_quintal: "Net per quintal",
      farm_profit: "Farm profit", profit_per_hectare: "Profit per hectare", farm_break_even_price: "Farm break-even sale price / quintal",
      finance_cost: "Hold finance / opportunity cost", hold_net_realization: "Hold net realization at your scenario price",
      hold_advantage: "Hold advantage vs selling now", break_even_hold_price: "Hold break-even price / remaining quintal",
    } as Record<string, string>,
    roi: "Return on production cost", roiUnavailable: "Unavailable: production cost is zero", remaining: "Saleable quantity after holding", quintals: "quintals",
    increase: "Required increase to hold break-even",
    scenariosAria: "Hold scenarios", scenariosCaption: "Deterministic hold scenarios — no probabilities or predicted outcomes",
    scenario: "Scenario", futurePrice: "Future price / quintal", holdNet: "Hold net proceeds", advantage: "Advantage vs sell now",
    unchanged: "Price unchanged from reference", yours: "Your entered future-price scenario", breakEven: "Break-even hold price",
    formula: "Net now = quantity × price × (1 − commission %) − transport − other selling costs. Farm profit = net now + by-product income − production cost. Holding finance = max(net now, 0) × annual rate × days / 365. Hold net uses the remaining weight and your future price, minus selling, storage and finance costs.",
    notPrediction: "Hold break-even is the future price that matches today's net proceeds after those costs. It is not a predicted price or a sell/hold recommendation. No taxes, grade changes, inflation, reinvestment or unentered expenses are inferred. Input 0 explicitly when applicable.",
    negative: "Immediate net proceeds are negative. Opportunity cost is floored at zero; financing of losses is not modelled.",
    savedTitle: "Private saved scenarios", savedHint: "Stored in the API database with immutable price and result snapshots. Shared reviewer-token access is not individual-account isolation. Latest 100 saved scenarios are listed.",
    storageToken: "Scenario storage reviewer token", unlock: "Unlock saved scenarios", lock: "Lock and clear private inputs", saveScenario: "Save calculated scenario",
    noSaved: "No saved scenarios", noSavedHint: "No example costs or fictitious farm inputs are stored.",
  },
  kn: {
    fields: {
      quantity_quintals: "ಮಾರಾಟಕ್ಕಿರುವ ಪ್ರಮಾಣ (ಕ್ವಿಂಟಾಲ್; 1 ಕ್ವಿಂಟಾಲ್ = 100 ಕೆಜಿ)", commission_percent: "ಮಾರಾಟ ಕಮಿಷನ್ (%)", transport_cost: "ಒಟ್ಟು ಸಾಗಣೆ ವೆಚ್ಚ (₹)",
      other_selling_cost: "ಇತರ ಮಾರಾಟ ವೆಚ್ಚ, ಒಟ್ಟು (₹)", area_hectares: "ತೋಟದ ವಿಸ್ತೀರ್ಣ (ಹೆಕ್ಟೇರ್)", production_cost: "ಈ ಕೊಯ್ಲಿನ ಉತ್ಪಾದನಾ ವೆಚ್ಚ, ಮಾರಾಟ ವೆಚ್ಚ ಹೊರತುಪಡಿಸಿ (₹)",
      byproduct_income: "ಈ ಕೊಯ್ಲಿನ ಉಪ-ಉತ್ಪನ್ನ ಆದಾಯ (₹)", hold_days: "ಕಾಯುವ ಅವಧಿ (ದಿನಗಳು)", annual_finance_percent: "ವಾರ್ಷಿಕ ಬಡ್ಡಿ / ಅವಕಾಶ ವೆಚ್ಚ ದರ (%)",
      storage_cost: "ಹೆಚ್ಚುವರಿ ಒಟ್ಟು ಸಂಗ್ರಹ / ವಿಮೆ ವೆಚ್ಚ (₹)", weight_loss_percent: "ನಿರೀಕ್ಷಿತ ತೂಕ ನಷ್ಟ (%)", scenario_price: "ನಿಮ್ಮ ಮುಂದಿನ ದರದ ಊಹೆ (₹/ಕ್ವಿಂಟಾಲ್; ಮುನ್ಸೂಚನೆ ಅಲ್ಲ)",
    },
    sections: {
      net: { title: "ನಿವ್ವಳ ಆದಾಯ", hint: "ಕಮಿಷನ್ ಒಟ್ಟು ಆದಾಯದ ಮೇಲೆ; ಸಾಗಣೆ ಮತ್ತು ಇತರ ಮಾರಾಟ ವೆಚ್ಚಗಳು ಒಟ್ಟು ರೂಪಾಯಿಗಳಲ್ಲಿ, ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ ಅಲ್ಲ." },
      farm: { title: "ತೋಟದ ಲಾಭ", hint: "ಈ ಮಾರಾಟದ ಕೊಯ್ಲಿಗೆ ಸಂಬಂಧಿಸಿದ ಒಟ್ಟು ವೆಚ್ಚ ಮತ್ತು ವಿಸ್ತೀರ್ಣ ಬಳಸಿ. ಮಾರಾಟ ವೆಚ್ಚವನ್ನು ಎರಡು ಬಾರಿ ಸೇರಿಸಬೇಡಿ." },
      hold: { title: "ಕಾಯುವ ಸಂದರ್ಭ", hint: "ಮುಂದಿನ ದರ, ತೂಕ ನಷ್ಟ ಮತ್ತು ಬಡ್ಡಿ ದರ ನಿಮ್ಮ ಊಹೆಗಳು. ಮಾರಾಟ ಶುಲ್ಕ/ಸಾಗಣೆ ಬದಲಾಗುವುದಿಲ್ಲ ಎಂದು ಪರಿಗಣಿಸಲಾಗಿದೆ. ಯಾವುದೇ ಸಂಭವನೀಯತೆ ನೀಡುವುದಿಲ್ಲ." },
    },
    cooperativeOption: (source: string, branch: string, variety: string, date: string, price: string, assumed: boolean) => `${source} · ${branch} · ${variety} · ${date} · ${price} / ಕ್ವಿಂ${assumed ? " — ಘಟಕ ಊಹಿಸಲಾಗಿದೆ" : ""}`,
    monthlyOption: (variety: string, month: string, price: string) => `AGMARKNET ತಿಂಗಳ ವರದಿ · ${variety} · ${month} · ${price} / ಕ್ವಿಂ — ರಾಜ್ಯ ಸರಾಸರಿ`,
    selectPrice: "ಲಭ್ಯವಿರುವ ಮೂಲ ದರವನ್ನು ಆಯ್ಕೆಮಾಡಿ ಅಥವಾ ನಿಮ್ಮ ದರ ನಮೂದಿಸಿ.", everyInput: "ಎಲ್ಲಾ ವೆಚ್ಚ ಮತ್ತು ಸಂದರ್ಭದ ಅಂಕಿಗಳನ್ನು ನಮೂದಿಸಿ; ವೆಚ್ಚ ನಿಜವಾಗಿಯೂ ಇಲ್ಲದಿದ್ದಾಗ ಮಾತ್ರ 0 ಬಳಸಿ.",
    finite: "ಅಂಕಿಗಳು ಸರಿಯಾದ ಸಂಖ್ಯೆಗಳಾಗಿರಬೇಕು.", invalid: "ಅಮಾನ್ಯ ಅಂಕಿಗಳು.",
    title: "ನಿವ್ವಳ ಆದಾಯ ಮತ್ತು ತೋಟದ ಲಾಭ", intro: "ನಿಮ್ಮ ಪ್ರಮಾಣ ಮತ್ತು ವೆಚ್ಚಗಳು, ಪತ್ತೆಹಚ್ಚಬಹುದಾದ ಮೂಲ ದರ ಮತ್ತು ಸ್ಪಷ್ಟ ಕಾಯುವ ಸಂದರ್ಭಗಳು. ಯಾವುದೇ ಮುನ್ಸೂಚನೆ ಸಲಹೆ ಇಲ್ಲ.",
    before: "ಲೆಕ್ಕ ಹಾಕುವ ಮೊದಲು", beforeText: "ಯಾವುದೇ ವೆಚ್ಚ ಅಥವಾ ಇಳುವರಿ ಮೊದಲೇ ತುಂಬಿಲ್ಲ. ನಿಮ್ಮ ನಿಖರ ದರ್ಜೆ ಮತ್ತು ವರದಿ ದಿನಾಂಕಕ್ಕೆ ಹೊಂದಿಸಿ. ಪ್ರಕಟಿತ ದರಗಳು ಸೂಚಕ ಮಾತ್ರ, ಖರೀದಿದಾರರ ಖಚಿತ ಕೊಡುಗೆ ಅಲ್ಲ. ತಿಂಗಳ ರಾಜ್ಯ ಸರಾಸರಿಗಳು ಸ್ಥಳೀಯ ದೈನಂದಿನ ದರಗಳಲ್ಲ; TSS ಘಟಕ ಊಹಿಸಿದ್ದು.",
    priceTitle: "ದರದ ಆಧಾರ ಮತ್ತು ಸಂದರ್ಭ", priceHint: "ಎಲ್ಲಾ ಮಾರಾಟ ದರಗಳು ₹/ಕ್ವಿಂಟಾಲ್. ಅದೇ ಕೊಯ್ಲಿನ ನಿಜವಾದ ವೆಚ್ಚಗಳನ್ನು ನಮೂದಿಸಿ.",
    scenarioName: "ಸಂದರ್ಭದ ಹೆಸರು", sourcePrice: "ಮೂಲ ದರ", selectOption: "ದರ ಆಯ್ಕೆಮಾಡಿ — ತಾನಾಗಿ ಬದಲಿಸುವುದಿಲ್ಲ",
    savedGone: "ಉಳಿಸಿದ ದರ ಈಗ ಲಭ್ಯವಿಲ್ಲ — ಮತ್ತೆ ಲೆಕ್ಕ ಹಾಕುವ ಮೊದಲು ಬೇರೆ ಆಯ್ಕೆಮಾಡಿ", manualOption: "ನನ್ನ ಸ್ವಂತ ದರ — ನಾನು ನಮೂದಿಸಿದ್ದು, ಮೂಲವಿಲ್ಲ", yourPrice: "ನಿಮ್ಮ ದರ (₹/ಕ್ವಿಂಟಾಲ್)",
    calculating: "ಲೆಕ್ಕ ಹಾಕಲಾಗುತ್ತಿದೆ...", calculate: "ಲೆಕ್ಕ ಹಾಕಿ",
    resultsAria: "ಲೆಕ್ಕದ ಫಲಿತಾಂಶ", results: (name: string) => `${name} · ಫಲಿತಾಂಶ`,
    savedAt: (time: string) => `ಉಳಿಸಿದ ಸಮಯ: ${time}. ನಂತರದ ಮೂಲ ತಿದ್ದುಪಡಿಗಳಿಂದ ಬದಲಾಗುವುದಿಲ್ಲ.`, notStored: "ಲೆಕ್ಕ ಹಾಕಲಾಗಿದೆ, ಉಳಿಸಿಲ್ಲ. ಕೆಳಗೆ ಪರಿಶೀಲಕರ ಪ್ರವೇಶದಿಂದ ಉಳಿಸಿ.",
    exportScenario: "ಸಂದರ್ಭ CSV ಡೌನ್‌ಲೋಡ್",
    priceLine: (price: string, source: string, status: string) => `ದರ: ${price} / ಕ್ವಿಂಟಾಲ್ · ${source} · ${status}`,
    reportingPeriod: (period: string) => `ಮಾರುಕಟ್ಟೆ ವರದಿ ಅವಧಿ: ${period}`, userEntered: "ನೀವು ನಮೂದಿಸಿದ್ದು; ವರದಿ ದಿನಾಂಕವಿಲ್ಲ",
    platformFetched: (time: string) => `ತಂದ ಸಮಯ: ${time}`, notSourced: "ಮೂಲವಿಲ್ಲ", evidence: "ಮೂಲದ ಆಧಾರ", reportingState: (state: string) => `ಮೂಲದ ವರದಿ ರಾಜ್ಯ: ${state}`,
    archived: "ಈ ಲೆಕ್ಕಕ್ಕೆ ಬಳಸಿದ ಸಂಗ್ರಹಿತ ವರದಿ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ", archivedNote: "(ನಂತರದ ನವೀಕರಣಗಳಿಂದ ಬದಲಾಗುವುದಿಲ್ಲ).",
    assumedNote: "ಈ ಮೂಲಕ್ಕೆ ₹/ಕ್ವಿಂಟಾಲ್ ನಿರ್ವಾಹಕರ ಊಹೆ. ಎಲ್ಲಾ ಹಣದ ಫಲಿತಾಂಶಗಳಿಗೂ ಇದು ಅನ್ವಯಿಸುತ್ತದೆ.",
    outputsAria: "ಲೆಕ್ಕದ ಫಲಿತಾಂಶಗಳು", outputsCaption: "ಸಂದರ್ಭದ ಲೆಕ್ಕಾಚಾರ ಮಾತ್ರ, ಮುನ್ಸೂಚನೆ ಅಥವಾ ವೈಯಕ್ತಿಕ ಹೂಡಿಕೆ ಸಲಹೆ ಅಲ್ಲ", measure: "ಅಳತೆ", value: "ಮೌಲ್ಯ",
    measures: {
      gross_realization: "ಒಟ್ಟು ಆದಾಯ", selling_costs: "ಮಾರಾಟ ವೆಚ್ಚ", net_realization: "ಈಗ ಮಾರಿದರೆ ನಿವ್ವಳ ಆದಾಯ", net_per_quintal: "ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್ ನಿವ್ವಳ",
      farm_profit: "ತೋಟದ ಲಾಭ", profit_per_hectare: "ಪ್ರತಿ ಹೆಕ್ಟೇರ್ ಲಾಭ", farm_break_even_price: "ತೋಟದ ನಷ್ಟವಿಲ್ಲದ ಮಾರಾಟ ದರ / ಕ್ವಿಂಟಾಲ್",
      finance_cost: "ಕಾಯುವುದರ ಬಡ್ಡಿ / ಅವಕಾಶ ವೆಚ್ಚ", hold_net_realization: "ನಿಮ್ಮ ಊಹೆಯ ದರದಲ್ಲಿ ಕಾದು ಮಾರಿದರೆ ನಿವ್ವಳ",
      hold_advantage: "ಈಗ ಮಾರುವುದಕ್ಕಿಂತ ಕಾಯುವುದರ ಲಾಭ", break_even_hold_price: "ಕಾಯುವುದಕ್ಕೆ ನಷ್ಟವಿಲ್ಲದ ದರ / ಉಳಿದ ಕ್ವಿಂಟಾಲ್",
    },
    roi: "ಉತ್ಪಾದನಾ ವೆಚ್ಚದ ಮೇಲಿನ ಲಾಭ", roiUnavailable: "ಲಭ್ಯವಿಲ್ಲ: ಉತ್ಪಾದನಾ ವೆಚ್ಚ ಸೊನ್ನೆ", remaining: "ಕಾದ ನಂತರ ಮಾರಾಟಕ್ಕಿರುವ ಪ್ರಮಾಣ", quintals: "ಕ್ವಿಂಟಾಲ್",
    increase: "ನಷ್ಟವಿಲ್ಲದಂತೆ ಕಾಯಲು ಬೇಕಾದ ಏರಿಕೆ",
    scenariosAria: "ಕಾಯುವ ಸಂದರ್ಭಗಳು", scenariosCaption: "ನಿಗದಿತ ಕಾಯುವ ಸಂದರ್ಭಗಳು — ಸಂಭವನೀಯತೆ ಅಥವಾ ಮುನ್ಸೂಚನೆ ಇಲ್ಲ",
    scenario: "ಸಂದರ್ಭ", futurePrice: "ಮುಂದಿನ ದರ / ಕ್ವಿಂಟಾಲ್", holdNet: "ಕಾದು ಮಾರಿದರೆ ನಿವ್ವಳ", advantage: "ಈಗ ಮಾರುವುದಕ್ಕೆ ಹೋಲಿಸಿ ಲಾಭ",
    unchanged: "ದರ ಬದಲಾಗದಿದ್ದರೆ", yours: "ನೀವು ನಮೂದಿಸಿದ ಮುಂದಿನ ದರ", breakEven: "ನಷ್ಟವಿಲ್ಲದ ಕಾಯುವ ದರ",
    formula: "ಈಗಿನ ನಿವ್ವಳ = ಪ್ರಮಾಣ × ದರ × (1 − ಕಮಿಷನ್ %) − ಸಾಗಣೆ − ಇತರ ಮಾರಾಟ ವೆಚ್ಚ. ತೋಟದ ಲಾಭ = ಈಗಿನ ನಿವ್ವಳ + ಉಪ-ಉತ್ಪನ್ನ ಆದಾಯ − ಉತ್ಪಾದನಾ ವೆಚ್ಚ. ಕಾಯುವ ಬಡ್ಡಿ = max(ಈಗಿನ ನಿವ್ವಳ, 0) × ವಾರ್ಷಿಕ ದರ × ದಿನಗಳು / 365. ಕಾದ ನಂತರದ ನಿವ್ವಳಕ್ಕೆ ಉಳಿದ ತೂಕ ಮತ್ತು ನಿಮ್ಮ ಮುಂದಿನ ದರ ಬಳಸಿ, ಮಾರಾಟ, ಸಂಗ್ರಹ ಮತ್ತು ಬಡ್ಡಿ ವೆಚ್ಚಗಳನ್ನು ಕಳೆಯಲಾಗುತ್ತದೆ.",
    notPrediction: "ನಷ್ಟವಿಲ್ಲದ ಕಾಯುವ ದರ ಎಂದರೆ ಆ ವೆಚ್ಚಗಳ ನಂತರ ಇಂದಿನ ನಿವ್ವಳಕ್ಕೆ ಸಮನಾಗುವ ಮುಂದಿನ ದರ. ಇದು ಮುನ್ಸೂಚನೆ ಅಥವಾ ಮಾರು/ಕಾಯು ಸಲಹೆ ಅಲ್ಲ. ತೆರಿಗೆ, ದರ್ಜೆ ಬದಲಾವಣೆ, ಹಣದುಬ್ಬರ ಅಥವಾ ನಮೂದಿಸದ ವೆಚ್ಚಗಳನ್ನು ಊಹಿಸುವುದಿಲ್ಲ. ಅನ್ವಯಿಸಿದಾಗ 0 ಎಂದು ಸ್ಪಷ್ಟವಾಗಿ ನಮೂದಿಸಿ.",
    negative: "ಈಗಿನ ನಿವ್ವಳ ಆದಾಯ ಋಣಾತ್ಮಕವಾಗಿದೆ. ಅವಕಾಶ ವೆಚ್ಚವನ್ನು ಸೊನ್ನೆಗಿಂತ ಕಡಿಮೆ ಮಾಡಿಲ್ಲ; ನಷ್ಟದ ಬಡ್ಡಿಯನ್ನು ಲೆಕ್ಕಕ್ಕೆ ತೆಗೆದುಕೊಂಡಿಲ್ಲ.",
    savedTitle: "ಉಳಿಸಿದ ಖಾಸಗಿ ಸಂದರ್ಭಗಳು", savedHint: "ಬದಲಾಗದ ದರ ಮತ್ತು ಫಲಿತಾಂಶದೊಂದಿಗೆ API ದತ್ತಾಂಶದಲ್ಲಿ ಉಳಿಸಲಾಗುತ್ತದೆ. ಹಂಚಿಕೊಂಡ ಪರಿಶೀಲಕರ ಟೋಕನ್ ವೈಯಕ್ತಿಕ ಖಾತೆಯ ರಕ್ಷಣೆಯಲ್ಲ. ಇತ್ತೀಚಿನ 100 ಸಂದರ್ಭಗಳನ್ನು ತೋರಿಸಲಾಗಿದೆ.",
    storageToken: "ಸಂದರ್ಭ ಸಂಗ್ರಹದ ಪರಿಶೀಲಕರ ಟೋಕನ್", unlock: "ಉಳಿಸಿದ ಸಂದರ್ಭಗಳನ್ನು ತೆರೆಯಿರಿ", lock: "ಮುಚ್ಚಿ ಮತ್ತು ಖಾಸಗಿ ಅಂಕಿಗಳನ್ನು ತೆರವುಗೊಳಿಸಿ", saveScenario: "ಲೆಕ್ಕ ಹಾಕಿದ ಸಂದರ್ಭ ಉಳಿಸಿ",
    noSaved: "ಉಳಿಸಿದ ಸಂದರ್ಭಗಳಿಲ್ಲ", noSavedHint: "ಉದಾಹರಣೆ ವೆಚ್ಚ ಅಥವಾ ಕಲ್ಪಿತ ತೋಟದ ಅಂಕಿಗಳನ್ನು ಉಳಿಸುವುದಿಲ್ಲ.",
  },
});
export function DecisionToolsPage() {
  const t = useCopy(COPY);
  const format = useFormat();
  const [values, setValues] = useState(emptyValues), [name, setName] = useState("");
  const [selection, setSelection] = useState(""), [manualPrice, setManualPrice] = useState("");
  const access = useReviewerAccess(["saved-calculations"]);
  const { token, unlocked } = access;
  const [result, setResult] = useState<Calculation | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const client = useQueryClient();
  const prices = useQuery({ queryKey: ["decision-prices"], queryFn: api.decisionPrices, refetchInterval: 60_000 });
  const saved = useQuery({ queryKey: ["saved-calculations", token], queryFn: () => api.savedCalculations(token), enabled: unlocked });
  const options = [
    ...(prices.data?.cooperative.map((row) => ({ key: `cooperative:${row.id}`,
      reference: { kind: "cooperative", id: row.id } satisfies PriceReference,
      label: t.cooperativeOption(row.source_key.toUpperCase(), row.branch, row.variety, format.date(row.reporting_date), money(row.average_price), row.unit_status === "assumed") })) ?? []),
    ...(prices.data?.monthly.map((row) => ({ key: `monthly:${row.refresh_run_id}:${row.variety_name}`,
      reference: { kind: "monthly", month: row.reporting_month, variety: row.variety_name, refresh_run_id: row.refresh_run_id } satisfies PriceReference,
      label: t.monthlyOption(row.variety_name, format.month(row.reporting_month), money(row.weighted_price)) })) ?? []),
  ];
  const calculate = useMutation({ mutationFn: api.calculate, onSuccess: setResult, onError: (error) => { setError(error); setResult(null); } });
  const save = useMutation({
    mutationFn: (inputs: CalculationInputs) => api.saveCalculation(inputs, token),
    onSuccess: async (value) => { setResult(value); await client.invalidateQueries({ queryKey: ["saved-calculations"] }); },
    onError: setError,
  });
  const busy = calculate.isPending || save.isPending;
  function changed() { setResult(null); setError(null); calculate.reset(); save.reset(); }
  function buildInputs(): CalculationInputs {
    const reference = selection === "manual" ? { kind: "manual" as const, value: Number(manualPrice) } : options.find((option) => option.key === selection)?.reference;
    if (!reference || (selection === "manual" && !manualPrice)) throw new Error(t.selectPrice);
    if (fields.some((field) => !values[field.key].trim())) throw new Error(t.everyInput);
    const numeric = Object.fromEntries(fields.map((field) => [field.key, Number(values[field.key])])) as Record<NumericKey, number>;
    if (Object.values(numeric).some((value) => !Number.isFinite(value))) throw new Error(t.finite);
    return { ...numeric, name, price: reference };
  }
  function load(calculation: Calculation) {
    setName(calculation.inputs.name);
    setValues(Object.fromEntries(fields.map((field) => [field.key, String(calculation.inputs[field.key])])) as Record<NumericKey, string>);
    const ref = calculation.inputs.price;
    setSelection(ref.kind === "cooperative" ? `cooperative:${ref.id}` : ref.kind === "monthly" ? `monthly:${ref.refresh_run_id}:${ref.variety}` : "manual");
    setManualPrice(ref.kind === "manual" ? String(ref.value) : "");
    setResult(calculation); setError(null); save.reset(); calculate.reset();
  }
  function exportResult(value: Calculation) {
    const rows: (string | number | null)[][] = [["section", "field", "value"],
      ["metadata", "name", value.inputs.name], ["metadata", "formula_version", value.formula_version],
      ["metadata", "saved_at", value.created_at ?? null],
      ["price_snapshot", "price_unit", "INR/quintal"],
      ...Object.entries(value.price).map(([key, val]) => ["price_snapshot", key, val]),
      ...fields.map((field) => ["user_inputs", field.key, value.inputs[field.key]]),
      ...Object.entries(value.results).map(([key, val]) => ["results", key, val]),
    ];
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "areca-pulse-decision-scenario.csv"; link.click(); URL.revokeObjectURL(url);
  }
  const measureRows: [string, number][] = (["gross_realization", "selling_costs", "net_realization", "net_per_quintal", "farm_profit", "profit_per_hectare", "farm_break_even_price", "finance_cost", "hold_net_realization", "hold_advantage", "break_even_hold_price"] as const)
    .map((key) => [t.measures[key], result ? result.results[key] : 0]);
  return <div className="page-stack">
    <section className="page-heading"><div><h1>{t.title}</h1><p>{t.intro}</p></div></section>
    <AboutData title={t.before}><p>{t.beforeText}</p></AboutData>
    {prices.isLoading ? <LoadingState /> : prices.error ? <ErrorState error={prices.error} onRetry={() => void prices.refetch()} /> : <form className="page-stack" onSubmit={(event) => {
      event.preventDefault(); setError(null); try { calculate.mutate(buildInputs()); } catch (error) { setError(error instanceof Error ? error : new Error(t.invalid)); }
    }}>
      <section className="panel"><div className="panel-heading"><div><h2>{t.priceTitle}</h2><p>{t.priceHint}</p></div></div><div className="calculator-grid">
        <label className="filter-control"><span>{t.scenarioName}</span><input required maxLength={120} value={name} disabled={busy} onChange={(event) => { changed(); setName(event.target.value); }} /></label>
        <label className="filter-control calculator-wide"><span>{t.sourcePrice}</span><select required value={selection} disabled={busy} onChange={(event) => { changed(); setSelection(event.target.value); }}>
          <option value="">{t.selectOption}</option>
          {selection && selection !== "manual" && !options.some((option) => option.key === selection) && <option value={selection}>{t.savedGone}</option>}
          {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}<option value="manual">{t.manualOption}</option>
        </select></label>
        {selection === "manual" && <label className="filter-control"><span>{t.yourPrice}</span><input type="number" step="any" min="0.01" max="100000000" required value={manualPrice} disabled={busy} onChange={(event) => { changed(); setManualPrice(event.target.value); }} /></label>}
      </div></section>
      {SECTIONS.map((section) => <section className="panel" key={section}><div className="panel-heading"><div><h2>{t.sections[section].title}</h2><p>{t.sections[section].hint}</p></div></div>
        <div className="calculator-grid">{fields.filter((field) => field.section === section).map((field) => <label className="filter-control" key={field.key}><span>{t.fields[field.key]}</span><input type="number" required step={field.step ?? "any"} min={field.min} max={field.max ?? (field.key === "quantity_quintals" || field.key === "area_hectares" ? 1e7 : field.key === "scenario_price" ? 1e8 : 1e12)} value={values[field.key]} disabled={busy} onChange={(event) => { changed(); setValues((current) => ({ ...current, [field.key]: event.target.value })); }} /></label>)}</div>
      </section>)}
      <button className="button-primary" disabled={busy}>{calculate.isPending ? t.calculating : t.calculate}</button>
    </form>}
    {error && <ErrorState error={error} />}
    {result && <section className="panel" aria-label={t.resultsAria}><div className="panel-heading"><div><h2>{t.results(result.inputs.name)}</h2><p>{result.created_at ? t.savedAt(format.timestamp(result.created_at)) : t.notStored} · {result.formula_version}</p></div><button className="button-secondary" onClick={() => exportResult(result)}>{t.exportScenario}</button></div>
      <div className="monthly-details">
        <p><strong>{t.priceLine(money(result.price.value), result.price.source, result.price.unit_status.replace(/_/g, " "))}</strong></p>
        <p>{result.price.branch} · {result.price.variety} · {t.reportingPeriod(result.price.reporting_period ?? t.userEntered)} · {t.platformFetched(result.price.fetched_at ? format.timestamp(result.price.fetched_at) : t.notSourced)} · {result.price.price_type.replace(/_/g, " ")} {result.price.source_url && <a href={result.price.source_url} target="_blank" rel="noreferrer">{t.evidence}</a>}</p>
        {result.price.state && <p>{t.reportingState(result.price.state)}</p>}
        {result.price.price_type === "monthly_weighted_modal" && result.price.reference_id && <p><a href={api.monthlySnapshotUrl(result.price.reference_id)} target="_blank" rel="noreferrer">{t.archived}</a> {t.archivedNote}</p>}
        {result.price.unit_status === "assumed" && <p role="note">{t.assumedNote}</p>}
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t.outputsAria}><table><caption>{t.outputsCaption}</caption><thead><tr><th>{t.measure}</th><th className="numeric">{t.value}</th></tr></thead><tbody>
          {measureRows.map(([label, value]) => <tr key={label}><td>{label}</td><td className="numeric">{money(value)}</td></tr>)}
          <tr><td>{t.roi}</td><td className="numeric">{result.results.roi_percent === null ? t.roiUnavailable : `${result.results.roi_percent.toFixed(2)}%`}</td></tr>
          <tr><td>{t.remaining}</td><td className="numeric">{result.results.remaining_quintals.toFixed(4)} {t.quintals}</td></tr>
          <tr><td>{t.increase}</td><td className="numeric">{result.results.break_even_increase_percent.toFixed(2)}%</td></tr>
        </tbody></table></div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t.scenariosAria}><table><caption>{t.scenariosCaption}</caption><thead><tr><th>{t.scenario}</th><th>{t.futurePrice}</th><th>{t.holdNet}</th><th>{t.advantage}</th></tr></thead><tbody>
          <tr><td>{t.unchanged}</td><td>{money(result.price.value)}</td><td>{money(result.results.hold_unchanged_net_realization)}</td><td>{money(result.results.hold_unchanged_advantage)}</td></tr>
          <tr><td>{t.yours}</td><td>{money(result.inputs.scenario_price)}</td><td>{money(result.results.hold_net_realization)}</td><td>{money(result.results.hold_advantage)}</td></tr>
          <tr><td>{t.breakEven}</td><td>{money(result.results.break_even_hold_price)}</td><td>{money(result.results.net_realization)}</td><td>{money(0)}</td></tr>
        </tbody></table></div>
        <p>{t.formula}</p>
        <p>{t.notPrediction}</p>
        {result.results.net_realization < 0 && <p role="alert">{t.negative}</p>}
      </div>
    </section>}
    <section className="panel"><div className="panel-heading"><div><h2>{t.savedTitle}</h2><p>{t.savedHint}</p></div></div><div className="monthly-details">
      {!unlocked ? <form className="monthly-refresh" onSubmit={access.unlock}><label className="filter-control"><span>{t.storageToken}</span><input type="password" autoComplete="off" value={access.draft} required onChange={(event) => access.setDraft(event.target.value)} /></label><button className="button-secondary" disabled={!access.canUnlock}>{t.unlock}</button></form> : <>
        <div className="monthly-refresh"><button className="button-secondary" disabled={busy} onClick={() => { access.lock(); setResult(null); setValues(emptyValues()); setName(""); setSelection(""); setManualPrice(""); setError(null); save.reset(); }}>{t.lock}</button>
          <button className="button-primary" disabled={busy || !result || Boolean(result.id) || !saved.isSuccess} onClick={() => { if (result) { setError(null); save.mutate(result.inputs); } }}>{t.saveScenario}</button></div>
        {saved.isLoading ? <LoadingState /> : saved.error ? <ErrorState error={saved.error} onRetry={() => void saved.refetch()} /> : !saved.data?.data.length ? <EmptyState title={t.noSaved}>{t.noSavedHint}</EmptyState> : <ul>{saved.data.data.map((value) => <li key={value.id}><button className="text-button" disabled={busy} onClick={() => load(value)}>{value.inputs.name} · {value.created_at ? format.timestamp(value.created_at) : ""}</button></li>)}</ul>}
      </>}
    </div></section>
  </div>;
}

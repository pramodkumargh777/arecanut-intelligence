import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { toCsv } from "../services/csv";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { LazyBarChart } from "../components/LazyCharts";
import { INK } from "../components/chartPalette";
import { calendarDateToTime, calendarTodayIST, completedMonthIST, DAY_MS, MONTH_NAMES_EN, MONTH_NAMES_KN } from "../../../shared/dates";
import { defineCopy, useCopy, useFormat } from "../services/language";
import { COMMON } from "../services/commonCopy";

const PriceChart = lazy(() => import("../components/PriceChart").then((module) => ({ default: module.PriceChart })));
const number = (value: number | null) => value === null ? "—" : value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const completed = completedMonthIST;
function download(rows: (string | number | null)[][], name: string) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}

const COPY = defineCopy({
  en: {
    months: MONTH_NAMES_EN,
    title: "Historical analytics", intro: "Exact-variety monthly AGMARKNET reports. Calendar gaps remain missing; revisions remain traceable.",
    fromMonth: "From month", throughMonth: "Through month", monthlyVariety: "Exact monthly variety",
    invalid: "Select completed months in ascending order, from 2010 onward.",
    coverage: "PRICE COVERAGE", coverageHint: (n: number) => `${n} report months stored; missing values are not zero`,
    latestMonth: "LATEST OBSERVED MONTH", none: "None", latestHint: (fetched: string) => `Platform fetched: ${fetched}. Reporting month is a calendar period, not a timestamp.`,
    yoy: "LATEST YEAR-ON-YEAR", yoyHint: "Exact month vs same month last year; never nearest available",
    volatility: "TRAILING VOLATILITY", volatilityHint: "Annualized sample volatility of 12 consecutive monthly log returns",
    observedTitle: (variety: string) => `${variety} · Observed monthly weighted prices`, observedHint: (state: string) => `INR/quintal · State: ${state} · No interpolation`,
    noObserved: "No observed monthly prices in this range", noObservedHint: "Missing reports, absent varieties and missing prices remain distinguished in the calendar table.",
    chartLabel: (variety: string) => `${variety} · Official monthly weighted price`,
    anomaly: "Historical anomaly review", anomalyHint: (flagged: number, threshold: number, method: string) => `${flagged} flagged months · ${threshold}% adjacent-calendar-month threshold · ${method}`,
    flagsNote: "Flags are review signals, not proof that a price is wrong. Every observation remains visible and included in descriptive calculations. No outlier is deleted, replaced or interpolated. Only the same state and exact variety are compared; gaps are not treated as adjacent observations.",
    noFlags: "No observations meet these review rules in the selected range.",
    flags: null as Record<string, string> | null,
    calendar: "Calendar history and rolling statistics", calendarHint: "Rolling windows are unavailable if any required month is missing. Prices and rolling means: INR/quintal.",
    exportHistory: "Export history CSV", tableAria: "Monthly historical analytics", tableCaption: "One row per calendar month; coverage and source attempt status retained",
    month: "Month", weighted: "Weighted price", mean3: "3-month mean", mean12: "12-month mean", yoyPercent: "YoY %", volPercent: "Volatility %", sourceFreshness: "Source / freshness",
    status: { observed: "observed", price_missing: "price missing", variety_missing: "variety missing", report_missing: "report missing" } as Record<string, string>,
    flagged: "Flagged for source review; value retained", refreshFailed: (message: string) => `Latest refresh failed: ${message}`,
    noObservation: "No observation", platformFetched: (time: string) => `Platform fetched: ${time}`, notFetched: "Not fetched for this variety",
    seasonal: "Descriptive seasonal pattern", seasonalHint: (count: number, years: string) => `${count} complete years: ${years}. Requires at least 3. Index 100 = each full year's average. Not a forecast.`,
    seasonalIndex: "Seasonal index", annualMean: "Annual mean", seasonalDescription: (variety: string) => `Seasonal index for ${variety}`,
    seasonalTable: "View seasonal index table", seasonalAria: "Monthly seasonal indices", seasonalCaption: "Average year-normalized month index · Complete years only",
    calendarMonth: "Calendar month", index: "Index", completeYears: "Complete years",
    snapshots: "Source snapshots and revisions", snapshotsHint: (versions: number, changes: number) => `${versions} stored report snapshots; ${changes} consecutive value or presence changes for their month. Identical re-fetches are not price revisions.`,
    inspectVersions: "Inspect all captured versions", versionsAria: "Monthly source versions", versionsCaption: "Historical snapshots are retained even after a source correction or removed variety",
    pricePresence: "Price / presence", fetchedAt: "Fetched at", captured: "Captured report", absent: "Variety absent from this snapshot", archivedCsv: "Download archived CSV", officialCsv: "Official CSV",
    methodology: "Rolling means require every calendar month in the window; rolling statistics and YoY use up to 12 stored months before the selected range as lookback. Volatility: sample standard deviation of 12 consecutive monthly log returns, annualized by sqrt(12). Seasonality: monthly price / full-year mean × 100, averaged across at least 3 complete years within the selected range. Descriptive only, not a forecast. Missing months and varieties are not filled. Monthly state-level arrival-weighted modal prices are not daily quotes.",
    backfill: "Refresh a single month in Monthly Trends. To resume the approved local backfill:", backfillAfter: "Failed source requests remain recorded; re-run retries missing reports. No inference is made that every supported month is available.",
    compare: "Compare source and imported value",
    evidenceLine: (state: string, variety: string, month: string) => `${state} · ${variety} · Market reporting month: ${month}`,
    originalValue: "Original captured source value:", rawToken: "Raw imported token:", reparsed: (value: string) => `Reparsed value: ${value} INR/quintal.`, retained: "Retained normalized version:", unitUnavailable: "Unit unavailable",
    capturedRow: "Captured row (variety, primary price, previous-month price, prior-year price, reported changes):",
    evidenceFetched: (time: string) => `Source publication timestamp: not supplied. Platform fetched: ${time}.`,
    evidenceExplanation: null as string | null, downloadCapture: "Download immutable source capture",
    daily: "Weekly / monthly captured daily quotations", dailyHint: "Partial captured history only. Never converts official monthly reports into daily observations.",
    dailySource: "Daily source", dailyVariety: "Daily exact variety", noRecords: "No records", aggregation: "Aggregation", weekly: "Weekly (Monday start)", monthly: "Monthly",
    fromDay: "From day", throughDay: "Through day",
    dailyUnit: (source: string, confirmed: boolean) => `${source} · INR/quintal${confirmed ? " — source-confirmed" : " — operator assumption"} · Coverage is captured reporting days / calendar days, not complete trading days.`,
    bothDates: "Select both daily aggregation dates.", noCaptured: "No captured quotations for this selection", exportAggregates: "Export aggregates CSV",
    aggregatesAria: "Captured daily aggregates", aggregatesCaption: "Equal-weight average of captured daily branch averages; empty periods remain empty",
    period: "Period", mean: "Mean · INR/qtl", minDaily: "Min daily average", maxDaily: "Max daily average", reportedMissing: "Reported / missing dates", noCapturedRecord: "No captured record",
    dailyMethodology: (assumed: boolean) => `Equal-weight arithmetic mean of captured daily reported averages for one exact variety and branch. Coverage is observed days / calendar days in the selected range, not a claim about trading-day completeness. No interpolation or volume weighting.${assumed ? " TSS and TUMCOS INR/quintal is an operator assumption." : ""} Not the official monthly arrival-weighted report.`,
    underlying: (n: number) => `Underlying source observations (${n})`,
  },
  kn: {
    months: MONTH_NAMES_KN,
    title: "ಐತಿಹಾಸಿಕ ವಿಶ್ಲೇಷಣೆ", intro: "ನಿಖರ ತಳಿಯ AGMARKNET ತಿಂಗಳ ವರದಿಗಳು. ಇಲ್ಲದ ತಿಂಗಳುಗಳು ಖಾಲಿಯಾಗಿಯೇ ಇರುತ್ತವೆ; ತಿದ್ದುಪಡಿಗಳನ್ನು ಪತ್ತೆಹಚ್ಚಬಹುದು.",
    fromMonth: "ಇಂದ (ತಿಂಗಳು)", throughMonth: "ವರೆಗೆ (ತಿಂಗಳು)", monthlyVariety: "ನಿಖರ ತಿಂಗಳ ತಳಿ",
    invalid: "2010 ರಿಂದ ಮುಂದಿನ, ಮುಗಿದ ತಿಂಗಳುಗಳನ್ನು ಏರಿಕೆ ಕ್ರಮದಲ್ಲಿ ಆಯ್ಕೆಮಾಡಿ.",
    coverage: "ದರದ ವ್ಯಾಪ್ತಿ", coverageHint: (n: number) => `${n} ವರದಿ ತಿಂಗಳುಗಳು ಸಂಗ್ರಹವಾಗಿವೆ; ಇಲ್ಲದ ಮೌಲ್ಯ ಸೊನ್ನೆಯಲ್ಲ`,
    latestMonth: "ಇತ್ತೀಚಿನ ದಾಖಲಿತ ತಿಂಗಳು", none: "ಯಾವುದೂ ಇಲ್ಲ", latestHint: (fetched: string) => `ತಂದ ಸಮಯ: ${fetched}. ವರದಿ ತಿಂಗಳು ಒಂದು ಕ್ಯಾಲೆಂಡರ್ ಅವಧಿ, ಸಮಯವಲ್ಲ.`,
    yoy: "ಇತ್ತೀಚಿನ ವರ್ಷದಿಂದ ವರ್ಷದ ಬದಲಾವಣೆ", yoyHint: "ಅದೇ ತಿಂಗಳನ್ನು ಕಳೆದ ವರ್ಷದ ಅದೇ ತಿಂಗಳಿಗೆ ಹೋಲಿಸಲಾಗಿದೆ; ಹತ್ತಿರದ ತಿಂಗಳನ್ನು ಎಂದೂ ಬಳಸುವುದಿಲ್ಲ",
    volatility: "ಇತ್ತೀಚಿನ ಏರಿಳಿತ", volatilityHint: "ಸತತ 12 ತಿಂಗಳ ದರ ಬದಲಾವಣೆಗಳ ವಾರ್ಷಿಕ ಏರಿಳಿತ",
    observedTitle: (variety: string) => `${variety} · ದಾಖಲಿತ ತಿಂಗಳ ತೂಕದ ಸರಾಸರಿ ದರಗಳು`, observedHint: (state: string) => `₹/ಕ್ವಿಂಟಾಲ್ · ರಾಜ್ಯ: ${state} · ಖಾಲಿ ಜಾಗ ತುಂಬುವುದಿಲ್ಲ`,
    noObserved: "ಈ ಅವಧಿಯಲ್ಲಿ ದಾಖಲಿತ ತಿಂಗಳ ದರಗಳಿಲ್ಲ", noObservedHint: "ಇಲ್ಲದ ವರದಿ, ಇಲ್ಲದ ತಳಿ ಮತ್ತು ಇಲ್ಲದ ದರಗಳನ್ನು ಕ್ಯಾಲೆಂಡರ್ ಪಟ್ಟಿಯಲ್ಲಿ ಪ್ರತ್ಯೇಕವಾಗಿ ತೋರಿಸಲಾಗಿದೆ.",
    chartLabel: (variety: string) => `${variety} · ಅಧಿಕೃತ ತಿಂಗಳ ತೂಕದ ಸರಾಸರಿ ದರ`,
    anomaly: "ಅಸಾಮಾನ್ಯ ದರಗಳ ಪರಿಶೀಲನೆ", anomalyHint: (flagged: number, threshold: number, method: string) => `${flagged} ಗುರುತಿಸಿದ ತಿಂಗಳುಗಳು · ಪಕ್ಕದ ತಿಂಗಳಿಗೆ ${threshold}% ಮಿತಿ · ${method}`,
    flagsNote: "ಗುರುತುಗಳು ಪರಿಶೀಲನೆಯ ಸೂಚನೆಗಳು ಮಾತ್ರ, ದರ ತಪ್ಪು ಎಂಬುದಕ್ಕೆ ಸಾಕ್ಷಿಯಲ್ಲ. ಪ್ರತಿ ದಾಖಲೆಯೂ ಕಾಣಿಸುತ್ತದೆ ಮತ್ತು ಲೆಕ್ಕದಲ್ಲಿ ಸೇರಿರುತ್ತದೆ. ಯಾವುದನ್ನೂ ಅಳಿಸುವುದಿಲ್ಲ, ಬದಲಿಸುವುದಿಲ್ಲ. ಅದೇ ರಾಜ್ಯ ಮತ್ತು ನಿಖರ ತಳಿಯನ್ನು ಮಾತ್ರ ಹೋಲಿಸಲಾಗುತ್ತದೆ; ಖಾಲಿ ತಿಂಗಳುಗಳನ್ನು ಪಕ್ಕದ ತಿಂಗಳು ಎಂದು ಪರಿಗಣಿಸುವುದಿಲ್ಲ.",
    noFlags: "ಆಯ್ದ ಅವಧಿಯಲ್ಲಿ ಯಾವ ದಾಖಲೆಯೂ ಈ ಪರಿಶೀಲನಾ ನಿಯಮಗಳಿಗೆ ಒಳಪಟ್ಟಿಲ್ಲ.",
    flags: {
      large_change_from_previous: "ಹಿಂದಿನ ತಿಂಗಳಿಗಿಂತ 20% ಕ್ಕಿಂತ ಹೆಚ್ಚು ಬದಲಾವಣೆ. ಬಳಸುವ ಮೊದಲು ಮೂಲ ವರದಿಯನ್ನು ಪರಿಶೀಲಿಸಿ.",
      large_change_to_next: "ಮುಂದಿನ ತಿಂಗಳಿಗೆ 20% ಕ್ಕಿಂತ ಹೆಚ್ಚು ಬದಲಾವಣೆ. ಬಳಸುವ ಮೊದಲು ಮೂಲ ವರದಿಯನ್ನು ಪರಿಶೀಲಿಸಿ.",
      unexpected_unit: "ಸಂಗ್ರಹಿಸಿದ ಘಟಕ ₹/ಕ್ವಿಂಟಾಲ್ ಅಲ್ಲ. ಬಳಸುವ ಮೊದಲು ಮೂಲದ ಆಧಾರವನ್ನು ಪರಿಶೀಲಿಸಿ.",
      nonpositive_price: "ಸೊನ್ನೆ ಅಥವಾ ಅಮಾನ್ಯ ದರ. ಪರಿಶೀಲನೆಗಾಗಿ ಉಳಿಸಲಾಗಿದೆ; ಬದಲಿಸಿಲ್ಲ ಅಥವಾ ಅಳಿಸಿಲ್ಲ.",
      version_missing: "ಈ ಸಂಗ್ರಹಕ್ಕೆ ಪರಿವರ್ತಿತ ಆವೃತ್ತಿ ಉಳಿದಿಲ್ಲ. ಮೂಲದ ಹೋಲಿಕೆ ಅಪೂರ್ಣ.",
      source_import_mismatch: "ಉಳಿಸಿದ ಮೌಲ್ಯ ಅಥವಾ ಘಟಕ ಮೂಲದ ಮುಖ್ಯ ಕಾಲಮ್‌ಗಿಂತ ಬೇರೆಯಾಗಿದೆ. ಆಮದನ್ನು ಪರಿಶೀಲಿಸಿ; ಯಾವ ಮೌಲ್ಯವನ್ನೂ ಬದಲಿಸಿಲ್ಲ.",
    },
    calendar: "ಕ್ಯಾಲೆಂಡರ್ ಇತಿಹಾಸ ಮತ್ತು ಚಲಿಸುವ ಸರಾಸರಿಗಳು", calendarHint: "ಅಗತ್ಯವಿರುವ ಯಾವುದೇ ತಿಂಗಳು ಇಲ್ಲದಿದ್ದರೆ ಚಲಿಸುವ ಸರಾಸರಿ ಲಭ್ಯವಿಲ್ಲ. ದರಗಳು ಮತ್ತು ಸರಾಸರಿಗಳು: ₹/ಕ್ವಿಂಟಾಲ್.",
    exportHistory: "ಇತಿಹಾಸ CSV ಡೌನ್‌ಲೋಡ್", tableAria: "ತಿಂಗಳ ಐತಿಹಾಸಿಕ ವಿಶ್ಲೇಷಣೆ", tableCaption: "ಪ್ರತಿ ಕ್ಯಾಲೆಂಡರ್ ತಿಂಗಳಿಗೆ ಒಂದು ಸಾಲು; ವ್ಯಾಪ್ತಿ ಮತ್ತು ಸಂಗ್ರಹದ ಸ್ಥಿತಿ ಉಳಿಸಲಾಗಿದೆ",
    month: "ತಿಂಗಳು", weighted: "ತೂಕದ ಸರಾಸರಿ ದರ", mean3: "3 ತಿಂಗಳ ಸರಾಸರಿ", mean12: "12 ತಿಂಗಳ ಸರಾಸರಿ", yoyPercent: "ವಾರ್ಷಿಕ ಬದಲಾವಣೆ %", volPercent: "ಏರಿಳಿತ %", sourceFreshness: "ಮೂಲ / ಹೊಸತನ",
    status: { observed: "ದಾಖಲಾಗಿದೆ", price_missing: "ದರ ಇಲ್ಲ", variety_missing: "ತಳಿ ಇಲ್ಲ", report_missing: "ವರದಿ ಇಲ್ಲ" },
    flagged: "ಮೂಲ ಪರಿಶೀಲನೆಗೆ ಗುರುತಿಸಲಾಗಿದೆ; ಮೌಲ್ಯ ಉಳಿಸಲಾಗಿದೆ", refreshFailed: (message: string) => `ಇತ್ತೀಚಿನ ನವೀಕರಣ ವಿಫಲ: ${message}`,
    noObservation: "ದಾಖಲೆ ಇಲ್ಲ", platformFetched: (time: string) => `ತಂದ ಸಮಯ: ${time}`, notFetched: "ಈ ತಳಿಗೆ ತಂದಿಲ್ಲ",
    seasonal: "ಋತುಮಾನದ ಮಾದರಿ", seasonalHint: (count: number, years: string) => `${count} ಪೂರ್ಣ ವರ್ಷಗಳು: ${years}. ಕನಿಷ್ಠ 3 ಬೇಕು. ಸೂಚ್ಯಂಕ 100 = ಆ ವರ್ಷದ ಸರಾಸರಿ. ಮುನ್ಸೂಚನೆ ಅಲ್ಲ.`,
    seasonalIndex: "ಋತುಮಾನ ಸೂಚ್ಯಂಕ", annualMean: "ವಾರ್ಷಿಕ ಸರಾಸರಿ", seasonalDescription: (variety: string) => `${variety} ಋತುಮಾನ ಸೂಚ್ಯಂಕ`,
    seasonalTable: "ಋತುಮಾನ ಸೂಚ್ಯಂಕ ಪಟ್ಟಿ ನೋಡಿ", seasonalAria: "ತಿಂಗಳ ಋತುಮಾನ ಸೂಚ್ಯಂಕಗಳು", seasonalCaption: "ವರ್ಷದ ಸರಾಸರಿಗೆ ಹೋಲಿಸಿದ ತಿಂಗಳ ಸೂಚ್ಯಂಕ · ಪೂರ್ಣ ವರ್ಷಗಳು ಮಾತ್ರ",
    calendarMonth: "ಕ್ಯಾಲೆಂಡರ್ ತಿಂಗಳು", index: "ಸೂಚ್ಯಂಕ", completeYears: "ಪೂರ್ಣ ವರ್ಷಗಳು",
    snapshots: "ಮೂಲದ ಸಂಗ್ರಹಗಳು ಮತ್ತು ತಿದ್ದುಪಡಿಗಳು", snapshotsHint: (versions: number, changes: number) => `${versions} ವರದಿ ಸಂಗ್ರಹಗಳು; ಅವುಗಳ ತಿಂಗಳಿಗೆ ${changes} ಸತತ ಮೌಲ್ಯ ಅಥವಾ ಇರುವಿಕೆಯ ಬದಲಾವಣೆಗಳು. ಒಂದೇ ರೀತಿಯ ಮರುಸಂಗ್ರಹಗಳು ದರ ತಿದ್ದುಪಡಿಗಳಲ್ಲ.`,
    inspectVersions: "ಸಂಗ್ರಹಿಸಿದ ಎಲ್ಲಾ ಆವೃತ್ತಿಗಳನ್ನು ನೋಡಿ", versionsAria: "ತಿಂಗಳ ಮೂಲ ಆವೃತ್ತಿಗಳು", versionsCaption: "ಮೂಲ ತಿದ್ದುಪಡಿ ಅಥವಾ ತಳಿ ತೆಗೆದ ನಂತರವೂ ಹಳೆಯ ಸಂಗ್ರಹಗಳನ್ನು ಉಳಿಸಲಾಗುತ್ತದೆ",
    pricePresence: "ದರ / ಇರುವಿಕೆ", fetchedAt: "ತಂದ ಸಮಯ", captured: "ಸಂಗ್ರಹಿಸಿದ ವರದಿ", absent: "ಈ ಸಂಗ್ರಹದಲ್ಲಿ ತಳಿ ಇಲ್ಲ", archivedCsv: "ಸಂಗ್ರಹಿಸಿದ CSV ಡೌನ್‌ಲೋಡ್", officialCsv: "ಅಧಿಕೃತ CSV",
    methodology: "ಚಲಿಸುವ ಸರಾಸರಿಗೆ ಅವಧಿಯ ಪ್ರತಿ ತಿಂಗಳೂ ಬೇಕು; ಚಲಿಸುವ ಅಂಕಿಗಳು ಮತ್ತು ವಾರ್ಷಿಕ ಬದಲಾವಣೆಗೆ ಆಯ್ದ ಅವಧಿಗೆ ಮೊದಲಿನ 12 ತಿಂಗಳವರೆಗೆ ಬಳಸಲಾಗುತ್ತದೆ. ಏರಿಳಿತ: ಸತತ 12 ತಿಂಗಳ ಲಾಗ್ ಬದಲಾವಣೆಗಳ ಪ್ರಮಾಣಿತ ವಿಚಲನ, √12 ರಿಂದ ವಾರ್ಷಿಕಗೊಳಿಸಲಾಗಿದೆ. ಋತುಮಾನ: ತಿಂಗಳ ದರ / ವರ್ಷದ ಸರಾಸರಿ × 100, ಕನಿಷ್ಠ 3 ಪೂರ್ಣ ವರ್ಷಗಳ ಸರಾಸರಿ. ವಿವರಣೆ ಮಾತ್ರ, ಮುನ್ಸೂಚನೆ ಅಲ್ಲ. ಇಲ್ಲದ ತಿಂಗಳು ಮತ್ತು ತಳಿಗಳನ್ನು ತುಂಬುವುದಿಲ್ಲ. ರಾಜ್ಯ ಮಟ್ಟದ ಆವಕ ಆಧಾರಿತ ತಿಂಗಳ ದರಗಳು ದೈನಂದಿನ ದರಗಳಲ್ಲ.",
    backfill: "ಒಂದು ತಿಂಗಳನ್ನು ತಿಂಗಳ ಪ್ರವೃತ್ತಿ ಪುಟದಲ್ಲಿ ನವೀಕರಿಸಿ. ಅನುಮೋದಿತ ಸ್ಥಳೀಯ ಹಿಂದಿನ ದತ್ತಾಂಶ ಸಂಗ್ರಹ ಮುಂದುವರಿಸಲು:", backfillAfter: "ವಿಫಲವಾದ ವಿನಂತಿಗಳು ದಾಖಲಾಗಿರುತ್ತವೆ; ಮತ್ತೆ ನಡೆಸಿದರೆ ಇಲ್ಲದ ವರದಿಗಳನ್ನು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸುತ್ತದೆ. ಎಲ್ಲಾ ತಿಂಗಳುಗಳೂ ಲಭ್ಯ ಎಂದು ಊಹಿಸುವುದಿಲ್ಲ.",
    compare: "ಮೂಲ ಮತ್ತು ಆಮದು ಮೌಲ್ಯ ಹೋಲಿಸಿ",
    evidenceLine: (state: string, variety: string, month: string) => `${state} · ${variety} · ಮಾರುಕಟ್ಟೆ ವರದಿ ತಿಂಗಳು: ${month}`,
    originalValue: "ಮೂಲದಲ್ಲಿ ಸಂಗ್ರಹಿಸಿದ ಮೌಲ್ಯ:", rawToken: "ಆಮದು ಮಾಡಿದ ಮೂಲ ಪಠ್ಯ:", reparsed: (value: string) => `ಮತ್ತೆ ಓದಿದ ಮೌಲ್ಯ: ${value} ₹/ಕ್ವಿಂಟಾಲ್.`, retained: "ಉಳಿಸಿದ ಪರಿವರ್ತಿತ ಆವೃತ್ತಿ:", unitUnavailable: "ಘಟಕ ಲಭ್ಯವಿಲ್ಲ",
    capturedRow: "ಸಂಗ್ರಹಿಸಿದ ಸಾಲು (ತಳಿ, ಮುಖ್ಯ ದರ, ಹಿಂದಿನ ತಿಂಗಳ ದರ, ಕಳೆದ ವರ್ಷದ ದರ, ವರದಿಯಾದ ಬದಲಾವಣೆಗಳು):",
    evidenceFetched: (time: string) => `ಮೂಲದ ಪ್ರಕಟಣೆ ಸಮಯ ನೀಡಿಲ್ಲ. ತಂದ ಸಮಯ: ${time}.`,
    evidenceExplanation: "ಮೂಲದ ಆಧಾರ ಎಂದರೆ ಈ ಆಮದು ಸಂಗ್ರಹಿಸಿದ CSV, ಹೊಸದಾಗಿ ತಂದದ್ದಲ್ಲ. ಮುಖ್ಯ ₹/ಕ್ವಿಂಟಾಲ್ ಕಾಲಮ್ ಅನ್ನು ಬದಲಿಸದೆ ಓದಲಾಗುತ್ತದೆ; ಹೋಲಿಕೆ ಕಾಲಮ್‌ಗಳನ್ನು ಆಮದು ಮಾಡುವುದಿಲ್ಲ. ಈ ಮೂಲ ಪ್ರಕಟಣೆ ಸಮಯ ನೀಡುವುದಿಲ್ಲ.",
    downloadCapture: "ಬದಲಾಗದ ಮೂಲ ಸಂಗ್ರಹ ಡೌನ್‌ಲೋಡ್",
    daily: "ಸಂಗ್ರಹಿಸಿದ ದೈನಂದಿನ ದರಗಳ ವಾರ / ತಿಂಗಳ ಸರಾಸರಿ", dailyHint: "ಸಂಗ್ರಹಿಸಿದ ಭಾಗಶಃ ಇತಿಹಾಸ ಮಾತ್ರ. ಅಧಿಕೃತ ತಿಂಗಳ ವರದಿಗಳನ್ನು ದೈನಂದಿನ ದಾಖಲೆಗಳಾಗಿ ಎಂದೂ ಪರಿವರ್ತಿಸುವುದಿಲ್ಲ.",
    dailySource: "ದೈನಂದಿನ ಮೂಲ", dailyVariety: "ದೈನಂದಿನ ನಿಖರ ತಳಿ", noRecords: "ದಾಖಲೆಗಳಿಲ್ಲ", aggregation: "ಸರಾಸರಿಯ ಅವಧಿ", weekly: "ವಾರಕ್ಕೊಮ್ಮೆ (ಸೋಮವಾರದಿಂದ)", monthly: "ತಿಂಗಳಿಗೊಮ್ಮೆ",
    fromDay: "ಇಂದ (ದಿನ)", throughDay: "ವರೆಗೆ (ದಿನ)",
    dailyUnit: (source: string, confirmed: boolean) => `${source} · ₹/ಕ್ವಿಂಟಾಲ್${confirmed ? " — ಮೂಲದಿಂದ ದೃಢಪಟ್ಟಿದೆ" : " — ನಿರ್ವಾಹಕರ ಊಹೆ"} · ವ್ಯಾಪ್ತಿ = ಸಂಗ್ರಹಿಸಿದ ವರದಿ ದಿನಗಳು / ಕ್ಯಾಲೆಂಡರ್ ದಿನಗಳು, ಸಂಪೂರ್ಣ ವಹಿವಾಟು ದಿನಗಳಲ್ಲ.`,
    bothDates: "ಎರಡೂ ದಿನಾಂಕಗಳನ್ನು ಆಯ್ಕೆಮಾಡಿ.", noCaptured: "ಈ ಆಯ್ಕೆಗೆ ಸಂಗ್ರಹಿಸಿದ ದರಗಳಿಲ್ಲ", exportAggregates: "ಸರಾಸರಿಗಳ CSV ಡೌನ್‌ಲೋಡ್",
    aggregatesAria: "ಸಂಗ್ರಹಿಸಿದ ದೈನಂದಿನ ಸರಾಸರಿಗಳು", aggregatesCaption: "ಸಂಗ್ರಹಿಸಿದ ದೈನಂದಿನ ಶಾಖೆ ಸರಾಸರಿಗಳ ಸಮಾನ ತೂಕದ ಸರಾಸರಿ; ಖಾಲಿ ಅವಧಿಗಳು ಖಾಲಿಯಾಗಿಯೇ ಇರುತ್ತವೆ",
    period: "ಅವಧಿ", mean: "ಸರಾಸರಿ · ₹/ಕ್ವಿಂ", minDaily: "ಕನಿಷ್ಠ ದೈನಂದಿನ ಸರಾಸರಿ", maxDaily: "ಗರಿಷ್ಠ ದೈನಂದಿನ ಸರಾಸರಿ", reportedMissing: "ವರದಿಯಾದ / ಇಲ್ಲದ ದಿನಗಳು", noCapturedRecord: "ಸಂಗ್ರಹಿಸಿದ ದಾಖಲೆ ಇಲ್ಲ",
    dailyMethodology: (assumed: boolean) => `ಒಂದು ನಿಖರ ತಳಿ ಮತ್ತು ಶಾಖೆಗೆ ಸಂಗ್ರಹಿಸಿದ ದೈನಂದಿನ ವರದಿಯಾದ ಸರಾಸರಿಗಳ ಸಮಾನ ತೂಕದ ಸರಾಸರಿ. ವ್ಯಾಪ್ತಿ = ದಾಖಲಾದ ದಿನಗಳು / ಆಯ್ದ ಅವಧಿಯ ಕ್ಯಾಲೆಂಡರ್ ದಿನಗಳು. ಖಾಲಿ ಜಾಗ ತುಂಬುವುದಿಲ್ಲ, ಪ್ರಮಾಣದ ತೂಕ ಇಲ್ಲ.${assumed ? " TSS ಮತ್ತು TUMCOS ₹/ಕ್ವಿಂಟಾಲ್ ನಿರ್ವಾಹಕರ ಊಹೆ." : ""} ಇದು ಅಧಿಕೃತ ತಿಂಗಳ ಆವಕ ಆಧಾರಿತ ವರದಿಯಲ್ಲ.`,
    underlying: (n: number) => `ಮೂಲ ದಾಖಲೆಗಳು (${n})`,
  },
});

export function HistoricalAnalyticsPage() {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const format = useFormat();
  const [from, setFrom] = useState("2021-01"), [to, setTo] = useState(completed), [variety, setVariety] = useState("Rashi");
  const valid = from >= "2010-01" && from <= to && to <= completed();
  const query = useQuery({ queryKey: ["history", from, to, variety], queryFn: () => api.monthlyHistory(from, to, variety), enabled: valid, refetchInterval: 60_000 });
  const data = query.data;
  const latest = data?.points.filter((point) => point.weighted_price !== null).at(-1);
  const changes = data?.versions.filter((row, index, versions) => {
    const prior = versions.slice(0, index).filter((value) => value.reporting_month === row.reporting_month).at(-1);
    return prior !== undefined && (prior.weighted_price !== row.weighted_price || prior.variety_present !== row.variety_present);
  }) ?? [];
  const flagText = (flag: { code: string; explanation: string }) => t.flags?.[flag.code] ?? flag.explanation;
  return <div className="page-stack">
    <section className="page-heading"><div><h1>{t.title}</h1><p>{t.intro}</p></div></section>
    <section className="filter-bar">
      <label className="filter-control"><span>{t.fromMonth}</span><input type="month" min="2010-01" max={completed()} value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="filter-control"><span>{t.throughMonth}</span><input type="month" min="2010-01" max={completed()} value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <label className="filter-control"><span>{t.monthlyVariety}</span><select value={variety} onChange={(event) => setVariety(event.target.value)}>{[...new Set([variety, ...(data?.varieties ?? [])])].map((value) => <option key={value} lang="en">{value}</option>)}</select></label>
    </section>
    {!valid ? <ErrorState error={new Error(t.invalid)} /> : query.isLoading ? <LoadingState /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : data && <>
      <section className="snapshot-grid">
        <article className="snapshot-card"><div className="card-kicker">{t.coverage}</div><div className="snapshot-value">{data.observed_months} / {data.expected_months}</div><p>{t.coverageHint(data.reporting_months)}</p></article>
        <article className="snapshot-card"><div className="card-kicker">{t.latestMonth}</div><div className="snapshot-value">{latest ? format.month(latest.reporting_month) : t.none}</div><p>{t.latestHint(latest?.fetched_at ? format.timestamp(latest.fetched_at) : c.never)}</p></article>
        <article className="snapshot-card"><div className="card-kicker">{t.yoy}</div><div className="snapshot-value">{number(latest?.yoy_percent ?? null)}{latest?.yoy_percent != null ? "%" : ""}</div><p>{t.yoyHint}</p></article>
        <article className="snapshot-card"><div className="card-kicker">{t.volatility}</div><div className="snapshot-value">{number(latest?.volatility_percent ?? null)}{latest?.volatility_percent != null ? "%" : ""}</div><p>{t.volatilityHint}</p></article>
      </section>
      <section className="panel"><div className="panel-heading"><div><h2>{t.observedTitle(variety)}</h2><p>{t.observedHint(data.state)}</p></div></div>
        {!data.observed_months ? <EmptyState title={t.noObserved}>{t.noObservedHint}</EmptyState>
          : <Suspense fallback={<LoadingState />}><PriceChart label={t.chartLabel(variety)} quotePoints={data.points.flatMap((row) => row.weighted_price === null ? [] : [{ reporting_date: `${row.reporting_month}-01`, average_price: row.weighted_price }])} calendarInterval="monthly" range={{ from: `${from}-01`, to: `${to}-01` }} /></Suspense>}
      </section>
      <section className="panel"><div className="panel-heading"><div><h2>{t.anomaly}</h2><p>{t.anomalyHint(data.flagged_months, data.anomaly_threshold_percent, data.review_method)}</p></div></div><div className="monthly-details">
        <p>{t.flagsNote}</p>
        {!data.flagged_months && <p>{t.noFlags}</p>}
        {data.points.filter((row) => row.review_flags.length > 0).map((row) => <article key={row.reporting_month}><h3>{format.month(row.reporting_month)} · {variety} · {number(row.weighted_price)} {row.price_unit}</h3><ul>{row.review_flags.map((flag) => <li key={flag.code}>{flagText(flag)}</li>)}</ul>{row.refresh_run_id && <MonthlyEvidenceReview id={row.refresh_run_id} variety={variety} />}</article>)}
      </div></section>
      <section className="panel table-panel"><div className="panel-heading"><div><h2>{t.calendar}</h2><p>{t.calendarHint}</p></div><button className="button-secondary" onClick={() => download([
        ["month", "weighted_price", "price_unit", "status", "review_flags", "review_explanations", "rolling_3", "rolling_12", "yoy_percent", "volatility_percent", "source_url", "fetched_at", "refresh_run_id"],
        ...data.points.map((row) => [row.reporting_month, row.weighted_price, row.price_unit, row.status, row.review_flags.map((flag) => flag.code).join("; "), row.review_flags.map((flag) => flag.explanation).join("; "), row.rolling_3, row.rolling_12, row.yoy_percent, row.volatility_percent, row.source_url, row.fetched_at, row.refresh_run_id]),
      ], "areca-pulse-monthly-history.csv")}>{t.exportHistory}</button></div>
        <div className="table-scroll table-tall" tabIndex={0} role="region" aria-label={t.tableAria}><table><caption>{t.tableCaption}</caption><thead><tr><th>{t.month}</th><th>{c.status}</th><th className="numeric">{t.weighted}</th><th className="numeric">{t.mean3}</th><th className="numeric">{t.mean12}</th><th className="numeric">{t.yoyPercent}</th><th className="numeric">{t.volPercent}</th><th>{t.sourceFreshness}</th></tr></thead><tbody>
          {data.points.map((row) => <tr key={row.reporting_month}><td>{format.month(row.reporting_month)}</td><td>{t.status[row.status] ?? row.status.replace(/_/g, " ")}{row.review_flags.length > 0 && <small className="quote-fetch" role="note">{t.flagged}</small>}{row.latest_attempt?.status === "failed" && <small className="quote-fetch" role="note">{t.refreshFailed(row.latest_attempt.error_message ?? "")}</small>}</td><td className="numeric">{number(row.weighted_price)}</td><td className="numeric">{number(row.rolling_3)}</td><td className="numeric">{number(row.rolling_12)}</td><td className="numeric">{number(row.yoy_percent)}</td><td className="numeric">{number(row.volatility_percent)}</td><td>{row.source_url ? <a href={row.source_url} target="_blank" rel="noreferrer">AGMARKNET CSV</a> : t.noObservation}<small className="quote-fetch">{row.fetched_at ? t.platformFetched(format.timestamp(row.fetched_at)) : t.notFetched}</small>{row.refresh_run_id && <MonthlyEvidenceReview id={row.refresh_run_id} variety={variety} />}</td></tr>)}
        </tbody></table></div>
      </section>
      <section className="panel table-panel"><div className="panel-heading"><div><h2>{t.seasonal}</h2><p>{t.seasonalHint(data.seasonal_years.length, data.seasonal_years.join(", ") || t.none)}</p></div></div>
        {data.seasonal.some((row) => row.index !== null) && <LazyBarChart categories={data.seasonal.map((row) => t.months[row.month - 1].slice(0, t.months === MONTH_NAMES_EN ? 3 : undefined))} values={data.seasonal.map((row) => row.index)} name={t.seasonalIndex} valueFormat="index" referenceLine={{ value: 100, label: t.annualMean }} description={t.seasonalDescription(variety)} color={(index) => (data.seasonal[index]?.index ?? 100) >= 100 ? INK[900] : INK[400]} />}
        <details className="chart-data">
        <summary>{t.seasonalTable}</summary>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t.seasonalAria}><table><caption>{t.seasonalCaption}</caption><thead><tr><th>{t.calendarMonth}</th><th className="numeric">{t.index}</th><th className="numeric">{t.completeYears}</th></tr></thead><tbody>{data.seasonal.map((row) => <tr key={row.month}><td>{t.months[row.month - 1]}</td><td className="numeric">{number(row.index)}</td><td className="numeric">{row.complete_years}</td></tr>)}</tbody></table></div>
        </details>
      </section>
      <section className="panel"><div className="panel-heading"><div><h2>{t.snapshots}</h2><p>{t.snapshotsHint(data.versions.length, changes.length)}</p></div></div><div className="monthly-details"><details><summary>{t.inspectVersions}</summary><div className="table-scroll" tabIndex={0} role="region" aria-label={t.versionsAria}><table><caption>{t.versionsCaption}</caption><thead><tr><th>{t.month}</th><th>{t.pricePresence}</th><th>{t.fetchedAt}</th><th>{t.captured}</th><th>{c.source}</th></tr></thead><tbody>{data.versions.map((row) => <tr key={`${row.reporting_month}:${row.refresh_run_id}`}><td>{format.month(row.reporting_month)}</td><td>{row.variety_present ? number(row.weighted_price) : t.absent}</td><td>{format.timestamp(row.fetched_at)}</td><td><a href={api.monthlySnapshotUrl(row.refresh_run_id)} target="_blank" rel="noreferrer">{t.archivedCsv}</a></td><td><a href={row.source_url} target="_blank" rel="noreferrer">{t.officialCsv}</a></td></tr>)}</tbody></table></div></details><p>{t.methodology}</p><p>{t.backfill} <code>npm run backfill:monthly -- 2021-01 2026-10</code>. {t.backfillAfter}</p></div></section>
    </>}
    <DailyAggregation />
  </div>;
}

function MonthlyEvidenceReview({ id, variety }: { id: string; variety: string }) {
  const t = useCopy(COPY);
  const format = useFormat();
  const [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: ["monthly-evidence", id, variety], queryFn: () => api.monthlyEvidence(id, variety), enabled: open });
  const evidence = query.data;
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}><summary>{t.compare}</summary>
    {open && (query.isLoading ? <LoadingState /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : evidence && <div className="monthly-details">
      <p>{t.evidenceLine(evidence.state, evidence.variety, format.month(evidence.reporting_month))}</p>
      <p>{t.originalValue} <strong>{evidence.source_value}</strong> {evidence.source_unit}. {t.rawToken} <strong>{evidence.raw_imported_value}</strong>. {t.reparsed(number(evidence.reparsed_value))} {t.retained} <strong>{number(evidence.normalized_value)}</strong> {evidence.normalized_unit ?? t.unitUnavailable}.</p>
      <p>{t.capturedRow} <code>{JSON.stringify(evidence.source_columns)}</code></p>
      <p>{t.evidenceFetched(format.timestamp(evidence.fetched_at))}</p>
      {evidence.review_flags.map((flag) => <p role="alert" key={flag.code}>{t.flags?.[flag.code] ?? flag.explanation}</p>)}
      <p>{t.evidenceExplanation ?? evidence.explanation}</p><a href={api.monthlySnapshotUrl(id)} target="_blank" rel="noreferrer">{t.downloadCapture}</a>
    </div>)}
  </details>;
}

function DailyAggregation() {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const format = useFormat();
  const [source, setSource] = useState<"mamcos" | "tss" | "tumcos">("mamcos"), [variety, setVariety] = useState("RASHI EDI"), [branch, setBranch] = useState("");
  const [from, setFrom] = useState(() => new Date(calendarDateToTime(calendarTodayIST()) - 60 * DAY_MS).toISOString().slice(0, 10)), [to, setTo] = useState(calendarTodayIST), [interval, setInterval] = useState("weekly");
  const quotes = useQuery({ queryKey: ["cooperative", source, variety], queryFn: () => api.cooperativePrices(source, variety) });
  const branches = quotes.data?.branches ?? [...new Set(quotes.data?.data.map((row) => row.branch) ?? [])].sort();
  const selectedBranch = branches.includes(branch) ? branch : branches[0] ?? "";
  const query = useQuery({ queryKey: ["aggregates", source, variety, selectedBranch, from, to, interval],
    queryFn: () => api.aggregates({ source, variety, branch: selectedBranch, from, to, interval }), enabled: Boolean(selectedBranch && from && to) });
  const data = query.data;
  return <section className="panel table-panel"><div className="panel-heading"><div><h2>{t.daily}</h2><p>{t.dailyHint}</p></div></div>
    <div className="filter-bar">
      <label className="filter-control"><span>{t.dailySource}</span><select value={source} onChange={(event) => { const next = event.target.value === "tss" || event.target.value === "tumcos" ? event.target.value : "mamcos"; setSource(next); setVariety(next === "tss" ? "RASHI" : next === "tumcos" ? "areca" : "RASHI EDI"); setBranch(""); }}><option value="mamcos">MAMCOS</option><option value="tss">TSS</option><option value="tumcos">TUMCOS</option></select></label>
      <label className="filter-control"><span>{t.dailyVariety}</span><select value={variety} onChange={(event) => setVariety(event.target.value)}>{[...new Set([variety, ...(quotes.data?.varieties ?? [])])].map((value) => <option key={value} lang="en">{value}</option>)}</select></label>
      <label className="filter-control"><span>{c.branch}</span><select value={selectedBranch} onChange={(event) => setBranch(event.target.value)}>{!branches.length && <option value="">{t.noRecords}</option>}{branches.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="filter-control"><span>{t.aggregation}</span><select value={interval} onChange={(event) => setInterval(event.target.value)}><option value="weekly">{t.weekly}</option><option value="monthly">{t.monthly}</option></select></label>
      <label className="filter-control"><span>{t.fromDay}</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="filter-control"><span>{t.throughDay}</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
    </div>
    <div className="data-disclosure">{t.dailyUnit(source.toUpperCase(), source === "mamcos")}</div>
    {!from || !to ? <ErrorState error={new Error(t.bothDates)} /> : quotes.error ? <ErrorState error={quotes.error} /> : !selectedBranch ? <EmptyState title={t.noCaptured} /> : query.isLoading ? <LoadingState /> : query.error ? <ErrorState error={query.error} /> : data && <>
      <button className="button-secondary" style={{ margin: "12px 0" }} onClick={() => download([["period", "from", "to", "source", "branch", "variety", "mean_average_price", "price_unit", "reporting_days", "calendar_days", "unit_status", "fetched_at"],
        ...data.data.map((row) => [row.period, row.from, row.to, source, selectedBranch, variety, row.mean_average_price, "INR/quintal", row.reporting_days, row.calendar_days, row.unit_status, row.fetched_at])], "areca-pulse-captured-aggregates.csv")}>{t.exportAggregates}</button>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={t.aggregatesAria}><table><caption>{t.aggregatesCaption}</caption><thead><tr><th>{t.period}</th><th className="numeric">{t.mean}</th><th className="numeric">{t.minDaily}</th><th className="numeric">{t.maxDaily}</th><th className="numeric">{t.reportedMissing}</th><th>{t.fetchedAt}</th></tr></thead><tbody>{data.data.map((row) => <tr key={row.period}><td>{format.date(row.from)} – {format.date(row.to)}</td><td className="numeric">{number(row.mean_average_price)}</td><td className="numeric">{number(row.minimum_average)}</td><td className="numeric">{number(row.maximum_average)}</td><td className="numeric">{row.reporting_days} / {row.calendar_days - row.reporting_days}</td><td>{row.fetched_at ? format.timestamp(row.fetched_at) : t.noCapturedRecord}</td></tr>)}</tbody></table></div>
      <div className="monthly-details"><p>{t.dailyMethodology(source !== "mamcos")}</p><details><summary>{t.underlying(data.observations.length)}</summary>{data.observations.map((row) => <p key={row.reporting_date}>{format.date(row.reporting_date)} · {number(row.average_price)} · <a href={row.source_url} target="_blank" rel="noreferrer">{c.source}</a> · {t.platformFetched(format.timestamp(row.fetched_at))}</p>)}</details></div>
    </>}
  </section>;
}

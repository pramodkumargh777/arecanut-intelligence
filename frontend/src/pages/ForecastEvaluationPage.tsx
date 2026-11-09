import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { showsValues } from "../services/forecasting";
import { defineCopy, useCopy, useFormat } from "../services/language";
import { LazyBarChart } from "../components/LazyCharts";
import { SourceLabel, StatusBadge } from "../components/Scorecard";
import { useChartPalette } from "../components/chartPalette";
import { useTheme } from "../services/theme";
import { AboutData } from "../components/AboutData";
import { ForecastShowcase } from "../components/ForecastShowcase";
import type { ModelEvaluation } from "../services/forecasting";

const num = (value: number | null | undefined, digits = 0) => value == null ? "—" : value.toLocaleString("en-IN", { maximumFractionDigits: digits });
const pct = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const label = (value: string) => value.replace(/_/g, " ");

/** Kannada names for the data-vintage modes the API reports ("revised" or "strict"). */
const VINTAGE_KN: Record<string, string> = { revised: "ಪರಿಷ್ಕೃತ", strict: "ಮೂಲ ಪ್ರಕಟಿತ" };

const COPY = defineCopy({
  en: {
    status: { reference: "Reference baseline", candidate: "Candidate", not_better_than_baseline: "Not better than baseline", validated: "Validated", revoked: "Revoked" } as Record<string, string>,
    publication: { validated_forecast: "Validated (prospective outcomes)", experimental_candidate: "Experimental candidate · awaiting prospective confirmation", reference_baseline: "Reference baseline estimate", not_published: "Withheld · not better than baseline" } as Record<string, string>,
    title: "Forecast model evaluation",
    intro: "How well can arecanut prices be forecast? Statistical, machine-learning and AI models are tested month by month on past prices against simple rules.",
    existing: "Existing monthly reference baselines", unchanged: "remain unchanged.",
    about: "Models are compared only within one price basis. Official monthly state-weighted prices, daily APMC modal prices, MAMCOS cooperative averages and TSS tender prices are never pooled. A model is labelled validated only after enough prospective outcomes, recorded after the forecast was saved, beat its baseline.",
    noExperiment: "No forecasting experiment published", runFrom: "Run", runAfter: "from data-platform against real observations. No results are invented to fill this page.",
    experiment: "EXPERIMENT", origins: (n: number) => `${n} origins`, vintages: (mode: string) => `${mode} vintages`,
    execution: "FORECAST EXECUTION", lastPeriod: (period: string) => `Last market period used: ${period}. Not a market reporting date.`,
    evaluationStatus: "EVALUATION STATUS", candidates: (n: number) => `${n} candidates`,
    outcomes: "PROSPECTIVE OUTCOMES", events: (validated: number, revoked: number) => `${validated} validated · ${revoked} revoked model events`,
    datasets: "Datasets by price basis",
    datasetsAria: "Forecasting datasets", dataset: "Dataset", priceBasis: "Price basis", frequencyUnit: "Frequency / unit", series: "Series (eligible)", observations: "Observations", statusCol: "Status",
    suppressed: (reasons: string) => `Suppressed: ${reasons}`, evaluated: "Evaluated", notEligible: "Not publication eligible",
    horizon: "Horizon (months)", all: "All", evaluationStatusFilter: "Evaluation status",
    pooled: "Pooled walk-forward metrics", pooledHint: "INR/quintal errors across all eligible monthly series · relative MAE below 1.00 means lower error than the better naive baseline in-sample, not a proven edge",
    pooledAria: "Pooled metrics", model: "Model", horizonCol: "Horizon", forecasts: "Forecasts", direction: "Direction", coverage80: "80% coverage", width: "Interval width", relative: "Relative MAE",
    relativeTitle: "Error relative to the best naive baseline",
    relativeHint: (horizon: string) => `Horizon ${horizon} · pooled MAE ÷ better of last value and seasonal naive · below 1.00 is lower error in backtests; dark bars beat the baseline, light bars match it or are worse`,
    relativeDarkHint: (horizon: string) => `Horizon ${horizon} · pooled MAE ÷ better of last value and seasonal naive · below 1.00 is lower error in backtests; bright bars beat the baseline, muted bars match it or are worse`,
    beating: (n: number) => `${n} model${n === 1 ? "" : "s"} below 1.00 pooled · see per-series status`, noneBeating: "No model beats the baseline",
    noRelative: "No relative metrics for this horizon", baseline: "Baseline", relativeDescription: (horizon: string) => `Relative MAE by model at horizon ${horizon}`,
    backtestsSource: (id: string, mode: string) => `Walk-forward backtests · experiment ${id} · ${mode} vintages`,
    coverageTitle: "Prediction interval coverage", coverageHint: "Share of backtest actuals inside the 80% interval · dark bars are within 5 points of 80%; far below 80% means intervals are too narrow",
    coverageDarkHint: "Share of backtest actuals inside the 80% interval · bright bars are within 5 points of 80%; far below 80% means intervals are too narrow",
    noIntervals: "No interval forecasts at this horizon", intervalCoverage: "Interval coverage", nominal: "Nominal 80%", coverageDescription: (horizon: string) => `Interval coverage by model at horizon ${horizon}`,
    widthSource: "Walk-forward backtests · interval width shown in the table above",
    perSeries: "Per-series evaluations", perSeriesHint: "Each model is compared with the better of last value and seasonal naive for the same series and horizon",
    noEvaluations: "No evaluations match", changeFilters: "Change the filters.", evaluationsAria: "Model evaluations",
    variety: "Variety", baselineCol: "Baseline", skill: "MAE skill", coverage: "Coverage", reasons: "Reasons",
    onPage: (n: number) => `${n} evaluations on this page`, previous: "Previous", next: "Next",
    saved: "Latest saved predictions", savedHint: (withheld: number) => `Stored before outcomes are known. ${withheld} predictions from models that did not beat their baseline are withheld. Values are not statements that prices will rise or fall.`,
    noPredictions: "No publishable predictions", allWithheld: "Every model was withheld for this experiment.", predictionsAria: "Stored predictions",
    varietyBasis: "Variety · basis", targetMonth: "Target month", median: "Median", interval: "Interval", lastObserved: (period: string) => `Last observed (${period})`, publicationCol: "Publication", actual: "Actual",
    notObserved: "Not yet observed", withError: (actual: string, error: string) => `${actual} (error ${error})`,
    prospective: "Prospective performance", prospectiveHint: (n: number) => `Forecasts matched to outcomes ingested after they were saved · validation needs at least ${n} paired outcomes`,
    noOutcomes: "No prospective outcomes yet", noOutcomesHint: "Outcomes are matched when new monthly reporting data arrives. No outcome is simulated.", performanceAria: "Prospective performance",
    outcomesCol: "Outcomes", baselineMae: "Baseline MAE", ratio: "MAE ratio",
    legacy: "Comparison with the existing monthly baseline", legacyHint: "Legacy holdout MAE versus engine MAE on the same holdout months (INR/quintal, horizon 1)", legacyAria: "Legacy comparison",
    legacyModel: "Legacy model", holdoutMonths: "Holdout months", legacyMae: "Legacy MAE", withheld: " (withheld)",
    technical: "Technical details", technicalHint: "Every metric, dataset and stored prediction behind the summary above",
    limitations: "Limitations",
    essentials: ["Experimental: tested on past prices only, not a promise of future accuracy.", "Forecasts are 80% ranges, not buy or sell signals.", "Each price source is evaluated on its own and never combined with another."],
    openSource: "Built with open-source tools:",
  },
  kn: {
    status: { reference: "ಉಲ್ಲೇಖ ಮೂಲ ಅಂದಾಜು", candidate: "ಪ್ರಾಯೋಗಿಕ ಅಭ್ಯರ್ಥಿ", not_better_than_baseline: "ಮೂಲ ಅಂದಾಜಿಗಿಂತ ಉತ್ತಮವಲ್ಲ", validated: "ದೃಢೀಕರಿಸಲಾಗಿದೆ", revoked: "ಹಿಂಪಡೆಯಲಾಗಿದೆ" },
    publication: { validated_forecast: "ದೃಢೀಕರಿಸಲಾಗಿದೆ (ಮುಂದಿನ ಫಲಿತಾಂಶಗಳು)", experimental_candidate: "ಪ್ರಾಯೋಗಿಕ ಅಭ್ಯರ್ಥಿ · ಮುಂದಿನ ದೃಢೀಕರಣಕ್ಕೆ ಕಾಯುತ್ತಿದೆ", reference_baseline: "ಉಲ್ಲೇಖ ಮೂಲ ಅಂದಾಜು", not_published: "ತಡೆಹಿಡಿಯಲಾಗಿದೆ · ಮೂಲ ಅಂದಾಜಿಗಿಂತ ಉತ್ತಮವಲ್ಲ" },
    title: "ಮುನ್ಸೂಚನಾ ಮಾದರಿಗಳ ಮೌಲ್ಯಮಾಪನ",
    intro: "ಅಡಿಕೆ ದರವನ್ನು ಎಷ್ಟು ನಿಖರವಾಗಿ ಊಹಿಸಬಹುದು? ಸಾಂಖ್ಯಿಕ, ಯಂತ್ರ ಕಲಿಕೆ ಮತ್ತು AI ಮಾದರಿಗಳನ್ನು ಹಿಂದಿನ ದರಗಳಲ್ಲಿ ತಿಂಗಳು ತಿಂಗಳು ಸರಳ ನಿಯಮಗಳ ವಿರುದ್ಧ ಪರೀಕ್ಷಿಸಲಾಗಿದೆ.",
    existing: "ಈಗಿನ ತಿಂಗಳ ಉಲ್ಲೇಖ ಅಂದಾಜುಗಳು", unchanged: "ಬದಲಾಗದೆ ಉಳಿದಿವೆ.",
    about: "ಮಾದರಿಗಳನ್ನು ಒಂದೇ ದರದ ಆಧಾರದೊಳಗೆ ಮಾತ್ರ ಹೋಲಿಸಲಾಗುತ್ತದೆ. ಅಧಿಕೃತ ತಿಂಗಳ ರಾಜ್ಯ ಸರಾಸರಿ, ದೈನಂದಿನ ಎಪಿಎಂಸಿ ಮಾದರಿ ದರ, MAMCOS ಸರಾಸರಿ ಮತ್ತು TSS ಟೆಂಡರ್ ದರಗಳನ್ನು ಎಂದೂ ಬೆರೆಸುವುದಿಲ್ಲ. ಮುನ್ಸೂಚನೆ ಉಳಿಸಿದ ನಂತರ ದಾಖಲಾದ ಸಾಕಷ್ಟು ಫಲಿತಾಂಶಗಳು ಮೂಲ ಅಂದಾಜನ್ನು ಮೀರಿದಾಗ ಮಾತ್ರ ಮಾದರಿಯನ್ನು ದೃಢೀಕರಿಸಲಾಗುತ್ತದೆ.",
    noExperiment: "ಯಾವುದೇ ಮುನ್ಸೂಚನಾ ಪ್ರಯೋಗ ಪ್ರಕಟವಾಗಿಲ್ಲ", runFrom: "ನಿಜವಾದ ದಾಖಲೆಗಳ ಮೇಲೆ data-platform ಇಂದ", runAfter: "ನಡೆಸಿ. ಈ ಪುಟ ತುಂಬಲು ಯಾವುದೇ ಫಲಿತಾಂಶ ಕಲ್ಪಿಸುವುದಿಲ್ಲ.",
    experiment: "ಪ್ರಯೋಗ", origins: (n: number) => `${n} ಆರಂಭ ಬಿಂದುಗಳು`, vintages: (mode: string) => `${VINTAGE_KN[mode] ?? mode} ಆವೃತ್ತಿಗಳು`,
    execution: "ಮುನ್ಸೂಚನೆ ನಡೆಸಿದ ಸಮಯ", lastPeriod: (period: string) => `ಬಳಸಿದ ಕೊನೆಯ ಮಾರುಕಟ್ಟೆ ಅವಧಿ: ${period}. ಇದು ಮಾರುಕಟ್ಟೆ ವರದಿ ದಿನಾಂಕವಲ್ಲ.`,
    evaluationStatus: "ಮೌಲ್ಯಮಾಪನ ಸ್ಥಿತಿ", candidates: (n: number) => `${n} ಅಭ್ಯರ್ಥಿಗಳು`,
    outcomes: "ಮುಂದಿನ ಫಲಿತಾಂಶಗಳು", events: (validated: number, revoked: number) => `${validated} ದೃಢೀಕೃತ · ${revoked} ಹಿಂಪಡೆದ ಮಾದರಿ ಘಟನೆಗಳು`,
    datasets: "ದರದ ಆಧಾರವಾರು ದತ್ತಾಂಶ",
    datasetsAria: "ಮುನ್ಸೂಚನಾ ದತ್ತಾಂಶ", dataset: "ದತ್ತಾಂಶ", priceBasis: "ದರದ ಆಧಾರ", frequencyUnit: "ಆವರ್ತನ / ಘಟಕ", series: "ಸರಣಿಗಳು (ಅರ್ಹ)", observations: "ದಾಖಲೆಗಳು", statusCol: "ಸ್ಥಿತಿ",
    suppressed: (reasons: string) => `ತಡೆಹಿಡಿಯಲಾಗಿದೆ: ${reasons}`, evaluated: "ಮೌಲ್ಯಮಾಪನವಾಗಿದೆ", notEligible: "ಪ್ರಕಟಣೆಗೆ ಅರ್ಹವಲ್ಲ",
    horizon: "ಮುಂದಿನ ಅವಧಿ (ತಿಂಗಳು)", all: "ಎಲ್ಲಾ", evaluationStatusFilter: "ಮೌಲ್ಯಮಾಪನ ಸ್ಥಿತಿ",
    pooled: "ಒಟ್ಟು ಹಂತ ಹಂತದ ಅಂಕಿಗಳು", pooledHint: "ಎಲ್ಲಾ ಅರ್ಹ ತಿಂಗಳ ಸರಣಿಗಳ ₹/ಕ್ವಿಂಟಾಲ್ ದೋಷಗಳು · ಸಾಪೇಕ್ಷ MAE 1.00 ಕ್ಕಿಂತ ಕಡಿಮೆ ಎಂದರೆ ಉತ್ತಮ ಸರಳ ಅಂದಾಜಿಗಿಂತ ಕಡಿಮೆ ದೋಷ, ಸಾಬೀತಾದ ಲಾಭವಲ್ಲ",
    pooledAria: "ಒಟ್ಟು ಅಂಕಿಗಳು", model: "ಮಾದರಿ", horizonCol: "ಅವಧಿ", forecasts: "ಮುನ್ಸೂಚನೆಗಳು", direction: "ದಿಕ್ಕು", coverage80: "80% ವ್ಯಾಪ್ತಿ", width: "ಶ್ರೇಣಿಯ ಅಗಲ", relative: "ಸಾಪೇಕ್ಷ MAE",
    relativeTitle: "ಉತ್ತಮ ಸರಳ ಅಂದಾಜಿಗೆ ಹೋಲಿಸಿದ ದೋಷ",
    relativeHint: (horizon: string) => `ಅವಧಿ ${horizon} · ಒಟ್ಟು MAE ÷ ಕೊನೆಯ ಮೌಲ್ಯ ಮತ್ತು ಋತುಮಾನ ಸರಳದಲ್ಲಿ ಉತ್ತಮದು · 1.00 ಕ್ಕಿಂತ ಕಡಿಮೆ = ಕಡಿಮೆ ದೋಷ; ಗಾಢ ಪಟ್ಟಿಗಳು ಮೂಲ ಅಂದಾಜನ್ನು ಮೀರಿವೆ, ತಿಳಿ ಪಟ್ಟಿಗಳು ಸಮ ಅಥವಾ ಕೆಟ್ಟದು`,
    relativeDarkHint: (horizon: string) => `ಅವಧಿ ${horizon} · ಒಟ್ಟು MAE ÷ ಉತ್ತಮ ಮೂಲ ಅಂದಾಜು · 1.00 ಕ್ಕಿಂತ ಕಡಿಮೆ = ಕಡಿಮೆ ದೋಷ; ಪ್ರಕಾಶಮಾನ ಪಟ್ಟಿಗಳು ಮೂಲ ಅಂದಾಜನ್ನು ಮೀರಿವೆ, ಮಸುಕಾದವು ಸಮ ಅಥವಾ ಕೆಟ್ಟದು`,
    beating: (n: number) => `${n} ${n === 1 ? "ಮಾದರಿ" : "ಮಾದರಿಗಳು"} ಒಟ್ಟಾರೆ 1.00 ಕ್ಕಿಂತ ಕಡಿಮೆ · ಸರಣಿವಾರು ಸ್ಥಿತಿ ನೋಡಿ`, noneBeating: "ಯಾವ ಮಾದರಿಯೂ ಮೂಲ ಅಂದಾಜನ್ನು ಮೀರಿಲ್ಲ",
    noRelative: "ಈ ಅವಧಿಗೆ ಸಾಪೇಕ್ಷ ಅಂಕಿಗಳಿಲ್ಲ", baseline: "ಮೂಲ ಅಂದಾಜು", relativeDescription: (horizon: string) => `ಅವಧಿ ${horizon} ರಲ್ಲಿ ಮಾದರಿವಾರು ಸಾಪೇಕ್ಷ MAE`,
    backtestsSource: (id: string, mode: string) => `ಹಂತ ಹಂತದ ಪರೀಕ್ಷೆಗಳು · ಪ್ರಯೋಗ ${id} · ${VINTAGE_KN[mode] ?? mode} ಆವೃತ್ತಿಗಳು`,
    coverageTitle: "ಮುನ್ಸೂಚನಾ ಶ್ರೇಣಿ ವ್ಯಾಪ್ತಿ", coverageHint: "80% ಶ್ರೇಣಿಯೊಳಗೆ ಬಿದ್ದ ನಿಜವಾದ ದರಗಳ ಪಾಲು · ಗಾಢ ಪಟ್ಟಿಗಳು 80% ಗೆ 5 ಅಂಕಗಳೊಳಗೆ; 80% ಕ್ಕಿಂತ ತುಂಬಾ ಕಡಿಮೆ ಎಂದರೆ ಶ್ರೇಣಿ ತುಂಬಾ ಕಿರಿದು",
    coverageDarkHint: "80% ಶ್ರೇಣಿಯೊಳಗೆ ಬಿದ್ದ ನಿಜವಾದ ದರಗಳ ಪಾಲು · ಪ್ರಕಾಶಮಾನ ಪಟ್ಟಿಗಳು 80% ಗೆ 5 ಅಂಕಗಳೊಳಗೆ; ತುಂಬಾ ಕಡಿಮೆ ಎಂದರೆ ಶ್ರೇಣಿ ತುಂಬಾ ಕಿರಿದು",
    noIntervals: "ಈ ಅವಧಿಗೆ ಶ್ರೇಣಿ ಮುನ್ಸೂಚನೆಗಳಿಲ್ಲ", intervalCoverage: "ಶ್ರೇಣಿ ವ್ಯಾಪ್ತಿ", nominal: "ಗುರಿ 80%", coverageDescription: (horizon: string) => `ಅವಧಿ ${horizon} ರಲ್ಲಿ ಮಾದರಿವಾರು ಶ್ರೇಣಿ ವ್ಯಾಪ್ತಿ`,
    widthSource: "ಹಂತ ಹಂತದ ಪರೀಕ್ಷೆಗಳು · ಶ್ರೇಣಿಯ ಅಗಲ ಮೇಲಿನ ಪಟ್ಟಿಯಲ್ಲಿದೆ",
    perSeries: "ಸರಣಿವಾರು ಮೌಲ್ಯಮಾಪನಗಳು", perSeriesHint: "ಪ್ರತಿ ಮಾದರಿಯನ್ನು ಅದೇ ಸರಣಿ ಮತ್ತು ಅವಧಿಗೆ ಕೊನೆಯ ಮೌಲ್ಯ ಮತ್ತು ಋತುಮಾನ ಸರಳದಲ್ಲಿ ಉತ್ತಮದರೊಂದಿಗೆ ಹೋಲಿಸಲಾಗಿದೆ",
    noEvaluations: "ಹೊಂದುವ ಮೌಲ್ಯಮಾಪನಗಳಿಲ್ಲ", changeFilters: "ಫಿಲ್ಟರ್ ಬದಲಿಸಿ.", evaluationsAria: "ಮಾದರಿ ಮೌಲ್ಯಮಾಪನಗಳು",
    variety: "ತಳಿ", baselineCol: "ಮೂಲ ಅಂದಾಜು", skill: "MAE ಸುಧಾರಣೆ", coverage: "ವ್ಯಾಪ್ತಿ", reasons: "ಕಾರಣಗಳು",
    onPage: (n: number) => `ಈ ಪುಟದಲ್ಲಿ ${n} ಮೌಲ್ಯಮಾಪನಗಳು`, previous: "ಹಿಂದಿನದು", next: "ಮುಂದಿನದು",
    saved: "ಇತ್ತೀಚಿನ ಉಳಿಸಿದ ಮುನ್ಸೂಚನೆಗಳು", savedHint: (withheld: number) => `ಫಲಿತಾಂಶ ತಿಳಿಯುವ ಮೊದಲೇ ಉಳಿಸಲಾಗಿದೆ. ಮೂಲ ಅಂದಾಜನ್ನು ಮೀರದ ಮಾದರಿಗಳ ${withheld} ಮುನ್ಸೂಚನೆಗಳನ್ನು ತಡೆಹಿಡಿಯಲಾಗಿದೆ. ಮೌಲ್ಯಗಳು ದರ ಏರುತ್ತದೆ ಅಥವಾ ಇಳಿಯುತ್ತದೆ ಎಂಬ ಹೇಳಿಕೆಗಳಲ್ಲ.`,
    noPredictions: "ಪ್ರಕಟಿಸಬಹುದಾದ ಮುನ್ಸೂಚನೆಗಳಿಲ್ಲ", allWithheld: "ಈ ಪ್ರಯೋಗದಲ್ಲಿ ಎಲ್ಲಾ ಮಾದರಿಗಳನ್ನೂ ತಡೆಹಿಡಿಯಲಾಗಿದೆ.", predictionsAria: "ಉಳಿಸಿದ ಮುನ್ಸೂಚನೆಗಳು",
    varietyBasis: "ತಳಿ · ಆಧಾರ", targetMonth: "ಗುರಿ ತಿಂಗಳು", median: "ಮಧ್ಯಮ", interval: "ಶ್ರೇಣಿ", lastObserved: (period: string) => `ಕೊನೆಯ ದಾಖಲೆ (${period})`, publicationCol: "ಪ್ರಕಟಣೆ", actual: "ನಿಜವಾದ ದರ",
    notObserved: "ಇನ್ನೂ ದಾಖಲಾಗಿಲ್ಲ", withError: (actual: string, error: string) => `${actual} (ದೋಷ ${error})`,
    prospective: "ಮುಂದಿನ ಫಲಿತಾಂಶಗಳ ಕಾರ್ಯಕ್ಷಮತೆ", prospectiveHint: (n: number) => `ಉಳಿಸಿದ ನಂತರ ಬಂದ ಫಲಿತಾಂಶಗಳೊಂದಿಗೆ ಹೊಂದಿಸಿದ ಮುನ್ಸೂಚನೆಗಳು · ದೃಢೀಕರಣಕ್ಕೆ ಕನಿಷ್ಠ ${n} ಜೋಡಿ ಫಲಿತಾಂಶಗಳು ಬೇಕು`,
    noOutcomes: "ಇನ್ನೂ ಮುಂದಿನ ಫಲಿತಾಂಶಗಳಿಲ್ಲ", noOutcomesHint: "ಹೊಸ ತಿಂಗಳ ವರದಿ ಬಂದಾಗ ಫಲಿತಾಂಶಗಳನ್ನು ಹೊಂದಿಸಲಾಗುತ್ತದೆ. ಯಾವುದೇ ಫಲಿತಾಂಶವನ್ನು ಕಲ್ಪಿಸುವುದಿಲ್ಲ.", performanceAria: "ಮುಂದಿನ ಕಾರ್ಯಕ್ಷಮತೆ",
    outcomesCol: "ಫಲಿತಾಂಶಗಳು", baselineMae: "ಮೂಲ ಅಂದಾಜಿನ MAE", ratio: "MAE ಅನುಪಾತ",
    legacy: "ಈಗಿನ ತಿಂಗಳ ಮೂಲ ಅಂದಾಜಿನೊಂದಿಗೆ ಹೋಲಿಕೆ", legacyHint: "ಅದೇ ಪರೀಕ್ಷಾ ತಿಂಗಳುಗಳಲ್ಲಿ ಹಳೆಯ MAE ಮತ್ತು ಹೊಸ ವ್ಯವಸ್ಥೆಯ MAE (₹/ಕ್ವಿಂಟಾಲ್, ಅವಧಿ 1)", legacyAria: "ಹಳೆಯ ಹೋಲಿಕೆ",
    legacyModel: "ಹಳೆಯ ಮಾದರಿ", holdoutMonths: "ಪರೀಕ್ಷಾ ತಿಂಗಳುಗಳು", legacyMae: "ಹಳೆಯ MAE", withheld: " (ತಡೆಹಿಡಿಯಲಾಗಿದೆ)",
    technical: "ತಾಂತ್ರಿಕ ವಿವರಗಳು", technicalHint: "ಮೇಲಿನ ಸಾರಾಂಶದ ಹಿಂದಿನ ಎಲ್ಲ ಅಳತೆಗಳು, ದತ್ತಾಂಶ ಮತ್ತು ಉಳಿಸಿದ ಅಂದಾಜುಗಳು",
    limitations: "ಮಿತಿಗಳು",
    essentials: ["ಪ್ರಾಯೋಗಿಕ: ಹಿಂದಿನ ದರಗಳ ಮೇಲೆ ಮಾತ್ರ ಪರೀಕ್ಷಿಸಲಾಗಿದೆ, ಮುಂದಿನ ನಿಖರತೆಯ ಭರವಸೆ ಅಲ್ಲ.", "ಅಂದಾಜುಗಳು 80% ಶ್ರೇಣಿಗಳು, ಖರೀದಿ ಅಥವಾ ಮಾರಾಟ ಸಲಹೆ ಅಲ್ಲ.", "ಪ್ರತಿ ದರ ಮೂಲವನ್ನು ಪ್ರತ್ಯೇಕವಾಗಿ ಪರೀಕ್ಷಿಸಲಾಗುತ್ತದೆ; ಬೇರೆ ಮೂಲದೊಂದಿಗೆ ಬೆರೆಸುವುದಿಲ್ಲ."],
    openSource: "ಬಳಸಿದ ಮುಕ್ತ ತಂತ್ರಾಂಶ:",
  },
});

export function ForecastEvaluationPage() {
  const { INK } = useChartPalette();
  const dark = useTheme() === "dark";
  const t = useCopy(COPY);
  const format = useFormat();
  const statusText = (value: string) => t.status[value] ?? label(value);
  const [status, setStatus] = useState(""), [horizon, setHorizon] = useState("1");
  // The cursors of the pages visited so far; the last is the page shown and `undefined` is the first page.
  const [cursors, setCursors] = useState<(number | undefined)[]>([undefined]);
  const cursor = cursors.at(-1);
  const overview = useQuery({ queryKey: ["forecasting-overview"], queryFn: () => api.forecastingOverview() });
  const experimentId = overview.data?.experiment?.id;
  const evaluations = useQuery({
    queryKey: ["forecasting-evaluations", experimentId, status, horizon, cursor],
    enabled: Boolean(experimentId),
    queryFn: () => api.forecastingEvaluations({ experiment_id: experimentId, status: status || undefined, horizon: horizon || undefined, after: cursor?.toString(), limit: "50" }),
  });
  const predictions = useQuery({ queryKey: ["forecasting-predictions", experimentId], enabled: Boolean(experimentId), queryFn: () => api.forecastingPredictions({ experiment_id: experimentId, limit: "500" }) });
  const performance = useQuery({ queryKey: ["forecasting-performance"], queryFn: () => api.forecastingPerformance() });
  // Every evaluation of the experiment (a few hundred rows), for the verdicts and leaderboard.
  const allEvaluations = useQuery({
    queryKey: ["forecasting-evaluations-all", experimentId], enabled: Boolean(experimentId),
    queryFn: async () => {
      const rows: ModelEvaluation[] = [];
      let after: number | null | undefined;
      do {
        const page = await api.forecastingEvaluations({ experiment_id: experimentId, limit: "500", after: after?.toString() });
        rows.push(...page.data);
        after = page.next_after;
      } while (after != null && rows.length < 5000);
      return rows;
    },
  });

  const resetPaging = () => setCursors([undefined]);
  const experiment = overview.data?.experiment, meta = experiment?.metadata;
  const pooled = (meta?.pooled ?? []).filter((row) => !horizon || row.horizon === Number(horizon)).sort((a, b) => (a.mae ?? Infinity) - (b.mae ?? Infinity));
  const shownPredictions = (predictions.data?.data ?? []).filter((row) => showsValues(row.publication));
  const withheldPredictions = (predictions.data?.data.length ?? 0) - shownPredictions.length;
  const engineModels = Array.from(new Set((meta?.legacy_comparison ?? []).flatMap((row) => Object.keys(row.engine_mae)))).sort();

  return <div className="page-stack">
    <section className="page-heading"><div><h1>{t.title}</h1>
      <p>{t.intro} <Link to="/forecasts">{t.existing}</Link> {t.unchanged}</p></div></section>
    <AboutData><p>{t.about}</p></AboutData>
    {overview.isLoading ? <LoadingState /> : overview.error ? <ErrorState error={overview.error} onRetry={() => void overview.refetch()} /> : !experiment ? <EmptyState title={t.noExperiment}>{t.runFrom} <code>python -m forecasting run --publish</code> {t.runAfter}</EmptyState> : <>
      {allEvaluations.isLoading ? <LoadingState /> : allEvaluations.error ? <ErrorState error={allEvaluations.error} onRetry={() => void allEvaluations.refetch()} />
        : <ForecastShowcase evaluations={allEvaluations.data ?? []} track={meta?.track?.series} trackModel={meta?.track?.model}
          predictions={predictions.data?.data ?? []} performance={performance.data} />}

      {/* Everything below is the full record for readers who want the statistics; it stays folded by default. */}
      <details className="fx-technical"><summary>{t.technical}<small>{t.technicalHint}</small></summary><div className="page-stack">
      <section className="snapshot-grid">
        <article className="snapshot-card"><div className="card-kicker">{t.experiment}</div><div className="snapshot-value">{t.origins(experiment.origins_evaluated)}</div><p>{experiment.id} · {experiment.engine_version} · {t.vintages(experiment.vintage_mode)}</p></article>
        <article className="snapshot-card"><div className="card-kicker">{t.execution}</div><div className="snapshot-value snapshot-date">{format.timestamp(experiment.created_at)}</div><p>{t.lastPeriod(experiment.origin_period)}</p></article>
        <article className="snapshot-card"><div className="card-kicker">{t.evaluationStatus}</div><div className="snapshot-value">{t.candidates(overview.data?.status_counts.candidate ?? 0)}</div><p>{Object.entries(overview.data?.status_counts ?? {}).map(([key, value]) => `${statusText(key)}: ${value}`).join(" · ")}</p></article>
        <article className="snapshot-card"><div className="card-kicker">{t.outcomes}</div><div className="snapshot-value">{overview.data?.totals.outcomes ?? 0}</div><p>{t.events(overview.data?.totals.validated_events ?? 0, overview.data?.totals.revoked_events ?? 0)}</p></article>
      </section>

      <section className="panel table-panel"><div className="panel-heading"><div><h2>{t.datasets}</h2></div></div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t.datasetsAria}><table><thead><tr><th>{t.dataset}</th><th>{t.priceBasis}</th><th>{t.frequencyUnit}</th><th>{t.series}</th><th>{t.observations}</th><th>{t.statusCol}</th></tr></thead><tbody>
          {(meta?.datasets ?? []).map((row) => <tr key={row.key}><td>{row.key}<br /><small lang="en">{row.provenance}</small></td><td>{label(row.price_basis)}</td><td>{row.frequency} · {row.unit} ({label(row.unit_status)})</td><td>{row.series_total} ({row.series_eligible})</td><td>{num(row.observations)}</td>
            <td>{row.suppressed ? t.suppressed(row.suppression_reasons.map(label).join(", ")) : row.publication_eligible ? t.evaluated : t.notEligible}</td></tr>)}
        </tbody></table></div></section>

      <section className="filter-bar">
        <label className="filter-control"><span>{t.horizon}</span><select value={horizon} onChange={(event) => { setHorizon(event.target.value); resetPaging(); }}><option value="">{t.all}</option>{(meta?.config?.horizons ?? [1, 2, 3]).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="filter-control"><span>{t.evaluationStatusFilter}</span><select value={status} onChange={(event) => { setStatus(event.target.value); resetPaging(); }}><option value="">{t.all}</option><option value="candidate">{t.status.candidate}</option><option value="reference">{t.status.reference}</option><option value="not_better_than_baseline">{t.status.not_better_than_baseline}</option></select></label>
      </section>

      <section className="panel table-panel"><div className="panel-heading"><div><h2>{t.pooled}</h2><p>{t.pooledHint}</p></div></div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t.pooledAria}><table><thead><tr><th>{t.model}</th><th>{t.horizonCol}</th><th>{t.forecasts}</th><th>MAE</th><th>RMSE</th><th>WAPE</th><th>MASE</th><th>{t.direction}</th><th>{t.coverage80}</th><th>{t.width}</th><th>{t.relative}</th></tr></thead><tbody>
          {pooled.map((row) => <tr key={`${row.model}-${row.horizon}`}><td lang="en">{row.model}</td><td>{row.horizon}</td><td>{row.n}</td><td>{num(row.mae)}</td><td>{num(row.rmse)}</td><td>{pct(row.wape)}</td><td>{num(row.mase, 2)}</td><td>{pct(row.directional_accuracy)}</td><td>{pct(row.interval_coverage)}</td><td>{num(row.interval_width)}</td><td>{num(row.relative_mae_vs_best_baseline, 3)}</td></tr>)}
        </tbody></table></div></section>

      {horizon && pooled.length > 0 && (() => {
        const relative = pooled.filter((row) => row.relative_mae_vs_best_baseline !== null).sort((a, b) => a.relative_mae_vs_best_baseline! - b.relative_mae_vs_best_baseline!);
        const intervals = pooled.filter((row) => row.interval_coverage !== null);
        const beating = relative.filter((row) => row.relative_mae_vs_best_baseline! < 1).length;
        return <section className="chart-grid">
          <article className="panel chart-panel"><div className="panel-heading"><div><h2>{t.relativeTitle}</h2><p>{dark ? t.relativeDarkHint(horizon) : t.relativeHint(horizon)}</p></div>
            <StatusBadge tone={beating ? "warn" : "bad"}>{beating ? t.beating(beating) : t.noneBeating}</StatusBadge></div>
            {!relative.length ? <EmptyState title={t.noRelative} /> : <LazyBarChart horizontal categories={relative.map((row) => row.model)} values={relative.map((row) => row.relative_mae_vs_best_baseline)} name={t.relative} valueFormat="ratio" referenceLine={{ value: 1, label: t.baseline }} description={t.relativeDescription(horizon)} color={(index) => { const value = relative[index]?.relative_mae_vs_best_baseline ?? 1; return value < 1 ? INK[900] : INK[400]; }} height={Math.max(220, relative.length * 34 + 60)} />}
            <div className="chart-foot"><SourceLabel>{t.backtestsSource(experiment.id, experiment.vintage_mode)}</SourceLabel></div></article>
          <article className="panel chart-panel"><div className="panel-heading"><div><h2>{t.coverageTitle}</h2><p>{dark ? t.coverageDarkHint : t.coverageHint}</p></div></div>
            {!intervals.length ? <EmptyState title={t.noIntervals} /> : <LazyBarChart horizontal categories={intervals.map((row) => row.model)} values={intervals.map((row) => (row.interval_coverage ?? 0) * 100)} name={t.intervalCoverage} valueFormat="percent" referenceLine={{ value: 80, label: t.nominal }} description={t.coverageDescription(horizon)} color={(index) => Math.abs((intervals[index]?.interval_coverage ?? 0) - 0.8) <= 0.05 ? INK[900] : INK[400]} height={Math.max(220, intervals.length * 34 + 60)} />}
            <div className="chart-foot"><SourceLabel>{t.widthSource}</SourceLabel></div></article>
        </section>;
      })()}
      <section className="panel table-panel"><div className="panel-heading"><div><h2>{t.perSeries}</h2><p>{t.perSeriesHint}</p></div></div>
        {evaluations.isLoading ? <LoadingState /> : evaluations.error ? <ErrorState error={evaluations.error} /> : !evaluations.data?.data.length ? <EmptyState title={t.noEvaluations}>{t.changeFilters}</EmptyState> : <>
          <div className="table-scroll table-tall" tabIndex={0} role="region" aria-label={t.evaluationsAria}><table><thead><tr><th>{t.variety}</th><th>{t.horizonCol}</th><th>{t.model}</th><th>{t.baselineCol}</th><th>n</th><th>MAE</th><th>{t.skill}</th><th>Holm p</th><th>{t.coverage}</th><th>{t.statusCol}</th><th>{t.reasons}</th></tr></thead><tbody>
            {evaluations.data.data.map((row) => <tr key={row.id}><td lang="en">{row.variety}</td><td>{row.horizon}</td><td lang="en">{row.model}</td><td lang="en">{row.baseline_model}</td><td>{row.n}</td><td>{num(row.mae)}</td><td>{pct(row.mae_skill_vs_baseline)}</td><td>{num(row.p_value_holm, 3)}</td><td>{pct(row.interval_coverage)} ({label(row.coverage_status)})</td><td>{statusText(row.status)}</td><td>{row.reasons.map(label).join(", ")}</td></tr>)}
          </tbody></table></div>
          <div className="pagination"><span>{t.onPage(evaluations.data.data.length)}</span><div>
            <button type="button" className="button-secondary" disabled={cursors.length < 2} onClick={() => setCursors(cursors.slice(0, -1))}>{t.previous}</button>
            <button type="button" className="button-secondary" disabled={evaluations.data.next_after == null} onClick={() => { const next = evaluations.data?.next_after; if (next != null) setCursors([...cursors, next]); }}>{t.next}</button>
          </div></div>
        </>}
      </section>

      <section className="panel table-panel"><div className="panel-heading"><div><h2>{t.saved}</h2><p>{t.savedHint(withheldPredictions)}</p></div></div>
        {predictions.isLoading ? <LoadingState /> : predictions.error ? <ErrorState error={predictions.error} /> : !shownPredictions.length ? <EmptyState title={t.noPredictions}>{t.allWithheld}</EmptyState> :
          <div className="table-scroll table-tall" tabIndex={0} role="region" aria-label={t.predictionsAria}><table><thead><tr><th>{t.varietyBasis}</th><th>{t.targetMonth}</th><th>{t.horizonCol}</th><th>{t.model}</th><th>{t.median}</th><th>{t.interval}</th><th>{t.lastObserved(shownPredictions[0].origin_period)}</th><th>{t.publicationCol}</th><th>{t.actual}</th></tr></thead><tbody>
            {shownPredictions.map((row) => <tr key={row.id}><td lang="en">{row.variety}<br /><small>{label(row.price_basis)} · {row.unit}</small></td><td>{row.target_period}</td><td>{row.horizon}</td><td lang="en">{row.model}</td><td>{num(row.median)}</td><td>{num(row.lower_bound)}–{num(row.upper_bound)} ({Math.round(row.interval_level)}%)</td><td>{num(row.last_observed_value)}</td><td>{t.publication[row.publication] ?? label(row.publication)}</td><td>{row.actual_value == null ? t.notObserved : t.withError(num(row.actual_value), num(row.absolute_error))}</td></tr>)}
          </tbody></table></div>}
      </section>

      <section className="panel table-panel"><div className="panel-heading"><div><h2>{t.prospective}</h2><p>{t.prospectiveHint(overview.data?.policy.validation_min_outcomes ?? 6)}</p></div></div>
        {performance.isLoading ? <LoadingState /> : performance.error ? <ErrorState error={performance.error} /> : !performance.data?.keys.length ? <EmptyState title={t.noOutcomes}>{t.noOutcomesHint}</EmptyState> :
          <div className="table-scroll" tabIndex={0} role="region" aria-label={t.performanceAria}><table><thead><tr><th>{t.variety}</th><th>{t.horizonCol}</th><th>{t.model}</th><th>{t.outcomesCol}</th><th>MAE</th><th>{t.baselineMae}</th><th>{t.ratio}</th><th>{t.coverage}</th><th>{t.statusCol}</th></tr></thead><tbody>
            {performance.data.keys.map((row) => <tr key={`${row.series_id}-${row.horizon}-${row.model}`}><td lang="en">{row.variety}</td><td>{row.horizon}</td><td lang="en">{row.model}</td><td>{row.outcomes}</td><td>{num(row.mae)}</td><td>{num(row.baseline_mae)}</td><td>{num(row.mae_ratio, 3)}</td><td>{pct(row.coverage)}</td><td>{statusText(row.effective_status)}</td></tr>)}
          </tbody></table></div>}
      </section>

      {!!meta?.legacy_comparison?.length && <section className="panel table-panel"><div className="panel-heading"><div><h2>{t.legacy}</h2><p>{t.legacyHint}</p></div></div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t.legacyAria}><table><thead><tr><th>{t.variety}</th><th>{t.legacyModel}</th><th>{t.holdoutMonths}</th><th>{t.legacyMae}</th>{engineModels.map((model) => <th key={model} lang="en">{model}</th>)}</tr></thead><tbody>
          {meta.legacy_comparison.map((row) => <tr key={row.variety}><td lang="en">{row.variety}</td><td lang="en">{row.legacy_model}{row.legacy_publishable ? "" : t.withheld}</td><td>{row.holdout_months}</td><td>{num(row.legacy_mae)}</td>{engineModels.map((model) => <td key={model}>{num(row.engine_mae[model])}</td>)}</tr>)}
        </tbody></table></div></section>}
      </div></details>

      {/* Only what a reader needs: what the numbers are, that sources stay separate, and credit for the open-source tools.
          Test statistics, hashes and engine internals stay in the published payload, not on the page. */}
      <section className="fx-card fx-limits" aria-labelledby="fx-limits"><header className="fx-card-head"><h2 id="fx-limits">{t.limitations}</h2></header>
        <ul>{t.essentials.map((line) => <li key={line}>{line}</li>)}</ul>
        {meta?.environment?.licences && <p className="table-note">{t.openSource} <span lang="en">{Object.entries(meta.environment.licences)
          .filter(([key]) => key !== "chronos-forecasting" && key !== "timesfm").map(([key, value]) => `${key.replace(/^(amazon|google)\//, "")} (${value.replace(/\s*\(.*\)$/, "")})`).join(" · ")}</span></p>}
      </section>
    </>}
  </div>;
}

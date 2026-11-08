import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { exportModule } from "./IntelligencePage";
import { shiftCalendarMonth } from "../../../shared/dates";
import { defineCopy, useCopy, useFormat } from "../services/language";
import { LazyBarChart, LazyLineChart } from "../components/LazyCharts";
import { SourceLabel, StatusBadge } from "../components/Scorecard";
import { INK } from "../components/chartPalette";
import { AboutData } from "../components/AboutData";

const percentOf = (value: number) => `${Math.round(value)}%`;

const COPY = defineCopy({
  en: {
    unavailable: "Unavailable",
    title: "Experimental monthly forecasting baselines", intro: "One reporting month ahead, for an exact Karnataka variety. Reference calculations, not proven predictive models.",
    compareLink: "Compare with the forecasting engine experiments",
    about: "The last-value baseline simply repeats the latest observed monthly price; seasonal naive repeats the same month last year. Retrospective evaluation does not establish prospective predictive accuracy or a trading edge. Current revised history, reused holdouts, small calibration samples and serial dependence limit the evaluation. These references do not incorporate weather, production or news.",
    variety: "Exact forecast variety",
    status: { not_evaluated: "not evaluated", stale: "stale", published: "published", withheld: "withheld" } as Record<string, string>,
    statusLine: "Status:", scope: "This forecasts an official monthly state-level weighted price, not a local daily quote or an executable sale price. It does not use weather, production, news or TSS data as predictive features.",
    reasons: {
      insufficient_history: "insufficient history", invalid_scope_or_unit: "invalid scope or unit", invalid_reporting_period: "invalid reporting period",
      nonpositive_or_missing_price: "non-positive or missing price", calendar_gap_or_duplicate: "calendar gap or duplicate", stale_history: "stale history",
      missing_capture_provenance: "missing capture provenance", holdout_performance_deteriorated: "holdout performance deteriorated",
      source_history_changed: "source history changed", formula_version_changed: "formula version changed",
    } as Record<string, string>,
    staleSnapshot: (reasons: string) => `Snapshot is stale: ${reasons}. Forecast output is suppressed until re-evaluated.`,
    noSnapshot: "No evaluated snapshot for this variety", noSnapshotHint: "A reviewer must run evaluation below. At least 60 consecutive positive monthly observations with source captures are required. No forecast is invented to fill this state.",
    historyUsed: "HISTORY USED", months: (n: number) => `${n} months`, noUsable: "No usable history",
    nextMonth: "NEXT REPORTING MONTH", notPublished: "Not published", failedEvaluation: "History did not pass evaluation requirements",
    holdoutMae: "HOLDOUT MEAN ABSOLUTE ERROR", perQuintalTargets: (n: number) => `Per quintal · ${n} one-step chronological holdout targets`,
    coverage: "MEASURED INTERVAL COVERAGE", covered: (covered: string) => `${covered} covered; nominal target 80%, not a guarantee`, noHoldout: "No holdout",
    estimateTitle: (month: string) => `${month} · Experimental reference estimate`, estimateHint: (label: string) => `${label} · INR/quintal · Not a proven predictive model`,
    perQuintal: "INR/quintal", interval: "Empirical interval:",
    methodLine: (method: string, count: number) => `Method: ${method}. Calibrated using ${count} pre-holdout absolute errors; the small sample and serial dependence limit confidence in future coverage.`,
    forecastUnavailable: "Forecast unavailable", sourceChanged: "Source history changed; re-evaluation is required.", requirementsNotMet: "Publication requirements were not met.",
    checks: "Publication checks & limitations", checksHint: (time: string, version: string) => `Forecast execution: ${time} · ${version}. This is not a market reporting date or source publication time.`,
    gates: { history_sufficient: "history sufficient", history_valid: "history valid", history_fresh: "history fresh", evaluation_sufficient: "evaluation sufficient", performance_not_worse_than_naive: "performance not worse than naive" } as Record<string, string>,
    passed: "Passed", notPassed: "Not passed",
    limitations: null as string[] | null, labels: null as Record<string, string> | null, selectionRule: null as string | null, method: null as string | null,
    evaluationTitle: "Chronological model evaluation", scoresAria: "Forecast model scores", scoresCaption: "Price errors in INR/quintal · sMAPE is percentage",
    block: "Evaluation block / model", targets: "Targets",
    blocks: ["Validation · Last value", "Validation · Seasonal naive", "Untouched holdout · Selected model", "Untouched holdout · Last-value benchmark"],
    blockDates: (initial: number, vFrom: string, vTo: string, hFrom: string, hTo: string) => `Initial training: ${initial} months. Validation: ${vFrom}–${vTo}. Calibration: 12 subsequent months. Holdout: ${hFrom}–${hTo}.`,
    skill: (value: string) => `MAE skill vs last-value benchmark: ${value}. Zero means no improvement, not a successful predictive advantage. Holdout is used for publication gating and can be reused by later evaluations.`,
    holdoutTargets: "Holdout targets", holdoutHint: "Each prediction uses only preceding calendar-month prices in the currently revised series.", exportHoldout: "Export holdout CSV",
    holdoutAria: "Forecast holdout predictions", holdoutCaption: "Exact held-out targets; retrospective current-vintage evaluation",
    target: "Target", trainingThrough: "Training through", actual: "Actual", lastValue: "Last value", seasonalNaive: "Seasonal naive",
    snapshotTitle: "Reproducible source snapshot", snapshotHint: (id: string, hash: string) => `Snapshot ${id} · SHA-256 ${hash}`, exportJson: "Export evaluation JSON",
    inputs: "Inspect monthly source inputs", inputLine: (month: string, price: string, fetched: string) => `${month}: ${price} · Platform fetched ${fetched} ·`, archivedReport: "Archived report",
    runTitle: "Run reproducible evaluation", runHint: "Reviewer access is required. Each evaluation saves an immutable snapshot, including withheld results. It does not train a complex AI model.",
    token: "Forecast reviewer token", evaluating: "Evaluating...", evaluate: "Evaluate selected variety", clearToken: "Clear token",
    stored: (status: string) => `Evaluation stored. Publication status: ${status}.`,
    backtest: "Backtest: actual versus baselines",
    backtestHint: (validation: number, holdout: number, from: string) => `Validation (${validation} months) then untouched holdout (${holdout} months, from ${from}) · one-step-ahead · INR/quintal`,
    referenceExperimental: "Reference estimate · experimental", notPublishable: "Not publishable",
    backtestDescription: (variety: string) => `Backtest of monthly ${variety} baselines against actual prices`, next: (month: string) => `${month} (next)`,
    calibration: "Calibration", holdout: "Holdout", nextInterval: (percent: number) => `Next-month ${percent}% interval`,
    backtestNote: (from: string, to: string, coverage: number, next: string) => `Baselines are not scored during the calibration months, which set the interval width. Holdout runs ${from} – ${to}. Measured holdout interval coverage: ${coverage}% against an 80% nominal target.${next} Past errors do not guarantee future accuracy.`,
    nextNote: (month: string, low: string, high: string) => ` Next-month (${month}) empirical interval: ${low}–${high}.`,
    backtestSource: (variety: string) => `AGMARKNET monthly · ${variety} · Areca Pulse legacy baseline evaluation`,
    errorTitle: "Historical error on holdout", errorHint: (model: string) => `Absolute error per held-out month · selected model (${model}) versus last-value benchmark`,
    models: { last_value: "last value", seasonal_naive: "seasonal naive" } as Record<string, string>,
    selfBenchmark: "Selected model is the benchmark · no skill", skillUnavailable: "Skill unavailable", better: (p: string) => `${p}% lower MAE than last value`,
    noImprovement: "No improvement over last value", worse: (p: string) => `${p}% worse than last value`,
    absoluteError: (model: string) => `Absolute error · ${model}`, errorDescription: "Absolute holdout forecast error by month",
    selfNote: "The selected model is the last-value benchmark itself, so its skill against that benchmark is zero by construction.",
    lightBars: "Light bars are months where the selected model was worse than the last-value benchmark.",
    holdoutMaeLine: (last: string, seasonal: string) => `Holdout MAE: last value ${last} · seasonal naive ${seasonal} per quintal.`,
    retrospective: "Retrospective current-vintage evaluation · not prospective",
  },
  kn: {
    unavailable: "ಲಭ್ಯವಿಲ್ಲ",
    title: "ಪ್ರಾಯೋಗಿಕ ತಿಂಗಳ ಮುನ್ಸೂಚನೆಯ ಮೂಲ ಅಂದಾಜುಗಳು", intro: "ಕರ್ನಾಟಕದ ನಿಖರ ತಳಿಗೆ ಒಂದು ವರದಿ ತಿಂಗಳು ಮುಂದಕ್ಕೆ. ಉಲ್ಲೇಖದ ಲೆಕ್ಕಾಚಾರಗಳು, ಸಾಬೀತಾದ ಮುನ್ಸೂಚನಾ ಮಾದರಿಗಳಲ್ಲ.",
    compareLink: "ಮುನ್ಸೂಚನಾ ವ್ಯವಸ್ಥೆಯ ಪ್ರಯೋಗಗಳೊಂದಿಗೆ ಹೋಲಿಸಿ",
    about: "‘ಕೊನೆಯ ಮೌಲ್ಯ’ ವಿಧಾನವು ಇತ್ತೀಚಿನ ತಿಂಗಳ ದರವನ್ನೇ ಪುನರಾವರ್ತಿಸುತ್ತದೆ; ‘ಋತುಮಾನ ಸರಳ’ ವಿಧಾನವು ಕಳೆದ ವರ್ಷದ ಅದೇ ತಿಂಗಳನ್ನು ಪುನರಾವರ್ತಿಸುತ್ತದೆ. ಹಿಂದಿನ ದತ್ತಾಂಶದ ಪರೀಕ್ಷೆಯು ಮುಂದಿನ ನಿಖರತೆ ಅಥವಾ ವ್ಯಾಪಾರ ಲಾಭವನ್ನು ಸಾಬೀತುಪಡಿಸುವುದಿಲ್ಲ. ತಿದ್ದಿದ ಇತಿಹಾಸ, ಮರುಬಳಕೆಯಾದ ಪರೀಕ್ಷಾ ಅವಧಿ, ಸಣ್ಣ ಮಾದರಿ ಮತ್ತು ಸರಣಿ ಅವಲಂಬನೆ ಮೌಲ್ಯಮಾಪನವನ್ನು ಮಿತಿಗೊಳಿಸುತ್ತವೆ. ಹವಾಮಾನ, ಉತ್ಪಾದನೆ ಅಥವಾ ಸುದ್ದಿಯನ್ನು ಬಳಸುವುದಿಲ್ಲ.",
    variety: "ಮುನ್ಸೂಚನೆಯ ನಿಖರ ತಳಿ",
    status: { not_evaluated: "ಮೌಲ್ಯಮಾಪನವಾಗಿಲ್ಲ", stale: "ಹಳೆಯದು", published: "ಪ್ರಕಟಿಸಲಾಗಿದೆ", withheld: "ತಡೆಹಿಡಿಯಲಾಗಿದೆ" },
    statusLine: "ಸ್ಥಿತಿ:", scope: "ಇದು ಅಧಿಕೃತ ತಿಂಗಳ ರಾಜ್ಯ ಮಟ್ಟದ ತೂಕದ ಸರಾಸರಿ ದರದ ಮುನ್ಸೂಚನೆ, ಸ್ಥಳೀಯ ದೈನಂದಿನ ದರ ಅಥವಾ ಖಚಿತ ಮಾರಾಟ ದರವಲ್ಲ. ಹವಾಮಾನ, ಉತ್ಪಾದನೆ, ಸುದ್ದಿ ಅಥವಾ TSS ದತ್ತಾಂಶವನ್ನು ಬಳಸುವುದಿಲ್ಲ.",
    reasons: {
      insufficient_history: "ಸಾಕಷ್ಟು ಇತಿಹಾಸವಿಲ್ಲ", invalid_scope_or_unit: "ಅಮಾನ್ಯ ವ್ಯಾಪ್ತಿ ಅಥವಾ ಘಟಕ", invalid_reporting_period: "ಅಮಾನ್ಯ ವರದಿ ಅವಧಿ",
      nonpositive_or_missing_price: "ಸೊನ್ನೆ ಅಥವಾ ಇಲ್ಲದ ದರ", calendar_gap_or_duplicate: "ತಿಂಗಳ ಅಂತರ ಅಥವಾ ಪುನರಾವರ್ತನೆ", stale_history: "ಹಳೆಯ ಇತಿಹಾಸ",
      missing_capture_provenance: "ಮೂಲ ಸಂಗ್ರಹದ ಆಧಾರ ಇಲ್ಲ", holdout_performance_deteriorated: "ಪರೀಕ್ಷಾ ಅವಧಿಯಲ್ಲಿ ಕಾರ್ಯಕ್ಷಮತೆ ಕುಸಿದಿದೆ",
      source_history_changed: "ಮೂಲ ಇತಿಹಾಸ ಬದಲಾಗಿದೆ", formula_version_changed: "ಸೂತ್ರದ ಆವೃತ್ತಿ ಬದಲಾಗಿದೆ",
    },
    staleSnapshot: (reasons: string) => `ಸಂಗ್ರಹ ಹಳೆಯದು: ${reasons}. ಮತ್ತೆ ಮೌಲ್ಯಮಾಪನ ಮಾಡುವವರೆಗೆ ಮುನ್ಸೂಚನೆ ತೋರಿಸುವುದಿಲ್ಲ.`,
    noSnapshot: "ಈ ತಳಿಗೆ ಮೌಲ್ಯಮಾಪನದ ಸಂಗ್ರಹವಿಲ್ಲ", noSnapshotHint: "ಪರಿಶೀಲಕರು ಕೆಳಗೆ ಮೌಲ್ಯಮಾಪನ ನಡೆಸಬೇಕು. ಮೂಲ ಸಂಗ್ರಹದೊಂದಿಗೆ ಸತತ ಕನಿಷ್ಠ 60 ತಿಂಗಳ ದರಗಳು ಬೇಕು. ಈ ಸ್ಥಿತಿಯನ್ನು ತುಂಬಲು ಯಾವುದೇ ಮುನ್ಸೂಚನೆ ಕಲ್ಪಿಸುವುದಿಲ್ಲ.",
    historyUsed: "ಬಳಸಿದ ಇತಿಹಾಸ", months: (n: number) => `${n} ತಿಂಗಳು`, noUsable: "ಬಳಸಬಹುದಾದ ಇತಿಹಾಸವಿಲ್ಲ",
    nextMonth: "ಮುಂದಿನ ವರದಿ ತಿಂಗಳು", notPublished: "ಪ್ರಕಟಿಸಿಲ್ಲ", failedEvaluation: "ಇತಿಹಾಸ ಮೌಲ್ಯಮಾಪನದ ಅಗತ್ಯಗಳನ್ನು ಪೂರೈಸಿಲ್ಲ",
    holdoutMae: "ಪರೀಕ್ಷಾ ಅವಧಿಯ ಸರಾಸರಿ ದೋಷ", perQuintalTargets: (n: number) => `ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್ · ${n} ಕಾಲಾನುಕ್ರಮ ಪರೀಕ್ಷಾ ತಿಂಗಳುಗಳು`,
    coverage: "ಅಳೆದ ಶ್ರೇಣಿ ವ್ಯಾಪ್ತಿ", covered: (covered: string) => `${covered} ಒಳಗೊಂಡಿವೆ; ಗುರಿ 80%, ಖಾತರಿ ಅಲ್ಲ`, noHoldout: "ಪರೀಕ್ಷಾ ಅವಧಿ ಇಲ್ಲ",
    estimateTitle: (month: string) => `${month} · ಪ್ರಾಯೋಗಿಕ ಉಲ್ಲೇಖ ಅಂದಾಜು`, estimateHint: (label: string) => `${label} · ₹/ಕ್ವಿಂಟಾಲ್ · ಸಾಬೀತಾದ ಮುನ್ಸೂಚನಾ ಮಾದರಿ ಅಲ್ಲ`,
    perQuintal: "₹/ಕ್ವಿಂಟಾಲ್", interval: "ಅನುಭವ ಆಧಾರಿತ ಶ್ರೇಣಿ:",
    methodLine: (method: string, count: number) => `ವಿಧಾನ: ${method}. ಪರೀಕ್ಷಾ ಅವಧಿಗೆ ಮೊದಲಿನ ${count} ದೋಷಗಳಿಂದ ಹೊಂದಿಸಲಾಗಿದೆ; ಸಣ್ಣ ಮಾದರಿ ಮತ್ತು ಸರಣಿ ಅವಲಂಬನೆ ಮುಂದಿನ ವ್ಯಾಪ್ತಿಯ ಮೇಲಿನ ನಂಬಿಕೆಯನ್ನು ಮಿತಿಗೊಳಿಸುತ್ತವೆ.`,
    forecastUnavailable: "ಮುನ್ಸೂಚನೆ ಲಭ್ಯವಿಲ್ಲ", sourceChanged: "ಮೂಲ ಇತಿಹಾಸ ಬದಲಾಗಿದೆ; ಮತ್ತೆ ಮೌಲ್ಯಮಾಪನ ಬೇಕು.", requirementsNotMet: "ಪ್ರಕಟಣೆಯ ಅಗತ್ಯಗಳು ಪೂರೈಸಿಲ್ಲ.",
    checks: "ಪ್ರಕಟಣಾ ಪರಿಶೀಲನೆಗಳು ಮತ್ತು ಮಿತಿಗಳು", checksHint: (time: string, version: string) => `ಮುನ್ಸೂಚನೆ ನಡೆಸಿದ ಸಮಯ: ${time} · ${version}. ಇದು ಮಾರುಕಟ್ಟೆ ವರದಿ ದಿನಾಂಕ ಅಥವಾ ಮೂಲದ ಪ್ರಕಟಣೆ ಸಮಯವಲ್ಲ.`,
    gates: { history_sufficient: "ಸಾಕಷ್ಟು ಇತಿಹಾಸ", history_valid: "ಇತಿಹಾಸ ಮಾನ್ಯ", history_fresh: "ಇತಿಹಾಸ ಹೊಸದು", evaluation_sufficient: "ಸಾಕಷ್ಟು ಮೌಲ್ಯಮಾಪನ", performance_not_worse_than_naive: "ಸರಳ ವಿಧಾನಕ್ಕಿಂತ ಕೆಟ್ಟದಲ್ಲ" },
    passed: "ಉತ್ತೀರ್ಣ", notPassed: "ಅನುತ್ತೀರ್ಣ",
    limitations: [
      "ಪ್ರಾಯೋಗಿಕ ಉಲ್ಲೇಖ ಅಂದಾಜುಗಳು, ಸಾಬೀತಾದ ಮುನ್ಸೂಚನಾ ಮಾದರಿಗಳಲ್ಲ. ‘ಕೊನೆಯ ಮೌಲ್ಯ’ ಇತ್ತೀಚಿನ ತಿಂಗಳ ದರವನ್ನು ಪುನರಾವರ್ತಿಸುತ್ತದೆ; ‘ಋತುಮಾನ ಸರಳ’ ಕಳೆದ ವರ್ಷದ ಅದೇ ತಿಂಗಳನ್ನು ಪುನರಾವರ್ತಿಸುತ್ತದೆ. ಮುಂದಿನ ಮುನ್ಸೂಚನಾ ಲಾಭ ಸಾಬೀತಾಗಿಲ್ಲ.",
      "ಹಿಂದಿನ ಪರೀಕ್ಷೆಗಳು ಈಗಿನ ತಿದ್ದಿದ ಇತಿಹಾಸವನ್ನು ಬಳಸುತ್ತವೆ, ಆಗಿನ ಮೂಲ ಆವೃತ್ತಿಗಳನ್ನಲ್ಲ; ಆವೃತ್ತಿ ಸೋರಿಕೆಯನ್ನು ತಳ್ಳಿಹಾಕಲಾಗದು.",
      "ಕರ್ನಾಟಕದ ನಿಖರ ತಳಿಯ ತಿಂಗಳ ತೂಕದ ಸರಾಸರಿ ದರಗಳು ಮಾತ್ರ; ಅಧಿಕೃತ ದೈನಂದಿನ, ಊಹಿಸಿದ ಘಟಕ ಅಥವಾ TSS ಬೆರೆಸುವಿಕೆ ಇಲ್ಲ.",
      "ಮುಂದಿನ ವರದಿ ತಿಂಗಳನ್ನು ಮಾತ್ರ ಮೌಲ್ಯಮಾಪನ ಮಾಡಲಾಗುತ್ತದೆ; ಇದು ಹಲವು ಹಂತ ಅಥವಾ ದೈನಂದಿನ ಮುನ್ಸೂಚನೆ ಅಲ್ಲ.",
      "ಶ್ರೇಣಿಗಳು ಪರೀಕ್ಷಾ ಅವಧಿಗೆ ಮೊದಲಿನ 12 ದೋಷಗಳನ್ನು ಮಾತ್ರ ಬಳಸುತ್ತವೆ. ಸರಣಿ ಅವಲಂಬನೆ, ಮಾದರಿ ಆಯ್ಕೆ ಮತ್ತು ಸಣ್ಣ ಮಾದರಿಯಿಂದ ವ್ಯಾಪ್ತಿಯನ್ನು ಖಾತರಿಪಡಿಸಲಾಗದು.",
      "ಪರೀಕ್ಷಾ ಫಲಿತಾಂಶಗಳು ಹಿಂದಿನ ಪ್ರಕಟಣಾ ತಡೆ ಮಾತ್ರ, ಮುಂದಿನ ವ್ಯಾಪಾರ ಲಾಭದ ಸಾಕ್ಷಿಯಲ್ಲ. ಪುನರಾವರ್ತಿತ ಮೌಲ್ಯಮಾಪನ ಅದೇ ಪರೀಕ್ಷಾ ಅವಧಿಯನ್ನು ಮರುಬಳಸಬಹುದು.",
    ],
    labels: { last_value: "ಪ್ರಾಯೋಗಿಕ ‘ಕೊನೆಯ ಮೌಲ್ಯ’ ಉಲ್ಲೇಖ; ಸಾಬೀತಾದ ಮುನ್ಸೂಚನಾ ಲಾಭವಿಲ್ಲ", seasonal_naive: "ಪ್ರಾಯೋಗಿಕ ‘ಋತುಮಾನ ಸರಳ’ ತಿಂಗಳ ಉಲ್ಲೇಖ" },
    selectionRule: "ಪರೀಕ್ಷೆಗೆ ಮೊದಲಿನ ಮೌಲ್ಯಮಾಪನದಲ್ಲಿ ಕನಿಷ್ಠ ಸರಾಸರಿ ದೋಷ; ಸಮವಾದರೆ ‘ಕೊನೆಯ ಮೌಲ್ಯ’. ಹೊಂದಾಣಿಕೆ ಮತ್ತು ಪರೀಕ್ಷಾ ಅವಧಿಗಳು ಮಾದರಿಯನ್ನು ಆಯ್ಕೆ ಮಾಡುವುದಿಲ್ಲ.",
    method: "ಪರೀಕ್ಷಾ ಅವಧಿಗೆ ಮೊದಲಿನ ದೋಷಗಳ ಅನುಭವ ಆಧಾರಿತ ಕ್ರಮಾಂಕ",
    evaluationTitle: "ಕಾಲಾನುಕ್ರಮ ಮಾದರಿ ಮೌಲ್ಯಮಾಪನ", scoresAria: "ಮುನ್ಸೂಚನಾ ಮಾದರಿಗಳ ಅಂಕಗಳು", scoresCaption: "ದರ ದೋಷಗಳು ₹/ಕ್ವಿಂಟಾಲ್‌ನಲ್ಲಿ · sMAPE ಶೇಕಡಾವಾರು",
    block: "ಮೌಲ್ಯಮಾಪನ ಭಾಗ / ಮಾದರಿ", targets: "ಗುರಿಗಳು",
    blocks: ["ಮೌಲ್ಯಮಾಪನ · ಕೊನೆಯ ಮೌಲ್ಯ", "ಮೌಲ್ಯಮಾಪನ · ಋತುಮಾನ ಸರಳ", "ಮುಟ್ಟದ ಪರೀಕ್ಷಾ ಅವಧಿ · ಆಯ್ದ ಮಾದರಿ", "ಮುಟ್ಟದ ಪರೀಕ್ಷಾ ಅವಧಿ · ಕೊನೆಯ ಮೌಲ್ಯದ ಮಾನದಂಡ"],
    blockDates: (initial: number, vFrom: string, vTo: string, hFrom: string, hTo: string) => `ಆರಂಭಿಕ ತರಬೇತಿ: ${initial} ತಿಂಗಳು. ಮೌಲ್ಯಮಾಪನ: ${vFrom}–${vTo}. ಹೊಂದಾಣಿಕೆ: ನಂತರದ 12 ತಿಂಗಳು. ಪರೀಕ್ಷಾ ಅವಧಿ: ${hFrom}–${hTo}.`,
    skill: (value: string) => `ಕೊನೆಯ ಮೌಲ್ಯದ ಮಾನದಂಡಕ್ಕೆ ಹೋಲಿಸಿ ದೋಷದಲ್ಲಿ ಸುಧಾರಣೆ: ${value}. ಸೊನ್ನೆ ಎಂದರೆ ಸುಧಾರಣೆ ಇಲ್ಲ. ಪರೀಕ್ಷಾ ಅವಧಿಯನ್ನು ಪ್ರಕಟಣಾ ತಡೆಗೆ ಬಳಸಲಾಗುತ್ತದೆ ಮತ್ತು ನಂತರದ ಮೌಲ್ಯಮಾಪನಗಳು ಮರುಬಳಸಬಹುದು.`,
    holdoutTargets: "ಪರೀಕ್ಷಾ ತಿಂಗಳುಗಳು", holdoutHint: "ಪ್ರತಿ ಅಂದಾಜು ಈಗಿನ ತಿದ್ದಿದ ಸರಣಿಯ ಹಿಂದಿನ ತಿಂಗಳ ದರಗಳನ್ನು ಮಾತ್ರ ಬಳಸುತ್ತದೆ.", exportHoldout: "ಪರೀಕ್ಷಾ CSV ಡೌನ್‌ಲೋಡ್",
    holdoutAria: "ಪರೀಕ್ಷಾ ಅವಧಿಯ ಅಂದಾಜುಗಳು", holdoutCaption: "ನಿಖರ ಪರೀಕ್ಷಾ ಗುರಿಗಳು; ಹಿಂದಿನ ದತ್ತಾಂಶದ ಮೌಲ್ಯಮಾಪನ",
    target: "ಗುರಿ", trainingThrough: "ತರಬೇತಿ ವರೆಗೆ", actual: "ನಿಜವಾದ ದರ", lastValue: "ಕೊನೆಯ ಮೌಲ್ಯ", seasonalNaive: "ಋತುಮಾನ ಸರಳ",
    snapshotTitle: "ಪುನರುತ್ಪಾದಿಸಬಹುದಾದ ಮೂಲ ಸಂಗ್ರಹ", snapshotHint: (id: string, hash: string) => `ಸಂಗ್ರಹ ${id} · SHA-256 ${hash}`, exportJson: "ಮೌಲ್ಯಮಾಪನ JSON ಡೌನ್‌ಲೋಡ್",
    inputs: "ತಿಂಗಳ ಮೂಲ ದತ್ತಾಂಶ ನೋಡಿ", inputLine: (month: string, price: string, fetched: string) => `${month}: ${price} · ತಂದ ಸಮಯ ${fetched} ·`, archivedReport: "ಸಂಗ್ರಹಿತ ವರದಿ",
    runTitle: "ಪುನರುತ್ಪಾದಿಸಬಹುದಾದ ಮೌಲ್ಯಮಾಪನ ನಡೆಸಿ", runHint: "ಪರಿಶೀಲಕರ ಪ್ರವೇಶ ಬೇಕು. ಪ್ರತಿ ಮೌಲ್ಯಮಾಪನವು ತಡೆಹಿಡಿದ ಫಲಿತಾಂಶಗಳನ್ನೂ ಸೇರಿ ಬದಲಾಗದ ಸಂಗ್ರಹವನ್ನು ಉಳಿಸುತ್ತದೆ. ಸಂಕೀರ್ಣ AI ಮಾದರಿಯನ್ನು ತರಬೇತಿಗೊಳಿಸುವುದಿಲ್ಲ.",
    token: "ಮುನ್ಸೂಚನೆ ಪರಿಶೀಲಕರ ಟೋಕನ್", evaluating: "ಮೌಲ್ಯಮಾಪನ ನಡೆಯುತ್ತಿದೆ...", evaluate: "ಆಯ್ದ ತಳಿಯನ್ನು ಮೌಲ್ಯಮಾಪನ ಮಾಡಿ", clearToken: "ಟೋಕನ್ ತೆರವುಗೊಳಿಸಿ",
    stored: (status: string) => `ಮೌಲ್ಯಮಾಪನ ಉಳಿಸಲಾಗಿದೆ. ಪ್ರಕಟಣಾ ಸ್ಥಿತಿ: ${status}.`,
    backtest: "ಹಿಂದಿನ ಪರೀಕ್ಷೆ: ನಿಜವಾದ ದರ ಮತ್ತು ಮೂಲ ಅಂದಾಜುಗಳು",
    backtestHint: (validation: number, holdout: number, from: string) => `ಮೌಲ್ಯಮಾಪನ (${validation} ತಿಂಗಳು) ನಂತರ ಮುಟ್ಟದ ಪರೀಕ್ಷಾ ಅವಧಿ (${holdout} ತಿಂಗಳು, ${from} ರಿಂದ) · ಒಂದು ಹಂತ ಮುಂದೆ · ₹/ಕ್ವಿಂಟಾಲ್`,
    referenceExperimental: "ಉಲ್ಲೇಖ ಅಂದಾಜು · ಪ್ರಾಯೋಗಿಕ", notPublishable: "ಪ್ರಕಟಿಸಲಾಗದು",
    backtestDescription: (variety: string) => `ನಿಜವಾದ ದರಗಳ ವಿರುದ್ಧ ${variety} ತಿಂಗಳ ಮೂಲ ಅಂದಾಜುಗಳ ಪರೀಕ್ಷೆ`, next: (month: string) => `${month} (ಮುಂದಿನದು)`,
    calibration: "ಹೊಂದಾಣಿಕೆ", holdout: "ಪರೀಕ್ಷಾ ಅವಧಿ", nextInterval: (percent: number) => `ಮುಂದಿನ ತಿಂಗಳ ${percent}% ಶ್ರೇಣಿ`,
    backtestNote: (from: string, to: string, coverage: number, next: string) => `ಹೊಂದಾಣಿಕೆ ತಿಂಗಳುಗಳಲ್ಲಿ ಮೂಲ ಅಂದಾಜುಗಳಿಗೆ ಅಂಕ ನೀಡುವುದಿಲ್ಲ; ಅವು ಶ್ರೇಣಿಯ ಅಗಲವನ್ನು ನಿರ್ಧರಿಸುತ್ತವೆ. ಪರೀಕ್ಷಾ ಅವಧಿ ${from} – ${to}. ಅಳೆದ ಶ್ರೇಣಿ ವ್ಯಾಪ್ತಿ: ${coverage}%, ಗುರಿ 80%.${next} ಹಿಂದಿನ ದೋಷಗಳು ಮುಂದಿನ ನಿಖರತೆಯನ್ನು ಖಾತರಿಪಡಿಸುವುದಿಲ್ಲ.`,
    nextNote: (month: string, low: string, high: string) => ` ಮುಂದಿನ ತಿಂಗಳ (${month}) ಶ್ರೇಣಿ: ${low}–${high}.`,
    backtestSource: (variety: string) => `AGMARKNET ತಿಂಗಳ ವರದಿ · ${variety} · Areca Pulse ಹಳೆಯ ಮೂಲ ಅಂದಾಜು ಮೌಲ್ಯಮಾಪನ`,
    errorTitle: "ಪರೀಕ್ಷಾ ಅವಧಿಯ ಹಿಂದಿನ ದೋಷ", errorHint: (model: string) => `ಪ್ರತಿ ಪರೀಕ್ಷಾ ತಿಂಗಳ ದೋಷ · ಆಯ್ದ ಮಾದರಿ (${model}) ಮತ್ತು ಕೊನೆಯ ಮೌಲ್ಯದ ಮಾನದಂಡ`,
    models: { last_value: "ಕೊನೆಯ ಮೌಲ್ಯ", seasonal_naive: "ಋತುಮಾನ ಸರಳ" },
    selfBenchmark: "ಆಯ್ದ ಮಾದರಿಯೇ ಮಾನದಂಡ · ಸುಧಾರಣೆ ಇಲ್ಲ", skillUnavailable: "ಸುಧಾರಣೆ ಲಭ್ಯವಿಲ್ಲ", better: (p: string) => `ಕೊನೆಯ ಮೌಲ್ಯಕ್ಕಿಂತ ${p}% ಕಡಿಮೆ ದೋಷ`,
    noImprovement: "ಕೊನೆಯ ಮೌಲ್ಯಕ್ಕಿಂತ ಸುಧಾರಣೆ ಇಲ್ಲ", worse: (p: string) => `ಕೊನೆಯ ಮೌಲ್ಯಕ್ಕಿಂತ ${p}% ಕೆಟ್ಟದು`,
    absoluteError: (model: string) => `ದೋಷ · ${model}`, errorDescription: "ತಿಂಗಳವಾರು ಪರೀಕ್ಷಾ ಮುನ್ಸೂಚನೆ ದೋಷ",
    selfNote: "ಆಯ್ದ ಮಾದರಿಯೇ ಕೊನೆಯ ಮೌಲ್ಯದ ಮಾನದಂಡವಾಗಿರುವುದರಿಂದ ಅದಕ್ಕೆ ಹೋಲಿಸಿದ ಸುಧಾರಣೆ ಸೊನ್ನೆ.",
    lightBars: "ತಿಳಿ ಪಟ್ಟಿಗಳು ಆಯ್ದ ಮಾದರಿ ಕೊನೆಯ ಮೌಲ್ಯಕ್ಕಿಂತ ಕೆಟ್ಟದಾಗಿದ್ದ ತಿಂಗಳುಗಳು.",
    holdoutMaeLine: (last: string, seasonal: string) => `ಪರೀಕ್ಷಾ ಸರಾಸರಿ ದೋಷ: ಕೊನೆಯ ಮೌಲ್ಯ ${last} · ಋತುಮಾನ ಸರಳ ${seasonal} ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್.`,
    retrospective: "ಹಿಂದಿನ ದತ್ತಾಂಶದ ಮೌಲ್ಯಮಾಪನ · ಮುಂದಿನದಲ್ಲ",
  },
});

export function ForecastsPage() {
  const t = useCopy(COPY);
  const format = useFormat();
  const month = (value: string) => format.month(value);
  const number = (value: number | null | undefined) => value == null ? t.unavailable : value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const whole = (value: number | null | undefined) => value == null ? t.unavailable : `₹${Math.round(value).toLocaleString("en-IN")}`;
  const reasonText = (codes: string[]) => codes.map((code) => t.reasons[code] ?? code.replace(/_/g, " ")).join(", ");
  const [variety, setVariety] = useState("Rashi"), [token, setToken] = useState("");
  const client = useQueryClient();
  const prices = useQuery({ queryKey: ["forecast-varieties"], queryFn: () => api.monthlyPrices() });
  const query = useQuery({ queryKey: ["forecasts", variety], queryFn: () => api.forecasts(variety), refetchInterval: 60_000 });
  const evaluate = useMutation({ mutationFn: () => api.evaluateForecast(variety, token), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["forecasts"] }); } });
  const data = query.data, snapshot = data?.snapshot, results = snapshot?.results, evaluation = results?.evaluation;
  const label = evaluation ? t.labels?.[evaluation.selected_model] ?? evaluation.label : undefined;
  return <div className="page-stack">
    <section className="page-heading"><div><h1>{t.title}</h1><p>{t.intro} <Link to="/forecasts/evaluation">{t.compareLink}</Link>.</p></div></section>
    <AboutData><p>{t.about}</p></AboutData>
    <section className="filter-bar"><label className="filter-control"><span>{t.variety}</span><select value={variety} disabled={evaluate.isPending} onChange={(event) => { setVariety(event.target.value); evaluate.reset(); }}><option>Rashi</option>{prices.data?.data.filter((row) => row.variety_name !== "Rashi").map((row) => <option key={row.variety_name} lang="en">{row.variety_name}</option>)}</select></label></section>
    {prices.error && <ErrorState error={prices.error} />}
    {query.isLoading ? <LoadingState /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : data && <>
      <div className="data-disclosure">{t.statusLine} <strong>{t.status[data.status] ?? data.status.replace(/_/g, " ")}</strong>. {t.scope}</div>
      {data.stale && <div role="alert" className="data-disclosure">{t.staleSnapshot(reasonText(data.stale_reasons))}</div>}
      {!snapshot ? <EmptyState title={t.noSnapshot}>{t.noSnapshotHint}</EmptyState> : <>
        <section className="snapshot-grid">
          <article className="snapshot-card"><div className="card-kicker">{t.historyUsed}</div><div className="snapshot-value">{t.months(results?.history.count ?? 0)}</div><p>{results?.history.from ? `${month(results.history.from)} – ${results.history.through ? month(results.history.through) : ""}` : t.noUsable}</p></article>
          <article className="snapshot-card"><div className="card-kicker">{t.nextMonth}</div><div className="snapshot-value">{data.forecast ? month(data.forecast.reporting_month) : t.notPublished}</div><p>{label ?? t.failedEvaluation}</p></article>
          <article className="snapshot-card"><div className="card-kicker">{t.holdoutMae}</div><div className="snapshot-value">{whole(evaluation?.holdout.selected.mae)}</div><p>{t.perQuintalTargets(evaluation?.holdout.selected.count ?? 0)}</p></article>
          <article className="snapshot-card"><div className="card-kicker">{t.coverage}</div><div className="snapshot-value">{evaluation ? percentOf(evaluation.holdout.interval_coverage * 100) : t.unavailable}</div><p>{t.covered(evaluation ? `${evaluation.holdout.covered} / ${evaluation.holdout.selected.count}` : t.noHoldout)}</p></article>
        </section>
        {evaluation && <BacktestPanels evaluation={evaluation} forecast={data.forecast} publishable={Boolean(results?.publishable)} variety={variety} inputs={snapshot.inputs.prices} />}
        {data.forecast ? <section className="panel"><div className="panel-heading"><div><h2>{t.estimateTitle(month(data.forecast.reporting_month))}</h2><p>{t.estimateHint(label ?? "")}</p></div></div><div className="monthly-details"><p className="forecast-estimate">{number(data.forecast.point)} <span>{t.perQuintal}</span></p><p>{t.interval} <strong>{number(data.forecast.lower)}–{number(data.forecast.upper)}</strong> {t.perQuintal}.</p><p>{t.methodLine(t.method ?? data.forecast.method, evaluation?.calibration.count ?? 0)}</p></div></section>
          : <EmptyState title={t.forecastUnavailable}>{(results?.reasons.length ? reasonText(results.reasons) : "") || (data.stale ? t.sourceChanged : t.requirementsNotMet)}</EmptyState>}
        <section className="panel"><div className="panel-heading"><div><h2>{t.checks}</h2><p>{t.checksHint(format.timestamp(snapshot.evaluated_at), snapshot.formula_version)}</p></div></div><div className="monthly-details">
          <ul className="check-list">{Object.entries(results?.gates ?? {}).map(([key, passed]) => <li key={key}><span>{t.gates[key] ?? key.replace(/_/g, " ")}</span><StatusBadge tone={passed ? "good" : "warn"}>{passed ? t.passed : t.notPassed}</StatusBadge></li>)}</ul>
          <ul>{(t.limitations ?? results?.limitations ?? []).map((value) => <li key={value}>{value}</li>)}</ul>
        </div></section>
        {evaluation && <>
          <section className="panel table-panel"><div className="panel-heading"><div><h2>{t.evaluationTitle}</h2><p>{t.selectionRule ?? evaluation.selection_rule}</p></div></div><div className="table-scroll" tabIndex={0} role="region" aria-label={t.scoresAria}><table><caption>{t.scoresCaption}</caption><thead><tr><th>{t.block}</th><th className="numeric">{t.targets}</th><th className="numeric">MAE</th><th className="numeric">RMSE</th><th className="numeric">sMAPE %</th></tr></thead><tbody>
            {([evaluation.validation.metrics.last_value, evaluation.validation.metrics.seasonal_naive, evaluation.holdout.selected, evaluation.holdout.naive]).map((metrics, index) => <tr key={t.blocks[index]}><td>{t.blocks[index]}</td><td className="numeric">{metrics.count}</td><td className="numeric">{number(metrics.mae)}</td><td className="numeric">{number(metrics.rmse)}</td><td className="numeric">{number(metrics.smape_percent)}</td></tr>)}
          </tbody></table></div><div className="monthly-details" style={{ marginTop: 14 }}><p>{t.blockDates(evaluation.initial_training_months, month(evaluation.validation.points[0]?.reporting_month ?? ""), month(evaluation.validation.points.at(-1)?.reporting_month ?? ""), month(evaluation.holdout.points[0]?.reporting_month ?? ""), month(evaluation.holdout.points.at(-1)?.reporting_month ?? ""))}</p><p>{t.skill(evaluation.holdout.mae_skill_vs_naive === null ? t.unavailable : `${number(evaluation.holdout.mae_skill_vs_naive * 100)}%`)}</p></div></section>
          <section className="panel table-panel"><div className="panel-heading"><div><h2>{t.holdoutTargets}</h2><p>{t.holdoutHint}</p></div><button className="button-secondary" onClick={() => exportModule([
            ["reporting_month", "training_through", "actual", "last_value", "seasonal_naive", "selected_model", "snapshot_id", "evaluated_at", "formula_version", "price_unit"],
            ...evaluation.holdout.points.map((row) => [row.reporting_month, row.training_through, row.actual, row.last_value, row.seasonal_naive, evaluation.selected_model, snapshot.id, snapshot.evaluated_at, snapshot.formula_version, "INR/quintal"]),
          ], "areca-pulse-forecast-holdout.csv")}>{t.exportHoldout}</button></div><div className="table-scroll" tabIndex={0} role="region" aria-label={t.holdoutAria}><table><caption>{t.holdoutCaption}</caption><thead><tr><th>{t.target}</th><th>{t.trainingThrough}</th><th className="numeric">{t.actual}</th><th className="numeric">{t.lastValue}</th><th className="numeric">{t.seasonalNaive}</th></tr></thead><tbody>{evaluation.holdout.points.map((row) => <tr key={row.reporting_month}><td>{month(row.reporting_month)}</td><td>{month(row.training_through)}</td><td className="numeric">{number(row.actual)}</td><td className="numeric">{number(row.last_value)}</td><td className="numeric">{number(row.seasonal_naive)}</td></tr>)}</tbody></table></div></section>
        </>}
        <section className="panel"><div className="panel-heading"><div><h2>{t.snapshotTitle}</h2><p>{t.snapshotHint(snapshot.id, snapshot.source_fingerprint)}</p></div></div><div className="monthly-details"><button className="button-secondary" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "areca-pulse-evaluated-forecast.json"; anchor.click(); URL.revokeObjectURL(url); }}>{t.exportJson}</button><details><summary>{t.inputs}</summary><ul>{snapshot.inputs.prices.map((row) => <li key={row.reporting_month}>{t.inputLine(month(row.reporting_month), number(row.weighted_price), format.timestamp(row.fetched_at))} <a href={api.monthlySnapshotUrl(row.refresh_run_id)}>{t.archivedReport}</a></li>)}</ul></details></div></section>
      </>}
    </>}
    <section className="panel"><div className="panel-heading"><div><h2>{t.runTitle}</h2><p>{t.runHint}</p></div></div><div className="monthly-details"><form className="monthly-refresh" onSubmit={(event) => { event.preventDefault(); evaluate.mutate(); }}><label className="filter-control"><span>{t.token}</span><input type="password" autoComplete="off" value={token} required disabled={evaluate.isPending} onChange={(event) => setToken(event.target.value)} /></label><button className="button-secondary" disabled={evaluate.isPending}>{evaluate.isPending ? t.evaluating : t.evaluate}</button><button type="button" className="button-secondary" disabled={evaluate.isPending} onClick={() => { setToken(""); evaluate.reset(); }}>{t.clearToken}</button></form>{evaluate.error && <ErrorState error={evaluate.error} />}{evaluate.isSuccess && <p role="status">{t.stored(t.status[evaluate.data.status] ?? evaluate.data.status)}</p>}</div></section>
  </div>;
}

type Evaluation = NonNullable<NonNullable<NonNullable<import("../services/modules").ForecastData["snapshot"]>["results"]["evaluation"]>>;

/** Actual backtest results: every validation and holdout month, including months where the baseline did poorly. */
function BacktestPanels({ evaluation, forecast, publishable, variety, inputs }: { evaluation: Evaluation; forecast: import("../services/modules").Forecast | null; publishable: boolean; variety: string; inputs: { reporting_month: string; weighted_price: number | null }[] }) {
  const t = useCopy(COPY);
  const format = useFormat();
  // Calibration months sit between validation and holdout. They stay on the axis, so a year is not silently squeezed out of the time scale.
  const points = [...evaluation.validation.points, ...evaluation.holdout.points];
  const byMonth = new Map(points.map((point) => [point.reporting_month, point]));
  const observed = new Map(inputs.map((row) => [row.reporting_month, row.weighted_price]));
  const months: string[] = [];
  for (let month = points[0]?.reporting_month, last = points.at(-1)?.reporting_month; month && last && month <= last; month = shiftCalendarMonth(month, 1)) months.push(month);
  const actuals = months.map((month) => byMonth.get(month)?.actual ?? observed.get(month) ?? null);
  const baseline = (key: "last_value" | "seasonal_naive") => months.map((month) => byMonth.get(month)?.[key] ?? null);
  const label = (value: string) => format.month(value);
  const nextLabel = forecast ? t.next(label(forecast.reporting_month)) : null;
  const categories = [...months.map(label), ...(nextLabel ? [nextLabel] : [])];
  const pad = forecast ? [null] : [];
  const lastValidation = evaluation.validation.points.at(-1)?.reporting_month, firstHoldout = evaluation.holdout.points[0]?.reporting_month, lastHoldout = evaluation.holdout.points.at(-1)?.reporting_month;
  const regions = [
    ...(lastValidation && firstHoldout && shiftCalendarMonth(lastValidation, 1) < firstHoldout ? [{ from: label(shiftCalendarMonth(lastValidation, 1)), to: label(shiftCalendarMonth(firstHoldout, -1)), label: t.calibration }] : []),
    ...(firstHoldout && lastHoldout ? [{ from: label(firstHoldout), to: label(lastHoldout), label: t.holdout }] : []),
  ];
  const selected = evaluation.selected_model;
  const errors = evaluation.holdout.points.map((point) => point[selected] === null || point.actual === null ? null : Math.abs(point.actual - point[selected]!));
  const naiveErrors = evaluation.holdout.points.map((point) => point.last_value === null || point.actual === null ? null : Math.abs(point.actual - point.last_value));
  const skill = evaluation.holdout.mae_skill_vs_naive;
  const tone = skill !== null && skill > 0 ? "warn" : "bad";
  const mae = (key: "last_value" | "seasonal_naive") => {
    const values = evaluation.holdout.points.flatMap((point) => point.actual === null || point[key] === null ? [] : [Math.abs(point.actual - point[key]!)]);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const rupees = (value: number | null | undefined) => value == null ? "—" : `₹${Math.round(value).toLocaleString("en-IN")}`;
  const selfBenchmark = selected === "last_value";
  const modelName = t.models[selected] ?? selected.replace("_", " ");
  return <section className="chart-grid">
    <article className="panel chart-panel"><div className="panel-heading"><div><h2>{t.backtest}</h2><p>{t.backtestHint(evaluation.validation.points.length, evaluation.holdout.points.length, label(evaluation.holdout.points[0]?.reporting_month ?? ""))}</p></div>
      <StatusBadge tone={publishable ? "warn" : "neutral"}>{publishable ? t.referenceExperimental : t.notPublishable}</StatusBadge></div>
      <LazyLineChart categories={categories} description={t.backtestDescription(variety)} regions={regions} height={340}
        series={[
          { name: t.actual, values: [...actuals, ...pad], width: 2.25, markers: false },
          { name: t.lastValue, values: [...baseline("last_value"), ...(forecast && forecast.model === "last_value" ? [forecast.point] : pad)], dashed: true, color: INK[500], width: 1.5, markers: false },
          { name: t.seasonalNaive, values: [...baseline("seasonal_naive"), ...(forecast && forecast.model === "seasonal_naive" ? [forecast.point] : pad)], dotted: true, color: INK[400], width: 1.5, markers: false },
        ]}
        band={forecast ? { name: t.nextInterval(Math.round(forecast.nominal_coverage * 100)), lower: [...months.map(() => null), forecast.lower], upper: [...months.map(() => null), forecast.upper] } : undefined} />
      <p className="panel-note">{t.backtestNote(firstHoldout ? label(firstHoldout) : "—", lastHoldout ? label(lastHoldout) : "—", Math.round(evaluation.holdout.interval_coverage * 100), forecast ? t.nextNote(label(forecast.reporting_month), rupees(forecast.lower), rupees(forecast.upper)) : "")}</p>
      <div className="chart-foot"><SourceLabel>{t.backtestSource(variety)}</SourceLabel></div></article>
    <article className="panel chart-panel"><div className="panel-heading"><div><h2>{t.errorTitle}</h2><p>{t.errorHint(modelName)}</p></div>
      <StatusBadge tone={tone}>{selfBenchmark ? t.selfBenchmark : skill === null ? t.skillUnavailable : skill > 0 ? t.better((skill * 100).toFixed(1)) : skill === 0 ? t.noImprovement : t.worse((-skill * 100).toFixed(1))}</StatusBadge></div>
      <LazyBarChart categories={evaluation.holdout.points.map((point) => label(point.reporting_month))} values={errors} name={t.absoluteError(modelName)} description={t.errorDescription} color={(index) => (errors[index] ?? 0) > (naiveErrors[index] ?? Infinity) ? INK[400] : INK[900]} />
      <p className="panel-note">{selfBenchmark ? t.selfNote : t.lightBars} {t.holdoutMaeLine(rupees(mae("last_value")), rupees(mae("seasonal_naive")))}</p>
      <div className="chart-foot"><SourceLabel>{t.retrospective}</SourceLabel></div></article>
  </section>;
}

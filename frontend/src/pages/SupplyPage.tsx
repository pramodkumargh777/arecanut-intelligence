import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { usePhone } from "../components/usePhone";
import { arrivalRows, type Advisory, type ForecastGate, type Granularity, type ProductionEstimate, type SupplySource } from "../services/supply";
import { defineCopy, useCopy, useFormat } from "../services/language";

const num = (value: number | null | undefined, digits = 1) => value == null ? "—" : value.toLocaleString("en-IN", { maximumFractionDigits: digits });
const signed = (value: number | null | undefined) => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const label = (value: string) => value.replace(/_/g, " ");
type Period = { from: string; to: string } | null | undefined;

const COPY = defineCopy({
  en: {
    noRecordsInRange: "No records in range", periodTo: (from: string, to: string) => `${from} to ${to}`,
    stage: { final: "Final", third_advance: "Third advance", second_advance: "Second advance", first_advance: "First advance", unspecified: "Stage not stated" } as Record<string, string>,
    advisory: { field_reported: "Verified field reports", weather_watch: "Weather watch (not a diagnosis)", insufficient_data: "Insufficient weather data", no_advisory: "No advisory" } as Record<Advisory["level"], string>,
    dataTypes: {
      station_measurement: "Physical weather-station measurement (authorized official import).",
      reanalysis: "ERA5 reanalysis via the Open-Meteo archive: model-derived grid estimate, not a station observation. Recent values are preliminary (ERA5T) and may be revised.",
      model_grid: "Open-Meteo numerical-model grid estimate near Sirsi: not a physical station observation.",
      official_forecast: "Official forecast issued by the provider.",
    } as Record<string, string>,
    dataTypeNames: { station_measurement: "station measurement", reanalysis: "reanalysis", model_grid: "model grid", official_forecast: "official forecast" } as Record<string, string>,
    freshness: { fresh: "fresh", stale: "stale", missing: "missing" } as Record<string, string>,
    provenance: (period: string) => `Reporting period: ${period}. Source:`, sourceWord: "Source", document: "document", published: (date: string) => `, published ${date}`, noneRecorded: "none recorded",
    forecastNotice: (subject: string, points: number) => `${subject} forecast: ${points} points available; eligible for evaluation only, not published.`,
    title: "Supply and weather", intro: "Government production estimates and weather datasets. Every table states its source and reporting period.",
    production: "Production", productionHint: "Area, production and yield by agricultural year, with estimate stage and revision history.", geography: "Geography",
    noEstimates: "No production estimates", noEstimatesHint: (geography: string) => `No published estimates have been captured for ${geography}.`,
    agriculturalYears: (period: string) => `${period} (agricultural years)`,
    estimatesAria: "Production estimates", year: "Year", estimateStage: "Estimate stage", area: (unit: string) => `Area (${unit})`, productionCol: (unit: string) => `Production (${unit})`,
    yieldCol: (unit: string) => `Yield (${unit})`, comparisonProduction: (geography: string) => `${geography} production`, share: "Share", publication: "Publication",
    revised: " · revised", stageUpdated: " · stage updated", dateNotStated: "date not stated",
    growthAria: "Production growth", measure: "Measure", yoyChanges: "Year-on-year changes", cagr: "Compound annual growth", mixedStages: " *mixed estimate stages",
    measures: { production: "production", area: "area", yield: "yield" } as Record<string, string>,
    revisionsAria: "Revision history", revision: "Revision", productionChange: "Production change", areaChange: "Area change", yieldChange: "Yield change", source: "Source",
    noRevisions: "No revisions recorded between estimate vintages.",
    productionNotes: ["Current values use the most mature estimate stage available (final > third > second > first advance > unspecified).",
      "Growth rates that span different estimate stages are flagged as mixed; advance estimates are commonly revised."],
    mixedNote: "* Growth spans different estimate stages and may change when estimates are finalised.",
    districtAnalysis: "District analysis:", selectState: "select a state.", districtRecords: (n: number, period: string) => `${n} original district records (${period}).`,
    noDistricts: "No original district-level production records have been imported for this geography. Areca Pulse never apportions state totals to districts.",
    productionSubject: "Production", arrivalSubject: "Arrival",
    arrivals: "Market arrivals", arrivalsHint: "Arrival and traded quantities are separate measures and are never added together.", period: "Period",
    granularity: { daily: "daily", weekly: "weekly", monthly: "monthly", seasonal: "seasonal" } as Record<Granularity, string>,
    arrivalsMeta: (period: string, from: string, to: string, sources: string, unit: string) => `Reporting period: ${period} (requested ${from} to ${to}). Sources: ${sources}. Unit: ${unit}.`,
    imported: (name: string, time: string) => `${name} (imported ${time})`, noneImported: "none imported",
    noArrivals: "No arrival records",
    noArrivalsHint: "No arrival or traded-quantity records exist for this selection. The AGMARKNET daily API resource carries no arrival quantities, and eNAM offers no public API; records appear only after an authorized file import.",
    arrivalsAria: "Arrivals", arrivalsT: "Arrivals (t)", arrivalMarkets: "Arrival markets", tradedT: "Traded (t)", tradedMarkets: "Traded markets", unknownUnit: "Unknown-unit rows",
    arrivalNotes: ["Arrivals and traded quantities are separate measures and are never added together.",
      "Weekly buckets start on Monday; seasons follow IMD meteorological seasons, not the arecanut harvest calendar."],
    weather: "Weather", weatherHint: "Model-derived grid estimates are never labelled as station observations. Observations and forecasts are kept separate.", district: "District",
    weatherPeriod: (period: string) => `Reporting period: ${period}.`, latestCapture: (time: string, status: string) => ` Latest model capture ${time} (${status}).`,
    lastImported: (dataset: string, time: string) => ` ${dataset} last imported ${time}.`,
    noWeather: "No weather records",
    noWeatherHint: (district: string) => `No weather records exist for ${district}. The Open-Meteo development capture covers only a grid point near Sirsi (Uttara Kannada); IMD station data requires approved API access or an authorized import.`,
    seasonalAria: "Seasonal weather", season: "Season", dataType: "Data type", coverage: "Coverage", rainfall: "Rainfall (mm)", rainyDays: "Days ≥2.5 mm", humidity: "Mean humidity (%)",
    daysCoverage: (have: number, expected: number, complete: boolean) => `${have}/${expected} days${complete ? "" : " (partial)"}`,
    recentAria: "Recent daily weather", date: "Date", rain: "Rain (mm)", max: "Max °C", min: "Min °C", humidityShort: "Humidity (%)",
    forecasts: "Forecasts", officialDays: (n: number) => `${n} official forecast days imported.`, modelAria: "Model forecast", target: "Target date", type: "Type", issued: "Issued",
    forecastType: (type: string) => `${type} forecast`,
    warnings: "District warnings", warning: (from: string, to: string, level: string, phenomena: string, provider: string, issued: string) => `${from} to ${to}: ${level} · ${phenomena} (${provider}, issued ${issued})`,
    weatherNotes: ["Observation-type datasets and forecasts are stored and shown separately.", "Seasons follow IMD meteorological definitions. Seasons with missing days are marked incomplete."],
    risk: "Arecanut crop-risk advisories", riskHint: "Rule-based watch levels from expert-approved ICAR-CPCRI criteria. Never a diagnosis.",
    disclaimer: "Areca Pulse advisories are not diagnoses. Weather can indicate conditions that published research associates with a hazard; only field inspection and laboratory confirmation can establish presence. Consult ICAR-CPCRI or the State Horticulture Department before applying any treatment.",
    evaluated: (district: string, asOf: string, period: string, types: string) => `Evaluated for ${district} as of ${asOf}; weather basis ${period} (${types}).`, noWeatherData: "no weather data",
    noAdvisory: "No advisory issued", noAdvisoryHint: "No crop-risk rule has been approved by a qualified expert, so no advisory is issued.",
    policy: "Rules are drafts until a qualified agricultural expert approves them. Only expert-approved rules generate advisories.",
    rulesAria: "Risk rules", hazard: "Hazard", version: "Version", status: "Status", relevance: "Weather relevance", evidence: "Evidence", blockers: "Approval blockers",
    noCitation: (status: string) => `No verified citation (${status})`, none: "None",
  },
  kn: {
    noRecordsInRange: "ಈ ಅವಧಿಯಲ್ಲಿ ದಾಖಲೆಗಳಿಲ್ಲ", periodTo: (from: string, to: string) => `${from} ರಿಂದ ${to}`,
    stage: { final: "ಅಂತಿಮ", third_advance: "ಮೂರನೇ ಮುಂಗಡ", second_advance: "ಎರಡನೇ ಮುಂಗಡ", first_advance: "ಮೊದಲ ಮುಂಗಡ", unspecified: "ಹಂತ ತಿಳಿಸಿಲ್ಲ" },
    advisory: { field_reported: "ಪರಿಶೀಲಿತ ತೋಟದ ವರದಿಗಳು", weather_watch: "ಹವಾಮಾನ ಎಚ್ಚರಿಕೆ (ರೋಗ ನಿರ್ಣಯವಲ್ಲ)", insufficient_data: "ಸಾಕಷ್ಟು ಹವಾಮಾನ ದತ್ತಾಂಶವಿಲ್ಲ", no_advisory: "ಸಲಹೆ ಇಲ್ಲ" },
    dataTypes: {
      station_measurement: "ಹವಾಮಾನ ಕೇಂದ್ರದ ನಿಜವಾದ ಅಳತೆ (ಅಧಿಕೃತ ಆಮದು).",
      reanalysis: "Open-Meteo ಸಂಗ್ರಹದ ERA5 ಮರುವಿಶ್ಲೇಷಣೆ: ಮಾದರಿ ಆಧಾರಿತ ಗ್ರಿಡ್ ಅಂದಾಜು, ಕೇಂದ್ರದ ಅಳತೆಯಲ್ಲ. ಇತ್ತೀಚಿನ ಮೌಲ್ಯಗಳು ಪ್ರಾಥಮಿಕ (ERA5T), ಬದಲಾಗಬಹುದು.",
      model_grid: "ಶಿರಸಿ ಹತ್ತಿರದ Open-Meteo ಮಾದರಿ ಗ್ರಿಡ್ ಅಂದಾಜು: ಕೇಂದ್ರದ ಅಳತೆಯಲ್ಲ.",
      official_forecast: "ಸೇವಾದಾರರು ನೀಡಿದ ಅಧಿಕೃತ ಮುನ್ಸೂಚನೆ.",
    },
    dataTypeNames: { station_measurement: "ಕೇಂದ್ರದ ಅಳತೆ", reanalysis: "ಮರುವಿಶ್ಲೇಷಣೆ", model_grid: "ಮಾದರಿ ಗ್ರಿಡ್", official_forecast: "ಅಧಿಕೃತ ಮುನ್ಸೂಚನೆ" },
    freshness: { fresh: "ಹೊಸದು", stale: "ಹಳೆಯದು", missing: "ಇಲ್ಲ" },
    provenance: (period: string) => `ವರದಿ ಅವಧಿ: ${period}. ಮೂಲ:`, sourceWord: "ಮೂಲ", document: "ದಾಖಲೆ", published: (date: string) => `, ಪ್ರಕಟಣೆ ${date}`, noneRecorded: "ದಾಖಲಾಗಿಲ್ಲ",
    forecastNotice: (subject: string, points: number) => `${subject} ಮುನ್ಸೂಚನೆ: ${points} ದಾಖಲೆಗಳು ಲಭ್ಯ; ಮೌಲ್ಯಮಾಪನಕ್ಕೆ ಮಾತ್ರ ಅರ್ಹ, ಪ್ರಕಟಿಸಿಲ್ಲ.`,
    title: "ಉತ್ಪಾದನೆ ಮತ್ತು ಹವಾಮಾನ", intro: "ಸರ್ಕಾರದ ಉತ್ಪಾದನಾ ಅಂದಾಜುಗಳು ಮತ್ತು ಹವಾಮಾನ ದತ್ತಾಂಶ. ಪ್ರತಿ ಪಟ್ಟಿಯೂ ಅದರ ಮೂಲ ಮತ್ತು ವರದಿ ಅವಧಿಯನ್ನು ತಿಳಿಸುತ್ತದೆ.",
    production: "ಉತ್ಪಾದನೆ", productionHint: "ಕೃಷಿ ವರ್ಷವಾರು ವಿಸ್ತೀರ್ಣ, ಉತ್ಪಾದನೆ ಮತ್ತು ಇಳುವರಿ, ಅಂದಾಜಿನ ಹಂತ ಮತ್ತು ತಿದ್ದುಪಡಿ ಇತಿಹಾಸದೊಂದಿಗೆ.", geography: "ಪ್ರದೇಶ",
    noEstimates: "ಉತ್ಪಾದನಾ ಅಂದಾಜುಗಳಿಲ್ಲ", noEstimatesHint: (geography: string) => `${geography} ಗೆ ಯಾವುದೇ ಪ್ರಕಟಿತ ಅಂದಾಜು ಸಂಗ್ರಹವಾಗಿಲ್ಲ.`,
    agriculturalYears: (period: string) => `${period} (ಕೃಷಿ ವರ್ಷಗಳು)`,
    estimatesAria: "ಉತ್ಪಾದನಾ ಅಂದಾಜುಗಳು", year: "ವರ್ಷ", estimateStage: "ಅಂದಾಜಿನ ಹಂತ", area: (unit: string) => `ವಿಸ್ತೀರ್ಣ (${unit})`, productionCol: (unit: string) => `ಉತ್ಪಾದನೆ (${unit})`,
    yieldCol: (unit: string) => `ಇಳುವರಿ (${unit})`, comparisonProduction: (geography: string) => `${geography} ಉತ್ಪಾದನೆ`, share: "ಪಾಲು", publication: "ಪ್ರಕಟಣೆ",
    revised: " · ತಿದ್ದಲಾಗಿದೆ", stageUpdated: " · ಹಂತ ಬದಲಾಗಿದೆ", dateNotStated: "ದಿನಾಂಕ ತಿಳಿಸಿಲ್ಲ",
    growthAria: "ಉತ್ಪಾದನಾ ಬೆಳವಣಿಗೆ", measure: "ಅಳತೆ", yoyChanges: "ವರ್ಷದಿಂದ ವರ್ಷದ ಬದಲಾವಣೆ", cagr: "ಸಂಯುಕ್ತ ವಾರ್ಷಿಕ ಬೆಳವಣಿಗೆ", mixedStages: " *ಬೇರೆ ಬೇರೆ ಅಂದಾಜು ಹಂತಗಳು",
    measures: { production: "ಉತ್ಪಾದನೆ", area: "ವಿಸ್ತೀರ್ಣ", yield: "ಇಳುವರಿ" },
    revisionsAria: "ತಿದ್ದುಪಡಿ ಇತಿಹಾಸ", revision: "ತಿದ್ದುಪಡಿ", productionChange: "ಉತ್ಪಾದನೆ ಬದಲಾವಣೆ", areaChange: "ವಿಸ್ತೀರ್ಣ ಬದಲಾವಣೆ", yieldChange: "ಇಳುವರಿ ಬದಲಾವಣೆ", source: "ಮೂಲ",
    noRevisions: "ಅಂದಾಜಿನ ಆವೃತ್ತಿಗಳ ನಡುವೆ ಯಾವುದೇ ತಿದ್ದುಪಡಿ ದಾಖಲಾಗಿಲ್ಲ.",
    productionNotes: ["ಈಗಿನ ಮೌಲ್ಯಗಳು ಲಭ್ಯವಿರುವ ಅತ್ಯಂತ ಪಕ್ವ ಅಂದಾಜು ಹಂತವನ್ನು ಬಳಸುತ್ತವೆ (ಅಂತಿಮ > ಮೂರನೇ > ಎರಡನೇ > ಮೊದಲ ಮುಂಗಡ > ತಿಳಿಸದ್ದು).",
      "ಬೇರೆ ಬೇರೆ ಅಂದಾಜು ಹಂತಗಳನ್ನು ಒಳಗೊಂಡ ಬೆಳವಣಿಗೆ ದರಗಳನ್ನು ಮಿಶ್ರ ಎಂದು ಗುರುತಿಸಲಾಗಿದೆ; ಮುಂಗಡ ಅಂದಾಜುಗಳು ಸಾಮಾನ್ಯವಾಗಿ ತಿದ್ದುಪಡಿಯಾಗುತ್ತವೆ."],
    mixedNote: "* ಬೆಳವಣಿಗೆ ಬೇರೆ ಬೇರೆ ಅಂದಾಜು ಹಂತಗಳನ್ನು ಒಳಗೊಂಡಿದೆ; ಅಂದಾಜುಗಳು ಅಂತಿಮವಾದಾಗ ಬದಲಾಗಬಹುದು.",
    districtAnalysis: "ಜಿಲ್ಲಾ ವಿಶ್ಲೇಷಣೆ:", selectState: "ರಾಜ್ಯವನ್ನು ಆಯ್ಕೆಮಾಡಿ.", districtRecords: (n: number, period: string) => `${n} ಮೂಲ ಜಿಲ್ಲಾ ದಾಖಲೆಗಳು (${period}).`,
    noDistricts: "ಈ ಪ್ರದೇಶಕ್ಕೆ ಮೂಲ ಜಿಲ್ಲಾ ಮಟ್ಟದ ಉತ್ಪಾದನಾ ದಾಖಲೆಗಳು ಆಮದಾಗಿಲ್ಲ. Areca Pulse ರಾಜ್ಯದ ಒಟ್ಟನ್ನು ಜಿಲ್ಲೆಗಳಿಗೆ ಎಂದೂ ಹಂಚುವುದಿಲ್ಲ.",
    productionSubject: "ಉತ್ಪಾದನೆ", arrivalSubject: "ಆವಕ",
    arrivals: "ಮಾರುಕಟ್ಟೆ ಆವಕ", arrivalsHint: "ಆವಕ ಮತ್ತು ವಹಿವಾಟಿನ ಪ್ರಮಾಣಗಳು ಬೇರೆ ಬೇರೆ ಅಳತೆಗಳು; ಎಂದೂ ಕೂಡಿಸುವುದಿಲ್ಲ.", period: "ಅವಧಿ",
    granularity: { daily: "ದೈನಂದಿನ", weekly: "ವಾರದ", monthly: "ತಿಂಗಳ", seasonal: "ಋತುವಾರು" },
    arrivalsMeta: (period: string, from: string, to: string, sources: string, unit: string) => `ವರದಿ ಅವಧಿ: ${period} (ಕೇಳಿದ್ದು ${from} ರಿಂದ ${to}). ಮೂಲಗಳು: ${sources}. ಘಟಕ: ${unit}.`,
    imported: (name: string, time: string) => `${name} (ಆಮದು ${time})`, noneImported: "ಯಾವುದೂ ಆಮದಾಗಿಲ್ಲ",
    noArrivals: "ಆವಕ ದಾಖಲೆಗಳಿಲ್ಲ",
    noArrivalsHint: "ಈ ಆಯ್ಕೆಗೆ ಆವಕ ಅಥವಾ ವಹಿವಾಟಿನ ಪ್ರಮಾಣದ ದಾಖಲೆಗಳಿಲ್ಲ. AGMARKNET ದೈನಂದಿನ API ಆವಕದ ಪ್ರಮಾಣ ನೀಡುವುದಿಲ್ಲ, eNAM ಗೆ ಸಾರ್ವಜನಿಕ API ಇಲ್ಲ; ಅಧಿಕೃತ ಕಡತ ಆಮದಿನ ನಂತರವೇ ದಾಖಲೆಗಳು ಕಾಣಿಸುತ್ತವೆ.",
    arrivalsAria: "ಆವಕ", arrivalsT: "ಆವಕ (ಟನ್)", arrivalMarkets: "ಆವಕದ ಮಾರುಕಟ್ಟೆಗಳು", tradedT: "ವಹಿವಾಟು (ಟನ್)", tradedMarkets: "ವಹಿವಾಟಿನ ಮಾರುಕಟ್ಟೆಗಳು", unknownUnit: "ಘಟಕ ತಿಳಿಯದ ಸಾಲುಗಳು",
    arrivalNotes: ["ಆವಕ ಮತ್ತು ವಹಿವಾಟಿನ ಪ್ರಮಾಣಗಳು ಬೇರೆ ಬೇರೆ ಅಳತೆಗಳು; ಎಂದೂ ಕೂಡಿಸುವುದಿಲ್ಲ.",
      "ವಾರಗಳು ಸೋಮವಾರದಿಂದ ಆರಂಭ; ಋತುಗಳು IMD ಹವಾಮಾನ ಋತುಗಳು, ಅಡಿಕೆ ಕೊಯ್ಲಿನ ಕ್ಯಾಲೆಂಡರ್ ಅಲ್ಲ."],
    weather: "ಹವಾಮಾನ", weatherHint: "ಮಾದರಿ ಆಧಾರಿತ ಗ್ರಿಡ್ ಅಂದಾಜುಗಳನ್ನು ಎಂದೂ ಕೇಂದ್ರದ ಅಳತೆ ಎಂದು ಕರೆಯುವುದಿಲ್ಲ. ಅಳತೆ ಮತ್ತು ಮುನ್ಸೂಚನೆಗಳನ್ನು ಪ್ರತ್ಯೇಕವಾಗಿ ಇಡಲಾಗಿದೆ.", district: "ಜಿಲ್ಲೆ",
    weatherPeriod: (period: string) => `ವರದಿ ಅವಧಿ: ${period}.`, latestCapture: (time: string, status: string) => ` ಇತ್ತೀಚಿನ ಮಾದರಿ ಸಂಗ್ರಹ ${time} (${status}).`,
    lastImported: (dataset: string, time: string) => ` ${dataset} ಕೊನೆಯ ಆಮದು ${time}.`,
    noWeather: "ಹವಾಮಾನ ದಾಖಲೆಗಳಿಲ್ಲ",
    noWeatherHint: (district: string) => `${district} ಗೆ ಹವಾಮಾನ ದಾಖಲೆಗಳಿಲ್ಲ. Open-Meteo ಅಭಿವೃದ್ಧಿ ಸಂಗ್ರಹವು ಶಿರಸಿ (ಉತ್ತರ ಕನ್ನಡ) ಹತ್ತಿರದ ಒಂದು ಗ್ರಿಡ್ ಬಿಂದುವನ್ನು ಮಾತ್ರ ಒಳಗೊಂಡಿದೆ; IMD ಕೇಂದ್ರದ ದತ್ತಾಂಶಕ್ಕೆ ಅನುಮೋದಿತ API ಪ್ರವೇಶ ಅಥವಾ ಅಧಿಕೃತ ಆಮದು ಬೇಕು.`,
    seasonalAria: "ಋತುವಾರು ಹವಾಮಾನ", season: "ಋತು", dataType: "ದತ್ತಾಂಶದ ವಿಧ", coverage: "ವ್ಯಾಪ್ತಿ", rainfall: "ಮಳೆ (ಮಿಮೀ)", rainyDays: "≥2.5 ಮಿಮೀ ಮಳೆ ದಿನಗಳು", humidity: "ಸರಾಸರಿ ಆರ್ದ್ರತೆ (%)",
    daysCoverage: (have: number, expected: number, complete: boolean) => `${expected} ರಲ್ಲಿ ${have} ದಿನ${complete ? "" : " (ಭಾಗಶಃ)"}`,
    recentAria: "ಇತ್ತೀಚಿನ ದೈನಂದಿನ ಹವಾಮಾನ", date: "ದಿನಾಂಕ", rain: "ಮಳೆ (ಮಿಮೀ)", max: "ಗರಿಷ್ಠ °C", min: "ಕನಿಷ್ಠ °C", humidityShort: "ಆರ್ದ್ರತೆ (%)",
    forecasts: "ಮುನ್ಸೂಚನೆಗಳು", officialDays: (n: number) => `${n} ಅಧಿಕೃತ ಮುನ್ಸೂಚನೆ ದಿನಗಳು ಆಮದಾಗಿವೆ.`, modelAria: "ಮಾದರಿ ಮುನ್ಸೂಚನೆ", target: "ಗುರಿ ದಿನಾಂಕ", type: "ವಿಧ", issued: "ನೀಡಿದ ಸಮಯ",
    forecastType: (type: string) => `${type} ಮುನ್ಸೂಚನೆ`,
    warnings: "ಜಿಲ್ಲಾ ಎಚ್ಚರಿಕೆಗಳು", warning: (from: string, to: string, level: string, phenomena: string, provider: string, issued: string) => `${from} ರಿಂದ ${to}: ${level} · ${phenomena} (${provider}, ನೀಡಿದ್ದು ${issued})`,
    weatherNotes: ["ಅಳತೆಯ ದತ್ತಾಂಶ ಮತ್ತು ಮುನ್ಸೂಚನೆಗಳನ್ನು ಪ್ರತ್ಯೇಕವಾಗಿ ಸಂಗ್ರಹಿಸಿ ತೋರಿಸಲಾಗುತ್ತದೆ.", "ಋತುಗಳು IMD ಹವಾಮಾನ ವ್ಯಾಖ್ಯಾನದಂತೆ. ದಿನಗಳು ಇಲ್ಲದ ಋತುಗಳನ್ನು ಅಪೂರ್ಣ ಎಂದು ಗುರುತಿಸಲಾಗಿದೆ."],
    risk: "ಅಡಿಕೆ ಬೆಳೆ ಅಪಾಯದ ಸಲಹೆಗಳು", riskHint: "ತಜ್ಞರು ಅನುಮೋದಿಸಿದ ICAR-CPCRI ಮಾನದಂಡಗಳಿಂದ ನಿಯಮ ಆಧಾರಿತ ಎಚ್ಚರಿಕೆ ಮಟ್ಟಗಳು. ಎಂದೂ ರೋಗ ನಿರ್ಣಯವಲ್ಲ.",
    disclaimer: "Areca Pulse ಸಲಹೆಗಳು ರೋಗ ನಿರ್ಣಯವಲ್ಲ. ಹವಾಮಾನವು ಸಂಶೋಧನೆಯಲ್ಲಿ ಅಪಾಯಕ್ಕೆ ಸಂಬಂಧಿಸಿದ ಪರಿಸ್ಥಿತಿಗಳನ್ನು ಸೂಚಿಸಬಹುದು; ತೋಟದ ಪರಿಶೀಲನೆ ಮತ್ತು ಪ್ರಯೋಗಾಲಯ ದೃಢೀಕರಣ ಮಾತ್ರ ರೋಗವನ್ನು ಖಚಿತಪಡಿಸುತ್ತದೆ. ಯಾವುದೇ ಚಿಕಿತ್ಸೆ ಮಾಡುವ ಮೊದಲು ICAR-CPCRI ಅಥವಾ ರಾಜ್ಯ ತೋಟಗಾರಿಕೆ ಇಲಾಖೆಯನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    evaluated: (district: string, asOf: string, period: string, types: string) => `${district} ಗೆ ${asOf} ರಂತೆ ಮೌಲ್ಯಮಾಪನ; ಹವಾಮಾನ ಆಧಾರ ${period} (${types}).`, noWeatherData: "ಹವಾಮಾನ ದತ್ತಾಂಶವಿಲ್ಲ",
    noAdvisory: "ಯಾವುದೇ ಸಲಹೆ ನೀಡಿಲ್ಲ", noAdvisoryHint: "ಯಾವುದೇ ಬೆಳೆ ಅಪಾಯದ ನಿಯಮವನ್ನು ಅರ್ಹ ತಜ್ಞರು ಅನುಮೋದಿಸಿಲ್ಲ, ಆದ್ದರಿಂದ ಸಲಹೆ ನೀಡಿಲ್ಲ.",
    policy: "ಅರ್ಹ ಕೃಷಿ ತಜ್ಞರು ಅನುಮೋದಿಸುವವರೆಗೆ ನಿಯಮಗಳು ಕರಡು ಮಾತ್ರ. ತಜ್ಞರು ಅನುಮೋದಿಸಿದ ನಿಯಮಗಳು ಮಾತ್ರ ಸಲಹೆ ನೀಡುತ್ತವೆ.",
    rulesAria: "ಅಪಾಯದ ನಿಯಮಗಳು", hazard: "ಅಪಾಯ", version: "ಆವೃತ್ತಿ", status: "ಸ್ಥಿತಿ", relevance: "ಹವಾಮಾನ ಸಂಬಂಧ", evidence: "ಆಧಾರ", blockers: "ಅನುಮೋದನೆಗೆ ಅಡ್ಡಿಗಳು",
    noCitation: (status: string) => `ಪರಿಶೀಲಿತ ಉಲ್ಲೇಖವಿಲ್ಲ (${status})`, none: "ಯಾವುದೂ ಇಲ್ಲ",
  },
});

type Copy = typeof COPY.en;
const periodText = (t: Copy, period: Period) => !period ? t.noRecordsInRange : period.from === period.to ? period.from : t.periodTo(period.from, period.to);
const stageText = (t: Copy, row: Pick<ProductionEstimate, "estimate_type" | "estimate_label">) => t.stage[row.estimate_type] ?? row.estimate_label;
const typeName = (t: Copy, type: string) => t.dataTypeNames[type] ?? label(type);

/** "Directorate of Arecanut and Spices Development (DASD)" → "DASD": the short name a phone line has room for. */
const shortPublisher = (publisher: string) => /\(([^)]+)\)\s*$/.exec(publisher)?.[1] ?? publisher;

function Provenance({ sources, period }: { sources: SupplySource[]; period: string }) {
  const t = useCopy(COPY);
  // Phones get one line: the period, then each source by its short name, still linked and dated.
  if (usePhone()) return <p className="data-disclosure">{period} · {t.sourceWord}: {sources.length ? sources.map((source, index) => <span key={`${source.source_url}-${index}`}>
    {index ? ", " : ""}<a href={source.source_url} target="_blank" rel="noreferrer">{shortPublisher(source.publisher)}{source.publication_date ? ` ${source.publication_date}` : ""}</a></span>) : t.noneRecorded}</p>;
  return <p className="data-disclosure">{t.provenance(period)} {sources.length ? sources.map((source, index) => <span key={`${source.source_url}-${index}`}>
    {index ? "; " : ""}{source.publisher} (<a href={source.source_url} target="_blank" rel="noreferrer">{t.document}</a>{source.publication_date ? t.published(source.publication_date) : ""})</span>) : t.noneRecorded}.</p>;
}

function ForecastNotice({ gate, subject }: { gate: ForecastGate; subject: string }) {
  const t = useCopy(COPY);
  if (gate.status === "suppressed") return null;
  return <p className="data-disclosure">{t.forecastNotice(subject, gate.points)}</p>;
}

function ProductionSection() {
  const t = useCopy(COPY);
  const [geography, setGeography] = useState("Karnataka");
  const production = useQuery({ queryKey: ["supply-production", geography], queryFn: () => api.supplyProduction(geography, "All India") });
  const districts = useQuery({ queryKey: ["supply-districts", geography], enabled: geography !== "All India", queryFn: () => api.supplyDistricts(geography) });
  const data = production.data;
  const comparison = new Map((data?.comparison_current ?? []).map((row) => [row.reporting_year, row]));
  const share = new Map((data?.share_of_comparison ?? []).map((row) => [row.reporting_year, row]));
  const compare = Boolean(data?.comparison_geography && data.comparison_geography !== geography);
  return <section className="panel table-panel" aria-labelledby="supply-production">
    <div className="panel-heading"><div><h2 id="supply-production">{t.production}</h2><p>{t.productionHint}</p></div>
      <label className="filter-control"><span>{t.geography}</span><select value={geography} onChange={(event) => setGeography(event.target.value)}>
        {(data?.geographies ?? ["Karnataka", "All India"]).map((value) => <option key={value}>{value}</option>)}</select></label></div>
    {production.isLoading ? <LoadingState /> : production.error ? <ErrorState error={production.error} onRetry={() => void production.refetch()} /> : !data?.current.length ? <EmptyState title={t.noEstimates}>{t.noEstimatesHint(geography)}</EmptyState> : <>
      <Provenance sources={data.sources} period={data.reporting_period ? t.agriculturalYears(periodText(t, data.reporting_period)) : "—"} />
      <div className="table-scroll" tabIndex={0} role="region" aria-label={t.estimatesAria}><table><thead><tr><th>{t.year}</th><th>{t.estimateStage}</th><th>{t.area(data.unit.area)}</th><th>{t.productionCol(data.unit.production)}</th><th>{t.yieldCol(data.unit.yield)}</th>
        {compare ? <><th>{t.comparisonProduction(data.comparison_geography!)}</th><th>{t.share}</th></> : null}<th>{t.publication}</th></tr></thead><tbody>
        {data.current.map((row: ProductionEstimate) => <tr key={row.reporting_year}><td>{row.reporting_year}</td>
          <td>{stageText(t, row)}{row.revised ? t.revised : ""}{row.stage_changed ? t.stageUpdated : ""}</td>
          <td>{num(row.area_thousand_hectares, 3)}</td><td>{num(row.production_thousand_tonnes, 3)}</td><td>{num(row.yield_kg_hectare, 0)}</td>
          {compare ? <><td>{num(comparison.get(row.reporting_year)?.production_thousand_tonnes, 3)}</td><td>{share.get(row.reporting_year)?.percent == null ? "—" : `${share.get(row.reporting_year)!.percent}%`}</td></> : null}
          <td><a href={row.source_url} target="_blank" rel="noreferrer">{row.publication_date ?? t.dateNotStated}</a></td></tr>)}
      </tbody></table></div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={t.growthAria}><table><thead><tr><th>{t.measure}</th><th>{t.yoyChanges}</th><th>{t.cagr}</th></tr></thead><tbody>
        {(["production", "area", "yield"] as const).map((measure) => { const growth = data.growth[measure]; return <tr key={measure}><td>{t.measures[measure]}</td>
          <td>{growth.yoy.map((row) => `${row.to}: ${signed(row.percent)}${row.mixed_estimate_types ? "*" : ""}`).join(" · ") || "—"}</td>
          <td>{growth.cagr ? `${signed(growth.cagr.percent)} (${growth.cagr.from}–${growth.cagr.to})${growth.cagr.mixed_estimate_types ? t.mixedStages : ""}` : "—"}</td></tr>; })}
      </tbody></table></div>
      {data.revisions.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label={t.revisionsAria}><table><thead><tr><th>{t.year}</th><th>{t.revision}</th><th>{t.productionChange}</th><th>{t.areaChange}</th><th>{t.yieldChange}</th><th>{t.source}</th></tr></thead><tbody>
        {data.revisions.map((row) => <tr key={`${row.reporting_year}-${row.evidence_id}`}><td>{row.reporting_year}</td><td>{row.previous_estimate_type ? t.stage[row.previous_estimate_type] ?? label(row.previous_estimate_type) : "—"} → {stageText(t, row)}</td>
          <td>{num(row.change_production_thousand_tonnes, 3)}</td><td>{num(row.change_area_thousand_hectares, 3)}</td><td>{num(row.change_yield_kg_hectare, 0)}</td>
          <td><a href={row.source_url} target="_blank" rel="noreferrer">{row.publication_date ?? t.document}</a></td></tr>)}
      </tbody></table></div> : <p>{t.noRevisions}</p>}
      {/* Method notes are for reviewers; phones skip them, and the tables above still carry every value and stage. */}
      <ul className="phone-hide">{t.productionNotes.map((note) => <li key={note}>{note}</li>)}<li>{t.mixedNote}</li></ul>
      <p className="data-disclosure phone-hide">{t.districtAnalysis} {geography === "All India" ? t.selectState : districts.data?.districts.length ? t.districtRecords(districts.data.districts.length, periodText(t, districts.data.reporting_period)) : t.noDistricts}</p>
      <ForecastNotice gate={data.forecast} subject={t.productionSubject} />
    </>}
  </section>;
}

function ArrivalsSection() {
  const t = useCopy(COPY);
  const format = useFormat();
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const arrivals = useQuery({ queryKey: ["supply-arrivals", granularity], queryFn: () => api.supplyArrivals({ granularity }) });
  const data = arrivals.data, rows = data ? arrivalRows(data.measures) : [];
  // Nothing has been imported yet, so there is nothing to show at any period.
  if (data && !data.sources.length && !rows.length) return null;
  return <section className="panel table-panel" aria-labelledby="supply-arrivals">
    <div className="panel-heading"><div><h2 id="supply-arrivals">{t.arrivals}</h2><p>{t.arrivalsHint}</p></div>
      <label className="filter-control"><span>{t.period}</span><select value={granularity} onChange={(event) => setGranularity(event.target.value as Granularity)}>
        {(["daily", "weekly", "monthly", "seasonal"] as const).map((value) => <option key={value} value={value}>{t.granularity[value]}</option>)}</select></label></div>
    {arrivals.isLoading ? <LoadingState /> : arrivals.error ? <ErrorState error={arrivals.error} onRetry={() => void arrivals.refetch()} /> : !data ? null : <>
      <p className="data-disclosure">{t.arrivalsMeta(periodText(t, data.reporting_period), data.requested_range.from, data.requested_range.to, data.sources.length ? data.sources.map((source) => t.imported(source.source_name, format.timestamp(source.imported_at))).join("; ") : t.noneImported, data.unit)}</p>
      {!rows.length ? <EmptyState title={t.noArrivals}>{t.noArrivalsHint}</EmptyState> :
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t.arrivalsAria}><table><thead><tr><th>{t.period}</th><th>{t.arrivalsT}</th><th>{t.arrivalMarkets}</th><th>{t.tradedT}</th><th>{t.tradedMarkets}</th><th>{t.unknownUnit}</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.bucket}><td>{row.bucket}</td><td>{num(row.arrival?.quantity_tonnes, 3)}</td><td>{row.arrival?.markets_reporting ?? "—"}</td>
            <td>{num(row.traded?.quantity_tonnes, 3)}</td><td>{row.traded?.markets_reporting ?? "—"}</td><td>{(row.arrival?.unknown_unit_records ?? 0) + (row.traded?.unknown_unit_records ?? 0)}</td></tr>)}
        </tbody></table></div>}
      <ul className="phone-hide">{t.arrivalNotes.map((note) => <li key={note}>{note}</li>)}</ul>
      <ForecastNotice gate={data.forecast} subject={t.arrivalSubject} />
    </>}
  </section>;
}

function WeatherSection({ district, districts, setDistrict }: { district: string; districts: string[]; setDistrict: (value: string) => void }) {
  const t = useCopy(COPY);
  const format = useFormat();
  const weather = useQuery({ queryKey: ["supply-weather", district], queryFn: () => api.supplyWeather({ district }) });
  const data = weather.data, recent = (data?.history ?? []).slice(-14).reverse();
  const phone = usePhone();
  return <section className="panel table-panel" aria-labelledby="supply-weather">
    <div className="panel-heading"><div><h2 id="supply-weather">{t.weather}</h2><p>{t.weatherHint}</p></div>
      <label className="filter-control"><span>{t.district}</span><select value={district} onChange={(event) => setDistrict(event.target.value)}>
        {(districts.length ? districts : [district]).map((value) => <option key={value}>{value}</option>)}</select></label></div>
    {weather.isLoading ? <LoadingState /> : weather.error ? <ErrorState error={weather.error} onRetry={() => void weather.refetch()} /> : !data ? null : <>
      {/* Phones skip the long data-type and import note; each row still names its data type and date. */}
      <p className="data-disclosure phone-hide">{t.weatherPeriod(periodText(t, data.reporting_period))} {Object.keys(data.data_types).map((key) => `${typeName(t, key)}: ${t.dataTypes[key] ?? data.data_types[key]}`).join(" ")}
        {data.freshness.model_capture ? t.latestCapture(data.freshness.model_capture.latest ? format.timestamp(data.freshness.model_capture.latest) : "—", t.freshness[data.freshness.model_capture.status] ?? data.freshness.model_capture.status) : ""}
        {data.freshness.imports.map((item) => t.lastImported(label(item.dataset), format.timestamp(item.latest))).join("")}</p>
      {!data.history.length ? <EmptyState title={t.noWeather}>{t.noWeatherHint(district)}</EmptyState> : <>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t.seasonalAria}><table><thead><tr><th>{t.season}</th><th>{t.dataType}</th><th>{t.coverage}</th><th>{t.rainfall}</th><th>{t.rainyDays}</th><th>{t.humidity}</th></tr></thead><tbody>
          {data.seasonal.map((row) => <tr key={`${row.key}-${row.data_type}`}><td>{row.label}</td><td>{typeName(t, row.data_type)}</td><td>{t.daysCoverage(row.days_with_data, row.expected_days, row.complete)}</td>
            <td>{num(row.rainfall_total_mm)}</td><td>{row.rainy_days_2_5mm}</td><td>{num(row.mean_humidity_pct)}</td></tr>)}
        </tbody></table></div>
        {/* Phones fold the day-by-day table; the season summary above is the quick read. */}
        {phone ? <details className="phone-fold"><summary>{t.recentAria}</summary>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t.recentAria}><table><thead><tr><th>{t.date}</th><th>{t.dataType}</th><th>{t.rain}</th><th>{t.max}</th><th>{t.min}</th><th>{t.humidityShort}</th></tr></thead><tbody>
          {recent.map((row) => <tr key={`${row.day}-${row.data_type}`}><td>{format.date(row.day)}</td><td>{typeName(t, row.data_type)}</td><td>{num(row.rainfall_mm)}</td><td>{num(row.temperature_max_c)}</td><td>{num(row.temperature_min_c)}</td><td>{num(row.relative_humidity_pct)}</td></tr>)}
        </tbody></table></div></details> : <>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t.recentAria}><table><thead><tr><th>{t.date}</th><th>{t.dataType}</th><th>{t.rain}</th><th>{t.max}</th><th>{t.min}</th><th>{t.humidityShort}</th></tr></thead><tbody>
          {recent.map((row) => <tr key={`${row.day}-${row.data_type}`}><td>{format.date(row.day)}</td><td>{typeName(t, row.data_type)}</td><td>{num(row.rainfall_mm)}</td><td>{num(row.temperature_max_c)}</td><td>{num(row.temperature_min_c)}</td><td>{num(row.relative_humidity_pct)}</td></tr>)}
        </tbody></table></div></>}</>}
      {(data.forecasts.official.length > 0 || data.forecasts.model.length > 0) && <h3>{t.forecasts}</h3>}
      {data.forecasts.official.length > 0 && <p>{t.officialDays(data.forecasts.official.length)}</p>}
      {data.forecasts.model.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label={t.modelAria}><table><thead><tr><th>{t.target}</th><th className="phone-hide">{t.type}</th><th>{t.rain}</th><th>{t.max}</th><th>{t.min}</th><th className="phone-hide">{t.issued}</th></tr></thead><tbody>
        {data.forecasts.model.map((row) => <tr key={`${row.target_date}-${row.provider}`}><td>{format.date(row.target_date)}</td><td className="phone-hide">{t.forecastType(typeName(t, row.data_type))}</td><td>{num(row.rainfall_mm)}</td><td>{num(row.temperature_max_c)}</td><td>{num(row.temperature_min_c)}</td><td className="phone-hide">{format.timestamp(row.issued_at)}</td></tr>)}
      </tbody></table></div> : null}
      {data.warnings.length > 0 && <><h3>{t.warnings}</h3><ul>{data.warnings.map((row) => <li key={`${row.issued_at}-${row.valid_from}-${row.phenomena}`}>{t.warning(row.valid_from, row.valid_to, row.warning_level, row.phenomena, row.provider, format.timestamp(row.issued_at))}</li>)}</ul></>}
      <ul className="phone-hide">{t.weatherNotes.map((note) => <li key={note}>{note}</li>)}</ul>
    </>}
  </section>;
}

function RiskSection({ district }: { district: string }) {
  const t = useCopy(COPY);
  const rules = useQuery({ queryKey: ["supply-risk-rules"], queryFn: () => api.supplyRiskRules() });
  const advisories = useQuery({ queryKey: ["supply-advisories", district], queryFn: () => api.supplyAdvisories(district) });
  const latest = (rules.data?.rules ?? []).filter((rule) => rule.latest_version);
  // Rules stay unpublished until an expert approves them; readers see this section once there is an advisory to read.
  if (!advisories.data?.advisories.length) return null;
  return <section className="panel table-panel" aria-labelledby="supply-risk">
    <div className="panel-heading"><div><h2 id="supply-risk">{t.risk}</h2><p>{t.riskHint}</p></div></div>
    {advisories.isLoading ? <LoadingState /> : advisories.error ? <ErrorState error={advisories.error} onRetry={() => void advisories.refetch()} /> : advisories.data ? <>
      <p className="data-disclosure">{t.disclaimer} {t.evaluated(advisories.data.district, advisories.data.as_of, periodText(t, advisories.data.weather_basis.period), advisories.data.weather_basis.data_types.map((item) => typeName(t, item.type)).join(", ") || t.noWeatherData)}</p>
      {/* Hazard names and advisory text are expert-approved rule wording, shown as approved until a reviewed translation exists. */}
      {advisories.data.advisories.length ? <ul>{advisories.data.advisories.map((item) => <li key={item.rule_id}><strong><span lang="en">{item.hazard_name}</span>: {t.advisory[item.level]}</strong>. <span lang="en">{item.message}</span></li>)}</ul>
        : <EmptyState title={t.noAdvisory}>{t.noAdvisoryHint}</EmptyState>}
    </> : null}
    {rules.isLoading ? <LoadingState /> : rules.error ? <ErrorState error={rules.error} /> : <>
      <p>{t.policy}</p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={t.rulesAria}><table><thead><tr><th>{t.hazard}</th><th>{t.version}</th><th>{t.status}</th><th>{t.relevance}</th><th>{t.evidence}</th><th>{t.blockers}</th></tr></thead><tbody>
        {latest.map((rule) => <tr key={rule.id}><td lang="en">{rule.hazard_name}{rule.causal_agent ? <><br /><small>{rule.causal_agent}</small></> : null}</td><td>v{rule.version}</td><td>{label(rule.status)}</td><td>{label(rule.weather_relevance)}</td>
          <td>{rule.citations.length ? rule.citations.map((citation) => <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer">{citation.publisher}</a>) : t.noCitation(rule.citation_status)}</td>
          <td lang="en">{rule.approval_blockers.length ? rule.approval_blockers.join(" ") : t.none}</td></tr>)}
      </tbody></table></div></>}
  </section>;
}

export function SupplyPage() {
  const t = useCopy(COPY);
  const [district, setDistrict] = useState("Uttara Kannada");
  const weatherDistricts = useQuery({ queryKey: ["supply-weather", district], queryFn: () => api.supplyWeather({ district }) });
  return <div className="page-stack">
    <section className="page-heading"><div><h1>{t.title}</h1><p>{t.intro}</p></div></section>
    <ProductionSection />
    <ArrivalsSection />
    <WeatherSection district={district} districts={weatherDistricts.data?.districts ?? []} setDistrict={setDistrict} />
    <RiskSection district={district} />
  </div>;
}

import { MarketSearch } from "../components/MarketSearch";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api } from "../services/api";
import { downloadCsv } from "../services/csvDownload";
import { crossSectionSpread, DATE_PRESETS, describe, histogram, presetRange, rankSameDate, sortRows, type DatePreset, type SortDirection } from "../services/insights";
import { LazyBarChart, LazyRangeChart } from "../components/LazyCharts";
import { SourceLabel } from "../components/Scorecard";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import type { CooperativeCommodity, CooperativeData, CooperativeQuote, CooperativeSource } from "../services/cooperative";
import { calendarTodayIST } from "../../../shared/dates";
import { capabilityStatus, marketFeeds, type MarketFeed } from "../../../shared/commodities";
import { commodityName, useCommodity } from "../services/commodity";
import { IntelligenceScorecard } from "../components/Scorecard";
import { AboutData } from "../components/AboutData";
import { SourceControl, SourceSlot } from "../components/SourceSlot";
import { pageParam, readPage, readPreset, readSort, sortParams, withoutFilters, withParams } from "../services/priceFilters";
import { defineCopy, useCopy, useFormat, useLanguage } from "../services/language";
import { COMMON, fetchStatusText } from "../services/commonCopy";

const PriceChart = lazy(() => import("../components/PriceChart").then((module) => ({ default: module.PriceChart })));
/** Rows per page in the observation table. */
const PAGE_SIZE = 25;
const QUOTE_SORT_KEYS = ["branch", "reporting_date", "minimum_price", "average_price", "maximum_price"] as const;
const DEFAULT_QUOTE_SORT = { key: "reporting_date", direction: "desc" } as const;
const feedCapability = { mamcos: "cooperative_mamcos", tss: "cooperative_tss", tumcos: "cooperative_tumcos", official: "daily_prices" } as const;
type Mode = "/overview" | "/prices" | "/analytics" | "/compare";

const COPY = defineCopy({
  en: {
    modes: {
      "/overview": { title: (commodity: string) => `${commodity} market overview`, description: "Published cooperative branch quotations, with reporting dates and source evidence." },
      "/prices": { title: () => "Market prices", description: "Explore reviewed cooperative minimum, maximum and reported average prices." },
      "/analytics": { title: () => "Price analytics", description: "Source-specific daily medians of branch averages. Never mixed with official modal prices." },
      "/compare": { title: () => "Market comparison", description: "Compare cooperative branches for the same variety and date. Branches are not APMC market mappings." },
    } as Record<Mode, { title: (commodity: string) => string; description: string }>,
    marketFallback: "Market",
    feeds: { mamcos: "MAMCOS · Cooperative branch averages", tss: "TSS · Tender averages", tumcos: "TUMCOS · Channagiri averages", official: "AGMARKNET · Official modal prices" } as Record<MarketFeed, string>,
    sourceBar: "Market data source", selectSource: "Select a supported source", unpublished: "unpublished",
    unsupported: (name: string, options: string) => `Unsupported market-data source for ${name}. Select one of: ${options}.`,
    selectedCommodity: "the selected commodity",
    meta: (source: string, assumed: boolean) => `${source} branch averages · ₹/quintal${assumed ? " (unit assumed)" : ""} · not APMC modal prices`,
    exactReportedVariety: "Exact reported variety", noVarieties: "No published varieties",
    loadingQuotes: "Loading cooperative quotations", emptyTitle: "No reviewed cooperative quotations in this selection",
    awaiting: (count: number) => `${count} quotation${count === 1 ? " is" : "s are"} waiting for reviewer approval in Data quality.`,
    archivedDate: (date: string) => `Latest archived market reporting date: ${date}.`, noArchive: "No reporting dates archived yet.",
    fetchAndReview: (source: string) => `Fetch and review ${source} quotations in Data quality`,
    awaitingHere: (count: number) => `${count} quotations for this source and commodity await review.`, nothingSubstituted: "Nothing is substituted for missing prices.",
    snapshot: "Cooperative snapshot", latestReportedAverage: "LATEST REPORTED AVERAGE", benchmarkKicker: "BRANCH-AVERAGE BENCHMARK", perQuintal: "/ quintal",
    oneLocation: "one location", noBenchmarkDate: "No date has enough branches yet",
    newerReports: (date: string, branches: string, coverage: number) => `Newer reports on ${date} come from ${branches}, below the ${coverage}-branch rule.`,
    reportedAverages: "REPORTED AVERAGES", branchesReporting: "BRANCHES REPORTING",
    publishedSoFar: (variety: string) => `Published for ${variety} so far`, neededForBenchmark: (date: string, coverage: number) => `${date} · ${coverage} needed for a benchmark`,
    daysMinimum: "DAY'S MINIMUM", daysMaximum: "DAY'S MAXIMUM", highestAverage: "HIGHEST AVERAGE", lowestAverage: "LOWEST AVERAGE",
    pulse: "Market pulse", pulseHint: "Observed facts, not a forecast or causal explanation",
    pulseReported: (variety: string, branches: string, date: string) => `${variety}: ${branches} reported on ${date}.`,
    pulseSingle: (price: string) => `The reported average is ${price} per quintal.`,
    pulseMedian: (price: string) => `The median of their reported averages is ${price} per quintal.`,
    pulseBelowRule: (coverage: number, price: string, date: string) => `That is below the ${coverage}-branch rule, so the latest benchmark is ${price} from ${date}.`,
    pulseNoRule: (coverage: number) => `No date has reached the ${coverage}-branch rule yet.`,
    pulseChange: (amount: string, date: string) => `The comparable branch-set median changed by ${amount} from ${date}.`,
    pulseWithheld: "A like-for-like price-change claim is withheld: branch constituents differ between dates or comparable history is insufficient.",
    coverageTitle: "Branch coverage", theLatestDate: "the latest date",
    coverageHint: (reported: number, branches: string, variety: string, date: string) => `${reported} of ${branches} reported ${variety} on ${date} · latest report per branch`,
    coverageAria: (reported: number, total: number) => `${reported} of ${total} branches on the latest reporting date`,
    coverageCaption: (variety: string) => `Latest published report per branch for ${variety}`,
    latestReportingDate: "Latest reporting date", latestDate: "Latest date", daysEarlier: (n: number) => `${n} day${n === 1 ? "" : "s"} earlier`,
    missingBranches: (variety: string, names: string) => `No ${variety} report in the current window: ${names}.`,
    analyticsSummary: "Cooperative analytics summary", qualifying: "QUALIFYING DAILY OBSERVATIONS", qualifyingHint: (coverage: number) => `Dates meeting the ${coverage}-branch minimum`,
    periodAverage: "PERIOD AVERAGE", periodAverageHint: "Arithmetic mean of published daily medians", periodHighLow: "PERIOD HIGH / LOW", low: (value: string) => `Low: ${value}`,
    dispersion: "PRICE DISPERSION", dispersionHint: "Population standard deviation, not forecast uncertainty",
    historyTitle: (source: string, single: boolean) => `${source} ${single ? "reported-average history" : "branch-average benchmark"}`,
    historySingleHint: "One location and exact variety. Not a benchmark or forecast.",
    historyHint: (dates: number, coverage: number) => `${dates} qualifying reporting date${dates === 1 ? "" : "s"} · At least ${coverage} branches per date · Constituent coverage varies`,
    chartLocation: "Chart location", chartSingleLabel: (source: string, branch: string, variety: string) => `${source} · ${branch} · ${variety} · Reported average`,
    chartBenchmarkLabel: (source: string) => `${source} branch-average benchmark`, operatorAssumption: " — operator assumption",
    insufficientCoverage: "Insufficient same-date branch coverage", constituents: "Constituent branches by date",
    spreadTitle: "Cross-branch spread", spreadHint: "Highest minus lowest reported average among branches on the same date · dates with ≥2 branches",
    noSpread: "No date has two or more reporting branches", spreadName: "Branch spread", spreadDescription: (source: string) => `${source} cross-branch average spread by reporting date`,
    reportedAveragesLabel: "reported averages", assumedUnitLabel: " · INR/quintal by operator assumption",
    distributionTitle: "Price distribution", distributionHint: (count: number) => `${count} published branch averages in the current window · not a forecast range`,
    noAverages: "No published averages", observationsName: "Observations", distributionDescription: (source: string) => `${source} distribution of branch averages`,
    iqr: "Interquartile range", cv: "Coefficient of variation", currentWindow: "current window",
    seasonalNote: "Seasonal and year-on-year analysis needs multi-year history: see", historyLink: "Historical analytics", seasonalBasis: "(AGMARKNET monthly series, a different price basis).",
    searchBranch: "Search branch or variety", searchExample: "e.g. Sagara",
    sameDate: "Same reporting date", rankedNote: (compared: number, total: number) => `Ranked by average, highest first. Other reporting dates are excluded. ${compared} of ${total} branches reported on this date.`,
    rankedTitle: "Ranked branch range", rankedHint: (date: string, variety: string, assumed: boolean) => `${date} · ${variety} · Bar shows minimum–maximum, marker shows the reported average${assumed ? " · INR/quintal by operator assumption" : ""}`,
    noRanked: "No branch averages on this date", rankedDescription: (source: string, variety: string, date: string) => `${source} branch ranges for ${variety} on ${date}`,
    cooperativeAverages: "cooperative reported averages",
    comparisonTitle: "Same-date branch comparison", observationsTitle: "Published branch observations",
    matching: (count: number) => `${count} matching observation${count === 1 ? "" : "s"}`, notModal: "Reported averages, not modal prices",
    window: (from: string, to: string) => `Reporting window ${from} – ${to}`, truncated: (limit: string) => ` (latest ${limit} rows only; narrow the date range to see the rest)`,
    noMatches: "No quotations match these filters",
    quotations: "Cooperative quotations", tableCaption: (source: string, unit: string, assumed: boolean) => `${source} published quotations · ${unit}${assumed ? " — operator assumption" : ""} · Average is not modal price`,
    normalRate: "Normal rate", sourceFetched: "Source / fetched at", platformFetched: (time: string) => `Platform fetched: ${time}`,
    rangeIncomplete: "Range incomplete", rangeOk: "Min ≤ avg ≤ max", rangeInconsistent: "Range inconsistent", unitConfirmed: "Unit confirmed", unitAssumed: "Unit assumed",
    methodology: (source: CooperativeSource, coverage: number) => source === "tumcos"
      ? "TUMCOS (Channagiri) publishes low, average and high values per date without a variety. Its page labels values \"kg\"; they are treated as INR/quintal by operator decision because their size is only plausible per quintal. Source records are kept unchanged. They are not APMC modal prices and are not merged with MAMCOS, TSS or AGMARKNET."
      : source === "tss"
      ? `TSS reported averages (avgrate), with normal rates (norrate) kept separately. TSS publishes no unit; INR/quintal is an operator assumption. The benchmark is the median across locations for one exact variety and date, with at least ${coverage} locations. Only the arecanut grades on the TSS list are included, each under its exact TSS label.`
      : `Median of published cooperative branch averages for one exact variety and reporting date, with at least ${coverage} branches. Not the official APMC modal-price index. Branch constituents can differ between dates; changes do not imply a like-for-like market movement.`,
    conflicts: (list: string) => `Left out of the benchmark because verified prices disagree: ${list}.`, conflictOn: (branch: string, date: string, prices: string) => `${branch} on ${date} (${prices})`,
    priceType: "Price type", priceTypeValue: "Cooperative reported average (not APMC modal)",
    unitValue: (assumed: boolean) => assumed ? "INR/quintal (operator assumption)" : "INR/quintal (source-confirmed)",
    coverageRule: "Coverage rule", coverageRuleValue: (coverage: number) => `At least ${coverage} branches on the same reporting date`,
    latestConstituents: "Latest constituents", noQualifying: "No qualifying date", marketReportingDate: "Market reporting date",
    publicationTime: "Source publication time", notSupplied: "Not supplied by this source", lastFetch: "Last platform fetch",
    reportingDates: "Reporting dates", keptPerBranch: "Kept per branch", varietyNames: "Variety names", asPublished: (source: string) => `As published by ${source}; no aliases merged`,
    permission: "Source permission",
    permissionLabel: (status: string, redistribution: boolean) => status === "granted" && redistribution ? "Permission recorded for collection and redistribution"
      : status === "granted" ? "Collection permission recorded; redistribution not confirmed" : status === "denied" ? "Permission denied"
      : status === "requested" ? "Permission requested; not confirmed" : "Permission not confirmed",
    notRecorded: "Not recorded",
    statusLine: (retrieval: string, awaiting: number) => `Source supported · ${retrieval} · ${awaiting} awaiting review across this source and commodity.`,
    lastRetrieval: (status: string, time: string) => `Last retrieval: ${status} (${time})`, noRetrieval: "No retrieval recorded",
    published: "Published observations are available for this selection.", notPublished: "No published observations in this selection and reporting window.",
    latestArchived: (date: string) => ` Latest archived reporting date: ${date}.`, lastError: (message: string) => `Last fetch error: ${message}`,
    recentFetches: "Recent location fetches", rowsExcluded: (rows: string, excluded: number) => `${rows} rows · ${excluded} excluded`,
    snapshotsNote: "These are the observations available in captured source snapshots, not a complete historical archive. A new fetch does not make an older quotation current.",
    inspect: "Inspect validation, source evidence and refresh controls",
  },
  kn: {
    modes: {
      "/overview": { title: (commodity: string) => `${commodity} ಮಾರುಕಟ್ಟೆ ಸಮಗ್ರ ನೋಟ`, description: "ಸಹಕಾರಿ ಶಾಖೆಗಳ ಪ್ರಕಟಿತ ದರಗಳು, ವರದಿ ದಿನಾಂಕ ಮತ್ತು ಮೂಲದ ಆಧಾರದೊಂದಿಗೆ." },
      "/prices": { title: () => "ಮಾರುಕಟ್ಟೆ ದರಗಳು", description: "ಪರಿಶೀಲಿಸಿದ ಸಹಕಾರಿ ಸಂಘಗಳ ಕನಿಷ್ಠ, ಗರಿಷ್ಠ ಮತ್ತು ವರದಿಯಾದ ಸರಾಸರಿ ದರಗಳು." },
      "/analytics": { title: () => "ದರ ವಿಶ್ಲೇಷಣೆ", description: "ಪ್ರತಿ ಮೂಲದ ಶಾಖೆ ಸರಾಸರಿಗಳ ದೈನಂದಿನ ಮಧ್ಯಮ. ಅಧಿಕೃತ ಮಾದರಿ ದರಗಳೊಂದಿಗೆ ಎಂದೂ ಬೆರೆಸುವುದಿಲ್ಲ." },
      "/compare": { title: () => "ಮಾರುಕಟ್ಟೆ ಹೋಲಿಕೆ", description: "ಒಂದೇ ತಳಿ ಮತ್ತು ದಿನಾಂಕಕ್ಕೆ ಸಹಕಾರಿ ಶಾಖೆಗಳನ್ನು ಹೋಲಿಸಿ. ಶಾಖೆಗಳು ಎಪಿಎಂಸಿ ಮಾರುಕಟ್ಟೆಗಳಲ್ಲ." },
    },
    marketFallback: "ಮಾರುಕಟ್ಟೆ",
    feeds: { mamcos: "MAMCOS · ಸಹಕಾರಿ ಶಾಖೆ ಸರಾಸರಿಗಳು", tss: "TSS · ಟೆಂಡರ್ ಸರಾಸರಿಗಳು", tumcos: "TUMCOS · ಚನ್ನಗಿರಿ ಸರಾಸರಿಗಳು", official: "AGMARKNET · ಅಧಿಕೃತ ಮಾದರಿ ದರಗಳು" },
    sourceBar: "ಮಾರುಕಟ್ಟೆ ದತ್ತಾಂಶದ ಮೂಲ", selectSource: "ಬೆಂಬಲಿತ ಮೂಲವನ್ನು ಆಯ್ಕೆಮಾಡಿ", unpublished: "ಪ್ರಕಟವಾಗಿಲ್ಲ",
    unsupported: (name: string, options: string) => `${name} ಗೆ ಈ ಮಾರುಕಟ್ಟೆ ದತ್ತಾಂಶ ಮೂಲ ಬೆಂಬಲಿತವಲ್ಲ. ಇವುಗಳಲ್ಲಿ ಒಂದನ್ನು ಆಯ್ಕೆಮಾಡಿ: ${options}.`,
    selectedCommodity: "ಆಯ್ದ ಬೆಳೆ",
    meta: (source: string, assumed: boolean) => `${source} ಶಾಖೆ ಸರಾಸರಿಗಳು · ₹/ಕ್ವಿಂಟಾಲ್${assumed ? " (ಘಟಕ ಊಹಿಸಲಾಗಿದೆ)" : ""} · ಎಪಿಎಂಸಿ ಮಾದರಿ ದರಗಳಲ್ಲ`,
    exactReportedVariety: "ವರದಿಯಾದ ನಿಖರ ತಳಿ", noVarieties: "ಪ್ರಕಟಿತ ತಳಿಗಳಿಲ್ಲ",
    loadingQuotes: "ಸಹಕಾರಿ ದರಗಳನ್ನು ತರಲಾಗುತ್ತಿದೆ", emptyTitle: "ಈ ಆಯ್ಕೆಯಲ್ಲಿ ಪರಿಶೀಲಿಸಿದ ಸಹಕಾರಿ ದರಗಳಿಲ್ಲ",
    awaiting: (count: number) => `${count} ದರ ವರದಿಗಳು ದತ್ತಾಂಶ ಗುಣಮಟ್ಟ ಪುಟದಲ್ಲಿ ಪರಿಶೀಲಕರ ಅನುಮೋದನೆಗೆ ಕಾಯುತ್ತಿವೆ.`,
    archivedDate: (date: string) => `ಸಂಗ್ರಹದಲ್ಲಿರುವ ಇತ್ತೀಚಿನ ಮಾರುಕಟ್ಟೆ ವರದಿ ದಿನಾಂಕ: ${date}.`, noArchive: "ಇನ್ನೂ ಯಾವುದೇ ವರದಿ ದಿನಾಂಕ ಸಂಗ್ರಹವಾಗಿಲ್ಲ.",
    fetchAndReview: (source: string) => `ದತ್ತಾಂಶ ಗುಣಮಟ್ಟ ಪುಟದಲ್ಲಿ ${source} ದರಗಳನ್ನು ತಂದು ಪರಿಶೀಲಿಸಿ`,
    awaitingHere: (count: number) => `ಈ ಮೂಲ ಮತ್ತು ಬೆಳೆಯ ${count} ದರ ವರದಿಗಳು ಪರಿಶೀಲನೆಗೆ ಕಾಯುತ್ತಿವೆ.`, nothingSubstituted: "ಇಲ್ಲದ ದರಗಳ ಬದಲಿಗೆ ಏನನ್ನೂ ತುಂಬುವುದಿಲ್ಲ.",
    snapshot: "ಸಹಕಾರಿ ದರಗಳ ಸಾರಾಂಶ", latestReportedAverage: "ಇತ್ತೀಚಿನ ವರದಿಯಾದ ಸರಾಸರಿ", benchmarkKicker: "ಶಾಖೆ-ಸರಾಸರಿ ಮಾನದಂಡ ದರ", perQuintal: "/ ಕ್ವಿಂಟಾಲ್",
    oneLocation: "ಒಂದು ಸ್ಥಳ", noBenchmarkDate: "ಇನ್ನೂ ಯಾವ ದಿನಾಂಕಕ್ಕೂ ಸಾಕಷ್ಟು ಶಾಖೆಗಳಿಲ್ಲ",
    newerReports: (date: string, branches: string, coverage: number) => `${date} ರ ಹೊಸ ವರದಿಗಳು ${branches} ಇಂದ ಮಾತ್ರ ಬಂದಿವೆ, ${coverage}-ಶಾಖೆ ನಿಯಮಕ್ಕಿಂತ ಕಡಿಮೆ.`,
    reportedAverages: "ವರದಿಯಾದ ಸರಾಸರಿಗಳು", branchesReporting: "ವರದಿ ಮಾಡಿದ ಶಾಖೆಗಳು",
    publishedSoFar: (variety: string) => `${variety} ಗೆ ಇಲ್ಲಿಯವರೆಗೆ ಪ್ರಕಟವಾದವು`, neededForBenchmark: (date: string, coverage: number) => `${date} · ಮಾನದಂಡ ದರಕ್ಕೆ ${coverage} ಬೇಕು`,
    daysMinimum: "ದಿನದ ಕನಿಷ್ಠ", daysMaximum: "ದಿನದ ಗರಿಷ್ಠ", highestAverage: "ಅತಿ ಹೆಚ್ಚಿನ ಸರಾಸರಿ", lowestAverage: "ಅತಿ ಕಡಿಮೆ ಸರಾಸರಿ",
    pulse: "ಮಾರುಕಟ್ಟೆ ಸ್ಥಿತಿ", pulseHint: "ಕಂಡುಬಂದ ಸಂಗತಿಗಳು ಮಾತ್ರ, ಮುನ್ಸೂಚನೆ ಅಥವಾ ಕಾರಣ ವಿವರಣೆ ಅಲ್ಲ",
    pulseReported: (variety: string, branches: string, date: string) => `${variety}: ${date} ರಂದು ${branches} ವರದಿ ಮಾಡಿವೆ.`,
    pulseSingle: (price: string) => `ವರದಿಯಾದ ಸರಾಸರಿ ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ ${price}.`,
    pulseMedian: (price: string) => `ಅವುಗಳ ವರದಿಯಾದ ಸರಾಸರಿಗಳ ಮಧ್ಯಮ ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ ${price}.`,
    pulseBelowRule: (coverage: number, price: string, date: string) => `ಇದು ${coverage}-ಶಾಖೆ ನಿಯಮಕ್ಕಿಂತ ಕಡಿಮೆ, ಆದ್ದರಿಂದ ಇತ್ತೀಚಿನ ಮಾನದಂಡ ದರ ${date} ರ ${price}.`,
    pulseNoRule: (coverage: number) => `ಇನ್ನೂ ಯಾವ ದಿನಾಂಕವೂ ${coverage}-ಶಾಖೆ ನಿಯಮವನ್ನು ತಲುಪಿಲ್ಲ.`,
    pulseChange: (amount: string, date: string) => `ಹೋಲಿಸಬಹುದಾದ ಶಾಖೆಗಳ ಮಧ್ಯಮ ದರ ${date} ರಿಂದ ${amount} ಬದಲಾಗಿದೆ.`,
    pulseWithheld: "ಸಮಾನ ಹೋಲಿಕೆಯ ದರ ಬದಲಾವಣೆಯನ್ನು ತೋರಿಸಿಲ್ಲ: ದಿನಾಂಕಗಳ ನಡುವೆ ಶಾಖೆಗಳು ಬದಲಾಗಿವೆ ಅಥವಾ ಹೋಲಿಸಲು ಸಾಕಷ್ಟು ಹಿಂದಿನ ದತ್ತಾಂಶವಿಲ್ಲ.",
    coverageTitle: "ಶಾಖೆಗಳ ವ್ಯಾಪ್ತಿ", theLatestDate: "ಇತ್ತೀಚಿನ ದಿನಾಂಕ",
    coverageHint: (reported: number, branches: string, variety: string, date: string) => `${branches} ಪೈಕಿ ${reported} ಶಾಖೆಗಳು ${date} ರಂದು ${variety} ವರದಿ ಮಾಡಿವೆ · ಪ್ರತಿ ಶಾಖೆಯ ಇತ್ತೀಚಿನ ವರದಿ`,
    coverageAria: (reported: number, total: number) => `ಇತ್ತೀಚಿನ ವರದಿ ದಿನಾಂಕದಂದು ${total} ರಲ್ಲಿ ${reported} ಶಾಖೆಗಳು`,
    coverageCaption: (variety: string) => `${variety} ಗೆ ಪ್ರತಿ ಶಾಖೆಯ ಇತ್ತೀಚಿನ ಪ್ರಕಟಿತ ವರದಿ`,
    latestReportingDate: "ಇತ್ತೀಚಿನ ವರದಿ ದಿನಾಂಕ", latestDate: "ಇತ್ತೀಚಿನ ದಿನಾಂಕ", daysEarlier: (n: number) => `${n} ದಿನ ಹಿಂದೆ`,
    missingBranches: (variety: string, names: string) => `ಈ ಅವಧಿಯಲ್ಲಿ ${variety} ವರದಿ ಇಲ್ಲದ ಶಾಖೆಗಳು: ${names}.`,
    analyticsSummary: "ಸಹಕಾರಿ ವಿಶ್ಲೇಷಣೆಯ ಸಾರಾಂಶ", qualifying: "ಅರ್ಹ ದೈನಂದಿನ ದಾಖಲೆಗಳು", qualifyingHint: (coverage: number) => `ಕನಿಷ್ಠ ${coverage} ಶಾಖೆಗಳಿರುವ ದಿನಾಂಕಗಳು`,
    periodAverage: "ಅವಧಿಯ ಸರಾಸರಿ", periodAverageHint: "ಪ್ರಕಟಿತ ದೈನಂದಿನ ಮಧ್ಯಮಗಳ ಸರಾಸರಿ", periodHighLow: "ಅವಧಿಯ ಗರಿಷ್ಠ / ಕನಿಷ್ಠ", low: (value: string) => `ಕನಿಷ್ಠ: ${value}`,
    dispersion: "ದರದ ಏರಿಳಿತ", dispersionHint: "ಪ್ರಮಾಣಿತ ವಿಚಲನ; ಮುನ್ಸೂಚನೆಯ ಅನಿಶ್ಚಿತತೆ ಅಲ್ಲ",
    historyTitle: (source: string, single: boolean) => `${source} ${single ? "ವರದಿಯಾದ ಸರಾಸರಿಯ ಇತಿಹಾಸ" : "ಶಾಖೆ-ಸರಾಸರಿ ಮಾನದಂಡ ದರ"}`,
    historySingleHint: "ಒಂದು ಸ್ಥಳ ಮತ್ತು ನಿಖರ ತಳಿ. ಮಾನದಂಡ ಅಥವಾ ಮುನ್ಸೂಚನೆ ಅಲ್ಲ.",
    historyHint: (dates: number, coverage: number) => `${dates} ಅರ್ಹ ವರದಿ ದಿನಾಂಕಗಳು · ಪ್ರತಿ ದಿನಾಂಕಕ್ಕೆ ಕನಿಷ್ಠ ${coverage} ಶಾಖೆಗಳು · ಒಳಗೊಂಡ ಶಾಖೆಗಳು ಬದಲಾಗಬಹುದು`,
    chartLocation: "ಚಾರ್ಟ್ ಸ್ಥಳ", chartSingleLabel: (source: string, branch: string, variety: string) => `${source} · ${branch} · ${variety} · ವರದಿಯಾದ ಸರಾಸರಿ`,
    chartBenchmarkLabel: (source: string) => `${source} ಶಾಖೆ-ಸರಾಸರಿ ಮಾನದಂಡ ದರ`, operatorAssumption: " — ಘಟಕ ಊಹಿಸಲಾಗಿದೆ",
    insufficientCoverage: "ಒಂದೇ ದಿನಾಂಕದಲ್ಲಿ ಸಾಕಷ್ಟು ಶಾಖೆಗಳಿಲ್ಲ", constituents: "ದಿನಾಂಕವಾರು ಒಳಗೊಂಡ ಶಾಖೆಗಳು",
    spreadTitle: "ಶಾಖೆಗಳ ನಡುವಿನ ಅಂತರ", spreadHint: "ಒಂದೇ ದಿನಾಂಕದಲ್ಲಿ ಶಾಖೆಗಳ ಅತಿ ಹೆಚ್ಚು ಮತ್ತು ಅತಿ ಕಡಿಮೆ ಸರಾಸರಿಯ ವ್ಯತ್ಯಾಸ · ಕನಿಷ್ಠ 2 ಶಾಖೆಗಳಿರುವ ದಿನಾಂಕಗಳು",
    noSpread: "ಯಾವ ದಿನಾಂಕದಲ್ಲೂ ಎರಡು ಅಥವಾ ಹೆಚ್ಚು ಶಾಖೆಗಳು ವರದಿ ಮಾಡಿಲ್ಲ", spreadName: "ಶಾಖೆ ಅಂತರ", spreadDescription: (source: string) => `ವರದಿ ದಿನಾಂಕವಾರು ${source} ಶಾಖೆಗಳ ಸರಾಸರಿ ಅಂತರ`,
    reportedAveragesLabel: "ವರದಿಯಾದ ಸರಾಸರಿಗಳು", assumedUnitLabel: " · ₹/ಕ್ವಿಂಟಾಲ್ ಘಟಕ ಊಹಿಸಲಾಗಿದೆ",
    distributionTitle: "ದರಗಳ ಹಂಚಿಕೆ", distributionHint: (count: number) => `ಈ ಅವಧಿಯಲ್ಲಿ ${count} ಪ್ರಕಟಿತ ಶಾಖೆ ಸರಾಸರಿಗಳು · ಮುನ್ಸೂಚನೆ ಶ್ರೇಣಿ ಅಲ್ಲ`,
    noAverages: "ಪ್ರಕಟಿತ ಸರಾಸರಿಗಳಿಲ್ಲ", observationsName: "ದಾಖಲೆಗಳು", distributionDescription: (source: string) => `${source} ಶಾಖೆ ಸರಾಸರಿಗಳ ಹಂಚಿಕೆ`,
    iqr: "ಮಧ್ಯದ ಅರ್ಧ ಶ್ರೇಣಿ", cv: "ಏರಿಳಿತದ ಗುಣಾಂಕ", currentWindow: "ಈಗಿನ ಅವಧಿ",
    seasonalNote: "ಋತುಮಾನ ಮತ್ತು ವರ್ಷದಿಂದ ವರ್ಷದ ವಿಶ್ಲೇಷಣೆಗೆ ಹಲವು ವರ್ಷಗಳ ದತ್ತಾಂಶ ಬೇಕು: ನೋಡಿ", historyLink: "ಐತಿಹಾಸಿಕ ವಿಶ್ಲೇಷಣೆ", seasonalBasis: "(AGMARKNET ತಿಂಗಳ ಸರಣಿ, ಬೇರೆ ದರದ ಆಧಾರ).",
    searchBranch: "ಶಾಖೆ ಅಥವಾ ತಳಿ ಹುಡುಕಿ", searchExample: "ಉದಾ. Sagara",
    sameDate: "ಅದೇ ವರದಿ ದಿನಾಂಕ", rankedNote: (compared: number, total: number) => `ಸರಾಸರಿ ದರದ ಪ್ರಕಾರ, ಹೆಚ್ಚಿನದು ಮೊದಲು. ಬೇರೆ ವರದಿ ದಿನಾಂಕಗಳನ್ನು ಬಿಡಲಾಗಿದೆ. ಈ ದಿನಾಂಕದಂದು ${total} ರಲ್ಲಿ ${compared} ಶಾಖೆಗಳು ವರದಿ ಮಾಡಿವೆ.`,
    rankedTitle: "ಶಾಖೆಗಳ ದರ ಶ್ರೇಣಿ", rankedHint: (date: string, variety: string, assumed: boolean) => `${date} · ${variety} · ಪಟ್ಟಿ ಕನಿಷ್ಠ–ಗರಿಷ್ಠ, ಚುಕ್ಕೆ ವರದಿಯಾದ ಸರಾಸರಿ${assumed ? " · ₹/ಕ್ವಿಂಟಾಲ್ ಘಟಕ ಊಹಿಸಲಾಗಿದೆ" : ""}`,
    noRanked: "ಈ ದಿನಾಂಕದಂದು ಶಾಖೆ ಸರಾಸರಿಗಳಿಲ್ಲ", rankedDescription: (source: string, variety: string, date: string) => `${date} ರಂದು ${variety} ಗೆ ${source} ಶಾಖೆಗಳ ದರ ಶ್ರೇಣಿ`,
    cooperativeAverages: "ಸಹಕಾರಿ ವರದಿಯಾದ ಸರಾಸರಿಗಳು",
    comparisonTitle: "ಅದೇ ದಿನಾಂಕದ ಶಾಖೆ ಹೋಲಿಕೆ", observationsTitle: "ಪ್ರಕಟಿತ ಶಾಖೆ ದಾಖಲೆಗಳು",
    matching: (count: number) => `ಹೊಂದುವ ${count} ದಾಖಲೆಗಳು`, notModal: "ವರದಿಯಾದ ಸರಾಸರಿಗಳು, ಮಾದರಿ ದರಗಳಲ್ಲ",
    window: (from: string, to: string) => `ವರದಿ ಅವಧಿ ${from} – ${to}`, truncated: (limit: string) => ` (ಇತ್ತೀಚಿನ ${limit} ಸಾಲುಗಳು ಮಾತ್ರ; ಉಳಿದವನ್ನು ನೋಡಲು ದಿನಾಂಕ ಅವಧಿಯನ್ನು ಕಡಿಮೆ ಮಾಡಿ)`,
    noMatches: "ಈ ಫಿಲ್ಟರ್‌ಗಳಿಗೆ ಹೊಂದುವ ದರಗಳಿಲ್ಲ",
    quotations: "ಸಹಕಾರಿ ದರ ವರದಿಗಳು", tableCaption: (source: string, unit: string, assumed: boolean) => `${source} ಪ್ರಕಟಿತ ದರಗಳು · ${unit}${assumed ? " — ಘಟಕ ಊಹಿಸಲಾಗಿದೆ" : ""} · ಸರಾಸರಿ ದರ ಮಾದರಿ ದರವಲ್ಲ`,
    normalRate: "ಸಾಮಾನ್ಯ ದರ", sourceFetched: "ಮೂಲ / ತಂದ ಸಮಯ", platformFetched: (time: string) => `ತಂದ ಸಮಯ: ${time}`,
    rangeIncomplete: "ಶ್ರೇಣಿ ಅಪೂರ್ಣ", rangeOk: "ಕನಿಷ್ಠ ≤ ಸರಾಸರಿ ≤ ಗರಿಷ್ಠ", rangeInconsistent: "ಶ್ರೇಣಿ ಹೊಂದುತ್ತಿಲ್ಲ", unitConfirmed: "ಘಟಕ ದೃಢಪಟ್ಟಿದೆ", unitAssumed: "ಘಟಕ ಊಹಿಸಲಾಗಿದೆ",
    methodology: (source: CooperativeSource, coverage: number) => source === "tumcos"
      ? "TUMCOS (ಚನ್ನಗಿರಿ) ಪ್ರತಿ ದಿನಾಂಕಕ್ಕೆ ತಳಿ ತಿಳಿಸದೆ ಕನಿಷ್ಠ, ಸರಾಸರಿ ಮತ್ತು ಗರಿಷ್ಠ ದರ ಪ್ರಕಟಿಸುತ್ತದೆ. ಅದರ ಪುಟದಲ್ಲಿ \"kg\" ಎಂದಿದೆ; ದರಗಳ ಗಾತ್ರ ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ ಮಾತ್ರ ಹೊಂದುವುದರಿಂದ ನಿರ್ವಾಹಕರ ನಿರ್ಧಾರದಂತೆ ₹/ಕ್ವಿಂಟಾಲ್ ಎಂದು ಪರಿಗಣಿಸಲಾಗಿದೆ. ಮೂಲ ದಾಖಲೆಗಳನ್ನು ಬದಲಿಸುವುದಿಲ್ಲ. ಇವು ಎಪಿಎಂಸಿ ಮಾದರಿ ದರಗಳಲ್ಲ ಮತ್ತು MAMCOS, TSS ಅಥವಾ AGMARKNET ಜೊತೆ ಬೆರೆಸುವುದಿಲ್ಲ."
      : source === "tss"
      ? `TSS ವರದಿಯಾದ ಸರಾಸರಿ ದರಗಳು (avgrate); ಸಾಮಾನ್ಯ ದರಗಳನ್ನು (norrate) ಪ್ರತ್ಯೇಕವಾಗಿ ಇಡಲಾಗಿದೆ. TSS ಘಟಕವನ್ನು ತಿಳಿಸುವುದಿಲ್ಲ; ₹/ಕ್ವಿಂಟಾಲ್ ನಿರ್ವಾಹಕರ ಊಹೆ. ಮಾನದಂಡ ದರವು ಒಂದು ನಿಖರ ತಳಿ ಮತ್ತು ದಿನಾಂಕಕ್ಕೆ ಕನಿಷ್ಠ ${coverage} ಸ್ಥಳಗಳ ಮಧ್ಯಮ. TSS ಪಟ್ಟಿಯಲ್ಲಿರುವ ಅಡಿಕೆ ದರ್ಜೆಗಳನ್ನು ಮಾತ್ರ, ಅವುಗಳ ನಿಖರ TSS ಹೆಸರಿನಲ್ಲಿ ಸೇರಿಸಲಾಗಿದೆ.`
      : `ಒಂದು ನಿಖರ ತಳಿ ಮತ್ತು ವರದಿ ದಿನಾಂಕಕ್ಕೆ, ಕನಿಷ್ಠ ${coverage} ಶಾಖೆಗಳ ಪ್ರಕಟಿತ ಸರಾಸರಿಗಳ ಮಧ್ಯಮ. ಇದು ಅಧಿಕೃತ ಎಪಿಎಂಸಿ ಮಾದರಿ ದರದ ಸೂಚ್ಯಂಕವಲ್ಲ. ದಿನಾಂಕಗಳ ನಡುವೆ ಒಳಗೊಂಡ ಶಾಖೆಗಳು ಬದಲಾಗಬಹುದು; ಬದಲಾವಣೆಯು ಸಮಾನ ಹೋಲಿಕೆಯ ಮಾರುಕಟ್ಟೆ ಚಲನೆ ಎಂದರ್ಥವಲ್ಲ.`,
    conflicts: (list: string) => `ಪರಿಶೀಲಿಸಿದ ದರಗಳು ಹೊಂದದ ಕಾರಣ ಮಾನದಂಡದಿಂದ ಬಿಡಲಾಗಿದೆ: ${list}.`, conflictOn: (branch: string, date: string, prices: string) => `${branch}, ${date} (${prices})`,
    priceType: "ದರದ ವಿಧ", priceTypeValue: "ಸಹಕಾರಿ ವರದಿಯಾದ ಸರಾಸರಿ (ಎಪಿಎಂಸಿ ಮಾದರಿ ದರವಲ್ಲ)",
    unitValue: (assumed: boolean) => assumed ? "₹/ಕ್ವಿಂಟಾಲ್ (ನಿರ್ವಾಹಕರ ಊಹೆ)" : "₹/ಕ್ವಿಂಟಾಲ್ (ಮೂಲದಿಂದ ದೃಢಪಟ್ಟಿದೆ)",
    coverageRule: "ವ್ಯಾಪ್ತಿ ನಿಯಮ", coverageRuleValue: (coverage: number) => `ಅದೇ ವರದಿ ದಿನಾಂಕದಲ್ಲಿ ಕನಿಷ್ಠ ${coverage} ಶಾಖೆಗಳು`,
    latestConstituents: "ಇತ್ತೀಚಿನ ಒಳಗೊಂಡ ಶಾಖೆಗಳು", noQualifying: "ಅರ್ಹ ದಿನಾಂಕವಿಲ್ಲ", marketReportingDate: "ಮಾರುಕಟ್ಟೆ ವರದಿ ದಿನಾಂಕ",
    publicationTime: "ಮೂಲದ ಪ್ರಕಟಣೆ ಸಮಯ", notSupplied: "ಈ ಮೂಲ ನೀಡುವುದಿಲ್ಲ", lastFetch: "ಕೊನೆಯ ಬಾರಿ ತಂದದ್ದು",
    reportingDates: "ವರದಿ ದಿನಾಂಕಗಳು", keptPerBranch: "ಪ್ರತಿ ಶಾಖೆಗೆ ಪ್ರತ್ಯೇಕವಾಗಿ", varietyNames: "ತಳಿಯ ಹೆಸರುಗಳು", asPublished: (source: string) => `${source} ಪ್ರಕಟಿಸಿದಂತೆಯೇ; ಹೆಸರುಗಳನ್ನು ವಿಲೀನಗೊಳಿಸಿಲ್ಲ`,
    permission: "ಮೂಲದ ಅನುಮತಿ",
    permissionLabel: (status: string, redistribution: boolean) => status === "granted" && redistribution ? "ಸಂಗ್ರಹ ಮತ್ತು ಮರುಪ್ರಕಟಣೆಗೆ ಅನುಮತಿ ದಾಖಲಾಗಿದೆ"
      : status === "granted" ? "ಸಂಗ್ರಹಕ್ಕೆ ಅನುಮತಿ ದಾಖಲಾಗಿದೆ; ಮರುಪ್ರಕಟಣೆ ದೃಢಪಟ್ಟಿಲ್ಲ" : status === "denied" ? "ಅನುಮತಿ ನಿರಾಕರಿಸಲಾಗಿದೆ"
      : status === "requested" ? "ಅನುಮತಿ ಕೋರಲಾಗಿದೆ; ದೃಢಪಟ್ಟಿಲ್ಲ" : "ಅನುಮತಿ ದೃಢಪಟ್ಟಿಲ್ಲ",
    notRecorded: "ದಾಖಲಾಗಿಲ್ಲ",
    statusLine: (retrieval: string, awaiting: number) => `ಮೂಲ ಬೆಂಬಲಿತ · ${retrieval} · ಈ ಮೂಲ ಮತ್ತು ಬೆಳೆಯ ${awaiting} ದರಗಳು ಪರಿಶೀಲನೆಗೆ ಕಾಯುತ್ತಿವೆ.`,
    lastRetrieval: (status: string, time: string) => `ಕೊನೆಯ ಸಂಗ್ರಹ: ${status} (${time})`, noRetrieval: "ಯಾವುದೇ ಸಂಗ್ರಹ ದಾಖಲಾಗಿಲ್ಲ",
    published: "ಈ ಆಯ್ಕೆಗೆ ಪ್ರಕಟಿತ ದಾಖಲೆಗಳು ಲಭ್ಯವಿವೆ.", notPublished: "ಈ ಆಯ್ಕೆ ಮತ್ತು ವರದಿ ಅವಧಿಯಲ್ಲಿ ಪ್ರಕಟಿತ ದಾಖಲೆಗಳಿಲ್ಲ.",
    latestArchived: (date: string) => ` ಸಂಗ್ರಹದಲ್ಲಿರುವ ಇತ್ತೀಚಿನ ವರದಿ ದಿನಾಂಕ: ${date}.`, lastError: (message: string) => `ಕೊನೆಯ ಸಂಗ್ರಹದ ದೋಷ: ${message}`,
    recentFetches: "ಇತ್ತೀಚಿನ ಸ್ಥಳವಾರು ಸಂಗ್ರಹಗಳು", rowsExcluded: (rows: string, excluded: number) => `${rows} ಸಾಲುಗಳು · ${excluded} ಬಿಡಲಾಗಿದೆ`,
    snapshotsNote: "ಇವು ಸಂಗ್ರಹಿಸಿದ ಮೂಲ ದಾಖಲೆಗಳಲ್ಲಿ ಲಭ್ಯವಿರುವ ದರಗಳು ಮಾತ್ರ, ಸಂಪೂರ್ಣ ಐತಿಹಾಸಿಕ ಸಂಗ್ರಹವಲ್ಲ. ಹೊಸ ಸಂಗ್ರಹವು ಹಳೆಯ ದರವನ್ನು ಇಂದಿನದನ್ನಾಗಿ ಮಾಡುವುದಿಲ್ಲ.",
    inspect: "ಪರಿಶೀಲನೆ, ಮೂಲದ ಆಧಾರ ಮತ್ತು ನವೀಕರಣ ನಿಯಂತ್ರಣಗಳನ್ನು ನೋಡಿ",
  },
});

const money = (value: number | null | undefined, missing: string) => value == null ? missing : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
// Calculated statistics are shown to the rupee; source prices above keep what was published.
const rupees = (value: number | null | undefined) => value == null ? "—" : `₹${Math.round(value).toLocaleString("en-IN")}`;

export function MarketDataPage({ official }: { official: ReactNode }) {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const { code, commodity } = useCommodity();
  const { language } = useLanguage();
  const feeds = marketFeeds(commodity);
  const requestedFeed = params.get("feed");
  const feed = requestedFeed || feeds[0] || "";
  const supported = (feeds as string[]).includes(feed);
  const name = commodity ? commodityName(code, commodity, language) : t.selectedCommodity;
  const sourceSelect = <label className="filter-control source-control" aria-label={t.sourceBar}><span>{c.source}</span>
    <select value={supported ? feed : ""} onChange={(event) => {
      setParams(withParams(withoutFilters(params, ["variety"]), { feed: event.target.value }));
    }}><option value="" disabled>{t.selectSource}</option>{feeds.map((value) => <option key={value} value={value}>{t.feeds[value]}{capabilityStatus(commodity, feedCapability[value]) === "unpublished" ? ` · ${t.unpublished}` : ""}</option>)}</select>
  </label>;
  return <SourceControl.Provider value={sourceSelect}>
    {!supported ? <div className="page-stack"><div className="heading-controls"><SourceSlot /></div><ErrorState error={new Error(t.unsupported(name, feeds.map((value) => t.feeds[value].split(" · ")[0]).join(", ")))} /></div>
      : feed === "official" ? official : <CooperativeMarketPage key={`${location.pathname}:${feed}:${commodity?.code}`} source={feed === "tss" || feed === "tumcos" ? feed : "mamcos"} />}
  </SourceControl.Provider>;
}

type QuoteSortKey = typeof QUOTE_SORT_KEYS[number];
type QuoteSort = { key: QuoteSortKey; direction: SortDirection };

/** Row-level checks shown as text chips; they describe the published quote, they do not alter it. */
function quoteQuality(row: CooperativeQuote, t: typeof COPY.en): { label: string; ok: boolean | null }[] {
  const ordered = row.minimum_price === null || row.maximum_price === null || row.average_price === null ? null
    : row.minimum_price <= row.average_price && row.average_price <= row.maximum_price;
  return [
    { label: ordered === null ? t.rangeIncomplete : ordered ? t.rangeOk : t.rangeInconsistent, ok: ordered },
    { label: row.unit_status === "source_confirmed" ? t.unitConfirmed : t.unitAssumed, ok: row.unit_status === "source_confirmed" ? true : null },
  ];
}

function SortHeader({ label, column, sort, onSort, numeric }: { label: string; column: QuoteSortKey; sort?: QuoteSort; onSort?: (key: QuoteSortKey) => void; numeric?: boolean }) {
  const active = sort?.key === column;
  if (!onSort) return <th scope="col" className={numeric ? "numeric" : undefined}>{label}</th>;
  return <th scope="col" className={numeric ? "numeric" : undefined} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
    <button type="button" className="sort-button" onClick={() => onSort(column)}>{label}<span aria-hidden="true">{active ? (sort.direction === "asc" ? " ▲" : " ▼") : " ↕"}</span></button></th>;
}

function QuoteTable({ rows, sort, onSort }: { rows: CooperativeQuote[]; sort?: QuoteSort; onSort?: (key: QuoteSortKey) => void }) {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const format = useFormat();
  const source = rows[0]?.source_key ?? "mamcos";
  const tss = source === "tss";
  const sourceName = source.toUpperCase();
  return <div className="table-scroll" tabIndex={0} role="region" aria-label={t.quotations}><table>
    <caption className="sr-only">{t.tableCaption(sourceName, c.inrQuintal, rows[0]?.unit_status === "assumed")}</caption>
    <thead><tr><SortHeader label={c.branch} column="branch" sort={sort} onSort={onSort} /><SortHeader label={c.reportingDate} column="reporting_date" sort={sort} onSort={onSort} /><th scope="col">{c.exactVariety}</th>
      <SortHeader label={c.minimum} column="minimum_price" sort={sort} onSort={onSort} numeric /><SortHeader label={c.average} column="average_price" sort={sort} onSort={onSort} numeric /><SortHeader label={c.maximum} column="maximum_price" sort={sort} onSort={onSort} numeric />
      {tss && <th scope="col" className="numeric">{t.normalRate}</th>}<th scope="col" className="col-quality">{c.quality}</th><th scope="col" className="col-source">{t.sourceFetched}</th></tr></thead>
    <tbody>{rows.map((row) => { const checks = quoteQuality(row, t); return <tr key={row.id}><td className="table-market">{row.branch}
      {/* Phones drop the quality column; a failed check still shows, under the branch. */}
      {checks.some((check) => check.ok === false) && <span className="quality-chips row-warnings">{checks.filter((check) => check.ok === false).map((check) => <span key={check.label} className="status-pill tone-warn">{check.label}</span>)}</span>}</td><td>{format.date(row.reporting_date)}</td><td lang="en">{row.variety}</td>
      <td className="numeric">{money(row.minimum_price, c.notReported)}</td><td className="numeric table-price">{money(row.average_price, c.notReported)}</td><td className="numeric">{money(row.maximum_price, c.notReported)}</td>
      {tss && <td className="numeric">{money(row.normal_price, c.notReported)}</td>}
      <td className="col-quality"><span className="quality-chips">{checks.map((check) => <span key={check.label} className={`status-pill tone-${check.ok === null ? "neutral" : check.ok ? "good" : "warn"}`}>{check.label}</span>)}</span></td>
      <td className="col-source"><a href={row.source_url} target="_blank" rel="noreferrer">{sourceName}</a><small className="quote-fetch">{t.platformFetched(format.timestamp(row.fetched_at))}</small></td></tr>; })}</tbody>
  </table></div>;
}

/** Collapsed provenance: methodology, source permission and fetch history for the selected cooperative feed. */
function CooperativeAbout({ source, data, coverage, awaitingReview, hasRows }: { source: CooperativeSource; data: CooperativeData | undefined; coverage: number; awaitingReview: number; hasRows: boolean }) {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const format = useFormat();
  const sourceName = source.toUpperCase();
  const assumedUnit = source !== "mamcos";
  const benchmark = data?.series.at(-1);
  const lastFetch = data?.last_fetch ? `${fetchStatusText(c, data.last_fetch.status)} · ${format.timestamp(data.last_fetch.started_at)}` : c.never;
  return <AboutData>
    <p>{t.methodology(source, coverage)}</p>
    {(data?.benchmark_conflicts?.length ?? 0) > 0 && <p role="note">{t.conflicts(data!.benchmark_conflicts.map((conflict) => t.conflictOn(conflict.branch, format.date(conflict.reporting_date), conflict.prices.join(", "))).join("; "))}</p>}
    <dl className="fact-list">
      <div><dt>{t.priceType}</dt><dd>{t.priceTypeValue}</dd></div>
      <div><dt>{c.unit}</dt><dd>{t.unitValue(assumedUnit)}</dd></div>
      <div><dt>{t.coverageRule}</dt><dd>{t.coverageRuleValue(coverage)}</dd></div>
      <div><dt>{t.latestConstituents}</dt><dd>{benchmark ? `${benchmark.branches.join(", ")} (${format.date(benchmark.reporting_date)})` : t.noQualifying}</dd></div>
      <div><dt>{t.marketReportingDate}</dt><dd>{format.date(data?.latest_reporting_date)}</dd></div>
      <div><dt>{t.publicationTime}</dt><dd>{t.notSupplied}</dd></div>
      <div><dt>{t.lastFetch}</dt><dd>{lastFetch}</dd></div>
      <div><dt>{t.reportingDates}</dt><dd>{t.keptPerBranch}</dd></div>
      <div><dt>{t.varietyNames}</dt><dd>{t.asPublished(sourceName)}</dd></div>
      <div><dt>{t.permission}</dt><dd>{data?.permission ? t.permissionLabel(data.permission.status, data.permission.redistribution_allowed) : t.notRecorded}</dd></div>
    </dl>
    {data && <><p>{t.statusLine(data.last_fetch ? t.lastRetrieval(fetchStatusText(c, data.last_fetch.status), format.timestamp(data.last_fetch.started_at)) : t.noRetrieval, awaitingReview)}</p>
      <p>{hasRows ? t.published : t.notPublished}{data.publication.latest_archived_reporting_date ? t.latestArchived(format.date(data.publication.latest_archived_reporting_date)) : ""}</p></>}
    {data?.last_fetch?.error_message && <p>{t.lastError(data.last_fetch.error_message)}</p>}
    {assumedUnit && <details><summary>{t.recentFetches}</summary>{data?.recent_fetches.map((run) => <p key={`${run.source_url}:${run.started_at}`}><a href={run.source_url} target="_blank" rel="noreferrer">{c.sourceRequest}</a> · {fetchStatusText(c, run.status)} · {format.timestamp(run.started_at)} · {t.rowsExcluded(run.received_count == null ? c.unknown : String(run.received_count), run.excluded_count)}{run.error_message && <span role="alert"> · {run.error_message}</span>}</p>)}</details>}
    <p>{t.snapshotsNote}</p>
    <Link to="/data-quality">{t.inspect}</Link>
  </AboutData>;
}

function CooperativeMarketPage({ source }: { source: CooperativeSource }) {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const format = useFormat();
  const dateText = (value: string | null | undefined) => format.date(value);
  const cash = (value: number | null | undefined) => money(value, c.notReported);
  const sourceName = source.toUpperCase();
  const assumedUnit = source !== "mamcos";
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const { code, commodity: commodityDef } = useCommodity();
  const { language } = useLanguage();
  // Only commodities with a cooperative capability reach this page (see marketFeeds); the API rejects anything else.
  const commodity = code as CooperativeCommodity;
  // Filters, sort, page and comparison date live in the URL so reloads, shared links and Back keep them.
  const branch = params.get("branch") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const search = params.get("search") ?? "";
  const [searchDraft, setSearchDraft] = useState(search);
  useEffect(() => setSearchDraft(search), [search]);
  useEffect(() => {
    if (searchDraft === search) return;
    const timeout = window.setTimeout(() => {
      setParams(withParams(params, { page: null, search: searchDraft }), { replace: true });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [params, search, searchDraft, setParams]);
  const comparisonDate = params.get("date") ?? "";
  const page = readPage(params);
  const sort: QuoteSort = readSort(params, QUOTE_SORT_KEYS, DEFAULT_QUOTE_SORT);
  const preset = readPreset(params);
  /** Applies filter changes; any change other than paging returns to the first page. */
  const update = (changes: Record<string, string | number | null>) => setParams(withParams(params, { page: null, ...changes }), { replace: true });
  const [chartBranch, setChartBranch] = useState("");
  const selected = params.get("variety") ?? "";
  // Only the observation table honours a custom range; the API keeps headline values anchored to the latest date.
  const range = location.pathname === "/prices" && !(from && to && from > to) ? { from, to } : {};
  const query = useQuery({ queryKey: ["cooperative", source, commodity, selected, range.from ?? "", range.to ?? ""], queryFn: () => api.cooperativePrices(source, selected || undefined, commodity, range), refetchInterval: 60_000 });
  const mode = t.modes[location.pathname as Mode] ?? t.modes["/overview"];
  const data = query.data;
  const coverage = data?.minimum_branch_coverage ?? 3;
  const rows = data?.data ?? [];
  const branches = [...new Set(rows.map((row) => row.branch))].sort();
  // The first branch alphabetically is charted until the reader picks one.
  const selectedChartBranch = branches.includes(chartBranch) ? chartBranch : branches[0] ?? "";
  const quotePoints = rows.flatMap((row) => row.branch === selectedChartBranch && row.average_price !== null
    ? [{ reporting_date: row.reporting_date, average_price: row.average_price }] : []);
  const dates = [...new Set(rows.map((row) => row.reporting_date))].sort().reverse();
  const selectedDate = comparisonDate || data?.latest_reporting_date || "";
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = sortRows(rows.filter((row) => (!branch || row.branch === branch) && (!from || row.reporting_date >= from)
    && (!to || row.reporting_date <= to) && (!normalizedSearch || `${row.branch} ${row.variety}`.toLowerCase().includes(normalizedSearch))), (row) => row[sort.key], sort.direction);
  const activePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const comparison = rows.filter((row) => row.reporting_date === selectedDate).sort((a, b) => (b.average_price ?? 0) - (a.average_price ?? 0));
  const ranked = rankSameDate(rows, (row) => row.average_price === null ? null : { key: String(row.id), label: row.branch, detail: row.variety, reporting_date: row.reporting_date, minimum: row.minimum_price, central: row.average_price, maximum: row.maximum_price }, selectedDate);
  const comparedBranches = new Set(comparison.map((row) => row.branch)).size;
  // Cross-branch spread per reporting date: only dates with at least two reporting branches carry a spread.
  const spreadByDate = dates.slice().reverse().map((date) => ({ date, ...crossSectionSpread(rows.filter((row) => row.reporting_date === date).map((row) => row.average_price)) })).filter((point) => point.count >= 2);
  const averageDistribution = describe(rows.map((row) => row.average_price));
  const averageBins = histogram(rows.flatMap((row) => row.average_price === null ? [] : [row.average_price]), 8);
  function toggleSort(key: QuoteSortKey) {
    const next: QuoteSort = sort.key === key ? { key, direction: sort.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "branch" ? "asc" : "desc" };
    update(sortParams(next, DEFAULT_QUOTE_SORT));
  }
  function applyPreset(value: DatePreset) {
    const range = presetRange(value, calendarTodayIST());
    const period = value === "all" ? null : value;
    if (range) update({ period, from: range.from, to: range.to });
    else if (value === "all") update({ period, from: null, to: null });
    else update({ period });
  }
  const series = data?.series ?? [];
  const current = series.find((point) => point.reporting_date === data?.latest_reporting_date);
  const benchmark = series.at(-1);
  const previous = series.filter((point) => point.reporting_date < (data?.latest_reporting_date ?? "")).at(-1);
  const sameBranches = Boolean(current && previous && JSON.stringify(current.branches) === JSON.stringify(previous.branches));
  const delta = sameBranches && current && previous ? current.median_average_price - previous.median_average_price : null;
  const awaitingReview = data?.publication.awaiting_review_count ?? 0;
  const benchmarkValues = series.map((point) => point.median_average_price);
  // A source with fewer locations than the coverage rule (TUMCOS reports one) cannot form a benchmark, so its own series is charted.
  const singleLocation = (data?.branches.length ?? 0) < coverage;
  // When the newest date lacks coverage, show the latest qualifying benchmark; the card states that date.
  const headlinePrice = data?.reference_price ?? (singleLocation ? comparison[0]?.average_price : series.at(-1)?.median_average_price);
  const latestBranches = (data?.latest_by_branch ?? []).filter((row) => row.reporting_date === data?.latest_reporting_date);
  const missingBranches = (data?.branches ?? []).filter((name) => !(data?.latest_by_branch ?? []).some((row) => row.branch === name));
  const periodMean = benchmarkValues.length ? benchmarkValues.reduce((sum, value) => sum + value, 0) / benchmarkValues.length : null;
  const dispersion = periodMean === null ? null : Math.sqrt(benchmarkValues.reduce((sum, value) => sum + (value - periodMean) ** 2, 0) / benchmarkValues.length);
  const unitNote = assumedUnit ? t.operatorAssumption : undefined;
  const isCompare = location.pathname === "/compare";
  const tableRows = isCompare ? comparison : filtered;
  function exportRows() {
    downloadCsv([["source", "branch", "reporting_date", "variety", "minimum_price", "average_price", "maximum_price", "normal_price", "price_type", "price_unit", "unit_status", "source_url", "fetched_at"],
      ...tableRows.map((row) => [row.source_key, row.branch, row.reporting_date, row.variety, row.minimum_price, row.average_price, row.maximum_price, row.normal_price, row.price_type, row.price_unit, row.unit_status, row.source_url, row.fetched_at])], `areca-pulse-${source}-branch-prices.csv`);
  }
  return <div className="page-stack">
    <section className="page-heading"><div><h1>{mode.title(commodityDef ? commodityName(code, commodityDef, language) : t.marketFallback)}</h1><p className="page-intro">{mode.description}</p>
      <p className="page-meta">{t.meta(sourceName, assumedUnit)}</p></div>
      <div className="heading-controls"><SourceSlot />
      <label className="filter-control"><span>{t.exactReportedVariety}</span><select value={data?.variety ?? ""} disabled={!data?.varieties.length} onChange={(event) => {
        update({ variety: event.target.value, date: null });
      }}>{!data?.varieties.length && <option>{t.noVarieties}</option>}{data?.varieties.map((variety) => <option key={variety} lang="en">{variety}</option>)}</select></label></div>
    </section>
    {location.pathname === "/overview" && <IntelligenceScorecard feed={source} variety={selected} />}
    {query.isPending ? <LoadingState label={t.loadingQuotes} /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : !rows.length ? <EmptyState title={t.emptyTitle}>
      {awaitingReview > 0 ? <>{t.awaiting(awaitingReview)} {data?.publication.latest_archived_reporting_date ? t.archivedDate(format.date(data.publication.latest_archived_reporting_date)) : t.noArchive} </> : null}
      <Link to="/data-quality">{t.fetchAndReview(sourceName)}</Link>. {awaitingReview > 0 ? t.awaitingHere(awaitingReview) : t.nothingSubstituted}
    </EmptyState> : <>
      {location.pathname === "/overview" && <>
        <section className="snapshot-grid" aria-label={t.snapshot}>
          <article className="snapshot-card featured-card"><div className="card-kicker">{singleLocation ? t.latestReportedAverage : t.benchmarkKicker} · {data?.variety}</div><div className="snapshot-value">{cash(headlinePrice)}<small>{t.perQuintal}</small></div>{singleLocation ? <p>{dateText(data?.latest_reporting_date)} · {comparison[0]?.branch ?? t.oneLocation}</p> : <p>{benchmark ? `${dateText(benchmark.reporting_date)} · ${c.branches(benchmark.branch_count)}` : t.noBenchmarkDate}</p>}{!singleLocation && benchmark && benchmark.reporting_date !== data?.latest_reporting_date && <p>{t.newerReports(dateText(data?.latest_reporting_date), c.branches(comparison.length), coverage)}</p>}</article>
          <article className="snapshot-card"><div className="card-kicker">{singleLocation ? t.reportedAverages : t.branchesReporting}</div><div className="snapshot-value">{singleLocation ? rows.length : comparison.length}</div><p>{singleLocation ? t.publishedSoFar(data?.variety ?? "") : t.neededForBenchmark(dateText(data?.latest_reporting_date), coverage)}</p></article>
          {singleLocation ? <>
            <article className="snapshot-card"><div className="card-kicker">{t.daysMinimum}</div><div className="snapshot-value">{cash(comparison[0]?.minimum_price)}</div><p>{comparison[0]?.branch} · {dateText(data?.latest_reporting_date)}</p></article>
            <article className="snapshot-card"><div className="card-kicker">{t.daysMaximum}</div><div className="snapshot-value">{cash(comparison[0]?.maximum_price)}</div><p>{comparison[0]?.branch} · {dateText(data?.latest_reporting_date)}</p></article>
          </> : <>
            <article className="snapshot-card"><div className="card-kicker">{t.highestAverage}</div><div className="snapshot-value">{cash(comparison[0]?.average_price)}</div><p>{comparison[0]?.branch} · {dateText(data?.latest_reporting_date)}</p></article>
            <article className="snapshot-card"><div className="card-kicker">{t.lowestAverage}</div><div className="snapshot-value">{cash(comparison.at(-1)?.average_price)}</div><p>{comparison.at(-1)?.branch} · {dateText(data?.latest_reporting_date)}</p></article>
          </>}
        </section>
        <section className="panel"><div className="panel-heading"><div><h2>{t.pulse}</h2><p>{t.pulseHint}</p></div></div><div className="monthly-details">
          <p>{t.pulseReported(data?.variety ?? "", c.branches(comparison.length), dateText(data?.latest_reporting_date))} {singleLocation ? t.pulseSingle(cash(headlinePrice)) : data?.reference_price !== null ? t.pulseMedian(cash(data?.reference_price)) : benchmark ? t.pulseBelowRule(coverage, cash(benchmark.median_average_price), dateText(benchmark.reporting_date)) : t.pulseNoRule(coverage)}</p>
          {delta !== null ? <p>{t.pulseChange(cash(delta), dateText(previous?.reporting_date))}</p> : <p>{t.pulseWithheld}</p>}
        </div></section>
        <section>
          <article className="panel table-panel"><div className="panel-heading"><div><h2>{t.coverageTitle}</h2><p>{t.coverageHint(latestBranches.length, c.branches(data?.branches.length ?? 0), data?.variety ?? "", data?.latest_reporting_date ? format.date(data.latest_reporting_date) : t.theLatestDate)}</p></div></div>
            <div className="coverage-meter" role="img" aria-label={t.coverageAria(latestBranches.length, data?.branches.length ?? 0)}><span style={{ width: `${data?.branches.length ? latestBranches.length / data.branches.length * 100 : 0}%` }} /></div>
            <div className="table-scroll" tabIndex={0} role="region" aria-label={t.coverageTitle}><table><caption className="sr-only">{t.coverageCaption(data?.variety ?? "")}</caption>
              <thead><tr><th scope="col">{c.branch}</th><th scope="col">{t.latestReportingDate}</th><th scope="col" className="numeric">{c.reportedAverage}</th><th scope="col">{c.status}</th></tr></thead>
              <tbody>{(data?.latest_by_branch ?? []).map((row) => {
                const lag = data?.latest_reporting_date ? Math.round((Date.parse(data.latest_reporting_date) - Date.parse(row.reporting_date)) / 86_400_000) : null;
                return <tr key={row.branch}><td className="table-market">{row.branch}</td><td>{format.date(row.reporting_date)}</td><td className="numeric">{cash(row.average_price)}</td>
                  <td>{lag === 0 ? <span className="status-pill tone-good">{t.latestDate}</span> : <span className="status-pill tone-neutral">{t.daysEarlier(lag ?? 0)}</span>}</td></tr>;
              })}</tbody></table></div>
            {missingBranches.length > 0 && <p className="panel-note">{t.missingBranches(data?.variety ?? "", missingBranches.join(", "))}</p>}
          </article>
        </section>
      </>}
      {location.pathname === "/analytics" && !singleLocation && <section className="snapshot-grid" aria-label={t.analyticsSummary}>
        <article className="snapshot-card"><div className="card-kicker">{t.qualifying}</div><div className="snapshot-value">{series.length}</div><p>{t.qualifyingHint(coverage)}</p></article>
        <article className="snapshot-card"><div className="card-kicker">{t.periodAverage}</div><div className="snapshot-value">{rupees(periodMean)}</div><p>{t.periodAverageHint}</p></article>
        <article className="snapshot-card"><div className="card-kicker">{t.periodHighLow}</div><div className="snapshot-value">{rupees(benchmarkValues.length ? Math.max(...benchmarkValues) : null)}</div><p>{t.low(rupees(benchmarkValues.length ? Math.min(...benchmarkValues) : null))}</p></article>
        <article className="snapshot-card"><div className="card-kicker">{t.dispersion}</div><div className="snapshot-value">{rupees(dispersion)}</div><p>{t.dispersionHint}</p></article>
      </section>}
      {(location.pathname === "/overview" || location.pathname === "/analytics") && <section className="panel"><div className="panel-heading"><div><h2>{t.historyTitle(sourceName, singleLocation)}</h2><p className="phone-hide">{singleLocation ? t.historySingleHint : t.historyHint(series.length, coverage)}</p></div>
        {singleLocation && <label className="filter-control"><span>{t.chartLocation}</span><select value={selectedChartBranch} onChange={(event) => setChartBranch(event.target.value)}>{branches.map((value) => <option key={value}>{value}</option>)}</select></label>}</div>
        {singleLocation ? <div className="monthly-details"><Suspense fallback={<LoadingState />}><PriceChart label={t.chartSingleLabel(sourceName, selectedChartBranch, data?.variety ?? "")} quotePoints={quotePoints} unitNote={unitNote} /></Suspense></div>
          : !series.length ? <EmptyState title={t.insufficientCoverage} /> : <div className="monthly-details"><Suspense fallback={<LoadingState />}><PriceChart label={t.chartBenchmarkLabel(sourceName)} averagePoints={series} showStats={location.pathname !== "/analytics"} unitNote={unitNote} /></Suspense>
          <details><summary>{t.constituents}</summary>{series.map((point) => <p key={point.reporting_date}>{dateText(point.reporting_date)}: {point.branches.join(", ")}</p>)}</details></div>}
      </section>}
      {location.pathname === "/analytics" && <section className="chart-grid">
        <article className="panel chart-panel"><div className="panel-heading"><div><h2>{t.spreadTitle}</h2><p className="phone-hide">{t.spreadHint}</p></div></div>
          {!spreadByDate.length ? <EmptyState title={t.noSpread} /> : <LazyBarChart categories={spreadByDate.map((point) => format.date(point.date))} values={spreadByDate.map((point) => point.spread)} name={t.spreadName} description={t.spreadDescription(sourceName)} />}
          <div className="chart-foot"><SourceLabel>{sourceName} · {t.reportedAveragesLabel}{assumedUnit ? t.assumedUnitLabel : ""}</SourceLabel></div></article>
        <article className="panel chart-panel"><div className="panel-heading"><div><h2>{t.distributionTitle}</h2><p className="phone-hide">{t.distributionHint(averageDistribution.count)}</p></div></div>
          {!averageBins.length ? <EmptyState title={t.noAverages} /> : <LazyBarChart categories={averageBins.map((bin) => `₹${(bin.from / 1000).toFixed(1)}k`)} tooltipLabels={averageBins.map((bin) => `${rupees(bin.from)} – ${rupees(bin.to)}`)} values={averageBins.map((bin) => bin.count)} name={t.observationsName} valueFormat="count" description={t.distributionDescription(sourceName)} />}
          <dl className="fact-list compact"><div><dt>{c.median}</dt><dd>{rupees(averageDistribution.median)}</dd></div><div><dt>{t.iqr}</dt><dd>{rupees(averageDistribution.q1)} – {rupees(averageDistribution.q3)}</dd></div><div><dt>{t.cv}</dt><dd>{averageDistribution.cvPercent === null ? "—" : `${averageDistribution.cvPercent.toFixed(1)}%`}</dd></div></dl>
          <div className="chart-foot"><SourceLabel>{sourceName} · {data?.window ? `${format.date(data.window.from)} – ${format.date(data.window.to)}` : t.currentWindow}</SourceLabel></div></article>
        <p className="panel-note chart-wide phone-hide">{t.seasonalNote} <Link to="/history">{t.historyLink}</Link> {t.seasonalBasis}</p>
      </section>}
      {location.pathname === "/prices" && <section className="filter-bar">
        <label className="filter-control"><span>{c.branch}</span><select value={branch} onChange={(event) => update({ branch: event.target.value })}><option value="">{c.allBranches}</option>{(data?.branches ?? [...new Set(rows.map((row) => row.branch))].sort()).map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="filter-control"><span>{t.searchBranch}</span><MarketSearch feeds={[source]} ariaLabel={t.searchBranch} value={searchDraft} placeholder={t.searchExample} onChange={setSearchDraft}
          onSelect={(suggestion) => { setSearchDraft(""); update({ branch: suggestion.name, search: null }); }} /></label>
        <button className="button-secondary" onClick={() => setParams(withoutFilters(params), { replace: true })}>{c.resetFilters}</button>
        <details className="advanced-filters">
        <summary>{c.moreFilters}{from || to ? ` · ${c.active}` : ""}</summary>
        <div className="advanced-filter-fields">
        <label className="filter-control"><span>{c.reportingPeriod}</span><select value={preset} onChange={(event) => applyPreset(event.target.value as DatePreset)}>{DATE_PRESETS.map((option) => <option key={option.value} value={option.value}>{c.datePresets[option.value]}</option>)}</select></label>
        <label className="filter-control"><span>{c.from}</span><input type="date" value={from} max={to || undefined} onChange={(event) => update({ from: event.target.value, period: "custom" })} /></label>
        <label className="filter-control"><span>{c.to}</span><input type="date" value={to} min={from || undefined} onChange={(event) => update({ to: event.target.value, period: "custom" })} /></label>
        </div></details>
      </section>}
      {isCompare && <section className="filter-bar"><label className="filter-control"><span>{t.sameDate}</span><select value={selectedDate} onChange={(event) => update({ date: event.target.value })}>{dates.map((date) => <option key={date} value={date}>{format.date(date)}</option>)}</select></label><span>{t.rankedNote(comparedBranches, data?.branches.length ?? 0)}</span></section>}
      {isCompare && <section className="panel chart-panel"><div className="panel-heading"><div><h2>{t.rankedTitle}</h2><p>{t.rankedHint(format.date(selectedDate), data?.variety ?? "", assumedUnit)}</p></div></div>
        {!ranked.length ? <EmptyState title={t.noRanked} /> : <LazyRangeChart rows={ranked.map((row) => ({ label: row.label, detail: row.detail, minimum: row.minimum, central: row.central, maximum: row.maximum }))} centralLabel={c.reportedAverage} description={t.rankedDescription(sourceName, data?.variety ?? "", format.date(selectedDate))} />}
        <div className="chart-foot"><SourceLabel>{sourceName} · {t.cooperativeAverages} · {format.date(selectedDate)}</SourceLabel></div>
      </section>}
      {from && to && from > to ? <ErrorState error={new Error(c.invalidRange)} /> : <section className="panel table-panel">
        <div className="panel-heading"><div><h2>{isCompare ? t.comparisonTitle : t.observationsTitle}</h2><p className="phone-hide">{t.matching(tableRows.length)} · {t.notModal}{data?.window && <> · {t.window(format.date(data.window.from), format.date(data.window.to))}{data.window.truncated ? t.truncated(data.window.row_limit.toLocaleString("en-IN")) : ""}</>}</p></div>
          <button className="button-secondary" onClick={exportRows} disabled={!tableRows.length}>{c.exportMatchingCsv}</button></div>
        {!tableRows.length ? <EmptyState title={t.noMatches} /> : <QuoteTable rows={isCompare ? comparison : filtered.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE)} sort={isCompare ? undefined : sort} onSort={isCompare ? undefined : toggleSort} />}
        {!isCompare && filtered.length > PAGE_SIZE && <div className="pagination"><span>{c.page(activePage + 1, Math.ceil(filtered.length / PAGE_SIZE))}</span><div><button className="button-secondary" disabled={!activePage} onClick={() => update({ page: pageParam(activePage - 1) })}>{c.previous}</button><button className="button-secondary" disabled={(activePage + 1) * PAGE_SIZE >= filtered.length} onClick={() => update({ page: pageParam(activePage + 1) })}>{c.next}</button></div></div>}
      </section>}
    </>}
    <CooperativeAbout source={source} data={data} coverage={coverage} awaitingReview={awaitingReview} hasRows={rows.length > 0} />
  </div>;
}

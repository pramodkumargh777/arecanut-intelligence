import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowRight, ArrowUp, ChevronDown, ExternalLink, Minus } from "lucide-react";
import { useState } from "react";
import { AboutData } from "../components/AboutData";
import { ShareButton } from "../components/ShareButton";
import { useChangeFlash } from "../components/useChangeFlash";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { calendarDateToTime, calendarTodayIST, DAY_MS, formatCalendarDate, formatPeriodKannada } from "../../../shared/dates";
import { DEFAULT_COMMODITY } from "../../../shared/commodities";
import { marketBreadth, MAX_CHANGE_GAP_DAYS, priceChange, varietyKey, type PriceChange } from "../../../shared/price-change";
import { ErrorState, SkeletonRows } from "../components/State";
import { api } from "../services/api";
import { useCommodity } from "../services/commodity";
import type { CooperativeQuote, CooperativeSource } from "../services/cooperative";
import { ageText, defineCopy, type Language, useLanguage } from "../services/language";
import { placeName } from "../services/places";
import { shareMessage } from "../services/share";
import { VARIETIES, VARIETY_GROUPS } from "../services/varieties";

const SOURCES: { key: CooperativeSource; kn: string; en: string; assumedUnit: boolean }[] = [
  { key: "mamcos", kn: "ಮ್ಯಾಮ್ಕೋಸ್ (MAMCOS)", en: "MAMCOS", assumedUnit: false },
  { key: "tss", kn: "ಟಿಎಸ್ಎಸ್ (TSS)", en: "TSS", assumedUnit: true },
];

const COPY = defineCopy({
  kn: {
    title: "ಇತ್ತೀಚಿನ ಅಡಿಕೆ ಧಾರಣೆ",
    choose: "ತಳಿ ಆಯ್ಕೆ ಮಾಡಿ",
    sellOrHold: "ಈಗ ಮಾರಬೇಕೇ, ಕಾಯಬೇಕೇ?",
    sellOrHoldHint: "ಹಿಂದಿನ ವರ್ಷಗಳಲ್ಲಿ ಏನಾಯಿತು ನೋಡಿ",
    ask: "ಪ್ರಶ್ನೆ ಕೇಳಿ",
    askHint: "ದರ, ರೋಗ, ಹವಾಮಾನದ ಬಗ್ಗೆ",
    highest: "ಈ ದಿನದ ಹೆಚ್ಚಿನ ದರ",
    source: "ಮೂಲ",
    noRows: "ಈ ತಳಿಗೆ ಪ್ರಕಟಿತ ದರ ಇಲ್ಲ.",
    moreVarieties: "ಇನ್ನಷ್ಟು ತಳಿಗಳು",
    notPublished: (names: string) => `${names} ಈ ತಳಿಯ ದರವನ್ನು ಪ್ರಕಟಿಸುವುದಿಲ್ಲ.`,
    assumedUnit: "ಮೂಲವು ಘಟಕವನ್ನು ತಿಳಿಸಿಲ್ಲ; ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್ ಎಂದು ಪರಿಗಣಿಸಲಾಗಿದೆ",
    tumcosNote: "ತುಮ್ಕೋಸ್ ತಳಿಯನ್ನು ತಿಳಿಸುವುದಿಲ್ಲ, ಆದ್ದರಿಂದ ಇದು ಯಾವ ತಳಿಯ ದರ ಎಂದು ಹೇಳಲಾಗದು. ಮೂಲದ ಪುಟದಲ್ಲಿ “kg” ಎಂದಿದೆ; ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್ ಎಂದು ಪರಿಗಣಿಸಲಾಗಿದೆ.",
    notComparable: "ಪ್ರತಿ ಸಂಸ್ಥೆಯ ದರವನ್ನು ಬೇರೆ ರೀತಿಯಲ್ಲಿ ಲೆಕ್ಕ ಮಾಡಲಾಗುತ್ತದೆ, ಆದ್ದರಿಂದ ಬೇರೆ ಬೇರೆ ಸಂಸ್ಥೆಗಳ ದರಗಳನ್ನು ನೇರವಾಗಿ ಹೋಲಿಸಬೇಡಿ. ಇವು ಸರಾಸರಿ ದರಗಳು; ನಿಮ್ಮ ಮಾಲಿಗೆ ಸಿಗುವ ದರ ಬೇರೆ ಇರಬಹುದು.",
    loading: "ದರಗಳನ್ನು ತರಲಾಗುತ್ತಿದೆ",
    failed: "ದರಗಳನ್ನು ತರಲು ಆಗಲಿಲ್ಲ. ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಪ್ರಯತ್ನಿಸಿ.",
    retry: "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ",
    versus: (when: string) => `${when} ವರದಿಗೆ ಹೋಲಿಸಿ`,
    yesterday: "ನಿನ್ನೆ",
    noChange: "ಬದಲಾವಣೆ ಇಲ್ಲ",
    up: "ಏರಿಕೆ", down: "ಇಳಿಕೆ", flat: "ಬದಲಾವಣೆ ಇಲ್ಲ",
    marketOn: (date: string) => `${date} ರ ಮಾರುಕಟ್ಟೆ`,
    typical: "ಮಧ್ಯಮ ಬದಲಾವಣೆ",
    changeNote: "ಪ್ರತಿ ಶಾಖೆಯನ್ನು ಅದರದೇ ಹಿಂದಿನ ವರದಿಗೆ ಹೋಲಿಸಲಾಗಿದೆ.",
    officialRates: "ಎಪಿಎಂಸಿ ಮಾರುಕಟ್ಟೆ ದರಗಳು",
    officialEmpty: "ಪರಿಶೀಲಿಸಿದ ಎಪಿಎಂಸಿ ದರಗಳು ಇನ್ನೂ ಲಭ್ಯವಿಲ್ಲ.",
    officialMore: "ಎಲ್ಲಾ ಎಪಿಎಂಸಿ ದರಗಳನ್ನು ನೋಡಿ",
    officialOthers: "ಇತರ ಎಪಿಎಂಸಿ ಮಾರುಕಟ್ಟೆಗಳ ದರ ನೋಡಿ",
    grade: "ದರ್ಜೆ",
    otherTools: "ಇನ್ನಷ್ಟು ಮಾಹಿತಿ",
    moreFrom: (source: string) => `${source} ದರಗಳನ್ನು ನೋಡಿ`,
    tumcosEmpty: "ಪ್ರಕಟಿತ ದರ ಇಲ್ಲ.",
    subtitle: "ಸಹಕಾರಿ ಸಂಘ ಮತ್ತು ಎಪಿಎಂಸಿ ಮಾರುಕಟ್ಟೆಗಳ ಪ್ರಕಟಿತ ದರಗಳು, ಪ್ರತಿ ದರದ ದಿನಾಂಕದೊಂದಿಗೆ.",
    latestPill: "ಇತ್ತೀಚಿನ ಸಹಕಾರಿ ವರದಿ",
    cardSub: (date: string, count: number) => `ಇತ್ತೀಚಿನ ವರದಿ: ${date} · ಒಟ್ಟು ${count} ಶಾಖೆಗಳು`,
    cooperativeTitle: "ಸಹಕಾರಿ ಶಾಖೆಗಳ ದರಗಳು",
    cooperativeHint: "ಆಯ್ದ ತಳಿಯ ದರಗಳು · ಪ್ರತಿ ಶಾಖೆಯ ದಿನಾಂಕ ಪರಿಶೀಲಿಸಿ",
    otherMarketsTitle: "ಇತರ ಮಾರುಕಟ್ಟೆ ದರಗಳು",
    otherMarketsHint: "ಎಪಿಎಂಸಿ ದರಗಳು ಎಲ್ಲಾ ತಳಿಗಳನ್ನು ಒಳಗೊಂಡಿವೆ; ತುಮ್ಕೋಸ್ ತಳಿಯನ್ನು ತಿಳಿಸುವುದಿಲ್ಲ.",
    topMark: "ಅತಿ ಹೆಚ್ಚು",
    vs: (when: string) => `${when} ವರದಿಗೆ ಹೋಲಿಸಿ`,
    showAll: (count: number) => `ಎಲ್ಲಾ ${count} ಶಾಖೆಗಳನ್ನು ತೋರಿಸಿ`,
    showFewer: "ಕಡಿಮೆ ತೋರಿಸಿ",
    unitFoot: (assumed: boolean) => `ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ ಸರಾಸರಿ · ಕನಿಷ್ಠ – ಗರಿಷ್ಠ${assumed ? " · ಘಟಕ ಊಹಿಸಲಾಗಿದೆ" : ""}`,
    tumcosSub: "ಚನ್ನಗಿರಿ · ತಳಿ ತಿಳಿಸಿಲ್ಲ · ಘಟಕ ಊಹಿಸಲಾಗಿದೆ",
    officialSub: "AGMARKNET · ಮಾದರಿ ದರ · ಎಲ್ಲಾ ತಳಿಗಳು",
    explore: "ಎಲ್ಲಾ ದರಗಳು",
    about: "ಈ ದರಗಳ ಬಗ್ಗೆ",
    glanceTitle: (variety: string) => `${variety} — ಒಂದು ನೋಟ`,
    glanceHint: "ಪ್ರತಿ ಸಂಸ್ಥೆಯ ಇತ್ತೀಚಿನ ವರದಿಯ ಶಾಖಾ ಸರಾಸರಿಗಳ ವ್ಯಾಪ್ತಿ",
    glanceBranches: (count: number) => `${count} ಶಾಖೆಗಳು`, perQuintal: "/ ಕ್ವಿಂಟಾಲ್", to: "ರಿಂದ",
    noCompare: "ಹೋಲಿಸಲು ಹಿಂದಿನ ವರದಿ ಇಲ್ಲ",
    mostlyUp: "ಹೆಚ್ಚಿನ ಶಾಖೆಗಳಲ್ಲಿ ಏರಿಕೆ", mostlyDown: "ಹೆಚ್ಚಿನ ಶಾಖೆಗಳಲ್ಲಿ ಇಳಿಕೆ", mixed: "ಏರಿಳಿತ ಮಿಶ್ರ", unchanged: "ಬದಲಾವಣೆ ಇಲ್ಲ",
    medianShort: (percent: string) => `ಮಧ್ಯಮ ${percent}`,
    share: "ಹಂಚಿಕೊಳ್ಳಿ", shareOpening: "ತೆರೆಯಲಾಗುತ್ತಿದೆ…", shareDone: "ಹಂಚಿಕೊಳ್ಳಲಾಗಿದೆ", shareWhatsapp: "ವಾಟ್ಸ್‌ಆ್ಯಪ್ ತೆರೆಯಲಾಗಿದೆ",
    shareAria: (source: string) => `${source} ದರಗಳನ್ನು ಹಂಚಿಕೊಳ್ಳಿ`,
    shareTitle: (variety: string, source: string) => `${variety} ಅಡಿಕೆ ಧಾರಣೆ · ${source}`,
    shareReport: (date: string) => `ವರದಿ: ${date}`,
    shareMore: (count: number) => `…ಇನ್ನೂ ${count} ಶಾಖೆಗಳು`,
    shareBasis: (assumed: boolean) => `ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ ಸರಾಸರಿ ದರ${assumed ? " (ಘಟಕ ಊಹಿಸಲಾಗಿದೆ)" : ""}. ನಿಮ್ಮ ಮಾಲಿನ ದರ ಬೇರೆ ಇರಬಹುದು.`,
    shareTumcosTitle: "ಅಡಿಕೆ ಧಾರಣೆ · ತುಮ್ಕೋಸ್ ಚನ್ನಗಿರಿ",
    shareTumcosNote: "ತಳಿ ತಿಳಿಸಿಲ್ಲ; ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್ ಎಂದು ಪರಿಗಣಿಸಲಾಗಿದೆ. ನಿಮ್ಮ ಮಾಲಿನ ದರ ಬೇರೆ ಇರಬಹುದು.",
    shareOfficialTitle: "ಅಡಿಕೆ ಎಪಿಎಂಸಿ ಮಾರುಕಟ್ಟೆ ದರಗಳು",
    shareOfficialNote: "ಎಪಿಎಂಸಿ ಮಾದರಿ ದರ, ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ (AGMARKNET).",
    shareOfficialMore: (count: number) => `…ಇನ್ನೂ ${count} ದರಗಳು`,
  },
  en: {
    title: "Latest arecanut rates",
    choose: "Choose a variety",
    sellOrHold: "Sell now or wait?",
    sellOrHoldHint: "See what happened in past years",
    ask: "Ask a question",
    askHint: "About rates, disease or weather",
    highest: "Highest that day",
    source: "Source",
    noRows: "No published rate for this variety.",
    moreVarieties: "More varieties",
    notPublished: (names: string) => `${names} ${names.includes(" and ") ? "do" : "does"} not publish this variety.`,
    assumedUnit: "The source states no unit; treated as per quintal",
    tumcosNote: "TUMCOS does not state the variety, so this cannot be matched to a grade. Its page says “kg”; treated as per quintal.",
    notComparable: "Each cooperative works out its rate differently, so don't compare rates directly between cooperatives. These are averages; the rate for your lot can differ.",
    loading: "Loading rates",
    failed: "Could not load the rates. Please try again shortly.",
    retry: "Try again",
    versus: (when: string) => `vs ${when}`,
    yesterday: "yesterday",
    noChange: "No change",
    up: "up", down: "down", flat: "unchanged",
    marketOn: (date: string) => `Market on ${date}`,
    typical: "Median change",
    changeNote: "Each branch is compared with its own previous report.",
    officialRates: "APMC market rates",
    officialEmpty: "No verified APMC prices are available yet.",
    officialMore: "Explore all APMC prices",
    officialOthers: "See rates from more APMC markets",
    grade: "Grade",
    otherTools: "Explore further",
    moreFrom: (source: string) => `Explore ${source} prices`,
    tumcosEmpty: "No published rates available.",
    subtitle: "Published cooperative and APMC market rates, each with its reporting date.",
    latestPill: "Latest cooperative report",
    cardSub: (date: string, count: number) => `Latest report: ${date} · ${count} branch${count === 1 ? "" : "es"} in total`,
    cooperativeTitle: "Cooperative branch prices",
    cooperativeHint: "Selected variety · check each branch's reporting date",
    otherMarketsTitle: "Other market quotations",
    otherMarketsHint: "APMC prices include all varieties; TUMCOS does not state a variety.",
    topMark: "Highest",
    vs: (when: string) => `compared with the ${when} report`,
    showAll: (count: number) => `Show all ${count} branches`,
    showFewer: "Show fewer",
    unitFoot: (assumed: boolean) => `average per quintal · minimum – maximum${assumed ? " · unit assumed" : ""}`,
    tumcosSub: "Channagiri · variety not stated · unit assumed",
    officialSub: "AGMARKNET · modal price, ₹/quintal · all varieties",
    explore: "All rates",
    about: "About these rates",
    glanceTitle: (variety: string) => `${variety} at a glance`,
    glanceHint: "Range of branch averages in each cooperative's latest report",
    glanceBranches: (count: number) => `${count} branch${count === 1 ? "" : "es"}`, perQuintal: "/ quintal", to: "to",
    noCompare: "No earlier report to compare",
    mostlyUp: "mostly up", mostlyDown: "mostly down", mixed: "mixed", unchanged: "unchanged",
    medianShort: (percent: string) => `median ${percent}`,
    share: "Share", shareOpening: "Opening…", shareDone: "Shared", shareWhatsapp: "WhatsApp opened",
    shareAria: (source: string) => `Share ${source} rates`,
    shareTitle: (variety: string, source: string) => `${variety} arecanut rates · ${source}`,
    shareReport: (date: string) => `Report: ${date}`,
    shareMore: (count: number) => `…and ${count} more branch${count === 1 ? "" : "es"}`,
    shareBasis: (assumed: boolean) => `Average rate per quintal${assumed ? " (unit assumed)" : ""}. The rate for your lot can differ.`,
    shareTumcosTitle: "Arecanut rate · TUMCOS Channagiri",
    shareTumcosNote: "Variety not stated; treated as per quintal. The rate for your lot can differ.",
    shareOfficialTitle: "Arecanut APMC market rates",
    shareOfficialNote: "APMC modal price per quintal (AGMARKNET).",
    shareOfficialMore: (count: number) => `…and ${count} more rate${count === 1 ? "" : "s"}`,
  },
});

const rupees = (value: number | null) => value === null ? "—" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const dateText = (date: string, language: Language) => language === "kn" ? formatPeriodKannada(date) : formatCalendarDate(date);
const ageDays = (date: string, today: string) => Math.round((calendarDateToTime(today) - calendarDateToTime(date)) / DAY_MS);
const branchName = placeName;

/** Shared links point at this site, so a friend who opens one sees the same variety's rates. */
const shareUrl = (path: string) => `${window.location.origin}${path}`;

const signedPercent = (value: number) => `${value > 0 ? "+" : ""}${value}%`;

function ChangeLine({ change, today, language }: { change: PriceChange | null; today: string; language: Language }) {
  const copy = COPY[language];
  if (!change) return null;
  const when = ageDays(change.previous_date, today) === 1 ? copy.yesterday : dateText(change.previous_date, language);
  if (change.amount === 0) return <span className="rate-change" title={copy.vs(when)}><Minus size={13} aria-hidden="true" />{copy.noChange}</span>;
  const rising = change.amount > 0;
  return <span className={`rate-change ${rising ? "hold-up" : "hold-down"}`} title={copy.vs(when)}>
    {rising ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />}
    {rising ? "+" : "−"}{rupees(Math.abs(change.amount))} ({signedPercent(change.percent).replace("-", "−")})
    <span className="sr-only"> {copy.vs(when)}</span>
  </span>;
}

/** Rates from the latest date first, highest first, so only rates from one day are ever compared. Older ones follow. */
function orderRows(all: CooperativeQuote[]) {
  // A branch can appear under two spellings of one label; its newest report is the one shown.
  const newest = new Map<string, CooperativeQuote>();
  for (const row of all) {
    if (row.average_price === null) continue;
    const key = `${row.branch}|${varietyKey(row.variety)}`;
    const current = newest.get(key);
    if (!current || row.reporting_date > current.reporting_date) newest.set(key, row);
  }
  const usable = [...newest.values()];
  const latest = usable.map((row) => row.reporting_date).sort().at(-1);
  return { latest, rows: [...usable].sort((a, b) => b.reporting_date.localeCompare(a.reporting_date) || (b.average_price! - a.average_price!) || a.branch.localeCompare(b.branch)) };
}

/** Two lines per branch: place, badge and date on the left; price, change and range on the right. */
function RateRow({ row, today, language, highest, showLabel, change, reveal }: { row: CooperativeQuote; today: string; language: Language; highest: boolean; showLabel: boolean; change: PriceChange | null; reveal?: "in" | "out" }) {
  const copy = COPY[language];
  const age = ageDays(row.reporting_date, today);
  // A refresh that brings a new report or price for this branch marks the row briefly. It is visual only: announcing
  // every changed row would read out a dozen messages at once, and the new price is read when the row is reached.
  const updated = useChangeFlash(`${row.reporting_date}|${row.average_price}`);
  return <li className={`rate-row${highest ? " rate-row-top" : ""}${updated ? " rate-row-updated" : ""}${reveal ? ` rate-row-${reveal}` : ""}`}>
    <div className="rate-place">
      <strong>{branchName(row.branch, language)}{highest && <span className="rate-top-mark" title={copy.highest}>{copy.topMark}</span>}</strong>
      <span className="rate-meta"><span className={`rate-date${age > 2 ? " rate-date-old" : ""}`}>{dateText(row.reporting_date, language)} · {ageText(age, language)}</span>
        {showLabel && <span className="rate-label" lang="en">{row.variety}</span>}</span>
    </div>
    <div className="rate-price">
      <strong>{rupees(row.average_price)}</strong>
      <span className="rate-sub"><ChangeLine change={change} today={today} language={language} /><span className="rate-range">{rupees(row.minimum_price)} – {rupees(row.maximum_price)}</span></span>
    </div>
  </li>;
}

/**
 * Rows per card before the toggle. Three keeps MAMCOS level with TSS, which has three branches, and stops one source
 * pushing the others off the screen.
 */
const VISIBLE_ROWS = 3;
/** The one APMC market shown on the home page; every other market is a link away. */
const HOME_APMC = { name: "Siddapur", district: "Uttara Kannada" };
/** Branches most readers look for. The collapsed card shows these first and tops up from the rest if one did not report. */
const FEATURED_BRANCHES: Partial<Record<CooperativeSource, string[]>> = { mamcos: ["SHIVAMOGGA", "SAGARA", "THIRTHAHALLI"] };

function collapsedRows(rows: CooperativeQuote[], featured: string[] = []) {
  const picked = rows.filter((row) => featured.includes(row.branch.toUpperCase()));
  return [...picked, ...rows.filter((row) => !picked.includes(row))].slice(0, VISIBLE_ROWS);
}
/** Matches the `rate-row-out` animation in styles.css. */
const COLLAPSE_MS = 150;

export function HomePage() {
  const { language } = useLanguage();
  const { code } = useCommodity();
  const [params, setParams] = useSearchParams();
  const copy = COPY[language];
  const today = calendarTodayIST();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // The card whose extra rows are fading out; they are removed once the animation ends.
  const [collapsing, setCollapsing] = useState<string | null>(null);
  // Enough reports to find each branch's previous one. Older ones are too old to show a change against anyway.
  const historyFrom = new Date(calendarDateToTime(today) - (MAX_CHANGE_GAP_DAYS + 7) * DAY_MS).toISOString().slice(0, 10);
  const variety = VARIETIES.find((item) => item.key === params.get("v")) ?? VARIETIES[0];
  const requests = SOURCES.flatMap((source) => (variety.labels[source.key] ?? []).map((label) => ({ source: source.key, label })));
  // TUMCOS never states a variety, so its single rate is shown only beside the everyday varieties.
  const showTumcos = Boolean(variety.everyday);
  const queries = useQueries({ queries: [...requests, ...(showTumcos ? [{ source: "tumcos" as const, label: "areca" }] : [])].map(({ source, label }) => ({
    queryKey: ["home-rates", source, label],
    queryFn: () => api.cooperativePrices(source, label, "arecanut", { from: historyFrom }),
    refetchInterval: 300_000,
  })) });
  const official = useQuery({
    queryKey: ["home-official-prices", HOME_APMC.name],
    queryFn: () => api.prices({ commodity: DEFAULT_COMMODITY, q: HOME_APMC.name, district: HOME_APMC.district, limit: "30", sort: "reporting_date", order: "desc" }),
    enabled: code === DEFAULT_COMMODITY,
    refetchInterval: 300_000,
  });
  // The rates here are arecanut's, so another commodity goes to the page that handles it.
  if (code !== DEFAULT_COMMODITY) return <Navigate to={`/overview?commodity=${encodeURIComponent(code)}`} replace />;
  const rowsFor = (source: CooperativeSource) => {
    const labels = variety.labels[source] ?? [];
    return labels.flatMap((label) => queries[requests.findIndex((request) => request.source === source && request.label === label)]?.data?.latest_by_branch ?? []);
  };
  const historyFor = (source: CooperativeSource) => {
    const labels = variety.labels[source] ?? [];
    return labels.flatMap((label) => queries[requests.findIndex((request) => request.source === source && request.label === label)]?.data?.data ?? []);
  };
  // Siddapur's latest day, and from it the row for the chosen variety when the APMC publishes one under the same name.
  const apmcDay = (official.data?.data ?? []).filter((row, _, all) => row.market_name.startsWith(HOME_APMC.name) && row.reporting_date === all[0].reporting_date);
  const apmcRow = apmcDay.find((row) => row.variety_name.toLowerCase() === variety.en.toLowerCase())
    ?? apmcDay.find((row) => row.variety_name.toLowerCase() === "rashi") ?? apmcDay[0];
  const tumcosQuery = showTumcos ? queries.at(-1) : undefined;
  const tumcos = tumcosQuery?.data?.latest_by_branch ?? [];
  const tumcosHistory = tumcosQuery?.data?.data ?? [];
  const publishing = SOURCES.filter((source) => variety.labels[source.key]?.length);
  const notPublishing = SOURCES.filter((source) => !variety.labels[source.key]?.length);
  const choose = (key: string) => { const next = new URLSearchParams(params); next.set("v", key); setParams(next, { replace: true }); };
  const varietyName = (item: typeof variety) => language === "kn" ? item.kn : item.en;
  const allDates = [...SOURCES.flatMap((source) => rowsFor(source.key)), ...tumcos].map((row) => row.reporting_date).sort();
  const newest = allDates.at(-1);
  const newestAge = newest ? ageDays(newest, today) : null;
  const moreToggle = (key: string, total: number) => total > VISIBLE_ROWS && <button type="button" className="rate-more-toggle" aria-expanded={Boolean(expanded[key])}
    onClick={() => {
      if (!expanded[key]) return setExpanded((current) => ({ ...current, [key]: true }));
      setCollapsing(key);
      setTimeout(() => { setExpanded((current) => ({ ...current, [key]: false })); setCollapsing(null); }, COLLAPSE_MS);
    }}>
    {expanded[key] ? copy.showFewer : copy.showAll(total)}<ChevronDown size={15} aria-hidden="true" /></button>;
  // One line per cooperative from its latest report. Sources stay separate because each works out its average differently.
  const glance = publishing.flatMap((source) => {
    const { latest, rows } = orderRows(rowsFor(source.key));
    const sameDay = rows.filter((row) => row.reporting_date === latest);
    if (!latest || !sameDay.length) return [];
    const prices = sameDay.map((row) => row.average_price!);
    const history = historyFor(source.key);
    return [{ source, latest, low: Math.min(...prices), high: Math.max(...prices), count: sameDay.length, breadth: marketBreadth(sameDay.map((row) => priceChange(row, history))) }];
  });
  const shareLabels = { share: copy.share, opening: copy.shareOpening, shared: copy.shareDone, whatsapp: copy.shareWhatsapp };
  // Rows outside the collapsed set animate in when the card is expanded and out when it is collapsed.
  const reveal = (key: string, row: CooperativeQuote, collapsed: CooperativeQuote[]) => collapsed.includes(row) ? undefined : collapsing === key ? "out" as const : "in" as const;
  return <div className="page-stack home" lang={language}>
    <section className="home-hero">
      <div><h1>{copy.title}</h1><p>{copy.subtitle}</p></div>
      {newest && <p className={`home-date-pill${newestAge !== null && newestAge > 2 ? " home-date-pill-old" : ""}`}>
        <span className="home-date-dot" aria-hidden="true" /><span>{copy.latestPill}: <strong>{dateText(newest, language)}</strong> · {ageText(newestAge ?? 0, language)}</span></p>}
    </section>

    <div className="home-variety">
    <div className="home-variety-label" id="home-variety-label">{copy.choose}</div>
    <div className="variety-chips" role="group" aria-labelledby="home-variety-label">
      {VARIETIES.filter((item) => item.everyday).map((item) => <button key={item.key} type="button" aria-pressed={item.key === variety.key}
        onClick={() => choose(item.key)}>{varietyName(item)}</button>)}
      <label className={`variety-more${variety.everyday ? "" : " variety-more-active"}`}>
        <span className="sr-only">{copy.moreVarieties}</span>
        <select value={variety.everyday ? "" : variety.key} onChange={(event) => choose(event.target.value)}>
          <option value="" disabled>{copy.moreVarieties}</option>
          {VARIETY_GROUPS.map((group) => {
            const items = VARIETIES.filter((item) => !item.everyday && item.group === group.key);
            return items.length ? <optgroup key={group.key} label={language === "kn" ? group.kn : group.en}>
              {items.map((item) => <option key={item.key} value={item.key}>{varietyName(item)}</option>)}
            </optgroup> : null;
          })}
        </select>
      </label>
    </div>
    </div>
    {variety.note && <p className="home-note home-note-callout">{variety.note[language]}</p>}

    {glance.length > 0 && <section className="glance" aria-labelledby="glance-heading">
      <header className="glance-head"><h2 id="glance-heading">{copy.glanceTitle(varietyName(variety))}</h2><p>{copy.glanceHint}</p></header>
      {/* One tile per cooperative, never merged: each works out its average differently. */}
      <ul className="glance-tiles">{glance.map(({ source, latest, low, high, count, breadth }) => {
        const trend = breadth.median_percent === null ? null
          : breadth.up > breadth.down ? { text: copy.mostlyUp, className: "hold-up", Icon: ArrowUp }
          : breadth.down > breadth.up ? { text: copy.mostlyDown, className: "hold-down", Icon: ArrowDown }
          : { text: breadth.up ? copy.mixed : copy.unchanged, className: "", Icon: Minus };
        const age = ageDays(latest, today);
        return <li key={source.key} className="glance-tile">
          <div className="glance-tile-top">
            <a className="glance-source" href={`#rates-${source.key}`}>{source.en}</a>
            <span className={`glance-date${age > 2 ? " glance-date-old" : ""}`}>{dateText(latest, language)} · {ageText(age, language)}</span>
          </div>
          <p className="glance-range">
            <span>{rupees(low)}</span>
            {low !== high && <><span className="glance-dash" aria-hidden="true">–</span><span className="sr-only"> {copy.to} </span><span>{rupees(high)}</span></>}
            <small>{copy.perQuintal}</small>
          </p>
          <div className="glance-tile-foot">
            {trend ? <span className={`glance-trend ${trend.className}`}><trend.Icon size={13} aria-hidden="true" />{trend.text} · {copy.medianShort(signedPercent(breadth.median_percent!).replace("-", "−"))}</span>
              : <span className="glance-trend">{copy.noCompare}</span>}
            <span className="glance-branches">{copy.glanceBranches(count)}</span>
          </div>
        </li>;
      })}</ul>
    </section>}

    <nav className="home-sections" aria-label={language === "kn" ? "ದರಗಳ ವಿಭಾಗಗಳು" : "Price sections"}>
      {publishing.map((source) => <a key={source.key} href={`#rates-${source.key}`}>{source.en}</a>)}
      {showTumcos && <a href="#rates-tumcos">TUMCOS</a>}
      <a href="#rates-official">APMC</a>
    </nav>

    <section className="home-price-section" aria-labelledby="cooperative-prices-heading">
    <div className="home-section-heading"><h2 id="cooperative-prices-heading">{copy.cooperativeTitle}</h2><p>{copy.cooperativeHint}</p></div>
    {/* Collapsed cards are stretched to one height so their footers line up; an expanded card would stretch the others too far. */}
    <div className={`rate-grid${publishing.some((source) => expanded[source.key]) ? "" : " rate-grid-even"}`}>
      {publishing.map((source) => {
        const published = variety.labels[source.key]!;
        const sourceQueries = requests.flatMap((request, index) => request.source === source.key ? [queries[index]] : []);
        const { latest, rows } = orderRows(rowsFor(source.key));
        const sameDay = rows.filter((row) => row.reporting_date === latest);
        const history = historyFor(source.key);
        const breadth = marketBreadth(sameDay.map((row) => priceChange(row, history)));
        const collapsed = collapsedRows(rows, FEATURED_BRANCHES[source.key]);
        return <section className="rate-card" key={source.key} aria-labelledby={`rates-${source.key}`}>
          <header className="rate-card-head">
            <div><h3 id={`rates-${source.key}`}>{language === "kn" ? source.kn : source.en}</h3>
              <span className="rate-card-basis">{copy.unitFoot(source.assumedUnit)}</span>
              {latest && <span className="rate-card-sub">{copy.cardSub(dateText(latest, language), rows.length)}</span>}</div>
            {rows[0] && <a className="rate-source" href={rows[0].source_url} target="_blank" rel="noreferrer">{copy.source}<ExternalLink size={13} aria-hidden="true" /></a>}
          </header>
          {sourceQueries.some((query) => query.isPending) ? <SkeletonRows label={copy.loading} /> : <>
            {sourceQueries.some((query) => query.isError) && <ErrorState error={new Error(copy.failed)} retryLabel={copy.retry} onRetry={() => sourceQueries.filter((query) => query.isError).forEach((query) => void query.refetch())} />}
            {!rows.length && !sourceQueries.some((query) => query.isError) && <p className="rate-empty">{copy.noRows}</p>}
            {rows.length > 0 && <>
            {latest && breadth.median_percent !== null && <div className="market-breadth" aria-label={copy.marketOn(dateText(latest, language))}>
              <span className="hold-up"><ArrowUp size={13} aria-hidden="true" /><b>{breadth.up}</b> {copy.up}</span>
              <span className="hold-down"><ArrowDown size={13} aria-hidden="true" /><b>{breadth.down}</b> {copy.down}</span>
              {breadth.flat > 0 && <span><Minus size={13} aria-hidden="true" /><b>{breadth.flat}</b> {copy.flat}</span>}
              <span className={`market-breadth-median ${breadth.median_percent > 0 ? "hold-up" : breadth.median_percent < 0 ? "hold-down" : ""}`}>{copy.typical} <b>{signedPercent(breadth.median_percent).replace("-", "−")}</b></span>
            </div>}
            <ul className="rate-list">{(expanded[source.key] ? rows : collapsed).map((row) => <RateRow key={`${row.branch}|${varietyKey(row.variety)}`} reveal={reveal(source.key, row, collapsed)} row={row} today={today} language={language} showLabel
              highest={sameDay.length > 1 && row === sameDay[0]} change={priceChange(row, history)} />)}</ul>
            {moreToggle(source.key, rows.length)}
            </>}
          </>}
          <footer className="rate-card-foot">
            {latest && <ShareButton labels={shareLabels} ariaLabel={copy.shareAria(source.en)} title={copy.shareTitle(varietyName(variety), source.en)} message={() => shareMessage({
              title: copy.shareTitle(varietyName(variety), language === "kn" ? source.kn : source.en), date: copy.shareReport(dateText(latest, language)),
              lines: sameDay.map((row) => ({ place: branchName(row.branch, language), price: rupees(row.average_price) })),
              more: copy.shareMore, note: copy.shareBasis(source.assumedUnit), url: shareUrl(`/?v=${encodeURIComponent(variety.key)}`),
            })} />}
            <Link to={`/prices?feed=${source.key}${published.length === 1 ? `&variety=${encodeURIComponent(published[0])}` : ""}`} aria-label={copy.moreFrom(source.en)}>{copy.explore} <ArrowRight size={14} aria-hidden="true" /></Link></footer>
        </section>;
      })}
    </div>
    {notPublishing.length > 0 && <p className="home-note">{copy.notPublished(notPublishing.map((source) => source.en).join(language === "kn" ? " ಮತ್ತು " : " and "))}</p>}
    </section>

    <section className="home-price-section" aria-labelledby="other-prices-heading">
    <div className="home-section-heading"><h2 id="other-prices-heading">{copy.otherMarketsTitle}</h2>{showTumcos && <p>{copy.otherMarketsHint}</p>}</div>
    <div className="rate-grid rate-grid-even">
      {showTumcos && <section className="rate-card" aria-labelledby="rates-tumcos">
        <header className="rate-card-head">
          <div><h3 id="rates-tumcos">TUMCOS</h3><span className="rate-card-basis">{copy.unitFoot(true)}</span><span className="rate-card-sub">{copy.tumcosSub}</span></div>
          {tumcos[0] && <a className="rate-source" href={tumcos[0].source_url} target="_blank" rel="noreferrer">{copy.source}<ExternalLink size={13} aria-hidden="true" /></a>}
        </header>
        {tumcosQuery?.isPending ? <SkeletonRows label={copy.loading} rows={1} /> : tumcosQuery?.isError ? <ErrorState error={new Error(copy.failed)} retryLabel={copy.retry} onRetry={() => void tumcosQuery.refetch()} /> : tumcos.length ? <ul className="rate-list">{tumcos.map((row) => <RateRow key={row.branch} row={row} today={today} language={language} showLabel={false} highest={false} change={priceChange(row, tumcosHistory)} />)}</ul> : <p className="rate-empty">{copy.tumcosEmpty}</p>}
        <footer className="rate-card-foot">{tumcos[0] && <ShareButton labels={shareLabels} ariaLabel={copy.shareAria("TUMCOS")} title={copy.shareTumcosTitle} message={() => shareMessage({
          title: copy.shareTumcosTitle, date: copy.shareReport(dateText(tumcos[0].reporting_date, language)),
          lines: tumcos.map((row) => ({ place: branchName(row.branch, language), price: rupees(row.average_price) })),
          more: copy.shareMore, note: copy.shareTumcosNote, url: shareUrl(`/?v=${encodeURIComponent(variety.key)}`),
        })} />}<Link to="/prices?feed=tumcos" aria-label={copy.moreFrom("TUMCOS")}>{copy.explore} <ArrowRight size={14} aria-hidden="true" /></Link></footer>
      </section>}

    <section className="rate-card" aria-labelledby="rates-official">
      <header className="rate-card-head"><div><h3 id="rates-official">{copy.officialRates}</h3><span className="rate-card-basis">{copy.officialSub}</span></div></header>
      {official.isPending ? <SkeletonRows label={copy.loading} rows={1} /> : official.isError ? <ErrorState error={new Error(copy.failed)} retryLabel={copy.retry} onRetry={() => void official.refetch()} /> : !apmcRow ? <p className="rate-empty">{copy.officialEmpty}</p> :
        <><ul className="rate-list">{[apmcRow].map((row) => <li className="rate-row" key={row.id}>
          <div className="rate-place"><strong>{row.market_name}</strong><span className="rate-meta"><span>{row.district} · {dateText(row.reporting_date, language)} · {ageText(ageDays(row.reporting_date, today), language)}</span><span className="rate-label" lang="en">{row.variety_name}{row.grade ? ` · ${copy.grade}: ${row.grade}` : ""} · {row.source_name}</span></span></div>
          <div className="rate-price"><strong>{rupees(row.modal_price)}</strong></div>
        </li>)}</ul>
        <Link className="rate-more-toggle" to="/prices?feed=official">{copy.officialOthers}<ArrowRight size={15} aria-hidden="true" /></Link></>}
      <footer className="rate-card-foot">{apmcRow ? <ShareButton labels={shareLabels} ariaLabel={copy.shareAria("APMC")} title={copy.shareOfficialTitle} message={() => shareMessage({
        title: copy.shareOfficialTitle,
        date: copy.shareReport(dateText(apmcRow.reporting_date, language)),
        lines: apmcDay.map((row) => ({ place: `${row.market_name} · ${row.variety_name}`, price: rupees(row.modal_price) })),
        more: copy.shareOfficialMore, note: copy.shareOfficialNote, url: shareUrl("/prices?feed=official"),
      })} /> : null}<Link to="/prices?feed=official" aria-label={copy.officialMore}>{copy.explore} <ArrowRight size={14} aria-hidden="true" /></Link></footer>
    </section>
    </div>
    </section>

    <section className="home-price-section" aria-labelledby="home-tools-heading">
    <div className="home-section-heading"><h2 id="home-tools-heading">{copy.otherTools}</h2></div>
    <nav className="home-actions" aria-label={copy.otherTools}>
      <Link to="/sell-or-hold"><strong>{copy.sellOrHold}</strong><span>{copy.sellOrHoldHint}</span><ArrowRight size={18} aria-hidden="true" /></Link>
      <Link to="/assistant"><strong>{copy.ask}</strong><span>{copy.askHint}</span><ArrowRight size={18} aria-hidden="true" /></Link>
    </nav>
    </section>

    <AboutData title={copy.about}>
      <p>{copy.notComparable}</p>
      <p>{copy.changeNote}</p>
      <p>{copy.assumedUnit}.</p>
      <p>{copy.tumcosNote}</p>
    </AboutData>
  </div>;
}

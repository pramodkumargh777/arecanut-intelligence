import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowRight, ArrowUp, ChevronDown, ExternalLink, MapPin, Minus, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AboutData } from "../components/AboutData";
import { ShareButton } from "../components/ShareButton";
import { useChangeFlash } from "../components/useChangeFlash";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { varietyPath } from "../services/seo-pages";
import { CARD_VARIETIES, MARKET_PLACES, marketBySlug } from "../services/markets";
import { setMyTown, useMyTown } from "../services/myTown";
import { agmarknetVarietyName, apmcCatalogueOrder, apmcLabelMatches } from "../services/agmarknetVarieties";
import type { PriceObservation } from "../types";
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
import chaliImage from "../assets/varieties/chali.webp";
import rashiImage from "../assets/varieties/rashi.webp";
import sippeGotuImage from "../assets/varieties/sippe-gotu.webp";
import { RollingNumber } from "../components/RollingNumber";

/** The three varieties most growers sell are picture cards; every other variety is in the "More varieties" list. */
const HOME_VARIETIES = VARIETIES.filter((item) => item.everyday);
const VARIETY_IMAGES: Record<string, string> = { rashi: rashiImage, chali: chaliImage, "sippe-gotu": sippeGotuImage };

const SOURCES: { key: CooperativeSource; kn: string; en: string }[] = [
  { key: "mamcos", kn: "ಮ್ಯಾಮ್ಕೋಸ್ (MAMCOS)", en: "MAMCOS" },
  { key: "tss", kn: "ಟಿಎಸ್ಎಸ್ (TSS)", en: "TSS" },
  // TMS Sirsi states "Rates in ₹/quintal" on its portal, so its unit is the source's own.
  { key: "tms", kn: "ಟಿಎಂಎಸ್ ಶಿರಸಿ (TMS)", en: "TMS Sirsi" },
];

const COPY = defineCopy({
  kn: {
    title: "ಇತ್ತೀಚಿನ ಅಡಿಕೆ ಧಾರಣೆ",
    choose: "ತಳಿ ಆಯ್ಕೆ ಮಾಡಿ",
    moreVarieties: "ಇನ್ನಷ್ಟು ತಳಿಗಳು", everyday: "ಸಾಮಾನ್ಯ ತಳಿಗಳು",
    sellOrHold: "ಈಗ ಮಾರಬೇಕೇ, ಕಾಯಬೇಕೇ?",
    sellOrHoldHint: "ಹಿಂದಿನ ವರ್ಷಗಳಲ್ಲಿ ಏನಾಯಿತು ನೋಡಿ",
    ask: "ಪ್ರಶ್ನೆ ಕೇಳಿ",
    askHint: "ದರ, ರೋಗ, ಹವಾಮಾನದ ಬಗ್ಗೆ",
    longHistory: "2014ರಿಂದ ಧಾರಣೆ",
    longHistoryHint: "ಪ್ರತಿ ತಿಂಗಳ ದರ, 50ಕ್ಕೂ ಹೆಚ್ಚು ಮಾರುಕಟ್ಟೆಗಳಿಂದ",
    highest: "ಈ ದಿನದ ಹೆಚ್ಚಿನ ದರ",
    source: "ಮೂಲ",
    noRows: "ಈ ತಳಿಗೆ ಪ್ರಕಟಿತ ದರ ಇಲ್ಲ.",
    notPublished: (names: string) => `${names} ಈ ತಳಿಯ ದರವನ್ನು ಪ್ರಕಟಿಸುವುದಿಲ್ಲ.`,
    tumcosNote: "ತುಮ್ಕೋಸ್ ತಳಿಯನ್ನು ತಿಳಿಸುವುದಿಲ್ಲ, ಆದ್ದರಿಂದ ಇದು ಯಾವ ತಳಿಯ ದರ ಎಂದು ಹೇಳಲಾಗದು.",
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
    showAllVarieties: (count: number) => `ಎಲ್ಲ ${count} ತಳಿಗಳನ್ನು ತೋರಿಸಿ`,
    onlyBranch: "ಈ ತಳಿಗೆ ವರದಿ ಮಾಡಿದ ಏಕೈಕ ಶಾಖೆ",
    unitFoot: "ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ ಸರಾಸರಿ · ಕನಿಷ್ಠ – ಗರಿಷ್ಠ",
    rowKey: "ಸರಾಸರಿ · ಕನಿಷ್ಠ–ಗರಿಷ್ಠ /ಕ್ವಿಂ",
    tumcosSub: "ಚನ್ನಗಿರಿ · ತಳಿ ತಿಳಿಸಿಲ್ಲ", tumcosLabel: "ತಳಿ ತಿಳಿಸಿಲ್ಲ",
    officialSub: "AGMARKNET · ಮಾದರಿ ದರ · ಎಲ್ಲಾ ತಳಿಗಳು",
    explore: "ಎಲ್ಲಾ ದರಗಳು",
    about: "ಈ ದರಗಳ ಬಗ್ಗೆ",
    glanceTitle: (variety: string) => `${variety} — ಒಂದು ನೋಟ`,
    glanceHint: "ಶಾಖೆಗಳಲ್ಲಿ ಕಡಿಮೆಯಿಂದ ಹೆಚ್ಚಿನ ದರ, ಪ್ರತಿ ಸಂಸ್ಥೆಯ ಇತ್ತೀಚಿನ ವರದಿ",
    glanceBranches: (count: number) => `${count} ಶಾಖೆಗಳು`, perQuintal: "/ ಕ್ವಿಂಟಾಲ್", perQuintalWord: "ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್", to: "ರಿಂದ",
    noCompare: "ಹಿಂದಿನ ವರದಿ ಇಲ್ಲ", noCompareHint: "ಬದಲಾವಣೆ ತೋರಿಸಲು ಹಿಂದಿನ ವರದಿ ಇಲ್ಲ",
    mostlyUp: "ಏರಿಕೆ", mostlyDown: "ಇಳಿಕೆ", mixed: "ಏರಿಳಿತ ಮಿಶ್ರ", unchanged: "ಬದಲಾವಣೆ ಇಲ್ಲ",
    share: "ಹಂಚಿಕೊಳ್ಳಿ", shareOpening: "ತೆರೆಯಲಾಗುತ್ತಿದೆ…", shareDone: "ಹಂಚಿಕೊಳ್ಳಲಾಗಿದೆ", shareWhatsapp: "ವಾಟ್ಸ್‌ಆ್ಯಪ್ ತೆರೆಯಲಾಗಿದೆ",
    shareAria: (source: string) => `${source} ದರಗಳನ್ನು ಹಂಚಿಕೊಳ್ಳಿ`,
    shareTitle: (variety: string, source: string) => `${variety} ಅಡಿಕೆ ಧಾರಣೆ · ${source}`,
    shareReport: (date: string) => `ವರದಿ: ${date}`,
    shareMore: (count: number) => `…ಇನ್ನೂ ${count} ಶಾಖೆಗಳು`,
    shareBasis: "ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ ಸರಾಸರಿ ದರ. ನಿಮ್ಮ ಮಾಲಿನ ದರ ಬೇರೆ ಇರಬಹುದು.",
    shareGlanceTitle: (variety: string) => `${variety} ಅಡಿಕೆ ಧಾರಣೆ · ಸಹಕಾರಿ ಸಂಘಗಳು`,
    shareGlanceAria: "ಈ ನೋಟವನ್ನು ಹಂಚಿಕೊಳ್ಳಿ",
    shareGlanceNote: "ಪ್ರತಿ ಸಂಸ್ಥೆಯ ಇತ್ತೀಚಿನ ವರದಿಯ ಶಾಖಾ ಸರಾಸರಿಗಳ ವ್ಯಾಪ್ತಿ, ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ. ನಿಮ್ಮ ಮಾಲಿನ ದರ ಬೇರೆ ಇರಬಹುದು.",
    shareTumcosTitle: "ಅಡಿಕೆ ಧಾರಣೆ · ತುಮ್ಕೋಸ್ ಚನ್ನಗಿರಿ",
    shareTumcosNote: "ತಳಿ ತಿಳಿಸಿಲ್ಲ. ನಿಮ್ಮ ಮಾಲಿನ ದರ ಬೇರೆ ಇರಬಹುದು.",
    shareOfficialTitle: "ಅಡಿಕೆ ಎಪಿಎಂಸಿ ಮಾರುಕಟ್ಟೆ ದರಗಳು",
    shareOfficialNote: "ಎಪಿಎಂಸಿ ಮಾದರಿ ದರ, ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ (AGMARKNET).",
    shareOfficialMore: (count: number) => `…ಇನ್ನೂ ${count} ದರಗಳು`,
    chooseTown: "ಊರು ಆಯ್ಕೆ ಮಾಡಿ", allTowns: "ಎಲ್ಲ ಊರುಗಳು", clearTownAria: (place: string) => `${place} ಆಯ್ಕೆ ತೆಗೆದು ಎಲ್ಲ ಊರುಗಳ ದರ ನೋಡಿ`,
    glanceTownTitle: (variety: string, place: string) => `${variety} — ${place}`,
    glanceTownHint: "ಈ ಊರಿನ ಪ್ರತಿ ಮೂಲದ ಇತ್ತೀಚಿನ ದರ, ಅದರದೇ ದಿನಾಂಕದೊಂದಿಗೆ",
    townBranch: (place: string) => `${place} ಶಾಖೆ`, townApmcSub: "ಎಪಿಎಂಸಿ ಮೋಡಲ್ ದರ",
    staleFor: (days: number) => `${days} ದಿನಗಳಿಂದ ಹೊಸ ದರ ಇಲ್ಲ`,
    townEmpty: (place: string) => `${place}: ಈ ತಳಿಗೆ ಇತ್ತೀಚಿನ ದರ ಇಲ್ಲ. ಬೇರೆ ತಳಿ ಅಥವಾ "ಎಲ್ಲ ಊರುಗಳು" ಆರಿಸಿ.`,
    townCooperativeTitle: (place: string) => `${place}: ಸಹಕಾರಿ ಶಾಖೆಯ ದರ`,
    townCooperativeHint: "ನಿಮ್ಮ ಊರಿನ ಶಾಖೆ ಮೊದಲು; ಇತರ ಶಾಖೆಗಳು \"ಎಲ್ಲ ಶಾಖೆಗಳನ್ನು ತೋರಿಸಿ\" ಒತ್ತಿದರೆ",
    townNoCooperative: (place: string) => `${place}ನಲ್ಲಿ ಸಹಕಾರಿ ಸಂಘದ ಶಾಖೆ ದರ ಪ್ರಕಟಿಸುವುದಿಲ್ಲ.`,
    townNotThisVariety: (place: string) => `${place} ಶಾಖೆಯ ಸಹಕಾರಿ ಸಂಘಗಳು ಈ ತಳಿಯ ದರ ಪ್ರಕಟಿಸುವುದಿಲ್ಲ.`,
    branchMissing: (place: string) => `${place} ಶಾಖೆ ಈ ತಳಿಯ ದರ ಇತ್ತೀಚೆಗೆ ಪ್ರಕಟಿಸಿಲ್ಲ. ಇತರ ಶಾಖೆಗಳ ದರ ಕೆಳಗಿದೆ.`,
    townApmcTitle: (place: string) => `${place} ಎಪಿಎಂಸಿ`,
    townApmcAll: "ಈ ತಳಿಯ ಹೆಸರಿನಲ್ಲಿ ದರ ಇಲ್ಲ · ಈ ಎಪಿಎಂಸಿಯ ಎಲ್ಲ ತಳಿಗಳು",
    townApmcEmpty: "ಕಳೆದ 45 ದಿನಗಳಲ್ಲಿ ಈ ಎಪಿಎಂಸಿ ದರ ಪ್ರಕಟಿಸಿಲ್ಲ.",
    plainChange: (amount: number, yesterday: boolean) => amount === 0 ? (yesterday ? "ನಿನ್ನೆಯಷ್ಟೇ" : "ಹಿಂದಿನ ದರದಷ್ಟೇ")
      : `${yesterday ? "ನಿನ್ನೆಗಿಂತ" : "ಹಿಂದಿನ ದರಕ್ಕಿಂತ"} ${rupees(Math.abs(amount))} ${amount > 0 ? "ಹೆಚ್ಚು" : "ಕಡಿಮೆ"}`,
  },
  en: {
    title: "Latest arecanut rates",
    choose: "Choose a variety",
    moreVarieties: "More varieties", everyday: "Everyday varieties",
    sellOrHold: "Sell now or wait?",
    sellOrHoldHint: "See what happened in past years",
    ask: "Ask a question",
    askHint: "About rates, disease or weather",
    longHistory: "Prices since 2014",
    longHistoryHint: "Every month, from 50+ markets",
    highest: "Highest that day",
    source: "Source",
    noRows: "No published rate for this variety.",
    notPublished: (names: string) => `${names} ${names.includes(" and ") ? "do" : "does"} not publish this variety.`,
    tumcosNote: "TUMCOS does not state the variety, so this cannot be matched to a grade.",
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
    showAllVarieties: (count: number) => `Show all ${count} varieties`,
    onlyBranch: "The only branch reporting this variety",
    unitFoot: "average per quintal · minimum – maximum",
    rowKey: "avg · min–max / qtl",
    tumcosSub: "Channagiri · variety not stated", tumcosLabel: "variety not stated",
    officialSub: "AGMARKNET · modal price, ₹/quintal · all varieties",
    explore: "All rates",
    about: "About these rates",
    glanceTitle: (variety: string) => `${variety} at a glance`,
    glanceHint: "Lowest to highest branch rate in each cooperative's latest report",
    glanceBranches: (count: number) => `${count} branch${count === 1 ? "" : "es"}`, perQuintal: "/ quintal", perQuintalWord: "per quintal", to: "to",
    noCompare: "No prior report", noCompareHint: "No earlier report to show a change against",
    mostlyUp: "Up", mostlyDown: "Down", mixed: "Mixed", unchanged: "Unchanged",
    share: "Share", shareOpening: "Opening…", shareDone: "Shared", shareWhatsapp: "WhatsApp opened",
    shareAria: (source: string) => `Share ${source} rates`,
    shareTitle: (variety: string, source: string) => `${variety} arecanut rates · ${source}`,
    shareReport: (date: string) => `Report: ${date}`,
    shareMore: (count: number) => `…and ${count} more branch${count === 1 ? "" : "es"}`,
    shareBasis: "Average rate per quintal. The rate for your lot can differ.",
    shareGlanceTitle: (variety: string) => `${variety} arecanut rates · cooperatives`,
    shareGlanceAria: "Share this summary",
    shareGlanceNote: "Range of branch averages per quintal in each cooperative's latest report. The rate for your lot can differ.",
    shareTumcosTitle: "Arecanut rate · TUMCOS Channagiri",
    shareTumcosNote: "Variety not stated. The rate for your lot can differ.",
    shareOfficialTitle: "Arecanut APMC market rates",
    shareOfficialNote: "APMC modal price per quintal (AGMARKNET).",
    shareOfficialMore: (count: number) => `…and ${count} more rate${count === 1 ? "" : "s"}`,
    chooseTown: "Choose a town", allTowns: "All towns", clearTownAria: (place: string) => `Clear ${place} and show all towns`,
    glanceTownTitle: (variety: string, place: string) => `${variety} in ${place}`,
    glanceTownHint: "The latest rate from each source in this town, each with its own date",
    townBranch: (place: string) => `${place} branch`, townApmcSub: "APMC modal price",
    staleFor: (days: number) => `No new rate for ${days} days`,
    townEmpty: (place: string) => `${place}: no recent rate for this variety. Choose another variety or "All towns".`,
    townCooperativeTitle: (place: string) => `${place}: cooperative branch rates`,
    townCooperativeHint: "Your town's branch first; the other branches under \"Show all\"",
    townNoCooperative: (place: string) => `No cooperative publishes branch rates in ${place}.`,
    townNotThisVariety: (place: string) => `The cooperatives in ${place} do not publish this variety.`,
    branchMissing: (place: string) => `The ${place} branch has not published this variety recently. Other branches are below.`,
    townApmcTitle: (place: string) => `${place} APMC`,
    townApmcAll: "No rate under this variety's name · all varieties at this APMC",
    townApmcEmpty: "This APMC has published no rate in the last 45 days.",
    plainChange: (amount: number, yesterday: boolean) => amount === 0 ? (yesterday ? "Same as yesterday" : "Same as the last rate")
      : `${rupees(Math.abs(amount))} ${amount > 0 ? "more" : "less"} than ${yesterday ? "yesterday" : "the last rate"}`,
  },
});

const rupees = (value: number | null) => value === null ? "—" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const dateText = (date: string, language: Language) => language === "kn" ? formatPeriodKannada(date) : formatCalendarDate(date);
const ageDays = (date: string, today: string) => Math.round((calendarDateToTime(today) - calendarDateToTime(date)) / DAY_MS);
const branchName = placeName;

/** Shared links point at this site, so a friend who opens one sees the same variety's rates. */
const shareUrl = (path: string) => `${window.location.origin}${path}`;
/** Rashi opens by default, so its link needs no variety and stays short. */
const varietyShareUrl = (key: string, town?: string) => {
  const params = new URLSearchParams();
  if (key !== VARIETIES[0].key) params.set("v", key);
  if (town) params.set("town", town);
  return shareUrl(params.toString() ? `/?${params}` : "/");
};

const signedPercent = (value: number) => `${value > 0 ? "+" : ""}${value}%`;

function ChangeLine({ change, today, language }: { change: PriceChange | null; today: string; language: Language }) {
  const copy = COPY[language];
  if (!change) return null;
  const when = ageDays(change.previous_date, today) === 1 ? copy.yesterday : dateText(change.previous_date, language);
  if (change.amount === 0) return <span className="rate-change" title={copy.vs(when)}><Minus size={14} aria-hidden="true" />{copy.noChange}</span>;
  const rising = change.amount > 0;
  return <span className={`rate-change ${rising ? "hold-up" : "hold-down"}`} title={copy.vs(when)}>
    {rising ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
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
/**
 * One branch. On phones the card header is hidden, so `sourceTag` names the cooperative beside the branch and `priceKey`
 * says which figure is the average and which the range; desktop keeps both in the card header and hides these.
 */
function RateRow({ row, today, language, highest, showLabel, change, reveal, sourceTag, priceKey, label }: { row: CooperativeQuote; today: string; language: Language; highest: boolean; showLabel: boolean; change: PriceChange | null; reveal?: "in" | "out"; sourceTag?: string; priceKey?: string; label?: string }) {
  const copy = COPY[language];
  const age = ageDays(row.reporting_date, today);
  // A refresh that brings a new report or price for this branch marks the row briefly. It is visual only: announcing
  // every changed row would read out a dozen messages at once, and the new price is read when the row is reached.
  const updated = useChangeFlash(`${row.reporting_date}|${row.average_price}`);
  return <li className={`rate-row${highest ? " rate-row-top" : ""}${updated ? " rate-row-updated" : ""}${reveal ? ` rate-row-${reveal}` : ""}`}>
    <div className="rate-place">
      <strong>{branchName(row.branch, language)}{highest && <span className="rate-top-mark" title={copy.highest}>{copy.topMark}</span>}{sourceTag && <span className="rate-source-tag" lang="en">{sourceTag}</span>}</strong>
      <span className="rate-meta"><span className={`rate-date${age > 2 ? " rate-date-old" : ""}`}>{dateText(row.reporting_date, language)} <span className="rate-age">{ageText(age, language)}</span></span>
        {showLabel && <span className="rate-label" lang={label ? language : "en"}>{label ?? row.variety}</span>}</span>
    </div>
    <div className="rate-price">
      <strong><RollingNumber text={rupees(row.average_price)} /></strong>
      <span className="rate-sub"><ChangeLine change={change} today={today} language={language} /><span className="rate-range">{rupees(row.minimum_price)} – {rupees(row.maximum_price)}</span></span>
      {priceKey && <span className="rate-key">{priceKey}</span>}
    </div>
  </li>;
}

/**
 * Rows per card before the toggle: one, the branch most readers look for, so every cooperative's card is the same height
 * and sits level with the others. The rest are one tap away under "Show all".
 */
const VISIBLE_ROWS = 1;
/** The one APMC market shown on the home page; every other market is a link away. */
const HOME_APMC = { name: "Siddapur", district: "Uttara Kannada" };
/** The branch each card shows when collapsed. If it did not report this variety, the card shows its first row instead. */
const FEATURED_BRANCHES: Partial<Record<CooperativeSource, string[]>> = { mamcos: ["SHIVAMOGGA"], tss: ["SIRSI"], tms: ["SIRSI"] };

function collapsedRows(rows: CooperativeQuote[], featured: string[] = []) {
  const picked = rows.filter((row) => featured.includes(row.branch.toUpperCase()));
  return [...picked, ...rows.filter((row) => !picked.includes(row))].slice(0, VISIBLE_ROWS);
}
/** Matches the `rate-row-out` animation in styles.css. */
const COLLAPSE_MS = 150;

/** A card with no entry shows its first rows only. While "closing", its extra rows fade out before they are removed. */
type CardState = "open" | "closing";

function useCardStates() {
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => { const pending = timers.current; return () => pending.forEach(clearTimeout); }, []);
  const set = (key: string, state: CardState | undefined) => setCards(({ [key]: _, ...rest }) => state ? { ...rest, [key]: state } : rest);
  function toggle(key: string) {
    clearTimeout(timers.current.get(key));
    timers.current.delete(key);
    // A card that is closing opens again rather than closing twice.
    if (cards[key] !== "open") return set(key, "open");
    set(key, "closing");
    timers.current.set(key, setTimeout(() => { timers.current.delete(key); set(key, undefined); }, COLLAPSE_MS));
  }
  return { cards, toggle };
}

const SEEN_REPORT_KEY = "ani-latest-report-seen";

/**
 * The "latest report" pill. When a newer report has arrived since this device last showed one, its dot pulses once to
 * say so; the first visit has nothing to compare and does not pulse. The date seen is kept only on this device, and a
 * browser that blocks storage simply never pulses.
 */
function ReportDatePill({ newest, old, children }: { newest: string; old: boolean; children: ReactNode }) {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(SEEN_REPORT_KEY);
      if (seen && newest > seen) setFresh(true);
      if (!seen || newest > seen) window.localStorage.setItem(SEEN_REPORT_KEY, newest);
    } catch { /* storage blocked: no pulse */ }
  }, [newest]);
  return <p className={`home-date-pill${old ? " home-date-pill-old" : ""}${fresh ? " is-fresh" : ""}`}>
    <span className="home-date-dot" aria-hidden="true" />{children}</p>;
}

/** Towns grouped by district, in the order the town list shows them. */
const TOWN_DISTRICTS = [...new Map(MARKET_PLACES.map((place) => [place.district.en, place.district])).values()]
  .map((district) => ({ district, places: MARKET_PLACES.filter((place) => place.district.en === district.en) }));

function TownOptions({ language }: { language: Language }) {
  return <>{TOWN_DISTRICTS.map(({ district, places }) => <optgroup key={district.en} label={language === "kn" ? district.kn : district.en}>
    {places.map((place) => <option key={place.slug} value={place.slug}>{language === "kn" ? place.kn : place.en}</option>)}
  </optgroup>)}</>;
}

/** APMC rows are looked for over the same window as the town pages use. */
const TOWN_APMC_DAYS = 45;
/** A rate this many days older than today is called out in words instead of being shown as the current price. */
const STALE_DAYS = 7;

/** One row per variety and grade at a market: its latest report. Rows arrive newest first. */
function latestPerLabel(rows: PriceObservation[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.variety_name}|${row.grade ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** An APMC row in the shape the change helper reads, so its change is worked out like a branch's. */
const apmcDated = (row: PriceObservation) => ({ branch: row.market_name, variety: `${row.variety_name}|${row.grade ?? ""}`, reporting_date: row.reporting_date, average_price: row.modal_price });

type TownTile = { key: string; label: string; sub: string; low: number; high: number; date: string; change: PriceChange | null; anchor: string };


/**
 * The chosen town's APMC: the chosen variety's rate when the APMC reports it under the same name, otherwise every
 * variety it reports, labelled as such so an APMC "New Variety" is never passed off as a cooperative grade.
 */
function TownApmcCard({ title, rows, matched, loading, failed, onRetry, today, language, shareLabels, shareUrl: url }: {
  title: string; rows: PriceObservation[]; matched: boolean; loading: boolean; failed: boolean; onRetry: () => void;
  today: string; language: Language; shareLabels: { share: string; opening: string; shared: string; whatsapp: string }; shareUrl: () => string;
}) {
  const copy = COPY[language];
  const [open, setOpen] = useState(false);
  // Catalogue order, three at first like every source card; the rest under "Show all".
  const ordered = apmcCatalogueOrder(rows);
  const shown = open ? ordered : ordered.slice(0, CARD_VARIETIES);
  return <section className="rate-card" data-source="apmc" aria-labelledby="rates-official">
    <header className="rate-card-head"><div><h3 id="rates-official">{title}</h3><span className="rate-card-basis">{matched || !rows.length ? copy.townApmcSub : copy.townApmcAll}</span></div></header>
    {loading ? <SkeletonRows label={copy.loading} rows={1} /> : failed ? <ErrorState error={new Error(copy.failed)} retryLabel={copy.retry} onRetry={onRetry} />
      : !rows.length ? <p className="rate-empty">{copy.townApmcEmpty}</p>
      : <ul className="rate-list">{shown.map((row) => {
        const age = ageDays(row.reporting_date, today);
        return <li className="rate-row" key={row.id}>
          <div className="rate-place"><strong>{agmarknetVarietyName(row.variety_name, language)}{row.grade ? ` · ${row.grade}` : ""}</strong>
            <span className="rate-meta"><span className={`rate-date${age > 2 ? " rate-date-old" : ""}`}>{dateText(row.reporting_date, language)} <span className="rate-age">{ageText(age, language)}</span></span></span></div>
          <div className="rate-price"><strong><RollingNumber text={rupees(row.modal_price)} /></strong>
            <span className="rate-sub"><span className="rate-range">{rupees(row.minimum_price)} – {rupees(row.maximum_price)}</span></span></div>
        </li>;
      })}</ul>}
    {!loading && !failed && ordered.length > CARD_VARIETIES && <button type="button" className="rate-more-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
      {open ? copy.showFewer : copy.showAllVarieties(ordered.length)}<ChevronDown size={16} aria-hidden="true" /></button>}
    <footer className="rate-card-foot">{shown.length > 0 && <ShareButton labels={shareLabels} ariaLabel={copy.shareAria("APMC")} title={title} message={() => shareMessage({
      title, lines: ordered.map((row) => ({ place: agmarknetVarietyName(row.variety_name, language), price: rupees(row.modal_price), date: dateText(row.reporting_date, language) })),
      more: copy.shareOfficialMore, note: copy.shareOfficialNote, url: url(),
    })} />}<Link to="/prices?feed=official" aria-label={copy.officialMore}>{copy.explore} <ArrowRight size={14} aria-hidden="true" /></Link></footer>
  </section>;
}

export function HomePage() {
  const { language } = useLanguage();
  const { code } = useCommodity();
  const [params, setParams] = useSearchParams();
  const copy = COPY[language];
  const today = calendarTodayIST();
  const { cards, toggle } = useCardStates();
  // The town filter: a shared link's ?town= first, then the town this device chose. "All towns" is today's page.
  const myTown = useMyTown();
  const town = marketBySlug(params.get("town") ?? undefined) ?? myTown;
  const apmcFrom = new Date(calendarDateToTime(today) - (TOWN_APMC_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
  // Enough reports to find each branch's previous one. Older ones are too old to show a change against anyway.
  const historyFrom = new Date(calendarDateToTime(today) - (MAX_CHANGE_GAP_DAYS + 7) * DAY_MS).toISOString().slice(0, 10);
  // A variety page (/variety/rashi) names the variety in its address; the home page keeps it in ?v=.
  const { key: pageVariety } = useParams();
  const navigate = useNavigate();
  const variety = VARIETIES.find((item) => item.key === (pageVariety ?? params.get("v"))) ?? VARIETIES[0];
  // Switching variety dips the price board and cards and fades them back (0.18s), so the swap reads as a change rather
  // than a snap. Web Animations, so nothing remounts and the prices still glide from old to new; skipped on first load
  // and for readers who ask for reduced motion.
  const swapped = useRef<string | null>(null);
  useEffect(() => {
    if (swapped.current === null) { swapped.current = variety.key; return; }
    if (swapped.current === variety.key) return;
    swapped.current = variety.key;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    document.querySelectorAll<HTMLElement>(".home .glance, .home .home-price-section").forEach((element) =>
      element.animate?.([{ opacity: 0.35 }, { opacity: 1 }], { duration: 180, easing: "ease-out" }));
  }, [variety.key]);
  const requests = SOURCES.flatMap((source) => (variety.labels[source.key] ?? []).map((label) => ({ source: source.key, label })));
  // TUMCOS never states a variety, so its single rate is shown only beside the common dried grades.
  const showTumcos = Boolean(variety.tumcos);
  const queries = useQueries({ queries: [...requests, ...(showTumcos ? [{ source: "tumcos" as const, label: "areca" }] : [])].map(({ source, label }) => ({
    queryKey: ["home-rates", source, label],
    queryFn: () => api.cooperativePrices(source, label, "arecanut", { from: historyFrom }),
    refetchInterval: 300_000,
  })) });
  const official = useQuery({
    queryKey: ["home-official-prices", HOME_APMC.name],
    queryFn: () => api.prices({ commodity: DEFAULT_COMMODITY, q: HOME_APMC.name, district: HOME_APMC.district, limit: "30", sort: "reporting_date", order: "desc" }),
    enabled: code === DEFAULT_COMMODITY && !town,
    refetchInterval: 300_000,
  });
  // A chosen town's APMC, looked up by market id: a text search scans every price row.
  const markets = useQuery({ queryKey: ["markets", DEFAULT_COMMODITY], queryFn: () => api.markets(DEFAULT_COMMODITY), enabled: code === DEFAULT_COMMODITY && Boolean(town?.apmc), staleTime: 3_600_000 });
  const townMarketId = town?.apmc ? markets.data?.find((market) => market.name === town.apmc)?.id : undefined;
  const townApmc = useQuery({
    queryKey: ["home-town-apmc", townMarketId, apmcFrom],
    queryFn: () => api.prices({ commodity: DEFAULT_COMMODITY, market_id: townMarketId, from: apmcFrom, limit: "200", sort: "reporting_date", order: "desc", include_count: "false" }),
    enabled: Boolean(townMarketId),
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
  const choose = (key: string) => {
    if (pageVariety) return navigate(`${varietyPath(key)}${params.toString() ? `?${params}` : ""}`, { replace: true });
    const next = new URLSearchParams(params); next.set("v", key); setParams(next, { replace: true });
  };
  const chooseTown = (slug: string) => {
    setMyTown(slug || null);
    const next = new URLSearchParams(params);
    if (slug) next.set("town", slug); else next.delete("town");
    setParams(next, { replace: true });
  };
  const varietyName = (item: typeof variety) => language === "kn" ? item.kn : item.en;
  const townName = town ? (language === "kn" ? town.kn : town.en) : "";
  // With a town chosen, only the cooperatives with a branch there; each card leads with that branch.
  const shownSources = town ? publishing.filter((source) => town.branches[source.key]) : publishing;
  const townBranchRow = (source: CooperativeSource) => {
    const branch = town?.branches[source]?.toUpperCase();
    return branch ? orderRows(rowsFor(source)).rows.find((row) => row.branch.toUpperCase() === branch) : undefined;
  };
  const showTumcosCard = showTumcos && (!town || Boolean(town.branches.tumcos));
  // The town's APMC: the chosen variety when it reports one under the same name, otherwise every variety it reports.
  const townApmcLatest = town?.apmc ? latestPerLabel((townApmc.data?.data ?? []).filter((row) => row.market_name === town.apmc)) : [];
  const townApmcMatched = townApmcLatest.filter((row) => apmcLabelMatches(variety.key, row.variety_name));
  const townTiles: TownTile[] = !town ? [] : [
    ...shownSources.flatMap((source) => {
      const row = townBranchRow(source.key);
      return row?.average_price ? [{ key: source.key, label: source.en, sub: copy.townBranch(townName), low: row.average_price, high: row.average_price,
        date: row.reporting_date, change: priceChange(row, historyFor(source.key)), anchor: `#rates-${source.key}` }] : [];
    }),
    ...(() => {
      const latest = townApmcMatched.map((row) => row.reporting_date).sort().at(-1);
      const day = townApmcMatched.filter((row) => row.reporting_date === latest && row.modal_price > 0);
      if (!latest || !day.length) return [];
      const prices = day.map((row) => row.modal_price);
      return [{ key: "apmc", label: "APMC", sub: copy.townApmcSub, low: Math.min(...prices), high: Math.max(...prices), date: latest,
        change: day.length === 1 ? priceChange(apmcDated(day[0]), (townApmc.data?.data ?? []).map(apmcDated)) : null, anchor: "#rates-official" }];
    })(),
  ];
  const townLoading = Boolean(town) && (queries.some((query) => query.isPending) || (Boolean(town?.apmc) && (markets.isPending || (Boolean(townMarketId) && townApmc.isPending))));
  const allDates = [...SOURCES.flatMap((source) => rowsFor(source.key)), ...tumcos].map((row) => row.reporting_date).sort();
  const newest = allDates.at(-1);
  const newestAge = newest ? ageDays(newest, today) : null;
  // A card with nothing more to show says so in the toggle's place, so every card's rows and footer stay level.
  const moreToggle = (key: string, total: number) => total === 1 ? <p className="rate-more-note">{copy.onlyBranch}</p> : total > VISIBLE_ROWS && <button type="button" className="rate-more-toggle" aria-expanded={cards[key] === "open"}
    onClick={() => toggle(key)}>
    {cards[key] === "open" ? copy.showFewer : copy.showAll(total)}<ChevronDown size={16} aria-hidden="true" /></button>;
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
  const reveal = (key: string, row: CooperativeQuote, collapsed: CooperativeQuote[]) => collapsed.includes(row) ? undefined : cards[key] === "closing" ? "out" as const : "in" as const;
  // The town's summary: one tile per source in that town, the same tile layout as the all-towns strip. A rate that is
  // well behind today says so in words, so an old figure is never read as today's.
  const townGlance = town && (townTiles.length ? <section className="glance" aria-labelledby="glance-heading">
    <header className="glance-head"><h2 id="glance-heading">{copy.glanceTownTitle(varietyName(variety), townName)}</h2><p>{copy.glanceTownHint}</p>
      <span className="glance-share"><ShareButton labels={shareLabels} ariaLabel={copy.shareGlanceAria} title={copy.glanceTownTitle(varietyName(variety), townName)} message={() => shareMessage({
        title: copy.glanceTownTitle(varietyName(variety), townName),
        lines: townTiles.map((tile) => ({ place: `${tile.label} · ${tile.sub}`, price: tile.low === tile.high ? rupees(tile.low) : `${rupees(tile.low)} – ${rupees(tile.high)}`, date: dateText(tile.date, language) })),
        more: copy.shareMore, note: copy.shareBasis, url: varietyShareUrl(variety.key, town.slug),
      })} /></span></header>
    <ul className="glance-tiles">{townTiles.map((tile) => {
      const age = ageDays(tile.date, today);
      const stale = age > STALE_DAYS;
      const yesterday = tile.change !== null && ageDays(tile.change.previous_date, today) === 1;
      return <li key={tile.key} data-source={tile.key} className={`glance-tile${stale ? " glance-tile-stale" : ""}`}>
        <div className="glance-tile-top">
          <a className="glance-source" href={tile.anchor}>{tile.label}</a>
          <span className={`glance-date${age > 2 ? " glance-date-old" : ""}`}>{dateText(tile.date, language)} · {ageText(age, language)}</span>
        </div>
        <p className="glance-range">
          <span><RollingNumber text={rupees(tile.low)} /></span>
          {tile.low !== tile.high && <><span className="glance-dash" aria-hidden="true">–</span><span className="sr-only"> {copy.to} </span><span><RollingNumber text={rupees(tile.high)} /></span></>}
          <small>{copy.perQuintal}</small>
        </p>
        <p className="glance-sub">{copy.perQuintalWord} · {tile.sub}</p>
        <div className="glance-tile-foot">
          {stale ? <span className="glance-trend glance-trend-stale">{copy.staleFor(age)}</span>
            : tile.change ? <span className={`glance-trend${tile.change.amount > 0 ? " hold-up" : tile.change.amount < 0 ? " hold-down" : ""}`} title={copy.vs(dateText(tile.change.previous_date, language))}>
              {tile.change.amount > 0 ? <ArrowUp size={14} aria-hidden="true" /> : tile.change.amount < 0 ? <ArrowDown size={14} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" />}
              {copy.plainChange(tile.change.amount, yesterday)}</span>
            : <span className="glance-trend" title={copy.noCompareHint}>{copy.noCompare}</span>}
          <span className="glance-branches">{tile.sub}</span>
        </div>
      </li>;
    })}</ul>
  </section> : !townLoading && <p className="home-note home-note-callout">{copy.townEmpty(townName)}</p>);
  return <div className="page-stack home" lang={language}>
    <section className="home-hero">
      <div><h1>{copy.title}</h1><p>{copy.subtitle}</p></div>
      {newest && <ReportDatePill newest={newest} old={newestAge !== null && newestAge > 2}>
        <span>{copy.latestPill}: <strong>{dateText(newest, language)}</strong> · {ageText(newestAge ?? 0, language)}</span></ReportDatePill>}
    </section>

    {/* Variety and town share one row on wider screens and stack on phones. */}
    <div className="home-filters">
    <div className="home-variety">
    <div className="home-variety-label" id="home-variety-label">{copy.choose}</div>
    <div className="variety-cards" role="group" aria-labelledby="home-variety-label">
      {HOME_VARIETIES.map((item) => <button key={item.key} type="button" className="variety-card" aria-pressed={item.key === variety.key} onClick={() => choose(item.key)}>
        <span className="variety-card-photo"><img src={VARIETY_IMAGES[item.key]} alt="" width={480} height={320} loading="lazy" decoding="async" /></span>
        <span className="variety-card-name">{varietyName(item)}</span>
      </button>)}
      <label className={`variety-more${variety.everyday ? "" : " variety-more-active"}`}>
        <span className="sr-only">{copy.moreVarieties}</span>
        <span className="variety-more-face" aria-hidden="true">{variety.everyday ? copy.moreVarieties : varietyName(variety)}</span>
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
    {/* Phones get one dropdown instead of the picture pills, which take two rows there. CSS shows one or the other. */}
    <label className="variety-phone">
      <select aria-labelledby="home-variety-label" value={variety.key} onChange={(event) => choose(event.target.value)}>
        <optgroup label={copy.everyday}>{HOME_VARIETIES.map((item) => <option key={item.key} value={item.key}>{varietyName(item)}</option>)}</optgroup>
        {VARIETY_GROUPS.map((group) => {
          const items = VARIETIES.filter((item) => !item.everyday && item.group === group.key);
          return items.length ? <optgroup key={group.key} label={language === "kn" ? group.kn : group.en}>
            {items.map((item) => <option key={item.key} value={item.key}>{varietyName(item)}</option>)}
          </optgroup> : null;
        })}
      </select>
    </label>
    </div>
    {/* The town filter. "All towns" leaves the page as it always was; a town narrows every card below to that town. */}
    <div className="home-variety home-town">
      <label className="home-variety-label" htmlFor="home-town">{copy.chooseTown}</label>
      {/* A pill like the variety pills (filled once a town is chosen); the real dropdown sits invisibly on top of it. */}
      <div className="town-controls">
      <span className={`town-pill${town ? " town-pill-active" : ""}`}>
        <span className="town-pill-face" aria-hidden="true"><MapPin size={16} /><span className="town-pill-name">{town ? townName : copy.allTowns}</span><ChevronDown size={14} /></span>
        <select id="home-town" value={town?.slug ?? ""} onChange={(event) => chooseTown(event.target.value)}>
          <option value="">{copy.allTowns}</option>
          <TownOptions language={language} />
        </select>
      </span>
      {/* The way back, in plain sight: the dropdown's own "All towns" option is easy to miss. */}
      {town && <button type="button" className="town-clear" aria-label={copy.clearTownAria(townName)} onClick={() => chooseTown("")}>
        <X size={16} aria-hidden="true" /><span className="town-clear-text">{copy.allTowns}</span></button>}
      </div>
    </div>
    </div>
    {variety.note && <p className="home-note home-note-callout">{variety.note[language]}</p>}

    {town ? townGlance : glance.length > 0 && <section className="glance" aria-labelledby="glance-heading">
      <header className="glance-head"><h2 id="glance-heading">{copy.glanceTitle(varietyName(variety))}</h2><p>{copy.glanceHint}</p>
        {/* Phones: the summary is what most people forward, so it gets its own share at the top. Desktop shares per card. */}
        <span className="glance-share"><ShareButton labels={shareLabels} ariaLabel={copy.shareGlanceAria} title={copy.shareGlanceTitle(varietyName(variety))} message={() => shareMessage({
          title: copy.shareGlanceTitle(varietyName(variety)),
          // Each cooperative stays on its own line with its own date; their averages are never combined.
          lines: glance.map(({ source, latest, low, high }) => ({ place: source.en, price: low === high ? rupees(low) : `${rupees(low)} – ${rupees(high)}`, date: dateText(latest, language) })),
          more: copy.shareMore, note: copy.shareGlanceNote, url: varietyShareUrl(variety.key),
        })} /></span></header>
      {/* One tile per cooperative, never merged: each works out its average differently. */}
      <ul className="glance-tiles">{glance.map(({ source, latest, low, high, count, breadth }) => {
        const trend = breadth.median_percent === null ? null
          : breadth.up > breadth.down ? { text: copy.mostlyUp, className: "hold-up", Icon: ArrowUp }
          : breadth.down > breadth.up ? { text: copy.mostlyDown, className: "hold-down", Icon: ArrowDown }
          : { text: breadth.up ? copy.mixed : copy.unchanged, className: "", Icon: Minus };
        const age = ageDays(latest, today);
        return <li key={source.key} data-source={source.key} className="glance-tile">
          <div className="glance-tile-top">
            <a className="glance-source" href={`#rates-${source.key}`}>{source.en}</a>
            <span className={`glance-date${age > 2 ? " glance-date-old" : ""}`}>{dateText(latest, language)} · {ageText(age, language)}</span>
          </div>
          <p className="glance-range">
            <span><RollingNumber text={rupees(low)} /></span>
            {low !== high && <><span className="glance-dash" aria-hidden="true">–</span><span className="sr-only"> {copy.to} </span><span><RollingNumber text={rupees(high)} /></span></>}
            <small>{copy.perQuintal}</small>
          </p>
          {/* Phones: unit and branch count on one quiet line under the range, so neither wraps alone. */}
          <p className="glance-sub">{copy.perQuintalWord} · {copy.glanceBranches(count)}</p>
          <div className="glance-tile-foot">
            {trend ? <span className={`glance-trend ${trend.className}`}><trend.Icon size={14} aria-hidden="true" />{trend.text}{breadth.median_amount ? ` ${rupees(Math.abs(breadth.median_amount))}` : ""}<span className="sr-only"> ({signedPercent(breadth.median_percent!).replace("-", "−")})</span></span>
              : <span className="glance-trend" title={copy.noCompareHint}>{copy.noCompare}</span>}
            <span className="glance-branches">{copy.glanceBranches(count)}</span>
          </div>
        </li>;
      })}</ul>
    </section>}

    <nav className="home-sections" aria-label={language === "kn" ? "ದರಗಳ ವಿಭಾಗಗಳು" : "Price sections"}>
      {shownSources.map((source) => <a key={source.key} href={`#rates-${source.key}`}>{source.en}</a>)}
      {showTumcosCard && <a href="#rates-tumcos">TUMCOS</a>}
      {(!town || town.apmc) && <a href="#rates-official">APMC</a>}
    </nav>

    <section className="home-price-section" aria-labelledby="cooperative-prices-heading">
    <div className="home-section-heading"><h2 id="cooperative-prices-heading">{town ? copy.townCooperativeTitle(townName) : copy.cooperativeTitle}</h2><p>{town ? copy.townCooperativeHint : copy.cooperativeHint}</p></div>
    {town && !shownSources.length && <p className="home-note">{SOURCES.some((source) => town.branches[source.key]) ? copy.townNotThisVariety(townName) : copy.townNoCooperative(townName)}</p>}
    {/* Collapsed cards are stretched to one height so their footers line up; an expanded card would stretch the others too far. */}
    {/* An expanded card breaks out to the full width and lays its branches out in columns; the cards still compact share
        the row above or below it, so no empty space is left beside them. */}
    <div className={`rate-grid rate-grid-even${shownSources.some((source) => cards[source.key]) ? " rate-grid-expanded" : ""}`}
      style={{ "--rate-others": Math.max(1, shownSources.filter((source) => !cards[source.key]).length) } as CSSProperties}>
      {shownSources.map((source) => {
        const published = variety.labels[source.key]!;
        const sourceQueries = requests.flatMap((request, index) => request.source === source.key ? [queries[index]] : []);
        const { latest, rows } = orderRows(rowsFor(source.key));
        const sameDay = rows.filter((row) => row.reporting_date === latest);
        const history = historyFor(source.key);
        const breadth = marketBreadth(sameDay.map((row) => priceChange(row, history)));
        const townBranch = town?.branches[source.key]?.toUpperCase();
        const collapsed = collapsedRows(rows, townBranch ? [townBranch] : FEATURED_BRANCHES[source.key]);
        const branchMissing = Boolean(townBranch) && rows.length > 0 && !townBranchRow(source.key);
        return <section className={`rate-card rate-card-coop${cards[source.key] ? " rate-card-wide" : ""}`} data-source={source.key} key={source.key} aria-labelledby={`rates-${source.key}`}>
          <header className="rate-card-head">
            <div><h3 id={`rates-${source.key}`}>{language === "kn" ? source.kn : source.en}</h3>
              <span className="rate-card-basis">{copy.unitFoot}</span>
              {latest && <span className="rate-card-sub rate-card-latest">{copy.cardSub(dateText(latest, language), rows.length)}</span>}</div>
            {rows[0] && <a className="rate-source" href={rows[0].source_url} target="_blank" rel="noreferrer">{copy.source}<ExternalLink size={14} aria-hidden="true" /></a>}
          </header>
          {sourceQueries.some((query) => query.isPending) ? <SkeletonRows label={copy.loading} /> : <>
            {sourceQueries.some((query) => query.isError) && <ErrorState error={new Error(copy.failed)} retryLabel={copy.retry} onRetry={() => sourceQueries.filter((query) => query.isError).forEach((query) => void query.refetch())} />}
            {!rows.length && !sourceQueries.some((query) => query.isError) && <p className="rate-empty">{copy.noRows}</p>}
            {rows.length > 0 && <>
            {branchMissing && <p className="rate-card-note rate-card-note-top">{copy.branchMissing(townName)}</p>}
            {/* Up/down counts need two or more branches; with one, its own row already shows the change. */}
            {latest && breadth.median_percent !== null && sameDay.length > 1 && <div className="market-breadth" aria-label={copy.marketOn(dateText(latest, language))}>
              <span className="hold-up"><ArrowUp size={14} aria-hidden="true" /><b>{breadth.up}</b> {copy.up}</span>
              <span className="hold-down"><ArrowDown size={14} aria-hidden="true" /><b>{breadth.down}</b> {copy.down}</span>
              {breadth.flat > 0 && <span><Minus size={14} aria-hidden="true" /><b>{breadth.flat}</b> {copy.flat}</span>}
              <span className={`market-breadth-median ${breadth.median_percent > 0 ? "hold-up" : breadth.median_percent < 0 ? "hold-down" : ""}`}>{copy.typical} <b>{signedPercent(breadth.median_percent).replace("-", "−")}</b></span>
            </div>}
            <ul className="rate-list">{(cards[source.key] ? rows : collapsed).map((row) => <RateRow key={`${row.branch}|${varietyKey(row.variety)}`} reveal={reveal(source.key, row, collapsed)} row={row} today={today} language={language} showLabel
              highest={sameDay.length > 1 && row === sameDay[0]} change={priceChange(row, history)} sourceTag={source.en} priceKey={copy.rowKey} />)}</ul>
            {moreToggle(source.key, rows.length)}
            </>}
          </>}
          <footer className="rate-card-foot">
            {latest && <ShareButton labels={shareLabels} ariaLabel={copy.shareAria(source.en)} title={copy.shareTitle(varietyName(variety), source.en)} message={() => shareMessage({
              title: copy.shareTitle(varietyName(variety), language === "kn" ? source.kn : source.en), date: copy.shareReport(dateText(latest, language)),
              lines: sameDay.map((row) => ({ place: branchName(row.branch, language), price: rupees(row.average_price) })),
              more: copy.shareMore, note: copy.shareBasis, url: varietyShareUrl(variety.key),
            })} />}
            {/* Phones hide the header, so its source link moves down here. */}
            {rows[0] && <a className="rate-foot-source" href={rows[0].source_url} target="_blank" rel="noreferrer">{copy.source}<ExternalLink size={14} aria-hidden="true" /></a>}
            <Link to={`/prices?feed=${source.key}${published.length === 1 ? `&variety=${encodeURIComponent(published[0])}` : ""}`} aria-label={copy.moreFrom(source.en)}>{copy.explore} <ArrowRight size={14} aria-hidden="true" /></Link></footer>
        </section>;
      })}
    </div>
    {!town && notPublishing.length > 0 && <p className="home-note">{copy.notPublished(notPublishing.map((source) => source.en).join(language === "kn" ? " ಮತ್ತು " : " and "))}</p>}
    </section>

    {(!town || showTumcosCard || town.apmc) && <section className="home-price-section" aria-labelledby="other-prices-heading">
    <div className="home-section-heading"><h2 id="other-prices-heading">{copy.otherMarketsTitle}</h2>{showTumcosCard && <p>{copy.otherMarketsHint}</p>}</div>
    <div className="rate-grid rate-grid-even">
      {showTumcosCard && <section className="rate-card rate-card-coop" data-source="tumcos" aria-labelledby="rates-tumcos">
        <header className="rate-card-head">
          <div><h3 id="rates-tumcos">TUMCOS</h3><span className="rate-card-basis">{copy.unitFoot}</span><span className="rate-card-sub">{copy.tumcosSub}</span></div>
          {tumcos[0] && <a className="rate-source" href={tumcos[0].source_url} target="_blank" rel="noreferrer">{copy.source}<ExternalLink size={14} aria-hidden="true" /></a>}
        </header>
        {tumcosQuery?.isPending ? <SkeletonRows label={copy.loading} rows={1} /> : tumcosQuery?.isError ? <ErrorState error={new Error(copy.failed)} retryLabel={copy.retry} onRetry={() => void tumcosQuery.refetch()} /> : tumcos.length ? <ul className="rate-list">{tumcos.map((row) => <RateRow key={row.branch} row={row} today={today} language={language} showLabel highest={false} change={priceChange(row, tumcosHistory)}
          label={copy.tumcosLabel} sourceTag="TUMCOS" priceKey={copy.rowKey} />)}</ul> : <p className="rate-empty">{copy.tumcosEmpty}</p>}
        <footer className="rate-card-foot">{tumcos[0] && <ShareButton labels={shareLabels} ariaLabel={copy.shareAria("TUMCOS")} title={copy.shareTumcosTitle} message={() => shareMessage({
          title: copy.shareTumcosTitle, date: copy.shareReport(dateText(tumcos[0].reporting_date, language)),
          lines: tumcos.map((row) => ({ place: branchName(row.branch, language), price: rupees(row.average_price) })),
          more: copy.shareMore, note: copy.shareTumcosNote, url: varietyShareUrl(variety.key),
        })} />}{tumcos[0] && <a className="rate-foot-source" href={tumcos[0].source_url} target="_blank" rel="noreferrer">{copy.source}<ExternalLink size={14} aria-hidden="true" /></a>}
          <Link to="/prices?feed=tumcos" aria-label={copy.moreFrom("TUMCOS")}>{copy.explore} <ArrowRight size={14} aria-hidden="true" /></Link></footer>
      </section>}

    {town ? town.apmc && <TownApmcCard title={copy.townApmcTitle(townName)} rows={townApmcMatched.length ? townApmcMatched : townApmcLatest} matched={townApmcMatched.length > 0}
      loading={markets.isPending || (Boolean(townMarketId) && townApmc.isPending)} failed={markets.isError || townApmc.isError} onRetry={() => { void markets.refetch(); void townApmc.refetch(); }}
      today={today} language={language} shareLabels={shareLabels} shareUrl={() => varietyShareUrl(variety.key, town.slug)} /> : <section className="rate-card" data-source="apmc" aria-labelledby="rates-official">
      <header className="rate-card-head"><div><h3 id="rates-official">{copy.officialRates}</h3><span className="rate-card-basis">{copy.officialSub}</span></div></header>
      {official.isPending ? <SkeletonRows label={copy.loading} rows={1} /> : official.isError ? <ErrorState error={new Error(copy.failed)} retryLabel={copy.retry} onRetry={() => void official.refetch()} /> : !apmcRow ? <p className="rate-empty">{copy.officialEmpty}</p> :
        <><ul className="rate-list">{[apmcRow].map((row) => <li className="rate-row" key={row.id}>
          <div className="rate-place"><strong>{row.market_name}</strong><span className="rate-meta"><span>{row.district} · {dateText(row.reporting_date, language)} · {ageText(ageDays(row.reporting_date, today), language)}</span><span className="rate-label" lang="en">{row.variety_name}{row.grade ? ` · ${copy.grade}: ${row.grade}` : ""}<span className="rate-label-source"> · {row.source_name}</span></span></span></div>
          <div className="rate-price"><strong><RollingNumber text={rupees(row.modal_price)} /></strong></div>
        </li>)}</ul>
        <Link className="rate-more-toggle" to="/prices?feed=official">{copy.officialOthers}<ArrowRight size={16} aria-hidden="true" /></Link></>}
      <footer className="rate-card-foot">{apmcRow ? <ShareButton labels={shareLabels} ariaLabel={copy.shareAria("APMC")} title={copy.shareOfficialTitle} message={() => shareMessage({
        title: copy.shareOfficialTitle,
        date: copy.shareReport(dateText(apmcRow.reporting_date, language)),
        lines: apmcDay.map((row) => ({ place: `${row.market_name} · ${row.variety_name}`, price: rupees(row.modal_price) })),
        more: copy.shareOfficialMore, note: copy.shareOfficialNote, url: shareUrl("/prices?feed=official"),
      })} /> : null}<Link to="/prices?feed=official" aria-label={copy.officialMore}>{copy.explore} <ArrowRight size={14} aria-hidden="true" /></Link></footer>
    </section>}
    </div>
    </section>}

    <section className="home-price-section" aria-labelledby="home-tools-heading">
    <div className="home-section-heading"><h2 id="home-tools-heading">{copy.otherTools}</h2></div>
    <nav className="home-actions" aria-label={copy.otherTools}>
      <Link to="/sell-or-hold"><strong>{copy.sellOrHold}</strong><span>{copy.sellOrHoldHint}</span><ArrowRight size={18} aria-hidden="true" /></Link>
      <Link to="/monthly-trends?series=long"><strong>{copy.longHistory}</strong><span>{copy.longHistoryHint}</span><ArrowRight size={18} aria-hidden="true" /></Link>
      <Link to="/assistant"><strong>{copy.ask}</strong><span>{copy.askHint}</span><ArrowRight size={18} aria-hidden="true" /></Link>
    </nav>
    </section>

    <AboutData title={copy.about}>
      <p>{copy.notComparable}</p>
      <p>{copy.changeNote}</p>
      <p>{copy.tumcosNote}</p>
    </AboutData>
  </div>;
}

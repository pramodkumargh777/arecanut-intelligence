import { useQuery } from "@tanstack/react-query";
import { CalendarRange } from "lucide-react";
import { useState } from "react";
import { calendarTodayIST, formatCalendarMonth, formatPeriodKannada, MONTH_NAMES_EN, MONTH_NAMES_KN, shiftCalendarMonth } from "../../../shared/dates";
import { HOLD_HORIZONS, holdBreakEvenPercent, holdHistory, MIN_HOLD_YEARS, seasonalPattern } from "../../../shared/hold-history";
import { ErrorState, LoadingState } from "../components/State";
import { HoldOutcomeChart } from "../components/HoldOutcomeChart";
import { usePhone } from "../components/usePhone";
import { api } from "../services/api";
import { isLongBasis, LONG_HISTORY_FROM } from "../services/intelligence";
import { defineCopy, type Language, useLanguage } from "../services/language";

/** Common trade names first. Everything else the source reports follows, under its own name. */
const COMMON_VARIETIES: { name: string; kn: string }[] = [
  { name: "Rashi", kn: "ರಾಶಿ" }, { name: "Chali", kn: "ಚಾಲಿ" }, { name: "Hosa Chali", kn: "ಹೊಸ ಚಾಲಿ" }, { name: "Hale Chali", kn: "ಹಳೆ ಚಾಲಿ" },
  { name: "Bette", kn: "ಬೆಟ್ಟೆ" }, { name: "Gorabalu", kn: "ಗೊರಬಲು" }, { name: "Bilegotu", kn: "ಬಿಳೇಗೋಟು" }, { name: "Kempugotu", kn: "ಕೆಂಪುಗೋಟು" },
  { name: "Saraku", kn: "ಸರಕು" }, { name: "Sippegotu", kn: "ಸಿಪ್ಪೆಗೋಟು" },
];

/** Display names for other source labels, where the source's own spelling reads poorly. The source name stays the value. */
const OTHER_NAMES: Record<string, { en: string; kn: string }> = { api: { en: "Api", kn: "ಅಪಿ" }, Churu: { en: "Churu", kn: "ಚೂರು" } };

/** Husk is a by-product, not a nut grade, so its price says nothing about when to sell nuts. */
const NOT_NUT_GRADES = new Set(["Arecanut-Husk"]);

/** Enough history for at least some months to clear the minimum years; fewer would only ever show "not enough data". */
const MIN_LISTED_MONTHS = 24;
const hasHistory = (coverage: { months: number; years: number }) => coverage.years >= MIN_HOLD_YEARS && coverage.months >= MIN_LISTED_MONTHS;

/** A starting point for the reader to change. Weight loss and storage start at zero because they differ too much to guess. */
const DEFAULT_INTEREST_PERCENT = 10;

const COPY = defineCopy({
  kn: {
    title: "ಈಗ ಮಾರಬೇಕೇ, ಕಾಯಬೇಕೇ?",
    intro: "ಹಿಂದಿನ ವರ್ಷಗಳಲ್ಲಿ ಈ ತಿಂಗಳ ನಂತರ ದರ ಏನಾಯಿತು ಎಂಬುದನ್ನು ಇಲ್ಲಿ ನೋಡಿ. ಇದು ಮುನ್ಸೂಚನೆ ಅಥವಾ ಸಲಹೆ ಅಲ್ಲ; ಮುಂದೆ ಏನಾಗುತ್ತದೆ ಎಂದು ಯಾರಿಗೂ ಖಚಿತವಾಗಿ ಹೇಳಲಾಗದು.",
    variety: "ತಳಿ", month: "ಮಾರಾಟದ ತಿಂಗಳು", costsToggle: "ನಿಮ್ಮ ಖರ್ಚು ಬದಲಿಸಿ",
    costsNow: (interest: string, loss: string, storage: string) => `ಬಡ್ಡಿ ${interest}% · ತೂಕ ನಷ್ಟ ${loss}% · ಸಂಗ್ರಹ ₹${storage}`, commonGrades: "ಸಾಮಾನ್ಯ ದರ್ಜೆಗಳು", otherGrades: "ಇತರ AGMARKNET ದರ್ಜೆಗಳು",
    hidden: (count: number) => `${MIN_HOLD_YEARS} ವರ್ಷಕ್ಕಿಂತ ಕಡಿಮೆ ದರ ಇರುವ ${count} ದರ್ಜೆಗಳನ್ನು ಪಟ್ಟಿಯಲ್ಲಿ ತೋರಿಸಿಲ್ಲ.`,
    costsTitle: "ಕಾಯುವುದಕ್ಕೆ ನಿಮ್ಮ ಖರ್ಚು",
    costsHint: "ಇವು ನಿಮ್ಮ ಸಂಖ್ಯೆಗಳು. ಬಡ್ಡಿಯ ಆರಂಭಿಕ ಸಂಖ್ಯೆ ಕೇವಲ ಉದಾಹರಣೆ; ನಿಮ್ಮದಕ್ಕೆ ಬದಲಿಸಿ.",
    interest: "ವಾರ್ಷಿಕ ಬಡ್ಡಿ (%)", weightLoss: "ಸಂಗ್ರಹದಲ್ಲಿ ತೂಕ ನಷ್ಟ (%)", storage: "ಸಂಗ್ರಹ ಖರ್ಚು (₹/ಕ್ವಿಂಟಾಲ್/ತಿಂಗಳು)",
    summaryTitle: (month: string) => `${month} ತಿಂಗಳಿನಿಂದ ಕಾದಿದ್ದರೆ`,
    summaryNote: "ಕರ್ನಾಟಕದ ತಿಂಗಳ ಸರಾಸರಿ ದರ (AGMARKNET). ನಿಮ್ಮ ಶಾಖೆಯ ದರ ಬೇರೆ ಇರಬಹುದು.",
    wait: "ಕಾದ ಅವಧಿ", months: (n: number) => `${n} ತಿಂಗಳು`, rose: "ದರ ಏರಿದ ವರ್ಷಗಳು", typical: "ಮಧ್ಯಮ ಬದಲಾವಣೆ", range: "ಕನಿಷ್ಠ / ಗರಿಷ್ಠ",
    needed: "ಖರ್ಚು ಸರಿದೂಗಲು ಬೇಕಾದ ಏರಿಕೆ", covered: "ಖರ್ಚು ಸರಿದೂಗಿದ ವರ್ಷಗಳು",
    ofYears: (count: number, years: number) => `${years} ರಲ್ಲಿ ${count}`, roseIn: (count: number, years: number) => `${years} ವರ್ಷಗಳಲ್ಲಿ ${count} ಬಾರಿ ಏರಿಕೆ`,
    mediansTitle: "ಕಾದ ಅವಧಿಯ ಪ್ರಕಾರ ಮಧ್ಯಮ ಬದಲಾವಣೆ", notEnough: `${MIN_HOLD_YEARS} ವರ್ಷಗಳಿಗಿಂತ ಕಡಿಮೆ ದತ್ತಾಂಶ`,
    yearsTitle: "ವರ್ಷವಾರು ವಿವರ", start: "ಆರಂಭ ದರ", startMonth: "ಆರಂಭ",
    chartNote: "ಪ್ರತಿ ಚುಕ್ಕೆ ಒಂದು ಹಿಂದಿನ ವರ್ಷ. ಗೆರೆ ನಿಮ್ಮ ಖರ್ಚು ಸರಿದೂಗಲು ಬೇಕಾದ ಏರಿಕೆ; ಗೆರೆಯ ಮೇಲಿನ ಹಸಿರು ಚುಕ್ಕೆಗಳು ಕಾಯುವುದು ಲಾಭವಾದ ವರ್ಷಗಳು.",
    paid: "ಖರ್ಚು ಸರಿದೂಗಿತು", notPaid: "ಖರ್ಚು ಸರಿದೂಗಲಿಲ್ಲ", needsLine: (p: number) => `ಬೇಕು ${p > 0 ? "+" : ""}${p}%`,
    paidOf: (count: number, years: number) => `${years} ರಲ್ಲಿ ${count} ವರ್ಷ ಲಾಭ`,
    chartDescription: (month: string) => `${month} ತಿಂಗಳಿನಿಂದ 1–6 ತಿಂಗಳು ಕಾದಿದ್ದರೆ ಪ್ರತಿ ಹಿಂದಿನ ವರ್ಷದ ದರ ಬದಲಾವಣೆ, ಖರ್ಚು ಸರಿದೂಗಲು ಬೇಕಾದ ಏರಿಕೆಯೊಂದಿಗೆ`,
    legendPaid: "ಖರ್ಚು ಸರಿದೂಗಿದ ವರ್ಷ", legendNotPaid: "ಸರಿದೂಗದ ವರ್ಷ", legendNeeded: "ನಿಮ್ಮ ಖರ್ಚು ಸರಿದೂಗಲು ಬೇಕಾದ ಏರಿಕೆ", legendZone: "ಕಾಯುವುದು ಲಾಭವಾಗುವ ವಲಯ",
    // Phone versions: the legend and column labels carry what the long chart note explains.
    legendShort: { paid: "ಲಾಭ", notPaid: "ಲಾಭವಿಲ್ಲ", needed: "ಖರ್ಚಿನ ಗೆರೆ" },
    monthsShort: (n: number) => `${n} ತಿಂ.`, needsShort: (p: number) => `${p > 0 ? "+" : ""}${p}%`, paidOfShort: (count: number, years: number) => `${count}/${years}`,
    summaryNoteLongShort: (since: number) => `${since}ರಿಂದ: ಎಪಿಎಂಸಿ ಮಧ್ಯಮ ದರ (AGMARKNET). ನಿಮ್ಮ ಶಾಖೆಯ ದರ ಬೇರೆ ಇರಬಹುದು.`,
    details: "ವಿವರಗಳು", detailsHint: "ವರ್ಷವಾರು ಪಟ್ಟಿ ಮತ್ತು ಮಧ್ಯಮ ಬದಲಾವಣೆ",
    scrollHint: "ಎಲ್ಲಾ ತಿಂಗಳ ವಿವರ ನೋಡಲು ಅಡ್ಡವಾಗಿ ಸ್ವೈಪ್ ಮಾಡಿ.",
    excluded: (months: string) => `ಬಿಟ್ಟಿರುವ ತಿಂಗಳು: ${months}. ಈ ತಿಂಗಳಲ್ಲಿ ದರ 20% ಕ್ಕಿಂತ ಹೆಚ್ಚು ಬದಲಾಗಿ ಮುಂದಿನ ತಿಂಗಳು ಮರಳಿ ಬಂದಿದೆ; ಇದು ದತ್ತಾಂಶದ ದೋಷ ಇರಬಹುದು.`,
    latestPrice: (price: string, month: string) => `ಇತ್ತೀಚಿನ ರಾಜ್ಯ ಸರಾಸರಿ: ${price}/ಕ್ವಿಂಟಾಲ್ (${month})`,
    caveat: "ಕೆಲವೇ ವರ್ಷಗಳ ದತ್ತಾಂಶ ಇದೆ. ಹಿಂದೆ ಆದದ್ದು ಈ ವರ್ಷವೂ ಆಗುತ್ತದೆ ಎಂದು ಹೇಳಲಾಗದು. ಮಾರಾಟದ ನಿರ್ಧಾರ ನಿಮ್ಮದು.",
    noData: "ಈ ತಳಿ ಮತ್ತು ತಿಂಗಳಿಗೆ ಸಾಕಷ್ಟು ದತ್ತಾಂಶ ಇಲ್ಲ.",
    loading: "ಹಿಂದಿನ ದರಗಳನ್ನು ತರಲಾಗುತ್ತಿದೆ",
    source: "ಮೂಲ: AGMARKNET ತಿಂಗಳ ವರದಿಗಳು",
    summaryNoteLong: (since: number) => `${since}ರಿಂದ, ಕರ್ನಾಟಕದ ಎಪಿಎಂಸಿಗಳ ದೈನಂದಿನ ಮಾದರಿ ದರದ ಮಧ್ಯಮ ಮೌಲ್ಯ (AGMARKNET ದೈನಂದಿನ). ಈ ತಳಿಗೆ ಇದು ತಿಂಗಳ ವರದಿಗೆ ಹತ್ತಿರವಾಗಿದೆ, ಆದರೆ ಅದೇ ಅಳತೆ ಅಲ್ಲ. ನಿಮ್ಮ ಶಾಖೆಯ ದರ ಬೇರೆ ಇರಬಹುದು.`,
    latestPriceLong: (price: string, month: string) => `ಇತ್ತೀಚಿನ ಎಪಿಎಂಸಿ ಮಧ್ಯಮ ದರ: ${price}/ಕ್ವಿಂಟಾಲ್ (${month})`,
    caveatLong: (years: number) => `${years} ವರ್ಷಗಳ ದತ್ತಾಂಶ ಇದೆ. ಹಿಂದೆ ಆದದ್ದು ಈ ವರ್ಷವೂ ಆಗುತ್ತದೆ ಎಂದು ಹೇಳಲಾಗದು. ಮಾರಾಟದ ನಿರ್ಧಾರ ನಿಮ್ಮದು.`,
    sourceLong: "ಮೂಲ: AGMARKNET ದೈನಂದಿನ ಎಪಿಎಂಸಿ ದರಗಳು (data.gov.in)",
    season: (since: number, name: string, high: string, low: string, spread: number, consistent: number, years: number) =>
      `${since}ರಿಂದ ${name} ದರ ಸಾಮಾನ್ಯವಾಗಿ ${high} ತಿಂಗಳಲ್ಲಿ ಹೆಚ್ಚು, ${low} ತಿಂಗಳಲ್ಲಿ ಕಡಿಮೆ ಇದೆ; ಸುಮಾರು ${spread}% ಅಂತರ (${years} ರಲ್ಲಿ ${consistent} ವರ್ಷ).`,
    noSeason: (since: number, name: string) => `${since}ರಿಂದ ${name} ದರದಲ್ಲಿ ಸ್ಪಷ್ಟ ಏರಿಕೆ ಅಥವಾ ಇಳಿಕೆಯ ಕಾಲ ಕಂಡುಬಂದಿಲ್ಲ.`,
  },
  en: {
    title: "Sell now or wait?",
    intro: "See what the price did after this month in past years. This is neither a forecast nor advice; nobody can say for certain what happens next.",
    variety: "Variety", month: "Month you would sell", costsToggle: "Change your costs",
    costsNow: (interest: string, loss: string, storage: string) => `Interest ${interest}% · weight loss ${loss}% · storage ₹${storage}`, commonGrades: "Common grades", otherGrades: "Other AGMARKNET grades",
    hidden: (count: number) => `${count} grade${count === 1 ? " is" : "s are"} not listed because ${count === 1 ? "it has" : "they have"} under ${MIN_HOLD_YEARS} years of prices.`,
    costsTitle: "Your cost of waiting",
    costsHint: "These are your numbers. The interest figure is only a starting example; change it to yours.",
    interest: "Annual interest (%)", weightLoss: "Weight lost in storage (%)", storage: "Storage cost (₹/quintal/month)",
    summaryTitle: (month: string) => `If you had waited from ${month}`,
    summaryNote: "Karnataka monthly average price (AGMARKNET). Your branch's rate can differ.",
    wait: "Waited", months: (n: number) => `${n} month${n === 1 ? "" : "s"}`, rose: "Years the price rose", typical: "Median change", range: "Lowest / highest",
    needed: "Rise needed to cover costs", covered: "Years that covered costs",
    ofYears: (count: number, years: number) => `${count} of ${years}`, roseIn: (count: number, years: number) => `Rose in ${count} of ${years} years`,
    mediansTitle: "Median change by waiting period", notEnough: `Under ${MIN_HOLD_YEARS} years of data`,
    yearsTitle: "Year by year", start: "Starting price", startMonth: "From",
    chartNote: "Each dot is one past year. The line is the rise you need to cover your costs; green dots above it are the years waiting paid off.",
    paid: "covered costs", notPaid: "did not cover costs", needsLine: (p: number) => `needs ${p > 0 ? "+" : ""}${p}%`,
    paidOf: (count: number, years: number) => `paid off ${count} of ${years}`,
    chartDescription: (month: string) => `Price change in each past year after waiting 1 to 6 months from ${month}, against the rise needed to cover your costs`,
    legendPaid: "Year waiting paid off", legendNotPaid: "Year it did not", legendNeeded: "Rise needed to cover your costs", legendZone: "Where waiting pays off",
    // Phone versions: the legend and column labels carry what the long chart note explains.
    legendShort: { paid: "Paid off", notPaid: "Did not", needed: "Cost line" },
    monthsShort: (n: number) => `${n} mo`, needsShort: (p: number) => `${p > 0 ? "+" : ""}${p}%`, paidOfShort: (count: number, years: number) => `${count}/${years}`,
    summaryNoteLongShort: (since: number) => `Since ${since}: median APMC price (AGMARKNET). Your branch's rate can differ.`,
    details: "Details", detailsHint: "Year-by-year table and median changes",
    scrollHint: "Swipe sideways to see all months.",
    excluded: (months: string) => `Left out: ${months}. The price moved more than 20% that month and came straight back the next, which may be a data problem.`,
    latestPrice: (price: string, month: string) => `Latest state average: ${price}/quintal (${month})`,
    caveat: "These are only a few years of data. What happened before may not happen this year. The decision to sell is yours.",
    noData: "Not enough data for this variety and month.",
    loading: "Loading past prices",
    source: "Source: AGMARKNET monthly reports",
    summaryNoteLong: (since: number) => `Since ${since}: the median of Karnataka APMCs' daily modal prices (AGMARKNET daily). For this variety it follows the monthly report closely, but it is not the same measure. Your branch's rate can differ.`,
    latestPriceLong: (price: string, month: string) => `Latest APMC median: ${price}/quintal (${month})`,
    caveatLong: (years: number) => `This is ${years} years of data. What happened before may not happen this year. The decision to sell is yours.`,
    sourceLong: "Source: AGMARKNET daily APMC prices (data.gov.in)",
    season: (since: number, name: string, high: string, low: string, spread: number, consistent: number, years: number) =>
      `Since ${since}, ${name} has usually been highest in ${high} and lowest in ${low}, about ${spread}% apart (${consistent} of ${years} years).`,
    noSeason: (since: number, name: string) => `Since ${since}, ${name} has shown no clear high or low season.`,
  },
});

const monthText = (month: string, language: Language) => language === "kn" ? formatPeriodKannada(month) : formatCalendarMonth(month);
const signed = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${value}%`;
const tone = (value: number | null) => value === null || value === 0 ? "" : value > 0 ? "hold-up" : "hold-down";
const rupees = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;

export function SellOrHoldPage() {
  const { language } = useLanguage();
  const copy = COPY[language];
  const today = calendarTodayIST();
  const lastCompleted = shiftCalendarMonth(today.slice(0, 7), -1);
  const [variety, setVariety] = useState("Rashi");
  const [startMonth, setStartMonth] = useState(Number(today.slice(5, 7)));
  const [interest, setInterest] = useState(String(DEFAULT_INTEREST_PERCENT));
  const [weightLoss, setWeightLoss] = useState("0");
  const [storage, setStorage] = useState("0");
  // The longest history for each variety: from 2014 where the daily-price series tracks the report, else the report.
  const query = useQuery({ queryKey: ["sell-or-hold", variety, lastCompleted, "long"], queryFn: () => api.monthlyHistory(LONG_HISTORY_FROM, lastCompleted, variety, "long") });
  const data = query.data;
  const long = isLongBasis(data);
  const history = data ? holdHistory(data.points, startMonth) : null;
  const observed = (data?.points ?? []).filter((point) => point.weighted_price !== null);
  const latest = observed.at(-1);
  const costs = { annualInterestPercent: Number(interest || 0), weightLossPercent: Number(weightLoss || 0), storagePerQuintalPerMonth: Number(storage || 0) };
  const breakEven = (months: number) => latest?.weighted_price ? holdBreakEvenPercent(months, latest.weighted_price, costs) : null;
  // Older API responses carry no coverage; then every variety is listed, as before.
  const listed = data?.variety_coverage ? data.variety_coverage.filter(hasHistory).map((item) => item.variety) : data?.varieties ?? [];
  const usable = listed.filter((name) => !NOT_NUT_GRADES.has(name) || name === variety);
  const hiddenCount = data?.variety_coverage ? data.varieties.length - usable.length : 0;
  const common = COMMON_VARIETIES.filter((item) => !data || usable.includes(item.name) || item.name === variety);
  const others = usable.filter((name) => !COMMON_VARIETIES.some((item) => item.name === name))
    .sort((a, b) => (OTHER_NAMES[a]?.en ?? a).localeCompare(OTHER_NAMES[b]?.en ?? b));
  const otherName = (name: string) => OTHER_NAMES[name]?.[language] ?? name;
  const varietyName = language === "kn" ? COMMON_VARIETIES.find((item) => item.name === variety)?.kn ?? otherName(variety) : otherName(variety);
  // One sentence on the usual high and low months, from past years only; it does not depend on the month chosen.
  const season = data ? seasonalPattern(data.points) : null;
  const monthNames = language === "kn" ? MONTH_NAMES_KN : MONTH_NAMES_EN;
  // Word joiners keep a pair such as "Feb–Mar" on one line.
  const monthPair = ([a, b]: [number, number]) => language === "kn" ? `${MONTH_NAMES_KN[a - 1]}\u2060–\u2060${MONTH_NAMES_KN[b - 1]}` : `${MONTH_NAMES_EN[a - 1].slice(0, 3)}\u2060–\u2060${MONTH_NAMES_EN[b - 1].slice(0, 3)}`;
  // Phones show the key waiting periods and fold the cost inputs and year table away; both stay one tap from view.
  const phone = usePhone();
  const latestText = latest?.weighted_price ? (long ? copy.latestPriceLong : copy.latestPrice)(rupees(latest.weighted_price), monthText(latest.reporting_month, language)) : "";
  const since = Number((observed[0]?.reporting_month ?? data?.from ?? "2021").slice(0, 4));
  const costInputs = <>
      <label className="filter-control"><span>{copy.interest}</span><input type="number" inputMode="decimal" min={0} max={100} step="any" value={interest} onChange={(event) => setInterest(event.target.value)} /></label>
      <label className="filter-control"><span>{copy.weightLoss}</span><input type="number" inputMode="decimal" min={0} max={99} step="any" value={weightLoss} onChange={(event) => setWeightLoss(event.target.value)} /></label>
      <label className="filter-control"><span>{copy.storage}</span><input type="number" inputMode="decimal" min={0} step="any" value={storage} onChange={(event) => setStorage(event.target.value)} /></label>
  </>;
  return <div className="page-stack home" lang={language}>
    {/* The intro hides on phones (.page-intro); the caveat at the bottom still says this is not advice. */}
    <section className="home-heading"><h1>{copy.title}</h1><p className="page-intro">{copy.intro}</p></section>

    {/* Every input in one place: what to look at, and the reader's own cost of waiting. */}
    <section className="rate-card hold-settings" aria-label={copy.costsTitle}>
      <div className="hold-controls">
      <label className="filter-control"><span>{copy.variety}</span><select value={variety} onChange={(event) => setVariety(event.target.value)}>
        <optgroup label={copy.commonGrades}>{common.map((item) => <option key={item.name} value={item.name}>{language === "kn" ? item.kn : item.name}</option>)}</optgroup>
        {others.length > 0 && <optgroup label={copy.otherGrades}>{others.map((name) => <option key={name} value={name}>{otherName(name)}</option>)}</optgroup>}
      </select></label>
      <label className="filter-control"><span>{copy.month}</span><select value={startMonth} onChange={(event) => setStartMonth(Number(event.target.value))}>
        {monthNames.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
      </select></label>
      {/* Costs fold away on every screen; the summary line always shows the figures in use. */}
      <details className="hold-costs">
        <summary><span><strong>{copy.costsToggle}</strong><small>{copy.costsNow(interest || "0", weightLoss || "0", storage || "0")}</small></span></summary>
        <div className="hold-costs-body">{costInputs}<p className="rate-caption">{copy.costsHint}</p></div>
      </details>
      </div>
      <p className="rate-caption">{phone ? latestText && `${latestText}.` : <>{hiddenCount > 0 ? `${copy.hidden(hiddenCount)} ` : ""}{latestText ? `${latestText}.` : ""}</>}</p>
    </section>

    {query.isLoading ? <LoadingState label={copy.loading} /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : !history?.years.length ? <p className="rate-empty">{copy.noData}</p> : <>
      {season && <p className="hold-season"><CalendarRange size={18} aria-hidden="true" /><span>{season.high && season.low
        ? copy.season(season.first_year, varietyName, monthPair(season.high), monthPair(season.low), season.spread_percent, season.consistent_years, season.years)
        : copy.noSeason(season.first_year, varietyName)}</span></p>}
      <section className="rate-card hold-outcomes" aria-labelledby="hold-summary">
        <header><h2 id="hold-summary">{copy.summaryTitle(monthNames[startMonth - 1])}</h2></header>
        <p className="rate-caption"><span className="label-full">{copy.chartNote} {long ? copy.summaryNoteLong(since) : copy.summaryNote}</span>
          <span className="label-short" aria-hidden="true">{long ? copy.summaryNoteLongShort(since) : copy.summaryNote}</span></p>
        <HoldOutcomeChart years={history.years} monthLabel={(month) => monthText(month, language)} description={copy.chartDescription(monthNames[startMonth - 1])}
          neededLabel={copy.needsLine} neededShort={copy.needsShort} paidLabel={copy.paid} notPaidLabel={copy.notPaid}
          legend={{ paid: copy.legendPaid, notPaid: copy.legendNotPaid, needed: copy.legendNeeded, zone: copy.legendZone }} legendShort={copy.legendShort}
          columns={HOLD_HORIZONS.map((months) => {
            const summary = history.summaries.find((item) => item.months === months)!;
            const needed = breakEven(months);
            const values = history.years.flatMap((year) => year.changes.filter((change) => change.months === months && change.percent !== null && !change.excluded).map((change) => change.percent!));
            const paidYears = needed === null ? 0 : values.filter((value) => value >= needed).length;
            const covered = needed === null || summary.median_percent === null ? null : copy.paidOf(paidYears, values.length);
            const coveredShort = needed === null || summary.median_percent === null ? null : copy.paidOfShort(paidYears, values.length);
            return { months, label: copy.months(months), shortLabel: copy.monthsShort(months), needed, covered, coveredShort };
          })} />
      </section>

      {(() => {
        const yearsBody = <>
        <p id="hold-years-scroll-hint" className="table-scroll-hint">{copy.scrollHint}</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="hold-years" aria-describedby="hold-years-scroll-hint"><table className="hold-years-table">
          <thead><tr><th scope="col">{copy.startMonth}</th><th scope="col" className="numeric">{copy.start}</th>{HOLD_HORIZONS.map((months) => <th scope="col" className="numeric" key={months}>{copy.months(months)}</th>)}</tr></thead>
          <tbody>{history.years.map((year) => <tr key={year.start_month}>
            <td>{monthText(year.start_month, language)}</td><td className="numeric">{rupees(year.start_price)}</td>
            {year.changes.map((change) => <td key={change.months} className={`numeric ${tone(change.percent)}`}>{change.excluded ? "*" : signed(change.percent)}</td>)}
          </tr>)}</tbody>
        </table></div>
        {history.excluded_months.length > 0 && <p className="rate-caption">* {copy.excluded(history.excluded_months.map((month) => monthText(month, language)).join(", "))}</p>}
        </>;
        // The year table is the full record behind the chart, folded under "Details" on every screen.
        return <details className="rate-card hold-fold"><summary><span><strong id="hold-years">{copy.details}</strong><small>{copy.detailsHint}</small></span></summary>
          {/* "Median change" is said once above the cards rather than inside each, so a card is the period and its
              median on one line with the count of rising years under it. */}
          <p className="hold-medians-title">{copy.mediansTitle}</p>
          <ul className="hold-medians">{HOLD_HORIZONS.map((months) => {
            const summary = history.summaries.find((item) => item.months === months)!;
            return <li key={months}><span>{copy.months(months)}</span><b className={tone(summary.median_percent)}>{signed(summary.median_percent)}</b>
              <small>{copy.roseIn(summary.rose, summary.years)}</small></li>;
          })}</ul>
          {yearsBody}</details>;
      })()}

      <p className="home-note">{long ? copy.caveatLong(Number(lastCompleted.slice(0, 4)) - since + 1) : copy.caveat} {long ? copy.sourceLong : copy.source}.{phone && hiddenCount > 0 ? ` ${copy.hidden(hiddenCount)}` : ""}</p>
    </>}
  </div>;
}

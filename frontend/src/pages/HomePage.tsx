import { useQueries } from "@tanstack/react-query";
import { ArrowDown, ArrowRight, ArrowUp, ExternalLink, Minus } from "lucide-react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { calendarDateToTime, calendarTodayIST, DAY_MS, formatCalendarDate, formatPeriodKannada } from "../../../shared/dates";
import { DEFAULT_COMMODITY } from "../../../shared/commodities";
import { marketBreadth, MAX_CHANGE_GAP_DAYS, priceChange, varietyKey, type PriceChange } from "../../../shared/price-change";
import { ErrorState, LoadingState } from "../components/State";
import { api } from "../services/api";
import { useCommodity } from "../services/commodity";
import type { CooperativeQuote, CooperativeSource } from "../services/cooperative";
import { ageText, useLanguage, type Language } from "../services/language";

/** A grower's word for a variety and the label each cooperative publishes it under. Labels stay visible on every row. */
const VARIETIES: { key: string; kn: string; en: string; labels: Partial<Record<CooperativeSource, string[]>> }[] = [
  { key: "rashi", kn: "ರಾಶಿ", en: "Rashi", labels: { mamcos: ["RASHI EDI"], tss: ["RASHI"] } },
  { key: "new-rashi", kn: "ಹೊಸ ರಾಶಿ", en: "New Rashi", labels: { mamcos: ["NEW RASHIEDI", "NEWRASHIEDI"] } },
  { key: "chali", kn: "ಚಾಲಿ", en: "Chali", labels: { mamcos: ["CHALI"], tss: ["CHALI"] } },
  { key: "bette", kn: "ಬೆಟ್ಟೆ", en: "Bette", labels: { mamcos: ["BETTE"], tss: ["BETTE"] } },
  { key: "gorabalu", kn: "ಗೊರಬಲು", en: "Gorabalu", labels: { mamcos: ["GORABALU"] } },
];

const SOURCES: { key: CooperativeSource; kn: string; en: string; assumedUnit: boolean }[] = [
  { key: "mamcos", kn: "ಮ್ಯಾಮ್ಕೋಸ್ (MAMCOS)", en: "MAMCOS", assumedUnit: false },
  { key: "tss", kn: "ಟಿಎಸ್ಎಸ್ (TSS)", en: "TSS", assumedUnit: true },
];

const BRANCH_NAMES_KN: Record<string, string> = {
  BHADRAVATHI: "ಭದ್ರಾವತಿ", BIRUR: "ಬೀರೂರು", CHANNAGIRI: "ಚನ್ನಗಿರಿ", HOSANAGARA: "ಹೊಸನಗರ", JAYAPURA: "ಜಯಪುರ", KOPPA: "ಕೊಪ್ಪ", SAGARA: "ಸಾಗರ",
  SHIKARIPURA: "ಶಿಕಾರಿಪುರ", SHIVAMOGGA: "ಶಿವಮೊಗ್ಗ", SIDDAPUR: "ಸಿದ್ದಾಪುರ", SIRSI: "ಶಿರಸಿ", SORABA: "ಸೊರಬ", SRINGERI: "ಶೃಂಗೇರಿ",
  TARIKERE: "ತರೀಕೆರೆ", THIRTHAHALLI: "ತೀರ್ಥಹಳ್ಳಿ", YELLAPUR: "ಯಲ್ಲಾಪುರ",
};

const COPY = {
  kn: {
    title: "ಇತ್ತೀಚಿನ ಅಡಿಕೆ ಧಾರಣೆ",
    intro: "ಸಹಕಾರಿ ಸಂಘಗಳು ಪ್ರಕಟಿಸಿದ ದರಗಳು. ಪ್ರತಿ ದರದ ಪಕ್ಕ ಅದರ ದಿನಾಂಕ ಇದೆ.",
    choose: "ತಳಿ ಆಯ್ಕೆ ಮಾಡಿ",
    latest: "ಇತ್ತೀಚಿನ ವರದಿ",
    sellOrHold: "ಈಗ ಮಾರಬೇಕೇ, ಕಾಯಬೇಕೇ?",
    sellOrHoldHint: "ಹಿಂದಿನ ವರ್ಷಗಳಲ್ಲಿ ಏನಾಯಿತು ನೋಡಿ",
    ask: "ಪ್ರಶ್ನೆ ಕೇಳಿ",
    askHint: "ದರ, ರೋಗ, ಹವಾಮಾನದ ಬಗ್ಗೆ",
    perQuintal: "ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ ಸರಾಸರಿ",
    range: "ಕನಿಷ್ಠ – ಗರಿಷ್ಠ",
    highest: "ಈ ದಿನದ ಹೆಚ್ಚಿನ ದರ",
    source: "ಮೂಲ",
    noRows: "ಈ ತಳಿಗೆ ಪ್ರಕಟಿತ ದರ ಇಲ್ಲ.",
    noVariety: "ಈ ಸಂಸ್ಥೆ ಈ ತಳಿಯ ದರ ಪ್ರಕಟಿಸುವುದಿಲ್ಲ.",
    assumedUnit: "ಮೂಲವು ಘಟಕವನ್ನು ತಿಳಿಸಿಲ್ಲ; ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್ ಎಂದು ಪರಿಗಣಿಸಲಾಗಿದೆ",
    tumcos: "ಚನ್ನಗಿರಿ — ತುಮ್ಕೋಸ್ (TUMCOS)",
    tumcosNote: "ತುಮ್ಕೋಸ್ ತಳಿಯನ್ನು ತಿಳಿಸುವುದಿಲ್ಲ, ಆದ್ದರಿಂದ ಇದು ಯಾವ ತಳಿಯ ದರ ಎಂದು ಹೇಳಲಾಗದು. ಮೂಲದ ಪುಟದಲ್ಲಿ “kg” ಎಂದಿದೆ; ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್ ಎಂದು ಪರಿಗಣಿಸಲಾಗಿದೆ.",
    notComparable: "ಪ್ರತಿ ಸಂಸ್ಥೆಯ ದರವನ್ನು ಬೇರೆ ರೀತಿಯಲ್ಲಿ ಲೆಕ್ಕ ಮಾಡಲಾಗುತ್ತದೆ, ಆದ್ದರಿಂದ ಬೇರೆ ಬೇರೆ ಸಂಸ್ಥೆಗಳ ದರಗಳನ್ನು ನೇರವಾಗಿ ಹೋಲಿಸಬೇಡಿ. ಇವು ಸರಾಸರಿ ದರಗಳು; ನಿಮ್ಮ ಮಾಲಿಗೆ ಸಿಗುವ ದರ ಬೇರೆ ಇರಬಹುದು.",
    allPrices: "ಎಲ್ಲಾ ದರಗಳು ಮತ್ತು ವಿವರಗಳು",
    loading: "ದರಗಳನ್ನು ತರಲಾಗುತ್ತಿದೆ",
    failed: "ದರಗಳನ್ನು ತರಲು ಆಗಲಿಲ್ಲ. ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಪ್ರಯತ್ನಿಸಿ.",
    retry: "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ",
    versus: (when: string) => `${when} ವರದಿಗೆ ಹೋಲಿಸಿ`,
    yesterday: "ನಿನ್ನೆ",
    noChange: "ಬದಲಾವಣೆ ಇಲ್ಲ",
    noComparison: "ಶಾಖೆಯ ಎರಡನೇ ವರದಿ ಬಂದ ನಂತರ ಏರಿಕೆ ಅಥವಾ ಇಳಿಕೆ ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತದೆ.",
    up: "ಏರಿಕೆ", down: "ಇಳಿಕೆ", flat: "ಬದಲಾವಣೆ ಇಲ್ಲ",
    marketOn: (date: string) => `${date} ರ ಮಾರುಕಟ್ಟೆ`,
    typical: "ಮಧ್ಯಮ ಬದಲಾವಣೆ",
    changeNote: "ಪ್ರತಿ ಶಾಖೆಯನ್ನು ಅದರದೇ ಹಿಂದಿನ ವರದಿಗೆ ಹೋಲಿಸಲಾಗಿದೆ.",
  },
  en: {
    title: "Latest arecanut rates",
    intro: "Rates published by the cooperatives. Every rate has its date beside it.",
    choose: "Choose a variety",
    latest: "Latest report",
    sellOrHold: "Sell now or wait?",
    sellOrHoldHint: "See what happened in past years",
    ask: "Ask a question",
    askHint: "About rates, disease or weather",
    perQuintal: "average per quintal",
    range: "Minimum – maximum",
    highest: "Highest that day",
    source: "Source",
    noRows: "No published rate for this variety.",
    noVariety: "This cooperative does not publish this variety.",
    assumedUnit: "The source states no unit; treated as per quintal",
    tumcos: "Channagiri — TUMCOS",
    tumcosNote: "TUMCOS does not state the variety, so this cannot be matched to a grade. Its page says “kg”; treated as per quintal.",
    notComparable: "Each cooperative works out its rate differently, so don't compare rates directly between cooperatives. These are averages; the rate for your lot can differ.",
    allPrices: "All rates and details",
    loading: "Loading rates",
    failed: "Could not load the rates. Please try again shortly.",
    retry: "Try again",
    versus: (when: string) => `vs ${when}`,
    yesterday: "yesterday",
    noChange: "No change",
    noComparison: "Rises and falls appear here once a branch has a second report.",
    up: "up", down: "down", flat: "unchanged",
    marketOn: (date: string) => `Market on ${date}`,
    typical: "Median change",
    changeNote: "Each branch is compared with its own previous report.",
  },
} as const;

const rupees = (value: number | null) => value === null ? "—" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const dateText = (date: string, language: Language) => language === "kn" ? formatPeriodKannada(date) : formatCalendarDate(date);
const ageDays = (date: string, today: string) => Math.round((calendarDateToTime(today) - calendarDateToTime(date)) / DAY_MS);
const branchName = (branch: string, language: Language) => language === "kn" ? BRANCH_NAMES_KN[branch.toUpperCase()] ?? branch : branch;

const signedPercent = (value: number) => `${value > 0 ? "+" : ""}${value}%`;

function ChangeLine({ change, today, language }: { change: PriceChange | null; today: string; language: Language }) {
  const copy = COPY[language];
  if (!change) return null;
  const when = ageDays(change.previous_date, today) === 1 ? copy.yesterday : dateText(change.previous_date, language);
  if (change.amount === 0) return <span className="rate-change"><Minus size={14} aria-hidden="true" />{copy.noChange} · {copy.versus(when)}</span>;
  const rising = change.amount > 0;
  return <span className={`rate-change ${rising ? "hold-up" : "hold-down"}`}>
    {rising ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
    <b>{rising ? "+" : "−"}{rupees(Math.abs(change.amount))} ({signedPercent(change.percent).replace("-", "−")})</b>
    <small>{copy.versus(when)}</small>
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

function RateRow({ row, today, language, highest, showLabel, change }: { row: CooperativeQuote; today: string; language: Language; highest: boolean; showLabel: boolean; change: PriceChange | null }) {
  const copy = COPY[language];
  const age = ageDays(row.reporting_date, today);
  return <li className={`rate-row${highest ? " rate-row-top" : ""}`}>
    <div className="rate-place">
      <strong>{branchName(row.branch, language)}</strong>
      <span className={`rate-date${age > 2 ? " rate-date-old" : ""}`}>{dateText(row.reporting_date, language)} · {ageText(age, language)}</span>
      {showLabel && <span className="rate-label" lang="en">{row.variety}</span>}
      {highest && <span className="rate-top-mark">{copy.highest}</span>}
    </div>
    <div className="rate-price">
      <strong>{rupees(row.average_price)}</strong>
      <ChangeLine change={change} today={today} language={language} />
      <span>{rupees(row.minimum_price)} – {rupees(row.maximum_price)}</span>
    </div>
  </li>;
}

export function HomePage() {
  const { language } = useLanguage();
  const { code } = useCommodity();
  const [params, setParams] = useSearchParams();
  const copy = COPY[language];
  const today = calendarTodayIST();
  // Enough reports to find each branch's previous one. Older ones are too old to show a change against anyway.
  const historyFrom = new Date(calendarDateToTime(today) - (MAX_CHANGE_GAP_DAYS + 7) * DAY_MS).toISOString().slice(0, 10);
  const variety = VARIETIES.find((item) => item.key === params.get("v")) ?? VARIETIES[0];
  const requests = SOURCES.flatMap((source) => (variety.labels[source.key] ?? []).map((label) => ({ source: source.key, label })));
  const queries = useQueries({ queries: [...requests, { source: "tumcos" as const, label: "areca" }].map(({ source, label }) => ({
    queryKey: ["home-rates", source, label],
    queryFn: () => api.cooperativePrices(source, label, "arecanut", { from: historyFrom }),
    refetchInterval: 300_000,
  })) });
  // The rates here are arecanut's, so another commodity goes to the page that handles it.
  if (code !== DEFAULT_COMMODITY) return <Navigate to={`/overview?commodity=${encodeURIComponent(code)}`} replace />;
  const loading = queries.some((query) => query.isLoading);
  const failed = queries.length > 0 && queries.every((query) => query.error);
  const rowsFor = (source: CooperativeSource) => {
    const labels = variety.labels[source] ?? [];
    return labels.flatMap((label) => queries[requests.findIndex((request) => request.source === source && request.label === label)]?.data?.latest_by_branch ?? []);
  };
  const historyFor = (source: CooperativeSource) => {
    const labels = variety.labels[source] ?? [];
    return labels.flatMap((label) => queries[requests.findIndex((request) => request.source === source && request.label === label)]?.data?.data ?? []);
  };
  const tumcos = queries.at(-1)?.data?.latest_by_branch ?? [];
  const tumcosHistory = queries.at(-1)?.data?.data ?? [];
  const allDates = [...SOURCES.flatMap((source) => rowsFor(source.key)), ...tumcos].map((row) => row.reporting_date).sort();
  const newest = allDates.at(-1);
  return <div className="page-stack home" lang={language}>
    <section className="home-heading">
      <h1>{copy.title}</h1>
      <p>{copy.intro}</p>
      {newest && <p className="home-latest">{copy.latest}: <strong>{dateText(newest, language)}</strong> ({ageText(ageDays(newest, today), language)})</p>}
    </section>

    <div className="variety-chips" role="group" aria-label={copy.choose}>
      {VARIETIES.map((item) => <button key={item.key} type="button" aria-pressed={item.key === variety.key}
        onClick={() => { const next = new URLSearchParams(params); next.set("v", item.key); setParams(next, { replace: true }); }}>{language === "kn" ? item.kn : item.en}</button>)}
    </div>

    <nav className="home-actions" aria-label={copy.sellOrHold}>
      <Link to="/sell-or-hold"><strong>{copy.sellOrHold}</strong><span>{copy.sellOrHoldHint}</span><ArrowRight size={18} aria-hidden="true" /></Link>
      <Link to="/assistant"><strong>{copy.ask}</strong><span>{copy.askHint}</span><ArrowRight size={18} aria-hidden="true" /></Link>
    </nav>

    {loading ? <LoadingState label={copy.loading} /> : failed ? <ErrorState error={new Error(copy.failed)} onRetry={() => queries.forEach((query) => void query.refetch())} /> : <>
      {SOURCES.map((source) => {
        const published = variety.labels[source.key];
        const { latest, rows } = orderRows(rowsFor(source.key));
        const sameDay = rows.filter((row) => row.reporting_date === latest);
        const history = historyFor(source.key);
        const breadth = marketBreadth(sameDay.map((row) => priceChange(row, history)));
        return <section className="rate-card" key={source.key} aria-labelledby={`rates-${source.key}`}>
          <header>
            <h2 id={`rates-${source.key}`}>{language === "kn" ? source.kn : source.en}</h2>
            {rows[0] && <a href={rows[0].source_url} target="_blank" rel="noreferrer">{copy.source} <ExternalLink size={13} aria-hidden="true" /></a>}
          </header>
          {!published ? <p className="rate-empty">{copy.noVariety}</p> : !rows.length ? <p className="rate-empty">{copy.noRows}</p> : <>
            {latest && breadth.median_percent !== null && <div className="market-breadth">
              <span className="market-breadth-title">{copy.marketOn(dateText(latest, language))}</span>
              <span className="hold-up"><ArrowUp size={14} aria-hidden="true" /><b>{breadth.up}</b> {copy.up}</span>
              <span className="hold-down"><ArrowDown size={14} aria-hidden="true" /><b>{breadth.down}</b> {copy.down}</span>
              {breadth.flat > 0 && <span><Minus size={14} aria-hidden="true" /><b>{breadth.flat}</b> {copy.flat}</span>}
              <span className={breadth.median_percent > 0 ? "hold-up" : breadth.median_percent < 0 ? "hold-down" : ""}>{copy.typical} <b>{signedPercent(breadth.median_percent).replace("-", "−")}</b></span>
            </div>}
            <p className="rate-caption">{copy.perQuintal} · {copy.range}{source.assumedUnit ? ` · ${copy.assumedUnit}` : ""}. {rows.some((row) => priceChange(row, history)) ? copy.changeNote : copy.noComparison}</p>
            <ul>{rows.map((row) => <RateRow key={row.id} row={row} today={today} language={language} showLabel={published.length > 1 || language === "en"}
              highest={sameDay.length > 1 && row === sameDay[0]} change={priceChange(row, history)} />)}</ul>
          </>}
        </section>;
      })}
      {tumcos.length > 0 && <section className="rate-card" aria-labelledby="rates-tumcos">
        <header>
          <h2 id="rates-tumcos">{copy.tumcos}</h2>
          <a href={tumcos[0].source_url} target="_blank" rel="noreferrer">{copy.source} <ExternalLink size={13} aria-hidden="true" /></a>
        </header>
        <p className="rate-caption">{copy.tumcosNote}</p>
        <ul>{tumcos.map((row) => <RateRow key={row.id} row={row} today={today} language={language} showLabel={false} highest={false} change={priceChange(row, tumcosHistory)} />)}</ul>
      </section>}
      <p className="home-note">{copy.notComparable}</p>
      <Link className="home-more" to="/overview">{copy.allPrices} <ArrowRight size={15} aria-hidden="true" /></Link>
    </>}
  </div>;
}

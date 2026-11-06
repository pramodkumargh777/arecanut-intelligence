import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { calendarTodayIST, formatCalendarMonth, formatPeriodKannada, MONTH_NAMES_EN, MONTH_NAMES_KN, shiftCalendarMonth } from "../../../shared/dates";
import { HOLD_HORIZONS, holdBreakEvenPercent, holdHistory, MIN_HOLD_YEARS } from "../../../shared/hold-history";
import { ErrorState, LoadingState } from "../components/State";
import { api } from "../services/api";
import { useLanguage, type Language } from "../services/language";

/** Common trade names first. Everything else the source reports follows, under its own name. */
const COMMON_VARIETIES: { name: string; kn: string }[] = [
  { name: "Rashi", kn: "ರಾಶಿ" }, { name: "Chali", kn: "ಚಾಲಿ" }, { name: "Hosa Chali", kn: "ಹೊಸ ಚಾಲಿ" }, { name: "Hale Chali", kn: "ಹಳೆ ಚಾಲಿ" },
  { name: "Bette", kn: "ಬೆಟ್ಟೆ" }, { name: "Gorabalu", kn: "ಗೊರಬಲು" }, { name: "Bilegotu", kn: "ಬಿಳೇಗೋಟು" }, { name: "Kempugotu", kn: "ಕೆಂಪುಗೋಟು" },
  { name: "Saraku", kn: "ಸರಕು" }, { name: "Sippegotu", kn: "ಸಿಪ್ಪೆಗೋಟು" },
];

/** A starting point for the reader to change. Weight loss and storage start at zero because they differ too much to guess. */
const DEFAULT_INTEREST_PERCENT = 10;

const COPY = {
  kn: {
    title: "ಈಗ ಮಾರಬೇಕೇ, ಕಾಯಬೇಕೇ?",
    intro: "ಹಿಂದಿನ ವರ್ಷಗಳಲ್ಲಿ ಈ ತಿಂಗಳ ನಂತರ ದರ ಏನಾಯಿತು ಎಂಬುದನ್ನು ಇಲ್ಲಿ ನೋಡಿ. ಇದು ಮುನ್ಸೂಚನೆ ಅಥವಾ ಸಲಹೆ ಅಲ್ಲ; ಮುಂದೆ ಏನಾಗುತ್ತದೆ ಎಂದು ಯಾರಿಗೂ ಖಚಿತವಾಗಿ ಹೇಳಲಾಗದು.",
    variety: "ತಳಿ", month: "ಮಾರಾಟದ ತಿಂಗಳು",
    costsTitle: "ಕಾಯುವುದಕ್ಕೆ ನಿಮ್ಮ ಖರ್ಚು",
    costsHint: "ಇವು ನಿಮ್ಮ ಸಂಖ್ಯೆಗಳು. ಬಡ್ಡಿಯ ಆರಂಭಿಕ ಸಂಖ್ಯೆ ಕೇವಲ ಉದಾಹರಣೆ; ನಿಮ್ಮದಕ್ಕೆ ಬದಲಿಸಿ.",
    interest: "ವಾರ್ಷಿಕ ಬಡ್ಡಿ (%)", weightLoss: "ಸಂಗ್ರಹದಲ್ಲಿ ತೂಕ ನಷ್ಟ (%)", storage: "ಸಂಗ್ರಹ ಖರ್ಚು (₹/ಕ್ವಿಂಟಾಲ್/ತಿಂಗಳು)",
    summaryTitle: (month: string) => `${month} ತಿಂಗಳಿನಿಂದ ಕಾದಿದ್ದರೆ`,
    summaryNote: "ಕರ್ನಾಟಕದ ತಿಂಗಳ ಸರಾಸರಿ ದರ (AGMARKNET). ನಿಮ್ಮ ಶಾಖೆಯ ದರ ಬೇರೆ ಇರಬಹುದು.",
    wait: "ಕಾದ ಅವಧಿ", months: (n: number) => `${n} ತಿಂಗಳು`, rose: "ದರ ಏರಿದ ವರ್ಷಗಳು", typical: "ಮಧ್ಯಮ ಬದಲಾವಣೆ", range: "ಕನಿಷ್ಠ / ಗರಿಷ್ಠ",
    needed: "ಖರ್ಚು ಸರಿದೂಗಲು ಬೇಕಾದ ಏರಿಕೆ", covered: "ಖರ್ಚು ಸರಿದೂಗಿದ ವರ್ಷಗಳು",
    ofYears: (count: number, years: number) => `${years} ರಲ್ಲಿ ${count}`, notEnough: `${MIN_HOLD_YEARS} ವರ್ಷಗಳಿಗಿಂತ ಕಡಿಮೆ ದತ್ತಾಂಶ`,
    yearsTitle: "ವರ್ಷವಾರು ವಿವರ", start: "ಆರಂಭ ದರ", startMonth: "ಆರಂಭ",
    excluded: (months: string) => `ಬಿಟ್ಟಿರುವ ತಿಂಗಳು: ${months}. ಈ ತಿಂಗಳಲ್ಲಿ ದರ 20% ಕ್ಕಿಂತ ಹೆಚ್ಚು ಬದಲಾಗಿ ಮುಂದಿನ ತಿಂಗಳು ಮರಳಿ ಬಂದಿದೆ; ಇದು ದತ್ತಾಂಶದ ದೋಷ ಇರಬಹುದು.`,
    latestPrice: (price: string, month: string) => `ಇತ್ತೀಚಿನ ರಾಜ್ಯ ಸರಾಸರಿ: ${price}/ಕ್ವಿಂಟಾಲ್ (${month})`,
    caveat: "ಕೆಲವೇ ವರ್ಷಗಳ ದತ್ತಾಂಶ ಇದೆ. ಹಿಂದೆ ಆದದ್ದು ಈ ವರ್ಷವೂ ಆಗುತ್ತದೆ ಎಂದು ಹೇಳಲಾಗದು. ಮಾರಾಟದ ನಿರ್ಧಾರ ನಿಮ್ಮದು.",
    noData: "ಈ ತಳಿ ಮತ್ತು ತಿಂಗಳಿಗೆ ಸಾಕಷ್ಟು ದತ್ತಾಂಶ ಇಲ್ಲ.",
    loading: "ಹಿಂದಿನ ದರಗಳನ್ನು ತರಲಾಗುತ್ತಿದೆ",
    source: "ಮೂಲ: AGMARKNET ತಿಂಗಳ ವರದಿಗಳು",
  },
  en: {
    title: "Sell now or wait?",
    intro: "See what the price did after this month in past years. This is neither a forecast nor advice; nobody can say for certain what happens next.",
    variety: "Variety", month: "Month you would sell",
    costsTitle: "Your cost of waiting",
    costsHint: "These are your numbers. The interest figure is only a starting example; change it to yours.",
    interest: "Annual interest (%)", weightLoss: "Weight lost in storage (%)", storage: "Storage cost (₹/quintal/month)",
    summaryTitle: (month: string) => `If you had waited from ${month}`,
    summaryNote: "Karnataka monthly average price (AGMARKNET). Your branch's rate can differ.",
    wait: "Waited", months: (n: number) => `${n} month${n === 1 ? "" : "s"}`, rose: "Years the price rose", typical: "Median change", range: "Lowest / highest",
    needed: "Rise needed to cover costs", covered: "Years that covered costs",
    ofYears: (count: number, years: number) => `${count} of ${years}`, notEnough: `Under ${MIN_HOLD_YEARS} years of data`,
    yearsTitle: "Year by year", start: "Starting price", startMonth: "From",
    excluded: (months: string) => `Left out: ${months}. The price moved more than 20% that month and came straight back the next, which may be a data problem.`,
    latestPrice: (price: string, month: string) => `Latest state average: ${price}/quintal (${month})`,
    caveat: "These are only a few years of data. What happened before may not happen this year. The decision to sell is yours.",
    noData: "Not enough data for this variety and month.",
    loading: "Loading past prices",
    source: "Source: AGMARKNET monthly reports",
  },
} as const;

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
  const query = useQuery({ queryKey: ["sell-or-hold", variety, lastCompleted], queryFn: () => api.monthlyHistory("2021-01", lastCompleted, variety) });
  const data = query.data;
  const history = data ? holdHistory(data.points, startMonth) : null;
  const observed = (data?.points ?? []).filter((point) => point.weighted_price !== null);
  const latest = observed.at(-1);
  const costs = { annualInterestPercent: Number(interest || 0), weightLossPercent: Number(weightLoss || 0), storagePerQuintalPerMonth: Number(storage || 0) };
  const breakEven = (months: number) => latest?.weighted_price ? holdBreakEvenPercent(months, latest.weighted_price, costs) : null;
  const common = COMMON_VARIETIES.filter((item) => !data || data.varieties.includes(item.name));
  const others = (data?.varieties ?? []).filter((name) => !COMMON_VARIETIES.some((item) => item.name === name));
  const monthNames = language === "kn" ? MONTH_NAMES_KN : MONTH_NAMES_EN;
  return <div className="page-stack home" lang={language}>
    <section className="home-heading"><h1>{copy.title}</h1><p>{copy.intro}</p></section>

    <section className="hold-controls">
      <label className="filter-control"><span>{copy.variety}</span><select value={variety} onChange={(event) => setVariety(event.target.value)}>
        {common.map((item) => <option key={item.name} value={item.name}>{language === "kn" ? item.kn : item.name}</option>)}
        {others.map((name) => <option key={name} value={name}>{name}</option>)}
      </select></label>
      <label className="filter-control"><span>{copy.month}</span><select value={startMonth} onChange={(event) => setStartMonth(Number(event.target.value))}>
        {monthNames.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
      </select></label>
    </section>

    {query.isLoading ? <LoadingState label={copy.loading} /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : !history?.years.length ? <p className="rate-empty">{copy.noData}</p> : <>
      <section className="rate-card" aria-labelledby="hold-summary">
        <header><h2 id="hold-summary">{copy.summaryTitle(monthNames[startMonth - 1])}</h2></header>
        <p className="rate-caption">{copy.summaryNote}</p>
        <ul className="hold-summary">{HOLD_HORIZONS.map((months) => {
          const summary = history.summaries.find((item) => item.months === months)!;
          const needed = breakEven(months);
          const values = history.years.flatMap((year) => year.changes.filter((change) => change.months === months && change.percent !== null).map((change) => change.percent!));
          const covered = needed === null ? null : values.filter((value) => value >= needed).length;
          return <li key={months}>
            <h3>{copy.months(months)}</h3>
            {summary.median_percent === null ? <p className="rate-empty">{copy.notEnough}</p> : <dl>
              <div><dt>{copy.rose}</dt><dd><strong>{copy.ofYears(summary.rose, summary.years)}</strong></dd></div>
              <div><dt>{copy.typical}</dt><dd className={tone(summary.median_percent)}>{signed(summary.median_percent)}</dd></div>
              <div><dt>{copy.range}</dt><dd>{signed(summary.lowest_percent)} / {signed(summary.highest_percent)}</dd></div>
              <div><dt>{copy.needed}</dt><dd>{needed === null ? "—" : `${needed}%`}</dd></div>
              <div><dt>{copy.covered}</dt><dd><strong>{covered === null ? "—" : copy.ofYears(covered, summary.years)}</strong></dd></div>
            </dl>}
          </li>;
        })}</ul>
      </section>

      <section className="rate-card" aria-labelledby="hold-costs">
        <header><h2 id="hold-costs">{copy.costsTitle}</h2></header>
        <p className="rate-caption">{copy.costsHint}</p>
        <div className="hold-costs">
          <label className="filter-control"><span>{copy.interest}</span><input type="number" inputMode="decimal" min={0} max={100} step="any" value={interest} onChange={(event) => setInterest(event.target.value)} /></label>
          <label className="filter-control"><span>{copy.weightLoss}</span><input type="number" inputMode="decimal" min={0} max={99} step="any" value={weightLoss} onChange={(event) => setWeightLoss(event.target.value)} /></label>
          <label className="filter-control"><span>{copy.storage}</span><input type="number" inputMode="decimal" min={0} step="any" value={storage} onChange={(event) => setStorage(event.target.value)} /></label>
        </div>
        {latest?.weighted_price && <p className="rate-caption">{copy.latestPrice(rupees(latest.weighted_price), monthText(latest.reporting_month, language))}</p>}
      </section>

      <section className="rate-card" aria-labelledby="hold-years">
        <header><h2 id="hold-years">{copy.yearsTitle}</h2></header>
        <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="hold-years"><table>
          <thead><tr><th scope="col">{copy.startMonth}</th><th scope="col" className="numeric">{copy.start}</th>{HOLD_HORIZONS.map((months) => <th scope="col" className="numeric" key={months}>{copy.months(months)}</th>)}</tr></thead>
          <tbody>{history.years.map((year) => <tr key={year.start_month}>
            <td>{monthText(year.start_month, language)}</td><td className="numeric">{rupees(year.start_price)}</td>
            {year.changes.map((change) => <td key={change.months} className={`numeric ${tone(change.percent)}`}>{change.excluded ? "*" : signed(change.percent)}</td>)}
          </tr>)}</tbody>
        </table></div>
        {history.excluded_months.length > 0 && <p className="rate-caption">* {copy.excluded(history.excluded_months.map((month) => monthText(month, language)).join(", "))}</p>}
      </section>

      <p className="home-note">{copy.caveat} {copy.source}.</p>
    </>}
  </div>;
}

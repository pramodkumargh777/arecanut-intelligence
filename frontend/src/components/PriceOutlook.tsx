import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { Forecast, ForecastData, Outlook, OutlookHorizon } from "../services/modules";
import { defineCopy, useCopy, useFormat } from "../services/language";
import { LazyOutlookChart } from "./LazyCharts";

/**
 * The reader-facing outlook for one variety: the likely range and most likely price for each of the next six months,
 * the chance the price ends higher, where next month's range sits against the past year, how often ranges held in
 * tests, and month-by-month proof. Ranges and odds come from the API's live outlook (the forecasting engine's
 * volatility-scaled calibration applied to today's prices); without one it falls back to the one-month baseline.
 */

type Evaluation = NonNullable<NonNullable<ForecastData["snapshot"]>["results"]["evaluation"]>;

const COPY = defineCopy({
  en: {
    experimental: "Experimental",
    eyebrow: (variety: string, month: string) => `${variety} · ${month} outlook`,
    headline: (low: string, high: string) => `Likely between ${low} and ${high}`,
    mostLikely: (point: string) => `Most likely around ${point} per quintal.`,
    vsLast: (month: string, change: string) => `${change} from ${month}'s official price.`,
    flat: (month: string) => `The same as ${month}'s official price.`,
    whyFlat: "No model has reliably beaten simply carrying the latest price forward, so the range is the useful part.",
    scope: "Official Karnataka monthly average (arrival-weighted), not a local daily quote or a sale price. Not a buy or sell signal.",
    gaugeLow: "12-month low", gaugeHigh: "12-month high", rangeLow: "Low end of range", rangeHigh: "High end of range", gaugeLast: (month: string) => `${month} actual`, gaugeRange: "Likely range",
    rangeLevel: (n: number) => `for the ${n}% range`,
    held: "Range held in past tests", heldValue: (inside: number, n: number) => `${inside} of ${n} months`,
    miss: "Typical miss", missNote: (pct: string) => `${pct} of the price`,
    history: "Based on", historyValue: (n: number) => `${n} months`, historyNote: (from: string, to: string) => `${from} – ${to}`,
    chart: "Recent prices and the outlook", chartHint: "Official monthly average per quintal for the last 18 months, with the likely range ahead.",
    actual: "Official price", outlook: "Outlook", range: "Likely range (80%)",
    proof: "How the range held", proofHint: (n: number) => `The same method, tested on the ${n} most recent months it had not seen.`,
    colMonth: "Month", colEstimate: "Estimate", colActual: "Actual", colResult: "Result",
    inside: "Inside range", outside: "Outside range", off: (amount: string) => `${amount} off`,
    compare: "See how every forecasting model compares", compareHint: "Statistical, machine-learning and AI models tested against this rule.",
    nextLabel: (month: string) => `${month} (outlook)`,
    chance: (month: string, pct: string) => `Chance it ends above ${month}'s price: ${pct}.`,
    chanceTip: (pct: string) => `Chance higher than now: ${pct}`,
    heldTested: (pct: string) => pct, heldTestedNote: (n: number) => `of ${n} held-out tests · target 80%`,
    swing: "Typical monthly swing", swingNote: "over the past 12 months",
    basedOn: (n: number, from: string, to: string) => `Based on ${n} months of official prices, ${from} – ${to}. Ranges widen when prices have been swinging and tighten when they are calm.`,
    ahead: "Next six months", aheadHint: "Likely range and the chance of ending above the latest official price. Further out, the range widens.",
    colRange: "Likely range", colMost: "Most likely", colChance: "Chance higher",
    inMonths: (n: number) => n === 1 ? "next month" : `in ${n} months`,
    proofHintNew: (n: number) => `The same range method, checked on the ${n} most recent months.`,
    noSkill: "In tests these odds did no better than a plain guess, so treat anything near 50% as a coin flip; the range is the reliable part.",
  },
  kn: {
    experimental: "ಪ್ರಾಯೋಗಿಕ",
    eyebrow: (variety: string, month: string) => `${variety} · ${month} ಮುನ್ನೋಟ`,
    headline: (low: string, high: string) => `${low} ರಿಂದ ${high} ನಡುವೆ ಇರುವ ಸಾಧ್ಯತೆ`,
    mostLikely: (point: string) => `ಹೆಚ್ಚಾಗಿ ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ ಸುಮಾರು ${point}.`,
    vsLast: (month: string, change: string) => `${month} ಅಧಿಕೃತ ದರಕ್ಕಿಂತ ${change}.`,
    flat: (month: string) => `${month} ಅಧಿಕೃತ ದರದಷ್ಟೇ.`,
    whyFlat: "ಇತ್ತೀಚಿನ ದರವನ್ನೇ ಮುಂದುವರಿಸುವುದಕ್ಕಿಂತ ಯಾವ ಮಾದರಿಯೂ ಸ್ಥಿರವಾಗಿ ಉತ್ತಮವಾಗಿಲ್ಲ; ಆದ್ದರಿಂದ ಶ್ರೇಣಿಯೇ ಉಪಯುಕ್ತ ಭಾಗ.",
    scope: "ಅಧಿಕೃತ ಕರ್ನಾಟಕ ತಿಂಗಳ ಸರಾಸರಿ (ಆವಕ ತೂಕದ), ಸ್ಥಳೀಯ ದೈನಂದಿನ ದರ ಅಥವಾ ಮಾರಾಟ ದರವಲ್ಲ. ಖರೀದಿ ಅಥವಾ ಮಾರಾಟ ಸಲಹೆ ಅಲ್ಲ.",
    gaugeLow: "12 ತಿಂಗಳ ಕನಿಷ್ಠ", gaugeHigh: "12 ತಿಂಗಳ ಗರಿಷ್ಠ", rangeLow: "ಶ್ರೇಣಿಯ ಕೆಳ ತುದಿ", rangeHigh: "ಶ್ರೇಣಿಯ ಮೇಲಿನ ತುದಿ", gaugeLast: (month: string) => `${month} ನಿಜವಾದ ದರ`, gaugeRange: "ಸಾಧ್ಯ ಶ್ರೇಣಿ",
    rangeLevel: (n: number) => `${n}% ಶ್ರೇಣಿಗೆ`,
    held: "ಹಿಂದಿನ ಪರೀಕ್ಷೆಗಳಲ್ಲಿ ಶ್ರೇಣಿ ಸರಿಯಾದದ್ದು", heldValue: (inside: number, n: number) => `${n} ರಲ್ಲಿ ${inside} ತಿಂಗಳು`,
    miss: "ಸಾಮಾನ್ಯ ವ್ಯತ್ಯಾಸ", missNote: (pct: string) => `ದರದ ${pct}`,
    history: "ಆಧಾರ", historyValue: (n: number) => `${n} ತಿಂಗಳುಗಳು`, historyNote: (from: string, to: string) => `${from} – ${to}`,
    chart: "ಇತ್ತೀಚಿನ ದರಗಳು ಮತ್ತು ಮುನ್ನೋಟ", chartHint: "ಕಳೆದ 18 ತಿಂಗಳ ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್ ಅಧಿಕೃತ ತಿಂಗಳ ಸರಾಸರಿ ಮತ್ತು ಮುಂದಿನ ಸಾಧ್ಯ ಶ್ರೇಣಿ.",
    actual: "ಅಧಿಕೃತ ದರ", outlook: "ಮುನ್ನೋಟ", range: "ಸಾಧ್ಯ ಶ್ರೇಣಿ (80%)",
    proof: "ಶ್ರೇಣಿ ಎಷ್ಟು ಸರಿಯಾಯಿತು", proofHint: (n: number) => `ಇದೇ ವಿಧಾನವನ್ನು ಅದು ನೋಡದ ಇತ್ತೀಚಿನ ${n} ತಿಂಗಳುಗಳಲ್ಲಿ ಪರೀಕ್ಷಿಸಲಾಗಿದೆ.`,
    colMonth: "ತಿಂಗಳು", colEstimate: "ಅಂದಾಜು", colActual: "ನಿಜವಾದ ದರ", colResult: "ಫಲಿತಾಂಶ",
    inside: "ಶ್ರೇಣಿಯೊಳಗೆ", outside: "ಶ್ರೇಣಿಯ ಹೊರಗೆ", off: (amount: string) => `${amount} ವ್ಯತ್ಯಾಸ`,
    compare: "ಎಲ್ಲ ಮುನ್ಸೂಚನಾ ಮಾದರಿಗಳ ಹೋಲಿಕೆ ನೋಡಿ", compareHint: "ಸಾಂಖ್ಯಿಕ, ಯಂತ್ರ ಕಲಿಕೆ ಮತ್ತು AI ಮಾದರಿಗಳನ್ನು ಈ ನಿಯಮದ ವಿರುದ್ಧ ಪರೀಕ್ಷಿಸಲಾಗಿದೆ.",
    nextLabel: (month: string) => `${month} (ಮುನ್ನೋಟ)`,
    chance: (month: string, pct: string) => `${month} ದರಕ್ಕಿಂತ ಹೆಚ್ಚಾಗುವ ಸಾಧ್ಯತೆ: ${pct}.`,
    chanceTip: (pct: string) => `ಈಗಿನ ದರಕ್ಕಿಂತ ಹೆಚ್ಚಾಗುವ ಸಾಧ್ಯತೆ: ${pct}`,
    heldTested: (pct: string) => pct, heldTestedNote: (n: number) => `${n} ಪ್ರತ್ಯೇಕ ಪರೀಕ್ಷೆಗಳಲ್ಲಿ · ಗುರಿ 80%`,
    swing: "ಸಾಮಾನ್ಯ ತಿಂಗಳ ಏರಿಳಿತ", swingNote: "ಕಳೆದ 12 ತಿಂಗಳಲ್ಲಿ",
    basedOn: (n: number, from: string, to: string) => `${from} – ${to} ರ ${n} ತಿಂಗಳ ಅಧಿಕೃತ ದರಗಳ ಆಧಾರ. ದರ ಏರಿಳಿತ ಹೆಚ್ಚಿದ್ದಾಗ ಶ್ರೇಣಿ ಅಗಲ, ಶಾಂತವಾಗಿದ್ದಾಗ ಕಿರಿದು.`,
    ahead: "ಮುಂದಿನ ಆರು ತಿಂಗಳು", aheadHint: "ಸಾಧ್ಯ ಶ್ರೇಣಿ ಮತ್ತು ಇತ್ತೀಚಿನ ಅಧಿಕೃತ ದರಕ್ಕಿಂತ ಹೆಚ್ಚಾಗುವ ಸಾಧ್ಯತೆ. ಹೆಚ್ಚು ಮುಂದೆ ಹೋದಂತೆ ಶ್ರೇಣಿ ಅಗಲ.",
    colRange: "ಸಾಧ್ಯ ಶ್ರೇಣಿ", colMost: "ಹೆಚ್ಚು ಸಾಧ್ಯ", colChance: "ಹೆಚ್ಚಾಗುವ ಸಾಧ್ಯತೆ",
    inMonths: (n: number) => n === 1 ? "ಮುಂದಿನ ತಿಂಗಳು" : `${n} ತಿಂಗಳಲ್ಲಿ`,
    proofHintNew: (n: number) => `ಇದೇ ಶ್ರೇಣಿ ವಿಧಾನ, ಇತ್ತೀಚಿನ ${n} ತಿಂಗಳುಗಳಲ್ಲಿ ಪರಿಶೀಲಿಸಲಾಗಿದೆ.`,
    noSkill: "ಪರೀಕ್ಷೆಗಳಲ್ಲಿ ಈ ಸಾಧ್ಯತೆಗಳು ಸಾಮಾನ್ಯ ಊಹೆಗಿಂತ ಉತ್ತಮವಾಗಿರಲಿಲ್ಲ; 50% ಹತ್ತಿರದ ಅಂಕಿಯನ್ನು ನಾಣ್ಯ ಚಿಮ್ಮಿದಂತೆ ಪರಿಗಣಿಸಿ. ಶ್ರೇಣಿಯೇ ವಿಶ್ವಾಸಾರ್ಹ ಭಾಗ.",
  },
});

const rupees = (value: number | null | undefined) => value == null ? "—" : `₹${Math.round(value).toLocaleString("en-IN")}`;
const pct = (value: number) => `${Math.round(value * 100)}%`;

/** Root-mean-square of the last 12 monthly log returns, floored at 1% (mirrors api/src/outlook.ts). */
function volatility(values: number[]): number | null {
  const returns = values.slice(1).map((value, i) => Math.log(value / values[i])).slice(-12);
  if (returns.length < 6) return null;
  return Math.max(Math.sqrt(returns.reduce((sum, value) => sum + value ** 2, 0) / returns.length), 0.01);
}

type Ahead = Omit<OutlookHorizon, "chance_higher" | "band" | "tested"> & Partial<Pick<OutlookHorizon, "chance_higher" | "band" | "tested">>;

export function PriceOutlook({ variety, outlook, forecast, evaluation, prices, historyCount }: {
  variety: string; outlook: Outlook | null; forecast: Forecast | null; evaluation: Evaluation | null;
  prices: { reporting_month: string; weighted_price: number | null }[]; historyCount: number;
}) {
  const t = useCopy(COPY);
  const format = useFormat();
  const month = (value: string) => format.month(value);
  const observed = prices.filter((row): row is { reporting_month: string; weighted_price: number } => row.weighted_price != null)
    .sort((a, b) => a.reporting_month.localeCompare(b.reporting_month));
  const ahead: Ahead[] = outlook?.horizons.length ? outlook.horizons
    : forecast ? [{ horizon: 1, target_month: forecast.reporting_month, model: forecast.model, point: forecast.point, lower: forecast.lower, upper: forecast.upper }] : [];
  const next = ahead[0];
  const last = observed.at(-1);
  if (!next || !last) return null;
  const year = observed.slice(-12).map((row) => row.weighted_price);
  const change = next.point / last.weighted_price - 1;

  // Gauge: the track runs from the lowest to the highest of the past year and the range, so both always fit. Its two
  // ends are labelled with what they are (a 12-month extreme or a range end); markers never carry labels of their own,
  // so coinciding values cannot print on top of each other.
  const yearLow = Math.min(...year), yearHigh = Math.max(...year);
  const from = Math.min(next.lower, yearLow), to = Math.max(next.upper, yearHigh);
  const at = (value: number) => `${((value - from) / (to - from || 1)) * 100}%`;

  // Past months checked with the range method the page shows: volatility-scaled when the live outlook is available
  // (volatility as known at each month's origin), otherwise the baseline's fixed calibrated radius.
  const selected = evaluation?.selected_model;
  const radius = evaluation?.calibration.absolute_residual_radius ?? (next.upper - next.point);
  const proof = (evaluation?.holdout.points ?? []).map((point) => {
    const estimate = selected ? point[selected] : point.last_value;
    const vol = next.band ? volatility(observed.filter((row) => row.reporting_month <= point.training_through).map((row) => row.weighted_price)) : null;
    const [lower, upper] = next.band && vol !== null
      ? [estimate * Math.exp(vol * next.band[0]), estimate * Math.exp(vol * next.band[1])] : [estimate - radius, estimate + radius];
    return { month: point.reporting_month, estimate, actual: point.actual, miss: Math.abs(point.actual - estimate), inside: point.actual >= lower && point.actual <= upper };
  });
  const inside = proof.filter((row) => row.inside).length;
  const meanActual = proof.length ? proof.reduce((sum, row) => sum + row.actual, 0) / proof.length : null;
  const mae = evaluation?.holdout.selected.mae ?? null;
  const tested = next.tested;
  const recent = observed.slice(-18);

  return <div className="fx-showcase">
    <section className="fx-hero po-hero tone-neutral">
      <div className="fx-hero-text">
        <p className="fx-eyebrow"><span className="po-badge">{t.experimental}</span>{t.eyebrow(variety, month(next.target_month))}</p>
        <h2>{t.headline(rupees(next.lower), rupees(next.upper))}</h2>
        <p className="fx-hero-detail"><strong>{t.mostLikely(rupees(next.point))}</strong>{" "}
          {Math.abs(change) < 0.0005 ? t.flat(month(last.reporting_month)) : t.vsLast(month(last.reporting_month), `${change > 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(1)}%`)}
          {next.chance_higher != null && <> {t.chance(month(last.reporting_month), pct(next.chance_higher))}</>}
          {next.model === "last_value" && <> {t.whyFlat}</>}</p>
        <p className="fx-tested">{t.basedOn(historyCount, month(observed[0].reporting_month), month(last.reporting_month))}</p>
      </div>
      <div className="po-gauge" role="img" aria-label={`${t.gaugeRange}: ${rupees(next.lower)} – ${rupees(next.upper)}`}>
        <div className="po-track">
          <span className="po-band" style={{ left: at(next.lower), width: `calc(${at(next.upper)} - ${at(next.lower)})` }} />
          <span className="po-last" style={{ left: at(last.weighted_price) }} />
          <span className="po-point" style={{ left: at(next.point) }} />
        </div>
        <div className="po-scale">
          <span><b>{rupees(from)}</b>{from === yearLow ? t.gaugeLow : t.rangeLow}</span>
          <span><b>{rupees(to)}</b>{to === yearHigh ? t.gaugeHigh : t.rangeHigh}</span>
        </div>
        <p className="po-key"><span><i className="po-key-band" />{t.gaugeRange}</span><span><i className="po-key-point" />{t.outlook}</span>
          <span><i className="po-key-last" />{t.gaugeLast(month(last.reporting_month))}</span></p>
      </div>
    </section>

    <dl className="fx-stats po-stats">
      {tested ? <div><dt>{t.held}</dt><dd>{t.heldTested(pct(tested.coverage))}</dd><small>{t.heldTestedNote(tested.months)}</small></div>
        : proof.length > 0 && <div><dt>{t.held}</dt><dd>{t.heldValue(inside, proof.length)}</dd><small>{t.rangeLevel(80)}</small></div>}
      {mae !== null && <div><dt>{t.miss}</dt><dd>±{rupees(mae)}</dd><small>{meanActual ? t.missNote(`${(mae / meanActual * 100).toFixed(1)}%`) : ""}</small></div>}
      {outlook ? <div><dt>{t.swing}</dt><dd>±{outlook.volatility_percent.toFixed(1)}%</dd><small>{t.swingNote}</small></div>
        : <div><dt>{t.history}</dt><dd>{t.historyValue(historyCount)}</dd><small>{t.historyNote(month(observed[0].reporting_month), month(last.reporting_month))}</small></div>}
    </dl>

    <section className="fx-card" aria-labelledby="po-chart">
      <header className="fx-card-head"><h2 id="po-chart">{t.chart}</h2><p>{t.chartHint}</p></header>
      <LazyOutlookChart periods={recent.map((row) => row.reporting_month)} prices={recent.map((row) => row.weighted_price)} height={320} description={t.chartHint}
        next={ahead.map((item) => ({ label: ahead.length > 1 ? month(item.target_month) : t.nextLabel(month(item.target_month)), point: item.point, lower: item.lower, upper: item.upper,
          chance: item.chance_higher != null ? t.chanceTip(pct(item.chance_higher)) : undefined }))}
        labels={{ actual: t.actual, outlook: t.outlook, range: t.range, month }} />
    </section>

    {ahead.length > 1 && <section className="fx-card" aria-labelledby="po-ahead">
      <header className="fx-card-head"><h2 id="po-ahead">{t.ahead}</h2><p>{t.aheadHint}</p></header>
      {/* The odds are shown only with their test result: unless they beat always guessing the usual up-rate by at least
          10% at every horizon, the reader is told beside them to treat them as a coin flip. */}
      {ahead.some((item) => (item.tested?.direction_skill ?? 0) < 0.1) && <p className="po-note">{t.noSkill}</p>}
      <div className="po-ahead" role="table" aria-labelledby="po-ahead">
        <div className="po-arow po-labels" role="row"><span role="columnheader">{t.colMonth}</span><span role="columnheader" className="num">{t.colRange}</span>
          <span role="columnheader" className="num">{t.colMost}</span><span role="columnheader">{t.colChance}</span></div>
        {ahead.map((item) => <div role="row" key={item.horizon} className="po-arow">
          <span role="cell"><strong>{month(item.target_month)}</strong><small>{t.inMonths(item.horizon)}</small></span>
          <span role="cell" className="num"><strong>{rupees(item.lower)} – {rupees(item.upper)}</strong></span>
          <span role="cell" className="num fx-muted">{rupees(item.point)}</span>
          <span role="cell" className="po-chance">{item.chance_higher != null && <><i aria-hidden="true"><b style={{ width: pct(item.chance_higher) }} /></i><em>{pct(item.chance_higher)}</em></>}</span>
        </div>)}
      </div>
    </section>}

    {proof.length > 0 && <section className="fx-card" aria-labelledby="po-proof">
        <header className="fx-card-head fx-card-head-row"><div><h2 id="po-proof">{t.proof}</h2><p>{next.band ? t.proofHintNew(proof.length) : t.proofHint(proof.length)}</p></div>
          <span className="fx-chip">{t.heldValue(inside, proof.length)}</span></header>
        <div className="po-proof" role="table" aria-labelledby="po-proof">
          <div className="po-row po-labels" role="row"><span role="columnheader">{t.colMonth}</span><span role="columnheader" className="num">{t.colEstimate}</span>
            <span role="columnheader" className="num">{t.colActual}</span><span role="columnheader">{t.colResult}</span></div>
          {[...proof].reverse().map((row) => <div role="row" key={row.month} className="po-row">
            <span role="cell"><strong>{month(row.month)}</strong></span>
            <span role="cell" className="num fx-muted"><small className="po-cell-label">{t.colEstimate} </small>{rupees(row.estimate)}</span>
            <span role="cell" className="num"><small className="po-cell-label">{t.colActual} </small><strong>{rupees(row.actual)}</strong></span>
            <span role="cell"><span className={`fx-result ${row.inside ? "is-hit" : "is-miss"}`}>{row.inside ? t.inside : t.outside} · {t.off(rupees(row.miss))}</span></span>
          </div>)}
        </div>
      </section>}
    <Link to="/forecasts/evaluation" className="fx-card po-compare">
      <span><strong>{t.compare}</strong><small>{t.compareHint}</small></span><ArrowRight size={18} aria-hidden="true" />
    </Link>

    <p className="po-scope">{t.scope}</p>
  </div>;
}

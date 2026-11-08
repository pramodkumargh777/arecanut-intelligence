import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { describe, histogram, yearMonthMatrix } from "../services/insights";
import { completedMonthIST, MONTH_NAMES_KN } from "../../../shared/dates";
import { defineCopy, useCopy, useFormat } from "../services/language";
import { COMMON } from "../services/commonCopy";
import { EmptyState, ErrorState, LoadingState } from "./State";
import { LazyBarChart, LazyLineChart } from "./LazyCharts";
import { SourceLabel, StatusBadge } from "./Scorecard";
import { INK, orderedRamp } from "./chartPalette";

const money = (value: number | null) => value == null ? "—" : `₹${Math.round(value).toLocaleString("en-IN")}`;
const HISTORY_FROM = "2021-01";

const COPY = defineCopy({
  en: {
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    loading: "Loading monthly history",
    source: (variety: string, from: string, to: string, fetched: string | null) => `AGMARKNET monthly · Karnataka arrival-weighted average · ${variety} · ${from} – ${to}${fetched ? ` · fetched ${fetched}` : ""}`,
    title: "Multi-year monthly analysis",
    hint: (observed: number, expected: number, flagged: number) => `${observed} of ${expected} months observed · ${flagged} months carry review flags and remain visible · Price basis: arrival-weighted state average, not a modal-price index`,
    variety: "Monthly variety", noMonths: "No observed months for this variety", notInterpolated: "Missing months are not interpolated.",
    summary: "Monthly distribution summary", observed: "Observed months", iqr: "Interquartile range", range: "Range", cv: "Coefficient of variation",
    byYear: "Seasonal price trend by year", byYearHint: "Each line is one calendar year, darkest for the most recent · gaps mark months without an observed value",
    byYearDescription: (variety: string) => `Monthly ${variety} prices overlaid by calendar year`,
    seasonal: "Seasonal index", seasonalHint: "Month average relative to its year's mean (100 = annual mean) · complete years only", needsYears: "Needs ≥3 complete years",
    withheld: "Seasonal index withheld", withheldHint: "At least three complete calendar years are required.", annualMean: "Annual mean",
    seasonalDescription: (variety: string) => `Seasonal index for ${variety}`, completeYears: (years: string) => `Complete years: ${years}`, none: "none",
    yoy: "Year-on-year change", yoyHint: "Change versus the same month of the previous year, dark for a rise and light for a fall · only where both months were observed",
    noPairs: "No comparable month pairs", yoyDescription: (variety: string) => `Year-on-year change for ${variety}`,
    volatility: "Market volatility", volatilityHint: "Annualised standard deviation of 12 monthly log returns · historical variation, not forecast risk",
    needs13: "Needs 13 consecutive observed months", volatilityName: "12-month volatility", volatilityDescription: (variety: string) => `Rolling volatility for ${variety}`,
    distribution: "Price distribution", distributionHint: "Number of observed months in each price band, labelled by its lower edge · flagged months included",
    monthsName: "Months", distributionDescription: (variety: string) => `Distribution of monthly ${variety} prices`,
    reviewNote: "Methodology and review flags for each month are in", historyLink: "Historical analytics", reviewRule: (rule: string) => `Review rule: ${rule}.`,
    arrivals: "Arrivals versus price",
    arrivalsMethod: "Pairs AGMARKNET arrivals with reviewer-verified AGMARKNET price observations for the same market, reporting date and exact source variety. Rows without a variety are not paired.",
    loadingPairs: "Loading arrival pairs", noPairsTitle: "No paired arrival and price records",
    noPairsMessage: "No same-day, same-variety AGMARKNET arrival and price pairs exist for this range.",
    importArrivals: "Arrival data must be imported from an authorized AGMARKNET or eNAM export; nothing is estimated.", supplyLink: "Supply & crop risk",
    pairsAria: "Arrival and price pairs", pairsCaption: "Arrivals and modal prices for the same market, date and variety", arrivalsTonnes: "Arrivals (tonnes)",
    pairsSummary: (n: number, low: string, high: string) => `${n} pairs · arrivals range ${low}–${high} tonnes.`,
    caution: "Co-movement between arrivals and prices is descriptive only and does not establish cause.",
    arrivalsSource: (range: string) => `AGMARKNET arrivals and reviewer-verified prices · ${range}`, lastYear: "last 365 days",
  },
  kn: {
    months: MONTH_NAMES_KN,
    loading: "ತಿಂಗಳ ಇತಿಹಾಸ ತರಲಾಗುತ್ತಿದೆ",
    source: (variety: string, from: string, to: string, fetched: string | null) => `AGMARKNET ತಿಂಗಳ ವರದಿ · ಕರ್ನಾಟಕ ಆವಕ ಆಧಾರಿತ ಸರಾಸರಿ · ${variety} · ${from} – ${to}${fetched ? ` · ತಂದದ್ದು ${fetched}` : ""}`,
    title: "ಹಲವು ವರ್ಷಗಳ ತಿಂಗಳ ವಿಶ್ಲೇಷಣೆ",
    hint: (observed: number, expected: number, flagged: number) => `${expected} ರಲ್ಲಿ ${observed} ತಿಂಗಳ ದಾಖಲೆ ಇದೆ · ${flagged} ತಿಂಗಳುಗಳಿಗೆ ಪರಿಶೀಲನಾ ಗುರುತು ಇದ್ದು ಕಾಣಿಸುತ್ತವೆ · ದರದ ಆಧಾರ: ಆವಕ ಆಧಾರಿತ ರಾಜ್ಯ ಸರಾಸರಿ, ಮಾದರಿ ದರದ ಸೂಚ್ಯಂಕವಲ್ಲ`,
    variety: "ತಿಂಗಳ ತಳಿ", noMonths: "ಈ ತಳಿಗೆ ದಾಖಲಿತ ತಿಂಗಳುಗಳಿಲ್ಲ", notInterpolated: "ಇಲ್ಲದ ತಿಂಗಳುಗಳನ್ನು ತುಂಬುವುದಿಲ್ಲ.",
    summary: "ತಿಂಗಳ ದರಗಳ ಹಂಚಿಕೆಯ ಸಾರಾಂಶ", observed: "ದಾಖಲಿತ ತಿಂಗಳುಗಳು", iqr: "ಮಧ್ಯದ ಅರ್ಧ ಶ್ರೇಣಿ", range: "ಶ್ರೇಣಿ", cv: "ಏರಿಳಿತದ ಗುಣಾಂಕ",
    byYear: "ವರ್ಷವಾರು ಋತುಮಾನ ದರ ಪ್ರವೃತ್ತಿ", byYearHint: "ಪ್ರತಿ ರೇಖೆ ಒಂದು ವರ್ಷ, ಇತ್ತೀಚಿನದು ಗಾಢ · ಖಾಲಿ ಜಾಗ = ದಾಖಲೆ ಇಲ್ಲದ ತಿಂಗಳು",
    byYearDescription: (variety: string) => `ವರ್ಷವಾರು ಜೋಡಿಸಿದ ${variety} ತಿಂಗಳ ದರಗಳು`,
    seasonal: "ಋತುಮಾನ ಸೂಚ್ಯಂಕ", seasonalHint: "ತಿಂಗಳ ಸರಾಸರಿ ಅದರ ವರ್ಷದ ಸರಾಸರಿಗೆ ಹೋಲಿಸಿ (100 = ವಾರ್ಷಿಕ ಸರಾಸರಿ) · ಪೂರ್ಣ ವರ್ಷಗಳು ಮಾತ್ರ", needsYears: "ಕನಿಷ್ಠ 3 ಪೂರ್ಣ ವರ್ಷ ಬೇಕು",
    withheld: "ಋತುಮಾನ ಸೂಚ್ಯಂಕ ತೋರಿಸಿಲ್ಲ", withheldHint: "ಕನಿಷ್ಠ ಮೂರು ಪೂರ್ಣ ಕ್ಯಾಲೆಂಡರ್ ವರ್ಷಗಳು ಬೇಕು.", annualMean: "ವಾರ್ಷಿಕ ಸರಾಸರಿ",
    seasonalDescription: (variety: string) => `${variety} ಋತುಮಾನ ಸೂಚ್ಯಂಕ`, completeYears: (years: string) => `ಪೂರ್ಣ ವರ್ಷಗಳು: ${years}`, none: "ಯಾವುದೂ ಇಲ್ಲ",
    yoy: "ವರ್ಷದಿಂದ ವರ್ಷದ ಬದಲಾವಣೆ", yoyHint: "ಕಳೆದ ವರ್ಷದ ಅದೇ ತಿಂಗಳಿಗೆ ಹೋಲಿಸಿ ಬದಲಾವಣೆ, ಏರಿಕೆ ಗಾಢ ಮತ್ತು ಇಳಿಕೆ ತಿಳಿ · ಎರಡೂ ತಿಂಗಳ ದಾಖಲೆ ಇದ್ದಲ್ಲಿ ಮಾತ್ರ",
    noPairs: "ಹೋಲಿಸಬಹುದಾದ ತಿಂಗಳ ಜೋಡಿಗಳಿಲ್ಲ", yoyDescription: (variety: string) => `${variety} ವರ್ಷದಿಂದ ವರ್ಷದ ಬದಲಾವಣೆ`,
    volatility: "ಮಾರುಕಟ್ಟೆ ಏರಿಳಿತ", volatilityHint: "12 ತಿಂಗಳ ಲಾಗ್ ಬದಲಾವಣೆಗಳ ವಾರ್ಷಿಕ ಪ್ರಮಾಣಿತ ವಿಚಲನ · ಹಿಂದಿನ ಏರಿಳಿತ, ಮುನ್ಸೂಚನೆಯ ಅಪಾಯವಲ್ಲ",
    needs13: "ಸತತ 13 ದಾಖಲಿತ ತಿಂಗಳು ಬೇಕು", volatilityName: "12 ತಿಂಗಳ ಏರಿಳಿತ", volatilityDescription: (variety: string) => `${variety} ಚಲಿಸುವ ಏರಿಳಿತ`,
    distribution: "ದರಗಳ ಹಂಚಿಕೆ", distributionHint: "ಪ್ರತಿ ದರ ಶ್ರೇಣಿಯಲ್ಲಿನ ದಾಖಲಿತ ತಿಂಗಳುಗಳ ಸಂಖ್ಯೆ, ಕೆಳ ಅಂಚಿನಿಂದ ಹೆಸರಿಸಲಾಗಿದೆ · ಗುರುತಿಸಿದ ತಿಂಗಳುಗಳೂ ಸೇರಿವೆ",
    monthsName: "ತಿಂಗಳುಗಳು", distributionDescription: (variety: string) => `${variety} ತಿಂಗಳ ದರಗಳ ಹಂಚಿಕೆ`,
    reviewNote: "ಪ್ರತಿ ತಿಂಗಳ ವಿಧಾನ ಮತ್ತು ಪರಿಶೀಲನಾ ಗುರುತುಗಳು ಇಲ್ಲಿವೆ:", historyLink: "ಐತಿಹಾಸಿಕ ವಿಶ್ಲೇಷಣೆ", reviewRule: (rule: string) => `ಪರಿಶೀಲನಾ ನಿಯಮ: ${rule}.`,
    arrivals: "ಆವಕ ಮತ್ತು ದರ",
    arrivalsMethod: "ಅದೇ ಮಾರುಕಟ್ಟೆ, ವರದಿ ದಿನಾಂಕ ಮತ್ತು ನಿಖರ ತಳಿಗೆ AGMARKNET ಆವಕವನ್ನು ಪರಿಶೀಲಿತ AGMARKNET ದರಗಳೊಂದಿಗೆ ಜೋಡಿಸಲಾಗಿದೆ. ತಳಿ ಇಲ್ಲದ ಸಾಲುಗಳನ್ನು ಜೋಡಿಸುವುದಿಲ್ಲ.",
    loadingPairs: "ಆವಕ ಜೋಡಿಗಳನ್ನು ತರಲಾಗುತ್ತಿದೆ", noPairsTitle: "ಜೋಡಿಸಿದ ಆವಕ ಮತ್ತು ದರ ದಾಖಲೆಗಳಿಲ್ಲ",
    noPairsMessage: "ಈ ಅವಧಿಗೆ ಅದೇ ದಿನ, ಅದೇ ತಳಿಯ AGMARKNET ಆವಕ ಮತ್ತು ದರ ಜೋಡಿಗಳಿಲ್ಲ.",
    importArrivals: "ಆವಕ ದತ್ತಾಂಶವನ್ನು ಅಧಿಕೃತ AGMARKNET ಅಥವಾ eNAM ಡೌನ್‌ಲೋಡ್‌ನಿಂದ ಆಮದು ಮಾಡಬೇಕು; ಏನನ್ನೂ ಅಂದಾಜು ಮಾಡುವುದಿಲ್ಲ.", supplyLink: "ಉತ್ಪಾದನೆ ಮತ್ತು ಬೆಳೆ ಅಪಾಯ",
    pairsAria: "ಆವಕ ಮತ್ತು ದರ ಜೋಡಿಗಳು", pairsCaption: "ಅದೇ ಮಾರುಕಟ್ಟೆ, ದಿನಾಂಕ ಮತ್ತು ತಳಿಯ ಆವಕ ಮತ್ತು ಮಾದರಿ ದರಗಳು", arrivalsTonnes: "ಆವಕ (ಟನ್)",
    pairsSummary: (n: number, low: string, high: string) => `${n} ಜೋಡಿಗಳು · ಆವಕ ${low}–${high} ಟನ್.`,
    caution: "ಆವಕ ಮತ್ತು ದರ ಜೊತೆಯಾಗಿ ಬದಲಾಗುವುದು ವಿವರಣೆ ಮಾತ್ರ; ಕಾರಣವನ್ನು ಸಾಬೀತುಪಡಿಸುವುದಿಲ್ಲ.",
    arrivalsSource: (range: string) => `AGMARKNET ಆವಕ ಮತ್ತು ಪರಿಶೀಲಿತ ದರಗಳು · ${range}`, lastYear: "ಕಳೆದ 365 ದಿನ",
  },
});

/**
 * Multi-year analysis of the Karnataka monthly AGMARKNET arrival-weighted series. Every chart uses observed
 * months only: gaps stay gaps, flagged months stay visible and no month is interpolated.
 */
export function MonthlyInsights() {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const format = useFormat();
  const to = completedMonthIST();
  const [variety, setVariety] = useState("Rashi");
  const history = useQuery({ queryKey: ["history", HISTORY_FROM, to, variety], queryFn: () => api.monthlyHistory(HISTORY_FROM, to, variety) });
  if (history.isLoading) return <LoadingState label={t.loading} />;
  if (history.error) return <ErrorState error={history.error} onRetry={() => void history.refetch()} />;
  const data = history.data!;
  const observed = data.points.filter((point) => point.weighted_price !== null);
  const years = yearMonthMatrix(data.points);
  const yoy = data.points.filter((point) => point.yoy_percent !== null);
  const vol = data.points.filter((point) => point.volatility_percent !== null);
  const yearColors = orderedRamp(years.length);
  const stats = describe(observed.map((point) => point.weighted_price));
  const bins = histogram(observed.map((point) => point.weighted_price!), 8);
  const seasonalReady = data.seasonal.some((month) => month.index !== null);
  const latestFetch = observed.at(-1)?.fetched_at ?? null;
  const source = <SourceLabel>{t.source(variety, format.month(data.from), format.month(data.to), latestFetch ? format.timestamp(latestFetch) : null)}</SourceLabel>;

  return <section className="page-stack" aria-label={t.title}>
    <div className="section-heading">
      <div><h2>{t.title}</h2><p>{t.hint(data.observed_months, data.expected_months, data.flagged_months)}</p></div>
      <label className="filter-control"><span>{t.variety}</span><select value={variety} onChange={(event) => setVariety(event.target.value)}>{data.varieties.map((value) => <option key={value} lang="en">{value}</option>)}</select></label>
    </div>
    {!observed.length ? <EmptyState title={t.noMonths}>{t.notInterpolated}</EmptyState> : <>
      <div className="metric-strip" role="list" aria-label={t.summary}>
        <div role="listitem"><span>{t.observed}</span><strong>{stats.count}</strong></div>
        <div role="listitem"><span>{c.median}</span><strong>{money(stats.median)}</strong></div>
        <div role="listitem"><span>{t.iqr}</span><strong>{money(stats.q1)} – {money(stats.q3)}</strong></div>
        <div role="listitem"><span>{t.range}</span><strong>{money(stats.min)} – {money(stats.max)}</strong></div>
        <div role="listitem"><span>{t.cv}</span><strong>{stats.cvPercent === null ? "—" : `${stats.cvPercent.toFixed(1)}%`}</strong></div>
      </div>
      <div className="chart-grid">
        <article className="panel chart-panel"><div className="panel-heading"><div><h2>{t.byYear}</h2><p>{t.byYearHint}</p></div></div>
          <LazyLineChart categories={t.months} series={years.map((year, index) => ({ name: `${year.year} (${year.observed}/12)`, values: year.values, color: yearColors[index], width: index === years.length - 1 ? 2.25 : 1.25 }))} description={t.byYearDescription(variety)} />
          <div className="chart-foot">{source}</div></article>
        <article className="panel chart-panel"><div className="panel-heading"><div><h2>{t.seasonal}</h2><p>{t.seasonalHint}</p></div>{!seasonalReady && <StatusBadge tone="warn">{t.needsYears}</StatusBadge>}</div>
          {!seasonalReady ? <EmptyState title={t.withheld}>{t.withheldHint}</EmptyState>
            : <LazyBarChart categories={t.months} values={data.seasonal.map((month) => month.index)} name={t.seasonal} valueFormat="index" referenceLine={{ value: 100, label: t.annualMean }} description={t.seasonalDescription(variety)} color={(index) => (data.seasonal[index]?.index ?? 100) >= 100 ? INK[900] : INK[400]} />}
          <div className="chart-foot"><SourceLabel>{t.completeYears(data.seasonal_years.join(", ") || t.none)}</SourceLabel></div></article>
        <article className="panel chart-panel"><div className="panel-heading"><div><h2>{t.yoy}</h2><p>{t.yoyHint}</p></div></div>
          {!yoy.length ? <EmptyState title={t.noPairs} /> : <LazyBarChart categories={yoy.map((point) => format.month(point.reporting_month))} values={yoy.map((point) => point.yoy_percent)} name={t.yoy} valueFormat="percent" referenceLine={{ value: 0 }} description={t.yoyDescription(variety)} color={(index) => (yoy[index]?.yoy_percent ?? 0) >= 0 ? INK[900] : INK[400]} />}
          <div className="chart-foot">{source}</div></article>
        <article className="panel chart-panel"><div className="panel-heading"><div><h2>{t.volatility}</h2><p>{t.volatilityHint}</p></div></div>
          {!vol.length ? <EmptyState title={t.needs13} /> : <LazyLineChart categories={vol.map((point) => format.month(point.reporting_month))} series={[{ name: t.volatilityName, values: vol.map((point) => point.volatility_percent) }]} valueFormat="percent" endLabel description={t.volatilityDescription(variety)} />}
          <div className="chart-foot">{source}</div></article>
        <article className="panel chart-panel"><div className="panel-heading"><div><h2>{t.distribution}</h2><p>{t.distributionHint}</p></div></div>
          <LazyBarChart categories={bins.map((bin) => `₹${(bin.from / 1000).toFixed(1)}k`)} tooltipLabels={bins.map((bin) => `${money(bin.from)} – ${money(bin.to)}`)} values={bins.map((bin) => bin.count)} name={t.monthsName} valueFormat="count" description={t.distributionDescription(variety)} />
          <div className="chart-foot">{source}</div></article>
        <ArrivalPricePanel />
      </div>
      <p className="panel-note">{t.reviewNote} <Link to="/history">{t.historyLink}</Link>. {t.reviewRule(data.review_method)}</p>
    </>}
  </section>;
}

/** Same-market, same-date, same-variety arrival/price pairs; an explicit empty state when no pairs exist. */
function ArrivalPricePanel() {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const format = useFormat();
  const query = useQuery({ queryKey: ["arrival-price-comparison"], queryFn: () => api.arrivalPriceComparison({}) });
  const pairs = (query.data?.pairs ?? []).filter((pair) => pair.quantity_tonnes !== null).slice().reverse();
  return <article className="panel chart-panel"><div className="panel-heading"><div><h2>{t.arrivals}</h2><p>{t.arrivalsMethod}</p></div></div>
    {query.isLoading ? <LoadingState label={t.loadingPairs} /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      : !pairs.length ? <EmptyState title={t.noPairsTitle}>{t.noPairsMessage} {t.importArrivals} <Link to="/supply">{t.supplyLink}</Link></EmptyState>
      : <div className="table-scroll" tabIndex={0} role="region" aria-label={t.pairsAria}><table><caption className="sr-only">{t.pairsCaption}</caption>
        <thead><tr><th scope="col">{c.reportingDate}</th><th scope="col">{c.market}</th><th scope="col">{c.variety}</th><th scope="col" className="numeric">{t.arrivalsTonnes}</th><th scope="col" className="numeric">{c.modal}</th></tr></thead>
        <tbody>{pairs.slice(-20).reverse().map((pair) => <tr key={`${pair.observation_date}:${pair.market}:${pair.variety}`}><td>{format.date(pair.observation_date)}</td><td className="table-market">{pair.market}</td><td lang="en">{pair.variety}</td><td className="numeric">{pair.quantity_tonnes!.toLocaleString("en-IN")}</td><td className="numeric">{money(pair.modal_price)}</td></tr>)}</tbody></table></div>}
    {pairs.length > 0 && <p className="panel-note">{t.pairsSummary(pairs.length, Math.min(...pairs.map((pair) => pair.quantity_tonnes!)).toLocaleString("en-IN"), Math.max(...pairs.map((pair) => pair.quantity_tonnes!)).toLocaleString("en-IN"))} {t.caution}</p>}
    <div className="chart-foot"><SourceLabel>{t.arrivalsSource(query.data ? `${format.date(query.data.requested_range.from)} – ${format.date(query.data.requested_range.to)}` : t.lastYear)}</SourceLabel></div>
  </article>;
}

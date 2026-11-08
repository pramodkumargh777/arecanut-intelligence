import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { CalendarDays, ShieldCheck } from "lucide-react";
import { api } from "../services/api";
import { useCommodity } from "../services/commodity";
import { ErrorState, EmptyState, LoadingState } from "../components/State";
import { MonthlyInsights } from "../components/MonthlyInsights";
import { LazyBarChart } from "../components/LazyCharts";
import { SourceLabel } from "../components/Scorecard";
import { SourceSlot } from "../components/SourceSlot";
import { crossSectionSpread, quoteSpread } from "../services/insights";
import { defineCopy, useCopy, useFormat } from "../services/language";

const COPY = defineCopy({
  en: {
    title: "Price analytics", intro: "Daily Karnataka reference index from verified, comparable market observations only.",
    reportedVariety: "Reported variety", loadingVarieties: "Loading varieties…", selectVariety: "Select variety", noVarieties: "No verified varieties",
    period: "Analysis period", periods: { "30": "Last 30 days", "90": "Last 90 days", "180": "Last 6 months", "365": "Last year", "1095": "Last 3 years", "1825": "Last 5 years" } as Record<string, string>,
    summary: "Historical summary in INR per quintal", observations: "Daily index observations", average: "Period average · INR/qtl", high: "Period high · INR/qtl",
    low: "Period low · INR/qtl", dispersion: "Price dispersion (σ) · INR/qtl", basedOn: "Based on available verified reports",
    indexTitle: "Karnataka reference index", indexHint: (variety: string) => `Median modal price for ${variety || "the selected variety"} across markets · INR / quintal`,
    method: "DOCUMENTED METHOD", loadingIndex: "Loading verified index", loadingChart: "Loading chart", notEnough: "Not enough history to chart yet", noVarietiesAvailable: "No verified varieties available",
    requires: (n: number) => `The index requires at least ${n} verified markets for a reporting date. Current imports and coverage are shown in Data quality.`,
    spreads: "Market spreads", spreadsHint: "Same-date verified quotations only · within-market spread is maximum minus minimum; cross-market spread is highest minus lowest modal price",
    loadingSpreads: "Loading market spreads", fewerThanTwo: "Fewer than two verified markets on a common date",
    spreadsOnly: "Spreads are only computed across markets reporting the same date.", oneMarket: "One market reported on the latest date.", noDaily: "No verified daily quotations are published.",
    crossMarket: "Cross-market spread", relative: "Relative to lowest", compared: "Markets compared", withinMarket: "Within-market spread",
    withinDescription: (date: string) => `Within-market price spread on ${date}`,
    spreadSource: (date: string, variety: string) => `AGMARKNET daily · verified modal, min and max · ${date} · ${variety}`, noCommonDate: "no common date", noVariety: "no variety",
    methodTitle: "Index and summary methodology",
    methodology: "For each reporting date, take the median of verified modal prices for the exact selected reported variety. Dates with fewer than the configured market-coverage threshold are withheld. Arrival-weighted prices and unverified varieties are excluded. Summary metrics are calculated from the displayed daily index: arithmetic average, observed high/low, and sample standard deviation (σ). These describe historical variation and are not forecasts.",
  },
  kn: {
    title: "ದರ ವಿಶ್ಲೇಷಣೆ", intro: "ಪರಿಶೀಲಿಸಿದ, ಹೋಲಿಸಬಹುದಾದ ಮಾರುಕಟ್ಟೆ ದಾಖಲೆಗಳಿಂದ ಮಾತ್ರ ತಯಾರಿಸಿದ ಕರ್ನಾಟಕದ ದೈನಂದಿನ ಮಾನದಂಡ ಸೂಚ್ಯಂಕ.",
    reportedVariety: "ವರದಿಯಾದ ತಳಿ", loadingVarieties: "ತಳಿಗಳನ್ನು ತರಲಾಗುತ್ತಿದೆ…", selectVariety: "ತಳಿ ಆಯ್ಕೆಮಾಡಿ", noVarieties: "ಪರಿಶೀಲಿಸಿದ ತಳಿಗಳಿಲ್ಲ",
    period: "ವಿಶ್ಲೇಷಣೆಯ ಅವಧಿ", periods: { "30": "ಕಳೆದ 30 ದಿನ", "90": "ಕಳೆದ 90 ದಿನ", "180": "ಕಳೆದ 6 ತಿಂಗಳು", "365": "ಕಳೆದ ವರ್ಷ", "1095": "ಕಳೆದ 3 ವರ್ಷ", "1825": "ಕಳೆದ 5 ವರ್ಷ" },
    summary: "ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ ರೂಪಾಯಿಗಳಲ್ಲಿ ಹಿಂದಿನ ದತ್ತಾಂಶದ ಸಾರಾಂಶ", observations: "ದೈನಂದಿನ ಸೂಚ್ಯಂಕ ದಾಖಲೆಗಳು", average: "ಅವಧಿಯ ಸರಾಸರಿ · ₹/ಕ್ವಿಂ", high: "ಅವಧಿಯ ಗರಿಷ್ಠ · ₹/ಕ್ವಿಂ",
    low: "ಅವಧಿಯ ಕನಿಷ್ಠ · ₹/ಕ್ವಿಂ", dispersion: "ದರದ ಏರಿಳಿತ (σ) · ₹/ಕ್ವಿಂ", basedOn: "ಲಭ್ಯವಿರುವ ಪರಿಶೀಲಿತ ವರದಿಗಳ ಆಧಾರದಲ್ಲಿ",
    indexTitle: "ಕರ್ನಾಟಕ ಮಾನದಂಡ ಸೂಚ್ಯಂಕ", indexHint: (variety: string) => `ಮಾರುಕಟ್ಟೆಗಳಾದ್ಯಂತ ${variety || "ಆಯ್ದ ತಳಿ"} ಮಾದರಿ ದರದ ಮಧ್ಯಮ · ₹ / ಕ್ವಿಂಟಾಲ್`,
    method: "ದಾಖಲಿತ ವಿಧಾನ", loadingIndex: "ಪರಿಶೀಲಿತ ಸೂಚ್ಯಂಕ ತರಲಾಗುತ್ತಿದೆ", loadingChart: "ಚಾರ್ಟ್ ತರಲಾಗುತ್ತಿದೆ", notEnough: "ಚಾರ್ಟ್ ಮಾಡಲು ಇನ್ನೂ ಸಾಕಷ್ಟು ಇತಿಹಾಸವಿಲ್ಲ", noVarietiesAvailable: "ಪರಿಶೀಲಿಸಿದ ತಳಿಗಳು ಲಭ್ಯವಿಲ್ಲ",
    requires: (n: number) => `ಒಂದು ವರದಿ ದಿನಾಂಕಕ್ಕೆ ಸೂಚ್ಯಂಕಕ್ಕೆ ಕನಿಷ್ಠ ${n} ಪರಿಶೀಲಿತ ಮಾರುಕಟ್ಟೆಗಳು ಬೇಕು. ಈಗಿನ ಆಮದು ಮತ್ತು ವ್ಯಾಪ್ತಿಯನ್ನು ದತ್ತಾಂಶ ಗುಣಮಟ್ಟ ಪುಟದಲ್ಲಿ ನೋಡಿ.`,
    spreads: "ಮಾರುಕಟ್ಟೆ ದರ ಅಂತರ", spreadsHint: "ಅದೇ ದಿನಾಂಕದ ಪರಿಶೀಲಿತ ದರಗಳು ಮಾತ್ರ · ಮಾರುಕಟ್ಟೆಯೊಳಗಿನ ಅಂತರ = ಗರಿಷ್ಠ ಮೈನಸ್ ಕನಿಷ್ಠ; ಮಾರುಕಟ್ಟೆಗಳ ನಡುವಿನ ಅಂತರ = ಅತಿ ಹೆಚ್ಚು ಮೈನಸ್ ಅತಿ ಕಡಿಮೆ ಮಾದರಿ ದರ",
    loadingSpreads: "ಮಾರುಕಟ್ಟೆ ಅಂತರ ತರಲಾಗುತ್ತಿದೆ", fewerThanTwo: "ಒಂದೇ ದಿನಾಂಕದಲ್ಲಿ ಎರಡಕ್ಕಿಂತ ಕಡಿಮೆ ಪರಿಶೀಲಿತ ಮಾರುಕಟ್ಟೆಗಳು",
    spreadsOnly: "ಅದೇ ದಿನಾಂಕದಂದು ವರದಿ ಮಾಡಿದ ಮಾರುಕಟ್ಟೆಗಳ ನಡುವೆ ಮಾತ್ರ ಅಂತರ ಲೆಕ್ಕ ಹಾಕಲಾಗುತ್ತದೆ.", oneMarket: "ಇತ್ತೀಚಿನ ದಿನಾಂಕದಂದು ಒಂದೇ ಮಾರುಕಟ್ಟೆ ವರದಿ ಮಾಡಿದೆ.", noDaily: "ಪರಿಶೀಲಿತ ದೈನಂದಿನ ದರಗಳು ಪ್ರಕಟವಾಗಿಲ್ಲ.",
    crossMarket: "ಮಾರುಕಟ್ಟೆಗಳ ನಡುವಿನ ಅಂತರ", relative: "ಅತಿ ಕಡಿಮೆಗೆ ಹೋಲಿಸಿ", compared: "ಹೋಲಿಸಿದ ಮಾರುಕಟ್ಟೆಗಳು", withinMarket: "ಮಾರುಕಟ್ಟೆಯೊಳಗಿನ ಅಂತರ",
    withinDescription: (date: string) => `${date} ರಂದು ಮಾರುಕಟ್ಟೆಯೊಳಗಿನ ದರ ಅಂತರ`,
    spreadSource: (date: string, variety: string) => `AGMARKNET ದೈನಂದಿನ · ಪರಿಶೀಲಿತ ಮಾದರಿ, ಕನಿಷ್ಠ ಮತ್ತು ಗರಿಷ್ಠ · ${date} · ${variety}`, noCommonDate: "ಸಾಮಾನ್ಯ ದಿನಾಂಕವಿಲ್ಲ", noVariety: "ತಳಿ ಇಲ್ಲ",
    methodTitle: "ಸೂಚ್ಯಂಕ ಮತ್ತು ಸಾರಾಂಶದ ವಿಧಾನ",
    methodology: "ಪ್ರತಿ ವರದಿ ದಿನಾಂಕಕ್ಕೆ, ಆಯ್ದ ನಿಖರ ತಳಿಯ ಪರಿಶೀಲಿತ ಮಾದರಿ ದರಗಳ ಮಧ್ಯಮವನ್ನು ತೆಗೆದುಕೊಳ್ಳಲಾಗುತ್ತದೆ. ನಿಗದಿತ ಮಾರುಕಟ್ಟೆ ವ್ಯಾಪ್ತಿಗಿಂತ ಕಡಿಮೆ ಇರುವ ದಿನಾಂಕಗಳನ್ನು ತೋರಿಸುವುದಿಲ್ಲ. ಆವಕ ಆಧಾರಿತ ದರಗಳು ಮತ್ತು ಪರಿಶೀಲಿಸದ ತಳಿಗಳನ್ನು ಸೇರಿಸುವುದಿಲ್ಲ. ಸಾರಾಂಶ ಅಂಕಿಗಳನ್ನು ತೋರಿಸಿದ ದೈನಂದಿನ ಸೂಚ್ಯಂಕದಿಂದ ಲೆಕ್ಕ ಹಾಕಲಾಗಿದೆ: ಸರಾಸರಿ, ಕಂಡ ಗರಿಷ್ಠ/ಕನಿಷ್ಠ ಮತ್ತು ಪ್ರಮಾಣಿತ ವಿಚಲನ (σ). ಇವು ಹಿಂದಿನ ಏರಿಳಿತವನ್ನು ವಿವರಿಸುತ್ತವೆ, ಮುನ್ಸೂಚನೆಗಳಲ್ಲ.",
  },
});

const PriceChart = lazy(() => import("../components/PriceChart").then((module) => ({ default: module.PriceChart })));
const money = (value: number | null) => value == null ? "—" : `₹${Math.round(value).toLocaleString("en-IN")}`;

export function AnalyticsPage() {
  const t = useCopy(COPY);
  const format = useFormat();
  const [variety, setVariety] = useState("");
  const [period, setPeriod] = useState("90");
  const { code: commodity } = useCommodity();
  const varieties = useQuery({ queryKey: ["varieties", commodity], queryFn: () => api.varieties(commodity) });
  useEffect(() => {
    if (!variety && varieties.data?.length) setVariety(varieties.data[0]);
  }, [variety, varieties.data]);
  const from = new Date();
  from.setDate(from.getDate() - Number(period));
  const index = useQuery({
    queryKey: ["reference-index", period, commodity, variety],
    queryFn: () => api.referenceIndex({ commodity, from: from.toISOString().slice(0, 10), variety }),
    enabled: Boolean(variety),
  });
  const points = index.data?.data ?? [];
  const avg = points.length ? points.reduce((sum, point) => sum + point.median_modal_price, 0) / points.length : null;
  const volatility = points.length > 1 ? Math.sqrt(points.reduce((sum, point) => sum + (point.median_modal_price - (avg ?? 0)) ** 2, 0) / (points.length - 1)) : null;
  const high = points.length ? Math.max(...points.map((point) => point.median_modal_price)) : null;
  const low = points.length ? Math.min(...points.map((point) => point.median_modal_price)) : null;
  const comparison = useQuery({ queryKey: ["market-comparison", commodity, variety], queryFn: () => api.marketComparison(variety, commodity), enabled: Boolean(variety) });
  const spreadDate = (comparison.data?.data ?? []).reduce<string | null>((latest, row) => !latest || row.reporting_date > latest ? row.reporting_date : latest, null);
  const sameDate = (comparison.data?.data ?? []).filter((row) => row.reporting_date === spreadDate);
  const marketSpread = crossSectionSpread(sameDate.map((row) => row.modal_price));
  const loading = varieties.isLoading || (Boolean(variety) && index.isLoading);
  const unavailable = loading || varieties.error || index.error;

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div><h1>{t.title}</h1><p>{t.intro}</p></div>
        <div className="analytics-filters heading-controls">
          <SourceSlot />
          <label className="variety-select"><span>{t.reportedVariety}</span>
            <select disabled={!varieties.data?.length} value={variety} onChange={(event) => setVariety(event.target.value)}>
              <option value="">{varieties.isLoading ? t.loadingVarieties : varieties.data?.length ? t.selectVariety : t.noVarieties}</option>
              {(varieties.data ?? []).map((value) => <option key={value} lang="en">{value}</option>)}
            </select>
          </label>
          <label className="period-select"><CalendarDays size={16} />
            <select aria-label={t.period} value={period} onChange={(event) => setPeriod(event.target.value)}>
              {Object.entries(t.periods).map(([days, label]) => <option key={days} value={days}>{label}</option>)}
            </select>
          </label>
        </div>
      </section>
      <section className="metric-grid" aria-label={t.summary}>
        <Metric label={t.observations} value={unavailable ? "—" : String(points.length)} hint={t.basedOn} />
        <Metric label={t.average} value={money(avg)} hint={t.basedOn} />
        <Metric label={t.high} value={money(high)} hint={t.basedOn} />
        <Metric label={t.low} value={money(low)} hint={t.basedOn} />
        <Metric label={t.dispersion} value={money(volatility)} hint={t.basedOn} />
      </section>
      <section className="panel chart-panel analytics-chart">
        <div className="panel-heading">
          <div><h2>{t.indexTitle}</h2><p>{t.indexHint(variety)}</p></div>
          <span className="method-chip"><ShieldCheck size={14} /> {t.method}</span>
        </div>
        {loading ? <LoadingState label={t.loadingIndex} />
          : varieties.error ? <ErrorState error={varieties.error} onRetry={() => void varieties.refetch()} />
          : index.error ? <ErrorState error={index.error} onRetry={() => void index.refetch()} />
          : points.length ? <Suspense fallback={<LoadingState label={t.loadingChart} />}><PriceChart points={points} /></Suspense>
          : <EmptyState title={variety ? t.notEnough : t.noVarietiesAvailable}>{t.requires(index.data?.minimum_market_coverage ?? 3)}</EmptyState>}
      </section>
      <section className="panel chart-panel">
        <div className="panel-heading"><div><h2>{t.spreads}</h2><p>{t.spreadsHint}</p></div></div>
        {comparison.isLoading && variety ? <LoadingState label={t.loadingSpreads} /> : comparison.error ? <ErrorState error={comparison.error} onRetry={() => void comparison.refetch()} />
          : sameDate.length < 2 ? <EmptyState title={t.fewerThanTwo}>{t.spreadsOnly} {sameDate.length === 1 ? t.oneMarket : t.noDaily}</EmptyState>
          : <><div className="metric-strip"><div><span>{t.crossMarket}</span><strong>{money(marketSpread.spread)}</strong></div><div><span>{t.relative}</span><strong>{marketSpread.percent === null ? "—" : `${marketSpread.percent.toFixed(1)}%`}</strong></div><div><span>{t.compared}</span><strong>{marketSpread.count}</strong></div></div>
            <LazyBarChart horizontal categories={sameDate.map((row) => row.market_name)} values={sameDate.map((row) => quoteSpread(row, row.modal_price).spread)} name={t.withinMarket} description={t.withinDescription(format.date(spreadDate))} /></>}
        <div className="chart-foot"><SourceLabel>{t.spreadSource(spreadDate ? format.date(spreadDate) : t.noCommonDate, variety || t.noVariety)}</SourceLabel></div>
      </section>
      <MonthlyInsights />
      <section className="methodology-note">
        <span className="method-icon"><ShieldCheck size={18} /></span>
        <div><strong>{t.methodTitle}</strong><p>{t.methodology}</p></div>
      </section>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

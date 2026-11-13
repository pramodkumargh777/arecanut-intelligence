import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { IntelligenceScorecard } from "../components/Scorecard";
import { lazy, Suspense } from "react";
import { ArrowDownRight, ArrowUpRight, ArrowUpRightFromSquare, CalendarDays, ChartNoAxesCombined, MapPin, ShieldCheck, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { useCommodity } from "../services/commodity";
import { ErrorState, LoadingState } from "../components/State";
import { calendarTodayIST, calendarDateToTime, DAY_MS } from "../../../shared/dates";
import { AboutData } from "../components/AboutData";
import { SourceSlot } from "../components/SourceSlot";

const PriceChart = lazy(() => import("../components/PriceChart").then((module) => ({ default: module.PriceChart })));

import { defineCopy, useCopy, useFormat } from "../services/language";
import { COMMON } from "../services/commonCopy";

const COPY = defineCopy({
  en: {
    title: "Arecanut market overview", intro: "A clear view of verified market quotations, with the source behind every number.",
    reportedVariety: "Reported variety", selectVariety: "Select variety", noVarieties: "No verified varieties", latestReport: "Latest report", noReports: "No verified reports",
    snapshot: "Market snapshot", referenceIndex: (variety: string) => `REFERENCE INDEX · ${variety || "NO VARIETY SELECTED"}`, perQuintal: "/ quintal",
    vsPrevious: (percent: string) => `(${percent}%) vs previous report`, appearsLater: "Reference value appears after sufficient verified market coverage.",
    exactVariety: (n: number) => `Exact reported variety · ${n} market${n === 1 ? "" : "s"}`,
    benchmark: (date: string) => `Latest qualifying benchmark: ${date}.`, olderPoint: "The latest market report does not meet benchmark coverage; an older chart point is not today's price.",
    reportingMarkets: "REPORTING MARKETS", markets: "markets", minimumCoverage: (n: number) => `Minimum index coverage: ${n} markets`,
    highest: "HIGHEST VERIFIED QUOTE", lowest: "LOWEST VERIFIED QUOTE", awaiting: "Awaiting verified data",
    movement: "Reference price movement", movementHint: "Daily median of verified modal prices · INR / quintal", viewAnalytics: "View analytics",
    loadingHistory: "Loading price history", loadingChart: "Loading chart", noHistory: "No publishable price history yet", noVarietiesAvailable: "No verified varieties available",
    historyLater: "History appears after source observations are reviewed and meet the minimum market coverage. Prices are never estimated to fill gaps.",
    verification: "View verification process", legend: "Reference index", coverageVaries: (n: number) => `Daily market coverage varies · ${n} markets required`,
    pulse: "Market pulse", pulseHint: "Data-led daily read", evidence: "EVIDENCE-LED", calculating: "Calculating market pulse",
    moved: (variety: string, rose: boolean, amount: string) => `${variety} reference ${rose ? "rose" : "fell"} ${amount}/qtl`,
    movedDetail: (from: string, to: string, percent: string, markets: number) => `From ${from} to ${to}, the median modal-price index changed ${percent}% across ${markets} reporting markets.`,
    historicalOnly: "Historical observation only · not a forecast or selling recommendation.",
    notEnough: "Not enough verified data yet", withheld: "Market commentary is withheld until there are at least two comparable daily index observations. No assumptions, no generated price claims.",
    multipleMarkets: "Insights require verified prices from multiple markets.", howVerified: "How data is verified",
    latestQuotes: "Latest market quotations", latestHint: (date: string, variety: string) => `Verified modal prices · ${date}${variety ? ` · ${variety}` : ""}`, exploreAll: "Explore all markets",
    loadingQuotes: "Loading quotations", quotesLater: "Quotations will appear here once a reported variety has verified observations.",
    noQuotes: "No verified quotations are available yet. Imported observations remain unpublished until reviewed.",
    tableAria: "Latest quotations, scroll horizontally for all columns", caption: "INR / quintal · Scroll horizontally for reporting dates and sources",
    minPrice: "Min price", modalPrice: "Modal price", maxPrice: "Max price", reported: "Reported",
    about: "Prices shown are market modal quotations, not individual transaction prices. Values are traceable to their source and reporting date.",
  },
  kn: {
    title: "ಅಡಿಕೆ ಮಾರುಕಟ್ಟೆ ಸಮಗ್ರ ನೋಟ", intro: "ಪರಿಶೀಲಿಸಿದ ಮಾರುಕಟ್ಟೆ ದರಗಳ ಸ್ಪಷ್ಟ ನೋಟ, ಪ್ರತಿ ಸಂಖ್ಯೆಯ ಮೂಲದೊಂದಿಗೆ.",
    reportedVariety: "ವರದಿಯಾದ ತಳಿ", selectVariety: "ತಳಿ ಆಯ್ಕೆಮಾಡಿ", noVarieties: "ಪರಿಶೀಲಿಸಿದ ತಳಿಗಳಿಲ್ಲ", latestReport: "ಇತ್ತೀಚಿನ ವರದಿ", noReports: "ಪರಿಶೀಲಿಸಿದ ವರದಿಗಳಿಲ್ಲ",
    snapshot: "ಮಾರುಕಟ್ಟೆ ಸಾರಾಂಶ", referenceIndex: (variety: string) => `ಮಾನದಂಡ ಸೂಚ್ಯಂಕ · ${variety || "ತಳಿ ಆಯ್ಕೆಯಾಗಿಲ್ಲ"}`, perQuintal: "/ ಕ್ವಿಂಟಾಲ್",
    vsPrevious: (percent: string) => `(${percent}%) ಹಿಂದಿನ ವರದಿಗೆ ಹೋಲಿಸಿ`, appearsLater: "ಸಾಕಷ್ಟು ಪರಿಶೀಲಿಸಿದ ಮಾರುಕಟ್ಟೆಗಳು ವರದಿ ಮಾಡಿದ ನಂತರ ಮಾನದಂಡ ದರ ಕಾಣಿಸುತ್ತದೆ.",
    exactVariety: (n: number) => `ವರದಿಯಾದ ನಿಖರ ತಳಿ · ${n} ಮಾರುಕಟ್ಟೆಗಳು`,
    benchmark: (date: string) => `ಇತ್ತೀಚಿನ ಅರ್ಹ ಮಾನದಂಡ: ${date}.`, olderPoint: "ಇತ್ತೀಚಿನ ಮಾರುಕಟ್ಟೆ ವರದಿ ಮಾನದಂಡದ ವ್ಯಾಪ್ತಿಯನ್ನು ತಲುಪಿಲ್ಲ; ಚಾರ್ಟ್‌ನ ಹಳೆಯ ಬಿಂದು ಇಂದಿನ ದರವಲ್ಲ.",
    reportingMarkets: "ವರದಿ ಮಾಡಿದ ಮಾರುಕಟ್ಟೆಗಳು", markets: "ಮಾರುಕಟ್ಟೆಗಳು", minimumCoverage: (n: number) => `ಸೂಚ್ಯಂಕಕ್ಕೆ ಕನಿಷ್ಠ ${n} ಮಾರುಕಟ್ಟೆಗಳು ಬೇಕು`,
    highest: "ಅತಿ ಹೆಚ್ಚಿನ ಪರಿಶೀಲಿತ ದರ", lowest: "ಅತಿ ಕಡಿಮೆ ಪರಿಶೀಲಿತ ದರ", awaiting: "ಪರಿಶೀಲಿತ ದತ್ತಾಂಶಕ್ಕೆ ಕಾಯಲಾಗುತ್ತಿದೆ",
    movement: "ಮಾನದಂಡ ದರದ ಚಲನೆ", movementHint: "ಪರಿಶೀಲಿಸಿದ ಮಾದರಿ ದರಗಳ ದೈನಂದಿನ ಮಧ್ಯಮ · ₹ / ಕ್ವಿಂಟಾಲ್", viewAnalytics: "ವಿಶ್ಲೇಷಣೆ ನೋಡಿ",
    loadingHistory: "ದರ ಇತಿಹಾಸ ತರಲಾಗುತ್ತಿದೆ", loadingChart: "ಚಾರ್ಟ್ ತರಲಾಗುತ್ತಿದೆ", noHistory: "ಪ್ರಕಟಿಸಬಹುದಾದ ದರ ಇತಿಹಾಸ ಇನ್ನೂ ಇಲ್ಲ", noVarietiesAvailable: "ಪರಿಶೀಲಿಸಿದ ತಳಿಗಳು ಲಭ್ಯವಿಲ್ಲ",
    historyLater: "ಮೂಲದ ದಾಖಲೆಗಳು ಪರಿಶೀಲನೆಯಾಗಿ ಕನಿಷ್ಠ ಮಾರುಕಟ್ಟೆ ವ್ಯಾಪ್ತಿ ತಲುಪಿದ ನಂತರ ಇತಿಹಾಸ ಕಾಣಿಸುತ್ತದೆ. ಖಾಲಿ ಜಾಗ ತುಂಬಲು ದರವನ್ನು ಎಂದೂ ಅಂದಾಜು ಮಾಡುವುದಿಲ್ಲ.",
    verification: "ಪರಿಶೀಲನಾ ಪ್ರಕ್ರಿಯೆ ನೋಡಿ", legend: "ಮಾನದಂಡ ಸೂಚ್ಯಂಕ", coverageVaries: (n: number) => `ದೈನಂದಿನ ಮಾರುಕಟ್ಟೆ ವ್ಯಾಪ್ತಿ ಬದಲಾಗುತ್ತದೆ · ${n} ಮಾರುಕಟ್ಟೆಗಳು ಬೇಕು`,
    pulse: "ಮಾರುಕಟ್ಟೆ ಸ್ಥಿತಿ", pulseHint: "ದತ್ತಾಂಶ ಆಧಾರಿತ ದೈನಂದಿನ ಓದು", evidence: "ಆಧಾರ ಸಹಿತ", calculating: "ಮಾರುಕಟ್ಟೆ ಸ್ಥಿತಿ ಲೆಕ್ಕ ಹಾಕಲಾಗುತ್ತಿದೆ",
    moved: (variety: string, rose: boolean, amount: string) => `${variety} ಮಾನದಂಡ ದರ ${amount}/ಕ್ವಿಂ ${rose ? "ಏರಿದೆ" : "ಇಳಿದಿದೆ"}`,
    movedDetail: (from: string, to: string, percent: string, markets: number) => `${from} ರಿಂದ ${to} ರವರೆಗೆ, ${markets} ಮಾರುಕಟ್ಟೆಗಳಲ್ಲಿ ಮಾದರಿ ದರದ ಮಧ್ಯಮ ಸೂಚ್ಯಂಕ ${percent}% ಬದಲಾಗಿದೆ.`,
    historicalOnly: "ಹಿಂದಿನ ದತ್ತಾಂಶದ ಗಮನಿಕೆ ಮಾತ್ರ · ಮುನ್ಸೂಚನೆ ಅಥವಾ ಮಾರಾಟದ ಸಲಹೆ ಅಲ್ಲ.",
    notEnough: "ಇನ್ನೂ ಸಾಕಷ್ಟು ಪರಿಶೀಲಿತ ದತ್ತಾಂಶವಿಲ್ಲ", withheld: "ಹೋಲಿಸಬಹುದಾದ ಕನಿಷ್ಠ ಎರಡು ದೈನಂದಿನ ಸೂಚ್ಯಂಕ ದಾಖಲೆಗಳು ಬರುವವರೆಗೆ ಮಾರುಕಟ್ಟೆ ವಿವರಣೆ ತೋರಿಸುವುದಿಲ್ಲ. ಊಹೆಗಳಿಲ್ಲ, ಕಲ್ಪಿತ ದರ ಹೇಳಿಕೆಗಳಿಲ್ಲ.",
    multipleMarkets: "ವಿವರಣೆಗೆ ಹಲವು ಮಾರುಕಟ್ಟೆಗಳ ಪರಿಶೀಲಿತ ದರಗಳು ಬೇಕು.", howVerified: "ದತ್ತಾಂಶವನ್ನು ಹೇಗೆ ಪರಿಶೀಲಿಸಲಾಗುತ್ತದೆ",
    latestQuotes: "ಇತ್ತೀಚಿನ ಮಾರುಕಟ್ಟೆ ದರಗಳು", latestHint: (date: string, variety: string) => `ಪರಿಶೀಲಿಸಿದ ಮಾದರಿ ದರಗಳು · ${date}${variety ? ` · ${variety}` : ""}`, exploreAll: "ಎಲ್ಲಾ ಮಾರುಕಟ್ಟೆಗಳನ್ನು ನೋಡಿ",
    loadingQuotes: "ದರಗಳನ್ನು ತರಲಾಗುತ್ತಿದೆ", quotesLater: "ವರದಿಯಾದ ತಳಿಗೆ ಪರಿಶೀಲಿತ ದಾಖಲೆಗಳು ಬಂದ ನಂತರ ದರಗಳು ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತವೆ.",
    noQuotes: "ಇನ್ನೂ ಪರಿಶೀಲಿತ ದರಗಳಿಲ್ಲ. ಆಮದು ಮಾಡಿದ ದಾಖಲೆಗಳು ಪರಿಶೀಲನೆಯಾಗುವವರೆಗೆ ಪ್ರಕಟವಾಗುವುದಿಲ್ಲ.",
    tableAria: "ಇತ್ತೀಚಿನ ದರಗಳು, ಎಲ್ಲಾ ಕಾಲಮ್‌ಗಳಿಗೆ ಅಡ್ಡಲಾಗಿ ಸರಿಸಿ", caption: "₹ / ಕ್ವಿಂಟಾಲ್ · ವರದಿ ದಿನಾಂಕ ಮತ್ತು ಮೂಲಕ್ಕೆ ಅಡ್ಡಲಾಗಿ ಸರಿಸಿ",
    minPrice: "ಕನಿಷ್ಠ ದರ", modalPrice: "ಮಾದರಿ ದರ", maxPrice: "ಗರಿಷ್ಠ ದರ", reported: "ವರದಿ",
    about: "ಇಲ್ಲಿನ ದರಗಳು ಮಾರುಕಟ್ಟೆಯ ಮಾದರಿ ದರಗಳು, ವೈಯಕ್ತಿಕ ವಹಿವಾಟಿನ ದರಗಳಲ್ಲ. ಪ್ರತಿ ಮೌಲ್ಯವನ್ನು ಅದರ ಮೂಲ ಮತ್ತು ವರದಿ ದಿನಾಂಕಕ್ಕೆ ಪತ್ತೆಹಚ್ಚಬಹುದು.",
  },
});

const money = (value: number | null | undefined) => value == null ? "—" : `₹${Math.round(value).toLocaleString("en-IN")}`;

export function OverviewPage() {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const format = useFormat();
  const niceDate = (date: string | null) => date ? format.date(date) : t.noReports;
  const [variety, setVariety] = useState("");
  const { code: commodity } = useCommodity();
  const varieties = useQuery({ queryKey: ["varieties", commodity], queryFn: () => api.varieties(commodity) });
  useEffect(() => {
    if (!variety && varieties.data?.length) setVariety(varieties.data[0]);
  }, [variety, varieties.data]);
  const overview = useQuery({ queryKey: ["overview", commodity, variety], queryFn: () => api.overview(variety, commodity), enabled: Boolean(variety) });
  const prices = useQuery({ queryKey: ["latest-prices", commodity, variety], queryFn: () => api.prices({ commodity, variety, limit: "8" }), enabled: Boolean(variety) });
  const index = useQuery({
    queryKey: ["reference-index", "90d", commodity, variety],
    queryFn: () => {
      const from = new Date(calendarDateToTime(calendarTodayIST()) - 90 * DAY_MS).toISOString().slice(0, 10);
      return api.referenceIndex({ commodity, from, variety });
    },
    enabled: Boolean(variety),
  });

  if (varieties.isLoading || (Boolean(variety) && overview.isLoading)) return <LoadingState />;
  if (varieties.error) return <ErrorState error={varieties.error} onRetry={() => void varieties.refetch()} />;
  if (overview.error) return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  const data = overview.data ?? {
    latest_reporting_date: null,
    benchmark_reporting_date: null,
    reference_price: null,
    previous_reference_price: null,
    absolute_change: null,
    percent_change: null,
    reporting_markets: 0,
    market_coverage_required: 3,
    index_status: "no_data" as const,
    highest_market: null,
    lowest_market: null,
    source_count: 0,
  };
  const changePositive = (data.absolute_change ?? 0) >= 0;
  const pulsePoints = index.data?.data ?? [];
  const previousPulse = pulsePoints.length > 1 ? pulsePoints[pulsePoints.length - 2] : null;
  const currentPulse = pulsePoints.length ? pulsePoints[pulsePoints.length - 1] : null;
  const pulseChange = previousPulse && currentPulse
    ? currentPulse.median_modal_price - previousPulse.median_modal_price
    : null;
  const pulsePercent = previousPulse && currentPulse && previousPulse.median_modal_price !== 0
    ? (currentPulse.median_modal_price - previousPulse.median_modal_price) / previousPulse.median_modal_price * 100
    : null;

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div><h1>{t.title}</h1><p>{t.intro}</p></div>
        <div className="heading-controls"><SourceSlot /><label className="variety-select"><span>{t.reportedVariety}</span><select disabled={!varieties.data?.length} value={variety} onChange={(event) => setVariety(event.target.value)}><option value="">{varieties.data?.length ? t.selectVariety : t.noVarieties}</option>{(varieties.data ?? []).map((value) => <option key={value} lang="en">{value}</option>)}</select></label>
</div>
        <div className="updated-chip"><CalendarDays size={14} /> {t.latestReport} <b>{niceDate(data.latest_reporting_date)}</b></div>
      </section>

      <IntelligenceScorecard feed="official" variety={variety} />

      <section className="snapshot-grid" aria-label={t.snapshot}>
        <article className="snapshot-card featured-card">
          <div className="card-kicker"><span>{t.referenceIndex(variety)}</span><TrendingUp size={18} /></div>
          <div className="snapshot-value">{data.index_status === "available" ? money(data.reference_price) : "—"}<small>{t.perQuintal}</small></div>
          {data.index_status === "available" && data.absolute_change != null ? <div className={`change-line ${changePositive ? "positive" : "negative"}`}>{changePositive ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}{money(Math.abs(data.absolute_change))} <span>{t.vsPrevious(Math.abs(data.percent_change ?? 0).toFixed(2))}</span></div> : <div className="card-hint">{t.appearsLater}</div>}
          <div className="feature-foot"><ShieldCheck size={14} /> {t.exactVariety(data.reporting_markets)}</div>
          <p>{t.benchmark(data.benchmark_reporting_date ? niceDate(data.benchmark_reporting_date) : c.unavailable)} {data.latest_reporting_date !== data.benchmark_reporting_date && t.olderPoint}</p>
        </article>
        <article className="snapshot-card">
          <div className="card-kicker"><span>{t.reportingMarkets}</span><MapPin size={16} /></div>
          <div className="snapshot-value">{data.reporting_markets}<small>{t.markets}</small></div>
          <div className="card-hint">{t.minimumCoverage(data.market_coverage_required)}</div>
          <div className="coverage-track"><span style={{ width: `${Math.min(100, data.reporting_markets / Math.max(data.market_coverage_required, 1) * 100)}%` }} /></div>
        </article>
        <article className="snapshot-card">
          <div className="card-kicker"><span>{t.highest}</span><ArrowUpRightFromSquare size={16} /></div>
          <div className="snapshot-value">{money(data.highest_market?.modal_price)}<small>{t.perQuintal}</small></div>
          <div className="market-name">{data.highest_market?.market_name ?? t.awaiting}</div>
        </article>
        <article className="snapshot-card">
          <div className="card-kicker"><span>{t.lowest}</span><ArrowDownRight size={16} /></div>
          <div className="snapshot-value">{money(data.lowest_market?.modal_price)}<small>{t.perQuintal}</small></div>
          <div className="market-name">{data.lowest_market?.market_name ?? t.awaiting}</div>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel chart-panel">
          <div className="panel-heading"><div><h2>{t.movement}</h2><p>{t.movementHint}</p></div><Link to="/analytics?feed=official" className="subtle-link">{t.viewAnalytics} <ArrowUpRightFromSquare size={14} /></Link></div>
          {index.isLoading && variety ? <LoadingState label={t.loadingHistory} /> : index.error ? <ErrorState error={index.error} onRetry={() => void index.refetch()} /> : index.data?.data.length ? <Suspense fallback={<LoadingState label={t.loadingChart} />}><PriceChart points={index.data.data} /></Suspense> : <div className="chart-empty"><ChartNoAxesCombined size={24} aria-hidden="true" /><strong>{variety ? t.noHistory : t.noVarietiesAvailable}</strong><p>{t.historyLater}</p><Link to="/data-quality" className="inline-action">{t.verification} <ArrowUpRightFromSquare size={14} /></Link></div>}
          {index.data?.data.length ? <div className="chart-meta"><span><span className="legend-line" /> {t.legend}</span><span>{t.coverageVaries(index.data.minimum_market_coverage)}</span></div> : null}
        </article>
        <article className="panel pulse-panel">
          <div className="panel-heading"><div><h2>{t.pulse}</h2><p>{t.pulseHint}</p></div><span className="pulse-badge">{t.evidence}</span></div>
          {index.isLoading && variety ? <LoadingState label={t.calculating} /> : index.error ? <ErrorState error={index.error} onRetry={() => void index.refetch()} /> : pulseChange !== null && currentPulse && previousPulse ? <div className="pulse-empty"><span className="pulse-icon"><TrendingUp size={18} /></span><strong>{t.moved(variety, pulseChange >= 0, money(Math.abs(pulseChange)))}</strong><p>{t.movedDetail(niceDate(previousPulse.reporting_date), niceDate(currentPulse.reporting_date), Math.abs(pulsePercent ?? 0).toFixed(2), currentPulse.market_count)}</p><div className="pulse-rule"><span className="pulse-rule-mark" /> {t.historicalOnly}</div></div> : <div className="pulse-empty"><span className="pulse-icon"><TrendingUp size={18} /></span><strong>{t.notEnough}</strong><p>{t.withheld}</p><div className="pulse-rule"><span className="pulse-rule-mark" /> {t.multipleMarkets}</div></div>}
          <Link to="/data-quality" className="panel-bottom-link">{t.howVerified} <ArrowUpRightFromSquare size={14} /></Link>
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>{t.latestQuotes}</h2><p>{t.latestHint(niceDate(data.latest_reporting_date), variety)}</p></div><Link to="/prices?feed=official" className="subtle-link">{t.exploreAll} <ArrowUpRightFromSquare size={14} /></Link></div>
        {prices.isLoading && variety ? <LoadingState label={t.loadingQuotes} /> : prices.error ? <ErrorState error={prices.error} onRetry={() => void prices.refetch()} /> : !variety ? <div className="table-empty">{t.quotesLater}</div> : !prices.data?.data.length ? <div className="table-empty">{t.noQuotes}</div> : <div className="table-scroll" tabIndex={0} role="region" aria-label={t.tableAria}><table><caption>{t.caption}</caption><thead><tr><th scope="col">{c.market}</th><th scope="col">{c.district}</th><th scope="col">{c.variety}</th><th scope="col" className="numeric">{t.minPrice}</th><th scope="col" className="numeric">{t.modalPrice}</th><th scope="col" className="numeric">{t.maxPrice}</th><th scope="col">{t.reported}</th><th scope="col">{c.source}</th></tr></thead><tbody>{prices.data.data.map((row) => <tr key={row.id}><td className="table-market">{row.market_name}</td><td>{row.district}</td><td lang="en">{row.variety_name}</td><td className="numeric">{money(row.minimum_price)}</td><td className="table-price numeric">{money(row.modal_price)}</td><td className="numeric">{money(row.maximum_price)}</td><td>{niceDate(row.reporting_date)}</td><td><span className="source-tag">{row.source_name}</span></td></tr>)}</tbody></table></div>}
      </section>
      <AboutData><p>{t.about}</p></AboutData>
    </div>
  );
}

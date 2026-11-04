import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { lazy, Suspense } from "react";
import { ArrowDownRight, ArrowUpRight, ArrowUpRightFromSquare, CalendarDays, ChartNoAxesCombined, MapPin, ShieldCheck, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { ErrorState, LoadingState } from "../components/State";

const PriceChart = lazy(() => import("../components/PriceChart").then((module) => ({ default: module.PriceChart })));

const money = (value: number | null | undefined) => value == null ? "—" : `₹${Math.round(value).toLocaleString("en-IN")}`;
const niceDate = (date: string | null) => date ? new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "No verified reports";

export function OverviewPage() {
  const [variety, setVariety] = useState("");
  const varieties = useQuery({ queryKey: ["varieties"], queryFn: api.varieties });
  useEffect(() => {
    if (!variety && varieties.data?.length) setVariety(varieties.data[0]);
  }, [variety, varieties.data]);
  const overview = useQuery({ queryKey: ["overview", variety], queryFn: () => api.overview(variety), enabled: Boolean(variety) });
  const prices = useQuery({ queryKey: ["latest-prices", variety], queryFn: () => api.prices({ variety, limit: "8" }), enabled: Boolean(variety) });
  const index = useQuery({
    queryKey: ["reference-index", "90d", variety],
    queryFn: () => {
      const from = new Date();
      from.setDate(from.getDate() - 90);
      return api.referenceIndex({ from: from.toISOString().slice(0, 10), variety });
    },
    enabled: Boolean(variety),
  });

  if (varieties.isLoading || (Boolean(variety) && overview.isLoading)) return <LoadingState />;
  if (varieties.error) return <ErrorState error={varieties.error} onRetry={() => void varieties.refetch()} />;
  if (overview.error) return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  const data = overview.data ?? {
    latest_reporting_date: null,
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
        <div><div className="eyebrow"><span className="eyebrow-line" />KARNATAKA MARKET BRIEFING</div><h1>Arecanut market overview</h1><p>A clear view of verified market quotations, with the source behind every number.</p></div>
        <label className="variety-select"><span>Reported variety</span><select disabled={!varieties.data?.length} value={variety} onChange={(event) => setVariety(event.target.value)}><option value="">{varieties.data?.length ? "Select variety" : "No verified varieties"}</option>{(varieties.data ?? []).map((value) => <option key={value}>{value}</option>)}</select></label>
        <div className="updated-chip"><CalendarDays size={13} /> Latest report <b>{niceDate(data.latest_reporting_date)}</b></div>
      </section>

      <section className="snapshot-grid" aria-label="Market snapshot">
        <article className="snapshot-card featured-card">
          <div className="card-kicker"><span>REFERENCE INDEX · {variety || "NO VARIETY SELECTED"}</span><TrendingUp size={17} /></div>
          <div className="snapshot-value">{data.index_status === "available" ? money(data.reference_price) : "—"}<small>/ quintal</small></div>
          {data.index_status === "available" && data.absolute_change != null ? <div className={`change-line ${changePositive ? "positive" : "negative"}`}>{changePositive ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}{money(Math.abs(data.absolute_change))} <span>({Math.abs(data.percent_change ?? 0).toFixed(2)}%) vs previous report</span></div> : <div className="card-hint">Reference value appears after sufficient verified market coverage.</div>}
          <div className="feature-foot"><ShieldCheck size={14} /> Exact reported variety · {data.reporting_markets} market{data.reporting_markets === 1 ? "" : "s"}</div>
        </article>
        <article className="snapshot-card">
          <div className="card-kicker"><span>REPORTING MARKETS</span><MapPin size={16} /></div>
          <div className="snapshot-value">{data.reporting_markets}<small>markets</small></div>
          <div className="card-hint">Minimum index coverage: {data.market_coverage_required} markets</div>
          <div className="coverage-track"><span style={{ width: `${Math.min(100, data.reporting_markets / Math.max(data.market_coverage_required, 1) * 100)}%` }} /></div>
        </article>
        <article className="snapshot-card">
          <div className="card-kicker"><span>HIGHEST VERIFIED QUOTE</span><ArrowUpRightFromSquare size={15} /></div>
          <div className="snapshot-value">{money(data.highest_market?.modal_price)}<small>/ quintal</small></div>
          <div className="market-name">{data.highest_market?.market_name ?? "Awaiting verified data"}</div>
        </article>
        <article className="snapshot-card">
          <div className="card-kicker"><span>LOWEST VERIFIED QUOTE</span><ArrowDownRight size={16} /></div>
          <div className="snapshot-value">{money(data.lowest_market?.modal_price)}<small>/ quintal</small></div>
          <div className="market-name">{data.lowest_market?.market_name ?? "Awaiting verified data"}</div>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel chart-panel">
          <div className="panel-heading"><div><h2>Reference price movement</h2><p>Daily median of verified modal prices · INR / quintal</p></div><Link to="/analytics?feed=official" className="subtle-link">View analytics <ArrowUpRightFromSquare size={14} /></Link></div>
          {index.isLoading && variety ? <LoadingState label="Loading price history" /> : index.error ? <ErrorState error={index.error} onRetry={() => void index.refetch()} /> : index.data?.data.length ? <Suspense fallback={<LoadingState label="Loading chart" />}><PriceChart points={index.data.data} /></Suspense> : <div className="chart-empty"><ChartNoAxesCombined size={28} strokeWidth={1.3} aria-hidden="true" /><strong>{variety ? "No publishable price history yet" : "No verified varieties available"}</strong><p>History appears after source observations are reviewed and meet the minimum market coverage. Prices are never estimated to fill gaps.</p><Link to="/data-quality" className="inline-action">View verification process <ArrowUpRightFromSquare size={14} /></Link></div>}
          {index.data?.data.length ? <div className="chart-meta"><span><span className="legend-line" /> Reference index</span><span>Daily market coverage varies · {index.data.minimum_market_coverage} markets required</span></div> : null}
        </article>
        <article className="panel pulse-panel">
          <div className="panel-heading"><div><h2>Market pulse</h2><p>Data-led daily read</p></div><span className="pulse-badge">EVIDENCE-LED</span></div>
          {index.isLoading && variety ? <LoadingState label="Calculating market pulse" /> : index.error ? <ErrorState error={index.error} onRetry={() => void index.refetch()} /> : pulseChange !== null && currentPulse && previousPulse ? <div className="pulse-empty"><span className="pulse-icon"><TrendingUp size={18} /></span><strong>{variety} reference {pulseChange >= 0 ? "rose" : "fell"} {money(Math.abs(pulseChange))}/qtl</strong><p>From {niceDate(previousPulse.reporting_date)} to {niceDate(currentPulse.reporting_date)}, the median modal-price index changed {Math.abs(pulsePercent ?? 0).toFixed(2)}% across {currentPulse.market_count} reporting markets.</p><div className="pulse-rule"><span className="pulse-rule-mark" /> Historical observation only · not a forecast or selling recommendation.</div></div> : <div className="pulse-empty"><span className="pulse-icon"><TrendingUp size={18} /></span><strong>Not enough verified data yet</strong><p>Market commentary is withheld until there are at least two comparable daily index observations. No assumptions, no generated price claims.</p><div className="pulse-rule"><span className="pulse-rule-mark" /> Insights require verified prices from multiple markets.</div></div>}
          <Link to="/data-quality" className="panel-bottom-link">How data is verified <ArrowUpRightFromSquare size={14} /></Link>
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Latest market quotations</h2><p>Verified modal prices · {niceDate(data.latest_reporting_date)}{variety ? ` · ${variety}` : ""}</p></div><Link to="/prices?feed=official" className="subtle-link">Explore all markets <ArrowUpRightFromSquare size={14} /></Link></div>
        {prices.isLoading && variety ? <LoadingState label="Loading quotations" /> : prices.error ? <ErrorState error={prices.error} onRetry={() => void prices.refetch()} /> : !variety ? <div className="table-empty">Quotations will appear here once a reported variety has verified observations.</div> : !prices.data?.data.length ? <div className="table-empty">No verified quotations are available yet. Imported observations remain unpublished until reviewed.</div> : <div className="table-scroll" tabIndex={0} role="region" aria-label="Latest quotations, scroll horizontally for all columns"><table><caption>INR / quintal · Scroll horizontally for reporting dates and sources</caption><thead><tr><th scope="col">Market</th><th scope="col">District</th><th scope="col">Variety</th><th scope="col" className="numeric">Min price</th><th scope="col" className="numeric">Modal price</th><th scope="col" className="numeric">Max price</th><th scope="col">Reported</th><th scope="col">Source</th></tr></thead><tbody>{prices.data.data.map((row) => <tr key={row.id}><td className="table-market">{row.market_name}</td><td>{row.district}</td><td>{row.variety_name}</td><td className="numeric">{money(row.minimum_price)}</td><td className="table-price numeric">{money(row.modal_price)}</td><td className="numeric">{money(row.maximum_price)}</td><td>{niceDate(row.reporting_date)}</td><td><span className="source-tag">{row.source_name}</span></td></tr>)}</tbody></table></div>}
      </section>
      <div className="data-disclosure"><ShieldCheck size={15} /><span>Prices shown are market modal quotations, not individual transaction prices. Values are traceable to their source and reporting date.</span></div>
    </div>
  );
}

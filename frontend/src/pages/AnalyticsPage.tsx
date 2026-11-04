import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { CalendarDays, ShieldCheck } from "lucide-react";
import { api } from "../services/api";
import { ErrorState, EmptyState, LoadingState } from "../components/State";

const PriceChart = lazy(() => import("../components/PriceChart").then((module) => ({ default: module.PriceChart })));
const money = (value: number | null) => value == null ? "—" : `₹${Math.round(value).toLocaleString("en-IN")}`;

export function AnalyticsPage() {
  const [variety, setVariety] = useState("");
  const [period, setPeriod] = useState("90");
  const varieties = useQuery({ queryKey: ["varieties"], queryFn: api.varieties });
  useEffect(() => {
    if (!variety && varieties.data?.length) setVariety(varieties.data[0]);
  }, [variety, varieties.data]);
  const from = new Date();
  from.setDate(from.getDate() - Number(period));
  const index = useQuery({
    queryKey: ["reference-index", period, variety],
    queryFn: () => api.referenceIndex({ from: from.toISOString().slice(0, 10), variety }),
    enabled: Boolean(variety),
  });
  const points = index.data?.data ?? [];
  const avg = points.length ? points.reduce((sum, point) => sum + point.median_modal_price, 0) / points.length : null;
  const volatility = points.length > 1 ? Math.sqrt(points.reduce((sum, point) => sum + (point.median_modal_price - (avg ?? 0)) ** 2, 0) / (points.length - 1)) : null;
  const high = points.length ? Math.max(...points.map((point) => point.median_modal_price)) : null;
  const low = points.length ? Math.min(...points.map((point) => point.median_modal_price)) : null;
  const loading = varieties.isLoading || (Boolean(variety) && index.isLoading);
  const unavailable = loading || varieties.error || index.error;

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" />HISTORICAL MARKET ANALYSIS</div>
          <h1>Price analytics</h1>
          <p>Daily Karnataka reference index from verified, comparable market observations only.</p>
        </div>
        <div className="analytics-filters">
          <label className="variety-select"><span>Reported variety</span>
            <select disabled={!varieties.data?.length} value={variety} onChange={(event) => setVariety(event.target.value)}>
              <option value="">{varieties.isLoading ? "Loading varieties…" : varieties.data?.length ? "Select variety" : "No verified varieties"}</option>
              {(varieties.data ?? []).map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="period-select"><CalendarDays size={16} />
            <select aria-label="Analysis period" value={period} onChange={(event) => setPeriod(event.target.value)}>
              <option value="30">Last 30 days</option><option value="90">Last 90 days</option>
              <option value="180">Last 6 months</option><option value="365">Last year</option>
              <option value="1095">Last 3 years</option><option value="1825">Last 5 years</option>
            </select>
          </label>
        </div>
      </section>
      <section className="metric-grid" aria-label="Historical summary in INR per quintal">
        <Metric label="Daily index observations" value={unavailable ? "—" : String(points.length)} />
        <Metric label="Period average · INR/qtl" value={money(avg)} />
        <Metric label="Period high · INR/qtl" value={money(high)} />
        <Metric label="Period low · INR/qtl" value={money(low)} />
        <Metric label="Price dispersion (σ) · INR/qtl" value={money(volatility)} />
      </section>
      <section className="panel chart-panel analytics-chart">
        <div className="panel-heading">
          <div><h2>Karnataka reference index</h2><p>Median modal price for {variety || "the selected variety"} across markets · INR / quintal</p></div>
          <span className="method-chip"><ShieldCheck size={14} /> DOCUMENTED METHOD</span>
        </div>
        {loading ? <LoadingState label="Loading verified index" />
          : varieties.error ? <ErrorState error={varieties.error} onRetry={() => void varieties.refetch()} />
          : index.error ? <ErrorState error={index.error} onRetry={() => void index.refetch()} />
          : points.length ? <Suspense fallback={<LoadingState label="Loading chart" />}><PriceChart points={points} /></Suspense>
          : <EmptyState title={variety ? "Not enough history to chart yet" : "No verified varieties available"}>
            The index requires at least {index.data?.minimum_market_coverage ?? 3} verified markets for a reporting date. Current imports and coverage are shown in Data quality.
          </EmptyState>}
      </section>
      <section className="methodology-note">
        <span className="method-icon"><ShieldCheck size={18} /></span>
        <div><strong>Index and summary methodology</strong>
          <p>{index.data?.methodology ?? "For each reporting date, take the median of verified modal prices for the exact selected reported variety. Dates with fewer than the configured market-coverage threshold are withheld. Arrival-weighted prices and unverified varieties are excluded."} Summary metrics are calculated from the displayed daily index: arithmetic average, observed high/low, and sample standard deviation (σ). These describe historical variation and are not forecasts.</p>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>Based on available verified reports</small></article>;
}

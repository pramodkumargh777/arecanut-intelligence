import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { describe, histogram, yearMonthMatrix } from "../services/insights";
import { completedMonthIST, formatCalendarDate, formatCalendarMonth, formatTimestampIST } from "../../../shared/dates";
import { EmptyState, ErrorState, LoadingState } from "./State";
import { LazyBarChart, LazyLineChart } from "./LazyCharts";
import { SourceLabel, StatusBadge } from "./Scorecard";
import { SERIES_COLORS } from "./chartPalette";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money = (value: number | null) => value == null ? "—" : `₹${Math.round(value).toLocaleString("en-IN")}`;
const HISTORY_FROM = "2021-01";

/**
 * Multi-year analysis of the Karnataka monthly AGMARKNET arrival-weighted series. Every chart uses observed
 * months only: gaps stay gaps, flagged months stay visible and no month is interpolated.
 */
export function MonthlyInsights() {
  const to = completedMonthIST();
  const [variety, setVariety] = useState("Rashi");
  const history = useQuery({ queryKey: ["history", HISTORY_FROM, to, variety], queryFn: () => api.monthlyHistory(HISTORY_FROM, to, variety) });
  if (history.isLoading) return <LoadingState label="Loading monthly history" />;
  if (history.error) return <ErrorState error={history.error} onRetry={() => void history.refetch()} />;
  const data = history.data!;
  const observed = data.points.filter((point) => point.weighted_price !== null);
  const years = yearMonthMatrix(data.points);
  const yoy = data.points.filter((point) => point.yoy_percent !== null);
  const vol = data.points.filter((point) => point.volatility_percent !== null);
  const stats = describe(observed.map((point) => point.weighted_price));
  const bins = histogram(observed.map((point) => point.weighted_price!), 8);
  const seasonalReady = data.seasonal.some((month) => month.index !== null);
  const latestFetch = observed.at(-1)?.fetched_at ?? null;
  const source = <SourceLabel>AGMARKNET monthly · Karnataka arrival-weighted average · {variety} · {formatCalendarMonth(data.from)} – {formatCalendarMonth(data.to)}{latestFetch ? ` · fetched ${formatTimestampIST(latestFetch)}` : ""}</SourceLabel>;

  return <section className="page-stack" aria-label="Multi-year monthly analysis">
    <div className="section-heading">
      <div><h2>Multi-year monthly analysis</h2><p>{data.observed_months} of {data.expected_months} months observed · {data.flagged_months} months carry review flags and remain visible · Price basis: arrival-weighted state average, not a modal-price index</p></div>
      <label className="filter-control"><span>Monthly variety</span><select value={variety} onChange={(event) => setVariety(event.target.value)}>{data.varieties.map((value) => <option key={value}>{value}</option>)}</select></label>
    </div>
    {!observed.length ? <EmptyState title="No observed months for this variety">Missing months are not interpolated.</EmptyState> : <>
      <div className="metric-strip" role="list" aria-label="Monthly distribution summary">
        <div role="listitem"><span>Observed months</span><strong>{stats.count}</strong></div>
        <div role="listitem"><span>Median</span><strong>{money(stats.median)}</strong></div>
        <div role="listitem"><span>Interquartile range</span><strong>{money(stats.q1)} – {money(stats.q3)}</strong></div>
        <div role="listitem"><span>Range</span><strong>{money(stats.min)} – {money(stats.max)}</strong></div>
        <div role="listitem"><span>Coefficient of variation</span><strong>{stats.cvPercent === null ? "—" : `${stats.cvPercent.toFixed(1)}%`}</strong></div>
      </div>
      <div className="chart-grid">
        <article className="panel chart-panel"><div className="panel-heading"><div><h2>Seasonal price trend by year</h2><p>Each line is one calendar year · gaps mark months without an observed value</p></div></div>
          <LazyLineChart categories={MONTHS} series={years.map((year, index) => ({ name: `${year.year} (${year.observed}/12)`, values: year.values, color: SERIES_COLORS[index % SERIES_COLORS.length] }))} description={`Monthly ${variety} prices overlaid by calendar year`} />
          <div className="chart-foot">{source}</div></article>
        <article className="panel chart-panel"><div className="panel-heading"><div><h2>Seasonal index</h2><p>Month average relative to its year's mean (100 = annual mean) · complete years only</p></div>{!seasonalReady && <StatusBadge tone="warn">Needs ≥3 complete years</StatusBadge>}</div>
          {!seasonalReady ? <EmptyState title="Seasonal index withheld">At least three complete calendar years are required.</EmptyState>
            : <LazyBarChart categories={MONTHS} values={data.seasonal.map((month) => month.index)} name="Seasonal index" valueFormat="index" referenceLine={{ value: 100, label: "Annual mean" }} description={`Seasonal index for ${variety}`} color={(index) => (data.seasonal[index]?.index ?? 100) >= 100 ? SERIES_COLORS[0] : SERIES_COLORS[1]} />}
          <div className="chart-foot"><SourceLabel>Complete years: {data.seasonal_years.join(", ") || "none"}</SourceLabel></div></article>
        <article className="panel chart-panel"><div className="panel-heading"><div><h2>Year-on-year change</h2><p>Change versus the same month of the previous year · only where both months were observed</p></div></div>
          {!yoy.length ? <EmptyState title="No comparable month pairs" /> : <LazyBarChart categories={yoy.map((point) => formatCalendarMonth(point.reporting_month))} values={yoy.map((point) => point.yoy_percent)} name="Year-on-year change" valueFormat="percent" referenceLine={{ value: 0, label: "No change" }} description={`Year-on-year change for ${variety}`} color={(index) => (yoy[index]?.yoy_percent ?? 0) >= 0 ? SERIES_COLORS[0] : SERIES_COLORS[5]} />}
          <div className="chart-foot">{source}</div></article>
        <article className="panel chart-panel"><div className="panel-heading"><div><h2>Market volatility</h2><p>Annualised standard deviation of 12 monthly log returns · historical variation, not forecast risk</p></div></div>
          {!vol.length ? <EmptyState title="Needs 13 consecutive observed months" /> : <LazyLineChart categories={vol.map((point) => formatCalendarMonth(point.reporting_month))} series={[{ name: "12-month volatility", values: vol.map((point) => point.volatility_percent) }]} valueFormat="percent" description={`Rolling volatility for ${variety}`} />}
          <div className="chart-foot">{source}</div></article>
        <article className="panel chart-panel"><div className="panel-heading"><div><h2>Price distribution</h2><p>Number of observed months in each price band · flagged months included</p></div></div>
          <LazyBarChart categories={bins.map((bin) => `${Math.round(bin.from / 1000)}k–${Math.round(bin.to / 1000)}k`)} values={bins.map((bin) => bin.count)} name="Months" valueFormat="count" description={`Distribution of monthly ${variety} prices`} />
          <div className="chart-foot">{source}</div></article>
        <ArrivalPricePanel />
      </div>
      <p className="panel-note">Methodology and review flags for each month are in <Link to="/history">Historical analytics</Link>. {data.review_method}</p>
    </>}
  </section>;
}

/** Same-market, same-date, same-variety arrival/price pairs; an explicit empty state when no pairs exist. */
function ArrivalPricePanel() {
  const query = useQuery({ queryKey: ["arrival-price-comparison"], queryFn: () => api.arrivalPriceComparison({}) });
  const pairs = (query.data?.pairs ?? []).filter((pair) => pair.quantity_tonnes !== null).slice().reverse();
  return <article className="panel chart-panel"><div className="panel-heading"><div><h2>Arrivals versus price</h2><p>{query.data?.method ?? "AGMARKNET arrivals paired with validated prices for the same market, date and variety"}</p></div></div>
    {query.isLoading ? <LoadingState label="Loading arrival pairs" /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      : !pairs.length ? <EmptyState title="No paired arrival and price records">{query.data?.message ?? "No pairs are available."} Arrival data must be imported from an authorized AGMARKNET or eNAM export; nothing is estimated. <Link to="/supply">Supply &amp; crop risk</Link></EmptyState>
      : <div className="table-scroll" tabIndex={0} role="region" aria-label="Arrival and price pairs"><table><caption className="sr-only">Arrivals and modal prices for the same market, date and variety</caption>
        <thead><tr><th scope="col">Reporting date</th><th scope="col">Market</th><th scope="col">Variety</th><th scope="col" className="numeric">Arrivals (tonnes)</th><th scope="col" className="numeric">Modal price</th></tr></thead>
        <tbody>{pairs.slice(-20).reverse().map((pair) => <tr key={`${pair.observation_date}:${pair.market}:${pair.variety}`}><td>{formatCalendarDate(pair.observation_date)}</td><td className="table-market">{pair.market}</td><td>{pair.variety}</td><td className="numeric">{pair.quantity_tonnes!.toLocaleString("en-IN")}</td><td className="numeric">{money(pair.modal_price)}</td></tr>)}</tbody></table></div>}
    {pairs.length > 0 && <p className="panel-note">{pairs.length} pairs · arrivals range {Math.min(...pairs.map((pair) => pair.quantity_tonnes!)).toLocaleString("en-IN")}–{Math.max(...pairs.map((pair) => pair.quantity_tonnes!)).toLocaleString("en-IN")} tonnes. {query.data?.caution}</p>}
    <div className="chart-foot"><SourceLabel>AGMARKNET arrivals and validated prices · {query.data ? `${query.data.requested_range.from} – ${query.data.requested_range.to}` : "last 365 days"}</SourceLabel></div>
  </article>;
}

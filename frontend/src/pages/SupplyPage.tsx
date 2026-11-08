import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { ADVISORY_LABEL, arrivalRows, estimateBadge, formatPeriod, type ForecastGate, type Granularity, type ProductionEstimate, type SupplySource } from "../services/supply";
import { formatTimestampIST } from "../../../shared/dates";

const num = (value: number | null | undefined, digits = 1) => value == null ? "—" : value.toLocaleString("en-IN", { maximumFractionDigits: digits });
const signed = (value: number | null | undefined) => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const label = (value: string) => value.replace(/_/g, " ");

function Provenance({ sources, period }: { sources: SupplySource[]; period: string }) {
  return <p className="data-disclosure">Reporting period: {period}. Source: {sources.length ? sources.map((source, index) => <span key={`${source.source_url}-${index}`}>
    {index ? "; " : ""}{source.publisher} (<a href={source.source_url} target="_blank" rel="noreferrer">document</a>{source.publication_date ? `, published ${source.publication_date}` : ""})</span>) : "none recorded"}.</p>;
}

function ForecastNotice({ gate, subject }: { gate: ForecastGate; subject: string }) {
  if (gate.status === "suppressed") return null;
  return <p className="data-disclosure">{subject} forecast: {gate.points} points available; eligible for evaluation only, not published.</p>;
}

function ProductionSection() {
  const [geography, setGeography] = useState("Karnataka");
  const production = useQuery({ queryKey: ["supply-production", geography], queryFn: () => api.supplyProduction(geography, "All India") });
  const districts = useQuery({ queryKey: ["supply-districts", geography], enabled: geography !== "All India", queryFn: () => api.supplyDistricts(geography) });
  const data = production.data;
  const comparison = new Map((data?.comparison_current ?? []).map((row) => [row.reporting_year, row]));
  const share = new Map((data?.share_of_comparison ?? []).map((row) => [row.reporting_year, row]));
  return <section className="panel table-panel" aria-labelledby="supply-production">
    <div className="panel-heading"><div><h2 id="supply-production">Production intelligence</h2><p>Area, production and yield by agricultural year, with estimate stage and revision history.</p></div>
      <label className="filter-control"><span>Geography</span><select value={geography} onChange={(event) => setGeography(event.target.value)}>
        {(data?.geographies ?? ["Karnataka", "All India"]).map((value) => <option key={value}>{value}</option>)}</select></label></div>
    {production.isLoading ? <LoadingState /> : production.error ? <ErrorState error={production.error} onRetry={() => void production.refetch()} /> : !data?.current.length ? <EmptyState title="No production estimates">No published estimates have been captured for {geography}.</EmptyState> : <>
      <Provenance sources={data.sources} period={data.reporting_period ? `${formatPeriod(data.reporting_period)} (agricultural years)` : "—"} />
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Production estimates"><table><thead><tr><th>Year</th><th>Estimate stage</th><th>Area ({data.unit.area})</th><th>Production ({data.unit.production})</th><th>Yield ({data.unit.yield})</th>
        {data.comparison_geography && data.comparison_geography !== geography ? <><th>{data.comparison_geography} production</th><th>Share</th></> : null}<th>Publication</th></tr></thead><tbody>
        {data.current.map((row: ProductionEstimate) => <tr key={row.reporting_year}><td>{row.reporting_year}</td>
          <td>{estimateBadge(row)}{row.revised ? " · revised" : ""}{row.stage_changed ? " · stage updated" : ""}</td>
          <td>{num(row.area_thousand_hectares, 3)}</td><td>{num(row.production_thousand_tonnes, 3)}</td><td>{num(row.yield_kg_hectare, 0)}</td>
          {data.comparison_geography && data.comparison_geography !== geography ? <><td>{num(comparison.get(row.reporting_year)?.production_thousand_tonnes, 3)}</td><td>{share.get(row.reporting_year)?.percent == null ? "—" : `${share.get(row.reporting_year)!.percent}%`}</td></> : null}
          <td><a href={row.source_url} target="_blank" rel="noreferrer">{row.publication_date ?? "date not stated"}</a></td></tr>)}
      </tbody></table></div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Production growth"><table><thead><tr><th>Measure</th><th>Year-on-year changes</th><th>Compound annual growth</th></tr></thead><tbody>
        {(["production", "area", "yield"] as const).map((measure) => { const growth = data.growth[measure]; return <tr key={measure}><td>{measure}</td>
          <td>{growth.yoy.map((row) => `${row.to}: ${signed(row.percent)}${row.mixed_estimate_types ? "*" : ""}`).join(" · ") || "—"}</td>
          <td>{growth.cagr ? `${signed(growth.cagr.percent)} (${growth.cagr.from}–${growth.cagr.to})${growth.cagr.mixed_estimate_types ? " *mixed estimate stages" : ""}` : "—"}</td></tr>; })}
      </tbody></table></div>
      {data.revisions.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Revision history"><table><thead><tr><th>Year</th><th>Revision</th><th>Production change</th><th>Area change</th><th>Yield change</th><th>Source</th></tr></thead><tbody>
        {data.revisions.map((row) => <tr key={`${row.reporting_year}-${row.evidence_id}`}><td>{row.reporting_year}</td><td>{label(row.previous_estimate_type ?? "—")} → {estimateBadge(row)}</td>
          <td>{num(row.change_production_thousand_tonnes, 3)}</td><td>{num(row.change_area_thousand_hectares, 3)}</td><td>{num(row.change_yield_kg_hectare, 0)}</td>
          <td><a href={row.source_url} target="_blank" rel="noreferrer">{row.publication_date ?? "document"}</a></td></tr>)}
      </tbody></table></div> : <p>No revisions recorded between estimate vintages.</p>}
      <ul>{data.notes.map((note) => <li key={note}>{note}</li>)}<li>* Growth spans different estimate stages and may change when estimates are finalised.</li></ul>
      <p className="data-disclosure">District analysis: {geography === "All India" ? "select a state." : districts.data?.districts.length ? `${districts.data.districts.length} original district records (${formatPeriod(districts.data.reporting_period)}).` : (districts.data?.message ?? data.districts.message)}</p>
      <ForecastNotice gate={data.forecast} subject="Production" />
    </>}
  </section>;
}

function ArrivalsSection() {
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const arrivals = useQuery({ queryKey: ["supply-arrivals", granularity], queryFn: () => api.supplyArrivals({ granularity }) });
  const data = arrivals.data, rows = data ? arrivalRows(data.measures) : [];
  // Nothing has been imported yet, so there is nothing to show at any period.
  if (data && !data.sources.length && !rows.length) return null;
  return <section className="panel table-panel" aria-labelledby="supply-arrivals">
    <div className="panel-heading"><div><h2 id="supply-arrivals">Market arrivals and traded quantity</h2><p>Arrival and traded quantities are separate measures and are never added together.</p></div>
      <label className="filter-control"><span>Period</span><select value={granularity} onChange={(event) => setGranularity(event.target.value as Granularity)}>
        {(["daily", "weekly", "monthly", "seasonal"] as const).map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div>
    {arrivals.isLoading ? <LoadingState /> : arrivals.error ? <ErrorState error={arrivals.error} onRetry={() => void arrivals.refetch()} /> : !data ? null : <>
      <p className="data-disclosure">Reporting period: {formatPeriod(data.reporting_period)} (requested {data.requested_range.from} to {data.requested_range.to}). Sources: {data.sources.length ? data.sources.map((source) => `${source.source_name} (imported ${formatTimestampIST(source.imported_at)})`).join("; ") : "none imported"}. Unit: {data.unit}.</p>
      {!rows.length ? <EmptyState title="No arrival records">{data.message}</EmptyState> :
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Arrivals"><table><thead><tr><th>Period</th><th>Arrivals (t)</th><th>Arrival markets</th><th>Traded (t)</th><th>Traded markets</th><th>Unknown-unit rows</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.bucket}><td>{row.bucket}</td><td>{num(row.arrival?.quantity_tonnes, 3)}</td><td>{row.arrival?.markets_reporting ?? "—"}</td>
            <td>{num(row.traded?.quantity_tonnes, 3)}</td><td>{row.traded?.markets_reporting ?? "—"}</td><td>{(row.arrival?.unknown_unit_records ?? 0) + (row.traded?.unknown_unit_records ?? 0)}</td></tr>)}
        </tbody></table></div>}
      <ul>{data.notes.map((note) => <li key={note}>{note}</li>)}</ul>
      <ForecastNotice gate={data.forecast} subject="Arrival" />
    </>}
  </section>;
}

function WeatherSection({ district, districts, setDistrict }: { district: string; districts: string[]; setDistrict: (value: string) => void }) {
  const weather = useQuery({ queryKey: ["supply-weather", district], queryFn: () => api.supplyWeather({ district }) });
  const data = weather.data, recent = (data?.history ?? []).slice(-14).reverse();
  return <section className="panel table-panel" aria-labelledby="supply-weather">
    <div className="panel-heading"><div><h2 id="supply-weather">Weather observations and forecasts</h2><p>Model-derived grid estimates are never labelled as station observations. Observations and forecasts are kept separate.</p></div>
      <label className="filter-control"><span>District</span><select value={district} onChange={(event) => setDistrict(event.target.value)}>
        {(districts.length ? districts : [district]).map((value) => <option key={value}>{value}</option>)}</select></label></div>
    {weather.isLoading ? <LoadingState /> : weather.error ? <ErrorState error={weather.error} onRetry={() => void weather.refetch()} /> : !data ? null : <>
      <p className="data-disclosure">Reporting period: {formatPeriod(data.reporting_period)}. {Object.entries(data.data_types).map(([key, text]) => `${label(key)}: ${text}`).join(" ")}
        {data.freshness.model_capture ? ` Latest model capture ${data.freshness.model_capture.latest ? formatTimestampIST(data.freshness.model_capture.latest) : "—"} (${data.freshness.model_capture.status}).` : ""}
        {data.freshness.imports.map((item) => ` ${label(item.dataset)} last imported ${formatTimestampIST(item.latest)}.`).join("")}</p>
      {!data.history.length ? <EmptyState title="No weather records">{data.message}</EmptyState> : <>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Seasonal weather"><table><thead><tr><th>Season</th><th>Data type</th><th>Coverage</th><th>Rainfall (mm)</th><th>Days ≥2.5 mm</th><th>Mean humidity (%)</th></tr></thead><tbody>
          {data.seasonal.map((row) => <tr key={`${row.key}-${row.data_type}`}><td>{row.label}</td><td>{label(row.data_type)}</td><td>{row.days_with_data}/{row.expected_days} days{row.complete ? "" : " (partial)"}</td>
            <td>{num(row.rainfall_total_mm)}</td><td>{row.rainy_days_2_5mm}</td><td>{num(row.mean_humidity_pct)}</td></tr>)}
        </tbody></table></div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Recent daily weather"><table><thead><tr><th>Date</th><th>Data type</th><th>Rain (mm)</th><th>Max °C</th><th>Min °C</th><th>Humidity (%)</th></tr></thead><tbody>
          {recent.map((row) => <tr key={`${row.day}-${row.data_type}`}><td>{row.day}</td><td>{label(row.data_type)}</td><td>{num(row.rainfall_mm)}</td><td>{num(row.temperature_max_c)}</td><td>{num(row.temperature_min_c)}</td><td>{num(row.relative_humidity_pct)}</td></tr>)}
        </tbody></table></div></>}
      {(data.forecasts.official.length > 0 || data.forecasts.model.length > 0) && <h3>Forecasts</h3>}
      {data.forecasts.official.length > 0 && <p>{data.forecasts.official.length} official forecast days imported.</p>}
      {data.forecasts.model.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Model forecast"><table><thead><tr><th>Target date</th><th>Type</th><th>Rain (mm)</th><th>Max °C</th><th>Min °C</th><th>Issued</th></tr></thead><tbody>
        {data.forecasts.model.map((row) => <tr key={`${row.target_date}-${row.provider}`}><td>{row.target_date}</td><td>{label(row.data_type)} forecast</td><td>{num(row.rainfall_mm)}</td><td>{num(row.temperature_max_c)}</td><td>{num(row.temperature_min_c)}</td><td>{formatTimestampIST(row.issued_at)}</td></tr>)}
      </tbody></table></div> : null}
      {data.warnings.length > 0 && <><h3>District warnings</h3><ul>{data.warnings.map((row) => <li key={`${row.issued_at}-${row.valid_from}-${row.phenomena}`}>{row.valid_from} to {row.valid_to}: {row.warning_level} · {row.phenomena} ({row.provider}, issued {formatTimestampIST(row.issued_at)})</li>)}</ul></>}
      <ul>{data.notes.map((note) => <li key={note}>{note}</li>)}</ul>
    </>}
  </section>;
}

function RiskSection({ district }: { district: string }) {
  const rules = useQuery({ queryKey: ["supply-risk-rules"], queryFn: () => api.supplyRiskRules() });
  const advisories = useQuery({ queryKey: ["supply-advisories", district], queryFn: () => api.supplyAdvisories(district) });
  const latest = (rules.data?.rules ?? []).filter((rule) => rule.latest_version);
  // Rules stay unpublished until an expert approves them; readers see this section once there is an advisory to read.
  if (!advisories.data?.advisories.length) return null;
  return <section className="panel table-panel" aria-labelledby="supply-risk">
    <div className="panel-heading"><div><h2 id="supply-risk">Arecanut crop-risk advisories</h2><p>Rule-based watch levels from expert-approved ICAR-CPCRI criteria. Never a diagnosis.</p></div></div>
    {advisories.isLoading ? <LoadingState /> : advisories.error ? <ErrorState error={advisories.error} onRetry={() => void advisories.refetch()} /> : advisories.data ? <>
      <p className="data-disclosure">{advisories.data.disclaimer} Evaluated for {advisories.data.district} as of {advisories.data.as_of}; weather basis {formatPeriod(advisories.data.weather_basis.period)} ({advisories.data.weather_basis.data_types.map((item) => label(item.type)).join(", ") || "no weather data"}).</p>
      {advisories.data.advisories.length ? <ul>{advisories.data.advisories.map((item) => <li key={item.rule_id}><strong>{item.hazard_name}: {ADVISORY_LABEL[item.level]}</strong>. {item.message}</li>)}</ul>
        : <EmptyState title="No advisory issued">{advisories.data.message}</EmptyState>}
    </> : null}
    {rules.isLoading ? <LoadingState /> : rules.error ? <ErrorState error={rules.error} /> : <>
      <p>{rules.data?.policy}</p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Risk rules"><table><thead><tr><th>Hazard</th><th>Version</th><th>Status</th><th>Weather relevance</th><th>Evidence</th><th>Approval blockers</th></tr></thead><tbody>
        {latest.map((rule) => <tr key={rule.id}><td>{rule.hazard_name}{rule.causal_agent ? <><br /><small>{rule.causal_agent}</small></> : null}</td><td>v{rule.version}</td><td>{label(rule.status)}</td><td>{label(rule.weather_relevance)}</td>
          <td>{rule.citations.length ? rule.citations.map((citation) => <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer">{citation.publisher}</a>) : `No verified citation (${rule.citation_status})`}</td>
          <td>{rule.approval_blockers.length ? rule.approval_blockers.join(" ") : "None"}</td></tr>)}
      </tbody></table></div></>}
  </section>;
}

export function SupplyPage() {
  const [district, setDistrict] = useState("Uttara Kannada");
  const weatherDistricts = useQuery({ queryKey: ["supply-weather", district], queryFn: () => api.supplyWeather({ district }) });
  return <div className="page-stack">
    <section className="page-heading"><div><h1>Supply and weather</h1>
      <p>Government production estimates and weather datasets. Every table states its source and reporting period.</p></div></section>
    <ProductionSection />
    <ArrivalsSection />
    <WeatherSection district={district} districts={weatherDistricts.data?.districts ?? []} setDistrict={setDistrict} />
    <RiskSection district={district} />
  </div>;
}

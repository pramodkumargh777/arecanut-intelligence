import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { toCsv } from "../services/csv";
import type { Production, Trade, Weather, Bulletin, Evidence, ModuleDomain } from "../services/modules";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
const domains = ["production", "weather", "trade", "policy", "news", "quality"] as const;
export function IntelligenceNavigation({ current }: { current: string }) {
  return <nav className="module-navigation" aria-label="Intelligence modules">{domains.map((domain) => <Link key={domain} to={`/intelligence/${domain}`} aria-current={current === domain ? "page" : undefined}>{domain[0].toUpperCase() + domain.slice(1)}</Link>)}</nav>;
}
const number = (value: number | null) => value === null ? "Not reported" : value.toLocaleString("en-IN", { maximumFractionDigits: 3 });
export function exportModule(rows: (string | number | null)[][], name: string) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}
function EvidenceCell({ row }: { row: Evidence }) {
  return <><a href={row.source_url} target="_blank" rel="noreferrer">Publisher</a>{" · "}<a href={api.sourceCaptureUrl(row.capture_id)}>Archived capture</a><small className="quote-fetch">Fetched {new Date(row.fetched_at).toLocaleString("en-IN")}</small>{row.publication_period && <small className="quote-fetch">Document publication: {row.publication_period}</small>}</>;
}
type ModuleRow = Production | Trade | Weather | Bulletin;
export function IntelligencePage() {
  const domain = useParams().domain ?? "production";
  const supported = domains.some((value) => value === domain) && domain !== "quality";
  const [period, setPeriod] = useState(""), [geography, setGeography] = useState(""), [token, setToken] = useState("");
  const [notice, setNotice] = useState("");
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["intelligence", domain], queryFn: () => api.intelligence<ModuleRow>(domain as ModuleDomain), enabled: supported, refetchInterval: 60_000 });
  const refresh = useMutation({ mutationFn: () => api.refreshIntelligence(domain === "weather" ? "weather" : "news", token),
    onSuccess: async () => { setNotice("Source capture refreshed."); await client.invalidateQueries({ queryKey: ["intelligence"] }); },
    onSettled: async () => { await client.invalidateQueries({ queryKey: ["intelligence"] }); } });
  useEffect(() => { setPeriod(""); setGeography(""); setToken(""); setNotice(""); refresh.reset(); }, [domain]);
  if (!supported) return <ErrorState error={new Error("Select an available intelligence module.")} />;
  const data = query.data;
  const rows = data?.data ?? [];
  const periods = [...new Set(rows.flatMap((row) => "period" in row ? [row.period] : []))].sort().reverse();
  const places = [...new Set(rows.flatMap((row) => "geography" in row ? [row.geography] : "partner" in row ? [row.partner] : []))].sort();
  const filtered = rows.filter((row) => (!period || !("period" in row) || row.period === period)
    && (!geography || ("geography" in row ? row.geography === geography : "partner" in row ? row.partner === geography : true)));
  const latest = rows.reduce<string | null>((value, row) => !value || row.fetched_at > value ? row.fetched_at : value, null);
  const staleWeather = domain === "weather" && latest !== null && Date.now() - Date.parse(latest) > 24 * 60 * 60_000;
  const title = domain === "weather" ? "Sirsi weather" : domain === "production" ? "Production & crop area" : domain === "trade" ? "Arecanut trade" : domain === "policy" ? "Policy notices" : "Official source news";
  function exportRows() {
    const header = domain === "production" ? ["period", "geography", "estimate_status", "area_thousand_hectares", "production_thousand_tonnes", "yield_kg_hectare"]
      : domain === "trade" ? ["period", "partner", "direction", "quantity_tonnes", "value_inr_lakh"] : domain === "weather" ? ["date", "kind_at_capture", "maximum_c", "minimum_c", "precipitation_mm", "grid_latitude", "grid_longitude"]
      : ["release_id", "title", "published_on"];
    exportModule([[...header, "source_url", "publication_period", "fetched_at", "capture_id", "content_hash"],
      ...filtered.map((row) => {
        const values = "geography" in row ? [row.period, row.geography, row.estimate_status, row.area_thousand_hectares, row.production_thousand_tonnes, row.yield_kg_hectare]
          : "partner" in row ? [row.period, row.partner, row.direction, row.quantity_tonnes, row.value_inr_lakh]
          : "date" in row ? [row.date, row.kind, row.temperature_max_c, row.temperature_min_c, row.precipitation_mm, row.grid_latitude, row.grid_longitude]
          : [row.release_id, row.title, row.published_on];
        return [...values, row.source_url, row.publication_period, row.fetched_at, row.capture_id, row.content_hash];
      })], `ani-${domain}.csv`);
  }
  return <div className="page-stack">
    <section className="page-heading"><div><div className="eyebrow">INDEPENDENT SOURCE INTELLIGENCE</div><h1>{title}</h1><p>Source-specific reporting periods, original units and retained evidence. No inferred price impact.</p></div></section>
    <IntelligenceNavigation current={domain} />
    {query.isLoading ? <LoadingState /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : data && <>
      <div className="data-disclosure">{data.coverage}</div>
      {staleWeather && <div role="alert" className="data-disclosure">Weather capture is more than 24 hours old. Refresh before relying on its dates; a forecast at capture is not necessarily a current forecast.</div>}
      <section className="snapshot-grid">
        <article className="snapshot-card"><div className="card-kicker">STORED RECORDS</div><div className="snapshot-value">{rows.length}</div><p>{new Set(rows.map((row) => row.capture_id)).size} current source captures; older captures retained</p></article>
        <article className="snapshot-card"><div className="card-kicker">LATEST FETCH</div><div className="snapshot-value snapshot-date">{latest ? new Date(latest).toLocaleDateString("en-IN") : "Never"}</div><p>{latest ? new Date(latest).toLocaleTimeString("en-IN") : "Source not captured"} · Not the reporting period</p></article>
        <article className="snapshot-card"><div className="card-kicker">SOURCE COVERAGE</div><div className="snapshot-value">{domain === "weather" ? "Sirsi" : "India"}</div><p>{domain === "weather" ? "Open-Meteo gridded model; recent and future model days" : domain === "trade" ? "Annual imports; one annual export aggregate" : domain === "production" ? "DASD annual estimates; state and national" : "Curated PIB / DASD publications"}</p></article>
      </section>
      {(periods.length > 0 || places.length > 0) && <section className="filter-bar">
        <label className="filter-control"><span>Reporting year</span><select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="">All available years</option>{periods.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="filter-control"><span>{domain === "trade" ? "Trading partner" : "Geography"}</span><select value={geography} onChange={(event) => setGeography(event.target.value)}><option value="">All available</option>{places.map((value) => <option key={value}>{value}</option>)}</select></label>
        <button className="button-secondary" onClick={() => { setPeriod(""); setGeography(""); }}>Reset filters</button>
      </section>}
      <section className="panel table-panel"><div className="panel-heading"><div><h2>Source records</h2><p>{filtered.length} displayed · {domain === "production" || domain === "trade" ? "Financial/agricultural year labels are preserved exactly as published." : "Publication dates and fetch timestamps are independent."}</p></div><button className="button-secondary" disabled={!filtered.length} onClick={exportRows}>Export {domain} CSV</button></div>
        {!filtered.length ? <EmptyState title={rows.length ? "No records match these filters" : "No captured source records"}>{rows.length ? "Reset the filters to see available source periods." : "Use the authenticated source refresh below. Missing data is not estimated."}</EmptyState> :
          <div className="table-scroll" tabIndex={0} role="region" aria-label={`${title} records`}><table>
            <caption>{domain === "weather" ? "Daily model output in Asia/Kolkata · Not measured farm conditions" : title}</caption>
            <thead><tr>{(domain === "production" ? ["Geography", "Reporting year", "Estimate", "Area ('000 ha)", "Production ('000 tonnes)", "Yield (kg/ha)"]
              : domain === "trade" ? ["Partner", "Reporting year", "Direction", "Quantity (tonnes)", "Value (INR lakh)"] : domain === "weather" ? ["Date", "Type at capture", "Maximum (°C)", "Minimum (°C)", "Rain (mm)"]
              : ["Release", "Publication date"]).map((label) => <th key={label}>{label}</th>)}<th>Source / freshness</th></tr></thead>
            <tbody>{filtered.map((row) => <tr key={`${row.capture_id}:${"geography" in row ? `${row.geography}:${row.period}` : "partner" in row ? `${row.partner}:${row.period}` : "date" in row ? row.date : row.release_id}`}>
              {"geography" in row ? <><td>{row.geography}</td><td>{row.period}</td><td>{row.estimate_status}</td><td className="numeric">{number(row.area_thousand_hectares)}</td><td className="numeric">{number(row.production_thousand_tonnes)}</td><td className="numeric">{number(row.yield_kg_hectare)}</td></>
                : "partner" in row ? <><td>{row.partner}</td><td>{row.period}</td><td>{row.direction}</td><td className="numeric">{number(row.quantity_tonnes)}</td><td className="numeric">{number(row.value_inr_lakh)}</td></>
                : "date" in row ? <><td>{row.date}</td><td>{row.kind === "recent_model" ? "Recent model estimate" : "Forecast model"}</td><td className="numeric">{number(row.temperature_max_c)}</td><td className="numeric">{number(row.temperature_min_c)}</td><td className="numeric">{number(row.precipitation_mm)}</td></>
                : <><td>{row.title}<small className="quote-fetch">{row.source_key.startsWith("pib") ? "PIB release" : "DASD announcement"} · {row.release_id}</small></td><td>{row.published_on}</td></>}
              <td><EvidenceCell row={row} /></td>
            </tr>)}</tbody></table></div>}
      </section>
      {domain === "weather" && rows.length > 0 && "grid_latitude" in rows[0] && <p className="data-disclosure">Returned model grid: {rows[0].grid_latitude}, {rows[0].grid_longitude} · Elevation {rows[0].elevation_m} m. Open-Meteo attribution: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · <a href="https://open-meteo.com/en/terms" target="_blank" rel="noreferrer">Terms</a>. Free API is for non-commercial evaluation; commercial use requires the appropriate service terms.</p>}
      <section className="panel"><div className="panel-heading"><div><h2>Refresh & source health</h2><p>Existing valid captures remain visible if a refresh fails. Re-fetching a historical release does not make it current news.</p></div></div><div className="monthly-details">
        {domain === "production" || domain === "trade" ? <p>Refresh verified official PDF tables locally with <code>npm run refresh:intelligence</code>. This archives the original PDFs and validates positioned columns, units and reporting years. Layout changes fail explicitly.</p>
          : <form className="monthly-refresh" onSubmit={(event) => { event.preventDefault(); setNotice(""); refresh.mutate(); }}><label className="filter-control"><span>Source refresh reviewer token</span><input type="password" autoComplete="off" required disabled={refresh.isPending} value={token} onChange={(event) => setToken(event.target.value)} /></label><button className="button-secondary" disabled={refresh.isPending}>{refresh.isPending ? "Capturing..." : domain === "weather" ? "Refresh Sirsi weather" : "Refresh official releases"}</button><button type="button" className="button-secondary" disabled={refresh.isPending} onClick={() => { setToken(""); setNotice(""); refresh.reset(); }}>Clear token</button></form>}
        {refresh.error && <ErrorState error={refresh.error} />}{notice && <p role="status">{notice}</p>}
        <details><summary>Recent capture attempts</summary><ul>{data.attempts.map((attempt) => <li key={attempt.id}>{attempt.source_key} · {attempt.status} · {new Date(attempt.started_at).toLocaleString("en-IN")}{attempt.error_message && ` · ${attempt.error_message}`}</li>)}</ul>{!data.attempts.length && <p>No attempts recorded.</p>}</details>
      </div></section>
    </>}
  </div>;
}

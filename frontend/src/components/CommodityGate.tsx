import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { gradeOptions, routeAvailable, routeCapability, varietyOptions, type CommodityDef } from "../../../shared/commodities";
import { useCommodity } from "../services/commodity";
import { ErrorState } from "./State";

const capabilityNames: Record<string, string> = {
  market_data: "market price data", monthly_history: "monthly history", forecast: "forecast baselines", calculators: "decision calculators",
  quality: "quality inspections", production: "production statistics", trade: "trade statistics", weather: "weather intelligence", intelligence: "source intelligence",
};

/** Renders the route only when the selected commodity has an integrated source for it; otherwise shows its configured profile. */
export function CommodityGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { code, commodity, catalogStatus } = useCommodity();
  if (routeAvailable(commodity, pathname)) return <>{children}</>;
  if (!commodity) {
    return catalogStatus === "loading" ? null : <ErrorState error={new Error(catalogStatus === "fallback"
      ? `The commodity catalogue is unavailable, so "${code}" cannot be shown. Arecanut remains available.`
      : `Unknown commodity "${code}". Select a configured commodity.`)} />;
  }
  return <CommodityProfile commodity={commodity} missing={capabilityNames[routeCapability(pathname) ?? ""] ?? "this page"} />;
}

function CommodityProfile({ commodity, missing }: { commodity: CommodityDef; missing: string }) {
  const { unitText: unit } = useCommodity();
  const varieties = varietyOptions(commodity);
  const grades = gradeOptions(commodity);
  const integrated = Object.entries(commodity.capabilities);
  const unitStatus = commodity.config?.config_status === "verified" ? "verified" : "reference configuration — unverified against a live source";
  return <div className="page-stack">
    <section className="page-heading"><div>
      <h1>{commodity.display_name}</h1>
      <p>No integrated source provides {missing} for {commodity.display_name.toLowerCase()} yet. Nothing is estimated or substituted; this page lists the configured classification only.</p></div></section>
    <div className="data-disclosure"><span>Default unit: {unit} ({unitStatus}). Grading system: {commodity.config?.grading_system ?? "not configured"}.{commodity.config?.notes ? ` ${commodity.config.notes}` : ""}</span></div>
    <section className="content-grid">
      <article className="panel table-panel"><div className="panel-heading"><div><h2>Varieties and forms</h2><p>{varieties.length ? "Commodity-specific classification. Unverified items are not mapped to any source." : "No variety classification configured; grades describe this commodity."}</p></div></div>
        {varieties.length > 0 && <div className="table-scroll" tabIndex={0} role="region" aria-label={`${commodity.display_name} varieties`}><table><caption>{commodity.display_name} varieties</caption>
          <thead><tr><th scope="col">Variety</th><th scope="col">Type</th><th scope="col">Unit</th><th scope="col">Status</th></tr></thead>
          <tbody>{varieties.map((variety) => <tr key={variety.id}><td>{variety.label}</td><td>{variety.classification_type.replace(/_/g, " ")}</td><td>{variety.unit_code ?? "Commodity default"}</td><td><span className="source-tag">{variety.mapping_status}</span></td></tr>)}</tbody></table></div>}
      </article>
      <article className="panel table-panel"><div className="panel-heading"><div><h2>Grades</h2><p>Grades belong to this commodity only and are never shared across commodities.</p></div></div>
        {grades.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label={`${commodity.display_name} grades`}><table><caption>{commodity.display_name} grades</caption>
          <thead><tr><th scope="col">Grade</th><th scope="col">Type</th><th scope="col">Applies to</th><th scope="col">Status</th></tr></thead>
          <tbody>{grades.map((grade) => <tr key={grade.id}><td>{grade.label}</td><td>{grade.grade_type.replace(/_/g, " ")}</td><td>{commodity.varieties.find((variety) => variety.id === grade.variety_id)?.label ?? "All"}</td><td><span className="source-tag">{grade.mapping_status}</span></td></tr>)}</tbody></table></div>
          : <p>No grades configured.</p>}
      </article>
    </section>
    <section className="panel"><div className="panel-heading"><div><h2>Integrated sources</h2><p>{integrated.length ? integrated.map(([capability, value]) => `${capability.replace(/_/g, " ")}: ${value.status}${value.note ? ` (${value.note})` : ""}`).join(" · ") : "None. Add a source connector before any prices are shown."}</p></div>
      <Link className="text-button" to="/data-quality">Data quality</Link></div></section>
  </div>;
}

import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { gradeOptions, routeAvailable, routeCapability, varietyOptions, type CommodityDef } from "../../../shared/commodities";
import { useCommodity } from "../services/commodity";
import { defineCopy, useCopy } from "../services/language";
import { ErrorState } from "./State";

const COPY = defineCopy({
  en: {
    capabilities: {
      market_data: "market price data", monthly_history: "monthly history", forecast: "forecast baselines", calculators: "decision calculators",
      quality: "quality inspections", production: "production statistics", trade: "trade statistics", weather: "weather intelligence", intelligence: "source intelligence",
    } as Record<string, string>,
    thisPage: "this page",
    catalogueDown: (code: string) => `The commodity catalogue is unavailable, so "${code}" cannot be shown. Arecanut remains available.`,
    unknown: (code: string) => `Unknown commodity "${code}". Select a configured commodity.`,
    noSource: (missing: string, commodity: string) => `No integrated source provides ${missing} for ${commodity} yet. Nothing is estimated or substituted; this page lists the configured classification only.`,
    verified: "verified", unverified: "reference configuration — unverified against a live source",
    unit: (unit: string, status: string, grading: string, notes: string) => `Default unit: ${unit} (${status}). Grading system: ${grading}.${notes}`, notConfigured: "not configured",
    varieties: "Varieties and forms", varietiesHint: (has: boolean) => has ? "Commodity-specific classification. Unverified items are not mapped to any source." : "No variety classification configured; grades describe this commodity.",
    varietiesCaption: (commodity: string) => `${commodity} varieties`, variety: "Variety", type: "Type", unitCol: "Unit", status: "Status", commodityDefault: "Commodity default",
    grades: "Grades", gradesHint: "Grades belong to this commodity only and are never shared across commodities.", gradesCaption: (commodity: string) => `${commodity} grades`,
    grade: "Grade", appliesTo: "Applies to", all: "All", noGrades: "No grades configured.",
    sources: "Integrated sources", noSources: "None. Add a source connector before any prices are shown.", dataQuality: "Data quality",
  },
  kn: {
    capabilities: {
      market_data: "ಮಾರುಕಟ್ಟೆ ದರ ದತ್ತಾಂಶ", monthly_history: "ತಿಂಗಳ ಇತಿಹಾಸ", forecast: "ಮುನ್ಸೂಚನೆ ಅಂದಾಜುಗಳು", calculators: "ಲೆಕ್ಕಾಚಾರ ಸಾಧನಗಳು",
      quality: "ಗುಣಮಟ್ಟ ಪರಿಶೀಲನೆಗಳು", production: "ಉತ್ಪಾದನಾ ಅಂಕಿಅಂಶ", trade: "ವ್ಯಾಪಾರ ಅಂಕಿಅಂಶ", weather: "ಹವಾಮಾನ ಮಾಹಿತಿ", intelligence: "ಮೂಲದ ಮಾಹಿತಿ",
    },
    thisPage: "ಈ ಪುಟ",
    catalogueDown: (code: string) => `ಬೆಳೆಗಳ ಪಟ್ಟಿ ಲಭ್ಯವಿಲ್ಲ, ಆದ್ದರಿಂದ "${code}" ತೋರಿಸಲಾಗದು. ಅಡಿಕೆ ಲಭ್ಯವಿದೆ.`,
    unknown: (code: string) => `"${code}" ಎಂಬ ಬೆಳೆ ಗೊತ್ತಿಲ್ಲ. ಹೊಂದಿಸಿದ ಬೆಳೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ.`,
    noSource: (missing: string, commodity: string) => `${commodity} ಗೆ ${missing} ನೀಡುವ ಯಾವುದೇ ಮೂಲ ಇನ್ನೂ ಸಂಪರ್ಕಿಸಿಲ್ಲ. ಏನನ್ನೂ ಅಂದಾಜು ಮಾಡುವುದಿಲ್ಲ ಅಥವಾ ಬದಲಿಸುವುದಿಲ್ಲ; ಈ ಪುಟ ಹೊಂದಿಸಿದ ವರ್ಗೀಕರಣವನ್ನು ಮಾತ್ರ ತೋರಿಸುತ್ತದೆ.`,
    verified: "ದೃಢಪಟ್ಟಿದೆ", unverified: "ಉಲ್ಲೇಖ ಹೊಂದಿಕೆ — ನೇರ ಮೂಲದಿಂದ ದೃಢಪಟ್ಟಿಲ್ಲ",
    unit: (unit: string, status: string, grading: string, notes: string) => `ಮೂಲ ಘಟಕ: ${unit} (${status}). ದರ್ಜೆ ವ್ಯವಸ್ಥೆ: ${grading}.${notes}`, notConfigured: "ಹೊಂದಿಸಿಲ್ಲ",
    varieties: "ತಳಿಗಳು ಮತ್ತು ರೂಪಗಳು", varietiesHint: (has: boolean) => has ? "ಈ ಬೆಳೆಗೆ ಮಾತ್ರ ಸೇರಿದ ವರ್ಗೀಕರಣ. ದೃಢಪಡದವುಗಳನ್ನು ಯಾವ ಮೂಲಕ್ಕೂ ಜೋಡಿಸಿಲ್ಲ." : "ತಳಿ ವರ್ಗೀಕರಣ ಹೊಂದಿಸಿಲ್ಲ; ದರ್ಜೆಗಳು ಈ ಬೆಳೆಯನ್ನು ವಿವರಿಸುತ್ತವೆ.",
    varietiesCaption: (commodity: string) => `${commodity} ತಳಿಗಳು`, variety: "ತಳಿ", type: "ವಿಧ", unitCol: "ಘಟಕ", status: "ಸ್ಥಿತಿ", commodityDefault: "ಬೆಳೆಯ ಮೂಲ ಘಟಕ",
    grades: "ದರ್ಜೆಗಳು", gradesHint: "ದರ್ಜೆಗಳು ಈ ಬೆಳೆಗೆ ಮಾತ್ರ ಸೇರಿವೆ; ಬೇರೆ ಬೆಳೆಗಳೊಂದಿಗೆ ಹಂಚಿಕೊಳ್ಳುವುದಿಲ್ಲ.", gradesCaption: (commodity: string) => `${commodity} ದರ್ಜೆಗಳು`,
    grade: "ದರ್ಜೆ", appliesTo: "ಅನ್ವಯಿಸುವುದು", all: "ಎಲ್ಲಾ", noGrades: "ಯಾವುದೇ ದರ್ಜೆ ಹೊಂದಿಸಿಲ್ಲ.",
    sources: "ಸಂಪರ್ಕಿತ ಮೂಲಗಳು", noSources: "ಯಾವುದೂ ಇಲ್ಲ. ದರ ತೋರಿಸುವ ಮೊದಲು ಮೂಲ ಸಂಪರ್ಕಿಸಿ.", dataQuality: "ದತ್ತಾಂಶ ಗುಣಮಟ್ಟ",
  },
});

/** Renders the route only when the selected commodity has an integrated source for it; otherwise shows its configured profile. */
export function CommodityGate({ children }: { children: ReactNode }) {
  const t = useCopy(COPY);
  const { pathname } = useLocation();
  const { code, commodity, catalogStatus } = useCommodity();
  if (routeAvailable(commodity, pathname)) return <>{children}</>;
  if (!commodity) {
    return catalogStatus === "loading" ? null : <ErrorState error={new Error(catalogStatus === "fallback" ? t.catalogueDown(code) : t.unknown(code))} />;
  }
  return <CommodityProfile commodity={commodity} missing={t.capabilities[routeCapability(pathname) ?? ""] ?? t.thisPage} />;
}

function CommodityProfile({ commodity, missing }: { commodity: CommodityDef; missing: string }) {
  const t = useCopy(COPY);
  const { unitText: unit } = useCommodity();
  const varieties = varietyOptions(commodity);
  const grades = gradeOptions(commodity);
  const integrated = Object.entries(commodity.capabilities);
  const unitStatus = commodity.config?.config_status === "verified" ? t.verified : t.unverified;
  return <div className="page-stack">
    <section className="page-heading"><div>
      <h1>{commodity.display_name}</h1>
      <p>{t.noSource(missing, commodity.display_name.toLowerCase())}</p></div></section>
    <div className="data-disclosure"><span>{t.unit(unit, unitStatus, commodity.config?.grading_system ?? t.notConfigured, commodity.config?.notes ? ` ${commodity.config.notes}` : "")}</span></div>
    <section className="content-grid">
      <article className="panel table-panel"><div className="panel-heading"><div><h2>{t.varieties}</h2><p>{t.varietiesHint(varieties.length > 0)}</p></div></div>
        {varieties.length > 0 && <div className="table-scroll" tabIndex={0} role="region" aria-label={t.varietiesCaption(commodity.display_name)}><table><caption>{t.varietiesCaption(commodity.display_name)}</caption>
          <thead><tr><th scope="col">{t.variety}</th><th scope="col">{t.type}</th><th scope="col">{t.unitCol}</th><th scope="col">{t.status}</th></tr></thead>
          <tbody>{varieties.map((variety) => <tr key={variety.id}><td>{variety.label}</td><td>{variety.classification_type.replace(/_/g, " ")}</td><td>{variety.unit_code ?? t.commodityDefault}</td><td><span className="source-tag">{variety.mapping_status}</span></td></tr>)}</tbody></table></div>}
      </article>
      <article className="panel table-panel"><div className="panel-heading"><div><h2>{t.grades}</h2><p>{t.gradesHint}</p></div></div>
        {grades.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label={t.gradesCaption(commodity.display_name)}><table><caption>{t.gradesCaption(commodity.display_name)}</caption>
          <thead><tr><th scope="col">{t.grade}</th><th scope="col">{t.type}</th><th scope="col">{t.appliesTo}</th><th scope="col">{t.status}</th></tr></thead>
          <tbody>{grades.map((grade) => <tr key={grade.id}><td>{grade.label}</td><td>{grade.grade_type.replace(/_/g, " ")}</td><td>{commodity.varieties.find((variety) => variety.id === grade.variety_id)?.label ?? t.all}</td><td><span className="source-tag">{grade.mapping_status}</span></td></tr>)}</tbody></table></div>
          : <p>{t.noGrades}</p>}
      </article>
    </section>
    <section className="panel"><div className="panel-heading"><div><h2>{t.sources}</h2><p>{integrated.length ? integrated.map(([capability, value]) => `${capability.replace(/_/g, " ")}: ${value.status}${value.note ? ` (${value.note})` : ""}`).join(" · ") : t.noSources}</p></div>
      <Link className="text-button" to="/data-quality">{t.dataQuality}</Link></div></section>
  </div>;
}

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { toCsv } from "../services/csv";
import type { Production, Trade, Weather, Bulletin, Evidence, ModuleDomain } from "../services/modules";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { defaultGeography } from "../services/intelligence";
import { defineCopy, useCopy, useFormat } from "../services/language";
import { COMMON } from "../services/commonCopy";
import { AboutData } from "../components/AboutData";
import { ExportButton } from "../components/ExportButton";
const domains = ["production", "weather", "trade", "policy", "news", "quality"] as const;
type Domain = typeof domains[number];

const COPY = defineCopy({
  en: {
    tabs: { production: "Production", weather: "Weather", trade: "Trade", policy: "Policy", news: "News", quality: "Quality" } as Record<Domain, string>,
    modules: "Intelligence modules",
    titles: { weather: "Sirsi weather", production: "Production & crop area", trade: "Arecanut trade", policy: "Policy notices", news: "Official source news" } as Record<string, string>,
    intro: "Source-specific reporting periods, original units and retained evidence. No inferred price impact.",
    unavailable: "Select an available intelligence module.",
    coverage: {
      trade: "India imports: selected named partners plus published total including others (DASD/Department of Commerce). Exports: one annual aggregate from PIB, value converted from INR crore to lakh (×100); not a continuous export series. No HS-code split is supplied. Null partner cells are not zero; totals include unlisted partners.",
      weather: "Sirsi town reference 14.6195, 74.8354. Open-Meteo gridded model output, not a farm sensor or observed weather station. Historical model days are not verified observations. API fetch time is not a model issuance timestamp.",
      production: "Annual DASD state/national estimates; source units retained. Historical table does not specify estimate status. Latest table labels 2024-25 Final and 2025-26 Second advance. Missing cells remain null.",
      news: "Curated official PIB releases and DASD announcements only, not a comprehensive or live news feed. Historical policy notices describe the position on publication date, not necessarily today's law. No inferred sentiment, price impact or health endorsement.",
    } as Record<string, string>,
    staleWeather: "Weather capture is more than 24 hours old. A forecast at capture is not necessarily a current forecast.",
    selected: "SELECTED RECORDS", captures: (n: number) => `${n} current source captures; older captures retained`,
    latestFetch: "LATEST PLATFORM FETCH", latestFetchShort: "LATEST FETCH", notPeriod: "Not the reporting period or source publication time",
    sourceCoverage: "SOURCE COVERAGE", sirsi: "Sirsi", indiaWide: "India-wide", india: "India",
    coverageHint: {
      weather: "Open-Meteo gridded model; recent and future model days", trade: "Annual imports; one annual export aggregate",
      production: "Karnataka default; select All India or All available for national comparison. DASD annual estimates.", news: "Curated PIB / DASD publications",
    } as Record<string, string>,
    reportingYear: "Reporting year", allYears: "All available years", partner: "Trading partner", geography: "Geography", allAvailable: "All available",
    records: "Source records", displayed: (n: number) => `${n} displayed`,
    yearLabels: "Financial/agricultural year labels are preserved exactly as published.", independent: "Publication dates and fetch timestamps are independent.",
    exportDomain: (domain: string) => `Export ${domain} CSV`,
    noMatch: "No records match these filters", noCaptured: "No captured source records",
    resetHint: "Reset the filters to see available source periods.", refreshHint: "No source records are available yet. Missing data is not estimated.",
    recordsAria: (title: string) => `${title} records`, weatherCaption: "Daily model output in Asia/Kolkata · Not measured farm conditions",
    columns: {
      production: ["Geography", "Reporting year", "Estimate", "Area ('000 ha)", "Production ('000 tonnes)", "Yield (kg/ha)"],
      trade: ["Partner", "Reporting year", "Direction", "Quantity (tonnes)", "Value (INR lakh)"],
      weather: ["Date", "Type at capture", "Maximum (°C)", "Minimum (°C)", "Rain (mm)"],
      bulletin: ["Release", "Publication date"],
    } as Record<string, string[]>,
    sourceFreshness: "Source / freshness", recent: "Recent model estimate", forecast: "Forecast model", pib: "PIB release", dasd: "DASD announcement",
    direction: { Import: "Import", Export: "Export" } as Record<string, string>,
    grid: (lat: number, lon: number, elevation: number) => `Returned model grid: ${lat}, ${lon} · Elevation ${elevation} m. Open-Meteo attribution:`,
    terms: "Terms",
    publisher: "Publisher", archived: "Archived capture", platformFetched: (time: string) => `Platform fetched ${time}`, documentPublication: (period: string) => `Document publication: ${period}`,
  },
  kn: {
    tabs: { production: "ಉತ್ಪಾದನೆ", weather: "ಹವಾಮಾನ", trade: "ವ್ಯಾಪಾರ", policy: "ನೀತಿ", news: "ಸುದ್ದಿ", quality: "ಗುಣಮಟ್ಟ" },
    modules: "ಮಾಹಿತಿ ವಿಭಾಗಗಳು",
    titles: { weather: "ಶಿರಸಿ ಹವಾಮಾನ", production: "ಉತ್ಪಾದನೆ ಮತ್ತು ಬೆಳೆ ವಿಸ್ತೀರ್ಣ", trade: "ಅಡಿಕೆ ವ್ಯಾಪಾರ", policy: "ನೀತಿ ಪ್ರಕಟಣೆಗಳು", news: "ಅಧಿಕೃತ ಮೂಲದ ಸುದ್ದಿ" },
    intro: "ಪ್ರತಿ ಮೂಲದ ವರದಿ ಅವಧಿ, ಮೂಲ ಘಟಕಗಳು ಮತ್ತು ಉಳಿಸಿದ ಆಧಾರ. ದರದ ಮೇಲಿನ ಪರಿಣಾಮವನ್ನು ಊಹಿಸುವುದಿಲ್ಲ.",
    unavailable: "ಲಭ್ಯವಿರುವ ಮಾಹಿತಿ ವಿಭಾಗವನ್ನು ಆಯ್ಕೆಮಾಡಿ.",
    coverage: {
      trade: "ಭಾರತದ ಆಮದು: ಆಯ್ದ ದೇಶಗಳು ಮತ್ತು ಇತರರನ್ನು ಸೇರಿಸಿದ ಪ್ರಕಟಿತ ಒಟ್ಟು (DASD/ವಾಣಿಜ್ಯ ಇಲಾಖೆ). ರಫ್ತು: PIB ಇಂದ ಒಂದು ವಾರ್ಷಿಕ ಒಟ್ಟು, ಮೌಲ್ಯವನ್ನು ಕೋಟಿಯಿಂದ ಲಕ್ಷಕ್ಕೆ (×100) ಪರಿವರ್ತಿಸಲಾಗಿದೆ; ನಿರಂತರ ರಫ್ತು ಸರಣಿ ಅಲ್ಲ. HS-ಕೋಡ್ ವಿಭಜನೆ ಇಲ್ಲ. ಖಾಲಿ ದೇಶದ ಕೋಶಗಳು ಸೊನ್ನೆಯಲ್ಲ; ಒಟ್ಟುಗಳಲ್ಲಿ ಪಟ್ಟಿ ಮಾಡದ ದೇಶಗಳೂ ಸೇರಿವೆ.",
      weather: "ಶಿರಸಿ ಪಟ್ಟಣದ ಉಲ್ಲೇಖ 14.6195, 74.8354. Open-Meteo ಗ್ರಿಡ್ ಮಾದರಿಯ ಅಂದಾಜು, ತೋಟದ ಸಂವೇದಕ ಅಥವಾ ಹವಾಮಾನ ಕೇಂದ್ರದ ಅಳತೆ ಅಲ್ಲ. ಹಿಂದಿನ ದಿನಗಳ ಮಾದರಿ ಮೌಲ್ಯಗಳು ಪರಿಶೀಲಿತ ಅಳತೆಗಳಲ್ಲ. ತಂದ ಸಮಯ ಮಾದರಿ ಬಿಡುಗಡೆಯ ಸಮಯವಲ್ಲ.",
      production: "DASD ವಾರ್ಷಿಕ ರಾಜ್ಯ/ರಾಷ್ಟ್ರೀಯ ಅಂದಾಜುಗಳು; ಮೂಲ ಘಟಕಗಳನ್ನು ಉಳಿಸಲಾಗಿದೆ. ಹಳೆಯ ಪಟ್ಟಿ ಅಂದಾಜಿನ ಸ್ಥಿತಿಯನ್ನು ತಿಳಿಸುವುದಿಲ್ಲ. ಇತ್ತೀಚಿನ ಪಟ್ಟಿ 2024-25 ಅಂತಿಮ ಮತ್ತು 2025-26 ಎರಡನೇ ಮುಂಗಡ ಅಂದಾಜು ಎಂದು ಗುರುತಿಸುತ್ತದೆ. ಖಾಲಿ ಕೋಶಗಳು ಖಾಲಿಯಾಗಿಯೇ ಇರುತ್ತವೆ.",
      news: "ಆಯ್ದ ಅಧಿಕೃತ PIB ಪ್ರಕಟಣೆಗಳು ಮತ್ತು DASD ಘೋಷಣೆಗಳು ಮಾತ್ರ, ಸಮಗ್ರ ಅಥವಾ ನೇರ ಸುದ್ದಿ ಅಲ್ಲ. ಹಳೆಯ ನೀತಿ ಪ್ರಕಟಣೆಗಳು ಪ್ರಕಟಣೆ ದಿನದ ಸ್ಥಿತಿಯನ್ನು ವಿವರಿಸುತ್ತವೆ, ಇಂದಿನ ಕಾನೂನನ್ನು ಅಲ್ಲ. ಭಾವನೆ, ದರದ ಪರಿಣಾಮ ಅಥವಾ ಆರೋಗ್ಯ ಶಿಫಾರಸನ್ನು ಊಹಿಸುವುದಿಲ್ಲ.",
    },
    staleWeather: "ಹವಾಮಾನ ಸಂಗ್ರಹ 24 ಗಂಟೆಗಿಂತ ಹಳೆಯದು. ಸಂಗ್ರಹದ ಸಮಯದ ಮುನ್ಸೂಚನೆ ಈಗಿನ ಮುನ್ಸೂಚನೆಯಾಗಿರಬೇಕಿಲ್ಲ.",
    selected: "ಆಯ್ದ ದಾಖಲೆಗಳು", captures: (n: number) => `${n} ಈಗಿನ ಮೂಲ ಸಂಗ್ರಹಗಳು; ಹಳೆಯವುಗಳನ್ನೂ ಉಳಿಸಲಾಗಿದೆ`,
    latestFetch: "ಕೊನೆಯ ಬಾರಿ ತಂದ ಸಮಯ", latestFetchShort: "ಕೊನೆಯ ಬಾರಿ ತಂದ ಸಮಯ", notPeriod: "ಇದು ವರದಿ ಅವಧಿ ಅಥವಾ ಮೂಲದ ಪ್ರಕಟಣೆ ಸಮಯವಲ್ಲ",
    sourceCoverage: "ಮೂಲದ ವ್ಯಾಪ್ತಿ", sirsi: "ಶಿರಸಿ", indiaWide: "ಭಾರತದಾದ್ಯಂತ", india: "ಭಾರತ",
    coverageHint: {
      weather: "Open-Meteo ಗ್ರಿಡ್ ಮಾದರಿ; ಇತ್ತೀಚಿನ ಮತ್ತು ಮುಂದಿನ ದಿನಗಳು", trade: "ವಾರ್ಷಿಕ ಆಮದು; ಒಂದು ವಾರ್ಷಿಕ ರಫ್ತು ಒಟ್ಟು",
      production: "ಕರ್ನಾಟಕ ಮೊದಲ ಆಯ್ಕೆ; ರಾಷ್ಟ್ರೀಯ ಹೋಲಿಕೆಗೆ ಅಖಿಲ ಭಾರತ ಅಥವಾ ಎಲ್ಲಾ ಲಭ್ಯ ಆಯ್ಕೆಮಾಡಿ. DASD ವಾರ್ಷಿಕ ಅಂದಾಜುಗಳು.", news: "ಆಯ್ದ PIB / DASD ಪ್ರಕಟಣೆಗಳು",
    },
    reportingYear: "ವರದಿ ವರ್ಷ", allYears: "ಎಲ್ಲಾ ಲಭ್ಯ ವರ್ಷಗಳು", partner: "ವ್ಯಾಪಾರ ಪಾಲುದಾರ ದೇಶ", geography: "ಪ್ರದೇಶ", allAvailable: "ಎಲ್ಲಾ ಲಭ್ಯ",
    records: "ಮೂಲ ದಾಖಲೆಗಳು", displayed: (n: number) => `${n} ತೋರಿಸಲಾಗಿದೆ`,
    yearLabels: "ಆರ್ಥಿಕ/ಕೃಷಿ ವರ್ಷದ ಹೆಸರುಗಳನ್ನು ಪ್ರಕಟಿಸಿದಂತೆಯೇ ಉಳಿಸಲಾಗಿದೆ.", independent: "ಪ್ರಕಟಣೆ ದಿನಾಂಕ ಮತ್ತು ತಂದ ಸಮಯ ಬೇರೆ ಬೇರೆ.",
    exportDomain: (domain: string) => `${domain} CSV ಡೌನ್‌ಲೋಡ್`,
    noMatch: "ಈ ಫಿಲ್ಟರ್‌ಗಳಿಗೆ ಹೊಂದುವ ದಾಖಲೆಗಳಿಲ್ಲ", noCaptured: "ಸಂಗ್ರಹಿಸಿದ ಮೂಲ ದಾಖಲೆಗಳಿಲ್ಲ",
    resetHint: "ಲಭ್ಯವಿರುವ ಅವಧಿಗಳನ್ನು ನೋಡಲು ಫಿಲ್ಟರ್ ತೆರವುಗೊಳಿಸಿ.", refreshHint: "ಇನ್ನೂ ಯಾವುದೇ ಮೂಲ ದಾಖಲೆಗಳು ಲಭ್ಯವಿಲ್ಲ. ಇಲ್ಲದ ದತ್ತಾಂಶವನ್ನು ಅಂದಾಜು ಮಾಡುವುದಿಲ್ಲ.",
    recordsAria: (title: string) => `${title} ದಾಖಲೆಗಳು`, weatherCaption: "ದೈನಂದಿನ ಮಾದರಿ ಅಂದಾಜು (ಭಾರತೀಯ ಕಾಲಮಾನ) · ತೋಟದಲ್ಲಿ ಅಳೆದದ್ದಲ್ಲ",
    columns: {
      production: ["ಪ್ರದೇಶ", "ವರದಿ ವರ್ಷ", "ಅಂದಾಜು", "ವಿಸ್ತೀರ್ಣ ('000 ಹೆ)", "ಉತ್ಪಾದನೆ ('000 ಟನ್)", "ಇಳುವರಿ (ಕೆಜಿ/ಹೆ)"],
      trade: ["ಪಾಲುದಾರ", "ವರದಿ ವರ್ಷ", "ದಿಕ್ಕು", "ಪ್ರಮಾಣ (ಟನ್)", "ಮೌಲ್ಯ (₹ ಲಕ್ಷ)"],
      weather: ["ದಿನಾಂಕ", "ಸಂಗ್ರಹದ ವಿಧ", "ಗರಿಷ್ಠ (°C)", "ಕನಿಷ್ಠ (°C)", "ಮಳೆ (ಮಿಮೀ)"],
      bulletin: ["ಪ್ರಕಟಣೆ", "ಪ್ರಕಟಣೆ ದಿನಾಂಕ"],
    },
    sourceFreshness: "ಮೂಲ / ಹೊಸತನ", recent: "ಇತ್ತೀಚಿನ ಮಾದರಿ ಅಂದಾಜು", forecast: "ಮುನ್ಸೂಚನೆ ಮಾದರಿ", pib: "PIB ಪ್ರಕಟಣೆ", dasd: "DASD ಘೋಷಣೆ",
    direction: { Import: "ಆಮದು", Export: "ರಫ್ತು" },
    grid: (lat: number, lon: number, elevation: number) => `ಮಾದರಿ ಗ್ರಿಡ್: ${lat}, ${lon} · ಎತ್ತರ ${elevation} ಮೀ. Open-Meteo ಉಲ್ಲೇಖ:`,
    terms: "ನಿಯಮಗಳು",
    publisher: "ಪ್ರಕಟಣಕಾರ", archived: "ಸಂಗ್ರಹಿಸಿದ ಪ್ರತಿ", platformFetched: (time: string) => `ತಂದ ಸಮಯ ${time}`, documentPublication: (period: string) => `ದಾಖಲೆಯ ಪ್ರಕಟಣೆ: ${period}`,
  },
});

export function IntelligenceNavigation({ current }: { current: string }) {
  const t = useCopy(COPY);
  // No inspection report has been published yet, so the tab appears with the first one. Its page stays reachable by link.
  const inspections = useQuery({ queryKey: ["quality-records-count"], queryFn: () => api.qualityInspections() });
  const visible = domains.filter((domain) => domain !== "quality" || current === "quality" || Boolean(inspections.data?.data.length));
  return <nav className="module-navigation" aria-label={t.modules}>{visible.map((domain) => <Link key={domain} to={`/intelligence/${domain}`} aria-current={current === domain ? "page" : undefined}>{t.tabs[domain]}</Link>)}</nav>;
}
const number = (value: number | null, missing: string) => value === null ? missing : value.toLocaleString("en-IN", { maximumFractionDigits: 3 });
export function exportModule(rows: (string | number | null)[][], name: string) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}
function EvidenceCell({ row }: { row: Evidence }) {
  const t = useCopy(COPY);
  const format = useFormat();
  return <><a href={row.source_url} target="_blank" rel="noreferrer">{t.publisher}</a>{" · "}<a href={api.sourceCaptureUrl(row.capture_id)}>{t.archived}</a><small className="quote-fetch evidence-fetched">{t.platformFetched(format.timestamp(row.fetched_at))}</small>{row.publication_period && <small className="quote-fetch">{t.documentPublication(row.publication_period)}</small>}</>;
}
type ModuleRow = Production | Trade | Weather | Bulletin;
export function IntelligencePage() {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const format = useFormat();
  const num = (value: number | null) => number(value, c.notReported);
  // Source dates are formatted only when they are plain calendar dates; anything else is shown as published.
  const day = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? format.date(value) : value;
  const domain = useParams().domain ?? "production";
  const supported = domains.some((value) => value === domain) && domain !== "quality";
  const [period, setPeriod] = useState(""), [geography, setGeography] = useState(() => defaultGeography(domain));
  const query = useQuery({ queryKey: ["intelligence", domain], queryFn: () => api.intelligence<ModuleRow>(domain as ModuleDomain), enabled: supported, refetchInterval: 60_000 });
  useEffect(() => { setPeriod(""); setGeography(defaultGeography(domain)); }, [domain]);
  if (!supported) return <ErrorState error={new Error(t.unavailable)} />;
  const data = query.data;
  const rows = data?.data ?? [];
  const periods = [...new Set(rows.flatMap((row) => "period" in row ? [row.period] : []))].sort().reverse();
  const places = [...new Set(rows.flatMap((row) => "geography" in row ? [row.geography] : "partner" in row ? [row.partner] : []))].sort();
  const filtered = rows.filter((row) => (!period || !("period" in row) || row.period === period)
    && (!geography || ("geography" in row ? row.geography === geography : "partner" in row ? row.partner === geography : true)));
  const latest = rows.reduce<string | null>((value, row) => !value || row.fetched_at > value ? row.fetched_at : value, null);
  const staleWeather = domain === "weather" && latest !== null && Date.now() - Date.parse(latest) > 24 * 60 * 60_000;
  const title = t.titles[domain] ?? t.titles.news;
  const coverageKey = domain === "trade" || domain === "weather" || domain === "production" ? domain : "news";
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
      })], `areca-pulse-${domain}.csv`);
  }
  const columnType = domain === "production" || domain === "trade" || domain === "weather" ? domain : "bulletin";
  const columns = t.columns[columnType];
  const numericFrom = columnType === "production" || columnType === "trade" ? 3 : columnType === "weather" ? 2 : columns.length;
  return <div className="page-stack intelligence-page">
    <section className="page-heading"><div><h1>{title}</h1><p className="page-intro">{t.intro}</p></div></section>
    {/* The section tabs and the methodology note share a row; the note takes the full width once opened. */}
    <div className="intelligence-toolbar"><IntelligenceNavigation current={domain} />{data && <AboutData><p>{t.coverage[coverageKey]}</p></AboutData>}</div>
    {query.isLoading ? <LoadingState /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : data && <>
      {staleWeather && <div role="alert" className="data-disclosure">{t.staleWeather}</div>}
      <section className="snapshot-grid snapshot-grid-even">
        <article className="snapshot-card"><div className="card-kicker">{t.selected}</div><div className="snapshot-value">{filtered.length}</div><p>{t.captures(new Set(filtered.map((row) => row.capture_id)).size)}</p></article>
        <article className="snapshot-card"><div className="card-kicker"><span className="label-full">{t.latestFetch}</span><span className="label-short" aria-hidden="true">{t.latestFetchShort}</span></div><div className="snapshot-value snapshot-date">{latest ? format.timestamp(latest) : c.never}</div><p>{t.notPeriod}</p></article>
        <article className="snapshot-card"><div className="card-kicker">{t.sourceCoverage}</div><div className="snapshot-value">{domain === "weather" ? t.sirsi : domain === "production" ? geography || t.indiaWide : t.india}</div><p>{t.coverageHint[coverageKey]}</p></article>
      </section>
      {(periods.length > 0 || places.length > 0) && <section className="filter-bar">
        <label className="filter-control"><span>{t.reportingYear}</span><select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="">{t.allYears}</option>{periods.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="filter-control"><span>{domain === "trade" ? t.partner : t.geography}</span><select value={geography} onChange={(event) => setGeography(event.target.value)}><option value="">{t.allAvailable}</option>{[...new Set([...places, ...(domain === "production" ? ["Karnataka"] : [])])].sort().map((value) => <option key={value}>{value}</option>)}</select></label>
        <button className="button-secondary" onClick={() => { setPeriod(""); setGeography(defaultGeography(domain)); }}>{c.resetFilters}</button>
      </section>}
      <section className="panel table-panel"><div className="panel-heading"><div><h2>{t.records}</h2><p className="phone-hide">{t.displayed(filtered.length)} · {domain === "production" || domain === "trade" ? t.yearLabels : t.independent}</p></div><ExportButton label={t.exportDomain(t.tabs[domain as Domain] ?? domain)} disabled={!filtered.length} onClick={exportRows} /></div>
        {!filtered.length ? <EmptyState title={rows.length ? t.noMatch : t.noCaptured}>{rows.length ? t.resetHint : t.refreshHint}</EmptyState> :
          <>{domain === "weather" && <p className="table-note phone-only" aria-hidden="true">{t.weatherCaption}</p>}<div className="table-scroll" tabIndex={0} role="region" aria-label={t.recordsAria(title)}><table className={columnType === "bulletin" ? "bulletin-table" : undefined}>
            {/* The weather caption says what the numbers are; elsewhere it would only repeat the page title, so only screen readers get it. */}
            {domain === "weather" ? <caption className="weather-caption">{t.weatherCaption}</caption> : <caption className="sr-only">{title}</caption>}
            <thead><tr>{columns.map((label, index) => <th scope="col" key={label} className={index >= numericFrom ? "numeric" : undefined}>{label}</th>)}<th scope="col" className="evidence-column">{t.sourceFreshness}</th></tr></thead>
            <tbody>{filtered.map((row) => <tr key={`${row.capture_id}:${"geography" in row ? `${row.geography}:${row.period}` : "partner" in row ? `${row.partner}:${row.period}` : "date" in row ? row.date : row.release_id}`}>
              {"geography" in row ? <><td>{row.geography}</td><td>{row.period}</td><td>{row.estimate_status}</td><td className="numeric">{num(row.area_thousand_hectares)}</td><td className="numeric">{num(row.production_thousand_tonnes)}</td><td className="numeric">{num(row.yield_kg_hectare)}</td></>
                : "partner" in row ? <><td>{row.partner}</td><td>{row.period}</td><td>{t.direction[row.direction] ?? row.direction}</td><td className="numeric">{num(row.quantity_tonnes)}</td><td className="numeric">{num(row.value_inr_lakh)}</td></>
                : "date" in row ? <><td>{day(row.date)}</td><td>{row.kind === "recent_model" ? t.recent : t.forecast}</td><td className="numeric">{num(row.temperature_max_c)}</td><td className="numeric">{num(row.temperature_min_c)}</td><td className="numeric">{num(row.precipitation_mm)}</td></>
                : <><td className="bulletin-title" lang="en">{row.title}<small className="quote-fetch">{row.source_key.startsWith("pib") ? t.pib : t.dasd} · {row.release_id}</small></td><td>{day(row.published_on)}</td></>}
              <td className="evidence-column"><EvidenceCell row={row} /></td>
            </tr>)}</tbody></table></div></>}
      </section>
      {domain === "weather" && rows.length > 0 && "grid_latitude" in rows[0] && <p className="data-disclosure">{t.grid(rows[0].grid_latitude, rows[0].grid_longitude, rows[0].elevation_m)} <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · <a href="https://open-meteo.com/en/terms" target="_blank" rel="noreferrer">{t.terms}</a>.</p>}
    </>}
  </div>;
}

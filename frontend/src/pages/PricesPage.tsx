import { MarketSearch } from "../components/MarketSearch";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, RotateCcw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../services/api";
import { useCommodity } from "../services/commodity";
import { ErrorState, EmptyState, LoadingState } from "../components/State";
import { downloadCsv } from "../services/csvDownload";
import { DATE_PRESETS, observationQuality, presetRange, type DatePreset, type SortDirection } from "../services/insights";
import type { PriceObservation } from "../types";
import { calendarTodayIST } from "../../../shared/dates";
import { gradeOptions } from "../../../shared/commodities";
import { SourceSlot } from "../components/SourceSlot";
import { pageParam, readPage, readPreset, readSort, sortParams, withoutFilters, withParams } from "../services/priceFilters";
import { AboutData } from "../components/AboutData";
import { defineCopy, useCopy, useFormat } from "../services/language";
import { COMMON } from "../services/commonCopy";

const COPY = defineCopy({
  en: {
    title: "Market prices", intro: (commodity: string) => `Explore verified ${commodity} quotations with transparent date, variety and source details.`,
    exportAll: "Export all matching", exportFirst: (n: string) => ` (first ${n})`,
    preparing: (done: string, total: string) => `Preparing ${done} of ${total} rows…`, exportFailed: (message: string) => `Export failed: ${message}`,
    searchLabel: "Search market, district or variety", searchExample: "e.g. Shivamogga",
    varietyExact: "Variety (exact)", varietyPlaceholder: "Type to search varieties", clearAll: "Clear all filters and search", marketSearch: "Market search:",
    observations: "Price observations", showing: (from: number, to: number, total: number) => `Showing ${from}–${to} of ${total} verified records`,
    matchingRecords: (n: number) => `${n} matching verified records`, pricesIn: (unit: string) => `Prices in ${unit}`,
    loading: "Loading observations", noMatch: "No observations match your selection", noneYet: "No verified observations published yet",
    widen: "Widen the date range or clear filters to see other verified reports.",
    afterReview: "Source imports appear here only after a reviewer verifies them. Missing prices are never substituted.",
    tableAria: "Verified market price observations, scroll horizontally for all columns",
    caption: (unit: string) => `Verified observations · ${unit} · Scroll horizontally for source and arrival details`,
    marketDate: "Market reporting date", min: "Min", modal: "Modal", max: "Max", arrival: "Arrival", provenance: "Source / date provenance",
    sourceUnit: "source unit", gradeLabel: (grade: string) => `Grade: ${grade}`, priceBasis: (basis: string) => `Price basis: ${basis}`,
    record: (id: string, unit: string) => `Source record: ${id} · Original unit: ${unit}`,
    publication: (date: string) => `Publication date: ${date} · Publication timestamp: not captured`, notSupplied: "Not supplied",
    ingested: (time: string) => `Platform fetch timestamp: not captured · Ingested: ${time}`,
    quality: {
      range: (ok: boolean | null) => ok === null ? "Min/max not reported" : "Modal within reported min–max",
      unit: (from: string | null) => from ? `Unit normalized from ${from}` : "Source unit not recorded",
      arrivals: (reported: boolean) => reported ? "Arrival quantity reported" : "Arrival quantity not reported",
      provenance: (kept: boolean) => kept ? "Source record ID retained" : "No source record ID",
    },
    about: "Showing validated records marked as verified by a data reviewer. Missing values are not substituted.",
  },
  kn: {
    title: "ಮಾರುಕಟ್ಟೆ ದರಗಳು", intro: (commodity: string) => `ಪರಿಶೀಲಿಸಿದ ${commodity} ದರಗಳು, ದಿನಾಂಕ, ತಳಿ ಮತ್ತು ಮೂಲದ ವಿವರಗಳೊಂದಿಗೆ.`,
    exportAll: "ಹೊಂದುವ ಎಲ್ಲವನ್ನೂ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ", exportFirst: (n: string) => ` (ಮೊದಲ ${n})`,
    preparing: (done: string, total: string) => `${total} ರಲ್ಲಿ ${done} ಸಾಲುಗಳನ್ನು ಸಿದ್ಧಪಡಿಸಲಾಗುತ್ತಿದೆ…`, exportFailed: (message: string) => `ಡೌನ್‌ಲೋಡ್ ವಿಫಲವಾಯಿತು: ${message}`,
    searchLabel: "ಮಾರುಕಟ್ಟೆ, ಜಿಲ್ಲೆ ಅಥವಾ ತಳಿ ಹುಡುಕಿ", searchExample: "ಉದಾ. Shivamogga",
    varietyExact: "ತಳಿ (ನಿಖರ)", varietyPlaceholder: "ತಳಿ ಹುಡುಕಲು ಟೈಪ್ ಮಾಡಿ", clearAll: "ಎಲ್ಲಾ ಫಿಲ್ಟರ್ ಮತ್ತು ಹುಡುಕಾಟ ತೆರವುಗೊಳಿಸಿ", marketSearch: "ಮಾರುಕಟ್ಟೆ ಹುಡುಕಾಟ:",
    observations: "ದರ ದಾಖಲೆಗಳು", showing: (from: number, to: number, total: number) => `${total} ಪರಿಶೀಲಿಸಿದ ದಾಖಲೆಗಳಲ್ಲಿ ${from}–${to} ತೋರಿಸಲಾಗಿದೆ`,
    matchingRecords: (n: number) => `ಹೊಂದುವ ${n} ಪರಿಶೀಲಿಸಿದ ದಾಖಲೆಗಳು`, pricesIn: (unit: string) => `ದರಗಳು ${unit} ನಲ್ಲಿ`,
    loading: "ದಾಖಲೆಗಳನ್ನು ತರಲಾಗುತ್ತಿದೆ", noMatch: "ನಿಮ್ಮ ಆಯ್ಕೆಗೆ ಹೊಂದುವ ದಾಖಲೆಗಳಿಲ್ಲ", noneYet: "ಇನ್ನೂ ಪರಿಶೀಲಿಸಿದ ದಾಖಲೆಗಳು ಪ್ರಕಟವಾಗಿಲ್ಲ",
    widen: "ಬೇರೆ ಪರಿಶೀಲಿಸಿದ ವರದಿಗಳನ್ನು ನೋಡಲು ದಿನಾಂಕ ಅವಧಿಯನ್ನು ಹೆಚ್ಚಿಸಿ ಅಥವಾ ಫಿಲ್ಟರ್ ತೆರವುಗೊಳಿಸಿ.",
    afterReview: "ಪರಿಶೀಲಕರು ದೃಢಪಡಿಸಿದ ನಂತರವೇ ಮೂಲದ ದಾಖಲೆಗಳು ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತವೆ. ಇಲ್ಲದ ದರಗಳ ಬದಲಿಗೆ ಏನನ್ನೂ ತುಂಬುವುದಿಲ್ಲ.",
    tableAria: "ಪರಿಶೀಲಿಸಿದ ಮಾರುಕಟ್ಟೆ ದರ ದಾಖಲೆಗಳು, ಎಲ್ಲಾ ಕಾಲಮ್‌ಗಳಿಗೆ ಅಡ್ಡಲಾಗಿ ಸರಿಸಿ",
    caption: (unit: string) => `ಪರಿಶೀಲಿಸಿದ ದಾಖಲೆಗಳು · ${unit} · ಮೂಲ ಮತ್ತು ಆವಕದ ವಿವರಗಳಿಗೆ ಅಡ್ಡಲಾಗಿ ಸರಿಸಿ`,
    marketDate: "ಮಾರುಕಟ್ಟೆ ವರದಿ ದಿನಾಂಕ", min: "ಕನಿಷ್ಠ", modal: "ಮಾದರಿ", max: "ಗರಿಷ್ಠ", arrival: "ಆವಕ", provenance: "ಮೂಲ / ದಿನಾಂಕದ ಆಧಾರ",
    sourceUnit: "ಮೂಲದ ಘಟಕ", gradeLabel: (grade: string) => `ದರ್ಜೆ: ${grade}`, priceBasis: (basis: string) => `ದರದ ಆಧಾರ: ${basis}`,
    record: (id: string, unit: string) => `ಮೂಲ ದಾಖಲೆ: ${id} · ಮೂಲ ಘಟಕ: ${unit}`,
    publication: (date: string) => `ಪ್ರಕಟಣೆ ದಿನಾಂಕ: ${date} · ಪ್ರಕಟಣೆ ಸಮಯ ದಾಖಲಾಗಿಲ್ಲ`, notSupplied: "ನೀಡಿಲ್ಲ",
    ingested: (time: string) => `ತಂದ ಸಮಯ ದಾಖಲಾಗಿಲ್ಲ · ಸೇರಿಸಿದ್ದು: ${time}`,
    quality: {
      range: (ok: boolean | null) => ok === null ? "ಕನಿಷ್ಠ/ಗರಿಷ್ಠ ವರದಿಯಾಗಿಲ್ಲ" : "ಮಾದರಿ ದರ ಕನಿಷ್ಠ–ಗರಿಷ್ಠದ ಒಳಗಿದೆ",
      unit: (from: string | null) => from ? `${from} ಇಂದ ಘಟಕ ಪರಿವರ್ತಿಸಲಾಗಿದೆ` : "ಮೂಲದ ಘಟಕ ದಾಖಲಾಗಿಲ್ಲ",
      arrivals: (reported: boolean) => reported ? "ಆವಕದ ಪ್ರಮಾಣ ವರದಿಯಾಗಿದೆ" : "ಆವಕದ ಪ್ರಮಾಣ ವರದಿಯಾಗಿಲ್ಲ",
      provenance: (kept: boolean) => kept ? "ಮೂಲ ದಾಖಲೆ ಗುರುತು ಉಳಿಸಲಾಗಿದೆ" : "ಮೂಲ ದಾಖಲೆ ಗುರುತು ಇಲ್ಲ",
    },
    about: "ಪರಿಶೀಲಕರು ದೃಢಪಡಿಸಿದ ದಾಖಲೆಗಳನ್ನು ಮಾತ್ರ ತೋರಿಸಲಾಗಿದೆ. ಇಲ್ಲದ ಮೌಲ್ಯಗಳ ಬದಲಿಗೆ ಏನನ್ನೂ ತುಂಬುವುದಿಲ್ಲ.",
  },
});

const inr = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;

const PRICE_SORT_KEYS = ["reporting_date", "market_name", "district", "variety_name", "minimum_price", "modal_price", "maximum_price"] as const;
type PriceSortKey = typeof PRICE_SORT_KEYS[number];
const DEFAULT_PRICE_SORT = { key: "reporting_date", direction: "desc" } as const;
const EXPORT_COLUMNS: (keyof PriceObservation)[] = ["reporting_date", "publication_date", "source_publication_timestamp", "platform_fetch_timestamp", "ingestion_timestamp", "market_name", "district", "variety_name", "minimum_price", "modal_price", "maximum_price", "arrival_quantity", "arrival_unit", "grade", "price_basis", "price_unit", "original_unit", "source_name", "source_record_id"];
/** Bounded full export: 1,000-row server pages up to this many rows keep the request count and browser memory small. */
const EXPORT_ROW_CAP = 5000;

function SortableHeader({ label, column, sort, onSort, numeric }: { label: string; column: PriceSortKey; sort: { key: PriceSortKey; direction: SortDirection }; onSort: (key: PriceSortKey) => void; numeric?: boolean }) {
  const active = sort.key === column;
  return <th scope="col" className={numeric ? "numeric" : undefined} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
    <button type="button" className="sort-button" onClick={() => onSort(column)}>{label}<span aria-hidden="true">{active ? (sort.direction === "asc" ? " ▲" : " ▼") : " ↕"}</span></button></th>;
}

export function PricesPage() {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const format = useFormat();
  const { code: commodity, commodity: commodityDef, unitText: unit } = useCommodity();
  const grades = gradeOptions(commodityDef);
  const [exporting, setExporting] = useState<string | null>(null);
  // Filters, sort and page live in the URL so reloads, shared links and Back keep them.
  const [searchParams, setSearchParams] = useSearchParams();
  const marketId = searchParams.get("market") ?? "";
  const variety = searchParams.get("variety") ?? "";
  const grade = searchParams.get("grade") ?? "";
  const district = searchParams.get("district") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const search = searchParams.get("search") ?? "";
  const [searchDraft, setSearchDraft] = useState(search);
  useEffect(() => setSearchDraft(search), [search]);
  useEffect(() => {
    if (searchDraft === search) return;
    const timeout = window.setTimeout(() => {
      setSearchParams(withParams(searchParams, { page: null, search: searchDraft }), { replace: true });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search, searchDraft, searchParams, setSearchParams]);
  const page = readPage(searchParams);
  const preset = readPreset(searchParams);
  const sort = readSort(searchParams, PRICE_SORT_KEYS, DEFAULT_PRICE_SORT);
  const pageSize = 50;
  /** Applies filter changes; any change other than paging returns to the first page. */
  const update = (changes: Record<string, string | number | null>) => setSearchParams(withParams(searchParams, { page: null, ...changes }), { replace: true });
  const markets = useQuery({ queryKey: ["markets", commodity], queryFn: () => api.markets(commodity) });
  const varietyOptions = useQuery({ queryKey: ["varieties", commodity], queryFn: () => api.varieties(commodity) });
  const defaultSort = sort.key === DEFAULT_PRICE_SORT.key && sort.direction === DEFAULT_PRICE_SORT.direction;
  const filterParams = { commodity, market_id: marketId || undefined, variety: variety || undefined, grade: grade || undefined, district: district || undefined, from: from || undefined, to: to || undefined, q: search || undefined, sort: defaultSort ? undefined : sort.key, order: defaultSort ? undefined : sort.direction };
  const prices = useQuery({
    queryKey: ["prices", commodity, marketId, variety, grade, district, from, to, search, sort.key, sort.direction, page],
    queryFn: () => api.prices({ ...filterParams, limit: String(pageSize), offset: String(page * pageSize) }),
  });
  const invalidRange = Boolean(from && to && from > to);
  const districts = useMemo(() => [...new Set((markets.data ?? []).map((market) => market.district))].sort(), [markets.data]);
  const hasFilters = Boolean(marketId || variety || grade || district || from || to || search);

  /** Clears every filter, the search and the sort, but keeps the feed and commodity. */
  function clearFilters() {
    setSearchParams(withoutFilters(searchParams, ["variety"]), { replace: true });
  }

  function toggleSort(key: PriceSortKey) {
    const next: { key: PriceSortKey; direction: SortDirection } = sort.key === key ? { key, direction: sort.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "market_name" || key === "district" || key === "variety_name" ? "asc" : "desc" };
    update(sortParams(next, DEFAULT_PRICE_SORT));
  }

  function applyPreset(value: DatePreset) {
    const range = presetRange(value, calendarTodayIST());
    const period = value === "all" ? null : value;
    if (range) update({ period, from: range.from, to: range.to });
    else if (value === "all") update({ period, from: null, to: null });
    else update({ period });
  }

  function exportPage() {
    const rows = prices.data?.data ?? [];
    if (!rows.length) return;
    downloadCsv([EXPORT_COLUMNS, ...rows.map((row) => EXPORT_COLUMNS.map((key) => row[key]))], `areca-pulse-market-prices-page-${page + 1}.csv`);
  }

  async function exportAll() {
    const total = Math.min(prices.data?.count ?? 0, EXPORT_ROW_CAP);
    if (!total) return;
    const rows: PriceObservation[] = [];
    try {
      for (let offset = 0; offset < total; offset += 1000) {
        setExporting(t.preparing(Math.min(offset + 1000, total).toLocaleString("en-IN"), total.toLocaleString("en-IN")));
        const response = await api.prices({ ...filterParams, limit: String(Math.min(1000, total - offset)), offset: String(offset) });
        rows.push(...response.data);
        if (!response.data.length) break;
      }
      downloadCsv([EXPORT_COLUMNS, ...rows.map((row) => EXPORT_COLUMNS.map((key) => row[key]))], "areca-pulse-market-prices-filtered.csv");
      setExporting(null);
    } catch (error) {
      setExporting(t.exportFailed((error as Error).message));
    }
  }

  const qualityLabel = (row: PriceObservation, code: string, ok: boolean | null) => code === "range" ? t.quality.range(ok)
    : code === "unit" ? t.quality.unit(row.original_unit ?? null) : code === "arrivals" ? t.quality.arrivals(row.arrival_quantity !== null) : t.quality.provenance(Boolean(row.source_record_id));
  return (
    <div className="page-stack">
      <section className="page-heading"><div><h1>{t.title}</h1><p className="page-intro">{t.intro(commodityDef?.display_name.toLowerCase() ?? commodity)}</p></div><div className="heading-controls"><SourceSlot /><div className="heading-actions"><button className="button-secondary" onClick={exportPage} disabled={!prices.data?.data.length}><Download size={16} /> {c.exportPage}</button><button className="button-secondary" onClick={() => void exportAll()} disabled={!prices.data?.count || Boolean(exporting && !exporting.startsWith(t.exportFailed("")))}><Download size={16} /> {t.exportAll}{(prices.data?.count ?? 0) > EXPORT_ROW_CAP ? t.exportFirst(EXPORT_ROW_CAP.toLocaleString("en-IN")) : ""}</button></div></div></section>
      {exporting && <div className="filter-context" role="status">{exporting}</div>}
      <section className="filter-bar">
        <label className="filter-control"><span>{t.searchLabel}</span><MarketSearch feeds={["official"]} ariaLabel={t.searchLabel} value={searchDraft} placeholder={t.searchExample} onChange={setSearchDraft}
          onSelect={(suggestion) => { setSearchDraft(""); update({ market: suggestion.marketId ?? null, search: null }); }} /></label>
        <label className="filter-control"><span>{c.market}</span><select value={marketId} onChange={(event) => update({ market: event.target.value })}><option value="">{c.allMarkets}</option>{(markets.data ?? []).filter((market) => !district || market.district === district).map((market) => <option key={market.id} value={market.id}>{market.name}</option>)}</select></label>
        <label className="filter-control"><span>{t.varietyExact}</span><input type="search" list="price-variety-options" value={variety} onChange={(event) => update({ variety: event.target.value })} placeholder={t.varietyPlaceholder} /><datalist id="price-variety-options">{(varietyOptions.data ?? []).map((value) => <option key={value} value={value} />)}</datalist></label>
        <button className="button-secondary clear-filters" disabled={!hasFilters} aria-label={t.clearAll} title={t.clearAll} onClick={clearFilters}><RotateCcw size={16} /> {c.reset}</button>
        <details className="advanced-filters">
        <summary>{c.moreFilters}{district || grade || from || to ? ` · ${c.active}` : ""}</summary>
        <div className="advanced-filter-fields">
        <label className="filter-control"><span>{c.district}</span><select value={district} onChange={(event) => update({ district: event.target.value, market: null })}><option value="">{c.allDistricts}</option>{districts.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="filter-control"><span>{c.grade}</span><select value={grade} onChange={(event) => update({ grade: event.target.value })}><option value="">{c.allGrades}</option>{grades.map((option) => <option key={option.id} value={option.label}>{option.label}</option>)}</select></label>
        <label className="filter-control"><span>{c.reportingPeriod}</span><select value={preset} onChange={(event) => applyPreset(event.target.value as DatePreset)}>{DATE_PRESETS.map((option) => <option key={option.value} value={option.value}>{c.datePresets[option.value]}</option>)}</select></label>
        <label className="filter-control"><span>{c.from}</span><input type="date" value={from} max={to || undefined} onChange={(event) => update({ from: event.target.value, period: "custom" })} /></label>
        <label className="filter-control"><span>{c.to}</span><input type="date" value={to} min={from || undefined} onChange={(event) => update({ to: event.target.value, period: "custom" })} /></label>
        </div></details>
      </section>
      {hasFilters && <div className="filter-context">{search && <span>{t.marketSearch} <strong>{search}</strong></span>}<button className="text-button" onClick={clearFilters}>{c.clearFilters}</button></div>}
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>{t.observations}</h2><p>{prices.data?.count ? t.showing(page * pageSize + 1, Math.min((page + 1) * pageSize, prices.data.count), prices.data.count) : t.matchingRecords(prices.data?.count ?? 0)} · {t.pricesIn(unit)}</p></div></div>
        {invalidRange ? <ErrorState error={new Error(c.invalidRange)} /> : prices.isLoading || markets.isLoading ? <LoadingState label={t.loading} /> : prices.error ? <ErrorState error={prices.error} onRetry={() => void prices.refetch()} /> : markets.error ? <ErrorState error={markets.error} onRetry={() => void markets.refetch()} /> : !prices.data?.data.length ? <EmptyState title={hasFilters ? t.noMatch : t.noneYet}>{hasFilters ? t.widen : t.afterReview}</EmptyState> : <div className="table-scroll" tabIndex={0} role="region" aria-label={t.tableAria}><table><caption>{t.caption(unit)}</caption><thead><tr><SortableHeader label={t.marketDate} column="reporting_date" sort={sort} onSort={toggleSort} /><SortableHeader label={c.market} column="market_name" sort={sort} onSort={toggleSort} /><SortableHeader label={c.district} column="district" sort={sort} onSort={toggleSort} /><SortableHeader label={c.variety} column="variety_name" sort={sort} onSort={toggleSort} /><SortableHeader label={t.min} column="minimum_price" sort={sort} onSort={toggleSort} numeric /><SortableHeader label={t.modal} column="modal_price" sort={sort} onSort={toggleSort} numeric /><SortableHeader label={t.max} column="maximum_price" sort={sort} onSort={toggleSort} numeric /><th scope="col" className="numeric">{t.arrival}</th><th scope="col" className="col-quality">{c.quality}</th><th scope="col" className="col-source">{t.provenance}</th></tr></thead><tbody>{prices.data.data.map((row) => { const checks = observationQuality(row); return <tr key={row.id}><td>{format.date(row.reporting_date)}</td><td className="table-market">{row.market_name}{checks.some((check) => check.ok === false) && <span className="quality-chips row-warnings">{checks.filter((check) => check.ok === false).map((check) => <span key={check.code} className="status-pill tone-warn">{qualityLabel(row, check.code, check.ok)}</span>)}</span>}</td><td>{row.district}</td><td lang="en">{row.variety_name}{row.grade ? <small className="quote-fetch">{t.gradeLabel(row.grade)}</small> : null}</td><td className="numeric">{inr(row.minimum_price)}</td><td className="table-price numeric">{inr(row.modal_price)}</td><td className="numeric">{inr(row.maximum_price)}</td><td className="numeric">{row.arrival_quantity == null ? "—" : `${row.arrival_quantity.toLocaleString("en-IN")} ${row.arrival_unit ?? t.sourceUnit}`}</td><td className="col-quality"><span className="quality-chips">{checks.map((check) => <span key={check.code} className={`status-pill tone-${check.ok === null ? "neutral" : check.ok ? "good" : "warn"}`}>{qualityLabel(row, check.code, check.ok)}</span>)}</span>{row.price_basis && <small className="quote-fetch">{t.priceBasis(row.price_basis)}</small>}</td><td className="col-source"><span className="source-tag">{row.source_name}</span><small className="quote-fetch">{t.record(row.source_record_id, row.original_unit)}</small><small className="quote-fetch">{t.publication(row.publication_date ? format.date(row.publication_date) : t.notSupplied)}</small><small className="quote-fetch">{t.ingested(format.timestamp(row.ingestion_timestamp))}</small></td></tr>; })}</tbody></table></div>}
        {prices.data?.count ? <div className="pagination"><span>{c.page(page + 1, Math.ceil(prices.data.count / pageSize))}</span><div><button className="button-secondary" disabled={page === 0 || prices.isFetching} onClick={() => update({ page: pageParam(page - 1) })}>{c.previous}</button><button className="button-secondary" disabled={(page + 1) * pageSize >= prices.data.count || prices.isFetching} onClick={() => update({ page: pageParam(page + 1) })}>{c.next}</button></div></div> : null}
      </section>
      <AboutData><p>{t.about}</p></AboutData>
    </div>
  );
}

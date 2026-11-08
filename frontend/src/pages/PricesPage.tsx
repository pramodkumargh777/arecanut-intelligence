import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Filter, RotateCcw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../services/api";
import { useCommodity } from "../services/commodity";
import { ErrorState, EmptyState, LoadingState } from "../components/State";
import { downloadCsv } from "../services/csvDownload";
import { DATE_PRESETS, observationQuality, presetRange, type DatePreset, type SortDirection } from "../services/insights";
import type { PriceObservation } from "../types";
import { calendarTodayIST, formatCalendarDate, formatTimestampIST } from "../../../shared/dates";
import { gradeOptions } from "../../../shared/commodities";
import { pageParam, readPage, readPreset, readSort, sortParams, withoutFilters, withParams } from "../services/priceFilters";
import { AboutData } from "../components/AboutData";

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
        setExporting(`Preparing ${Math.min(offset + 1000, total).toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} rows…`);
        const response = await api.prices({ ...filterParams, limit: String(Math.min(1000, total - offset)), offset: String(offset) });
        rows.push(...response.data);
        if (!response.data.length) break;
      }
      downloadCsv([EXPORT_COLUMNS, ...rows.map((row) => EXPORT_COLUMNS.map((key) => row[key]))], "areca-pulse-market-prices-filtered.csv");
      setExporting(null);
    } catch (error) {
      setExporting(`Export failed: ${(error as Error).message}`);
    }
  }

  return (
    <div className="page-stack">
      <section className="page-heading"><div><h1>Market prices</h1><p>Explore verified {commodityDef?.display_name.toLowerCase() ?? commodity} quotations with transparent date, variety and source details.</p></div><div className="heading-actions"><button className="button-secondary" onClick={exportPage} disabled={!prices.data?.data.length}><Download size={16} /> Export page</button><button className="button-secondary" onClick={() => void exportAll()} disabled={!prices.data?.count || Boolean(exporting && !exporting.startsWith("Export failed"))}><Download size={16} /> Export all matching{(prices.data?.count ?? 0) > EXPORT_ROW_CAP ? ` (first ${EXPORT_ROW_CAP.toLocaleString("en-IN")})` : ""}</button></div></section>
      {exporting && <div className="filter-context" role="status">{exporting}</div>}
      <section className="filter-bar">
        <div className="filter-label"><Filter size={16} /><span>FILTERS</span></div>
        <label className="filter-control"><span>Search market, district or variety</span><input type="search" value={search} placeholder="e.g. Shivamogga" onChange={(event) => update({ search: event.target.value })} /></label>
        <label className="filter-control"><span>Market</span><select value={marketId} onChange={(event) => update({ market: event.target.value })}><option value="">All markets</option>{(markets.data ?? []).filter((market) => !district || market.district === district).map((market) => <option key={market.id} value={market.id}>{market.name}</option>)}</select></label>
        <label className="filter-control"><span>Variety (exact)</span><input type="search" list="price-variety-options" value={variety} onChange={(event) => update({ variety: event.target.value })} placeholder="Type to search varieties" /><datalist id="price-variety-options">{(varietyOptions.data ?? []).map((value) => <option key={value} value={value} />)}</datalist></label>
        <button className="button-secondary clear-filters" disabled={!hasFilters} aria-label="Clear all filters and search" title="Clear all filters and search" onClick={clearFilters}><RotateCcw size={15} /> Reset</button>
        <details className="advanced-filters">
        <summary>More filters{district || grade || from || to ? " · active" : ""}</summary>
        <div className="advanced-filter-fields">
        <label className="filter-control"><span>District</span><select value={district} onChange={(event) => update({ district: event.target.value, market: null })}><option value="">All districts</option>{districts.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="filter-control"><span>Grade</span><select value={grade} onChange={(event) => update({ grade: event.target.value })}><option value="">All grades</option>{grades.map((option) => <option key={option.id} value={option.label}>{option.label}</option>)}</select></label>
        <label className="filter-control"><span>Reporting period</span><select value={preset} onChange={(event) => applyPreset(event.target.value as DatePreset)}>{DATE_PRESETS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="filter-control"><span>From</span><input type="date" value={from} max={to || undefined} onChange={(event) => update({ from: event.target.value, period: "custom" })} /></label>
        <label className="filter-control"><span>To</span><input type="date" value={to} min={from || undefined} onChange={(event) => update({ to: event.target.value, period: "custom" })} /></label>
        </div></details>
      </section>
      {hasFilters && <div className="filter-context">{search && <span>Market search: <strong>{search}</strong></span>}<button className="text-button" onClick={clearFilters}>Clear all filters</button></div>}
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Price observations</h2><p>{prices.data?.count ? `Showing ${page * pageSize + 1}–${Math.min((page + 1) * pageSize, prices.data.count)} of ${prices.data.count} verified records` : `${prices.data?.count ?? 0} matching verified records`} · Prices in {unit}</p></div></div>
        {invalidRange ? <ErrorState error={new Error("From date must not be after To date.")} /> : prices.isLoading || markets.isLoading ? <LoadingState label="Loading observations" /> : prices.error ? <ErrorState error={prices.error} onRetry={() => void prices.refetch()} /> : markets.error ? <ErrorState error={markets.error} onRetry={() => void markets.refetch()} /> : !prices.data?.data.length ? <EmptyState title={hasFilters ? "No observations match your selection" : "No verified observations published yet"}>{hasFilters ? "Widen the date range or clear filters to see other verified reports." : "Source imports appear here only after a reviewer verifies them. Missing prices are never substituted."}</EmptyState> : <div className="table-scroll" tabIndex={0} role="region" aria-label="Verified market price observations, scroll horizontally for all columns"><table><caption>Verified observations · {unit} · Scroll horizontally for source and arrival details</caption><thead><tr><SortableHeader label="Market reporting date" column="reporting_date" sort={sort} onSort={toggleSort} /><SortableHeader label="Market" column="market_name" sort={sort} onSort={toggleSort} /><SortableHeader label="District" column="district" sort={sort} onSort={toggleSort} /><SortableHeader label="Variety" column="variety_name" sort={sort} onSort={toggleSort} /><SortableHeader label="Min" column="minimum_price" sort={sort} onSort={toggleSort} numeric /><SortableHeader label="Modal" column="modal_price" sort={sort} onSort={toggleSort} numeric /><SortableHeader label="Max" column="maximum_price" sort={sort} onSort={toggleSort} numeric /><th scope="col" className="numeric">Arrival</th><th scope="col">Quality</th><th scope="col">Source / date provenance</th></tr></thead><tbody>{prices.data.data.map((row) => <tr key={row.id}><td>{formatCalendarDate(row.reporting_date)}</td><td className="table-market">{row.market_name}</td><td>{row.district}</td><td>{row.variety_name}{row.grade ? <small className="quote-fetch">Grade: {row.grade}</small> : null}</td><td className="numeric">{inr(row.minimum_price)}</td><td className="table-price numeric">{inr(row.modal_price)}</td><td className="numeric">{inr(row.maximum_price)}</td><td className="numeric">{row.arrival_quantity == null ? "—" : `${row.arrival_quantity.toLocaleString("en-IN")} ${row.arrival_unit ?? "source unit"}`}</td><td><span className="quality-chips">{observationQuality(row).map((check) => <span key={check.code} className={`status-pill tone-${check.ok === null ? "neutral" : check.ok ? "good" : "warn"}`}>{check.label}</span>)}</span>{row.price_basis && <small className="quote-fetch">Price basis: {row.price_basis}</small>}</td><td><span className="source-tag">{row.source_name}</span><small className="quote-fetch">Source record: {row.source_record_id} · Original unit: {row.original_unit}</small><small className="quote-fetch">Publication date: {row.publication_date ? formatCalendarDate(row.publication_date) : "Not supplied"} · Publication timestamp: not captured</small><small className="quote-fetch">Platform fetch timestamp: not captured · Ingested: {formatTimestampIST(row.ingestion_timestamp)}</small></td></tr>)}</tbody></table></div>}
        {prices.data?.count ? <div className="pagination"><span>Page {page + 1} of {Math.ceil(prices.data.count / pageSize)}</span><div><button className="button-secondary" disabled={page === 0 || prices.isFetching} onClick={() => update({ page: pageParam(page - 1) })}>Previous</button><button className="button-secondary" disabled={(page + 1) * pageSize >= prices.data.count || prices.isFetching} onClick={() => update({ page: pageParam(page + 1) })}>Next</button></div></div> : null}
      </section>
      <AboutData><p>Showing validated records marked as verified by a data reviewer. Missing values are not substituted.</p></AboutData>
    </div>
  );
}

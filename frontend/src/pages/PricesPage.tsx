import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Filter, RotateCcw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../services/api";
import { ErrorState, EmptyState, LoadingState } from "../components/State";
import { toCsv } from "../services/csv";
import type { PriceObservation } from "../types";

const inr = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;

export function PricesPage() {
  const [marketId, setMarketId] = useState("");
  const [variety, setVariety] = useState("");
  const [district, setDistrict] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("search") ?? "";
  const pageSize = 50;
  useEffect(() => {
    setPage(0);
  }, [district, marketId, variety, from, to, search]);
  const markets = useQuery({ queryKey: ["markets"], queryFn: api.markets });
  const prices = useQuery({
    queryKey: ["prices", marketId, variety, district, from, to, search, page],
    queryFn: () => api.prices({ market_id: marketId || undefined, variety: variety || undefined, district: district || undefined, from: from || undefined, to: to || undefined, q: search || undefined, limit: String(pageSize), offset: String(page * pageSize) }),
  });
  const districts = useMemo(() => [...new Set((markets.data ?? []).map((market) => market.district))].sort(), [markets.data]);
  const hasFilters = Boolean(marketId || variety || district || from || to || search);

  function clearFilters() {
    setMarketId("");
    setVariety("");
    setDistrict("");
    setFrom("");
    setTo("");
    setPage(0);
    setSearchParams({});
  }

  function exportCsv() {
    const rows = prices.data?.data ?? [];
    if (!rows.length) return;
    const columns: (keyof PriceObservation)[] = ["reporting_date", "market_name", "district", "variety_name", "minimum_price", "modal_price", "maximum_price", "price_unit", "source_name", "source_record_id"];
    const csv = toCsv([columns, ...rows.map((row) => columns.map((key) => row[key]))]);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "ani-market-prices.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="page-stack">
      <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />MARKET EXPLORER</div><h1>Market prices</h1><p>Explore verified arecanut quotations with transparent date, variety and source details.</p></div><button className="button-secondary" onClick={exportCsv} disabled={!prices.data?.data.length}><Download size={16} /> Export page</button></section>
      <section className="filter-bar">
        <div className="filter-label"><Filter size={16} /><span>FILTERS</span></div>
        <label className="filter-control"><span>District</span><select value={district} onChange={(event) => { setDistrict(event.target.value); setMarketId(""); }}><option value="">All districts</option>{districts.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="filter-control"><span>Market</span><select value={marketId} onChange={(event) => setMarketId(event.target.value)}><option value="">All markets</option>{(markets.data ?? []).filter((market) => !district || market.district === district).map((market) => <option key={market.id} value={market.id}>{market.name}</option>)}</select></label>
        <label className="filter-control"><span>Variety</span><input value={variety} onChange={(event) => setVariety(event.target.value)} placeholder="All varieties" /></label>
        <label className="filter-control"><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="filter-control"><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <button className="button-secondary clear-filters" disabled={!hasFilters} aria-label="Clear all filters and search" title="Clear all filters and search" onClick={clearFilters}><RotateCcw size={15} /> Reset</button>
      </section>
      {hasFilters && <div className="filter-context">{search && <span>Market search: <strong>{search}</strong></span>}<button className="text-button" onClick={clearFilters}>Clear all filters</button></div>}
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Price observations</h2><p>{prices.data?.count ? `Showing ${page * pageSize + 1}–${Math.min((page + 1) * pageSize, prices.data.count)} of ${prices.data.count} verified records` : `${prices.data?.count ?? 0} matching verified records`} · Prices in INR / quintal</p></div></div>
        {prices.isLoading || markets.isLoading ? <LoadingState label="Loading observations" /> : prices.error ? <ErrorState error={prices.error} onRetry={() => void prices.refetch()} /> : markets.error ? <ErrorState error={markets.error} onRetry={() => void markets.refetch()} /> : !prices.data?.data.length ? <EmptyState title={hasFilters ? "No observations match your selection" : "No verified observations published yet"}>{hasFilters ? "Widen the date range or clear filters to see other verified reports." : "Source imports appear here only after a reviewer verifies them. Missing prices are never substituted."}</EmptyState> : <div className="table-scroll" tabIndex={0} role="region" aria-label="Verified market price observations, scroll horizontally for all columns"><table><caption>Verified observations · INR / quintal · Scroll horizontally for source and arrival details</caption><thead><tr><th scope="col">Reporting date</th><th scope="col">Market</th><th scope="col">District</th><th scope="col">Variety</th><th scope="col" className="numeric">Min</th><th scope="col" className="numeric">Modal</th><th scope="col" className="numeric">Max</th><th scope="col" className="numeric">Arrival</th><th scope="col">Source</th></tr></thead><tbody>{prices.data.data.map((row) => <tr key={row.id}><td>{row.reporting_date}</td><td className="table-market">{row.market_name}</td><td>{row.district}</td><td>{row.variety_name}</td><td className="numeric">{inr(row.minimum_price)}</td><td className="table-price numeric">{inr(row.modal_price)}</td><td className="numeric">{inr(row.maximum_price)}</td><td className="numeric">{row.arrival_quantity == null ? "—" : `${row.arrival_quantity.toLocaleString("en-IN")} ${row.arrival_unit ?? "source unit"}`}</td><td><span className="source-tag">{row.source_name}</span></td></tr>)}</tbody></table></div>}
        {prices.data?.count ? <div className="pagination"><span>Page {page + 1} of {Math.ceil(prices.data.count / pageSize)}</span><div><button className="button-secondary" disabled={page === 0 || prices.isFetching} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="button-secondary" disabled={(page + 1) * pageSize >= prices.data.count || prices.isFetching} onClick={() => setPage((value) => value + 1)}>Next</button></div></div> : null}
      </section>
      <div className="data-disclosure"><Filter size={15} /><span>Showing validated records marked as verified by a data reviewer. Missing values are not substituted.</span></div>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { ArrowUpDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { EmptyState, ErrorState, LoadingState } from "../components/State";

export function ComparePage() {
  const [sortBy, setSortBy] = useState<"modal_price" | "market_name">("modal_price");
  const [variety, setVariety] = useState("");
  const varieties = useQuery({ queryKey: ["varieties"], queryFn: api.varieties });
  useEffect(() => {
    if (!variety && varieties.data?.length) setVariety(varieties.data[0]);
  }, [variety, varieties.data]);
  const prices = useQuery({ queryKey: ["market-comparison", variety], queryFn: () => api.marketComparison(variety), enabled: Boolean(variety) });
  const rows = useMemo(() => [...(prices.data?.data ?? [])].sort((a, b) => sortBy === "modal_price" ? b.modal_price - a.modal_price : a.market_name.localeCompare(b.market_name)), [prices.data, sortBy]);
  const allQuotesSameDate = new Set(rows.map((row) => row.reporting_date)).size <= 1;
  return (
    <div className="page-stack">
      <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />MARKET SPREAD</div><h1>Market comparison</h1><p>Compare the latest verified modal quotation for each market. Dates are shown to make freshness and comparability clear.</p></div><div className="compare-heading-tools"><label className="variety-select"><span>Reported variety</span><select value={variety} onChange={(event) => setVariety(event.target.value)}><option value="">Select variety</option>{(varieties.data ?? []).map((value) => <option key={value}>{value}</option>)}</select></label><div className="comparison-count"><strong>{rows.length}</strong><span>markets</span></div></div></section>
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Latest market quotations</h2><p>{!rows.length ? "Awaiting verified quotations." : allQuotesSameDate ? "Markets report on the same date." : "Reporting dates vary by market; compare dates before acting."} · INR / quintal · Sorted by {sortBy === "modal_price" ? "price, high to low" : "market, A to Z"}</p></div><button className="sort-button" disabled={!rows.length} onClick={() => setSortBy((value) => value === "modal_price" ? "market_name" : "modal_price")}><ArrowUpDown size={15} /> Sort by {sortBy === "modal_price" ? "market" : "price"}</button></div>
        {varieties.error ? <ErrorState error={varieties.error} onRetry={() => void varieties.refetch()} /> : varieties.isLoading || (prices.isLoading && variety) ? <LoadingState /> : prices.error ? <ErrorState error={prices.error} onRetry={() => void prices.refetch()} /> : !variety ? <EmptyState title="No verified varieties available">Market comparisons appear after observations for an exact reported variety are verified.</EmptyState> : !rows.length ? <EmptyState title="No verified market quotations yet">Market comparisons become available after source observations are verified.</EmptyState> : <div className="comparison-list">{rows.map((row, index) => {
          const max = Math.max(...rows.map((item) => item.modal_price));
          const width = max > 0 ? row.modal_price / max * 100 : 0;
          return <div className="comparison-row" key={row.market_id}><div className="rank">{String(index + 1).padStart(2, "0")}</div><div className="comparison-market"><strong>{row.market_name}</strong><span>{row.district} · {row.variety_name} · {row.reporting_date}</span></div><div className="comparison-bar-track" aria-hidden="true"><span style={{ width: `${width}%` }} /></div><strong className="comparison-price">₹{Math.round(row.modal_price).toLocaleString("en-IN")}<small>/qtl</small></strong></div>;
        })}</div>}
      </section>
      <div className="data-disclosure"><ArrowUpDown size={15} /><span>Only the most recent verified report per market is displayed. Different reporting dates and varieties are not treated as directly comparable.</span></div>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { ArrowUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../services/api";
import { useCommodity } from "../services/commodity";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { LazyRangeChart } from "../components/LazyCharts";
import { SourceLabel } from "../components/Scorecard";
import { rankSameDate } from "../services/insights";
import { formatCalendarDate } from "../../../shared/dates";

export function ComparePage() {
  const [sortBy, setSortBy] = useState<"modal_price" | "market_name">("market_name");
  const [selectedVariety, setVariety] = useState("");
  const [comparisonDate, setComparisonDate] = useState("");
  const { code: commodity } = useCommodity();
  const varieties = useQuery({ queryKey: ["varieties", commodity], queryFn: () => api.varieties(commodity) });
  const variety = varieties.data?.includes(selectedVariety) ? selectedVariety : varieties.data?.[0] || "";
  const prices = useQuery({ queryKey: ["market-comparison", commodity, variety], queryFn: () => api.marketComparison(variety, commodity), enabled: Boolean(variety) });
  const allQuotesSameDate = new Set((prices.data?.data ?? []).map((row) => row.reporting_date)).size <= 1;
  const effectiveSort = allQuotesSameDate ? sortBy : "market_name";
  const rows = useMemo(() => [...(prices.data?.data ?? [])].sort((a, b) => effectiveSort === "modal_price" ? b.modal_price - a.modal_price : a.market_name.localeCompare(b.market_name)), [prices.data, effectiveSort]);
  const dates = [...new Set(rows.map((row) => row.reporting_date))].sort().reverse();
  const selectedDate = dates.includes(comparisonDate) ? comparisonDate : dates[0] ?? "";
  const ranked = rankSameDate(rows, (row) => ({ key: row.market_id, label: row.market_name, detail: `${row.district} · ${row.variety_name}`, reporting_date: row.reporting_date, minimum: row.minimum_price, central: row.modal_price, maximum: row.maximum_price }), selectedDate);
  return (
    <div className="page-stack">
      <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />MARKET SPREAD</div><h1>Market comparison</h1><p>Compare the latest verified modal quotation for each market. Dates are shown to make freshness and comparability clear.</p></div><div className="compare-heading-tools"><label className="variety-select"><span>Reported variety</span><select value={variety} onChange={(event) => setVariety(event.target.value)}><option value="">Select variety</option>{(varieties.data ?? []).map((value) => <option key={value}>{value}</option>)}</select></label><div className="comparison-count"><strong>{rows.length}</strong><span>markets</span></div></div></section>
      {rows.length > 0 && <section className="panel chart-panel">
        <div className="panel-heading"><div><h2>Ranked same-date comparison</h2><p>Bar: minimum–maximum · marker: modal price · {ranked.length} of {rows.length} markets reported {variety} on {formatCalendarDate(selectedDate)}; markets reporting on other dates are excluded</p></div>
          <label className="filter-control"><span>Same reporting date</span><select value={selectedDate} onChange={(event) => setComparisonDate(event.target.value)}>{dates.map((date) => <option key={date} value={date}>{formatCalendarDate(date)}</option>)}</select></label></div>
        <LazyRangeChart rows={ranked} centralLabel="Modal price" description={`Verified ${variety} quotations on ${selectedDate}, ranked by modal price`} />
        <div className="chart-foot"><SourceLabel>AGMARKNET daily · verified APMC modal, minimum and maximum · INR/quintal · {formatCalendarDate(selectedDate)}</SourceLabel></div>
      </section>}
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Latest market quotations</h2><p>{!rows.length ? "Awaiting verified quotations." : allQuotesSameDate ? "Markets report on the same date." : "Reporting dates vary by market; compare dates before acting."} · Modal price · INR / quintal · Sorted by {effectiveSort === "modal_price" ? "price, high to low" : "market, A to Z"}</p></div>{allQuotesSameDate && <button className="sort-button" disabled={!rows.length} onClick={() => setSortBy((value) => value === "modal_price" ? "market_name" : "modal_price")}><ArrowUpDown size={15} /> Sort by {sortBy === "modal_price" ? "market" : "price"}</button>}</div>
        {varieties.error ? <ErrorState error={varieties.error} onRetry={() => void varieties.refetch()} /> : varieties.isLoading || (prices.isLoading && variety) ? <LoadingState /> : prices.error ? <ErrorState error={prices.error} onRetry={() => void prices.refetch()} /> : !variety ? <EmptyState title="No verified varieties available">Market comparisons appear after observations for an exact reported variety are verified.</EmptyState> : !rows.length ? <EmptyState title="No verified market quotations yet">Market comparisons become available after source observations are verified.</EmptyState> : <div className="comparison-list">{rows.map((row) =>
          <div className="comparison-row comparison-quotation" key={row.market_id}><div className="comparison-market"><strong>{row.market_name}</strong><span>{row.district} · {row.variety_name}{row.grade ? ` · Grade: ${row.grade}` : ""} · {formatCalendarDate(row.reporting_date)} · {row.source_name}</span></div><strong className="comparison-price">₹{Math.round(row.modal_price).toLocaleString("en-IN")}<small>/qtl</small></strong></div>
        )}</div>}
      </section>
      <div className="data-disclosure"><ArrowUpDown size={15} /><span>Only the most recent verified report per market is displayed. Different reporting dates and varieties are not treated as directly comparable.</span></div>
    </div>
  );
}

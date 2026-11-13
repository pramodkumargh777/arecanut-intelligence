import { useQuery } from "@tanstack/react-query";
import { ArrowUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../services/api";
import { useCommodity } from "../services/commodity";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { LazyRangeChart } from "../components/LazyCharts";
import { SourceLabel } from "../components/Scorecard";
import { rankSameDate } from "../services/insights";
import { defineCopy, useCopy, useFormat } from "../services/language";

const COPY = defineCopy({
  en: {
    title: "Market comparison", intro: "Compare the latest verified modal quotation for each market. Dates are shown to make freshness and comparability clear.",
    reportedVariety: "Reported variety", selectVariety: "Select variety", markets: "markets",
    rankedTitle: "Ranked same-date comparison",
    rankedHint: (ranked: number, total: number, variety: string, date: string) => `Bar: minimum–maximum · marker: modal price · ${ranked} of ${total} markets reported ${variety} on ${date}; markets reporting on other dates are excluded`,
    sameDate: "Same reporting date", modalPrice: "Modal price",
    rankedDescription: (variety: string, date: string) => `Verified ${variety} quotations on ${date}, ranked by modal price`,
    rankedSource: (date: string) => `AGMARKNET daily · verified APMC modal, minimum and maximum · INR/quintal · ${date}`,
    latest: "Latest market quotations", awaiting: "Awaiting verified quotations.", sameDay: "Markets report on the same date.", varies: "Reporting dates vary by market; compare dates before acting.",
    unit: "Modal price · INR / quintal", sorted: (byPrice: boolean) => `Sorted by ${byPrice ? "price, high to low" : "market, A to Z"}`, sortBy: (byPrice: boolean) => `Sort by ${byPrice ? "market" : "price"}`,
    noVarieties: "No verified varieties available", noVarietiesHint: "Market comparisons appear after observations for an exact reported variety are verified.",
    noQuotes: "No verified market quotations yet", noQuotesHint: "Market comparisons become available after source observations are verified.",
    grade: (grade: string) => ` · Grade: ${grade}`, qtl: "/qtl",
    about: "Only the most recent verified report per market is displayed. Different reporting dates and varieties are not treated as directly comparable.",
  },
  kn: {
    title: "ಮಾರುಕಟ್ಟೆ ಹೋಲಿಕೆ", intro: "ಪ್ರತಿ ಮಾರುಕಟ್ಟೆಯ ಇತ್ತೀಚಿನ ಪರಿಶೀಲಿತ ಮಾದರಿ ದರವನ್ನು ಹೋಲಿಸಿ. ದರ ಎಷ್ಟು ಹೊಸದು ಮತ್ತು ಹೋಲಿಸಬಹುದೇ ಎಂದು ತಿಳಿಯಲು ದಿನಾಂಕಗಳನ್ನು ತೋರಿಸಲಾಗಿದೆ.",
    reportedVariety: "ವರದಿಯಾದ ತಳಿ", selectVariety: "ತಳಿ ಆಯ್ಕೆಮಾಡಿ", markets: "ಮಾರುಕಟ್ಟೆಗಳು",
    rankedTitle: "ಅದೇ ದಿನಾಂಕದ ಶ್ರೇಣೀಕೃತ ಹೋಲಿಕೆ",
    rankedHint: (ranked: number, total: number, variety: string, date: string) => `ಪಟ್ಟಿ: ಕನಿಷ್ಠ–ಗರಿಷ್ಠ · ಚುಕ್ಕೆ: ಮಾದರಿ ದರ · ${date} ರಂದು ${total} ರಲ್ಲಿ ${ranked} ಮಾರುಕಟ್ಟೆಗಳು ${variety} ವರದಿ ಮಾಡಿವೆ; ಬೇರೆ ದಿನಾಂಕಗಳಲ್ಲಿ ವರದಿ ಮಾಡಿದವನ್ನು ಬಿಡಲಾಗಿದೆ`,
    sameDate: "ಅದೇ ವರದಿ ದಿನಾಂಕ", modalPrice: "ಮಾದರಿ ದರ",
    rankedDescription: (variety: string, date: string) => `${date} ರಂದು ಪರಿಶೀಲಿತ ${variety} ದರಗಳು, ಮಾದರಿ ದರದ ಪ್ರಕಾರ`,
    rankedSource: (date: string) => `AGMARKNET ದೈನಂದಿನ · ಪರಿಶೀಲಿತ ಎಪಿಎಂಸಿ ಮಾದರಿ, ಕನಿಷ್ಠ ಮತ್ತು ಗರಿಷ್ಠ · ₹/ಕ್ವಿಂಟಾಲ್ · ${date}`,
    latest: "ಇತ್ತೀಚಿನ ಮಾರುಕಟ್ಟೆ ದರಗಳು", awaiting: "ಪರಿಶೀಲಿತ ದರಗಳಿಗೆ ಕಾಯಲಾಗುತ್ತಿದೆ.", sameDay: "ಮಾರುಕಟ್ಟೆಗಳು ಒಂದೇ ದಿನಾಂಕದಲ್ಲಿ ವರದಿ ಮಾಡಿವೆ.", varies: "ಮಾರುಕಟ್ಟೆಗಳ ವರದಿ ದಿನಾಂಕಗಳು ಬೇರೆ ಬೇರೆ; ನಿರ್ಧರಿಸುವ ಮೊದಲು ದಿನಾಂಕಗಳನ್ನು ಹೋಲಿಸಿ.",
    unit: "ಮಾದರಿ ದರ · ₹ / ಕ್ವಿಂಟಾಲ್", sorted: (byPrice: boolean) => byPrice ? "ದರದ ಪ್ರಕಾರ, ಹೆಚ್ಚಿನದು ಮೊದಲು" : "ಮಾರುಕಟ್ಟೆ ಹೆಸರಿನ ಪ್ರಕಾರ", sortBy: (byPrice: boolean) => byPrice ? "ಮಾರುಕಟ್ಟೆ ಪ್ರಕಾರ ವಿಂಗಡಿಸಿ" : "ದರದ ಪ್ರಕಾರ ವಿಂಗಡಿಸಿ",
    noVarieties: "ಪರಿಶೀಲಿಸಿದ ತಳಿಗಳು ಲಭ್ಯವಿಲ್ಲ", noVarietiesHint: "ನಿಖರ ತಳಿಯ ದಾಖಲೆಗಳು ಪರಿಶೀಲನೆಯಾದ ನಂತರ ಮಾರುಕಟ್ಟೆ ಹೋಲಿಕೆ ಕಾಣಿಸುತ್ತದೆ.",
    noQuotes: "ಇನ್ನೂ ಪರಿಶೀಲಿತ ಮಾರುಕಟ್ಟೆ ದರಗಳಿಲ್ಲ", noQuotesHint: "ಮೂಲದ ದಾಖಲೆಗಳು ಪರಿಶೀಲನೆಯಾದ ನಂತರ ಮಾರುಕಟ್ಟೆ ಹೋಲಿಕೆ ಲಭ್ಯವಾಗುತ್ತದೆ.",
    grade: (grade: string) => ` · ದರ್ಜೆ: ${grade}`, qtl: "/ಕ್ವಿಂ",
    about: "ಪ್ರತಿ ಮಾರುಕಟ್ಟೆಯ ಇತ್ತೀಚಿನ ಪರಿಶೀಲಿತ ವರದಿಯನ್ನು ಮಾತ್ರ ತೋರಿಸಲಾಗಿದೆ. ಬೇರೆ ವರದಿ ದಿನಾಂಕ ಮತ್ತು ತಳಿಗಳನ್ನು ನೇರವಾಗಿ ಹೋಲಿಸಬಹುದು ಎಂದು ಪರಿಗಣಿಸುವುದಿಲ್ಲ.",
  },
});
import { AboutData } from "../components/AboutData";
import { SourceSlot } from "../components/SourceSlot";

export function ComparePage() {
  const t = useCopy(COPY);
  const format = useFormat();
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
  const byPrice = effectiveSort === "modal_price";
  return (
    <div className="page-stack">
      <section className="page-heading"><div><h1>{t.title}</h1><p>{t.intro}</p></div><div className="compare-heading-tools heading-controls"><SourceSlot /><label className="variety-select"><span>{t.reportedVariety}</span><select value={variety} onChange={(event) => setVariety(event.target.value)}><option value="">{t.selectVariety}</option>{(varieties.data ?? []).map((value) => <option key={value} lang="en">{value}</option>)}</select></label><div className="comparison-count"><strong>{rows.length}</strong><span>{t.markets}</span></div></div></section>
      {rows.length > 0 && <section className="panel chart-panel">
        <div className="panel-heading"><div><h2>{t.rankedTitle}</h2><p>{t.rankedHint(ranked.length, rows.length, variety, format.date(selectedDate))}</p></div>
          <label className="filter-control"><span>{t.sameDate}</span><select value={selectedDate} onChange={(event) => setComparisonDate(event.target.value)}>{dates.map((date) => <option key={date} value={date}>{format.date(date)}</option>)}</select></label></div>
        <LazyRangeChart rows={ranked} centralLabel={t.modalPrice} description={t.rankedDescription(variety, format.date(selectedDate))} />
        <div className="chart-foot"><SourceLabel>{t.rankedSource(format.date(selectedDate))}</SourceLabel></div>
      </section>}
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>{t.latest}</h2><p>{!rows.length ? t.awaiting : allQuotesSameDate ? t.sameDay : t.varies} · {t.unit} · {t.sorted(byPrice)}</p></div>{allQuotesSameDate && <button className="sort-button" disabled={!rows.length} onClick={() => setSortBy((value) => value === "modal_price" ? "market_name" : "modal_price")}><ArrowUpDown size={16} /> {t.sortBy(sortBy === "modal_price")}</button>}</div>
        {varieties.error ? <ErrorState error={varieties.error} onRetry={() => void varieties.refetch()} /> : varieties.isLoading || (prices.isLoading && variety) ? <LoadingState /> : prices.error ? <ErrorState error={prices.error} onRetry={() => void prices.refetch()} /> : !variety ? <EmptyState title={t.noVarieties}>{t.noVarietiesHint}</EmptyState> : !rows.length ? <EmptyState title={t.noQuotes}>{t.noQuotesHint}</EmptyState> : <div className="comparison-list">{rows.map((row) =>
          <div className="comparison-row comparison-quotation" key={row.market_id}><div className="comparison-market"><strong>{row.market_name}</strong><span>{row.district} · {row.variety_name}{row.grade ? t.grade(row.grade) : ""} · {format.date(row.reporting_date)} · {row.source_name}</span></div><strong className="comparison-price">₹{Math.round(row.modal_price).toLocaleString("en-IN")}<small>{t.qtl}</small></strong></div>
        )}</div>}
      </section>
      <AboutData><p>{t.about}</p></AboutData>
    </div>
  );
}

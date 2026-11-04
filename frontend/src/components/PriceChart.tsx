import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { AriaComponent, GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ReferencePoint } from "../types";

echarts.use([LineChart, GridComponent, TooltipComponent, AriaComponent, CanvasRenderer]);

type AveragePoint = { reporting_date: string; median_average_price: number; branch_count: number };

export function PriceChart({ points = [], averagePoints, quotePoints, unitNote = "", calendarInterval = "daily", label = "Official modal-price reference index" }: {
  points?: ReferencePoint[]; averagePoints?: AveragePoint[]; quotePoints?: { reporting_date: string; average_price: number }[]; unitNote?: string; label?: string; calendarInterval?: "daily" | "monthly";
}) {
  const dateLabel = (value: number) => new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const ordered = (quotePoints
    ? quotePoints.map((point) => ({ reporting_date: point.reporting_date, value: point.average_price, constituents: 1 }))
    : averagePoints
    ? averagePoints.map((point) => ({ reporting_date: point.reporting_date, value: point.median_average_price, constituents: point.branch_count }))
    : points.map((point) => ({ reporting_date: point.reporting_date, value: point.median_modal_price, constituents: point.market_count })))
    .sort((a, b) => a.reporting_date.localeCompare(b.reporting_date));
  const series: [number, number | null][] = [];
  ordered.forEach((point, index) => {
    const time = Date.parse(`${point.reporting_date}T00:00:00Z`);
    const previous = ordered[index - 1];
    const previousDate = previous ? new Date(`${previous.reporting_date}T00:00:00Z`) : null;
    const monthDifference = previousDate ? (new Date(time).getUTCFullYear() - previousDate.getUTCFullYear()) * 12 + new Date(time).getUTCMonth() - previousDate.getUTCMonth() : 0;
    if (previous && (calendarInterval === "monthly" ? monthDifference > 1 : time - Date.parse(`${previous.reporting_date}T00:00:00Z`) > 86_400_000)) {
      series.push([time - 86_400_000, null]);
    }
    series.push([time, point.value]);
  });
  const option = {
    animation: false,
    aria: {
      enabled: true,
      label: {
        description: `${label} in INR per quintal${unitNote}. ${ordered.length} reviewed observations${ordered.length ? ` from ${dateLabel(Date.parse(ordered[0].reporting_date))} to ${dateLabel(Date.parse(ordered[ordered.length - 1].reporting_date))}` : ""}. Unpublished dates are gaps, not estimated prices. Expand View ${quotePoints ? "source" : "index"} observations for exact values and coverage.`,
      },
    },
    textStyle: { fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" },
    grid: { top: 28, right: 16, bottom: 28, left: 4, containLabel: true },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: "line", lineStyle: { color: "#7f9078", type: "dashed" } },
      valueFormatter: (value: number | null) => value == null ? "Not published" : `₹${value.toLocaleString("en-IN")}/qtl${unitNote}`,
      backgroundColor: "#203b2e",
      borderWidth: 0,
      textStyle: { color: "#fff" },
    },
    xAxis: {
      type: "time",
      axisPointer: { label: { formatter: ({ value }: { value: number }) => dateLabel(value) } },
      axisLine: { lineStyle: { color: "#dce2da" } },
      axisTick: { show: false },
      axisLabel: { color: "#64736a", fontSize: 11, hideOverlap: true, formatter: (value: number) => new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) },
      splitNumber: 4,
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: { color: "#64736a", fontSize: 11, formatter: (value: number) => `₹${value.toLocaleString("en-IN")}` },
      splitLine: { lineStyle: { color: "#e7ece2", type: "dashed" } },
      splitNumber: 4,
    },
    series: [{
      type: "line",
      name: label,
      smooth: false,
      connectNulls: false,
      symbol: "circle",
      symbolSize: ordered.length < 45 ? 5 : 3,
      showSymbol: true,
      data: series,
      itemStyle: { color: "#286348" },
      lineStyle: { color: "#286348", width: 2 },
    }],
  };
  return <div className="price-chart">
    <span className="price-chart-caption">{label} · INR / quintal{unitNote} · Gaps indicate unpublished dates</span>
    <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate style={{ height: 280, width: "100%" }} />
    <details className="chart-data"><summary>View {quotePoints ? "source" : "index"} observations ({ordered.length})</summary><div className="table-scroll" tabIndex={0} role="region" aria-label={quotePoints ? "Source observations" : "Index observations"}><table><caption>{label} · INR/qtl{unitNote}</caption><thead><tr><th scope="col">Reporting date</th><th scope="col" className="numeric">{calendarInterval === "monthly" ? "Weighted price" : quotePoints ? "Reported average" : "Index"} · INR/qtl{unitNote}</th>{calendarInterval !== "monthly" && <th scope="col" className="numeric">{averagePoints || quotePoints ? "Branches" : "Markets"}</th>}</tr></thead><tbody>{ordered.map((point) => <tr key={point.reporting_date}><td>{point.reporting_date}</td><td className="numeric table-price">₹{point.value.toLocaleString("en-IN")}</td>{calendarInterval !== "monthly" && <td className="numeric">{point.constituents}</td>}</tr>)}</tbody></table></div></details>
  </div>;
}

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { AriaComponent, GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ReferencePoint } from "../types";
import { buildChartData } from "../services/chart";
import { calendarDateToTime, formatCalendarMonth, formatChartDate } from "../../../shared/dates";

echarts.use([LineChart, GridComponent, TooltipComponent, AriaComponent, CanvasRenderer]);

type AveragePoint = { reporting_date: string; median_average_price: number; branch_count: number };

export function PriceChart({ points = [], averagePoints, quotePoints, unitNote = "", calendarInterval = "daily", range, label = "Official modal-price reference index" }: {
  points?: ReferencePoint[]; averagePoints?: AveragePoint[]; quotePoints?: { reporting_date: string; average_price: number }[]; unitNote?: string; label?: string; calendarInterval?: "daily" | "monthly"; range?: { from: string; to: string };
}) {
  const chart = buildChartData(quotePoints
    ? quotePoints.map((point) => ({ reporting_date: point.reporting_date, value: point.average_price, constituents: 1 }))
    : averagePoints
    ? averagePoints.map((point) => ({ reporting_date: point.reporting_date, value: point.median_average_price, constituents: point.branch_count }))
    : points.map((point) => ({ reporting_date: point.reporting_date, value: point.median_modal_price, constituents: point.market_count })), calendarInterval, range);
  const { ordered, series } = chart;
  const coverage = `${chart.observations} actual observations · ${chart.missing} missing calendar ${calendarInterval === "monthly" ? "months" : "dates"}${range ? " in selected range" : " between first and last observation"}`;
  const observationLabel = (time: number) => calendarInterval === "monthly"
    ? formatCalendarMonth(new Date(time).toISOString().slice(0, 7)) : formatChartDate(time);
  const option = {
    useUTC: true,
    animation: false,
    aria: {
      enabled: true,
      label: {
        description: `${label} in INR per quintal${unitNote}. ${coverage}. Unpublished dates are gaps, not estimated prices. Expand View ${quotePoints ? "source" : "index"} observations for exact values and coverage.`,
      },
    },
    textStyle: { fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" },
    grid: { top: 28, right: 16, bottom: 28, left: 4, containLabel: true },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: "line", lineStyle: { color: "#7f9078", type: "dashed" } },
      formatter: (params: { data: [number, number | null] }[]) => {
        if (!params.length) return "No observation at this calendar position";
        const [time, value] = params[0].data;
        return `${observationLabel(time)}<br />${value === null ? "Not published; no price interpolated" : `₹${value.toLocaleString("en-IN")}/qtl${unitNote}`}`;
      },
      backgroundColor: "#203b2e",
      borderWidth: 0,
      textStyle: { color: "#fff" },
    },
    xAxis: {
      type: "time",
      min: chart.from ? calendarDateToTime(chart.from) : undefined,
      max: chart.to ? calendarDateToTime(chart.to) : undefined,
      axisPointer: { label: { formatter: ({ value }: { value: number }) => observationLabel(value) } },
      axisLine: { lineStyle: { color: "#dce2da" } },
      axisTick: { show: false },
      axisLabel: { color: "#64736a", fontSize: 11, hideOverlap: true, formatter: formatChartDate },
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
    <span className="price-chart-caption">{label} · INR / quintal{unitNote} · {coverage}. Markers are actual observations{calendarInterval === "daily" ? "; missing calendar dates may include non-trading days" : "; missing reports, varieties or prices are not filled"}. No interpolation.</span>
    <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate style={{ height: 280, width: "100%" }} />
    <details className="chart-data"><summary>View {quotePoints ? "source" : "index"} observations ({ordered.length})</summary><div className="table-scroll" tabIndex={0} role="region" aria-label={quotePoints ? "Source observations" : "Index observations"}><table><caption>{label} · INR/qtl{unitNote}</caption><thead><tr><th scope="col">{calendarInterval === "monthly" ? "Reporting month" : "Reporting date"}</th><th scope="col" className="numeric">{calendarInterval === "monthly" ? "Weighted price" : quotePoints ? "Reported average" : "Index"} · INR/qtl{unitNote}</th>{calendarInterval !== "monthly" && <th scope="col" className="numeric">{averagePoints || quotePoints ? "Branches" : "Markets"}</th>}</tr></thead><tbody>{ordered.map((point) => <tr key={point.reporting_date}><td>{calendarInterval === "monthly" ? point.reporting_date.slice(0, 7) : point.reporting_date}</td><td className="numeric table-price">₹{point.value.toLocaleString("en-IN")}</td>{calendarInterval !== "monthly" && <td className="numeric">{point.constituents}</td>}</tr>)}</tbody></table></div></details>
  </div>;
}

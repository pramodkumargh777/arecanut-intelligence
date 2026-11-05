import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, AriaComponent, CanvasRenderer]);

import { SERIES_COLORS } from "./chartPalette";
export { SERIES_COLORS };
const FONT = "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
const inr = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "Not reported" : `₹${Math.round(value).toLocaleString("en-IN")}`;
const axisInr = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
const base = (description: string) => ({
  animation: false, useUTC: true, aria: { enabled: true, label: { description } }, textStyle: { fontFamily: FONT, color: "#23332d" },
  legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 4, textStyle: { color: "#3e4f45", fontSize: 12 } },
});

export type LineSeries = { name: string; values: (number | null)[]; color?: string; dashed?: boolean; markers?: boolean };

/**
 * Category-axis line chart. Null values are gaps (connectNulls false); markers show actual observations.
 * An optional band draws a shaded lower–upper interval without implying it is an observation.
 */
export function LineSeriesChart({ categories, series, band, valueFormat = "inr", description, height = 320, referenceLine }: {
  categories: string[]; series: LineSeries[]; band?: { name: string; lower: (number | null)[]; upper: (number | null)[] };
  valueFormat?: "inr" | "percent" | "index"; description: string; height?: number; referenceLine?: { value: number; label: string };
}) {
  const format = (value: number | null | undefined) => value == null ? "Not reported" : valueFormat === "inr" ? inr(value) : valueFormat === "percent" ? `${value.toFixed(1)}%` : value.toFixed(1);
  const bandSeries = band ? [
    { name: `${band.name} (lower)`, type: "line", stack: "band", data: band.lower, lineStyle: { opacity: 0 }, symbol: "none", silent: true, tooltip: { show: false }, legendHoverLink: false },
    { name: band.name, type: "line", stack: "band", data: band.upper.map((upper, index) => upper === null || band.lower[index] === null ? null : upper - band.lower[index]!),
      lineStyle: { opacity: 0 }, symbol: "none", areaStyle: { color: "rgba(40, 99, 72, 0.14)" }, color: "rgba(40, 99, 72, 0.35)", silent: true, tooltip: { show: false } },
  ] : [];
  const option = {
    ...base(description),
    legend: { ...base(description).legend, data: [...series.map((item) => item.name), ...(band ? [band.name] : [])] },
    color: series.map((item, index) => item.color ?? SERIES_COLORS[index % SERIES_COLORS.length]),
    grid: { top: 40, right: 16, bottom: 28, left: 8, containLabel: true },
    tooltip: {
      trigger: "axis", confine: true,
      formatter: (items: { seriesName: string; value: number | null; axisValueLabel: string; marker: string }[]) => {
        const rows = items.filter((item) => !item.seriesName.endsWith("(lower)") && item.seriesName !== band?.name);
        const index = categories.indexOf(items[0]?.axisValueLabel ?? "");
        const interval = band && index >= 0 && band.lower[index] !== null ? `<br/>${band.name}: ${format(band.lower[index])} – ${format(band.upper[index])}` : "";
        return `${items[0]?.axisValueLabel ?? ""}<br/>${rows.map((item) => `${item.marker}${item.seriesName}: ${format(item.value)}`).join("<br/>")}${interval}`;
      },
    },
    xAxis: { type: "category", data: categories, boundaryGap: false, axisLabel: { color: "#64736a", hideOverlap: true }, axisLine: { lineStyle: { color: "#cbd6c7" } } },
    yAxis: { type: "value", scale: true, axisLabel: { color: "#64736a", formatter: valueFormat === "inr" ? axisInr : valueFormat === "percent" ? (value: number) => `${value}%` : undefined }, splitLine: { lineStyle: { color: "#e7ece2" } } },
    series: [...bandSeries, ...series.map((item, index) => ({
      name: item.name, type: "line", data: item.values, connectNulls: false, showSymbol: item.markers ?? true, symbolSize: 5,
      lineStyle: { width: index === 0 ? 2.4 : 1.6, type: item.dashed ? "dashed" : "solid" },
      ...(index === 0 && referenceLine ? { markLine: { silent: true, symbol: "none", label: { formatter: referenceLine.label, color: "#64736a", position: "insideEndTop" }, lineStyle: { color: "#9aa79f", type: "dotted" }, data: [{ yAxis: referenceLine.value }] } } : {}),
    }))],
  };
  return <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} />;
}

/** Vertical category bars (histograms, seasonal indices, error comparisons). Null bars are omitted, not zero-filled. */
export function CategoryBarChart({ categories, values, name, color = SERIES_COLORS[0], valueFormat = "inr", description, height = 280, referenceLine, horizontal = false }: {
  categories: string[]; values: (number | null)[]; name: string; color?: string | ((index: number) => string); valueFormat?: "inr" | "percent" | "count" | "index" | "ratio";
  description: string; height?: number; referenceLine?: { value: number; label: string }; horizontal?: boolean;
}) {
  const format = (value: number | null | undefined) => value == null ? "Not available" : valueFormat === "inr" ? inr(value)
    : valueFormat === "percent" ? `${value.toFixed(1)}%` : valueFormat === "count" ? String(value) : valueFormat === "ratio" ? value.toFixed(2) : value.toFixed(1);
  const categoryAxis = { type: "category", data: categories, axisLabel: { color: "#64736a", hideOverlap: !horizontal, interval: horizontal ? 0 : "auto" }, axisLine: { lineStyle: { color: "#cbd6c7" } }, inverse: horizontal };
  const valueAxis = { type: "value", scale: valueFormat === "index", axisLabel: { color: "#64736a", formatter: valueFormat === "inr" ? axisInr : valueFormat === "percent" ? (value: number) => `${value}%` : undefined }, splitLine: { lineStyle: { color: "#e7ece2" } } };
  const option = {
    ...base(description), legend: { show: false },
    grid: { top: horizontal && referenceLine ? 28 : 16, right: 24, bottom: 24, left: 8, containLabel: true },
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, formatter: (items: { name: string; value: number | null }[]) => `${items[0]?.name}<br/>${name}: ${format(items[0]?.value)}` },
    xAxis: horizontal ? valueAxis : categoryAxis, yAxis: horizontal ? categoryAxis : valueAxis,
    series: [{
      name, type: "bar", barMaxWidth: 28, data: values.map((value, index) => ({ value, itemStyle: { color: typeof color === "function" ? color(index) : color, borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] } })),
      ...(referenceLine ? { markLine: { silent: true, symbol: "none", label: { formatter: referenceLine.label, color: "#64736a", position: horizontal ? "start" : "insideEndTop" }, lineStyle: { color: "#9aa79f", type: "dashed" }, data: [horizontal ? { xAxis: referenceLine.value } : { yAxis: referenceLine.value }] } } : {}),
    }],
  };
  return <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} />;
}

export type RangeRow = { label: string; detail?: string; minimum: number | null; central: number; maximum: number | null };

/** Horizontal ranked chart: a min–max bar per row with the central value (modal or reported average) as a marker. */
export function RankedRangeChart({ rows, centralLabel, description }: { rows: RangeRow[]; centralLabel: string; description: string }) {
  const labels = rows.map((row) => row.label);
  const hasRange = rows.map((row) => row.minimum !== null && row.maximum !== null && row.maximum >= row.minimum);
  const option = {
    ...base(description),
    legend: { ...base(description).legend, data: ["Minimum – maximum", centralLabel] },
    grid: { top: 32, right: 24, bottom: 24, left: 8, containLabel: true },
    tooltip: {
      trigger: "axis", confine: true, axisPointer: { type: "shadow" },
      formatter: (items: { dataIndex: number }[]) => {
        const row = rows[items[0]?.dataIndex ?? 0];
        return row ? `<strong>${row.label}</strong>${row.detail ? `<br/>${row.detail}` : ""}<br/>Minimum: ${inr(row.minimum)}<br/>${centralLabel}: ${inr(row.central)}<br/>Maximum: ${inr(row.maximum)}` : "";
      },
    },
    yAxis: { type: "category", data: labels, inverse: true, axisLabel: { color: "#3e4f45", interval: 0, width: 120, overflow: "truncate" }, axisLine: { lineStyle: { color: "#cbd6c7" } } },
    xAxis: { type: "value", scale: true, axisLabel: { color: "#64736a", formatter: axisInr }, splitLine: { lineStyle: { color: "#e7ece2" } } },
    series: [
      { name: "range-base", type: "bar", stack: "range", silent: true, itemStyle: { color: "transparent" }, data: rows.map((row, index) => hasRange[index] ? row.minimum : null), tooltip: { show: false } },
      { name: "Minimum – maximum", type: "bar", stack: "range", barMaxWidth: 14, itemStyle: { color: "#cfe0d2", borderColor: "#8aa889", borderWidth: 1, borderRadius: 3 },
        data: rows.map((row, index) => hasRange[index] ? row.maximum! - row.minimum! : null) },
      { name: centralLabel, type: "scatter", symbol: "diamond", symbolSize: 12, itemStyle: { color: "#286348" }, data: rows.map((row) => row.central), z: 3 },
    ],
  };
  // Value axis must start at the smallest minimum; a "transparent" base keeps bars aligned on a scaled axis.
  const lowest = Math.min(...rows.flatMap((row) => [row.minimum ?? row.central, row.central]));
  const highest = Math.max(...rows.flatMap((row) => [row.maximum ?? row.central, row.central]));
  const pad = Math.max(1, (highest - lowest) * 0.06);
  option.xAxis = { ...option.xAxis, scale: false, min: Math.max(0, Math.floor((lowest - pad) / 100) * 100), max: Math.ceil((highest + pad) / 100) * 100 } as typeof option.xAxis;
  return <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate style={{ height: Math.max(180, rows.length * 34 + 70), width: "100%" }} opts={{ renderer: "canvas" }} />;
}

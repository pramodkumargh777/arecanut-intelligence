import ReactEChartsCore from "echarts-for-react/lib/core";
import { useResponsiveChart } from "./useResponsiveChart";
import { usePhone } from "./usePhone";
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { CHART_FONT, chartMotion, monthAxisInterval, SERIES_COLORS, useChartPalette } from "./chartPalette";
import { defineCopy, useCopy } from "../services/language";

const CHART = defineCopy({
  en: { notReported: "Not reported", notAvailable: "Not available", isolated: " (isolated)", range: "Minimum – maximum", minimum: "Minimum", maximum: "Maximum" },
  kn: { notReported: "ವರದಿಯಾಗಿಲ್ಲ", notAvailable: "ಲಭ್ಯವಿಲ್ಲ", isolated: " (ಒಂಟಿ ವರದಿ)", range: "ಕನಿಷ್ಠ – ಗರಿಷ್ಠ", minimum: "ಕನಿಷ್ಠ", maximum: "ಗರಿಷ್ಠ" },
});

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent, AriaComponent, CanvasRenderer]);

export { SERIES_COLORS };
const inr = (value: number | null | undefined, missing = CHART.en.notReported) => value == null || !Number.isFinite(value) ? missing : `₹${Math.round(value).toLocaleString("en-IN")}`;
const axisInr = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
const base = (description: string, INK: ReturnType<typeof useChartPalette>["INK"]) => ({
  ...chartMotion(), useUTC: true, aria: { enabled: true, label: { description } }, textStyle: { fontFamily: CHART_FONT, color: INK[900] },
  legend: { top: 0, left: 0, itemWidth: 22, itemHeight: 8, itemGap: 16, itemStyle: { opacity: 0 }, textStyle: { color: INK[600], fontSize: 12, fontFamily: CHART_FONT } },
});

export type LineSeries = { name: string; values: (number | null)[]; color?: string; dashed?: boolean; dotted?: boolean; markers?: boolean; width?: number };
export type ChartRegion = { from: string; to: string; label: string };

/**
 * Category-axis line chart with monotone smoothing, which never overshoots an observed value. Null values remain
 * gaps; a value with no neighbour on either side keeps a visible dot, since a line cannot draw it.
 * A band draws the lower–upper interval as a whisker, so an interval is not mistaken for an observation.
 */
export function LineSeriesChart({ categories, series, band, valueFormat = "inr", description, height = 320, referenceLine, regions = [], endLabel = false }: {
  categories: string[]; series: LineSeries[]; band?: { name: string; lower: (number | null)[]; upper: (number | null)[] };
  valueFormat?: "inr" | "percent" | "index"; description: string; height?: number; referenceLine?: { value: number; label: string }; regions?: ChartRegion[]; endLabel?: boolean;
}) {
  const t = useCopy(CHART);
  const onChartReady = useResponsiveChart();
  const { AXIS_LABEL, AXIS_LINE, BRAND_AREA, CROSSHAIR, GRID_LINE, INK, SERIES_COLORS, TOOLTIP, tooltipHtml, regionShade } = useChartPalette();
  const phone = usePhone();
  const ISOLATED = t.isolated;
  const format = (value: number | null | undefined) => value == null ? t.notReported : valueFormat === "inr" ? inr(value) : valueFormat === "percent" ? `${value.toFixed(1)}%` : value.toFixed(1);
  const single = series.length === 1;
  const whiskers = band ? categories.flatMap((category, index) => band.lower[index] !== null && band.upper[index] !== null
    ? [[{ xAxis: category, yAxis: band.lower[index] }, { xAxis: category, yAxis: band.upper[index] }]] : []) : [];
  const colorOf = (item: LineSeries, index: number) => item.color ?? SERIES_COLORS[index % SERIES_COLORS.length];
  const isolated = series.flatMap((item, index) => {
    const points = item.values.flatMap((value, position) => value !== null && item.values[position - 1] == null && item.values[position + 1] == null ? [[categories[position], value]] : []);
    return points.length ? [{ name: `${item.name}${ISOLATED}`, type: "scatter", data: points, symbolSize: 6, itemStyle: { color: colorOf(item, index) }, silent: true, z: 3 }] : [];
  });
  const legendItems = series.length + (band ? 1 : 0);
  const showEnd = endLabel && single && series[0].values.at(-1) != null;
  const option = {
    ...base(description, INK),
    // On phones up to four legend entries wrap onto two rows the grid reserves, so every line (and the forecast range)
    // is named without paging; longer legends scroll along one row.
    legend: { ...base(description, INK).legend, show: !single, ...(phone ? { itemGap: 12, ...(legendItems > 4 ? { type: "scroll", pageIconSize: 10, pageTextStyle: { color: INK[500], fontSize: 11 } } : {}) } : {}), data: [...series.map((item) => item.name), ...(band ? [band.name] : [])] },
    grid: { top: single ? 16 : phone ? (legendItems > 2 && legendItems <= 4 ? 58 : 36) : series.length > 4 ? 68 : 40, right: showEnd ? 60 : 16, bottom: 4, left: 4, containLabel: true },
    tooltip: {
      ...TOOLTIP, trigger: "axis", axisPointer: CROSSHAIR,
      formatter: (items: { seriesName: string; value: number | null; axisValueLabel: string; color: string; dataIndex: number }[]) => {
        const rows = items.filter((item) => !item.seriesName.endsWith(ISOLATED) && item.seriesName !== band?.name);
        const index = items[0]?.dataIndex ?? -1;
        const interval = band && index >= 0 && band.lower[index] != null ? [{ label: band.name, value: `${format(band.lower[index])} – ${format(band.upper[index])}` }] : [];
        return tooltipHtml(items[0]?.axisValueLabel ?? "", [
          ...rows.map((item) => ({ label: item.seriesName, value: format(item.value), marker: single ? "" : `<span style="display:inline-block;width:10px;height:2px;margin:0 6px 3px 0;background:${item.color}"></span>` })),
          ...interval,
        ]);
      },
    },
    xAxis: { type: "category", data: categories, boundaryGap: false, axisTick: { show: false }, axisLabel: { ...AXIS_LABEL, hideOverlap: true, interval: monthAxisInterval(categories) }, axisLine: AXIS_LINE },
    yAxis: { type: "value", scale: true, splitNumber: 4, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...AXIS_LABEL, formatter: valueFormat === "inr" ? axisInr : valueFormat === "percent" ? (value: number) => `${value}%` : undefined }, splitLine: GRID_LINE },
    series: [
      ...series.map((item, index) => {
        const color = colorOf(item, index);
        const markers = item.markers ?? (single && categories.length <= 36);
        return {
          name: item.name, type: "line", data: item.values, connectNulls: false, smooth: 0.35, smoothMonotone: "x", color,
          showSymbol: markers, symbol: "circle", symbolSize: markers ? 6 : 7,
          itemStyle: { color, borderColor: INK.surface, borderWidth: 1.5 }, emphasis: { scale: false },
          lineStyle: { color, width: item.width ?? (index === 0 ? 2 : 1.5), type: item.dotted ? "dotted" : item.dashed ? "dashed" : "solid", cap: "round", join: "round" },
          ...(single ? { areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: BRAND_AREA[0] }, { offset: 1, color: BRAND_AREA[1] }]) } } : {}),
          ...(showEnd ? { endLabel: { show: true, color: INK[900], fontSize: 11, fontWeight: 600, fontFamily: CHART_FONT, distance: 6, formatter: ({ value }: { value: number }) => format(value) } } : {}),
          ...(index === 0 && regions.length ? { markArea: { silent: true, itemStyle: { color: regionShade }, label: { color: INK[500], fontSize: 11, position: "insideTop", distance: 6, fontFamily: CHART_FONT }, data: regions.map((region) => [{ xAxis: region.from, name: region.label }, { xAxis: region.to }]) } } : {}),
          ...(index === 0 && (referenceLine || whiskers.length) ? { markLine: { silent: true, symbol: "none", animation: false, data: [
            ...(referenceLine ? [{ yAxis: referenceLine.value, label: { formatter: referenceLine.label, color: INK[500], position: "insideEndTop" }, lineStyle: { color: INK[400], width: 1, type: "solid" } }] : []),
            ...whiskers.map((pair) => pair.map((point, position) => position ? point : { ...point, label: { show: false }, lineStyle: { color: INK[300], width: 6, type: "solid", cap: "round" } })),
          ] } } : {}),
        };
      }),
      ...isolated,
      ...(band ? [{ name: band.name, type: "line", data: [], color: INK[300], lineStyle: { color: INK[300], width: 6 }, showSymbol: false }] : []),
    ],
  };
  return <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate onChartReady={onChartReady} autoResize={false} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} />;
}

/** Vertical category bars (histograms, seasonal indices, error comparisons). Null bars are omitted, not zero-filled. */
export function CategoryBarChart({ categories, values, name, color: givenColor, valueFormat = "inr", description, height = 280, referenceLine, horizontal = false, tooltipLabels }: {
  categories: string[]; values: (number | null)[]; name: string; color?: string | ((index: number) => string); valueFormat?: "inr" | "percent" | "count" | "index" | "ratio";
  description: string; height?: number; referenceLine?: { value: number; label?: string }; horizontal?: boolean; tooltipLabels?: string[];
}) {
  const t = useCopy(CHART);
  const onChartReady = useResponsiveChart();
  const { AXIS_LABEL, AXIS_LINE, BRAND, GRID_LINE, INK, TOOLTIP, tooltipHtml, shade } = useChartPalette();
  const color = givenColor ?? BRAND;
  const format = (value: number | null | undefined) => value == null ? t.notAvailable : valueFormat === "inr" ? inr(value)
    : valueFormat === "percent" ? `${value.toFixed(1)}%` : valueFormat === "count" ? String(value) : valueFormat === "ratio" ? value.toFixed(2) : value.toFixed(1);
  const categoryAxis = { type: "category", data: categories, axisTick: { show: false }, axisLabel: { ...AXIS_LABEL, hideOverlap: !horizontal, interval: horizontal ? 0 : monthAxisInterval(categories), color: horizontal ? INK[700] : INK[500] }, axisLine: { ...AXIS_LINE, onZero: false }, inverse: horizontal };
  const valueAxis = { type: "value", scale: valueFormat === "index", splitNumber: 4, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...AXIS_LABEL, formatter: valueFormat === "inr" ? axisInr : valueFormat === "percent" ? (value: number) => `${value}%` : undefined }, splitLine: GRID_LINE };
  const labelled = Boolean(referenceLine?.label);
  // On phones a vertical chart's reference label sits above its line at the left, on a backing so a bar behind it
  // cannot hide it, instead of in a margin that took a quarter of the width.
  const phone = usePhone();
  const labelInside = phone && !horizontal;
  const option = {
    ...base(description, INK), legend: { show: false },
    grid: { top: horizontal && labelled ? 28 : 12, right: !horizontal && labelled && !labelInside ? 84 : phone ? 8 : 24, bottom: 4, left: 4, containLabel: true },
    tooltip: { ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: shade } }, formatter: (items: { name: string; value: number | null; dataIndex: number }[]) => tooltipHtml(tooltipLabels?.[items[0]?.dataIndex] ?? items[0]?.name ?? "", [{ label: name, value: format(items[0]?.value) }]) },
    xAxis: horizontal ? valueAxis : categoryAxis, yAxis: horizontal ? categoryAxis : valueAxis,
    series: [{
      name, type: "bar", barMaxWidth: horizontal ? 14 : 22, barCategoryGap: "32%",
      data: values.map((value, index) => ({ value, itemStyle: { color: typeof color === "function" ? color(index) : color, borderRadius: horizontal ? [0, 3, 3, 0] : (value ?? 0) < 0 ? [0, 0, 3, 3] : [3, 3, 0, 0] } })),
      ...(referenceLine ? { markLine: { silent: true, symbol: "none", animation: false, label: labelled ? { formatter: referenceLine.label, color: INK[500], fontSize: 11, position: horizontal ? "start" : labelInside ? "insideStartTop" : "end", ...(labelInside ? { backgroundColor: INK.surface, padding: [1, 4], borderRadius: 3 } : {}) } : { show: false }, lineStyle: { color: INK[400], width: 1, type: "solid" }, data: [horizontal ? { xAxis: referenceLine.value } : { yAxis: referenceLine.value }] } } : {}),
    }],
  };
  return <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate onChartReady={onChartReady} autoResize={false} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} />;
}

export type RangeRow = { label: string; detail?: string; minimum: number | null; central: number; maximum: number | null };

/** Round axis bounds, so the range axis labels regular prices instead of the raw edges of the data. */
function niceBounds(lowest: number, highest: number) {
  const rough = Math.max(1, highest - lowest) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) ?? rough;
  return { min: Math.max(0, Math.floor(lowest / step) * step), max: Math.ceil(highest / step) * step, interval: step };
}

/** Horizontal ranked chart: a min–max bar per row with the central value (modal or reported average) as a labelled marker. */
export function RankedRangeChart({ rows, centralLabel, description }: { rows: RangeRow[]; centralLabel: string; description: string }) {
  const t = useCopy(CHART);
  const onChartReady = useResponsiveChart();
  const { AXIS_LABEL, AXIS_LINE, BRAND, GRID_LINE, INK, TOOLTIP, tooltipHtml, shade } = useChartPalette();
  const labels = rows.map((row) => row.label);
  const hasRange = rows.map((row) => row.minimum !== null && row.maximum !== null && row.maximum >= row.minimum);
  const lowest = Math.min(...rows.flatMap((row) => [row.minimum ?? row.central, row.central]));
  const highest = Math.max(...rows.flatMap((row) => [row.maximum ?? row.central, row.central]));
  const option = {
    ...base(description, INK),
    legend: { ...base(description, INK).legend, icon: "roundRect", itemWidth: 14, itemHeight: 6, itemStyle: { opacity: 1 }, data: [t.range, centralLabel] },
    grid: { top: 36, right: 24, bottom: 4, left: 4, containLabel: true },
    tooltip: {
      ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: shade } },
      formatter: (items: { dataIndex: number }[]) => {
        const row = rows[items[0]?.dataIndex ?? 0];
        return row ? tooltipHtml(row.label, [{ label: t.minimum, value: inr(row.minimum, t.notReported) }, { label: centralLabel, value: inr(row.central, t.notReported) }, { label: t.maximum, value: inr(row.maximum, t.notReported) }], row.detail) : "";
      },
    },
    yAxis: { type: "category", data: labels, inverse: true, axisTick: { show: false }, axisLabel: { ...AXIS_LABEL, color: INK[700], interval: 0, width: 120, overflow: "truncate" }, axisLine: AXIS_LINE },
    xAxis: { type: "value", ...niceBounds(lowest, highest), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...AXIS_LABEL, formatter: axisInr }, splitLine: GRID_LINE },
    series: [
      { name: "range-base", type: "bar", stack: "range", silent: true, itemStyle: { color: "transparent" }, data: rows.map((row, index) => hasRange[index] ? row.minimum : null), tooltip: { show: false } },
      { name: t.range, type: "bar", stack: "range", barMaxWidth: 10, color: INK[200], itemStyle: { color: INK[200], borderRadius: 3 },
        data: rows.map((row, index) => hasRange[index] ? row.maximum! - row.minimum! : null) },
      { name: centralLabel, type: "scatter", symbol: "circle", symbolSize: 10, color: BRAND, itemStyle: { color: BRAND, borderColor: INK.surface, borderWidth: 2 }, data: rows.map((row) => row.central), z: 3,
        label: { show: rows.length <= 16, position: "top", distance: 4, color: INK[900], fontSize: 11, fontWeight: 600, fontFamily: CHART_FONT, formatter: ({ value }: { value: number }) => inr(value) } },
    ],
  };
  return <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate onChartReady={onChartReady} autoResize={false} style={{ height: Math.max(200, rows.length * 46 + 72), width: "100%" }} opts={{ renderer: "canvas" }} />;
}

/**
 * Backtest track record: the actual price, a model's one-step forecast and its 80% band (a shaded area, not whiskers,
 * since every month has one), with the last-value baseline as a faint dotted reference.
 */
export function TrackRecordChart({ periods, actual, median, lower, upper, baseline, labels, description, height = 320 }: {
  periods: string[]; actual: number[]; median: number[]; lower: number[]; upper: number[]; baseline: number[];
  labels: { actual: string; forecast: string; band: string; baseline: string; month: (period: string) => string };
  description: string; height?: number;
}) {
  const onChartReady = useResponsiveChart();
  const phone = usePhone();
  const { AXIS_LABEL, AXIS_LINE, BRAND, CROSSHAIR, GRID_LINE, INK, TOOLTIP, tooltipHtml } = useChartPalette();
  const categories = periods.map(labels.month);
  const option = {
    ...base(description, INK),
    legend: { ...base(description, INK).legend, itemStyle: { opacity: 1 }, data: [labels.actual, labels.forecast, labels.band, labels.baseline],
      ...(phone ? { itemGap: 10, textStyle: { color: INK[600], fontSize: 11, fontFamily: CHART_FONT } } : {}) },
    grid: { top: phone ? 52 : 36, right: phone ? 8 : 16, bottom: 4, left: 4, containLabel: true },
    tooltip: {
      ...TOOLTIP, trigger: "axis", axisPointer: CROSSHAIR,
      formatter: (items: { dataIndex: number }[]) => {
        const i = items[0]?.dataIndex ?? 0;
        const miss = median[i] - actual[i];
        return tooltipHtml(categories[i], [
          { label: labels.actual, value: inr(actual[i]) },
          { label: labels.forecast, value: `${inr(median[i])} (${miss >= 0 ? "+" : "−"}${inr(Math.abs(miss)).slice(1)})` },
          { label: labels.band, value: `${inr(lower[i])} – ${inr(upper[i])}` },
          { label: labels.baseline, value: inr(baseline[i]) },
        ]);
      },
    },
    xAxis: { type: "category", data: categories, boundaryGap: false, axisTick: { show: false }, axisLabel: { ...AXIS_LABEL, hideOverlap: true, interval: monthAxisInterval(periods) }, axisLine: AXIS_LINE },
    yAxis: { type: "value", scale: true, splitNumber: 4, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...AXIS_LABEL, formatter: axisInr }, splitLine: GRID_LINE },
    series: [
      { name: "band-floor", type: "line", data: lower, stack: "band", symbol: "none", lineStyle: { opacity: 0 }, silent: true, tooltip: { show: false } },
      { name: labels.band, type: "line", data: upper.map((value, i) => value - lower[i]), stack: "band", symbol: "none", color: BRAND,
        lineStyle: { opacity: 0 }, areaStyle: { color: BRAND, opacity: 0.14 }, silent: true },
      { name: labels.baseline, type: "line", data: baseline, symbol: "none", color: INK[400], lineStyle: { color: INK[400], width: 1, type: "dotted" } },
      { name: labels.forecast, type: "line", data: median, symbol: "none", smooth: 0.3, smoothMonotone: "x", color: BRAND, lineStyle: { color: BRAND, width: 2, type: "dashed" } },
      { name: labels.actual, type: "line", data: actual, symbol: "circle", symbolSize: 5, showSymbol: periods.length <= 40, smooth: 0.3, smoothMonotone: "x",
        color: INK[900], itemStyle: { color: INK[900], borderColor: INK.surface, borderWidth: 1 }, lineStyle: { color: INK[900], width: 2 } },
    ],
  };
  return <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate onChartReady={onChartReady} autoResize={false} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} />;
}

/**
 * Recent prices with the outlook as a fan: a dashed line from the last official price through each month's estimate,
 * and the likely range opening from that last price to each month's lower–upper bounds.
 */
export function OutlookChart({ periods, prices, next, labels, description, height = 300 }: {
  periods: string[]; prices: number[]; next: { label: string; point: number; lower: number; upper: number; chance?: string }[];
  labels: { actual: string; outlook: string; range: string; month: (period: string) => string }; description: string; height?: number;
}) {
  const onChartReady = useResponsiveChart();
  const phone = usePhone();
  const { AXIS_LABEL, AXIS_LINE, BRAND, CROSSHAIR, GRID_LINE, INK, TOOLTIP, tooltipHtml } = useChartPalette();
  const categories = [...periods.map(labels.month), ...next.map((item) => item.label)];
  const n = periods.length, last = prices[n - 1];
  const gap = Array(n - 1).fill(null);
  const option = {
    ...base(description, INK),
    legend: { ...base(description, INK).legend, itemStyle: { opacity: 1 }, data: [labels.actual, labels.outlook, labels.range],
      ...(phone ? { itemGap: 10, textStyle: { color: INK[600], fontSize: 11, fontFamily: CHART_FONT } } : {}) },
    // On phones the three legend entries take two rows, so the plot starts lower.
    grid: { top: phone ? 56 : 36, right: phone ? 8 : 16, bottom: 4, left: 4, containLabel: true },
    tooltip: {
      ...TOOLTIP, trigger: "axis", axisPointer: CROSSHAIR,
      formatter: (items: { dataIndex: number }[]) => {
        const i = items[0]?.dataIndex ?? 0;
        const ahead = next[i - n];
        return ahead
          ? tooltipHtml(ahead.label, [{ label: labels.outlook, value: inr(ahead.point) }, { label: labels.range, value: `${inr(ahead.lower)} – ${inr(ahead.upper)}` },
            ...(ahead.chance ? [{ value: ahead.chance }] : [])])
          : tooltipHtml(categories[i], [{ label: labels.actual, value: inr(prices[i]) }]);
      },
    },
    xAxis: { type: "category", data: categories, boundaryGap: false, axisTick: { show: false }, axisLabel: { ...AXIS_LABEL, hideOverlap: true, interval: monthAxisInterval(periods) }, axisLine: AXIS_LINE },
    yAxis: { type: "value", scale: true, splitNumber: 4, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...AXIS_LABEL, formatter: axisInr }, splitLine: GRID_LINE },
    series: [
      { name: "fan-floor", type: "line", data: [...gap, last, ...next.map((item) => item.lower)], stack: "fan", symbol: "none", lineStyle: { opacity: 0 }, silent: true, tooltip: { show: false } },
      { name: labels.range, type: "line", data: [...gap, 0, ...next.map((item) => item.upper - item.lower)], stack: "fan", symbol: "none", smooth: 0.3, color: BRAND, lineStyle: { opacity: 0 }, areaStyle: { color: BRAND, opacity: 0.18 }, silent: true },
      { name: labels.outlook, type: "line", data: [...gap, last, ...next.map((item) => item.point)], color: BRAND, symbol: "circle", symbolSize: 7, showSymbol: true,
        itemStyle: { color: BRAND, borderColor: INK.surface, borderWidth: 2 }, lineStyle: { color: BRAND, width: 2, type: "dashed" } },
      { name: labels.actual, type: "line", data: [...prices, ...next.map(() => null)], symbol: "none", smooth: 0.3, smoothMonotone: "x", color: INK[900], lineStyle: { color: INK[900], width: 2.25 } },
    ],
  };
  return <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate onChartReady={onChartReady} autoResize={false} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} />;
}

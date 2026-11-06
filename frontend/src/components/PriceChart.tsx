import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart, ScatterChart } from "echarts/charts";
import { AriaComponent, GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ReferencePoint } from "../types";
import { buildChartData, connectShortGaps, missingPeriods } from "../services/chart";
import { calendarDateToTime, DAY_MS, formatCalendarDate, formatCalendarMonth, formatChartDate } from "../../../shared/dates";
import { AXIS_LABEL, AXIS_LINE, CHART_FONT, CROSSHAIR, GRID_LINE, INK, TOOLTIP, tooltipHtml } from "./chartPalette";

echarts.use([LineChart, ScatterChart, GridComponent, TooltipComponent, AriaComponent, CanvasRenderer]);

type AveragePoint = { reporting_date: string; median_average_price: number; branch_count: number; branches?: string[] };
const rupees = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function PriceChart({ points = [], averagePoints, quotePoints, unitNote = "", calendarInterval = "daily", range, label = "Official modal-price reference index", showStats = true }: {
  points?: ReferencePoint[]; averagePoints?: AveragePoint[]; quotePoints?: { reporting_date: string; average_price: number }[]; unitNote?: string; label?: string; calendarInterval?: "daily" | "monthly"; range?: { from: string; to: string }; showStats?: boolean;
}) {
  const chart = buildChartData(quotePoints
    ? quotePoints.map((point) => ({ reporting_date: point.reporting_date, value: point.average_price, constituents: 1 }))
    : averagePoints
    ? averagePoints.map((point) => ({ reporting_date: point.reporting_date, value: point.median_average_price, constituents: point.branch_count }))
    : points.map((point) => ({ reporting_date: point.reporting_date, value: point.median_modal_price, constituents: point.market_count })), calendarInterval, range);
  const { ordered } = chart;
  const monthly = calendarInterval === "monthly";
  const line = connectShortGaps(chart.series, calendarInterval);
  const periodWord = monthly ? "month" : "date";
  const missing = missingPeriods(ordered, calendarInterval, range);
  const place = (count: number) => averagePoints || quotePoints ? `${count} ${count === 1 ? "branch" : "branches"}` : plural(count, "market");
  const dateText = (date: string) => monthly ? formatCalendarMonth(date.slice(0, 7)) : formatCalendarDate(date);
  const observationLabel = (time: number) => monthly ? formatCalendarMonth(new Date(time).toISOString().slice(0, 7)) : formatChartDate(time);
  const coverage = `${plural(chart.observations, "report")} · ${plural(chart.missing, periodWord)} without a report${range ? " in the selected range" : ""}`;
  const missingNote = missing.length && missing.length <= 5 ? ` (${missing.map(dateText).join(", ")})` : "";
  const values = ordered.map((point) => point.value);
  const latest = ordered.at(-1);
  const high = values.length ? Math.max(...values) : 0, low = values.length ? Math.min(...values) : 0;
  const highPoint = ordered.find((point) => point.value === high), lowPoint = ordered.find((point) => point.value === low);
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const first = ordered[0];
  // A benchmark's constituent branches change between dates, so a first-to-last change is shown only for one fixed series.
  const change = quotePoints && first && latest && ordered.length > 1 && first.value !== 0 ? (latest.value - first.value) / first.value * 100 : null;
  const table = <details className="chart-data"><summary>View {quotePoints ? "source" : "index"} observations ({ordered.length})</summary><div className="table-scroll" tabIndex={0} role="region" aria-label={quotePoints ? "Source observations" : "Index observations"}><table><caption>{label} · INR/qtl{unitNote}</caption><thead><tr><th scope="col">{monthly ? "Reporting month" : "Reporting date"}</th><th scope="col" className="numeric">{monthly ? "Weighted price" : quotePoints ? "Reported average" : "Index"} · INR/qtl{unitNote}</th>{!monthly && <th scope="col" className="numeric">{averagePoints || quotePoints ? "Branches" : "Markets"}</th>}</tr></thead><tbody>{[...ordered].reverse().map((point) => <tr key={point.reporting_date}><td>{dateText(point.reporting_date)}</td><td className="numeric table-price">₹{point.value.toLocaleString("en-IN")}</td>{!monthly && <td className="numeric">{point.constituents}</td>}</tr>)}</tbody></table></div></details>;

  // One observation is not a trend, so it is stated as a value rather than plotted as a lone dot on an empty axis.
  if (ordered.length === 1 && latest) return <div className="price-chart">
    <div className="single-observation">
      <div><span>{dateText(latest.reporting_date)}</span><strong>{rupees(latest.value)}<small>/ quintal{unitNote}</small></strong><p>{place(latest.constituents)} · {label}</p></div>
      <p>The trend line appears once a second {monthly ? "reporting month" : "reporting date"} qualifies. Nothing is estimated in the meantime.</p>
    </div>
    {table}
  </div>;

  const spanDays = first && latest ? (calendarDateToTime(latest.reporting_date) - calendarDateToTime(first.reporting_date)) / DAY_MS : 0;
  const axisDate = (time: number) => {
    const iso = new Date(time).toISOString().slice(0, 10);
    if (monthly || spanDays > 300) return formatCalendarMonth(iso.slice(0, 7));
    return formatCalendarDate(iso).replace(/ \d{4}$/, "");
  };
  const markers = ordered.length <= 60;
  const isolated = line.flatMap(([time, value], index) => value !== null && line[index - 1]?.[1] == null && line[index + 1]?.[1] == null ? [[time, value]] : []);
  const branchesOn = new Map((averagePoints ?? []).map((point) => [calendarDateToTime(point.reporting_date), point.branches ?? []]));
  const option = {
    useUTC: true,
    animation: false,
    aria: { enabled: true, label: { description: `${label} in INR per quintal${unitNote}. ${coverage}. The line joins reported values and no price is estimated for dates without a report. Expand View ${quotePoints ? "source" : "index"} observations for exact values and coverage.` } },
    textStyle: { fontFamily: CHART_FONT },
    grid: { top: 16, right: 64, bottom: 4, left: 4, containLabel: true },
    tooltip: {
      ...TOOLTIP, trigger: "axis", axisPointer: CROSSHAIR,
      formatter: (params: { data: [number, number | null] }[]) => {
        const data = params[0]?.data;
        if (!data) return "";
        const [time, value] = data;
        if (value === null) return tooltipHtml(observationLabel(time), [], "No report on this date. No price is estimated.");
        const observation = ordered.find((point) => calendarDateToTime(point.reporting_date) === time);
        const names = branchesOn.get(time) ?? [];
        return tooltipHtml(observationLabel(time), [
          { value: `${rupees(value)} / qtl` },
          ...(!monthly && observation ? [{ label: averagePoints || quotePoints ? "Branches" : "Markets", value: String(observation.constituents) }] : []),
        ], names.length ? names.join(", ") : unitNote ? `INR/quintal${unitNote}` : undefined);
      },
    },
    xAxis: {
      type: "time",
      min: chart.from ? calendarDateToTime(chart.from) : undefined,
      max: chart.to ? calendarDateToTime(chart.to) : undefined,
      minInterval: monthly ? 28 * DAY_MS : DAY_MS,
      axisLine: AXIS_LINE,
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { ...AXIS_LABEL, hideOverlap: true, formatter: axisDate },
      splitNumber: 5,
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { ...AXIS_LABEL, formatter: (value: number) => rupees(value) },
      splitLine: GRID_LINE,
      splitNumber: 4,
    },
    series: [{
      type: "line",
      name: label,
      smooth: 0.35,
      smoothMonotone: "x",
      connectNulls: false,
      symbol: "circle",
      symbolSize: markers ? 7 : 8,
      showSymbol: markers,
      data: line,
      itemStyle: { color: INK[900], borderColor: INK.surface, borderWidth: 1.5 },
      lineStyle: { color: INK[900], width: 2, cap: "round", join: "round" },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "rgba(24,24,27,.10)" }, { offset: 1, color: "rgba(24,24,27,0)" }]) },
      emphasis: { scale: false },
      endLabel: { show: true, color: INK[900], fontSize: 11, fontWeight: 600, fontFamily: CHART_FONT, distance: 6, formatter: ({ value }: { value: [number, number] }) => rupees(value[1]) },
    }, ...(isolated.length ? [{ type: "scatter", name: "Isolated report", data: isolated, symbolSize: 7, itemStyle: { color: INK[900] }, silent: true, tooltip: { show: false } }] : [])],
  };
  return <div className="price-chart">
    {showStats && latest && <dl className="chart-stats">
      <div><dt>Latest</dt><dd>{rupees(latest.value)}</dd><small>{dateText(latest.reporting_date)}</small></div>
      {change !== null && <div><dt>Change over period</dt><dd>{change >= 0 ? "+" : "−"}{Math.abs(change).toFixed(1)}%</dd><small>since {dateText(first.reporting_date)}</small></div>}
      <div><dt>High</dt><dd>{rupees(high)}</dd><small>{highPoint && dateText(highPoint.reporting_date)}</small></div>
      <div><dt>Low</dt><dd>{rupees(low)}</dd><small>{lowPoint && dateText(lowPoint.reporting_date)}</small></div>
      <div><dt>Average</dt><dd>{rupees(mean)}</dd><small>{plural(chart.observations, "report")}</small></div>
    </dl>}
    <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate style={{ height: 300, width: "100%" }} />
    <p className="price-chart-caption">{label} · INR / quintal{unitNote} · {coverage}{missingNote}. {markers ? "Each marker is a reported value; the" : "The"} line joins reported values and no price is estimated between them{monthly ? "" : ". Dates without a report may be non-trading days"}.</p>
    {table}
  </div>;
}

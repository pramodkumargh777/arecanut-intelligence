import ReactEChartsCore from "echarts-for-react/lib/core";
import { useResponsiveChart } from "./useResponsiveChart";
import { usePhone } from "./usePhone";
import * as echarts from "echarts/core";
import { LineChart, ScatterChart } from "echarts/charts";
import { AriaComponent, GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ReferencePoint } from "../types";
import { buildChartData, connectShortGaps, missingPeriods } from "../services/chart";
import { calendarDateToTime, DAY_MS } from "../../../shared/dates";
import { defineCopy, formatDate, formatMonth, useCopy, useLanguage } from "../services/language";
import { CHART_FONT, useChartPalette } from "./chartPalette";
import { eventsBetween } from "../services/market-events";

echarts.use([LineChart, ScatterChart, GridComponent, TooltipComponent, AriaComponent, MarkLineComponent, CanvasRenderer]);

type AveragePoint = { reporting_date: string; median_average_price: number; branch_count: number; branches?: string[] };
const rupees = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;

const COPY = defineCopy({
  en: {
    defaultLabel: "Official modal-price reference index",
    reports: (n: number) => `${n} report${n === 1 ? "" : "s"}`,
    places: (n: number, branches: boolean) => branches ? `${n} ${n === 1 ? "branch" : "branches"}` : `${n} market${n === 1 ? "" : "s"}`,
    withoutReport: (n: number, monthly: boolean, inRange: boolean) => `${n} ${monthly ? "month" : "date"}${n === 1 ? "" : "s"} without a report${inRange ? " in the selected range" : ""}`,
    viewObservations: (source: boolean, n: number) => `View ${source ? "source" : "index"} observations (${n})`,
    sourceObservations: "Source observations", indexObservations: "Index observations",
    perQtl: "INR/qtl", perQuintal: "INR / quintal", qtl: "/ qtl", quintal: "/ quintal",
    reportingMonth: "Reporting month", reportingDate: "Reporting date", weightedPrice: "Weighted price", reportedAverage: "Reported average", index: "Index",
    branches: "Branches", markets: "Markets",
    trendLater: (monthly: boolean) => `The trend line appears once a second ${monthly ? "reporting month" : "reporting date"} qualifies. Nothing is estimated in the meantime.`,
    aria: (label: string, unit: string, coverage: string, source: boolean) => `${label} in INR per quintal${unit}. ${coverage}. The line joins reported values and no price is estimated for dates without a report. Expand View ${source ? "source" : "index"} observations for exact values and coverage.`,
    noReport: "No report on this date. No price is estimated.", isolated: "Isolated report",
    latest: "Latest", change: "Change over period", since: (date: string) => `since ${date}`, high: "High", low: "Low", average: "Average",
    events: "What happened", eventsAria: "Policy and tax events marked on the chart", inForce: "in force", source: "source",
    caption: (markers: boolean, monthly: boolean) => `${markers ? "Each marker is a reported value; the" : "The"} line joins reported values and no price is estimated between them${monthly ? "" : ". Dates without a report may be non-trading days"}.`,
  },
  kn: {
    defaultLabel: "ಅಧಿಕೃತ ಮಾದರಿ ದರದ ಮಾನದಂಡ ಸೂಚ್ಯಂಕ",
    reports: (n: number) => `${n} ವರದಿಗಳು`,
    places: (n: number, branches: boolean) => branches ? `${n} ಶಾಖೆಗಳು` : `${n} ಮಾರುಕಟ್ಟೆಗಳು`,
    withoutReport: (n: number, monthly: boolean, inRange: boolean) => `${inRange ? "ಆಯ್ದ ಅವಧಿಯಲ್ಲಿ " : ""}ವರದಿ ಇಲ್ಲದ ${n} ${monthly ? "ತಿಂಗಳು" : "ದಿನಗಳು"}`,
    viewObservations: (source: boolean, n: number) => `${source ? "ಮೂಲ" : "ಸೂಚ್ಯಂಕ"} ದಾಖಲೆಗಳನ್ನು ನೋಡಿ (${n})`,
    sourceObservations: "ಮೂಲ ದಾಖಲೆಗಳು", indexObservations: "ಸೂಚ್ಯಂಕ ದಾಖಲೆಗಳು",
    perQtl: "₹/ಕ್ವಿಂ", perQuintal: "₹ / ಕ್ವಿಂಟಾಲ್", qtl: "/ ಕ್ವಿಂ", quintal: "/ ಕ್ವಿಂಟಾಲ್",
    reportingMonth: "ವರದಿ ತಿಂಗಳು", reportingDate: "ವರದಿ ದಿನಾಂಕ", weightedPrice: "ತೂಕದ ಸರಾಸರಿ ದರ", reportedAverage: "ವರದಿಯಾದ ಸರಾಸರಿ", index: "ಸೂಚ್ಯಂಕ",
    branches: "ಶಾಖೆಗಳು", markets: "ಮಾರುಕಟ್ಟೆಗಳು",
    trendLater: (monthly: boolean) => `ಎರಡನೇ ${monthly ? "ವರದಿ ತಿಂಗಳು" : "ವರದಿ ದಿನಾಂಕ"} ಬಂದ ನಂತರ ಪ್ರವೃತ್ತಿ ರೇಖೆ ಕಾಣಿಸುತ್ತದೆ. ಅಲ್ಲಿಯವರೆಗೆ ಏನನ್ನೂ ಅಂದಾಜು ಮಾಡುವುದಿಲ್ಲ.`,
    aria: (label: string, unit: string, coverage: string, source: boolean) => `${label}, ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ ರೂಪಾಯಿಗಳಲ್ಲಿ${unit}. ${coverage}. ರೇಖೆಯು ವರದಿಯಾದ ದರಗಳನ್ನು ಜೋಡಿಸುತ್ತದೆ; ವರದಿ ಇಲ್ಲದ ದಿನಗಳಿಗೆ ಯಾವುದೇ ದರ ಅಂದಾಜು ಮಾಡುವುದಿಲ್ಲ. ನಿಖರ ಮೌಲ್ಯಗಳಿಗೆ ${source ? "ಮೂಲ" : "ಸೂಚ್ಯಂಕ"} ದಾಖಲೆಗಳನ್ನು ತೆರೆಯಿರಿ.`,
    noReport: "ಈ ದಿನ ವರದಿ ಇಲ್ಲ. ಯಾವುದೇ ದರ ಅಂದಾಜು ಮಾಡಿಲ್ಲ.", isolated: "ಒಂಟಿ ವರದಿ",
    latest: "ಇತ್ತೀಚಿನದು", change: "ಅವಧಿಯಲ್ಲಿ ಬದಲಾವಣೆ", since: (date: string) => `${date} ರಿಂದ`, high: "ಗರಿಷ್ಠ", low: "ಕನಿಷ್ಠ", average: "ಸರಾಸರಿ",
    events: "ಏನು ನಡೆಯಿತು", eventsAria: "ಚಾರ್ಟ್‌ನಲ್ಲಿ ಗುರುತಿಸಿದ ನೀತಿ ಮತ್ತು ತೆರಿಗೆ ಘಟನೆಗಳು", inForce: "ಜಾರಿ", source: "ಮೂಲ",
    caption: (markers: boolean, monthly: boolean) => `${markers ? "ಪ್ರತಿ ಚುಕ್ಕೆ ಒಂದು ವರದಿಯಾದ ದರ; " : ""}ರೇಖೆಯು ವರದಿಯಾದ ದರಗಳನ್ನು ಜೋಡಿಸುತ್ತದೆ, ನಡುವೆ ಯಾವುದೇ ದರ ಅಂದಾಜು ಮಾಡುವುದಿಲ್ಲ${monthly ? "" : ". ವರದಿ ಇಲ್ಲದ ದಿನಗಳು ವಹಿವಾಟು ಇಲ್ಲದ ದಿನಗಳಾಗಿರಬಹುದು"}.`,
  },
});

export function PriceChart({ points = [], averagePoints, quotePoints, unitNote = "", calendarInterval = "daily", range, label: givenLabel, showStats = true, showEvents = true }: {
  points?: ReferencePoint[]; averagePoints?: AveragePoint[]; quotePoints?: { reporting_date: string; average_price: number }[]; unitNote?: string; label?: string; calendarInterval?: "daily" | "monthly"; range?: { from: string; to: string }; showStats?: boolean;
  /** Numbered markers for the policy and tax events inside the plotted range, with a short list under the chart. */
  showEvents?: boolean;
}) {
  const t = useCopy(COPY);
  const onChartReady = useResponsiveChart();
  // On phones the latest price is already the first figure above the chart, so the line drops its end label and the
  // plot takes the width that label reserved.
  const phone = usePhone();
  const { AXIS_LABEL, AXIS_LINE, BRAND, BRAND_AREA, CROSSHAIR, GRID_LINE, INK, TOOLTIP, tooltipHtml } = useChartPalette();
  const { language } = useLanguage();
  const label = givenLabel ?? t.defaultLabel;
  const chart = buildChartData(quotePoints
    ? quotePoints.map((point) => ({ reporting_date: point.reporting_date, value: point.average_price, constituents: 1 }))
    : averagePoints
    ? averagePoints.map((point) => ({ reporting_date: point.reporting_date, value: point.median_average_price, constituents: point.branch_count }))
    : points.map((point) => ({ reporting_date: point.reporting_date, value: point.median_modal_price, constituents: point.market_count })), calendarInterval, range);
  const { ordered } = chart;
  const monthly = calendarInterval === "monthly";
  const line = connectShortGaps(chart.series, calendarInterval);
  const missing = missingPeriods(ordered, calendarInterval, range);
  const byBranch = Boolean(averagePoints || quotePoints);
  const place = (count: number) => t.places(count, byBranch);
  const dateText = (date: string) => monthly ? formatMonth(date.slice(0, 7), language) : formatDate(date, language);
  const observationLabel = (time: number) => dateText(new Date(time).toISOString().slice(0, 10));
  const coverage = `${t.reports(chart.observations)} · ${t.withoutReport(chart.missing, monthly, Boolean(range))}`;
  const missingNote = missing.length && missing.length <= 5 ? ` (${missing.map(dateText).join(", ")})` : "";
  const values = ordered.map((point) => point.value);
  const latest = ordered.at(-1);
  const high = values.length ? Math.max(...values) : 0, low = values.length ? Math.min(...values) : 0;
  const highPoint = ordered.find((point) => point.value === high), lowPoint = ordered.find((point) => point.value === low);
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const first = ordered[0];
  // A benchmark's constituent branches change between dates, so a first-to-last change is shown only for one fixed series.
  const change = quotePoints && first && latest && ordered.length > 1 && first.value !== 0 ? (latest.value - first.value) / first.value * 100 : null;
  const table = <details className="chart-data"><summary>{t.viewObservations(Boolean(quotePoints), ordered.length)}</summary><div className="table-scroll" tabIndex={0} role="region" aria-label={quotePoints ? t.sourceObservations : t.indexObservations}><table><caption>{label} · {t.perQtl}{unitNote}</caption><thead><tr><th scope="col">{monthly ? t.reportingMonth : t.reportingDate}</th><th scope="col" className="numeric">{monthly ? t.weightedPrice : quotePoints ? t.reportedAverage : t.index} · {t.perQtl}{unitNote}</th>{!monthly && <th scope="col" className="numeric">{byBranch ? t.branches : t.markets}</th>}</tr></thead><tbody>{[...ordered].reverse().map((point) => <tr key={point.reporting_date}><td>{dateText(point.reporting_date)}</td><td className="numeric table-price">₹{point.value.toLocaleString("en-IN")}</td>{!monthly && <td className="numeric">{point.constituents}</td>}</tr>)}</tbody></table></div></details>;

  // One observation is not a trend, so it is stated as a value rather than plotted as a lone dot on an empty axis.
  if (ordered.length === 1 && latest) return <div className="price-chart">
    <div className="single-observation">
      <div><span>{dateText(latest.reporting_date)}</span><strong>{rupees(latest.value)}<small>{t.quintal}{unitNote}</small></strong><p>{place(latest.constituents)} · {label}</p></div>
      <p>{t.trendLater(monthly)}</p>
    </div>
    {table}
  </div>;

  const spanDays = first && latest ? (calendarDateToTime(latest.reporting_date) - calendarDateToTime(first.reporting_date)) / DAY_MS : 0;
  const axisDate = (time: number) => {
    const iso = new Date(time).toISOString().slice(0, 10);
    if (monthly || spanDays > 300) return formatMonth(iso.slice(0, 7), language);
    return formatDate(iso, language).replace(/ \d{4}$/, "");
  };
  const markers = ordered.length <= 60;
  // A monthly point stands for its whole month, so an event in the last plotted month still belongs on the chart.
  const events = showEvents && first && latest ? eventsBetween(first.reporting_date, monthly ? `${latest.reporting_date.slice(0, 7)}-31` : latest.reporting_date) : [];
  // Events closer than a few percent of the span would print their numbers on top of each other, so the first of a close
  // run carries every number (such as "2·3") and the rest keep only their dashed line.
  const eventSpan = first && latest ? calendarDateToTime(latest.reporting_date) - calendarDateToTime(first.reporting_date) : 0;
  const eventMarks: { xAxis: number; label: { show?: boolean; formatter?: string; width?: number } }[] = [];
  let lead: { at: number; label: { formatter?: string; width?: number } } | undefined;
  events.forEach((event, index) => {
    const at = calendarDateToTime(event.date);
    if (lead && at - lead.at < eventSpan * 0.06) {
      lead.label.formatter = `${lead.label.formatter}·${index + 1}`;
      lead.label.width = 10 + lead.label.formatter.length * 6;
      eventMarks.push({ xAxis: at, label: { show: false } });
      return;
    }
    const mark = { xAxis: at, label: { formatter: String(index + 1) } };
    lead = { at, label: mark.label };
    eventMarks.push(mark);
  });
  const isolated = line.flatMap(([time, value], index) => value !== null && line[index - 1]?.[1] == null && line[index + 1]?.[1] == null ? [[time, value]] : []);
  const branchesOn = new Map((averagePoints ?? []).map((point) => [calendarDateToTime(point.reporting_date), point.branches ?? []]));
  const option = {
    useUTC: true,
    animation: false,
    aria: { enabled: true, label: { description: t.aria(label, unitNote, coverage, Boolean(quotePoints)) } },
    textStyle: { fontFamily: CHART_FONT },
    grid: { top: events.length ? 26 : 16, right: phone ? 12 : 64, bottom: 4, left: 4, containLabel: true },
    tooltip: {
      ...TOOLTIP, trigger: "axis", axisPointer: CROSSHAIR,
      formatter: (params: { data: [number, number | null] }[]) => {
        const data = params[0]?.data;
        if (!data) return "";
        const [time, value] = data;
        if (value === null) return tooltipHtml(observationLabel(time), [], t.noReport);
        const observation = ordered.find((point) => calendarDateToTime(point.reporting_date) === time);
        const names = branchesOn.get(time) ?? [];
        return tooltipHtml(observationLabel(time), [
          { value: `${rupees(value)} ${t.qtl}` },
          ...(!monthly && observation ? [{ label: byBranch ? t.branches : t.markets, value: String(observation.constituents) }] : []),
        ], names.length ? names.join(", ") : unitNote ? `${t.perQuintal}${unitNote}` : undefined);
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
      itemStyle: { color: BRAND, borderColor: INK.surface, borderWidth: 1.5 },
      lineStyle: { color: BRAND, width: 2, cap: "round", join: "round" },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: BRAND_AREA[0] }, { offset: 1, color: BRAND_AREA[1] }]) },
      emphasis: { scale: false },
      endLabel: { show: !phone, color: BRAND, fontSize: 11, fontWeight: 600, fontFamily: CHART_FONT, distance: 6, formatter: ({ value }: { value: [number, number] }) => rupees(value[1]) },
      ...(events.length ? { markLine: {
        silent: true, symbol: "none", animation: false,
        lineStyle: { color: INK[400], type: "dashed", width: 1 },
        label: { position: "end", distance: 2, color: INK.surface, backgroundColor: INK[600], borderRadius: 9, width: 18, height: 18, lineHeight: 18, align: "center", padding: 0, fontSize: 10.5, fontWeight: 700, fontFamily: CHART_FONT },
        data: eventMarks,
      } } : {}),
    }, ...(isolated.length ? [{ type: "scatter", name: t.isolated, data: isolated, symbolSize: 7, itemStyle: { color: BRAND }, silent: true, tooltip: { show: false } }] : [])],
  };
  return <div className="price-chart">
    {showStats && latest && <dl className="chart-stats">
      <div><dt>{t.latest}</dt><dd>{rupees(latest.value)}</dd><small>{dateText(latest.reporting_date)}</small></div>
      {change !== null && <div><dt>{t.change}</dt><dd>{change >= 0 ? "+" : "−"}{Math.abs(change).toFixed(1)}%</dd><small>{t.since(dateText(first.reporting_date))}</small></div>}
      <div><dt>{t.high}</dt><dd>{rupees(high)}</dd><small>{highPoint && dateText(highPoint.reporting_date)}</small></div>
      <div><dt>{t.low}</dt><dd>{rupees(low)}</dd><small>{lowPoint && dateText(lowPoint.reporting_date)}</small></div>
      <div><dt>{t.average}</dt><dd>{rupees(mean)}</dd><small>{t.reports(chart.observations)}</small></div>
    </dl>}
    <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate onChartReady={onChartReady} autoResize={false} style={{ height: 300, width: "100%" }} />
    {events.length > 0 && <ol className="chart-events" aria-label={t.eventsAria}>
      {events.map((event, index) => <li key={event.date}><span className="chart-event-number" aria-hidden="true">{index + 1}</span>
        <span><time dateTime={event.date}>{formatDate(event.date, language)}</time>{event.kind === "in-force" ? ` · ${t.inForce}` : ""} · {event[language]} <a href={event.source.url} target="_blank" rel="noreferrer" title={event.source.name}>{t.source}</a></span></li>)}
    </ol>}
    <p className="price-chart-caption">{label} · {t.perQuintal}{unitNote} · {coverage}{missingNote}. {t.caption(markers, monthly)}</p>
    {table}
  </div>;
}

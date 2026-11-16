import { useEffect, useRef } from "react";
import { useTheme, type Theme } from "../services/theme";

/**
 * One monochrome chart system. Identity is carried by lightness plus line style and a legend, never by hue.
 * Status colour is reserved for status pills, so a chart colour never implies good or bad.
 */
export const INK: Record<900 | 800 | 700 | 600 | 500 | 400 | 300 | 200 | 100 | "surface", string> = {
  900: "#18181b", 800: "#27272a", 700: "#3f3f46", 600: "#52525b", 500: "#71717a",
  400: "#a1a1aa", 300: "#d4d4d8", 200: "#e4e4e7", 100: "#f4f4f5", surface: "#ffffff",
} as const;

/** Brand forest green for the primary series; supporting series stay grey so colour still means "the main line". */
export const BRAND = "#0b3d2e";
/** The fill under a single price line: strongest just under the line, fading out well before the axis. */
export const BRAND_AREA = ["rgba(11,61,46,.20)", "rgba(11,61,46,.06)", "rgba(11,61,46,0)"] as const;

/** "#rrggbb" at an opacity, for glows and fills drawn from a series colour. */
export function withAlpha(hex: string, alpha: number) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

/**
 * Depth without distortion: a soft glow under the price line and a three-stop fill (see BRAND_AREA). Values stay exactly
 * where they are; nothing is tilted or extruded.
 */
export function lineGlow(color: string, dark: boolean, dense = false) {
  // A long, jagged series (years of daily prices) would blur into a smear under a full glow, so it gets a faint one.
  if (dense) return { shadowColor: withAlpha(color, dark ? 0.3 : 0.18), shadowBlur: 5, shadowOffsetY: 1 };
  return { shadowColor: withAlpha(color, dark ? 0.55 : 0.35), shadowBlur: dark ? 12 : 10, shadowOffsetY: 3 };
}

/** Stops for an echarts LinearGradient(0, 0, 0, 1, …) under a line. */
export function areaStops(area: readonly string[]) {
  return [{ offset: 0, color: area[0] }, { offset: 0.55, color: area[1] }, { offset: 1, color: area[2] }];
}

export const CHART_FONT = '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** Default series order: strongest first. Every supporting line remains distinguishable against a white chart. */
export const SERIES_COLORS = [BRAND, INK[500], "#767680", "#85858f"];

/** Ordered lightness ramp for ordered data such as calendar years: the newest entry is the darkest. */
export function orderedRamp(count: number): string[] {
  const ramp = ["#777780", "#6b6b75", "#5f5f69", "#53535d", "#474751", INK[900]];
  return count >= ramp.length ? [...Array(count - ramp.length).fill(ramp[0]), ...ramp] : ramp.slice(ramp.length - count);
}

export const AXIS_LABEL = { color: INK[500], fontSize: 11, fontFamily: CHART_FONT };
export const AXIS_LINE = { lineStyle: { color: INK[300], width: 1 } };
export const GRID_LINE = { lineStyle: { color: INK[100], width: 1, type: "solid" as const } };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Source labels reach this HTML, so every value is escaped. */
export function tooltipHtml(title: string, rows: { label?: string; value: string; marker?: string; strong?: boolean }[], note?: string, ink = INK) {
  // Sized to its content (no minimum width), so a one-price card stays small. A "strong" row is the reading itself
  // (the price on this date): large, under a quieter date. Labelled rows follow, then an optional one-line note.
  const headline = rows.some((row) => row.strong);
  const body = rows.map((row) => row.strong
    ? `<div style="margin-top:1px;color:${ink[900]};font-size:16px;line-height:1.25;font-weight:700;letter-spacing:-.01em;font-variant-numeric:tabular-nums;white-space:nowrap">${escapeHtml(row.value)}${row.label ? `<span style="margin-left:3px;color:${ink[500]};font-size:11px;font-weight:500">${escapeHtml(row.label)}</span>` : ""}</div>`
    : `<div style="display:flex;justify-content:space-between;gap:14px;margin-top:3px;line-height:1.35">
    <span style="color:${ink[500]}">${row.marker ?? ""}${row.label ? escapeHtml(row.label) : ""}</span>
    <span style="color:${ink[900]};font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap">${escapeHtml(row.value)}</span></div>`).join("");
  return `<div style="max-width:232px;white-space:normal;line-height:1.35">
    <div style="color:${headline ? ink[500] : ink[900]};font-weight:600${headline ? ";font-size:11px" : ""}">${escapeHtml(title)}</div>${body}
    ${note ? `<div style="margin-top:3px;color:${ink[500]};font-size:11px;line-height:1.4">${escapeHtml(note)}</div>` : ""}</div>`;
}

/**
 * Where the readout card sits: beside the pointer, on the side with more room, so it never covers the hovered point or
 * the stretch of line just read. On phone-width charts it also rises above the finger (below it when there is no room),
 * rather than to the top edge, where it would cover a legend.
 */
export function tooltipPosition(point: number[], _params: unknown, _dom: unknown, _rect: unknown, size: { contentSize: number[]; viewSize: number[] }) {
  const [x, y] = point, [cardWidth, cardHeight] = size.contentSize, [width, height] = size.viewSize;
  const gap = 12;
  const left = x > width / 2 ? x - cardWidth - gap : x + gap;
  const top = width >= 480 ? y - cardHeight / 2 : y - cardHeight - 20 >= 4 ? y - cardHeight - 20 : y + 20;
  return [Math.max(4, Math.min(left, width - cardWidth - 4)), Math.max(4, Math.min(top, height - cardHeight - 4))];
}

export const TOOLTIP = {
  confine: true,
  position: tooltipPosition,
  backgroundColor: INK.surface,
  borderColor: INK[200],
  borderWidth: 1,
  padding: [7, 10],
  textStyle: { color: INK[900], fontSize: 12, fontFamily: CHART_FONT },
  extraCssText: "border-radius:9px;box-shadow:0 8px 24px rgba(24,24,27,.14),0 1px 3px rgba(24,24,27,.08);",
};

/** A vertical hairline follows the pointer on line charts. */
export const CROSSHAIR = { type: "line" as const, lineStyle: { color: INK[400], width: 1, type: "solid" as const }, label: { show: false } };

export function chartPalette(theme: Theme) {
  const dark = theme === "dark";
  const ink: typeof INK = dark ? {
    900: "#f2f1e8", 800: "#e1eadf", 700: "#d3ddd2", 600: "#c5d3c6", 500: "#b3c2b5",
    400: "#9cb3a3", 300: "#799484", 200: "#526a5b", 100: "#33463b", surface: "#192722",
  } : INK;
  const brand = dark ? "#b6d59d" : BRAND;
  return {
    DARK: dark, INK: ink, BRAND: brand, BRAND_AREA: dark ? ["rgba(182,213,157,.24)", "rgba(182,213,157,.07)", "rgba(182,213,157,0)"] as const : BRAND_AREA,
    SERIES_COLORS: dark ? [brand, "#c8d3c7", "#90ad9f", "#d1bb94"] : SERIES_COLORS,
    AXIS_LABEL: { ...AXIS_LABEL, color: ink[500] },
    AXIS_LINE: { lineStyle: { color: ink[300], width: 1 } },
    GRID_LINE: { lineStyle: { color: ink[100], width: 1, type: "solid" as const } },
    TOOLTIP: { ...TOOLTIP, backgroundColor: ink.surface, borderColor: ink[200], textStyle: { ...TOOLTIP.textStyle, color: ink[900] },
      ...(dark ? { extraCssText: "border-radius:9px;box-shadow:0 8px 24px rgba(0,0,0,.45);" } : {}) },
    /** The hovered point: a filled dot ringed in the surface colour, with the same glow as the line. */
    hoverDot: (color: string) => ({ itemStyle: { color, borderColor: ink.surface, borderWidth: 1.5, ...lineGlow(color, dark) } }),
    tooltipHtml: (title: string, rows: { label?: string; value: string; marker?: string; strong?: boolean }[], note?: string) => tooltipHtml(title, rows, note, ink),
    CROSSHAIR: { ...CROSSHAIR, lineStyle: { ...CROSSHAIR.lineStyle, color: ink[400] } },
    shade: dark ? "rgba(200,220,200,.08)" : "rgba(24,24,27,.04)",
    regionShade: dark ? "rgba(200,220,200,.08)" : "rgba(24,24,27,.045)",
    orderedRamp: (count: number) => {
      if (!dark) return orderedRamp(count);
      const ramp = ["#718b7a", "#88a594", "#a0b7a5", "#b8cdbb", "#d0e0ce", ink[900]];
      return count >= ramp.length ? [...Array(count - ramp.length).fill(ramp[0]), ...ramp] : ramp.slice(ramp.length - count);
    },
  };
}

export function useChartPalette() {
  return chartPalette(useTheme());
}

/** Calendar-month axes label January (and July on shorter spans), so ticks stay regular instead of drifting. */
export function monthAxisInterval(categories: string[]): "auto" | ((index: number, label: string) => boolean) {
  if (categories.length <= 18 || !categories.every((label) => /^[A-Z][a-z]{2} \d{4}/.test(label))) return "auto";
  const keep = categories.length > 54 ? /^Jan/ : /^(Jan|Jul)/;
  return (_index, label) => keep.test(label);
}

/**
 * Chart motion: lines draw in left to right and bars grow once, in 0.6s, when a chart first appears. After that a chart
 * never replays its entrance: a chart that updates in place (PriceChart, merged by series id) glides to its new shape in
 * 0.45s when the period or variety changes, and an unchanged refresh does not move. Readers who ask their device to
 * reduce motion get static charts.
 */
export function useChartMotion() {
  const drawn = useRef(false);
  // Marked drawn only once the entrance has had time to play: a chart re-renders straight after it appears (its
  // resize watcher attaches), and turning animation off then would cut the entrance short.
  useEffect(() => {
    const timer = window.setTimeout(() => { drawn.current = true; }, ENTRANCE_MS + 200);
    return () => window.clearTimeout(timer);
  }, []);
  if (!drawn.current) return chartMotion();
  return reducedMotion() ? { animation: false } : {
    animation: true, animationDuration: 0, animationDurationUpdate: 450, animationEasingUpdate: "cubicInOut" as const, animationThreshold: 5000,
  };
}

const reducedMotion = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

const ENTRANCE_MS = 600;

export function chartMotion() {
  return reducedMotion() ? { animation: false } : {
    animation: true, animationDuration: ENTRANCE_MS, animationEasing: "cubicOut" as const,
    animationDurationUpdate: 300, animationEasingUpdate: "cubicOut" as const, animationThreshold: 4000,
  };
}

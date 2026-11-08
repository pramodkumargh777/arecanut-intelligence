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
export const BRAND_AREA = ["rgba(11,61,46,.14)", "rgba(11,61,46,0)"] as const;

export const CHART_FONT = '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** Default series order: strongest first. Further series also differ by dash pattern at the call site. */
export const SERIES_COLORS = [BRAND, INK[500], INK[400], INK[300]];

/** Ordered lightness ramp for ordered data such as calendar years: the newest entry is the darkest. */
export function orderedRamp(count: number): string[] {
  const ramp = ["#a8a8b0", "#8a8a93", "#6b6b74", "#4f4f57", "#35353b", INK[900]];
  return count >= ramp.length ? [...Array(count - ramp.length).fill(ramp[0]), ...ramp] : ramp.slice(ramp.length - count);
}

export const AXIS_LABEL = { color: INK[500], fontSize: 11, fontFamily: CHART_FONT };
export const AXIS_LINE = { lineStyle: { color: INK[300], width: 1 } };
export const GRID_LINE = { lineStyle: { color: INK[100], width: 1, type: "solid" as const } };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Source labels reach this HTML, so every value is escaped. */
export function tooltipHtml(title: string, rows: { label?: string; value: string; marker?: string }[], note?: string, ink = INK) {
  const body = rows.map((row) => `<div style="display:flex;justify-content:space-between;gap:20px;margin-top:4px">
    <span style="color:${ink[500]}">${row.marker ?? ""}${row.label ? escapeHtml(row.label) : ""}</span>
    <span style="color:${ink[900]};font-weight:600;font-variant-numeric:tabular-nums">${escapeHtml(row.value)}</span></div>`).join("");
  return `<div style="min-width:150px;max-width:280px;white-space:normal">
    <div style="color:${ink[900]};font-weight:600">${escapeHtml(title)}</div>${body}
    ${note ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid ${ink[200]};color:${ink[500]};font-size:11px;line-height:1.45">${escapeHtml(note)}</div>` : ""}</div>`;
}

export const TOOLTIP = {
  confine: true,
  backgroundColor: INK.surface,
  borderColor: INK[200],
  borderWidth: 1,
  padding: [10, 12],
  textStyle: { color: INK[900], fontSize: 12, fontFamily: CHART_FONT },
  extraCssText: "border-radius:8px;box-shadow:0 8px 24px rgba(24,24,27,.10);",
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
    INK: ink, BRAND: brand, BRAND_AREA: dark ? ["rgba(182,213,157,.16)", "rgba(182,213,157,0)"] : BRAND_AREA,
    SERIES_COLORS: dark ? [brand, "#c8d3c7", "#90ad9f", "#d1bb94"] : SERIES_COLORS,
    AXIS_LABEL: { ...AXIS_LABEL, color: ink[500] },
    AXIS_LINE: { lineStyle: { color: ink[300], width: 1 } },
    GRID_LINE: { lineStyle: { color: ink[100], width: 1, type: "solid" as const } },
    TOOLTIP: { ...TOOLTIP, backgroundColor: ink.surface, borderColor: ink[200], textStyle: { ...TOOLTIP.textStyle, color: ink[900] } },
    CROSSHAIR: { ...CROSSHAIR, lineStyle: { ...CROSSHAIR.lineStyle, color: ink[400] } },
    shade: dark ? "rgba(200,220,200,.08)" : "rgba(24,24,27,.04)",
    regionShade: dark ? "rgba(200,220,200,.08)" : "rgba(24,24,27,.045)",
    tooltipHtml: (title: string, rows: { label?: string; value: string; marker?: string }[], note?: string) => tooltipHtml(title, rows, note, ink),
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

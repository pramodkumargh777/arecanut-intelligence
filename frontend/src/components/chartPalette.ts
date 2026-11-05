/**
 * One monochrome chart system. Identity is carried by lightness plus line style and a legend, never by hue.
 * Status colour is reserved for status pills, so a chart colour never implies good or bad.
 */
export const INK = {
  900: "#18181b", 800: "#27272a", 700: "#3f3f46", 600: "#52525b", 500: "#71717a",
  400: "#a1a1aa", 300: "#d4d4d8", 200: "#e4e4e7", 100: "#f4f4f5", surface: "#ffffff",
} as const;

export const CHART_FONT = '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** Default series order: strongest first. Further series also differ by dash pattern at the call site. */
export const SERIES_COLORS = [INK[900], INK[500], INK[400], INK[300]];

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
export function tooltipHtml(title: string, rows: { label?: string; value: string; marker?: string }[], note?: string) {
  const body = rows.map((row) => `<div style="display:flex;justify-content:space-between;gap:20px;margin-top:4px">
    <span style="color:${INK[500]}">${row.marker ?? ""}${row.label ? escapeHtml(row.label) : ""}</span>
    <span style="color:${INK[900]};font-weight:600;font-variant-numeric:tabular-nums">${escapeHtml(row.value)}</span></div>`).join("");
  return `<div style="min-width:150px;max-width:280px;white-space:normal">
    <div style="color:${INK[900]};font-weight:600">${escapeHtml(title)}</div>${body}
    ${note ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid ${INK[200]};color:${INK[500]};font-size:11px;line-height:1.45">${escapeHtml(note)}</div>` : ""}</div>`;
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

/** Calendar-month axes label January (and July on shorter spans), so ticks stay regular instead of drifting. */
export function monthAxisInterval(categories: string[]): "auto" | ((index: number, label: string) => boolean) {
  if (categories.length <= 18 || !categories.every((label) => /^[A-Z][a-z]{2} \d{4}/.test(label))) return "auto";
  const keep = categories.length > 54 ? /^Jan/ : /^(Jan|Jul)/;
  return (_index, label) => keep.test(label);
}

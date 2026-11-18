import type { CSSProperties } from "react";
import type { SellingPlanKey, StagedSummary } from "../../../shared/hold-history";

export type SellingPlansCopy = {
  plans: Record<SellingPlanKey, string>;
  median: string; worst: string; best: string;
  beat: (count: number, years: number) => string;
  legendMedian: string; legendRange: string; legendZero: string;
};

/** Signed percent with a true minus sign, so negative figures line up and read cleanly. */
export const signedPercent = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : value < 0 ? "\u2212" : ""}${Math.abs(value)}%`;
const tone = (value: number | null) => value === null || value === 0 ? "" : value > 0 ? "hold-up" : "hold-down";

/**
 * Each way of selling as a card: its worst-to-best range across past years on one shared scale, the median as a dot,
 * and the line where selling everything in the start month would have left the reader (0%). A narrower bar means the
 * outcome depended less on which year it was. Figures are always written out; the drawing is only a guide.
 */
export function SellingPlans({ summaries, copy }: { summaries: StagedSummary[]; copy: SellingPlansCopy }) {
  const rows = summaries.filter((row) => row.median_percent !== null && row.lowest_percent !== null && row.highest_percent !== null);
  if (!rows.length) return null;
  const low = Math.min(0, ...rows.map((row) => row.lowest_percent!)), high = Math.max(0, ...rows.map((row) => row.highest_percent!));
  const pad = (high - low || 1) * 0.06;
  const from = low - pad, span = high + pad - from;
  const at = (value: number) => ((value - from) / span) * 100;
  const zero = at(0);
  return <div className="hold-plans-frame">
    <ul className="hold-plan-legend" aria-hidden="true">
      <li><i className="key-median" />{copy.legendMedian}</li>
      <li><i className="key-range" />{copy.legendRange}</li>
      <li><i className="key-zero" />{copy.legendZero}</li>
    </ul>
    <ul className="hold-plans">
      {rows.map((row) => {
        const left = at(row.lowest_percent!), right = at(row.highest_percent!);
        const width = Math.max(right - left, 0.6);
        // Where 0% falls inside this bar: losses are tinted on its left, gains on its right, and it grows out from there.
        const split = Math.min(100, Math.max(0, ((zero - left) / width) * 100));
        const beat = copy.beat(row.beat_selling_now, row.years);
        const style = { "--left": `${left}%`, "--width": `${width}%`, "--split": `${split}%`, "--median": `${at(row.median_percent!)}%`, "--zero": `${zero}%` } as CSSProperties;
        return <li key={row.plan} className="hold-plan" style={style}>
          <div className="hold-plan-head"><strong>{copy.plans[row.plan]}</strong><span>{beat}</span></div>
          <div className="hold-plan-track" aria-hidden="true">
            <span className="hold-plan-zero" />
            <span className="hold-plan-range" />
            <span className="hold-plan-median" />
          </div>
          <dl className="hold-plan-stats">
            <div><dt>{copy.worst}</dt><dd className={tone(row.lowest_percent)}>{signedPercent(row.lowest_percent)}</dd></div>
            <div><dt>{copy.median}</dt><dd className={tone(row.median_percent)}>{signedPercent(row.median_percent)}</dd></div>
            <div><dt>{copy.best}</dt><dd className={tone(row.highest_percent)}>{signedPercent(row.highest_percent)}</dd></div>
          </dl>
        </li>;
      })}
    </ul>
  </div>;
}

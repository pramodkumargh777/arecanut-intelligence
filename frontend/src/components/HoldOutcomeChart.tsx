import type { ReactNode } from "react";
import { RollingText } from "./RollingNumber";
import type { HoldYear } from "../../../shared/hold-history";

/**
 * Sell-or-wait in one picture: for each waiting period, every past year is a dot at the price change it saw, and the
 * line is the rise the reader needs to cover their own costs. Dots above the line are the years waiting paid off.
 * Built from HTML rather than a scaled image so the labels stay readable on a phone.
 */

export type HoldColumn = { months: number; label: string; needed: number | null; covered: string | null; shortLabel?: string; coveredShort?: string | null };

const STEPS = [1, 2, 2.5, 5, 10, 20, 25, 50];

function scale(values: number[]) {
  const low = Math.min(0, ...values), high = Math.max(0, ...values);
  const rough = Math.max(1, high - low) / 4;
  const step = STEPS.find((s) => s >= rough) ?? rough;
  // A quarter step of air at each end keeps a dot or the cost line off the chart's edge.
  const min = Math.floor(low / step) * step - step / 4;
  const max = Math.ceil(high / step) * step + step / 4;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + 1e-9; value += step) ticks.push(Math.round(value * 10) / 10);
  return { min, max, ticks, at: (value: number) => `${((max - value) / (max - min)) * 100}%` };
}

export function HoldOutcomeChart({ years, columns, monthLabel, neededLabel, neededShort, paidLabel, notPaidLabel, description, legend, legendShort }: {
  years: HoldYear[]; columns: HoldColumn[]; monthLabel: (month: string) => string;
  neededLabel: (percent: number) => string; paidLabel: string; notPaidLabel: string; description: string;
  legend: { paid: string; notPaid: string; needed: string; zone: string };
  /** Phone wording (see .label-short in responsive.css); screen readers always get the full wording. */
  neededShort?: (percent: number) => string; legendShort?: { paid: string; notPaid: string; needed: string };
}) {
  const dual = (full: ReactNode, short: ReactNode | undefined) => short === undefined ? full
    : <><span className="label-full">{full}</span><span className="label-short" aria-hidden="true">{short}</span></>;
  const points = columns.map((column) => years.flatMap((year) => year.changes
    .filter((change) => change.months === column.months && change.percent !== null && !change.excluded)
    .map((change) => ({ from: year.start_month, to: change.target_month, percent: change.percent! }))));
  const { ticks, at } = scale([...points.flat().map((point) => point.percent), ...columns.flatMap((column) => column.needed === null ? [] : [column.needed])]);
  const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}%`;
  return <figure className="hold-chart" aria-label={description}>
    <figcaption className="hold-chart-legend">
      <span><i className="hold-key-paid" />{dual(legend.paid, legendShort?.paid)}</span><span><i className="hold-key-not" />{dual(legend.notPaid, legendShort?.notPaid)}</span>
      <span><i className="hold-key-need" />{dual(legend.needed, legendShort?.needed)}</span><span className="hold-key-zone-item"><i className="hold-key-zone" />{legend.zone}</span>
    </figcaption>
    <div className="hold-chart-axis" aria-hidden="true">{ticks.map((tick) => <span key={tick} style={{ top: at(tick) }}>{signed(tick)}</span>)}</div>
    <div className="hold-chart-body">
      <div className="hold-chart-grid" aria-hidden="true">{ticks.map((tick) => <i key={tick} className={tick === 0 ? "is-zero" : undefined} style={{ top: at(tick) }} />)}</div>
      {columns.map((column, c) => {
        // Spread the year dots across the column in value order, so close results sit side by side instead of overlapping.
        const sorted = [...points[c]].sort((a, b) => a.percent - b.percent);
        return <div className="hold-chart-col" key={column.months}>
          <div className="hold-chart-plot">
            {/* Everything above the cost line is the zone where waiting paid off. */}
            {column.needed !== null && <span className="hold-chart-zone" style={{ height: at(column.needed) }} />}
            {column.needed !== null && <span className="hold-chart-need" style={{ top: at(column.needed) }} />}
            {sorted.map((point, i) => {
              const paid = column.needed !== null && point.percent >= column.needed;
              const left = sorted.length > 1 ? 22 + (56 * i) / (sorted.length - 1) : 50;
              const tip = `${monthLabel(point.from)} → ${monthLabel(point.to)} · ${signed(point.percent)} · ${paid ? paidLabel : notPaidLabel}`;
              return <span key={point.from} tabIndex={0} className={`hold-chart-dot${paid ? " is-paid" : ""}${left > 60 ? " tip-left" : ""}`}
                style={{ top: at(point.percent), left: `${left}%` }} aria-label={tip} data-tip={tip} />;
            })}
          </div>
          {/* The requirement is printed under the column, not on the line, so it never sits under a year's dot. */}
          <div className="hold-chart-label"><strong>{dual(column.label, column.shortLabel)}</strong>
            {/* These follow the reader's costs, so they roll when the costs are changed. */}
            {column.needed !== null && <span className="hold-chart-need-text">{dual(<RollingText text={neededLabel(column.needed)} />,
              neededShort ? <RollingText text={neededShort(column.needed)} /> : undefined)}</span>}
            {column.covered && <small>{dual(<RollingText text={column.covered} />, column.coveredShort ? <RollingText text={column.coveredShort} /> : undefined)}</small>}</div>
        </div>;
      })}
    </div>
  </figure>;
}

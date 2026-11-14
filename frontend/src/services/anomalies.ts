/**
 * Turns the month-by-month review flags (api/src/monthly-quality.ts) into events a reader can follow. One sharp month
 * raises up to three flags (into it, out of it, and on its neighbours); here it becomes one event:
 *   - blip:  a jump that reversed the next month, e.g. Rashi ₹47,411 → ₹36,367 → ₹47,117 (Jan 2024). Most likely a
 *            reporting or arrival-mix effect; Sell now or wait? leaves such months out (shared/hold-history.ts).
 *   - shift: a jump that did not reverse, with back-to-back jumps the same way merged into one move (Rashi rose 25%
 *            then 27% in March and April 2017: one 59% rise). Lasting if the month after stayed near it, sharp if
 *            prices moved again, too early to tell when it is the latest month.
 *   - data:  a stored unit or price the source contract does not allow.
 * Every observation stays visible elsewhere; this only explains the flags.
 */
export type AnomalyPoint = {
  reporting_month: string; weighted_price: number | null; price_unit?: string | null;
  review_flags: { code: string }[]; refresh_run_id?: string | null;
};

type Base = { month: string; refresh_run_id: string | null; around: (number | null)[] };
export type AnomalyEvent =
  | Base & { kind: "blip"; before: number; value: number; after: number; change_in: number; change_out: number }
  | Base & { kind: "shift"; end: string; from: number; to: number; change: number; next: number | null; held: boolean | null }
  | Base & { kind: "data"; value: number | null; codes: string[] };

const DATA_CODES = new Set(["unexpected_unit", "nonpositive_price"]);

function shiftMonth(month: string, offset: number) {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + offset;
  return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`;
}

/** Events, latest first. `threshold` is the review threshold as a fraction (0.2 for 20%). */
export function anomalyEvents(points: AnomalyPoint[], threshold: number): AnomalyEvent[] {
  const byMonth = new Map(points.map((point) => [point.reporting_month, point]));
  const price = (month: string) => {
    const point = byMonth.get(month);
    return point && point.weighted_price !== null && point.weighted_price > 0 && !point.review_flags.some((flag) => DATA_CODES.has(flag.code)) ? point.weighted_price : null;
  };
  const around = (month: string) => [-2, -1, 0, 1, 2].map((offset) => price(shiftMonth(month, offset)));
  const run = (month: string) => byMonth.get(month)?.refresh_run_id ?? null;
  const events: AnomalyEvent[] = [];
  for (const point of points) {
    const codes = point.review_flags.map((flag) => flag.code).filter((code) => DATA_CODES.has(code));
    if (codes.length) events.push({ kind: "data", month: point.reporting_month, value: point.weighted_price, codes, refresh_run_id: run(point.reporting_month), around: around(point.reporting_month) });
  }
  // Jumps between neighbouring calendar months with prices on both sides; gaps are never treated as neighbours.
  const months = [...byMonth.keys()].sort();
  const jumps = new Map<string, number>();
  for (const month of months) {
    const now = price(month), before = price(shiftMonth(month, -1));
    if (now !== null && before !== null && Math.abs(now / before - 1) + Number.EPSILON >= threshold) jumps.set(month, now / before - 1);
  }
  const used = new Set<string>();
  for (const month of months) {
    const change = jumps.get(month);
    if (change === undefined || used.has(month)) continue;
    const next = shiftMonth(month, 1), back = jumps.get(next);
    const from = price(shiftMonth(month, -1))!, to = price(month)!;
    if (back !== undefined && Math.sign(back) !== Math.sign(change)) {
      used.add(next);
      events.push({ kind: "blip", month, before: from, value: to, after: price(next)!, change_in: change, change_out: back, refresh_run_id: run(month), around: around(month) });
      continue;
    }
    // Further jumps the same way in the months right after belong to the same move.
    let end = month;
    while (true) {
      const following = shiftMonth(end, 1), more = jumps.get(following);
      if (more === undefined || Math.sign(more) !== Math.sign(change) || used.has(following)) break;
      const reverses = jumps.get(shiftMonth(following, 1));
      if (reverses !== undefined && Math.sign(reverses) !== Math.sign(more)) break;
      used.add(following);
      end = following;
    }
    const last = price(end)!, after = price(shiftMonth(end, 1));
    events.push({ kind: "shift", month, end, from, to: last, change: last / from - 1, next: after,
      held: after === null ? null : Math.abs(after / last - 1) < threshold / 2, refresh_run_id: run(month), around: around(month) });
  }
  return events.sort((a, b) => b.month.localeCompare(a.month));
}

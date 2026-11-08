import { useCopy } from "../services/language";
import { COMMON } from "../services/commonCopy";

type QueuePagerProps = { offset: number; limit: number; total: number; busy?: boolean; label: string; onChange: (offset: number) => void };

/** Server-side pagination controls for reviewer queues; shows the true queue size, not just the loaded page. */
export function QueuePager({ offset, limit, total, busy = false, label, onChange }: QueuePagerProps) {
  const c = useCopy(COMMON);
  if (total <= limit && offset === 0) return null;
  const first = total ? offset + 1 : 0;
  const last = Math.min(offset + limit, total);
  return (
    <div className="pagination" aria-label={label}>
      <span>{first}–{last} / {total.toLocaleString("en-IN")} {label}</span>
      <div>
        <button className="button-secondary" disabled={offset === 0 || busy} onClick={() => onChange(Math.max(0, offset - limit))}>{c.previous}</button>
        <button className="button-secondary" disabled={offset + limit >= total || busy} onClick={() => onChange(offset + limit)}>{c.next}</button>
      </div>
    </div>
  );
}

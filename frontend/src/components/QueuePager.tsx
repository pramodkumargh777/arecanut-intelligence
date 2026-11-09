import { useEffect } from "react";
import { useCopy } from "../services/language";
import { COMMON } from "../services/commonCopy";

/** Reviewing shrinks a queue; this steps the offset back a page when the current page empties. */
export function useStepBackWhenEmpty(page: { total: number; data: unknown[] } | undefined, offset: number, setOffset: (offset: number) => void, limit: number) {
  const emptyPage = Boolean(page && !page.data.length);
  const total = page?.total;
  useEffect(() => { if (emptyPage && offset > 0 && total) setOffset(Math.max(0, offset - limit)); }, [emptyPage, offset, total, limit, setOffset]);
}

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

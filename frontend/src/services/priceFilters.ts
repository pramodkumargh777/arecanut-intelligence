import { DATE_PRESETS, type DatePreset, type SortDirection } from "./insights";

/**
 * Price-page filters live in the URL so a reload, a shared link or the back button keeps them.
 * Context keys (commodity, feed and, on cooperative pages, the exact variety) are never cleared by a filter reset.
 */
export const PRICE_FILTER_KEYS = ["search", "branch", "market", "district", "grade", "from", "to", "period", "sort", "dir", "page", "date"] as const;

/** Copy of `params` with each change applied; empty values remove the key so URLs stay short. */
export function withParams(params: URLSearchParams, changes: Record<string, string | number | null | undefined>): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === "") next.delete(key);
    else next.set(key, String(value));
  }
  return next;
}

/** Copy of `params` without any filter keys, plus any extra keys named. Feed and commodity are kept. */
export function withoutFilters(params: URLSearchParams, extra: string[] = []): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of [...PRICE_FILTER_KEYS, ...extra]) next.delete(key);
  return next;
}

/** Zero-based page index from the one-based `page` parameter; anything invalid is the first page. */
export function readPage(params: URLSearchParams): number {
  const page = Number(params.get("page"));
  return Number.isInteger(page) && page > 1 ? page - 1 : 0;
}

/** One-based `page` value for the URL; the first page is left out. */
export const pageParam = (index: number) => index > 0 ? index + 1 : null;

export function readSort<K extends string>(params: URLSearchParams, keys: readonly K[], fallback: { key: K; direction: SortDirection }): { key: K; direction: SortDirection } {
  const key = params.get("sort");
  const direction = params.get("dir");
  if (!key || !(keys as readonly string[]).includes(key)) return fallback;
  return { key: key as K, direction: direction === "asc" || direction === "desc" ? direction : fallback.direction };
}

/** The default sort is left out of the URL. */
export function sortParams(sort: { key: string; direction: SortDirection }, fallback: { key: string; direction: SortDirection }) {
  const isDefault = sort.key === fallback.key && sort.direction === fallback.direction;
  return { sort: isDefault ? null : sort.key, dir: isDefault ? null : sort.direction };
}

/** Named reporting period; a hand-entered date range without a known preset is "custom". */
export function readPreset(params: URLSearchParams): DatePreset {
  const period = params.get("period");
  if (DATE_PRESETS.some((option) => option.value === period)) return period as DatePreset;
  return params.get("from") || params.get("to") ? "custom" : "all";
}

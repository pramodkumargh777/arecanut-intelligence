import { useQueries } from "@tanstack/react-query";
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import type { MarketFeed } from "../../../shared/commodities";
import { api } from "../services/api";
import { useCommodity } from "../services/commodity";
import type { CooperativeCommodity } from "../services/cooperative";
import { defineCopy, useLanguage } from "../services/language";
import { marketSuggestion, matchSuggestions, type MarketSuggestion } from "../services/marketSuggestions";
import { placeName } from "../services/places";

const COPY = defineCopy({
  en: { branch: "branch", count: (n: number) => `${n} suggestion${n === 1 ? "" : "s"}, use the arrow keys to choose` },
  kn: { branch: "ಶಾಖೆ", count: (n: number) => `${n} ಸಲಹೆಗಳು, ಆಯ್ಕೆಗೆ ಬಾಣದ ಗುರುತಿನ ಕೀಲಿಗಳನ್ನು ಬಳಸಿ` },
});

const FEED_LABEL: Record<MarketFeed, string> = { official: "APMC", mamcos: "MAMCOS", tss: "TSS", tumcos: "TUMCOS" };

/**
 * Markets and branches that have published data, loaded once the reader first focuses a search box and then filtered in
 * the browser, so typing never waits on the network. APMC markets come from /markets, which lists only markets with
 * verified prices; branches come from each cooperative's own branch list.
 */
function useSuggestionItems(feeds: MarketFeed[], enabled: boolean) {
  const { code } = useCommodity();
  const queries = useQueries({ queries: feeds.map((feed) => ({
    queryKey: ["market-suggestions", code, feed],
    queryFn: async () => feed === "official"
      ? (await api.markets(code)).map((market) => marketSuggestion(feed, market.name, { marketId: market.id, district: market.district }))
      : (await api.cooperativePrices(feed, undefined, code as CooperativeCommodity, {}, 1)).branches.map((branch) => marketSuggestion(feed, branch)),
    enabled,
    staleTime: 10 * 60_000,
  })) });
  return useMemo(() => queries.flatMap((query) => query.data ?? []), [queries]);
}

/**
 * A search box that suggests markets as the reader types (ARIA combobox). Enter with no suggestion highlighted still
 * searches the typed text, so the box keeps working as a plain search when nothing matches.
 */
export function MarketSearch({ value, onChange, onSelect, feeds, ariaLabel, placeholder }: {
  value: string; onChange: (value: string) => void; onSelect: (suggestion: MarketSuggestion) => void; feeds: MarketFeed[]; ariaLabel?: string; placeholder?: string;
}) {
  const { language } = useLanguage();
  const copy = COPY[language];
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  const items = useSuggestionItems(feeds, focused);
  const matches = useMemo(() => matchSuggestions(items, value), [items, value]);
  const showing = open && matches.length > 0;
  function choose(suggestion: MarketSuggestion) {
    setOpen(false);
    setActive(-1);
    onSelect(suggestion);
  }
  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!matches.length) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + matches.length + (current < 0 && step < 0 ? 1 : 0)) % matches.length);
    } else if (event.key === "Enter" && showing && active >= 0) {
      event.preventDefault();
      choose(matches[active]);
    } else if (event.key === "Escape" && showing) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }
  return <span className="market-search">
    <input type="search" role="combobox" autoComplete="off" aria-autocomplete="list" aria-label={ariaLabel} placeholder={placeholder}
      aria-expanded={showing} aria-controls={listId} aria-activedescendant={showing && active >= 0 ? `${listId}-${active}` : undefined}
      value={value} onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1); }}
      onFocus={() => { setFocused(true); setOpen(true); }} onBlur={() => { setOpen(false); setActive(-1); }} onKeyDown={handleKey} />
    <ul id={listId} role="listbox" className="market-suggestions" hidden={!showing} aria-label={ariaLabel}>
      {showing && matches.map((item, index) => <li key={item.key} id={`${listId}-${index}`} role="option" aria-selected={index === active}
        // Chosen on mouse down, before the input's blur would close the list.
        onMouseDown={(event) => { event.preventDefault(); choose(item); }} onMouseMove={() => setActive(index)}>
        <span className="market-suggestion-name" lang={item.feed === "official" ? "en" : undefined}>{item.feed === "official" ? item.name : placeName(item.name, language)}</span>
        <span className="market-suggestion-detail">{FEED_LABEL[item.feed]} · {item.feed === "official" ? item.district : copy.branch}</span>
      </li>)}
    </ul>
    <span className="sr-only" role="status">{showing ? copy.count(matches.length) : ""}</span>
  </span>;
}

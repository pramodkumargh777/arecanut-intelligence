import type { MarketFeed } from "../../../shared/commodities";
import { placeSearchTerms } from "./places";

/** A market or cooperative branch the reader can jump to. Only places with published data are offered. */
export type MarketSuggestion = {
  key: string;
  feed: MarketFeed;
  /** The name as the source publishes it. */
  name: string;
  /** APMC market id, for the prices filter. Cooperative branches are filtered by name. */
  marketId?: string;
  district?: string;
  terms: string[];
};

export const MAX_SUGGESTIONS = 8;

const normalise = (text: string) => text.toLocaleLowerCase("en-IN").normalize("NFC").replace(/[\s.\-_/]+/g, " ").trim();

export function marketSuggestion(feed: MarketFeed, name: string, extra: { marketId?: string; district?: string } = {}): MarketSuggestion {
  return { key: `${feed}|${extra.marketId ?? name}`, feed, name, ...extra, terms: [...placeSearchTerms(name), ...(extra.district ? [extra.district] : [])].map(normalise) };
}

/**
 * Places whose name, Kannada name, other spelling or district matches what was typed. Names that start with the text
 * come first, then names with a word starting with it, then names that only contain it; ties keep alphabetical order.
 */
export function matchSuggestions(items: MarketSuggestion[], query: string, limit = MAX_SUGGESTIONS) {
  const text = normalise(query);
  if (!text) return [];
  const rank = (item: MarketSuggestion) => {
    let best = Infinity;
    for (const term of item.terms) {
      if (term.startsWith(text)) best = Math.min(best, 0);
      else if (term.split(" ").some((word) => word.startsWith(text))) best = Math.min(best, 1);
      else if (term.includes(text)) best = Math.min(best, 2);
    }
    return best;
  };
  return items.map((item) => ({ item, score: rank(item) }))
    .filter(({ score }) => score < Infinity)
    .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map(({ item }) => item);
}

import { useSyncExternalStore } from "react";
import { marketBySlug, type MarketPlace } from "./markets";

/**
 * The grower's own town, kept only on this device. The home page leads with its rates, the bottom bar's "My town" opens
 * its page, and the town page can set or clear it. A browser that blocks storage keeps the choice until the page closes.
 */
const KEY = "ani-my-town";
const EVENT = "ani-my-town-change";
let memory: string | null = null;

function read(): string | null {
  try { return localStorage.getItem(KEY) ?? memory; }
  catch { return memory; }
}

export function setMyTown(slug: string | null) {
  memory = slug;
  try {
    if (slug) localStorage.setItem(KEY, slug);
    else localStorage.removeItem(KEY);
  } catch { /* kept in memory for this visit */ }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(callback: () => void) {
  const storageChanged = (event: StorageEvent) => { if (event.key === KEY || event.key === null) callback(); };
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", storageChanged);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", storageChanged);
  };
}

/** The saved town, or undefined when none is saved or the saved one is no longer listed. */
export function useMyTown(): MarketPlace | undefined {
  const slug = useSyncExternalStore(subscribe, read, () => null);
  return marketBySlug(slug ?? undefined);
}

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const KEY = "areca-pulse-theme";
const EVENT = "areca-pulse-theme-change";

function savedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch (error) {
    console.warn("Theme preference could not be read.", error);
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event(EVENT));
}

export function setTheme(theme: Theme) {
  try { localStorage.setItem(KEY, theme); }
  catch (error) { console.warn("Theme preference could not be saved.", error); }
  apply(theme);
}

function subscribe(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const systemChanged = () => { if (!savedTheme()) apply(systemTheme()); };
  const storageChanged = (event: StorageEvent) => { if (event.key === KEY || event.key === null) apply(savedTheme() ?? systemTheme()); };
  media.addEventListener("change", systemChanged);
  window.addEventListener("storage", storageChanged);
  window.addEventListener(EVENT, callback);
  return () => {
    media.removeEventListener("change", systemChanged);
    window.removeEventListener("storage", storageChanged);
    window.removeEventListener(EVENT, callback);
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme === "dark" ? "dark" : "light", () => "light");
}

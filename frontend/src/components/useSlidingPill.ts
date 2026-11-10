import { useLayoutEffect, useRef } from "react";

/**
 * A segmented switch whose selection glides: one highlight sits behind the buttons and moves to the pressed one
 * (`aria-pressed="true"`). Until it has been measured the pressed button keeps its own background, so the switch reads
 * correctly with or without script. "Reduce motion" removes the glide (the global transition rule), not the highlight.
 */
export function useSlidingPill<T extends HTMLElement>(dependency: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const place = () => {
      const active = element.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!active) { element.classList.remove("has-pill"); return; }
      element.style.setProperty("--pill-x", `${active.offsetLeft}px`);
      element.style.setProperty("--pill-y", `${active.offsetTop}px`);
      element.style.setProperty("--pill-w", `${active.offsetWidth}px`);
      element.style.setProperty("--pill-h", `${active.offsetHeight}px`);
      element.classList.add("has-pill");
    };
    place();
    // Re-measure when the switch resizes (layout, language) and once web fonts have loaded and changed text widths.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(element);
    let cancelled = false;
    void document.fonts?.ready.then(() => { if (!cancelled) place(); });
    return () => { cancelled = true; observer?.disconnect(); };
  }, [dependency]);
  return ref;
}

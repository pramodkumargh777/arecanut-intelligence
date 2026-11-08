import { Info } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Methodology, provenance and source-status detail, collapsed by default. Pages keep the facts a reader needs to
 * trust a number (date, unit, price type, warnings) visible, and put the rest here so the data comes first.
 */
export function AboutData({ children, title = "About this data" }: { children: ReactNode; title?: string }) {
  return <details className="about-data">
    <summary><Info size={15} aria-hidden="true" />{title}</summary>
    <div className="about-data-body">{children}</div>
  </details>;
}

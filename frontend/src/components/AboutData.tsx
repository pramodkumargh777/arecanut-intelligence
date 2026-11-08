import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { useLanguage } from "../services/language";

/**
 * Methodology, provenance and source-status detail, collapsed by default. Pages keep the facts a reader needs to
 * trust a number (date, unit, price type, warnings) visible, and put the rest here so the data comes first.
 */
export function AboutData({ children, title }: { children: ReactNode; title?: string }) {
  const { language } = useLanguage();
  return <details className="about-data">
    <summary><Info size={15} aria-hidden="true" />{title ?? (language === "kn" ? "ಈ ದತ್ತಾಂಶದ ಬಗ್ಗೆ" : "About this data")}</summary>
    <div className="about-data-body">{children}</div>
  </details>;
}

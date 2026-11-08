import { AlertCircle, Database, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { defineCopy, useLanguage } from "../services/language";

/** Defaults follow the reader's language; pages that pass their own label decide its language themselves. */
const STATE_COPY = defineCopy({
  en: { loading: "Loading market data", retry: "Retry" },
  kn: { loading: "ಮಾರುಕಟ್ಟೆ ದತ್ತಾಂಶ ತರಲಾಗುತ್ತಿದೆ", retry: "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ" },
});

export function LoadingState({ label }: { label?: string }) {
  const { language } = useLanguage();
  const text = label ?? STATE_COPY[language].loading;
  return <div className="state-card" role="status" lang={label ? undefined : language}><LoaderCircle className="spin" size={19} /><span>{text}…</span></div>;
}

/** Grey rows shaped like rate rows, so a slow connection shows where the prices will appear. Screen readers hear the label. */
export function SkeletonRows({ label, rows = 3 }: { label?: string; rows?: number }) {
  const { language } = useLanguage();
  const text = label ?? STATE_COPY[language].loading;
  return <div className="skeleton-rows" role="status" lang={label ? undefined : language}>
    <span className="sr-only">{text}…</span>
    {Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index} aria-hidden="true">
      <span className="skeleton-lines"><span className="skeleton-bar" /><span className="skeleton-bar skeleton-bar-thin" /></span>
      <span className="skeleton-bar skeleton-bar-price" />
    </div>)}
  </div>;
}

export function ErrorState({ error, onRetry, retryLabel }: { error: Error; onRetry?: () => void; retryLabel?: string }) {
  const { language } = useLanguage();
  return (
    <div className="state-card state-error" role="alert">
      <AlertCircle size={19} /><span>{error.message}</span>
      {onRetry && <button className="text-button" onClick={onRetry} lang={retryLabel ? undefined : language}>{retryLabel ?? STATE_COPY[language].retry}</button>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Database size={22} /></span>
      <strong>{title}</strong>
      <div>{children}</div>
    </div>
  );
}

import { AlertCircle, Database, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

export function LoadingState({ label = "Loading market data" }: { label?: string }) {
  return <div className="state-card" role="status"><LoaderCircle className="spin" size={19} /><span>{label}…</span></div>;
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="state-card state-error" role="alert">
      <AlertCircle size={19} /><span>{error.message}</span>
      {onRetry && <button className="text-button" onClick={onRetry}>Retry</button>}
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

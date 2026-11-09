import { Download } from "lucide-react";

/**
 * A panel's CSV download. Desktop shows the full label; phones show a download icon and "CSV", so a long (often Kannada)
 * panel title keeps the width it needs. Screen readers always get the full label.
 */
export function ExportButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className="button-secondary export-button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
    <Download size={15} aria-hidden="true" /><span className="export-label">{label}</span><span className="export-short" aria-hidden="true">CSV</span>
  </button>;
}

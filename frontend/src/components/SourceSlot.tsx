import { createContext, useContext, type ReactNode } from "react";

/**
 * The market pages share one data-source dropdown. MarketDataPage provides it here, and each page places it in its
 * own heading row with its other controls, so the source does not take a separate row above the page.
 */
export const SourceControl = createContext<ReactNode>(null);

export function SourceSlot() {
  return <>{useContext(SourceControl)}</>;
}

/**
 * Publication rule for cooperative price units. A quotation is publishable in INR/quintal when the source confirms that
 * unit or the operator has decided to treat the source as INR/quintal (TSS and TUMCOS, migration 0020). An operator
 * decision stays recorded as `assumed`, so it is never presented as something the source itself stated.
 */
export const OPERATOR_ASSUMED_UNIT_SOURCES = ["tss", "tumcos"] as const;

/** Below this, a value could genuinely be per kg, so treating it as per quintal could be wrong by a factor of 100. */
export const PER_KG_PLAUSIBILITY_LIMIT = 1_000;

export function operatorAssumesUnit(source: string): boolean {
  return (OPERATOR_ASSUMED_UNIT_SOURCES as readonly string[]).includes(source);
}

export function publishableUnit(row: { unit_status?: string; price_unit: string }): boolean {
  return row.price_unit === "INR/quintal" && (row.unit_status === "source_confirmed" || row.unit_status === "assumed");
}

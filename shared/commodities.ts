// Commodity domain helpers shared by the API and the frontend. Pure functions only: no I/O.

export const PRICE_BASES = [
  "APMC_MODAL",
  "APMC_MIN_MAX",
  "COOPERATIVE_AVERAGE",
  "COOPERATIVE_TENDER_AVERAGE",
  "AUCTION_LOT_PRICE",
  "BUYER_QUOTATION",
  "FARMER_TRANSACTION",
] as const;
export type PriceBasis = typeof PRICE_BASES[number];

export const CAPABILITIES = [
  "daily_prices", "analytics", "market_comparison", "monthly_history", "forecast",
  "cooperative_mamcos", "cooperative_tss", "cooperative_tumcos",
  "production", "trade", "weather", "quality", "calculators", "intelligence",
] as const;
export type Capability = typeof CAPABILITIES[number];
export type CapabilityStatus = "available" | "unpublished" | "not_integrated";

export type MarketFeed = "official" | "mamcos" | "tss" | "tumcos";

export interface UnitDef { code: string; label: string; dimension: "mass" | "count"; base_unit: string; factor_to_base: number }
export interface UnitAlias { source_label: string; unit_code: string; currency: string; mapping_status: "verified" | "unverified" }
export interface VarietyDef {
  id: string; code: string; label: string; classification_type: string; unit_code: string | null;
  mapping_status: "verified" | "unverified"; evidence: string | null; sort_order: number;
}
export interface GradeDef {
  id: string; code: string; label: string; grade_type: string; variety_id: string | null;
  mapping_status: "verified" | "unverified"; evidence: string; sort_order: number;
}
export interface VarietyAlias {
  commodity_id: string; variety_id: string; source_key: string; source_name: string; mapping_status: "verified" | "unverified";
}
export interface GradeMapping { commodity_id: string; source_key: string; source_label: string; grade_id: string; mapping_status: "verified" | "unverified" }
export interface CommodityDef {
  id: string; code: string; display_name: string; category: string | null; status: "production" | "configured"; sort_order: number;
  config: {
    default_unit_code: string; currency: string; grading_system: string; agmarknet_commodity_code: string | null;
    config_status: "verified" | "reference_unverified"; notes: string;
  } | null;
  capabilities: Partial<Record<Capability, { status: Exclude<CapabilityStatus, "not_integrated">; note: string | null }>>;
  varieties: VarietyDef[];
  grades: GradeDef[];
}
export interface CommodityCatalog {
  default_commodity: string;
  commodities: CommodityDef[];
  units: UnitDef[];
  price_bases: { code: PriceBasis; label: string; description: string }[];
}

export const DEFAULT_COMMODITY = "arecanut";

export function isPriceBasis(value: string): value is PriceBasis {
  return (PRICE_BASES as readonly string[]).includes(value);
}

/** Price basis carried by each integrated source. Cooperative averages are never APMC modal prices. */
export function priceBasisForSource(sourceKey: string): PriceBasis {
  switch (sourceKey) {
    case "agmarknet":
    case "agmarknet_csv":
      return "APMC_MODAL";
    case "tss":
      return "COOPERATIVE_TENDER_AVERAGE";
    case "mamcos":
    case "tumcos":
      return "COOPERATIVE_AVERAGE";
    default:
      throw new Error(`No price basis is defined for source ${sourceKey}.`);
  }
}

/** Resolve a source unit label such as "Rs./Quintal" to a unit code. Unknown labels are not guessed. */
export function parsePriceUnit(label: string | null | undefined, aliases: UnitAlias[]): string | null {
  if (!label) return null;
  const match = aliases.find((alias) => alias.source_label === label.trim());
  return match ? match.unit_code : null;
}

/**
 * Convert a price quoted per `fromUnit` into a price per `toUnit`.
 * Returns null when either unit is unknown or the units measure different dimensions (e.g. nuts vs kg).
 */
export function normalizePrice(value: number, fromUnit: string, toUnit: string, units: UnitDef[]): number | null {
  if (!Number.isFinite(value)) return null;
  const from = units.find((unit) => unit.code === fromUnit);
  const to = units.find((unit) => unit.code === toUnit);
  if (!from || !to || from.dimension !== to.dimension || from.base_unit !== to.base_unit) return null;
  return (value / from.factor_to_base) * to.factor_to_base;
}

/** Commodity-scoped variety alias resolution. The same label under another commodity or source never matches. */
export function resolveVariety(aliases: VarietyAlias[], commodityId: string, sourceKey: string, label: string): VarietyAlias | null {
  return aliases.find((alias) => alias.commodity_id === commodityId && alias.source_key === sourceKey && alias.source_name === label) ?? null;
}

export function resolveGrade(mappings: GradeMapping[], commodityId: string, sourceKey: string, label: string | null): GradeMapping | null {
  if (!label) return null;
  return mappings.find((mapping) => mapping.commodity_id === commodityId && mapping.source_key === sourceKey && mapping.source_label === label) ?? null;
}

export function findCommodity(catalog: CommodityCatalog, code: string | null | undefined): CommodityDef | undefined {
  return catalog.commodities.find((commodity) => commodity.code === code);
}

export function capabilityStatus(commodity: CommodityDef | undefined, capability: Capability): CapabilityStatus {
  return commodity?.capabilities[capability]?.status ?? "not_integrated";
}

export function varietyOptions(commodity: CommodityDef | undefined): VarietyDef[] {
  return [...(commodity?.varieties ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
}

/** Grades valid for a commodity, optionally restricted to grades that apply to a variety (or to every variety). */
export function gradeOptions(commodity: CommodityDef | undefined, varietyId?: string | null): GradeDef[] {
  return [...(commodity?.grades ?? [])]
    .filter((grade) => !varietyId || grade.variety_id === null || grade.variety_id === varietyId)
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
}

/** Default price unit, e.g. "INR / QUINTAL" (caps, for labels) or "INR / quintal" (text, for prose and captions). */
export function unitLabel(catalog: CommodityCatalog, commodity: CommodityDef | undefined, style: "caps" | "text" = "caps"): string {
  const code = commodity?.config?.default_unit_code;
  const unit = catalog.units.find((candidate) => candidate.code === code);
  const name = (unit?.code ?? code ?? "unit").replace("_", " ");
  return `${commodity?.config?.currency ?? "INR"} / ${style === "caps" ? name.toUpperCase() : name}`;
}

/** Market-data feeds the commodity can show. Unpublished feeds are listed so archived review rows remain discoverable. */
export function marketFeeds(commodity: CommodityDef | undefined): MarketFeed[] {
  const feeds: MarketFeed[] = [];
  for (const [feed, capability] of [["mamcos", "cooperative_mamcos"], ["tss", "cooperative_tss"], ["tumcos", "cooperative_tumcos"], ["official", "daily_prices"]] as const) {
    if (capabilityStatus(commodity, capability) !== "not_integrated") feeds.push(feed);
  }
  return feeds;
}

/** Capability required to render a route for the selected commodity; null when the route is commodity-independent. */
export function routeCapability(pathname: string): Capability | "market_data" | null {
  if (["/", "/overview", "/prices", "/analytics", "/compare"].includes(pathname)) return "market_data";
  if (pathname === "/monthly-trends" || pathname === "/history" || pathname === "/sell-or-hold") return "monthly_history";
  if (pathname === "/forecasts" || pathname === "/forecasts/evaluation") return "forecast";
  if (pathname === "/decision-tools") return "calculators";
  if (pathname === "/supply") return "production";
  if (pathname === "/intelligence/quality") return "quality";
  const domain = /^\/intelligence\/([a-z]+)$/.exec(pathname)?.[1];
  if (domain === "production" || domain === "trade" || domain === "weather") return domain;
  if (pathname.startsWith("/intelligence")) return "intelligence";
  return null;
}

/** Whether a route has an integrated (published or archived) source for the commodity. Unknown commodities only see commodity-independent routes. */
export function routeAvailable(commodity: CommodityDef | undefined, pathname: string): boolean {
  const capability = routeCapability(pathname);
  if (capability === null) return true;
  if (capability === "market_data") return marketFeeds(commodity).length > 0;
  return capabilityStatus(commodity, capability) !== "not_integrated";
}

export interface FilterableObservation {
  commodity_code: string | null; variety_id: string | null; variety_label: string; grade_id: string | null; grade_label: string | null; price_basis: string;
}

/** Filter observations by commodity, exact variety (id or source label), grade and basis. Never merges commodities. */
export function filterObservations<T extends FilterableObservation>(rows: T[], filter: {
  commodity: string; variety?: string; grade?: string; priceBasis?: string;
}): T[] {
  return rows.filter((row) => row.commodity_code === filter.commodity
    && (!filter.variety || row.variety_id === filter.variety || row.variety_label === filter.variety)
    && (!filter.grade || row.grade_id === filter.grade || row.grade_label === filter.grade)
    && (!filter.priceBasis || row.price_basis === filter.priceBasis));
}

/** Built-in production configuration used when the catalogue endpoint is unavailable, so arecanut pages keep working. */
export const FALLBACK_CATALOG: CommodityCatalog = {
  default_commodity: DEFAULT_COMMODITY,
  units: [
    { code: "kg", label: "kilogram", dimension: "mass", base_unit: "kg", factor_to_base: 1 },
    { code: "quintal", label: "quintal (100 kg)", dimension: "mass", base_unit: "kg", factor_to_base: 100 },
  ],
  price_bases: [],
  commodities: [{
    id: "commodity-arecanut", code: "arecanut", display_name: "Arecanut", category: "plantation_crop", status: "production", sort_order: 1,
    config: {
      default_unit_code: "quintal", currency: "INR", grading_system: "AGMARKNET variety label with AGMARKNET grade (Local/Large/Medium/FAQ)",
      agmarknet_commodity_code: "118", config_status: "verified", notes: "Built-in fallback configuration.",
    },
    capabilities: Object.fromEntries(CAPABILITIES.map((capability) => [capability, { status: "available", note: null }])),
    varieties: [],
    grades: ["Local", "Large", "Medium", "FAQ"].map((label, index) => ({
      id: `grade-arecanut-${label.toLowerCase()}`, code: label.toLowerCase(), label, grade_type: "agmarknet_grade", variety_id: null,
      mapping_status: "verified", evidence: "AGMARKNET daily resource grade field", sort_order: index + 1,
    })),
  }],
};

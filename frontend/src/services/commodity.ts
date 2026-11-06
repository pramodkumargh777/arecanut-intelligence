import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { FALLBACK_CATALOG, findCommodity, unitLabel, type CommodityCatalog, type CommodityDef } from "../../../shared/commodities";
import { api } from "./api";

export interface CommoditySelection {
  /** Commodity code sent to the API. Always the requested code, even when it is not in the catalogue. */
  code: string;
  commodity: CommodityDef | undefined;
  catalog: CommodityCatalog;
  catalogStatus: "loading" | "loaded" | "fallback";
  /** Caps label for chrome, e.g. "INR / QUINTAL". */
  unit: string;
  /** Prose label, e.g. "INR / quintal". */
  unitText: string;
}

/** Global commodity selection from the `commodity` URL parameter; the catalogue default (Arecanut) applies when absent. */
export function useCommodity(): CommoditySelection {
  const [params] = useSearchParams();
  const query = useQuery({ queryKey: ["commodities"], queryFn: api.commodities, staleTime: 10 * 60_000, retry: 1 });
  // Fallback contains only Arecanut, so production pages keep working if the catalogue endpoint is unavailable.
  const catalog = query.data ?? FALLBACK_CATALOG;
  const code = params.get("commodity") || catalog.default_commodity;
  const commodity = findCommodity(catalog, code);
  return {
    code, commodity, catalog,
    catalogStatus: query.data ? "loaded" : query.isLoading ? "loading" : "fallback",
    unit: unitLabel(catalog, commodity),
    unitText: unitLabel(catalog, commodity, "text"),
  };
}

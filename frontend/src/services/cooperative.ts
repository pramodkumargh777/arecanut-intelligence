export type CooperativeQuote = {
  id: string; source_key: string; branch: string; reporting_date: string; variety: string;
  minimum_price: number | null; maximum_price: number | null; average_price: number | null;
  price_type: "reported_average"; price_unit: string; source_url: string; fetched_at: string;
  raw_record?: string; validation_message?: string | null; status: string;
  unit_status: "source_confirmed" | "assumed"; normal_price: number | null;
};
export type CooperativeData = {
  source: string; varieties: string[]; variety: string; data: CooperativeQuote[];
  latest_by_branch: CooperativeQuote[];
  series: { reporting_date: string; median_average_price: number; branch_count: number; branches: string[] }[];
  latest_reporting_date: string | null; reference_price: number | null; previous_reference_price: number | null;
  minimum_branch_coverage: number; methodology: string; availability: string | null;
  counts: { status: string; count: number }[];
  last_fetch: { started_at: string; finished_at: string | null; status: string; error_message: string | null } | null;
  recent_fetches: { source_url: string; started_at: string; status: string; error_message: string | null; received_count: number | null; excluded_count: number }[];
};

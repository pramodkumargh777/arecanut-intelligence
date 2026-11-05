import { formatCalendarDate } from "../../../shared/dates";

export type CooperativeQuote = {
  id: string; source_key: string; branch: string; reporting_date: string; variety: string;
  minimum_price: number | null; maximum_price: number | null; average_price: number | null;
  price_type: "reported_average"; price_unit: string; source_url: string; fetched_at: string;
  raw_record?: string; validation_message?: string | null; status: string;
  unit_status: "source_confirmed" | "assumed" | "source_conflict"; normal_price: number | null;
  commodity?: CooperativeCommodity; variety_reported?: number; source_unit_label?: string | null;
  lot_count?: number | null; bag_count?: number | null; reported_weight?: number | null; session_codes?: string | null;
  source_record_id?: string | null; source_published_at?: string | null; review_flags?: string | null; ingest_mode?: string | null;
  fetch_id?: string;
};
export type CooperativeSource = "mamcos" | "tss" | "tumcos";
export type CooperativeCommodity = "arecanut" | "black_pepper";
export type PermissionStatus = "not_requested" | "requested" | "granted" | "denied";
export type CooperativeData = {
  source: CooperativeSource; commodity: CooperativeCommodity;
  publication: { published: boolean; blocked_reason: string | null; latest_archived_reporting_date: string | null };
  permission: { status: PermissionStatus; label: string; operator: string; scheduled_collection_allowed: boolean; redistribution_allowed: boolean; terms_checked_at: string } | null; varieties: string[]; variety: string; data: CooperativeQuote[];
  latest_by_branch: CooperativeQuote[];
  /** All branches reporting the selected variety, independent of the bounded row window. */
  branches: string[];
  window: { from: string; to: string; default_window_days: number; max_window_days: number; row_limit: number; truncated: boolean };
  series: { reporting_date: string; median_average_price: number; branch_count: number; branches: string[] }[];
  latest_reporting_date: string | null; reference_price: number | null; previous_reference_price: number | null;
  benchmark_reporting_date: string | null; source_publication_timestamp: null;
  minimum_branch_coverage: number; methodology: string; availability: string | null;
  counts: { status: string; count: number }[];
  last_fetch: { started_at: string; finished_at: string | null; status: string; error_message: string | null } | null;
  recent_fetches: { source_url: string; started_at: string; status: string; error_message: string | null; received_count: number | null; excluded_count: number }[];
};

export type RefreshSummary = { fetch_id?: string; received_count: number; inserted_count: number; invalid_count: number; excluded_count?: number; attempts?: number };
export type TumcosRefreshSummary = RefreshSummary & {
  in_scope_count: number; duplicate_count: number; unit_conflict_count: number;
  commodities: Record<CooperativeCommodity, number>; latest_record_date: string | null; page_last_updated: string | null;
  stale_page_metadata: boolean; table_check: { rows: number; matched: number };
};
export type TssBackfillSummary = { dates: number; succeeded: number; results: { date: string; status: "succeeded" | "failed"; detail: RefreshSummary | string }[] };
export type CsvImportSummary = {
  source: CooperativeSource; dry_run: boolean; fetch_id: string | null; received_count: number; pending_count: number; invalid_count: number;
  inserted_count: number; duplicate_count: number;
  rejected: { branch: string; reporting_date: string; variety: string; reason: string | null }[];
};
export type CsvImportRequest = { source: CooperativeSource; csv: string; authorized_by: string; permission_reference: string; attestation: true; dry_run: boolean };
export type ReplaySummary = { fetch_id: string; replay_of: string; source: CooperativeSource; received_count: number; parsed_count: number; inserted_count: number; duplicate_count: number; invalid_count: number };
export type ReviewResult = { success: boolean; status: string; published: boolean; note: string | null };
export type Freshness = { latest_reporting_date: string | null; age_days: number | null; state: "fresh" | "stale" | "no_data" };
export type CooperativeSourceStatus = {
  generated_at: string; market_calendar_today: string;
  sources: {
    source_key: CooperativeSource; display_name: string; operator: string; source_url: string; access_method: string; commodities: string;
    availability: { state: "available" | "running" | "failing" | "never_fetched"; last_attempt_at: string | null; last_status: string | null; http_status: number | null; attempts: number | null };
    last_success_at: string | null;
    permission: { status: PermissionStatus; label: string; scheduled_collection_allowed: boolean; redistribution_allowed: boolean;
      permission_reference: string | null; robots_status: string; terms_status: string; terms_checked_at: string };
    unit_evidence: string; notes: string;
    commodity_status: { commodity: string; freshness: Freshness; by_status: Record<string, number>; by_unit_status: Record<string, number> }[];
    recent_failures: { fetch_id: string; status: string; started_at: string; ingest_mode: string | null; http_status: number | null; reason: string | null }[];
    recent_fetches: { fetch_id: string; status: string; started_at: string; finished_at: string | null; ingest_mode: string | null; http_status: number | null; attempts: number | null; received_count: number | null; inserted_count: number | null }[];
  }[];
};

/** Only a source-confirmed INR/quintal unit can be verified and published. */
export function unitConfirmed(row: Pick<CooperativeQuote, "unit_status" | "price_unit">): boolean {
  return row.unit_status === "source_confirmed" && row.price_unit === "INR/quintal";
}

export function reviewFlags(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

const FRESHNESS_LABEL: Record<Freshness["state"], string> = { fresh: "Fresh", stale: "Stale", no_data: "No data" };

export function describeFreshness({ freshness }: { freshness: Freshness }): string {
  if (freshness.state === "no_data" || !freshness.latest_reporting_date) return "No stored reporting dates";
  return `${FRESHNESS_LABEL[freshness.state]} · latest market reporting date ${formatCalendarDate(freshness.latest_reporting_date)} (${freshness.age_days} day${freshness.age_days === 1 ? "" : "s"} old)`;
}

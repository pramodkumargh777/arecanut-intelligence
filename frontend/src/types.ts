export type Market = {
  id: string;
  name: string;
  district: string;
  state: string;
};

export type PriceObservation = {
  id: string;
  reporting_date: string;
  publication_date: string | null;
  original_unit: string;
  source_publication_timestamp: null;
  platform_fetch_timestamp: null;
  market_id: string;
  market_name: string;
  district: string;
  variety_name: string;
  minimum_price: number;
  maximum_price: number;
  modal_price: number;
  arrival_quantity: number | null;
  arrival_unit: string | null;
  price_unit: "INR/quintal";
  source_name: string;
  source_record_id: string;
  ingestion_timestamp: string;
  grade?: string | null;
  /** Price basis taxonomy code; APMC_MODAL for AGMARKNET daily rows. */
  price_basis?: string;
};

export type ReferencePoint = {
  reporting_date: string;
  median_modal_price: number;
  market_count: number;
};

export type Overview = {
  latest_reporting_date: string | null;
  benchmark_reporting_date: string | null;
  reference_price: number | null;
  previous_reference_price: number | null;
  absolute_change: number | null;
  percent_change: number | null;
  reporting_markets: number;
  market_coverage_required: number;
  index_status: "available" | "insufficient_coverage" | "no_data";
  highest_market: { market_name: string; modal_price: number } | null;
  lowest_market: { market_name: string; modal_price: number } | null;
  source_count: number;
};

export type QualityRecord = {
  id: string;
  reporting_date: string;
  publication_date: string | null;
  market_name: string;
  district: string;
  state: string;
  variety_name: string;
  minimum_price: number;
  maximum_price: number;
  modal_price: number;
  price_unit: string;
  source_name: string;
  source_record_id: string;
  validation_status: string;
  validation_message: string | null;
  raw_payload: string;
  original_unit: string;
  ingested_at: string;
  grade?: string | null;
  source_resource_id?: string | null;
  platform_fetched_at?: string | null;
};

export type SourceRun = {
  id: string;
  source_key: string;
  resource_id: string | null;
  mode: "daily" | "backfill" | "csv" | "replay";
  status: "completed" | "completed_with_rejections" | "no_data" | "failed";
  started_at: string;
  completed_at: string;
  source_updated_at: string | null;
  request_filters: Record<string, string>;
  source_total: number | null;
  fetched_count: number;
  out_of_scope_count: number;
  accepted_count: number;
  review_required_count: number;
  rejected_count: number;
  inserted_count: number;
  duplicate_count: number;
  corrected_count: number;
  market_count: number;
  reporting_dates: string[];
  import_job_ids: string[];
  rejected_sample: { source_record_id: string | null; reasons: { code: string; message: string; severity: string }[] }[];
  error_message: string | null;
};

export type SourceStatus = {
  reference_state: string;
  sources: {
    id: string;
    source_key: string;
    name: string;
    source_type: string;
    is_enabled: number;
    observation_counts: Record<string, number>;
    coverage: {
      latest_reporting_date: string;
      latest_date_observations: number;
      latest_date_markets: number;
      latest_platform_fetch: string | null;
      latest_ingested_at: string;
      reporting_date_count: number;
      earliest_reporting_date: string;
    } | null;
    last_run: SourceRun | null;
  }[];
  recent_runs: SourceRun[];
  limitations: string[];
};

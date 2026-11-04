export type Market = {
  id: string;
  name: string;
  district: string;
  state: string;
};

export type PriceObservation = {
  id: string;
  reporting_date: string;
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
};

export type ReferencePoint = {
  reporting_date: string;
  median_modal_price: number;
  market_count: number;
};

export type Overview = {
  latest_reporting_date: string | null;
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
};

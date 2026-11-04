export type Observation = {
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

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function buildReferenceSeries(
  observations: Observation[],
  minimumMarketCoverage: number,
): ReferencePoint[] {
  const byDate = new Map<string, Map<string, Observation>>();
  for (const observation of observations) {
    const markets = byDate.get(observation.reporting_date) ?? new Map<string, Observation>();
    const existing = markets.get(observation.market_id);
    if (existing === undefined || observation.ingestion_timestamp > existing.ingestion_timestamp) {
      markets.set(observation.market_id, observation);
    }
    byDate.set(observation.reporting_date, markets);
  }

  return [...byDate.entries()]
    .map(([reporting_date, marketPrices]) => ({
      reporting_date,
      market_count: marketPrices.size,
      median_modal_price: median([...marketPrices.values()].map((observation) => observation.modal_price)) ?? 0,
    }))
    .filter((point) => point.market_count >= minimumMarketCoverage)
    .sort((a, b) => a.reporting_date.localeCompare(b.reporting_date));
}

export function percentageChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

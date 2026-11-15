/**
 * Rates for the daily video, read from the same public API the website uses. Sources are never merged: each block is
 * one source and one exact source label, and every quote keeps its own branch and reporting date.
 */
export type Source = "mamcos" | "tss" | "tumcos";

export type Quote = {
  branch: string;
  date: string;
  avg: number;
  min: number | null;
  max: number | null;
  /** "source_confirmed" when the source states ₹/quintal; "assumed" for TSS and TUMCOS, which state no unit. */
  unit: string;
  prevDate: string | null;
  prevAvg: number | null;
};

export type CoopBlock = { source: Source; variety: string; latest: Quote[]; histBranch: string; hist: [string, number][] };

export type ApmcRow = {
  market: string;
  district: string;
  date: string;
  variety: string;
  grade: string | null;
  modal: number;
  min: number | null;
  max: number | null;
  source: string;
};

export type RatesData = { fetchedAt: string; live: boolean; coop: CoopBlock[]; apmc: ApmcRow[] };

export const API_BASE = "https://ani-market-api.arecanut.workers.dev/api/v1";

/** The source labels the website's Rashi and Chali tabs use (frontend/src/services/varieties.ts). */
export const REQUESTS: { source: Source; variety: string; histBranch: string }[] = [
  { source: "mamcos", variety: "RASHI EDI", histBranch: "THIRTHAHALLI" },
  { source: "tss", variety: "RASHI", histBranch: "Sirsi" },
  { source: "mamcos", variety: "CHALI", histBranch: "SAGARA" },
  { source: "tss", variety: "CHALI", histBranch: "Sirsi" },
  { source: "tumcos", variety: "areca", histBranch: "Channagiri" },
];

type ApiQuote = {
  branch: string;
  reporting_date: string;
  average_price: number | null;
  minimum_price: number | null;
  maximum_price: number | null;
  unit_status: string;
};

const shift = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return (await res.json()) as T;
}

export async function fetchRates(signal?: AbortSignal): Promise<RatesData> {
  const from = shift(new Date().toISOString(), -60);
  const coop = await Promise.all(
    REQUESTS.map(async ({ source, variety, histBranch }): Promise<CoopBlock> => {
      const r = await getJson<{ data: ApiQuote[]; latest_by_branch: ApiQuote[] }>(
        `${API_BASE}/cooperative/prices?source=${source}&variety=${encodeURIComponent(variety)}&commodity=arecanut&from=${from}`,
        signal,
      );
      const latest = r.latest_by_branch
        .filter((q) => q.average_price != null)
        .map((q) => {
          const prev = r.data
            .filter((d) => d.branch === q.branch && d.reporting_date < q.reporting_date && d.average_price != null)
            .sort((a, b) => b.reporting_date.localeCompare(a.reporting_date))[0];
          return {
            branch: q.branch,
            date: q.reporting_date,
            avg: q.average_price!,
            min: q.minimum_price,
            max: q.maximum_price,
            unit: q.unit_status,
            prevDate: prev?.reporting_date ?? null,
            prevAvg: prev?.average_price ?? null,
          };
        });
      const branch = source === "tumcos" ? (latest[0]?.branch ?? histBranch) : histBranch;
      const hist = r.data
        .filter((d) => d.branch === branch && d.average_price != null)
        .map((d) => [d.reporting_date, d.average_price!] as [string, number])
        .sort((a, b) => a[0].localeCompare(b[0]));
      return { source, variety, latest, histBranch: branch, hist };
    }),
  );
  const a = await getJson<{
    data: {
      market_name: string;
      district: string;
      reporting_date: string;
      variety_name: string;
      grade: string | null;
      modal_price: number | null;
      minimum_price: number | null;
      maximum_price: number | null;
      source_name: string;
    }[];
  }>(`${API_BASE}/prices?commodity=arecanut&q=Siddapur&district=Uttara+Kannada&limit=30&sort=reporting_date&order=desc`, signal);
  const day = a.data[0]?.reporting_date;
  const apmc = a.data
    .filter((x) => x.reporting_date === day && x.modal_price != null)
    .map((x) => ({
      market: x.market_name,
      district: x.district,
      date: x.reporting_date,
      variety: x.variety_name,
      grade: x.grade,
      modal: x.modal_price!,
      min: x.minimum_price,
      max: x.maximum_price,
      source: x.source_name,
    }));
  return { fetchedAt: new Date().toISOString(), live: true, coop, apmc };
}

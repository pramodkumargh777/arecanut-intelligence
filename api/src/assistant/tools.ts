/**
 * Assistant tool registry. Every tool calls an existing public ANI endpoint in-process (no new data paths), copies
 * verified values into facts with their source, reporting period and price basis, and states what is missing.
 * Tools are read-only; the only POST target is the stateless /decisions/calculate calculator.
 */
import { z } from "zod";
import { MONTH_NAMES_EN, MONTH_NAMES_KN } from "../../../shared/dates";
import { holdHistory } from "../../../shared/hold-history";
import { namesPlace, placesIn } from "./places";
import { searchDocuments, pageLabel, queryTerms } from "./retrieval";
import type { EmbeddingProvider } from "./providers";
import type { Language } from "./language";
import { TOOL_NAMES, type Fact, type SourceRef, type ToolName, type ToolResult } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export type ToolContext = {
  /** Calls an ANI API path (e.g. "/monthly-prices?…") in-process and returns the Response. */
  call: (path: string, init?: RequestInit) => Promise<Response>;
  db: D1Database;
  question: string;
  language: Language;
  embedder: EmbeddingProvider | null;
  semanticThreshold?: number;
  semanticScanLimit?: number;
  /** Override for tests. */
  now?: Date;
};

const text = (max = 120) => z.string().trim().min(1).max(max);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const source = z.enum(["agmarknet", "mamcos", "tss", "tumcos"]);
const money = z.number().finite().min(0).max(1e8);

const calculationArgs = {
  variety: text(80).optional(),
  price: z.number().finite().min(0.01).max(1e8).optional(),
  quantity_quintals: z.number().finite().min(0.0001).max(1e7).optional(),
  commission_percent: z.number().finite().min(0).max(99).optional(),
  transport_cost: money.optional(),
  other_selling_cost: money.optional(),
};

export const TOOL_SCHEMAS = {
  get_current_prices: z.object({ variety: text(80).optional(), district: text(80).optional(), source: source.optional() }).strict(),
  get_historical_prices: z.object({ variety: text(80).optional(), from_month: month.optional(), to_month: month.optional() }).strict(),
  compare_markets: z.object({ variety: text(80).optional(), source: source.optional() }).strict(),
  get_market_index: z.object({ variety: text(80).optional() }).strict(),
  get_market_arrivals: z.object({ district: text(80).optional(), granularity: z.enum(["daily", "weekly", "monthly", "seasonal"]).optional() }).strict(),
  get_price_forecast: z.object({ variety: text(80).optional() }).strict(),
  get_production_statistics: z.object({ geography: text(80).optional() }).strict(),
  get_trade_statistics: z.object({ direction: z.enum(["import", "export"]).optional() }).strict(),
  get_weather: z.object({ district: text(80).optional() }).strict(),
  get_advisories: z.object({ district: text(80).optional() }).strict(),
  calculate_net_realization: z.object(calculationArgs).strict(),
  calculate_sell_hold: z.object({
    ...calculationArgs,
    hold_days: z.number().int().min(1).max(3650).optional(),
    storage_cost: money.optional(),
    annual_finance_percent: z.number().finite().min(0).max(100).optional(),
    weight_loss_percent: z.number().finite().min(0).max(99).optional(),
    scenario_price: z.number().finite().min(0.01).max(1e8).optional(),
  }).strict(),
  search_industry_news: z.object({ query: text(300) }).strict(),
  search_agricultural_documents: z.object({
    query: text(500),
    document_type: z.enum(["cpcri_publication", "dasd_report", "government_notification", "agricultural_research"]).optional(),
  }).strict(),
} satisfies Record<ToolName, z.ZodType>;

export type ToolArgs<T extends ToolName> = z.infer<(typeof TOOL_SCHEMAS)[T]>;

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  get_current_prices: "Latest verified arecanut prices, listed separately by source and price basis (AGMARKNET daily APMC, AGMARKNET monthly state average, MAMCOS/TSS/TUMCOS cooperative averages).",
  get_historical_prices: "AGMARKNET Karnataka monthly arrival-weighted modal price history for one exact variety, with rolling and year-on-year statistics.",
  compare_markets: "Compare markets or cooperative branches for one variety, within one source only.",
  get_market_index: "ANI reference index: median verified AGMARKNET modal price across markets for one variety and date.",
  get_market_arrivals: "Arrival and traded quantities from authorized imports (kept as separate measures).",
  get_price_forecast: "Monthly reference forecast with interval, evaluation results and limitations.",
  get_production_statistics: "DASD area, production and yield by reporting year and estimate stage.",
  get_trade_statistics: "India arecanut import/export quantities and values by partner (DASD/DGCIS).",
  get_weather: "Weather history, forecasts and warnings with dataset type (model grid vs station observation).",
  get_advisories: "Expert-approved crop-risk advisories (never a diagnosis).",
  calculate_net_realization: "Net sale proceeds from user-stated quantity, price or variety, commission and transport cost.",
  calculate_sell_hold: "Sell-now vs hold comparison from user-stated holding costs; reports break-even hold price.",
  search_industry_news: "Search curated official news and policy releases ingested by ANI.",
  search_agricultural_documents: "Search CPCRI, DASD and government documents (keyword + BGE-M3 semantic retrieval).",
};

export function validateToolArgs(name: string, args: unknown): { ok: true; tool: ToolName; args: Record<string, unknown> } | { ok: false; error: string } {
  if (!(TOOL_NAMES as readonly string[]).includes(name)) return { ok: false, error: `Unknown tool "${name}".` };
  const parsed = TOOL_SCHEMAS[name as ToolName].safeParse(args ?? {});
  if (!parsed.success) return { ok: false, error: `Invalid arguments for ${name}: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "args"} ${issue.message}`).join("; ")}` };
  return { ok: true, tool: name as ToolName, args: parsed.data as Record<string, unknown> };
}

// ------------------------------------------------------------------------------------------------
// Helpers

const MONTHLY_BASIS = "MONTHLY_STATE_WEIGHTED_AVERAGE";
const DEFAULT_VARIETY = "Rashi";
const AGMARKNET = "AGMARKNET (Directorate of Marketing and Inspection)";
const STALE_DAYS = 7;
const COOP_LABEL: Record<string, string> = { mamcos: "MAMCOS", tss: "TSS", tumcos: "TUMCOS" };

class ToolHttpError extends Error {
  constructor(readonly path: string, readonly status: number, message: string) {
    super(message);
  }
}

async function getJson(ctx: ToolContext, path: string, init?: RequestInit): Promise<Json> {
  const response = await ctx.call(path, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ToolHttpError(path, response.status, (body as { error?: string } | null)?.error ?? `HTTP ${response.status}`);
  return body;
}

function result(tool: ToolName, args: Record<string, unknown>, title: string, partial: Partial<ToolResult> = {}): ToolResult {
  return {
    tool, args, title, status: "ok", summary: "", facts: [], sources: [], assumptions: [], uncertainty: [], missing: [], limitations: [],
    reporting_period: null, ...partial,
  };
}

function addSource(target: ToolResult, ref: SourceRef): string {
  if (!target.sources.some((existing) => existing.key === ref.key)) target.sources.push(ref);
  return ref.key;
}

function istToday(now: Date) {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function ageDays(date: string, now: Date) {
  return Math.round((Date.parse(`${istToday(now)}T00:00:00Z`) - Date.parse(`${date.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

function shiftMonth(value: string, delta: number) {
  const [year, monthNumber] = value.split("-").map(Number);
  const index = year * 12 + (monthNumber - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function finalize(target: ToolResult): ToolResult {
  if (target.status === "ok" && !target.facts.length) target.status = "empty";
  return target;
}

type MonthlySnapshot = { reporting_month: string | null; rows: Json[]; varieties: string[]; methodology: string | null };

async function monthlySnapshot(ctx: ToolContext): Promise<MonthlySnapshot> {
  const body = await getJson(ctx, "/monthly-prices");
  const rows: Json[] = Array.isArray(body?.data) ? body.data : [];
  return { reporting_month: body?.reporting_month ?? null, rows, varieties: rows.map((row) => String(row.variety_name)), methodology: body?.methodology ?? null };
}

/** Exact, case-insensitive match for the official monthly and daily data, whose calculations stay exact-variety. */
function matchVariety(requested: string | undefined, available: string[]): string | undefined {
  if (!requested) return undefined;
  const wanted = requested.trim().toLowerCase();
  return available.find((name) => name.toLowerCase() === wanted);
}

/** Ignores case and spacing, so NEW RASHIEDI and NEWRASHIEDI are one label. */
const varietyKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * What a grower's word covers in cooperative feeds, most direct label first. MAMCOS quotes Rashi as RASHI EDI and
 * new-crop Rashi as NEW RASHIEDI. Each label is still shown and priced separately; nothing is averaged across labels.
 * Extend through review. TUMCOS's generic "areca" is deliberately not mapped to any grade.
 */
const COOPERATIVE_VARIETY_LABELS: Record<string, string[]> = {
  rashi: ["rashi", "rashiedi", "newrashiedi"],
  newrashi: ["newrashi", "newrashiedi"],
};

export function matchCooperativeVarieties(requested: string, available: string[]): string[] {
  const key = varietyKey(requested);
  const labels = COOPERATIVE_VARIETY_LABELS[key] ?? [key];
  return labels.flatMap((label) => available.filter((name) => varietyKey(name) === label));
}

const rupeeText = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/**
 * Highest and lowest within one source and label, among places reporting on the same latest date. Each source gets its
 * own line because prices from different sources are different measures, and older quotes are not ranked against newer.
 */
function rankingLine(language: Language, source: string, variety: string, rows: { place: string; date: string; price: number }[]): string | null {
  if (!rows.length) return null;
  const date = rows.map((row) => row.date).sort().at(-1)!;
  const sameDay = rows.filter((row) => row.date === date).sort((a, b) => b.price - a.price);
  const high = sameDay[0], low = sameDay.at(-1)!;
  const older = rows.length - sameDay.length;
  if (language === "kn") {
    const body = sameDay.length === 1
      ? `ಆ ದಿನ ${high.place} ಮಾತ್ರ ವರದಿ ಮಾಡಿದೆ, ರೂ. ${rupeeText(high.price)}/ಕ್ವಿಂಟಾಲ್`
      : `ಹೆಚ್ಚಿನ ಬೆಲೆ ${high.place} ರೂ. ${rupeeText(high.price)}/ಕ್ವಿಂಟಾಲ್, ಕಡಿಮೆ ಬೆಲೆ ${low.place} ರೂ. ${rupeeText(low.price)}/ಕ್ವಿಂಟಾಲ್ (${sameDay.length} ವರದಿಗಳು)`;
    return `${source} ${variety}, ${date}: ${body}.${older ? ` ಹಿಂದಿನ ದಿನಾಂಕದ ${older} ವರದಿಗಳನ್ನು ಹೋಲಿಸಿಲ್ಲ.` : ""}`;
  }
  const body = sameDay.length === 1
    ? `only ${high.place} reported that day, INR ${rupeeText(high.price)}/quintal`
    : `highest ${high.place} at INR ${rupeeText(high.price)}/quintal, lowest ${low.place} at INR ${rupeeText(low.price)}/quintal (${sameDay.length} reporting that day)`;
  return `${source} ${variety}, ${date}: ${body}.${older ? ` ${older} that last reported earlier are not ranked.` : ""}`;
}

function resolveVariety(target: ToolResult, requested: string | undefined, available: string[]): string | null {
  if (!requested) {
    target.assumptions.push(`No variety was named; ANI's default reference variety "${DEFAULT_VARIETY}" is shown. Ask about another variety by name.`);
    return matchVariety(DEFAULT_VARIETY, available) ?? DEFAULT_VARIETY;
  }
  const match = matchVariety(requested, available);
  if (!match) {
    target.missing.push(`AGMARKNET monthly data has no variety named "${requested}". Reported varieties: ${available.slice(0, 30).join(", ") || "none"}.`);
    return null;
  }
  return match;
}

function monthlySource(target: ToolResult, row: Json): string {
  return addSource(target, {
    key: `agmarknet-monthly:${row.reporting_month}`, kind: "data", label: `AGMARKNET monthly variety-wise prices, Karnataka, ${row.reporting_month}`,
    publisher: AGMARKNET, url: row.source_url ?? null, reporting_period: row.reporting_month, retrieved_at: row.fetched_at ?? null,
  });
}

// ------------------------------------------------------------------------------------------------
// Price tools

type CooperativeView = {
  maxBranches: number;
  /** A price question about a named place shows only that place's branches. A comparison keeps every branch. */
  onlyNamedPlaces: boolean;
  /** Add the highest and lowest branch for each label. */
  rank: boolean;
};

async function cooperativeLatest(ctx: ToolContext, target: ToolResult, sourceKey: "mamcos" | "tss" | "tumcos", requested: string, now: Date, view: CooperativeView) {
  const label = COOP_LABEL[sourceKey];
  const overview = await getJson(ctx, `/cooperative/prices?source=${sourceKey}`);
  const varieties: string[] = overview?.varieties ?? [];
  const matches = matchCooperativeVarieties(requested, varieties);
  if (!matches.length) {
    const blocked = overview?.publication?.blocked_reason;
    target.missing.push(varieties.length
      ? `${label}: no verified quotation uses the variety name "${requested}". ${label} reports: ${varieties.slice(0, 15).join(", ")}.`
      : `${label}: no verified quotations are published.${blocked ? ` ${blocked}` : ""}`);
    return;
  }
  const namedPlaces = placesIn(ctx.question).filter((place) => place.level === "local");
  for (const variety of matches) {
    const body = variety === overview?.variety ? overview : await getJson(ctx, `/cooperative/prices?source=${sourceKey}&variety=${encodeURIComponent(variety)}`);
    const all: Json[] = body?.latest_by_branch ?? [];
    if (!all.length) {
      target.missing.push(`${label}: no verified quotations for ${variety}.`);
      continue;
    }
    const atNamed = all.filter((row) => namedPlaces.some((place) => namesPlace(String(row.branch), place)));
    const others = all.filter((row) => !atNamed.includes(row));
    const rows = view.onlyNamedPlaces && atNamed.length ? atNamed : [...atNamed, ...others].slice(0, view.maxBranches);
    if (namedPlaces.length && !atNamed.length) target.missing.push(`${label} ${variety}: no quotation for ${namedPlaces.map((place) => place.name).join(", ")}. ${label} branches elsewhere are shown.`);
    if (varietyKey(variety) !== varietyKey(requested)) target.assumptions.push(`${label} reports this as "${variety}", shown here for "${requested}".`);
    if (body?.permission?.label) target.limitations.push(`${label} reuse status: ${body.permission.label}.`);
    if (rows.some((row) => row.unit_status === "assumed")) target.assumptions.push(`${label} prices are treated as INR/quintal by operator decision; the source does not confirm that unit.`);
    for (const row of rows) {
      const key = addSource(target, {
        key: `${sourceKey}:${row.reporting_date}`, kind: "data", label: `${label} published market rates, ${row.reporting_date}`,
        publisher: body?.permission?.operator ?? label, url: row.source_url ?? null, reporting_period: row.reporting_date, retrieved_at: row.fetched_at ?? null,
      });
      target.facts.push({
        label: `${label} ${row.branch} – ${row.variety} branch average`, value: row.average_price, unit: row.price_unit ?? "INR/quintal",
        basis: row.price_basis ?? "COOPERATIVE_AVERAGE", reporting_period: row.reporting_date, source_key: key, source_name: label,
        note: row.minimum_price != null && row.maximum_price != null ? `range ${row.minimum_price}–${row.maximum_price}` : null,
      });
    }
    if (view.rank) {
      const line = rankingLine(ctx.language, label, variety, rows.flatMap((row) => typeof row.average_price === "number" ? [{ place: String(row.branch), date: String(row.reporting_date), price: row.average_price as number }] : []));
      if (line) (target.highlights ??= []).push(line);
    } else {
      for (const row of atNamed) {
        if (typeof row.average_price !== "number") continue;
        (target.highlights ??= []).push(ctx.language === "kn"
          ? `${label} ${row.branch} ${row.variety}, ${row.reporting_date}: ರೂ. ${rupeeText(row.average_price)}/ಕ್ವಿಂಟಾಲ್ (ಶಾಖೆಯ ಸರಾಸರಿ).`
          : `${label} ${row.branch} ${row.variety}, ${row.reporting_date}: INR ${rupeeText(row.average_price)}/quintal (branch average).`);
      }
    }
    const latest = rows.map((row) => row.reporting_date as string).sort().at(-1)!;
    if (ageDays(latest, now) > STALE_DAYS) target.uncertainty.push(`${label} latest verified quotation is from ${latest} (${ageDays(latest, now)} days old).`);
    if (body?.reference_price != null && !(view.onlyNamedPlaces && atNamed.length)) {
      target.facts.push({
        label: `${label} median of branch averages – ${variety}`, value: body.reference_price, unit: "INR/quintal", basis: "COOPERATIVE_AVERAGE",
        reporting_period: body.latest_reporting_date, source_key: target.sources.at(-1)!.key, source_name: label,
        note: `Median across at least ${body.minimum_branch_coverage} branches; not an APMC modal price.`,
      });
    }
  }
}

async function getCurrentPrices(ctx: ToolContext, args: ToolArgs<"get_current_prices">): Promise<ToolResult> {
  const now = ctx.now ?? new Date();
  const target = result("get_current_prices", args, "Current prices by source");
  const monthly = await monthlySnapshot(ctx);
  const variety = args.variety ? matchVariety(args.variety, monthly.varieties) ?? args.variety : (resolveVariety(target, undefined, monthly.varieties) ?? DEFAULT_VARIETY);
  const sources = args.source ? [args.source] : (["agmarknet", "mamcos", "tss", "tumcos"] as const);

  if (sources.includes("agmarknet")) {
    const params = new URLSearchParams({ variety, limit: "12", include_count: "false" });
    if (args.district) params.set("district", args.district);
    const daily = await getJson(ctx, `/prices?${params}`);
    const rows: Json[] = daily?.data ?? [];
    const latestDate = rows[0]?.reporting_date;
    const latestRows = rows.filter((row) => row.reporting_date === latestDate).slice(0, 8);
    for (const row of latestRows) {
      const key = addSource(target, {
        key: `agmarknet-daily:${row.reporting_date}`, kind: "data", label: `AGMARKNET daily mandi prices (data.gov.in), ${row.reporting_date}`,
        publisher: row.source_name ?? AGMARKNET, url: "https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070",
        reporting_period: row.reporting_date, retrieved_at: row.platform_fetch_timestamp ?? null,
      });
      target.facts.push({
        label: `${row.market_name}${row.district ? ` (${row.district})` : ""} – ${row.variety_name} modal price`, value: row.modal_price,
        unit: row.price_unit ?? "INR/quintal", basis: row.price_basis ?? "APMC_MODAL", reporting_period: row.reporting_date, source_key: key, source_name: "AGMARKNET daily",
        note: row.minimum_price != null && row.maximum_price != null ? `range ${row.minimum_price}–${row.maximum_price}` : null,
      });
    }
    if (!latestRows.length) target.missing.push(`AGMARKNET daily: no verified Karnataka observations for "${variety}"${args.district ? ` in ${args.district}` : ""}.`);
    else if (ageDays(latestDate, now) > STALE_DAYS) target.uncertainty.push(`Latest AGMARKNET daily observation is from ${latestDate} (${ageDays(latestDate, now)} days old).`);

    const row = monthly.rows.find((candidate) => candidate.variety_name === variety);
    if (row && row.weighted_price != null) {
      target.facts.push({
        label: `Karnataka monthly arrival-weighted modal price – ${variety}`, value: row.weighted_price, unit: row.price_unit ?? "INR/quintal",
        basis: MONTHLY_BASIS, reporting_period: row.reporting_month, source_key: monthlySource(target, row), source_name: "AGMARKNET monthly",
        note: args.district ? `State monthly average for all Karnataka, not a ${args.district} or daily market quotation.` : "State monthly average, not a daily market quotation.",
      });
      if (args.district && !latestRows.length) target.assumptions.push(`No ${args.district}-specific daily quotation was available, so the Karnataka state monthly average is shown; it is not a ${args.district} price.`);
    } else target.missing.push(`AGMARKNET monthly: no ${monthly.reporting_month ?? "recent"} Karnataka value for "${variety}".`);
  }
  for (const key of sources) {
    if (key !== "agmarknet") await cooperativeLatest(ctx, target, key, args.variety ?? variety, now, { maxBranches: 6, onlyNamedPlaces: true, rank: false });
  }
  target.limitations.push("Each value keeps its source and price basis. APMC modal prices, state monthly averages and cooperative branch averages are different measures and are never combined or averaged together.");
  target.reporting_period = target.facts.map((fact) => fact.reporting_period).filter(Boolean).sort().at(-1) ?? null;
  target.summary = target.facts.length
    ? `${target.facts.length} verified price value(s) for ${variety} from ${new Set(target.facts.map((fact) => fact.basis)).size} price basis/bases.`
    : `No verified current price is available for ${variety}.`;
  return finalize(target);
}

async function getHistoricalPrices(ctx: ToolContext, args: ToolArgs<"get_historical_prices">): Promise<ToolResult> {
  const target = result("get_historical_prices", args, "Monthly price history");
  const monthly = await monthlySnapshot(ctx);
  const variety = resolveVariety(target, args.variety, monthly.varieties);
  if (!variety || !monthly.reporting_month) {
    target.status = "empty";
    target.summary = "No monthly history is available for the requested variety.";
    return target;
  }
  const latest = monthly.reporting_month;
  let to = args.to_month && args.to_month < latest ? args.to_month : latest;
  let from = args.from_month ?? shiftMonth(to, -23);
  if (from > to) [from, to] = [to, from];
  if (from < shiftMonth(to, -239)) from = shiftMonth(to, -239);
  if (!args.from_month && !args.to_month) target.assumptions.push(`No period was named; the 24 months ending ${to} are shown.`);
  if (args.to_month && args.to_month > latest) target.missing.push(`Monthly data is published only through ${latest}; later months are not yet available.`);
  const body = await getJson(ctx, `/history/monthly?${new URLSearchParams({ variety, from, to })}`);
  const points: Json[] = (body?.points ?? []).filter((point: Json) => point.weighted_price != null);
  if (!points.length) {
    target.status = "empty";
    target.missing.push(`No observed months for ${variety} between ${from} and ${to}.`);
    target.summary = target.missing.at(-1)!;
    return target;
  }
  const last = points.at(-1);
  const key = addSource(target, {
    key: `agmarknet-monthly-history:${variety}:${from}:${to}`, kind: "data",
    label: `AGMARKNET monthly variety-wise prices, Karnataka, ${variety}, ${points[0].reporting_month} to ${last.reporting_month} (one report per month)`,
    publisher: AGMARKNET, url: last.source_url ?? null, reporting_period: `${points[0].reporting_month} to ${last.reporting_month}`, retrieved_at: last.fetched_at ?? null,
  });
  const unit = last.price_unit ?? "INR/quintal";
  const push = (label: string, value: number | null, period: string, note: string | null = null, factUnit: string | null = unit) => {
    if (value != null && Number.isFinite(value)) target.facts.push({ label, value: round2(value), unit: factUnit, basis: factUnit === unit ? MONTHLY_BASIS : null, reporting_period: period, source_key: key, note });
  };
  const max = points.reduce((best, point) => (point.weighted_price > best.weighted_price ? point : best));
  const min = points.reduce((best, point) => (point.weighted_price < best.weighted_price ? point : best));
  push(`${variety} monthly price, first month in range`, points[0].weighted_price, points[0].reporting_month);
  push(`${variety} monthly price, latest month`, last.weighted_price, last.reporting_month);
  push(`Highest month in range`, max.weighted_price, max.reporting_month);
  push(`Lowest month in range`, min.weighted_price, min.reporting_month);
  push(`3-month rolling mean (latest)`, last.rolling_3, last.reporting_month);
  push(`12-month rolling mean (latest)`, last.rolling_12, last.reporting_month);
  push(`Year-on-year change (latest)`, last.yoy_percent, last.reporting_month, null, "%");
  push(`Annualised volatility of monthly log returns (latest)`, last.volatility_percent, last.reporting_month, null, "%");
  target.reporting_period = `${points[0].reporting_month} to ${last.reporting_month}`;
  const expected = Number(body?.expected_months ?? points.length), observed = Number(body?.observed_months ?? points.length);
  if (observed < expected) target.missing.push(`${expected - observed} of ${expected} months in the range have no published value; they are not filled or interpolated.`);
  const flagged = points.filter((point) => (point.review_flags ?? []).length);
  if (flagged.length) target.uncertainty.push(`${flagged.length} month(s) carry review flags for unusual month-to-month changes: ${flagged.map((point) => point.reporting_month).slice(0, 6).join(", ")}.`);
  if (body?.methodology) target.limitations.push(body.methodology);
  target.summary = `${observed} observed month(s) of ${variety} prices from ${points[0].reporting_month} to ${last.reporting_month}.`;
  return finalize(target);
}

async function compareMarkets(ctx: ToolContext, args: ToolArgs<"compare_markets">): Promise<ToolResult> {
  const now = ctx.now ?? new Date();
  const target = result("compare_markets", args, "Market comparison (within one source)");
  const monthly = await monthlySnapshot(ctx);
  const variety = args.variety ? matchVariety(args.variety, monthly.varieties) ?? args.variety : (resolveVariety(target, undefined, monthly.varieties) ?? DEFAULT_VARIETY);
  if (!args.source || args.source === "agmarknet") {
    const body = await getJson(ctx, `/analytics/market-comparison?${new URLSearchParams({ variety })}`);
    const rows: Json[] = (body?.data ?? []).slice(0, 12);
    for (const row of rows) {
      const key = addSource(target, {
        key: `agmarknet-daily:${row.reporting_date}`, kind: "data", label: `AGMARKNET daily mandi prices (data.gov.in), ${row.reporting_date}`,
        publisher: row.source_name ?? AGMARKNET, url: "https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070",
        reporting_period: row.reporting_date, retrieved_at: row.platform_fetch_timestamp ?? null,
      });
      target.facts.push({ label: `AGMARKNET ${row.market_name} – ${row.variety_name} latest modal price`, value: row.modal_price, unit: row.price_unit ?? "INR/quintal",
        basis: row.price_basis ?? "APMC_MODAL", reporting_period: row.reporting_date, source_key: key, source_name: "AGMARKNET daily" });
    }
    const dailyLine = rankingLine(ctx.language, "AGMARKNET", variety, rows.flatMap((row) => typeof row.modal_price === "number" ? [{ place: String(row.market_name), date: String(row.reporting_date), price: row.modal_price as number }] : []));
    if (dailyLine) (target.highlights ??= []).push(dailyLine);
    const dates = new Set(rows.map((row) => row.reporting_date));
    if (dates.size > 1) target.uncertainty.push(`AGMARKNET markets reported on different dates (${[...dates].sort().join(", ")}); each value is that market's latest verified day.`);
    if (!rows.length) target.missing.push(`AGMARKNET daily: no verified market observations for "${variety}" in Karnataka.`);
  }
  const coop = args.source && args.source !== "agmarknet" ? [args.source] : args.source ? [] : (["mamcos", "tss", "tumcos"] as const);
  for (const key of coop) await cooperativeLatest(ctx, target, key, args.variety ?? variety, now, { maxBranches: 15, onlyNamedPlaces: false, rank: true });
  target.limitations.push("Markets are compared only within the same source and price basis. AGMARKNET modal prices and cooperative branch averages are not ranked against each other.");
  target.reporting_period = target.facts.map((fact) => fact.reporting_period).filter(Boolean).sort().at(-1) ?? null;
  target.summary = target.facts.length ? `${target.facts.length} market/branch value(s) for ${variety}, grouped by source.` : `No comparable market values exist for ${variety}.`;
  return finalize(target);
}

async function getMarketIndex(ctx: ToolContext, args: ToolArgs<"get_market_index">): Promise<ToolResult> {
  const target = result("get_market_index", args, "ANI reference index");
  const monthly = await monthlySnapshot(ctx);
  const variety = args.variety ? matchVariety(args.variety, monthly.varieties) ?? args.variety : (resolveVariety(target, undefined, monthly.varieties) ?? DEFAULT_VARIETY);
  const body = await getJson(ctx, `/analytics/reference-index?${new URLSearchParams({ variety })}`);
  const rows: Json[] = body?.data ?? [];
  if (body?.methodology) target.limitations.push(body.methodology);
  const key = addSource(target, { key: `ani-reference-index:${variety}`, kind: "data", label: `ANI reference index from verified AGMARKNET daily modal prices, ${variety}`,
    publisher: "ArecaNut Intelligence (derived from AGMARKNET)", url: null, reporting_period: rows.at(-1)?.reporting_date ?? null, retrieved_at: null });
  for (const row of rows.slice(-2).reverse()) {
    target.facts.push({ label: `Reference index – ${variety}`, value: row.median_modal_price, unit: "INR/quintal", basis: "APMC_MODAL_MEDIAN",
      reporting_period: row.reporting_date, source_key: key, source_name: "ANI reference index", note: `${row.market_count} verified markets` });
  }
  if (!rows.length) {
    target.sources = [];
    target.missing.push(`No date has at least ${body?.minimum_market_coverage ?? 3} verified AGMARKNET markets reporting "${variety}", so the reference index is withheld.`);
  }
  target.reporting_period = rows.at(-1)?.reporting_date ?? null;
  target.summary = rows.length ? `Latest reference index for ${variety} is from ${rows.at(-1).reporting_date}.` : target.missing.at(-1)!;
  return finalize(target);
}

async function getPriceForecast(ctx: ToolContext, args: ToolArgs<"get_price_forecast">): Promise<ToolResult> {
  const target = result("get_price_forecast", args, "Price forecast (reference estimate)");
  const monthly = await monthlySnapshot(ctx);
  const variety = resolveVariety(target, args.variety, monthly.varieties);
  if (!variety) {
    target.status = "empty";
    target.summary = "No forecast exists for the requested variety.";
    return target;
  }
  const body = await getJson(ctx, `/forecasts?${new URLSearchParams({ variety })}`).catch((error) => {
    if (error instanceof ToolHttpError && error.status === 404) return null;
    throw error;
  });
  const results = body?.snapshot?.results;
  const evaluation = results?.evaluation;
  const forecast = body?.forecast;
  const key = addSource(target, {
    key: `ani-forecast:${variety}`, kind: "data", label: `ANI monthly forecast evaluation (${results?.formula_version ?? "monthly baselines"}), ${variety}`,
    publisher: "ArecaNut Intelligence (from AGMARKNET monthly prices)", url: null,
    reporting_period: results?.history ? `history ${results.history.from} to ${results.history.through}` : null, retrieved_at: body?.snapshot?.evaluated_at ?? null,
  });
  const status: string = body?.status ?? "not_evaluated";
  if (forecast && (status === "published" || status === "stale")) {
    const label = evaluation?.label ?? forecast.model;
    target.facts.push({ label: `Reference estimate for ${forecast.reporting_month} (${label})`, value: round2(forecast.point), unit: results?.price_unit ?? "INR/quintal",
      basis: "FORECAST_REFERENCE_BASELINE", reporting_period: forecast.reporting_month, source_key: key,
      note: forecast.model === "last_value" ? "Equal to the latest observed monthly price; not a predicted change." : null });
    target.facts.push({ label: `${Math.round(forecast.nominal_coverage * 100)}% interval lower bound`, value: round2(forecast.lower), unit: results?.price_unit ?? "INR/quintal",
      basis: "FORECAST_INTERVAL", reporting_period: forecast.reporting_month, source_key: key });
    target.facts.push({ label: `${Math.round(forecast.nominal_coverage * 100)}% interval upper bound`, value: round2(forecast.upper), unit: results?.price_unit ?? "INR/quintal",
      basis: "FORECAST_INTERVAL", reporting_period: forecast.reporting_month, source_key: key });
    target.uncertainty.push(`Interval method: ${forecast.method}. Nominal coverage ${Math.round(forecast.nominal_coverage * 100)}%; the actual price can fall outside it.`);
    const holdout = evaluation?.holdout;
    if (holdout?.selected) {
      target.facts.push({ label: "Holdout mean absolute error (selected model)", value: round2(holdout.selected.mae), unit: results?.price_unit ?? "INR/quintal",
        basis: "EVALUATION_METRIC", reporting_period: `${holdout.selected.count} holdout months`, source_key: key });
      target.facts.push({ label: "Holdout MAE skill versus naive baseline", value: round2(holdout.mae_skill_vs_naive ?? 0), unit: "ratio", basis: "EVALUATION_METRIC",
        reporting_period: `${holdout.selected.count} holdout months`, source_key: key, note: "0 means no improvement over the naive last-value baseline." });
      if (holdout.covered != null) target.uncertainty.push(`In the ${holdout.selected.count}-month holdout, ${holdout.covered} actual value(s) fell inside the interval.`);
    }
  } else {
    target.missing.push(`No forecast is published for ${variety} (status: ${status}).${(results?.reasons ?? []).length ? ` Reasons: ${results.reasons.join("; ")}` : ""}${(body?.stale_reasons ?? []).length ? ` ${body.stale_reasons.join("; ")}` : ""}`);
  }
  if (status === "stale") target.uncertainty.push(`The forecast snapshot is stale: ${(body?.stale_reasons ?? []).join("; ")}`);
  for (const limitation of results?.limitations ?? []) target.limitations.push(limitation);
  target.limitations.push("ANI's monthly forecast is an experimental reference baseline without demonstrated predictive improvement. It does not predict whether prices will rise or fall.");

  const predictions = await getJson(ctx, `/forecasting/predictions?${new URLSearchParams({ series_id: `KA|${variety}` })}`).catch(() => null);
  const rows: Json[] = (predictions?.data ?? []).filter((row: Json) => row.actual_value == null).slice(0, 3);
  if (rows.length) {
    const experiment = addSource(target, { key: `ani-forecasting-engine:${variety}`, kind: "data", label: `ANI forecasting engine experiment ${predictions.experiment_id ?? ""}`.trim(),
      publisher: "ArecaNut Intelligence forecasting engine", url: null, reporting_period: `origin ${rows[0].origin_period}`, retrieved_at: rows[0].forecast_created_at ?? null });
    for (const row of rows) {
      target.facts.push({ label: `Engine ${row.model} median, horizon ${row.horizon} (${row.publication})`, value: round2(row.median), unit: row.unit ?? "INR/quintal",
        basis: row.price_basis ?? MONTHLY_BASIS, reporting_period: row.target_period, source_key: experiment,
        note: `${row.interval_level}% interval ${round2(row.lower_bound)}–${round2(row.upper_bound)}` });
    }
    if (rows.every((row) => row.publication !== "validated")) target.uncertainty.push("No forecasting-engine model has passed the validation rule; engine values are reference baselines only.");
  }
  target.reporting_period = forecast?.reporting_month ?? null;
  target.summary = forecast ? `Reference estimate for ${variety}, ${forecast.reporting_month}, with interval and evaluation.` : target.missing.at(-1) ?? "No forecast available.";
  return finalize(target);
}

// ------------------------------------------------------------------------------------------------
// Supply, trade, weather and advisory tools

async function getMarketArrivals(ctx: ToolContext, args: ToolArgs<"get_market_arrivals">): Promise<ToolResult> {
  const target = result("get_market_arrivals", args, "Market arrivals");
  const params = new URLSearchParams({ granularity: args.granularity ?? "weekly" });
  if (args.district) params.set("district", args.district);
  const body = await getJson(ctx, `/supply/arrivals?${params}`);
  for (const batch of body?.sources ?? []) {
    addSource(target, { key: `arrivals:${batch.id}`, kind: "data", label: `${batch.source_name ?? batch.source_key} arrivals import ${batch.file_name ?? ""}`.trim(),
      publisher: batch.source_name ?? batch.source_key, url: batch.source_url ?? null, reporting_period: null, retrieved_at: batch.imported_at ?? null });
  }
  const sourceKey = target.sources[0]?.key;
  for (const measure of ["arrival", "traded"] as const) {
    const rows: Json[] = body?.measures?.[measure] ?? [];
    for (const row of rows.slice(-4).reverse()) {
      if (!sourceKey) break;
      target.facts.push({ label: `${measure === "arrival" ? "Arrivals" : "Traded quantity"} (${body.granularity} bucket ${row.bucket})`, value: row.quantity_tonnes,
        unit: "tonnes", basis: measure === "arrival" ? "ARRIVAL_QUANTITY" : "TRADED_QUANTITY", reporting_period: `${row.first_date} to ${row.last_date}`,
        source_key: sourceKey, note: `${row.markets_reporting} market(s), ${row.reporting_days} reporting day(s)` });
    }
  }
  if (!target.facts.length) target.missing.push(body?.message ?? "No arrival records are available.");
  if (body?.forecast?.reason) target.uncertainty.push(`Arrival forecast ${body.forecast.status}: ${body.forecast.reason}`);
  for (const note of body?.notes ?? []) target.limitations.push(note);
  target.reporting_period = body?.reporting_period ? `${body.reporting_period.from} to ${body.reporting_period.to}` : null;
  target.summary = target.facts.length ? `Arrival and traded quantities for ${target.reporting_period}, kept as separate measures.` : target.missing.at(-1)!;
  return finalize(target);
}

async function getProductionStatistics(ctx: ToolContext, args: ToolArgs<"get_production_statistics">): Promise<ToolResult> {
  const target = result("get_production_statistics", args, "Production statistics");
  const geography = args.geography ?? "Karnataka";
  if (!args.geography) target.assumptions.push("No geography was named; Karnataka is shown with the All-India comparison.");
  const body = await getJson(ctx, `/supply/production?${new URLSearchParams({ geography })}`);
  const rows: Json[] = body?.current ?? [];
  const unit = body?.unit ?? {};
  const sourceFor = (row: Json) => addSource(target, {
    key: `production:${row.source_url}`, kind: "data", label: `${row.publisher}${row.estimate_label ? ` – ${row.estimate_label} estimates` : ""}`,
    publisher: row.publisher, url: row.source_url ?? null, reporting_period: row.reporting_year,
    retrieved_at: row.recorded_at ?? null, publication_date: row.publication_date ?? null,
  });
  for (const row of rows.slice(-2).reverse()) {
    const key = sourceFor(row);
    const note = `${row.estimate_label}${row.publication_date ? `, published ${row.publication_date}` : ""}`;
    target.facts.push({ label: `${row.geography} production ${row.reporting_year}`, value: row.production_thousand_tonnes, unit: unit.production ?? "thousand tonnes", basis: row.estimate_type, reporting_period: row.reporting_year, source_key: key, note });
    target.facts.push({ label: `${row.geography} area ${row.reporting_year}`, value: row.area_thousand_hectares, unit: unit.area ?? "thousand hectares", basis: row.estimate_type, reporting_period: row.reporting_year, source_key: key, note });
    target.facts.push({ label: `${row.geography} yield ${row.reporting_year}`, value: row.yield_kg_hectare, unit: unit.yield ?? "kg/hectare", basis: row.estimate_type, reporting_period: row.reporting_year, source_key: key, note });
  }
  const comparison: Json = (body?.comparison_current ?? []).at(-1);
  if (comparison) target.facts.push({ label: `${comparison.geography} production ${comparison.reporting_year}`, value: comparison.production_thousand_tonnes,
    unit: unit.production ?? "thousand tonnes", basis: comparison.estimate_type, reporting_period: comparison.reporting_year, source_key: sourceFor(comparison), note: comparison.estimate_label });
  const share: Json = (body?.share_of_comparison ?? []).at(-1);
  if (share && share.percent != null && rows.length) target.facts.push({ label: `${geography} share of ${body.comparison_geography} production ${share.reporting_year}`, value: share.percent,
    unit: "%", basis: null, reporting_period: share.reporting_year, source_key: sourceFor(rows.at(-1)), note: share.note });
  const cagr = body?.growth?.production?.cagr;
  if (cagr?.percent != null && rows.length) {
    target.facts.push({ label: `Production compound annual growth ${cagr.from} to ${cagr.to}`, value: cagr.percent, unit: "%", basis: null,
      reporting_period: `${cagr.from} to ${cagr.to}`, source_key: sourceFor(rows.at(-1)), note: cagr.mixed_estimate_types ? "spans different estimate stages" : null });
    if (cagr.mixed_estimate_types) target.uncertainty.push("Growth rates compare different estimate stages (advance vs final); advance estimates are commonly revised.");
  }
  if (rows.some((row) => row.estimate_type?.includes("advance"))) target.uncertainty.push("The latest year is an advance estimate and may be revised in later DASD releases.");
  const revised = (body?.revisions ?? []).length;
  if (revised) target.uncertainty.push(`${revised} revision record(s) exist for this geography; current values use the most mature estimate stage.`);
  if (body?.districts?.message) target.missing.push(body.districts.message);
  if (body?.forecast?.reason) target.missing.push(`Production forecast suppressed: ${body.forecast.reason}`);
  for (const note of body?.notes ?? []) target.limitations.push(note);
  target.reporting_period = body?.reporting_period ? `${body.reporting_period.from} to ${body.reporting_period.to}` : null;
  target.summary = rows.length ? `${geography} production statistics for ${target.reporting_period}.` : body?.message ?? `No production records for ${geography}.`;
  if (!rows.length) target.missing.push(target.summary);
  return finalize(target);
}

async function getTradeStatistics(ctx: ToolContext, args: ToolArgs<"get_trade_statistics">): Promise<ToolResult> {
  const target = result("get_trade_statistics", args, "Trade statistics");
  const body = await getJson(ctx, "/intelligence/trade");
  const all: Json[] = (body?.data ?? []).filter((row: Json) => !args.direction || String(row.direction).toLowerCase() === args.direction);
  const latest = all.map((row) => String(row.period)).sort().at(-1);
  const rows = all.filter((row) => row.period === latest)
    .sort((a, b) => Number(b.quantity_tonnes ?? 0) - Number(a.quantity_tonnes ?? 0)).slice(0, 8);
  for (const row of rows) {
    const key = addSource(target, { key: `trade:${row.source_url}:${row.period}`, kind: "data", label: `${row.source_key === "trade_imports" ? "DASD import statistics" : "PIB export release"}, ${row.period}`,
      publisher: row.source_key === "trade_imports" ? "Directorate of Arecanut and Spices Development (DASD) / Department of Commerce" : "Press Information Bureau", url: row.source_url ?? null, reporting_period: row.period, retrieved_at: row.fetched_at ?? null });
    target.facts.push({ label: `${row.direction} ${row.partner} quantity`, value: row.quantity_tonnes, unit: "tonnes", basis: row.direction, reporting_period: row.period, source_key: key });
    if (row.value_inr_lakh != null) target.facts.push({ label: `${row.direction} ${row.partner} value`, value: row.value_inr_lakh, unit: "INR lakh", basis: row.direction, reporting_period: row.period, source_key: key });
  }
  if (!rows.length) target.missing.push(`No ${args.direction ?? "trade"} statistics are stored.`);
  if (body?.coverage) target.limitations.push(body.coverage);
  target.reporting_period = latest ?? null;
  target.summary = rows.length ? `Trade quantities and values for ${latest}.` : target.missing.at(-1)!;
  return finalize(target);
}

async function getWeather(ctx: ToolContext, args: ToolArgs<"get_weather">): Promise<ToolResult> {
  const target = result("get_weather", args, "Weather");
  const params = new URLSearchParams();
  if (args.district) params.set("district", args.district);
  else target.assumptions.push("No district was named; the API default district is shown.");
  const body = await getJson(ctx, `/supply/weather?${params}`);
  const district = body?.district ?? args.district;
  const labels: Record<string, string> = body?.data_types ?? {};
  const history: Json[] = body?.history ?? [];
  const sourceFor = (row: Json, kind: string) => addSource(target, { key: `weather:${row.provider}:${row.data_type}:${kind}`, kind: "data",
    label: `${row.provider} – ${labels[row.data_type] ?? row.data_type}`, publisher: row.provider, url: row.source_url ?? null,
    reporting_period: null, retrieved_at: row.retrieved_at ?? row.issued_at ?? null });
  const byType = new Map<string, Json[]>();
  history.forEach((row) => byType.set(row.data_type, [...(byType.get(row.data_type) ?? []), row]));
  for (const [type, rows] of byType) {
    const recent = rows.slice(-7);
    const key = sourceFor(recent.at(-1), "history");
    const period = `${recent[0].day} to ${recent.at(-1).day}`;
    target.sources.find((source) => source.key === key)!.reporting_period = period;
    const rain = recent.filter((row) => row.rainfall_mm != null);
    if (rain.length) target.facts.push({ label: `Rainfall total, last ${rain.length} day(s) (${labels[type] ?? type})`, value: round2(rain.reduce((sum, row) => sum + row.rainfall_mm, 0)),
      unit: "mm", basis: type, reporting_period: period, source_key: key });
    const last = recent.at(-1);
    if (last.temperature_max_c != null) target.facts.push({ label: `Maximum temperature (${labels[type] ?? type})`, value: last.temperature_max_c, unit: "°C", basis: type, reporting_period: last.day, source_key: key });
    if (last.temperature_min_c != null) target.facts.push({ label: `Minimum temperature (${labels[type] ?? type})`, value: last.temperature_min_c, unit: "°C", basis: type, reporting_period: last.day, source_key: key });
    if (last.relative_humidity_pct != null) target.facts.push({ label: `Relative humidity (${labels[type] ?? type})`, value: last.relative_humidity_pct, unit: "%", basis: type, reporting_period: last.day, source_key: key });
  }
  for (const [kind, rows] of [["model forecast", body?.forecasts?.model ?? []], ["official forecast", body?.forecasts?.official ?? []]] as [string, Json[]][]) {
    const upcoming = rows.slice(0, 5);
    if (!upcoming.length) continue;
    const key = sourceFor(upcoming[0], kind);
    const period = `${upcoming[0].target_date} to ${upcoming.at(-1).target_date}`;
    target.sources.find((source) => source.key === key)!.reporting_period = period;
    const rain = upcoming.filter((row) => row.rainfall_mm != null);
    if (rain.length) target.facts.push({ label: `Forecast rainfall total, ${rain.length} day(s) (${kind})`, value: round2(rain.reduce((sum, row) => sum + row.rainfall_mm, 0)),
      unit: "mm", basis: upcoming[0].data_type, reporting_period: period, source_key: key, note: `issued ${upcoming[0].issued_at}` });
  }
  for (const warning of (body?.warnings ?? []).slice(0, 3)) {
    const key = addSource(target, { key: `weather-warning:${warning.provider}:${warning.issued_at}`, kind: "data", label: `${warning.provider} district warning`,
      publisher: warning.provider, url: warning.source_url ?? null, reporting_period: `${warning.valid_from} to ${warning.valid_to}`, retrieved_at: warning.issued_at });
    target.facts.push({ label: `Warning (${warning.warning_level})`, value: warning.phenomena, unit: null, basis: "official_warning", reporting_period: `${warning.valid_from} to ${warning.valid_to}`, source_key: key });
  }
  const freshness = body?.freshness?.model_capture;
  if (freshness?.status && freshness.status !== "fresh" && freshness.latest) target.uncertainty.push(`Model weather capture is ${freshness.status} (latest ${freshness.latest}).`);
  if (Object.keys(labels).length) target.limitations.push(`Dataset types: ${Object.entries(labels).map(([type, label]) => `${type} = ${label}`).join("; ")}. Model-grid values are not physical station observations.`);
  if (!target.facts.length) target.missing.push(body?.message ?? `No weather records for ${district}.`);
  for (const note of body?.notes ?? []) target.limitations.push(note);
  target.reporting_period = body?.reporting_period ? `${body.reporting_period.from} to ${body.reporting_period.to}` : null;
  target.summary = target.facts.length ? `Weather for ${district}, ${target.reporting_period ?? "forecast period"}.` : target.missing.at(-1)!;
  return finalize(target);
}

async function getAdvisories(ctx: ToolContext, args: ToolArgs<"get_advisories">): Promise<ToolResult> {
  const target = result("get_advisories", args, "Crop-risk advisories");
  const params = new URLSearchParams();
  if (args.district) params.set("district", args.district);
  const body = await getJson(ctx, `/supply/risk/advisories?${params}`);
  const key = addSource(target, { key: `advisories:${body?.district}:${body?.as_of}`, kind: "data", label: `ANI expert-reviewed crop-risk rules, ${body?.district}`,
    publisher: "ArecaNut Intelligence (expert-approved rules)", url: null, reporting_period: body?.as_of ?? null, retrieved_at: null });
  for (const advisory of body?.advisories ?? []) {
    target.facts.push({ label: `${advisory.hazard_name}`, value: advisory.level, unit: null, basis: "RULE_BASED_ADVISORY", reporting_period: body.as_of, source_key: key, note: advisory.message });
  }
  if (body?.rules) target.facts.push({ label: "Crop-risk rules awaiting expert review", value: body.rules.awaiting_review, unit: "rules", basis: null, reporting_period: body.as_of, source_key: key,
    note: `${body.rules.published} published` });
  if (body?.message) target.missing.push(body.message);
  if (body?.disclaimer) target.limitations.push(body.disclaimer);
  target.reporting_period = body?.as_of ?? null;
  target.summary = (body?.advisories ?? []).length ? `${body.advisories.length} advisory evaluation(s) for ${body.district} as of ${body.as_of}.` : body?.message ?? "No advisories.";
  return finalize(target);
}

// ------------------------------------------------------------------------------------------------
// Calculators (deterministic; the language model never computes)

type CalculationArgs = ToolArgs<"calculate_sell_hold">;

const signedPercent = (value: number) => `${value > 0 ? "+" : ""}${value}%`;

/** What happened in past years after this calendar month, so a sell-or-hold question gets an answer before any costs are entered. */
async function addHoldHistory(ctx: ToolContext, target: ToolResult, requested: string | undefined) {
  const now = ctx.now ?? new Date();
  const monthly = await monthlySnapshot(ctx);
  const variety = matchVariety(requested ?? DEFAULT_VARIETY, monthly.varieties);
  if (!variety) return;
  const body = await getJson(ctx, `/history/monthly?${new URLSearchParams({ variety, from: "2021-01" })}`);
  const startMonth = Number(istToday(now).slice(5, 7));
  const history = holdHistory(body?.points ?? [], startMonth, [3, 6]);
  const summaries = history.summaries.filter((summary) => summary.median_percent !== null);
  if (!summaries.length || !history.first_month || !history.last_month) return;
  const period = `${history.first_month} to ${history.last_month}`;
  const key = addSource(target, {
    key: `agmarknet-hold-history:${variety}:${startMonth}`, kind: "data", label: `AGMARKNET monthly variety-wise prices, Karnataka, ${variety}, ${period}`,
    publisher: AGMARKNET, url: "https://agmarknet.gov.in", reporting_period: period, retrieved_at: null,
  });
  const monthName = MONTH_NAMES_EN[startMonth - 1];
  for (const summary of summaries) {
    target.facts.push({ label: `${variety} Karnataka monthly average: median change ${summary.months} months after ${monthName}`, value: summary.median_percent, unit: "%", basis: "PAST_YEARS_CHANGE",
      reporting_period: period, source_key: key, note: `higher in ${summary.rose} of ${summary.years} years; range ${summary.lowest_percent}% to ${summary.highest_percent}%` });
  }
  (target.highlights ??= []).push(ctx.language === "kn"
    ? `${variety}, ಕರ್ನಾಟಕದ ತಿಂಗಳ ಸರಾಸರಿ, ${MONTH_NAMES_KN[startMonth - 1]} ತಿಂಗಳಿನಿಂದ: ${summaries.map((summary) => `${summary.months} ತಿಂಗಳ ನಂತರ ${summary.years} ವರ್ಷಗಳಲ್ಲಿ ${summary.rose} ಬಾರಿ ಬೆಲೆ ಹೆಚ್ಚಿತ್ತು (ಮಧ್ಯಮ ಬದಲಾವಣೆ ${signedPercent(summary.median_percent!)})`).join("; ")}. ಇದು ಸಂಗ್ರಹ, ಬಡ್ಡಿ ಮತ್ತು ತೂಕ ನಷ್ಟದ ಖರ್ಚಿಗೆ ಮೊದಲಿನ ಲೆಕ್ಕ.`
    : `${variety}, Karnataka monthly average, from ${monthName}: ${summaries.map((summary) => `${summary.months} months later it was higher in ${summary.rose} of ${summary.years} years (median change ${signedPercent(summary.median_percent!)})`).join("; ")}. This is before storage, interest and weight loss.`);
  target.uncertainty.push("Past years do not show what the price will do this year. These are state monthly averages, not a branch price, and the years shown are few.");
  if (history.excluded_months.length) target.uncertainty.push(`Left out because the price moved more than 20% for one month and straight back, which may be a data problem: ${history.excluded_months.join(", ")}.`);
}

async function calculate(ctx: ToolContext, tool: "calculate_net_realization" | "calculate_sell_hold", args: CalculationArgs): Promise<ToolResult> {
  const target = result(tool, args, tool === "calculate_sell_hold" ? "Sell now or hold" : "Net realization");
  const required: [keyof CalculationArgs, string][] = [
    ["quantity_quintals", "quantity in quintals"],
    ["commission_percent", "commission percentage"],
    ["transport_cost", "transport cost in INR"],
  ];
  if (tool === "calculate_sell_hold") required.push(
    ["hold_days", "holding period in days"], ["storage_cost", "total storage cost in INR"],
    ["annual_finance_percent", "annual finance/interest rate %"], ["weight_loss_percent", "expected weight loss % during storage"],
  );
  const missing = required.filter(([field]) => args[field] === undefined).map(([, label]) => label);
  let price: { kind: "manual"; value: number } | { kind: "monthly"; month: string; variety: string; refresh_run_id: string } | null = null;
  if (args.price !== undefined) {
    price = { kind: "manual", value: args.price };
    target.assumptions.push(`Sale price: INR ${args.price} per quintal, as stated in the question.`);
  } else if (args.variety) {
    const prices = await getJson(ctx, "/decisions/prices");
    const row = (prices?.monthly ?? []).find((candidate: Json) => String(candidate.variety_name).toLowerCase() === args.variety!.toLowerCase());
    if (row) {
      price = { kind: "monthly", month: row.reporting_month, variety: row.variety_name, refresh_run_id: row.refresh_run_id };
      target.assumptions.push(`Sale price: the latest AGMARKNET Karnataka monthly arrival-weighted price for ${row.variety_name} (${row.reporting_month}), because no price was stated. A specific market or day can differ.`);
    } else missing.push(`a sale price (no monthly price exists for "${args.variety}")`);
  } else missing.push("a sale price per quintal or a variety name");
  if (tool === "calculate_sell_hold") await addHoldHistory(ctx, target, args.variety);
  if (missing.length || !price) {
    target.status = "needs_input";
    target.missing.push(`To calculate, state: ${missing.join(", ")}. ANI does not assume costs you have not given.`);
    target.summary = target.missing[0];
    return target;
  }
  const otherSelling = args.other_selling_cost ?? 0;
  if (args.other_selling_cost === undefined) target.assumptions.push("No other selling costs (loading, cess, packing) were stated; they are taken as INR 0.");
  const body = {
    name: "assistant", quantity_quintals: args.quantity_quintals!, commission_percent: args.commission_percent!, transport_cost: args.transport_cost!,
    other_selling_cost: otherSelling,
    // Farm-profit inputs are not part of these tools; neutral values are sent and the related outputs are not reported.
    area_hectares: 1, production_cost: 0, byproduct_income: 0,
    hold_days: args.hold_days ?? 1, annual_finance_percent: args.annual_finance_percent ?? 0, storage_cost: args.storage_cost ?? 0,
    weight_loss_percent: args.weight_loss_percent ?? 0, scenario_price: args.scenario_price ?? (price.kind === "manual" ? price.value : 1),
    price,
  };
  const response = await getJson(ctx, "/decisions/calculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const snapshot = response.price, results = response.results;
  const key = addSource(target, snapshot.source_url
    ? { key: `calc-price:${snapshot.reference_id ?? snapshot.reporting_period}`, kind: "data", label: `${snapshot.source} ${snapshot.variety ?? ""} ${snapshot.reporting_period ?? ""}`.trim(),
      publisher: AGMARKNET, url: snapshot.source_url, reporting_period: snapshot.reporting_period, retrieved_at: snapshot.fetched_at }
    : { key: "calc-user-input", kind: "data", label: "Values stated in the question", publisher: null, url: null, reporting_period: null, retrieved_at: null });
  const formulaKey = addSource(target, { key: `formula:${response.formula_version}`, kind: "data", label: `ANI decision calculator (${response.formula_version})`,
    publisher: "ArecaNut Intelligence", url: null, reporting_period: null, retrieved_at: null });
  const inr = (label: string, value: number, note: string | null = null, source = formulaKey) =>
    target.facts.push({ label, value: round2(value), unit: "INR", basis: "CALCULATED", reporting_period: snapshot.reporting_period, source_key: source, note });
  target.facts.push({ label: "Sale price used", value: round2(snapshot.value), unit: "INR/quintal", basis: snapshot.price_type, reporting_period: snapshot.reporting_period, source_key: key });
  inr("Gross realization", results.gross_realization, `${args.quantity_quintals} quintals × price`);
  inr("Selling costs", results.selling_costs, `${args.commission_percent}% commission + transport ${args.transport_cost} + other ${otherSelling}`);
  inr("Net realization if sold now", results.net_realization);
  target.facts.push({ label: "Net realization per quintal", value: round2(results.net_per_quintal), unit: "INR/quintal", basis: "CALCULATED", reporting_period: snapshot.reporting_period, source_key: formulaKey });
  if (tool === "calculate_sell_hold") {
    target.assumptions.push(`Holding for ${args.hold_days} days with storage cost INR ${args.storage_cost}, finance at ${args.annual_finance_percent}% a year on the sell-now net value, and ${args.weight_loss_percent}% weight loss.`);
    target.facts.push({ label: "Break-even price needed after holding", value: round2(results.break_even_hold_price), unit: "INR/quintal", basis: "CALCULATED", reporting_period: snapshot.reporting_period, source_key: formulaKey,
      note: `${round2(results.break_even_increase_percent)}% above the price used` });
    inr("Finance cost of holding", results.finance_cost);
    inr("Net realization after holding if the price is unchanged", results.hold_unchanged_net_realization);
    inr("Difference versus selling now if the price is unchanged", results.hold_unchanged_advantage);
    if (args.scenario_price !== undefined) {
      target.assumptions.push(`Scenario price after holding: INR ${args.scenario_price} per quintal, as stated in the question. This is a user scenario, not a forecast.`);
      inr("Net realization after holding at the scenario price", results.hold_net_realization);
      inr("Difference versus selling now at the scenario price", results.hold_advantage);
    } else target.missing.push("No future price scenario was stated, so only the break-even price and the unchanged-price outcome are shown. ANI does not predict the future price.");
    target.uncertainty.push("Holding outcomes depend on the future price, which is unknown. The calculation does not recommend selling or holding.");
  }
  target.limitations.push("Formula: gross = quantity × price; selling costs = commission % × gross + transport + other selling costs; net = gross − selling costs.");
  target.reporting_period = snapshot.reporting_period ?? null;
  target.summary = `Net realization calculated with ${response.formula_version}.`;
  return finalize(target);
}

// ------------------------------------------------------------------------------------------------
// Search tools

async function searchIndustryNews(ctx: ToolContext, args: ToolArgs<"search_industry_news">): Promise<ToolResult> {
  const target = result("search_industry_news", args, "Official news and policy releases");
  const body = await getJson(ctx, "/intelligence/news");
  const rows: Json[] = body?.data ?? [];
  const terms = queryTerms(args.query).filter((term) => !["news", "latest", "recent", "policy", "government"].includes(term));
  const scored = rows.map((row) => {
    const title = String(row.title ?? "").toLowerCase();
    return { row, score: terms.filter((term) => title.includes(term)).length };
  });
  const wantsLatest = !terms.length;
  const relevant = (wantsLatest ? scored : scored.filter((item) => item.score > 0))
    .sort((a, b) => b.score - a.score || String(b.row.published_on).localeCompare(String(a.row.published_on))).slice(0, 5);
  if (wantsLatest) target.assumptions.push("No specific topic was detected; the most recent releases are listed.");
  relevant.forEach(({ row }) => {
    const key = addSource(target, { key: `news:${row.source_url}`, kind: "news", label: row.title, publisher: String(row.source_key).startsWith("dasd") ? "Directorate of Arecanut and Spices Development (DASD)" : "Press Information Bureau",
      url: row.source_url ?? null, reporting_period: row.published_on, retrieved_at: row.fetched_at ?? null, publication_date: row.published_on });
    target.facts.push({ label: row.is_policy ? "Policy release" : "News release", value: row.title, unit: null, basis: null, reporting_period: row.published_on, source_key: key });
  });
  if (!relevant.length) target.missing.push(`None of the ${rows.length} stored official releases matches "${args.query}".`);
  if (body?.coverage) target.limitations.push(body.coverage);
  target.reporting_period = relevant.map(({ row }) => row.published_on).sort().at(-1) ?? null;
  target.summary = relevant.length ? `${relevant.length} matching official release(s).` : target.missing.at(-1)!;
  return finalize(target);
}

const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  cpcri_publication: "ICAR-CPCRI publication", dasd_report: "DASD report", government_notification: "Government notification", agricultural_research: "Agricultural research",
};

/** Publications before this year are flagged, because recommendations and approved products change. */
const OLD_PUBLICATION_YEAR = 2010;
const isScanned = (hit: { reuse_note: string | null }) => /\bOCR\b/.test(hit.reuse_note ?? "");

async function searchAgriculturalDocuments(ctx: ToolContext, args: ToolArgs<"search_agricultural_documents">): Promise<ToolResult> {
  const target = result("search_agricultural_documents", args, "Agricultural documents");
  const retrieval = await searchDocuments(ctx.db, args.query, {
    embedder: ctx.embedder, documentTypes: args.document_type ? [args.document_type] : undefined,
    semanticThreshold: ctx.semanticThreshold, semanticScanLimit: ctx.semanticScanLimit, language: ctx.language,
  });
  target.excerpts = [];
  for (const hit of retrieval.hits) {
    const page = pageLabel(hit);
    const key = addSource(target, {
      key: `doc:${hit.chunk_id}`, kind: "document", label: `${hit.title}${page ? `, ${page}` : ""}`, publisher: hit.publisher, url: hit.source_url,
      reporting_period: hit.publication_date, retrieved_at: hit.fetched_at, publication_date: hit.publication_date, page,
    });
    const snippet = hit.text.length > 600 ? `${hit.text.slice(0, 600).replace(/\s+\S*$/, "")} …` : hit.text;
    target.facts.push({ label: `${DOCUMENT_TYPE_LABEL[hit.document_type] ?? hit.document_type}${hit.heading ? ` – ${hit.heading}` : ""}`, value: snippet, unit: null,
      basis: hit.matched_by.join("+"), reporting_period: hit.publication_date, source_key: key });
    target.excerpts.push({ source_key: key, text: hit.text, scanned: isScanned(hit) });
  }
  if (!retrieval.corpus.chunks) target.missing.push("No agricultural documents have been ingested yet (see data-platform/documents).");
  else if (!retrieval.hits.length) target.missing.push(retrieval.diseases.length
    ? `No passage in ${retrieval.corpus.documents} ingested document(s) discusses ${retrieval.diseases.join(" or ")}. Passages about other diseases are not shown, because their advice does not apply.`
    : `No passage in ${retrieval.corpus.documents} ingested document(s) is relevant to the question.`);
  if (retrieval.semantic_status === "failed") target.uncertainty.push(`Semantic search was unavailable (${retrieval.semantic_error}); keyword matches only.`);
  else if (retrieval.semantic_status !== "used") target.limitations.push("Semantic (BGE-M3) search is not active; results use keyword matching only.");
  if (ctx.language === "kn" && retrieval.hits.some((hit) => hit.language !== "kn")) target.limitations.push("ಕೆಲವು ಭಾಗಗಳು ಮೂಲ ಇಂಗ್ಲಿಷ್ ದಾಖಲೆಗಳಿಂದ ಬಂದಿವೆ ಮತ್ತು ಇಂಗ್ಲಿಷ್‌ನಲ್ಲೇ ಉಲ್ಲೇಖಿಸಲಾಗಿದೆ.");
  // A scanner can misread a digit, and a dose is the one thing a reader may act on directly.
  if (retrieval.hits.some(isScanned)) {
    target.limitations.push(ctx.language === "kn"
      ? "ಕೆಲವು ಭಾಗಗಳನ್ನು ಸ್ಕ್ಯಾನ್ ಮಾಡಿದ ಪ್ರತಿಯಿಂದ ಓದಲಾಗಿದೆ (OCR). ಪ್ರಮಾಣ ಮತ್ತು ಡೋಸ್ ಅನ್ನು ಬಳಸುವ ಮೊದಲು ಉಲ್ಲೇಖಿಸಿದ ಮೂಲ ಪುಟದಲ್ಲಿ ಪರಿಶೀಲಿಸಿ."
      : "Some passages were read from a scanned copy by OCR, which can misread characters. Check any dose or quantity on the cited page of the original before using it.");
  }
  if (retrieval.withheld_pesticides.length) {
    const names = retrieval.withheld_pesticides.join(", ");
    target.limitations.push(ctx.language === "kn"
      ? `ಕೆಲವು ಹಳೆಯ ಭಾಗಗಳನ್ನು ತೋರಿಸಿಲ್ಲ, ಏಕೆಂದರೆ ಅವು ಈಗ ಭಾರತದಲ್ಲಿ ನಿಷೇಧಿತ ಅಥವಾ ನಿರ್ಬಂಧಿತ ಕೀಟನಾಶಕವನ್ನು (${names}) ಶಿಫಾರಸು ಮಾಡುತ್ತವೆ. ಪ್ರಸ್ತುತ ಶಿಫಾರಸಿಗಾಗಿ ICAR-CPCRI ಅಥವಾ ತೋಟಗಾರಿಕೆ ಇಲಾಖೆಯನ್ನು ಸಂಪರ್ಕಿಸಿ.`
      : `Some older passages are not shown because they name a pesticide now banned or restricted in India (${names}). Ask ICAR-CPCRI or the State Horticulture Department for a current recommendation.`);
  }
  const olderThan = retrieval.hits.flatMap((hit) => hit.publication_date && Number(hit.publication_date.slice(0, 4)) < OLD_PUBLICATION_YEAR ? [hit.publication_date.slice(0, 4)] : []);
  if (olderThan.length) {
    const earliest = olderThan.sort()[0];
    target.limitations.push(ctx.language === "kn"
      ? `ಕೆಲವು ಭಾಗಗಳು ಹಳೆಯ ಪ್ರಕಟಣೆಗಳಿಂದ ಬಂದಿವೆ (${earliest} ರಿಂದ). ಶಿಫಾರಸುಗಳು ಬದಲಾಗಿರಬಹುದು.`
      : `Some passages come from older publications (from ${earliest}). Recommendations may have changed since then.`);
  }
  target.limitations.push("Passages are quoted from the cited publications. They are general guidance, not a diagnosis; confirm field problems with ICAR-CPCRI or the State Horticulture Department.");
  target.reporting_period = null;
  target.summary = retrieval.hits.length ? `${retrieval.hits.length} relevant passage(s) (${retrieval.mode} retrieval).` : target.missing.at(-1) ?? "No passages found.";
  return finalize(target);
}

// ------------------------------------------------------------------------------------------------
// Dispatcher

export async function runTool(name: ToolName, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  const validated = validateToolArgs(name, rawArgs);
  if (!validated.ok) {
    return result(name, {}, name, { status: "error", summary: validated.error, missing: [validated.error] });
  }
  const args = validated.args as never;
  try {
    switch (name) {
      case "get_current_prices": return await getCurrentPrices(ctx, args);
      case "get_historical_prices": return await getHistoricalPrices(ctx, args);
      case "compare_markets": return await compareMarkets(ctx, args);
      case "get_market_index": return await getMarketIndex(ctx, args);
      case "get_market_arrivals": return await getMarketArrivals(ctx, args);
      case "get_price_forecast": return await getPriceForecast(ctx, args);
      case "get_production_statistics": return await getProductionStatistics(ctx, args);
      case "get_trade_statistics": return await getTradeStatistics(ctx, args);
      case "get_weather": return await getWeather(ctx, args);
      case "get_advisories": return await getAdvisories(ctx, args);
      case "calculate_net_realization": return await calculate(ctx, name, args);
      case "calculate_sell_hold": return await calculate(ctx, name, args);
      case "search_industry_news": return await searchIndustryNews(ctx, args);
      case "search_agricultural_documents": return await searchAgriculturalDocuments(ctx, args);
    }
  } catch (error) {
    const message = error instanceof ToolHttpError ? `ANI data service returned ${error.status} for this request: ${error.message}` : "The ANI data service could not be reached for this tool.";
    if (!(error instanceof ToolHttpError)) console.error("assistant tool failure", name, error);
    return result(name, validated.args, name, { status: error instanceof ToolHttpError ? "error" : "unavailable", summary: message, missing: [message] });
  }
}

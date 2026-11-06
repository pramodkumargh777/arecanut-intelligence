import { z } from "zod";

// Pure supply/production/weather/risk logic. Route handlers live in supply-routes.ts.

export const ESTIMATE_TYPES = ["first_advance", "second_advance", "third_advance", "final", "unspecified"] as const;
export type EstimateType = typeof ESTIMATE_TYPES[number];
const ESTIMATE_RANK: Record<EstimateType, number> = { unspecified: 1, first_advance: 2, second_advance: 3, third_advance: 4, final: 5 };

export type EstimateRow = {
  evidence_id: string; source_key: string; publisher: string; source_url: string; commodity_code: string;
  reporting_year: string; geography_level: "country" | "state" | "district"; state: string | null; district: string | null;
  geography: string; estimate_type: EstimateType; estimate_label: string;
  area_thousand_hectares: number | null; production_thousand_tonnes: number | null; yield_kg_hectare: number | null;
  publication_date: string | null; publication_precision: string | null; recorded_at: string; content_sha256: string;
};
export type Vintage = EstimateRow & { first_recorded_at: string; captures: number };

export function parseReportingYear(value: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const start = Number(match[1]);
  return (start + 1) % 100 === Number(match[2]) ? start : null;
}
export const nextReportingYear = (value: string) => {
  const start = parseReportingYear(value);
  return start === null ? null : `${start + 1}-${String((start + 2) % 100).padStart(2, "0")}`;
};

const valueKey = (row: EstimateRow) => [row.area_thousand_hectares, row.production_thousand_tonnes, row.yield_kg_hectare].join("|");

/** Collapses repeated captures of an unchanged table into one vintage, keeping the earliest record time. */
export function collapseVintages(rows: EstimateRow[]): Vintage[] {
  const map = new Map<string, Vintage>();
  for (const row of [...rows].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))) {
    const key = [row.geography_level, row.geography, row.reporting_year, row.source_key, row.estimate_type, row.estimate_label,
      row.publication_date ?? "", valueKey(row)].join("\u0000");
    const existing = map.get(key);
    if (existing) existing.captures += 1;
    else map.set(key, { ...row, first_recorded_at: row.recorded_at, captures: 1 });
  }
  return [...map.values()];
}

/** Current estimate: most mature estimate stage, then latest publication, then latest record time. */
export function currentEstimate<T extends EstimateRow>(rows: T[]): T | null {
  return [...rows].sort((a, b) => ESTIMATE_RANK[b.estimate_type] - ESTIMATE_RANK[a.estimate_type]
    || (b.publication_date ?? "").localeCompare(a.publication_date ?? "")
    || b.recorded_at.localeCompare(a.recorded_at))[0] ?? null;
}

export function currentSeries(vintages: Vintage[]) {
  const groups = new Map<string, Vintage[]>();
  for (const row of vintages) {
    const key = `${row.geography}\u0000${row.reporting_year}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map((group) => {
    const chosen = currentEstimate(group)!;
    const distinctValues = new Set(group.map(valueKey));
    return { ...chosen, vintages: group.length, revised: distinctValues.size > 1, stage_changed: new Set(group.map((row) => row.estimate_type)).size > 1 };
  }).sort((a, b) => a.reporting_year.localeCompare(b.reporting_year) || a.geography.localeCompare(b.geography));
}

export function revisionHistory(vintages: Vintage[]) {
  const ordered = [...vintages].sort((a, b) => a.reporting_year.localeCompare(b.reporting_year)
    || ESTIMATE_RANK[a.estimate_type] - ESTIMATE_RANK[b.estimate_type] || a.first_recorded_at.localeCompare(b.first_recorded_at));
  const previous = new Map<string, Vintage>();
  return ordered.map((row) => {
    const key = `${row.geography}\u0000${row.reporting_year}`, prior = previous.get(key);
    previous.set(key, row);
    const delta = (field: "area_thousand_hectares" | "production_thousand_tonnes" | "yield_kg_hectare") =>
      prior && prior[field] !== null && row[field] !== null ? Number((row[field]! - prior[field]!).toFixed(3)) : null;
    return { ...row, previous_estimate_type: prior?.estimate_type ?? null,
      change_production_thousand_tonnes: delta("production_thousand_tonnes"), change_area_thousand_hectares: delta("area_thousand_hectares"),
      change_yield_kg_hectare: delta("yield_kg_hectare") };
  });
}

type SeriesPoint = { reporting_year: string; value: number | null; estimate_type: EstimateType };
export function growthSeries(points: SeriesPoint[]) {
  const ordered = [...points].sort((a, b) => a.reporting_year.localeCompare(b.reporting_year));
  const yoy = ordered.slice(1).map((point, index) => {
    const prior = ordered[index];
    const consecutive = nextReportingYear(prior.reporting_year) === point.reporting_year;
    const valid = consecutive && prior.value !== null && point.value !== null && prior.value > 0;
    return { from: prior.reporting_year, to: point.reporting_year,
      percent: valid ? Number((((point.value! - prior.value!) / prior.value!) * 100).toFixed(2)) : null,
      mixed_estimate_types: prior.estimate_type !== point.estimate_type,
      reason: !consecutive ? "Reporting years are not consecutive." : valid ? null : "A value is missing or the base is zero." };
  });
  const usable = ordered.filter((point) => point.value !== null && point.value > 0);
  let cagr: { from: string; to: string; years: number; percent: number; mixed_estimate_types: boolean } | null = null;
  if (usable.length >= 2) {
    const first = usable[0], last = usable[usable.length - 1];
    const years = parseReportingYear(last.reporting_year)! - parseReportingYear(first.reporting_year)!;
    if (years > 0) cagr = { from: first.reporting_year, to: last.reporting_year, years,
      percent: Number(((Math.pow(last.value! / first.value!, 1 / years) - 1) * 100).toFixed(2)),
      mixed_estimate_types: new Set(usable.map((point) => point.estimate_type)).size > 1 };
  }
  return { yoy, cagr };
}

// ---------------------------------------------------------------------------------------------
// Dates (market calendar dates are IST date-only values)
export const istDate = (instant: Date) => new Date(instant.getTime() + 330 * 60_000).toISOString().slice(0, 10);
export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
export const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
export function weekStart(day: string) {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

export const IMD_SEASONS = [
  { key: "winter", label: "Winter (Jan–Feb)", months: [1, 2] },
  { key: "pre_monsoon", label: "Pre-monsoon (Mar–May)", months: [3, 4, 5] },
  { key: "southwest_monsoon", label: "South-west monsoon (Jun–Sep)", months: [6, 7, 8, 9] },
  { key: "post_monsoon", label: "Post-monsoon (Oct–Dec)", months: [10, 11, 12] },
] as const;
export function imdSeason(day: string) {
  const year = Number(day.slice(0, 4)), month = Number(day.slice(5, 7));
  const season = IMD_SEASONS.find((item) => (item.months as readonly number[]).includes(month))!;
  const lastMonth = season.months[season.months.length - 1];
  const nextMonthStart = lastMonth === 12 ? `${year + 1}-01-01` : `${year}-${String(lastMonth + 1).padStart(2, "0")}-01`;
  return { key: `${year}-${season.key}`, year, season: season.key, label: `${year} ${season.label}`,
    start: `${year}-${String(season.months[0]).padStart(2, "0")}-01`, end: addDays(nextMonthStart, -1) };
}
/** SQL expression bucketing an ISO date column; mirrors weekStart/imdSeason. */
export function bucketSql(granularity: "daily" | "weekly" | "monthly" | "seasonal", column: string) {
  if (granularity === "daily") return column;
  if (granularity === "weekly") return `date(${column}, '-' || ((CAST(strftime('%w', ${column}) AS INTEGER) + 6) % 7) || ' days')`;
  if (granularity === "monthly") return `substr(${column}, 1, 7)`;
  return `substr(${column}, 1, 4) || '-' || CASE WHEN CAST(substr(${column}, 6, 2) AS INTEGER) <= 2 THEN 'winter'
    WHEN CAST(substr(${column}, 6, 2) AS INTEGER) <= 5 THEN 'pre_monsoon' WHEN CAST(substr(${column}, 6, 2) AS INTEGER) <= 9 THEN 'southwest_monsoon' ELSE 'post_monsoon' END`;
}

// ---------------------------------------------------------------------------------------------
// Units and geography
const TONNE_FACTORS: Record<string, number> = {
  tonne: 1, tonnes: 1, "metric tonne": 1, "metric tonnes": 1,
  quintal: 0.1, quintals: 0.1, qtl: 0.1, qtls: 0.1,
  kg: 0.001, kgs: 0.001, kilogram: 0.001, kilograms: 0.001,
};
/** Converts only explicitly known mass units; ambiguous units such as "ton", "MT", bags or lots stay unconverted. */
export function toTonnes(quantity: number, unit: string): { tonnes: number | null; status: "converted" | "unknown_unit" } {
  const factor = TONNE_FACTORS[unit.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ")];
  return factor === undefined ? { tonnes: null, status: "unknown_unit" } : { tonnes: Number((quantity * factor).toFixed(6)), status: "converted" };
}
export const districtKey = (value: string) => value.trim().toLowerCase().replace(/\s+district$/i, "").replace(/\s+/g, " ");

export async function districtResolver(db: D1Database, state: string) {
  const rows = await db.prepare("SELECT alias_key,district FROM geography_aliases WHERE state=?").bind(state).all<{ alias_key: string; district: string }>();
  const map = new Map(rows.results.map((row) => [row.alias_key, row.district]));
  return (raw: string) => map.get(districtKey(raw)) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Weather freshness and seasonal summaries
export const WEATHER_STALE_HOURS = 36;
export function freshness(latest: string | null, now: Date, maxAgeHours = WEATHER_STALE_HOURS) {
  if (!latest) return { status: "missing" as const, age_hours: null, max_age_hours: maxAgeHours };
  const age = (now.getTime() - Date.parse(latest)) / 3_600_000;
  return { status: age <= maxAgeHours ? "fresh" as const : "stale" as const, age_hours: Number(age.toFixed(1)), max_age_hours: maxAgeHours };
}
export type WeatherDay = { day: string; data_type: string; provider: string; rainfall_mm: number | null; temperature_max_c: number | null;
  temperature_min_c: number | null; relative_humidity_pct: number | null; evidence_id: string; retrieved_at: string | null };
export function seasonalSummary(days: WeatherDay[]) {
  const groups = new Map<string, WeatherDay[]>();
  for (const day of days) {
    const key = `${imdSeason(day.day).key}\u0000${day.data_type}`;
    groups.set(key, [...(groups.get(key) ?? []), day]);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const season = imdSeason(rows[0].day), expected = daysBetween(season.start, season.end) + 1;
    const rain = rows.filter((row) => row.rainfall_mm !== null);
    const humidity = rows.filter((row) => row.relative_humidity_pct !== null);
    return { key: season.key, season: season.season, label: season.label, data_type: key.split("\u0000")[1], start: season.start, end: season.end,
      days_with_data: rows.length, expected_days: expected, complete: rows.length === expected && rain.length === expected,
      rainfall_total_mm: rain.length ? Number(rain.reduce((sum, row) => sum + row.rainfall_mm!, 0).toFixed(1)) : null,
      rainy_days_2_5mm: rain.filter((row) => row.rainfall_mm! >= 2.5).length,
      mean_humidity_pct: humidity.length ? Number((humidity.reduce((sum, row) => sum + row.relative_humidity_pct!, 0) / humidity.length).toFixed(1)) : null };
  }).sort((a, b) => a.start.localeCompare(b.start) || a.data_type.localeCompare(b.data_type));
}
const TYPE_PRIORITY: Record<string, number> = { station_measurement: 3, reanalysis: 2, model_grid: 1 };
/** One value per day, preferring physical station measurements, then reanalysis, then model output. */
export function preferredDays(days: WeatherDay[]) {
  const map = new Map<string, WeatherDay>();
  for (const day of days) {
    const existing = map.get(day.day);
    if (!existing || (TYPE_PRIORITY[day.data_type] ?? 0) > (TYPE_PRIORITY[existing.data_type] ?? 0)) map.set(day.day, day);
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}

// ---------------------------------------------------------------------------------------------
// Crop risk rules
export const HAZARDS = ["fruit_rot_mahali", "yellow_leaf_disease", "bud_rot", "root_grub", "areolate_mildew"] as const;
export const conditionSchema = z.object({
  window_days: z.number().int().min(1).max(60),
  months: z.array(z.number().int().min(1).max(12)).min(1).max(12).optional(),
  min_total_rainfall_mm: z.number().finite().min(0).optional(),
  min_rainy_days: z.number().int().min(1).optional(),
  rainy_day_threshold_mm: z.number().finite().min(0).optional(),
  min_mean_humidity_pct: z.number().finite().min(0).max(100).optional(),
  min_mean_temperature_c: z.number().finite().optional(),
  max_mean_temperature_c: z.number().finite().optional(),
  min_coverage_ratio: z.number().min(0.5).max(1).default(0.8),
}).strict().refine((value) => value.min_total_rainfall_mm !== undefined || value.min_rainy_days !== undefined
  || value.min_mean_humidity_pct !== undefined || value.min_mean_temperature_c !== undefined || value.max_mean_temperature_c !== undefined,
  "At least one weather criterion is required.")
  .refine((value) => (value.min_rainy_days === undefined) === (value.rainy_day_threshold_mm === undefined), "Rainy-day count needs a rainy-day threshold.");
export type Conditions = z.infer<typeof conditionSchema>;

export type RuleRow = { id: string; rule_key: string; version: number; hazard_key: string; hazard_name: string; hazard_type: string;
  causal_agent: string | null; source_summary: string; weather_relevance: "weather_linked" | "not_weather_driven" | "unknown";
  weather_conditions_json: string | null; field_evidence_required: string; management_guidance: string | null;
  citations_json: string; citation_status: "verified" | "unverified"; created_at: string; created_by: string };
export type ReviewRow = { id: string; rule_id: string; decision: "approve" | "reject" | "retire"; reviewer_name: string;
  reviewer_qualification: string; note: string; reviewed_at: string };
export function ruleStatus(reviews: ReviewRow[]) {
  // Stable ascending sort keeps insertion order for identical timestamps; the last review wins.
  const latest = [...reviews].sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at)).at(-1);
  if (!latest) return "draft" as const;
  return latest.decision === "approve" ? "expert_approved" as const : latest.decision === "reject" ? "rejected" as const : "retired" as const;
}
export function approvalProblems(rule: RuleRow) {
  const problems: string[] = [];
  if (rule.citation_status !== "verified" || JSON.parse(rule.citations_json).length === 0) problems.push("A verified primary citation is required.");
  if (rule.weather_relevance === "weather_linked") {
    if (!rule.weather_conditions_json) problems.push("Weather-linked rules need reviewer-specified weather conditions.");
    else if (!conditionSchema.safeParse(JSON.parse(rule.weather_conditions_json)).success) problems.push("Weather conditions are invalid.");
  }
  if (rule.weather_relevance === "unknown") problems.push("Weather relevance must be established before approval.");
  return problems;
}
/** Highest expert-approved version of each rule key; later drafts do not unpublish the approved version. */
export function publishedRules(rules: RuleRow[], reviews: ReviewRow[]) {
  const best = new Map<string, RuleRow>();
  for (const rule of rules) {
    if (ruleStatus(reviews.filter((review) => review.rule_id === rule.id)) !== "expert_approved") continue;
    const current = best.get(rule.rule_key);
    if (!current || rule.version > current.version) best.set(rule.rule_key, rule);
  }
  return [...best.values()];
}

export type FieldReport = { id: string; hazard_key: string; observed_on: string; verification_status: string; reporter_role: string };
export function evaluateWeather(conditions: Conditions, days: WeatherDay[], asOf: string) {
  const month = Number(asOf.slice(5, 7));
  if (conditions.months && !conditions.months.includes(month)) return { status: "out_of_season" as const, criteria: [], coverage: null, window: null, data_types: [] };
  const from = addDays(asOf, -(conditions.window_days - 1));
  const window = days.filter((day) => day.day >= from && day.day <= asOf);
  const coverage = window.length / conditions.window_days;
  const dataTypes = [...new Set(window.map((day) => day.data_type))];
  const base = { coverage: Number(coverage.toFixed(2)), window: { from, to: asOf }, data_types: dataTypes };
  if (coverage < conditions.min_coverage_ratio) return { status: "insufficient_weather_data" as const, criteria: [], ...base };
  const criteria: { criterion: string; required: number; observed: number | null; met: boolean | null }[] = [];
  const values = (pick: (day: WeatherDay) => number | null) => window.map(pick).filter((value): value is number => value !== null);
  const requireAll = (list: number[]) => list.length === window.length ? list : null;
  const rain = requireAll(values((day) => day.rainfall_mm));
  if (conditions.min_total_rainfall_mm !== undefined) {
    const total = rain ? Number(rain.reduce((sum, value) => sum + value, 0).toFixed(1)) : null;
    criteria.push({ criterion: "total_rainfall_mm", required: conditions.min_total_rainfall_mm, observed: total, met: total === null ? null : total >= conditions.min_total_rainfall_mm });
  }
  if (conditions.min_rainy_days !== undefined) {
    const count = rain ? rain.filter((value) => value >= conditions.rainy_day_threshold_mm!).length : null;
    criteria.push({ criterion: `rainy_days_at_least_${conditions.rainy_day_threshold_mm}mm`, required: conditions.min_rainy_days, observed: count, met: count === null ? null : count >= conditions.min_rainy_days });
  }
  if (conditions.min_mean_humidity_pct !== undefined) {
    const list = requireAll(values((day) => day.relative_humidity_pct));
    const mean = list ? Number((list.reduce((sum, value) => sum + value, 0) / list.length).toFixed(1)) : null;
    criteria.push({ criterion: "mean_relative_humidity_pct", required: conditions.min_mean_humidity_pct, observed: mean, met: mean === null ? null : mean >= conditions.min_mean_humidity_pct });
  }
  if (conditions.min_mean_temperature_c !== undefined || conditions.max_mean_temperature_c !== undefined) {
    const complete = window.every((day) => day.temperature_max_c !== null && day.temperature_min_c !== null);
    const mean = complete ? Number((window.reduce((sum, day) => sum + (day.temperature_max_c! + day.temperature_min_c!) / 2, 0) / window.length).toFixed(1)) : null;
    if (conditions.min_mean_temperature_c !== undefined) criteria.push({ criterion: "mean_temperature_c_min", required: conditions.min_mean_temperature_c, observed: mean, met: mean === null ? null : mean >= conditions.min_mean_temperature_c });
    if (conditions.max_mean_temperature_c !== undefined) criteria.push({ criterion: "mean_temperature_c_max", required: conditions.max_mean_temperature_c, observed: mean, met: mean === null ? null : mean <= conditions.max_mean_temperature_c });
  }
  if (criteria.some((criterion) => criterion.met === null)) return { status: "insufficient_weather_data" as const, criteria, ...base };
  return { status: criteria.every((criterion) => criterion.met) ? "conditions_favourable" as const : "conditions_not_met" as const, criteria, ...base };
}

export const FIELD_EVIDENCE_DAYS = 30;
/**
 * Advisory levels never constitute a diagnosis. Weather alone can at most yield a "weather_watch";
 * an elevated "field_reported" level requires reviewer-verified field evidence.
 */
export function evaluateRule(rule: RuleRow, days: WeatherDay[], reports: FieldReport[], asOf: string) {
  const conditions = rule.weather_relevance === "weather_linked" && rule.weather_conditions_json
    ? conditionSchema.parse(JSON.parse(rule.weather_conditions_json)) : null;
  const weather = conditions ? evaluateWeather(conditions, days, asOf) : { status: "not_applicable" as const, criteria: [], coverage: null, window: null, data_types: [] };
  const evidenceFrom = addDays(asOf, -(Math.max(conditions?.window_days ?? 0, FIELD_EVIDENCE_DAYS) - 1));
  const verified = reports.filter((report) => report.hazard_key === rule.hazard_key && report.verification_status === "verified"
    && report.observed_on >= evidenceFrom && report.observed_on <= asOf);
  const level = verified.length ? "field_reported" : weather.status === "conditions_favourable" ? "weather_watch"
    : weather.status === "insufficient_weather_data" ? "insufficient_data" : "no_advisory";
  const message = level === "field_reported"
    ? `${verified.length} reviewer-verified field report(s) describe symptoms consistent with ${rule.hazard_name}. Confirm with an extension officer or ICAR-CPCRI before acting; this is not a laboratory diagnosis.`
    : level === "weather_watch"
      ? `Recent weather meets the expert-approved favourable-condition criteria for ${rule.hazard_name}. This is not a diagnosis and does not mean the disease or pest is present; inspect palms for: ${rule.field_evidence_required}`
      : level === "insufficient_data" ? "Weather data coverage is insufficient to evaluate this rule." : "No advisory: approved criteria are not met and no verified field reports exist.";
  return { rule_id: rule.id, rule_key: rule.rule_key, version: rule.version, hazard_key: rule.hazard_key, hazard_name: rule.hazard_name,
    level, message, weather, verified_field_reports: verified.length, field_evidence_window: { from: evidenceFrom, to: asOf },
    field_evidence_required: rule.field_evidence_required, management_guidance: rule.management_guidance,
    citations: JSON.parse(rule.citations_json) as unknown[] };
}

// ---------------------------------------------------------------------------------------------
// Forecast eligibility: production and arrival forecasts are only attempted when history supports evaluation.
export const MIN_ANNUAL_PRODUCTION_POINTS = 15;
export const MIN_WEEKLY_ARRIVAL_POINTS = 104;
export function forecastEligibility(kind: "production" | "arrivals", points: number) {
  const minimum = kind === "production" ? MIN_ANNUAL_PRODUCTION_POINTS : MIN_WEEKLY_ARRIVAL_POINTS;
  return points >= minimum
    ? { status: "eligible_for_evaluation" as const, points, minimum,
      reason: "Enough history exists for walk-forward evaluation in the Python forecasting engine. No forecast is published until it beats a naive baseline." }
    : { status: "suppressed" as const, points, minimum,
      reason: kind === "production"
        ? `Only ${points} annual reporting year(s) are available; at least ${minimum} are required before an annual production forecast can be evaluated.`
        : `Only ${points} week(s) of arrival data are available; at least ${minimum} (two seasonal cycles) are required before an arrival forecast can be evaluated.` };
}

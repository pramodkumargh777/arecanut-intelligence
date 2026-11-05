import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarCheck, Gauge, History, ShieldCheck } from "lucide-react";
import { api } from "../services/api";
import { useCommodity } from "../services/commodity";
import { completeness, forecastValidationStatus, reportingFreshness, type ForecastStatus } from "../services/insights";
import { calendarTodayIST, completedMonthIST, formatCalendarDate, formatCalendarMonth } from "../../../shared/dates";
import { capabilityStatus, type MarketFeed } from "../../../shared/commodities";

export type ScoreTone = "good" | "warn" | "bad" | "neutral";

/** Text labels accompany every tone so status is never conveyed by colour alone. */
const TONE_LABEL: Record<ScoreTone, string> = { good: "OK", warn: "Attention", bad: "Unavailable", neutral: "Info" };

export function ScoreItem({ icon, label, value, tone, detail, source, to, loading }: {
  icon: ReactNode; label: string; value: string; tone: ScoreTone; detail: ReactNode; source: string; to?: string; loading?: boolean;
}) {
  return <article className={`score-item tone-${tone}`} aria-busy={loading || undefined}>
    <div className="score-head"><span className="score-icon" aria-hidden="true">{icon}</span><span className="score-label">{label}</span><span className={`status-pill tone-${tone}`}>{loading ? "Loading" : TONE_LABEL[tone]}</span></div>
    <strong className="score-value">{loading ? "…" : value}</strong>
    <p className="score-detail">{loading ? "Reading the latest published records" : detail}</p>
    <div className="score-foot"><SourceLabel>{source}</SourceLabel>{to && <Link to={to} className="subtle-link">Details</Link>}</div>
  </article>;
}

/** Consistent source/provenance label used beneath metrics, charts and tables. */
export function SourceLabel({ children }: { children: ReactNode }) {
  return <span className="source-label"><span className="source-label-key">Source</span>{children}</span>;
}

/** Status badge with text; tone only reinforces the wording. */
export function StatusBadge({ tone, children }: { tone: ScoreTone; children: ReactNode }) {
  return <span className={`status-pill tone-${tone}`}>{children}</span>;
}

const FORECAST_TEXT: Record<ForecastStatus, { value: string; tone: ScoreTone; detail: string }> = {
  validated: { value: "Validated model", tone: "good", detail: "At least one model met the prospective validation policy." },
  candidate: { value: "Experimental only", tone: "warn", detail: "Candidates beat a baseline in backtests but are not prospectively validated." },
  reference_only: { value: "Reference baselines", tone: "neutral", detail: "No evaluated model demonstrably beats its naive baseline; only reference estimates are shown." },
  not_evaluated: { value: "Not evaluated", tone: "neutral", detail: "No forecasting experiment has been published." },
};

const FEED_NAME: Record<MarketFeed, string> = { official: "AGMARKNET daily", mamcos: "MAMCOS", tss: "TSS", tumcos: "TUMCOS" };

/**
 * Overview intelligence scorecard. It composes existing published endpoints (shared react-query cache keys with
 * the pages that render the same data) and never infers a value that an endpoint did not report.
 */
export function IntelligenceScorecard({ feed, variety }: { feed: MarketFeed; variety: string }) {
  const { code: commodity, commodity: definition } = useCommodity();
  const today = calendarTodayIST();
  const completed = completedMonthIST();
  const official = feed === "official";
  const monthlyEnabled = capabilityStatus(definition, "monthly_history") !== "not_integrated" && commodity === "arecanut";
  const forecastEnabled = capabilityStatus(definition, "forecast") !== "not_integrated";
  const varieties = useQuery({ queryKey: ["varieties", commodity], queryFn: () => api.varieties(commodity), enabled: official });
  const officialVariety = variety || varieties.data?.[0] || "";
  const overview = useQuery({ queryKey: ["overview", commodity, officialVariety], queryFn: () => api.overview(officialVariety, commodity), enabled: official && Boolean(officialVariety) });
  const cooperative = useQuery({
    queryKey: ["cooperative", feed, commodity, variety, "", ""], enabled: !official,
    queryFn: () => api.cooperativePrices(feed as "mamcos" | "tss" | "tumcos", variety || undefined, commodity as "arecanut" | "black_pepper", {}),
  });
  const history = useQuery({ queryKey: ["history", "2021-01", completed, "Rashi"], queryFn: () => api.monthlyHistory("2021-01", completed, "Rashi"), enabled: monthlyEnabled });
  const forecasting = useQuery({ queryKey: ["forecasting-overview"], queryFn: () => api.forecastingOverview(), enabled: forecastEnabled });
  const performance = useQuery({ queryKey: ["forecasting-performance"], queryFn: () => api.forecastingPerformance(), enabled: forecastEnabled });

  const sourceLoading = official ? varieties.isLoading || (Boolean(officialVariety) && overview.isLoading) : cooperative.isLoading;
  const latest = official ? overview.data?.latest_reporting_date ?? null : cooperative.data?.latest_reporting_date ?? null;
  const fresh = reportingFreshness(latest, today, 3);
  const sourceError = official ? varieties.error ?? overview.error : cooperative.error;
  const awaitingReview = !official && cooperative.data && !cooperative.data.publication.published && cooperative.data.publication.awaiting_review_count > 0;
  const archived = cooperative.data?.publication.latest_archived_reporting_date ?? null;

  const latestRows = cooperative.data ? cooperative.data.data.filter((row) => row.reporting_date === latest) : [];
  const reporting = official ? overview.data?.reporting_markets ?? 0 : new Set(latestRows.map((row) => row.branch)).size;
  const universe = official ? overview.data?.market_coverage_required ?? 3 : cooperative.data?.branches.length ?? 0;
  const coverageTone: ScoreTone = sourceError ? "bad" : !latest ? "bad" : official ? reporting >= universe ? "good" : "warn" : reporting >= (cooperative.data?.minimum_branch_coverage ?? 3) ? "good" : "warn";

  const monthly = history.data ? completeness(history.data.observed_months, history.data.expected_months) : null;
  const latestMonth = history.data?.points.filter((point) => point.weighted_price !== null).at(-1)?.reporting_month ?? null;
  const validatedKeys = performance.data?.keys.filter((key) => key.effective_status === "validated").length ?? 0;
  const forecastStatus = forecastValidationStatus(forecasting.data?.status_counts, validatedKeys);
  const forecastText = FORECAST_TEXT[forecastStatus];

  return <section className="scorecard" aria-label="Intelligence scorecard">
    <div className="scorecard-heading"><div><h2>Intelligence scorecard</h2><p>Evidence status for the selected source and commodity. Calendar dates are market reporting dates (IST calendar); nothing here is a live feed.</p></div></div>
    <div className="scorecard-grid">
      <ScoreItem icon={<CalendarCheck size={16} />} label="Data freshness" loading={sourceLoading}
        value={sourceError ? "Unavailable" : awaitingReview ? "Awaiting review" : latest ? formatCalendarDate(latest) : "No reports"}
        tone={sourceError ? "bad" : awaitingReview ? "warn" : fresh.state === "fresh" ? "good" : fresh.state === "stale" ? "warn" : "bad"}
        detail={sourceError ? (sourceError as Error).message : awaitingReview ? `${cooperative.data?.publication.blocked_reason ?? ""}${archived ? ` Latest archived reporting date ${formatCalendarDate(archived)}.` : ""}`
          : fresh.ageDays === null ? (official ? "No verified daily observations are published for this commodity." : "No reviewed quotations are published.") : `Latest market reporting date is ${fresh.ageDays} day${fresh.ageDays === 1 ? "" : "s"} before today (${formatCalendarDate(today)}). Stale after 3 days.`}
        source={`${FEED_NAME[feed]}${official ? " · verified modal prices" : " · reported averages"}`} to="/data-quality" />
      <ScoreItem icon={<Gauge size={16} />} label="Reporting coverage" loading={sourceLoading}
        value={!latest ? "—" : official ? `${reporting} market${reporting === 1 ? "" : "s"}` : `${reporting} of ${universe} ${universe === 1 ? "branch" : "branches"}`}
        tone={coverageTone}
        detail={!latest ? "Coverage is reported once observations are published." : official
          ? `Verified markets on ${formatCalendarDate(latest)} for ${officialVariety}. The reference index needs at least ${universe}.`
          : `Branches reporting ${cooperative.data?.variety} on ${formatCalendarDate(latest)}; the branch-average benchmark needs ${cooperative.data?.minimum_branch_coverage ?? 3}.`}
        source={`${FEED_NAME[feed]} · same reporting date`} to={official ? "/compare?feed=official" : `/compare?feed=${feed}`} />
      <ScoreItem icon={<History size={16} />} label="Historical completeness" loading={monthlyEnabled && history.isLoading}
        value={!monthlyEnabled ? "Not integrated" : history.error ? "Unavailable" : monthly?.percent == null ? "—" : `${monthly.percent.toFixed(0)}%`}
        tone={!monthlyEnabled || history.error ? "neutral" : monthly?.state === "complete" ? "good" : monthly?.state === "partial" ? "warn" : "bad"}
        detail={!monthlyEnabled ? "No monthly history source is integrated for this commodity." : history.error ? (history.error as Error).message
          : `${history.data?.observed_months ?? 0} of ${history.data?.expected_months ?? 0} calendar months observed for Karnataka Rashi (${formatCalendarMonth("2021-01")} – ${formatCalendarMonth(completed)}). Latest observed month: ${latestMonth ? formatCalendarMonth(latestMonth) : "none"}. ${history.data?.flagged_months ?? 0} months carry review flags.`}
        source="AGMARKNET monthly · arrival-weighted state average" to="/history" />
      <ScoreItem icon={<ShieldCheck size={16} />} label="Forecast validation" loading={forecastEnabled && (forecasting.isLoading || performance.isLoading)}
        value={!forecastEnabled ? "Not integrated" : forecasting.error ? "Unavailable" : forecastText.value}
        tone={!forecastEnabled || forecasting.error ? "neutral" : forecastText.tone}
        detail={!forecastEnabled ? "Forecasting is not integrated for this commodity." : forecasting.error ? (forecasting.error as Error).message
          : `${forecastText.detail} ${forecasting.data?.status_counts.candidate ?? 0} candidate and ${forecasting.data?.status_counts.not_better_than_baseline ?? 0} not-better-than-baseline evaluations; ${forecasting.data?.totals.outcomes ?? 0} prospective outcomes matched.`}
        source="ANI forecasting engine · walk-forward backtests" to="/forecasts/evaluation" />
    </div>
  </section>;
}

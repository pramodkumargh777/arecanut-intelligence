import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarCheck, Gauge, History, ShieldCheck } from "lucide-react";
import { api } from "../services/api";
import { useCommodity } from "../services/commodity";
import { completeness, forecastValidationStatus, reportingFreshness, type ForecastStatus } from "../services/insights";
import { calendarTodayIST, completedMonthIST } from "../../../shared/dates";
import { capabilityStatus, type MarketFeed } from "../../../shared/commodities";
import { defineCopy, useCopy, useFormat } from "../services/language";

export type ScoreTone = "good" | "warn" | "bad" | "neutral";

const COPY = defineCopy({
  en: {
    /** Text labels accompany every tone so status is never conveyed by colour alone. */
    tone: { good: "OK", warn: "Attention", bad: "Unavailable", neutral: "Info" } as Record<ScoreTone, string>,
    loading: "Loading", reading: "Reading the latest published records", details: "Details", source: "Source",
    title: "Intelligence scorecard",
    intro: "Evidence status for the selected source and commodity. Calendar dates are market reporting dates (IST calendar); nothing here is a live feed.",
    forecast: {
      validated: { value: "Validated model", detail: "At least one model met the prospective validation policy." },
      candidate: { value: "Experimental only", detail: "Candidates beat a baseline in backtests but are not prospectively validated." },
      reference_only: { value: "Reference baselines", detail: "No evaluated model demonstrably beats its naive baseline; only reference estimates are shown." },
      not_evaluated: { value: "Not evaluated", detail: "No forecasting experiment has been published." },
    } as Record<ForecastStatus, { value: string; detail: string }>,
    feed: { official: "AGMARKNET daily", mamcos: "MAMCOS", tss: "TSS", tumcos: "TUMCOS" } as Record<MarketFeed, string>,
    freshness: "Data freshness", unavailable: "Unavailable", awaitingReview: "Awaiting review", noReports: "No reports",
    awaitingDetail: (count: number, archived: string | null) => `${count} quotation${count === 1 ? " is" : "s are"} waiting for reviewer approval in Data quality.${archived ? ` Latest archived reporting date ${archived}.` : ""}`,
    noOfficial: "No verified daily observations are published for this commodity.", noCooperative: "No reviewed quotations are published.",
    age: (days: number, today: string) => `Latest market reporting date is ${days} day${days === 1 ? "" : "s"} before today (${today}). Stale after 3 days.`,
    verifiedModal: "verified modal prices", reportedAverages: "reported averages", sameDate: "same reporting date",
    coverage: "Reporting coverage", markets: (n: number) => `${n} market${n === 1 ? "" : "s"}`,
    ofBranches: (n: number, of: number) => `${n} of ${of} ${of === 1 ? "branch" : "branches"}`,
    coverageLater: "Coverage is reported once observations are published.",
    officialCoverage: (date: string, variety: string, needed: number) => `Verified markets on ${date} for ${variety}. The reference index needs at least ${needed}.`,
    branchCoverage: (variety: string, date: string, needed: number) => `Branches reporting ${variety} on ${date}; the branch-average benchmark needs ${needed}.`,
    history: "Historical completeness", notIntegrated: "Not integrated", noMonthly: "No monthly history source is integrated for this commodity.",
    historyDetail: (observed: number, expected: number, from: string, to: string, latest: string | null, flagged: number) =>
      `${observed} of ${expected} calendar months observed for Karnataka Rashi (${from} – ${to}). Latest observed month: ${latest ?? "none"}. ${flagged} months carry review flags.`,
    historySource: "AGMARKNET monthly · arrival-weighted state average",
    validation: "Forecast validation", noForecast: "Forecasting is not integrated for this commodity.",
    forecastCounts: (candidate: number, notBetter: number, outcomes: number) => `${candidate} candidate and ${notBetter} not-better-than-baseline evaluations; ${outcomes} prospective outcomes matched.`,
    forecastSource: "Areca Pulse forecasting engine · walk-forward backtests",
  },
  kn: {
    tone: { good: "ಸರಿ", warn: "ಗಮನಿಸಿ", bad: "ಲಭ್ಯವಿಲ್ಲ", neutral: "ಮಾಹಿತಿ" },
    loading: "ತರಲಾಗುತ್ತಿದೆ", reading: "ಇತ್ತೀಚಿನ ಪ್ರಕಟಿತ ದಾಖಲೆಗಳನ್ನು ಓದಲಾಗುತ್ತಿದೆ", details: "ವಿವರ", source: "ಮೂಲ",
    title: "ಮಾಹಿತಿ ಸ್ಥಿತಿ ಪಟ್ಟಿ",
    intro: "ಆಯ್ದ ಮೂಲ ಮತ್ತು ಬೆಳೆಯ ದತ್ತಾಂಶದ ಸ್ಥಿತಿ. ದಿನಾಂಕಗಳು ಮಾರುಕಟ್ಟೆ ವರದಿ ದಿನಾಂಕಗಳು (ಭಾರತೀಯ ಕಾಲಮಾನ); ಇಲ್ಲಿ ಯಾವುದೂ ನೇರ ಪ್ರಸಾರವಲ್ಲ.",
    forecast: {
      validated: { value: "ದೃಢೀಕರಿಸಿದ ಮಾದರಿ", detail: "ಕನಿಷ್ಠ ಒಂದು ಮಾದರಿ ಮುಂದಿನ ಫಲಿತಾಂಶಗಳ ಪರಿಶೀಲನೆಯಲ್ಲಿ ಉತ್ತೀರ್ಣವಾಗಿದೆ." },
      candidate: { value: "ಪ್ರಾಯೋಗಿಕ ಮಾತ್ರ", detail: "ಹಿಂದಿನ ದತ್ತಾಂಶದ ಪರೀಕ್ಷೆಯಲ್ಲಿ ಮೂಲ ಅಂದಾಜನ್ನು ಮೀರಿವೆ, ಆದರೆ ಮುಂದಿನ ಫಲಿತಾಂಶಗಳಿಂದ ದೃಢಪಟ್ಟಿಲ್ಲ." },
      reference_only: { value: "ಮೂಲ ಅಂದಾಜುಗಳು ಮಾತ್ರ", detail: "ಯಾವ ಮಾದರಿಯೂ ಸರಳ ಮೂಲ ಅಂದಾಜನ್ನು ಸ್ಪಷ್ಟವಾಗಿ ಮೀರಿಲ್ಲ; ಉಲ್ಲೇಖ ಅಂದಾಜುಗಳನ್ನು ಮಾತ್ರ ತೋರಿಸಲಾಗಿದೆ." },
      not_evaluated: { value: "ಪರಿಶೀಲಿಸಿಲ್ಲ", detail: "ಯಾವುದೇ ಮುನ್ಸೂಚನೆ ಪ್ರಯೋಗ ಪ್ರಕಟವಾಗಿಲ್ಲ." },
    },
    feed: { official: "AGMARKNET ದೈನಂದಿನ", mamcos: "MAMCOS", tss: "TSS", tumcos: "TUMCOS" },
    freshness: "ದತ್ತಾಂಶ ಎಷ್ಟು ಹೊಸದು", unavailable: "ಲಭ್ಯವಿಲ್ಲ", awaitingReview: "ಪರಿಶೀಲನೆಗೆ ಕಾಯುತ್ತಿದೆ", noReports: "ವರದಿಗಳಿಲ್ಲ",
    awaitingDetail: (count: number, archived: string | null) => `${count} ದರ ವರದಿಗಳು ದತ್ತಾಂಶ ಗುಣಮಟ್ಟ ಪುಟದಲ್ಲಿ ಪರಿಶೀಲಕರ ಅನುಮೋದನೆಗೆ ಕಾಯುತ್ತಿವೆ.${archived ? ` ಸಂಗ್ರಹದಲ್ಲಿರುವ ಇತ್ತೀಚಿನ ವರದಿ ದಿನಾಂಕ ${archived}.` : ""}`,
    noOfficial: "ಈ ಬೆಳೆಗೆ ಪರಿಶೀಲಿಸಿದ ದೈನಂದಿನ ದಾಖಲೆಗಳು ಪ್ರಕಟವಾಗಿಲ್ಲ.", noCooperative: "ಪರಿಶೀಲಿಸಿದ ದರ ವರದಿಗಳು ಪ್ರಕಟವಾಗಿಲ್ಲ.",
    age: (days: number, today: string) => `ಇತ್ತೀಚಿನ ಮಾರುಕಟ್ಟೆ ವರದಿ ದಿನಾಂಕ ಇಂದಿಗಿಂತ (${today}) ${days} ದಿನ ಹಿಂದಿನದು. 3 ದಿನಗಳ ನಂತರ ಹಳೆಯದು ಎಂದು ಪರಿಗಣಿಸಲಾಗುತ್ತದೆ.`,
    verifiedModal: "ಪರಿಶೀಲಿಸಿದ ಮಾದರಿ ದರಗಳು", reportedAverages: "ವರದಿಯಾದ ಸರಾಸರಿಗಳು", sameDate: "ಅದೇ ವರದಿ ದಿನಾಂಕ",
    coverage: "ವರದಿಯ ವ್ಯಾಪ್ತಿ", markets: (n: number) => `${n} ಮಾರುಕಟ್ಟೆಗಳು`,
    ofBranches: (n: number, of: number) => `${of} ರಲ್ಲಿ ${n} ಶಾಖೆಗಳು`,
    coverageLater: "ದಾಖಲೆಗಳು ಪ್ರಕಟವಾದ ನಂತರ ವ್ಯಾಪ್ತಿ ತೋರಿಸಲಾಗುತ್ತದೆ.",
    officialCoverage: (date: string, variety: string, needed: number) => `${date} ರಂದು ${variety} ತಳಿಗೆ ಪರಿಶೀಲಿಸಿದ ಮಾರುಕಟ್ಟೆಗಳು. ಮಾನದಂಡ ಸೂಚ್ಯಂಕಕ್ಕೆ ಕನಿಷ್ಠ ${needed} ಬೇಕು.`,
    branchCoverage: (variety: string, date: string, needed: number) => `${date} ರಂದು ${variety} ವರದಿ ಮಾಡಿದ ಶಾಖೆಗಳು; ಶಾಖೆ-ಸರಾಸರಿ ಮಾನದಂಡಕ್ಕೆ ${needed} ಬೇಕು.`,
    history: "ಹಿಂದಿನ ದತ್ತಾಂಶದ ಸಂಪೂರ್ಣತೆ", notIntegrated: "ಸಂಪರ್ಕಿಸಿಲ್ಲ", noMonthly: "ಈ ಬೆಳೆಗೆ ತಿಂಗಳ ಇತಿಹಾಸದ ಮೂಲ ಸಂಪರ್ಕಿಸಿಲ್ಲ.",
    historyDetail: (observed: number, expected: number, from: string, to: string, latest: string | null, flagged: number) =>
      `ಕರ್ನಾಟಕ ರಾಶಿಗೆ ${expected} ತಿಂಗಳುಗಳಲ್ಲಿ ${observed} ತಿಂಗಳ ದಾಖಲೆ ಇದೆ (${from} – ${to}). ಇತ್ತೀಚಿನ ದಾಖಲಿತ ತಿಂಗಳು: ${latest ?? "ಯಾವುದೂ ಇಲ್ಲ"}. ${flagged} ತಿಂಗಳುಗಳಿಗೆ ಪರಿಶೀಲನಾ ಗುರುತು ಇದೆ.`,
    historySource: "AGMARKNET ತಿಂಗಳ ವರದಿ · ಆವಕ ಆಧಾರಿತ ರಾಜ್ಯ ಸರಾಸರಿ",
    validation: "ಮುನ್ಸೂಚನೆಯ ದೃಢೀಕರಣ", noForecast: "ಈ ಬೆಳೆಗೆ ಮುನ್ಸೂಚನೆ ಸಂಪರ್ಕಿಸಿಲ್ಲ.",
    forecastCounts: (candidate: number, notBetter: number, outcomes: number) => `${candidate} ಪ್ರಾಯೋಗಿಕ ಮತ್ತು ${notBetter} ಮೂಲ ಅಂದಾಜಿಗಿಂತ ಉತ್ತಮವಲ್ಲದ ಮೌಲ್ಯಮಾಪನಗಳು; ${outcomes} ಮುಂದಿನ ಫಲಿತಾಂಶಗಳು ಹೊಂದಿಕೆಯಾಗಿವೆ.`,
    forecastSource: "Areca Pulse ಮುನ್ಸೂಚನೆ ವ್ಯವಸ್ಥೆ · ಹಂತ ಹಂತದ ಹಿಂದಿನ ಪರೀಕ್ಷೆಗಳು",
  },
});

const FORECAST_TONE: Record<ForecastStatus, ScoreTone> = { validated: "good", candidate: "warn", reference_only: "neutral", not_evaluated: "neutral" };

export function ScoreItem({ icon, label, value, tone, detail, source, to, loading }: {
  icon: ReactNode; label: string; value: string; tone: ScoreTone; detail: ReactNode; source: string; to?: string; loading?: boolean;
}) {
  const t = useCopy(COPY);
  return <article className={`score-item tone-${tone}`} aria-busy={loading || undefined}>
    <div className="score-head"><span className="score-icon" aria-hidden="true">{icon}</span><span className="score-label">{label}</span><span className={`status-pill tone-${tone}`}>{loading ? t.loading : t.tone[tone]}</span></div>
    <strong className="score-value">{loading ? "…" : value}</strong>
    <p className="score-detail">{loading ? t.reading : detail}</p>
    <div className="score-foot"><SourceLabel>{source}</SourceLabel>{to && <Link to={to} className="subtle-link">{t.details}</Link>}</div>
  </article>;
}

/** Consistent source/provenance label used beneath metrics, charts and tables. */
export function SourceLabel({ children }: { children: ReactNode }) {
  const t = useCopy(COPY);
  return <span className="source-label"><span className="source-label-key">{t.source}</span>{children}</span>;
}

/** Status badge with text; tone only reinforces the wording. */
export function StatusBadge({ tone, children }: { tone: ScoreTone; children: ReactNode }) {
  return <span className={`status-pill tone-${tone}`}>{children}</span>;
}

/**
 * Overview intelligence scorecard. It composes existing published endpoints (shared react-query cache keys with
 * the pages that render the same data) and never infers a value that an endpoint did not report.
 */
export function IntelligenceScorecard({ feed, variety }: { feed: MarketFeed; variety: string }) {
  const t = useCopy(COPY);
  const format = useFormat();
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
  const forecastText = t.forecast[forecastStatus];

  return <section className="scorecard" aria-label={t.title}>
    <div className="scorecard-heading"><div><h2>{t.title}</h2><p>{t.intro}</p></div></div>
    <div className="scorecard-grid">
      <ScoreItem icon={<CalendarCheck size={16} />} label={t.freshness} loading={sourceLoading}
        value={sourceError ? t.unavailable : awaitingReview ? t.awaitingReview : latest ? format.date(latest) : t.noReports}
        tone={sourceError ? "bad" : awaitingReview ? "warn" : fresh.state === "fresh" ? "good" : fresh.state === "stale" ? "warn" : "bad"}
        detail={sourceError ? (sourceError as Error).message : awaitingReview ? t.awaitingDetail(cooperative.data?.publication.awaiting_review_count ?? 0, archived ? format.date(archived) : null)
          : fresh.ageDays === null ? (official ? t.noOfficial : t.noCooperative) : t.age(fresh.ageDays, format.date(today))}
        source={`${t.feed[feed]} · ${official ? t.verifiedModal : t.reportedAverages}`} to="/data-quality" />
      <ScoreItem icon={<Gauge size={16} />} label={t.coverage} loading={sourceLoading}
        value={!latest ? "—" : official ? t.markets(reporting) : t.ofBranches(reporting, universe)}
        tone={coverageTone}
        detail={!latest ? t.coverageLater : official
          ? t.officialCoverage(format.date(latest), officialVariety, universe)
          : t.branchCoverage(cooperative.data?.variety ?? "", format.date(latest), cooperative.data?.minimum_branch_coverage ?? 3)}
        source={`${t.feed[feed]} · ${t.sameDate}`} to={official ? "/compare?feed=official" : `/compare?feed=${feed}`} />
      <ScoreItem icon={<History size={16} />} label={t.history} loading={monthlyEnabled && history.isLoading}
        value={!monthlyEnabled ? t.notIntegrated : history.error ? t.unavailable : monthly?.percent == null ? "—" : `${monthly.percent.toFixed(0)}%`}
        tone={!monthlyEnabled || history.error ? "neutral" : monthly?.state === "complete" ? "good" : monthly?.state === "partial" ? "warn" : "bad"}
        detail={!monthlyEnabled ? t.noMonthly : history.error ? (history.error as Error).message
          : t.historyDetail(history.data?.observed_months ?? 0, history.data?.expected_months ?? 0, format.month("2021-01"), format.month(completed), latestMonth ? format.month(latestMonth) : null, history.data?.flagged_months ?? 0)}
        source={t.historySource} to="/monthly-trends" />
      <ScoreItem icon={<ShieldCheck size={16} />} label={t.validation} loading={forecastEnabled && (forecasting.isLoading || performance.isLoading)}
        value={!forecastEnabled ? t.notIntegrated : forecasting.error ? t.unavailable : forecastText.value}
        tone={!forecastEnabled || forecasting.error ? "neutral" : FORECAST_TONE[forecastStatus]}
        detail={!forecastEnabled ? t.noForecast : forecasting.error ? (forecasting.error as Error).message
          : `${forecastText.detail} ${t.forecastCounts(forecasting.data?.status_counts.candidate ?? 0, forecasting.data?.status_counts.not_better_than_baseline ?? 0, forecasting.data?.totals.outcomes ?? 0)}`}
        source={t.forecastSource} to="/forecasts/evaluation" />
    </div>
  </section>;
}

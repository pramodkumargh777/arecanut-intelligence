import { useMemo, useState } from "react";
import type { ForecastingPerformance, ModelEvaluation, StoredPrediction, TrackSeries } from "../services/forecasting";
import { showsValues } from "../services/forecasting";
import { defineCopy, useCopy, useFormat } from "../services/language";
import { LazyTrackChart } from "./LazyCharts";

/**
 * The reader-facing half of the forecast evaluation page: one verdict per variety and horizon, a leaderboard against
 * the naive baseline, accuracy by horizon, the backtest track record and the live scorecard. Every number comes from
 * the published experiment; nothing is claimed for a model that did not pass the engine's backtest gate.
 */

const BASELINES = new Set(["last_value", "seasonal_naive"]);
type Kind = "rule" | "stats" | "ml" | "ai" | "blend";
const KIND: Record<string, Kind> = {
  last_value: "rule", seasonal_naive: "rule", auto_arima: "stats", auto_ets: "stats", theta: "stats",
  lightgbm: "ml", chronos2: "ai", timesfm25: "ai", ensemble: "blend",
};

const COPY = defineCopy({
  en: {
    models: {
      last_value: "Last month's price", seasonal_naive: "Same month last year", auto_arima: "ARIMA", auto_ets: "Exponential smoothing",
      theta: "Theta", lightgbm: "LightGBM", chronos2: "Chronos-2", timesfm25: "TimesFM 2.5", ensemble: "Ensemble",
    } as Record<string, string>,
    kinds: { rule: "Simple rule", stats: "Statistical", ml: "Machine learning", ai: "AI foundation model", blend: "Theta + ETS + Chronos-2" } as Record<Kind, string>,
    makers: { chronos2: "Amazon", timesfm25: "Google" } as Record<string, string>,
    variety: "Variety", horizon: "Forecast for",
    ahead: (h: number) => h === 1 ? "Next month" : `${h} months ahead`,
    question: (variety: string, h: number) => h === 1 ? `Can we predict the ${variety} price next month?` : `Can we predict the ${variety} price ${h} months ahead?`,
    verdictValidated: (model: string) => `Yes. ${model} beats the simple rule on live prices.`,
    verdictCandidate: (model: string) => `Promising. ${model} passed past tests.`,
    verdictCandidateDetail: (base: string) => `It beat “${base}” in backtests by a reliable margin. Live months still have to confirm it.`,
    verdictNo: (base: string) => `Not yet better than “${base}”.`,
    verdictNoDetail: (base: string) => `No model, including the AI models, beats ${base.toLowerCase()} by a margin that holds up across past months, so that rule is the reference estimate.`,
    typicalMiss: "Typical miss", typicalMissNote: (pct: string) => `${pct} of the price, per quintal`,
    inRange: "Price inside the range", inRangeNote: "target 80%",
    challenger: "Closest challenger",
    closer: (p: string) => `${p} closer in tests, not reliable yet`, further: (p: string) => `${p} further off`, same: "Same accuracy",
    closerReliable: (p: string) => `${p} closer in tests`,
    tested: (n: number) => `Tested on ${n} past months`,
    leaderboard: "Model leaderboard", leaderboardHint: (base: string) => `How far each model's forecast landed from the actual price, compared with “${base}”.`,
    colModel: "Model", colVs: "vs. the rule", colMiss: "Typical miss",
    reference: "Reference", closerBar: "Closer", furtherBar: "Further off", passed: "Passed",
    horizons: "Further ahead, less accurate", horizonsHint: "Typical miss as a share of the price.",
    simpleRule: "Last month's price", bestModel: "Best model",
    best: (model: string) => `Best: ${model}`,
    track: "Track record", trackChip: (inside: number, n: number) => `In range ${inside} of ${n} months`, trackModel: (model: string) => `${model} · one month ahead`,
    trackHint: (model: string, n: number, inside: number) => `${model}, one month ahead, on ${n} past months. The actual price landed inside the shaded 80% range in ${inside} of ${n} months.`,
    actual: "Actual price", band: "80% range", baseline: "Last month's price",
    trackPending: "The track record appears after the next forecasting run.", trackNone: "No track record for this variety.",
    live: "Live scorecard", liveHint: "Forecasts saved before the price was known, checked as each month's official price arrives.",
    colMonth: "Month", colForecast: "Forecast", colRange: "80% range", colResult: "Result",
    awaiting: "Awaiting price", hit: "Inside range", miss: "Outside range", off: (amount: string) => `${amount} off`,
    noLive: "No forecast for this variety is waiting to be checked.", liveOutcomes: (n: number) => `${n} live checks so far`,
  },
  kn: {
    models: {
      last_value: "ಕಳೆದ ತಿಂಗಳ ದರ", seasonal_naive: "ಕಳೆದ ವರ್ಷದ ಅದೇ ತಿಂಗಳು", auto_arima: "ARIMA", auto_ets: "ಘಾತೀಯ ಸರಾಗೀಕರಣ (ETS)",
      theta: "Theta", lightgbm: "LightGBM", chronos2: "Chronos-2", timesfm25: "TimesFM 2.5", ensemble: "ಸಂಯೋಜಿತ ಮಾದರಿ",
    },
    kinds: { rule: "ಸರಳ ನಿಯಮ", stats: "ಸಾಂಖ್ಯಿಕ", ml: "ಯಂತ್ರ ಕಲಿಕೆ", ai: "AI ಮೂಲ ಮಾದರಿ", blend: "Theta + ETS + Chronos-2" },
    makers: { chronos2: "Amazon", timesfm25: "Google" },
    variety: "ತಳಿ", horizon: "ಅಂದಾಜು",
    ahead: (h: number) => h === 1 ? "ಮುಂದಿನ ತಿಂಗಳು" : `${h} ತಿಂಗಳ ಮುಂದೆ`,
    question: (variety: string, h: number) => h === 1 ? `${variety} ಮುಂದಿನ ತಿಂಗಳ ದರವನ್ನು ಊಹಿಸಬಹುದೇ?` : `${variety} ದರವನ್ನು ${h} ತಿಂಗಳ ಮುಂದೆ ಊಹಿಸಬಹುದೇ?`,
    verdictValidated: (model: string) => `ಹೌದು. ${model} ನಿಜವಾದ ದರಗಳಲ್ಲಿ ಸರಳ ನಿಯಮಕ್ಕಿಂತ ಉತ್ತಮ.`,
    verdictCandidate: (model: string) => `ಭರವಸೆಯಿದೆ. ${model} ಹಿಂದಿನ ಪರೀಕ್ಷೆಗಳಲ್ಲಿ ಉತ್ತೀರ್ಣ.`,
    verdictCandidateDetail: (base: string) => `ಹಿಂದಿನ ಪರೀಕ್ಷೆಗಳಲ್ಲಿ “${base}” ಗಿಂತ ವಿಶ್ವಾಸಾರ್ಹವಾಗಿ ಉತ್ತಮ. ಮುಂದಿನ ತಿಂಗಳುಗಳಲ್ಲಿ ದೃಢಪಡಬೇಕಿದೆ.`,
    verdictNo: (base: string) => `ಇನ್ನೂ “${base}” ಗಿಂತ ಉತ್ತಮವಲ್ಲ.`,
    verdictNoDetail: (base: string) => `AI ಮಾದರಿಗಳೂ ಸೇರಿ ಯಾವ ಮಾದರಿಯೂ ಹಿಂದಿನ ತಿಂಗಳುಗಳಲ್ಲಿ “${base}” ಗಿಂತ ಸ್ಥಿರವಾಗಿ ಉತ್ತಮವಲ್ಲ. ಆದ್ದರಿಂದ ಅದೇ ಉಲ್ಲೇಖ ಅಂದಾಜು.`,
    typicalMiss: "ಸಾಮಾನ್ಯ ವ್ಯತ್ಯಾಸ", typicalMissNote: (pct: string) => `ದರದ ${pct}, ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್`,
    inRange: "ಶ್ರೇಣಿಯೊಳಗೆ ಬಂದ ದರ", inRangeNote: "ಗುರಿ 80%",
    challenger: "ಹತ್ತಿರದ ಸ್ಪರ್ಧಿ",
    closer: (p: string) => `ಪರೀಕ್ಷೆಯಲ್ಲಿ ${p} ಹತ್ತಿರ, ಇನ್ನೂ ವಿಶ್ವಾಸಾರ್ಹವಲ್ಲ`, further: (p: string) => `${p} ದೂರ`, same: "ಅಷ್ಟೇ ನಿಖರ",
    closerReliable: (p: string) => `ಪರೀಕ್ಷೆಯಲ್ಲಿ ${p} ಹತ್ತಿರ`,
    tested: (n: number) => `ಹಿಂದಿನ ${n} ತಿಂಗಳುಗಳಲ್ಲಿ ಪರೀಕ್ಷಿಸಲಾಗಿದೆ`,
    leaderboard: "ಮಾದರಿಗಳ ಶ್ರೇಣಿಪಟ್ಟಿ", leaderboardHint: (base: string) => `ಪ್ರತಿ ಮಾದರಿಯ ಅಂದಾಜು ನಿಜವಾದ ದರದಿಂದ ಎಷ್ಟು ದೂರ, “${base}” ಗೆ ಹೋಲಿಸಿ.`,
    colModel: "ಮಾದರಿ", colVs: "ನಿಯಮಕ್ಕೆ ಹೋಲಿಸಿ", colMiss: "ಸಾಮಾನ್ಯ ವ್ಯತ್ಯಾಸ",
    reference: "ಉಲ್ಲೇಖ", closerBar: "ಹತ್ತಿರ", furtherBar: "ದೂರ", passed: "ಉತ್ತೀರ್ಣ",
    horizons: "ಹೆಚ್ಚು ಮುಂದೆ, ಕಡಿಮೆ ನಿಖರ", horizonsHint: "ದರದ ಶೇಕಡಾವಾರು ಸಾಮಾನ್ಯ ವ್ಯತ್ಯಾಸ.",
    simpleRule: "ಕಳೆದ ತಿಂಗಳ ದರ", bestModel: "ಉತ್ತಮ ಮಾದರಿ",
    best: (model: string) => `ಉತ್ತಮ: ${model}`,
    track: "ಹಿಂದಿನ ದಾಖಲೆ", trackChip: (inside: number, n: number) => `${n} ರಲ್ಲಿ ${inside} ತಿಂಗಳು ಶ್ರೇಣಿಯೊಳಗೆ`, trackModel: (model: string) => `${model} · ಒಂದು ತಿಂಗಳ ಮುಂದೆ`,
    trackHint: (model: string, n: number, inside: number) => `${model}, ಒಂದು ತಿಂಗಳ ಮುಂದಿನ ಅಂದಾಜು, ಹಿಂದಿನ ${n} ತಿಂಗಳುಗಳಲ್ಲಿ. ನಿಜವಾದ ದರ ${n} ರಲ್ಲಿ ${inside} ತಿಂಗಳು ಮಬ್ಬಾದ 80% ಶ್ರೇಣಿಯೊಳಗೆ ಬಂದಿದೆ.`,
    actual: "ನಿಜವಾದ ದರ", band: "80% ಶ್ರೇಣಿ", baseline: "ಕಳೆದ ತಿಂಗಳ ದರ",
    trackPending: "ಮುಂದಿನ ಅಂದಾಜು ಓಟದ ನಂತರ ಹಿಂದಿನ ದಾಖಲೆ ಕಾಣಿಸುತ್ತದೆ.", trackNone: "ಈ ತಳಿಗೆ ಹಿಂದಿನ ದಾಖಲೆ ಇಲ್ಲ.",
    live: "ನೇರ ಅಂಕಪಟ್ಟಿ", liveHint: "ದರ ತಿಳಿಯುವ ಮೊದಲೇ ಉಳಿಸಿದ ಅಂದಾಜುಗಳು; ಪ್ರತಿ ತಿಂಗಳ ಅಧಿಕೃತ ದರ ಬಂದಂತೆ ಪರಿಶೀಲಿಸಲಾಗುತ್ತದೆ.",
    colMonth: "ತಿಂಗಳು", colForecast: "ಅಂದಾಜು", colRange: "80% ಶ್ರೇಣಿ", colResult: "ಫಲಿತಾಂಶ",
    awaiting: "ದರಕ್ಕಾಗಿ ಕಾಯಲಾಗುತ್ತಿದೆ", hit: "ಶ್ರೇಣಿಯೊಳಗೆ", miss: "ಶ್ರೇಣಿಯ ಹೊರಗೆ", off: (amount: string) => `${amount} ವ್ಯತ್ಯಾಸ`,
    noLive: "ಈ ತಳಿಯ ಯಾವ ಅಂದಾಜೂ ಪರಿಶೀಲನೆಗೆ ಕಾಯುತ್ತಿಲ್ಲ.", liveOutcomes: (n: number) => `ಇದುವರೆಗೆ ${n} ನೇರ ಪರಿಶೀಲನೆಗಳು`,
  },
});

const rupees = (value: number | null | undefined) => value == null ? "—" : `₹${Math.round(value).toLocaleString("en-IN")}`;
const percent = (value: number | null | undefined, digits = 0) => value == null ? "—" : `${(value * 100).toFixed(digits)}%`;

export function ForecastShowcase({ evaluations, track, trackModel, predictions, performance }: {
  evaluations: ModelEvaluation[]; track: TrackSeries[] | undefined; trackModel: string | undefined;
  predictions: StoredPrediction[]; performance: ForecastingPerformance | undefined;
}) {
  const t = useCopy(COPY);
  const format = useFormat();
  const name = (model: string) => t.models[model] ?? model;
  const varieties = useMemo(() => [...new Set(evaluations.map((row) => row.variety))].sort(), [evaluations]);
  const horizons = useMemo(() => [...new Set(evaluations.map((row) => row.horizon))].sort((a, b) => a - b), [evaluations]);
  const [chosen, setVariety] = useState("Rashi");
  const variety = varieties.includes(chosen) ? chosen : varieties[0] ?? "";
  const [horizon, setHorizon] = useState(1);
  const rows = evaluations.filter((row) => row.variety === variety && row.horizon === horizon);
  const baseline = rows.find((row) => row.model === rows[0]?.baseline_model);
  const challengers = rows.filter((row) => !BASELINES.has(row.model) && row.mae != null).sort((a, b) => a.mae! - b.mae!);
  if (!baseline || baseline.mae == null) return null;

  const liveKeys = (performance?.keys ?? []).filter((key) => key.variety === variety && key.horizon === horizon);
  const validated = liveKeys.find((key) => key.effective_status === "validated");
  const candidate = challengers.find((row) => row.status === "candidate");
  const featured = validated ? rows.find((row) => row.model === validated.model) ?? baseline : candidate ?? baseline;
  const best = challengers[0];
  const delta = best ? best.mae! / baseline.mae - 1 : null;
  const tone = validated ? "good" : candidate ? "warn" : "neutral";
  const headline = validated ? t.verdictValidated(name(validated.model)) : candidate ? t.verdictCandidate(name(candidate.model)) : t.verdictNo(name(baseline.model));
  const detail = validated ? null : candidate ? t.verdictCandidateDetail(name(baseline.model)) : t.verdictNoDetail(name(baseline.model));
  const challengerNote = delta === null ? "" : Math.abs(delta) < 0.005 ? t.same
    : delta > 0 ? t.further(percent(delta, 1)) : best.status === "candidate" ? t.closerReliable(percent(-delta, 1)) : t.closer(percent(-delta, 1));

  // Leaderboard: error relative to the baseline, drawn either side of a centre line. The scale follows the models, not
  // the second simple rule (last year's price is often far worse and would flatten every other bar); a bar past the
  // scale fades at its end and its exact figure is printed beside it.
  const board = rows.filter((row) => row.mae != null).map((row) => ({ row, relative: row.mae! / baseline.mae! - 1 }))
    .sort((a, b) => a.relative - b.relative);
  const span = Math.max(0.05, ...board.filter((item) => !BASELINES.has(item.row.model)).map((item) => Math.abs(item.relative)));

  const byHorizon = horizons.map((h) => {
    const group = evaluations.filter((row) => row.variety === variety && row.horizon === h);
    const base = group.find((row) => row.model === group[0]?.baseline_model);
    const top = group.filter((row) => !BASELINES.has(row.model) && row.wape != null).sort((a, b) => a.wape! - b.wape!)[0];
    return { h, base: base?.wape ?? null, top: top?.wape ?? null, topModel: top?.model };
  });
  const widest = Math.max(0.01, ...byHorizon.flatMap((item) => [item.base ?? 0, item.top ?? 0]));

  const series = track?.find((item) => item.variety === variety);
  const inside = series ? series.actual.filter((value, i) => value >= series.lower[i] && value <= series.upper[i]).length : 0;

  const live = predictions.filter((row) => row.variety === variety && showsValues(row.publication))
    .sort((a, b) => a.target_period.localeCompare(b.target_period) || a.horizon - b.horizon)
    .filter((row, i, all) => all.findIndex((other) => other.target_period === row.target_period && other.horizon === row.horizon) === i).slice(0, 6);
  const checked = (performance?.keys ?? []).filter((key) => key.variety === variety).reduce((sum, key) => sum + key.outcomes, 0);

  return <div className="fx-showcase">
    <div className="fx-toolbar">
      <label className="fx-select"><span>{t.variety}</span>
        <select value={variety} onChange={(event) => setVariety(event.target.value)}>{varieties.map((value) => <option key={value} lang="en">{value}</option>)}</select></label>
      <div className="fx-segmented" role="group" aria-label={t.horizon}>
        {horizons.map((h) => <button type="button" key={h} aria-pressed={h === horizon} onClick={() => setHorizon(h)}>{t.ahead(h)}</button>)}
      </div>
    </div>

    <section className={`fx-hero tone-${tone}`} aria-live="polite">
      <div className="fx-hero-text">
        <p className="fx-eyebrow">{t.question(variety, horizon)}</p>
        <h2>{headline}</h2>
        {detail && <p className="fx-hero-detail">{detail}</p>}
        <p className="fx-tested">{t.tested(baseline.n)}</p>
      </div>
      <dl className="fx-stats">
        <div><dt>{t.typicalMiss}</dt><dd>±{rupees(featured.mae)}</dd><small>{t.typicalMissNote(percent(featured.wape, 1))}</small></div>
        <div><dt>{t.inRange}</dt><dd>{percent(featured.interval_coverage)}</dd><small>{t.inRangeNote}</small></div>
        {best && <div><dt>{t.challenger}</dt><dd className="fx-stat-name">{name(best.model)}</dd><small>{challengerNote}</small></div>}
      </dl>
    </section>

    <div className="fx-split">
      <section className="fx-card fx-board" aria-labelledby="fx-board">
        <header className="fx-card-head"><h2 id="fx-board">{t.leaderboard}</h2><p>{t.leaderboardHint(name(baseline.model))}</p></header>
        <div className="fx-board-grid" role="table" aria-labelledby="fx-board">
          <div className="fx-board-row fx-board-labels" role="row">
            <span role="columnheader" aria-hidden="true" /><span role="columnheader">{t.colModel}</span>
            <span role="columnheader" className="fx-axis"><em>{t.closerBar}</em><em>{t.furtherBar}</em></span>
            <span role="columnheader" className="num">{t.colVs}</span><span role="columnheader" className="num">{t.colMiss}</span>
          </div>
          {board.map(({ row, relative }, index) => {
            const isBase = row.model === baseline.model;
            const width = `${Math.min(50, Math.abs(relative) / span * 50)}%`;
            return <div role="row" key={row.model} className={`fx-board-row ${isBase ? "is-base" : relative < 0 ? "is-better" : "is-worse"}`}>
              <span role="cell" className="fx-rank">{index + 1}</span>
              <span role="cell" className="fx-model"><strong>{name(row.model)}{row.status === "candidate" && <i className="fx-tag">{t.passed}</i>}</strong>
                <small>{t.makers[row.model] ? `${t.makers[row.model]} · ` : ""}{t.kinds[KIND[row.model] ?? "stats"]}</small></span>
              <span role="cell" className={`fx-bar${Math.abs(relative) > span ? " is-beyond" : ""}`} aria-hidden="true">
                {!isBase && <i style={relative < 0 ? { right: "50%", width } : { left: "50%", width }} />}</span>
              <span role="cell" className="num fx-delta">{isBase ? t.reference : `${relative < 0 ? "−" : "+"}${percent(Math.abs(relative), 1)}`}</span>
              <span role="cell" className="num fx-miss">{rupees(row.mae)}</span>
            </div>;
          })}
        </div>
      </section>

      <section className="fx-card fx-horizons" aria-labelledby="fx-horizons">
        <header className="fx-card-head"><h2 id="fx-horizons">{t.horizons}</h2><p>{t.horizonsHint}</p></header>
        <p className="fx-legend"><span className="fx-key fx-key-base" />{t.simpleRule}<span className="fx-key fx-key-top" />{t.bestModel}</p>
        <ul>{byHorizon.map((item) => <li key={item.h} className={item.h === horizon ? "is-current" : undefined}>
          <span className="fx-h"><strong>{t.ahead(item.h)}</strong>{item.topModel && <small>{t.best(name(item.topModel))}</small>}</span>
          <span className="fx-hbar"><i className="fx-hbar-base" style={{ width: `${(item.base ?? 0) / widest * 100}%` }} /><b>{percent(item.base, 1)}</b></span>
          <span className="fx-hbar"><i className="fx-hbar-top" style={{ width: `${(item.top ?? 0) / widest * 100}%` }} /><b>{percent(item.top, 1)}</b></span>
        </li>)}</ul>
      </section>
    </div>

    <section className="fx-card" aria-labelledby="fx-track">
      <header className="fx-card-head fx-card-head-row">
        <div><h2 id="fx-track">{t.track}</h2>{series && trackModel && <p>{t.trackModel(name(trackModel))}</p>}</div>
        {series && trackModel && <span className="fx-chip">{t.trackChip(inside, series.periods.length)}</span>}
      </header>
      {series && trackModel ? <LazyTrackChart periods={series.periods} actual={series.actual} median={series.median} lower={series.lower} upper={series.upper}
        baseline={series.baseline} description={t.trackHint(name(trackModel), series.periods.length, inside)}
        labels={{ actual: t.actual, forecast: name(trackModel), band: t.band, baseline: t.baseline, month: format.month }} />
        : <p className="fx-empty">{track ? t.trackNone : t.trackPending}</p>}
    </section>

    <section className="fx-card" aria-labelledby="fx-live">
      <header className="fx-card-head fx-card-head-row">
        <div><h2 id="fx-live">{t.live}</h2><p>{t.liveHint}</p></div>
        {checked > 0 && <span className="fx-chip">{t.liveOutcomes(checked)}</span>}
      </header>
      {!live.length ? <p className="fx-empty">{t.noLive}</p> : <div className="fx-live-grid" role="table" aria-labelledby="fx-live">
        <div className="fx-live-row fx-live-labels" role="row">
          <span role="columnheader">{t.colMonth}</span><span role="columnheader" className="num">{t.colForecast}</span>
          <span role="columnheader" className="num">{t.colRange}</span><span role="columnheader">{t.colModel}</span><span role="columnheader">{t.colResult}</span>
        </div>
        {live.map((row) => {
          const known = row.actual_value != null;
          const hit = known && row.within_interval === 1;
          return <div role="row" key={row.id} className="fx-live-row">
            <span role="cell" className="fx-live-month"><strong>{format.month(row.target_period.slice(0, 7))}</strong><small>{t.ahead(row.horizon)}</small></span>
            <span role="cell" className="num"><strong>{rupees(row.median)}</strong></span>
            <span role="cell" className="num fx-muted">{rupees(row.lower_bound)} – {rupees(row.upper_bound)}</span>
            <span role="cell" className="fx-muted">{name(row.model)}</span>
            <span role="cell">{known
              ? <span className={`fx-result ${hit ? "is-hit" : "is-miss"}`}>{hit ? t.hit : t.miss} · {t.off(rupees(row.absolute_error))}</span>
              : <span className="fx-result is-pending">{t.awaiting}</span>}</span>
          </div>;
        })}
      </div>}
    </section>
  </div>;
}

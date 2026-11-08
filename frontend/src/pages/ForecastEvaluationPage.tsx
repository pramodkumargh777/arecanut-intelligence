import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { PUBLICATION_LABEL, STATUS_LABEL, showsValues } from "../services/forecasting";
import { formatTimestampIST } from "../../../shared/dates";
import { LazyBarChart } from "../components/LazyCharts";
import { SourceLabel, StatusBadge } from "../components/Scorecard";
import { INK } from "../components/chartPalette";
import { AboutData } from "../components/AboutData";

const num = (value: number | null | undefined, digits = 0) => value == null ? "—" : value.toLocaleString("en-IN", { maximumFractionDigits: digits });
const pct = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const label = (value: string) => value.replace(/_/g, " ");

export function ForecastEvaluationPage() {
  const [status, setStatus] = useState(""), [horizon, setHorizon] = useState("1");
  const [cursor, setCursor] = useState<number | undefined>(undefined), [history, setHistory] = useState<number[]>([]);
  const overview = useQuery({ queryKey: ["forecasting-overview"], queryFn: () => api.forecastingOverview() });
  const experimentId = overview.data?.experiment?.id;
  const evaluations = useQuery({
    queryKey: ["forecasting-evaluations", experimentId, status, horizon, cursor],
    enabled: Boolean(experimentId),
    queryFn: () => api.forecastingEvaluations({ experiment_id: experimentId, status: status || undefined, horizon: horizon || undefined, after: cursor?.toString(), limit: "50" }),
  });
  const predictions = useQuery({ queryKey: ["forecasting-predictions", experimentId], enabled: Boolean(experimentId), queryFn: () => api.forecastingPredictions({ experiment_id: experimentId, limit: "500" }) });
  const performance = useQuery({ queryKey: ["forecasting-performance"], queryFn: () => api.forecastingPerformance() });

  const resetPaging = () => { setCursor(undefined); setHistory([]); };
  const experiment = overview.data?.experiment, meta = experiment?.metadata;
  const pooled = (meta?.pooled ?? []).filter((row) => !horizon || row.horizon === Number(horizon)).sort((a, b) => (a.mae ?? Infinity) - (b.mae ?? Infinity));
  const shownPredictions = (predictions.data?.data ?? []).filter((row) => showsValues(row.publication));
  const withheldPredictions = (predictions.data?.data.length ?? 0) - shownPredictions.length;
  const engineModels = Array.from(new Set((meta?.legacy_comparison ?? []).flatMap((row) => Object.keys(row.engine_mae)))).sort();

  return <div className="page-stack">
    <section className="page-heading"><div><h1>Forecast model evaluation</h1>
      <p>Walk-forward backtests of statistical, machine-learning and foundation models against naive baselines. Nothing here states that prices will rise or fall. <Link to="/forecasts">Existing monthly reference baselines</Link> remain unchanged.</p></div></section>
    <AboutData><p>Models are compared only within one price basis. Official monthly state-weighted prices, daily APMC modal prices, MAMCOS cooperative averages and TSS tender prices are never pooled. A model is labelled validated only after enough prospective outcomes, recorded after the forecast was saved, beat its baseline.</p></AboutData>
    {overview.isLoading ? <LoadingState /> : overview.error ? <ErrorState error={overview.error} onRetry={() => void overview.refetch()} /> : !experiment ? <EmptyState title="No forecasting experiment published">Run <code>python -m forecasting run --publish</code> from data-platform against real observations. No results are invented to fill this page.</EmptyState> : <>
      <section className="snapshot-grid">
        <article className="snapshot-card"><div className="card-kicker">EXPERIMENT</div><div className="snapshot-value">{experiment.origins_evaluated} origins</div><p>{experiment.id} · {experiment.engine_version} · {experiment.vintage_mode} vintages</p></article>
        <article className="snapshot-card"><div className="card-kicker">FORECAST EXECUTION</div><div className="snapshot-value snapshot-date">{formatTimestampIST(experiment.created_at)}</div><p>Last market period used: {experiment.origin_period}. Not a market reporting date.</p></article>
        <article className="snapshot-card"><div className="card-kicker">EVALUATION STATUS</div><div className="snapshot-value">{overview.data?.status_counts.candidate ?? 0} candidates</div><p>{Object.entries(overview.data?.status_counts ?? {}).map(([key, value]) => `${STATUS_LABEL[key] ?? label(key)}: ${value}`).join(" · ")}</p></article>
        <article className="snapshot-card"><div className="card-kicker">PROSPECTIVE OUTCOMES</div><div className="snapshot-value">{overview.data?.totals.outcomes ?? 0}</div><p>{overview.data?.totals.validated_events ?? 0} validated · {overview.data?.totals.revoked_events ?? 0} revoked model events</p></article>
      </section>

      <section className="panel table-panel"><div className="panel-heading"><div><h2>Datasets by price basis</h2><p>Input data version {experiment.input_data_version.slice(0, 12)} · {meta?.multiple_testing ?? "Holm-adjusted Diebold-Mariano tests"}</p></div></div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Forecasting datasets"><table><thead><tr><th>Dataset</th><th>Price basis</th><th>Frequency / unit</th><th>Series (eligible)</th><th>Observations</th><th>Status</th></tr></thead><tbody>
          {(meta?.datasets ?? []).map((row) => <tr key={row.key}><td>{row.key}<br /><small>{row.provenance}</small></td><td>{label(row.price_basis)}</td><td>{row.frequency} · {row.unit} ({label(row.unit_status)})</td><td>{row.series_total} ({row.series_eligible})</td><td>{num(row.observations)}</td>
            <td>{row.suppressed ? <>Suppressed: {row.suppression_reasons.map(label).join(", ")}</> : row.publication_eligible ? "Evaluated" : "Not publication eligible"}</td></tr>)}
        </tbody></table></div></section>

      <section className="filter-bar">
        <label className="filter-control"><span>Horizon (months)</span><select value={horizon} onChange={(event) => { setHorizon(event.target.value); resetPaging(); }}><option value="">All</option>{(meta?.config?.horizons ?? [1, 2, 3]).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="filter-control"><span>Evaluation status</span><select value={status} onChange={(event) => { setStatus(event.target.value); resetPaging(); }}><option value="">All</option><option value="candidate">Candidate</option><option value="reference">Reference baseline</option><option value="not_better_than_baseline">Not better than baseline</option></select></label>
      </section>

      <section className="panel table-panel"><div className="panel-heading"><div><h2>Pooled walk-forward metrics</h2><p>INR/quintal errors across all eligible monthly series · relative MAE below 1.00 means lower error than the better naive baseline in-sample, not a proven edge</p></div></div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Pooled metrics"><table><thead><tr><th>Model</th><th>Horizon</th><th>Forecasts</th><th>MAE</th><th>RMSE</th><th>WAPE</th><th>MASE</th><th>Direction</th><th>80% coverage</th><th>Interval width</th><th>Relative MAE</th></tr></thead><tbody>
          {pooled.map((row) => <tr key={`${row.model}-${row.horizon}`}><td>{row.model}</td><td>{row.horizon}</td><td>{row.n}</td><td>{num(row.mae)}</td><td>{num(row.rmse)}</td><td>{pct(row.wape)}</td><td>{num(row.mase, 2)}</td><td>{pct(row.directional_accuracy)}</td><td>{pct(row.interval_coverage)}</td><td>{num(row.interval_width)}</td><td>{num(row.relative_mae_vs_best_baseline, 3)}</td></tr>)}
        </tbody></table></div></section>

      {horizon && pooled.length > 0 && (() => {
        const relative = pooled.filter((row) => row.relative_mae_vs_best_baseline !== null).sort((a, b) => a.relative_mae_vs_best_baseline! - b.relative_mae_vs_best_baseline!);
        const intervals = pooled.filter((row) => row.interval_coverage !== null);
        const beating = relative.filter((row) => row.relative_mae_vs_best_baseline! < 1).length;
        return <section className="chart-grid">
          <article className="panel chart-panel"><div className="panel-heading"><div><h2>Error relative to the best naive baseline</h2><p>Horizon {horizon} · pooled MAE ÷ better of last value and seasonal naive · below 1.00 is lower error in backtests; dark bars beat the baseline, light bars match it or are worse</p></div>
            <StatusBadge tone={beating ? "warn" : "bad"}>{beating ? `${beating} model${beating === 1 ? "" : "s"} below 1.00 pooled · see per-series status` : "No model beats the baseline"}</StatusBadge></div>
            {!relative.length ? <EmptyState title="No relative metrics for this horizon" /> : <LazyBarChart horizontal categories={relative.map((row) => row.model)} values={relative.map((row) => row.relative_mae_vs_best_baseline)} name="Relative MAE" valueFormat="ratio" referenceLine={{ value: 1, label: "Baseline" }} description={`Relative MAE by model at horizon ${horizon}`} color={(index) => { const value = relative[index]?.relative_mae_vs_best_baseline ?? 1; return value < 1 ? INK[900] : INK[400]; }} height={Math.max(220, relative.length * 34 + 60)} />}
            <div className="chart-foot"><SourceLabel>Walk-forward backtests · experiment {experiment.id} · {experiment.vintage_mode} vintages</SourceLabel></div></article>
          <article className="panel chart-panel"><div className="panel-heading"><div><h2>Prediction interval coverage</h2><p>Share of backtest actuals inside the 80% interval · dark bars are within 5 points of 80%; far below 80% means intervals are too narrow</p></div></div>
            {!intervals.length ? <EmptyState title="No interval forecasts at this horizon" /> : <LazyBarChart horizontal categories={intervals.map((row) => row.model)} values={intervals.map((row) => (row.interval_coverage ?? 0) * 100)} name="Interval coverage" valueFormat="percent" referenceLine={{ value: 80, label: "Nominal 80%" }} description={`Interval coverage by model at horizon ${horizon}`} color={(index) => Math.abs((intervals[index]?.interval_coverage ?? 0) - 0.8) <= 0.05 ? INK[900] : INK[400]} height={Math.max(220, intervals.length * 34 + 60)} />}
            <div className="chart-foot"><SourceLabel>Walk-forward backtests · interval width shown in the table above</SourceLabel></div></article>
        </section>;
      })()}
      <section className="panel table-panel"><div className="panel-heading"><div><h2>Per-series evaluations</h2><p>Each model is compared with the better of last value and seasonal naive for the same series and horizon</p></div></div>
        {evaluations.isLoading ? <LoadingState /> : evaluations.error ? <ErrorState error={evaluations.error} /> : !evaluations.data?.data.length ? <EmptyState title="No evaluations match">Change the filters.</EmptyState> : <>
          <div className="table-scroll table-tall" tabIndex={0} role="region" aria-label="Model evaluations"><table><thead><tr><th>Variety</th><th>Horizon</th><th>Model</th><th>Baseline</th><th>n</th><th>MAE</th><th>MAE skill</th><th>Holm p</th><th>Coverage</th><th>Status</th><th>Reasons</th></tr></thead><tbody>
            {evaluations.data.data.map((row) => <tr key={row.id}><td>{row.variety}</td><td>{row.horizon}</td><td>{row.model}</td><td>{row.baseline_model}</td><td>{row.n}</td><td>{num(row.mae)}</td><td>{pct(row.mae_skill_vs_baseline)}</td><td>{num(row.p_value_holm, 3)}</td><td>{pct(row.interval_coverage)} ({label(row.coverage_status)})</td><td>{STATUS_LABEL[row.status] ?? label(row.status)}</td><td>{row.reasons.map(label).join(", ")}</td></tr>)}
          </tbody></table></div>
          <div className="pagination"><span>{evaluations.data.data.length} evaluations on this page</span><div>
            <button type="button" className="button-secondary" disabled={!history.length} onClick={() => { const previous = [...history]; const last = previous.pop(); setHistory(previous); setCursor(last === -1 ? undefined : last); }}>Previous</button>
            <button type="button" className="button-secondary" disabled={evaluations.data.next_after == null} onClick={() => { setHistory([...history, cursor ?? -1]); setCursor(evaluations.data?.next_after ?? undefined); }}>Next</button>
          </div></div>
        </>}
      </section>

      <section className="panel table-panel"><div className="panel-heading"><div><h2>Latest saved predictions</h2><p>Stored before outcomes are known. {withheldPredictions} predictions from models that did not beat their baseline are withheld. Values are not statements that prices will rise or fall.</p></div></div>
        {predictions.isLoading ? <LoadingState /> : predictions.error ? <ErrorState error={predictions.error} /> : !shownPredictions.length ? <EmptyState title="No publishable predictions">Every model was withheld for this experiment.</EmptyState> :
          <div className="table-scroll table-tall" tabIndex={0} role="region" aria-label="Stored predictions"><table><thead><tr><th>Variety · basis</th><th>Target month</th><th>Horizon</th><th>Model</th><th>Median</th><th>Interval</th><th>Last observed ({shownPredictions[0].origin_period})</th><th>Publication</th><th>Actual</th></tr></thead><tbody>
            {shownPredictions.map((row) => <tr key={row.id}><td>{row.variety}<br /><small>{label(row.price_basis)} · {row.unit}</small></td><td>{row.target_period}</td><td>{row.horizon}</td><td>{row.model}</td><td>{num(row.median)}</td><td>{num(row.lower_bound)}–{num(row.upper_bound)} ({Math.round(row.interval_level)}%)</td><td>{num(row.last_observed_value)}</td><td>{PUBLICATION_LABEL[row.publication]}</td><td>{row.actual_value == null ? "Not yet observed" : `${num(row.actual_value)} (error ${num(row.absolute_error)})`}</td></tr>)}
          </tbody></table></div>}
      </section>

      <section className="panel table-panel"><div className="panel-heading"><div><h2>Prospective performance</h2><p>Forecasts matched to outcomes ingested after they were saved · validation needs at least {overview.data?.policy.validation_min_outcomes ?? 6} paired outcomes</p></div></div>
        {performance.isLoading ? <LoadingState /> : performance.error ? <ErrorState error={performance.error} /> : !performance.data?.keys.length ? <EmptyState title="No prospective outcomes yet">Outcomes are matched when new monthly reporting data arrives. No outcome is simulated.</EmptyState> :
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Prospective performance"><table><thead><tr><th>Variety</th><th>Horizon</th><th>Model</th><th>Outcomes</th><th>MAE</th><th>Baseline MAE</th><th>MAE ratio</th><th>Coverage</th><th>Status</th></tr></thead><tbody>
            {performance.data.keys.map((row) => <tr key={`${row.series_id}-${row.horizon}-${row.model}`}><td>{row.variety}</td><td>{row.horizon}</td><td>{row.model}</td><td>{row.outcomes}</td><td>{num(row.mae)}</td><td>{num(row.baseline_mae)}</td><td>{num(row.mae_ratio, 3)}</td><td>{pct(row.coverage)}</td><td>{STATUS_LABEL[row.effective_status] ?? label(row.effective_status)}</td></tr>)}
          </tbody></table></div>}
      </section>

      {!!meta?.legacy_comparison?.length && <section className="panel table-panel"><div className="panel-heading"><div><h2>Comparison with the existing monthly baseline</h2><p>Legacy holdout MAE versus engine MAE on the same holdout months (INR/quintal, horizon 1)</p></div></div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Legacy comparison"><table><thead><tr><th>Variety</th><th>Legacy model</th><th>Holdout months</th><th>Legacy MAE</th>{engineModels.map((model) => <th key={model}>{model}</th>)}</tr></thead><tbody>
          {meta.legacy_comparison.map((row) => <tr key={row.variety}><td>{row.variety}</td><td>{row.legacy_model}{row.legacy_publishable ? "" : " (withheld)"}</td><td>{row.holdout_months}</td><td>{num(row.legacy_mae)}</td>{engineModels.map((model) => <td key={model}>{num(row.engine_mae[model])}</td>)}</tr>)}
        </tbody></table></div></section>}

      <section className="panel"><div className="panel-heading"><div><h2>Limitations, data availability and licences</h2><p>Payload SHA-256 {experiment.payload_sha256.slice(0, 16)} · received {formatTimestampIST(experiment.received_at)}</p></div></div><div className="monthly-details">
        <ul>{overview.data?.limitations.map((value) => <li key={value}>{value}</li>)}</ul>
        {meta?.strict_vintage && <p>Strict as-of evaluation: {meta.strict_vintage.origins_evaluated} origin(s) evaluated; skipped: {Object.entries(meta.strict_vintage.origins_skipped).map(([key, value]) => `${label(key)} ${value}`).join(", ") || "none"}.</p>}
        {meta?.exogenous && <ul>{Object.entries(meta.exogenous).map(([key, value]) => <li key={key}>{key}: {value.usable_in_backtest ? "used" : "not used"} — {value.reason}</li>)}</ul>}
        {meta?.environment?.licences && <ul>{Object.entries(meta.environment.licences).map(([key, value]) => <li key={key}>{key}: {value}</li>)}</ul>}
      </div></section>
    </>}
  </div>;
}

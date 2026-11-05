import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { exportModule } from "./IntelligencePage";
import { formatCalendarMonth, formatTimestampIST } from "../../../shared/dates";
import { LazyBarChart, LazyLineChart } from "../components/LazyCharts";
import { SourceLabel, StatusBadge } from "../components/Scorecard";

const number = (value: number | null | undefined) => value == null ? "Unavailable" : value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
export function ForecastsPage() {
  const [variety, setVariety] = useState("Rashi"), [token, setToken] = useState("");
  const client = useQueryClient();
  const prices = useQuery({ queryKey: ["forecast-varieties"], queryFn: () => api.monthlyPrices() });
  const query = useQuery({ queryKey: ["forecasts", variety], queryFn: () => api.forecasts(variety), refetchInterval: 60_000 });
  const evaluate = useMutation({ mutationFn: () => api.evaluateForecast(variety, token), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["forecasts"] }); } });
  const data = query.data, snapshot = data?.snapshot, results = snapshot?.results, evaluation = results?.evaluation;
  return <div className="page-stack">
    <section className="page-heading"><div><div className="eyebrow">EXPERIMENTAL REFERENCES · NOT TRADING ADVICE</div><h1>Experimental monthly forecasting baselines</h1><p>One reporting month ahead, for an exact Karnataka variety. Reference calculations, not proven predictive models. <Link to="/forecasts/evaluation">Compare with the forecasting engine experiments</Link>.</p></div></section>
    <div className="data-disclosure">The last-value baseline simply repeats the latest observed monthly price; seasonal naive repeats the same month last year. Retrospective evaluation does not establish prospective predictive accuracy or a trading edge. Current revised history, reused holdouts, small calibration samples and serial dependence limit the evaluation. These references do not incorporate weather, production or news.</div>
    <section className="filter-bar"><label className="filter-control"><span>Exact forecast variety</span><select value={variety} disabled={evaluate.isPending} onChange={(event) => { setVariety(event.target.value); evaluate.reset(); }}><option>Rashi</option>{prices.data?.data.filter((row) => row.variety_name !== "Rashi").map((row) => <option key={row.variety_name}>{row.variety_name}</option>)}</select></label></section>
    {prices.error && <ErrorState error={prices.error} />}
    {query.isLoading ? <LoadingState /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : data && <>
      <div className="data-disclosure">Status: <strong>{data.status.replace(/_/g, " ")}</strong>. This forecasts an official monthly state-level weighted price, not a local daily quote or an executable sale price. It does not use weather, production, news or TSS data as predictive features.</div>
      {data.stale && <div role="alert" className="data-disclosure">Snapshot is stale: {data.stale_reasons.join(", ").replace(/_/g, " ")}. Forecast output is suppressed until re-evaluated.</div>}
      {!snapshot ? <EmptyState title="No evaluated snapshot for this variety">A reviewer must run evaluation below. At least 60 consecutive positive monthly observations with source captures are required. No forecast is invented to fill this state.</EmptyState> : <>
        <section className="snapshot-grid">
          <article className="snapshot-card"><div className="card-kicker">HISTORY USED</div><div className="snapshot-value">{results?.history.count} months</div><p>{results?.history.from} through {results?.history.through}</p></article>
          <article className="snapshot-card"><div className="card-kicker">NEXT REPORTING MONTH</div><div className="snapshot-value">{data.forecast?.reporting_month ?? "Withheld"}</div><p>{evaluation?.label ?? "History did not pass evaluation requirements"}</p></article>
          <article className="snapshot-card"><div className="card-kicker">HOLDOUT MEAN ABSOLUTE ERROR</div><div className="snapshot-value">{number(evaluation?.holdout.selected.mae)}</div><p>INR/quintal · {evaluation?.holdout.selected.count ?? 0} one-step chronological holdout targets</p></article>
          <article className="snapshot-card"><div className="card-kicker">MEASURED INTERVAL COVERAGE</div><div className="snapshot-value">{evaluation ? `${number(evaluation.holdout.interval_coverage * 100)}%` : "Unavailable"}</div><p>{evaluation ? `${evaluation.holdout.covered} / ${evaluation.holdout.selected.count}` : "No holdout"} covered; nominal target 80%, not a guarantee</p></article>
        </section>
        {evaluation && <BacktestPanels evaluation={evaluation} forecast={data.forecast} publishable={Boolean(results?.publishable)} variety={variety} />}
        {data.forecast ? <section className="panel"><div className="panel-heading"><div><h2>{data.forecast.reporting_month} · Experimental reference estimate</h2><p>{evaluation?.label} · INR/quintal · Not a proven predictive model</p></div></div><div className="monthly-details"><p className="forecast-estimate">{number(data.forecast.point)} <span>INR/quintal</span></p><p>Empirical interval: <strong>{number(data.forecast.lower)}–{number(data.forecast.upper)}</strong> INR/quintal.</p><p>Method: {data.forecast.method}. Calibrated using {evaluation?.calibration.count} pre-holdout absolute errors; the small sample and serial dependence limit confidence in future coverage.</p></div></section>
          : <EmptyState title="Forecast unavailable">{results?.reasons.join(", ").replace(/_/g, " ") || (data.stale ? "Source history changed; re-evaluation is required." : "Publication requirements were not met.")}</EmptyState>}
        <section className="panel"><div className="panel-heading"><div><h2>Publication checks & limitations</h2><p>Forecast execution: {formatTimestampIST(snapshot.evaluated_at)} · {snapshot.formula_version}. This is not a market reporting date or source publication time.</p></div></div><div className="monthly-details">
          <ul>{Object.entries(results?.gates ?? {}).map(([key, passed]) => <li key={key}>{key.replace(/_/g, " ")}: <strong>{passed ? "Passed" : "Not passed"}</strong></li>)}</ul>
          <ul>{results?.limitations.map((value) => <li key={value}>{value}</li>)}</ul>
        </div></section>
        {evaluation && <>
          <section className="panel table-panel"><div className="panel-heading"><div><h2>Chronological model evaluation</h2><p>{evaluation.selection_rule}</p></div></div><div className="table-scroll" tabIndex={0} role="region" aria-label="Forecast model scores"><table><caption>Price errors in INR/quintal · sMAPE is percentage</caption><thead><tr><th>Evaluation block / model</th><th>Targets</th><th>MAE</th><th>RMSE</th><th>sMAPE %</th></tr></thead><tbody>
            {([
              ["Validation · Last value", evaluation.validation.metrics.last_value],
              ["Validation · Seasonal naive", evaluation.validation.metrics.seasonal_naive],
              ["Untouched holdout · Selected model", evaluation.holdout.selected],
              ["Untouched holdout · Last-value benchmark", evaluation.holdout.naive],
            ] as const).map(([label, metrics]) => <tr key={label}><td>{label}</td><td>{metrics.count}</td><td className="numeric">{number(metrics.mae)}</td><td className="numeric">{number(metrics.rmse)}</td><td className="numeric">{number(metrics.smape_percent)}</td></tr>)}
          </tbody></table></div><div className="monthly-details"><p>Initial training: {evaluation.initial_training_months} months. Validation: {evaluation.validation.points[0]?.reporting_month}–{evaluation.validation.points.at(-1)?.reporting_month}. Calibration: 12 subsequent months. Holdout: {evaluation.holdout.points[0]?.reporting_month}–{evaluation.holdout.points.at(-1)?.reporting_month}.</p><p>MAE skill vs last-value benchmark: {evaluation.holdout.mae_skill_vs_naive === null ? "Unavailable" : `${number(evaluation.holdout.mae_skill_vs_naive * 100)}%`}. Zero means no improvement, not a successful predictive advantage. Holdout is used for publication gating and can be reused by later evaluations.</p></div></section>
          <section className="panel table-panel"><div className="panel-heading"><div><h2>Holdout targets</h2><p>Each prediction uses only preceding calendar-month prices in the currently revised series.</p></div><button className="button-secondary" onClick={() => exportModule([
            ["reporting_month", "training_through", "actual", "last_value", "seasonal_naive", "selected_model", "snapshot_id", "evaluated_at", "formula_version", "price_unit"],
            ...evaluation.holdout.points.map((row) => [row.reporting_month, row.training_through, row.actual, row.last_value, row.seasonal_naive, evaluation.selected_model, snapshot.id, snapshot.evaluated_at, snapshot.formula_version, "INR/quintal"]),
          ], "ani-forecast-holdout.csv")}>Export holdout CSV</button></div><div className="table-scroll" tabIndex={0} role="region" aria-label="Forecast holdout predictions"><table><caption>Exact held-out targets; retrospective current-vintage evaluation</caption><thead><tr><th>Target</th><th>Training through</th><th>Actual</th><th>Last value</th><th>Seasonal naive</th></tr></thead><tbody>{evaluation.holdout.points.map((row) => <tr key={row.reporting_month}><td>{row.reporting_month}</td><td>{row.training_through}</td><td className="numeric">{number(row.actual)}</td><td className="numeric">{number(row.last_value)}</td><td className="numeric">{number(row.seasonal_naive)}</td></tr>)}</tbody></table></div></section>
        </>}
        <section className="panel"><div className="panel-heading"><div><h2>Reproducible source snapshot</h2><p>Snapshot {snapshot.id} · SHA-256 {snapshot.source_fingerprint}</p></div></div><div className="monthly-details"><button className="button-secondary" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "ani-evaluated-forecast.json"; anchor.click(); URL.revokeObjectURL(url); }}>Export evaluation JSON</button><details><summary>Inspect monthly source inputs</summary><ul>{snapshot.inputs.prices.map((row) => <li key={row.reporting_month}>{row.reporting_month}: {number(row.weighted_price)} · Platform fetched {formatTimestampIST(row.fetched_at)} · <a href={api.monthlySnapshotUrl(row.refresh_run_id)}>Archived report</a></li>)}</ul></details></div></section>
      </>}
    </>}
    <section className="panel"><div className="panel-heading"><div><h2>Run reproducible evaluation</h2><p>Reviewer access is required. Each evaluation saves an immutable snapshot, including withheld results. It does not train a complex AI model.</p></div></div><div className="monthly-details"><form className="monthly-refresh" onSubmit={(event) => { event.preventDefault(); evaluate.mutate(); }}><label className="filter-control"><span>Forecast reviewer token</span><input type="password" autoComplete="off" value={token} required disabled={evaluate.isPending} onChange={(event) => setToken(event.target.value)} /></label><button className="button-secondary" disabled={evaluate.isPending}>{evaluate.isPending ? "Evaluating..." : "Evaluate selected variety"}</button><button type="button" className="button-secondary" disabled={evaluate.isPending} onClick={() => { setToken(""); evaluate.reset(); }}>Clear token</button></form>{evaluate.error && <ErrorState error={evaluate.error} />}{evaluate.isSuccess && <p role="status">Evaluation stored. Publication status: {evaluate.data.status}.</p>}</div></section>
  </div>;
}

type Evaluation = NonNullable<NonNullable<NonNullable<import("../services/modules").ForecastData["snapshot"]>["results"]["evaluation"]>>;

/** Actual backtest results: every validation and holdout month, including months where the baseline did poorly. */
function BacktestPanels({ evaluation, forecast, publishable, variety }: { evaluation: Evaluation; forecast: import("../services/modules").Forecast | null; publishable: boolean; variety: string }) {
  const points = [...evaluation.validation.points, ...evaluation.holdout.points];
  const categories = [...points.map((point) => formatCalendarMonth(point.reporting_month)), ...(forecast ? [`${formatCalendarMonth(forecast.reporting_month)} (next)`] : [])];
  const pad = forecast ? [null] : [];
  const holdoutStart = evaluation.validation.points.length;
  const selected = evaluation.selected_model;
  const errors = evaluation.holdout.points.map((point) => point[selected] === null || point.actual === null ? null : Math.abs(point.actual - point[selected]!));
  const naiveErrors = evaluation.holdout.points.map((point) => point.last_value === null || point.actual === null ? null : Math.abs(point.actual - point.last_value));
  const skill = evaluation.holdout.mae_skill_vs_naive;
  const tone = skill !== null && skill > 0 ? "warn" : "bad";
  const mae = (key: "last_value" | "seasonal_naive") => {
    const values = evaluation.holdout.points.flatMap((point) => point.actual === null || point[key] === null ? [] : [Math.abs(point.actual - point[key]!)]);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const rupees = (value: number | null | undefined) => value == null ? "—" : `₹${Math.round(value).toLocaleString("en-IN")}`;
  const selfBenchmark = selected === "last_value";
  return <section className="chart-grid">
    <article className="panel chart-panel"><div className="panel-heading"><div><h2>Backtest: actual versus baselines</h2><p>Validation ({evaluation.validation.points.length} months) then untouched holdout ({evaluation.holdout.points.length} months, from {formatCalendarMonth(evaluation.holdout.points[0]?.reporting_month ?? "")}) · one-step-ahead · INR/quintal</p></div>
      <StatusBadge tone={publishable ? "warn" : "neutral"}>{publishable ? "Reference estimate · experimental" : "Not publishable"}</StatusBadge></div>
      <LazyLineChart categories={categories} description={`Backtest of monthly ${variety} baselines against actual prices`}
        series={[
          { name: "Actual", values: [...points.map((point) => point.actual), ...pad] },
          { name: "Last value", values: [...points.map((point) => point.last_value), ...(forecast && forecast.model === "last_value" ? [forecast.point] : pad)], dashed: true },
          { name: "Seasonal naive", values: [...points.map((point) => point.seasonal_naive), ...(forecast && forecast.model === "seasonal_naive" ? [forecast.point] : pad)], dashed: true },
        ]}
        band={forecast ? { name: `Next-month ${Math.round(forecast.nominal_coverage * 100)}% empirical interval`, lower: [...points.map(() => null), forecast.lower], upper: [...points.map(() => null), forecast.upper] } : undefined} />
      <p className="panel-note">Holdout begins at point {holdoutStart + 1}. Measured holdout interval coverage: {Math.round(evaluation.holdout.interval_coverage * 100)}% against an 80% nominal target. {forecast ? ` Next-month (${formatCalendarMonth(forecast.reporting_month)}) empirical interval: ${rupees(forecast.lower)}–${rupees(forecast.upper)}.` : ""} Past errors do not guarantee future accuracy.</p>
      <div className="chart-foot"><SourceLabel>AGMARKNET monthly · {variety} · ANI legacy baseline evaluation</SourceLabel></div></article>
    <article className="panel chart-panel"><div className="panel-heading"><div><h2>Historical error on holdout</h2><p>Absolute error per held-out month · selected model ({selected.replace("_", " ")}) versus last-value benchmark</p></div>
      <StatusBadge tone={tone}>{selfBenchmark ? "Selected model is the benchmark · no skill" : skill === null ? "Skill unavailable" : skill > 0 ? `${(skill * 100).toFixed(1)}% lower MAE than last value` : skill === 0 ? "No improvement over last value" : `${(-skill * 100).toFixed(1)}% worse than last value`}</StatusBadge></div>
      <LazyBarChart categories={evaluation.holdout.points.map((point) => formatCalendarMonth(point.reporting_month))} values={errors} name={`Absolute error · ${selected.replace("_", " ")}`} description="Absolute holdout forecast error by month" color={(index) => (errors[index] ?? 0) > (naiveErrors[index] ?? Infinity) ? "#9a3d3d" : "#286348"} />
      <p className="panel-note">{selfBenchmark ? "The selected model is the last-value benchmark itself, so its skill against that benchmark is zero by construction." : "Red bars are months where the selected model was worse than the last-value benchmark."} Holdout MAE: last value {rupees(mae("last_value"))} · seasonal naive {rupees(mae("seasonal_naive"))} per quintal.</p>
      <div className="chart-foot"><SourceLabel>Retrospective current-vintage evaluation · not prospective</SourceLabel></div></article>
  </section>;
}

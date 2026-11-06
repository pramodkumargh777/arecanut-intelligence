"""Markdown model comparison report."""

from __future__ import annotations

from typing import Any


def _fmt(value: Any, digits: int = 1) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:,.{digits}f}"
    return str(value)


def render(*, run_id: str, created_at: str, env: dict[str, Any], datasets: list[dict[str, Any]],
           evaluation: dict[str, Any] | None, backtest_meta: dict[str, Any] | None,
           legacy: list[dict[str, Any]] | None, exogenous: dict[str, Any], strict: dict[str, Any] | None,
           unified_note: str) -> str:
    lines = [f"# ANI forecasting experiment `{run_id}`", "",
             f"- Created: {created_at} (UTC)", f"- Engine: {env['engine_version']}; git {env['git'].get('sha')}"
             f"{' (dirty)' if env['git'].get('dirty') else ''}",
             "- Status vocabulary: `reference` (baseline), `candidate` (beat the baseline in backtest, awaiting "
             "prospective confirmation), `not_better_than_baseline`, `suppressed`. `validated` is granted only by the "
             "API after prospective outcomes.", "", "## Datasets (one price basis each)", "",
             "| Dataset | Basis | Unit | Unit status | Series eligible | Observations | Suppressed | Reasons |",
             "|---|---|---|---|---|---|---|---|"]
    for d in datasets:
        lines.append(f"| {d['key']} | {d['price_basis']} | {d['unit']} | {d['unit_status']} | "
                     f"{d['series_eligible']}/{d['series_total']} | {d['observations']} | {d['suppressed']} | "
                     f"{', '.join(d['suppression_reasons']) or '—'} |")
    lines += ["", f"Unified dataset: {unified_note}", "",
              "## Exogenous covariates", ""]
    for name, info in exogenous.items():
        lines.append(f"- **{name}**: usable in backtest = {info['usable_in_backtest']}. {info['reason']}")
    if strict is not None:
        lines += ["", "## Strict as-of vintage evaluation", "",
                  f"- Origins evaluated: {strict['origins_evaluated']}; skipped: {strict['origins_skipped']}",
                  "- Stored capture vintages begin on the earliest capture date, so historical origins cannot be "
                  "re-evaluated as-of. The walk-forward results below use revised history and are labelled so."]
    if evaluation and backtest_meta:
        lines += ["", "## Walk-forward results (monthly reference, revised history)", "",
                  f"- Origins: {backtest_meta['origins_evaluated']}; horizons {backtest_meta['horizons']}; "
                  f"{evaluation['multiple_testing']}; alpha {evaluation['alpha']}; nominal coverage "
                  f"{evaluation['nominal_coverage']:.0%}.",
                  f"- Status counts: {evaluation['status_counts']}",
                  f"- Model errors: {backtest_meta['model_errors']}", "",
                  "### Pooled descriptive metrics (all eligible series, common points; no significance claim)", "",
                  "| h | Model | n | MAE | RMSE | WAPE | MASE | Dir. acc. | Coverage | Width | MAE / best baseline |",
                  "|---|---|---|---|---|---|---|---|---|---|---|"]
        for row in evaluation["pooled"]:
            lines.append(f"| {row['horizon']} | {row['model']} | {row['n']} | {_fmt(row['mae'])} | {_fmt(row['rmse'])} | "
                         f"{_fmt(row['wape'], 3)} | {_fmt(row['mase'], 3)} | {_fmt(row['directional_accuracy'], 2)} | "
                         f"{_fmt(row['interval_coverage'], 2)} | {_fmt(row['interval_width'])} | "
                         f"{_fmt(row['relative_mae_vs_best_baseline'], 3)} |")
        candidates = [(g, m, i) for g in evaluation["groups"] for m, i in g["models"].items() if i["status"] == "candidate"]
        lines += ["", "### Candidates (series × horizon)", ""]
        if not candidates:
            lines.append("No model passed the pre-registered gate against its baseline for any series and horizon.")
        for group, model, item in candidates:
            lines.append(f"- {group['series_id']} h={group['horizon']}: {model} vs {group['baseline_model']} — MAE skill "
                         f"{_fmt(item['mae_skill_vs_baseline'], 3)}, Holm p {_fmt(item['p_value_holm'], 4)}, coverage "
                         f"{_fmt(item['metrics']['interval_coverage'], 2)}")
    if legacy:
        lines += ["", "## Existing `monthly-baselines-v1` vs engine (one-step, same 12 holdout months)", "",
                  "| Variety | Legacy model | Legacy MAE | Legacy publishable | Best engine model | Engine MAE |",
                  "|---|---|---|---|---|---|"]
        for row in legacy:
            best = min(row["engine_mae"].items(), key=lambda kv: kv[1]) if row["engine_mae"] else (None, None)
            lines.append(f"| {row['variety']} | {row['legacy_model']} | {_fmt(row['legacy_mae'])} | "
                         f"{row['legacy_publishable']} | {best[0] or '—'} | {_fmt(best[1])} |")
        lines += ["", "Twelve holdout points per variety are too few for a significance claim; this table is descriptive."]
    lines += ["", "## Limitations", "",
              "- Backtests use revised history; vintage leakage cannot be ruled out before the first stored capture.",
              "- Monthly state averages are derived values; they are not APMC modal or cooperative prices.",
              "- Daily AGMARKNET, MAMCOS and TSS series are suppressed until they meet the sufficiency rule.",
              "- No forecast states that prices will rise or fall; intervals are model-based and may under-cover.", ""]
    return "\n".join(lines)

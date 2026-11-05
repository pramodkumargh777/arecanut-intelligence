"""Model comparison against the relevant baseline, with family-wise significance control.

Status rules (pre-registered):
* Baselines (`last_value`, `seasonal_naive`) are `reference`.
* For each series and horizon the baseline is whichever reference has the lower MAE on the same points
  (the stronger, conservative comparator).
* A model becomes `candidate` only when it has >= `min_test_pairs` scored points, a lower MAE than the
  baseline, a Holm-adjusted one-sided Diebold-Mariano p-value < alpha (family = every candidate test in
  the experiment), and interval coverage that is not significantly below nominal and above the floor.
* `validated` is never assigned here. The API grants it only after prospective outcomes confirm a candidate.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .backtest import BacktestResult
from .config import BASELINE_MODELS, ExperimentConfig
from .metrics import diebold_mariano, holm_adjust, summarize


def _common_points(frame: pd.DataFrame) -> pd.DataFrame:
    """Keep origins that every model scored, so all models are compared on identical points."""
    counts = frame.groupby("origin").model.nunique()
    complete = counts[counts == frame.model.nunique()].index
    return frame[frame.origin.isin(complete)]


def _metrics(frame: pd.DataFrame, nominal: float) -> dict[str, Any]:
    scales = frame.mase_scale.to_numpy(dtype=float) if frame.mase_scale.notna().all() else np.full(len(frame), np.nan)
    return summarize(frame.actual, frame["median"], frame.lower, frame.upper, frame.last_value, scales, nominal)


def evaluate(result: BacktestResult, config: ExperimentConfig) -> dict[str, Any]:
    nominal = config.interval_level / 100
    scored = result.rows[result.rows.actual.notna()].copy()
    groups: list[dict[str, Any]] = []
    tests: list[tuple[int, str]] = []
    p_values: list[float | None] = []
    for (series_id, horizon), frame in scored.groupby(["series_id", "horizon"], sort=True):
        frame = _common_points(frame)
        models = sorted(frame.model.unique())
        per_model = {m: _metrics(frame[frame.model == m].sort_values("origin"), nominal) for m in models}
        references = [m for m in BASELINE_MODELS if m in per_model]
        if not references:
            continue
        baseline = min(references, key=lambda m: (per_model[m]["mae"], BASELINE_MODELS.index(m)))
        baseline_frame = frame[frame.model == baseline].sort_values("origin")
        entry = {"series_id": series_id, "horizon": int(horizon), "baseline_model": baseline,
                 "n": per_model[baseline]["n"], "models": {}}
        for model in models:
            metrics = per_model[model]
            item: dict[str, Any] = {"metrics": metrics, "status": "reference" if model in BASELINE_MODELS else None,
                                    "reasons": [], "dm": None, "p_value_holm": None,
                                    "mae_skill_vs_baseline": (1 - metrics["mae"] / per_model[baseline]["mae"])
                                    if per_model[baseline]["mae"] > 0 else None}
            if model not in BASELINE_MODELS:
                candidate = frame[frame.model == model].sort_values("origin")
                dm = diebold_mariano(baseline_frame["median"].to_numpy() - baseline_frame.actual.to_numpy(),
                                     candidate["median"].to_numpy() - candidate.actual.to_numpy(), int(horizon))
                item["dm"] = dm
                tests.append((len(groups), model))
                p_values.append(dm["p_value"])
            entry["models"][model] = item
        groups.append(entry)
    adjusted = holm_adjust(p_values)
    for (group_index, model), p_holm in zip(tests, adjusted):
        entry = groups[group_index]
        item = entry["models"][model]
        item["p_value_holm"] = p_holm
        metrics = item["metrics"]
        baseline_mae = entry["models"][entry["baseline_model"]]["metrics"]["mae"]
        reasons = []
        if metrics["n"] < config.min_test_pairs:
            reasons.append(f"insufficient_scored_points:{metrics['n']}<{config.min_test_pairs}")
        if metrics["mae"] >= baseline_mae:
            reasons.append("mae_not_below_baseline")
        if p_holm is None or p_holm >= config.alpha:
            reasons.append("improvement_not_significant_after_holm")
        if metrics["interval_coverage"] < config.min_coverage_floor or metrics["coverage_p_value_below_nominal"] < config.alpha:
            reasons.append("interval_coverage_below_nominal")
        item["reasons"] = reasons
        item["status"] = "candidate" if not reasons else "not_better_than_baseline"
    pooled = _pooled(scored, nominal)
    statuses = [m["status"] for g in groups for m in g["models"].values()]
    return {
        "vintage_mode": result.vintage_mode, "nominal_coverage": nominal, "alpha": config.alpha,
        "multiple_testing": f"Holm-Bonferroni over {len(p_values)} candidate-vs-baseline tests",
        "groups": groups, "pooled": pooled,
        "status_counts": {s: statuses.count(s) for s in sorted(set(statuses))},
    }


def _pooled(scored: pd.DataFrame, nominal: float) -> list[dict[str, Any]]:
    """Descriptive metrics per model and horizon over all series on common points (no significance claim)."""
    output = []
    for horizon, frame in scored.groupby("horizon"):
        keys = frame.groupby(["series_id", "origin"]).model.nunique()
        complete = keys[keys == frame.model.nunique()].index
        frame = frame.set_index(["series_id", "origin"]).loc[complete].reset_index()
        reference_mae = None
        rows = []
        for model, part in frame.groupby("model"):
            metrics = _metrics(part, nominal)
            rows.append({"model": model, "horizon": int(horizon), **{k: metrics[k] for k in (
                "n", "mae", "rmse", "wape", "mase", "directional_accuracy", "interval_coverage", "interval_width")}})
        maes = {r["model"]: r["mae"] for r in rows}
        reference_mae = min((maes[m] for m in BASELINE_MODELS if m in maes), default=None)
        for row in rows:
            row["relative_mae_vs_best_baseline"] = row["mae"] / reference_mae if reference_mae else None
        output.extend(sorted(rows, key=lambda r: r["mae"]))
    return output

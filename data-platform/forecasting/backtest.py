"""Walk-forward (expanding window) backtesting.

At each origin every model sees only the history available at that origin:
* `revised` mode uses current stored values truncated at the origin. Later revisions of earlier months can
  leak, so results are labelled `revised_history` and cannot by themselves validate a model.
* `strict` mode rebuilds history from capture vintages with `fetched_at <= cutoff` and scores against the
  first-release value. Origins without any vintage are skipped and counted.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable, Literal

import numpy as np
import pandas as pd

from .config import ExperimentConfig
from .datasets import ForecastDataset
from .metrics import naive_scale
from .models import run_models

VintageMode = Literal["revised", "strict"]


@dataclass
class BacktestResult:
    dataset_key: str
    vintage_mode: VintageMode
    rows: pd.DataFrame
    origins_evaluated: int
    origins_skipped: dict[str, int] = field(default_factory=dict)
    model_errors: list[dict[str, Any]] = field(default_factory=list)
    seconds: float = 0.0


def origin_cutoff(origin: pd.Period, config: ExperimentConfig) -> pd.Timestamp:
    """When data for the origin month is assumed knowable: month end plus the configured publication lag (UTC)."""
    return (origin + 1).start_time.tz_localize("UTC") + pd.Timedelta(days=config.monthly_publication_lag_days)


def _contiguous_tail(values: pd.Series, origin: pd.Period) -> pd.Series:
    values = values[values.index <= origin]
    if values.empty or values.index[-1] != origin:
        return values.iloc[0:0]
    start = len(values) - 1
    while start > 0 and values.index[start - 1] + 1 == values.index[start]:
        start -= 1
    return values.iloc[start:]


def build_view(dataset: ForecastDataset, origin, mode: VintageMode, config: ExperimentConfig) -> dict[str, pd.Series]:
    view: dict[str, pd.Series] = {}
    for item in dataset.eligible_series:
        if mode == "revised":
            history = item.values[item.values.index <= origin]
            if history.empty or history.index[-1] != origin:
                continue
        else:
            if dataset.vintages is None:
                raise ValueError("Strict mode needs capture vintages.")
            history = _contiguous_tail(dataset.vintages.history_as_of(item.series_id, origin_cutoff(origin, config)), origin)
        if len(history) >= config.initial_training_periods:
            view[item.series_id] = history.astype(float)
    return view


def _actual(dataset: ForecastDataset, series_id: str, target, mode: VintageMode) -> float:
    if mode == "strict":
        release = dataset.vintages.first_release(series_id, target) if dataset.vintages else None
        return np.nan if release is None else release[0]
    item = next(s for s in dataset.series if s.series_id == series_id)
    return float(item.values.get(target, np.nan))


def walk_forward(dataset: ForecastDataset, config: ExperimentConfig, *, models: tuple[str, ...] | None = None,
                 mode: VintageMode = "revised", origins: list | None = None,
                 progress: Callable[[str], None] | None = None) -> BacktestResult:
    if dataset.frequency != "monthly":
        raise ValueError("Walk-forward evaluation is implemented for monthly datasets; daily datasets are suppressed "
                         "until they meet the sufficiency rule.")
    models = models or config.models
    started = time.perf_counter()
    periods = sorted({p for s in dataset.eligible_series for p in s.values.index})
    if origins is None:
        origins = periods[config.initial_training_periods - 1:]
    rows: list[dict[str, Any]] = []
    skipped: dict[str, int] = {}
    errors: list[dict[str, Any]] = []
    cache: dict[str, Any] = {}
    for number, origin in enumerate(origins, 1):
        view = build_view(dataset, origin, mode, config)
        if not view:
            skipped["no_history_available_at_origin"] = skipped.get("no_history_available_at_origin", 0) + 1
            continue
        predictions, failures = run_models(view, config, config.horizons, models, cache)
        errors.extend({"origin": str(origin), "model": name, "error": message} for name, message in failures.items())
        context = {
            s: {"last": float(h.iloc[-1]), "train_size": len(h), "scale": naive_scale(h.to_numpy(), config.season_length)}
            for s, h in view.items()
        }
        for model_name, frame in predictions.items():
            for record in frame.itertuples(index=False):
                target = origin + int(record.horizon)
                info = context[record.series_id]
                rows.append({
                    "series_id": record.series_id, "model": model_name, "origin": str(origin), "target": str(target),
                    "horizon": int(record.horizon), "median": float(record.median),
                    "lower": float(min(record.lower, record.median)), "upper": float(max(record.upper, record.median)),
                    "last_value": info["last"], "train_size": info["train_size"], "mase_scale": info["scale"],
                    "actual": _actual(dataset, record.series_id, target, mode), "vintage_mode": mode,
                })
        if progress:
            progress(f"origin {origin} ({number}/{len(origins)}): {len(view)} series, {len(predictions)} models")
    frame = pd.DataFrame(rows)
    return BacktestResult(dataset_key=dataset.key, vintage_mode=mode, rows=frame,
                          origins_evaluated=int(frame.origin.nunique()) if not frame.empty else 0,
                          origins_skipped=skipped, model_errors=errors, seconds=time.perf_counter() - started)

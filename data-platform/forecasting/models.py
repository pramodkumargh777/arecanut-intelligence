"""Forecast models behind one interface.

`predict(view, horizons, level)` receives only the history available at the origin (one positive,
contiguous series per id, each ending at the shared origin) and returns one row per series and horizon
with a median and a central prediction interval.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Protocol

import numpy as np
import pandas as pd

from .config import CHRONOS_MODEL_ID, CHRONOS_REVISION, ENSEMBLE_MEMBERS, TIMESFM_MODEL_ID, TIMESFM_REVISION, ExperimentConfig
from .features import log_panel, supervised

PREDICTION_COLUMNS = ["series_id", "horizon", "median", "lower", "upper"]


class Model(Protocol):
    name: str

    def predict(self, view: dict[str, pd.Series], horizons: tuple[int, ...], level: int) -> pd.DataFrame: ...


def _to_long(view: dict[str, pd.Series]) -> pd.DataFrame:
    frames = []
    for series_id, values in view.items():
        index = values.index.to_timestamp(how="start") if isinstance(values.index, pd.PeriodIndex) else values.index
        frames.append(pd.DataFrame({"unique_id": series_id, "ds": index, "y": values.to_numpy(dtype=float)}))
    return pd.concat(frames, ignore_index=True)


@dataclass
class StatsForecastModels:
    """Runs every requested StatsForecast model in one pass; results are split per model name."""

    names: tuple[str, ...]
    season_length: int = 12
    freq: str = "MS"

    def _models(self, min_length: int):
        from statsforecast.models import AutoARIMA, AutoETS, Naive, SeasonalNaive, Theta

        season = self.season_length if min_length >= 2 * self.season_length else 1
        factories = {
            "last_value": lambda: Naive(alias="last_value"),
            "seasonal_naive": lambda: SeasonalNaive(season_length=self.season_length, alias="seasonal_naive"),
            "auto_arima": lambda: AutoARIMA(season_length=season, alias="auto_arima"),
            "auto_ets": lambda: AutoETS(season_length=season, alias="auto_ets"),
            "theta": lambda: Theta(season_length=season, alias="theta"),
        }
        return [factories[name]() for name in self.names]

    def predict_all(self, view: dict[str, pd.Series], horizons: tuple[int, ...], level: int) -> dict[str, pd.DataFrame]:
        from statsforecast import StatsForecast

        long = _to_long(view)
        min_length = int(long.groupby("unique_id").size().min())
        engine = StatsForecast(models=self._models(min_length), freq=self.freq, n_jobs=1)
        output = engine.forecast(df=long, h=max(horizons), level=[level])
        output["horizon"] = output.groupby("unique_id").cumcount() + 1
        output = output[output.horizon.isin(horizons)]
        results = {}
        for name in self.names:
            results[name] = pd.DataFrame({
                "series_id": output.unique_id.astype(str).to_numpy(), "horizon": output.horizon.to_numpy(),
                "median": output[name].to_numpy(dtype=float),
                "lower": output[f"{name}-lo-{level}"].to_numpy(dtype=float),
                "upper": output[f"{name}-hi-{level}"].to_numpy(dtype=float),
            })
        return results


@dataclass
class LightGBMDirect:
    """Global direct multi-horizon quantile regression on log returns, pooled over the dataset's series."""

    config: ExperimentConfig
    name: str = "lightgbm"
    min_history: int = 13
    feature_columns_: dict[int, list[str]] = field(default_factory=dict)

    def predict(self, view: dict[str, pd.Series], horizons: tuple[int, ...], level: int) -> pd.DataFrame:
        import lightgbm as lgb

        tail = (100 - level) / 200
        quantiles = (tail, 0.5, 1 - tail)
        panel = log_panel(view)
        rows = []
        for horizon in horizons:
            train_x, train_y, final_x = [], [], {}
            for series_id, history in view.items():
                x, y, last = supervised(history, horizon, series_id=series_id, panel=panel,
                                        season_length=self.config.season_length)
                keep = x.index.isin(history.index[self.min_history - 1:])
                train_x.append(x[keep])
                train_y.append(y[keep])
                final_x[series_id] = last
            features = pd.concat(train_x)
            targets = pd.concat(train_y)
            columns = [c for c in features.columns if features[c].notna().any()]
            if len(features) < 30:
                raise ValueError(f"Too few LightGBM training rows for horizon {horizon}: {len(features)}")
            predictions = {}
            for quantile in quantiles:
                model = lgb.LGBMRegressor(objective="quantile", alpha=quantile, **self.config.lightgbm_params)
                model.fit(features[columns].to_numpy(dtype=float), targets.to_numpy(dtype=float))
                stacked = pd.DataFrame([final_x[s] for s in view])[columns].to_numpy(dtype=float)
                predictions[quantile] = model.predict(stacked)
            ordered = np.sort(np.vstack([predictions[q] for q in quantiles]), axis=0)  # prevent quantile crossing
            for i, series_id in enumerate(view):
                last = float(view[series_id].iloc[-1])
                rows.append({"series_id": series_id, "horizon": horizon, "median": last * np.exp(ordered[1, i]),
                             "lower": last * np.exp(ordered[0, i]), "upper": last * np.exp(ordered[2, i])})
        return pd.DataFrame(rows, columns=PREDICTION_COLUMNS)


@dataclass
class Chronos2ZeroShot:
    """Experimental pretrained benchmark. CPU only, pinned checkpoint revision, no fine-tuning."""

    name: str = "chronos2"
    context_length: int | None = None
    _pipeline: Any = None

    def _load(self):
        if self._pipeline is None:
            try:
                import torch
                from chronos import Chronos2Pipeline
            except ImportError as error:  # optional dependency
                raise RuntimeError("Chronos-2 is optional; install data-platform/requirements-forecasting-optional.txt") from error
            torch.manual_seed(0)
            self._pipeline = Chronos2Pipeline.from_pretrained(
                os.environ.get("ANI_CHRONOS_MODEL", CHRONOS_MODEL_ID), revision=CHRONOS_REVISION, device_map="cpu",
            )
        return self._pipeline

    def predict(self, view: dict[str, pd.Series], horizons: tuple[int, ...], level: int) -> pd.DataFrame:
        pipeline = self._load()
        tail = (100 - level) / 200
        quantiles = [round(tail, 4), 0.5, round(1 - tail, 4)]
        ids = list(view)
        inputs = [view[s].to_numpy(dtype=np.float32) for s in ids]
        quantile_out, _ = pipeline.predict_quantiles(inputs, prediction_length=max(horizons), quantile_levels=quantiles)
        rows = []
        for series_id, tensor in zip(ids, quantile_out):
            values = np.sort(np.asarray(tensor, dtype=float).reshape(-1, max(horizons), len(quantiles))[0], axis=1)
            for horizon in horizons:
                low, mid, high = values[horizon - 1]
                rows.append({"series_id": series_id, "horizon": horizon, "median": mid, "lower": low, "upper": high})
        return pd.DataFrame(rows, columns=PREDICTION_COLUMNS)


@dataclass
class TimesFM25ZeroShot:
    """Experimental pretrained benchmark: Google TimesFM 2.5 (200M). CPU only, pinned checkpoint, no fine-tuning."""

    name: str = "timesfm25"
    _model: Any = None

    def _load(self, horizon: int):
        if self._model is None:
            try:
                import timesfm
                import torch
            except ImportError as error:  # optional dependency
                raise RuntimeError("TimesFM is optional; install timesfm[torch]==3.0.2") from error
            torch.manual_seed(0)
            model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(
                os.environ.get("ANI_TIMESFM_MODEL", TIMESFM_MODEL_ID), revision=TIMESFM_REVISION, torch_compile=False)
            model.compile(timesfm.ForecastConfig(max_context=512, max_horizon=max(horizon, 16), normalize_inputs=True,
                                                 use_continuous_quantile_head=True, fix_quantile_crossing=True,
                                                 infer_is_positive=True))
            self._model = model
        return self._model

    def predict(self, view: dict[str, pd.Series], horizons: tuple[int, ...], level: int) -> pd.DataFrame:
        if level != 80:
            raise ValueError("TimesFM's quantile head gives deciles; only the 80% interval (q10–q90) is supported.")
        model = self._load(max(horizons))
        ids = list(view)
        _, quantiles = model.forecast(horizon=max(horizons), inputs=[view[s].to_numpy(dtype=np.float32) for s in ids])
        rows = []
        for series_id, q in zip(ids, np.asarray(quantiles, dtype=float)):
            for horizon in horizons:
                # Columns are the mean, then the 10th..90th percentiles.
                low, mid, high = np.sort([q[horizon - 1, 1], q[horizon - 1, 5], q[horizon - 1, 9]])
                rows.append({"series_id": series_id, "horizon": horizon, "median": mid, "lower": low, "upper": high})
        return pd.DataFrame(rows, columns=PREDICTION_COLUMNS)


def median_ensemble(members: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Equal-weight median of the members' medians and of their bounds, per series and horizon."""
    stacked = pd.concat(members.values(), ignore_index=True)
    combined = stacked.groupby(["series_id", "horizon"], as_index=False)[["median", "lower", "upper"]].median()
    combined["lower"] = np.minimum(combined["lower"], combined["median"])
    combined["upper"] = np.maximum(combined["upper"], combined["median"])
    return combined[PREDICTION_COLUMNS]


def run_models(view: dict[str, pd.Series], config: ExperimentConfig, horizons: tuple[int, ...],
               models: tuple[str, ...], cache: dict[str, Any] | None = None) -> tuple[dict[str, pd.DataFrame], dict[str, str]]:
    """Return predictions per model and an error message per model that failed at this origin."""
    cache = cache if cache is not None else {}
    results: dict[str, pd.DataFrame] = {}
    errors: dict[str, str] = {}
    stats_names = tuple(m for m in models if m in {"last_value", "seasonal_naive", "auto_arima", "auto_ets", "theta"})
    if stats_names:
        try:
            results.update(StatsForecastModels(stats_names, config.season_length).predict_all(view, horizons, config.interval_level))
        except Exception as error:  # noqa: BLE001 - recorded per model and origin
            errors.update({name: f"{type(error).__name__}: {error}" for name in stats_names})
    for name in models:
        if name in stats_names or name == "ensemble":
            continue
        try:
            if name == "lightgbm":
                model = LightGBMDirect(config)
            elif name == "chronos2":
                model = cache.setdefault("chronos2", Chronos2ZeroShot())
            elif name == "timesfm25":
                model = cache.setdefault("timesfm25", TimesFM25ZeroShot())
            else:
                raise ValueError(f"Unknown model {name}")
            results[name] = model.predict(view, horizons, config.interval_level)
        except Exception as error:  # noqa: BLE001
            errors[name] = f"{type(error).__name__}: {error}"
    if "ensemble" in models:
        missing = [m for m in ENSEMBLE_MEMBERS if m not in results]
        if missing:
            errors["ensemble"] = f"MissingMembers: {', '.join(missing)}"
        else:
            results["ensemble"] = median_ensemble({m: results[m] for m in ENSEMBLE_MEMBERS})
    return results, errors

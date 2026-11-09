"""Leakage-safe features.

Every feature at origin p uses only values with period <= p (backward shifts and trailing windows only).
The supervised target is the log return log(y[p+h] / y[p]); forecasts are y[p] * exp(prediction).
Covariates are joined only when their recorded availability time is at or before the origin cutoff.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

LAGS = tuple(range(1, 13))
WINDOWS = (3, 6, 12)


@dataclass(frozen=True)
class ExogenousValue:
    """A covariate value together with the time it actually became available to ANI."""

    name: str
    period: pd.Period
    value: float
    available_at: pd.Timestamp


def log_panel(view: dict[str, pd.Series]) -> pd.DataFrame:
    """Periods x series log prices. Missing periods stay NaN."""
    return pd.DataFrame({key: np.log(values.astype(float)) for key, values in view.items()}).sort_index()


def _peer_median(panel: pd.DataFrame, series_id: str, months: int) -> pd.Series:
    if panel.shape[1] < 2:
        return pd.Series(np.nan, index=panel.index)
    # Index arithmetic, not positional shift, so a missing month never pairs non-adjacent prices.
    shifted = panel.copy()
    shifted.index = shifted.index + months
    returns = (panel - shifted.reindex(panel.index)).drop(columns=[series_id], errors="ignore")
    return returns.median(axis=1, skipna=True)


def series_features(history: pd.Series, horizon: int, *, series_id: str = "", panel: pd.DataFrame | None = None,
                    season_length: int = 12, exogenous: list[ExogenousValue] | None = None,
                    cutoff_for_origin=None, covariates: pd.DataFrame | None = None) -> pd.DataFrame:
    """Feature rows for every origin in a contiguous positive history (index = origin period)."""
    if history.empty or (history <= 0).any() or history.isna().any():
        raise ValueError("Feature history must be non-empty, positive and without gaps.")
    logs = np.log(history.astype(float))
    frame = pd.DataFrame(index=history.index)
    frame["horizon"] = float(horizon)
    for lag in LAGS:
        frame[f"lag_{lag}_logratio"] = logs.shift(lag) - logs
    for window in WINDOWS:
        rolled = history.rolling(window, min_periods=window)
        frame[f"rolling_mean_{window}_logratio"] = np.log(rolled.mean()) - logs
        frame[f"rolling_median_{window}_logratio"] = np.log(rolled.median()) - logs
    returns = logs.diff()
    frame["momentum_1"] = returns
    frame["momentum_3"] = logs - logs.shift(3)
    frame["volatility_6"] = returns.rolling(6, min_periods=6).std()
    frame["volatility_12"] = returns.rolling(12, min_periods=12).std()
    seasonal_lag = season_length - horizon
    frame["seasonal_logratio"] = (logs.shift(seasonal_lag) - logs) if seasonal_lag >= 0 else np.nan
    if isinstance(history.index, pd.PeriodIndex):
        target_month = np.asarray((history.index + horizon).month)
        frame["target_month_sin"] = np.sin(2 * np.pi * target_month / 12)
        frame["target_month_cos"] = np.cos(2 * np.pi * target_month / 12)
    if panel is not None:
        frame["peer_median_return_1"] = _peer_median(panel, series_id, 1).reindex(frame.index)
        frame["peer_median_return_3"] = _peer_median(panel, series_id, 3).reindex(frame.index)
    if covariates is not None:
        # Indexed by the origin month at which each value was already published (covariates.monthly_covariates), so
        # a row only ever sees outside data available at its own origin.
        for column in covariates.columns:
            frame[f"exog_{column}"] = covariates[column].reindex(frame.index).to_numpy(dtype=float)
    for item in exogenous or []:
        column = f"exog_{item.name}"
        if column not in frame:
            frame[column] = np.nan
        for origin in frame.index:
            cutoff = cutoff_for_origin(origin) if cutoff_for_origin else None
            if cutoff is not None and item.available_at <= cutoff and item.period <= origin:
                frame.loc[origin, column] = item.value
    return frame


def supervised(history: pd.Series, horizon: int, **kwargs) -> tuple[pd.DataFrame, pd.Series, pd.Series]:
    """(training features, training targets, features at the final origin).

    Training rows are those whose target period is inside `history`, i.e. already observed at the origin.
    """
    features = series_features(history, horizon, **kwargs)
    logs = np.log(history.astype(float))
    target = logs.shift(-horizon) - logs
    observed = target.notna()
    return features[observed], target[observed], features.iloc[-1]

"""Outlook calibration: volatility-scaled forecast ranges and direction odds for 1..H months ahead.

The point forecast stays the published baseline unless a model has been validated on prospective outcomes; what this
module adds is the uncertainty around it. For each horizon it pools every variety's walk-forward errors on the log
scale, divides each by that series' recent volatility at the origin (so a calm and a volatile month are comparable),
and publishes the quantiles of those scaled errors. The API applies them to the latest price and the latest volatility,
so ranges widen when prices are swinging and tighten when they are calm, and are percentage-based rather than a fixed
rupee width. The same distribution gives the chance that the price ends higher than the last official price.

Honesty checks: quantiles are first fitted on the earlier origins only and scored on the last `test_origins`, and
that held-out coverage and direction accuracy are published next to the final (all-origin) quantiles.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .datasets import ForecastDataset

GRID = tuple(round(q, 2) for q in np.arange(0.05, 0.96, 0.05))
VOL_WINDOW = 12
MIN_VOL = 0.01


def recent_volatility(values: pd.Series, origin: pd.Period, window: int = VOL_WINDOW) -> float | None:
    """Root-mean-square monthly log return over the `window` months ending at `origin` (history only).

    Measured around zero, not around the average move: the point forecasts carry a price forward, so a steady fall
    is exactly the kind of move they miss and must count as volatility.
    """
    history = values[values.index <= origin].astype(float)
    returns = np.diff(np.log(history.to_numpy()))[-window:]
    if len(returns) < window // 2:
        return None
    return max(float(np.sqrt(np.mean(returns ** 2))), MIN_VOL)


def _scaled_errors(rows: pd.DataFrame, dataset: ForecastDataset, model_for: dict[tuple[str, int], str]) -> pd.DataFrame:
    values = {s.series_id: s.values for s in dataset.eligible_series}
    scored = rows[rows.actual.notna() & rows.series_id.isin(values)].copy()
    scored = scored[[model_for.get((s, int(h))) == m for s, h, m in zip(scored.series_id, scored.horizon, scored.model)]]
    origins = pd.PeriodIndex(scored.origin.astype(str), freq="M")
    vol = [recent_volatility(values[s], o) for s, o in zip(scored.series_id, origins)]
    scored["vol"] = vol
    scored = scored[scored.vol.notna()]
    scored["z"] = (np.log(scored.actual.astype(float)) - np.log(scored["median"].astype(float))) / scored.vol
    # Signed move the forecast implied relative to the last observed price, for scoring direction odds.
    scored["move"] = np.log(scored["median"].astype(float)) - np.log(scored.last_value.astype(float))
    scored["up"] = scored.actual.astype(float) > scored.last_value.astype(float)
    return scored


def _quantiles(z: np.ndarray) -> list[float]:
    return [float(v) for v in np.quantile(z, GRID)]


def chance_higher(quantiles: list[float], move: float, vol: float) -> float:
    """P(actual > last price) when log(actual) = log(point) + vol * z and z follows the published quantile grid.

    Between grid points the distribution is linear; beyond the outer quantiles half the remaining tail is assumed.
    """
    threshold = -move / vol  # z above this means the price ends higher than the last observed price
    below = float(np.interp(threshold, quantiles, GRID, left=GRID[0] / 2, right=1 - (1 - GRID[-1]) / 2))
    return 1.0 - below


def build_outlook(rows: pd.DataFrame, dataset: ForecastDataset, evaluation: dict[str, Any], horizons: tuple[int, ...],
                  level: int, test_origins: int = 12) -> dict[str, Any]:
    tail = (100 - level) / 200
    lo_i, hi_i = GRID.index(round(tail, 2)), GRID.index(round(1 - tail, 2))
    # The point model per series and horizon is the evaluation's baseline (the better of the two simple rules).
    # A challenger replaces it only after prospective validation, which the API decides; the engine never does.
    model_for = {(g["series_id"], int(g["horizon"])): g["baseline_model"] for g in evaluation["groups"]}
    scored = _scaled_errors(rows, dataset, model_for)
    origins = sorted(scored.origin.astype(str).unique())
    cutoff = origins[-test_origins] if len(origins) > test_origins else None
    out = []
    for h in horizons:
        group = scored[scored.horizon == h]
        if len(group) < 30:
            continue
        final = _quantiles(group.z.to_numpy())
        entry: dict[str, Any] = {"horizon": h, "quantiles": final, "n": int(len(group)),
                                 "series": int(group.series_id.nunique())}
        if cutoff is not None:
            fit, test = group[group.origin.astype(str) < cutoff], group[group.origin.astype(str) >= cutoff]
            if len(fit) >= 30 and len(test) >= 10:
                q = _quantiles(fit.z.to_numpy())
                inside = (test.z >= q[lo_i]) & (test.z <= q[hi_i])
                p_up = np.array([chance_higher(q, m, v) for m, v in zip(test.move, test.vol)])
                brier = float(np.mean((p_up - test.up.astype(float)) ** 2))
                climatology = float(np.mean((float(fit.up.mean()) - test.up.astype(float)) ** 2))
                width = np.exp(test.vol * q[hi_i]) - np.exp(test.vol * q[lo_i])
                entry["test"] = {"n": int(len(test)), "from": cutoff, "coverage": float(inside.mean()),
                                 "direction_brier": brier, "climatology_brier": climatology,
                                 "median_width_pct": float(np.median(width) * 100)}
        out.append(entry)
    return {"method": "volatility-scaled pooled walk-forward errors", "level": level, "grid": list(GRID),
            "vol_window": VOL_WINDOW, "horizons": out,
            "point_rule": "Better of last value and seasonal naive per series and horizon; a challenger only after prospective validation."}

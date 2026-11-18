"""Outlook calibration: volatility-scaled forecast ranges and direction odds for 1..H months ahead.

The point forecast stays the published baseline unless a model has been validated on prospective outcomes; what this
module adds is the uncertainty around it. For each horizon it pools every variety's walk-forward errors on the log
scale, divides each by that series' recent volatility at the origin (so a calm and a volatile month are comparable),
and publishes the quantiles of those scaled errors. The API applies them to the latest price and the latest volatility,
so ranges widen when prices are swinging and tighten when they are calm, and are percentage-based rather than a fixed
rupee width. The same distribution gives the chance that the price ends higher than the last official price.

Honesty checks: quantiles are first fitted on the earlier origins only and scored on the last `test_origins`, and
that held-out coverage and direction accuracy are published next to the final (all-origin) quantiles.

Volatility method (`vol_method`): `rms` weighs the last 12 monthly returns equally; `ewma` weighs them by 0.94 per month
back (about 17 months of effective memory), so a large move fades instead of dropping out after a year.
`build_outlook_selected` fits both, scores them with the interval score on the same held-out origins and publishes
`ewma` only if it scores strictly better; the API measures today's volatility with whichever method is published.

Longer calibration history (`calibration`): the quantiles can instead be fitted on the baseline errors of a longer
series, the 2014+ median of APMC daily modal prices, centred on zero (every era leans its own way: errors ran high in
2020 and low in 2026, so no drift is assumed). The test still scores them on the evaluated series' own latest origins,
which is the series the API applies them to. On the official report's 2024-10..2026-09 origins this held the 80% range
near nominal (0.74-0.90) where the report's own few years did not (0.49-0.93), and kept direction odds near 50%.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .datasets import ForecastDataset

GRID = tuple(round(q, 2) for q in np.arange(0.05, 0.96, 0.05))
VOL_WINDOW = 12
MIN_VOL = 0.01
# Exponentially weighted volatility (shared/volatility.ts mirrors this exactly). The decay is the RiskMetrics monthly
# convention, fixed before it was compared with anything; it was not tuned on these prices.
VOL_LAMBDA = 0.94
VOL_MAX_RETURNS = 60
VOL_METHODS = ("rms", "ewma")


def recent_volatility(values: pd.Series, origin: pd.Period, window: int = VOL_WINDOW, method: str = "rms",
                      lam: float = VOL_LAMBDA, max_returns: int = VOL_MAX_RETURNS) -> float | None:
    """Volatility of monthly log returns up to `origin` (history only).

    Measured around zero, not around the average move: the point forecasts carry a price forward, so a steady fall
    is exactly the kind of move they miss and must count as volatility. `rms` is the root-mean-square of the last
    `window` returns. `ewma` weights the newest return 1, the one before `lam`, then `lam`², over at most `max_returns`
    returns. Both need `window // 2` returns and are floored at 1%.
    """
    history = values[values.index <= origin].astype(float)
    returns = np.diff(np.log(history.to_numpy()))
    if method == "ewma":
        recent = returns[-max_returns:]
        if len(recent) < window // 2:
            return None
        weights = lam ** np.arange(len(recent) - 1, -1, -1, dtype=float)
        return max(float(np.sqrt(np.sum(weights * recent ** 2) / np.sum(weights))), MIN_VOL)
    returns = returns[-window:]
    if len(returns) < window // 2:
        return None
    return max(float(np.sqrt(np.mean(returns ** 2))), MIN_VOL)


def _scaled_errors(rows: pd.DataFrame, dataset: ForecastDataset, model_for: dict[tuple[str, int], str],
                   method: str = "rms") -> pd.DataFrame:
    values = {s.series_id: s.values for s in dataset.eligible_series}
    scored = rows[rows.actual.notna() & rows.series_id.isin(values)].copy()
    scored = scored[[model_for.get((s, int(h))) == m for s, h, m in zip(scored.series_id, scored.horizon, scored.model)]]
    origins = pd.PeriodIndex(scored.origin.astype(str), freq="M")
    vol = [recent_volatility(values[s], o, method=method) for s, o in zip(scored.series_id, origins)]
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
                  level: int, test_origins: int = 12, calibration: dict[str, Any] | None = None,
                  vol_method: str = "rms") -> dict[str, Any]:
    """`calibration` = {"rows", "dataset", "evaluation"} of a longer series' baseline backtest: its errors, centred on
    zero, give the quantiles; `rows`/`dataset` stay the series the test scores them on. `vol_method` is one of
    `VOL_METHODS`; the API reads it from the result and measures today's volatility the same way."""
    if vol_method not in VOL_METHODS:
        raise ValueError(f"Unknown volatility method {vol_method}")
    tail = (100 - level) / 200
    lo_i, hi_i = GRID.index(round(tail, 2)), GRID.index(round(1 - tail, 2))
    # The point model per series and horizon is the evaluation's baseline (the better of the two simple rules).
    # A challenger replaces it only after prospective validation, which the API decides; the engine never does.
    model_for = {(g["series_id"], int(g["horizon"])): g["baseline_model"] for g in evaluation["groups"]}
    scored = _scaled_errors(rows, dataset, model_for, vol_method)
    source = scored
    if calibration is not None:
        source = _scaled_errors(calibration["rows"], calibration["dataset"],
                                {(g["series_id"], int(g["horizon"])): g["baseline_model"] for g in calibration["evaluation"]["groups"]},
                                vol_method)

    def fitted(z: np.ndarray) -> list[float]:
        return _quantiles(z - np.median(z) if calibration is not None else z)

    origins = sorted(scored.origin.astype(str).unique())
    cutoff = origins[-test_origins] if len(origins) > test_origins else None
    out = []
    for h in horizons:
        group, pool = scored[scored.horizon == h], source[source.horizon == h]
        if len(pool) < 30:
            continue
        final = fitted(pool.z.to_numpy())
        entry: dict[str, Any] = {"horizon": h, "quantiles": final, "n": int(len(pool)),
                                 "series": int(pool.series_id.nunique())}
        if cutoff is not None:
            fit, test = pool[pool.origin.astype(str) < cutoff], group[group.origin.astype(str) >= cutoff]
            # The no-skill reference is the evaluated series' own base rate before the test.
            base = group[group.origin.astype(str) < cutoff]
            if len(fit) >= 30 and len(test) >= 10:
                q = fitted(fit.z.to_numpy())
                inside = (test.z >= q[lo_i]) & (test.z <= q[hi_i])
                p_up = np.array([chance_higher(q, m, v) for m, v in zip(test.move, test.vol)])
                brier = float(np.mean((p_up - test.up.astype(float)) ** 2))
                climatology = float(np.mean((float((base if len(base) else fit).up.mean()) - test.up.astype(float)) ** 2))
                width = np.exp(test.vol * q[hi_i]) - np.exp(test.vol * q[lo_i])
                # Interval score on the log scale, in percent (Gneiting & Raftery 2007): the width, plus a penalty of
                # 2/alpha times any miss. Lower is better; it rewards narrow ranges only while they still hold.
                low, high, x = test.vol * q[lo_i], test.vol * q[hi_i], test.vol * test.z
                alpha = (100 - level) / 100
                score = (high - low) + (2 / alpha) * ((low - x).clip(lower=0) + (x - high).clip(lower=0))
                entry["test"] = {"n": int(len(test)), "from": cutoff, "coverage": float(inside.mean()),
                                 "direction_brier": brier, "climatology_brier": climatology,
                                 "median_width_pct": float(np.median(width) * 100),
                                 "interval_score_pct": float(np.mean(score) * 100)}
        out.append(entry)
    result: dict[str, Any] = {"method": "volatility-scaled pooled walk-forward errors", "level": level, "grid": list(GRID),
                              "vol_window": VOL_WINDOW, "vol_method": vol_method, "horizons": out,
                              "point_rule": "Better of last value and seasonal naive per series and horizon; a challenger only after prospective validation."}
    if vol_method == "ewma":
        result.update(vol_lambda=VOL_LAMBDA, vol_max_returns=VOL_MAX_RETURNS)
    if calibration is not None:
        long = calibration["dataset"]
        result["method"] = (f"volatility-scaled pooled walk-forward errors of {long.key} ({long.price_basis}), centred on zero; "
                            f"tested on {dataset.key}")
        result["calibration"] = {"dataset": long.key, "price_basis": long.price_basis, "centred": True,
                                 "origins": [str(source.origin.min()), str(source.origin.max())] if len(source) else None,
                                 "series": int(source.series_id.nunique()), "tested_on": dataset.key}
    return result


def build_outlook_selected(*args: Any, **kwargs: Any) -> dict[str, Any]:
    """The outlook with whichever of `VOL_METHODS` scored better on the held-out test, `rms` unless `ewma` wins.

    Both are fitted and scored on identical points: the same errors, quantile fit and test origins, differing only in
    how volatility is measured. `ewma` is chosen only when its mean interval score over the horizons tested under both
    is strictly lower. The comparison is published in `vol_selection`. Because the test that chooses also reports the
    result, the chosen method's test is slightly optimistic; with two candidates fixed in advance the effect is small.
    """
    built = {method: build_outlook(*args, **kwargs, vol_method=method) for method in VOL_METHODS}
    scores: dict[str, float | None] = {}
    tested = [{e["horizon"] for e in built[m]["horizons"] if "test" in e} for m in VOL_METHODS]
    common = sorted(set.intersection(*tested)) if tested else []
    for method, outlook in built.items():
        values = [e["test"]["interval_score_pct"] for e in outlook["horizons"] if e["horizon"] in common]
        scores[method] = float(np.mean(values)) if values else None
    chosen = "ewma" if scores["ewma"] is not None and scores["rms"] is not None and scores["ewma"] < scores["rms"] else "rms"
    result = built[chosen]
    result["vol_selection"] = {
        "rule": "ewma only if its mean held-out interval score over commonly tested horizons is strictly lower than rms",
        "horizons": common, "interval_score_pct": scores, "chosen": chosen,
    }
    return result

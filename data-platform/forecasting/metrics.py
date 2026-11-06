"""Point, interval and significance metrics. All functions are pure and tested with synthetic inputs only."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy import stats


def _arrays(actual, predicted) -> tuple[np.ndarray, np.ndarray]:
    a = np.asarray(actual, dtype=float)
    p = np.asarray(predicted, dtype=float)
    if a.shape != p.shape or a.size == 0 or not np.isfinite(a).all() or not np.isfinite(p).all():
        raise ValueError("Metrics need equal-length, non-empty, finite arrays.")
    return a, p


def mae(actual, predicted) -> float:
    a, p = _arrays(actual, predicted)
    return float(np.mean(np.abs(a - p)))


def rmse(actual, predicted) -> float:
    a, p = _arrays(actual, predicted)
    return float(np.sqrt(np.mean((a - p) ** 2)))


def wape(actual, predicted) -> float | None:
    a, p = _arrays(actual, predicted)
    denominator = float(np.sum(np.abs(a)))
    return None if denominator == 0 else float(np.sum(np.abs(a - p)) / denominator)


def mase(actual, predicted, scales) -> float | None:
    """Mean of |error| / per-point in-sample naive scale (seasonal when enough training history)."""
    a, p = _arrays(actual, predicted)
    s = np.asarray(scales, dtype=float)
    if s.shape != a.shape or not np.isfinite(s).all() or (s <= 0).any():
        return None
    return float(np.mean(np.abs(a - p) / s))


def naive_scale(training: np.ndarray, season_length: int = 12) -> float | None:
    """In-sample MAE of the seasonal naive (or lag-1 naive when fewer than two seasons are available)."""
    values = np.asarray(training, dtype=float)
    lag = season_length if values.size >= 2 * season_length else 1
    if values.size <= lag:
        return None
    scale = float(np.mean(np.abs(values[lag:] - values[:-lag])))
    return scale if scale > 0 else None


def directional_accuracy(actual, predicted, last_observed) -> tuple[float | None, int]:
    """Share of correct up/down calls among points where the model made a directional call.

    A model whose median equals the last observed value (for example last value) makes no call and gets None.
    Unchanged actuals count as a miss for any directional call.
    """
    a, p = _arrays(actual, predicted)
    last = np.asarray(last_observed, dtype=float)
    call = np.sign(p - last)
    outcome = np.sign(a - last)
    made = call != 0
    count = int(made.sum())
    if count == 0:
        return None, 0
    return float(np.mean(call[made] == outcome[made])), count


def interval_coverage(actual, lower, upper) -> float:
    a, lo = _arrays(actual, lower)
    _, hi = _arrays(actual, upper)
    return float(np.mean((a >= lo) & (a <= hi)))


def interval_width(lower, upper, actual=None) -> dict[str, float | None]:
    lo, hi = _arrays(lower, upper)
    width = hi - lo
    relative = None
    if actual is not None:
        a, _ = _arrays(actual, lower)
        relative = float(np.mean(width / a)) if (a > 0).all() else None
    return {"mean": float(np.mean(width)), "relative_mean": relative}


def coverage_test(covered: int, total: int, nominal: float) -> float:
    """One-sided exact binomial p-value for coverage being below nominal."""
    if total <= 0:
        return math.nan
    return float(stats.binomtest(covered, total, nominal, alternative="less").pvalue)


def diebold_mariano(baseline_errors, candidate_errors, horizon: int) -> dict[str, Any]:
    """One-sided DM test with the Harvey-Leybourne-Newbold small-sample correction.

    Loss = absolute error; d = |e_baseline| - |e_candidate|. H1: the candidate has lower expected loss.
    Long-run variance uses Newey-West (Bartlett) weights up to lag horizon-1.
    """
    b = np.abs(np.asarray(baseline_errors, dtype=float))
    c = np.abs(np.asarray(candidate_errors, dtype=float))
    if b.shape != c.shape or b.size < 3:
        return {"statistic": None, "p_value": None, "n": int(b.size)}
    d = b - c
    n = d.size
    mean = d.mean()
    centred = d - mean
    variance = float(np.dot(centred, centred) / n)
    for lag in range(1, max(horizon, 1)):
        if lag >= n:
            break
        weight = 1 - lag / horizon
        variance += 2 * weight * float(np.dot(centred[lag:], centred[:-lag]) / n)
    if variance <= 0:
        if mean > 0:
            return {"statistic": math.inf, "p_value": 0.0, "n": n}
        return {"statistic": None, "p_value": 1.0, "n": n}
    statistic = mean / math.sqrt(variance / n)
    correction = math.sqrt((n + 1 - 2 * horizon + horizon * (horizon - 1) / n) / n)
    statistic *= correction
    p_value = float(stats.t.sf(statistic, df=n - 1))
    return {"statistic": float(statistic), "p_value": p_value, "n": n}


def holm_adjust(p_values: list[float | None]) -> list[float | None]:
    """Holm-Bonferroni step-down adjusted p-values (family-wise error control). None stays None."""
    indexed = [(p, i) for i, p in enumerate(p_values) if p is not None and not math.isnan(p)]
    m = len(indexed)
    adjusted: list[float | None] = [None] * len(p_values)
    running = 0.0
    for rank, (p, i) in enumerate(sorted(indexed)):
        running = max(running, min(1.0, (m - rank) * p))
        adjusted[i] = running
    return adjusted


def summarize(actual, median, lower, upper, last_observed, scales, nominal: float) -> dict[str, Any]:
    a = np.asarray(actual, dtype=float)
    covered = int(np.sum((a >= np.asarray(lower)) & (a <= np.asarray(upper))))
    direction, calls = directional_accuracy(actual, median, last_observed)
    return {
        "n": int(a.size), "mae": mae(actual, median), "rmse": rmse(actual, median), "wape": wape(actual, median),
        "mase": mase(actual, median, scales), "directional_accuracy": direction, "directional_calls": calls,
        "interval_coverage": covered / a.size, "interval_covered": covered,
        "interval_width": interval_width(lower, upper, actual)["mean"],
        "interval_relative_width": interval_width(lower, upper, actual)["relative_mean"],
        "coverage_p_value_below_nominal": coverage_test(covered, int(a.size), nominal),
    }

"""Python parity port of the Worker's `monthly-baselines-v1` evaluator (api/src/forecast.ts).

Used to (1) prove the port reproduces stored `forecast_snapshots` exactly and (2) compare the existing
published reference with the experimental engine on the same holdout months. It never writes snapshots.
"""

from __future__ import annotations

import json
import math
import sqlite3
from typing import Any

import pandas as pd

BLOCK = 12
INITIAL_HISTORY = 24
MIN_FORECAST_MONTHS = INITIAL_HISTORY + BLOCK * 3
INTERVAL_LEVEL = 0.8
LEGACY_VERSION = "monthly-baselines-v1"


def _score(actual: list[float], predicted: list[float]) -> dict[str, float]:
    errors = [abs(a - p) for a, p in zip(actual, predicted)]
    n = len(actual)
    return {"count": n, "mae": sum(errors) / n, "rmse": math.sqrt(sum(e * e for e in errors) / n),
            "smape_percent": sum(200 * e / (a + p) for e, a, p in zip(errors, actual, predicted)) / n}


def _origins(values: list[float], months: list[str], start: int, end: int) -> list[dict[str, Any]]:
    return [{"reporting_month": months[i], "actual": values[i], "last_value": values[i - 1],
             "seasonal_naive": values[i - 12]} for i in range(start, end)]


def _radius(errors: list[float], level: float = INTERVAL_LEVEL) -> float:
    rank = math.ceil((len(errors) + 1) * level)
    if rank > len(errors):
        raise ValueError("Too few calibration errors for a finite interval")
    return sorted(errors)[rank - 1]


def legacy_evaluate(months: list[str], values: list[float]) -> dict[str, Any]:
    """Reproduces the evaluation block of `evaluateForecast` for an already-validated contiguous history."""
    n = len(values)
    if n < MIN_FORECAST_MONTHS:
        raise ValueError("insufficient_history")
    validation = _origins(values, months, n - 36, n - 24)
    calibration = _origins(values, months, n - 24, n - 12)
    holdout = _origins(values, months, n - 12, n)

    def metric(points, model):
        return _score([p["actual"] for p in points], [p[model] for p in points])

    val = {"last_value": metric(validation, "last_value"), "seasonal_naive": metric(validation, "seasonal_naive")}
    selected = "seasonal_naive" if val["seasonal_naive"]["mae"] < val["last_value"]["mae"] else "last_value"
    radius = _radius([abs(p["actual"] - p[selected]) for p in calibration])
    selected_scores, naive_scores = metric(holdout, selected), metric(holdout, "last_value")
    publishable = all(selected_scores[k] <= naive_scores[k] + 1e-9 for k in ("mae", "rmse", "smape_percent"))
    covered = sum(abs(p["actual"] - p[selected]) <= radius for p in holdout)
    point = values[-1] if selected == "last_value" else values[n - 12]
    return {"selected_model": selected, "radius": radius, "holdout": holdout, "holdout_selected": selected_scores,
            "holdout_naive": naive_scores, "covered": covered, "publishable": publishable,
            "forecast": {"point": point, "lower": max(0.0, point - radius), "upper": point + radius} if publishable else None}


def parity_check(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Re-run the port on each variety's latest stored snapshot inputs and compare with its stored results."""
    rows = conn.execute(
        """SELECT s.variety_name, s.evaluated_at, s.inputs_json, s.results_json FROM forecast_snapshots s
           WHERE s.formula_version = ? AND s.rowid = (SELECT s2.rowid FROM forecast_snapshots s2
             WHERE s2.variety_name = s.variety_name ORDER BY s2.evaluated_at DESC, s2.rowid DESC LIMIT 1)
           ORDER BY s.variety_name""", (LEGACY_VERSION,),
    ).fetchall()
    report = []
    for variety, evaluated_at, inputs_json, results_json in rows:
        stored = json.loads(results_json)
        entry: dict[str, Any] = {"variety": variety, "evaluated_at": evaluated_at,
                                 "stored_publishable": stored.get("publishable"), "stored_reasons": stored.get("reasons", [])}
        if not stored.get("evaluation"):
            entry.update({"compared": False, "match": None})
            report.append(entry)
            continue
        prices = sorted(json.loads(inputs_json)["prices"], key=lambda r: r["reporting_month"])
        result = legacy_evaluate([p["reporting_month"] for p in prices], [float(p["weighted_price"]) for p in prices])
        evaluation = stored["evaluation"]
        expected = {
            "selected_model": evaluation["selected_model"],
            "radius": evaluation["calibration"]["absolute_residual_radius"],
            "holdout_mae": evaluation["holdout"]["selected"]["mae"],
            "holdout_rmse": evaluation["holdout"]["selected"]["rmse"],
            "covered": evaluation["holdout"]["covered"], "publishable": stored["publishable"],
        }
        actual = {"selected_model": result["selected_model"], "radius": result["radius"],
                  "holdout_mae": result["holdout_selected"]["mae"], "holdout_rmse": result["holdout_selected"]["rmse"],
                  "covered": result["covered"], "publishable": result["publishable"]}
        match = all(
            math.isclose(actual[k], expected[k], rel_tol=1e-9, abs_tol=1e-6) if isinstance(expected[k], float)
            else actual[k] == expected[k] for k in expected
        )
        entry.update({"compared": True, "match": match, "expected": expected, "actual": actual,
                      "holdout_months": [p["reporting_month"] for p in result["holdout"]]})
        report.append(entry)
    return report


def compare_with_engine(parity: list[dict[str, Any]], backtest_rows: pd.DataFrame) -> list[dict[str, Any]]:
    """Legacy selected-model holdout MAE vs each engine model's one-step MAE on the same target months."""
    output = []
    one_step = backtest_rows[(backtest_rows.horizon == 1) & backtest_rows.actual.notna()]
    for entry in parity:
        if not entry.get("compared"):
            continue
        series_id = f"KA|{entry['variety']}"
        part = one_step[(one_step.series_id == series_id) & one_step.target.isin(entry["holdout_months"])]
        engine = {}
        for model, frame in part.groupby("model"):
            if len(frame) == len(entry["holdout_months"]):
                engine[model] = float((frame["median"] - frame.actual).abs().mean())
        output.append({"variety": entry["variety"], "holdout_months": len(entry["holdout_months"]),
                       "legacy_model": entry["actual"]["selected_model"], "legacy_mae": entry["actual"]["holdout_mae"],
                       "legacy_publishable": entry["actual"]["publishable"], "engine_mae": engine})
    return output

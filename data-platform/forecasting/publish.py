"""Build and send the experiment payload to the ANI API (`POST /admin/forecasting/experiments`).

Only real database datasets can be published. The API independently re-checks that every prediction's
`last_observed_value` matches a stored observation, so synthetic or edited data is rejected server-side too.
"""

from __future__ import annotations

import json
import math
import os
import urllib.error
import urllib.request
from typing import Any

import pandas as pd

from . import ENGINE_VERSION
from .backtest import BacktestResult
from .config import BASELINE_MODELS as BASELINES, MODEL_VERSIONS, ExperimentConfig
from .datasets import ForecastDataset


class PublicationRefused(ValueError):
    pass


def _number(value: Any) -> float | None:
    if value is None:
        return None
    value = float(value)
    return None if math.isnan(value) or math.isinf(value) else value


def _coverage_status(metrics: dict[str, Any] | None, config: ExperimentConfig) -> str:
    if not metrics:
        return "not_evaluated"
    if metrics["interval_coverage"] < config.min_coverage_floor or metrics["coverage_p_value_below_nominal"] < config.alpha:
        return "below_nominal"
    return "consistent_with_nominal"


def build_payload(*, run_id: str, created_at: str, config: ExperimentConfig, config_hash: str, env: dict[str, Any],
                  datasets: dict[str, ForecastDataset], evaluated: ForecastDataset, result: BacktestResult,
                  evaluation: dict[str, Any]) -> dict[str, Any]:
    if any(d.provenance != "database" for d in datasets.values()):
        raise PublicationRefused("Synthetic or non-database datasets can never be published.")
    if not evaluated.publication_eligible:
        raise PublicationRefused(f"Dataset {evaluated.key} is not publication-eligible: {evaluated.suppression_reasons}")
    series_meta = {s.series_id: s for s in evaluated.series}
    eval_rows = []
    status_lookup: dict[tuple[str, int, str], dict[str, Any]] = {}
    for group in evaluation["groups"]:
        meta = series_meta[group["series_id"]]
        for model, item in group["models"].items():
            m = item["metrics"]
            status_lookup[(group["series_id"], group["horizon"], model)] = item
            dm = item.get("dm") or {}
            eval_rows.append({
                "dataset_key": evaluated.key, "series_id": group["series_id"], "market": meta.market,
                "variety": meta.variety, "grade": meta.grade, "price_basis": evaluated.price_basis,
                "horizon": group["horizon"], "model": model, "model_version": MODEL_VERSIONS[model],
                "baseline_model": group["baseline_model"], "status": item["status"], "reasons": item["reasons"],
                "n": m["n"], "mae": _number(m["mae"]), "rmse": _number(m["rmse"]), "wape": _number(m["wape"]),
                "mase": _number(m["mase"]), "directional_accuracy": _number(m["directional_accuracy"]),
                "interval_coverage": _number(m["interval_coverage"]), "interval_width": _number(m["interval_width"]),
                "dm_statistic": _number(dm.get("statistic")), "p_value": _number(dm.get("p_value")),
                "p_value_holm": _number(item.get("p_value_holm")),
                "mae_skill_vs_baseline": _number(item.get("mae_skill_vs_baseline")),
                "coverage_status": _coverage_status(m, config),
            })
    latest_origin = result.rows.origin.max()
    live = result.rows[(result.rows.origin == latest_origin) & result.rows.actual.isna()]
    predictions = []
    for row in live.itertuples(index=False):
        meta = series_meta[row.series_id]
        item = status_lookup.get((row.series_id, int(row.horizon), row.model))
        predictions.append({
            "dataset_key": evaluated.key, "series_id": row.series_id, "market": meta.market, "variety": meta.variety,
            "grade": meta.grade, "price_basis": evaluated.price_basis, "unit": evaluated.unit, "model": row.model,
            "model_version": MODEL_VERSIONS[row.model], "origin_period": row.origin, "target_period": row.target,
            "horizon": int(row.horizon), "median": float(row.median), "lower": max(0.0, float(row.lower)),
            "upper": float(row.upper), "interval_level": config.interval_level,
            "last_observed_value": float(row.last_value), "input_data_version": evaluated.data_version,
            "evaluation_status": item["status"] if item else "not_evaluated",
            "coverage_status": _coverage_status(item["metrics"] if item else None, config),
        })
    if any(p["median"] <= 0 or p["lower"] > p["median"] or p["median"] > p["upper"] for p in predictions):
        raise PublicationRefused("Prediction intervals must satisfy 0 <= lower <= median <= upper.")
    return {
        "experiment": {
            "id": run_id, "engine_version": ENGINE_VERSION, "created_at": created_at, "config_hash": config_hash,
            "vintage_mode": result.vintage_mode, "dataset_key": evaluated.key, "price_basis": evaluated.price_basis,
            "input_data_version": evaluated.data_version, "origin_period": str(latest_origin),
            "origins_evaluated": result.origins_evaluated, "multiple_testing": evaluation["multiple_testing"],
            "config": config.to_dict(), "environment": env, "model_errors": result.model_errors[:50],
        },
        "datasets": [{
            "key": d.key, "price_basis": d.price_basis, "frequency": d.frequency, "unit": d.unit,
            "unit_status": d.unit_status, "provenance": d.provenance, "data_version": d.data_version,
            "suppressed": d.suppressed, "suppression_reasons": d.suppression_reasons,
            "publication_eligible": d.publication_eligible, "series_total": len(d.series),
            "series_eligible": len(d.eligible_series), "observations": sum(s.observations for s in d.series),
            "notes": d.notes,
        } for d in datasets.values()],
        "evaluations": eval_rows,
        "predictions": predictions,
    }


def build_track(rows: pd.DataFrame, evaluated: ForecastDataset, pooled: list[dict[str, Any]], horizon: int = 1) -> dict[str, Any]:
    """One-step-ahead backtest record per series for the dashboard's track-record chart: the actual monthly price,
    the last-value baseline and the model with the lowest pooled MAE at this horizon, with its interval. Whole rupees."""
    ranked = sorted((r for r in pooled if r["horizon"] == horizon and r["mae"] is not None and r["model"] not in BASELINES),
                    key=lambda r: r["mae"])
    best = ranked[0]["model"] if ranked else "last_value"
    scored = rows[(rows.horizon == horizon) & rows.actual.notna()]
    series_meta = {s.series_id: s for s in evaluated.series}
    out = []
    for series_id, group in scored.groupby("series_id"):
        wide = group.pivot_table(index="target", columns="model", values=["median", "lower", "upper", "actual"], aggfunc="first")
        if ("median", best) not in wide.columns or ("median", "last_value") not in wide.columns:
            continue
        wide = wide.dropna(subset=[("median", best), ("median", "last_value")]).sort_index()
        whole = lambda column: [int(round(v)) for v in wide[column].to_numpy(dtype=float)]  # noqa: E731
        out.append({"series_id": series_id, "variety": series_meta[series_id].variety, "periods": [str(p) for p in wide.index],
                    "actual": whole(("actual", "last_value")), "baseline": whole(("median", "last_value")),
                    "median": whole(("median", best)), "lower": whole(("lower", best)), "upper": whole(("upper", best))})
    return {"model": best, "horizon": horizon, "series": out}


def _redact(text: str, token: str) -> str:
    return text.replace(token, "***") if token else text


def post_payload(payload: dict[str, Any], api_url: str | None = None, token: str | None = None,
                 timeout: float = 60.0) -> dict[str, Any]:
    api_url = (api_url or os.environ.get("ANI_API_URL", "")).rstrip("/")
    token = token or os.environ.get("INGESTION_TOKEN", "")
    if not api_url or not token:
        raise RuntimeError("Set ANI_API_URL and INGESTION_TOKEN to publish (or use --dry-run).")
    url = f"{api_url}/admin/forecasting/experiments"
    request = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), method="POST",
                                     # Cloudflare answers Python's default user agent with HTTP 403 (error code 1010).
                                     headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "ANI-data-platform/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = _redact(error.read().decode("utf-8", errors="replace")[:800], token)
        raise RuntimeError(f"ANI API returned HTTP {error.code}: {body}") from None
    except (urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError(f"ANI API request failed: {getattr(error, 'reason', error)}") from None


def prediction_frame(payload: dict[str, Any]) -> pd.DataFrame:
    return pd.DataFrame(payload["predictions"])

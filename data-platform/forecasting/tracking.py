"""Lightweight, file-based experiment tracking with optional MLflow mirroring.

Each run writes `data-platform/forecasting/runs/<run_id>/` (git-ignored): config, environment, dataset
manifest, backtest rows, evaluation, legacy comparison, report and the API payload.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone
from importlib import metadata
from pathlib import Path
from typing import Any

import pandas as pd

from . import ENGINE_VERSION
from .config import LICENCES

RUNS_DIR = Path(__file__).resolve().parent / "runs"
TRACKED_PACKAGES = ("pandas", "numpy", "scipy", "statsforecast", "statsmodels", "lightgbm", "scikit-learn",
                    "chronos-forecasting", "timesfm", "torch", "transformers", "mlflow")


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def environment() -> dict[str, Any]:
    versions = {}
    for package in TRACKED_PACKAGES:
        try:
            versions[package] = metadata.version(package)
        except metadata.PackageNotFoundError:
            versions[package] = None
    git = {"sha": None, "dirty": None}
    try:
        root = Path(__file__).resolve().parents[2]
        git["sha"] = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True, check=True).stdout.strip()
        git["dirty"] = bool(subprocess.run(["git", "status", "--porcelain"], cwd=root, capture_output=True, text=True).stdout.strip())
    except (OSError, subprocess.CalledProcessError):
        pass
    return {"engine_version": ENGINE_VERSION, "python": sys.version.split()[0], "platform": platform.platform(),
            "packages": versions, "licences": LICENCES, "git": git}


def new_run_id(config_hash: str, now: datetime | None = None) -> str:
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
    return f"fx-{stamp}-{config_hash[:10]}"


class RunRecorder:
    def __init__(self, run_id: str, root: Path = RUNS_DIR):
        self.run_id = run_id
        self.path = root / run_id
        self.path.mkdir(parents=True, exist_ok=False)

    def json(self, name: str, value: Any) -> Path:
        target = self.path / name
        target.write_text(json.dumps(value, indent=2, sort_keys=True, default=str) + "\n", encoding="utf-8")
        return target

    def frame(self, name: str, frame: pd.DataFrame) -> Path:
        target = self.path / name
        frame.to_csv(target, index=False)
        return target

    def text(self, name: str, value: str) -> Path:
        target = self.path / name
        target.write_text(value, encoding="utf-8")
        return target


def mirror_to_mlflow(run_id: str, params: dict[str, Any], metrics: dict[str, float], artifacts: Path) -> str | None:
    """Mirror to MLflow only when it is installed and ANI_MLFLOW_TRACKING_URI is set. Returns a status note."""
    uri = os.environ.get("ANI_MLFLOW_TRACKING_URI")
    if not uri:
        return None
    try:
        import mlflow  # type: ignore[import-not-found]
    except ImportError:
        return "ANI_MLFLOW_TRACKING_URI is set but mlflow is not installed; file tracking only."
    mlflow.set_tracking_uri(uri)
    mlflow.set_experiment("ani-forecasting")
    with mlflow.start_run(run_name=run_id):
        mlflow.log_params({k: str(v)[:500] for k, v in params.items()})
        mlflow.log_metrics({k: v for k, v in metrics.items() if v is not None})
        mlflow.log_artifacts(str(artifacts))
    return f"Mirrored to MLflow at {uri}."

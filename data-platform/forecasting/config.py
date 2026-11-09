"""Pre-registered experiment settings. Changing any value changes the experiment configuration hash."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

INTERVAL_LEVEL = 80
SIGNIFICANCE_ALPHA = 0.05

# Observation-level basis codes come from migration 0014. The monthly AGMARKNET report is a derived,
# arrival-weighted state average, so it receives its own forecasting-only basis label and is never
# presented as an APMC modal price.
MONTHLY_BASIS = "MONTHLY_STATE_WEIGHTED_AVERAGE"
PRICE_BASES = {"APMC_MODAL", "COOPERATIVE_AVERAGE", "COOPERATIVE_TENDER_AVERAGE", MONTHLY_BASIS}

BASELINE_MODELS = ("last_value", "seasonal_naive")
CANDIDATE_MODELS = ("auto_arima", "auto_ets", "theta", "lightgbm", "chronos2", "timesfm25", "ensemble")
# Members of the equal-weight ensemble, fixed before the run that first evaluated it (chosen as the three strongest
# individual models in fx-20261104T192118Z-5839b847aa). The ensemble takes the median of their medians and bounds.
ENSEMBLE_MEMBERS = ("theta", "auto_ets", "chronos2")

MODEL_VERSIONS = {
    "last_value": "statsforecast-naive-1",
    "seasonal_naive": "statsforecast-seasonal-naive-m12-1",
    "auto_arima": "statsforecast-autoarima-m12-1",
    "auto_ets": "statsforecast-autoets-m12-1",
    "theta": "statsforecast-theta-m12-1",
    "lightgbm": "lightgbm-direct-quantile-logreturn-1",
    "chronos2": "chronos2-zero-shot-1",
    "timesfm25": "timesfm-2.5-200m-zero-shot-1",
    "ensemble": "median-ensemble-theta-ets-chronos2-1",
}

# Verified 2026-11-05 from PyPI metadata and the Hugging Face model card/API (license: apache-2.0).
CHRONOS_MODEL_ID = "amazon/chronos-2"
CHRONOS_REVISION = "29ec3766d36d6f73f0696f85560a422f50e8498c"
# Verified 2026-11-09 from PyPI (timesfm 3.0.2, Apache-2.0) and the Hugging Face model API (license: apache-2.0).
TIMESFM_MODEL_ID = "google/timesfm-2.5-200m-pytorch"
TIMESFM_REVISION = "1d952420fba87f3c6dee4f240de0f1a0fbc790e3"
LICENCES = {
    "statsforecast": "Apache-2.0",
    "statsmodels": "BSD-3-Clause",
    "lightgbm": "MIT",
    "scikit-learn": "BSD-3-Clause",
    "chronos-forecasting": "Apache-2.0 (package 2.3.2)",
    "amazon/chronos-2": f"Apache-2.0 (checkpoint revision {CHRONOS_REVISION})",
    "timesfm": "Apache-2.0 (package 3.0.2)",
    "google/timesfm-2.5": f"Apache-2.0 (checkpoint revision {TIMESFM_REVISION})",
}


@dataclass(frozen=True)
class SufficiencyRule:
    min_series_observations: int
    min_walk_forward_origins: int
    max_gap_periods: int


@dataclass(frozen=True)
class ExperimentConfig:
    horizons: tuple[int, ...] = (1, 2, 3)
    interval_level: int = INTERVAL_LEVEL
    season_length: int = 12
    initial_training_periods: int = 36
    min_test_pairs: int = 24
    alpha: float = SIGNIFICANCE_ALPHA
    # Coverage gate: empirical coverage must not be significantly below nominal (one-sided binomial)
    # and must stay above this absolute floor.
    min_coverage_floor: float = 0.6
    # Used only to define the strict-vintage cutoff for an origin month; capture timestamps decide
    # what was actually available at that cutoff.
    monthly_publication_lag_days: int = 15
    models: tuple[str, ...] = BASELINE_MODELS + ("auto_arima", "auto_ets", "theta", "lightgbm")
    sufficiency: dict[str, SufficiencyRule] = field(default_factory=lambda: {
        "monthly": SufficiencyRule(min_series_observations=48, min_walk_forward_origins=24, max_gap_periods=0),
        "daily": SufficiencyRule(min_series_observations=250, min_walk_forward_origins=120, max_gap_periods=14),
    })
    lightgbm_params: dict[str, Any] = field(default_factory=lambda: {
        "n_estimators": 200, "learning_rate": 0.05, "num_leaves": 7, "min_child_samples": 10,
        "subsample": 1.0, "colsample_bytree": 1.0, "random_state": 20261105, "n_jobs": 1,
        "deterministic": True, "force_row_wise": True, "verbose": -1,
    })

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["horizons"] = list(self.horizons)
        data["models"] = list(self.models)
        return data

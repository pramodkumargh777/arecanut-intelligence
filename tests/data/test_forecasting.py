"""Unit tests for data-platform/forecasting.

All series here are synthetic and labelled provenance="synthetic_test"; they exist only inside these tests and the
publication path refuses them.
"""
import math
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "data-platform"))
from forecasting import metrics  # noqa: E402
from forecasting.backtest import BacktestResult, walk_forward  # noqa: E402
from forecasting.config import ExperimentConfig  # noqa: E402
from forecasting.datasets import (  # noqa: E402
    ForecastDataset, IncomparableDatasets, SeriesData, _apply_rule, _trailing_contiguous_months, build_unified_dataset,
    data_version,
)
from forecasting.evaluate import evaluate  # noqa: E402
from forecasting.features import ExogenousValue, series_features, supervised  # noqa: E402
from forecasting.legacy import legacy_evaluate  # noqa: E402
from forecasting.publish import PublicationRefused, build_payload  # noqa: E402


def monthly(values, start="2019-01", series_id="KA|Synthetic") -> SeriesData:
    index = pd.period_range(start, periods=len(values), freq="M")
    return SeriesData(series_id=series_id, market="KA", variety=series_id.split("|")[-1], grade=None,
                      values=pd.Series(np.asarray(values, dtype=float), index=index))


def dataset(series, *, key="synthetic_monthly", basis="MONTHLY_STATE_WEIGHTED_AVERAGE", unit="INR/quintal",
            unit_status="derived_report", frequency="monthly", provenance="synthetic_test") -> ForecastDataset:
    ds = ForecastDataset(key=key, price_basis=basis, frequency=frequency, unit=unit, unit_status=unit_status,
                         provenance=provenance, source_description="synthetic unit-test series", series=list(series))
    ds.data_version = data_version(basis, unit, ds.series)
    return ds


def seasonal_series(n=72, seed=7):
    rng = np.random.default_rng(seed)
    t = np.arange(n)
    return 40000 + 50 * t + 3000 * np.sin(2 * np.pi * t / 12) + rng.normal(0, 400, n)


class MetricTests(unittest.TestCase):
    def test_point_metrics(self):
        actual, predicted = [100, 200, 300], [110, 190, 330]
        self.assertAlmostEqual(metrics.mae(actual, predicted), 50 / 3)
        self.assertAlmostEqual(metrics.rmse(actual, predicted), math.sqrt((100 + 100 + 900) / 3))
        self.assertAlmostEqual(metrics.wape(actual, predicted), 50 / 600)

    def test_mase_uses_supplied_scale(self):
        self.assertAlmostEqual(metrics.mase([10, 20], [12, 18], [2, 2]), 1.0)
        self.assertIsNone(metrics.mase([10], [12], [np.nan]))

    def test_directional_accuracy_counts_only_directional_calls(self):
        accuracy, calls = metrics.directional_accuracy([110, 90, 100, 120], [105, 95, 120, 100], [100, 100, 100, 100])
        self.assertEqual(calls, 3)
        self.assertAlmostEqual(accuracy, 2 / 3)
        self.assertEqual(metrics.directional_accuracy([110], [100], [100]), (None, 0))

    def test_interval_coverage_and_width(self):
        self.assertAlmostEqual(metrics.interval_coverage([5, 15], [0, 0], [10, 10]), 0.5)
        self.assertAlmostEqual(metrics.interval_width([0, 0], [10, 20])["mean"], 15)

    def test_holm_is_monotone_and_preserves_none(self):
        adjusted = metrics.holm_adjust([0.01, None, 0.04, 0.03])
        self.assertIsNone(adjusted[1])
        self.assertAlmostEqual(adjusted[0], 0.03)
        self.assertAlmostEqual(adjusted[3], 0.06)
        self.assertAlmostEqual(adjusted[2], 0.06)

    def test_diebold_mariano_detects_clear_improvement_only(self):
        rng = np.random.default_rng(1)
        baseline = rng.normal(0, 10, 60)
        better = baseline * 0.3
        self.assertLess(metrics.diebold_mariano(baseline, better, 1)["p_value"], 0.01)
        self.assertGreater(metrics.diebold_mariano(baseline, baseline * 1.5, 1)["p_value"], 0.5)
        self.assertIsNone(metrics.diebold_mariano([1, 2], [1, 2], 1)["p_value"])


class FeatureLeakageTests(unittest.TestCase):
    def test_features_do_not_change_when_future_values_change(self):
        values = seasonal_series(48)
        history = monthly(values).values
        altered = history.copy()
        altered.iloc[30:] *= 3
        for horizon in (1, 3):
            original = series_features(history, horizon).loc[:history.index[29]]
            changed = series_features(altered, horizon).loc[:history.index[29]]
            pd.testing.assert_frame_equal(original, changed)

    def test_supervised_targets_only_use_observed_periods(self):
        history = monthly(seasonal_series(40)).values
        features, targets, final = supervised(history, 3)
        self.assertEqual(features.index.max(), history.index[-4])
        self.assertTrue(targets.notna().all())
        self.assertEqual(final.name, history.index[-1])

    def test_exogenous_values_respect_availability_time(self):
        history = monthly(seasonal_series(24)).values
        published_late = ExogenousValue("rain", history.index[5], 123.0,
                                        pd.Timestamp(history.index[10].end_time.date()))
        frame = series_features(history, 1, exogenous=[published_late],
                                cutoff_for_origin=lambda origin: pd.Timestamp(origin.end_time.date()))
        self.assertTrue(np.isnan(frame.loc[history.index[9], "exog_rain"]))
        self.assertEqual(frame.loc[history.index[10], "exog_rain"], 123.0)

    def test_gapped_history_is_rejected(self):
        history = monthly(seasonal_series(24)).values
        history.iloc[5] = np.nan
        with self.assertRaises(ValueError):
            series_features(history, 1)


class DatasetSeparationTests(unittest.TestCase):
    def test_trailing_contiguous_run_drops_older_points_without_interpolation(self):
        index = pd.PeriodIndex(["2020-01", "2020-02", "2020-05", "2020-06", "2020-07"], freq="M")
        kept, dropped, missing = _trailing_contiguous_months(pd.Series([1.0, 2, 3, 4, 5], index=index))
        self.assertEqual(list(kept.values), [3, 4, 5])
        self.assertEqual((dropped, missing), (2, 2))

    def test_unified_dataset_refuses_different_price_bases(self):
        official = dataset([monthly(seasonal_series(), series_id="KA|Rashi")])
        cooperative = dataset([monthly(seasonal_series(), series_id="mamcos|Shimoga|Rashi")], key="mamcos",
                              basis="COOPERATIVE_AVERAGE", unit_status="source_confirmed")
        with self.assertRaises(IncomparableDatasets):
            build_unified_dataset([official, cooperative])

    def test_unified_dataset_refuses_assumed_units_and_overlapping_ids(self):
        confirmed = dataset([monthly(seasonal_series(), series_id="a")], basis="COOPERATIVE_TENDER_AVERAGE",
                            unit_status="source_confirmed")
        assumed = dataset([monthly(seasonal_series(), series_id="b")], basis="COOPERATIVE_TENDER_AVERAGE",
                          unit_status="assumed")
        with self.assertRaises(IncomparableDatasets):
            build_unified_dataset([confirmed, assumed])
        same = dataset([monthly(seasonal_series(), series_id="a")], basis="COOPERATIVE_TENDER_AVERAGE",
                       unit_status="source_confirmed")
        with self.assertRaises(IncomparableDatasets):
            build_unified_dataset([confirmed, same])

    def test_sufficiency_rule_suppresses_short_series(self):
        ds = dataset([monthly(seasonal_series(30))])
        _apply_rule(ds, ExperimentConfig())
        self.assertTrue(ds.suppressed)
        self.assertIn("insufficient_observations", ds.series[0].excluded_reason)

    def test_synthetic_and_assumed_unit_datasets_are_never_publication_eligible(self):
        self.assertFalse(dataset([monthly(seasonal_series())]).publication_eligible)
        assumed = dataset([monthly(seasonal_series())], provenance="database", unit_status="assumed")
        self.assertFalse(assumed.publication_eligible)

    def test_data_version_changes_with_any_value(self):
        series = monthly(seasonal_series())
        before = data_version("B", "INR/quintal", [series])
        series.values.iloc[-1] += 1
        self.assertNotEqual(before, data_version("B", "INR/quintal", [series]))


class WalkForwardTests(unittest.TestCase):
    def test_baseline_backtest_and_gate_never_validate(self):
        config = ExperimentConfig(horizons=(1, 2))
        ds = dataset([monthly(seasonal_series(60), series_id="KA|A"), monthly(seasonal_series(60, 3), series_id="KA|B")])
        _apply_rule(ds, config)
        result = walk_forward(ds, config, models=("last_value", "seasonal_naive"))
        scored = result.rows[result.rows.actual.notna()]
        self.assertFalse(scored.empty)
        self.assertTrue((pd.PeriodIndex(scored.target, freq="M") > pd.PeriodIndex(scored.origin, freq="M")).all())
        live = result.rows[result.rows.actual.isna()]
        last = ds.series[0].values.index[-1]
        self.assertTrue((pd.PeriodIndex(live.target, freq="M") > last).all())
        self.assertIn(str(last), set(live.origin))
        evaluation = evaluate(result, config)
        statuses = {m["status"] for g in evaluation["groups"] for m in g["models"].values()}
        self.assertEqual(statuses, {"reference"})
        self.assertNotIn("validated", evaluation["status_counts"])

    def test_candidate_requires_significant_holm_adjusted_improvement(self):
        config = ExperimentConfig()
        rng = np.random.default_rng(5)
        rows = []
        for i in range(40):
            actual = 1000 + rng.normal(0, 50)
            for model, error in (("last_value", rng.normal(0, 60)), ("seasonal_naive", rng.normal(0, 90)),
                                 ("theta", rng.normal(0, 59))):
                rows.append({"series_id": "s", "model": model, "origin": f"o{i:02d}", "target": f"t{i:02d}",
                             "horizon": 1, "median": actual + error, "lower": actual + error - 500,
                             "upper": actual + error + 500, "last_value": 1000.0, "train_size": 36,
                             "mase_scale": 50.0, "actual": actual, "vintage_mode": "revised"})
        evaluation = evaluate(BacktestResult("s", "revised", pd.DataFrame(rows), 40), config)
        theta = evaluation["groups"][0]["models"]["theta"]
        self.assertEqual(theta["status"], "not_better_than_baseline")
        self.assertIn("improvement_not_significant_after_holm", theta["reasons"])


class PublicationTests(unittest.TestCase):
    def test_payload_refuses_synthetic_datasets(self):
        ds = dataset([monthly(seasonal_series())])
        with self.assertRaises(PublicationRefused):
            build_payload(run_id="r", created_at="2026-01-01T00:00:00Z", config=ExperimentConfig(), config_hash="h",
                          env={}, datasets={ds.key: ds}, evaluated=ds, result=None, evaluation={})


class LegacyParityTests(unittest.TestCase):
    def test_legacy_evaluator_selects_and_scores_like_the_worker(self):
        values = list(seasonal_series(72, seed=11))
        months = [str(p) for p in pd.period_range("2020-01", periods=72, freq="M")]
        result = legacy_evaluate(months, values)
        self.assertIn(result["selected_model"], {"last_value", "seasonal_naive"})
        self.assertEqual(len(result["holdout"]), 12)
        point = values[-1] if result["selected_model"] == "last_value" else values[-12]
        if result["publishable"]:
            self.assertAlmostEqual(result["forecast"]["point"], point)
        else:
            self.assertIsNone(result["forecast"])
        with self.assertRaises(ValueError):
            legacy_evaluate(months[:20], values[:20])


if __name__ == "__main__":
    unittest.main()

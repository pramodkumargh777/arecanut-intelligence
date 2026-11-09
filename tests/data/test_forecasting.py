"""Unit tests for data-platform/forecasting.

All series here are synthetic and labelled provenance="synthetic_test"; they exist only inside these tests and the
publication path refuses them.
"""
import math
import sys
import unittest
import unittest.mock
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
from forecasting.models import median_ensemble, run_models  # noqa: E402
from forecasting.outlook import GRID, build_outlook, chance_higher, recent_volatility  # noqa: E402
from forecasting import covariates as cov  # noqa: E402
from forecasting.publish import PublicationRefused, build_payload, build_track  # noqa: E402


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

    def test_synthetic_datasets_are_never_eligible_and_operator_assumed_units_are(self):
        self.assertFalse(dataset([monthly(seasonal_series())]).publication_eligible)
        assumed = dataset([monthly(seasonal_series())], provenance="database", unit_status="assumed")
        self.assertTrue(assumed.publication_eligible)
        conflict = dataset([monthly(seasonal_series())], provenance="database", unit_status="source_conflict")
        self.assertFalse(conflict.publication_eligible)

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


class EnsembleAndTrackTests(unittest.TestCase):
    def test_ensemble_is_the_median_of_its_members(self):
        frame = lambda m, lo, hi: pd.DataFrame([{"series_id": "S", "horizon": 1, "median": m, "lower": lo, "upper": hi}])  # noqa: E731
        combined = median_ensemble({"theta": frame(100, 90, 110), "auto_ets": frame(104, 95, 120), "chronos2": frame(130, 80, 140)})
        row = combined.iloc[0]
        self.assertEqual((row["median"], row["lower"], row["upper"]), (104, 90, 120))

    def test_ensemble_is_an_error_when_a_member_is_missing(self):
        view = {"KA|Synthetic": monthly(seasonal_series(48)).values}
        results, errors = run_models(view, ExperimentConfig(), (1,), ("theta", "auto_ets", "ensemble"))
        self.assertNotIn("ensemble", results)
        self.assertIn("chronos2", errors["ensemble"])

    def test_track_uses_the_strongest_pooled_challenger_and_only_scored_months(self):
        rows = pd.DataFrame([
            {"series_id": "KA|Rashi", "model": model, "origin": "2026-0" + str(m - 1), "target": "2026-0" + str(m), "horizon": 1,
             "median": med, "lower": med - 10, "upper": med + 10, "actual": actual}
            for m, actual in ((2, 100.0), (3, None)) for model, med in (("last_value", 95.0), ("theta", 99.0), ("lightgbm", 90.0))])
        ds = dataset([monthly(seasonal_series(48), series_id="KA|Rashi")])
        pooled = [{"horizon": 1, "model": "last_value", "mae": 5.0}, {"horizon": 1, "model": "theta", "mae": 1.0},
                  {"horizon": 1, "model": "lightgbm", "mae": 10.0}]
        track = build_track(rows, ds, pooled)
        self.assertEqual(track["model"], "theta")
        series = track["series"][0]
        self.assertEqual((series["periods"], series["actual"], series["median"], series["baseline"]), (["2026-02"], [100], [99], [95]))


class OutlookCalibrationTests(unittest.TestCase):
    def random_walks(self, n_series=8, n=84, seed=11):
        rng = np.random.default_rng(seed)
        series = []
        for i in range(n_series):
            vol = 0.02 + 0.02 * (i % 3)  # calm, medium and volatile series
            series.append(monthly(40000 * np.exp(np.cumsum(rng.normal(0, vol, n))), series_id=f"KA|V{i}"))
        return dataset(series)

    def test_volatility_uses_only_history_up_to_the_origin(self):
        values = monthly([100.0] * 12 + [200.0, 50.0], series_id="KA|X").values
        self.assertEqual(recent_volatility(values, values.index[11]), 0.01)  # flat history, floored
        self.assertGreater(recent_volatility(values, values.index[-1]), 0.3)

    def test_scaled_ranges_hold_out_of_sample_and_odds_are_sane(self):
        config = ExperimentConfig(horizons=(1, 3))
        ds = self.random_walks()
        _apply_rule(ds, config)
        result = walk_forward(ds, config, models=("last_value", "seasonal_naive"))
        outlook = build_outlook(result.rows, ds, evaluate(result, config), config.horizons, 80)
        self.assertEqual([h["horizon"] for h in outlook["horizons"]], [1, 3])
        for entry in outlook["horizons"]:
            self.assertEqual(entry["quantiles"], sorted(entry["quantiles"]))
            self.assertGreater(entry["test"]["coverage"], 0.6)
        h1, h3 = outlook["horizons"]
        self.assertGreater(h3["quantiles"][-1] - h3["quantiles"][0], h1["quantiles"][-1] - h1["quantiles"][0])
        # A random walk carried forward is equally likely to end higher or lower.
        self.assertAlmostEqual(chance_higher(h1["quantiles"], 0.0, 0.03), 0.5, delta=0.12)

    def test_chance_higher_follows_the_implied_move(self):
        quantiles = list(np.linspace(-2, 2, len(GRID)))
        self.assertGreater(chance_higher(quantiles, 0.05, 0.03), 0.85)
        self.assertLess(chance_higher(quantiles, -0.05, 0.03), 0.15)


class CovariateTests(unittest.TestCase):
    ARRIVALS = (',,,"Market-wise Wholesale Arrivals Monthly Analysis for Arecanut - September, 2026",,\n'
                'Market,"Arrivals September, 2026 (Metric Tonnes)","Arrivals August, 2026 (Metric Tonnes)",x,y,z\n'
                'Sagar APMC,533.2,378.3,269.87,41.0%,97.6%\nSorabha APMC,-,-,15.0,-,-\nTotal,533.2,378.3,-,-,-\n\nNote:\nChange = x\n')

    def test_arrivals_parser_keeps_reports_and_skips_blanks(self):
        self.assertEqual(cov.parse_arrivals(self.ARRIVALS, pd.Period("2026-09", freq="M")), {"Sagar APMC": 533.2})
        with self.assertRaises(ValueError):
            cov.parse_arrivals(self.ARRIVALS, pd.Period("2026-08", freq="M"))

    def test_import_parser_sums_countries_for_both_years(self):
        page = ("<table><tr><th>S.No.</th><th>Country</th><th>Sep-2024 (R)</th><th>Sep-2025 (R)</th><th>%Growth</th></tr>"
                "<tr><td>1</td><td>A</td><td>1,000</td><td>2,500</td><td>1</td></tr><tr><td>2</td><td>B</td><td>0</td><td>500</td><td>-</td></tr></table>")
        self.assertEqual(cov.parse_imports(page, pd.Period("2025-09", freq="M")), {"2024-09": 1000.0, "2025-09": 3000.0})

    def test_market_spellings_collapse_to_one_yard(self):
        self.assertEqual(cov.canonical_market("Hosanagar APMC"), cov.canonical_market("Hosanagara APMC"))
        self.assertEqual(cov.canonical_market("Shimogga(Theertahalli) APMC"), cov.canonical_market("APMC THIRTHAHALLI"))

    def test_inputs_are_lagged_by_publication_delay_and_skip_occasional_markets(self):
        months = [str(p) for p in pd.period_range("2024-01", "2025-12", freq="M")]
        arrivals = [{"district_id": 1, "district": "D", "market": "Steady APMC", "month": m, "tonnes": 100 + i, "source_url": "u", "fetched_at": "t"}
                    for i, m in enumerate(months)]
        arrivals += [{"district_id": 1, "district": "D", "market": "Rare APMC", "month": m, "tonnes": 9999, "source_url": "u", "fetched_at": "t"} for m in months[:3]]
        imports = [{"month": m, "quantity": 1000 * (i + 1), "hs_code": "080280", "source_url": "u", "fetched_at": "t"} for i, m in enumerate(months)]
        with self.subTest("lags"), unittest.mock.patch.object(cov, "DIR", Path(self._tmp())):
            cov._write("arrivals.csv", arrivals, list(arrivals[0]))
            cov._write("imports.csv", imports, list(imports[0]))
            frame = cov.monthly_covariates()
            jan25 = pd.Period("2025-01", freq="M")
            self.assertAlmostEqual(frame.loc[jan25, "arrivals_log"], np.log1p(112))  # same month, rare market excluded
            self.assertAlmostEqual(frame.loc[jan25, "imports_log"], np.log1p(12000))  # December's figure: one-month lag
            self.assertTrue(np.isnan(frame.loc[pd.Period("2024-01", freq="M"), "imports_log"]))
            self.assertEqual(frame.loc[pd.Period("2025-10", freq="M"), "event_mip_2025"], 1.0)
            self.assertEqual(frame.loc[pd.Period("2025-09", freq="M"), "event_mip_2025"], 0.0)

    def test_lightgbm_with_covariates_runs_on_the_same_interface(self):
        ds = dataset([monthly(seasonal_series(60), series_id="KA|A"), monthly(seasonal_series(60, 3), series_id="KA|B")])
        view = {s.series_id: s.values for s in ds.series}
        index = pd.period_range("2019-01", periods=60, freq="M")
        covariates = pd.DataFrame({"arrivals_log": np.linspace(5, 6, 60)}, index=index)
        results, errors = run_models(view, ExperimentConfig(), (1, 2), ("lightgbm_x",), {"covariates": covariates})
        self.assertEqual(errors, {})
        self.assertEqual(len(results["lightgbm_x"]), 4)
        _, errors = run_models(view, ExperimentConfig(), (1,), ("lightgbm_x",), {"covariates": None})
        self.assertIn("No covariates", errors["lightgbm_x"])

    def _tmp(self):
        import tempfile
        directory = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(directory, ignore_errors=True))
        return directory


if __name__ == "__main__":
    unittest.main()

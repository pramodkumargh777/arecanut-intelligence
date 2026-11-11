"""Forecasting dataset builders. One dataset per price basis.

Rules:
* Only stored observations are used. Missing periods stay missing; nothing is interpolated.
* Each dataset has exactly one price basis, unit and frequency, and records its provenance
  (`database` or `synthetic_test`). Synthetic datasets are never publishable.
* A dataset or series below the sufficiency rule is suppressed with an exact reason.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass, field
from typing import Any, Literal

import pandas as pd

from .config import MONTHLY_BASIS, ExperimentConfig
from .sources import table_exists

Provenance = Literal["database", "synthetic_test"]
Frequency = Literal["monthly", "daily"]


@dataclass
class SeriesData:
    series_id: str
    market: str
    variety: str
    grade: str | None
    values: pd.Series  # sorted, positive, no NaN; PeriodIndex (monthly) or DatetimeIndex (daily)
    covariates: pd.DataFrame | None = None
    dropped_observations: int = 0
    missing_periods: int = 0
    excluded_reason: str | None = None

    @property
    def observations(self) -> int:
        return int(self.values.size)

    def summary(self) -> dict[str, Any]:
        return {
            "series_id": self.series_id, "market": self.market, "variety": self.variety, "grade": self.grade,
            "observations": self.observations,
            "first_period": str(self.values.index[0]) if self.observations else None,
            "last_period": str(self.values.index[-1]) if self.observations else None,
            "dropped_observations": self.dropped_observations, "missing_periods": self.missing_periods,
            "excluded_reason": self.excluded_reason,
        }


@dataclass
class MonthlyVintages:
    """Capture versions of the monthly report. `fetched_at` is when ANI captured that value."""

    rows: pd.DataFrame  # series_id, period (Period[M]), value, fetched_at (UTC Timestamp)

    def history_as_of(self, series_id: str, cutoff: pd.Timestamp) -> pd.Series:
        frame = self.rows[(self.rows.series_id == series_id) & (self.rows.fetched_at <= cutoff)]
        if frame.empty:
            return pd.Series(dtype=float)
        latest = frame.sort_values("fetched_at").groupby("period").tail(1).set_index("period")["value"].sort_index()
        return latest[latest > 0]

    def first_release(self, series_id: str, period: pd.Period) -> tuple[float, pd.Timestamp] | None:
        frame = self.rows[(self.rows.series_id == series_id) & (self.rows.period == period)]
        if frame.empty:
            return None
        first = frame.sort_values("fetched_at").iloc[0]
        return float(first.value), first.fetched_at

    def earliest_capture(self) -> pd.Timestamp | None:
        return None if self.rows.empty else self.rows.fetched_at.min()


@dataclass
class ForecastDataset:
    key: str
    price_basis: str
    frequency: Frequency
    unit: str
    unit_status: str
    provenance: Provenance
    source_description: str
    series: list[SeriesData]
    vintages: MonthlyVintages | None = None
    suppression_reasons: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    data_version: str = ""

    @property
    def eligible_series(self) -> list[SeriesData]:
        return [s for s in self.series if s.excluded_reason is None]

    @property
    def suppressed(self) -> bool:
        return bool(self.suppression_reasons)

    @property
    def publication_eligible(self) -> bool:
        return self.provenance == "database" and not self.suppressed and self.unit_status in {"source_confirmed", "assumed", "derived_report"}

    def summary(self) -> dict[str, Any]:
        return {
            "key": self.key, "price_basis": self.price_basis, "frequency": self.frequency, "unit": self.unit,
            "unit_status": self.unit_status, "provenance": self.provenance, "source": self.source_description,
            "data_version": self.data_version, "suppressed": self.suppressed,
            "suppression_reasons": self.suppression_reasons, "publication_eligible": self.publication_eligible,
            "series_total": len(self.series), "series_eligible": len(self.eligible_series),
            "observations": sum(s.observations for s in self.series),
            "notes": self.notes, "series": [s.summary() for s in self.series],
        }


def data_version(price_basis: str, unit: str, series: list[SeriesData]) -> str:
    canonical = [
        [s.series_id, str(period), round(float(value), 6)]
        for s in sorted(series, key=lambda item: item.series_id)
        for period, value in s.values.items()
    ]
    payload = json.dumps({"basis": price_basis, "unit": unit, "rows": canonical}, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _trailing_contiguous_months(raw: pd.Series) -> tuple[pd.Series, int, int]:
    """Return the latest contiguous run of positive months, the count of dropped valid points and the missing months."""
    raw = raw.sort_index()
    valid = raw[(raw.notna()) & (raw > 0)]
    if valid.empty:
        return valid.astype(float), 0, 0
    full = pd.period_range(valid.index.min(), valid.index.max(), freq="M")
    missing = int(len(full) - len(valid))
    run_start = len(valid) - 1
    while run_start > 0 and valid.index[run_start - 1] + 1 == valid.index[run_start]:
        run_start -= 1
    kept = valid.iloc[run_start:].astype(float)
    return kept, int(len(valid) - len(kept)), missing


def _apply_rule(dataset: ForecastDataset, config: ExperimentConfig) -> None:
    rule = config.sufficiency[dataset.frequency]
    for item in dataset.series:
        if item.excluded_reason:
            continue
        if item.observations < rule.min_series_observations:
            item.excluded_reason = f"insufficient_observations:{item.observations}<{rule.min_series_observations}"
        elif dataset.frequency == "daily":
            span = (item.values.index[-1] - item.values.index[0]).days
            if span < 365:
                item.excluded_reason = f"insufficient_span_days:{span}<365"
        elif item.observations - config.initial_training_periods < rule.min_walk_forward_origins:
            origins = item.observations - config.initial_training_periods
            item.excluded_reason = f"insufficient_walk_forward_origins:{origins}<{rule.min_walk_forward_origins}"
    if not dataset.eligible_series:
        dataset.suppression_reasons.append("no_series_meets_sufficiency_rule")


def build_monthly_reference(conn: sqlite3.Connection, config: ExperimentConfig | None = None,
                            state: str = "Karnataka") -> ForecastDataset:
    config = config or ExperimentConfig()
    prices = pd.read_sql_query(
        """SELECT variety_name, reporting_month, weighted_price FROM monthly_variety_prices
           WHERE state=? AND price_unit='INR/quintal' ORDER BY variety_name, reporting_month""",
        conn, params=(state,),
    )
    versions = pd.read_sql_query(
        """SELECT variety_name, reporting_month, weighted_price, fetched_at FROM monthly_price_versions
           WHERE state=? AND price_unit='INR/quintal'""",
        conn, params=(state,),
    )
    series: list[SeriesData] = []
    for variety, frame in prices.groupby("variety_name", sort=True):
        raw = pd.Series(frame.weighted_price.to_numpy(dtype=float),
                        index=pd.PeriodIndex(frame.reporting_month, freq="M"))
        kept, dropped, missing = _trailing_contiguous_months(raw)
        series.append(SeriesData(series_id=f"KA|{variety}", market=state, variety=str(variety), grade=None,
                                 values=kept, dropped_observations=dropped, missing_periods=missing))
    vintage_rows = pd.DataFrame({
        "series_id": "KA|" + versions.variety_name.astype(str),
        "period": pd.PeriodIndex(versions.reporting_month, freq="M"),
        "value": versions.weighted_price.astype(float),
        "fetched_at": pd.to_datetime(versions.fetched_at, utc=True),
    })
    dataset = ForecastDataset(
        key="monthly_reference", price_basis=MONTHLY_BASIS, frequency="monthly", unit="INR/quintal",
        unit_status="derived_report", provenance="database",
        source_description="AGMARKNET state-wise variety-wise monthly arrival-weighted price (Karnataka)",
        series=series, vintages=MonthlyVintages(vintage_rows.dropna(subset=["value"])),
    )
    earliest = dataset.vintages.earliest_capture() if dataset.vintages else None
    dataset.notes.append(
        "Monthly values are a derived state-level weighted average, not an APMC modal or cooperative price."
    )
    if earliest is not None:
        dataset.notes.append(
            f"Earliest stored capture vintage is {earliest.isoformat()}; earlier months exist only as revised history."
        )
    _apply_rule(dataset, config)
    dataset.data_version = data_version(dataset.price_basis, dataset.unit, dataset.series)
    return dataset


def build_monthly_from_daily(config: ExperimentConfig | None = None) -> ForecastDataset:
    """Monthly series from the 2014+ daily archive files (``daily_monthly.py`` rule). Not stored in D1, no vintages."""
    from .daily_archive import load_archive, load_manifest
    from .daily_monthly import BASIS, MIN_MARKETS, monthly_from_daily

    config = config or ExperimentConfig()
    monthly = monthly_from_daily(load_archive())
    series: list[SeriesData] = []
    for variety, frame in monthly.groupby("variety", sort=True):
        raw = pd.Series(frame.value.to_numpy(dtype=float), index=pd.PeriodIndex(frame.month, freq="M"))
        kept, dropped, missing = _trailing_contiguous_months(raw)
        series.append(SeriesData(series_id=f"KA|{variety}", market="Karnataka", variety=str(variety), grade=None,
                                 values=kept, dropped_observations=dropped, missing_periods=missing))
    empty = pd.DataFrame({"series_id": pd.Series(dtype=str), "period": pd.PeriodIndex([], freq="M"),
                          "value": pd.Series(dtype=float), "fetched_at": pd.to_datetime(pd.Series([], dtype=str), utc=True)})
    dataset = ForecastDataset(
        key="monthly_from_daily", price_basis=BASIS, frequency="monthly", unit="INR/quintal",
        unit_status="derived_report", provenance="database",
        source_description=f"Median across Karnataka APMCs of each market's mean daily modal price (AGMARKNET daily, "
                           f"from 2014; at least {MIN_MARKETS} markets a month)",
        series=series, vintages=MonthlyVintages(empty),
    )
    months = load_manifest()["months"]
    dataset.notes.append(f"Built from {len(months)} archived months of daily APMC prices; not the arrival-weighted monthly report.")
    _apply_rule(dataset, config)
    dataset.data_version = data_version(dataset.price_basis, dataset.unit, dataset.series)
    return dataset


def build_daily_agmarknet(conn: sqlite3.Connection, config: ExperimentConfig | None = None) -> ForecastDataset:
    config = config or ExperimentConfig()
    frame = pd.DataFrame()
    if table_exists(conn, "market_price_observations"):
        frame = pd.read_sql_query(
            """SELECT o.market_id, COALESCE(m.name, o.market_id) AS market_name, o.variety_name, o.grade,
                      o.reporting_date, o.modal_price, o.arrival_quantity
               FROM market_price_observations o LEFT JOIN markets m ON m.id = o.market_id
               WHERE o.validation_status='validated' AND o.price_basis='APMC_MODAL' AND o.price_unit='INR/quintal'
                 AND o.modal_price > 0
               ORDER BY o.market_id, o.variety_name, o.grade, o.reporting_date""",
            conn,
        )
    series: list[SeriesData] = []
    for (market_id, variety, grade), group in frame.groupby(["market_id", "variety_name", "grade"], dropna=False, sort=True):
        grade_value = None if pd.isna(grade) else str(grade)
        item_id = f"{market_id}|{variety}|{'-' if grade_value is None else grade_value}"  # matches SQL COALESCE(grade, '-')
        index = pd.DatetimeIndex(pd.to_datetime(group.reporting_date))
        values = pd.Series(group.modal_price.to_numpy(dtype=float), index=index)
        reason = "duplicate_reporting_dates" if index.has_duplicates else None
        covariates = pd.DataFrame({"arrival_quantity": group.arrival_quantity.to_numpy(dtype=float)}, index=index)
        missing = 0
        if len(index) > 1 and not index.has_duplicates:
            missing = int(len(pd.bdate_range(index.min(), index.max())) - len(index))
        series.append(SeriesData(series_id=item_id, market=str(group.market_name.iloc[0]), variety=str(variety),
                                 grade=grade_value, values=values.sort_index(), covariates=covariates,
                                 missing_periods=max(missing, 0), excluded_reason=reason))
    dataset = ForecastDataset(
        key="daily_agmarknet", price_basis="APMC_MODAL", frequency="daily", unit="INR/quintal",
        unit_status="source_confirmed", provenance="database",
        source_description="data.gov.in AGMARKNET current-daily resource, validated rows only", series=series,
    )
    if frame.empty:
        dataset.suppression_reasons.append("no_validated_daily_observations")
    else:
        dates = frame.reporting_date.nunique()
        dataset.notes.append(f"{len(frame)} validated observations across {dates} reporting date(s).")
        if frame.arrival_quantity.notna().sum() == 0:
            dataset.notes.append("No arrival quantities were reported; the arrival covariate is unavailable.")
    _apply_rule(dataset, config)
    dataset.data_version = data_version(dataset.price_basis, dataset.unit, dataset.series)
    return dataset


def _build_cooperative(conn: sqlite3.Connection, config: ExperimentConfig, *, key: str, source_key: str,
                       price_basis: str, statuses: tuple[str, ...], description: str) -> ForecastDataset:
    frame = pd.DataFrame()
    if table_exists(conn, "cooperative_quotes"):
        placeholders = ",".join("?" for _ in statuses)
        frame = pd.read_sql_query(
            f"""SELECT branch, variety, reporting_date, average_price, unit_status, price_unit
                FROM cooperative_quotes
                WHERE source_key=? AND commodity='arecanut' AND price_basis=? AND status IN ({placeholders})
                  AND average_price > 0
                ORDER BY branch, variety, reporting_date""",
            conn, params=(source_key, price_basis, *statuses),
        )
    unit_statuses = sorted(set(frame.unit_status)) if not frame.empty else []
    units = sorted(set(frame.price_unit)) if not frame.empty else []
    series: list[SeriesData] = []
    for (branch, variety), group in frame.groupby(["branch", "variety"], sort=True):
        index = pd.DatetimeIndex(pd.to_datetime(group.reporting_date))
        series.append(SeriesData(
            series_id=f"{source_key}|{branch}|{variety}", market=str(branch), variety=str(variety), grade=None,
            values=pd.Series(group.average_price.to_numpy(dtype=float), index=index).sort_index(),
            excluded_reason="duplicate_reporting_dates" if index.has_duplicates else None,
        ))
    dataset = ForecastDataset(
        key=key, price_basis=price_basis, frequency="daily", unit=units[0] if len(units) == 1 else "mixed",
        unit_status=unit_statuses[0] if len(unit_statuses) == 1 else ("mixed" if unit_statuses else "unknown"),
        provenance="database", source_description=description, series=series,
    )
    if frame.empty:
        dataset.suppression_reasons.append("no_reviewed_observations")
    else:
        dataset.notes.append(f"{len(frame)} reviewed observations across {frame.reporting_date.nunique()} reporting date(s).")
    if len(units) > 1 or len(unit_statuses) > 1:
        dataset.suppression_reasons.append("mixed_units_or_unit_status")
    if dataset.unit != "INR/quintal" or dataset.unit_status not in {"source_confirmed", "assumed"}:
        dataset.suppression_reasons.append(f"unit_not_publishable:{dataset.unit}:{dataset.unit_status}")
    _apply_rule(dataset, config)
    dataset.data_version = data_version(dataset.price_basis, dataset.unit, dataset.series)
    return dataset


def build_mamcos(conn: sqlite3.Connection, config: ExperimentConfig | None = None) -> ForecastDataset:
    return _build_cooperative(conn, config or ExperimentConfig(), key="mamcos_branch_average", source_key="mamcos",
                              price_basis="COOPERATIVE_AVERAGE", statuses=("verified",),
                              description="MAMCOS branch cooperative averages, verified rows only")


def build_tss(conn: sqlite3.Connection, config: ExperimentConfig | None = None) -> ForecastDataset:
    # INR/quintal is an operator assumption (migration 0020); publication is still subject to the history rules.
    return _build_cooperative(conn, config or ExperimentConfig(), key="tss_tender_average", source_key="tss",
                              price_basis="COOPERATIVE_TENDER_AVERAGE", statuses=("verified",),
                              description="TSS tender/auction averages, verified rows only (INR/quintal by operator decision)")


def build_tumcos(conn: sqlite3.Connection, config: ExperimentConfig | None = None) -> ForecastDataset:
    return _build_cooperative(conn, config or ExperimentConfig(), key="tumcos_branch_average", source_key="tumcos",
                              price_basis="COOPERATIVE_AVERAGE", statuses=("verified",),
                              description="TUMCOS Channagiri averages, verified rows only (INR/quintal by operator decision)")


def build_all(conn: sqlite3.Connection, config: ExperimentConfig | None = None) -> dict[str, ForecastDataset]:
    config = config or ExperimentConfig()
    datasets = [build_monthly_reference(conn, config), build_daily_agmarknet(conn, config),
                build_mamcos(conn, config), build_tss(conn, config), build_tumcos(conn, config)]
    return {dataset.key: dataset for dataset in datasets}


class IncomparableDatasets(ValueError):
    pass


def build_unified_dataset(datasets: list[ForecastDataset]) -> ForecastDataset:
    """Combine datasets only when basis, unit, unit status and frequency are identical."""
    if len(datasets) < 2:
        raise IncomparableDatasets("A unified dataset needs at least two datasets.")
    signature = {(d.price_basis, d.unit, d.unit_status, d.frequency) for d in datasets}
    if len(signature) != 1:
        raise IncomparableDatasets(
            "Datasets are not demonstrably comparable: "
            + "; ".join(f"{d.key}=({d.price_basis},{d.unit},{d.unit_status},{d.frequency})" for d in datasets)
        )
    if any(d.provenance != datasets[0].provenance for d in datasets):
        raise IncomparableDatasets("Datasets have different provenance.")
    first = datasets[0]
    combined = ForecastDataset(
        key="unified_" + "_".join(d.key for d in datasets), price_basis=first.price_basis, frequency=first.frequency,
        unit=first.unit, unit_status=first.unit_status, provenance=first.provenance,
        source_description=" + ".join(d.source_description for d in datasets),
        series=[s for d in datasets for s in d.series],
    )
    ids = [s.series_id for s in combined.series]
    if len(ids) != len(set(ids)):
        raise IncomparableDatasets("Series identifiers overlap; observations would be merged.")
    combined.suppression_reasons = sorted({r for d in datasets for r in d.suppression_reasons})
    combined.data_version = data_version(combined.price_basis, combined.unit, combined.series)
    return combined


def exogenous_availability(conn: sqlite3.Connection) -> dict[str, Any]:
    """Report which covariates could be used without leakage. Availability is the capture time, not the period."""
    report: dict[str, Any] = {}
    if table_exists(conn, "weather_records"):
        row = conn.execute("""SELECT MIN(date), MAX(date), COUNT(*), GROUP_CONCAT(DISTINCT kind) FROM weather_records""").fetchone()
        report["weather"] = {
            "first_date": row[0], "last_date": row[1], "rows": row[2], "kinds": row[3],
            "usable_in_backtest": False,
            "reason": "Only a short recent/forecast window is stored; no historical weather archive covers the price history.",
        }
    for table, label in (("production_records", "production"), ("trade_records", "trade")):
        if not table_exists(conn, table):
            continue
        row = conn.execute(
            f"""SELECT MIN(r.period), MAX(r.period), COUNT(*), MIN(c.fetched_at)
                FROM {table} r JOIN intelligence_captures c ON c.id = r.capture_id"""
        ).fetchone()
        report[label] = {
            "first_period": row[0], "last_period": row[1], "rows": row[2], "first_capture_at": row[3],
            "usable_in_backtest": False,
            "reason": "Annual figures were first captured at the stated time; using them for earlier origins would leak "
                      "information that was not available then.",
        }
    return report

"""A monthly price per variety built from AGMARKNET daily APMC modal prices, measured the same way for every month.

Rule (fixed before it was compared with anything):
1. Take every validated daily modal price for the variety in the month (rows flagged for review are left out).
2. Average each market's prices for the month (all grades of the variety in that market together), so a market that
   reports every day does not outweigh one that reports twice a week.
3. The month's value is the median of those market averages, so one unusual market cannot move it.
4. A month needs at least ``MIN_MARKETS`` markets; otherwise it is left missing, never filled in.

This is a different measure from AGMARKNET's monthly report (an arrival-weighted state average; daily rows carry no
arrivals), so the two are never mixed in one series. ``tracking`` measures how closely they agree where both exist.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

BASIS = "MONTHLY_APMC_MODAL_MEDIAN"
MIN_MARKETS = 2
# A variety's long series replaces the monthly report on pages only when, over at least TRACK_MIN_MONTHS months where
# both exist, the typical level gap is within TRACK_MAX_ABS_GAP_PCT, month-to-month moves agree in direction at least
# TRACK_MIN_SAME_DIRECTION_PCT of the time and their correlation is at least TRACK_MIN_MOVE_CORRELATION.
TRACK_MIN_MONTHS = 24
TRACK_MAX_ABS_GAP_PCT = 3.0
TRACK_MIN_SAME_DIRECTION_PCT = 75.0
TRACK_MIN_MOVE_CORRELATION = 0.3


def monthly_from_daily(frame: pd.DataFrame, min_markets: int = MIN_MARKETS) -> pd.DataFrame:
    """Rows: variety, month (Period[M]), value, markets, market_days. Months below ``min_markets`` are dropped."""
    rows = frame[(frame.status == "validated") & (frame.modal_price > 0)].copy()
    if rows.empty:
        return pd.DataFrame(columns=["variety", "month", "value", "markets", "market_days"])
    rows["month"] = rows.reporting_date.dt.to_period("M")
    per_market = rows.groupby(["variety", "month", "district", "market"]).modal_price.agg(["mean", "size"]).reset_index()
    monthly = per_market.groupby(["variety", "month"]).agg(
        value=("mean", "median"), markets=("mean", "size"), market_days=("size", "sum")).reset_index()
    monthly = monthly[monthly.markets >= min_markets].copy()
    monthly["value"] = monthly.value.round(0)
    return monthly.sort_values(["variety", "month"]).reset_index(drop=True)


def tracking(daily: pd.DataFrame, reports: pd.DataFrame) -> pd.DataFrame:
    """Per variety, where both exist: months compared, typical level gap, and agreement of month-to-month moves.

    ``reports`` has columns variety, month (Period[M]), value. Moves are log changes between consecutive months
    present in both series.
    """
    out = []
    for variety, mine in daily.groupby("variety"):
        theirs = reports[reports.variety == variety]
        both = mine.merge(theirs, on="month", suffixes=("_daily", "_report")).sort_values("month")
        if len(both) < 6:
            continue
        gap = (both.value_daily / both.value_report - 1) * 100
        consecutive = both.month.diff().apply(lambda d: getattr(d, "n", None) == 1)
        moves_d = np.log(both.value_daily).diff()[consecutive]
        moves_r = np.log(both.value_report).diff()[consecutive]
        agree = (np.sign(moves_d) == np.sign(moves_r))[(moves_d != 0) & (moves_r != 0)]
        out.append({
            "variety": variety, "months": len(both), "first": str(both.month.iloc[0]), "last": str(both.month.iloc[-1]),
            "median_gap_pct": round(float(gap.median()), 1), "median_abs_gap_pct": round(float(gap.abs().median()), 1),
            "move_correlation": round(float(moves_d.corr(moves_r)), 2) if len(moves_d) > 3 else None,
            "same_direction_pct": round(float(agree.mean() * 100), 0) if len(agree) else None,
            "level_correlation": round(float(both.value_daily.corr(both.value_report)), 3),
        })
    return pd.DataFrame(out).sort_values("months", ascending=False).reset_index(drop=True)


def tracks_reports(row: dict) -> bool:
    return (row.get("months", 0) >= TRACK_MIN_MONTHS and row.get("median_abs_gap_pct") is not None
            and row["median_abs_gap_pct"] <= TRACK_MAX_ABS_GAP_PCT
            and (row.get("same_direction_pct") or 0) >= TRACK_MIN_SAME_DIRECTION_PCT
            and (row.get("move_correlation") or 0) >= TRACK_MIN_MOVE_CORRELATION)


def d1_sql(monthly: pd.DataFrame, reports: pd.DataFrame, *, through: str, imported_at: str, data_version: str,
           state: str = "Karnataka") -> str:
    """SQL that replaces both monthly_apmc tables. Months after ``through`` (the last complete month) are left out."""
    monthly = monthly[monthly.month <= pd.Period(through, freq="M")]
    track = {row["variety"]: row for row in tracking(monthly, reports).to_dict("records")}
    quote = lambda text: "'" + str(text).replace("'", "''") + "'"
    num = lambda value: "NULL" if value is None or pd.isna(value) else repr(float(value))
    lines = [f"DELETE FROM monthly_apmc_prices WHERE state={quote(state)};",
             f"DELETE FROM monthly_apmc_series WHERE state={quote(state)};"]
    for row in monthly.itertuples():
        lines.append("INSERT INTO monthly_apmc_prices VALUES (" + ",".join([
            quote(state), quote(row.month), quote(row.variety), num(row.value), str(int(row.markets)), str(int(row.market_days)),
            quote(data_version), quote(imported_at)]) + ");")
    for variety, frame in monthly.groupby("variety"):
        t = track.get(variety, {})
        lines.append("INSERT INTO monthly_apmc_series VALUES (" + ",".join([
            quote(state), quote(variety), quote(frame.month.min()), quote(frame.month.max()), str(len(frame)),
            str(int(t.get("months", 0))), num(t.get("median_abs_gap_pct")), num(t.get("same_direction_pct")),
            num(t.get("move_correlation")), "1" if tracks_reports(t) else "0", quote(data_version), quote(imported_at)]) + ");")
    return "\n".join(lines) + "\n"

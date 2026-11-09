"""Outside data for the forecasting experiment: market arrivals, imports, rainfall and policy events.

`fetch_all` downloads each public source into `forecasting/covariates/*.csv`, keeping the source URL and fetch time on
every row. `monthly_covariates` turns those files into one monthly frame of model inputs, already shifted by each
source's publication delay, so the value a model sees at origin month M is one that had been published by the time
M's official price was (no look-ahead in backtests):

- arrivals (AGMARKNET market-wise monthly arrivals, Karnataka areca districts): same month as the price. Only markets
  that reported in at least `MIN_MARKET_SHARE` of months are summed, so a market joining or leaving the report does not
  read as a change in supply.
- imports (Commerce Ministry TradeStat, HS 080280 areca nuts, all countries): published about a month after the price,
  so lagged one month.
- rainfall (Open-Meteo ERA5 archive, three growing areas): reanalysis available within days; same month.
- policy events (the verified dates in frontend/src/services/market-events.ts): known on the day.

Every value is the latest revision of its source; historical vintages are not available, as for prices.
"""

from __future__ import annotations

import csv
import html
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.cookiejar import CookieJar
from pathlib import Path

import numpy as np
import pandas as pd

DIR = Path(__file__).resolve().parent / "covariates"
AGENT = "Mozilla/5.0 (ANI forecasting research; contact via repository)"
START = "2020-01"

# AGMARKNET district ids (price-trend/district-filter, commodity 118 = Arecanut, state 16 = Karnataka).
ARRIVAL_DISTRICTS = {266: "Shivamogga", 257: "Uttara Kannada", 262: "Dakshina Kannada", 249: "Chikkamagaluru",
                     251: "Davangere", 250: "Chitradurga", 267: "Tumakuru", 268: "Udupi"}
MIN_MARKET_SHARE = 0.8
RAIN_POINTS = {"Shivamogga": (13.93, 75.57), "Sirsi": (14.62, 74.84), "Puttur": (12.76, 75.20)}
# Verified policy events (frontend/src/services/market-events.ts): minimum import price raised to Rs 351/kg for
# cheaper areca (2023-02-14); extended to all areca (2025-10-15); pan-masala GST and health cess (2026-02-01).
POLICY_EVENTS = {"mip_2023": "2023-02-14", "mip_2025": "2025-10-15", "pan_masala_2026": "2026-02-01"}
LAG_MONTHS = {"arrivals": 0, "imports": 1, "rain": 0, "events": 0}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _get(url: str, data: bytes | None = None, opener=None, timeout: int = 60, retries: int = 6) -> str:
    """GET or POST with a polite back-off: a 429 or 5xx waits 20s, 40s, 80s... before trying again."""
    import urllib.error
    for attempt in range(retries):
        request = urllib.request.Request(url, data=data, headers={"User-Agent": AGENT})
        try:
            with (opener or urllib.request.build_opener()).open(request, timeout=timeout) as response:
                return response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as error:
            if error.code != 429 and error.code < 500 or attempt == retries - 1:
                raise
            time.sleep(20 * 2 ** attempt)
        except (urllib.error.URLError, TimeoutError):
            if attempt == retries - 1:
                raise
            time.sleep(20 * 2 ** attempt)
    raise RuntimeError("unreachable")


def _months(start: str, end: str) -> list[pd.Period]:
    return list(pd.period_range(start, end, freq="M"))


def _write(name: str, rows: list[dict], fields: list[str]) -> Path:
    DIR.mkdir(exist_ok=True)
    path = DIR / name
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    return path


def _read(name: str) -> pd.DataFrame:
    path = DIR / name
    return pd.read_csv(path) if path.exists() else pd.DataFrame()


# ---------- Fetch ----------

ARRIVAL_FIELDS = ["district_id", "district", "market", "month", "tonnes", "source_url", "fetched_at"]


def arrivals_url(district: int, month: pd.Period) -> str:
    return "https://api.agmarknet.gov.in/v1/price-trend/wholesale-arrivals-monthly?" + urllib.parse.urlencode({
        "report_mode": "Marketwise", "commodity": 118, "year": month.year, "month": month.month,
        "export": "true", "downloadformat": "csv", "state": 16, "district": district})


def parse_arrivals(text: str, month: pd.Period) -> dict[str, float]:
    """Market -> tonnes for `month` from the market-wise arrivals CSV ('-' is no report, not zero)."""
    rows = list(csv.reader(text.splitlines()))
    header = next((r for r in rows if r and r[0] == "Market"), None)
    if not header or "Metric Tonnes" not in header[1] or month.strftime("%B, %Y") not in header[1]:
        raise ValueError(f"Arrivals report layout or month changed for {month}")
    out = {}
    for row in rows[rows.index(header) + 1:]:
        if not row or row[0].startswith("Note"):
            break
        if len(row) < 2 or row[0] in ("Total", ""):
            continue
        if row[1] not in ("-", ""):
            out[row[0].strip()] = float(row[1].replace(",", ""))
    return out


def fetch_arrivals(end: str, pause: float = 1.5, log=print) -> Path:
    existing = _read("arrivals.csv")
    done = set(zip(existing.get("district_id", []), existing.get("month", [])))
    rows = existing.to_dict("records") if not existing.empty else []
    for district, name in ARRIVAL_DISTRICTS.items():
        for month in _months(START, end):
            if (district, str(month)) in done:
                continue
            url = arrivals_url(district, month)
            for market, tonnes in parse_arrivals(_get(url), month).items():
                rows.append({"district_id": district, "district": name, "market": market, "month": str(month),
                             "tonnes": tonnes, "source_url": url, "fetched_at": _now()})
            rows.append({"district_id": district, "district": name, "market": "", "month": str(month),
                         "tonnes": "", "source_url": url, "fetched_at": _now()})  # marks the month as fetched
            time.sleep(pause)
        # Saved after every district, so an interrupted download resumes where it stopped.
        _write("arrivals.csv", rows, ARRIVAL_FIELDS)
        log(f"arrivals: {name} done")
    return _write("arrivals.csv", rows, ARRIVAL_FIELDS)


TRADESTAT = "https://tradestat.commerce.gov.in/meidb/commodity_wise_all_countries_import"


def parse_imports(page: str, month: pd.Period) -> dict[str, float]:
    """{'YYYY-MM': total quantity} for `month` and the same month a year earlier, summed over all countries."""
    table = next((t for t in re.findall(r"<table.*?</table>", page, re.S) if "Country" in t), None)
    if table is None:
        raise ValueError(f"TradeStat table missing for {month}")
    rows = [[html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", r, re.S)]
            for r in re.findall(r"<tr.*?</tr>", table, re.S)]
    header = [re.sub(r"\s+", " ", h) for h in rows[0]]
    labels = {str(month - 12): month.strftime("%b") + "-" + str(month.year - 1), str(month): month.strftime("%b") + "-" + str(month.year)}
    out = {}
    for key, label in labels.items():
        column = next((i for i, h in enumerate(header) if h.startswith(label)), None)
        if column is None:
            raise ValueError(f"TradeStat column {label} missing")
        out[key] = sum(float(r[column].replace(",", "")) for r in rows[1:] if len(r) > column and re.fullmatch(r"[\d,]+(\.\d+)?", r[column]))
    return out


def fetch_imports(end: str, pause: float = 1.0, log=print) -> Path:
    jar = CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    values: dict[str, float] = {}
    for month in _months("2021-01", end):
        token = re.search(r'name="_token" value="([^"]+)"', _get(TRADESTAT, opener=opener)).group(1)
        body = urllib.parse.urlencode({"_token": token, "cwacimHSCODE": "080280", "cwacimMonth": month.month,
                                       "cwacimYear": month.year, "cwacimReportVal": 2, "cwacimReportYear": 2}).encode()
        try:
            values.update(parse_imports(_get(TRADESTAT, data=body, opener=opener), month))
        except ValueError as error:  # the latest months are often not released yet
            log(f"imports: {month}: {error}")
        time.sleep(pause)
    rows = [{"month": k, "quantity": v, "hs_code": "080280", "source_url": TRADESTAT, "fetched_at": _now()} for k, v in sorted(values.items())]
    log(f"imports: {len(rows)} months")
    return _write("imports.csv", rows, ["month", "quantity", "hs_code", "source_url", "fetched_at"])


def fetch_rainfall(end: str, log=print) -> Path:
    last_day = (pd.Period(end, freq="M").to_timestamp(how="end")).strftime("%Y-%m-%d")
    rows = []
    for name, (lat, lon) in RAIN_POINTS.items():
        url = "https://archive-api.open-meteo.com/v1/archive?" + urllib.parse.urlencode({
            "latitude": lat, "longitude": lon, "start_date": f"{START}-01", "end_date": last_day,
            "daily": "precipitation_sum", "timezone": "Asia/Kolkata"})
        daily = json.loads(_get(url, timeout=120))["daily"]
        frame = pd.DataFrame({"day": pd.to_datetime(daily["time"]), "mm": daily["precipitation_sum"]}).dropna()
        for month, total in frame.groupby(frame.day.dt.to_period("M")).mm.sum().items():
            rows.append({"point": name, "month": str(month), "mm": round(float(total), 1), "source_url": url, "fetched_at": _now()})
    log(f"rainfall: {len(rows)} point-months")
    return _write("rainfall.csv", rows, ["point", "month", "mm", "source_url", "fetched_at"])


def fetch_all(end: str, log=print) -> list[str]:
    return [str(fetch_arrivals(end, log=log)), str(fetch_imports(end, log=log)), str(fetch_rainfall(end, log=log))]


# ---------- Model inputs ----------

# AGMARKNET spells some markets differently across years; these are the same APMC yards.
MARKET_ALIASES = {"hosanagar": "hosanagara", "shimoggatheertahalli": "thirthahalli", "theerthahalli": "thirthahalli",
                  "shimogatheerthahalli": "thirthahalli", "sorabha": "soraba", "shimogga": "shimoga", "shivamogga": "shimoga"}


def canonical_market(name: str) -> str:
    key = re.sub(r"[^a-z]", "", re.sub(r"apmc", "", str(name).lower()))
    return MARKET_ALIASES.get(key, key)


def monthly_covariates(through: str | None = None) -> pd.DataFrame:
    """Monthly model inputs indexed by the origin month at which they are known (publication lag applied)."""
    columns: dict[str, pd.Series] = {}
    arrivals = _read("arrivals.csv")
    if not arrivals.empty:
        reported = arrivals.dropna(subset=["tonnes"]).assign(market=lambda f: f.market.map(canonical_market))
        reported = reported.groupby(["district", "market", "month"], as_index=False).tonnes.sum()
        months = arrivals.month.nunique()
        share = reported.groupby(["district", "market"]).month.nunique() / max(months, 1)
        steady = share[share >= MIN_MARKET_SHARE].index
        kept = reported.set_index(["district", "market"]).loc[lambda f: f.index.isin(steady)]
        total = kept.groupby("month").tonnes.sum()
        total.index = pd.PeriodIndex(total.index, freq="M")
        logs = np.log1p(total)
        columns["arrivals_log"] = logs
        columns["arrivals_yoy"] = logs - logs.shift(12)
    imports = _read("imports.csv")
    if not imports.empty:
        # An unreleased month comes back as all-zero rows; areca imports are never truly zero in a month, so a zero
        # total means "not published yet", not "no imports".
        q = imports.set_index(pd.PeriodIndex(imports.month, freq="M")).quantity.where(lambda v: v > 0)
        logs = np.log1p(q)
        columns["imports_log"] = logs
        columns["imports_yoy"] = logs - logs.shift(12)
    rain = _read("rainfall.csv")
    if not rain.empty:
        mm = rain.groupby("month").mm.mean()
        mm.index = pd.PeriodIndex(mm.index, freq="M")
        climatology = mm.groupby(mm.index.month).transform("mean")
        columns["rain_3m_anomaly"] = (mm - climatology).rolling(3, min_periods=3).sum() / 100
        columns["rain_12m_anomaly"] = (mm - climatology).rolling(12, min_periods=12).sum() / 100
    frame = pd.DataFrame(columns).sort_index()
    if frame.empty:
        return frame
    index = pd.period_range(frame.index.min(), through or frame.index.max(), freq="M")
    frame = frame.reindex(index)
    for name, date in POLICY_EVENTS.items():
        start = pd.Period(date[:7], freq="M")
        frame[f"event_{name}"] = (index >= start).astype(float)
    # Shift each source by its publication delay: the value usable at origin M is the source's M - lag.
    lagged = pd.DataFrame(index=index)
    for column in frame.columns:
        source = "events" if column.startswith("event_") else column.split("_")[0]
        lagged[column] = frame[column].shift(LAG_MONTHS.get(source, 0))
    return lagged


def covariate_version() -> str:
    import hashlib
    digest = hashlib.sha256()
    for name in ("arrivals.csv", "imports.csv", "rainfall.csv"):
        path = DIR / name
        digest.update(path.read_bytes() if path.exists() else b"")
    return digest.hexdigest()

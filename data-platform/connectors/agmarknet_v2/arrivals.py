"""AGMARKNET 2.0 market-wise wholesale arrivals, weekly and monthly (docs/AGMARKNET_V2_ARRIVALS.md).

Verified against the live backend on 2026-11-17 (Karnataka = state 16, Arecanut(Betelnut/Supari) = commodity 118):
- ``GET https://api.agmarknet.gov.in/v1/price-trend/wholesale-arrivals-monthly?report_mode=Marketwise&commodity=118
  &year=YYYY&month=M&state=16&district=D`` and ``…/wholesale-arrivals-weekly?…&week=1..4`` answer without login or
  CAPTCHA. ``report_mode=Marketwise`` is the only mode accepted for arrivals, so it needs a district.
- JSON: ``{"success": true, "title", "data": [{"key", "columns": [{"key", "title"}]}], "rows": [{"market", ...}]}``. The
  current period's column is ``arrivals_<month>_<year>`` (monthly) or ``arrivals_<d1>_<d2>_<mon>_<year>`` (weekly), titled
  ``Arrivals October, 2026 (Metric Tonnes)`` / ``Arrivals 1-8 Oct 2026 (Metric Tonnes)``. ``null`` means not reported.
- Weeks are month-relative: 1-8, 9-15, 16-23 and 24 to month end; the four weeks add up to the month exactly.
- The open month and week return partial totals with no marker, so only closed periods are taken.
- Monthly data reaches back to at least 2010; AGMARKNET 2.0 went live on 2025-11-07, and October 2025 is
  under-reported in every market.

Daily arrivals (``daily-price-arrival/report``, ``prices-and-arrivals/*``) need a CAPTCHA or a logged-in token and are
not used. Nothing here touches the data.gov.in price connectors.
"""
from __future__ import annotations

import calendar
import json
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable
from zoneinfo import ZoneInfo

DEFAULT_BASE_URL = "https://api.agmarknet.gov.in/v1/"
ENDPOINTS = {"month": "wholesale-arrivals-monthly", "agm_week": "wholesale-arrivals-weekly"}
COMMODITY_ID = 118
COMMODITY_NAME = "Arecanut(Betelnut/Supari)"
STATE_ID = 16
STATE = "Karnataka"
PARSER_VERSION = "agmarknet-v2-arrivals/1"
USER_AGENT = "ANI-agmarknet-v2-arrivals/1.0 (Areca Pulse; arecanut arrivals research)"
VERIFIED_UNIT = "Metric Tonnes"
# A period is taken only once its last day is at least this many days old (IST); the server requires it to be past.
DEFAULT_LAG_DAYS = 2
# Fetches per import request; the API accepts at most 5 (src/agmarknet-v2-arrivals.ts).
MAX_FETCHES_PER_IMPORT = 5
RETRYABLE_HTTP = {408, 429, 500, 502, 503, 504}
IST = ZoneInfo("Asia/Kolkata")
API_USER_AGENT = "ANI-data-platform/1.0"  # Cloudflare refuses Python's default urllib signature.


class SourceError(RuntimeError):
    """The source could not be reached or answered with something other than a usable report."""


def today_ist() -> date:
    return datetime.now(IST).date()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True, order=True)
class Period:
    year: int
    month: int
    week: int | None = None  # None for a month

    @property
    def kind(self) -> str:
        return "month" if self.week is None else "agm_week"

    @property
    def bounds(self) -> tuple[date, date]:
        last = calendar.monthrange(self.year, self.month)[1]
        if self.week is None:
            return date(self.year, self.month, 1), date(self.year, self.month, last)
        first, final = ((1, 8), (9, 15), (16, 23), (24, last))[self.week - 1]
        return date(self.year, self.month, first), date(self.year, self.month, final)

    @property
    def column_key(self) -> str:
        name = calendar.month_name[self.month].lower()
        if self.week is None:
            return f"arrivals_{name}_{self.year}"
        start, end = self.bounds
        return f"arrivals_{start.day}_{end.day}_{name[:3]}_{self.year}"

    @property
    def label_prefix(self) -> str:
        if self.week is None:
            return f"Arrivals {calendar.month_name[self.month]}, {self.year} ("
        start, end = self.bounds
        return f"Arrivals {start.day}-{end.day} {calendar.month_abbr[self.month]} {self.year} ("

    @property
    def title_suffix(self) -> str:
        """How the report title ends for this period, e.g. "October, 2026" or "Week 2 of November, 2026"."""
        month = f"{calendar.month_name[self.month]}, {self.year}"
        return month if self.week is None else f"Week {self.week} of {month}"

    def params(self, district_id: int) -> dict[str, str]:
        values = {"report_mode": "Marketwise", "commodity": str(COMMODITY_ID), "year": str(self.year), "month": str(self.month)}
        if self.week is not None:
            values["week"] = str(self.week)
        values.update({"state": str(STATE_ID), "district": str(district_id)})
        return values

    def closed(self, today: date, lag_days: int = DEFAULT_LAG_DAYS) -> bool:
        return self.bounds[1] <= today - timedelta(days=lag_days)

    def __str__(self) -> str:
        return f"{self.year}-{self.month:02d}" + (f"-w{self.week}" if self.week else "")


def months_back(latest: Period, count: int) -> list[Period]:
    periods, year, month = [], latest.year, latest.month
    for _ in range(count):
        periods.append(Period(year, month))
        year, month = (year - 1, 12) if month == 1 else (year, month - 1)
    return periods


def latest_closed_month(today: date, lag_days: int = DEFAULT_LAG_DAYS) -> Period:
    candidate = Period(today.year, today.month)
    while not candidate.closed(today, lag_days):
        candidate = months_back(candidate, 2)[1]
    return candidate


def recent_periods(today: date, months: int, weeks: int, lag_days: int = DEFAULT_LAG_DAYS) -> list[Period]:
    """The last ``months`` closed months and ``weeks`` closed weeks, newest first."""
    result = months_back(latest_closed_month(today, lag_days), months) if months else []
    closed_weeks: list[Period] = []
    for month in months_back(Period(today.year, today.month), 3):
        for week in (4, 3, 2, 1):
            period = Period(month.year, month.month, week)
            if period.closed(today, lag_days) and len(closed_weeks) < weeks:
                closed_weeks.append(period)
    return result + closed_weeks


class Client:
    """Polite GET client: one request at a time, at least ``min_interval`` seconds apart, back-off on 429/5xx."""

    def __init__(self, base_url: str = DEFAULT_BASE_URL, *, min_interval: float = 2.0, timeout: float = 60.0, retries: int = 4,
                 opener: Callable[..., Any] = urllib.request.urlopen, sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.monotonic):
        self.base_url = base_url.rstrip("/") + "/"
        self.min_interval, self.timeout, self.retries = min_interval, timeout, retries
        self.opener, self.sleep, self.clock = opener, sleep, clock
        self._last = -1e9
        self.requests = 0

    def url(self, path: str, params: dict[str, str]) -> str:
        return f"{self.base_url}{path}?{urllib.parse.urlencode(params)}"

    def get(self, path: str, params: dict[str, str]) -> tuple[str, int, str, str]:
        url = self.url(path, params)
        last_error = "unknown error"
        for attempt in range(self.retries + 1):
            wait = self.min_interval - (self.clock() - self._last)
            if wait > 0:
                self.sleep(wait)
            self._last = self.clock()
            self.requests += 1
            request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
            try:
                with self.opener(request, timeout=self.timeout) as response:
                    body = response.read().decode("utf-8")
                    return url, int(getattr(response, "status", 200)), response.headers.get("Content-Type", ""), body
            except urllib.error.HTTPError as error:
                detail = error.read().decode("utf-8", errors="replace")[:300]
                last_error = f"HTTP {error.code}: {detail}"
                if error.code not in RETRYABLE_HTTP:
                    raise SourceError(f"{path} returned {last_error}") from None
            except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as error:
                reason = getattr(error, "reason", error)
                if isinstance(reason, ssl.SSLCertVerificationError):
                    raise SourceError(f"{path}: TLS certificate verification failed ({reason}); check this Python's CA bundle.") from None
                last_error = f"network error: {reason}"
            if attempt < self.retries:
                self.sleep(min(10 * 2 ** attempt, 120))
        raise SourceError(f"{path} failed after {self.retries + 1} attempt(s): {last_error}")


def fetch_districts(client: Client) -> list[tuple[int, str]]:
    """Karnataka districts that AGMARKNET lists for arecanut (price-trend/district-filter)."""
    _, _, _, body = client.get("price-trend/district-filter", {"commodity": str(COMMODITY_ID), "state": str(STATE_ID)})
    payload = json.loads(body)
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list) or not data:
        raise SourceError("district-filter returned no districts.")
    return [(int(item["district_id"]), str(item["district_name"]).strip()) for item in data]


def parse_report(body: str, period: Period, district_name: str) -> tuple[list[dict[str, Any]], list[str], str | None]:
    """Records for the requested period's column, the problems found and the report title. Problems mean: store nothing."""
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return [], ["Response is not JSON."], None
    if not isinstance(payload, dict) or payload.get("success") is not True:
        return [], [f"Source did not report success: {str(payload.get('message') if isinstance(payload, dict) else payload)[:200]}"], None
    title = payload.get("title") if isinstance(payload.get("title"), str) else None
    if not title or not title.rstrip().endswith(period.title_suffix):
        return [], [f"Report title {title!r} is not for {period.title_suffix}."], title
    # The first arrivals column is the report's own period; later ones are comparison periods.
    arrivals_columns = [column for group in payload.get("data") or [] if isinstance(group, dict)
                        for column in group.get("columns") or [] if isinstance(column, dict) and str(column.get("key", "")).startswith("arrivals_")]
    column = arrivals_columns[0] if arrivals_columns else None
    if not column or column.get("key") != period.column_key or not str(column.get("title", "")).startswith(period.label_prefix):
        return [], [f"The report's current column is not {period.column_key} for {period}."], title
    label = str(column["title"])
    unit = label[label.rfind("(") + 1:label.rfind(")")] if label.endswith(")") else None
    if unit != VERIFIED_UNIT:
        return [], [f"Unit {unit!r} is not the verified {VERIFIED_UNIT!r}."], title
    problems: list[str] = []
    by_market: dict[str, list[Any]] = {}
    for row in payload.get("rows") or []:
        if isinstance(row, dict) and isinstance(row.get("market"), str) and row["market"].strip() != "Total":
            by_market.setdefault(row["market"], []).append(row.get(period.column_key))
    records = []
    start, end = period.bounds
    for market, values in by_market.items():
        if len({json.dumps(value) for value in values}) > 1:
            problems.append(f"{market} appears more than once with different values.")
            continue
        value = values[0]
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0):
            problems.append(f"{market}: value {value!r} is not a non-negative number.")
            continue
        records.append({
            "source_commodity_name": COMMODITY_NAME, "state": STATE, "source_district_name": district_name, "source_market_name": market,
            "period_type": period.kind, "period_start": start.isoformat(), "period_end": end.isoformat(), "period_week": period.week,
            "source_period_label": label, "source_column_key": period.column_key,
            "value_status": "not_reported" if value is None else "reported",
            "quantity_original": None if value is None else value, "unit_original": unit,
            "quantity_tonnes": None if value is None else value,  # Metric Tonnes are tonnes.
        })
    return records, problems, title


def fetch_period(client: Client, period: Period, district_id: int, district_name: str) -> dict[str, Any]:
    """One source request, returned as the import payload with the response body verbatim and any problems found."""
    endpoint = ENDPOINTS[period.kind]
    params = period.params(district_id)
    fetched_at = utc_now_iso()
    url, status, content_type, body = client.get(f"price-trend/{endpoint}", params)
    records, problems, title = parse_report(body, period, district_name)
    return {"endpoint": endpoint, "request_url": url, "request_params": params, "http_status": status, "content_type": content_type,
            "response_body": body, "fetched_at": fetched_at, "parser_version": PARSER_VERSION, "records": records,
            "_problems": problems, "_title": title, "_period": str(period), "_district": district_name}


def _post_json(url: str, token: str, body: dict[str, Any], timeout: float = 60.0) -> dict[str, Any]:
    request = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST", headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": API_USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:800].replace(token, "[redacted]")
        raise RuntimeError(f"ANI API returned HTTP {error.code}: {detail}") from None
    except (urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError(f"ANI API request failed: {getattr(error, 'reason', error)}") from None


def _get_json(url: str, token: str, timeout: float = 60.0) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "User-Agent": API_USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetched_keys(api_url: str, token: str) -> set[tuple[str, int, int, int, int | None]]:
    """(kind, district, year, month, week) already stored, from GET /admin/agmarknet-v2/arrivals/coverage."""
    coverage = _get_json(f"{api_url.rstrip('/')}/admin/agmarknet-v2/arrivals/coverage", token)
    keys = set()
    for row in coverage.get("fetched", []):
        kind = "month" if row["endpoint"] == ENDPOINTS["month"] else "agm_week"
        keys.add((kind, int(row["district"]), int(row["year"]), int(row["month"]), int(row["week"]) if row.get("week") else None))
    return keys


def backfill_periods(start: Period, latest: Period, weekly: bool) -> list[Period]:
    """Every month (and, with ``weekly``, every week) from ``latest`` back to ``start``, newest first."""
    months = []
    for month in months_back(latest, 12 * 40):
        if (month.year, month.month) < (start.year, start.month):
            break
        months.append(month)
    if not weekly:
        return months
    return [period for month in months for period in [month] + [Period(month.year, month.month, week) for week in (4, 3, 2, 1)]]


def ingest(work: Iterable[tuple[Period, int, str]], client: Client, *, dry_run: bool, api_url: str | None, token: str | None,
           report_dir: Path | None, mode: str, max_requests: int | None = None, log: Callable[[str], None] = print) -> dict[str, Any]:
    """Fetch, check and import each (period, district). A fetch with any problem is reported and nothing of it is stored."""
    if not dry_run and (not api_url or not token):
        raise ValueError("ANI_API_URL and INGESTION_TOKEN are required unless --dry-run is used.")
    started_at = utc_now_iso()
    totals = {"fetched": 0, "accepted_fetches": 0, "rejected_fetches": 0, "records": 0, "reported": 0, "not_reported": 0,
              "inserted": 0, "revised": 0, "duplicates": 0, "source_errors": 0}
    rejected: list[dict[str, Any]] = []
    errors: list[str] = []
    periods: set[str] = set()
    markets: set[str] = set()
    pending: list[dict[str, Any]] = []
    import_failed = False
    raw_stream = None
    if report_dir:
        report_dir.mkdir(parents=True, exist_ok=True)
        raw_stream = (report_dir / "raw_source_responses.jsonl").open("w", encoding="utf-8")

    def flush() -> None:
        if not pending:
            return
        if not dry_run:
            payload = {"fetches": [{k: v for k, v in item.items() if not k.startswith("_")} for item in pending]}
            result = _post_json(f"{api_url.rstrip('/')}/admin/agmarknet-v2/arrivals/import", token, payload)
            for name in ("inserted", "revised", "duplicates"):
                totals[name] += int(result.get(name, 0))
        pending.clear()

    try:
        for period, district_id, district_name in work:
            if max_requests is not None and client.requests >= max_requests:
                log(f"request budget of {max_requests} reached; the rest waits for the next run")
                break
            try:
                item = fetch_period(client, period, district_id, district_name)
            except SourceError as error:
                totals["source_errors"] += 1
                errors.append(f"{period} {district_name}: {error}")
                continue
            totals["fetched"] += 1
            if raw_stream:
                raw_stream.write(json.dumps({k: item[k] for k in ("request_url", "fetched_at", "http_status", "content_type", "response_body")},
                                            ensure_ascii=False) + "\n")
            if item["_problems"]:
                totals["rejected_fetches"] += 1
                rejected.append({"period": item["_period"], "district": district_name, "request_url": item["request_url"], "problems": item["_problems"]})
                continue
            totals["accepted_fetches"] += 1
            totals["records"] += len(item["records"])
            for record in item["records"]:
                totals[record["value_status"]] += 1
                markets.add(f"{record['source_market_name']} ({district_name})")
                periods.add(record["period_start"])
            pending.append(item)
            if len(pending) >= MAX_FETCHES_PER_IMPORT:
                flush()
        flush()
    except RuntimeError as error:
        # The ANI import failed: batches already stored stay stored, and a re-run replays them as duplicates.
        import_failed = True
        errors.insert(0, str(error))
    finally:
        if raw_stream:
            raw_stream.close()
    status = ("failed" if import_failed or (errors and not totals["accepted_fetches"]) else "no_data" if not totals["fetched"]
              else "completed_with_rejections" if rejected or errors else "completed")
    summary = {"source_key": "agmarknet_v2_arrivals", "mode": mode, "dry_run": dry_run, "status": status, "started_at": started_at,
               "completed_at": utc_now_iso(), "source_requests": client.requests, **totals, "market_count": len(markets),
               "period_starts": sorted(periods), "rejected": rejected, "errors": errors}
    if report_dir:
        (report_dir / "ingestion_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if not dry_run and api_url and token:
        run = {"mode": "backfill" if mode == "backfill" else "daily", "status": status, "started_at": summary["started_at"],
               "completed_at": summary["completed_at"], "request_filters": {"state": str(STATE_ID), "commodity": str(COMMODITY_ID)},
               "fetched_count": totals["fetched"], "accepted_count": totals["records"], "rejected_count": totals["rejected_fetches"],
               "inserted_count": totals["inserted"], "duplicate_count": totals["duplicates"], "corrected_count": totals["revised"],
               "market_count": len(markets), "reporting_dates": sorted(periods)[-400:],
               "rejected_sample": [{"source_record_id": item["request_url"][:256], "reasons": [
                   {"code": "fetch_rejected", "message": problem[:300], "severity": "reject"} for problem in item["problems"][:10]]}
                   for item in rejected[:25]],
               "error_message": "; ".join(errors)[:1000] or None}
        try:
            summary["run_id"] = _post_json(f"{api_url.rstrip('/')}/admin/agmarknet-v2/arrivals/runs", token, run)["id"]
        except RuntimeError as error:
            summary["run_record_error"] = str(error)
    return summary

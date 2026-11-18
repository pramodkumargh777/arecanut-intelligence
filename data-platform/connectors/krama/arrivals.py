"""Daily arecanut arrivals from KRAMA, the Karnataka Department of Agricultural Marketing's market information system
(Krishi Marata Vahini, https://krama.karnataka.gov.in). See docs/DAILY_ARRIVALS.md.

KRAMA is the state system the APMCs report into; AGMARKNET's Karnataka figures come from it. The public report page
needs no login or CAPTCHA. Verified 2026-11-17:

1. ``GET  /Reports/Main_rep`` returns an ASP.NET form.
2. ``POST /Reports/Main_rep`` with ``TxtDate=dd/mm/yyyy`` and ``RadBtnSel=C`` ("Commoditywise Daily Report") redirects to
   ``/reports/Commadity``, listing the commodities reported that day. Arecanut is checkbox ``140``; when it is missing,
   no market reported arecanut that day.
3. ``POST /reports/Commadity`` with ``140=on`` returns ``/reports/CommadityRep``. The heading reads
   ``MARKETWISE REPORT FOR VARIOUS COMMODITIES AS ON dd/mm/yyyy`` and ``COMMODITY: Arecanut``. One table follows, with
   columns Market, Variety, Grade, Arrivals, Units ("Quintal"), Min (Rs.), Max (Rs.) and Modal (Rs.).

The connector keeps the heading and that table verbatim (about 11 KB a day) and sends them to the API, which parses and
checks them itself (api/src/daily-arrivals.ts). The full page's SHA-256 and size are recorded, and the page is written to
the report directory.
"""
from __future__ import annotations

import hashlib
import html
import http.cookiejar
import json
import os
import re
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from itertools import groupby
from pathlib import Path
from typing import Any, Callable, Iterable
from zoneinfo import ZoneInfo

BASE_URL = "https://krama.karnataka.gov.in/"
SOURCE_KEY = "krama_arrivals"
COMMODITY_CODE = "140"  # KRAMA's arecanut checkbox
PAYLOAD_FORMAT = "krama_commodity_table/1"
PARSER_VERSION = "krama-arrivals/1"
USER_AGENT = "Mozilla/5.0 (compatible; ANI-krama-arrivals/1.0; Areca Pulse arecanut arrivals; contact@adikenaadi.com)"
RELAY_TOKEN_HEADER = "X-ANI-Relay-Token"
# A run stops after this many dates in a row fail (each already tried twice): KRAMA is down or unreachable from here.
MAX_CONSECUTIVE_FAILURES = 3
API_USER_AGENT = "ANI-data-platform/1.0"
EXPECTED_HEADER = ["Market", "Variety", "Grade", "Arrivals", "Units", "Min (Rs.)", "Max (Rs.)", "Modal (Rs.)"]
# Documents per import request; the API accepts at most this many (src/daily-arrivals.ts).
MAX_DOCUMENTS_PER_IMPORT = 10
RETRYABLE_HTTP = {408, 429, 500, 502, 503, 504}
IST = ZoneInfo("Asia/Kolkata")
EARLIEST_DATE = date(2014, 1, 1)


class SourceError(RuntimeError):
    """KRAMA could not be reached or answered with a page this connector does not recognise."""


def load_env_file(path: Path) -> dict[str, str]:
    """KEY=VALUE lines from ``path``; variables already set in the environment win. The same rule as the AGMARKNET
    connectors, kept here so this package needs nothing outside the standard library."""
    values: dict[str, str] = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"').strip("'")
    return {**values, **os.environ}


def today_ist() -> date:
    return datetime.now(IST).date()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _hidden_fields(page: str) -> dict[str, str]:
    return {name: html.unescape(value) for name, value in re.findall(r'<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"', page)}


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


class Session:
    """One KRAMA browsing session: cookies kept, one request at a time, at least ``min_interval`` seconds apart."""

    def __init__(self, base_url: str = BASE_URL, *, min_interval: float = 2.0, timeout: float = 90.0, retries: int = 3,
                 opener: Any = None, sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic,
                 relay_token: str | None = None):
        self.base_url = base_url.rstrip("/") + "/"
        # Only a proxy in front of KRAMA (KRAMA_BASE_URL) gets the token; KRAMA itself never sees it.
        self.relay_token = relay_token if urllib.parse.urlsplit(self.base_url).hostname != urllib.parse.urlsplit(BASE_URL).hostname else None
        self.opener = opener or urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.min_interval, self.timeout, self.retries = min_interval, timeout, retries
        self.sleep, self.clock = sleep, clock
        self._last = -1e9
        self.requests = 0

    def request(self, path: str, form: dict[str, str] | None = None, referer: str | None = None) -> tuple[str, bytes]:
        url = self.base_url + path
        data = urllib.parse.urlencode(form).encode("utf-8") if form is not None else None
        last_error = "unknown error"
        for attempt in range(self.retries + 1):
            wait = self.min_interval - (self.clock() - self._last)
            if wait > 0:
                self.sleep(wait)
            self._last = self.clock()
            self.requests += 1
            headers = {"User-Agent": USER_AGENT, "Accept": "text/html"}
            if referer:
                headers["Referer"] = referer
            if self.relay_token:
                headers[RELAY_TOKEN_HEADER] = self.relay_token
            try:
                with self.opener.open(urllib.request.Request(url, data=data, headers=headers), timeout=self.timeout) as response:
                    return response.geturl(), response.read()
            except urllib.error.HTTPError as error:
                last_error = f"HTTP {error.code}"
                if error.code not in RETRYABLE_HTTP:
                    raise SourceError(f"KRAMA {path} returned {last_error}") from None
            except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as error:
                reason = getattr(error, "reason", error)
                if isinstance(reason, ssl.SSLCertVerificationError):
                    raise SourceError(f"KRAMA {path}: TLS certificate verification failed ({reason}).") from None
                last_error = f"network error: {reason}"
            if attempt < self.retries:
                self.sleep(min(10 * 2 ** attempt, 120))
        raise SourceError(f"KRAMA {path} failed after {self.retries + 1} attempt(s): {last_error}")

    def check(self, timeout: float = 30.0) -> None:
        """One quick request to the report menu, so an unreachable KRAMA fails the run in seconds rather than hours."""
        headers = {"User-Agent": USER_AGENT, "Accept": "text/html"}
        if self.relay_token:
            headers[RELAY_TOKEN_HEADER] = self.relay_token
        try:
            with self.opener.open(urllib.request.Request(self.base_url + "Reports/Main_rep", headers=headers), timeout=timeout) as response:
                page = response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:120].strip()
            hint = " (the relay could not connect to KRAMA)" if error.code in (502, 504, 522, 523, 524) else ""
            raise SourceError(f"KRAMA is not reachable at {self.base_url}: HTTP {error.code} {detail}{hint}") from None
        except Exception as error:  # noqa: BLE001 - any failure means the run cannot proceed
            raise SourceError(f"KRAMA is not reachable at {self.base_url}: {getattr(error, 'reason', error)}") from None
        if "__VIEWSTATE" not in page:
            raise SourceError(f"{self.base_url}Reports/Main_rep did not return KRAMA's report form.")


@dataclass
class DayReport:
    day: date
    status: str  # "reported" or "not_reported" (arecanut absent from the day's commodity list)
    document: dict[str, Any]
    raw_pages: dict[str, bytes]
    row_count: int


NO_DATA = "No Data Found For The Commodity"


def extract_report(page: str, day: date) -> tuple[str, str, str]:
    """The heading, commodity line and data table of a CommadityRep page, verbatim. Raises SourceError if unrecognised.

    A day KRAMA lists arecanut for but holds no rows has a one-cell table reading ``No Data Found For The Commodity``;
    its table is returned as is and the caller records the day as not reported."""
    heading = re.search(r'<span id="_ctl0_MainContent_Lbl_Heading"[^>]*>(.*?)</span>', page, re.S)
    commodity = re.search(r'<span[^>]*>\s*(COMMODITY:[^<]*)</span>', page)
    tables = re.findall(r"<table\b.*?</table>", page, re.S)
    if not heading or not commodity or len(tables) != 1:
        raise SourceError(f"{day.isoformat()}: the KRAMA report page layout is not the verified one.")
    heading_text = _text(heading.group(1))
    if heading_text != f"MARKETWISE REPORT FOR VARIOUS COMMODITIES AS ON {day.strftime('%d/%m/%Y')}":
        raise SourceError(f"{day.isoformat()}: report heading {heading_text!r} is not for the requested date.")
    commodity_text = _text(commodity.group(1))
    if commodity_text != "COMMODITY: Arecanut":
        raise SourceError(f"{day.isoformat()}: report is for {commodity_text!r}, not arecanut.")
    if is_no_data(tables[0]):
        return heading_text, commodity_text, tables[0]
    header = [_text(cell) for cell in re.findall(r"<th\b[^>]*>(.*?)</th>", tables[0], re.S)]
    if header != EXPECTED_HEADER:
        raise SourceError(f"{day.isoformat()}: table columns {header} are not the verified ones.")
    return heading_text, commodity_text, tables[0]


def is_no_data(table: str) -> bool:
    cells = [_text(cell) for cell in re.findall(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", table, re.S)]
    return cells == [NO_DATA]


def fetch_day(session: Session, day: date) -> DayReport:
    """The arecanut Commoditywise Daily Report for one date, through the same three steps as the public page."""
    menu_url, menu = session.request("Reports/Main_rep")
    form = _hidden_fields(menu.decode("utf-8", "replace"))
    if "__VIEWSTATE" not in form:
        raise SourceError("KRAMA report menu has no form state; the page layout changed.")
    form.update({"_ctl0:txtSiteSearch": "", "_ctl0:MainContent:TxtDate": day.strftime("%d/%m/%Y"),
                 "_ctl0:MainContent:RadBtnSel": "C", "_ctl0:MainContent:BtnRep": "View Report"})
    list_url, listing = session.request("Reports/Main_rep", form, referer=menu_url)
    listing_text = listing.decode("utf-8", "replace")
    if "reports/Commadity" not in list_url:
        raise SourceError(f"{day.isoformat()}: KRAMA did not open the commodity list (landed on {list_url}).")
    reported_on = re.search(r"Commodities Reported on (\d{2}/\d{2}/\d{4})", _text(listing_text))
    if not reported_on or reported_on.group(1) != day.strftime("%d/%m/%Y"):
        raise SourceError(f"{day.isoformat()}: the commodity list is not for the requested date.")
    request_params = {"report": "C", "date": day.strftime("%d/%m/%Y"), "commodity": COMMODITY_CODE}
    # Provenance names KRAMA's own page, also when the request went through the relay.
    base = {"request_url": f"{BASE_URL}reports/CommadityRep", "request_params": request_params,
            "period_start": day.isoformat(), "period_end": day.isoformat(), "fetched_at": utc_now_iso(),
            "payload_format": PAYLOAD_FORMAT, "parser_version": PARSER_VERSION}
    if f'name="_ctl0:MainContent:{COMMODITY_CODE}"' not in listing_text:
        payload = {"status": "not_reported", "date": day.isoformat(), "evidence": reported_on.group(0)}
        raw = listing
        return DayReport(day, "not_reported", {**base, "raw_sha256": hashlib.sha256(raw).hexdigest(), "raw_bytes": len(raw),
                                               "payload": json.dumps(payload, ensure_ascii=False)}, {"commodity_list": listing}, 0)
    form = _hidden_fields(listing_text)
    form.update({"_ctl0:txtSiteSearch": "", f"_ctl0:MainContent:{COMMODITY_CODE}": "on", "_ctl0:MainContent:BtnRep": "View Report"})
    report_url, report = session.request("reports/Commadity", form, referer=list_url)
    if "reports/CommadityRep" not in report_url:
        raise SourceError(f"{day.isoformat()}: KRAMA did not open the commodity report (landed on {report_url}).")
    heading, commodity, table = extract_report(report.decode("utf-8", "replace"), day)
    if is_no_data(table):
        payload = {"status": "not_reported", "date": day.isoformat(), "evidence": NO_DATA, "heading": heading, "commodity": commodity}
        return DayReport(day, "not_reported", {**base, "raw_sha256": hashlib.sha256(report).hexdigest(), "raw_bytes": len(report),
                                               "payload": json.dumps(payload, ensure_ascii=False)}, {"report": report}, 0)
    payload = {"status": "reported", "date": day.isoformat(), "heading": heading, "commodity": commodity, "table_html": table}
    rows = len(re.findall(r"<tr\b", table)) - 1
    return DayReport(day, "reported", {**base, "raw_sha256": hashlib.sha256(report).hexdigest(), "raw_bytes": len(report),
                                       "payload": json.dumps(payload, ensure_ascii=False)}, {"report": report}, rows)


def _api(method: str, url: str, token: str, body: Any = None, timeout: float = 300.0, attempts: int = 3,
         sleep: Callable[[float], None] = time.sleep) -> Any:
    """Calls the ANI API. Timeouts, network errors and 5xx are retried: imports are idempotent (a document already stored
    is counted as duplicates), so a request that timed out after the server stored it is safe to send again."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Authorization": f"Bearer {token}", "User-Agent": API_USER_AGENT}
    if data is not None:
        headers["Content-Type"] = "application/json"
    endpoint = url.rsplit("/v1", 1)[-1]
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, method=method, headers=headers), timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:800].replace(token, "[redacted]")
            if error.code < 500 or attempt == attempts - 1:
                raise RuntimeError(f"ANI API {endpoint} returned HTTP {error.code}: {detail}") from None
        except (urllib.error.URLError, TimeoutError, socket.timeout) as error:
            if attempt == attempts - 1:
                raise RuntimeError(f"ANI API {endpoint} request failed: {getattr(error, 'reason', error)}") from None
        sleep(15 * (attempt + 1))
    raise RuntimeError("unreachable")


def stored_dates(api_url: str, token: str, source_key: str = SOURCE_KEY) -> set[str]:
    """Dates already fetched for this source (GET /admin/arrivals/daily/coverage)."""
    coverage = _api("GET", f"{api_url.rstrip('/')}/admin/arrivals/daily/coverage?source_key={source_key}", token)
    return set(coverage.get("fetched_dates", []))


def ingest(days: Iterable[date], session: Session, *, dry_run: bool, api_url: str | None, token: str | None,
           report_dir: Path | None, mode: str, max_requests: int | None = None,
           log: Callable[[str], None] = lambda message: print(message, flush=True)) -> dict[str, Any]:
    """Fetch each date, keep the pages, and import the documents in batches. A date that fails is retried next run."""
    if not dry_run and (not api_url or not token):
        raise ValueError("ANI_API_URL and INGESTION_TOKEN are required unless --dry-run is used.")
    started_at = utc_now_iso()
    totals = {"dates": 0, "reported_dates": 0, "not_reported_dates": 0, "table_rows": 0, "documents_new": 0, "inserted": 0,
              "revised": 0, "duplicates": 0, "rejected_rows": 0, "source_errors": 0}
    errors: list[str] = []
    rejected: list[dict[str, Any]] = []
    dates: list[str] = []
    pending: list[DayReport] = []
    import_failed = False
    consecutive_failures = 0
    stopped = False

    def flush() -> None:
        if not pending:
            return
        if not dry_run:
            result = _api("POST", f"{api_url.rstrip('/')}/admin/arrivals/daily/import", token,
                          {"source_key": SOURCE_KEY, "documents": [item.document for item in pending]})
            for name in ("documents_new", "inserted", "revised", "duplicates", "rejected_rows"):
                totals[name] += int(result.get(name, 0))
            rejected.extend(result.get("rejected", [])[:50])
        pending.clear()

    try:
        for day in days:
            if max_requests is not None and session.requests + 3 > max_requests:
                log(f"request budget of {max_requests} reached; the rest waits for the next run")
                break
            try:
                report = fetch_day(session, day)
            except SourceError:
                # KRAMA now and then sends a request back to its menu; the whole form is tried once more, from the start.
                session.sleep(10)
                try:
                    report = fetch_day(session, day)
                except SourceError as error:
                    totals["source_errors"] += 1
                    errors.append(str(error))
                    consecutive_failures += 1
                    log(f"{day.isoformat()} failed: {error}")
                    if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                        errors.insert(0, f"Stopped after {consecutive_failures} dates in a row failed; KRAMA is down or unreachable from here.")
                        stopped = True
                        break
                    continue
            consecutive_failures = 0
            log(f"{day.isoformat()} {report.status} {report.row_count} rows")
            totals["dates"] += 1
            totals[f"{report.status}_dates"] += 1
            totals["table_rows"] += report.row_count
            dates.append(day.isoformat())
            if report_dir:
                report_dir.mkdir(parents=True, exist_ok=True)
                for name, raw in report.raw_pages.items():
                    (report_dir / f"{day.isoformat()}-{name}.html").write_bytes(raw)
            pending.append(report)
            if len(pending) >= MAX_DOCUMENTS_PER_IMPORT:
                flush()
        flush()
    except RuntimeError as error:
        import_failed = True
        errors.insert(0, str(error))
    status = ("failed" if import_failed or stopped or (errors and not totals["dates"]) else "no_data" if not totals["dates"]
              else "completed_with_rejections" if errors or totals["rejected_rows"] else "completed")
    summary = {"source_key": SOURCE_KEY, "mode": mode, "dry_run": dry_run, "status": status, "started_at": started_at,
               "completed_at": utc_now_iso(), "source_requests": session.requests, **totals, "fetched_dates": sorted(dates),
               "rejected": rejected, "errors": errors}
    if report_dir:
        report_dir.mkdir(parents=True, exist_ok=True)
        (report_dir / "ingestion_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if not dry_run and api_url and token:
        run = {"source_key": SOURCE_KEY, "mode": "backfill" if mode == "backfill" else "daily", "status": status,
               "started_at": summary["started_at"], "completed_at": summary["completed_at"],
               "fetched_count": totals["dates"], "accepted_count": totals["inserted"] + totals["revised"] + totals["duplicates"],
               "rejected_count": totals["rejected_rows"], "inserted_count": totals["inserted"], "duplicate_count": totals["duplicates"],
               "corrected_count": totals["revised"], "reporting_dates": sorted(dates)[-400:],
               "error_message": "; ".join(errors)[:1000] or None}
        try:
            summary["run_id"] = _api("POST", f"{api_url.rstrip('/')}/admin/arrivals/daily/runs", token, run)["id"]
        except RuntimeError as error:
            summary["run_record_error"] = str(error)
    return summary


def recent_days(today: date, count: int) -> list[date]:
    """The last ``count`` dates up to today (IST), newest first: late uploads and corrections are picked up again."""
    return [today - timedelta(days=offset) for offset in range(count)]


def backfill_days(done: set[str], start: date, end: date) -> list[date]:
    """Dates from ``end`` back to ``start`` not fetched yet, newest first."""
    days, day = [], end
    while day >= start:
        if day.isoformat() not in done:
            days.append(day)
        day -= timedelta(days=1)
    return days


def whole_months(days: list[date], max_dates: int) -> list[date]:
    """The newest dates that fit ``max_dates`` without splitting a month (a month with some daily rows is shown from those
    alone, so a half-fetched month would read as a fall in arrivals). The first month is taken even if it is larger."""
    chosen: list[date] = []
    for _, group in groupby(days, key=lambda day: (day.year, day.month)):
        month = list(group)
        if chosen and len(chosen) + len(month) > max_dates:
            break
        chosen.extend(month)
    return chosen

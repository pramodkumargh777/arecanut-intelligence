"""AGMARKNET current-daily mandi prices from the data.gov.in resource API.

Verified against the live resource 9ef84268-d588-465a-a308-a864a43d0070 (2026-11-04):
- Response fields: state, district, market, commodity, variety, grade, arrival_date,
  min_price, max_price, modal_price. There is no unit, arrival-quantity or record-id field.
- arrival_date is DD/MM/YYYY.
- Exposed filter ids include ``state.keyword`` and ``commodity``; the exact arecanut
  commodity value is ``Arecanut(Betelnut/Supari)``.
- ``filters[arrival_date]`` is ignored by the API and every record carries the current
  arrival date, so the resource is a current-day snapshot, not a historical archive.
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Callable, Iterable
from zoneinfo import ZoneInfo

from ingestion.idempotency import batch_idempotency_key

DAILY_RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070"
DEFAULT_BASE_URL = "https://api.data.gov.in/resource"
SOURCE_FIELDS = (
    "state", "district", "market", "commodity", "variety", "grade",
    "arrival_date", "min_price", "max_price", "modal_price",
)
# data.gov.in CSV exports use the display names returned in the API "field" metadata.
CSV_HEADER_FIELDS = {
    "State": "state", "District": "district", "Market": "market", "Commodity": "commodity",
    "Variety": "variety", "Grade": "grade", "Arrival_Date": "arrival_date",
    "Min_x0020_Price": "min_price", "Max_x0020_Price": "max_price", "Modal_x0020_Price": "modal_price",
}
STATE_FILTER_FIELD = "state.keyword"
COMMODITY_FILTER_FIELD = "commodity"
ARECANUT_COMMODITY = "Arecanut(Betelnut/Supari)"
DEFAULT_STATE = "Karnataka"
IST = ZoneInfo("Asia/Kolkata")
RETRYABLE_HTTP = {408, 429, 500, 502, 503, 504}
SANITY_MAX_INR_PER_QUINTAL = Decimal(200000)


class SourceAccessError(RuntimeError):
    """The source could not be reached or refused the request; message is key-free."""


class SchemaMismatchError(RuntimeError):
    """The live resource no longer exposes the verified fields."""


@dataclass
class ConnectorConfig:
    api_key: str | None
    resource_id: str = DAILY_RESOURCE_ID
    base_url: str = DEFAULT_BASE_URL
    state: str = DEFAULT_STATE
    commodity: str = ARECANUT_COMMODITY
    price_unit: str | None = None
    page_size: int = 500
    max_pages: int = 20
    timeout_seconds: float = 60.0
    max_retries: int = 3
    backoff_seconds: float = 2.0
    page_delay_seconds: float = 0.5
    relay_token: str | None = None

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None, **overrides: Any) -> "ConnectorConfig":
        env = dict(os.environ if env is None else env)
        values: dict[str, Any] = {
            "api_key": env.get("DATA_GOV_IN_API_KEY") or None,
            "resource_id": env.get("AGMARKNET_DAILY_RESOURCE_ID") or env.get("AGMARKNET_RESOURCE_ID") or DAILY_RESOURCE_ID,
            "base_url": env.get("AGMARKNET_API_BASE_URL") or DEFAULT_BASE_URL,
            "state": env.get("AGMARKNET_STATE") or DEFAULT_STATE,
            "price_unit": env.get("AGMARKNET_PRICE_UNIT") or None,
            "relay_token": env.get("INGESTION_TOKEN") or None,
        }
        for name, kind in (("page_size", int), ("max_pages", int), ("max_retries", int),
                           ("timeout_seconds", float), ("backoff_seconds", float), ("page_delay_seconds", float)):
            raw = env.get(f"AGMARKNET_{name.upper()}")
            if raw:
                values[name] = kind(raw)
        values.update({key: value for key, value in overrides.items() if value is not None})
        return cls(**values)

    def validate(self) -> None:
        if not 1 <= self.page_size <= 1000:
            raise ValueError("page_size must be 1–1000 (data.gov.in maximum).")
        if not 1 <= self.max_pages <= 200:
            raise ValueError("max_pages must be 1–200.")
        if not 0 <= self.max_retries <= 10 or self.backoff_seconds < 0 or self.timeout_seconds <= 0:
            raise ValueError("Retry settings must be non-negative with a positive timeout.")


@dataclass
class FetchResult:
    records: list[dict[str, Any]]
    source_total: int | None
    pages: int
    fetched_at: str
    source_updated_at: str | None
    schema_fields: list[str]
    request_filters: dict[str, str]
    raw_pages: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class ValidationIssue:
    code: str
    message: str
    severity: str  # "reject" or "review"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def today_ist() -> date:
    return datetime.now(IST).date()


def _redact(text: str, secret: str | None) -> str:
    return text.replace(secret, "[redacted]") if secret else text


def _request_page(
    config: ConnectorConfig, offset: int, opener: Callable[..., Any], sleep: Callable[[float], None],
) -> dict[str, Any]:
    params = {
        "api-key": config.api_key or "",
        "format": "json",
        "limit": str(config.page_size),
        "offset": str(offset),
        f"filters[{STATE_FILTER_FIELD}]": config.state,
        f"filters[{COMMODITY_FILTER_FIELD}]": config.commodity,
    }
    url = f"{config.base_url.rstrip('/')}/{urllib.parse.quote(config.resource_id, safe='')}?{urllib.parse.urlencode(params)}"
    last_error = "unknown error"
    for attempt in range(config.max_retries + 1):
        headers = {"Accept": "application/json", "User-Agent": "ANI-agmarknet-connector/1.0"}
        # Only our own relay gets the token (api/src/agmarknet-relay.ts); data.gov.in itself never sees it.
        if config.relay_token and urllib.parse.urlsplit(config.base_url).hostname != urllib.parse.urlsplit(DEFAULT_BASE_URL).hostname:
            headers["X-ANI-Relay-Token"] = config.relay_token
        request = urllib.request.Request(url, headers=headers)
        try:
            with opener(request, timeout=config.timeout_seconds) as response:
                body = response.read().decode("utf-8")
            payload = json.loads(body)
            if not isinstance(payload, dict):
                raise SourceAccessError("data.gov.in returned a non-object JSON response.")
            if payload.get("error"):
                raise SourceAccessError(f"data.gov.in rejected the request: {_redact(str(payload['error']), config.api_key)}")
            if payload.get("status") == "error":
                raise SourceAccessError(f"data.gov.in returned status=error: {_redact(str(payload.get('message')), config.api_key)}")
            return payload
        except urllib.error.HTTPError as error:
            detail = _redact(error.read().decode("utf-8", errors="replace")[:500], config.api_key)
            last_error = f"HTTP {error.code}: {detail}"
            if error.code not in RETRYABLE_HTTP:
                raise SourceAccessError(f"data.gov.in request failed with {last_error}") from None
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as error:
            reason = getattr(error, "reason", error)
            last_error = f"network error: {_redact(str(reason), config.api_key)}"
        except json.JSONDecodeError:
            last_error = "response was not valid JSON"
        if attempt < config.max_retries:
            sleep(config.backoff_seconds * (2 ** attempt))
    raise SourceAccessError(f"data.gov.in request failed after {config.max_retries + 1} attempt(s): {last_error}")


def fetch_agmarknet_daily(
    config: ConnectorConfig,
    *,
    opener: Callable[..., Any] = urllib.request.urlopen,
    sleep: Callable[[float], None] = time.sleep,
) -> FetchResult:
    """Fetch every page of the state+commodity filtered current-daily resource."""
    config.validate()
    if not config.api_key:
        raise SourceAccessError("DATA_GOV_IN_API_KEY is not configured; data.gov.in rejects unauthenticated requests.")
    fetched_at = utc_now_iso()
    records: list[dict[str, Any]] = []
    raw_pages: list[dict[str, Any]] = []
    total: int | None = None
    schema_fields: list[str] = []
    updated_at: str | None = None
    pages = 0
    offset = 0
    while True:
        if pages >= config.max_pages:
            raise SourceAccessError(
                f"Pagination ceiling reached ({config.max_pages} pages) with {total - offset if total else 'unknown'} "
                "record(s) remaining; increase max_pages. No partial snapshot was accepted.")
        payload = _request_page(config, offset, opener, sleep)
        pages += 1
        if pages == 1:
            schema_fields = [str(item.get("id")) for item in payload.get("field") or [] if isinstance(item, dict)]
            missing = [name for name in SOURCE_FIELDS if name not in schema_fields]
            if missing:
                raise SchemaMismatchError(f"Resource schema no longer exposes verified field(s): {', '.join(missing)}.")
            updated_at = payload.get("updated_date")
        try:
            total = int(payload.get("total"))
        except (TypeError, ValueError):
            raise SourceAccessError("data.gov.in response did not include a numeric total.") from None
        page_records = payload.get("records")
        if not isinstance(page_records, list) or not all(isinstance(item, dict) for item in page_records):
            raise SourceAccessError("data.gov.in response did not contain a records array.")
        raw_pages.append({k: v for k, v in payload.items() if k != "field"})
        records.extend(page_records)
        offset += len(page_records)
        if not page_records or offset >= total:
            break
        if config.page_delay_seconds:
            sleep(config.page_delay_seconds)
    if total is not None and len(records) != total:
        raise SourceAccessError(f"Fetched {len(records)} record(s) but source reported total={total}; snapshot rejected as incomplete.")
    return FetchResult(
        records=records, source_total=total, pages=pages, fetched_at=fetched_at,
        source_updated_at=updated_at, schema_fields=schema_fields,
        request_filters={STATE_FILTER_FIELD: config.state, COMMODITY_FILTER_FIELD: config.commodity},
        raw_pages=raw_pages,
    )


def parse_arrival_date(value: Any) -> date:
    text = str(value or "").strip()
    for pattern in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    raise ValueError(f"arrival_date {text!r} is not DD/MM/YYYY")


def _price(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool) or not str(value).strip():
        return None
    try:
        number = Decimal(str(value).strip().replace(",", ""))
    except InvalidOperation:
        return None
    return number if number.is_finite() else None


def canonical_price_unit(value: str | None) -> str | None:
    if not value:
        return None
    text = "".join(ch for ch in value.lower() if ch not in " ._()").replace("rupees", "inr").replace("rs", "inr")
    if text in {"inr/quintal", "inr/qtl", "inrperquintal", "inr/100kg"}:
        return "INR/quintal"
    return None


def validate_agmarknet_record(
    raw: dict[str, Any],
    *,
    state: str = DEFAULT_STATE,
    commodity: str = ARECANUT_COMMODITY,
    today: date | None = None,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    missing = [name for name in SOURCE_FIELDS if name != "grade" and not str(raw.get(name) or "").strip()]
    if missing:
        issues.append(ValidationIssue("missing_field", f"Missing source field(s): {', '.join(missing)}.", "reject"))
    if str(raw.get("commodity") or "").strip() != commodity:
        issues.append(ValidationIssue("commodity_mismatch", f"Commodity {raw.get('commodity')!r} is not exactly {commodity!r}.", "reject"))
    if str(raw.get("state") or "").strip() != state:
        issues.append(ValidationIssue("state_mismatch", f"State {raw.get('state')!r} is not {state!r}.", "reject"))
    try:
        arrival = parse_arrival_date(raw.get("arrival_date"))
        if arrival > (today or today_ist()):
            issues.append(ValidationIssue("future_date", f"arrival_date {arrival.isoformat()} is after today in IST.", "reject"))
    except ValueError as error:
        issues.append(ValidationIssue("invalid_date", str(error), "reject"))
    prices = {name: _price(raw.get(name)) for name in ("min_price", "max_price", "modal_price")}
    for name, value in prices.items():
        if value is None:
            issues.append(ValidationIssue("invalid_price", f"{name} {raw.get(name)!r} is not a finite number.", "reject"))
        elif value <= 0:
            issues.append(ValidationIssue("non_positive_price", f"{name} {value} is not a positive price.", "reject"))
    lo, hi, modal = prices["min_price"], prices["max_price"], prices["modal_price"]
    if all(v is not None and v > 0 for v in (lo, hi, modal)):
        if not (lo <= modal <= hi):
            issues.append(ValidationIssue("price_order", "Prices violate minimum ≤ modal ≤ maximum; reviewer confirmation required.", "review"))
        if hi > SANITY_MAX_INR_PER_QUINTAL:
            issues.append(ValidationIssue("price_magnitude", f"max_price {hi} exceeds {SANITY_MAX_INR_PER_QUINTAL} INR/quintal; check unit.", "review"))
    return issues


def _sha(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def natural_key(raw: dict[str, Any]) -> tuple[str, ...]:
    return tuple(str(raw.get(name) or "").strip() for name in
                 ("state", "district", "market", "commodity", "variety", "grade", "arrival_date"))


def source_record_id(raw: dict[str, Any], resource_id: str) -> str:
    # The resource exposes no record identifier; derive a stable one from its natural key.
    return f"datagovin:{resource_id}:{_sha(natural_key(raw))[:40]}"


def normalize_agmarknet_record(
    raw: dict[str, Any],
    *,
    resource_id: str,
    price_unit: str | None,
    fetched_at: str | None,
    issues: Iterable[ValidationIssue] = (),
) -> dict[str, Any]:
    unit = canonical_price_unit(price_unit)
    if unit is None:
        raise ValueError("Price unit is not confirmed (set AGMARKNET_PRICE_UNIT=Rs./Quintal after verification); no unit was guessed.")
    source = {name: raw.get(name) for name in SOURCE_FIELDS}
    state, district, market = (str(source[k]).strip() for k in ("state", "district", "market"))
    variety = str(source["variety"]).strip()
    grade = str(source["grade"]).strip() if source["grade"] is not None and str(source["grade"]).strip() else None
    review = [issue.message for issue in issues if issue.severity == "review"]
    raw_payload = json.dumps(source, ensure_ascii=False, sort_keys=True)
    record_id = source_record_id(raw, resource_id)
    prices = [float(_price(source[name])) for name in ("min_price", "max_price", "modal_price")]
    return {
        "id": _sha(("agmarknet", record_id, raw_payload, unit)),
        "source_record_id": record_id,
        "source_resource_id": resource_id,
        "market_id": hashlib.sha256("|".join((state.casefold(), district.casefold(), market.casefold())).encode()).hexdigest(),
        "market_name": market,
        "district": district,
        "state": state,
        "reporting_date": parse_arrival_date(source["arrival_date"]).isoformat(),
        "publication_date": None,
        "platform_fetched_at": fetched_at,
        "commodity_name": "Arecanut",
        "original_commodity_name": str(source["commodity"]).strip(),
        "variety_name": variety,
        "original_variety_name": variety,
        "grade": grade,
        "minimum_price": prices[0],
        "maximum_price": prices[1],
        "modal_price": prices[2],
        # The daily resource does not publish arrivals; never infer a quantity.
        "arrival_quantity": None,
        "arrival_unit": None,
        "original_unit": str(price_unit).strip(),
        "price_unit": unit,
        "validation_status": "review_required" if review else "validated",
        "validation_message": " ".join(review)[:500] or None,
        "raw_payload": raw_payload,
    }


@dataclass
class PreparedBatch:
    accepted: list[dict[str, Any]]
    rejected: list[dict[str, Any]]
    duplicates: int
    excluded: int = 0


def _in_scope(raw: dict[str, Any], config: ConnectorConfig) -> bool:
    """Rows for other states/commodities are out of scope; near-miss arecanut names stay in for rejection."""
    state = str(raw.get("state") or "").strip()
    commodity = str(raw.get("commodity") or "").strip()
    if state and state != config.state:
        return False
    return not commodity or commodity == config.commodity or "areca" in commodity.lower() or "betel" in commodity.lower()


def prepare_records(
    raw_records: list[dict[str, Any]],
    config: ConnectorConfig,
    fetched_at: str | None,
    *,
    today: date | None = None,
) -> PreparedBatch:
    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    duplicates = 0
    excluded = 0
    by_key: dict[str, list[tuple[int, dict[str, Any]]]] = {}
    for index, raw in enumerate(raw_records):
        if not isinstance(raw, dict):
            rejected.append({"index": index, "source_record_id": None, "reasons": [
                {"code": "malformed_record", "message": "Source record is not an object.", "severity": "reject"}], "raw": raw})
            continue
        if not _in_scope(raw, config):
            excluded += 1
            continue
        by_key.setdefault(source_record_id(raw, config.resource_id), []).append((index, raw))
    for key, group in by_key.items():
        payloads = {json.dumps({n: group_raw.get(n) for n in SOURCE_FIELDS}, sort_keys=True, default=str) for _, group_raw in group}
        if len(payloads) > 1:
            for index, raw in group:
                rejected.append({"index": index, "source_record_id": key, "reasons": [{
                    "code": "conflicting_duplicate", "severity": "reject",
                    "message": "Same market/variety/grade/date reported with different prices in one snapshot."}],
                    "raw": raw})
            continue
        duplicates += len(group) - 1
        index, raw = group[0]
        issues = validate_agmarknet_record(raw, state=config.state, commodity=config.commodity, today=today)
        blocking = [issue for issue in issues if issue.severity == "reject"]
        if blocking:
            rejected.append({"index": index, "source_record_id": key,
                             "reasons": [issue.__dict__ for issue in blocking], "raw": raw})
            continue
        accepted.append(normalize_agmarknet_record(raw, resource_id=config.resource_id, price_unit=config.price_unit,
                                                   fetched_at=fetched_at, issues=issues))
    return PreparedBatch(accepted, sorted(rejected, key=lambda item: item["index"]), duplicates, excluded)


# Cloudflare answers Python's default "Python-urllib" signature with HTTP 403 (error code 1010).
API_USER_AGENT = "ANI-data-platform/1.0"


def _post_json(url: str, token: str, body: dict[str, Any], timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"), method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": API_USER_AGENT},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"ANI API {url.rsplit('/', 2)[-2:]} returned HTTP {error.code}: "
                           f"{_redact(error.read().decode('utf-8', errors='replace')[:800], token)}") from None
    except (urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError(f"ANI API request failed: {getattr(error, 'reason', error)}") from None


def coverage_report(accepted: list[dict[str, Any]], fetch: FetchResult | None, mode: str) -> dict[str, Any]:
    dates = Counter(record["reporting_date"] for record in accepted)
    return {
        "mode": mode,
        "source_resource_id": None,
        "request_filters": fetch.request_filters if fetch else None,
        "source_total": fetch.source_total if fetch else None,
        "source_updated_at": fetch.source_updated_at if fetch else None,
        "reporting_dates": dict(sorted(dates.items())),
        "districts": dict(sorted(Counter(r["district"] for r in accepted).items())),
        "markets": dict(sorted(Counter(f"{r['market_name']} ({r['district']})" for r in accepted).items())),
        "varieties": dict(sorted(Counter(r["variety_name"] for r in accepted).items())),
        "grades": dict(sorted(Counter(r["grade"] or "(none)" for r in accepted).items())),
        "historical_archive": False if mode == "daily" else None,
        "notes": [
            "The data.gov.in current-daily resource returns only the latest arrival date; it is not a historical archive.",
            "The resource publishes no arrival quantity, price unit or record identifier; unit is operator-confirmed configuration.",
        ],
    }


def write_reports(report_dir: Path, summary: dict[str, Any], coverage: dict[str, Any],
                  rejected: list[dict[str, Any]], raw_pages: list[dict[str, Any]] | None) -> None:
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / "ingestion_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (report_dir / "source_coverage.json").write_text(json.dumps(coverage, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (report_dir / "rejected_records.json").write_text(json.dumps(rejected, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if raw_pages:
        # Archived exactly as received (minus field metadata) for later manual replay.
        with (report_dir / "raw_source_pages.jsonl").open("w", encoding="utf-8") as stream:
            for page in raw_pages:
                stream.write(json.dumps(page, ensure_ascii=False) + "\n")


def ingest_records(
    raw_records: list[dict[str, Any]],
    config: ConnectorConfig,
    *,
    mode: str,
    source_key: str = "agmarknet",
    fetch: FetchResult | None = None,
    fetched_at: str | None = None,
    dry_run: bool = True,
    api_url: str | None = None,
    token: str | None = None,
    batch_size: int = 10,
    report_dir: Path | None = None,
    started_at: str | None = None,
    today: date | None = None,
    error_message: str | None = None,
) -> dict[str, Any]:
    started_at = started_at or utc_now_iso()
    prepared = prepare_records(raw_records, config, fetched_at, today=today)
    totals = {"inserted_count": 0, "duplicate_count": prepared.duplicates, "corrected_count": 0}
    job_ids: list[str] = []
    replayed_batches = 0
    status = "failed" if error_message else "completed"
    if not error_message and not dry_run and prepared.accepted:
        if not api_url or not token:
            raise ValueError("ANI_API_URL and INGESTION_TOKEN are required unless --dry-run is used.")
        if not 1 <= batch_size <= 100:
            raise ValueError("batch_size must be 1–100.")
        try:
            for batch_index, offset in enumerate(range(0, len(prepared.accepted), batch_size)):
                batch = prepared.accepted[offset:offset + batch_size]
                # Retrying the identical batch (same fetch timestamp) replays the completed job instead of re-importing.
                result = _post_json(f"{api_url.rstrip('/')}/admin/import", token,
                                    {"source_key": source_key, "records": batch,
                                     "idempotency_key": batch_idempotency_key("daily", batch_index, batch)},
                                    config.timeout_seconds)
                job_ids.append(result["job_id"])
                if result.get("replayed"):
                    replayed_batches += 1
                    continue
                for name in totals:
                    totals[name] += int(result.get(name, 0))
        except RuntimeError as error:
            status, error_message = "failed", str(error)
    if status == "completed":
        status = "no_data" if not raw_records else "completed_with_rejections" if prepared.rejected else "completed"
    summary = {
        "source_key": source_key,
        "resource_id": config.resource_id,
        "mode": mode,
        "dry_run": dry_run,
        "status": status,
        "started_at": started_at,
        "completed_at": utc_now_iso(),
        "platform_fetched_at": fetched_at,
        "source_updated_at": fetch.source_updated_at if fetch else None,
        "request_filters": fetch.request_filters if fetch else {STATE_FILTER_FIELD: config.state, COMMODITY_FILTER_FIELD: config.commodity},
        "source_total": fetch.source_total if fetch else None,
        "pages": fetch.pages if fetch else None,
        "fetched_count": len(raw_records),
        "out_of_scope_count": prepared.excluded,
        "accepted_count": len(prepared.accepted),
        "review_required_count": sum(1 for r in prepared.accepted if r["validation_status"] == "review_required"),
        "rejected_count": len(prepared.rejected),
        **totals,
        "import_job_ids": job_ids,
        "replayed_batches": replayed_batches,
        "reporting_dates": sorted({r["reporting_date"] for r in prepared.accepted}),
        "market_count": len({r["market_id"] for r in prepared.accepted}),
        "price_unit_basis": f"configured: {config.price_unit}" if config.price_unit else None,
        "error_message": error_message,
    }
    coverage = coverage_report(prepared.accepted, fetch, mode)
    coverage["source_resource_id"] = config.resource_id
    if report_dir:
        write_reports(report_dir, summary, coverage, prepared.rejected, fetch.raw_pages if fetch else None)
        summary["report_dir"] = str(report_dir)
    if not dry_run and api_url and token:
        run = {k: summary[k] for k in (
            "source_key", "resource_id", "mode", "status", "started_at", "completed_at", "source_updated_at",
            "request_filters", "source_total", "fetched_count", "out_of_scope_count", "accepted_count", "review_required_count",
            "rejected_count", "inserted_count", "duplicate_count", "corrected_count", "import_job_ids",
            "reporting_dates", "market_count", "error_message")}
        run["rejected_sample"] = [{"source_record_id": item["source_record_id"], "reasons": item["reasons"]}
                                  for item in prepared.rejected[:25]]
        try:
            summary["run_id"] = _post_json(f"{api_url.rstrip('/')}/admin/source-runs", token, run, config.timeout_seconds)["id"]
        except RuntimeError as error:
            summary["run_record_error"] = str(error)
    summary["rejected_records"] = prepared.rejected
    return summary


def ingest_agmarknet_daily(
    config: ConnectorConfig,
    *,
    dry_run: bool = True,
    api_url: str | None = None,
    token: str | None = None,
    batch_size: int = 10,
    report_dir: Path | None = None,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> dict[str, Any]:
    """Daily incremental ingestion: fetch the current snapshot, validate, persist idempotently."""
    started_at = utc_now_iso()
    try:
        fetch = fetch_agmarknet_daily(config, opener=opener)
    except (SourceAccessError, SchemaMismatchError, ValueError) as error:
        return ingest_records([], config, mode="daily", dry_run=dry_run, api_url=api_url, token=token,
                              report_dir=report_dir, started_at=started_at, error_message=str(error))
    return ingest_records(fetch.records, config, mode="daily", fetch=fetch, fetched_at=fetch.fetched_at,
                          dry_run=dry_run, api_url=api_url, token=token, batch_size=batch_size,
                          report_dir=report_dir, started_at=started_at)


def read_csv_records(path: Path) -> list[dict[str, Any]]:
    """Read an official data.gov.in daily CSV export into the verified API field names."""
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        headers = reader.fieldnames or []
        mapping = {header: CSV_HEADER_FIELDS.get(header.strip(), header.strip() if header.strip() in SOURCE_FIELDS else None)
                   for header in headers}
        missing = sorted(set(SOURCE_FIELDS) - {value for value in mapping.values() if value})
        if missing:
            raise ValueError(f"{path.name}: CSV is not a data.gov.in daily mandi export; missing {', '.join(missing)}.")
        return [{mapping[k]: v for k, v in row.items() if k in mapping and mapping[k]} for row in reader]


def read_replay_records(path: Path) -> list[dict[str, Any]]:
    """Read archived raw API pages (raw_source_pages.jsonl) or a JSON list of raw records."""
    text = path.read_text(encoding="utf-8")
    if path.suffix == ".jsonl":
        records: list[dict[str, Any]] = []
        for line in text.splitlines():
            if line.strip():
                page = json.loads(line)
                records.extend(page["records"] if isinstance(page, dict) and "records" in page else [page])
        return records
    data = json.loads(text)
    return data["records"] if isinstance(data, dict) else data


def backfill_agmarknet_history(
    config: ConnectorConfig,
    start: date,
    end: date,
    *,
    csv_paths: Iterable[Path] = (),
    replay_paths: Iterable[Path] = (),
    dry_run: bool = True,
    api_url: str | None = None,
    token: str | None = None,
    batch_size: int = 10,
    report_dir: Path | None = None,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> dict[str, Any]:
    """Backfill only what genuine sources support and report every uncovered date.

    The live current-daily resource contributes records only for dates it still returns.
    Older dates require official CSV exports (source ``agmarknet_csv``) or archived raw
    API pages captured by previous runs (replayed under ``agmarknet``).
    """
    if end < start:
        raise ValueError("Backfill end date precedes start date.")
    if (end - start).days > 366:
        raise ValueError("Backfill windows are limited to 366 days per run.")
    in_range = lambda raw: _in_range(raw, start, end)  # noqa: E731
    results: dict[str, Any] = {"start": start.isoformat(), "end": end.isoformat(), "parts": []}
    covered: set[str] = set()

    def run(part: str, records: list[dict[str, Any]], mode: str, source_key: str, **kwargs: Any) -> None:
        sub_dir = report_dir / part if report_dir else None
        summary = ingest_records([r for r in records if in_range(r)], config, mode=mode, source_key=source_key,
                                 dry_run=dry_run, api_url=api_url, token=token, batch_size=batch_size,
                                 report_dir=sub_dir, **kwargs)
        covered.update(summary["reporting_dates"])
        summary.pop("rejected_records", None)
        results["parts"].append({"part": part, **summary})

    if config.api_key:
        try:
            fetch = fetch_agmarknet_daily(config, opener=opener)
            run("live_resource", fetch.records, "backfill", "agmarknet", fetch=fetch, fetched_at=fetch.fetched_at)
        except (SourceAccessError, SchemaMismatchError) as error:
            results["parts"].append({"part": "live_resource", "status": "failed", "error_message": str(error)})
    for path in replay_paths:
        run(f"replay_{Path(path).stem}", read_replay_records(Path(path)), "replay", "agmarknet")
    for path in csv_paths:
        run(f"csv_{Path(path).stem}", read_csv_records(Path(path)), "csv", "agmarknet_csv")
    requested = [(start + timedelta(days=n)).isoformat() for n in range((end - start).days + 1)]
    results["covered_dates"] = sorted(covered)
    results["uncovered_dates"] = [day for day in requested if day not in covered]
    results["note"] = ("Uncovered dates had no record in the supplied genuine sources. Markets do not report every day; "
                       "no prices were interpolated.")
    if report_dir:
        report_dir.mkdir(parents=True, exist_ok=True)
        (report_dir / "backfill_summary.json").write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return results


def _in_range(raw: dict[str, Any], start: date, end: date) -> bool:
    try:
        return start <= parse_arrival_date(raw.get("arrival_date")) <= end
    except ValueError:
        return True  # keep so validation reports it as rejected instead of silently dropping it

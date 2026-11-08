"""AGMARKNET variety-wise daily history from data.gov.in, as an add-on to the current-daily connector.

Verified against the live resource 35985678-0d79-46b4-9ed6-6f13308a1d24 (2026-11-08):
- Title "Variety-wise Daily Market Prices Data of Commodity". Karnataka arecanut: 257,009 rows from 2014,
  current to the previous day.
- Fields: Arrival_Date (DD/MM/YYYY), Commodity, Commodity_Code, District, Grade, Market, Max_Price, Min_Price,
  Modal_Price, State, Variety. Values are strings in older rows and integers in recent ones.
- ``filters[State]``, ``filters[Commodity]`` and ``filters[Arrival_Date]`` all work, so each date is fetched on its
  own and checked against that date's ``total``.
- Same values as the current-daily resource for the same market and date (Kumta APMC, Factory, 2026-11-06).
- Market and district names changed over time ("Sirsi" in "Karwar(Uttar Kannad)" is now "Sirsi APMC" in
  "Uttara Kannada"). ``LEGACY_DISTRICTS`` and ``LEGACY_MARKETS`` map old names to the current ones so a market keeps
  one identity; the source's own names stay in ``raw_payload``.

Nothing here changes the current-daily connector: validation and normalization are reused from ``daily.py``, records
go to their own source key and endpoint, and the API never inserts a market/date/variety/grade another source holds.
"""
from __future__ import annotations

import hashlib
import json
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable

from connectors.agmarknet.daily import (
    API_USER_AGENT, DEFAULT_BASE_URL, RETRYABLE_HTTP, ConnectorConfig, SourceAccessError, SchemaMismatchError, _post_json, _redact,
    canonical_price_unit, normalize_agmarknet_record, source_record_id, today_ist, utc_now_iso, validate_agmarknet_record,
)
from ingestion.idempotency import batch_idempotency_key

HISTORY_RESOURCE_ID = "35985678-0d79-46b4-9ed6-6f13308a1d24"
HISTORY_SOURCE_KEY = "agmarknet_history"
# Must stay at or below HISTORY_IMPORT_MAX_RECORDS in api/src/agmarknet-history.ts (D1 50-query limit on Workers Free).
DEFAULT_BATCH_SIZE = 5
MAX_BATCH_SIZE = 5
# The current-daily connector owns recent dates; history only fills dates at least this many days old (IST).
DEFAULT_LAG_DAYS = 2
HISTORY_FIELDS = {
    "State": "state", "District": "district", "Market": "market", "Commodity": "commodity", "Variety": "variety",
    "Grade": "grade", "Arrival_Date": "arrival_date", "Min_Price": "min_price", "Max_Price": "max_price",
    "Modal_Price": "modal_price",
}

# AGMARKNET renamed districts and markets in 2025–2026, in three steps: "Sirsi" / "Karwar(Uttar Kannad)" (to 2025),
# "Sirsi APMC" / "Karwar(Uttar Kannad)" (2025–2026), "Sirsi APMC" / "Uttara Kannada" (current). During the changeover
# data.gov.in published the same price under both the old and the new name on the same day (checked 2026-11-08: Sirsi,
# Tumkur/Tumakuru, Mangalore/Mangaluru, Theertahalli/THIRTHAHALLI, Sagar(Hosanagara)/Hosanagara, Mysore (Bandipalya)/
# Mysuru, Chamaraj Nagar/Chamarajanagar, Chikkamagalore/Chikkamagaluru, Piriya Pattana/Periyapatna: identical
# variety, grade and prices). Without these maps one market would count twice on those days.
#
# Only names with a current counterpart are mapped. Markets that no longer report (Bangalore, Malur, Pavagada,
# Sringeri, Gundlupet, Ramanagara, Sakaleshpura) keep their own names; "Bangalore" and "Kolar" districts were split, so they are
# mapped per market, not as districts.
LEGACY_DISTRICTS: dict[str, str] = {
    "Karwar(Uttar Kannad)": "Uttara Kannada",
    "Mangalore(Dakshin Kannad)": "Dakshina Kannada",
    "Shimoga": "Shivamogga",
    "Chikmagalur": "Chikkamagaluru",
    "Tumkur": "Tumakuru",
    "Mysore": "Mysuru",
    "Madikeri(Kodagu)": "Kodagu",
    "Chamrajnagar": "Chamarajanagar",
}
# Markets whose current name is the old name plus " APMC", by current district.
_APMC_SUFFIX: dict[str, tuple[str, ...]] = {
    "Uttara Kannada": ("Haliyala", "Honnavar", "Kumta", "Siddapur", "Sirsi", "Yellapur"),
    "Dakshina Kannada": ("Bantwala", "Belthangdi", "Puttur", "Sulya"),
    "Shivamogga": ("Bhadravathi", "Sagar", "Shikaripura", "Shimoga", "Sorabha"),
    "Chikkamagaluru": ("Kadur", "Koppa", "Tarikere"),
    "Tumakuru": ("Gubbi", "Huliyar", "Kunigal", "Madhugiri", "Sira", "Turvekere"),
    "Mysuru": ("Hunsur", "K.R.Nagar"),
    "Kodagu": ("Gonikappal", "Madikeri", "Somvarpet"),
    "Hassan": ("Arakalgud", "Arasikere", "Hassan", "Holenarsipura"),
    "Davangere": ("Channagiri", "Davangere", "Honnali"),
    "Chitradurga": ("Chitradurga", "Hiriyur", "Holalkere"),
    "Haveri": ("Byadagi", "Hanagal"),
    "Udupi": ("Karkala", "Kundapura"),
    "Mandya": ("K.R. Pet",),
}
# (district after LEGACY_DISTRICTS, source market) -> (current district, current market).
LEGACY_MARKETS: dict[tuple[str, str], tuple[str, str]] = {
    **{(district, market): (district, f"{market} APMC") for district, markets in _APMC_SUFFIX.items() for market in markets},
    ("Dakshina Kannada", "Mangalore"): ("Dakshina Kannada", "Mangaluru APMC"),
    ("Dakshina Kannada", "Mangalore APMC"): ("Dakshina Kannada", "Mangaluru APMC"),
    ("Shivamogga", "Hosanagar"): ("Shivamogga", "Hosanagara APMC"),
    ("Shivamogga", "Sagar(Hosanagara) APMC"): ("Shivamogga", "Hosanagara APMC"),
    ("Shivamogga", "Shimogga(Theertahalli)"): ("Shivamogga", "APMC THIRTHAHALLI"),
    ("Shivamogga", "Shimoga(Theertahalli)"): ("Shivamogga", "APMC THIRTHAHALLI"),
    ("Shivamogga", "Shimoga(Theertahalli) APMC"): ("Shivamogga", "APMC THIRTHAHALLI"),
    ("Chikkamagaluru", "Chikkamagalore"): ("Chikkamagaluru", "Chikkamagaluru APMC"),
    ("Chikkamagaluru", "Chikkamagalore APMC"): ("Chikkamagaluru", "Chikkamagaluru APMC"),
    ("Chikkamagaluru", "Moodigere"): ("Chikkamagaluru", "Mudigere APMC"),
    ("Chikkamagaluru", "Moodigere APMC"): ("Chikkamagaluru", "Mudigere APMC"),
    ("Tumakuru", "Tumkur"): ("Tumakuru", "Tumakuru APMC"),
    ("Tumakuru", "Tumkur APMC"): ("Tumakuru", "Tumakuru APMC"),
    ("Mysuru", "Piriya Pattana"): ("Mysuru", "Periyapatna APMC"),
    ("Mysuru", "Piriya Pattana APMC"): ("Mysuru", "Periyapatna APMC"),
    ("Mysuru", "Mysore (Bandipalya)"): ("Mysuru", "Mysuru APMC"),
    ("Mysuru", "Mysore (Bandipalya) APMC"): ("Mysuru", "Mysuru APMC"),
    ("Chamarajanagar", "Chamaraj Nagar"): ("Chamarajanagar", "Chamarajanagar APMC"),
    ("Chamarajanagar", "Chamaraj Nagar APMC"): ("Chamarajanagar", "Chamarajanagar APMC"),
    ("Bangalore", "Doddaballa Pur APMC"): ("Bengaluru Rural", "Doddaballapur APMC"),
    ("Kolar", "Gowribidanoor"): ("Chikkaballapur", "Gauribidanur APMC"),
}


@dataclass
class DayFetch:
    day: date
    records: list[dict[str, Any]]
    total: int
    source_updated_at: str | None
    raw_pages: list[dict[str, Any]]


def _request(config: ConnectorConfig, params: dict[str, str], opener: Callable[..., Any],
             sleep: Callable[[float], None]) -> dict[str, Any]:
    query = {"api-key": config.api_key or "", "format": "json", **params}
    url = f"{config.base_url.rstrip('/')}/{urllib.parse.quote(config.resource_id, safe='')}?{urllib.parse.urlencode(query)}"
    headers = {"Accept": "application/json", "User-Agent": "ANI-agmarknet-history/1.0"}
    # Only our own relay gets the token (api/src/agmarknet-relay.ts); data.gov.in itself never sees it.
    if config.relay_token and urllib.parse.urlsplit(config.base_url).hostname != urllib.parse.urlsplit(DEFAULT_BASE_URL).hostname:
        headers["X-ANI-Relay-Token"] = config.relay_token
    last_error = "unknown error"
    for attempt in range(config.max_retries + 1):
        try:
            with opener(urllib.request.Request(url, headers=headers), timeout=config.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if not isinstance(payload, dict):
                raise SourceAccessError("data.gov.in returned a non-object JSON response.")
            if payload.get("error") or payload.get("status") == "error":
                detail = payload.get("error") or payload.get("message")
                raise SourceAccessError(f"data.gov.in rejected the request: {_redact(str(detail), config.api_key)}")
            return payload
        except urllib.error.HTTPError as error:
            detail = _redact(error.read().decode("utf-8", errors="replace")[:500], config.api_key)
            last_error = f"HTTP {error.code}: {detail}"
            if error.code not in RETRYABLE_HTTP:
                raise SourceAccessError(f"data.gov.in request failed with {last_error}") from None
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as error:
            last_error = f"network error: {_redact(str(getattr(error, 'reason', error)), config.api_key)}"
        except json.JSONDecodeError:
            last_error = "response was not valid JSON"
        if attempt < config.max_retries:
            sleep(config.backoff_seconds * (2 ** attempt))
    raise SourceAccessError(f"data.gov.in request failed after {config.max_retries + 1} attempt(s): {last_error}")


def fetch_history_day(config: ConnectorConfig, day: date, *, opener: Callable[..., Any] = urllib.request.urlopen,
                      sleep: Callable[[float], None] = time.sleep) -> DayFetch:
    """Every Karnataka arecanut row for one arrival date. A short read is rejected, never stored as partial."""
    if not config.api_key:
        raise SourceAccessError("DATA_GOV_IN_API_KEY is not configured; data.gov.in rejects unauthenticated requests.")
    filters = {"filters[State]": config.state, "filters[Commodity]": config.commodity,
               "filters[Arrival_Date]": day.strftime("%d/%m/%Y")}
    records: list[dict[str, Any]] = []
    raw_pages: list[dict[str, Any]] = []
    total: int | None = None
    updated_at: str | None = None
    for page in range(config.max_pages):
        payload = _request(config, {**filters, "limit": str(config.page_size), "offset": str(len(records))}, opener, sleep)
        if page == 0:
            fields = {str(item.get("id")) for item in payload.get("field") or [] if isinstance(item, dict)}
            missing = sorted(set(HISTORY_FIELDS) - fields)
            if missing:
                raise SchemaMismatchError(f"History resource no longer exposes verified field(s): {', '.join(missing)}.")
            updated_at = payload.get("updated_date")
        try:
            total = int(payload.get("total"))
        except (TypeError, ValueError):
            raise SourceAccessError("data.gov.in response did not include a numeric total.") from None
        page_records = payload.get("records")
        if not isinstance(page_records, list) or not all(isinstance(item, dict) for item in page_records):
            raise SourceAccessError("data.gov.in response did not contain a records array.")
        raw_pages.append({k: v for k, v in payload.items() if k != "field"} | {"requested_date": day.isoformat()})
        records.extend(page_records)
        if not page_records or len(records) >= total:
            break
        if config.page_delay_seconds:
            sleep(config.page_delay_seconds)
    else:
        raise SourceAccessError(f"{day.isoformat()}: pagination ceiling of {config.max_pages} page(s) reached.")
    if total is not None and len(records) != total:
        raise SourceAccessError(f"{day.isoformat()}: fetched {len(records)} record(s) but source total={total}; date rejected as incomplete.")
    return DayFetch(day, records, total or 0, updated_at, raw_pages)


def to_source_fields(record: dict[str, Any]) -> dict[str, Any]:
    """History field names to the daily connector's names, so its validation applies unchanged."""
    return {name: (None if record.get(field) is None else str(record.get(field)).strip()) for field, name in HISTORY_FIELDS.items()}


def canonical_market(district: str, market: str) -> tuple[str, str]:
    current_district = LEGACY_DISTRICTS.get(district, district)
    return LEGACY_MARKETS.get((current_district, market), (current_district, market))


@dataclass
class PreparedHistory:
    accepted: list[dict[str, Any]]
    rejected: list[dict[str, Any]]
    duplicates: int
    excluded: int
    renamed: Counter


def _sha(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def prepare_history(raw_records: list[dict[str, Any]], config: ConnectorConfig, fetched_at: str, *,
                    today: date | None = None) -> PreparedHistory:
    unit = canonical_price_unit(config.price_unit)
    if unit is None:
        raise ValueError("Price unit is not confirmed (set AGMARKNET_PRICE_UNIT=Rs./Quintal after verification); no unit was guessed.")
    rejected: list[dict[str, Any]] = []
    excluded = duplicates = 0
    renamed: Counter = Counter()
    groups: dict[str, list[tuple[int, dict[str, Any], dict[str, Any]]]] = {}
    for index, original in enumerate(raw_records):
        src = to_source_fields(original)
        if src["state"] != config.state or src["commodity"] != config.commodity:
            excluded += 1
            continue
        groups.setdefault(source_record_id(src, config.resource_id), []).append((index, original, src))
    candidates: list[tuple[int, dict[str, Any], dict[str, Any]]] = []
    for key, group in groups.items():
        if len({json.dumps(src, sort_keys=True) for _, _, src in group}) > 1:
            rejected.extend({"index": index, "source_record_id": key, "raw": original, "reasons": [{
                "code": "conflicting_duplicate", "severity": "reject",
                "message": "Same market/variety/grade/date reported with different prices in one day's records."}]}
                for index, original, _ in group)
            continue
        duplicates += len(group) - 1
        candidates.append(group[0])
    accepted: list[dict[str, Any]] = []
    slots: dict[tuple[str, str, str, str], list[dict[str, Any]]] = {}
    for index, original, src in candidates:
        record_id = source_record_id(src, config.resource_id)
        issues = validate_agmarknet_record(src, state=config.state, commodity=config.commodity, today=today)
        blocking = [issue.__dict__ for issue in issues if issue.severity == "reject"]
        if blocking:
            rejected.append({"index": index, "source_record_id": record_id, "raw": original, "reasons": blocking})
            continue
        district, market = canonical_market(src["district"] or "", src["market"] or "")
        if (district, market) != (src["district"], src["market"]):
            renamed[f"{src['market']} ({src['district']}) -> {market} ({district})"] += 1
        record = normalize_agmarknet_record({**src, "district": district, "market": market}, resource_id=config.resource_id,
                                            price_unit=config.price_unit, fetched_at=fetched_at, issues=issues)
        # Provenance stays with the source: its own names and values, exactly as received.
        record["raw_payload"] = json.dumps(original, ensure_ascii=False, sort_keys=True)
        record["source_record_id"] = record_id
        record["id"] = _sha((HISTORY_SOURCE_KEY, record_id, record["raw_payload"], unit, record["market_id"]))
        slots.setdefault((record["market_id"], record["reporting_date"], record["variety_name"], record["grade"] or ""), []).append(
            {"index": index, "record": record, "raw": original, "current_names": (district, market) == (src["district"], src["market"])})
    price = lambda entry: tuple(entry["record"][k] for k in ("minimum_price", "modal_price", "maximum_price"))  # noqa: E731
    for entries in slots.values():
        if len({price(entry) for entry in entries}) == 1:
            # One price, or the same price published under an old and a new name: keep one copy, preferring the row
            # that already carries current names, then the first in source order (stable across re-runs).
            keep = min(entries, key=lambda entry: (not entry["current_names"], entry["index"]))
            accepted.append(keep["record"])
            duplicates += len(entries) - 1
            continue
        # Different prices on one market after renaming would be a mapping error, so neither is stored.
        rejected.extend({"index": entry["index"], "source_record_id": entry["record"]["source_record_id"], "raw": entry["raw"],
                         "reasons": [{"code": "canonical_market_collision", "severity": "reject",
                                      "message": "Source markets that map to one current market report different prices for the same variety, grade and date."}]}
                        for entry in entries)
    return PreparedHistory(accepted, sorted(rejected, key=lambda item: item["index"]), duplicates, excluded, renamed)


def month_ranges(start: date, end: date) -> list[tuple[date, date]]:
    ranges: list[tuple[date, date]] = []
    first = start
    while first <= end:
        next_month = (first.replace(day=1) + timedelta(days=32)).replace(day=1)
        ranges.append((first, min(end, next_month - timedelta(days=1))))
        first = next_month
    return ranges


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


_ZERO_COUNTS = ("fetched_count", "out_of_scope_count", "accepted_count", "review_required_count", "rejected_count",
                "inserted_count", "duplicate_count", "held_by_other_source_count", "corrected_count", "auto_verified_count")


def _deferred(start: date, end: date, reason: str, records: int, failed_dates: dict[str, str]) -> dict[str, Any]:
    """A month left whole for a later run: nothing of it was stored."""
    return {"source_key": HISTORY_SOURCE_KEY, "status": "deferred", "deferred_reason": reason, "deferred_count": records,
            "start": start.isoformat(), "end": end.isoformat(), **{key: 0 for key in _ZERO_COUNTS}, "import_job_ids": [],
            "reporting_dates": [], "dates_with_no_records": [], "failed_dates": failed_dates, "market_count": 0,
            "renamed_markets": {}, "markets": {}, "error_message": None}


def ingest_history_month(config: ConnectorConfig, start: date, end: date, *, dry_run: bool, api_url: str | None,
                         token: str | None, batch_size: int, report_dir: Path | None,
                         opener: Callable[..., Any], sleep: Callable[[float], None], today: date,
                         max_records: int | None = None, backfill: bool = False) -> dict[str, Any]:
    """One month: fetch, validate, import.

    With ``backfill``, the month is all or nothing so the stored history never has holes: a month with a failed date
    is not stored at all, and records are imported newest date first, so an interrupted import leaves only the oldest
    dates for the next run. With ``max_records``, a month larger than that is left untouched for the next run.
    """
    started_at = utc_now_iso()
    fetched_at = started_at
    days: list[DayFetch] = []
    failed_dates: dict[str, str] = {}
    day = start
    while day <= end:
        try:
            days.append(fetch_history_day(config, day, opener=opener, sleep=sleep))
        except (SourceAccessError, SchemaMismatchError) as error:
            if isinstance(error, SchemaMismatchError):
                raise
            failed_dates[day.isoformat()] = str(error)
        if config.page_delay_seconds:
            sleep(config.page_delay_seconds)
        day += timedelta(days=1)
    raw_records = [record for fetch in days for record in fetch.records]
    if backfill and failed_dates:
        return _deferred(start, end, "fetch_failed", 0, failed_dates)
    prepared = prepare_history(raw_records, config, fetched_at, today=today)
    if max_records is not None and len(prepared.accepted) > max_records:
        return _deferred(start, end, "daily_record_budget", len(prepared.accepted), {})
    if backfill:
        prepared.accepted.sort(key=lambda record: record["reporting_date"], reverse=True)
    totals = {"inserted_count": 0, "duplicate_count": prepared.duplicates, "held_by_other_source_count": 0,
              "corrected_count": 0, "auto_verified_count": 0}
    job_ids: list[str] = []
    errors = [f"{d}: {m}" for d, m in failed_dates.items()]
    import_failed = False
    if not dry_run and prepared.accepted:
        if not api_url or not token:
            raise ValueError("ANI_API_URL and INGESTION_TOKEN are required unless --dry-run is used.")
        try:
            for batch_index, offset in enumerate(range(0, len(prepared.accepted), batch_size)):
                batch = prepared.accepted[offset:offset + batch_size]
                result = _post_json(f"{api_url.rstrip('/')}/admin/agmarknet-history/import", token, {
                    "records": batch,
                    # Bound to the month and the exact batch content, so a re-run replays completed batches.
                    "idempotency_key": batch_idempotency_key(f"history-{start.strftime('%Y-%m')}", batch_index, batch),
                }, config.timeout_seconds)
                job_ids.append(result["job_id"])
                if not result.get("replayed"):
                    for name in totals:
                        totals[name] += int(result.get(name, 0))
        except RuntimeError as error:
            # Completed batches stay stored; re-running the month replays them and continues from the failed one.
            import_failed = True
            errors.insert(0, str(error))
    error_message = "; ".join(errors)[:1000] or None
    if import_failed or (failed_dates and not raw_records):
        status = "failed"
    elif not raw_records:
        status = "no_data"
    elif prepared.rejected or failed_dates:
        status = "completed_with_rejections"
    else:
        status = "completed"
    per_date = {fetch.day.isoformat(): fetch.total for fetch in days}
    summary = {
        "source_key": HISTORY_SOURCE_KEY, "resource_id": config.resource_id, "mode": "backfill", "dry_run": dry_run,
        "status": status, "start": start.isoformat(), "end": end.isoformat(), "started_at": started_at,
        "completed_at": utc_now_iso(),
        "source_updated_at": next((fetch.source_updated_at for fetch in days if fetch.source_updated_at), None),
        "fetched_count": len(raw_records), "out_of_scope_count": prepared.excluded, "accepted_count": len(prepared.accepted),
        "review_required_count": sum(1 for r in prepared.accepted if r["validation_status"] == "review_required"),
        "rejected_count": len(prepared.rejected), **totals, "import_job_ids": job_ids,
        "reporting_dates": sorted({r["reporting_date"] for r in prepared.accepted}),
        "dates_with_no_records": sorted(d for d, n in per_date.items() if n == 0),
        "failed_dates": failed_dates,
        "market_count": len({r["market_id"] for r in prepared.accepted}),
        "renamed_markets": dict(sorted(prepared.renamed.items())),
        "markets": dict(sorted(Counter(f"{r['market_name']} ({r['district']})" for r in prepared.accepted).items())),
        "error_message": error_message,
    }
    if report_dir:
        month_dir = report_dir / start.strftime("%Y-%m")
        _write_json(month_dir / "ingestion_summary.json", summary)
        _write_json(month_dir / "rejected_records.json", prepared.rejected)
        with (month_dir / "raw_source_pages.jsonl").open("w", encoding="utf-8") as stream:
            for fetch in days:
                for page in fetch.raw_pages:
                    stream.write(json.dumps(page, ensure_ascii=False) + "\n")
    if not dry_run and api_url and token:
        run = {k: summary[k] for k in ("source_key", "resource_id", "mode", "status", "started_at", "completed_at",
                                       "source_updated_at", "fetched_count", "out_of_scope_count", "accepted_count",
                                       "review_required_count", "rejected_count", "inserted_count", "corrected_count",
                                       "import_job_ids", "reporting_dates", "market_count", "error_message")}
        run["duplicate_count"] = totals["duplicate_count"] + totals["held_by_other_source_count"]
        run["source_total"] = sum(per_date.values())
        run["request_filters"] = {"State": config.state, "Commodity": config.commodity,
                                  "Arrival_Date": f"{start.isoformat()}..{end.isoformat()}"}
        run["rejected_sample"] = [{"source_record_id": item["source_record_id"], "reasons": item["reasons"][:10]}
                                  for item in prepared.rejected[:25]]
        try:
            summary["run_id"] = _post_json(f"{api_url.rstrip('/')}/admin/source-runs", token, run, config.timeout_seconds)["id"]
        except RuntimeError as error:
            summary["run_record_error"] = str(error)
    return summary


def backfill_history(config: ConnectorConfig, start: date, end: date, *, dry_run: bool = True, api_url: str | None = None,
                     token: str | None = None, batch_size: int = DEFAULT_BATCH_SIZE, lag_days: int = DEFAULT_LAG_DAYS,
                     report_dir: Path | None = None, opener: Callable[..., Any] = urllib.request.urlopen,
                     sleep: Callable[[float], None] = time.sleep, today: date | None = None,
                     on_month: Callable[[dict[str, Any]], None] | None = None,
                     backfill: bool = False, max_records: int | None = None) -> dict[str, Any]:
    """Fetch, validate and import one month at a time. Re-running any range is safe: imports are idempotent.

    With ``backfill``, months go newest first and the run stops at the first month that fails or is deferred, so the
    stored history stays contiguous and the next run resumes from it. ``max_records`` caps the records stored per run
    (the D1 daily write budget); the first month always runs, so one large month cannot stall the backfill.
    """
    config.validate()
    if not 1 <= batch_size <= MAX_BATCH_SIZE:
        raise ValueError(f"batch_size must be 1–{MAX_BATCH_SIZE} (D1 query limit per request).")
    if lag_days < 1:
        raise ValueError("lag_days must be at least 1 so the current-daily connector keeps today's date.")
    today = today or today_ist()
    latest = today - timedelta(days=lag_days)
    end = min(end, latest)
    if end < start:
        raise ValueError(f"Nothing to fetch: the range ends before {latest.isoformat()} is allowed (lag {lag_days} day(s)).")
    months: list[dict[str, Any]] = []
    ranges = month_ranges(start, end)
    used = 0
    for month_start, month_end in reversed(ranges) if backfill else ranges:
        remaining = None if max_records is None or not months else max(max_records - used, 0)
        summary = ingest_history_month(config, month_start, month_end, dry_run=dry_run, api_url=api_url, token=token,
                                       batch_size=batch_size, report_dir=report_dir, opener=opener, sleep=sleep, today=today,
                                       max_records=remaining, backfill=backfill)
        months.append(summary)
        if on_month:
            on_month(summary)
        used += summary["accepted_count"]
        if backfill and (summary["status"] in ("deferred", "failed") or (max_records is not None and used >= max_records)):
            break
    keys = ("fetched_count", "accepted_count", "review_required_count", "rejected_count", "inserted_count", "duplicate_count",
            "held_by_other_source_count", "corrected_count", "auto_verified_count")
    result = {
        "source_key": HISTORY_SOURCE_KEY, "start": start.isoformat(), "end": end.isoformat(), "dry_run": dry_run,
        "months": len(months), **{key: sum(m[key] for m in months) for key in keys},
        "failed_dates": {d: m for month in months for d, m in month["failed_dates"].items()},
        "dates_with_no_records": [d for month in months for d in month["dates_with_no_records"]],
        "renamed_markets": dict(sorted(sum((Counter(m["renamed_markets"]) for m in months), Counter()).items())),
        "markets": dict(sorted(sum((Counter(m["markets"]) for m in months), Counter()).items())),
        "deferred": [{"month": m["start"][:7], "reason": m["deferred_reason"], "records": m["deferred_count"]}
                     for m in months if m["status"] == "deferred"],
        "status": "failed" if any(m["status"] == "failed" for m in months) else
                  "completed_with_rejections" if any(m["status"] == "completed_with_rejections" for m in months) else "completed",
    }
    if report_dir:
        _write_json(report_dir / "backfill_summary.json", result)
    return result


def fetch_history_coverage(api_url: str, token: str, timeout: float = 60.0) -> dict[str, Any]:
    """The stored history range from GET /admin/agmarknet-history/coverage."""
    request = urllib.request.Request(f"{api_url.rstrip('/')}/admin/agmarknet-history/coverage",
                                     headers={"Authorization": f"Bearer {token}", "User-Agent": API_USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"ANI API coverage request returned HTTP {error.code}.") from None
    except (urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError(f"ANI API coverage request failed: {getattr(error, 'reason', error)}") from None


# Within this many days of backfill_from the backfill counts as complete: the first days of a year can be holidays
# with no market data, and waiting for a record there would repeat the same empty window every day.
BACKFILL_DONE_WITHIN_DAYS = 7


def next_backfill_window(earliest: date | None, backfill_from: date, latest: date, months: int) -> tuple[date, date] | None:
    """The next window of whole months ending at the oldest stored date, or None once ``backfill_from`` is reached.

    The window includes the oldest stored date itself, so a date that an interrupted run stored only in part is
    completed (the stored records are duplicates and cost nothing).
    """
    if months < 1:
        raise ValueError("months must be at least 1.")
    if earliest and (earliest - backfill_from).days < BACKFILL_DONE_WITHIN_DAYS:
        return None
    end = earliest if earliest else latest
    month_index = end.year * 12 + end.month - 1 - (months - 1)
    start = date(month_index // 12, month_index % 12 + 1, 1)
    return max(start, backfill_from), end

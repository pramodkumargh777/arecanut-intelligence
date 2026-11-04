from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any


FIELD_ALIASES = {
    "date": ("arrival_date", "reporting_date", "date", "reported_date"),
    "state": ("state",),
    "district": ("district",),
    "market": ("market", "market_name", "apmc"),
    "commodity": ("commodity", "commodity_name", "crop"),
    "variety": ("variety", "variety_name", "grade"),
    "minimum": ("min_price", "minimum_price", "min_modal_price", "minimum"),
    "maximum": ("max_price", "maximum_price", "max_modal_price", "maximum"),
    "modal": ("modal_price", "modal", "model_price"),
    "arrival": ("arrival", "arrival_quantity", "arrivals", "arrivals_tonnes"),
    "arrival_unit": ("arrival_unit", "arrival_quantity_unit"),
    "unit": ("unit", "price_unit", "original_unit"),
    "source_id": ("source_record_id", "record_id", "id"),
    "publication_date": ("publication_date", "published_date"),
}


class RowError(ValueError):
    pass


def _key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower().replace("_x0020_", " ")).strip("_")


def _value(row: dict[str, Any], field: str) -> tuple[str | None, Any]:
    aliases = set(FIELD_ALIASES[field])
    for key, value in row.items():
        normalized = _key(str(key))
        has_unit_suffix = field in {"minimum", "maximum", "modal"} and any(
            normalized.startswith(f"{alias}_") for alias in aliases
        )
        if (normalized in aliases or has_unit_suffix) and value is not None and str(value).strip():
            return str(key), value
    return None, None


def _date(value: Any) -> str:
    text = str(value).strip()
    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, pattern).date().isoformat()
        except ValueError:
            continue
    raise RowError(f"Unrecognized reporting date: {text!r}.")


def _number(value: Any, label: str, *, optional: bool = False) -> Decimal | None:
    if value is None or not str(value).strip():
        if optional:
            return None
        raise RowError(f"Missing {label}.")
    try:
        result = Decimal(str(value).strip().replace(",", ""))
    except InvalidOperation as error:
        raise RowError(f"Invalid {label}: {value!r}.") from error
    if not result.is_finite() or result < 0:
        raise RowError(f"{label.capitalize()} must be a non-negative finite number.")
    return result


def _parse_unit(value: str) -> str:
    text = re.sub(r"[\s.()_]", "", value.lower()).replace("rupees", "inr").replace("rs", "inr")
    match = re.fullmatch(r"inr(?:/|per)(quintals?|qtl|100kg|kg)", text)
    if not match:
        raise RowError(f"Price unit is missing or unsupported: {value!r}; no unit conversion was guessed.")
    return "INR/kg" if match.group(1) == "kg" else "INR/quintal"


def _unit(row: dict[str, Any], configured: str | None = None) -> str:
    _, explicit = _value(row, "unit")
    common = _parse_unit(str(explicit)) if explicit else _parse_unit(configured) if configured else None
    if explicit and configured and _parse_unit(configured) != common:
        raise RowError("Conflicting price units in row and source configuration.")
    units: list[str] = []
    for field in ("minimum", "maximum", "modal"):
        key, _ = _value(row, field)
        heading = re.search(r"\(([^)]+)\)", key or "")
        unit = _parse_unit(heading.group(1)) if heading else common
        if unit is None:
            raise RowError("Price unit is missing or unsupported; no unit conversion was guessed.")
        if common and unit != common:
            raise RowError("Conflicting price units in column headings and source configuration.")
        units.append(unit)
    if len(set(units)) != 1:
        raise RowError("Conflicting price units across minimum, maximum and modal columns.")
    return units[0]


def _arrival_unit(row: dict[str, Any]) -> str | None:
    _, explicit = _value(row, "arrival_unit")
    if explicit:
        return str(explicit).strip()
    key, _ = _value(row, "arrival")
    if key:
        normalized = _key(key)
        for suffix in ("tonnes", "tonne", "quintals", "quintal", "qtl", "kg", "bags"):
            if normalized.endswith(f"_{suffix}"):
                return suffix
    return None


def _original_unit(row: dict[str, Any], configured: str | None, canonical: str) -> str:
    _, explicit = _value(row, "unit")
    if explicit:
        return str(explicit).strip()
    if configured:
        return configured.strip()
    for key in row:
        normalized = _key(str(key))
        if any(normalized.startswith(f"{alias}_") for field in ("minimum", "maximum", "modal") for alias in FIELD_ALIASES[field]):
            match = re.search(r"\(([^)]+)\)", str(key))
            if match:
                return match.group(1).strip()
    return canonical


def _stable_id(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalize_record(
    row: dict[str, Any],
    source_key: str,
    configured_price_unit: str | None = None,
) -> dict[str, Any]:
    original = {str(key): value for key, value in row.items()}
    values = {field: _value(original, field)[1] for field in FIELD_ALIASES}
    required = ("date", "state", "district", "market", "commodity", "variety", "minimum", "maximum", "modal")
    missing = [field for field in required if values[field] is None or not str(values[field]).strip()]
    if missing:
        raise RowError(f"Missing required field(s): {', '.join(missing)}.")
    raw_commodity = str(values["commodity"]).strip()
    if raw_commodity.lower().replace(" ", "") not in {"arecanut", "areca", "arecanut(betelnut/supari)"}:
        raise RowError(f"Unsupported commodity {raw_commodity!r}; this importer accepts arecanut only.")

    canonical_unit = _unit(original, configured_price_unit)
    original_unit = _original_unit(original, configured_price_unit, canonical_unit)
    multiplier = Decimal(100) if canonical_unit == "INR/kg" else Decimal(1)
    minimum = _number(values["minimum"], "minimum price") * multiplier
    maximum = _number(values["maximum"], "maximum price") * multiplier
    modal = _number(values["modal"], "modal price") * multiplier
    arrival = _number(values["arrival"], "arrival quantity", optional=True)
    arrival_unit = _arrival_unit(original) if arrival is not None else None

    message = None
    status = "validated"
    if minimum > maximum or not minimum <= modal <= maximum:
        status = "review_required"
        message = "Reported prices are outside the expected minimum ≤ modal ≤ maximum range."
    try:
        if date.fromisoformat(_date(values["date"])) > date.today():
            status = "review_required"
            message = "Reporting date is in the future; reviewer confirmation is required."
    except RowError:
        raise

    state = str(values["state"]).strip()
    district = str(values["district"]).strip()
    market = str(values["market"]).strip()
    variety = str(values["variety"]).strip()
    market_id = _stable_id("|".join((state.casefold(), district.casefold(), market.casefold())))
    raw_payload = json.dumps(original, sort_keys=True, ensure_ascii=False, default=str)
    source_record_id = str(values["source_id"]).strip() if values["source_id"] is not None else _stable_id(
        json.dumps((source_key, state.casefold(), district.casefold(), market.casefold(), _date(values["date"]), variety), ensure_ascii=False)
    )
    unique_id = _stable_id(json.dumps(
        (source_key, source_record_id, raw_payload, canonical_unit, str(minimum), str(maximum), str(modal)),
        ensure_ascii=False,
    ))
    publication_date = None
    if values["publication_date"] is not None:
        publication_date = _date(values["publication_date"])

    return {
        "id": unique_id,
        "source_record_id": source_record_id,
        "market_id": market_id,
        "market_name": market,
        "district": district,
        "state": state,
        "reporting_date": _date(values["date"]),
        "publication_date": publication_date,
        "commodity_name": "Arecanut",
        "original_commodity_name": raw_commodity,
        "variety_name": variety,
        "original_variety_name": variety,
        "minimum_price": float(minimum),
        "maximum_price": float(maximum),
        "modal_price": float(modal),
        "arrival_quantity": float(arrival) if arrival is not None else None,
        "arrival_unit": arrival_unit,
        "original_unit": original_unit,
        "price_unit": "INR/quintal",
        "validation_status": status,
        "validation_message": message,
        "raw_payload": raw_payload,
    }

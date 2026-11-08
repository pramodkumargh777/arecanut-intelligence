import io
import json
import sys
import tempfile
import unittest
import urllib.parse
from datetime import date
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "data-platform"))
from connectors.agmarknet import history  # noqa: E402
from connectors.agmarknet.daily import ConnectorConfig, SchemaMismatchError, SourceAccessError  # noqa: E402
from connectors.agmarknet.history import (  # noqa: E402
    HISTORY_RESOURCE_ID, backfill_history, fetch_history_day, prepare_history,
)

KEY = "test-key-should-never-appear"
FIELDS = [{"id": name} for name in history.HISTORY_FIELDS]
TODAY = date(2026, 11, 8)


def row(**overrides):
    value = {"Arrival_Date": "15/10/2026", "Commodity": "Arecanut(Betelnut/Supari)", "Commodity_Code": 140,
             "District": "Uttara Kannada", "Grade": "Local", "Market": "Sirsi APMC", "Max_Price": 47000,
             "Min_Price": 43000, "Modal_Price": 45000, "State": "Karnataka", "Variety": "Rashi"}
    value.update(overrides)
    return value


def page(records, total):
    return {"status": "ok", "total": total, "count": len(records), "field": FIELDS,
            "updated_date": "2026-11-07T23:36:20Z", "records": records}


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class Opener:
    """Answers each request from a function of its query parameters."""

    def __init__(self, answer):
        self.answer = answer
        self.urls = []

    def __call__(self, request, timeout):
        self.urls.append(request.full_url)
        query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(request.full_url).query))
        return FakeResponse(json.dumps(self.answer(query)).encode())


def config(**overrides):
    values = dict(api_key=KEY, resource_id=HISTORY_RESOURCE_ID, price_unit="Rs./Quintal", page_size=2,
                  backoff_seconds=0, page_delay_seconds=0)
    values.update(overrides)
    return ConnectorConfig(**values)


class FetchTests(unittest.TestCase):
    def test_fetches_one_date_with_all_filters_and_pages(self):
        records = [row(Variety="Rashi"), row(Variety="Bette"), row(Variety="Chali")]
        opener = Opener(lambda q: page(records[int(q["offset"]):int(q["offset"]) + 2], 3))
        result = fetch_history_day(config(), date(2026, 10, 15), opener=opener, sleep=lambda _: None)
        self.assertEqual(len(result.records), 3)
        query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(opener.urls[0]).query))
        self.assertEqual(query["filters[Arrival_Date]"], "15/10/2026")
        self.assertEqual(query["filters[State]"], "Karnataka")
        self.assertEqual(query["filters[Commodity]"], "Arecanut(Betelnut/Supari)")
        self.assertIn(HISTORY_RESOURCE_ID, opener.urls[0])

    def test_rejects_a_short_read(self):
        opener = Opener(lambda q: page([row()] if q["offset"] == "0" else [], 2))
        with self.assertRaises(SourceAccessError):
            fetch_history_day(config(), date(2026, 10, 15), opener=opener, sleep=lambda _: None)

    def test_stops_on_schema_drift(self):
        opener = Opener(lambda q: {**page([row()], 1), "field": [{"id": "State"}]})
        with self.assertRaises(SchemaMismatchError):
            fetch_history_day(config(), date(2026, 10, 15), opener=opener, sleep=lambda _: None)

    def test_error_messages_never_contain_the_key(self):
        def answer(q):
            return {"error": f"bad key {q['api-key']}"}
        with self.assertRaises(SourceAccessError) as caught:
            fetch_history_day(config(), date(2026, 10, 15), opener=Opener(answer), sleep=lambda _: None)
        self.assertNotIn(KEY, str(caught.exception))


class PrepareTests(unittest.TestCase):
    def test_normalizes_with_daily_rules_and_keeps_the_source_payload(self):
        prepared = prepare_history([row(Min_Price="43,000")], config(), "2026-11-08T05:00:00Z", today=TODAY)
        self.assertEqual(len(prepared.accepted), 1)
        record = prepared.accepted[0]
        self.assertEqual((record["reporting_date"], record["modal_price"], record["grade"]), ("2026-10-15", 45000.0, "Local"))
        self.assertEqual(record["price_unit"], "INR/quintal")
        self.assertEqual(json.loads(record["raw_payload"])["Market"], "Sirsi APMC")
        self.assertTrue(record["source_record_id"].startswith(f"datagovin:{HISTORY_RESOURCE_ID}:"))
        self.assertEqual(len(record["id"]), 64)

    def test_every_naming_generation_maps_to_the_current_market_and_payload_keeps_the_original(self):
        current = prepare_history([row()], config(), "t", today=TODAY).accepted[0]
        for district, market in (("Karwar(Uttar Kannad)", "Sirsi"), ("Karwar(Uttar Kannad)", "Sirsi APMC")):
            prepared = prepare_history([row(District=district, Market=market)], config(), "t", today=TODAY)
            legacy = prepared.accepted[0]
            self.assertEqual(legacy["market_id"], current["market_id"])
            self.assertEqual((legacy["market_name"], legacy["district"]), ("Sirsi APMC", "Uttara Kannada"))
            self.assertEqual(json.loads(legacy["raw_payload"])["Market"], market)
            self.assertEqual(dict(prepared.renamed), {f"{market} ({district}) -> Sirsi APMC (Uttara Kannada)": 1})

    def test_maps_renamed_markets_and_split_districts(self):
        cases = {("Shimoga", "Shimogga(Theertahalli)"): ("Shivamogga", "APMC THIRTHAHALLI"),
                 ("Mangalore(Dakshin Kannad)", "Mangalore"): ("Dakshina Kannada", "Mangaluru APMC"),
                 ("Bangalore", "Doddaballa Pur APMC"): ("Bengaluru Rural", "Doddaballapur APMC"),
                 ("Tumkur", "Tumkur APMC"): ("Tumakuru", "Tumakuru APMC"),
                 # No current counterpart: only the district label changes, the market keeps its name.
                 ("Chikmagalur", "Sringeri"): ("Chikkamagaluru", "Sringeri"),
                 ("Bangalore", "Bangalore"): ("Bangalore", "Bangalore")}
        for source, expected in cases.items():
            self.assertEqual(history.canonical_market(*source), expected)

    def test_every_mapped_target_is_a_current_name(self):
        current_districts = set(history.LEGACY_DISTRICTS.values()) | {"Hassan", "Davangere", "Chitradurga", "Udupi", "Mandya",
                                                                     "Bengaluru Rural", "Chikkaballapur"}
        for (district, _), (target_district, target_market) in history.LEGACY_MARKETS.items():
            self.assertIn(target_district, current_districts)
            self.assertTrue(target_market.endswith(" APMC") or target_market.startswith("APMC "), target_market)
            self.assertNotIn(district, history.LEGACY_DISTRICTS, "keys use the district after LEGACY_DISTRICTS")

    def test_rejects_conflicting_duplicates_and_counts_identical_ones(self):
        prepared = prepare_history([row(), row(), row(Variety="Bette"), row(Variety="Bette", Modal_Price=44000)],
                                   config(), "t", today=TODAY)
        self.assertEqual(len(prepared.accepted), 1)
        self.assertEqual(prepared.duplicates, 1)
        self.assertEqual([r["reasons"][0]["code"] for r in prepared.rejected], ["conflicting_duplicate"] * 2)

    def test_keeps_one_copy_of_a_price_published_under_old_and_new_names(self):
        # As on 2026-04-08: the same Sirsi price under both district labels.
        old = row(District="Karwar(Uttar Kannad)")
        prepared = prepare_history([old, row()], config(), "t", today=TODAY)
        self.assertEqual(len(prepared.accepted), 1)
        self.assertEqual(prepared.duplicates, 1)
        self.assertEqual(json.loads(prepared.accepted[0]["raw_payload"])["District"], "Uttara Kannada")
        # The choice does not depend on source order, so a re-run keeps the same record.
        again = prepare_history([row(), old], config(), "t", today=TODAY)
        self.assertEqual(again.accepted[0]["id"], prepared.accepted[0]["id"])

    def test_rejects_both_when_renamed_markets_disagree_on_price(self):
        prepared = prepare_history([row(), row(District="Karwar(Uttar Kannad)", Market="Sirsi", Modal_Price=44000)],
                                   config(), "t", today=TODAY)
        self.assertEqual(prepared.accepted, [])
        self.assertEqual({r["reasons"][0]["code"] for r in prepared.rejected}, {"canonical_market_collision"})

    def test_flags_and_rejects_like_the_daily_connector(self):
        prepared = prepare_history([row(Variety="A", Min_Price=46000), row(Variety="B", Modal_Price=0),
                                    row(Variety="C", Arrival_Date="31/12/2026"), row(State="Kerala")],
                                   config(), "t", today=TODAY)
        self.assertEqual([r["validation_status"] for r in prepared.accepted], ["review_required"])
        self.assertEqual(sorted(r["reasons"][0]["code"] for r in prepared.rejected), ["future_date", "non_positive_price"])
        self.assertEqual(prepared.excluded, 1)


class BackfillTests(unittest.TestCase):
    def setUp(self):
        self.answers = {"15/10/2026": [row()], "16/10/2026": [row(Arrival_Date="16/10/2026")]}
        self.opener = Opener(lambda q: page(self.answers.get(q["filters[Arrival_Date]"], []),
                                            len(self.answers.get(q["filters[Arrival_Date]"], []))))

    def test_dry_run_persists_nothing_and_reports_empty_dates(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(history, "_post_json") as post:
            result = backfill_history(config(), date(2026, 10, 14), date(2026, 10, 16), dry_run=True,
                                      report_dir=Path(folder), opener=self.opener, sleep=lambda _: None, today=TODAY)
            self.assertTrue((Path(folder) / "2026-10" / "raw_source_pages.jsonl").is_file())
        post.assert_not_called()
        self.assertEqual(result["accepted_count"], 2)
        self.assertEqual(result["dates_with_no_records"], ["2026-10-14"])

    def test_leaves_recent_dates_to_the_daily_connector(self):
        with self.assertRaises(ValueError):
            backfill_history(config(), date(2026, 11, 7), date(2026, 11, 8), opener=self.opener, sleep=lambda _: None, today=TODAY)
        result = backfill_history(config(), date(2026, 11, 5), date(2026, 11, 8), opener=self.opener, sleep=lambda _: None, today=TODAY)
        self.assertEqual(result["end"], "2026-11-06")

    def test_imports_through_the_history_endpoint_in_small_batches(self):
        calls = []

        def fake_post(url, token, body, timeout):
            calls.append((url, body))
            if url.endswith("/admin/source-runs"):
                return {"id": "run-1"}
            return {"job_id": f"job-{len(calls)}", "inserted_count": len(body["records"]), "auto_verified_count": len(body["records"]),
                    "duplicate_count": 0, "held_by_other_source_count": 0, "corrected_count": 0}

        with patch.object(history, "_post_json", side_effect=fake_post):
            result = backfill_history(config(), date(2026, 10, 15), date(2026, 10, 16), dry_run=False, api_url="https://api.test/api/v1",
                                      token="t", batch_size=1, opener=self.opener, sleep=lambda _: None, today=TODAY)
        imports = [body for url, body in calls if url.endswith("/admin/agmarknet-history/import")]
        self.assertEqual([len(body["records"]) for body in imports], [1, 1])
        self.assertTrue(all(body["idempotency_key"].startswith("history-2026-10:") for body in imports))
        run = next(body for url, body in calls if url.endswith("/admin/source-runs"))
        self.assertEqual((run["source_key"], run["mode"], run["source_total"]), ("agmarknet_history", "backfill", 2))
        self.assertEqual(result["auto_verified_count"], 2)

    def test_refuses_batches_above_the_d1_safe_size(self):
        with self.assertRaises(ValueError):
            backfill_history(config(), date(2026, 10, 15), date(2026, 10, 16), batch_size=6, opener=self.opener,
                             sleep=lambda _: None, today=TODAY)


if __name__ == "__main__":
    unittest.main()

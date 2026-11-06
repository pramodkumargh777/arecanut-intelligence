import io
import json
import sys
import tempfile
import unittest
import urllib.error
from datetime import date
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "data-platform"))
from connectors.agmarknet import daily  # noqa: E402
from connectors.agmarknet.daily import (  # noqa: E402
    ConnectorConfig, SchemaMismatchError, SourceAccessError, backfill_agmarknet_history,
    fetch_agmarknet_daily, ingest_records, normalize_agmarknet_record, prepare_records,
    read_csv_records, read_replay_records, validate_agmarknet_record,
)

KEY = "test-key-should-never-appear"
FIELDS = [{"id": name} for name in daily.SOURCE_FIELDS]


def raw(**overrides):
    row = {"state": "Karnataka", "district": "Uttara Kannada", "market": "Sirsi APMC",
           "commodity": "Arecanut(Betelnut/Supari)", "variety": "Rashi", "grade": "Local",
           "arrival_date": "04/11/2026", "min_price": 43099, "max_price": 47019, "modal_price": 45844}
    row.update(overrides)
    return row


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def page(records, total, fields=FIELDS):
    return {"status": "ok", "total": total, "count": len(records), "field": fields,
            "updated_date": "2026-11-04T17:00:54Z", "records": records}


class Opener:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.urls = []

    def __call__(self, request, timeout):
        self.urls.append(request.full_url)
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return FakeResponse(json.dumps(item).encode())


def config(**overrides):
    values = dict(api_key=KEY, price_unit="Rs./Quintal", page_size=2, backoff_seconds=0, page_delay_seconds=0)
    values.update(overrides)
    return ConnectorConfig(**values)


class FetchTests(unittest.TestCase):
    def test_paginates_with_verified_filters_until_source_total(self):
        opener = Opener(page([raw(), raw(variety="Chali")], 3), page([raw(variety="Bette")], 3))
        result = fetch_agmarknet_daily(config(), opener=opener, sleep=lambda _: None)
        self.assertEqual(len(result.records), 3)
        self.assertEqual(result.pages, 2)
        self.assertEqual(result.source_updated_at, "2026-11-04T17:00:54Z")
        self.assertIn("filters%5Bstate.keyword%5D=Karnataka", opener.urls[0])
        self.assertIn("filters%5Bcommodity%5D=Arecanut%28Betelnut%2FSupari%29", opener.urls[0])
        self.assertIn("offset=2", opener.urls[1])

    def test_rejects_incomplete_snapshot_and_page_ceiling(self):
        with self.assertRaisesRegex(SourceAccessError, "incomplete"):
            fetch_agmarknet_daily(config(), opener=Opener(page([raw()], 3), page([], 3)), sleep=lambda _: None)
        with self.assertRaisesRegex(SourceAccessError, "Pagination ceiling"):
            fetch_agmarknet_daily(config(max_pages=1), opener=Opener(page([raw(), raw()], 5)), sleep=lambda _: None)

    def test_schema_drift_is_reported(self):
        with self.assertRaisesRegex(SchemaMismatchError, "modal_price"):
            fetch_agmarknet_daily(config(), opener=Opener(page([raw()], 1, FIELDS[:-1])), sleep=lambda _: None)

    def test_retries_transient_errors_then_succeeds(self):
        transient = urllib.error.HTTPError("u", 503, "busy", {}, io.BytesIO(b"busy"))
        sleeps = []
        result = fetch_agmarknet_daily(config(backoff_seconds=1), opener=Opener(transient, page([raw()], 1)), sleep=sleeps.append)
        self.assertEqual(len(result.records), 1)
        self.assertEqual(sleeps, [1])

    def test_auth_errors_are_exact_and_never_contain_the_key(self):
        denied = urllib.error.HTTPError("u", 403, "denied", {}, io.BytesIO(f"invalid key {KEY}".encode()))
        with self.assertRaises(SourceAccessError) as caught:
            fetch_agmarknet_daily(config(), opener=Opener(denied), sleep=lambda _: None)
        self.assertIn("HTTP 403", str(caught.exception))
        self.assertNotIn(KEY, str(caught.exception))
        with self.assertRaisesRegex(SourceAccessError, "Authorization field missing"):
            fetch_agmarknet_daily(config(), opener=Opener({"error": "Authorization field missing"}), sleep=lambda _: None)
        with self.assertRaisesRegex(SourceAccessError, "DATA_GOV_IN_API_KEY is not configured"):
            fetch_agmarknet_daily(config(api_key=None), opener=Opener(), sleep=lambda _: None)

    def test_exhausted_retries_report_last_error(self):
        error = urllib.error.URLError("timed out")
        with self.assertRaisesRegex(SourceAccessError, "after 2 attempt.*timed out"):
            fetch_agmarknet_daily(config(max_retries=1), opener=Opener(error, error), sleep=lambda _: None)


class ValidationAndNormalizationTests(unittest.TestCase):
    today = date(2026, 11, 4)

    def codes(self, row):
        return {issue.code: issue.severity for issue in validate_agmarknet_record(row, today=self.today)}

    def test_valid_record_has_no_issues(self):
        self.assertEqual(self.codes(raw()), {})

    def test_dates_are_validated_in_ist_calendar(self):
        self.assertEqual(self.codes(raw(arrival_date="05/11/2026")), {"future_date": "reject"})
        self.assertEqual(self.codes(raw(arrival_date="11/04/26")), {"invalid_date": "reject"})
        self.assertEqual(self.codes(raw(arrival_date="31/02/2026")), {"invalid_date": "reject"})
        self.assertEqual(daily.parse_arrival_date("04/11/2026"), date(2026, 11, 4))

    def test_invalid_prices_and_commodity_variants(self):
        self.assertEqual(self.codes(raw(modal_price=0))["non_positive_price"], "reject")
        self.assertEqual(self.codes(raw(min_price="NA"))["invalid_price"], "reject")
        self.assertEqual(self.codes(raw(commodity="Arecanut")), {"commodity_mismatch": "reject"})
        self.assertEqual(self.codes(raw(modal_price=50000)), {"price_order": "review"})
        self.assertEqual(self.codes(raw(min_price=4000000, modal_price=4500000, max_price=4700000)), {"price_magnitude": "review"})

    def test_normalization_preserves_source_terms_and_does_not_invent_arrivals(self):
        record = normalize_agmarknet_record(raw(variety="Hosa Chali", grade="Large"), resource_id="res",
                                            price_unit="Rs./Quintal", fetched_at="2026-11-04T17:09:24Z")
        self.assertEqual((record["variety_name"], record["original_variety_name"], record["grade"]), ("Hosa Chali", "Hosa Chali", "Large"))
        self.assertEqual((record["minimum_price"], record["modal_price"], record["maximum_price"]), (43099.0, 45844.0, 47019.0))
        self.assertEqual((record["reporting_date"], record["publication_date"]), ("2026-11-04", None))
        self.assertEqual((record["price_unit"], record["original_unit"]), ("INR/quintal", "Rs./Quintal"))
        self.assertIsNone(record["arrival_quantity"])
        self.assertEqual(record["source_resource_id"], "res")
        self.assertTrue(record["source_record_id"].startswith("datagovin:res:"))
        self.assertEqual(json.loads(record["raw_payload"])["grade"], "Large")

    def test_unit_must_be_confirmed_and_ids_are_stable(self):
        with self.assertRaisesRegex(ValueError, "not confirmed"):
            normalize_agmarknet_record(raw(), resource_id="res", price_unit=None, fetched_at=None)
        with self.assertRaisesRegex(ValueError, "not confirmed"):
            normalize_agmarknet_record(raw(), resource_id="res", price_unit="Rs./Kg", fetched_at=None)
        first = normalize_agmarknet_record(raw(), resource_id="res", price_unit="Rs./Quintal", fetched_at="2026-11-04T01:00:00Z")
        later = normalize_agmarknet_record(raw(), resource_id="res", price_unit="Rs./Quintal", fetched_at="2026-11-04T09:00:00Z")
        revised = normalize_agmarknet_record(raw(modal_price=46000), resource_id="res", price_unit="Rs./Quintal", fetched_at=None)
        self.assertEqual(first["id"], later["id"])
        self.assertEqual(first["source_record_id"], revised["source_record_id"])
        self.assertNotEqual(first["id"], revised["id"])
        other_grade = normalize_agmarknet_record(raw(grade="Large"), resource_id="res", price_unit="Rs./Quintal", fetched_at=None)
        self.assertNotEqual(first["source_record_id"], other_grade["source_record_id"])


class PreparationAndIngestionTests(unittest.TestCase):
    def test_duplicates_conflicts_rejections_and_scope(self):
        rows = [raw(), raw(), raw(variety="Chali", modal_price=1), raw(variety="Chali", modal_price=2),
                raw(variety="Bette", modal_price=0), raw(state="Kerala"), raw(commodity="Coffee"), raw(commodity="Arecanut")]
        prepared = prepare_records(rows, config(), "2026-11-04T17:09:24Z", today=date(2026, 11, 4))
        self.assertEqual(len(prepared.accepted), 1)
        self.assertEqual(prepared.duplicates, 1)
        self.assertEqual(prepared.excluded, 2)
        codes = [reason["code"] for item in prepared.rejected for reason in item["reasons"]]
        self.assertEqual(codes.count("conflicting_duplicate"), 2)
        self.assertIn("non_positive_price", codes)
        self.assertIn("commodity_mismatch", codes)

    def test_dry_run_persists_nothing_and_reports_without_secrets(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(daily, "_post_json") as post:
            summary = ingest_records([raw(), raw(modal_price=0, variety="X")], config(), mode="daily", dry_run=True,
                                     report_dir=Path(folder), fetched_at="2026-11-04T17:09:24Z", today=date(2026, 11, 4))
            post.assert_not_called()
            self.assertEqual((summary["accepted_count"], summary["rejected_count"], summary["status"]), (1, 1, "completed_with_rejections"))
            for name in ("ingestion_summary.json", "source_coverage.json", "rejected_records.json"):
                self.assertNotIn(KEY, (Path(folder) / name).read_text())
            self.assertEqual(json.loads((Path(folder) / "rejected_records.json").read_text())[0]["raw"]["variety"], "X")

    def test_persisting_batches_imports_and_records_run(self):
        calls = []

        def fake_post(url, token, body, timeout):
            calls.append((url, body))
            if url.endswith("/admin/import"):
                return {"job_id": f"job-{len(calls)}", "inserted_count": len(body["records"]), "duplicate_count": 0, "corrected_count": 0}
            return {"id": "run-1"}

        rows = [raw(variety=f"V{i}") for i in range(3)]
        with patch.object(daily, "_post_json", side_effect=fake_post):
            summary = ingest_records(rows, config(), mode="daily", dry_run=False, api_url="http://api/v1", token="t",
                                     batch_size=2, fetched_at="2026-11-04T17:09:24Z", today=date(2026, 11, 4))
        self.assertEqual([len(body["records"]) for url, body in calls if url.endswith("/admin/import")], [2, 1])
        self.assertEqual(summary["inserted_count"], 3)
        self.assertEqual(summary["run_id"], "run-1")
        run_body = calls[-1][1]
        self.assertEqual(run_body["source_key"], "agmarknet")
        self.assertEqual(run_body["import_job_ids"], ["job-1", "job-2"])

    def test_import_failure_is_recorded_as_failed_run(self):
        def fake_post(url, token, body, timeout):
            if url.endswith("/admin/import"):
                raise RuntimeError("ANI API returned HTTP 401")
            return {"id": "run"}

        with patch.object(daily, "_post_json", side_effect=fake_post):
            summary = ingest_records([raw()], config(), mode="daily", dry_run=False, api_url="http://api/v1", token="t",
                                     today=date(2026, 11, 4))
        self.assertEqual((summary["status"], summary["error_message"]), ("failed", "ANI API returned HTTP 401"))


class BackfillTests(unittest.TestCase):
    def test_csv_and_replay_fill_only_genuine_dates_and_report_gaps(self):
        with tempfile.TemporaryDirectory() as folder:
            csv_path = Path(folder) / "export.csv"
            csv_path.write_text(
                "State,District,Market,Commodity,Variety,Grade,Arrival_Date,Min_x0020_Price,Max_x0020_Price,Modal_x0020_Price\n"
                "Karnataka,Shivamogga,Sagar APMC,Arecanut(Betelnut/Supari),Rashi,FAQ,02/11/2026,40000,50000,44000\n"
                "Kerala,Kasaragod,Kasaragod,Arecanut(Betelnut/Supari),Rashi,FAQ,02/11/2026,40000,50000,44000\n",
                encoding="utf-8")
            replay_path = Path(folder) / "raw_source_pages.jsonl"
            replay_path.write_text(json.dumps(page([raw(arrival_date="03/11/2026")], 1)) + "\n", encoding="utf-8")
            self.assertEqual(read_csv_records(csv_path)[0]["min_price"], "40000")
            self.assertEqual(len(read_replay_records(replay_path)), 1)
            result = backfill_agmarknet_history(config(api_key=None), date(2026, 11, 1), date(2026, 11, 4),
                                                csv_paths=[csv_path], replay_paths=[replay_path], dry_run=True,
                                                report_dir=Path(folder) / "reports")
            self.assertEqual(result["covered_dates"], ["2026-11-02", "2026-11-03"])
            self.assertEqual(result["uncovered_dates"], ["2026-11-01", "2026-11-04"])
            parts = {part["part"]: part for part in result["parts"]}
            self.assertEqual(parts["csv_export"]["source_key"], "agmarknet_csv")
            self.assertEqual(parts["csv_export"]["out_of_scope_count"], 1)
            self.assertEqual(parts["replay_raw_source_pages"]["mode"], "replay")
            self.assertTrue((Path(folder) / "reports" / "backfill_summary.json").is_file())

    def test_rejects_non_daily_csv(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "monthly.csv"
            path.write_text("State,Market,Prices Monthly Analysis\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "not a data.gov.in daily mandi export"):
                read_csv_records(path)


class RelayTests(unittest.TestCase):
    def headers_for(self, **overrides):
        seen = {}

        def opener(request, timeout):
            seen["url"] = request.full_url
            seen["token"] = request.get_header("X-ani-relay-token")
            return FakeResponse(json.dumps({"total": 0, "records": [], "field": FIELDS}).encode())

        fetch_agmarknet_daily(config(relay_token="relay-secret", **overrides), opener=opener, sleep=lambda _: None)
        return seen

    def test_sends_the_token_to_the_relay(self):
        seen = self.headers_for(base_url="https://ani-agmarknet-relay.example.dev/resource")
        self.assertEqual(seen["token"], "relay-secret")
        self.assertTrue(seen["url"].startswith("https://ani-agmarknet-relay.example.dev/resource/"))

    def test_never_sends_the_token_to_data_gov_in(self):
        seen = self.headers_for()
        self.assertTrue(seen["url"].startswith("https://api.data.gov.in/"))
        self.assertIsNone(seen["token"])

    def test_reads_the_token_from_the_ingestion_secret(self):
        built = ConnectorConfig.from_env({"DATA_GOV_IN_API_KEY": "k", "INGESTION_TOKEN": "relay-secret"})
        self.assertEqual(built.relay_token, "relay-secret")


class ApiRequestTests(unittest.TestCase):
    def test_posts_name_the_client_because_cloudflare_blocks_the_python_default(self):
        seen = {}

        def opener(request, timeout):
            seen["agent"] = request.get_header("User-agent")
            return FakeResponse(b"{}")

        with patch.object(daily.urllib.request, "urlopen", opener):
            daily._post_json("https://example.test/api/v1/admin/import", "token", {}, 5)
        self.assertEqual(seen["agent"], daily.API_USER_AGENT)
        self.assertNotIn("python-urllib", seen["agent"].lower())


if __name__ == "__main__":
    unittest.main()

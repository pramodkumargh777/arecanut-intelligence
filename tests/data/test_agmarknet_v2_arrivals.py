import io
import json
import sys
import unittest
import urllib.error
from datetime import date
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "data-platform"))
from connectors.agmarknet_v2 import arrivals  # noqa: E402
from connectors.agmarknet_v2.arrivals import Client, Period, SourceError, backfill_periods, ingest, parse_report, recent_periods  # noqa: E402

FIXTURES = ROOT / "api" / "src" / "fixtures" / "agmarknet-v2"
MONTHLY = (FIXTURES / "monthly-2026-10-uttara-kannada.json").read_text(encoding="utf-8")
WEEKLY = (FIXTURES / "weekly-2026-11-w2-uttara-kannada.json").read_text(encoding="utf-8")


class Response(io.BytesIO):
    def __init__(self, body: str, status: int = 200):
        super().__init__(body.encode("utf-8"))
        self.status = status
        self.headers = {"Content-Type": "application/json"}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeClock:
    def __init__(self):
        self.now = 0.0
        self.sleeps: list[float] = []

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds

    def clock(self) -> float:
        return self.now


class PeriodTests(unittest.TestCase):
    def test_month_relative_weeks(self):
        self.assertEqual(Period(2026, 10, 1).bounds, (date(2026, 10, 1), date(2026, 10, 8)))
        self.assertEqual(Period(2026, 10, 3).bounds, (date(2026, 10, 16), date(2026, 10, 23)))
        self.assertEqual(Period(2026, 2, 4).bounds, (date(2026, 2, 24), date(2026, 2, 28)))
        self.assertEqual(Period(2026, 11, 2).column_key, "arrivals_9_15_nov_2026")
        self.assertEqual(Period(2026, 10).column_key, "arrivals_october_2026")
        self.assertEqual(Period(2026, 11, 2).label_prefix, "Arrivals 9-15 Nov 2026 (")

    def test_only_closed_periods_after_the_lag(self):
        today = date(2026, 11, 17)
        self.assertTrue(Period(2026, 11, 2).closed(today))        # ends 15 Nov
        self.assertFalse(Period(2026, 11, 3).closed(today))       # 16-23 Nov is still open
        self.assertFalse(Period(2026, 11).closed(today))
        self.assertFalse(Period(2026, 11, 2).closed(date(2026, 11, 16)))  # inside the 2-day lag

    def test_recent_periods(self):
        periods = recent_periods(date(2026, 11, 17), months=2, weeks=4)
        self.assertEqual([str(p) for p in periods], ["2026-10", "2026-09", "2026-11-w2", "2026-11-w1", "2026-10-w4", "2026-10-w3"])
        self.assertEqual([str(p) for p in recent_periods(date(2026, 11, 1), months=1, weeks=0)], ["2026-09"])

    def test_backfill_periods_newest_first(self):
        months = backfill_periods(Period(2026, 8), Period(2026, 10), weekly=False)
        self.assertEqual([str(p) for p in months], ["2026-10", "2026-09", "2026-08"])
        self.assertEqual(len(backfill_periods(Period(2026, 10), Period(2026, 10), weekly=True)), 5)


class ParseTests(unittest.TestCase):
    def test_monthly_fixture(self):
        records, problems, title = parse_report(MONTHLY, Period(2026, 10), "Uttara Kannada")
        self.assertEqual(problems, [])
        self.assertIn("October, 2026", title)
        self.assertEqual(len(records), 6)
        sirsi = next(r for r in records if r["source_market_name"] == "Sirsi APMC")
        self.assertEqual(sirsi["quantity_original"], 1175.3)
        self.assertEqual(sirsi["quantity_tonnes"], 1175.3)
        self.assertEqual(sirsi["unit_original"], "Metric Tonnes")
        self.assertEqual((sirsi["period_start"], sirsi["period_end"], sirsi["period_week"]), ("2026-10-01", "2026-10-31", None))
        self.assertAlmostEqual(sum(r["quantity_tonnes"] for r in records), 2506.4, places=6)

    def test_weekly_fixture_uses_the_current_week_column_only(self):
        records, problems, _ = parse_report(WEEKLY, Period(2026, 11, 2), "Uttara Kannada")
        self.assertEqual(problems, [])
        sirsi = next(r for r in records if r["source_market_name"] == "Sirsi APMC")
        self.assertEqual((sirsi["quantity_original"], sirsi["source_column_key"]), (79.0, "arrivals_9_15_nov_2026"))

    def test_null_is_not_reported(self):
        body = WEEKLY.replace('"arrivals_9_15_nov_2026":0.2', '"arrivals_9_15_nov_2026":null')
        records, problems, _ = parse_report(body, Period(2026, 11, 2), "Uttara Kannada")
        haliyala = next(r for r in records if r["source_market_name"] == "Haliyala APMC")
        self.assertEqual((problems, haliyala["value_status"], haliyala["quantity_original"]), ([], "not_reported", None))

    def test_wrong_period_unit_or_failure_is_a_problem(self):
        self.assertIn("is not for September, 2026", parse_report(MONTHLY, Period(2026, 9), "x")[1][0])
        self.assertIn("is not for Week 1 of November, 2026", parse_report(WEEKLY, Period(2026, 11, 1), "x")[1][0])
        retitled = MONTHLY.replace("– October, 2026", "– September, 2026")
        self.assertIn("current column", parse_report(retitled, Period(2026, 9), "x")[1][0])
        bad_unit = MONTHLY.replace("October, 2026 (Metric Tonnes)", "October, 2026 (Quintal)")
        self.assertIn("Unit 'Quintal'", parse_report(bad_unit, Period(2026, 10), "x")[1][0])
        self.assertIn("did not report success", parse_report('{"success":false,"message":"Invalid week ID"}', Period(2026, 10), "x")[1][0])
        self.assertEqual(parse_report("<html>", Period(2026, 10), "x")[1], ["Response is not JSON."])

    def test_conflicting_duplicate_market_is_a_problem(self):
        payload = json.loads(MONTHLY)
        payload["rows"].append({**payload["rows"][0], "arrivals_october_2026": 999})
        problems = parse_report(json.dumps(payload), Period(2026, 10), "x")[1]
        self.assertIn("appears more than once", problems[0])


class ClientTests(unittest.TestCase):
    def test_spaces_requests_and_retries_server_errors(self):
        clock, calls = FakeClock(), []

        def opener(request, timeout):
            calls.append(request.full_url)
            if len(calls) == 1:
                raise urllib.error.HTTPError(request.full_url, 503, "busy", {}, io.BytesIO(b"busy"))
            return Response(MONTHLY)

        client = Client(min_interval=2.0, opener=opener, sleep=clock.sleep, clock=clock.clock)
        url, status, _, body = client.get("price-trend/wholesale-arrivals-monthly", Period(2026, 10).params(257))
        self.assertEqual((status, body, client.requests), (200, MONTHLY, 2))
        self.assertIn("district=257", url)
        self.assertIn(10, clock.sleeps)  # back-off after the 503
        client.get("price-trend/wholesale-arrivals-monthly", Period(2026, 10).params(257))
        self.assertGreaterEqual(clock.now, 12)

    def test_client_errors_are_not_retried(self):
        def opener(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 400, "bad", {}, io.BytesIO(b'{"code":"TOKEN_OR_CAPTCHA_REQUIRED"}'))

        client = Client(opener=opener, sleep=lambda s: None)
        with self.assertRaises(SourceError):
            client.get("daily-price-arrival/report", {})
        self.assertEqual(client.requests, 1)


class IngestTests(unittest.TestCase):
    def client(self, bodies):
        def opener(request, timeout):
            return Response(bodies(request.full_url))
        return Client(opener=opener, sleep=lambda s: None, min_interval=0)

    def test_dry_run_reports_and_rejects_without_posting(self):
        def bodies(url):
            return MONTHLY if "district=257" in url else '{"success":false,"message":"Invalid report_mode"}'
        work = [(Period(2026, 10), 257, "Uttara Kannada"), (Period(2026, 10), 266, "Shivamogga")]
        with patch.object(arrivals, "_post_json") as post:
            summary = ingest(work, self.client(bodies), dry_run=True, api_url=None, token=None, report_dir=None, mode="daily")
        post.assert_not_called()
        self.assertEqual((summary["accepted_fetches"], summary["rejected_fetches"], summary["records"]), (1, 1, 6))
        self.assertEqual(summary["status"], "completed_with_rejections")

    def test_imports_in_batches_and_records_the_run(self):
        work = [(Period(2026, 10), district, "Uttara Kannada") for district in range(7)]
        sent = []

        def fake_post(url, token, body, timeout=60.0):
            sent.append((url.rsplit("/", 1)[-1], body))
            return {"id": "run-1"} if url.endswith("/runs") else {"inserted": 6 * len(body["fetches"]), "revised": 0, "duplicates": 0}

        with patch.object(arrivals, "_post_json", side_effect=fake_post):
            summary = ingest(work, self.client(lambda url: MONTHLY), dry_run=False, api_url="http://api/v1", token="t", report_dir=None, mode="daily")
        imports = [body for name, body in sent if name == "import"]
        self.assertEqual([len(body["fetches"]) for body in imports], [5, 2])
        self.assertNotIn("_problems", imports[0]["fetches"][0])
        self.assertEqual(imports[0]["fetches"][0]["response_body"], MONTHLY)
        self.assertEqual((summary["inserted"], summary["run_id"]), (42, "run-1"))
        run = next(body for name, body in sent if name == "runs")
        self.assertEqual((run["mode"], run["status"], run["fetched_count"]), ("daily", "completed", 7))

    def test_request_budget_stops_the_run(self):
        work = [(Period(2026, 10), district, "x") for district in range(5)]
        summary = ingest(work, self.client(lambda url: MONTHLY), dry_run=True, api_url=None, token=None, report_dir=None,
                         mode="backfill", max_requests=2)
        self.assertEqual(summary["fetched"], 2)

    def test_a_failed_import_fails_the_run(self):
        def fake_post(url, token, body, timeout=60.0):
            if url.endswith("/import"):
                raise RuntimeError("ANI API returned HTTP 500")
            return {"id": "run-1"}

        with patch.object(arrivals, "_post_json", side_effect=fake_post) as post:
            summary = ingest([(Period(2026, 10), 257, "x")], self.client(lambda url: MONTHLY), dry_run=False, api_url="http://api/v1",
                             token="t", report_dir=None, mode="daily")
        self.assertEqual(summary["status"], "failed")
        self.assertEqual(post.call_args_list[-1].args[2]["status"], "failed")


class DailyImportDocumentTests(unittest.TestCase):
    def test_document_covers_the_whole_month_with_the_verified_request(self):
        from connectors.agmarknet_v2.run_daily_arrivals import document_for, month_bounds
        self.assertEqual(month_bounds("2024-02"), ("2024-02-01", "2024-02-29"))
        self.assertEqual(month_bounds("2026-12"), ("2026-12-01", "2026-12-31"))
        body = (FIXTURES / "datewise-2026-10-sirsi-yellapur.json").read_bytes()
        document = document_for("2026-10", body, "2026-11-17T05:00:00Z")
        self.assertEqual(document["request_params"], {"year": "2026", "month": "10", "includeExcel": "false", "stateId": "16", "commodityId": "118"})
        self.assertEqual((document["period_start"], document["period_end"], document["payload"]), ("2026-10-01", "2026-10-31", body.decode()))
        self.assertNotIn("Authorization", json.dumps(document))


if __name__ == "__main__":
    unittest.main()

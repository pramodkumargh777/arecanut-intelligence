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
from connectors.krama import arrivals  # noqa: E402
from connectors.krama.arrivals import Session, SourceError, backfill_days, extract_report, fetch_day, ingest, recent_days, whole_months  # noqa: E402

FIXTURES = ROOT / "api" / "src" / "fixtures" / "krama"
REPORT = (FIXTURES / "commodity-arecanut-2026-11-13.html").read_bytes()
LISTING = (FIXTURES / "commodity-select-2026-11-13.html").read_bytes()
MENU = (b'<form><input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="state" />'
        b'<input type="hidden" name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="valid" /></form>')
DAY = date(2026, 11, 13)


class Response(io.BytesIO):
    def __init__(self, body: bytes, url: str):
        super().__init__(body)
        self.url = url

    def geturl(self):
        return self.url

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeKrama:
    """Serves the three verified steps; records each form posted."""

    def __init__(self, listing: bytes = LISTING, report: bytes = REPORT):
        self.listing, self.report, self.posts = listing, report, []

    def open(self, request, timeout):
        form = dict(item.split("=", 1) for item in request.data.decode().split("&")) if request.data else None
        self.posts.append((request.full_url, form))
        if request.full_url.endswith("Reports/Main_rep") and form is None:
            return Response(MENU, request.full_url)
        if request.full_url.endswith("Reports/Main_rep"):
            return Response(self.listing, "https://krama.karnataka.gov.in/reports/Commadity")
        return Response(self.report, "https://krama.karnataka.gov.in/reports/CommadityRep")


def session(fake):
    return Session(opener=fake, sleep=lambda s: None, min_interval=0)


class FetchTests(unittest.TestCase):
    def test_follows_the_public_report_steps(self):
        fake = FakeKrama()
        report = fetch_day(session(fake), DAY)
        self.assertEqual((report.status, report.row_count), ("reported", 76))
        menu, chosen, commodity = fake.posts
        self.assertEqual(chosen[1]["_ctl0%3AMainContent%3ATxtDate"], "13%2F11%2F2026")
        self.assertEqual(chosen[1]["_ctl0%3AMainContent%3ARadBtnSel"], "C")
        self.assertEqual(commodity[1]["_ctl0%3AMainContent%3A140"], "on")
        payload = json.loads(report.document["payload"])
        self.assertEqual(payload["heading"], "MARKETWISE REPORT FOR VARIOUS COMMODITIES AS ON 13/11/2026")
        self.assertTrue(payload["table_html"].startswith("<table") and payload["table_html"].endswith("</table>"))
        self.assertIn(payload["table_html"], REPORT.decode())  # verbatim
        self.assertEqual(report.document["request_params"], {"report": "C", "date": "13/11/2026", "commodity": "140"})
        self.assertEqual(report.document["raw_bytes"], len(REPORT))

    def test_a_day_without_arecanut_is_recorded_as_not_reported(self):
        listing = LISTING.replace(b'name="_ctl0:MainContent:140"', b'name="_ctl0:MainContent:9140"')
        report = fetch_day(session(FakeKrama(listing=listing)), DAY)
        self.assertEqual(report.status, "not_reported")
        self.assertEqual(json.loads(report.document["payload"]), {"status": "not_reported", "date": "2026-11-13",
                                                                  "evidence": "Commodities Reported on 13/11/2026"})

    def test_a_listed_day_whose_report_holds_no_data_is_not_reported(self):
        # Real page: 23 Aug 2026 lists arecanut, but the report reads "No Data Found For The Commodity".
        no_data = (FIXTURES / "commodity-arecanut-2026-08-23-no-data.html").read_bytes()
        listing = LISTING.replace(b"13/11/2026", b"23/08/2026")
        report = fetch_day(session(FakeKrama(listing=listing, report=no_data)), date(2026, 8, 23))
        self.assertEqual((report.status, report.row_count), ("not_reported", 0))
        self.assertEqual(json.loads(report.document["payload"]), {
            "status": "not_reported", "date": "2026-08-23", "evidence": "No Data Found For The Commodity",
            "heading": "MARKETWISE REPORT FOR VARIOUS COMMODITIES AS ON 23/08/2026", "commodity": "COMMODITY: Arecanut"})

    def test_refuses_pages_for_another_date_or_layout(self):
        with self.assertRaisesRegex(SourceError, "commodity list is not for the requested date"):
            fetch_day(session(FakeKrama()), date(2026, 11, 12))
        with self.assertRaisesRegex(SourceError, "not for the requested date"):
            extract_report(REPORT.decode(), date(2026, 11, 12))
        with self.assertRaisesRegex(SourceError, "columns"):
            extract_report(REPORT.decode().replace(">Arrivals<", ">Arrival Qty<"), DAY)

    def test_client_errors_are_not_retried(self):
        class Refusing:
            calls = 0

            def open(self, request, timeout):
                Refusing.calls += 1
                raise urllib.error.HTTPError(request.full_url, 404, "missing", {}, io.BytesIO(b""))

        with self.assertRaises(SourceError):
            session(Refusing()).request("Reports/Main_rep")
        self.assertEqual(Refusing.calls, 1)


class RelayTests(unittest.TestCase):
    def test_through_the_relay_the_token_goes_to_the_relay_and_provenance_names_krama(self):
        fake = FakeKrama()
        seen = []
        original = fake.open

        def open_(request, timeout):
            seen.append((request.full_url, request.get_header("X-ani-relay-token")))
            return original(request, timeout)

        fake.open = open_
        relay = Session("https://relay.example/krama/", opener=fake, sleep=lambda s: None, min_interval=0, relay_token="secret")
        report = fetch_day(relay, DAY)
        self.assertTrue(all(url.startswith("https://relay.example/krama/") and token == "secret" for url, token in seen))
        self.assertEqual(report.document["request_url"], "https://krama.karnataka.gov.in/reports/CommadityRep")
        direct = Session(opener=FakeKrama(), relay_token="secret")
        self.assertIsNone(direct.relay_token)  # KRAMA itself never gets the token

    def test_check_fails_fast_when_krama_cannot_be_reached(self):
        class Down:
            def open(self, request, timeout):
                raise urllib.error.URLError("timed out")

        with self.assertRaisesRegex(SourceError, "not reachable"):
            Session(opener=Down()).check()
        Session(opener=FakeKrama()).check()

    def test_a_run_stops_after_three_dates_in_a_row_fail(self):
        summary = ingest([date(2026, 11, d) for d in (1, 2, 3, 4, 5)], session(FakeKrama()), dry_run=True, api_url=None, token=None,
                         report_dir=None, mode="daily", log=lambda message: None)
        self.assertEqual((summary["source_errors"], summary["status"]), (3, "failed"))
        self.assertIn("in a row", summary["errors"][0])


class PlanTests(unittest.TestCase):
    def test_recent_and_backfill_dates(self):
        self.assertEqual(recent_days(date(2026, 11, 17), 3), [date(2026, 11, 17), date(2026, 11, 16), date(2026, 11, 15)])
        days = backfill_days({"2026-11-16"}, date(2026, 11, 14), date(2026, 11, 17))
        self.assertEqual(days, [date(2026, 11, 17), date(2026, 11, 15), date(2026, 11, 14)])

    def test_backfill_takes_whole_months_within_the_budget(self):
        days = backfill_days(set(), date(2026, 8, 1), date(2026, 10, 31))  # 31 + 30 + 31 dates, newest first
        self.assertEqual(len(whole_months(days, 70)), 61)            # October and September, not part of August
        self.assertEqual(whole_months(days, 70)[-1], date(2026, 9, 1))
        self.assertEqual(len(whole_months(days, 10)), 31)            # a month larger than the budget is still taken whole
        self.assertEqual(len(whole_months(days, 1000)), 92)


class IngestTests(unittest.TestCase):
    def test_imports_in_batches_and_records_the_run(self):
        sent = []

        def fake_api(method, url, token, body=None, timeout=120.0):
            sent.append((url.rsplit("/", 1)[-1], body))
            if url.endswith("/runs"):
                return {"id": "run-1"}
            return {"documents_new": len(body["documents"]), "inserted": 76 * len(body["documents"]), "revised": 0, "duplicates": 0,
                    "rejected_rows": 0, "rejected": []}

        days = [DAY] * 11  # the fake serves the 13 Nov page for every request
        with patch.object(arrivals, "_api", side_effect=fake_api):
            summary = ingest(days, session(FakeKrama()), dry_run=False, api_url="http://api/v1", token="t", report_dir=None, mode="daily")
        imports = [body for name, body in sent if name == "import"]
        self.assertEqual([len(body["documents"]) for body in imports], [10, 1])
        self.assertEqual(imports[0]["source_key"], "krama_arrivals")
        self.assertEqual((summary["status"], summary["inserted"], summary["run_id"]), ("completed", 836, "run-1"))

    def test_a_source_error_is_reported_and_the_rest_continues(self):
        summary = ingest([date(2026, 11, 12), DAY], session(FakeKrama()), dry_run=True, api_url=None, token=None, report_dir=None, mode="daily")
        self.assertEqual((summary["dates"], summary["source_errors"], summary["status"]), (1, 1, "completed_with_rejections"))

    def test_a_date_sent_back_to_the_menu_is_tried_once_more(self):
        class Flaky(FakeKrama):
            failed = False

            def open(self, request, timeout):
                if request.full_url.endswith("reports/Commadity") and not Flaky.failed:
                    Flaky.failed = True
                    return Response(MENU, "https://krama.karnataka.gov.in/reports/Main_Rep")
                return super().open(request, timeout)

        summary = ingest([DAY], session(Flaky()), dry_run=True, api_url=None, token=None, report_dir=None, mode="daily")
        self.assertEqual((summary["dates"], summary["source_errors"], summary["source_requests"]), (1, 0, 6))

    def test_an_import_that_times_out_is_sent_again(self):
        calls = []

        def urlopen(request, timeout):
            calls.append(request.full_url)
            if len(calls) == 1:
                raise TimeoutError("The read operation timed out")
            return Response(b'{"documents_new": 0, "duplicates": 76}', request.full_url)

        with patch.object(arrivals.urllib.request, "urlopen", side_effect=urlopen):
            result = arrivals._api("POST", "http://api/v1/admin/arrivals/daily/import", "t", {"documents": []}, sleep=lambda s: None)
        self.assertEqual((len(calls), result["duplicates"]), (2, 76))
        with patch.object(arrivals.urllib.request, "urlopen", side_effect=TimeoutError("slow")):
            with self.assertRaisesRegex(RuntimeError, "request failed"):
                arrivals._api("POST", "http://api/v1/admin/arrivals/daily/import", "t", {}, sleep=lambda s: None)

    def test_request_budget_stops_before_a_partial_day(self):
        summary = ingest([DAY] * 5, session(FakeKrama()), dry_run=True, api_url=None, token=None, report_dir=None, mode="backfill", max_requests=7)
        self.assertEqual(summary["dates"], 2)


if __name__ == "__main__":
    unittest.main()

import io
import json
import os
import sys
import tempfile
import time
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "data-platform"))
from connectors.agmarknet import daily  # noqa: E402
from connectors.agmarknet.daily import ingest_records  # noqa: E402
from ingestion import retention  # noqa: E402
from ingestion.idempotency import batch_idempotency_key, sha256_file, sha256_json  # noqa: E402
from ingestion.import_csv import send_records  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_agmarknet_daily import config, raw  # noqa: E402

KEY_PATTERN = __import__("re").compile(r"^[A-Za-z0-9:._-]{8,200}$")


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class IdempotencyKeyTests(unittest.TestCase):
    def test_file_hash_matches_known_sha256(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "a.csv"
            path.write_bytes(b"abc")
            self.assertEqual(sha256_file(path), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")

    def test_keys_are_stable_order_independent_and_api_compatible(self):
        sha = "a" * 64
        first = batch_idempotency_key("csv", 0, [{"b": 1, "a": 2}], sha)
        self.assertEqual(first, batch_idempotency_key("csv", 0, [{"a": 2, "b": 1}], sha))
        self.assertRegex(first, KEY_PATTERN)
        self.assertNotEqual(first, batch_idempotency_key("csv", 1, [{"a": 2, "b": 1}], sha))
        self.assertNotEqual(first, batch_idempotency_key("csv", 0, [{"a": 3, "b": 1}], sha))
        self.assertEqual(sha256_json({"b": 1, "a": 2}), sha256_json({"a": 2, "b": 1}))

    def test_invalid_prefix_is_refused(self):
        with self.assertRaises(ValueError):
            batch_idempotency_key("csv key", 0, [])


class CsvSendTests(unittest.TestCase):
    def test_batches_carry_file_hash_keys_and_reprocess_flag(self):
        bodies = []

        def opener(request, timeout):
            body = json.loads(request.data)
            bodies.append(body)
            return FakeResponse(json.dumps({"job_id": f"job-{len(bodies)}", "replayed": len(bodies) == 1}).encode())

        records = [{"n": index} for index in range(201)]
        result = send_records("http://api/v1", "t", records, "agmarknet_csv", content_sha256="b" * 64,
                              source_file_name="export.csv", reprocess=True, opener=opener)
        self.assertEqual([len(body["records"]) for body in bodies], [200, 1])
        self.assertEqual({body["content_sha256"] for body in bodies}, {"b" * 64})
        self.assertTrue(all(body["reprocess"] and body["source_file_name"] == "export.csv" for body in bodies))
        self.assertEqual(len({body["idempotency_key"] for body in bodies}), 2)
        self.assertTrue(all(KEY_PATTERN.match(body["idempotency_key"]) for body in bodies))
        self.assertEqual((result["job_ids"], result["replayed_batches"]), (["job-1", "job-2"], 1))

    def test_resending_identical_file_produces_identical_keys(self):
        keys = []

        def opener(request, timeout):
            keys.append(json.loads(request.data)["idempotency_key"])
            return FakeResponse(b'{"job_id": "j"}')

        for _ in range(2):
            send_records("http://api/v1", "t", [{"n": 1}], "agmarknet_csv", content_sha256="c" * 64, opener=opener)
        self.assertEqual(keys[0], keys[1])


class DailyReplayTests(unittest.TestCase):
    def test_replayed_batches_are_not_double_counted(self):
        def fake_post(url, token, body, timeout):
            if url.endswith("/admin/import"):
                self.assertRegex(body["idempotency_key"], KEY_PATTERN)
                return {"job_id": "prior", "inserted_count": 1, "duplicate_count": 0, "corrected_count": 0, "replayed": True}
            return {"id": "run"}

        with patch.object(daily, "_post_json", side_effect=fake_post):
            summary = ingest_records([raw()], config(), mode="daily", dry_run=False, api_url="http://api/v1", token="t",
                                     fetched_at="2026-11-04T17:09:24Z", today=date(2026, 11, 4))
        self.assertEqual((summary["inserted_count"], summary["replayed_batches"], summary["import_job_ids"]), (0, 1, ["prior"]))

    def test_same_fetch_retry_reuses_key(self):
        keys = []

        def fake_post(url, token, body, timeout):
            if url.endswith("/admin/import"):
                keys.append(body["idempotency_key"])
                return {"job_id": "j", "inserted_count": 1}
            return {"id": "run"}

        with patch.object(daily, "_post_json", side_effect=fake_post):
            for _ in range(2):
                ingest_records([raw()], config(), mode="daily", dry_run=False, api_url="http://api/v1", token="t",
                               fetched_at="2026-11-04T17:09:24Z", today=date(2026, 11, 4))
        self.assertEqual(len(keys), 2)
        self.assertEqual(keys[0], keys[1])


class RetentionTests(unittest.TestCase):
    def test_evidence_and_unsafe_locations_are_refused(self):
        for unsafe in (retention.ROOT / "data" / "raw", retention.ROOT / "data" / "processed" / "agmarknet",
                       retention.ROOT / "data", retention.ROOT, Path.home(), Path("/")):
            with self.subTest(path=str(unsafe)), self.assertRaises(retention.RetentionRefused):
                retention.resolve_temp_dir(unsafe)

    def test_custom_directory_requires_marker(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(retention.RetentionRefused):
                retention.resolve_temp_dir(folder)
            (Path(folder) / retention.MARKER_FILE).write_text("")
            self.assertEqual(retention.resolve_temp_dir(folder), Path(folder).resolve())

    def test_retention_days_bounds(self):
        self.assertEqual(retention.retention_days(None), 7)
        self.assertEqual(retention.retention_days("30"), 30)
        for invalid in ("0", "366"):
            with self.assertRaises(retention.RetentionRefused):
                retention.retention_days(invalid)

    def test_dry_run_reports_and_apply_deletes_only_expired_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / retention.MARKER_FILE).write_text("")
            (root / "nested").mkdir()
            old, fresh = root / "nested" / "old.json", root / "fresh.json"
            old.write_text("x" * 10)
            fresh.write_text("y")
            now = time.time()
            os.utime(old, (now - 10 * 86400, now - 10 * 86400))
            outside = root.parent / f"{root.name}-outside.txt"
            outside.write_text("keep")
            os.utime(outside, (now - 10 * 86400, now - 10 * 86400))
            try:
                (root / "link.txt").symlink_to(outside)
                dry = retention.purge_temporary_files(root, 7, now=now)
                self.assertEqual((dry.candidates, dry.deleted, dry.bytes_eligible), (["nested/old.json"], [], 10))
                self.assertTrue(old.exists())
                applied = retention.purge_temporary_files(root, 7, apply=True, now=now)
                self.assertEqual(applied.deleted, ["nested/old.json"])
                self.assertFalse(old.exists())
                self.assertFalse((root / "nested").exists())
                self.assertTrue(fresh.exists() and outside.exists() and (root / retention.MARKER_FILE).exists())
            finally:
                outside.unlink()

    def test_cli_refuses_evidence_directory(self):
        self.assertEqual(retention.main(["--temp-dir", str(retention.ROOT / "data" / "processed")]), 2)


if __name__ == "__main__":
    unittest.main()

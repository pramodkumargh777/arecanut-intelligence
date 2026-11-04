import csv
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "data-platform"))
from connectors.agmarknet.fetch_api import fetch_records
from connectors.agmarknet.fetch_api import main as fetch_main
from ingestion.import_csv import import_csv, main


class DailyIngestionTests(unittest.TestCase):
    def setUp(self):
        self.row = {
            "State": "Karnataka", "District": "Shivamogga", "Market": "Sagar",
            "Commodity": "Arecanut(Betelnut/Supari)", "Variety": "Rashi", "Grade": "FAQ",
            "Arrival_Date": "30/10/2026", "Min_x0020_Price": "40000",
            "Max_x0020_Price": "50000", "Modal_x0020_Price": "44000",
        }

    def test_known_official_flat_daily_csv_requires_confirmed_units(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "daily.csv"
            with path.open("w", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=list(self.row))
                writer.writeheader()
                writer.writerow(self.row)
            records, errors = import_csv(path)
            self.assertFalse(records)
            self.assertIn("unit is missing", errors[0])
            records, errors = import_csv(path, configured_price_unit="Rs./Quintal")
            self.assertFalse(errors)
            self.assertEqual(records[0]["modal_price"], 44000)
            self.assertEqual(records[0]["reporting_date"], "2026-10-30")
            self.assertIn('"Grade": "FAQ"', records[0]["raw_payload"])

    def test_page_ceiling_does_not_silently_return_partial_history(self):
        with patch("connectors.agmarknet.fetch_api.fetch_page", return_value=[self.row]):
            with self.assertRaisesRegex(ValueError, "additional source records"):
                fetch_records("https://example.com", "resource", "not-a-key", 1, 2, 0, "INR/quintal")

    def test_exact_page_boundary_checks_for_end_of_source(self):
        with patch("connectors.agmarknet.fetch_api.fetch_page", side_effect=[[self.row], []]) as fetch:
            rows, errors = fetch_records("https://example.com", "resource", "not-a-key", 1, 1, 0, "INR/quintal")
            self.assertEqual(len(rows), 1)
            self.assertFalse(errors)
            self.assertEqual(fetch.call_count, 2)

    def test_invalid_csv_does_not_send_partial_import(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "daily.csv"
            with path.open("w", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=list(self.row))
                writer.writeheader()
                writer.writerow(self.row)
                writer.writerow({**self.row, "Modal_x0020_Price": "bad"})
            with patch.dict(os.environ, {}, clear=True), patch.object(sys, "argv", [
                "import_csv.py", str(path), "--price-unit", "INR/quintal",
                "--api-url", "http://localhost:8787/api/v1", "--token", "test",
            ]), patch("ingestion.import_csv.send_records") as send:
                self.assertEqual(main(), 1)
                send.assert_not_called()

    def test_monthly_report_cannot_enter_daily_store(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "monthly.csv"
            path.write_text(',,,"State/UT-wise & Variety-wise Prices Monthly Analysis for Arecanut",,\n')
            with self.assertRaisesRegex(ValueError, "Monthly aggregates"):
                import_csv(path)

    def test_empty_endpoint_environment_uses_official_default(self):
        with patch.dict(os.environ, {"AGMARKNET_API_BASE_URL": ""}, clear=True), patch.object(sys, "argv", [
            "fetch_api.py", "--resource-id", "test-resource", "--api-key", "test-key",
        ]), patch("connectors.agmarknet.fetch_api.fetch_records", return_value=([], [])) as fetch:
            self.assertEqual(fetch_main(), 0)
            self.assertEqual(fetch.call_args.args[0], "https://api.data.gov.in/resource")


if __name__ == "__main__":
    unittest.main()

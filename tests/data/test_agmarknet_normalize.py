import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "data-platform"))

from connectors.agmarknet.normalize import RowError, normalize_record  # noqa: E402


class AgmarknetNormalizeTests(unittest.TestCase):
    def setUp(self):
        self.row = {
            "Arrival_Date": "2025-01-12",
            "State": "Karnataka",
            "District": "Shivamogga",
            "Market": "Sagar",
            "Commodity": "Arecanut",
            "Variety": "Rashi",
            "Min Price (Rs./Quintal)": "42,000",
            "Max Price (Rs./Quintal)": "46,000",
            "Modal Price (Rs./Quintal)": "44,000",
            "Arrivals (Tonnes)": "1.25",
        }

    def test_normalizes_reported_quintal_price_and_keeps_provenance(self):
        record = normalize_record(self.row, "agmarknet_csv")
        self.assertEqual(record["price_unit"], "INR/quintal")
        self.assertEqual(record["modal_price"], 44000)
        self.assertEqual(record["original_unit"], "Rs./Quintal")
        self.assertEqual(record["original_variety_name"], "Rashi")
        self.assertEqual(record["validation_status"], "validated")
        self.assertEqual(record["arrival_unit"], "tonnes")
        self.assertEqual(record["arrival_quantity"], 1.25)
        self.assertIn("Modal Price", record["raw_payload"])

    def test_converts_rupees_per_kg_only_when_unit_is_explicit(self):
        row = {
            key: value for key, value in self.row.items()
            if "Min Price" not in key and "Max Price" not in key and "Modal Price" not in key
        }
        row.update({"Price Unit": "INR/kg", "Min Price": "420", "Max Price": "460", "Modal Price": "440"})
        record = normalize_record(row, "agmarknet_csv")
        self.assertEqual(record["modal_price"], 44000)
        self.assertEqual(record["original_unit"], "INR/kg")

    def test_api_records_accept_only_explicitly_configured_source_unit(self):
        row = {
            "arrival_date": "2025-01-12",
            "state": "Karnataka",
            "district": "Shivamogga",
            "market": "Sagar",
            "commodity": "Arecanut",
            "variety": "Rashi",
            "min_price": "42000",
            "max_price": "46000",
            "modal_price": "44000",
        }
        with self.assertRaisesRegex(RowError, "unit is missing or unsupported"):
            normalize_record(row, "agmarknet")
        self.assertEqual(normalize_record(row, "agmarknet", "INR/quintal")["modal_price"], 44000)

    def test_rejects_missing_price_unit_instead_of_guessing(self):
        row = {key: value for key, value in self.row.items() if "Quintal" not in key}
        row.update({"Min Price": "42000", "Max Price": "46000", "Modal Price": "44000"})
        with self.assertRaisesRegex(RowError, "unit is missing or unsupported"):
            normalize_record(row, "agmarknet_csv")

    def test_flags_inconsistent_price_range_for_review(self):
        row = {**self.row, "Min Price (Rs./Quintal)": "45,000"}
        record = normalize_record(row, "agmarknet_csv")
        self.assertEqual(record["validation_status"], "review_required")
        self.assertIsNotNone(record["validation_message"])

    def test_rejects_other_commodities_and_malformed_dates(self):
        with self.assertRaisesRegex(RowError, "Unsupported commodity"):
            normalize_record({**self.row, "Commodity": "Coffee"}, "agmarknet_csv")
        with self.assertRaisesRegex(RowError, "Unrecognized reporting date"):
            normalize_record({**self.row, "Arrival_Date": "yesterday"}, "agmarknet_csv")

    def test_same_source_record_is_idempotent(self):
        row = {**self.row, "Record ID": "agmarknet-123"}
        self.assertEqual(
            normalize_record(row, "agmarknet")["id"],
            normalize_record(row, "agmarknet")["id"],
        )

    def test_corrected_source_row_keeps_stable_record_identity_and_new_version_id(self):
        first = normalize_record(self.row, "agmarknet_csv")
        corrected = normalize_record({**self.row, "Modal Price (Rs./Quintal)": "44,500"}, "agmarknet_csv")
        self.assertEqual(first["source_record_id"], corrected["source_record_id"])
        self.assertNotEqual(first["id"], corrected["id"])

    def test_rejects_foreign_currency_and_mixed_column_units(self):
        row = {key: value for key, value in self.row.items() if "Price" not in key}
        row.update({"Min Price": "420", "Max Price": "460", "Modal Price": "440", "Price Unit": "USD/quintal"})
        with self.assertRaisesRegex(RowError, "unsupported"):
            normalize_record(row, "agmarknet")
        mixed = dict(self.row)
        mixed["Min Price (Rs./kg)"] = mixed.pop("Min Price (Rs./Quintal)")
        with self.assertRaisesRegex(RowError, "Conflicting"):
            normalize_record(mixed, "agmarknet")

    def test_normalization_configuration_changes_version_identity(self):
        row = {key: value for key, value in self.row.items() if "Price" not in key}
        row.update({"Min Price": "420", "Max Price": "460", "Modal Price": "440"})
        a = normalize_record(row, "agmarknet", "INR/kg")
        b = normalize_record(row, "agmarknet", "INR/quintal")
        self.assertEqual(a["source_record_id"], b["source_record_id"])
        self.assertNotEqual(a["id"], b["id"])

    def test_official_commodity_and_encoded_headers(self):
        row = {key: value for key, value in self.row.items() if "Price" not in key}
        row.update({"Commodity": "Arecanut(Betelnut/Supari)", "Min_x0020_Price": "42000",
                    "Max_x0020_Price": "46000", "Modal_x0020_Price": "44000", "Price Unit": "Rs./Quintal"})
        self.assertEqual(normalize_record(row, "agmarknet_csv")["modal_price"], 44000)


if __name__ == "__main__":
    unittest.main()

"""Unit tests for CSV and field-format handling in the template checker."""

import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "historical_templates", ROOT / "scripts/check-historical-import-templates.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class HistoricalTemplateFormatTests(unittest.TestCase):
    def test_utf8_bom_is_read_and_multiline_csv_cells_stay_in_one_row(self):
        with tempfile.TemporaryDirectory(dir=MODULE.PACKAGE) as temporary:
            path = Path(temporary) / "quoted.csv"
            path.write_bytes(b'\xef\xbb\xbfleft,right\r\nvalue,"line one\r\nline two"\r\n')
            header, rows = MODULE.read_csv(path)
        self.assertEqual(header, ["left", "right"])
        self.assertEqual(rows, [["value", "line one\r\nline two"]])

    def test_malformed_csv_quoting_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=MODULE.PACKAGE) as temporary:
            path = Path(temporary) / "malformed.csv"
            path.write_text('left,right\nvalue,"unfinished\n', encoding="utf-8")
            with self.assertRaises(SystemExit):
                MODULE.read_csv(path)

    def test_dates_need_a_valid_calendar_date_or_timezone_offset(self):
        MODULE.parse_date("2024-02-29", "date")
        MODULE.parse_date("2024-02-29T12:30:00+00:00", "timestamp")
        with self.assertRaises(SystemExit):
            MODULE.parse_date("2024-02-30", "date")
        with self.assertRaises(SystemExit):
            MODULE.parse_date("2024-02-29T12:30:00", "timestamp")

    def test_amounts_reject_locale_grouping_and_exponents(self):
        MODULE.parse_decimal("125.00", "amount")
        with self.assertRaises(SystemExit):
            MODULE.parse_decimal("1,234.56", "amount")
        with self.assertRaises(SystemExit):
            MODULE.parse_decimal("1.2e3", "amount")


if __name__ == "__main__":
    unittest.main()

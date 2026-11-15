#!/usr/bin/env python3
"""Exercise the monthly sales report parser using a synthetic workbook."""

import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile


SCRIPT = Path(__file__).with_name("stage-monthly-sales-report.py")
SPEC = importlib.util.spec_from_file_location("monthly_sales_staging", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def _write_workbook(path: Path, *, include_formula: bool = False, invalid_header: bool = False) -> None:
    workbook = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets><sheet name="SUMMARY" sheetId="1" r:id="rId1"/></sheets>
    </workbook>'''
    relationships = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>
    </Relationships>'''
    strings = [
        "MONTHLY SALES REPORT FOR THE MONTH OF OCTOBER 2025- SEPTEMBER 2026",
        "NO", "DELIVERY DATE", "MODEL", "CHASSIS NO", "REG. NO", "NAME OF CUSTOMER", "SALES REP",
        "1", "TEST MODEL", "1HGCM82633A004352", "GT 100-20", "TEST CUSTOMER", "TEST STAFF",
        "01/10/26", "BADVIN", "N/A", "SECOND CUSTOMER",
    ]
    shared = '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + "".join(f"<si><t>{value}</t></si>" for value in strings) + "</sst>"
    header_indexes = list(range(1, 7))
    if invalid_header:
        header_indexes[3] = 5
    header = ''.join(f'<c r="{col}2" t="s"><v>{index}</v></c>' for col,index in zip("ABCDEF",header_indexes)) + '<c r="I2" t="s"><v>7</v></c>'
    first = '<c r="A3" t="s"><v>8</v></c><c r="B3" s="1"><v>45933</v></c><c r="C3" t="s"><v>9</v></c><c r="D3" t="s"><v>10</v></c><c r="E3" t="s"><v>11</v></c><c r="F3" t="s"><v>12</v></c><c r="I3" t="s"><v>13</v></c>'
    second = '<c r="A4"><v>2</v></c><c r="B4" t="s"><v>14</v></c><c r="C4" t="s"><v>9</v></c><c r="D4" t="s"><v>15</v></c><c r="E4" t="s"><v>16</v></c><c r="F4" t="s"><v>17</v></c><c r="I4" t="s"><v>13</v></c>'
    if include_formula:
        first = first.replace('<c r="F3" t="s"><v>12</v></c>', '<c r="F3"><f>1+1</f><v>2</v></c>')
    sheet = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2">{header}</row>
      <row r="3">{first}</row><row r="4">{second}</row>
    </sheetData></worksheet>'''
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", relationships)
        archive.writestr("xl/sharedStrings.xml", shared)
        archive.writestr("xl/worksheets/sheet1.xml", sheet)


class MonthlySalesStagingTests(unittest.TestCase):
    def test_preserves_claims_and_flags_values_without_promoting_records(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "sales.xlsx"
            _write_workbook(source)
            staged = MODULE.extract(source)
        self.assertEqual(staged["counts"]["rows"], 2)
        self.assertEqual(staged["records"][0]["deliveryDateNormalized"], "2025-10-03")
        self.assertIn("delivery-date-after-report-title-period", staged["records"][1]["reviewFlags"])
        self.assertIn("chassis-number-needs-review", staged["records"][1]["reviewFlags"])
        self.assertIn("registration-missing-or-not-applicable", staged["records"][1]["reviewFlags"])
        self.assertEqual(staged["records"][0]["salesCustomerNameClaimRaw"], "TEST CUSTOMER")
        self.assertNotIn("salesRep", staged["records"][0])
        self.assertFalse(staged["policy"]["createsServiceClient"])
        self.assertFalse(staged["policy"]["verifiesCurrentVehicleOwner"])
        self.assertFalse(staged["batch"]["operationalRecordsWritten"])

    def test_rejects_formula_in_included_source_field(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "sales.xlsx"
            _write_workbook(source, include_formula=True)
            with self.assertRaisesRegex(MODULE.StagingError, "WORKBOOK_FORMULA_CELLS_REQUIRE_REVIEW"):
                MODULE.extract(source)

    def test_rejects_unexpected_headers(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "sales.xlsx"
            _write_workbook(source, invalid_header=True)
            with self.assertRaisesRegex(MODULE.StagingError, "WORKBOOK_HEADERS_DO_NOT_MATCH"):
                MODULE.extract(source)


if __name__ == "__main__":
    unittest.main()

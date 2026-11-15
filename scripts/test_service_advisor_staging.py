"""Synthetic contract tests for the restricted service-advisor workbook extractor."""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "service_advisor_staging", ROOT / "scripts/stage-service-advisor-workbook.py"
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

HEADERS = [
    "BOOKING NO.", "DATE REPORTED", "CLIENT NAME", "CONTACT PERSON", "MAKE", "MODEL", "TRIM",
    "CHASIS NUMBER", "REGISTRATION NUMBER", "ISSUE DESCRIPTION", "ISSUE CATEGORY", "SEVERITY",
    "SALES REP", "TECHNICIAN ASSIGNED", "STATUS", "ACTIONS TAKEN", "ROOT CAUSE", "DATE RESOLVED",
    "WARRANTY", "COST TO COMPANY/CLIENT (GHS)", "CLIENT SATISFACTION (1-5)", "FOLLOW-UP REQUIRED?", "REMARKS",
]


def make_workbook(path: Path, *, formula: bool = False) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = MODULE.EXPECTED_SHEET
    sheet.append(HEADERS)
    sheet.append([
        "LEGACY-1", "2024-01-05", "Example showroom", "Example contact", "Example", "Model E", "Base",
        "WVWZZZ1JZXW000111", "TEST-1", "Synthetic complaint", "Charging", "Medium", "Ignore me",
        "Legacy technician", "Completed", "Synthetic action", "Source claim", "2024-01-06", "Yes",
        "210.00", "5", "No", "Synthetic remark",
    ])
    sheet.append([
        "LEGACY-2", None, None, None, None, None, None, None, None, None, None, None, "Ignore me",
        None, None, None, None, None, None, None, "1", None, None,
    ])
    if formula:
        sheet.cell(2, HEADERS.index("REMARKS") + 1, "=HYPERLINK(\"https://example.invalid\")")
    workbook.save(path)


class ServiceAdvisorStagingTests(unittest.TestCase):
    def test_extract_keeps_roles_and_source_claims_pending(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "synthetic.xlsx"
            make_workbook(source)
            staged = MODULE.extract(source)
            MODULE.validate_staging(staged)

        self.assertEqual(staged["counts"]["nonemptyRows"], 2)
        self.assertEqual(staged["counts"]["jobCandidates"], 1)
        self.assertEqual(staged["counts"]["referenceOnlyRows"], 1)
        record = staged["records"][0]
        self.assertEqual(record["sourceReferenceRaw"], "LEGACY-1")
        self.assertIsNone(record["vmmsBookingReference"])
        self.assertIsNone(record["vehicle"]["powertrainClass"])
        self.assertIsNone(record["reportedOwner"]["nameRaw"])
        self.assertEqual(record["visitContact"]["nameRaw"], "Example contact")
        self.assertEqual(record["historicalStatus"]["sourceLabelRaw"], "Completed")
        self.assertEqual(record["historicalStatus"]["mappingState"], "pending-review")
        self.assertEqual(record["historicalStatus"]["gateEffect"], "none")
        self.assertEqual(record["sourceReportedResolvedDate"], "2024-01-06")
        self.assertNotIn("completedAt", record)
        self.assertNotIn("sales_rep", record["sourceClaims"])
        self.assertNotIn("client_satisfaction", record["sourceClaims"])
        self.assertNotIn("Ignore me", str(staged))
        self.assertTrue(staged["policy"]["operationalRecordsWritten"] is False)

    def test_validator_rejects_promoted_or_authoritative_source_claims(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "synthetic.xlsx"
            make_workbook(source)
            staged = MODULE.extract(source)
        staged["records"][0]["historicalStatus"]["gateEffect"] = "complete"
        with self.assertRaisesRegex(ValueError, "STAGING_STATUS_GRANTED_AUTHORITY"):
            MODULE.validate_staging(staged)

    def test_formula_in_a_mapped_source_field_is_rejected_without_evaluation(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "synthetic.xlsx"
            make_workbook(source, formula=True)
            with self.assertRaisesRegex(ValueError, "WORKBOOK_FORMULA_IN_MAPPED_FIELD"):
                MODULE.extract(source)


if __name__ == "__main__":
    unittest.main()

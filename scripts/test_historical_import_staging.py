"""Synthetic tests for isolated, non-operational historical batch staging."""

from __future__ import annotations

import csv
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("historical_staging", ROOT / "scripts/stage-historical-import.py")
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
EXAMPLES = ROOT / "docs/import/historical/v1/examples"
ORG_ID = "8b74fa1d-32ad-4bf0-a0f1-49edb68e98b0"
SITE_ID = "41bb56a5-b8e1-4f05-bef7-c1ac178f28b2"


def batch_copy(target: Path) -> None:
    target.mkdir()
    for source in EXAMPLES.glob("*.csv"):
        shutil.copyfile(source, target / source.name)


def edit_csv(path: Path, edit) -> None:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        fields = list(reader.fieldnames or [])
        rows = list(reader)
    edit(rows)
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\r\n")
        writer.writeheader()
        writer.writerows(rows)


def refresh_source_hash(batch: Path) -> None:
    source_hash = hashlib.sha256((batch / "synthetic-source.csv").read_bytes()).hexdigest()
    edit_csv(batch / "batch-manifest.csv", lambda rows: rows[0].update(source_file_sha256=source_hash))
    edit_csv(batch / "field-mapping.csv", lambda rows: [row.update(source_file_sha256=source_hash) for row in rows])


class HistoricalImportStagingTests(unittest.TestCase):
    def test_csv_file_size_limit_is_enforced_after_bounded_read(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "oversized.csv"
            source.write_bytes(b"a\n12345678\n")
            with patch.object(MODULE, "MAX_FILE_BYTES", 8):
                with self.assertRaisesRegex(MODULE.BatchError, "file exceeds the 8-byte safety limit"):
                    MODULE.read_csv(source)

    def test_csv_row_limit_stops_at_first_excess_row_and_accepts_boundary(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "rows.csv"
            with patch.object(MODULE, "MAX_ROWS_PER_FILE", 2):
                source.write_text("value\none\ntwo\n", encoding="utf-8")
                header, data, _ = MODULE.read_csv(source)
                self.assertEqual(header, ["value"])
                self.assertEqual(len(data), 2)
                source.write_text("value\none\ntwo\nthree\n", encoding="utf-8")
                with self.assertRaisesRegex(MODULE.BatchError, "exceeds the 2-row safety limit"):
                    MODULE.read_csv(source)

    def test_synthetic_batch_validates_and_stays_scoped_and_non_operational(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)
        self.assertEqual(staged["scope"]["organizationId"], ORG_ID)
        self.assertEqual(staged["scope"]["siteId"], SITE_ID)
        self.assertFalse(staged["summary"]["operationalRecordsWritten"])
        self.assertFalse(staged["summary"]["commitAuthorized"])
        self.assertEqual(staged["summary"]["gateEffect"], "none")
        self.assertGreater(staged["summary"]["quarantinedRecords"], 0)
        self.assertGreater(staged["summary"]["sourceRecords"], 0)
        self.assertEqual(staged["sourceRowReconciliation"][0]["outcome"], "quarantined-awaiting-review")
        self.assertEqual(staged["sourceRowReconciliation"][0]["mappingState"], "partial-source-mapping")
        self.assertEqual(staged["sourceRowReconciliation"][0]["mappedColumns"], 4)
        self.assertEqual(staged["summary"]["unresolvedSourceRows"], 1)
        self.assertEqual(staged["summary"]["currencyMetadataState"], "not-configured")
        self.assertEqual(staged["summary"]["unresolvedCurrencyRows"], 1)
        self.assertEqual(staged["summary"]["amountTotalsByCurrency"], {})

    def test_unknown_client_is_quarantined_with_row_error_without_losing_source_value(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "maintenance-jobs.csv", lambda rows: rows[0].update(source_client_id="NO-SUCH-CLIENT"))
            staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)
        job = staged["files"]["maintenance-jobs.csv"]
        self.assertEqual(len(job["quarantined"]), 1)
        self.assertIn("source_client_id references no clients.csv source ID", job["quarantined"][0]["errors"])
        self.assertIn("SOURCE_REFERENCE_UNRESOLVED", [issue["code"] for issue in job["quarantined"][0]["issues"]])
        self.assertEqual(job["quarantined"][0]["record"]["source_client_id"], "NO-SUCH-CLIENT")
        self.assertFalse(staged["summary"]["operationalRecordsWritten"])

    def test_non_none_gate_effect_is_quarantined(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "status-map.csv", lambda rows: rows[0].update(gate_effect="release"))
            staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)
        row = staged["files"]["status-map.csv"]["quarantined"][0]
        self.assertIn("historical status mapping must have gate_effect none", row["errors"])

    def test_pending_and_rejected_status_mappings_do_not_resolve_source_status(self):
        for mapping_state in ("pending-review", "rejected"):
            with self.subTest(mapping_state=mapping_state), tempfile.TemporaryDirectory() as folder:
                source = Path(folder) / "batch"
                batch_copy(source)
                edit_csv(source / "status-map.csv", lambda rows: rows[0].update(mapping_state=mapping_state))
                staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)

            jobs = staged["files"]["maintenance-jobs.csv"]
            self.assertEqual(len(jobs["accepted"]), 0)
            self.assertEqual(len(jobs["quarantined"]), 1)
            row = jobs["quarantined"][0]
            self.assertIn("source status mapping is not approved; keep the source status unresolved", row["errors"])
            self.assertIn({"code": "SOURCE_STATUS_MAPPING_UNAPPROVED", "message": "source status mapping is not approved; keep the source status unresolved"}, row["issues"])
            self.assertEqual(row["record"]["source_status_raw"], "DONE")
            tasks = staged["files"]["maintenance-tasks.csv"]
            self.assertEqual(len(tasks["accepted"]), 0)
            self.assertEqual(len(tasks["quarantined"]), 1)
            self.assertEqual(tasks["quarantined"][0]["record"]["source_status_raw"], "DONE")
            self.assertFalse(staged["summary"]["operationalRecordsWritten"])
            self.assertFalse(staged["summary"]["commitAuthorized"])

    def test_approved_status_mapping_with_reviewer_and_date_resolves_source_status(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "status-map.csv", lambda rows: [
                row.update(mapping_state="approved", reviewer_reference="synthetic-reviewer-1", reviewed_at="2026-11-11")
                for row in rows
            ])
            staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)

        jobs = staged["files"]["maintenance-jobs.csv"]
        self.assertEqual(len(jobs["accepted"]), 1)
        self.assertEqual(jobs["accepted"][0]["record"]["source_status_raw"], "DONE")
        self.assertEqual(len(jobs["quarantined"]), 0)
        tasks = staged["files"]["maintenance-tasks.csv"]
        self.assertEqual(len(tasks["accepted"]), 1)
        self.assertEqual(tasks["accepted"][0]["record"]["source_status_raw"], "DONE")

    def test_formula_like_values_stay_literal_and_are_quarantined_with_a_stable_code(self):
        formula = '=HYPERLINK("https://example.invalid","review")'
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "clients.csv", lambda rows: rows[0].update(client_name=formula))
            staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)

        row = staged["files"]["clients.csv"]["quarantined"][0]
        self.assertEqual(row["record"]["client_name"], formula)
        self.assertIn("FORMULA_LIKE_VALUE", [issue["code"] for issue in row["issues"]])
        self.assertEqual(row["errors"], [issue["message"] for issue in row["issues"]])

    def test_formula_detector_does_not_flag_numeric_signs(self):
        self.assertFalse(MODULE.is_formula_like("-12.50"))
        self.assertFalse(MODULE.is_formula_like("+233"))
        self.assertTrue(MODULE.is_formula_like("  =SUM(A1:A2)"))
        self.assertTrue(MODULE.is_formula_like("@SUM(A1:A2)"))

    def test_formula_like_immutable_source_value_quarantines_linked_records_and_is_reconciled(self):
        formula = '=HYPERLINK("https://example.invalid","review")'
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "synthetic-source.csv", lambda rows: rows[0].update(client_name=formula))
            refresh_source_hash(source)
            staged, source_bytes = MODULE.validate_batch(source, ORG_ID, SITE_ID)

        for name in ("clients.csv", "maintenance-jobs.csv", "maintenance-tasks.csv"):
            self.assertEqual(len(staged["files"][name]["accepted"]), 0)
            self.assertIn("FORMULA_LIKE_VALUE", [issue["code"] for issue in staged["files"][name]["quarantined"][0]["issues"]])
        reconciliation = staged["sourceRowReconciliation"][0]
        self.assertEqual(reconciliation["outcome"], "quarantined-awaiting-review")
        self.assertEqual(reconciliation["issues"], [{"code": "FORMULA_LIKE_VALUE", "columns": ["client_name"]}])
        self.assertNotIn(formula.encode(), json.dumps(staged).encode())
        self.assertIn(b"=HYPERLINK(", source_bytes)

    def test_formula_like_batch_metadata_is_quarantined_and_requires_review(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "batch-manifest.csv", lambda rows: rows[0].update(source_owner="=CHECK()"))
            staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)

        self.assertEqual(staged["summary"]["quarantinedBatchManifestRows"], 1)
        issue = staged["files"]["batch-manifest.csv"]["quarantined"][0]["issues"][0]
        self.assertEqual(issue["code"], "FORMULA_LIKE_VALUE")

    def test_formula_like_manifest_control_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "batch-manifest.csv", lambda rows: rows[0].update(source_file_name="=source.csv"))
            with self.assertRaisesRegex(MODULE.BatchError, "control value is formula-like"):
                MODULE.validate_batch(source, ORG_ID, SITE_ID)

    def test_unsupported_status_map_entity_is_quarantined(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "status-map.csv", lambda rows: rows[0].update(entity_type="maintenance-jbo"))
            staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)
        row = staged["files"]["status-map.csv"]["quarantined"][0]
        self.assertIn("SOURCE_ENTITY_TYPE_UNSUPPORTED", [issue["code"] for issue in row["issues"]])

    def test_unapproved_evidence_is_quarantined_and_not_attached(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "evidence-manifest.csv", lambda rows: rows.append({
                "batch_id": "SYNTHETIC-BATCH-001", "source_evidence_id": "EVID-1", "source_job_id": "SRC-JOB-001",
                "source_file_name": "synthetic-evidence.pdf", "source_file_sha256": "a" * 64,
                "declared_media_type": "application/pdf", "evidence_kind": "service-record",
                "authority_reference": "", "permission_state": "pending-review", "source_row_reference": "source-row-2",
            }))
            staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)
        row = staged["files"]["evidence-manifest.csv"]["quarantined"][0]
        self.assertIn("evidence permission is not confirmed; keep this reference quarantined", row["errors"])

    def test_authorized_evidence_requires_traceable_authority_reference(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "evidence-manifest.csv", lambda rows: rows.append({
                "batch_id": "SYNTHETIC-BATCH-001", "source_evidence_id": "EVID-1", "source_job_id": "SRC-JOB-001",
                "source_file_name": "synthetic-evidence.pdf", "source_file_sha256": "a" * 64,
                "declared_media_type": "application/pdf", "evidence_kind": "service-record",
                "authority_reference": "", "permission_state": "authorized", "source_row_reference": "source-row-2",
            }))
            staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)
        errors = staged["files"]["evidence-manifest.csv"]["quarantined"][0]["errors"]
        self.assertIn("authorized evidence requires a traceable authority_reference", errors)

    def test_approved_mappings_require_reviewer_and_review_date(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "field-mapping.csv", lambda rows: rows.append({
                **rows[0], "review_state": "approved", "reviewer_reference": "", "reviewed_at": "",
            }))
            edit_csv(source / "status-map.csv", lambda rows: rows[0].update(
                mapping_state="approved", reviewer_reference="", reviewed_at="",
            ))
            staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)
        field_errors = staged["files"]["field-mapping.csv"]["quarantined"][-1]["errors"]
        status_errors = staged["files"]["status-map.csv"]["quarantined"][0]["errors"]
        self.assertIn("approved mapping requires reviewer_reference", field_errors)
        self.assertIn("approved mapping requires a valid reviewed_at date or timestamp", field_errors)
        self.assertIn("approved mapping requires reviewer_reference", status_errors)

    @unittest.skipUnless(os.name == "nt", "Windows protected DACL check")
    def test_output_directory_has_no_inherited_acl(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "private-output"
            MODULE.restrict_directory(output)
            result = subprocess.run(["icacls", str(output)], capture_output=True, text=True, check=True)
        self.assertIn("OWNER RIGHTS", result.stdout.upper())
        self.assertNotRegex(result.stdout, r"\(I\)")

    def test_duplicate_vin_candidates_are_both_quarantined_for_review(self):
        def add_duplicate(rows):
            duplicate = dict(rows[0])
            duplicate["source_vehicle_id"] = "SRC-VE-OTHER"
            duplicate["source_row_reference"] = "source-row-3"
            rows.append(duplicate)

        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "vehicles.csv", add_duplicate)
            staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)
        vehicles = staged["files"]["vehicles.csv"]["quarantined"]
        self.assertEqual(len(vehicles), 2)
        self.assertTrue(all(any("duplicate VIN candidate" in error for error in row["errors"]) for row in vehicles))

    def test_duplicate_source_status_mappings_are_both_quarantined(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "status-map.csv", lambda rows: rows.append(dict(rows[0])))
            staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)
        rows = staged["files"]["status-map.csv"]["quarantined"]
        self.assertEqual(len(rows), 2)
        self.assertTrue(all("duplicate entity and source status mapping requires review" in row["errors"] for row in rows))

    def test_duplicate_party_ids_quarantine_every_duplicate_and_dependent_jobs(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "clients.csv", lambda rows: rows.append(dict(rows[0])))
            staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)
        clients = staged["files"]["clients.csv"]["quarantined"]
        jobs = staged["files"]["maintenance-jobs.csv"]["quarantined"]
        self.assertEqual(len(clients), 2)
        self.assertEqual(len(jobs), 1)
        self.assertIn("source_client_id references an ambiguous or quarantined clients.csv record", jobs[0]["errors"])

    def test_reference_to_incomplete_quarantined_target_is_also_quarantined(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "clients.csv", lambda rows: rows[0].update(client_name=""))
            staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)
        job = staged["files"]["maintenance-jobs.csv"]["quarantined"][0]
        self.assertIn("source_client_id references an ambiguous or quarantined clients.csv record", job["errors"])

    def test_field_mapping_must_match_batch_and_an_existing_source_row(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "field-mapping.csv", lambda rows: rows[0].update(batch_id="OTHER", source_row_reference="synthetic-source.csv#row=99"))
            staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)
        row = staged["files"]["field-mapping.csv"]["quarantined"][0]
        self.assertIn("batch_id does not match batch manifest", row["errors"])
        self.assertIn("field mapping source row is absent from the immutable source", row["errors"])

    def test_direct_copy_field_mapping_must_match_the_raw_value(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "clients.csv", lambda rows: rows[0].update(client_name="Different name"))
            staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)
        row = staged["files"]["field-mapping.csv"]["quarantined"][0]
        self.assertIn("preserved value does not match the immutable source", row["errors"])

    def test_missing_batch_provenance_is_a_batch_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "batch-manifest.csv", lambda rows: rows[0].update(source_owner=""))
            with self.assertRaisesRegex(MODULE.BatchError, "source_owner"):
                MODULE.validate_batch(source, ORG_ID, SITE_ID)

    def test_batch_checksum_mismatch_fails_before_staging(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            path = source / "synthetic-source.csv"
            path.write_bytes(path.read_bytes().replace(b"Example Fleet", b"Tampered Fleet"))
            with self.assertRaisesRegex(MODULE.BatchError, "checksum"):
                MODULE.validate_batch(source, ORG_ID, SITE_ID)

    def test_generated_artifact_keeps_source_completion_non_authoritative(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)
            output = Path(folder) / "private-stage"
            MODULE.restrict_directory(output)
            (output / "staging.json").write_text(json.dumps(staged), encoding="utf-8")
            loaded = json.loads((output / "staging.json").read_text(encoding="utf-8"))
        self.assertFalse(loaded["summary"]["operationalRecordsWritten"])
        self.assertFalse(loaded["summary"]["commitAuthorized"])
        self.assertEqual(loaded["summary"]["gateEffect"], "none")

    def test_currency_without_approved_metadata_stays_quarantined(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            edit_csv(source / "commercial-lines.csv", lambda rows: rows[0].update(currency="ABC"))
            staged, _ = MODULE.validate_batch(source, ORG_ID, SITE_ID)
        lines = staged["files"]["commercial-lines.csv"]["quarantined"]
        self.assertEqual(len(lines), 1)
        self.assertTrue(any("ISO 4217 membership and approved currency precision metadata are not configured" in error for error in lines[0]["errors"]))
        self.assertIn("CURRENCY_METADATA_UNAVAILABLE", [issue["code"] for issue in lines[0]["issues"]])
        self.assertEqual(staged["summary"]["amountTotalsByCurrency"], {})

    def test_source_bytes_are_parsed_hashed_and_archived_from_one_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            source_file = source / "synthetic-source.csv"
            original_read_csv = MODULE.read_csv
            mutated = False

            def read_and_mutate(path, expected_header=None):
                nonlocal mutated
                snapshot = original_read_csv(path, expected_header)
                if path.name == "synthetic-source.csv" and not mutated:
                    path.write_bytes(path.read_bytes().replace(b"Example Fleet", b"Changed after snapshot"))
                    mutated = True
                return snapshot

            with patch.object(MODULE, "read_csv", side_effect=read_and_mutate):
                staged, source_snapshot = MODULE.validate_batch(source, ORG_ID, SITE_ID)
            self.assertNotEqual(source_file.read_bytes(), source_snapshot)
            self.assertEqual(staged["source"]["sha256"], MODULE.sha256(source_snapshot))
            self.assertIn("Example Fleet Ltd", str(staged["files"]["clients.csv"]["accepted"][0]["record"]))

    def test_command_writes_a_private_staging_artifact_without_operational_records(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            output = Path(folder) / "private-output"
            result = subprocess.run([
                sys.executable, str(ROOT / "scripts/stage-historical-import.py"),
                "--batch-dir", str(source), "--output", str(output),
                "--organization-id", ORG_ID, "--site-id", SITE_ID,
            ], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            artifact = json.loads((output / "staging.json").read_text(encoding="utf-8"))
            self.assertFalse(artifact["summary"]["operationalRecordsWritten"])
            self.assertFalse(artifact["summary"]["commitAuthorized"])
            archived = output / "source-original" / "synthetic-source.csv"
            self.assertEqual(MODULE.sha256(archived.read_bytes()), artifact["source"]["sha256"])

    def test_command_refuses_output_inside_submitted_batch(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "batch"
            batch_copy(source)
            output = source / "staging-output"
            result = subprocess.run([
                sys.executable, str(ROOT / "scripts/stage-historical-import.py"),
                "--batch-dir", str(source), "--output", str(output),
                "--organization-id", ORG_ID, "--site-id", SITE_ID,
            ], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn("must not be inside the submitted batch directory", result.stderr)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()

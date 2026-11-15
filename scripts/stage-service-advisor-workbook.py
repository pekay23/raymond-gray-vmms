"""Extract the service-advisor workbook into a private, review-only staging JSON file.

This deliberately does not write VMMS business records. It preserves source claims,
omits fields excluded by management, and leaves missing authority and identity data
unresolved. Use the bundled/runtime Python with openpyxl installed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_SHEET = "AFTERSALES ISSUES"
MAPPING_VERSION = "rg-service-advisor-workbook-v1"
FIELDS = {
    "BOOKING NO.": "legacy_booking_reference",
    "DATE REPORTED": "reported_date_raw",
    "CLIENT NAME": "client_candidate_raw",
    "CONTACT PERSON": "visit_contact_candidate_raw",
    "MAKE": "make_raw",
    "MODEL": "model_raw",
    "TRIM": "variant_raw",
    "CHASIS NUMBER": "vin_raw",
    "REGISTRATION NUMBER": "registration_raw",
    "ISSUE DESCRIPTION": "complaint_raw",
    "ISSUE CATEGORY": "category_raw",
    "SEVERITY": "severity_raw",
    "TECHNICIAN ASSIGNED": "legacy_technician_claim_raw",
    "STATUS": "status_raw",
    "ACTIONS TAKEN": "actions_taken_raw",
    "ROOT CAUSE": "root_cause_claim_raw",
    "DATE RESOLVED": "reported_resolved_date_raw",
    "WARRANTY": "warranty_claim_raw",
    "COST TO COMPANY/CLIENT (GHS)": "source_cost_claim_ghs_raw",
    "FOLLOW-UP REQUIRED?": "follow_up_claim_raw",
    "REMARKS": "remarks_raw",
}
REQUIRED = {
    "BOOKING NO.", "DATE REPORTED", "CLIENT NAME", "CONTACT PERSON", "MAKE", "MODEL",
    "TRIM", "CHASIS NUMBER", "REGISTRATION NUMBER", "ISSUE DESCRIPTION", "ISSUE CATEGORY",
    "SEVERITY", "STATUS", "ACTIONS TAKEN", "ROOT CAUSE", "DATE RESOLVED", "WARRANTY",
    "COST TO COMPANY/CLIENT (GHS)", "FOLLOW-UP REQUIRED?", "REMARKS",
}
SOURCE_COLUMN_MAP = [
    {"sourceColumn": "BOOKING NO.", "stagingField": "sourceReferenceRaw", "rule": "Keep only as a legacy source identifier; never use as the VMMS booking reference."},
    {"sourceColumn": "DATE REPORTED", "stagingField": "sourceReportedDate", "rule": "Preserve the reported date as source history."},
    {"sourceColumn": "CLIENT NAME", "stagingField": "client.nameRaw", "rule": "Paying-client candidate; require relationship review."},
    {"sourceColumn": "CONTACT PERSON", "stagingField": "visitContact.nameRaw", "rule": "Visit-contact candidate only; never infer vehicle ownership."},
    {"sourceColumn": "CHASIS NUMBER", "stagingField": "vehicle.vinRaw", "rule": "Preserve the source claim; validate format and duplicates during review."},
    {"sourceColumn": "MAKE", "stagingField": "vehicle.makeRaw", "rule": "Preserve verbatim source claim."},
    {"sourceColumn": "MODEL", "stagingField": "vehicle.modelRaw", "rule": "Preserve verbatim source claim."},
    {"sourceColumn": "TRIM", "stagingField": "vehicle.variantRaw", "rule": "Preserve verbatim source claim."},
    {"sourceColumn": "REGISTRATION NUMBER", "stagingField": "vehicle.registrationRaw", "rule": "Preserve verbatim source claim."},
    {"sourceColumn": "ISSUE DESCRIPTION", "stagingField": "sourceClaims.complaint_raw", "rule": "Preserve the original complaint wording."},
    {"sourceColumn": "ISSUE CATEGORY", "stagingField": "sourceClaims.category_raw", "rule": "Preserve raw category; no unreviewed crosswalk."},
    {"sourceColumn": "SEVERITY", "stagingField": "sourceClaims.severity_raw", "rule": "Preserve raw severity; do not create a safety or quality hold."},
    {"sourceColumn": "STATUS", "stagingField": "historicalStatus.sourceLabelRaw", "rule": "Preserve raw status pending historical mapping; gate effect is none."},
    {"sourceColumn": "ACTIONS TAKEN", "stagingField": "sourceClaims.actions_taken_raw", "rule": "Preserve narrative; do not create task sign-off."},
    {"sourceColumn": "ROOT CAUSE", "stagingField": "sourceClaims.root_cause_claim_raw", "rule": "Preserve as a source claim, not a verified diagnosis."},
    {"sourceColumn": "DATE RESOLVED", "stagingField": "sourceReportedResolvedDate", "rule": "Preserve source date only; never populate a VMMS completion timestamp."},
    {"sourceColumn": "WARRANTY", "stagingField": "sourceClaims.warranty_claim_raw", "rule": "Preserve warranty claim; do not set confirmed-at-booking or the W marker."},
    {"sourceColumn": "COST TO COMPANY/CLIENT (GHS)", "stagingField": "sourceClaims.source_cost_claim_ghs_raw", "rule": "Preserve source cost claim; never create invoice or payment records."},
    {"sourceColumn": "FOLLOW-UP REQUIRED?", "stagingField": "sourceClaims.follow_up_claim_raw", "rule": "Preserve source claim; do not create a live reminder."},
    {"sourceColumn": "REMARKS", "stagingField": "sourceClaims.remarks_raw", "rule": "Preserve restricted source text for review only."},
    {"sourceColumn": "TECHNICIAN ASSIGNED", "stagingField": "sourceClaims.legacy_technician_claim_raw", "rule": "Preserve as a historical claim; never grants lead or supervisor authority."},
]
FORBIDDEN_STAGING_KEYS = {
    "salesRep", "salesRepresentative", "clientSatisfaction", "completedAt", "supervisorSignedOff",
    "teamLeadReleased", "invoice", "payment", "warrantyConfirmed", "safetyHold", "ownerVerified",
}


def text_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    if isinstance(value, date):
        return value.isoformat()
    result = str(value).strip()
    return result if result else None


def extract(source: Path) -> dict[str, Any]:
    raw = source.read_bytes()
    source_hash = hashlib.sha256(raw).hexdigest()
    workbook = load_workbook(source, read_only=True, data_only=False)
    try:
        if EXPECTED_SHEET not in workbook.sheetnames:
            raise ValueError("WORKBOOK_SHEET_MISSING")
        sheet = workbook[EXPECTED_SHEET]
        rows = sheet.iter_rows()
        header_cells = next(rows, None)
        if header_cells is None:
            raise ValueError("WORKBOOK_HEADER_MISSING")
        headers = [str(cell.value).strip() if cell.value is not None else "" for cell in header_cells]
        if len(headers) != len(set(headers)):
            raise ValueError("WORKBOOK_HEADER_DUPLICATE")
        missing = sorted(REQUIRED - set(headers))
        if missing:
            raise ValueError("WORKBOOK_REQUIRED_HEADER_MISSING")
        index = {header: headers.index(header) for header in FIELDS}
        records: list[dict[str, Any]] = []
        formula_errors: list[int] = []
        for row_number, row in enumerate(rows, start=2):
            raw_row = list(row)
            selected_cells = {key: raw_row[column] for key, column in index.items()}
            if not any(text_value(cell.value) for cell in selected_cells.values()):
                continue
            if any(isinstance(cell.value, str) and cell.value.startswith("=") for cell in selected_cells.values()):
                formula_errors.append(row_number)
                continue
            extracted = {FIELDS[key]: text_value(cell.value) for key, cell in selected_cells.items()}
            has_job_detail = any(extracted[key] for key in ("complaint_raw", "make_raw", "model_raw", "vin_raw", "registration_raw"))
            source_reference = extracted.pop("legacy_booking_reference")
            records.append({
                "sourceRowReference": f"{EXPECTED_SHEET}!{row_number}",
                "sourceReferenceRaw": source_reference,
                "recordClass": "job-candidate" if has_job_detail else "reference-only",
                "client": {"nameRaw": extracted.pop("client_candidate_raw"), "role": "paying-client-candidate", "reviewState": "pending-review"},
                "reportedOwner": {"nameRaw": None, "reviewState": "missing-in-source"},
                "visitContact": {"nameRaw": extracted.pop("visit_contact_candidate_raw"), "role": "visit-contact-candidate", "reviewState": "pending-review"},
                "vehicle": {
                    "vinRaw": extracted.pop("vin_raw"), "registrationRaw": extracted.pop("registration_raw"),
                    "makeRaw": extracted.pop("make_raw"), "modelRaw": extracted.pop("model_raw"),
                    "variantRaw": extracted.pop("variant_raw"), "powertrainClass": None,
                },
                "vmmsBookingReference": None,
                "warrantyConfirmedAtBooking": None,
                "historicalStatus": {"sourceLabelRaw": extracted.pop("status_raw"), "mappingState": "pending-review", "gateEffect": "none"},
                "sourceReportedResolvedDate": extracted.pop("reported_resolved_date_raw"),
                "sourceReportedDate": extracted.pop("reported_date_raw"),
                "sourceClaims": extracted,
                "promotionState": "staging-only",
            })
        if formula_errors:
            raise ValueError("WORKBOOK_FORMULA_IN_MAPPED_FIELD")
        counts = {
            "nonemptyRows": len(records),
            "jobCandidates": sum(record["recordClass"] == "job-candidate" for record in records),
            "referenceOnlyRows": sum(record["recordClass"] == "reference-only" for record in records),
            "rowsWithoutLegacyReference": sum(record["sourceReferenceRaw"] is None for record in records),
            "rowsWithoutReportedOwner": sum(record["reportedOwner"]["nameRaw"] is None for record in records),
            "rowsAwaitingStatusReview": sum(record["historicalStatus"]["mappingState"] == "pending-review" for record in records),
            "rowsWithoutNewBookingReference": sum(record["vmmsBookingReference"] is None for record in records),
        }
        return {
            "batch": {"sourceFileSha256": source_hash, "sourceFileName": source.name, "sourceSheet": EXPECTED_SHEET, "mappingVersion": MAPPING_VERSION, "sourceColumnMap": SOURCE_COLUMN_MAP},
            "policy": {
                "operationalRecordsWritten": False,
                "newBookingReferencesGenerated": False,
                "sourceResolvedDateUsedAsVmmsCompletion": False,
                "excludedColumns": ["SALES REP", "CLIENT SATISFACTION     (1�5)"],
                "authorityEffect": "none",
            },
            "counts": counts,
            "records": records,
        }
    finally:
        workbook.close()


def validate_staging(staged: dict[str, Any]) -> None:
    records = staged["records"]
    counts = staged["counts"]
    if len({record["sourceRowReference"] for record in records}) != len(records):
        raise ValueError("STAGING_DUPLICATE_SOURCE_ROW")
    if counts["jobCandidates"] + counts["referenceOnlyRows"] != counts["nonemptyRows"]:
        raise ValueError("STAGING_ROW_RECONCILIATION_FAILED")
    if staged["policy"]["operationalRecordsWritten"] or staged["policy"]["authorityEffect"] != "none":
        raise ValueError("STAGING_OPERATIONAL_WRITE_FORBIDDEN")
    for record in records:
        keys = set(record) | set(record.get("client", {})) | set(record.get("reportedOwner", {})) | set(record.get("visitContact", {})) | set(record.get("vehicle", {})) | set(record.get("historicalStatus", {})) | set(record.get("sourceClaims", {}))
        if keys & FORBIDDEN_STAGING_KEYS:
            raise ValueError("STAGING_FORBIDDEN_OPERATIONAL_FIELD")
        if record["vmmsBookingReference"] is not None or record["vehicle"]["powertrainClass"] is not None:
            raise ValueError("STAGING_UNCONFIRMED_BOOKING_IDENTITY")
        if record["reportedOwner"]["nameRaw"] is not None or record["reportedOwner"]["reviewState"] != "missing-in-source":
            raise ValueError("STAGING_OWNER_ROLE_INFERRED")
        if record["historicalStatus"]["mappingState"] != "pending-review" or record["historicalStatus"]["gateEffect"] != "none":
            raise ValueError("STAGING_STATUS_GRANTED_AUTHORITY")
        if record["promotionState"] != "staging-only":
            raise ValueError("STAGING_PROMOTION_FORBIDDEN")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Source workbook; read only")
    parser.add_argument("--output", required=True, type=Path, help="Private JSON output path outside the repository")
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    output = args.output.resolve()
    try:
        output.relative_to(ROOT)
    except ValueError:
        pass
    else:
        raise SystemExit("Refusing to write source records inside the repository.")
    try:
        staged = extract(source)
        validate_staging(staged)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(staged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except (OSError, ValueError) as error:
        reason = str(error) if str(error).startswith(("WORKBOOK_", "STAGING_")) else "WORKBOOK_READ_FAILED"
        print(json.dumps({"ok": False, "error": reason}), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "output": str(output), "sourceFileSha256": staged["batch"]["sourceFileSha256"], "counts": staged["counts"], "excludedColumns": staged["policy"]["excludedColumns"], "operationalRecordsWritten": False}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Extract a showroom sales report into private, non-operational staging."""

from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import zipfile
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
SHEET_NAME = "SUMMARY"
MAPPING_VERSION = "rg-monthly-sales-report-v1"
EXPECTED_HEADERS = {
    "A": "NO",
    "B": "DELIVERY DATE",
    "C": "MODEL",
    "D": "CHASSIS NO",
    "E": "REG. NO",
    "F": "NAME OF CUSTOMER",
}
VIN = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$", re.IGNORECASE)
MAX_BYTES = 50 * 1024 * 1024
MAX_ROWS = 100_000
NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "p": "http://schemas.openxmlformats.org/package/2006/relationships",
}


class SecurityAttributes(ctypes.Structure):
    _fields_ = [
        ("nLength", wintypes.DWORD),
        ("lpSecurityDescriptor", ctypes.c_void_p),
        ("bInheritHandle", wintypes.BOOL),
    ]


class StagingError(ValueError):
    pass


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    except ET.ParseError as error:
        raise StagingError("WORKBOOK_SHARED_STRINGS_INVALID") from error
    return ["".join(node.itertext()) for node in root.findall("m:si", NS)]


def _sheet_path(archive: zipfile.ZipFile) -> str:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {node.attrib["Id"]: node.attrib["Target"] for node in relationships}
    sheets = workbook.find("m:sheets", NS)
    if sheets is None:
        raise StagingError("WORKBOOK_SHEETS_MISSING")
    for sheet in sheets:
        if (sheet.attrib.get("name") or "").strip() != SHEET_NAME:
            continue
        target = targets.get(sheet.attrib.get(f"{{{NS['r']}}}id", ""))
        if not target:
            raise StagingError("WORKBOOK_SHEET_RELATIONSHIP_MISSING")
        return target.lstrip("/") if target.startswith("/") else f"xl/{target}"
    raise StagingError("WORKBOOK_EXPECTED_SHEET_MISSING")


def _cell_value(cell: ET.Element, strings: list[str]) -> str | None:
    kind = cell.attrib.get("t")
    if kind == "inlineStr":
        value = "".join(node.itertext())
    else:
        node = cell.find("m:v", NS)
        if node is None or node.text is None:
            return None
        value = node.text
        if kind == "s":
            try:
                value = strings[int(value)]
            except (ValueError, IndexError) as error:
                raise StagingError("WORKBOOK_SHARED_STRING_INVALID") from error
    value = value.strip()
    return value or None


def _excel_column(cell_ref: str) -> str:
    match = re.match(r"[A-Z]+", cell_ref)
    if not match:
        raise StagingError("WORKBOOK_CELL_REFERENCE_INVALID")
    return match.group(0)


def _parse_date(raw: str | None, cell: ET.Element | None) -> str | None:
    if raw is None:
        return None
    if cell is not None and cell.attrib.get("t") in (None, "n"):
        try:
            serial = Decimal(raw)
            if serial.is_finite():
                return (datetime(1899, 12, 30) + timedelta(days=float(serial))).date().isoformat()
        except (InvalidOperation, OverflowError, ValueError):
            pass
    for pattern in ("%d/%m/%y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, pattern).date().isoformat()
        except ValueError:
            continue
    return None


def extract(source: Path) -> dict:
    size = source.stat().st_size
    if size > MAX_BYTES:
        raise StagingError("WORKBOOK_SIZE_LIMIT_EXCEEDED")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    try:
        archive = zipfile.ZipFile(source)
    except (OSError, zipfile.BadZipFile) as error:
        raise StagingError("WORKBOOK_INVALID_XLSX") from error
    with archive:
        strings = _shared_strings(archive)
        try:
            root = ET.fromstring(archive.read(_sheet_path(archive)))
        except (KeyError, ET.ParseError) as error:
            raise StagingError("WORKBOOK_SHEET_INVALID") from error
    sheet_data = root.find("m:sheetData", NS)
    if sheet_data is None:
        raise StagingError("WORKBOOK_ROWS_MISSING")
    rows = list(sheet_data.findall("m:row", NS))
    header_row = next((row for row in rows if row.attrib.get("r") == "2"), None)
    if header_row is None:
        raise StagingError("WORKBOOK_HEADER_ROW_MISSING")
    header_cells = {_excel_column(c.attrib.get("r", "")): _cell_value(c, strings) for c in header_row.findall("m:c", NS)}
    if any(header_cells.get(column) != name for column, name in EXPECTED_HEADERS.items()):
        raise StagingError("WORKBOOK_HEADERS_DO_NOT_MATCH")

    records = []
    formulas = 0
    for row in rows:
        try:
            row_number = int(row.attrib.get("r", "0"))
        except ValueError as error:
            raise StagingError("WORKBOOK_ROW_REFERENCE_INVALID") from error
        if row_number <= 2:
            continue
        if len(records) >= MAX_ROWS:
            raise StagingError("WORKBOOK_ROW_LIMIT_EXCEEDED")
        cells = {_excel_column(c.attrib.get("r", "")): c for c in row.findall("m:c", NS)}
        chosen = {column: cells.get(column) for column in EXPECTED_HEADERS}
        if not any(cell is not None and _cell_value(cell, strings) for cell in chosen.values()):
            continue
        if any(cell is not None and cell.find("m:f", NS) is not None for cell in chosen.values()):
            formulas += 1
            continue
        raw = {column: _cell_value(cell, strings) if cell is not None else None for column, cell in chosen.items()}
        chassis = (raw["D"] or "").strip().upper() or None
        registration = (raw["E"] or "").strip() or None
        delivery = _parse_date(raw["B"], chosen["B"])
        flags = []
        if delivery is None:
            flags.append("delivery-date-missing-or-unreadable")
        elif delivery > "2026-09-30":
            flags.append("delivery-date-after-report-title-period")
        if chassis is None or not VIN.fullmatch(chassis):
            flags.append("chassis-number-needs-review")
        if registration is None or registration.casefold() == "n/a":
            flags.append("registration-missing-or-not-applicable")
        records.append({
            "sourceRowId": f"{SHEET_NAME}:row:{row_number}",
            "sourceRowNumber": raw["A"],
            "deliveryDateRaw": raw["B"],
            "deliveryDateNormalized": delivery,
            "vehicleModelRaw": raw["C"],
            "chassisNumberRaw": raw["D"],
            "chassisNumberCandidate": chassis,
            "registrationRaw": raw["E"],
            "salesCustomerNameClaimRaw": raw["F"],
            "reviewFlags": flags,
            "state": "source-staging-only",
        })
    chassis_values = [r["chassisNumberCandidate"] for r in records if r["chassisNumberCandidate"]]
    duplicate_chassis = len(chassis_values) - len(set(chassis_values))
    if formulas:
        raise StagingError("WORKBOOK_FORMULA_CELLS_REQUIRE_REVIEW")
    return {
        "schemaVersion": 1,
        "mappingVersion": MAPPING_VERSION,
        "batch": {
            "sourceFileName": source.name,
            "sourceFileSha256": digest,
            "worksheet": SHEET_NAME,
            "reportTitlePeriod": {"from": "2025-10-01", "through": "2026-09-30"},
            "operationalRecordsWritten": False,
            "operationalAuthorityEffect": "none",
        },
        "policy": {
            "salesCustomerMeaning": "unconfirmed-source-claim",
            "createsServiceClient": False,
            "verifiesCurrentVehicleOwner": False,
            "createsOwnerAccess": False,
            "createsWorkOrders": False,
            "importsSalesRepresentative": False,
            "promotionState": "staging-only",
        },
        "counts": {
            "rows": len(records),
            "deliveryDateMissingOrUnreadable": sum("delivery-date-missing-or-unreadable" in r["reviewFlags"] for r in records),
            "deliveryDateAfterReportTitlePeriod": sum("delivery-date-after-report-title-period" in r["reviewFlags"] for r in records),
            "chassisNumberNeedsReview": sum("chassis-number-needs-review" in r["reviewFlags"] for r in records),
            "registrationMissingOrNotApplicable": sum("registration-missing-or-not-applicable" in r["reviewFlags"] for r in records),
            "duplicateChassisNumberCandidates": duplicate_chassis,
        },
        "records": records,
    }


def _create_private_directory(path: Path) -> None:
    if path.exists():
        raise StagingError("PRIVATE_STAGING_BATCH_ALREADY_EXISTS")
    if os.name != "nt":
        path.mkdir(parents=True, mode=0o700, exist_ok=False)
        path.chmod(0o700)
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    advapi = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    descriptor = ctypes.c_void_p()
    convert = advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW
    convert.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(wintypes.DWORD)]
    convert.restype = wintypes.BOOL
    create = kernel.CreateDirectoryW
    create.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(SecurityAttributes)]
    create.restype = wintypes.BOOL
    local_free = kernel.LocalFree
    local_free.argtypes = [ctypes.c_void_p]
    local_free.restype = ctypes.c_void_p
    if not convert("D:P(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)", 1, ctypes.byref(descriptor), None):
        raise OSError(ctypes.get_last_error(), "Could not prepare private import permissions.")
    try:
        attributes = SecurityAttributes(ctypes.sizeof(SecurityAttributes), descriptor, False)
        if not create(str(path), ctypes.byref(attributes)):
            raise OSError(ctypes.get_last_error(), "Could not create private import directory.")
    finally:
        local_free(descriptor)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Source workbook; read only")
    parser.add_argument("--output-root", type=Path, help="Private staging parent; defaults to the current user's local application data")
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    output_root = args.output_root or Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "VMMS-Import-Staging"
    output_root = output_root.resolve()
    try:
        output_root.relative_to(ROOT)
    except ValueError:
        pass
    else:
        raise SystemExit("Refusing to write source records inside the repository.")
    try:
        batch = extract(source)
        directory = output_root / batch["batch"]["sourceFileSha256"][:16]
        _create_private_directory(directory)
        destination = directory / "sales-claims.json"
        destination.write_text(json.dumps(batch, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    except (OSError, StagingError, zipfile.BadZipFile) as error:
        message = str(error) if str(error).startswith(("WORKBOOK_", "PRIVATE_")) else "WORKBOOK_READ_OR_STAGE_FAILED"
        print(json.dumps({"ok": False, "error": message}), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "sourceFileSha256": batch["batch"]["sourceFileSha256"], "counts": batch["counts"], "operationalRecordsWritten": False}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

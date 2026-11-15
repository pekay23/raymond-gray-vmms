"""Validate a historical CSV batch into a private, non-operational staging artifact."""

from __future__ import annotations

import argparse
import csv
import ctypes
import hashlib
import io
import json
import os
import re
import sys
from uuid import UUID
from collections import Counter, defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "docs/import/historical/v1"
MANIFEST = PACKAGE / "manifest.json"
MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_ROWS_PER_FILE = 100_000
DECIMAL = re.compile(r"^-?\d+(?:\.\d+)?$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RFC3339 = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")

PRIMARY_KEYS = {
    "clients.csv": "source_client_id", "customers.csv": "source_customer_id",
    "client-customer-links.csv": "source_link_id", "vehicles.csv": "source_vehicle_id",
    "ownership-intervals.csv": "source_ownership_id", "maintenance-jobs.csv": "source_job_id",
    "maintenance-tasks.csv": "source_task_id", "commercial-lines.csv": "source_line_id",
    "evidence-manifest.csv": "source_evidence_id",
}


class BatchError(Exception):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_csv(path: Path, expected_header: list[str] | None = None) -> tuple[list[str], list[dict[str, str]], bytes]:
    with path.open("rb") as source:
        raw = source.read(MAX_FILE_BYTES + 1)
    if len(raw) > MAX_FILE_BYTES:
        raise BatchError(f"{path.name}: file exceeds the {MAX_FILE_BYTES}-byte safety limit")
    try:
        rows = csv.reader(io.TextIOWrapper(io.BytesIO(raw), encoding="utf-8-sig", newline=""), strict=True)
        header = next(rows, None)
    except (UnicodeDecodeError, csv.Error) as error:
        raise BatchError(f"{path.name}: invalid UTF-8 CSV or malformed quoting") from error
    if not header or len(header) != len(set(header)):
        raise BatchError(f"{path.name}: missing or duplicate header")
    if expected_header is not None and header != expected_header:
        raise BatchError(f"{path.name}: columns do not match template version 1.0.0")
    data: list[dict[str, str]] = []
    try:
        for number, row in enumerate(rows, start=2):
            if len(data) >= MAX_ROWS_PER_FILE:
                raise BatchError(f"{path.name}: exceeds the {MAX_ROWS_PER_FILE}-row safety limit")
            if len(row) != len(header):
                raise BatchError(f"{path.name} row {number}: has {len(row)} cells; expected {len(header)}")
            data.append(dict(zip(header, row, strict=True)))
    except (UnicodeDecodeError, csv.Error) as error:
        raise BatchError(f"{path.name}: invalid UTF-8 CSV or malformed quoting") from error
    return header, data, raw


def row_error(_record: dict[str, str], errors: list[dict[str, str]], condition: bool, code: str, message: str) -> None:
    issue = {"code": code, "message": message}
    if condition and issue not in errors:
        errors.append(issue)


def parse_date(value: str) -> bool:
    try:
        if DATE.fullmatch(value):
            date.fromisoformat(value)
            return True
        if RFC3339.fullmatch(value):
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.tzinfo is not None and parsed.utcoffset() is not None
    except ValueError:
        return False
    return False


def parse_decimal(value: str) -> bool:
    if not DECIMAL.fullmatch(value):
        return False
    try:
        Decimal(value)
        return True
    except InvalidOperation:
        return False


def is_formula_like(value: str) -> bool:
    candidate = value.lstrip(" \t\r\n")
    if not candidate:
        return False
    if candidate[0] in "=@":
        return True
    if candidate[0] == "+":
        return not re.fullmatch(r"\+\d+(?:\.\d+)?", candidate)
    if candidate[0] == "-":
        return not parse_decimal(candidate)
    return False


def restrict_directory(path: Path) -> None:
    if os.name == "nt":
        from ctypes import wintypes

        class SecurityAttributes(ctypes.Structure):
            _fields_ = [
                ("nLength", wintypes.DWORD),
                ("lpSecurityDescriptor", ctypes.c_void_p),
                ("bInheritHandle", wintypes.BOOL),
            ]

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
        # Set the creator as owner and install a protected DACL before the
        # directory becomes visible; no inherited ACEs are present.
        if not convert("D:P(A;OICI;FA;;;OW)", 1, ctypes.byref(descriptor), None):
            error = ctypes.get_last_error()
            raise OSError(error, ctypes.FormatError(error), str(path))
        try:
            attributes = SecurityAttributes(ctypes.sizeof(SecurityAttributes), descriptor, False)
            if not create(str(path), ctypes.byref(attributes)):
                error = ctypes.get_last_error()
                raise OSError(error, ctypes.FormatError(error), str(path))
        finally:
            local_free(descriptor)
    else:
        path.mkdir(parents=True, exist_ok=False, mode=0o700)


def validate_batch(batch_dir: Path, organization_id: str, site_id: str) -> tuple[dict[str, Any], bytes]:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    files = {definition["name"]: definition for definition in manifest["files"]}
    parsed: dict[str, list[dict[str, str]]] = {}
    file_hashes: dict[str, str] = {}
    file_bytes: dict[str, bytes] = {}
    headers: dict[str, list[str]] = {}

    for name, definition in files.items():
        path = batch_dir / name
        if not path.is_file() or path.resolve().parent != batch_dir:
            raise BatchError(f"required batch file is missing or unsafe: {name}")
        headers[name], parsed[name], file_bytes[name] = read_csv(path, definition["columns"])
        file_hashes[name] = sha256(file_bytes[name])

    batch_rows = parsed["batch-manifest.csv"]
    if len(batch_rows) != 1:
        raise BatchError("batch-manifest.csv must contain exactly one batch record")
    batch = batch_rows[0]
    manifest_control_columns = {
        "batch_id", "template_version", "source_file_name", "source_file_sha256", "source_record_count",
    }
    for column in manifest_control_columns:
        if is_formula_like(batch.get(column, "")):
            raise BatchError(f"batch manifest control value is formula-like: {column}")
    for column in files["batch-manifest.csv"]["required"]:
        if not batch.get(column, "").strip():
            raise BatchError(f"batch manifest required value is missing: {column}")
    if batch.get("template_version") != manifest["templateVersion"]:
        raise BatchError("batch manifest template version does not match package version")
    batch_id = batch.get("batch_id", "")
    if not batch_id:
        raise BatchError("batch manifest has no batch_id")
    source_name = batch.get("source_file_name", "")
    if not source_name or Path(source_name).name != source_name:
        raise BatchError("batch manifest source_file_name must be a plain file name")
    source_path = batch_dir / source_name
    if not source_path.is_file() or source_path.resolve().parent != batch_dir:
        raise BatchError("the declared immutable source file is missing or unsafe")
    raw_header, raw_rows, source_bytes = read_csv(source_path)
    source_hash = sha256(source_bytes)
    if batch.get("source_file_sha256") != source_hash:
        raise BatchError("batch source checksum does not match the immutable source file")
    try:
        if int(batch.get("source_record_count", "")) != len(raw_rows):
            raise BatchError("batch source_record_count does not match the immutable source file")
    except ValueError as error:
        raise BatchError("batch source_record_count must be a whole number") from error

    errors: dict[str, list[list[dict[str, str]]]] = {name: [[] for _ in rows] for name, rows in parsed.items()}
    source_formula_columns: dict[int, list[str]] = defaultdict(list)
    for row_number, record in enumerate(raw_rows, start=2):
        for column, value in record.items():
            if is_formula_like(value):
                source_formula_columns[row_number].append(column)

    manifest_record = batch_rows[0]
    for column, value in manifest_record.items():
        row_error(manifest_record, errors["batch-manifest.csv"][0], is_formula_like(value), "FORMULA_LIKE_VALUE", f"{column} starts with a spreadsheet formula character; keep as text and review before use")

    for name, rows in parsed.items():
        if name == "batch-manifest.csv":
            continue
        required = files[name]["required"]
        primary = PRIMARY_KEYS.get(name)
        primary_rows: dict[str, list[int]] = defaultdict(list)
        for index, record in enumerate(rows):
            row_errors = errors[name][index]
            row_error(record, row_errors, record.get("batch_id") != batch_id, "BATCH_ID_MISMATCH", "batch_id does not match batch manifest")
            for column in required:
                row_error(record, row_errors, not record.get(column, "").strip(), "REQUIRED_VALUE_MISSING", f"required value is missing: {column}")
            for value in record.values():
                row_error(record, row_errors, is_formula_like(value), "FORMULA_LIKE_VALUE", "value starts with a spreadsheet formula character; keep as text and review before use")
            if primary:
                key = record.get(primary, "")
                if key:
                    primary_rows[key].append(index)
            source_row = record.get("source_row_reference", "")
            if source_row:
                match = re.fullmatch(re.escape(source_name) + r"#row=(\d+)", source_row)
                row_number = int(match.group(1)) if match else -1
                row_error(record, row_errors, row_number < 2 or row_number > len(raw_rows) + 1, "SOURCE_ROW_REFERENCE_INVALID", "source_row_reference does not identify a row in the immutable source file")
                for column in source_formula_columns.get(row_number, []):
                    row_error(record, row_errors, True, "FORMULA_LIKE_VALUE", f"immutable source column {column} contains a spreadsheet formula-like value; keep it literal and review before use")
        if primary:
            for key, indices in primary_rows.items():
                if len(indices) > 1:
                    for index in indices:
                        row_error(rows[index], errors[name][index], True, "SOURCE_ID_DUPLICATE", f"duplicate {primary} is ambiguous: {key}")

    target_keys = {
        "clients.csv": "source_client_id", "customers.csv": "source_customer_id",
        "vehicles.csv": "source_vehicle_id", "maintenance-jobs.csv": "source_job_id",
    }
    refs = {
        "client-customer-links.csv": [("source_client_id", "clients.csv"), ("source_customer_id", "customers.csv")],
        "ownership-intervals.csv": [("source_vehicle_id", "vehicles.csv"), ("source_customer_id", "customers.csv")],
        "maintenance-jobs.csv": [("source_client_id", "clients.csv"), ("source_customer_id", "customers.csv"), ("source_vehicle_id", "vehicles.csv")],
        "maintenance-tasks.csv": [("source_job_id", "maintenance-jobs.csv")],
        "commercial-lines.csv": [("source_job_id", "maintenance-jobs.csv")],
        "evidence-manifest.csv": [("source_job_id", "maintenance-jobs.csv")],
    }
    target_indices: dict[str, dict[str, list[int]]] = {}
    for name, key_column in target_keys.items():
        groups: dict[str, list[int]] = defaultdict(list)
        for index, record in enumerate(parsed[name]):
            if record.get(key_column):
                groups[record[key_column]].append(index)
        target_indices[name] = groups

    enum_rules = {
        ("client-customer-links.csv", "relationship_kind"): "relationship_kind",
        ("ownership-intervals.csv", "interval_status"): "ownership_interval_status",
        ("commercial-lines.csv", "line_kind"): "commercial_line_kind",
        ("commercial-lines.csv", "tax_data_status"): "tax_data_status",
        ("commercial-lines.csv", "payer_entity_type"): "payer_entity_type",
        ("evidence-manifest.csv", "permission_state"): "permission_state",
        ("status-map.csv", "historical_status"): "historical_status",
        ("status-map.csv", "mapping_state"): "mapping_state",
        ("field-mapping.csv", "review_state"): "review_state",
    }
    for (name, column), enum_name in enum_rules.items():
        choices = set(manifest["statusValues"][enum_name])
        for index, record in enumerate(parsed[name]):
            value = record.get(column, "")
            row_error(record, errors[name][index], bool(value) and value not in choices, "ENUM_VALUE_UNSUPPORTED", f"unsupported {column} value: {value}")
    for index, record in enumerate(parsed["status-map.csv"]):
        entity_type = record.get("entity_type", "")
        row_error(record, errors["status-map.csv"][index], entity_type not in {"maintenance-job", "maintenance-task"}, "SOURCE_ENTITY_TYPE_UNSUPPORTED", "entity_type must be maintenance-job or maintenance-task")

    # Duplicate VINs are candidates for manual review, not records to silently merge.
    seen_vins: dict[str, int] = {}
    for index, record in enumerate(parsed["vehicles.csv"]):
        vin = record.get("vin", "").strip().upper()
        if not vin:
            continue
        previous = seen_vins.get(vin)
        if previous is not None:
            row_error(record, errors["vehicles.csv"][index], True, "VEHICLE_IDENTITY_DUPLICATE_CANDIDATE", f"duplicate VIN candidate also appears on row {previous + 2}")
            row_error(record, errors["vehicles.csv"][previous], True, "VEHICLE_IDENTITY_DUPLICATE_CANDIDATE", f"duplicate VIN candidate also appears on row {index + 2}")
        else:
            seen_vins[vin] = index

    seen_status_keys: dict[tuple[str, str], int] = {}
    for index, record in enumerate(parsed["status-map.csv"]):
        key = (record.get("entity_type", ""), record.get("source_status_raw", ""))
        previous = seen_status_keys.get(key)
        if previous is not None:
            message = "duplicate entity and source status mapping requires review"
            row_error(record, errors["status-map.csv"][index], True, "SOURCE_STATUS_MAPPING_AMBIGUOUS", message)
            row_error(record, errors["status-map.csv"][previous], True, "SOURCE_STATUS_MAPPING_AMBIGUOUS", message)
        else:
            seen_status_keys[key] = index

    for index, record in enumerate(parsed["status-map.csv"]):
        row_error(record, errors["status-map.csv"][index], record.get("gate_effect") != "none", "STATUS_GATE_EFFECT_FORBIDDEN", "historical status mapping must have gate_effect none")
    for name, date_columns in {
        "client-customer-links.csv": ("effective_from", "effective_until"),
        "ownership-intervals.csv": ("effective_from", "effective_until"),
        "maintenance-jobs.csv": ("source_started_at", "source_completed_at"),
    }.items():
        for index, record in enumerate(parsed[name]):
            for column in date_columns:
                value = record.get(column, "")
                row_error(record, errors[name][index], bool(value) and not parse_date(value), "DATE_FORMAT_INVALID", f"{column} must be a valid date or timestamp with offset")
    for name, columns in {
        "maintenance-tasks.csv": ("labour_hours",),
        "commercial-lines.csv": ("quantity", "unit_amount_decimal", "line_amount_decimal", "tax_amount_decimal", "tax_rate_decimal"),
    }.items():
        for index, record in enumerate(parsed[name]):
            for column in columns:
                value = record.get(column, "")
                row_error(record, errors[name][index], bool(value) and not parse_decimal(value), "MONEY_FORMAT_INVALID", f"{column} must be base-10 decimal text")
    for index, record in enumerate(parsed["commercial-lines.csv"]):
        currency = record.get("currency", "")
        row_error(record, errors["commercial-lines.csv"][index], bool(currency) and not re.fullmatch(r"[A-Z]{3}", currency), "CURRENCY_FORMAT_INVALID", "currency must have the uppercase three-letter format")
        row_error(record, errors["commercial-lines.csv"][index], bool(record.get("line_amount_decimal")) and not currency, "CURRENCY_MISSING", "currency is required when a line amount is provided")
        row_error(record, errors["commercial-lines.csv"][index], bool(record.get("line_amount_decimal")), "CURRENCY_METADATA_UNAVAILABLE", "ISO 4217 membership and approved currency precision metadata are not configured; keep the amount unresolved")
    for index, record in enumerate(parsed["evidence-manifest.csv"]):
        row_error(record, errors["evidence-manifest.csv"][index], record.get("permission_state") != "authorized", "SOURCE_PERMISSION_UNCONFIRMED", "evidence permission is not confirmed; keep this reference quarantined")
        row_error(record, errors["evidence-manifest.csv"][index], record.get("permission_state") == "authorized" and not record.get("authority_reference", "").strip(), "EVIDENCE_AUTHORITY_REFERENCE_MISSING", "authorized evidence requires a traceable authority_reference")
    for name, column, state_column in (
        ("field-mapping.csv", "reviewer_reference", "review_state"),
        ("status-map.csv", "reviewer_reference", "mapping_state"),
    ):
        for index, record in enumerate(parsed[name]):
            state = record.get(state_column)
            row_error(record, errors[name][index], state == "approved" and not record.get(column, "").strip(), "MAPPING_REVIEWER_MISSING", "approved mapping requires reviewer_reference")
            row_error(record, errors[name][index], state == "approved" and not parse_date(record.get("reviewed_at", "")), "MAPPING_REVIEW_DATE_INVALID", "approved mapping requires a valid reviewed_at date or timestamp")
    for index, record in enumerate(parsed["field-mapping.csv"]):
        row_error(record, errors["field-mapping.csv"][index], record.get("source_file_sha256") != source_hash, "SOURCE_CHECKSUM_MISMATCH", "field mapping does not reference the batch source checksum")
        row_error(record, errors["field-mapping.csv"][index], record.get("mapping_version") != manifest["templateVersion"], "MAPPING_VERSION_MISMATCH", "field mapping version does not match the template")
        row_error(record, errors["field-mapping.csv"][index], record.get("source_column") not in raw_header, "SOURCE_COLUMN_UNRESOLVED", "field mapping source column is absent from the immutable source")
        source_row = record.get("source_row_reference", "")
        match = re.fullmatch(re.escape(source_name) + r"#row=(\d+)", source_row)
        row_number = int(match.group(1)) if match else -1
        row_error(record, errors["field-mapping.csv"][index], row_number < 2 or row_number > len(raw_rows) + 1, "SOURCE_ROW_REFERENCE_INVALID", "field mapping source row is absent from the immutable source")
        mapping_target = {
            ("client", "name", "direct-copy"): ("clients.csv", "client_name"),
            ("customer", "full_name", "direct-copy"): ("customers.csv", "full_name"),
            ("maintenance-job", "source_status_raw", "preserve-verbatim"): ("maintenance-jobs.csv", "source_status_raw"),
            ("maintenance-job", "source_completed_at", "preserve-source-date"): ("maintenance-jobs.csv", "source_completed_at"),
        }.get((record.get("target_entity"), record.get("target_field"), record.get("mapping_rule")))
        if mapping_target is None:
            row_error(record, errors["field-mapping.csv"][index], True, "MAPPING_RULE_UNSUPPORTED", "mapping rule and target field are not supported for automatic staging")
        elif match and 2 <= row_number <= len(raw_rows) + 1 and record.get("source_column") in raw_header:
            target_file, target_column = mapping_target
            raw_record = raw_rows[row_number - 2]
            target_rows = [row for row in parsed[target_file] if row.get("source_row_reference") == source_row]
            target_value = target_rows[0].get(target_column, "") if len(target_rows) == 1 else None
            row_error(record, errors["field-mapping.csv"][index], target_value != raw_record.get(record["source_column"], ""), "MAPPED_VALUE_MISMATCH", "preserved value does not match the immutable source")

    status_indices: dict[tuple[str, str], list[int]] = defaultdict(list)
    for index, record in enumerate(parsed["status-map.csv"]):
        status_indices[(record.get("entity_type", ""), record.get("source_status_raw", ""))].append(index)
    for name, entity in (("maintenance-jobs.csv", "maintenance-job"), ("maintenance-tasks.csv", "maintenance-task")):
        for index, record in enumerate(parsed[name]):
            raw_status = record.get("source_status_raw", "")
            if not raw_status:
                continue
            candidates = status_indices.get((entity, raw_status), [])
            if not candidates:
                code = "SOURCE_STATUS_UNMAPPED"
                message = "source status has no mapping row"
            elif len(candidates) != 1 or errors["status-map.csv"][candidates[0]]:
                code = "SOURCE_STATUS_MAPPING_UNAVAILABLE"
                message = "source status mapping is ambiguous or quarantined"
            elif parsed["status-map.csv"][candidates[0]].get("mapping_state") != "approved":
                code = "SOURCE_STATUS_MAPPING_UNAPPROVED"
                message = "source status mapping is not approved; keep the source status unresolved"
            else:
                continue
            row_error(record, errors[name][index], True, code, message)

    # A relationship cannot make an otherwise quarantined target look valid. Repeat
    # until quarantined status has propagated through each dependent reference.
    while True:
        changed = False
        for name, fields in refs.items():
            for index, record in enumerate(parsed[name]):
                for column, target in fields:
                    value = record.get(column, "")
                    if not value:
                        continue
                    candidates = target_indices[target].get(value, [])
                    if not candidates:
                        code = "SOURCE_REFERENCE_UNRESOLVED"
                        message = f"{column} references no {target} source ID"
                    elif len(candidates) != 1 or errors[target][candidates[0]]:
                        code = "SOURCE_REFERENCE_AMBIGUOUS"
                        message = f"{column} references an ambiguous or quarantined {target} record"
                    else:
                        continue
                    before = len(errors[name][index])
                    row_error(record, errors[name][index], True, code, message)
                    changed = changed or len(errors[name][index]) > before
        for index, record in enumerate(parsed["commercial-lines.csv"]):
            payer_type = record.get("payer_entity_type")
            payer_id = record.get("payer_source_id", "")
            target = "clients.csv" if payer_type == "client" else "customers.csv" if payer_type == "customer" else None
            if not target or not payer_id:
                continue
            candidates = target_indices[target].get(payer_id, [])
            if not candidates:
                code = "SOURCE_REFERENCE_UNRESOLVED"
                message = "payer_source_id references no source party"
            elif len(candidates) != 1 or errors[target][candidates[0]]:
                code = "SOURCE_REFERENCE_AMBIGUOUS"
                message = "payer_source_id references an ambiguous or quarantined source party"
            else:
                continue
            before = len(errors["commercial-lines.csv"][index])
            row_error(record, errors["commercial-lines.csv"][index], True, code, message)
            changed = changed or len(errors["commercial-lines.csv"][index]) > before
        if not changed:
            break

    staged_files: dict[str, Any] = {}
    totals: defaultdict[str, Decimal] = defaultdict(Decimal)
    status_counts: Counter[str] = Counter()
    for name, rows in parsed.items():
        accepted, quarantined = [], []
        for index, record in enumerate(rows):
            row_result = {"sourceRow": index + 2, "sourceRowReference": record.get("source_row_reference"), "record": record}
            if errors[name][index]:
                row_result["errors"] = [issue["message"] for issue in errors[name][index]]
                row_result["issues"] = errors[name][index]
                quarantined.append(row_result)
            else:
                accepted.append(row_result)
            if name == "commercial-lines.csv" and not errors[name][index] and record.get("line_amount_decimal") and parse_decimal(record["line_amount_decimal"]):
                totals[record.get("currency", "unknown")] += Decimal(record["line_amount_decimal"])
            if name == "maintenance-jobs.csv":
                status_counts[record.get("source_status_raw", "(blank)")] += 1
        staged_files[name] = {"input": len(rows), "accepted": accepted, "quarantined": quarantined}

    source_count = sum(value["input"] for name, value in staged_files.items() if name != "batch-manifest.csv")
    accepted_count = sum(len(value["accepted"]) for name, value in staged_files.items() if name != "batch-manifest.csv")
    quarantined_count = sum(len(value["quarantined"]) for name, value in staged_files.items() if name != "batch-manifest.csv")
    unresolved_currency_rows = sum(
        1 for item in staged_files["commercial-lines.csv"]["quarantined"]
        if any(issue["code"] == "CURRENCY_METADATA_UNAVAILABLE" for issue in item["issues"])
    )
    duplicate_count = sum(
        1 for name, value in staged_files.items() if name != "batch-manifest.csv"
        for item in value["quarantined"] if any(issue["code"] in {
            "SOURCE_ID_DUPLICATE", "VEHICLE_IDENTITY_DUPLICATE_CANDIDATE", "SOURCE_STATUS_MAPPING_AMBIGUOUS",
        } for issue in item["issues"])
    )
    mapped_columns: dict[str, set[str]] = defaultdict(set)
    for item in staged_files["field-mapping.csv"]["accepted"]:
        reference = item["record"].get("source_row_reference")
        column = item["record"].get("source_column")
        if reference and column:
            mapped_columns[reference].add(column)
    mapped_source_rows = set(mapped_columns)
    staged_source_rows = {
        item["record"].get("source_row_reference")
        for name, value in staged_files.items() if name not in ("batch-manifest.csv", "field-mapping.csv")
        for group in (value["accepted"], value["quarantined"])
        for item in group if item["record"].get("source_row_reference")
    }
    quarantined_source_rows = {
        item["record"].get("source_row_reference")
        for name, value in staged_files.items() if name not in ("batch-manifest.csv", "field-mapping.csv")
        for item in value["quarantined"] if item["record"].get("source_row_reference")
    }
    source_row_reconciliation = []
    for row_number in range(2, len(raw_rows) + 2):
        reference = f"{source_name}#row={row_number}"
        if reference not in mapped_source_rows:
            mapping_state = "no-field-mappings"
        elif len(mapped_columns[reference]) < len(raw_header):
            mapping_state = "partial-source-mapping"
        else:
            mapping_state = "all-source-columns-mapped"
        if reference not in staged_source_rows:
            outcome = "unresolved-no-staged-record"
        elif reference in quarantined_source_rows:
            outcome = "quarantined-awaiting-review"
        elif mapping_state == "no-field-mappings":
            outcome = "represented-without-field-map"
        else:
            outcome = "represented-awaiting-review"
        formula_columns = source_formula_columns.get(row_number, [])
        if formula_columns and outcome not in ("unresolved-no-staged-record", "quarantined-awaiting-review"):
            outcome = "formula-like-source-value-review"
        source_row_reconciliation.append({"sourceRowReference": reference, "mappedColumns": len(mapped_columns.get(reference, set())), "sourceColumns": len(raw_header), "mappingState": mapping_state, "outcome": outcome, "issues": ([{"code": "FORMULA_LIKE_VALUE", "columns": formula_columns}] if formula_columns else [])})
    unresolved_source_rows = sum(item["mappingState"] != "all-source-columns-mapped" or item["outcome"] != "represented-awaiting-review" for item in source_row_reconciliation)
    quarantined_manifest_rows = sum(bool(row_errors) for row_errors in errors["batch-manifest.csv"])
    staged = {
        "templateVersion": manifest["templateVersion"], "batchId": batch_id,
        "scope": {"organizationId": organization_id, "siteId": site_id, "scopeSource": "explicit operator input", "recordsWritten": False},
        "source": {"fileName": source_name, "sha256": source_hash, "recordCount": len(raw_rows), "headers": raw_header},
        "batchFilesSha256": file_hashes,
        "summary": {"sourceRecords": len(raw_rows), "sourceColumns": len(raw_header), "templateInputRecords": source_count, "acceptedForStaging": accepted_count,
                    "duplicateCandidates": duplicate_count, "quarantinedRecords": quarantined_count,
                    "unresolvedSourceRows": unresolved_source_rows, "quarantinedBatchManifestRows": quarantined_manifest_rows, "currencyMetadataState": "not-configured",
                    "unresolvedCurrencyRows": unresolved_currency_rows,
                    "amountTotalsByCurrency": {key: str(value) for key, value in sorted(totals.items())},
                    "sourceStatuses": dict(sorted(status_counts.items())), "operationalRecordsWritten": False,
                    "gateEffect": "none", "commitAuthorized": False},
        "sourceRowReconciliation": source_row_reconciliation,
        "files": staged_files,
    }
    return staged, source_bytes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-dir", required=True, type=Path, help="Directory containing the version 1.0.0 CSV batch")
    parser.add_argument("--output", required=True, type=Path, help="New private output directory outside the repository")
    parser.add_argument("--organization-id", required=True, help="UUID defining the intended organisation boundary")
    parser.add_argument("--site-id", required=True, help="UUID defining the intended service-centre boundary")
    args = parser.parse_args()
    try:
        batch_dir = args.batch_dir.resolve(strict=True)
        output = args.output.resolve()
        if not batch_dir.is_dir():
            raise BatchError("batch-dir must be a directory")
        try:
            output.relative_to(batch_dir)
        except ValueError:
            pass
        else:
            raise BatchError("output directory must not be inside the submitted batch directory")
        try:
            output.relative_to(ROOT)
        except ValueError:
            pass
        else:
            raise BatchError("refusing to write potentially sensitive staging records inside the repository")
        organization_id = str(UUID(args.organization_id))
        site_id = str(UUID(args.site_id))
        staged, source_bytes = validate_batch(batch_dir, organization_id, site_id)
        restrict_directory(output)
        archive = output / "source-original"
        archive.mkdir()
        source_archive = archive / staged["source"]["fileName"]
        temporary_source = archive / f"{source_archive.name}.tmp"
        temporary_source.write_bytes(source_bytes)
        temporary_source.replace(source_archive)
        temporary = output / "staging.json.tmp"
        temporary.write_text(json.dumps(staged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(output / "staging.json")
    except (OSError, ValueError, BatchError, json.JSONDecodeError) as error:
        reason = str(error) if isinstance(error, BatchError) else "BATCH_VALIDATION_FAILED"
        print(json.dumps({"ok": False, "error": reason}), file=sys.stderr)
        return 2
    summary = staged["summary"]
    print(json.dumps({"ok": True, "requiresReview": summary["quarantinedRecords"] > 0 or summary["unresolvedSourceRows"] > 0 or summary["quarantinedBatchManifestRows"] > 0, "stagingFile": str(output / "staging.json"), "summary": summary}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

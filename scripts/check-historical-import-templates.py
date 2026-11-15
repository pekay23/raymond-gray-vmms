"""Validate the versioned historical import templates and their synthetic example."""

import csv
import hashlib
import io
import json
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "docs/import/historical/v1"
DECIMAL = re.compile(r"^-?\d+(?:\.\d+)?$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RFC3339 = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")


def fail(message):
    raise SystemExit(f"Historical import template check failed: {message}")


def read_csv(path):
    try:
        text = path.read_bytes().decode("utf-8-sig")
        rows = list(csv.reader(io.StringIO(text, newline=""), strict=True))
    except (UnicodeDecodeError, csv.Error) as error:
        fail(f"{path.relative_to(ROOT)} is not valid UTF-8 CSV: {error}")
    if not rows or not rows[0]:
        fail(f"{path.relative_to(ROOT)} has no header row")
    header = rows[0]
    if len(header) != len(set(header)):
        fail(f"{path.relative_to(ROOT)} has duplicate headers")
    for number, row in enumerate(rows[1:], start=2):
        if len(row) != len(header):
            fail(f"{path.relative_to(ROOT)} row {number} has {len(row)} cells; expected {len(header)}")
    return header, rows[1:]


def parse_date(value, location):
    if not value:
        return
    if DATE.fullmatch(value):
        try:
            date.fromisoformat(value)
            return
        except ValueError:
            pass
    if RFC3339.fullmatch(value):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is not None and parsed.utcoffset() is not None:
                return
        except ValueError:
            pass
    fail(f"{location} must be YYYY-MM-DD or an RFC 3339 timestamp with an offset")


def parse_decimal(value, location):
    if not value:
        return
    if not DECIMAL.fullmatch(value):
        fail(f"{location} must be decimal text without grouping or exponent notation")
    try:
        Decimal(value)
    except InvalidOperation:
        fail(f"{location} is not a decimal value")


def rows_as_dicts(header, rows):
    return [dict(zip(header, row, strict=True)) for row in rows]


def require_ref(value, known, location):
    if value and value not in known:
        fail(f"{location} references unknown source ID {value!r}")


def main():
    manifest_path = PACKAGE / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("templateVersion") != "1.0.0":
        fail("manifest templateVersion must be 1.0.0")
    examples = {}
    for definition in manifest.get("files", []):
        name = definition["name"]
        expected = definition["columns"]
        template = PACKAGE / "templates" / name
        template_bytes = template.read_bytes()
        if template_bytes.startswith(b"\xef\xbb\xbf"):
            fail(f"{template.relative_to(ROOT)} must be UTF-8 without a BOM")
        header, rows = read_csv(template)
        if header != expected or rows:
            fail(f"{template.relative_to(ROOT)} must contain the manifest header and no records")
        example = PACKAGE / definition["example"]
        example_header, example_rows = read_csv(example)
        if example_header != expected:
            fail(f"{example.relative_to(ROOT)} does not match the manifest header")
        dictionaries = rows_as_dicts(example_header, example_rows)
        if example.name != "evidence-manifest.csv":
            for number, row in enumerate(dictionaries, start=2):
                for column in definition["required"]:
                    if not row.get(column, "").strip():
                        fail(f"{example.relative_to(ROOT)} row {number} has no {column}")
        examples[name] = dictionaries

    raw_file = PACKAGE / "examples/synthetic-source.csv"
    raw_header, raw_rows = read_csv(raw_file)
    batch_rows = examples["batch-manifest.csv"]
    if len(batch_rows) != 1:
        fail("the example must contain exactly one batch manifest row")
    batch = batch_rows[0]
    if batch["template_version"] != manifest["templateVersion"]:
        fail("the example batch template_version does not match the manifest")
    raw_hash = hashlib.sha256(raw_file.read_bytes()).hexdigest()
    if batch["source_file_sha256"] != raw_hash:
        fail("the example batch source_file_sha256 does not match synthetic-source.csv")
    if int(batch["source_record_count"]) != len(raw_rows):
        fail("the example batch source_record_count does not match synthetic-source.csv")

    batch_id = batch["batch_id"]
    for name, rows in examples.items():
        for number, row in enumerate(rows, start=2):
            if row.get("batch_id") != batch_id:
                fail(f"{name} row {number} uses a different batch_id")

    clients = {row["source_client_id"] for row in examples["clients.csv"]}
    customers = {row["source_customer_id"] for row in examples["customers.csv"]}
    vehicles = {row["source_vehicle_id"] for row in examples["vehicles.csv"]}
    jobs = {row["source_job_id"] for row in examples["maintenance-jobs.csv"]}
    for row in examples["client-customer-links.csv"]:
        if row["relationship_kind"] not in manifest["statusValues"]["relationship_kind"]:
            fail("client-customer-links.relationship_kind has an unsupported value")
        require_ref(row["source_client_id"], clients, "client-customer-links.source_client_id")
        require_ref(row["source_customer_id"], customers, "client-customer-links.source_customer_id")
    for row in examples["ownership-intervals.csv"]:
        if row["interval_status"] not in manifest["statusValues"]["ownership_interval_status"]:
            fail("ownership-intervals.interval_status has an unsupported value")
        require_ref(row["source_vehicle_id"], vehicles, "ownership-intervals.source_vehicle_id")
        require_ref(row["source_customer_id"], customers, "ownership-intervals.source_customer_id")
    for row in examples["maintenance-jobs.csv"]:
        require_ref(row["source_client_id"], clients, "maintenance-jobs.source_client_id")
        require_ref(row["source_customer_id"], customers, "maintenance-jobs.source_customer_id")
        require_ref(row["source_vehicle_id"], vehicles, "maintenance-jobs.source_vehicle_id")
        if row["source_payer_entity_type"] not in manifest["statusValues"]["payer_entity_type"]:
            fail("maintenance-jobs.source_payer_entity_type has an unsupported value")
        payer_set = clients if row["source_payer_entity_type"] == "client" else customers
        require_ref(row["source_payer_id"], payer_set, "maintenance-jobs.source_payer_id")
    for row in examples["maintenance-tasks.csv"]:
        require_ref(row["source_job_id"], jobs, "maintenance-tasks.source_job_id")
    for row in examples["commercial-lines.csv"]:
        require_ref(row["source_job_id"], jobs, "commercial-lines.source_job_id")
        if row["line_kind"] not in manifest["statusValues"]["commercial_line_kind"]:
            fail("commercial-lines.line_kind has an unsupported value")
        if row["tax_data_status"] not in manifest["statusValues"]["tax_data_status"]:
            fail("commercial-lines.tax_data_status has an unsupported value")
        if row["payer_entity_type"] not in manifest["statusValues"]["payer_entity_type"]:
            fail("commercial-lines.payer_entity_type has an unsupported value")
        payer_set = clients if row["payer_entity_type"] == "client" else customers
        require_ref(row["payer_source_id"], payer_set, "commercial-lines.payer_source_id")
        if not re.fullmatch(r"[A-Z]{3}", row["currency"]):
            fail("commercial-lines.currency must be an explicit ISO 4217 code")
        if row["tax_currency"] and not re.fullmatch(r"[A-Z]{3}", row["tax_currency"]):
            fail("commercial-lines.tax_currency must be an ISO 4217 code when supplied")
        for column in ("quantity", "unit_amount_decimal", "line_amount_decimal", "tax_amount_decimal", "tax_rate_decimal"):
            parse_decimal(row[column], f"commercial-lines.{column}")
    for name, fields in {
        "client-customer-links.csv": ("effective_from", "effective_until"),
        "ownership-intervals.csv": ("effective_from", "effective_until"),
        "maintenance-jobs.csv": ("source_started_at", "source_completed_at"),
    }.items():
        for row in examples[name]:
            for column in fields:
                parse_date(row[column], f"{name}.{column}")
    for row in examples["maintenance-tasks.csv"]:
        parse_decimal(row["labour_hours"], "maintenance-tasks.labour_hours")

    status_keys = {(row["entity_type"], row["source_status_raw"]) for row in examples["status-map.csv"]}
    for name, entity, column in (
        ("maintenance-jobs.csv", "maintenance-job", "source_status_raw"),
        ("maintenance-tasks.csv", "maintenance-task", "source_status_raw"),
    ):
        for row in examples[name]:
            if (entity, row[column]) not in status_keys:
                fail(f"{name} raw status {row[column]!r} has no status-map row")
    allowed_statuses = set(manifest["statusValues"]["historical_status"])
    for row in examples["status-map.csv"]:
        if row["historical_status"] not in allowed_statuses:
            fail("status-map contains an unsupported historical_status")
        if row["gate_effect"] != "none":
            fail("status-map gate_effect must always be none")
        if row["mapping_state"] != "pending-review":
            fail("fictional status mappings must remain pending-review")
    for row in examples["evidence-manifest.csv"]:
        if row["permission_state"] not in manifest["statusValues"]["permission_state"]:
            fail("evidence-manifest.permission_state has an unsupported value")
    for row in examples["field-mapping.csv"]:
        if row["source_file_sha256"] != raw_hash or row["mapping_version"] != manifest["templateVersion"]:
            fail("field-mapping must reference the exact source checksum and template version")
        if row["source_column"] not in raw_header:
            fail(f"field-mapping source column {row['source_column']!r} is absent from the source example")
        if row["review_state"] != "pending-review":
            fail("fictional field mappings must remain pending-review")
        if row["review_state"] not in manifest["statusValues"]["review_state"]:
            fail("field-mapping.review_state has an unsupported value")

    print(f"Historical import templates passed: {len(manifest['files'])} template/example CSV pairs, one synthetic batch, source SHA-256 and cross-file references verified.")


if __name__ == "__main__":
    main()

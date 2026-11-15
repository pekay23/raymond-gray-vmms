#!/usr/bin/env python3
"""Check that a backup package and restore artifacts are internally consistent.

This checks artifacts prepared by the approved database/object-store backup
process. It does not create backups, restore a database, or authorize rollout.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
from pathlib import Path, PurePosixPath
from typing import Any

SHA256 = re.compile(r"^[0-9a-f]{64}$")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
MAX_MANIFEST_BYTES = 64 * 1024 * 1024
CATALOG_FIELDS = ("evidenceId", "objectType", "objectKey", "sizeBytes", "sha256")


class VerificationError(Exception):
    pass


def load_json(path: Path, label: str) -> Any:
    try:
        if path.stat().st_size > MAX_MANIFEST_BYTES:
            raise VerificationError(f"{label} exceeds the {MAX_MANIFEST_BYTES}-byte safety limit")
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise VerificationError(f"Cannot read {label}: {error}") from error


def require(condition: bool, message: str) -> None:
    if not condition:
        raise VerificationError(message)


def require_provider_version(value: Any, label: str) -> None:
    require(isinstance(value, str) and bool(value.strip()), f"{label} is required")
    require(value.strip().lower() not in {"null", "none", "n/a", "na", "unversioned", "unknown"},
            f"{label} must be a non-null provider version identifier")


def is_link_like(path: Path) -> bool:
    if path.is_symlink():
        return True
    junction = getattr(path, "is_junction", None)
    if junction is not None and junction():
        return True
    try:
        attributes = getattr(path.lstat(), "st_file_attributes", 0)
    except OSError:
        return False
    reparse_point = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x0400)
    return bool(attributes & reparse_point)


def safe_relative(value: Any, label: str) -> str:
    require(isinstance(value, str) and bool(value), f"{label} must be a non-empty relative path")
    require("\\" not in value and "\0" not in value and ":" not in value, f"{label} must use safe POSIX path syntax")
    path = PurePosixPath(value)
    require(not path.is_absolute() and all(part not in ("", ".", "..") for part in path.parts), f"{label} escapes its artifact directory")
    return path.as_posix()


def artifact_path(root: Path, relative: str, label: str) -> Path:
    root = root.resolve(strict=True)
    path = root
    for part in PurePosixPath(relative).parts:
        path = path / part
        require(not is_link_like(path), f"{label} must not traverse symbolic links or junctions")
        try:
            path = path.resolve(strict=True)
        except OSError as error:
            raise VerificationError(f"{label} is missing or is not a regular file") from error
        require(path.is_relative_to(root), f"{label} escapes its artifact directory")
    require(path.is_file(), f"{label} is missing or is not a regular file")
    return path


def digest_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def check_file(root: Path, relative: str, expected_size: Any, expected_hash: Any, label: str) -> None:
    require(type(expected_size) is int and expected_size >= 0, f"{label} has an invalid byte size")
    require(isinstance(expected_hash, str) and SHA256.fullmatch(expected_hash) is not None, f"{label} has an invalid SHA-256")
    path = artifact_path(root, relative, label)
    size, sha256 = digest_file(path)
    require(size == expected_size, f"{label} byte size mismatch: expected {expected_size}, found {size}")
    require(sha256 == expected_hash, f"{label} SHA-256 mismatch")


def catalog_entries(document: Any, label: str) -> dict[tuple[str, str], tuple[Any, ...]]:
    require(isinstance(document, dict) and isinstance(document.get("entries"), list), f"{label} must contain an entries list")
    require(isinstance(document.get("databaseSnapshotId"), str) and document["databaseSnapshotId"],
            f"{label} must identify its database snapshot")
    result: dict[tuple[str, str], tuple[Any, ...]] = {}
    for number, entry in enumerate(document["entries"], 1):
        require(isinstance(entry, dict), f"{label} entry {number} must be an object")
        normalized: list[Any] = []
        for field in CATALOG_FIELDS:
            require(field in entry, f"{label} entry {number} is missing {field}")
            normalized.append(entry[field])
        evidence_id, object_type, object_key, size, sha256 = normalized
        require(isinstance(evidence_id, str) and UUID.fullmatch(evidence_id) is not None, f"{label} entry {number} has an invalid evidence ID")
        require(object_type in ("accepted", "quarantine"), f"{label} entry {number} has an invalid object type")
        safe_relative(object_key, f"{label} entry {number} object key")
        require(type(size) is int and size >= 0, f"{label} entry {number} has an invalid byte size")
        require(isinstance(sha256, str) and SHA256.fullmatch(sha256) is not None, f"{label} entry {number} has an invalid SHA-256")
        key = (evidence_id, object_key)
        require(key not in result, f"{label} contains duplicate evidence/object identity")
        result[key] = tuple(normalized)
    return result


def listed_files(root: Path) -> set[str]:
    root = root.resolve(strict=True)
    result: set[str] = set()
    pending = [root]
    while pending:
        directory = pending.pop()
        for path in directory.iterdir():
            require(not is_link_like(path), f"Artifact directory contains a symbolic link or junction: {path.relative_to(root)}")
            resolved = path.resolve(strict=True)
            require(resolved.is_relative_to(root), f"Artifact directory entry escapes its root: {path.relative_to(root)}")
            if path.is_file():
                result.add(path.relative_to(root).as_posix())
            elif path.is_dir():
                pending.append(path)
            else:
                raise VerificationError(f"Artifact directory contains a non-regular entry: {path.relative_to(root)}")
    return result


def verify(args: argparse.Namespace) -> dict[str, Any]:
    backup_root = args.backup_root.resolve(strict=True)
    restore_root = args.restore_root.resolve(strict=True)
    require(backup_root != restore_root and backup_root not in restore_root.parents and restore_root not in backup_root.parents,
            "Backup and restore directories must be separate, non-overlapping paths")

    manifest = load_json(args.manifest, "backup manifest")
    require(isinstance(manifest, dict) and manifest.get("schemaVersion") == 1, "Unsupported evidence backup manifest version")
    require(isinstance(manifest.get("backupId"), str) and manifest["backupId"], "Manifest backupId is required")
    database = manifest.get("databaseSnapshot")
    require(isinstance(database, dict), "Manifest databaseSnapshot is required")
    require(isinstance(database.get("snapshotId"), str) and database["snapshotId"], "Database snapshotId is required")
    require_provider_version(database.get("backupVersionId"), "Database backupVersionId")
    database_path = safe_relative(database.get("artifactPath"), "Database artifactPath")
    require(type(database.get("sizeBytes")) is int and database["sizeBytes"] > 0, "Database snapshot must not be empty")
    check_file(backup_root, database_path, database.get("sizeBytes"), database.get("sha256"), "Database snapshot")

    rows = manifest.get("objects")
    require(isinstance(rows, list), "Manifest objects must be a list")
    expected: dict[tuple[str, str], tuple[Any, ...]] = {}
    expected_files = {database_path}
    for number, row in enumerate(rows, 1):
        require(isinstance(row, dict), f"Manifest object {number} must be an object")
        evidence_id = row.get("evidenceId")
        object_type = row.get("objectType")
        object_key = safe_relative(row.get("objectKey"), f"Manifest object {number} objectKey")
        require(isinstance(evidence_id, str) and UUID.fullmatch(evidence_id) is not None, f"Manifest object {number} has an invalid evidence ID")
        require(object_type in ("accepted", "quarantine"), f"Manifest object {number} has an invalid object type")
        require_provider_version(row.get("sourceVersionId"), f"Manifest object {number} sourceVersionId")
        require_provider_version(row.get("backupVersionId"), f"Manifest object {number} backupVersionId")
        expected_row = (evidence_id, object_type, object_key, row.get("sizeBytes"), row.get("sha256"))
        identity = (evidence_id, object_key)
        require(identity not in expected, "Manifest contains duplicate evidence/object identity")
        expected[identity] = expected_row
        backup_path = safe_relative(row.get("backupPath"), f"Manifest object {number} backupPath")
        require(backup_path not in expected_files, "Manifest contains duplicate artifact paths")
        expected_files.add(backup_path)
        check_file(backup_root, backup_path, row.get("sizeBytes"), row.get("sha256"), f"Backup object {number}")
        check_file(restore_root, object_key, row.get("sizeBytes"), row.get("sha256"), f"Restored object {number}")

    source_document = load_json(args.source_catalog, "source metadata catalog")
    restored_document = load_json(args.restored_catalog, "restored metadata catalog")
    require(isinstance(source_document, dict), "Source metadata catalog must be an object")
    require(isinstance(restored_document, dict), "Restored metadata catalog must be an object")
    require(source_document.get("databaseSnapshotId") == database["snapshotId"],
            "Source metadata catalog does not identify the manifest database snapshot")
    require(restored_document.get("databaseSnapshotId") == database["snapshotId"],
            "Restored metadata catalog does not identify the manifest database snapshot")
    source = catalog_entries(source_document, "Source metadata catalog")
    restored = catalog_entries(restored_document, "Restored metadata catalog")
    require(source == expected, "Backup manifest does not exactly match the source metadata catalog")
    require(restored == source, "Restored database metadata does not exactly match the source catalog")
    require(listed_files(backup_root) == expected_files, "Backup directory has missing or unlisted artifacts")
    require(listed_files(restore_root) == {row[2] for row in expected.values()}, "Restore directory has missing or unlisted evidence objects")

    return {
        "status": "package-consistent",
        "backupId": manifest["backupId"],
        "databaseSnapshotId": database["snapshotId"],
        "evidenceObjectCount": len(expected),
        "databaseSnapshotSha256": database["sha256"],
        "checks": ["non-empty database snapshot bytes", "source and backup object versions recorded", "backup object size and SHA-256", "restored object size and SHA-256", "source and restored metadata match", "missing and unlisted artifact detection", "backup and restore artifact directories are separate and non-overlapping"],
        "productionCoverage": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--backup-root", type=Path, required=True)
    parser.add_argument("--restore-root", type=Path, required=True)
    parser.add_argument("--source-catalog", type=Path, required=True)
    parser.add_argument("--restored-catalog", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = verify(args)
    except (VerificationError, OSError) as error:
        print(json.dumps({"status": "failed", "error": str(error), "productionCoverage": False}, indent=2))
        return 1
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

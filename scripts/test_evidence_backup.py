import hashlib
import json
import runpy
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("verify-evidence-backup.py")
IS_LINK_LIKE = runpy.run_path(str(SCRIPT))["is_link_like"]


class EvidenceBackupVerifierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.backup = self.root / "backup"
        self.restore = self.root / "isolated-restore"
        self.backup.mkdir()
        self.restore.mkdir()
        self.evidence_id = str(uuid.uuid4())
        self.bytes = b"Synthetic private evidence bytes for restore verification\n"
        self.sha = hashlib.sha256(self.bytes).hexdigest()
        self.key = f"accepted/{self.evidence_id}"
        (self.backup / "database").mkdir()
        (self.backup / "database" / "snapshot.dump").write_bytes(b"Synthetic database snapshot\n")
        (self.backup / "objects" / "accepted").mkdir(parents=True)
        (self.backup / "objects" / self.key).write_bytes(self.bytes)
        (self.restore / "accepted").mkdir()
        (self.restore / self.key).write_bytes(self.bytes)
        entry = {
            "evidenceId": self.evidence_id,
            "objectType": "accepted",
            "objectKey": self.key,
            "sizeBytes": len(self.bytes),
            "sha256": self.sha,
        }
        self.manifest = {
            "schemaVersion": 1,
            "backupId": str(uuid.uuid4()),
            "databaseSnapshot": {
                "snapshotId": "synthetic-postgres-snapshot",
                "backupVersionId": "synthetic-backup-snapshot-version",
                "artifactPath": "database/snapshot.dump",
                "sizeBytes": (self.backup / "database" / "snapshot.dump").stat().st_size,
                "sha256": hashlib.sha256((self.backup / "database" / "snapshot.dump").read_bytes()).hexdigest(),
            },
            "objects": [{
                **entry,
                "sourceVersionId": "synthetic-source-object-version",
                "backupVersionId": "synthetic-backup-object-version",
                "backupPath": f"objects/{self.key}",
            }],
        }
        self.manifest_path = self.root / "manifest.json"
        self.source_catalog = self.root / "source-catalog.json"
        self.restored_catalog = self.root / "restored-catalog.json"
        self.write_json(self.manifest_path, self.manifest)
        self.write_json(self.source_catalog, {"databaseSnapshotId": "synthetic-postgres-snapshot", "entries": [entry]})
        self.write_json(self.restored_catalog, {"databaseSnapshotId": "synthetic-postgres-snapshot", "entries": [entry]})

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def write_json(path, value):
        path.write_text(json.dumps(value), encoding="utf-8")

    def run_verifier(self):
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--manifest", str(self.manifest_path),
             "--backup-root", str(self.backup), "--restore-root", str(self.restore),
             "--source-catalog", str(self.source_catalog), "--restored-catalog", str(self.restored_catalog)],
            capture_output=True, text=True, check=False,
        )

    def test_valid_backup_and_restored_catalog_pass(self):
        result = self.run_verifier()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["status"], "package-consistent")
        self.assertEqual(report["evidenceObjectCount"], 1)
        self.assertFalse(report["productionCoverage"])

    def test_corrupt_restored_object_fails(self):
        (self.restore / self.key).write_bytes(b"X" * len(self.bytes))
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SHA-256 mismatch", result.stdout)

    def test_missing_restored_object_fails(self):
        (self.restore / self.key).unlink()
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing or is not a regular file", result.stdout)

    def test_restored_metadata_mismatch_fails(self):
        self.write_json(self.restored_catalog, {"databaseSnapshotId": "synthetic-postgres-snapshot", "entries": []})
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Restored database metadata", result.stdout)

    def test_missing_provider_object_version_fails(self):
        self.manifest["objects"][0]["backupVersionId"] = ""
        self.write_json(self.manifest_path, self.manifest)
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("backupVersionId is required", result.stdout)

    def test_null_object_version_fails(self):
        self.manifest["objects"][0]["sourceVersionId"] = "null"
        self.write_json(self.manifest_path, self.manifest)
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("non-null provider version identifier", result.stdout)

    def test_unlisted_backup_object_fails(self):
        (self.backup / "orphaned-object").write_bytes(b"orphan")
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing or unlisted artifacts", result.stdout)

    def test_backup_and_restore_roots_must_be_isolated(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--manifest", str(self.manifest_path),
             "--backup-root", str(self.backup), "--restore-root", str(self.backup),
             "--source-catalog", str(self.source_catalog), "--restored-catalog", str(self.restored_catalog)],
            capture_output=True, text=True, check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("separate, non-overlapping", result.stdout)

    def test_junctions_are_treated_as_linked_paths(self):
        with patch.object(Path, "is_junction", return_value=True, create=True):
            self.assertTrue(IS_LINK_LIKE(self.backup))

    def test_path_traversal_fails(self):
        self.manifest["objects"][0]["backupPath"] = "../outside"
        self.write_json(self.manifest_path, self.manifest)
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("escapes its artifact directory", result.stdout)

    def test_catalog_snapshot_identity_must_match_manifest(self):
        self.write_json(self.restored_catalog, {"databaseSnapshotId": "different-snapshot", "entries": [{
            "evidenceId": self.evidence_id, "objectType": "accepted", "objectKey": self.key,
            "sizeBytes": len(self.bytes), "sha256": self.sha,
        }]})
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not identify the manifest database snapshot", result.stdout)

    def test_empty_database_snapshot_fails(self):
        snapshot = self.backup / "database" / "snapshot.dump"
        snapshot.write_bytes(b"")
        self.manifest["databaseSnapshot"]["sizeBytes"] = 0
        self.manifest["databaseSnapshot"]["sha256"] = hashlib.sha256(b"").hexdigest()
        self.write_json(self.manifest_path, self.manifest)
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Database snapshot must not be empty", result.stdout)


if __name__ == "__main__":
    unittest.main()

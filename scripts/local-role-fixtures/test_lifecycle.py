from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import lifecycle


INSTALLATION_ID = "a1b2c3d4-1122-4334-8556-aabbccddeeff"
SLUG = "a1b2c3d4"


def valid_state(folder: Path) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "installationId": INSTALLATION_ID,
        "instanceSlug": SLUG,
        "authComposeProject": f"rg-auth-role-{SLUG}",
        "vmmsComposeProject": f"vmms-role-{SLUG}",
        "authPort": 18180,
        "authDatabasePort": 58432,
        "vmmsDatabasePort": 55440,
        "apiPort": 14100,
        "webPort": 15173,
        "databaseName": f"vmms_role_rehearsal_{SLUG}",
        "databaseVolume": f"vmms_role_rehearsal_data_{SLUG}",
        "realm": f"vmms-role-review-{SLUG}",
        "issuer": f"http://127.0.0.1:18180/realms/vmms-role-review-{SLUG}",
        "clientId": f"vmms-role-review-{SLUG}",
        "callbackUri": "http://127.0.0.1:14100/api/v1/auth/oidc/callback",
        "webOrigin": "http://127.0.0.1:15173",
        "authManifestPath": str(folder / "identity-request.json"),
        "identityCredentialsPath": str(folder / "identity-credentials.json"),
        "identityReceiptPath": str(folder / "identity-receipt.json"),
        "credentialsGuidePath": str(folder / "login-credentials.txt"),
        "privateConfigPath": str(folder / "private.json"),
    }


def write_fixture(root: Path, *, with_receipt: bool = False) -> Path:
    folder = root / INSTALLATION_ID
    folder.mkdir(parents=True)
    state = valid_state(folder)
    (folder / "state.json").write_text(json.dumps(state), encoding="utf-8")
    for name in lifecycle.ARTIFACTS:
        (folder / name).write_text("synthetic sentinel secret", encoding="utf-8")
    if with_receipt:
        expected_actor_keys = lifecycle._expected_identity_actor_keys()
        receipt = {
            "schemaVersion": 1,
            "installationId": INSTALLATION_ID,
            "issuer": state["issuer"],
            "clientId": state["clientId"],
            "actors": [{"key": key, "subject": f"00000000-0000-4000-8000-{index:012d}"} for index, key in enumerate(sorted(expected_actor_keys), start=1)],
        }
        (folder / "identity-receipt.json").write_text(json.dumps(receipt), encoding="utf-8")
    return folder


class LifecycleReadOnlyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "VMMS-Role-Rehearsal"
        self.root.mkdir()
        self.acl_check = Mock()

    def test_missing_installation_is_incomplete(self):
        report = lifecycle.inspect_installation(INSTALLATION_ID, root=self.root, acl_check=self.acl_check)
        self.assertEqual(report["outcome"], "incomplete")
        self.assertEqual(report["checks"][0]["status"], "missing")

    def test_missing_identity_and_runtime_are_never_success(self):
        write_fixture(self.root)
        report = lifecycle.inspect_installation(INSTALLATION_ID, root=self.root, acl_check=self.acl_check)
        self.assertEqual(report["outcome"], "incomplete")
        checks = {item["name"]: item["status"] for item in report["checks"]}
        self.assertEqual(checks["identity-receipt"], "missing")
        self.assertEqual(checks["runtime"], "not-recorded")

    def test_valid_identity_receipt_is_still_incomplete_without_runtime_marker(self):
        write_fixture(self.root, with_receipt=True)
        report = lifecycle.inspect_installation(INSTALLATION_ID, root=self.root, acl_check=self.acl_check)
        checks = {item["name"]: item["status"] for item in report["checks"]}
        self.assertEqual(report["outcome"], "incomplete")
        self.assertEqual(checks["identity-receipt"], "verified")
        self.assertEqual(checks["runtime"], "not-recorded")

    def test_identity_receipt_rejects_sensitive_fields(self):
        folder = write_fixture(self.root, with_receipt=True)
        receipt_path = folder / "identity-receipt.json"
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        receipt["accessToken"] = "synthetic sentinel secret"
        receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
        with self.assertRaisesRegex(lifecycle.FixtureStateError, "sensitive field"):
            lifecycle.inspect_installation(INSTALLATION_ID, root=self.root, acl_check=self.acl_check)

    def test_identity_receipt_rejects_duplicate_subjects(self):
        folder = write_fixture(self.root, with_receipt=True)
        receipt_path = folder / "identity-receipt.json"
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        receipt["actors"][1]["subject"] = receipt["actors"][0]["subject"]
        receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
        with self.assertRaisesRegex(lifecycle.FixtureStateError, "duplicate"):
            lifecycle.inspect_installation(INSTALLATION_ID, root=self.root, acl_check=self.acl_check)

    def test_identity_receipt_rejects_stale_extra_actor_slot(self):
        folder = write_fixture(self.root, with_receipt=True)
        receipt_path = folder / "identity-receipt.json"
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        receipt["actors"].append({"key": "p16", "subject": "00000000-0000-4000-8000-000000000016"})
        receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
        with self.assertRaisesRegex(lifecycle.FixtureStateError, "every current staff persona"):
            lifecycle.inspect_installation(INSTALLATION_ID, root=self.root, acl_check=self.acl_check)

    def test_never_reads_private_artifact_contents(self):
        folder = write_fixture(self.root, with_receipt=True)
        original_reader = lifecycle._read_json
        read_names: list[str] = []

        def track(path: Path):
            read_names.append(path.name)
            return original_reader(path)

        lifecycle.inspect_installation(INSTALLATION_ID, root=self.root, acl_check=self.acl_check, json_reader=track)
        self.assertEqual(read_names, ["state.json", "identity-receipt.json"])
        self.assertTrue((folder / "private.json").exists())

    def test_state_marker_drift_is_rejected(self):
        folder = write_fixture(self.root)
        state_path = folder / "state.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state["vmmsComposeProject"] = "unrelated-project"
        state_path.write_text(json.dumps(state), encoding="utf-8")
        with self.assertRaisesRegex(lifecycle.FixtureStateError, "markers"):
            lifecycle.inspect_installation(INSTALLATION_ID, root=self.root, acl_check=self.acl_check)

    def test_state_artifact_paths_cannot_escape_installation(self):
        folder = write_fixture(self.root)
        state_path = folder / "state.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state["privateConfigPath"] = str(self.root / "other" / "private.json")
        state_path.write_text(json.dumps(state), encoding="utf-8")
        with self.assertRaisesRegex(lifecycle.FixtureStateError, "outside"):
            lifecycle.inspect_installation(INSTALLATION_ID, root=self.root, acl_check=self.acl_check)

    def test_symlink_selected_installation_is_rejected(self):
        target = self.root / "elsewhere"
        target.mkdir()
        selected = self.root / INSTALLATION_ID
        selected.symlink_to(target, target_is_directory=True)
        with patch.object(Path, "is_symlink", autospec=True, side_effect=lambda path: path == selected):
            with self.assertRaisesRegex(lifecycle.FixtureStateError, "symbolic link"):
                lifecycle.inspect_installation(INSTALLATION_ID, root=self.root, acl_check=self.acl_check)

    def test_insecure_acl_backend_fails_closed(self):
        write_fixture(self.root)

        def reject(path: Path, *, directory: bool):
            if path.name == "private.json":
                raise lifecycle.FixtureStateError("A fixture file or folder is accessible to other local users.")

        with self.assertRaisesRegex(lifecycle.FixtureStateError, "accessible"):
            lifecycle.inspect_installation(INSTALLATION_ID, root=self.root, acl_check=reject)

    def test_windows_acl_parser_rejects_inherited_and_unexpected_principals(self):
        lifecycle._validate_windows_acl(
            "C:\\fixture\n  WORKSHOP\\operator:(R,W)\n  NT AUTHORITY\\SYSTEM:(F)\n  BUILTIN\\Administrators:(F)",
            "workshop\\operator",
        )
        with self.assertRaisesRegex(lifecycle.FixtureStateError, "inherited"):
            lifecycle._validate_windows_acl("C:\\fixture\n  WORKSHOP\\operator:(I)(R,W)", "workshop\\operator")
        with self.assertRaisesRegex(lifecycle.FixtureStateError, "broadly shared"):
            lifecycle._validate_windows_acl("C:\\fixture\n  Everyone:(R)", "workshop\\operator")
        with self.assertRaisesRegex(lifecycle.FixtureStateError, "owner"):
            lifecycle._validate_windows_acl("C:\\fixture\n  NT AUTHORITY\\SYSTEM:(F)", "workshop\\operator")

    def test_cli_missing_fixture_reports_incomplete_with_nonzero_exit(self):
        env = dict(os.environ)
        env["LOCALAPPDATA"] = str(self.root.parent / "absent")
        script = Path(__file__).with_name("lifecycle.py")
        result = subprocess.run(
            [sys.executable, str(script), "status", "--installation-id", INSTALLATION_ID],
            capture_output=True,
            text=True,
            env=env,
            timeout=10,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stdout)["outcome"], "incomplete")
        self.assertNotIn("synthetic sentinel secret", result.stdout)

    def test_cli_incomplete_exit_is_not_success(self):
        with patch("runtime.verify_prepared_installation", return_value={"installationId": INSTALLATION_ID, "outcome": "incomplete", "checks": [], "message": "missing"}):
            self.assertEqual(lifecycle.main(["verify", "--installation-id", INSTALLATION_ID]), 2)


if __name__ == "__main__":
    unittest.main()

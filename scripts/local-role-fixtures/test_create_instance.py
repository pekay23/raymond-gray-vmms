from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import unittest
from unittest import mock
from pathlib import Path

SCRIPT = Path(__file__).with_name("create-instance.py")
SPEC = importlib.util.spec_from_file_location("local_role_fixture_instance", SCRIPT)
assert SPEC and SPEC.loader
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)


class LocalRoleFixtureInstanceTests(unittest.TestCase):
    def test_port_allocator_never_reuses_ports_reserved_by_existing_installations(self):
        reserved = {18180, 58432, 55440, 14100, 15173}

        ports = FIXTURE._allocate_ports(reserved)

        self.assertEqual(set(ports), set(FIXTURE.PORT_RANGES))
        self.assertEqual(len(set(ports.values())), len(FIXTURE.PORT_RANGES))
        self.assertTrue(reserved.isdisjoint(ports.values()))
        for field, port in ports.items():
            start, end = FIXTURE.PORT_RANGES[field]
            self.assertGreaterEqual(port, start)
            self.assertLess(port, end)

    def test_existing_fixture_ports_are_reserved_from_private_public_state(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            instance_id = "a1b2c3d4-1122-4334-8556-aabbccddeeff"
            state_dir = root / instance_id
            state_dir.mkdir()
            state = {
                "schemaVersion": 1,
                "installationId": instance_id,
                "instanceSlug": "a1b2c3d4",
                "authPort": 18180,
                "authDatabasePort": 58432,
                "vmmsDatabasePort": 55440,
                "apiPort": 14100,
                "webPort": 15173,
            }
            (state_dir / "state.json").write_text(json.dumps(state), encoding="utf-8")

            with mock.patch.object(FIXTURE, "_check_acl"):
                reserved = FIXTURE._reserved_fixture_ports(root)

            self.assertEqual(reserved, set(state[field] for field in FIXTURE.PORT_RANGES))

    def test_instance_uses_private_synthetic_credentials_and_distinct_ports(self):
        with tempfile.TemporaryDirectory() as folder:
            prior = os.environ.get("LOCALAPPDATA")
            os.environ["LOCALAPPDATA"] = folder
            try:
                result = FIXTURE.create_instance("a1b2c3d4-1122-4334-8556-aabbccddeeff")
            finally:
                if prior is None:
                    os.environ.pop("LOCALAPPDATA", None)
                else:
                    os.environ["LOCALAPPDATA"] = prior

            state_dir = Path(result["stateDirectory"])
            state = json.loads((state_dir / "state.json").read_text(encoding="utf-8"))
            private = json.loads((state_dir / "private.json").read_text(encoding="utf-8"))
            request = json.loads((state_dir / "identity-request.json").read_text(encoding="utf-8"))
            credentials = json.loads((state_dir / "identity-credentials.json").read_text(encoding="utf-8"))
            login_guide = (state_dir / "login-credentials.txt").read_text(encoding="utf-8")
            personas = json.loads(Path(__file__).with_name("personas.json").read_text(encoding="utf-8"))
            expected_actor_count = len(personas["staff"]) + 1

            self.assertEqual(state["installationId"], "a1b2c3d4-1122-4334-8556-aabbccddeeff")
            self.assertEqual(state["instanceSlug"], "a1b2c3d4")
            self.assertEqual(len(request["actors"]), expected_actor_count)
            self.assertEqual(set(credentials["actors"]), {f"p{index:02d}" for index in range(1, expected_actor_count + 1)})
            self.assertNotIn("roleCode", json.dumps(request))
            self.assertNotIn("clientSecret", json.dumps(state))
            self.assertNotIn("databasePassword", json.dumps(state))
            self.assertNotIn(private["sessionSecret"], login_guide)
            self.assertNotIn(private["clientSecret"], login_guide)
            self.assertIn("VMMS Operator", login_guide)
            self.assertIn("Head of Service Centre / Operations Admin", login_guide)
            self.assertIn("Sales Representative", login_guide)
            self.assertIn("PDI Observer", login_guide)
            self.assertIn("Approved vehicle owner", login_guide)
            self.assertEqual(private["identityCredentials"], credentials)
            self.assertEqual(len({state["authPort"], state["authDatabasePort"], state["vmmsDatabasePort"], state["apiPort"], state["webPort"]}), 5)
            self.assertTrue(all(len(password) >= 12 for password in credentials["actors"].values()))
            for path in state_dir.iterdir():
                FIXTURE._check_acl(path)

    def test_existing_installation_path_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            prior = os.environ.get("LOCALAPPDATA")
            os.environ["LOCALAPPDATA"] = folder
            try:
                FIXTURE.create_instance("a1b2c3d4-1122-4334-8556-aabbccddeeff")
                with self.assertRaisesRegex(FIXTURE.FixtureError, "already exists"):
                    FIXTURE.create_instance("a1b2c3d4-1122-4334-8556-aabbccddeeff")
            finally:
                if prior is None:
                    os.environ.pop("LOCALAPPDATA", None)
                else:
                    os.environ["LOCALAPPDATA"] = prior


if __name__ == "__main__":
    unittest.main()

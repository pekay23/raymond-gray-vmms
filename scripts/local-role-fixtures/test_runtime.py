from __future__ import annotations

import json
import socket
import subprocess
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import runtime


PROJECT = "vmms-role-a1b2c3d4"
INSTANCE = "a1b2c3d4"
CONTAINER = "a" * 64


def runner_for(*, port: int = 55440, marker: str = INSTANCE):
    def run(args, **kwargs):
        if args[:3] == ["docker", "ps", "--all"]:
            return SimpleNamespace(stdout=CONTAINER)
        if args[:3] == ["docker", "inspect", "--format"]:
            output = "|".join([
                CONTAINER,
                "postgres:18.1",
                "true",
                "healthy",
                PROJECT,
                "postgres",
                marker,
                json.dumps({"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(port)}]}),
                json.dumps([{"Type": "volume", "Name": "vmms_role_rehearsal_data_a1b2c3d4", "Destination": "/var/lib/postgresql"}]),
            ])
            return SimpleNamespace(stdout=output)
        raise AssertionError("Unexpected command")
    return run


def auth_runner_for(*, health: str = "healthy"):
    def run(args, **kwargs):
        if args[:3] == ["docker", "ps", "--all"]:
            return SimpleNamespace(stdout="\n".join(["a" * 64, "b" * 64]))
        if args[:3] == ["docker", "inspect", "--format"]:
            container_id = args[-1]
            service = "postgres" if container_id.startswith("a") else "keycloak"
            image = "postgres:18.1" if service == "postgres" else "quay.io/keycloak/keycloak:26.8.2"
            port_map = {"5432/tcp": None} if service == "postgres" else {"8080/tcp": [{"HostIp": "127.0.0.1", "HostPort": "18180"}]}
            mounts = [{"Type": "volume", "Name": "rg-auth-role-a1b2c3d4_role_fixture_auth_db", "Destination": "/var/lib/postgresql"}] if service == "postgres" else []
            return SimpleNamespace(stdout="|".join([container_id, image, "true", health, PROJECT.replace("vmms-role", "rg-auth-role"), service, INSTANCE, json.dumps(port_map), json.dumps(mounts)]))
        raise AssertionError("Unexpected command")
    return run


class RuntimeSafetyTests(unittest.TestCase):
    def test_owned_database_container_requires_exact_project_label_image_port_and_volume(self):
        result = runtime._inspect_owned(
            runner_for(), PROJECT, INSTANCE, {"postgres"}, "org.raymond-gray.vmms.role-rehearsal",
            {"postgres": "postgres:18.1"}, expected_volume="vmms_role_rehearsal_data_a1b2c3d4",
            published_ports={"postgres": ("5432/tcp", 55440)},
        )
        self.assertEqual(result, [CONTAINER])

    def test_rejects_wrong_loopback_database_port_before_accepting_runtime(self):
        with self.assertRaisesRegex(runtime.RuntimeErrorSafe, "host binding"):
            runtime._inspect_owned(
                runner_for(port=5432), PROJECT, INSTANCE, {"postgres"}, "org.raymond-gray.vmms.role-rehearsal",
                {"postgres": "postgres:18.1"}, expected_volume="vmms_role_rehearsal_data_a1b2c3d4",
                published_ports={"postgres": ("5432/tcp", 55440)},
            )

    def test_rejects_container_from_another_installation(self):
        with self.assertRaisesRegex(runtime.RuntimeErrorSafe, "ownership"):
            runtime._inspect_owned(
                runner_for(marker="ffffffff"), PROJECT, INSTANCE, {"postgres"}, "org.raymond-gray.vmms.role-rehearsal",
                {"postgres": "postgres:18.1"}, expected_volume="vmms_role_rehearsal_data_a1b2c3d4",
                published_ports={"postgres": ("5432/tcp", 55440)},
            )

    def test_cold_start_can_be_resumed_when_exact_owned_services_are_still_starting(self):
        ids = runtime._inspect_owned(
            auth_runner_for(health="starting"), "rg-auth-role-a1b2c3d4", INSTANCE, {"postgres", "keycloak"},
            "org.raymond-gray.auth.role-fixture", {"postgres": "postgres:18.1", "keycloak": "quay.io/keycloak/keycloak:26.8.2"},
            expected_volume="rg-auth-role-a1b2c3d4_role_fixture_auth_db",
            published_ports={"postgres": None, "keycloak": ("8080/tcp", 18180)}, allow_starting=True,
        )
        self.assertEqual(set(ids), {"a" * 64, "b" * 64})

    def test_does_not_accept_unhealthy_service_as_resumable(self):
        with self.assertRaisesRegex(runtime.RuntimeErrorSafe, "ownership, image, or health"):
            runtime._inspect_owned(
                auth_runner_for(health="unhealthy"), "rg-auth-role-a1b2c3d4", INSTANCE, {"postgres", "keycloak"},
                "org.raymond-gray.auth.role-fixture", {"postgres": "postgres:18.1", "keycloak": "quay.io/keycloak/keycloak:26.8.2"},
                expected_volume="rg-auth-role-a1b2c3d4_role_fixture_auth_db",
                published_ports={"postgres": None, "keycloak": ("8080/tcp", 18180)}, allow_starting=True,
            )

    def test_error_does_not_echo_private_command_output(self):
        secret = "private-fixture-sentinel"
        def fail(*_args, **_kwargs):
            raise subprocess.CalledProcessError(1, ["docker"], stderr=secret)
        with self.assertRaises(runtime.RuntimeErrorSafe) as caught:
            runtime._command(fail, ["docker", "compose", "config"])
        self.assertNotIn(secret, str(caught.exception))

    def test_initial_prepare_refuses_existing_project_before_volume_or_compose_mutation(self):
        runner = Mock(return_value=SimpleNamespace(stdout=CONTAINER))
        with self.assertRaisesRegex(runtime.RuntimeErrorSafe, "already uses"):
            runtime._ensure_empty_start(runner, PROJECT, "unused-volume", None)
        runner.assert_called_once()

    def test_remote_docker_context_is_rejected_before_any_rehearsal_mutation(self):
        runner = lambda *_args, **_kwargs: SimpleNamespace(stdout="ssh://build-host")
        with self.assertRaisesRegex(runtime.RuntimeErrorSafe, "remote host"):
            runtime._assert_local_docker(runner)

    def test_loopback_port_in_use_is_rejected(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            port = listener.getsockname()[1]
            with self.assertRaisesRegex(runtime.RuntimeErrorSafe, "already in use"):
                runtime._assert_ports_free([port])

    def test_child_environment_keeps_windows_compose_plugin_lookup_without_docker_override(self):
        filtered = runtime._child_environment({
            "PATH": "C:/Windows/System32",
            "ProgramFiles": "C:/Program Files",
            "DOCKER_HOST": "tcp://remote-host:2376",
            "GITHUB_TOKEN": "sentinel",
        })
        self.assertEqual(filtered.get("ProgramFiles"), "C:/Program Files")
        self.assertNotIn("DOCKER_HOST", filtered)
        self.assertNotIn("GITHUB_TOKEN", filtered)

    def test_stopped_recorded_app_process_is_not_reported_as_running(self):
        with patch.object(runtime, "_process_information", return_value=None):
            self.assertFalse(runtime._check_recorded_app_process(
                "web", {"pid": 123, "creationMarker": "created"},
                node_executable="C:/node.exe", script_marker="C:/vite.js", port=15174,
            ))

    def test_recorded_app_process_must_still_serve_on_its_loopback_port(self):
        identity = {"commandLine": "node C:\\vite.js", "executablePath": "C:\\node.exe", "creationMarker": "created"}
        with patch.object(runtime, "_process_information", return_value=identity), patch.object(runtime, "_http_status", return_value=None):
            with self.assertRaisesRegex(runtime.RuntimeErrorSafe, "not serving"):
                runtime._check_recorded_app_process(
                    "web", {"pid": 123, "creationMarker": "created"},
                    node_executable="C:\\node.exe", script_marker="C:\\vite.js", port=15174,
                )


if __name__ == "__main__":
    unittest.main()

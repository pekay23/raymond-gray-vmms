"""Private, installation-scoped preparation for a local VMMS role rehearsal."""
from __future__ import annotations

import json
import http.client
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Callable
from urllib.request import HTTPRedirectHandler, build_opener

import lifecycle


class RuntimeErrorSafe(Exception):
    """A safe lifecycle failure message that never includes captured process output."""


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str):
        return None


def _child_environment(source: dict[str, str]) -> dict[str, str]:
    allowed = {"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "USERPROFILE", "APPDATA", "HOME", "COMSPEC", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA"}
    return {key: value for key, value in source.items() if key.upper() in allowed}


def _command(runner: Callable[..., Any], args: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None, timeout: int = 240) -> str:
    if args and args[0] == "docker":
        env = _child_environment(env or dict(os.environ))
    try:
        result = runner(args, cwd=cwd, env=env, capture_output=True, text=True, check=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        raise RuntimeErrorSafe("A local rehearsal command failed. Private logs were suppressed; inspect the selected installation before retrying.") from None
    return result.stdout.strip()


def _env_file(path: Path) -> dict[str, str]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        raise RuntimeErrorSafe("A required private rehearsal configuration file could not be read.") from None
    values: dict[str, str] = {}
    for line in lines:
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or not value or any(char in value for char in "\r\n\0"):
            raise RuntimeErrorSafe("A private rehearsal configuration file has an invalid entry.")
        if key in values:
            raise RuntimeErrorSafe("A private rehearsal configuration file contains a duplicate entry.")
        values[key] = value
    return values


def _verify_env(state: dict[str, Any], private: Any, auth: dict[str, str], vmms: dict[str, str]) -> None:
    if not isinstance(private, dict) or private.get("installationId") != state["installationId"] or private.get("instanceSlug") != state["instanceSlug"]:
        raise RuntimeErrorSafe("Private configuration does not belong to the selected installation.")
    expected_auth = {
        "ROLE_FIXTURE_INSTANCE": state["instanceSlug"],
        "ROLE_FIXTURE_POSTGRES_DB": "keycloak_fixture",
        "ROLE_FIXTURE_POSTGRES_USER": f"kc_role_{state['instanceSlug']}",
        "ROLE_FIXTURE_POSTGRES_PASSWORD": private.get("identityDatabasePassword"),
        "ROLE_FIXTURE_ADMIN_USERNAME": private.get("identityAdminUsername"),
        "ROLE_FIXTURE_ADMIN_PASSWORD": private.get("identityAdminPassword"),
        "ROLE_FIXTURE_KEYCLOAK_PORT": str(state["authPort"]),
    }
    expected_vmms = {
        "VMMS_ROLE_FIXTURE_INSTANCE": state["instanceSlug"],
        "VMMS_ROLE_DATABASE": state["databaseName"],
        "VMMS_ROLE_DATABASE_USER": "vmms_role_fixture_owner",
        "VMMS_ROLE_DATABASE_PASSWORD": private.get("databasePassword"),
        "VMMS_ROLE_DATABASE_PORT": str(state["vmmsDatabasePort"]),
        "VMMS_ROLE_DATABASE_VOLUME": state["databaseVolume"],
    }
    if auth != expected_auth or vmms != expected_vmms:
        raise RuntimeErrorSafe("Private configuration does not match the selected installation's service markers.")
    for key in ("clientSecret", "sessionSecret", "identityAdminPassword", "identityDatabasePassword", "databasePassword"):
        if not isinstance(private.get(key), str) or len(private[key]) < 32:
            raise RuntimeErrorSafe("Private rehearsal credentials are incomplete.")


def _project_containers(runner: Callable[..., Any], project: str) -> list[str]:
    raw = _command(runner, ["docker", "ps", "--all", "--quiet", "--no-trunc", "--filter", f"label=com.docker.compose.project={project}"])
    return [item for item in raw.splitlines() if re.fullmatch(r"[a-f0-9]{12,64}", item, re.I)]


def _project_volumes(runner: Callable[..., Any], project: str) -> list[str]:
    raw = _command(runner, ["docker", "volume", "ls", "--quiet", "--filter", f"label=com.docker.compose.project={project}"])
    return [item for item in raw.splitlines() if item]


def _verify_owned_volume(runner: Callable[..., Any], project: str, volume: str) -> None:
    if _project_volumes(runner, project) != [volume]:
        raise RuntimeErrorSafe("The rehearsal volume set does not match this installation.")
    details = _command(runner, ["docker", "volume", "inspect", "--format", "{{.Name}}|{{index .Labels \"com.docker.compose.project\"}}|{{index .Labels \"com.docker.compose.volume\"}}", volume], timeout=15)
    fields = details.split("|")
    expected_compose_volume = "role_fixture_auth_db" if project.startswith("rg-auth-role-") else "role_rehearsal_data"
    if len(fields) != 3 or fields[0] != volume or fields[1] != project or fields[2] != expected_compose_volume:
        raise RuntimeErrorSafe("The rehearsal volume ownership labels do not match this installation.")


def _ensure_empty_start(runner: Callable[..., Any], project: str, volume: str, runtime: dict[str, Any] | None) -> None:
    containers = _project_containers(runner, project)
    if runtime is None:
        if containers:
            raise RuntimeErrorSafe("A container already uses this rehearsal project without a matching runtime record; no existing service was changed.")
        if _project_volumes(runner, project):
            raise RuntimeErrorSafe("A volume already uses this rehearsal project without a matching runtime record; no existing data was changed.")
        raw = _command(runner, ["docker", "volume", "ls", "--quiet", "--filter", f"name=^{volume}$"])
        if raw:
            raise RuntimeErrorSafe("A volume already uses this rehearsal name without a matching runtime record; no existing data was changed.")
        return
    recorded = runtime.get("containers", {}).get(project) if isinstance(runtime.get("containers"), dict) else None
    if not isinstance(recorded, list) or set(containers) != set(recorded):
        raise RuntimeErrorSafe("The recorded rehearsal containers differ from Docker; no service was changed.")
    _verify_owned_volume(runner, project, volume)


def _compose_up(runner: Callable[..., Any], auth_root: Path, compose_file: Path, env_file: Path, project: str) -> None:
    _command(runner, ["docker", "compose", "--env-file", str(env_file), "--project-name", project, "--file", str(compose_file), "up", "--detach", "--wait", "--wait-timeout", "900"], cwd=auth_root, timeout=960)


def _assert_local_docker(runner: Callable[..., Any]) -> None:
    host = _command(runner, ["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], timeout=15)
    if not (host.startswith("npipe://") or host.startswith("unix://")):
        raise RuntimeErrorSafe("Docker is not using a local named-pipe or Unix-socket engine; refusing to create a rehearsal on a remote host.")


def _assert_ports_free(ports: list[int]) -> None:
    for port in ports:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
                listener.bind(("127.0.0.1", port))
        except OSError:
            raise RuntimeErrorSafe("A required rehearsal loopback port is already in use; no service was started.") from None


def _inspect_owned(runner: Callable[..., Any], project: str, instance: str, services: set[str], marker_label: str, expected_images: dict[str, str], *, expected_volume: str, published_ports: dict[str, tuple[str, int] | None], allow_starting: bool = False) -> list[str]:
    ids = _project_containers(runner, project)
    if len(ids) != len(services):
        raise RuntimeErrorSafe("The rehearsal service set is incomplete or contains unexpected containers.")
    seen: set[str] = set()
    for container_id in ids:
        details = _command(runner, ["docker", "inspect", "--format", "{{.Id}}|{{.Config.Image}}|{{.State.Running}}|{{.State.Health.Status}}|{{index .Config.Labels \"com.docker.compose.project\"}}|{{index .Config.Labels \"com.docker.compose.service\"}}|{{index .Config.Labels \"" + marker_label + "\"}}|{{json .NetworkSettings.Ports}}|{{json .Mounts}}", container_id], timeout=15)
        fields = details.split("|")
        if len(fields) != 9:
            raise RuntimeErrorSafe("A rehearsal container could not be verified safely.")
        full_id, image, running, health, actual_project, service, marker, ports_raw, mounts_raw = fields
        if not re.fullmatch(r"[a-f0-9]{64}", full_id, re.I):
            raise RuntimeErrorSafe("A rehearsal container ID could not be verified safely.")
        allowed_health = {"healthy", "starting"} if allow_starting else {"healthy"}
        if actual_project != project or marker != instance or service not in services or service in seen or image != expected_images[service] or running != "true" or health not in allowed_health:
            raise RuntimeErrorSafe("A rehearsal container's ownership, image, or health does not match the selected installation.")
        try:
            ports = json.loads(ports_raw)
            mounts = json.loads(mounts_raw)
        except json.JSONDecodeError:
            raise RuntimeErrorSafe("A rehearsal container's network or volume details could not be verified.") from None
        if not isinstance(ports, dict) or not isinstance(mounts, list):
            raise RuntimeErrorSafe("A rehearsal container's network or volume details could not be verified.")
        bound = [(name, binding) for name, bindings in ports.items() if bindings for binding in bindings]
        if service == "postgres":
            published_port = published_ports.get(service)
            if published_port is None and bound:
                raise RuntimeErrorSafe("The identity database unexpectedly exposes a host port.")
            if published_port is not None and (len(bound) != 1 or bound[0][0] != "5432/tcp" or bound[0][1].get("HostIp") != "127.0.0.1" or bound[0][1].get("HostPort") != str(published_port[1])):
                raise RuntimeErrorSafe("The rehearsal database host binding is not the expected loopback address and port.")
            if len(mounts) != 1 or mounts[0].get("Type") != "volume" or mounts[0].get("Name") != expected_volume or mounts[0].get("Destination") != "/var/lib/postgresql":
                raise RuntimeErrorSafe("The rehearsal database is not using its exact owned data volume.")
        elif service == "keycloak":
            published_port = published_ports.get(service)
            if len(bound) != 1 or bound[0][0] != "8080/tcp" or bound[0][1].get("HostIp") != "127.0.0.1" or bound[0][1].get("HostPort") != str(published_port[1] if published_port else "") or mounts:
                raise RuntimeErrorSafe("The identity provider is not isolated on the expected loopback port.")
        seen.add(service)
        ids[ids.index(container_id)] = full_id
    if seen != services:
        raise RuntimeErrorSafe("A required rehearsal service is missing.")
    return ids


def _write_runtime(path: Path, value: dict[str, Any]) -> None:
    if path.exists() or path.is_symlink():
        current = lifecycle._read_json(path)
        immutable_keys = ("schemaVersion", "installationId", "instanceSlug", "authComposeProject", "vmmsComposeProject", "authDatabaseVolume", "vmmsDatabaseVolume")
        if not isinstance(current, dict) or any(current.get(key) != value.get(key) for key in immutable_keys):
            raise RuntimeErrorSafe("The existing runtime record belongs to a different rehearsal; refusing to replace it.")
        old_containers = current.get("containers", {})
        new_containers = value.get("containers", {})
        if not isinstance(old_containers, dict) or not isinstance(new_containers, dict) or any(key in new_containers and new_containers[key] != old_containers.get(key) for key in old_containers):
            raise RuntimeErrorSafe("The runtime record's container identities changed; refusing to replace it.")
        allowed_phases = {"created", "starting-auth", "auth-healthy", "identity-ready", "starting-vmms", "database-healthy", "prepared", "starting-api", "starting-web", "up", "stopping"}
        if current.get("phase") not in allowed_phases:
            raise RuntimeErrorSafe("The existing runtime record has an unknown lifecycle phase.")
        if value.get("phase") not in allowed_phases:
            raise RuntimeErrorSafe("The new runtime record has an unknown lifecycle phase.")
        old_processes = current.get("processes", {})
        new_processes = value.get("processes", {})
        if not isinstance(old_processes, dict) or not isinstance(new_processes, dict) or any(key in new_processes and new_processes[key] != old_processes.get(key) for key in old_processes):
            raise RuntimeErrorSafe("The runtime process identities changed; refusing to replace them.")
    temporary = path.with_name(f".runtime-{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        if os.name != "nt":
            temporary.chmod(0o600)
        else:
            owner = subprocess.run(["whoami"], capture_output=True, text=True, check=True, timeout=8).stdout.strip()
            subprocess.run(["icacls", str(temporary), "/inheritance:r", "/grant:r", f"{owner}:(R,W)", "NT AUTHORITY\\SYSTEM:(F)", "BUILTIN\\Administrators:(F)"], capture_output=True, text=True, check=True, timeout=8)
        os.replace(temporary, path)
        lifecycle._check_path_acl(path, directory=False)
    except (OSError, subprocess.SubprocessError, lifecycle.FixtureStateError):
        temporary.unlink(missing_ok=True)
        raise RuntimeErrorSafe("The private runtime record could not be securely stored.") from None


def prepare_installation(
    installation_id: str,
    *,
    root: Path | None = None,
    runner: Callable[..., Any] = subprocess.run,
) -> dict[str, Any]:
    installation_id = lifecycle._installation_id(installation_id)
    report = lifecycle.inspect_installation(installation_id, root=root)
    if report["outcome"] == "unsafe":
        raise RuntimeErrorSafe("The selected rehearsal state or access controls are unsafe.")
    if report["outcome"] != "incomplete":
        raise RuntimeErrorSafe("The selected rehearsal is not in a preparable state.")
    if root is None:
        local_data = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
        root = local_data / "VMMS-Role-Rehearsal"
    folder = Path(root) / installation_id
    state = lifecycle._validate_state(lifecycle._read_json(folder / "state.json"), installation_id, folder)
    runtime_path = folder / "runtime.json"
    runtime = lifecycle._read_json(runtime_path) if runtime_path.exists() else None
    if runtime is not None:
        lifecycle._reject_embedded_secrets(runtime)
        if runtime.get("installationId") != installation_id or runtime.get("instanceSlug") != state["instanceSlug"] or runtime.get("authComposeProject") != state["authComposeProject"] or runtime.get("vmmsComposeProject") != state["vmmsComposeProject"]:
            raise RuntimeErrorSafe("The runtime record belongs to a different installation.")
        if not isinstance(runtime.get("containers"), dict):
            raise RuntimeErrorSafe("The runtime container record is invalid.")
    if (folder / "identity-receipt.json").exists() and runtime is None:
        raise RuntimeErrorSafe("An identity receipt exists without a matching runtime record; refusing to reprovision or reset credentials.")

    private = lifecycle._read_json(folder / "private.json")
    auth_env = _env_file(folder / "auth-compose.env")
    vmms_env = _env_file(folder / "vmms-compose.env")
    _verify_env(state, private, auth_env, vmms_env)
    vmms_root = Path(__file__).resolve().parents[2]
    auth_root = vmms_root.parent / "raymond-gray-auth"
    auth_compose = auth_root / "compose.role-fixtures.yaml"
    vmms_compose = vmms_root / "scripts/local-role-fixtures/compose.yaml"
    provisioner = auth_root / "scripts/provision-local-vmms-role-fixture.py"
    if not all(path.is_file() for path in (auth_compose, vmms_compose, provisioner)):
        raise RuntimeErrorSafe("A required local fixture service definition is missing.")

    auth_volume = f"{state['authComposeProject']}_role_fixture_auth_db"
    vmms_ids = [] if runtime is None else runtime.get("containers", {}).get(state["vmmsComposeProject"], [])
    auth_ids = [] if runtime is None else runtime.get("containers", {}).get(state["authComposeProject"], [])
    base_env = _child_environment(dict(os.environ))
    _assert_local_docker(runner)

    auth_images = {"postgres": "postgres:18.1", "keycloak": "quay.io/keycloak/keycloak:26.8.2"}
    vmms_images = {"postgres": "postgres:18.1"}
    auth_marker = "org.raymond-gray.auth.role-fixture"
    vmms_marker = "org.raymond-gray.vmms.role-rehearsal"
    auth_marker_url = {"postgres": None, "keycloak": ("8080/tcp", state["authPort"])}
    vmms_marker_url = {"postgres": ("5432/tcp", state["vmmsDatabasePort"])}

    def reconcile_project(project: str, volume: str, marker_label: str, services: set[str], images: dict[str, str], ports: dict[str, tuple[str, int] | None], recorded_ids: list[str]) -> list[str]:
        if recorded_ids:
            _ensure_empty_start(runner, project, volume, journal if "journal" in locals() else runtime)
            verified_ids = _inspect_owned(runner, project, state["instanceSlug"], services, marker_label, images, expected_volume=volume, published_ports=ports)
            if set(verified_ids) != set(recorded_ids):
                raise RuntimeErrorSafe("The recorded container IDs differ from live Docker resources.")
            return verified_ids
        found = _project_containers(runner, project)
        found_volumes = _project_volumes(runner, project)
        exact_volume_exists = bool(_command(runner, ["docker", "volume", "ls", "--quiet", "--filter", f"name=^{volume}$"]))
        if not found and not found_volumes and not exact_volume_exists:
            return []
        if found:
            verified_ids = _inspect_owned(runner, project, state["instanceSlug"], services, marker_label, images, expected_volume=volume, published_ports=ports, allow_starting=True)
            _verify_owned_volume(runner, project, volume)
            return verified_ids
        if found_volumes:
            _verify_owned_volume(runner, project, volume)
        elif exact_volume_exists:
            raise RuntimeErrorSafe("A volume with the selected name has no matching ownership labels; no service was changed.")
        return []

    if runtime is not None and not auth_ids and runtime.get("phase") not in {"created", "starting-auth"}:
        raise RuntimeErrorSafe("The auth container record is missing after the auth startup phase.")
    if runtime is not None and not vmms_ids and runtime.get("phase") not in {"created", "starting-auth", "auth-healthy", "identity-ready", "starting-vmms"}:
        raise RuntimeErrorSafe("The database container record is missing after the database startup phase.")

    journal = runtime or {
        "schemaVersion": 1,
        "installationId": installation_id,
        "instanceSlug": state["instanceSlug"],
        "authComposeProject": state["authComposeProject"],
        "vmmsComposeProject": state["vmmsComposeProject"],
        "authDatabaseVolume": auth_volume,
        "vmmsDatabaseVolume": state["databaseVolume"],
        "containers": {},
        "phase": "created",
    }
    auth_ids = reconcile_project(state["authComposeProject"], auth_volume, auth_marker, {"postgres", "keycloak"}, auth_images, auth_marker_url, auth_ids)
    vmms_ids = reconcile_project(state["vmmsComposeProject"], state["databaseVolume"], vmms_marker, {"postgres"}, vmms_images, vmms_marker_url, vmms_ids)
    if auth_ids:
        journal["containers"][state["authComposeProject"]] = auth_ids
    if vmms_ids:
        journal["containers"][state["vmmsComposeProject"]] = vmms_ids
    if not runtime and not auth_ids:
        journal["phase"] = "starting-auth"
    _write_runtime(runtime_path, journal)
    ports_to_check = []
    if not auth_ids:
        ports_to_check.append(state["authPort"])
    if not vmms_ids:
        ports_to_check.append(state["vmmsDatabasePort"])
    _assert_ports_free(ports_to_check)
    if auth_ids:
        _inspect_owned(runner, state["authComposeProject"], state["instanceSlug"], {"postgres", "keycloak"}, auth_marker, auth_images,
            expected_volume=auth_volume, published_ports=auth_marker_url)
    _compose_up(runner, auth_root, auth_compose, folder / "auth-compose.env", state["authComposeProject"])
    journal["containers"][state["authComposeProject"]] = _inspect_owned(
        runner, state["authComposeProject"], state["instanceSlug"], {"postgres", "keycloak"},
        auth_marker, auth_images,
        expected_volume=auth_volume, published_ports=auth_marker_url,
    )
    _ensure_empty_start(runner, state["authComposeProject"], auth_volume, journal)
    journal["phase"] = "auth-healthy"
    _write_runtime(runtime_path, journal)

    identity_env = dict(base_env)
    identity_env.update({
        "RG_FIXTURE_ISSUER": state["issuer"],
        "RG_FIXTURE_REALM": state["realm"],
        "RG_FIXTURE_CLIENT_SECRET": private["clientSecret"],
        "RG_FIXTURE_ADMIN_USERNAME": private["identityAdminUsername"],
        "RG_FIXTURE_ADMIN_PASSWORD": private["identityAdminPassword"],
    })
    receipt_path = folder / "identity-receipt.json"
    if not receipt_path.exists():
        _command(runner, [sys.executable, str(provisioner), "--manifest", str(folder / "identity-request.json"), "--credentials-file", str(folder / "identity-credentials.json"), "--receipt", str(receipt_path)], cwd=auth_root, env=identity_env, timeout=180)
    receipt = lifecycle._read_json(receipt_path)
    lifecycle._validate_identity_receipt(receipt, state, installation_id)
    journal["phase"] = "identity-ready"
    _write_runtime(runtime_path, journal)

    if vmms_ids:
        _inspect_owned(runner, state["vmmsComposeProject"], state["instanceSlug"], {"postgres"}, vmms_marker, vmms_images,
            expected_volume=state["databaseVolume"], published_ports=vmms_marker_url)
    _compose_up(runner, vmms_root, vmms_compose, folder / "vmms-compose.env", state["vmmsComposeProject"])
    journal["containers"][state["vmmsComposeProject"]] = _inspect_owned(
        runner, state["vmmsComposeProject"], state["instanceSlug"], {"postgres"},
        vmms_marker, vmms_images,
        expected_volume=state["databaseVolume"], published_ports=vmms_marker_url,
    )
    _ensure_empty_start(runner, state["vmmsComposeProject"], state["databaseVolume"], journal)
    journal["phase"] = "database-healthy"
    _write_runtime(runtime_path, journal)
    vmms_database_url = f"postgresql://{vmms_env['VMMS_ROLE_DATABASE_USER']}:{vmms_env['VMMS_ROLE_DATABASE_PASSWORD']}@127.0.0.1:{state['vmmsDatabasePort']}/{state['databaseName']}"
    database_probe = "import pg from 'pg'; const p=new pg.Pool({connectionString:process.env.VMMS_ROLE_FIXTURE_DATABASE_URL,max:1,connectionTimeoutMillis:5000}); try { const r=await p.query('SELECT current_database() AS name, oid::text AS oid FROM pg_database WHERE datname=current_database()'); process.stdout.write(JSON.stringify(r.rows[0])); } finally { await p.end(); }"
    probe_env = dict(base_env, VMMS_ROLE_FIXTURE_DATABASE_URL=vmms_database_url)
    try:
        identity = json.loads(_command(runner, ["node", "--input-type=module", "-e", database_probe], cwd=vmms_root, env=probe_env, timeout=20))
    except (json.JSONDecodeError, TypeError):
        raise RuntimeErrorSafe("The isolated rehearsal database identity could not be verified.") from None
    if identity.get("name") != state["databaseName"] or not re.fullmatch(r"[1-9][0-9]{0,9}", str(identity.get("oid", ""))):
        raise RuntimeErrorSafe("The isolated rehearsal database name or identity is unexpected.")

    seed_env = dict(base_env)
    seed_env.update({
        "NODE_ENV": "development",
        "VMMS_ROLE_FIXTURE_ENABLED": "true",
        "VMMS_ROLE_FIXTURE_INSTALLATION_ID": installation_id,
        "VMMS_ROLE_FIXTURE_INSTANCE": state["instanceSlug"],
        "VMMS_ROLE_FIXTURE_DATABASE_URL": vmms_database_url,
        "VMMS_ROLE_FIXTURE_DATABASE_NAME": state["databaseName"],
        "VMMS_ROLE_FIXTURE_DATABASE_OID": str(identity["oid"]),
        "VMMS_ROLE_FIXTURE_DATABASE_CONTAINER_ID": journal["containers"][state["vmmsComposeProject"]][0],
        "VMMS_ROLE_FIXTURE_DATABASE_VOLUME": state["databaseVolume"],
        "VMMS_ROLE_FIXTURE_DATABASE_PORT": str(state["vmmsDatabasePort"]),
        "VMMS_ROLE_FIXTURE_CALLBACK_URL": state["callbackUri"],
        "VMMS_ROLE_FIXTURE_WEB_ORIGIN": state["webOrigin"],
        "VMMS_ROLE_FIXTURE_ISSUER": state["issuer"],
        "VMMS_ROLE_FIXTURE_IDENTITY_RECEIPT": str(receipt_path),
        "MIGRATION_DATABASE_URL": vmms_database_url,
    })
    _command(runner, ["node", "--import", "tsx", "apps/api/scripts/prepare-local-role-fixture.ts"], cwd=vmms_root, env=seed_env, timeout=300)
    journal["databaseName"] = identity["name"]
    journal["databaseOid"] = str(identity["oid"])
    journal["phase"] = "prepared"
    _write_runtime(runtime_path, journal)
    return {"installationId": installation_id, "outcome": "prepared", "phase": "prepared", "containerCount": sum(len(items) for items in journal["containers"].values())}


def verify_prepared_installation(
    installation_id: str,
    *,
    root: Path | None = None,
    runner: Callable[..., Any] = subprocess.run,
) -> dict[str, Any]:
    installation_id = lifecycle._installation_id(installation_id)
    if root is None:
        local_data = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
        root = local_data / "VMMS-Role-Rehearsal"
    folder = Path(root) / installation_id
    base = lifecycle.inspect_installation(installation_id, root=root)
    if base["outcome"] == "unsafe":
        raise RuntimeErrorSafe("The selected rehearsal state or access controls are unsafe.")
    state = lifecycle._validate_state(lifecycle._read_json(folder / "state.json"), installation_id, folder)
    runtime = lifecycle._read_json(folder / "runtime.json")
    if not isinstance(runtime, dict) or runtime.get("phase") not in {"prepared", "starting-api", "starting-web", "up", "stopping"} or runtime.get("installationId") != installation_id:
        raise RuntimeErrorSafe("The local identity and database rehearsal has not completed preparation.")
    containers = runtime.get("containers")
    if not isinstance(containers, dict):
        raise RuntimeErrorSafe("The runtime container record is invalid.")
    private = lifecycle._read_json(folder / "private.json")
    vmms_env = _env_file(folder / "vmms-compose.env")
    _assert_local_docker(runner)
    auth_project = state["authComposeProject"]
    vmms_project = state["vmmsComposeProject"]
    auth_volume = runtime.get("authDatabaseVolume")
    if auth_volume != f"{auth_project}_role_fixture_auth_db":
        raise RuntimeErrorSafe("The recorded identity database volume does not match the selected installation.")
    _ensure_empty_start(runner, auth_project, auth_volume, runtime)
    _ensure_empty_start(runner, vmms_project, state["databaseVolume"], runtime)
    auth_ids = _inspect_owned(runner, auth_project, state["instanceSlug"], {"postgres", "keycloak"},
        "org.raymond-gray.auth.role-fixture", {"postgres": "postgres:18.1", "keycloak": "quay.io/keycloak/keycloak:26.8.2"},
        expected_volume=auth_volume, published_ports={"postgres": None, "keycloak": ("8080/tcp", state["authPort"])})
    vmms_ids = _inspect_owned(runner, vmms_project, state["instanceSlug"], {"postgres"},
        "org.raymond-gray.vmms.role-rehearsal", {"postgres": "postgres:18.1"},
        expected_volume=state["databaseVolume"], published_ports={"postgres": ("5432/tcp", state["vmmsDatabasePort"])})
    if set(auth_ids) != set(containers.get(auth_project, [])) or set(vmms_ids) != set(containers.get(vmms_project, [])):
        raise RuntimeErrorSafe("The live container IDs differ from the private runtime record.")

    try:
        issuer_url = f"{state['issuer']}/.well-known/openid-configuration"
        with build_opener(_NoRedirect()).open(issuer_url, timeout=8) as response:
            discovery = json.loads(response.read(32_000))
    except Exception:
        raise RuntimeErrorSafe("The isolated identity provider discovery endpoint did not respond safely.") from None
    if discovery.get("issuer", "").rstrip("/") != state["issuer"].rstrip("/"):
        raise RuntimeErrorSafe("The identity provider returned an unexpected issuer.")

    vmms_root = Path(__file__).resolve().parents[2]
    database_url = f"postgresql://{vmms_env['VMMS_ROLE_DATABASE_USER']}:{vmms_env['VMMS_ROLE_DATABASE_PASSWORD']}@127.0.0.1:{state['vmmsDatabasePort']}/{state['databaseName']}"
    probe = "import pg from 'pg'; const p=new pg.Pool({connectionString:process.env.VMMS_ROLE_FIXTURE_DATABASE_URL,max:1,connectionTimeoutMillis:5000}); try { const r=await p.query(`SELECT current_database() AS name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,(SELECT count(*)::int FROM staff_users WHERE active) AS staff,(SELECT count(*)::int FROM staff_role_placements WHERE state='active') AS placements,(SELECT count(*)::int FROM staff_authority_grants) AS grants,(SELECT count(*)::int FROM staff_identities) AS identities`); process.stdout.write(JSON.stringify(r.rows[0])); } finally { await p.end(); }"
    try:
        counts = json.loads(_command(runner, ["node", "--input-type=module", "-e", probe], cwd=vmms_root, env=dict(_child_environment(dict(os.environ)), VMMS_ROLE_FIXTURE_DATABASE_URL=database_url), timeout=20))
    except (json.JSONDecodeError, TypeError):
        raise RuntimeErrorSafe("The isolated rehearsal records could not be verified.") from None
    personas = lifecycle._read_json(Path(__file__).with_name("personas.json"))
    expected_staff = len(personas["staff"])
    expected_placements = sum(len(persona["placements"]) for persona in personas["staff"])
    if counts.get("name") != runtime.get("databaseName") or str(counts.get("oid")) != str(runtime.get("databaseOid")):
        raise RuntimeErrorSafe("The live database name or OID differs from the private runtime record.")
    if int(counts.get("staff", -1)) != expected_staff or int(counts.get("identities", -1)) != expected_staff or int(counts.get("placements", -1)) != expected_placements or int(counts.get("grants", -1)) != 0:
        raise RuntimeErrorSafe("The isolated role account, placement, identity, or authority-grant counts do not match the approved rehearsal manifest.")
    app_status = "not-started"
    if runtime.get("phase") == "up":
        processes = runtime.get("processes")
        node = shutil.which("node")
        if not isinstance(processes, dict) or not node or not isinstance(runtime.get("apiPort"), int) or not isinstance(runtime.get("webPort"), int):
            raise RuntimeErrorSafe("The VMMS web and API runtime record is incomplete.")
        node = str(Path(node).resolve())
        api_script = str((Path(__file__).resolve().parents[2] / "apps/api/src/server.ts").resolve())
        web_script = str((Path(__file__).resolve().parents[2] / "node_modules/vite/bin/vite.js").resolve())
        api_running = _check_recorded_app_process("api", processes.get("api"), node_executable=node, script_marker=api_script, port=runtime["apiPort"])
        web_running = _check_recorded_app_process("web", processes.get("web"), node_executable=node, script_marker=web_script, port=runtime["webPort"])
        if not api_running or not web_running:
            raise RuntimeErrorSafe("The VMMS web app or API process is no longer running; run the local fixture up command to resume it.")
        app_status = "running"
    elif runtime.get("phase") in {"starting-api", "starting-web"}:
        app_status = "starting"
    return {
        "installationId": installation_id,
        "outcome": "verified",
        "checks": [
            {"name": "identity-provider", "status": "healthy", "issuer": state["issuer"]},
            {"name": "database", "status": "healthy", "databaseName": counts["name"], "databaseOid": counts["oid"]},
            {"name": "staff-identities", "status": "verified", "count": expected_staff},
            {"name": "role-placements", "status": "verified", "count": expected_placements},
            {"name": "operational-authority-grants", "status": "none"},
            {"name": "web-and-api", "status": app_status},
        ],
        "message": "Identity, database, web app, and API are running." if app_status == "running" else ("Identity and database services are ready; VMMS web and API startup is in progress." if app_status == "starting" else "Identity and database services are ready. The VMMS web app and API have not been started yet."),
    }


def _process_information(pid: int) -> dict[str, str] | None:
    if os.name != "nt":
        try:
            raw = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace").strip()
            executable = Path(f"/proc/{pid}/exe").resolve()
            started = str(Path(f"/proc/{pid}").stat().st_ctime_ns)
            return {"commandLine": raw, "executablePath": str(executable), "creationMarker": started}
        except OSError:
            return None
    script = f'$p=Get-CimInstance Win32_Process -Filter "ProcessId = {pid}"; if($p){{[pscustomobject]@{{commandLine=$p.CommandLine;executablePath=$p.ExecutablePath;creationMarker=$p.CreationDate}}|ConvertTo-Json -Compress}}'
    try:
        result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, text=True, check=True, timeout=12, env=_child_environment(dict(os.environ)))
        value = json.loads(result.stdout) if result.stdout.strip() else None
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        raise RuntimeErrorSafe("The local VMMS process identity could not be verified.") from None
    if value is None:
        return None
    if not isinstance(value, dict) or not all(isinstance(value.get(key), str) for key in ("commandLine", "executablePath", "creationMarker")):
        raise RuntimeErrorSafe("The local VMMS process identity response is invalid.")
    return value


def _check_recorded_app_process(name: str, record: Any, *, node_executable: str, script_marker: str, port: int) -> bool:
    if not isinstance(record, dict) or not isinstance(record.get("pid"), int) or isinstance(record.get("pid"), bool):
        raise RuntimeErrorSafe(f"The recorded {name} process identity is invalid.")
    current = _process_information(record["pid"])
    if current is None:
        return False
    command = current["commandLine"].replace("/", "\\").casefold()
    marker = script_marker.replace("/", "\\").casefold()
    if (current["executablePath"].casefold() != node_executable.casefold()
        or current["creationMarker"] != record.get("creationMarker")
        or marker not in command
        or current.get("creationMarker") is None):
        raise RuntimeErrorSafe(f"The process recorded as {name} is no longer the original VMMS service; it was left untouched.")
    response = _http_status(port, "/" if name == "web" else "/api/v1/session")
    if response is None:
        raise RuntimeErrorSafe(f"The recorded {name} process is not serving on its assigned local port.")
    return True


def _http_status(port: int, path: str) -> int | None:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
    try:
        connection.request("GET", path, headers={"Connection": "close"})
        return connection.getresponse().status
    except OSError:
        return None
    finally:
        connection.close()


def _private_log(folder: Path, name: str) -> tuple[Path, Any]:
    path = folder / f"{name}-{uuid.uuid4().hex}.log"
    try:
        stream = path.open("xb")
        if os.name != "nt":
            path.chmod(0o600)
        else:
            owner = subprocess.run(["whoami"], capture_output=True, text=True, check=True, timeout=8).stdout.strip()
            subprocess.run(["icacls", str(path), "/inheritance:r", "/grant:r", f"{owner}:(R,W)", "NT AUTHORITY\\SYSTEM:(F)", "BUILTIN\\Administrators:(F)"], capture_output=True, text=True, check=True, timeout=8)
        lifecycle._check_path_acl(path, directory=False)
        return path, stream
    except (OSError, subprocess.SubprocessError, lifecycle.FixtureStateError):
        path.unlink(missing_ok=True)
        raise RuntimeErrorSafe("A private VMMS service log could not be created securely.") from None


def _start_node(node: str, command: list[str], *, cwd: Path, environment: dict[str, str], log_path: Path, stream: Any) -> dict[str, Any]:
    if os.name == "nt":
        flags = getattr(subprocess, "DETACHED_PROCESS", 0x00000008) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200) | getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
        process = subprocess.Popen([node, *command], cwd=cwd, env=environment, stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT, close_fds=True, creationflags=flags)
    else:
        process = subprocess.Popen([node, *command], cwd=cwd, env=environment, stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT, close_fds=True, start_new_session=True)
    stream.close()
    record = {"pid": process.pid, "creationMarker": "", "executablePath": node, "scriptMarker": command[-1], "logPath": str(log_path)}
    for _ in range(50):
        if process.poll() is not None:
            raise RuntimeErrorSafe("A local VMMS process exited during startup; its private log and state were preserved.")
        identity = _process_information(process.pid)
        if identity:
            if identity["executablePath"].casefold() != node.casefold():
                raise RuntimeErrorSafe("A local VMMS process started from an unexpected executable.")
            record["creationMarker"] = identity["creationMarker"]
            return record
        time.sleep(0.1)
    raise RuntimeErrorSafe("A local VMMS process did not become observable after startup.")


def up_installation(installation_id: str, *, root: Path | None = None) -> dict[str, Any]:
    installation_id = lifecycle._installation_id(installation_id)
    if root is None:
        local_data = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
        root = local_data / "VMMS-Role-Rehearsal"
    folder = Path(root) / installation_id
    verify = verify_prepared_installation(installation_id, root=root)
    runtime_path = folder / "runtime.json"
    journal = lifecycle._read_json(runtime_path)
    if journal.get("phase") not in {"prepared", "starting-api", "starting-web", "up"}:
        raise RuntimeErrorSafe("The local rehearsal is not ready to start its VMMS app.")
    node = shutil.which("node")
    if not node:
        raise RuntimeErrorSafe("Node.js is unavailable in the local environment.")
    node = str(Path(node).resolve())
    vmms_root = Path(__file__).resolve().parents[2]
    api_script = vmms_root / "apps/api/src/server.ts"
    vite_script = vmms_root / "node_modules/vite/bin/vite.js"
    if not api_script.is_file() or not vite_script.is_file():
        raise RuntimeErrorSafe("The VMMS API or web development entry point is missing.")
    processes = journal.get("processes") if isinstance(journal.get("processes"), dict) else {}
    if processes:
        if "api" in processes:
            api_live = _check_recorded_app_process("api", processes["api"], node_executable=node, script_marker=str(api_script), port=journal.get("apiPort", 0))
        else:
            api_live = False
        if "web" in processes:
            web_live = _check_recorded_app_process("web", processes["web"], node_executable=node, script_marker=str(vite_script), port=journal.get("webPort", 0))
        else:
            web_live = False
        if api_live and web_live:
            return {"installationId": installation_id, "outcome": "up", "webOrigin": journal["webOrigin"], "apiPort": journal["apiPort"], "processCount": 2}
        missing = [name for name, is_live in (("api", api_live), ("web", web_live)) if name in processes and not is_live]
        for name in missing:
            processes.pop(name, None)
        if missing:
            journal["processes"] = processes
            journal["phase"] = "starting-api" if "api" in missing else "starting-web"
            _write_runtime(runtime_path, journal)
    else:
        journal["processes"] = {}

    state = lifecycle._validate_state(lifecycle._read_json(folder / "state.json"), installation_id, folder)
    private = lifecycle._read_json(folder / "private.json")
    database_url = f"postgresql://vmms_runtime:vmms_runtime_local_development_only@127.0.0.1:{state['vmmsDatabasePort']}/{state['databaseName']}"
    api_environment = _child_environment(dict(os.environ))
    api_environment.update({
        "NODE_ENV": "development", "DATABASE_URL": database_url,
        "SESSION_SECRET": private["sessionSecret"], "WEB_ORIGIN": state["webOrigin"],
        "OIDC_ISSUER": state["issuer"], "OIDC_CLIENT_ID": state["clientId"],
        "OIDC_CLIENT_SECRET": private["clientSecret"], "OIDC_CALLBACK_URL": state["callbackUri"],
        "OIDC_LOGOUT_CALLBACK_URL": f"http://127.0.0.1:{state['apiPort']}/api/v1/auth/oidc/logout/callback",
        "PORT": str(state["apiPort"]), "HOST": "127.0.0.1", "TRUSTED_PROXY_CIDRS": "",
        "STAFF_MESSAGES_ENABLED": "false",
        "VMMS_EVIDENCE_S3_ENDPOINT": "", "VMMS_EVIDENCE_S3_BUCKET": "",
        "VMMS_EVIDENCE_S3_ACCESS_KEY_ID": "", "VMMS_EVIDENCE_S3_SECRET_ACCESS_KEY": "",
        "VMMS_EVIDENCE_S3_REGION": "", "VMMS_EVIDENCE_CLAMAV_HOST": "",
        "VMMS_EVIDENCE_CLAMAV_PORT": "", "VMMS_EVIDENCE_CLAMAV_TIMEOUT_MS": "",
        "VMMS_EVIDENCE_MAX_UPLOAD_BYTES": "", "VMMS_EVIDENCE_ALLOWED_MIME_TYPES": "",
    })
    web_environment = _child_environment(dict(os.environ))
    web_environment.update({"NODE_ENV": "development", "VMMS_WEB_PORT": str(state["webPort"]), "VMMS_API_ORIGIN": f"http://127.0.0.1:{state['apiPort']}"})

    if "api" not in journal["processes"]:
        _assert_ports_free([state["apiPort"]])
        journal["phase"] = "starting-api"
        _write_runtime(runtime_path, journal)
        log_path, stream = _private_log(folder, "api")
        api_command = ["--import", "tsx", str(api_script)]
        journal["processes"]["api"] = _start_node(node, api_command, cwd=vmms_root, environment=api_environment, log_path=log_path, stream=stream)
        journal["apiPort"] = state["apiPort"]
        journal["webOrigin"] = state["webOrigin"]
        journal["webPort"] = state["webPort"]
        _write_runtime(runtime_path, journal)

    api_process = journal["processes"]["api"]
    api_ready = False
    for _ in range(90):
        if _process_information(api_process["pid"]) is None:
            raise RuntimeErrorSafe("The VMMS API stopped before becoming ready; its private log and state were preserved.")
        if _http_status(state["apiPort"], "/api/v1/session") == 200:
            api_ready = True
            break
        time.sleep(1)
    if not api_ready:
        raise RuntimeErrorSafe("The VMMS API did not become ready on its assigned loopback port.")

    if "web" not in journal["processes"]:
        _assert_ports_free([state["webPort"]])
        journal["phase"] = "starting-web"
        _write_runtime(runtime_path, journal)
        log_path, stream = _private_log(folder, "web")
        web_command = [str(vite_script), "--host", "127.0.0.1", "--port", str(state["webPort"]), "--strictPort"]
        journal["processes"]["web"] = _start_node(node, web_command, cwd=vmms_root / "apps/web", environment=web_environment, log_path=log_path, stream=stream)
        _write_runtime(runtime_path, journal)

    web_process = journal["processes"]["web"]
    web_ready = False
    for _ in range(90):
        if _process_information(web_process["pid"]) is None:
            raise RuntimeErrorSafe("The VMMS web app stopped before becoming ready; its private log and state were preserved.")
        if _http_status(state["webPort"], "/") == 200:
            web_ready = True
            break
        time.sleep(1)
    if not web_ready:
        raise RuntimeErrorSafe("The VMMS web app did not become ready on its assigned loopback origin.")
    journal["phase"] = "up"
    _write_runtime(runtime_path, journal)
    return {"installationId": installation_id, "outcome": "up", "webOrigin": state["webOrigin"], "apiPort": state["apiPort"], "processCount": 2, "preparedChecks": verify["checks"]}

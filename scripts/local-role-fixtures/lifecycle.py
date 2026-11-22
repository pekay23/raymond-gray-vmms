"""Read-only status and verification for one private VMMS role rehearsal."""
from __future__ import annotations

import argparse
import json
import os
import re
import stat
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any, Callable



ARTIFACTS = (
    "auth-compose.env",
    "vmms-compose.env",
    "identity-request.json",
    "identity-credentials.json",
    "private.json",
    "login-credentials.txt",
)
SENSITIVE_KEYS = re.compile(r"password|secret|token|credential|private.?key", re.IGNORECASE)
WINDOWS_PRINCIPALS = (
    "nt authority\\system",
    "builtin\\administrators",
    "s-1-5-18",
    "s-1-5-32-544",
)
PERSONA_MANIFEST_PATH = Path(__file__).with_name("personas.json")


class FixtureStateError(Exception):
    """A selected fixture path or its recorded identity is unsafe or inconsistent."""


def _is_reparse_point(path: Path) -> bool:
    if path.is_symlink():
        return True
    is_junction = getattr(path, "is_junction", None)
    return bool(is_junction and is_junction())


def _check_path_acl(path: Path, *, directory: bool, runner: Callable[..., Any] = subprocess.run) -> None:
    """Verify existing access controls without changing them or reading file contents."""
    if os.name != "nt":
        mode = stat.S_IMODE(path.stat().st_mode)
        expected = 0o700 if directory else 0o600
        if mode & 0o777 != expected or mode & 0o7000:
            raise FixtureStateError("A fixture file or folder is accessible to other local users.")
        return

    try:
        owner = runner(["whoami"], capture_output=True, text=True, check=True, timeout=8).stdout.strip().casefold()
        output = runner(["icacls", str(path)], capture_output=True, text=True, check=True, timeout=8).stdout.casefold()
    except (OSError, subprocess.SubprocessError):
        raise FixtureStateError("The fixture access permissions could not be verified.") from None

    _validate_windows_acl(output, owner)


def _validate_windows_acl(output: str, owner: str) -> None:
    output = output.casefold()
    allowed = (owner.casefold(), *WINDOWS_PRINCIPALS)
    entries = [line for line in output.splitlines()[1:] if "(" in line]
    if not entries:
        raise FixtureStateError("The fixture access permissions could not be verified.")
    owner_found = False
    for line in entries:
        principal = line.split("(", 1)[0].strip().casefold().rstrip(":")
        if "(i)" in line or any(word in principal for word in ("everyone", "authenticated users", "\\users")):
            raise FixtureStateError("A fixture file or folder has inherited or broadly shared access.")
        if not any(principal == allowed_name or principal.endswith("\\" + allowed_name) for allowed_name in allowed):
            raise FixtureStateError("A fixture file or folder grants access to an unexpected account.")
        if principal == owner.casefold():
            owner_found = True
    if not owner_found:
        raise FixtureStateError("The current owner has no recorded access to the fixture file or folder.")


def _read_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as stream:
            return json.load(stream)
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise FixtureStateError("A fixture metadata file is missing or invalid.") from None


def _reject_embedded_secrets(value: Any) -> None:
    if isinstance(value, dict):
        if any(SENSITIVE_KEYS.search(str(key)) and not str(key).endswith("Path") for key in value):
            raise FixtureStateError("The public fixture state contains a forbidden sensitive field.")
        for nested in value.values():
            _reject_embedded_secrets(nested)
    elif isinstance(value, list):
        for nested in value:
            _reject_embedded_secrets(nested)


def _safe_file(path: Path, *, directory: bool, acl_check: Callable[..., None]) -> None:
    if _is_reparse_point(path):
        raise FixtureStateError("A fixture file or folder cannot be a symbolic link or junction.")
    try:
        metadata = path.stat(follow_symlinks=False)
    except OSError:
        raise FixtureStateError("A required fixture file or folder is missing.") from None
    if directory and not stat.S_ISDIR(metadata.st_mode):
        raise FixtureStateError("A fixture path is not a folder.")
    if not directory and not stat.S_ISREG(metadata.st_mode):
        raise FixtureStateError("A fixture artifact is not a regular file.")
    acl_check(path, directory=directory)


def _installation_id(value: str) -> str:
    try:
        parsed = str(uuid.UUID(value))
    except (ValueError, AttributeError):
        raise FixtureStateError("Provide the exact installation UUID shown when the fixture was created.") from None
    if parsed != value.lower():
        raise FixtureStateError("The installation UUID must use its canonical form.")
    return parsed


def _validate_state(state: Any, installation_id: str, state_directory: Path) -> dict[str, Any]:
    if not isinstance(state, dict):
        raise FixtureStateError("The public fixture state is invalid.")
    _reject_embedded_secrets(state)
    slug = installation_id.replace("-", "")[:8]
    expected = {
        "schemaVersion": 1,
        "installationId": installation_id,
        "instanceSlug": slug,
        "authComposeProject": f"rg-auth-role-{slug}",
        "vmmsComposeProject": f"vmms-role-{slug}",
        "databaseName": f"vmms_role_rehearsal_{slug}",
        "databaseVolume": f"vmms_role_rehearsal_data_{slug}",
        "realm": f"vmms-role-review-{slug}",
        "clientId": f"vmms-role-review-{slug}",
    }
    if any(state.get(key) != value for key, value in expected.items()):
        raise FixtureStateError("The fixture state markers do not match the selected installation.")

    port_ranges = {
        "authPort": (18180, 18280),
        "authDatabasePort": (58432, 58532),
        "vmmsDatabasePort": (55440, 55540),
        "apiPort": (14100, 14200),
        "webPort": (15173, 15273),
    }
    ports: list[int] = []
    for key, (lower, upper) in port_ranges.items():
        value = state.get(key)
        if not isinstance(value, int) or isinstance(value, bool) or not lower <= value < upper:
            raise FixtureStateError("A fixture port is missing or outside its reserved local range.")
        ports.append(value)
    if len(set(ports)) != len(ports):
        raise FixtureStateError("Fixture services must use distinct local ports.")

    issuer = f"http://127.0.0.1:{state['authPort']}/realms/{expected['realm']}"
    expected_urls = {
        "issuer": issuer,
        "callbackUri": f"http://127.0.0.1:{state['apiPort']}/api/v1/auth/oidc/callback",
        "webOrigin": f"http://127.0.0.1:{state['webPort']}",
    }
    if any(state.get(key) != value for key, value in expected_urls.items()):
        raise FixtureStateError("A fixture identity or application URL does not match its loopback installation.")

    expected_paths = {
        "authManifestPath": "identity-request.json",
        "identityCredentialsPath": "identity-credentials.json",
        "identityReceiptPath": "identity-receipt.json",
        "credentialsGuidePath": "login-credentials.txt",
        "privateConfigPath": "private.json",
    }
    for key, filename in expected_paths.items():
        value = state.get(key)
        if not isinstance(value, str) or Path(value).name.casefold() != filename.casefold():
            raise FixtureStateError("A fixture artifact path does not match the selected installation layout.")
        if Path(value).absolute() != (state_directory / filename).absolute():
            raise FixtureStateError("A fixture artifact path points outside the selected installation.")
    return state


def inspect_installation(
    installation_id: str,
    *,
    root: Path | None = None,
    acl_check: Callable[..., None] = _check_path_acl,
    json_reader: Callable[[Path], Any] = _read_json,
) -> dict[str, Any]:
    """Read fixture metadata only; never load private credentials or contact services."""
    installation_id = _installation_id(installation_id)
    if root is None:
        local_data = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
        root = local_data / "VMMS-Role-Rehearsal"
    root = Path(root)
    selected = root / installation_id
    checks: list[dict[str, str]] = []

    if _is_reparse_point(root):
        raise FixtureStateError("A fixture folder cannot be a symbolic link or junction.")
    if not root.exists():
        return _incomplete(installation_id, [{"name": "installation", "status": "missing"}], "No fixture state was found.")
    _safe_file(root, directory=True, acl_check=acl_check)
    if _is_reparse_point(selected):
        raise FixtureStateError("A fixture folder cannot be a symbolic link or junction.")
    if not selected.exists():
        return _incomplete(installation_id, [{"name": "installation", "status": "missing"}], "The selected fixture installation does not exist.")
    _safe_file(selected, directory=True, acl_check=acl_check)
    state_path = selected / "state.json"
    if _is_reparse_point(state_path):
        raise FixtureStateError("A fixture file cannot be a symbolic link or junction.")
    if not state_path.exists():
        return _incomplete(installation_id, [{"name": "state", "status": "missing"}], "The selected fixture has no state record.")
    _safe_file(state_path, directory=False, acl_check=acl_check)
    state = _validate_state(json_reader(state_path), installation_id, selected)
    checks.append({"name": "state", "status": "verified"})

    artifacts_present = True
    for filename in ARTIFACTS:
        path = selected / filename
        if _is_reparse_point(path):
            raise FixtureStateError("A fixture file cannot be a symbolic link or junction.")
        if not path.exists():
            checks.append({"name": filename, "status": "missing"})
            artifacts_present = False
            continue
        _safe_file(path, directory=False, acl_check=acl_check)
        checks.append({"name": filename, "status": "present-private"})

    receipt_path = selected / "identity-receipt.json"
    identity_status = "missing"
    if _is_reparse_point(receipt_path):
        raise FixtureStateError("A fixture file cannot be a symbolic link or junction.")
    if receipt_path.exists():
        _safe_file(receipt_path, directory=False, acl_check=acl_check)
        receipt = json_reader(receipt_path)
        _validate_identity_receipt(receipt, state, installation_id)
        identity_status = "verified"
    checks.append({"name": "identity-receipt", "status": identity_status})

    runtime_path = selected / "runtime.json"
    runtime_status = "not-recorded"
    if runtime_path.exists():
        _safe_file(runtime_path, directory=False, acl_check=acl_check)
        runtime = json_reader(runtime_path)
        if not isinstance(runtime, dict):
            raise FixtureStateError("The fixture runtime record is invalid.")
        _reject_embedded_secrets(runtime)
        if runtime.get("schemaVersion") != 1 or runtime.get("installationId") != installation_id or runtime.get("instanceSlug") != state["instanceSlug"]:
            raise FixtureStateError("The fixture runtime record belongs to a different installation.")
        if runtime.get("authComposeProject") != state["authComposeProject"] or runtime.get("vmmsComposeProject") != state["vmmsComposeProject"]:
            raise FixtureStateError("The fixture runtime project markers do not match the selected installation.")
        if runtime.get("phase") not in {"created", "starting-auth", "auth-healthy", "identity-ready", "starting-vmms", "database-healthy", "prepared", "starting-api", "starting-web", "up", "stopping"}:
            raise FixtureStateError("The fixture runtime phase is invalid.")
        runtime_status = "recorded"
    checks.append({"name": "runtime", "status": runtime_status})
    message = "Runtime ownership, database identity and service health require live verification before the rehearsal is ready."
    return {
        "installationId": installation_id,
        "outcome": "incomplete",
        "checks": checks,
        "message": message,
    }


def _expected_identity_actor_keys() -> set[str]:
    try:
        manifest = json.loads(PERSONA_MANIFEST_PATH.read_text(encoding="utf-8"))
        staff = manifest.get("staff")
        if not isinstance(staff, list) or not staff or any(not isinstance(persona, dict) for persona in staff):
            raise ValueError
        if not isinstance(manifest.get("owner"), dict):
            raise ValueError
        count = len(staff) + 1
    except (OSError, json.JSONDecodeError, AttributeError, ValueError):
        raise FixtureStateError("The current role persona manifest is invalid.") from None
    return {f"p{index:02d}" for index in range(1, count + 1)}


def _validate_identity_receipt(receipt: Any, state: dict[str, Any], installation_id: str) -> None:
    if not isinstance(receipt, dict):
        raise FixtureStateError("The identity receipt is invalid.")
    _reject_embedded_secrets(receipt)
    if receipt.get("schemaVersion") != 1 or receipt.get("installationId") != installation_id:
        raise FixtureStateError("The identity receipt belongs to a different fixture installation.")
    if not isinstance(receipt.get("issuer"), str) or receipt["issuer"].rstrip("/") != state["issuer"].rstrip("/"):
        raise FixtureStateError("The identity receipt issuer does not match the fixture state.")
    if receipt.get("clientId") != state["clientId"]:
        raise FixtureStateError("The identity receipt client does not match the fixture state.")
    expected_actor_keys = _expected_identity_actor_keys()
    actors = receipt.get("actors")
    if not isinstance(actors, list) or len(actors) != len(expected_actor_keys):
        raise FixtureStateError("The identity receipt must include every current staff persona and the separate owner test identity.")
    keys = [item.get("key") for item in actors if isinstance(item, dict)]
    if len(keys) != len(expected_actor_keys) or set(keys) != expected_actor_keys:
        raise FixtureStateError("The identity receipt has missing or unexpected synthetic actor markers.")
    for item in actors:
        try:
            uuid.UUID(item.get("subject", ""))
        except (ValueError, AttributeError):
            raise FixtureStateError("The identity receipt contains an invalid synthetic subject marker.") from None
    subjects = [item["subject"] for item in actors]
    if len(set(subjects)) != len(subjects):
        raise FixtureStateError("The identity receipt contains duplicate synthetic subject markers.")


def _incomplete(installation_id: str, checks: list[dict[str, str]], message: str) -> dict[str, Any]:
    return {"installationId": installation_id, "outcome": "incomplete", "checks": checks, "message": message}


def main(argv: list[str] | None = None) -> int:
    from runtime import RuntimeErrorSafe, prepare_installation

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "up", "status", "verify"), help="Prepare, start, inspect, or verify one installation")
    parser.add_argument("--installation-id", required=True, help="Exact UUID printed when the local fixture was created")
    args = parser.parse_args(argv)
    try:
        if args.action == "prepare":
            report = prepare_installation(args.installation_id)
        elif args.action == "up":
            from runtime import up_installation

            report = up_installation(args.installation_id)
        elif args.action == "verify":
            from runtime import verify_prepared_installation

            report = verify_prepared_installation(args.installation_id)
        else:
            report = inspect_installation(args.installation_id)
        report["action"] = args.action
    except FixtureStateError as error:
        report = {"installationId": args.installation_id, "action": args.action, "outcome": "unsafe", "checks": [], "message": str(error)}
    except RuntimeErrorSafe as error:
        report = {"installationId": args.installation_id, "action": args.action, "outcome": "incomplete", "checks": [], "message": str(error)}
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    if report["outcome"] in {"verified", "prepared", "up"}:
        return 0
    return 2 if report["outcome"] == "incomplete" else 1


if __name__ == "__main__":
    raise SystemExit(main())

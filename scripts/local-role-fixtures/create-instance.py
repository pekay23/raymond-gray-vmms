"""Create private local configuration for one isolated VMMS role rehearsal."""
from __future__ import annotations

import argparse
import json
import os
import secrets
import socket
import stat
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUTH_ROOT = ROOT.parent / "raymond-gray-auth"
ROLE_NAMES = [
    ("VMMS Operator", "vmms.operator.local"),
    ("Head of Service Centre / Operations Admin", "vmms.head.local"),
    ("EV Team Lead", "vmms.ev-lead.local"),
    ("ICE Team Lead", "vmms.ice-lead.local"),
    ("Supervisor", "vmms.supervisor.local"),
    ("Technician / Engineer / Trainee", "vmms.technician.local"),
    ("Service Advisor", "vmms.advisor.local"),
    ("Quality Inspector", "vmms.inspector.local"),
    ("Parts & Inventory", "vmms.parts.local"),
    ("Warranty / Customer Support", "vmms.warranty.local"),
    ("Finance / Billing", "vmms.finance.local"),
    ("Compliance / Records / HR", "vmms.records.local"),
    ("Sales Representative", "vmms.sales.local"),
    ("PDI Observer", "vmms.pdi.local"),
    ("Approved vehicle owner (invitation exercise)", "vmms.owner.local"),
]


class FixtureError(Exception):
    pass


def _run(command: list[str]) -> str:
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=True, timeout=8)
        return result.stdout
    except (OSError, subprocess.SubprocessError):
        raise FixtureError("Could not establish private local fixture file permissions.") from None


def _restrict_directory(path: Path) -> None:
    if path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()):
        raise FixtureError("The private fixture path cannot be a symbolic link or junction.")
    if os.name == "nt":
        owner = _run(["whoami"]).strip()
        _run(["icacls", str(path), "/inheritance:r", "/grant:r", f"{owner}:(OI)(CI)F", "NT AUTHORITY\\SYSTEM:(OI)(CI)F", "BUILTIN\\Administrators:(OI)(CI)F"])
        _check_acl(path, directory=True)
    else:
        path.chmod(0o700)
        if stat.S_IMODE(path.stat().st_mode) & 0o077:
            raise FixtureError("The private fixture directory is accessible to other users.")


def _check_acl(path: Path, *, directory: bool = False) -> None:
    if os.name != "nt":
        mode = stat.S_IMODE(path.stat().st_mode)
        mask = 0o077 if directory else 0o177
        if mode & mask:
            raise FixtureError("The private fixture path has broad filesystem permissions.")
        return
    owner = _run(["whoami"]).strip().casefold()
    output = _run(["icacls", str(path)]).casefold()
    allowed = (owner, "nt authority\\system", "builtin\\administrators", "s-1-5-18", "s-1-5-32-544")
    for line in output.splitlines()[1:]:
        if "(" not in line:
            continue
        principal = line.split("(", 1)[0].strip().casefold().rstrip(":")
        if "(i)" in line or any(word in principal for word in ("everyone", "authenticated users", "\\users")):
            raise FixtureError("The private fixture path has inherited or broadly shared permissions.")
        if not any(principal == item or principal.endswith("\\" + item) for item in allowed):
            raise FixtureError("The private fixture path grants access to an unexpected account.")


def _private_directory(path: Path) -> None:
    if path.exists():
        raise FixtureError("The rehearsal destination already exists; it will not be reused or overwritten.")
    path.mkdir(parents=True)
    _restrict_directory(path)


def _write_private(path: Path, value: str) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(path, flags, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        path.unlink(missing_ok=True)
        raise
    if os.name == "nt":
        owner = _run(["whoami"]).strip()
        _run(["icacls", str(path), "/inheritance:r", "/grant:r", f"{owner}:(R,W)", "NT AUTHORITY\\SYSTEM:(F)", "BUILTIN\\Administrators:(F)"])
    _check_acl(path)


def _secret(length: int = 48) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_"
    value = [secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ"), secrets.choice("abcdefghijkmnopqrstuvwxyz"), secrets.choice("23456789")]
    value.extend(secrets.choice(alphabet) for _ in range(length - len(value)))
    secrets.SystemRandom().shuffle(value)
    return "".join(value)


def _available_port(start: int, end: int) -> int:
    for port in range(start, end):
        try:
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", port))
                return port
        except OSError:
            continue
    raise FixtureError("No free loopback port is available in the rehearsal port range.")


def _safe_env_value(value: str) -> str:
    if not value or any(char in value for char in "\r\n\0"):
        raise FixtureError("The local fixture configuration value is invalid.")
    return value


def create_instance(instance_id: str | None = None) -> dict[str, str]:
    installation_id = str(uuid.UUID(instance_id)) if instance_id else str(uuid.uuid4())
    slug = installation_id.replace("-", "")[:8]
    local_data = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    root = local_data / "VMMS-Role-Rehearsal"
    if not root.exists():
        root.mkdir()
        _restrict_directory(root)
    else:
        _check_acl(root, directory=True)
    state_dir = root / installation_id
    _private_directory(state_dir)

    auth_port = _available_port(18180, 18280)
    auth_database_port = _available_port(58432, 58532)
    vmms_database_port = _available_port(55440, 55540)
    api_port = _available_port(14100, 14200)
    web_port = _available_port(15173, 15273)
    realm = f"vmms-role-review-{slug}"
    database_name = f"vmms_role_rehearsal_{slug}"
    auth_project = f"rg-auth-role-{slug}"
    vmms_project = f"vmms-role-{slug}"
    database_volume = f"vmms_role_rehearsal_data_{slug}"
    database_password = _secret()
    keycloak_database_password = _secret()
    admin_username = f"fixture-admin-{slug}"
    admin_password = _secret()
    client_secret = _secret(64)
    session_secret = _secret(64)
    fixture_users = []
    fixture_passwords: dict[str, str] = {}
    login_lines = [
        "Local synthetic test accounts",
        f"Installation: {installation_id}",
        "These identities and their credentials are synthetic and work only in this local rehearsal.",
        "Do not reuse them for real accounts.",
        "",
    ]
    for index, (role_name, _username) in enumerate(ROLE_NAMES, start=1):
        slot = f"p{index:02d}"
        username = f"vmms.review.{index:02d}"
        email = f"review{index:02d}@example.test"
        password = _secret(36)
        fixture_users.append({"key": slot, "username": username, "displayName": f"Workshop Rehearsal {index:02d}", "email": email})
        fixture_passwords[slot] = password
        login_lines.extend([role_name, f"  Username: {username}", f"  Password: {password}", ""])

    issuer = f"http://127.0.0.1:{auth_port}/realms/{realm}"
    web_origin = f"http://127.0.0.1:{web_port}"
    callback = f"http://127.0.0.1:{api_port}/api/v1/auth/oidc/callback"
    identity_manifest = {
        "schemaVersion": 1,
        "installationId": installation_id,
        "realm": realm,
        "issuer": issuer,
        "clientId": f"vmms-role-review-{slug}",
        "callbackUri": callback,
        "webOrigin": web_origin,
        "actors": fixture_users,
    }
    credentials = {"actors": fixture_passwords}
    private = {
        "installationId": installation_id,
        "instanceSlug": slug,
        "databasePassword": database_password,
        "identityDatabasePassword": keycloak_database_password,
        "identityAdminUsername": admin_username,
        "identityAdminPassword": admin_password,
        "clientSecret": client_secret,
        "sessionSecret": session_secret,
        "identityCredentials": credentials,
    }
    auth_env = {
        "ROLE_FIXTURE_INSTANCE": slug,
        "ROLE_FIXTURE_POSTGRES_DB": "keycloak_fixture",
        "ROLE_FIXTURE_POSTGRES_USER": f"kc_role_{slug}",
        "ROLE_FIXTURE_POSTGRES_PASSWORD": keycloak_database_password,
        "ROLE_FIXTURE_ADMIN_USERNAME": admin_username,
        "ROLE_FIXTURE_ADMIN_PASSWORD": admin_password,
        "ROLE_FIXTURE_KEYCLOAK_PORT": str(auth_port),
    }
    vmms_env = {
        "VMMS_ROLE_FIXTURE_INSTANCE": slug,
        "VMMS_ROLE_DATABASE": database_name,
        "VMMS_ROLE_DATABASE_USER": "vmms_role_fixture_owner",
        "VMMS_ROLE_DATABASE_PASSWORD": database_password,
        "VMMS_ROLE_DATABASE_PORT": str(vmms_database_port),
        "VMMS_ROLE_DATABASE_VOLUME": database_volume,
    }
    public_state = {
        "schemaVersion": 1,
        "installationId": installation_id,
        "instanceSlug": slug,
        "authComposeProject": auth_project,
        "vmmsComposeProject": vmms_project,
        "authPort": auth_port,
        "authDatabasePort": auth_database_port,
        "vmmsDatabasePort": vmms_database_port,
        "apiPort": api_port,
        "webPort": web_port,
        "databaseName": database_name,
        "databaseVolume": database_volume,
        "realm": realm,
        "issuer": issuer,
        "clientId": identity_manifest["clientId"],
        "callbackUri": callback,
        "webOrigin": web_origin,
        "authManifestPath": str(state_dir / "identity-request.json"),
        "identityCredentialsPath": str(state_dir / "identity-credentials.json"),
        "identityReceiptPath": str(state_dir / "identity-receipt.json"),
        "credentialsGuidePath": str(state_dir / "login-credentials.txt"),
        "privateConfigPath": str(state_dir / "private.json"),
    }
    try:
        _write_private(state_dir / "auth-compose.env", "".join(f"{key}={_safe_env_value(value)}\n" for key, value in auth_env.items()))
        _write_private(state_dir / "vmms-compose.env", "".join(f"{key}={_safe_env_value(value)}\n" for key, value in vmms_env.items()))
        _write_private(state_dir / "identity-request.json", json.dumps(identity_manifest, ensure_ascii=False, indent=2) + "\n")
        _write_private(state_dir / "identity-credentials.json", json.dumps(credentials, ensure_ascii=False) + "\n")
        _write_private(state_dir / "private.json", json.dumps(private, ensure_ascii=False) + "\n")
        _write_private(state_dir / "login-credentials.txt", "\n".join(login_lines))
        _write_private(state_dir / "state.json", json.dumps(public_state, ensure_ascii=False, indent=2) + "\n")
    except Exception:
        # Keep partial state for inspection; never clean up provider/database resources implicitly.
        raise
    return {"installationId": installation_id, "instanceSlug": slug, "stateDirectory": str(state_dir), "stateFile": str(state_dir / "state.json")}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--installation-id", help="Optional new UUID. Existing rehearsal directories are never reused.")
    args = parser.parse_args()
    try:
        result = create_instance(args.installation_id)
        print(f"Created private local role rehearsal {result['instanceSlug']}.")
        print(f"Installation: {result['installationId']}")
        print(f"Private credential guide: {result['stateDirectory']}\\login-credentials.txt")
        print("No containers, identities, database records, invitations or grants were created by this command.")
        print("The owner account remains a credential-only test identity until its real synthetic invitation claim flow is implemented.")
        return 0
    except (FixtureError, ValueError) as error:
        print(f"Role rehearsal setup stopped: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

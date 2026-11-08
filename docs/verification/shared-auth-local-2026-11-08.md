# Shared identity local foundation

Date: 8 November 2026. Scope: isolated local development provider and initial realm policy only.

## Evidence

- Auth repository: `C:\Projects\raymond-gray-auth` (local working tree; no remote or deployment configured).
- `docker compose up -d` started PostgreSQL 18.1 and Keycloak 26.8.2. Keycloak imported `raymond-gray-dev` successfully from the versioned realm file.
- `docker compose down` removed the containers and local network without removing the named PostgreSQL volume; `docker compose up -d` recreated the services. Both services returned healthy, and the existing realm survived without reimporting, demonstrating local database persistence and a clean application-stack teardown/restart.
- The provider binds to `127.0.0.1:8080`; PostgreSQL has no published host port.
- `GET http://localhost:8080/realms/raymond-gray-dev/.well-known/openid-configuration` returned HTTP 200.
- `python scripts/verify-local-realm.py` in the auth repository passed. It queried the local Keycloak Admin API without printing credential or token values and confirmed: registration disabled; brute-force protection enabled; passkeys enabled; RP ID `localhost`; user verification `required`; resident key `required`; authorization and token endpoints advertised; zero application clients.
- Local bootstrap credentials are in the ignored auth repository `.env`; the values were not printed or copied.

## Limits

This report's original scope was provider startup and realm policy only. Later local development evidence supersedes its statement that no application client, passkey ceremony or product callback had been tested: see [`shared-passkey-local-2026-11-08.md`](shared-passkey-local-2026-11-08.md) for passkey enrollment/passwordless login and [`oidc-local-2026-11-08.md`](oidc-local-2026-11-08.md) for the VMMS authorization-code callback/session flow. Google federation, central logout and all production configuration remain unverified. The development provider must not be exposed publicly or used as the production deployment.

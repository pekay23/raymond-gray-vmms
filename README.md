# Raymond Gray VMMS

A new web-first vehicle maintenance and service-centre operations system. The master specification is the functional authority. The user authorised a fresh implementation, one-site launch with future site expansion, saved drafts, approved vehicle-owner access, and a later historical maintenance import.

The product is under construction. Its first engineering slice covers staff identity, site access and reception drafts. It does not establish accepted G1-G5 controls or operational readiness. Follow [the project documentation](docs/README.md), [implementation plan](docs/delivery/implementation-plan.md) and [tracker](docs/delivery/implementation-tracker.md).

Cross-project sign-in is being designed in the separate `C:\Projects\raymond-gray-auth` service. See [shared identity](docs/architecture/shared-identity.md) and [hosting strategy](docs/architecture/hosting-strategy.md). VMMS remains the program source of truth for cross-repository tasks.

## Local development

Use Node 24 or another version allowed by `package.json`, npm, Python 3 for documentation scripts, and Docker Desktop with Linux containers.

1. Run `npm install` from the repository root.
2. Copy `.env.example` to `.env` and generate a random `SESSION_SECRET` of at least 32 characters. Do not add a VMMS application password; web sign-in is delegated to the shared identity service.
3. Start the loopback-only shared identity stack by following the local setup in `C:\Projects\raymond-gray-auth\README.md`.
4. From the auth repository, run `python scripts/register-local-vmms-client.py` and `python scripts/provision-local-vmms-test-user.py`. These create a confidential loopback OIDC client and disposable synthetic user, and write their local credentials only to the ignored VMMS `.env`.
5. Run `docker compose up -d postgres`. It binds the development database only to `127.0.0.1:55432`.
6. Run `npm run db:migrate` to create the local identity mapping tables. Migrations use the owner URL; the API uses the separate `vmms_runtime` non-owner role.
7. Run `npm run dev:seed` to create synthetic site DEV and account `advisor`, then `npm run dev:link-auth` to explicitly link the synthetic identity. No technical or financial grants are seeded.
8. Run `npm run dev:api` and `npm run dev:web` in separate terminals. Open `http://127.0.0.1:5173` and use **Continue to secure sign-in**.

Development database passwords in the example and compose file are deliberately local-only. The API currently refuses production startup while production identity and operational checks remain unfinished.

## Checks

Run `npm run docs:generate` after updating canonical tracker data. `npm run docs:check` rejects invalid references and a stale generated tracker. Run `node scripts/verify.mjs` to record documentation, compiler, build and actual PostgreSQL API-integration results under `docs/verification/checks`. The test fixture creates and removes its own uniquely named synthetic database.

Use `powershell -NoProfile -File scripts/refresh-code-indexes.ps1 -Initial` to create local CodeGraph and Graphify indexes after source exists. The graph script selects Graphify's code-only path without semantic document extraction. Follow `AGENTS.md` before code searches and edits.

Production hosting, private evidence, customer access, full workflows, historical import, restore, UAT and physical-device validation remain tracked work. No deployment is implied by this checkout.

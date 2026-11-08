# Clean workspace verification

Date: 8 November 2026  
Status: partial evidence for F-001; not a completion record.

## Method

Copied the source tree into a new temporary directory without the repository's `.env`, installed `node_modules`, `.git`, CodeGraph index, Graphify output, or build output. Installed from the copied `package-lock.json` with `npm ci`. The temporary directory was not a Git checkout because the source repository currently has no commits. Later, a temporary `.env` was created only from `.env.example`, with dummy local identity values and isolated loopback ports. The API integration suite used only its existing disposable PostgreSQL fixtures and synthetic data.

## Results

- `npm ci` installed 167 packages and reported zero known vulnerabilities. npm reported that the `esbuild` install script had not been explicitly approved; the installed binary responds as version 0.28.2 and the build completes.
- `npm run docs:check`, `npm run typecheck`, and `npm run build` completed successfully from the clean source copy.
- With `NODE_ENV=production`, `node scripts/verify.mjs` passed documentation validation, API and web typechecks, production builds, and PostgreSQL API integration: 28 tests passed, zero failed, and one optional S3Mock/ClamAV test was skipped because the evidence profile was not enabled. That real local storage test had separately passed in the primary worktree. The clean-install verification JSON and individual logs are preserved under [`clean-install-2026-11-08`](clean-install-2026-11-08/).
- Documented API and web development commands started successfully on loopback ports 4210 and 5174. `GET /api/v1/session` and `GET /` each returned HTTP 200. Both temporary servers were stopped after the check.

## Open verification items

- At the time of this source-copy run the repository had no commit, so Git checkout could not yet be tested. That remaining check is now covered by the dedicated [Git checkout verification](git-checkout-2026-11-08.md).
- The JavaScript bundle-size variance is explained by the process environment: `NODE_ENV=development` produced 715,892 bytes and a development-mode chunk warning; setting `NODE_ENV=production` in the same clean install produced 474,320 bytes and the exact same SHA-256 as the primary worktree. The installed package trees also matched across all 173 distinct package/version entries. Release verification must run with `NODE_ENV=production`.
- A production-mode verification initially exposed an asynchronous database-fixture teardown failure in `migration-upgrade.test.ts`. The fixture used `DROP DATABASE ... WITH (FORCE)` immediately after closing its pool, which could terminate a late connection and fail the test runner. The teardown now uses a normal `DROP DATABASE` after `pool.end()`; the focused migration test and the full clean-install verification pass with this fix.
- Actual production environment, remote identity, deployment, data recovery and physical-device startup remain outside this local check.

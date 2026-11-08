# Git checkout verification

Date: 8 November 2026  
Commit checked: `7aae42d` (`Establish VMMS implementation baseline`)  
Status: F-001 clean-checkout acceptance verified.

## Method and result

Cloned the committed repository into a new temporary directory with a clean worktree. No `.env` or installed dependencies were present in the clone. `npm ci` installed 167 packages from the committed lockfile and reported zero audit vulnerabilities. npm warned that `esbuild`'s install script was not explicitly approved by npm's install-script policy; the installed binary was usable and production build passed.

With `NODE_ENV=production`, `node scripts/verify.mjs` passed documentation validation, API and web typechecks, production builds, and PostgreSQL API integration. The suite reported 28 passing tests, zero failures, and one optional S3Mock/ClamAV integration skip. The build produced a 474,320-byte JavaScript bundle with the same SHA-256 as the primary worktree. Run metadata and individual logs are preserved under [`git-checkout-2026-11-08`](git-checkout-2026-11-08/).

The documented API and web development commands also started from the clone on loopback ports 4210 and 5174. `GET /api/v1/session` and `GET /` each returned HTTP 200. The temporary `.env` was created from `.env.example` with dummy local values; no production secrets were copied. Both servers were stopped after verification.

This proves repository checkout and local development/build/test reproducibility only. It does not establish production deployment, remote identity, restore, operational, or physical-device readiness.

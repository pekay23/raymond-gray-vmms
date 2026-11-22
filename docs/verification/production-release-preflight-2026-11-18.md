# Production release preflight — 18 November 2026

**Result:** Not released. Local checks are green, but the current worktree is not a single reviewed full-stack production artifact.

## Local evidence

- `npm test` — 151 API tests passed, 40 web tests passed, one environment-dependent S3/ClamAV integration test skipped.
- `npm run verify:work-plan-browser` — all 69 checks passed against disposable PostgreSQL and the real API/browser workflow. A flaky loading-state assertion was corrected to wait for the visible state before releasing its mocked response.
- `npm run typecheck` and `npm run build` — passed with no compiler or Vite warnings.
- `npm run docs:check` — passed for 258 requirements, 719 tasks and 350 source blocks. `docs:test` was not rerun in this checkpoint.

## Deployment evidence

Read-only Vercel inspection found project `raymond-gray-vmms`, framework `vite`, with `vmms.raymond-gray.org` listed as a project domain. Its latest deployment remains READY with production target at commit `7da5e845096241fa338cce75e90f5f825af3364a`; the project `live` field is false, and SSO protection is enabled for non-custom domains. The local `main` and `origin/main` are at `e6e9b4cbac1e8ae3905ea5989b510c367f52e363`, so the current tested code has not been published. This is evidence of a Vercel frontend deployment record, not proof that the Fastify API, database migrations, evidence worker, shared authentication, or production user flow is live and healthy.

The checkout is on `main` with 100 modified/untracked paths, including API configuration and OIDC/session changes as well as workshop workflow features. The local build and tests pass, but the working set is not yet an isolated, reviewed full-stack release commit. The exact API/evidence-worker target and production migration/identity state are also not established by the Vercel project. No environment values were read; no deployment, alias, domain, migration, or production data was changed.

## Release requirements still open

1. Review and isolate the exact release commit; do not include unrelated or identity-owner changes without that owner’s review.
2. Confirm the production API and evidence worker target, database, migration state, identity callback/session flow, and private evidence path.
3. Stage that exact commit, run the release checks against staging, verify the staff journey, and rehearse rollback/recovery before promotion.

The local checks above are useful release evidence but do not close production deployment or staff UAT.

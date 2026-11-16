# Production environment boundary check

Date: 15 November 2026

## Change

The API no longer reads the repository `.env` file when `NODE_ENV=production`. Production values must be supplied explicitly by the runtime environment. Development and test retain the local `.env` convenience.

The existing production startup guard remains in place. It rejects startup until staff identity, MFA, hosting, and deployment controls pass their review. This change does not enable a production server or claim that the deployment is ready.

## Verification

- `node --import tsx --test apps/api/test/config.test.ts` passed 6 tests. Two new tests prove production skips local `.env` loading and local development/test still allow it. The existing tests continue to prove the production startup gate, disabled staff messaging, trusted-proxy validation and OIDC logout-origin checks.
- `npx tsc --noEmit -p apps/api/tsconfig.json` passed.
- CodeGraph sync completed and reported the index up to date. `codegraph affected apps/api/src/config.ts` selected the configuration, API, OIDC, evidence, foundation and Worker test paths.

No production environment, provider secret, database, identity, invitation, DNS or deployment was read or changed. Production OIDC, Google federation, MFA, bootstrap, API reachability and full sign-in remain unverified.

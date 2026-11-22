# VMMS API production package review

**Date:** 20 November 2026  
**Purpose:** Read-only production release review for the standalone `raymond-gray-vmms-api` Vercel project.

## Observed state

- Vercel lists `api.raymond-gray.org` as attached and verified on the standalone API project.
- The Cloudflare zone has no DNS record for `api.raymond-gray.org`.
- Vercel reports no hidden Production environment variables for the API. Existing runtime variables are Preview-only and include a staging marker and an explicitly unconfigured OIDC client ID.
- The API has no verified healthy Production deployment. The current API custom domain must not be routed to this unconfigured service.
- Independent read-only deployment reviews found that a failed Production-target deployment inventory included filenames for two local `.env` files and Wrangler state databases. A local metadata-only check found that the two named files contain distinct shared-auth Preview OIDC client identifiers, client-secret fields and loopback callbacks. Secret values were not printed, decoded, tested or passed to tools. The source inventory is evidence that those files may have been uploaded to Vercel's deployment/build storage; it does not establish public access, current credential validity or successful production execution.
- The root and API `.vercelignore` files in the current worktree are untracked, so they did not protect that revision.

## Required release gates

1. In the shared-auth system, confirm the two identifiers are Preview-only and revoke/regenerate both associated client secrets. Treat each secret as exposed even if its client is no longer active. Do not copy values into logs or chat.
2. Track and verify ignore rules at the actual Vercel project root. Build a sanitized package locally and confirm it excludes environment files, `.vercel` state, Wrangler state and local databases.
3. Correct the repository upload/root-directory mismatch. Prove the resulting package contains the expected API files under the configured `apps/api` project root.
4. Provision reviewed Production-only database, session, OIDC, evidence and origin settings. Do not copy Preview secrets into Production.
5. Deploy only after local checks pass; verify API JSON health, authenticated same-origin proxy behavior, production OIDC callback/MFA claims, trusted ingress, runtime database role/RLS and rollback.
6. Add the DNS-only CNAME for `api.raymond-gray.org` only after the API Production deployment is healthy. Then verify DNS, TLS, API health and VMMS proxy behavior.

No Vercel variables, deployments, aliases, Cloudflare DNS, database credentials or user accounts were changed in this review.

## Follow-up platform check

Read-only Vercel checks on 20 November confirmed exactly two VMMS projects: `raymond-gray-vmms` for the web app and the permitted standalone `raymond-gray-vmms-api`. The web project has the verified production domain `vmms.raymond-gray.org`; the API project has `api.raymond-gray.org` attached and verified. The API custom domain is not yet routable because Cloudflare DNS is absent.

The latest web Production deployment is still the 15 November build from commit `7da5e845096241fa338cce75e90f5f825af3364a`. The latest API Production-target deployment, `dpl_8arAruDiPW46DbPCJwfE4zLPffne` from 19 November commit `e6e9b4cbac1e8ae3905ea5989b510c367f52e363`, is `ERROR`. Its build log says the configured Root Directory `apps/api` does not exist in the uploaded deployment source. The deployment file inventory is rooted at the API app's own files (for example `src/...`), confirming a project-root/package mismatch. The latest API deployment is a READY Preview; it is not evidence of Production readiness and must not be promoted.

No deployment, alias, project setting, environment variable, database, secret, or DNS record was changed. Local verification on this checkout later passed the full test suite (API 170 passed, one optional integration skipped; web 46 passed), API and web typechecks, production build, and documentation traceability. These checks do not repair the hosted project-root mismatch or prove hosted identity, database, storage, or recovery behavior.

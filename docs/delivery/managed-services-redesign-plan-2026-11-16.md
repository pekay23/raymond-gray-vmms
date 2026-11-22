# VMMS and shared auth managed-services redesign plan

Date: 16 November 2026; auth evaluation update: 17 November 2026. Status: account preflight completed; implementation and deployment remain incomplete. USER-046 records the owner's instruction to leave Railway, avoid user-managed containers, compare managed authentication, and plan both repositories. The user selected the existing Neon project for PostgreSQL and chose to preserve explicit identity linking while evaluating Vercel with Neon Auth. The current recommendation is self-managed Better Auth on Vercel with the existing Neon `raymond_gray_auth` database; Neon Managed Auth itself does not meet the current staff MFA requirement. This is a candidate pending pinned-version review and isolated-flow verification, not a production selection.

## Target and constraints

Operate VMMS and shared sign-in without Railway, Keycloak, Docker or another user-managed container platform. Local developers run Node applications and use isolated managed nonproduction dependencies; Docker is not a required test step. Providers may operate infrastructure internally. Preserve existing branding, the workshop pilot priority, canonical IDs, audited commands, independent G1–G5 gates and approval requirements. This plan adds infrastructure work, not Finance/Sales scope to the next workshop pilot.

Use three core platforms: Vercel for apps and the Node API; Neon PostgreSQL for VMMS and isolated auth-session databases; self-managed Better Auth on Vercel is the leading identity candidate; Cloudflare for DNS, private evidence storage and bounded asynchronous handlers. Malware scanning and email are deferred for the initial deployment. Evidence upload/acceptance and real invitation/recovery mail stay disabled until their required services are configured and verified. [Account preflight](../verification/checks/managed-services-account-preflight-2026-11-16.md), [research and sources](../discovery/managed-auth-and-storage-2026-11-16.md), [auth repository plan](../../../raymond-gray-auth/docs/managed-services-redesign-plan-2026-11-16.md).

## Deployment map

| Unit | Proposed home | Boundary |
| --- | --- | --- |
| VMMS React/Vite frontend | Vercel | Existing SPA and approved UI, including responsive drafts and evidence progress |
| VMMS Fastify API | Vercel Node Functions | Same-origin /api/v1; sessions, grants, gates, commands and audit. Not Vercel Edge or workerd |
| Shared auth website | Vercel at auth.raymond-gray.org | Existing-direction login, consent, enrollment and recovery UI with server-side provider adapter |
| Shared identity | Self-managed Better Auth on Vercel, backed by Neon | Password/Google, TOTP/passkey plugins, OAuth/OIDC provider, consent and server-owned identities; exact policy/version still to verify |
| Canonical VMMS database | Existing Neon project `broad-hill-03193529`, database `neondb` | One business model, non-owner RLS-enforced runtime role, separate migration and bounded worker roles |
| Auth BFF sessions and provisioning ledger | Separate Neon database `raymond_gray_auth` in the same existing project | Separate runtime role and database; no VMMS business-table access from auth runtime; encrypted provider secrets/tokens, operation ledger and revocation delivery |
| Upload staging, sealed quarantine and accepted files | Private Cloudflare R2 buckets | Browser can write only staging via a short-lived capability; no public evidence bucket |
| Evidence gateway and asynchronous handlers | Cloudflare Workers and Queues with dead-letter handling | Authenticated streaming, sealing/scan dispatch, bounded jobs and retries |
| Malware engine | Private managed scan API; attachmentAV candidate | Exact-object clean verdict; processor, region, limits and price require review |
| Mail | Approved managed SMTP/API service | Auth invitation/recovery only after sender/content/recipients are authorized; no real mail in evaluation |

A read-only inventory found the existing Neon project empty and already referenced by the VMMS local configuration. Reuse it; do not create a duplicate. The existing Supabase project is already referenced by `raymond-gray-platform` and contains that application's tables. Its ordinary Auth discovery endpoint responds, but the OAuth authorization-server discovery endpoint returned 404. Do not change its Auth settings or treat it as VMMS's issuer until the existing platform impact, client flow, admin-key isolation and same-email-linking policy are reviewed. Supabase Auth's schema remains provider-owned; do not add brittle triggers or patch its tables.

Neon is the selected canonical PostgreSQL service. The existing VMMS project is in `aws-us-east-2`; its latency and recovery fit remain deployment checks. Separate `neondb` and `raymond_gray_auth` databases have dedicated non-superuser, non-BYPASSRLS runtime roles; migration access stays with the owner credential and never enters ordinary runtime configuration. Keep pg and SQL migrations portable. Neon Managed Auth and Neon Storage are not selected. Do not synchronize two canonical databases or dual-write two live file stores.

### Logical flow

~~~mermaid
flowchart TD
    Browser[VMMS browser] --> Web[Vercel frontend]
    Browser --> API[Vercel Node Fastify API]
    Browser --> Login[Vercel branded auth website]
    Login --> IDP[Better Auth on Vercel]
    API --> IDP
    API --> DB[(Managed PostgreSQL)]
    Browser -->|signed staging upload| R2[Private R2]
    API -->|committed outbox| DB
    Jobs[Cloudflare Workers and Queues] --> API
    Jobs --> R2
    Jobs --> Scanner[Private managed scanning API]
    Gateway[Authenticated evidence gateway] --> API
    Gateway --> R2
    Browser --> Gateway
~~~

This is a proposed logical map, not an assurance that all routes have been configured.

## Authentication contract

Keep VMMS as a standards-based relying party using the maintained openid-client library. Preserve five-minute one-use browser-bound state, nonce, S256 PKCE, exact redirects, asymmetric signature and issuer/audience validation. The callback supports staff and owner audiences. The browser gets an opaque host-only Secure HttpOnly product cookie plus CSRF protection; it does not receive provider refresh tokens or database/admin keys.

The auth website and proposed issuer origin are auth.raymond-gray.org on Vercel, pending verification of Better Auth OAuth Provider discovery and exact callback behavior. Keep the passkey RP ID at auth.raymond-gray.org. Never infer issuer metadata from the UI hostname; VMMS must use the value returned by verified discovery.

Keep application-local user UUIDs, site memberships, staff/owner relationships, signed grants and historical decisions. Add reviewed old-issuer/old-subject to local-ID to new-issuer/new-subject mappings. No same-email mapping, provider job-title role, or successful login activates business access.

### Hard provider selection gates

1. Pin and verify Better Auth's `disableImplicitLinking` and signed-in `linkSocial()` behavior for the approved explicit-linking policy.
2. Prove OAuth/OIDC provider code exchange, exact registered callbacks, required user verification, RP/origin, Google/password fallback, closed enrollment, recovery, Safari/iOS and shared devices on the pinned release.
3. Prove that mandatory MFA assurance and freshness reach VMMS as provider-verified claims or an authenticated documented result. Better Auth's built-in 2FA challenge does not automatically gate social OAuth or passkey login; the server must hold authorization until verified TOTP and emit only evidence tied to that session. A frontend assertion cannot satisfy MFA. Existing code must persist any required assurance at the server session boundary.
4. Prove central revocation without assuming Keycloak end-session/backchannel endpoints exist. Provider refresh revocation alone leaves already-issued JWTs valid. Use provider-supported logout plus an authenticated durable product-session revocation contract and callback race barriers.
5. Prove server-held auth website sessions/refresh serialization using maintained provider APIs. If the supported SDK flow requires a different token custody model, document that difference for review before changing the contract.
6. Inventory whether email-or-username fallback is used. Prove the selected Better Auth identifier flow supports the existing contract or add a reviewed, non-enumerating server lookup; do not silently drop a login identifier.

If these gates fail, stop selection, keep access closed, and evaluate another managed provider or an explicitly reviewed requirement change. The owner does not need to resume Railway or learn containers to resolve that choice.

## VMMS API and PostgreSQL

Keep apps/api domain modules and the shared command transaction implementation. Vercel handles Node request execution. Make startup/build/configuration compatible with scale-to-zero and concurrency. Remove dependence on in-process durable state, startup-only schema migration, resident timers or trusting a fixed upstream socket identity.

Business commands still derive scope from the current authenticated session, lock membership and relevant aggregate/grants in the existing order, reject stale versions and commit mutation/event/receipt/outbox atomically. Provider auth claims never replace action-time authority checks. Use transaction-local organisation/site/actor context with pg on one acquired connection until commit/rollback. Test pooled connection reuse, transaction advisory locks and role safety against the selected hosted PostgreSQL.

Use restricted runtime/worker credentials and separate migration credentials. Do not use the Neon owner role for business queries. The verified `vmms_runtime` role is non-superuser and does not bypass RLS; the verified `raymond_auth_runtime` role is isolated to its separate database and likewise does not bypass RLS. Review public-schema grants, default privileges, RLS and role access after migrations are applied. Retain application checks and RLS. Verify required extensions, functions, privileges, locking and migrations; do not assume superuser access.

Replace the current per-instance pool sizing with a measured serverless-compatible configuration, bounded connections and timeouts, placed near the database. The existing max=12 pool is not an approved deployment-wide connection budget. Test session/context isolation under concurrency. TLS certificate validation stays enabled.

Vercel Functions currently cap request bodies at 4.5 MB. JSON commands fit the bounded API contract; evidence bytes must bypass it. Preserve Vercel's own runtime deadline, observe failed invocations, and make retries return idempotent receipts rather than duplicate changes. Inspect the real ingress path and current provider address handling; do not copy a trusted-proxy CIDR list from the former container deployment.

## Evidence upload, acceptance and downloads

1. VMMS authenticates an intent command, rechecks target permissions and commits the upload intent with an allocated random staging key, expected length/type/hash, expiry, actor/site and receipt. Return a short-lived signed PUT for that key only. CORS allows exact product origins. A signed PUT is reusable until expiry and does not itself enforce every declared field; check actual bytes and storage consumption independently.
2. The browser uploads directly to R2's supported S3 endpoint. This avoids Vercel and Worker HTTP request-body caps, including the current configurable 100 MiB application maximum. Test the default 10 MiB and maximum path; do not silently reduce the accepted product limit.
3. A bounded authenticated finalization command authorizes the intent again and schedules sealing through the committed outbox. An R2 event can wake reconciliation but is not authority to accept evidence. Events may arrive before finalization, repeat or be missing.
4. A Worker reads the staging object and writes a separate random sealed key that the browser has never been allowed to write. Validate actual length/type and stream a server-computed hash with a maintained incremental library. Compare actual bytes, permitted type and computed hash with the intent's expected values; reject mismatches. Store the observed object metadata and resulting hash. Conditional writes/unique keys and restricted credentials prevent overwriting the sealed bytes. Never scan a staging key and later accept whichever bytes happen to be at that key.
5. Dispatch only the sealed object to the private scan API through a short-lived read URL. Persist job ID, provider, exact key/hash/size, attempt and deadline. Do not accept arbitrary caller-supplied download URLs. Verify callback signatures over the raw body and timestamp, correlate job identity and retrieve authoritative results if delivery is ambiguous. Redact signed URLs and secrets.
6. Verify the clean result is for the exact sealed bytes, then copy/promote those bytes to a protected accepted key and verify the durable destination identity, length and hash. Only after that succeeds does the existing domain acceptance operation recheck target/site state and atomically commit accepted metadata, audit and receipt. A crash before that database commit leaves quarantined/unavailable evidence or an inaccessible orphan for reconciliation, never an accepted record pointing to an unverified object. Infected, encrypted/unsupported, oversize, missing, timed-out, malformed and ambiguous results stay rejected or quarantined. Duplicate/reordered results cannot promote different content.
7. Downloads stream through an authenticated Worker route on the VMMS origin. The Worker forwards the actual product request to a private VMMS authorization operation, which rechecks current membership/target/accepted state and atomically appends access audit before authorizing that response. The Worker then streams the permitted R2 object with no-store and safe content headers. Never return a bearer download URL that can be redeemed after access revocation without another check.

Worker-to-API calls use platform-supported service authentication or an existing maintained signing implementation with exact audience/scope, short lifetime and replay controls. Do not invent an end-user authentication protocol or trust browser identity headers. Domain decisions remain in the Node command implementation; Workers own byte transport and scheduling only. Same-origin route configuration, cookies, response limits, restricted access and streaming cancellation require a dedicated hosted proof.

Use separate staging/quarantine/accepted access capabilities. Apply approved bucket-lock rules only to accepted evidence; quarantine needs reviewed cleanup. Because malware scanning is deferred, keep upload and acceptance unavailable until exact-byte scanning and restore checks pass. Hashes, manifests, R2 locks and provider replication are not substitutes for independent backups. Prove restore of SQL plus exact object bytes and their audit linkage before launch. Any optional secondary-provider backup copy is one-way, access-isolated, reconciled and separately tested, never a fallback writer.

## Jobs and provisioning without resident processes

PostgreSQL remains the durable source for pending work. A Cloudflare scheduled Worker calls a bounded authenticated dispatcher; it leases committed outbox batches and publishes opaque job references to Queues. Mark dispatch progress only with retry-safe acknowledgements. A crash before/after enqueue is safe because processing is idempotent. Queues wake bounded handlers; repeated delivery, dead-letter routing, lease expiry and explicit reconciliation handle failure.

Provider administration runs only in the auth repository's server-only handler. VMMS emits an approved account request and never gets auth administration credentials. Select one private endpoint contract, /internal/v1/vmms/account-provisioning-operations, and migrate the caller and auth handler together; remove the conflicting /invitations API shape in the same implementation unit. Preserve canonical payload digest, operation ID, actor/client identity, 24-hour original expiry, at most one resend without extending expiry, recipient proof and manual review on an existing identity. Invitation delivery, enrollment, local linking and site activation remain separate recorded transitions.

Move evidence scanning, provider provisioning, reconciliation and authorized notification delivery from loops to bounded handlers. Do not deliver external messages inside the business transaction or fire-and-forget after the response. Recheck current authorization for protected operations and redact sensitive payloads from queues/logs. A queue consumer does not inherit an interactive user's grants.

## Changes by repository

| Repository | Keep | Replace or add during implementation |
| --- | --- | --- |
| raymond-gray-vmms | React screens/branding, domain modules, command runner, SQL audit/grants, canonical UUIDs, PostgreSQL tests | Vercel project/build/routing, managed database configuration, measured pool, managed OIDC compatibility, direct upload/finalize UI, authenticated Worker downloads, bounded jobs, hosted no-container test harness |
| raymond-gray-auth | Shared product identity contract, approved brand assets, auditable provisioning semantics | Vercel Better Auth login/consent/enrollment/recovery app, Neon database adapter, explicit-linking policy, MFA and passkey plugins, bounded provisioning/revocation handlers and isolated provider tests |

Proposed VMMS additions are a Vercel entry/config at the deployment boundary, apps/evidence-worker for Cloudflare transport and queue handlers, evidence upload/finalization adapters beside current evidence code, and scripts for managed-environment verification. These are proposed paths, not existing artifacts. Keep domain logic in apps/api. Do not create empty layers or rewrite Fastify merely to place it on Workers.

Retire Railway CLI/configuration, production Dockerfiles, Keycloak adapters/realm containers and container-only verification only when their replacement passes acceptance. Existing unrelated/uncommitted work must be preserved. Keep historical reports read-only as evidence of the old system, labeled by provider; they do not verify the replacement.

## Delivery order and acceptance evidence

| Unit | Tracker | Done when |
| --- | --- | --- |
| Record research/design and owner constraints | PLAN-MANAGED-001 | Two alternatives compared, recommendation/gaps written in both repos, trackers/docs links valid |
| Prove managed identity fit | BUILD-MANAGED-IDP-001 / CHECK-MANAGED-IDP-001 | All provider selection gates above pass on synthetic isolated accounts, or a specific unsupported requirement is recorded without cutover |
| Build auth website/provisioning | BUILD-MANAGED-AUTH-001 / CHECK-MANAGED-AUTH-001 | Login, consent, invitations, explicit mappings, recovery, logout and scoped admin denials pass; no browser admin/refresh secrets |
| Prove Vercel API and managed PostgreSQL | BUILD-MANAGED-API-001 / CHECK-MANAGED-API-001 | Real hosted role/RLS/lock/receipt/rollback/concurrency suite, both login audiences, CSRF and private ingress pass |
| Build R2 gateway and managed scan path | BUILD-MANAGED-EVIDENCE-001 / CHECK-MANAGED-EVIDENCE-001 | Exact-byte quarantine, overwrite/race denials, scan failure/retry and revocation-safe streamed downloads pass at approved sizes |
| Replace resident jobs | BUILD-MANAGED-JOBS-001 / CHECK-MANAGED-JOBS-001 | Crash/retry/idempotency, duplicate publication, stale lease, dead-letter and reconciliation drills pass |
| Rehearse migration/restore/cutover | CHECK-MANAGED-CUTOVER-001 | Reviewed identity map, SQL/object restore, synthetic two-product SSO, no-container rollback and exact release manifest accepted |

PLAN-MANAGED-001 records documentation completion only. USER-046 stays in progress. Existing AUTH/IDP/EVID/HOST tasks keep historical evidence; new checks must run against new providers. No build result closes UAT or grants authority.

Run Node locally; use isolated managed nonproduction projects, identities, buckets and queues for integration, or maintained protocol fixtures where remote behavior is not under test. Do not clone production users, sessions or evidence into previews. Disable real mail or use approved synthetic capture recipients. Paid/nonproduction resource creation still needs an exact reviewed configuration; elapsed time is not permission. Implementation may proceed locally against fixtures before that stage.

The verification matrix includes staff and owner login, two registered synthetic products, wrong issuer/audience, disallowed callback, state/nonce/PKCE reuse, suspension and callback/logout races, account collision, closed signup, invitation replay/expiry/resend, refresh concurrency, cross-tenant/site reads/writes/downloads, real PostgreSQL races, evidence overwrite-before/during/after scan, malicious/error verdicts, abandoned uploads, scan-before-finalize, database rollback, queue outages, restore and accessible desktop/mobile workflows. Record each platform not tested. Financial/safety gate denial suites remain binding even where the workshop pilot defers those workflows.

## Cutover, retirement and rollback

Inventory the actual production state read-only through approved access before any move: database records, files, identities, relying parties, sessions, DNS, email and current billing. Repository documentation describes Railway-hosted auth; public discovery alone is not a user/data inventory. Prepare reviewed exports/backups without printing credentials.

Use additive migrations and one authoritative business writer. Freeze affected writes for the rehearsed export/import window if needed, reconcile counts/hashes and preserve original IDs, events and financial history. Build explicit identity mapping records with independent proof. Do not promise password hashes, passkeys, MFA factors or active sessions are portable; require verified re-enrollment/reset where needed. Keeping the same RP hostname alone does not transfer passkey records.

Deploy the new slice only to reviewed staging first. After complete acceptance, present exact Vercel projects, managed project/region/plan, callback/client IDs, bucket/queue policies, processor/sender, DNS records, secrets by name, budget limits and database/object restore/rollback instructions. Actual secrets belong in provider stores. Then schedule the authorized production switch, expire old app sessions and activate one issuer per environment. VMMS is first; audit the other Raymond Gray products before migrating them.

Rollback uses a known-good managed-services release/configuration and compatible additive schema, or a maintenance/closed-access state while fixing the new provider. It does not require restoring Railway, Keycloak or Docker. Never switch back to a stale business database after new writes. Retain encrypted old-provider evidence/exports under the approved retention policy; destroy old resources and revoke old credentials only after their exact retirement is separately authorized. This plan neither deletes nor continues development on the old hosted service.

## Open decisions

REV-058 covers managed provider/linking/maturity/assurance; REV-059 covers account plans, region, budgets, project isolation, exact hostnames and recovery; REV-060 covers R2 immutability, scan processor, retention and backup. Existing authority, Finance, privacy, Google callback, mail and staff acceptance decisions remain open. The no-Railway/no-container direction is accepted and does not need to be asked again.

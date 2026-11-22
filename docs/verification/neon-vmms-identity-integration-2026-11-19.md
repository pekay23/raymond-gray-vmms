# Isolated Neon VMMS identity-integration database

Date: 19 November 2026

## Scope

An isolated Neon project and child branch were used to check whether the current VMMS PostgreSQL migrations and runtime role work on the selected managed database without containers. The branch began empty; after schema verification it received one marked synthetic staff account, site membership, `service-advisor` role placement, and local OIDC subject mapping for the end-to-end check below. No production database, DNS, account, email, or live identity was changed.

The owner selected one central OIDC issuer with explicit per-product access. A VMMS realm membership permits authentication only to VMMS clients. It does not grant access to the Raymond Gray platform portal or another product. VMMS keeps the local staff account, organisation/site membership, operational role placements and grants. A client, sales user, technician/engineer, service advisor, Head of Aftersales, administrator, finance user, Team Lead, Supervisor, or Operator receives only the local access separately approved for that person.

## Results

- The dedicated VMMS Neon project uses the London region and a separate integration branch. It is not the pre-existing unrelated `RaymondGray` project.
- All migrations through `094_work_order_checklist_item_reviews.sql` applied successfully on the integration branch.
- Neon migration roles are not superusers. Each migration grants the target NOLOGIN role to the migration user inside that migration transaction, performs ownership transfers and ACL changes, then revokes membership. Function execution is granted before ownership changes so later ACL statements do not run as a role that no longer owns the function.
- Migration `047_identity_runtime_least_privilege.sql` no longer attempts to change the superuser attribute of an existing role; the role is created with `NOSUPERUSER` and remains non-superuser.
- The runtime role cannot create objects in `public`, can read the expected work-order relation, is not a superuser, and inherits only its granted runtime privileges.
- The migration runner skipped migrations already applied on retry and completed the remaining files.
- On the same isolated branch, one synthetic staff identity was linked to the local test issuer and a single read-only site membership. Its only VMMS job role is `service-advisor`; no technical, safety, inspection, financial, or governance grants were created.

## Local OIDC verification

- The local identity evaluation service issued a synthetic identity through its confidential VMMS OIDC client. The local sign-in included TOTP MFA, and the client had an explicit membership in the synthetic VMMS realm.
- VMMS started its own authorization-code + PKCE flow, validated the issuer, audience, state, nonce and MFA assurance, handled the real local callback, and created its own application session.
- The returned VMMS session resolved the exact `(issuer, subject)` mapping to `Synthetic OIDC VMMS Advisor`, with only the synthetic QA site, `canWrite=false`, and `service-advisor` role placement.
- This verifies central authentication plus local authorization separation on a test branch. It does not create VMMS users from the identity service or prove production callbacks, hosted deployment, logout, or cross-product access.

## Limits

This is synthetic integration evidence only. It does not verify production callbacks, production account enrollment, denial for a user assigned only to a different realm, the private provisioning API, invitation delivery, logout/back-channel logout, or a hosted VMMS deployment. The `BUILD-AUTH-PROVISIONING-001` acceptance criteria remain open. No production user or operational data was seeded into Neon.

Production migration, OIDC client registration, secrets, DNS, user provisioning and email remain unchanged.

## Corrected Vercel API Preview route check

On 19 November 2026, the API function was placed under `api/v1/[...path].ts` so that Vercel mounts it at the same `/api/v1/*` path used by the VMMS application. A new protected Preview deployment, `dpl_CQnEXEKxXGWutLbjtMUzhPkusDAx`, built successfully. `GET /api/v1/health` returned HTTP 200 with `{"status":"ready"}`; the handler initialized Fastify and completed its database readiness query against the isolated Neon integration branch. The service index also returned HTTP 200.

This proves hosted API startup and isolated database connectivity only. It does not prove OIDC because the Preview `OIDC_CLIENT_ID` is intentionally an unregistered placeholder, nor does it prove a browser sign-in: Vercel Authentication still protects the Preview. The API project has no Production deployment or custom API domain, and the live VMMS frontend deployment still uses its prior Railway rewrite. Do not promote the Preview or change the production route until a registered test client and end-to-end sign-in are verified.

## Vercel frontend-to-API Preview path

On 19 November 2026, the VMMS frontend Preview was connected to the protected API Preview through a same-origin Vercel Node function. Stable Vercel aliases are `https://vmms-preview-pekay23s-projects.vercel.app` for the frontend and `https://vmms-api-preview-pekay23s-projects.vercel.app` for the API; both deployments retain Vercel Authentication. The frontend Preview alone holds a sensitive, server-side API deployment-protection bypass value. No bypass value is present in source or returned to the browser. Vercel Preview environment variables contain the API origin and callback configuration; Production environment values were not changed.

The frontend's `/api/v1/*` rewrite reaches its proxy function, which forwards the original VMMS path, browser cookies, Origin, CSRF token and request body to the fixed API origin. It returns API headers and separate `Set-Cookie` values to the same VMMS origin. Verification through the stable aliases returned HTTP 200 for `/api/v1/health` and an anonymous `/api/v1/session` with a CSRF cookie. The nested `/api/v1/auth/oidc/start` route returned HTTP 302 both when called directly on the API Preview and through the frontend proxy. This verifies nested routing and redirect transport, not a successful OIDC client login: the configured client ID remains a placeholder and is not registered in the central identity service.

The VMMS `vercel.json` source no longer contains a Railway API rewrite. The existing Production frontend deployment has not been changed and still follows its previously deployed Railway route. Production cutover, a production Neon database, central VMMS realm/client registration, identity linking, and the authenticated end-to-end browser session remain open.

## Vercel API Preview deployment attempt

The existing VMMS frontend project remains separate from the new API project. Four protected Preview deployments of `raymond-gray-vmms-api` built successfully on Vercel's Fastify framework preset and Node 24, targeting London (`lhr1`) with the isolated Neon integration branch. The latest is `dpl_2CVSBEyhXydbtQwioB8ZCsVFoHky`. No production alias or API custom domain is attached.

`GET /api/v1/health` returns Vercel `500 INTERNAL_FUNCTION_INVOCATION_FAILED` on each tested Preview, including after using the documented Fastify listener shape and the default local host. Vercel request records show the route enters a generated function, but no runtime logs or trace root are available for the failures. The failure is therefore unresolved; a READY build is not runtime evidence. The API Preview must not be used as the VMMS frontend target until runtime startup and authenticated VMMS callback behavior pass.

The Preview upload excludes `.env` files, Wrangler state, SQLite/database files, `Dockerfile`, and `.dockerignore`; the latest uploaded file tree contained none of those paths. The Vercel Preview environment change is limited to `HOST`; production environment, custom domains, frontend rewrite, Railway service and DNS were not changed. The public VMMS frontend's existing Railway rewrite remains in the tracked configuration until a working Vercel API target is proven.

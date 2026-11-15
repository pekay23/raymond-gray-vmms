# Isolated local role rehearsal

Status: selected engineering design, 10 November 2026. This design covers synthetic local test identities only. It does not authorize production accounts, invitations, or operational authority.

## Ownership and isolation

The VMMS role rehearsal must be a disposable, wholly owned local environment with a dedicated Keycloak realm and PostgreSQL database. It must not reset or adopt the existing development advisor or QA viewer. The auth repository owns local identity-provider administration; VMMS owns the persona manifest, product records, and verification. The auth helper receives opaque fixture slots and generic identity fields only. It never receives VMMS role codes, sites, reporting links, customer data, or authority grants. VMMS never receives Keycloak administrator credentials.

Expose the app, API, identity provider and browser only on loopback. Validate configured URLs, redirects, DNS resolution and actual database socket peers. Require explicit development mode, an ownership marker in both stores, an exact realm/database identity, and a recorded container/database identity before mutation. Reject live/non-loopback endpoints, mismatched markers, occupied IDs, unmarked accounts, or unexpected existing records. Do not infer disposability from a hostname alone.

Use commands with explicit ownership and lifecycle semantics: `prepare`, `up`, `status`, `verify`, and `down`. Repeated `prepare` with the same manifest must be a no-op when records match. It must surface manual drift without resetting passwords, roles, memberships or work performed during review. Teardown may remove only the exact resources recorded as owned by that fixture instance and must refuse on identity mismatch.

## Persona catalog

Create separate synthetic identities for the VMMS Operator, Head of Service Centre / Operations Admin, EV Team Lead, ICE Team Lead, Supervisor, Technician / Engineer / Trainee, Service Advisor, Quality Inspector, Parts & Inventory, Warranty / Customer Support, Finance / Billing, Compliance / Records / HR, Sales Representative, and PDI Observer. Add a separate approved vehicle-owner persona with no staff account, staff identity mapping, membership, placement, or procedure-library access. Use generic names and reserved `.test` or `.invalid` addresses only.

The Head and Operator are distinct personas. The Head has the existing site-operational duties and may assign people only to existing effective role profiles. The Operator manages accounts and approved account/site access only. Neither account profile grants authority to sign technical completion, independent inspection, release, finance, governance, or controlled-document publication. Seed no such grants. A synthetic fixture-only owner-access approval capability may be used only to establish the owner scenario, in its isolated database, through the real approval and invitation commands; revoke or disable it immediately after setup.

Seed one site with the reporting chain Head → Team Leads → Supervisor → Technician. The Operator is outside that chain. Keep separate work-order lead/supervisor assignments in the workshop domain. Reconcile the persona manifest against the active built-in role catalog before writes; stop and report a safe mismatch if the catalog changes.

## Idempotency, secrets, and recovery

Use fixed namespace-derived IDs for fixture records and a versioned manifest digest. Preflight every identity, site, membership, subject mapping, placement and reporting link before mutation. Treat missing records as creatable, exact fixture-owned records as reusable, and all other states as conflicts. Never use conflict-update logic to move an issuer/subject mapping between people.

Identity-provider and VMMS database writes cannot share a transaction. Persist a local, secret-free step journal after each provider operation. Persist generated per-persona credentials atomically in ignored private local files before creating or resetting an identity, so retries can recover without losing the credential. Restrict file permissions for the host OS and fail closed if the target is a symlink/reparse point or permissions cannot be restricted. Do not pass secrets as command-line arguments or print them. On partial failure, preserve the journal and report the incomplete phase; do not silently delete or reset resources.

Apply all product records in one database transaction after identity receipts are verified. Record the fixture marker, issuer/subject mapping, staff account, site membership, role placement and initial placement history. Repeated preparation is read-and-compare; any changed password, subject, membership, role, site, or manually edited state requires an explicit reset of the isolated fixture instance.

## Owner access rehearsal

Create one clearly synthetic vehicle, approved relationship, and accepted synthetic evidence only in the isolated database. Establish owner approval through the existing command path with a narrowly scoped fixture-only capability; create the real single-use invitation; and sign in using the real OIDC authorization-code/PKCE flow. The owner must claim the invitation and see only the synthetic linked vehicle. Do not insert a session, claimed invitation, or owner relationship merely to satisfy a test. If the approved evidence/command path cannot be exercised safely, mark this acceptance case incomplete.

## Verification and limits

The private login guide pairs each VMMS role with the generated identity-provider username and password. Use the username shown there; the `vmms.*.local` values in the persona manifest identify VMMS staff records and are not the Keycloak login usernames.

The generated web origin is authoritative for the local rehearsal. Start Vite from `apps/web` with `VMMS_WEB_PORT` set from the private installation state, and set its API proxy target from that same installation's API port. Do not silently fall back to the shared `5173`/`4100` development listeners for a role fixture.

Verify every persona through real local OIDC and the expected VMMS workspace. Check exact site scope, reporting links, Head/Operator mutual denial, no sign-off grants, protected-command denials, owner/staff audience isolation, invitation replay, logout and session revocation. Use synthetic records and sanitized evidence only. Login success does not complete a role's unimplemented workbench or prove production readiness. Keep AUTH-013 in progress until every acceptance case has evidence.

This design does not connect to production identity, the live portal database, real staff, email delivery, or production deployment. Local fixture implementation and production identity enrollment are separate tasks.

# Identity data boundary for the API runtime

**Status:** implementation contract for the PostgreSQL least-privilege correction. The product continues to authenticate staff through the shared OIDC identity service; the local password endpoint exists only in the test environment.

## Problem found

Migration 001 grants `vmms_runtime` table-wide reads on `staff_users`, `memberships`, `sites` and `organisations`, plus direct session writes. `staff_users` includes `password_hash`. Migration 003 grants direct reads of `staff_identities` and reads/writes on `oidc_login_transactions`, which stores OIDC nonce and PKCE verifier state. Current API code selects narrow rows, but the runtime role can bypass those query predicates with direct SQL.

## Boundary

- The runtime cannot read credential hashes, session token hashes, identity-subject mappings, OIDC nonce/verifier state, or the entire organisation/site directory through direct SQL. Without transaction-local scope, staff, membership and site queries return no rows. Within a transaction, RLS limits accidental queries to the selected site.
- Staff and membership reads from ordinary API queries require transaction-local organisation/site scope. Staff profiles are visible only to the active site context (including the current actor); memberships and sites are limited to that same organisation/site.
- Session and OIDC login transaction operations use schema-qualified, fixed-search-path security-definer database functions. Their NOLOGIN owner has only explicit RLS read policies and narrow table grants; it does not have BYPASSRLS. The API can look up the active account for a session token hash, enumerate that account's active sites, validate its requested site, create/revoke a session, and atomically consume an OIDC transaction bound to state and browser-binding hashes. The database cannot prove that the API verified an OIDC response: session creation is a trusted-application capability, so a compromised runtime credential could call it for any active user.
- Direct table privileges on session, OIDC identity and OIDC transaction tables are removed from `vmms_runtime`. The function owner is non-login and separate from the API role. The API role remains non-owner and `NOBYPASSRLS`; app startup continues to enforce that condition.
- The `/api/v1/session` password route remains test-only. Tests inject a separate privileged credential pool for synthetic test login; business requests and session reads still execute as `vmms_runtime`.

## Required checks

Using a disposable PostgreSQL database and the actual non-owner `vmms_runtime` role, verify that credential-hash, session, identity-mapping and OIDC-transaction table reads/writes are denied; profile, membership and site reads return no rows without scope and only the selected site within a transaction; pool reuse clears the prior site; OIDC login, one-time callback consumption, logout/revocation and multi-site session rendering still work; and disabled/suspended staff cannot obtain or retain a session. Do not query production credentials or data for these checks.

This is defense in depth for a trusted application runtime, not containment for a stolen runtime credential. RLS context uses application-set PostgreSQL settings that any holder of the runtime credential can spoof in a direct SQL session; this protects against omitted scoping in ordinary code, but does not independently authenticate the tenant to PostgreSQL. Session creation likewise trusts the API to verify OIDC before calling the function. Keep production ingress, identity-provider and database credentials separately restricted and monitored.

# VMMS OIDC browser sign-out implementation check — 14 November 2026

## Result

VMMS now has a CSRF-protected RP-initiated sign-out route. It revokes both local VMMS browser audiences first, then returns either an exact Keycloak logout URL or a local sign-out result with a provider-unavailable state. A fixed signed-out page offers separate staff and vehicle-owner sign-in links.

## Verified locally

- `npm exec --workspace @vmms/api -- tsx --test test/oidc-client.test.ts` — 3 passed, including discovered end-session URL construction with the exact client, callback and state and no `sid` or `id_token_hint`.
- `npm exec --workspace @vmms/api -- tsx --test --test-name-pattern="RP-initiated browser sign-out" test/foundation.test.ts` — passed against disposable PostgreSQL using the non-owner runtime role. It verifies CSRF denial, invalid destination rejection, removal of the unsigned GET route, staff and owner session revocation, one-use browser-bound state, fixed callback destination and replay denial.
- The provider-outage PostgreSQL test passed: local sessions remain revoked and the API reports `centralLogout: unavailable`.
- `npm run typecheck --workspace @vmms/api` — passed.
- `npm run typecheck --workspace @vmms/web` — passed.
- `npm run build --workspace @vmms/web` — passed.
- `npm test --workspace @vmms/api` — 139 passed, 1 optional local-storage integration case skipped, 0 failed (140 total).
- `npm run docs:generate` and `npm run docs:check` — passed (256 requirements, 684 tasks, 350 source blocks).
- `git diff --check` — passed. Git reported only line-ending normalization warnings for pre-existing mixed-ending files.
- `python -m py_compile C:\Projects\raymond-gray-auth\scripts\register-local-vmms-client.py` — passed.

An earlier API run exposed a test assertion that assumed `set-cookie` was always an array. The test was corrected, then the focused PostgreSQL test and complete API suite both passed.

## Local provider setup attempt

The loopback-only Keycloak/PostgreSQL compose services reported healthy. The updated local client-registration script now sets the exact callback `http://127.0.0.1:4100/api/v1/auth/oidc/logout/callback` as Keycloak's post-logout redirect and writes `OIDC_LOGOUT_CALLBACK_URL` to the ignored VMMS `.env` when run successfully. Its latest invocation returned a generic setup failure; the script intentionally did not expose its error body or credentials. No production service was contacted. The registered local callback and actual browser round-trip remain unverified.

## Remaining boundaries

This is local API/client work, not production identity acceptance. Keycloak callback registration, browser behavior without manually clearing IdP cookies, Google federation, provider account-disablement/recovery, other products' session handling and production operations remain open under IDP-005, IDP-006 and REV-056.

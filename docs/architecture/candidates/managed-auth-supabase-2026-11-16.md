# Managed Supabase identity candidate

Status: candidate for review, 16 November 2026. This is a plan, not an accepted replacement or runtime proof. No deployment, account, DNS, production data, or secret changed. The user's no-container and no-Railway direction governs the proposed target. Existing Keycloak remains untouched during review.

## Caller flow

A staff member opens VMMS and chooses Sign in. The VMMS server creates a short-lived, single-use authorization attempt with state, nonce, and S256 PKCE. It redirects through Supabase's managed authorization endpoint to Raymond Gray's existing-direction login interface at auth.raymond-gray.org. That interface uses a server-side authentication adapter for password or Google verification, followed by required MFA. The auth website keeps provider tokens server-side and gives its browser an opaque, host-only HttpOnly cookie.

The auth service resolves the requesting registered client and requested identity scopes, obtains consent, and asks Supabase to complete the authorization. The VMMS server exchanges the returned code and validates the issuer, subject, audience, signature, expiry, nonce, state, and PKCE result. It maps the provider identity to an existing application UUID through an explicit reviewed mapping, then creates its own host-only HttpOnly Secure session. Browsers never receive provider refresh tokens or VMMS database credentials.

After login, a workshop command still follows the existing VMMS boundary: current application session, active organisation/site membership, current named grants, expected version, safety facts, and one PostgreSQL transaction. The transaction persists the mutation, audit event, idempotency receipt, and outbox record together. Supabase Auth does not decide G1–G5, technical authority, payment verification, or release eligibility.

Supabase supports OIDC, authorization code with PKCE, confidential clients, and a configurable authorization interface. Its OAuth server is explicitly beta. The proposed server-side adapter around the documented interface must be proved with synthetic identities; the documentation's browser examples are not evidence that our token-storage contract works unchanged. See [OAuth setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started) and [OIDC flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows), checked 16 November 2026.

## Deployment and ownership

| Unit | Proposed runtime | Owns |
| --- | --- | --- |
| Shared auth website | Vercel static UI and Node Functions | Existing Raymond Gray presentation, opaque auth sessions, consent UI, recovery and enrollment interface |
| Managed identity | Hosted Supabase Auth | Password verification, Google brokerage, MFA, identity subjects, OAuth issuance |
| VMMS web and API | Vercel static UI and Node Functions | Same-origin /api/v1 routing, first-party sessions, all domain commands and audit |
| Business persistence | Isolated Supabase PostgreSQL database/schema and restricted runtime roles | Canonical VMMS records, RLS, locks, transactions, outbox, application sessions |
| Evidence objects | Private Supabase Storage or private R2, selected once in synthesis | Pending/quarantined objects and accepted objects, with no public bucket |
| Scheduled delivery | Bounded managed jobs invoking leased outbox handlers | Idempotent provisioning, delivery retries, reconciliation |
| Malware acceptance | Managed scanning adapter, exact service unresolved | An authenticated scan result bound to the exact object identity and hash |

There are no user-managed containers in this target. Supabase uses managed infrastructure internally; the application team does not operate that infrastructure. Do not move Fastify unchanged into Cloudflare Workers: the recorded router code-generation failure remains evidence against that shortcut. Vercel Node Functions are the API candidate because they preserve Node libraries and require less transport change. Upload and scanner redesign remain separate compatibility work.

Keep these boundaries in the eventual implementation. The names describe proposed module responsibilities, not existing files:

- IdentityProviderAdapter: authorization metadata, code exchange, verified identity, refresh and provider logout capabilities.
- CentralAuthSessionStore: encrypted provider-token storage, refresh serialization, central session epoch, expiry and revocation.
- ProvisioningAdapter: approved invitation requests, provider-admin calls, idempotency, enrollment acknowledgements.
- ProductSessionStore: existing product session creation/revocation and immutable local actor mappings.
- Existing command modules and transaction runner: unchanged business ownership, with a restricted PostgreSQL connection adapter.
- Job adapters: bounded lease acquisition and retries, with the durable outbox as source of truth.

Supabase service/admin credentials belong only in privileged server-side provisioning. The business API uses a separate non-owner role without RLS bypass. No generic browser Data API access is granted to VMMS business tables. Migration credentials remain separate.

## Branding and hostname

The auth website can remain at auth.raymond-gray.org on Vercel. That branded UI hostname does not automatically change the managed OAuth issuer or Google's callback domain. Without the Supabase custom-domain add-on, protocol URLs use the project's supabase.co hostname. A custom Supabase API hostname requires a paid plan and the paid domain add-on. Do not point one DNS name simultaneously at the Vercel UI and Supabase gateway or invent a reverse proxy to hide that distinction. Select a distinct protocol hostname if the paid option is chosen. The exact issuer is a reviewed security setting, not display text. See [custom domains](https://supabase.com/docs/guides/platform/custom-domains), checked 16 November 2026.

Preserve the approved Raymond Gray login treatment. New branding concepts are outside this plan.

## Feature parity and selection blockers

Supabase has password sign-in, Google sign-in, TOTP MFA, and privileged user invitations. Invitation delivery needs a reviewed sender and external email service; its default SMTP is unsuitable as a production delivery assumption. See [passwords](https://supabase.com/docs/guides/auth/passwords), [Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [MFA](https://supabase.com/docs/guides/auth/auth-mfa), [user management](https://supabase.com/docs/guides/auth/users), and [SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

Three issues prevent treating this as a drop-in replacement:

1. Supabase documents automatic linking of same-email OAuth identities. The existing Raymond Gray contract forbids automatic same-email linking and requires proof of both identities. No supported disable control was established in this review. Selection requires a supported, tested policy-preserving configuration, or a separately reviewed policy change. Do not add a brittle trigger to managed auth tables or silently relax the rule. See [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking).
2. Supabase passkeys exist but are explicitly experimental. Their API can change without notice. A synthetic test must establish user verification, auth.raymond-gray.org RP/origin handling, enrollment, removal, recovery, and shared-device behavior. Existing Keycloak credentials cannot be assumed portable. See [passkeys](https://supabase.com/docs/guides/auth/passkeys).
3. The reviewed OAuth guides do not establish parity with Keycloak's RP-initiated logout and back-channel logout behavior. Do not claim discovery exposes the required logout endpoint. Implement and prove a deliberate central revocation contract before replacing the current adapter.

MFA assurance must reach the relying party as verified evidence. A login page saying MFA passed is insufficient. Prove the relevant token claims or a signed server-to-server result and freshness policy without placing business grants into global tokens.

## Logout and account administration

App-local logout immediately revokes the VMMS session in its own database and clears its cookie. Shared-device central logout must additionally revoke the central auth session, revoke the provider refresh session, and invalidate other application sessions through an authenticated idempotent event contract. Product access suspension remains independent and takes effect at action time.

Supabase's global/local/others signout scopes revoke refresh sessions, but already-issued JWTs remain usable until expiry. Therefore token verification alone cannot establish immediate global suspension. Our local session epochs/revocation checks must be authoritative, with a proved event delivery and failure policy. See [signout](https://supabase.com/docs/guides/auth/signout) and [sessions](https://supabase.com/docs/guides/auth/sessions).

Keep Operator and Head duties separate. The Operator requests account lifecycle changes through audited commands. A bounded outbox handler calls the privileged provider API, records the outcome, and sends only an approved invitation. The Head assigns approved local role profiles; neither role gets technical or financial grants from identity administration. Preserve the existing invitation expiry/resend contract, or explicitly document a reviewed difference after provider testing.

## Alternatives and rationale

Supabase combines managed identity, PostgreSQL, and private storage, reducing the number of service adapters. It also retains standards-based OIDC integration, subject to beta risk and the linking blocker.

Neon is a valid PostgreSQL alternative and now has Managed Better Auth, including an OAuth provider for other applications. Its provider is described as beta in the official November update. It is incorrect to dismiss Neon as database-only. Compare its actual managed plugin coverage, passkeys, MFA, linking controls, logout, and custom-domain behavior before selection. Do not assume that every upstream Better Auth plugin is available in Neon's managed service. See [Neon managed identity](https://neon.com/docs/auth/overview), [OAuth provider](https://neon.com/docs/auth/guides/plugins/oauth-provider), and [10 November update](https://neon.com/blog/whats-new-with-the-neon-backend).

Reject retaining Keycloak on a different container service because it conflicts with the user's target. Reject rebuilding an OAuth issuer or WebAuthn verifier to avoid a managed service. Reject embedding all domain authorization into provider roles. Reject choosing a provider solely because its demo is free.

## Migration and rollback

Prepare new managed services only in an isolated synthetic environment after the concrete configuration is approved. Do not use production credentials for the spike. Inventory actual relying parties, user counts, recovery methods, and existing provider grants before designing the exact cutover.

Use an immutable mapping from old issuer/subject to local actor UUID and new issuer/subject. Preserve local actor IDs, audit attribution, site memberships, grants, and financial records. Same email never supplies that mapping. Password-hash import is provider-format dependent; do not promise Keycloak credential migration. Prefer reviewed re-enrollment and recovery for a small initial staff set. Supabase supports certain imported password hashes, but that is not Keycloak portability proof. See [migration guidance](https://supabase.com/kb/guides/migrate-from-auth0).

Switch one relying party at a time using environment-specific exact clients. Revoke old app sessions on cutover, require fresh authentication, and retain the old issuer mapping and recovery evidence. Keep production business writes in one authoritative database. A rollback restores the previous issuer configuration and requires fresh sign-in; it does not merge two diverged business databases or recover newly enrolled credentials automatically. Retire the old service only after full sign-in, logout, revocation, recovery, and rollback evidence is accepted.

## Validation and cost gates

The compatibility spike must cover the real OIDC library, confidential exchange, state/nonce/PKCE replay rejection, exact redirects, wrong issuer/audience denial, server-only tokens, MFA freshness, closed registration, Google linking denial, invitation expiry/retry, refresh races, immediate product suspension, central revocation, recovery, and two-product SSO. Run PostgreSQL transaction/RLS/lock and tenant-reuse checks through the selected pool. Exercise private uploads, malicious/timeout scan results, concurrent jobs, accepted-object access, and a measured restore. Provider documentation is not runtime evidence.

As checked on 16 November 2026, Supabase Pro starts at USD25/month, while its custom API domain adds USD10/month. These figures exclude additional compute, Vercel, mail, scanning, storage, egress, tax, and recovery requirements. The OAuth server has no separate charge but counts users toward MAUs. Free plans can support a synthetic evaluation; do not label a production shared-identity and recovery design permanently free. See [pricing](https://supabase.com/pricing), [domain charging](https://supabase.com/docs/guides/platform/manage-your-usage/custom-domains), and the OAuth setup page above.

Recommendation: retain this as a coherent managed-services candidate, but do not select it until same-email linking, experimental passkeys, and central logout/revocation meet the current contract. A no-container target is feasible; Supabase parity with the current identity requirements remains unproved.

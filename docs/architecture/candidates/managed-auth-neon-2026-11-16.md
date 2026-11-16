# Candidate: Neon-centred managed hosting without Railway or containers

Status: independent architecture candidate, 16 November 2026. Planning only. No provider, DNS, production data, credentials, real identities or notifications changed. This candidate does not replace the accepted system design or authentication contract. Its auth option has launch blockers described below.

## User journey and request flow

A staff member opens VMMS at the approved product hostname. Anonymous requests may view the existing public entry. Protected work redirects through a maintained OpenID Connect client to the central sign-in experience at auth.raymond-gray.org. That hostname hosts the Raymond Gray login and consent interface; in this candidate the actual authorization server remains Neon Managed Better Auth. Do not represent the branded interface hostname as the OIDC issuer unless Neon documents and successfully provisions a custom issuer domain.

The provider handles credentials and account authentication. The VMMS callback verifies state, nonce, S256 PKCE, signature, exact issuer and audience, then maps the immutable issuer/subject pair to an explicitly linked local identity. The browser receives a Secure, HttpOnly, host-only product-session cookie. Product access still requires active local site membership. No parent-domain cookie, browser refresh token, email-based account linking or identity-provider role grants business authority.

The staff member submits a bounded JSON command. The Vercel Node Fastify API authenticates the local session, checks CSRF, loads current membership and signed action grants, acquires existing transaction-scoped locks, evaluates independent gates, rejects stale versions, and atomically commits the business mutation, audit event, receipt and outbox record in Neon PostgreSQL. A serverless invocation ending never ends a durable job; the database/outbox remains the source of pending work.

For an attachment, the API creates a scoped upload intent and returns a short-lived signed S3 upload capability. The browser uploads bytes directly into a private quarantine prefix, bypassing Vercel's small request-body limit. The signed upload binds the allocated key and required checksum, and browser CORS accepts only approved product origins. An upload is not evidence. The API does not accept a caller's clean-scan assertion.

S3/GuardDuty produces a scan-result event. EventBridge sends it to SQS, which invokes a ZIP-packaged Lambda handler. The handler verifies the configured account, bucket, object key and version, reconciles the intent, validates actual size, checksum and permitted content, and calls the evidence acceptance transition using a dedicated worker database role. Duplicate messages return the prior result. Only a verified clean exact object version becomes accepted; skipped, failed, unsupported, encrypted or missing results stay unavailable for gates. Download authorization returns a short-lived signed GET for the accepted version after recording access. Ordinary downloads also bypass Vercel's response-body cap.

## Hosting and module boundaries

| Unit | Candidate runtime | Responsibilities |
| --- | --- | --- |
| Existing VMMS React/Vite application | Vercel static deployment | Existing branding, accessible workflows, direct-upload progress and scan-pending/failure states |
| VMMS Fastify command API and OIDC relying party | Vercel Node Functions, not Edge | Session/CSRF, grants, gates, canonical commands, signed upload/download intents |
| VMMS canonical records | Isolated Neon PostgreSQL project/database | Existing migrations, RLS, transactions, locks, audit, receipts, evidence metadata, durable outbox |
| Shared sign-in interface | Vercel at auth.raymond-gray.org | Existing brand, Neon-supported SDK login/consent UI; no bespoke credential protocol |
| Shared identity | Separate Neon Managed Better Auth project | Managed user authentication and OAuth/OIDC provider, distinct clients per application/environment |
| Evidence bytes | One private, versioned AWS S3 bucket | Separate quarantine/accepted namespaces or policy scopes, version-specific access, retention/backups |
| Malware scanning | GuardDuty Malware Protection for S3 | Managed scan engine without a customer-maintained daemon |
| Durable scan delivery | EventBridge → SQS + dead-letter queue → Lambda ZIP | Retryable result reconciliation, idempotent acceptance, poison-message review |
| Other durable jobs | Existing PostgreSQL outbox + bounded scheduled Lambda ZIP dispatcher | Lease bounded batches, persist attempt/result, retry same idempotency key; never fire-and-forget |
| DNS and optional edge | Cloudflare DNS | Approved records only after review; no forced Fastify migration to workerd |

Keep provider adapters small. Suggested interfaces are IdentityProviderClient for OIDC discovery/callback/logout, SharedAuthProvisioningClient for the existing operation ledger, EvidenceUploadBroker for signed capabilities, EvidenceScanResultConsumer for version-bound scan results, and OutboxBatchRunner for bounded leased processing. Domain command modules remain in apps/api; provider adapters belong at runtime boundaries. A single domain implementation is shared by HTTP and job handlers. Do not copy gate or authority rules into Workers, SDK callbacks, database-provider policies, or frontend logic.

## Neon managed identity: current capabilities and gaps

The managed plugin set now includes Admin, email OTP, magic link, JWT, phone number and an OAuth Provider; Organization support is partial. It is not equivalent to installing arbitrary upstream Better Auth plugins. Admin APIs support user creation and session revocation. The staff-provisioning adapter must use supported server-side management credentials or a maintained admin mechanism; do not store a human admin session or invent client-credentials OAuth that the provider does not implement. [Managed plugins](https://neon.com/docs/auth/guides/plugins), [Admin](https://neon.com/docs/auth/guides/plugins/admin).

The new OAuth/OIDC provider supports confidential clients, PKCE and exact callback registration. Host the login/consent UI. Pin issuer and audience because branches share signing keys. Do not derive issuer strings manually. The OAuth client SDK is beta, and its sign-in cookie code requires Node. No client_credentials grant exists. Token revocation, central logout and session reconciliation must be proved against the existing contract rather than inferred from an endpoint name. [OAuth Provider](https://neon.com/docs/auth/guides/plugins/oauth-provider).

The 9 November roadmap still places managed MFA on the roadmap; application passkeys are not in the supported managed plugin matrix. Neon-console passkeys are a different feature. The existing Raymond Gray baseline explicitly requires passkeys with user verification at auth.raymond-gray.org. This candidate cannot claim that requirement satisfied today. No custom passkey implementation or app-local MFA patch is proposed. Provider confirmation and a working supported integration are selection gates; otherwise select another managed identity provider. [Roadmap](https://neon.com/docs/auth/roadmap), [existing contract](../authentication.md).

Trusted-domain allowlisting authorizes redirects/origins; it does not establish a custom OIDC issuer or DNS mapping. A branded Vercel UI can be an allowed login origin while the issuer remains Neon-hosted. Verify Safari/iOS cookie behavior, SDK proxy support, login-page return validation and first-party session behavior in an isolated spike before selecting this flow. [Trusted domains](https://neon.com/docs/auth/guides/configure-domains).

Closed enrollment, 24-hour invitation expiry, one resend, recipient proof, one-time bootstrap/recovery and immutable subject linking remain required. A provider's create-user API is only an adapter capability, not evidence that the approved workflow is complete. Preserve the provisioning ledger and its ambiguous-delivery state. Replace Keycloak-specific invocation with managed APIs after proving invitation/claim semantics; never expose provider administration to VMMS Operators or auto-activate membership.

## Storage choice and alternatives

Choose S3 plus managed GuardDuty for this candidate because private versioned objects, managed malware events and durable event delivery form an explicit no-container path. This adds an AWS account and costs; it avoids assuming ClamAV can run in a Vercel invocation or that an R2 event is a clean scan. GuardDuty results are delivered at least once; no-result and non-clean states must fail closed. [GuardDuty process](https://docs.aws.amazon.com/guardduty/latest/ug/how-malware-protection-for-s3-gdu-works.html), [EventBridge result schema](https://docs.aws.amazon.com/guardduty/latest/ug/monitor-with-eventbridge-s3-malware-protection.html), [SQS processing](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html).

Presigned URLs are reusable until expiry. Use random intent-specific keys and version-specific acceptance/downloads, bind checksum, cap URL lifetime and validate actual bytes before acceptance. Enabling versioning alone is not backup, and a key alone is not immutable identity. Prevent overwrites from silently changing evidence by storing the accepted version ID. [S3 presigning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).

Neon now has S3-compatible private object storage with server-generated presigned URLs and branch-scoped credentials. It is a real alternative, not a missing product. However, its compatibility matrix supports only a subset of S3; versioning configuration is not enforced and bucket event notifications are unsupported. No equivalent managed version-bound malware-result pipeline was established in this review, so it is not the selected evidence store. [Storage](https://neon.com/docs/storage/overview), [credentials](https://neon.com/docs/storage/authentication), [compatibility](https://neon.com/docs/storage/s3-compatibility).

R2 plus Queues is another plausible upload/event path, but still needs a trustworthy scanner. Cloudflare WAF malware scanning is Enterprise plus a paid add-on, not a free default. Do not upload private workshop records to a public malware-analysis service to obtain free scanning. [Cloudflare malware detection](https://developers.cloudflare.com/waf/detections/malicious-uploads/).

Supabase Auth is the stronger managed-auth comparison at this date: it documents TOTP/phone MFA and native passkeys marked experimental, plus an OAuth 2.1 provider beta. Its branded custom domain is a paid-plan add-on. It may satisfy more of the current identity scope, but exact passkey RP/origin policy, invitation-only enrollment, revocation and OIDC assurance still need tests. A Supabase identity project may coexist with the VMMS Neon database, keeping issuer/subject mapping and product sessions unchanged. Do not migrate the canonical database merely to choose its identity provider. [MFA](https://supabase.com/docs/guides/auth/auth-mfa), [passkeys](https://supabase.com/docs/guides/auth/passkeys), [OAuth server](https://supabase.com/docs/guides/auth/oauth-server/getting-started), [custom domains](https://supabase.com/docs/guides/platform/custom-domains).

## Delivery sequence, verification and rollback

1. Record owner decisions on supported auth requirements, beta acceptance, region, retention, recovery objectives and paid production services. Neon-only managed auth stays a conditional option until passkey/MFA and hostname gaps close.
2. Build isolated synthetic spikes: Fastify on Vercel Node; Neon restricted runtime role; actual pooled transactions and transaction-local RLS; non-owner migration separation; OIDC callback/session/CSRF; direct uploads and clean/malicious/error scan results. No live notifications.
3. Replace streamed API upload/download endpoints with intent/finalization/version-specific access contracts and UI states. Test expired/reused capabilities, oversize upload, checksum mismatch, overwrite race, event-before-finalization, duplicate/reordered results, abandoned upload cleanup and cross-tenant access. Acceptance and audit mutations remain atomic.
4. Refactor polling workers into bounded batch handlers with leases and persisted attempts. Verify outbox commit-before-enqueue, crash after external success, retry convergence, dead-letter recovery, account-provisioning ambiguity and no authority side effects.
5. Run the full API/PostgreSQL race and RLS suite, browser/device checks, restore drill and security checks. Repeat with the selected hosted runtimes; local or SQLite tests do not prove hosted PostgreSQL concurrency.
6. Prepare exact infrastructure manifests, secret names, budget alert, hostname records, provider configuration and rollback artifact for review. No external changes until authorized.

Use additive schema changes and keep prior application artifacts deployable until acceptance. Identity migration maps a reviewed old issuer/subject to a new pair with explicit proof; never relink by email or copy credential hashes opportunistically. Existing identities remain on the old provider until each approved cohort enrolls. Do not claim passkeys migrate across relying-party IDs. Reverting releases must retain new audit/evidence records and use a compatible database version. Failed scanning delivery leaves pending evidence, not accepted evidence. Keycloak can remain a local reference but no container is part of the proposed hosted target or rollback dependency; before cutover, a validated prior managed-provider configuration or maintenance/closed-access rollback must exist.

## Costs and unresolved proof

Neon's current published Free plan includes up to 60,000 managed-auth MAU. That does not prove adequate database capacity, restore history or production support. Custom SMTP is a production checklist item. [Neon plans](https://neon.com/docs/introduction/plans), [auth production checklist](https://neon.com/docs/auth/production-checklist).

S3 storage/requests/egress, EventBridge, SQS and Lambda are separately metered. GuardDuty's published US East example is USD 0.09 per GB scanned plus USD 0.215 per 1,000 evaluated objects; its stated monthly allowance is 1 GB and 1,000 objects. Check the actual region and current bill before budgeting. This is not an entirely free production architecture. [GuardDuty pricing](https://aws.amazon.com/guardduty/pricing/).

Vercel commercial-plan eligibility and actual limits, Neon region/recovery/connection limits, managed auth beta stability, supported custom issuer domains, managed passkeys/MFA, central logout/revocation, provisioning machine identity, mail deliverability and scan-result/version behavior remain evidence gates. This candidate demonstrates a plausible managed path without Railway or customer-managed containers. It does not establish readiness to deploy.

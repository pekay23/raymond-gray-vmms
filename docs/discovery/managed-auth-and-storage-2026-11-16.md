# Managed authentication and evidence storage comparison

Reviewed: 16 November 2026. This is a source-based comparison, not a provider configuration or runtime test. Existing credentials were not read. The owner rejects Railway and user-managed containers, including for the replacement local/staging workflow. The approved branding and business requirements remain binding.

## Recommendation

Use the Supabase-centred candidate as the conditional design base. Prefer Vercel for the two application repositories and the existing Fastify Node API, Supabase Auth plus PostgreSQL for identity and canonical persistence, and Cloudflare R2 plus Workers/Queues for evidence transport and bounded jobs. A private managed malware-scanning API replaces the resident ClamAV process. This does not require another database or a second live evidence store.

Supabase is closer to the current identity contract, but is not yet a proven replacement. Its account-linking behavior is an unresolved policy conflict. Its OAuth server is beta and passkeys are experimental. Resolve these gates before committing to a production cutover. If no supported configuration meets the identity-linking contract, report that the provider cannot meet the unchanged requirement; do not disguise the conflict with a trigger or waive the requirement through a test.

Neon PostgreSQL remains a valid alternative to Supabase PostgreSQL. The auth choice does not technically require a database migration. The recommended consolidation assumes one managed PostgreSQL home is operationally simpler and avoids paying for two platforms solely to separate vendors. Inventory the actual current database, data volume, backup requirements and existing paid accounts before the final hosting bill is accepted.

## Identity comparison

| Capability | Neon Managed Better Auth | Supabase Auth | Consequence |
| --- | --- | --- | --- |
| Managed runtime | Generally available managed Better Auth | Managed Auth | Neither needs a customer-operated identity container |
| Sign other products in | OAuth/OIDC provider now available; beta | OAuth 2.1/OIDC server; beta | Both need registered clients, discovery and real confidential-client tests |
| Password and Google | Managed methods documented | Managed methods documented | Prove closed enrollment, verified email, recovery and collisions |
| Application passkeys | Not established in supported managed plugin list | Documented, explicitly experimental | Supabase is closer to USER-020; exact RP/origin and required user verification remain gates |
| MFA | Current roadmap lists MFA as coming soon | TOTP and phone MFA documented | Supabase has the stronger documented baseline; prove assurance/freshness reaching the RP |
| Custom login interface | Application hosts login and consent | Application hosts authorization/login interface | auth.raymond-gray.org can remain a Vercel-hosted branded website |
| Custom issuer hostname | No supported managed custom issuer was established | Paid custom API domain documented | UI hostname and actual issuer are separate settings |
| Explicit identity linking | Must verify managed controls, not upstream plugin assumptions | Same-email OAuth identities automatically link | Supabase conflicts with the existing no-auto-link policy; supported resolution or an explicit reviewed policy change is mandatory |
| Immediate global logout | Needs provider-specific proof | Refresh sessions can be revoked; existing JWTs survive until expiry | Product session revocation and callback race protection remain necessary |
| Invitations/admin | Managed admin plugin, machine-identity scope needs proof | Server-only admin APIs documented | Neither API alone satisfies the approved Operator lifecycle |

Neon's base managed product being generally available does not make its OAuth plugin generally available. Supabase consuming Google/OIDC identities is different from Supabase acting as the provider for other Raymond Gray apps. Neither feature should be inferred from the other.

Official sources: [Neon overview](https://neon.com/docs/auth/overview), [Neon roadmap](https://neon.com/docs/auth/roadmap), [Neon OAuth provider](https://neon.com/docs/auth/guides/plugins/oauth-provider), [Supabase OAuth setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started), [Supabase OIDC flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows), [Supabase passkeys](https://supabase.com/docs/guides/auth/passkeys), [MFA](https://supabase.com/docs/guides/auth/auth-mfa), [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), [signout](https://supabase.com/docs/guides/auth/signout), [custom domains](https://supabase.com/docs/guides/platform/custom-domains).

## Choose one primary evidence store

Neon Object Storage is a real S3-compatible service. It supports core object operations, scoped credentials and server-generated presigned URLs. Its current compatibility matrix says object versioning and lifecycle configuration are not enforced and bucket notifications are unavailable. Branching storage can also copy access to private evidence into child branches; do not branch production identity or evidence into developer previews. This review did not establish parity with the proposed R2 event and retention path. [Neon storage](https://neon.com/docs/storage/overview), [credentials](https://neon.com/docs/storage/authentication), [S3 compatibility](https://neon.com/docs/storage/s3-compatibility).

Choose R2 for the primary quarantine and accepted evidence buckets. R2 offers documented object events to Queues, presigned upload support and bucket-lock retention rules. These facilities still require application-level authorization, immutable keys, exact-byte validation, scans and restore proof. Do not claim S3 version IDs or unconditional immutability. Apply approved retention rules only after policy review; a bucket lock is not an independent backup. [Events](https://developers.cloudflare.com/r2/buckets/event-notifications/), [presigning](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/).

Neon Storage can later be assessed for an independent backup copy or substituted as the single primary store after equivalent tests. Do not dual-write evidence by default. A second store needs an authoritative manifest, checksums, restore tests, independent access and a defined replication lag.

## Replace the scan daemon with a managed service

attachmentAV is a concrete candidate, not a selected processor or purchased subscription. Its documented SaaS API accepts asynchronous scans using a download URL, signs result callbacks, and has a vendor R2 integration example. A Worker can supply a short-lived read capability for a sealed quarantine object and reconcile the authenticated result without running ClamAV. [API](https://attachmentav.com/help/virus-malware-scan-api/developer/definition.html), [vendor R2 example](https://github.com/widdix/attachmentav-example-cloudflare-r2-virus-malware-scan).

Private files would be processed by an additional third party. Its DPA describes prompt deletion of file contents but separate metadata retention. Exact region, retention, subprocessors, signed callback validation, file limits and price need review. The existing keys for R2 or Neon do not purchase or configure scanning. No customer file may be sent as part of this planning work. [DPA](https://attachmentav.com/dpa/).

The alternatives are another private managed scanning API or a managed S3/GuardDuty pipeline. The latter is viable without user-managed containers but adds AWS services and is not the initial recommendation. Cloudflare storage or a queue event does not itself certify a file clean.

## Cost and account decisions

Supabase Pro currently starts at USD25/month. Its custom API domain adds USD10/month and is optional when only the branded login UI needs auth.raymond-gray.org. Separate production identity and business projects, stronger recovery features, extra compute and mail can increase the bill. [Supabase pricing](https://supabase.com/pricing), [domain billing](https://supabase.com/docs/guides/platform/manage-your-usage/custom-domains).

Budget an eligible Vercel commercial plan, Cloudflare Workers/Queues/R2 usage, managed scanning and production SMTP. Existing paid plans may cover some items; account entitlements were not inspected. Vercel Hobby is restricted to personal/non-commercial use. Free tiers are useful for synthetic evaluation but do not establish production availability or recovery. [Vercel terms](https://vercel.com/legal/terms), [Vercel pricing](https://vercel.com/pricing), [Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Candidate synthesis

Both candidates were read in full and independently cross-reviewed. Scores out of five for owner constraints, identity coverage, safety preservation, operational burden and delivery/recovery were Neon 4/3/3/2/4 = 16/25 and Supabase 4/4/4/4/4 = 20/25. Scores compare plans; they are not security certification or runtime evidence.

The Supabase candidate supplies the simpler primary platform and stronger documented auth methods. Graft the Neon candidate's exact-object scan binding, overwrite/event-order tests, bounded leased jobs and closed-access rollback. Select R2 and a managed scan adapter in place of an unresolved store or AWS expansion. Reject bare signed downloads, an automatic Keycloak rollback, a rewritten OAuth issuer, and any weakening of product grants. The primary plan keeps adapters at provider boundaries rather than creating a new interface for every module.

Sources of current architecture/rationale: shared-identity.md, authentication.md, oidc-vmms-integration.md, evidence-storage.md, shared-auth-provisioning.md, the decision log, current auth README/Dockerfile and the owner's 16 November instruction. Historical Git commits include f15920a, ff178cf and 96d1858. No issue/chat/observability/analytics source was used to infer production behavior. Provider documentation establishes capability claims only.

Candidates: [Supabase](../architecture/candidates/managed-auth-supabase-2026-11-16.md), [Neon](../architecture/candidates/managed-auth-neon-2026-11-16.md). Execution plan: [managed services redesign](../delivery/managed-services-redesign-plan-2026-11-16.md).

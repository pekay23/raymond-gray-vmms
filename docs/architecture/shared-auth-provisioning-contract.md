# VMMS account provisioning through shared auth

**Status: Proposed for owner review.** This contract does not authorize provisioning real identities, sending invitations, or enabling a production service. The shared-auth repository requires a reviewed implementation plan before user provisioning.

## Purpose and ownership

VMMS Operators need a controlled way to request staff account setup without receiving identity-provider administrator access. VMMS already records an Operator request, audit event, idempotency receipt and outbox item in one transaction, and a separate leased worker can process that request. The shared-auth project currently has no product-facing provisioning API; its local Keycloak Admin REST scripts are test-fixture tools and are not the product integration.

Shared auth owns central identity, authentication, enrollment and invitation delivery. VMMS owns its local staff record, organization/site memberships, role placements, qualifications, signed grants, local sessions and access decisions. A central invitation does not activate a VMMS account or grant any site, work role or authority.

## Recommended service shape

Use a private, versioned, idempotent command API called only by the VMMS account worker. The shared-auth service persists the operation before starting identity or delivery work. Repeating the same command returns the same operation and current outcome; a changed request under the same idempotency key returns a conflict. Use this single command boundary first. Add a separate polling API only if an approved delivery provider's measured behavior requires it.

Proposed endpoint:

```http
POST /internal/v1/vmms/account-provisioning-operations
Idempotency-Key: <VMMS request UUID>
Authorization: <dedicated VMMS worker identity>
Content-Type: application/json
```

Request and response are service-to-service types, not browser or OIDC claims:

```ts
type StartAccountProvisioning = {
  operationId: string; // UUID; must equal Idempotency-Key
  email: string;        // destination only, never an identity key
  displayName: string;
};

type AccountProvisioningOutcome =
  | { operationId: string; state: "invitation-dispatched"; invitationReference: string }
  | { operationId: string; state: "delivery-pending" }
  | { operationId: string; state: "identity-conflict" }
  | { operationId: string; state: "rejected"; code: "invalid-request" | "policy-denied" }
  | { operationId: string; state: "retryable"; code: "temporarily-unavailable" };

interface SharedAuthProvisioningClient {
  start(input: StartAccountProvisioning): Promise<AccountProvisioningOutcome>;
}
```

`delivery-pending` must remain a pending VMMS request. It must not map to `invitation-issued`, `active`, or a permanent failure. The VMMS worker/database/UI contract needs a durable pending state and bounded retry schedule before using this outcome. `invitation-dispatched` means the approved delivery provider accepted the message; it does not mean the person enrolled or gained VMMS access. If delivery remains synchronous and the endpoint returns only terminal outcomes, the current VMMS worker may retain its smaller result type.

The API response never contains a password, passkey material, enrollment token or URL, email body, raw provider response, VMMS organization/site/role, site access, grant or stable identity subject. The `invitationReference` is opaque and safe for status reconciliation only. A later, separate, reviewed identity-claim flow must bind a verified `(issuer, subject)` to the intended VMMS staff account. Email match, invitation dispatch, or successful central sign-in alone must never link a VMMS account.

## Security and idempotency requirements

- Authenticate the caller as a dedicated VMMS provisioning worker over TLS. Bind it to a narrow provisioning permission and exact service audience; reject browser sessions, public clients, human tokens, normal API credentials and Keycloak Admin REST credentials.
- The transport mechanism (for example mTLS or a short-lived workload token), credential owner, rotation path and network policy are pending host selection and review. Never use a static shared Keycloak administrator token.
- Treat `operationId` as an idempotency key scoped to the dedicated VMMS caller. Store a canonical request digest. Same key and same request returns the existing operation; same key with changed email/display name returns a conflict without a second identity or invitation.
- A verified existing central identity returns `identity-conflict` for manual, authenticated review. Never attach an existing identity by email.
- Persist remote operation state and delivery outcomes without passwords, passkey data, invitation secrets or raw provider errors. Audit service principal, operation ID, result code and timestamps only.
- When delivery provider idempotency is available, pass the stable operation key through. Otherwise retain the delivery attempt and expose ambiguous outcomes for review; do not claim exactly-once email delivery.
- Keep account-request approval, recipient verification, notice and retention, invitation expiry/resend, and account recovery as explicit policies. Until these are approved, provisioning and invitation delivery remain disabled; use fake adapters in tests.

## Outcome mapping and lifecycle

| Shared-auth outcome | VMMS handling |
| --- | --- |
| `invitation-dispatched` | Record the opaque reference and invitation-dispatched state; do not activate VMMS access or create a role/grant. |
| `delivery-pending` | Keep the request visibly pending and retry the same operation ID. It needs a durable pending state before implementation. |
| `identity-conflict` | Stop automatic retries and show a manual review outcome. Do not link by email. |
| `rejected` | Store only an allowlisted error code and show the next approved action. |
| `retryable` or network timeout | Retry the same operation ID under the VMMS worker lease/backoff policy. A lost response after remote commit must not duplicate the operation. |

After invitation acceptance, a separate identity-claim flow must prove the central subject and bind it to the intended local staff record. Only then may an Operator explicitly grant approved VMMS site access. The Head of Service Centre remains the only role that assigns existing operational role profiles. Neither flow edits permission definitions or grants technical, inspection, release, governance or financial authority.

## Verification before enablement

Use an isolated synthetic shared-auth service and fake non-delivery adapter. Verify exact caller/audience denial, idempotent replay, changed-payload conflict, identity conflict without linking, redaction, pending delivery, timeout after remote commit, one current VMMS lease settlement, and denial of any VMMS site/role/grant side effect. Verify the later subject-claim flow separately with wrong-subject, replay, expired challenge, suspended identity and revoked-membership cases. No real email, identity provider, production database or customer/staff data is used in these checks.

## Design comparison

Two service shapes were reviewed in [`candidates/shared-auth-provisioning-sync.md`](candidates/shared-auth-provisioning-sync.md) and [`candidates/shared-auth-provisioning-async.md`](candidates/shared-auth-provisioning-async.md). The selected base is Candidate A's single idempotent command because it fits the existing VMMS leased queue and keeps the caller surface small. Candidate B's explicit distinction between identity creation, delivery pending, invitation dispatch, enrollment and VMMS activation is grafted into the outcome model. The shared-auth operation ledger makes a repeated POST return its existing state, avoiding a new polling endpoint until the delivery provider demonstrates that one is needed. The design must not map delivery-pending to the current `invitation-issued` worker result; that requires a VMMS pending-state migration before asynchronous delivery is enabled.

Direct Keycloak Admin REST from VMMS was rejected because it gives product code provider administration credentials. A second independent polling API was deferred because the VMMS worker already schedules retries and a remote operation ledger can make repeated commands idempotent. Shared tables were rejected because they couple product databases and identity internals.

## Owner review required

1. Which service-auth mechanism and owner should be used after hosting is selected?
2. Who must approve account creation and site access beyond the Operator's ability to submit a request?
3. Which email/delivery provider, destination verification, invitation expiry/resend and support process are approved?
4. Is the proposed `invitation-dispatched` meaning acceptable, and should asynchronous delivery use the additional VMMS pending state?
5. What notice, retention and recovery rules apply to the email and identity-claim operation?
6. Who owns the initial Operator bootstrap, subject-linking approval and recovery?

Until these decisions are reviewed, implement only isolated contract tests and synthetic adapters. Do not add an auth endpoint, provision real identities, send invitations, or enable the worker in production.

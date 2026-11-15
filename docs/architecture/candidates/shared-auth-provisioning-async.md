# Candidate B: Auth-owned provisioning operation

## Problem

VMMS already owns a durable, leased Operator request queue and knows its site access rules. Shared auth owns credentials and central identities, but currently has no product provisioning API. Creating a central identity and sending an enrollment message may take longer than one HTTP request and must not be described as one event when delivery has not happened. The contract must keep VMMS roles, memberships, grants, and all product authorization in VMMS.

## Usage (caller's view)

The VMMS worker submits its stable operation ID once. The shared service durably accepts that ID and owns the next steps. VMMS retries a timed-out submission with the same ID, then polls until a terminal outcome:

```ts
const accepted = await auth.startStaffEnrollment({
  operationId: claim.operationId,
  email: claim.email,
  displayName: claim.displayName,
});

const outcome = await auth.getStaffEnrollment(accepted.operationId);
// pending | invitation-dispatched | identity-conflict | rejected
```

The caller never receives a password, passkey challenge, enrollment URL, or email body. `invitation-dispatched` means the approved delivery adapter confirmed dispatch; it does not mean the person enrolled or gained VMMS access.

## Shape

The shared-auth service exposes a private product-provisioning resource, separate from browser OIDC routes and Keycloak's Admin REST API:

```ts
type StartEnrollment = {
  operationId: string; // stable VMMS request UUID; idempotency key
  email: string;       // requested destination, not identity proof
  displayName: string;
};

type EnrollmentReceipt = {
  operationId: string;
  state: 'accepted' | 'identity-created' | 'delivery-pending'
       | 'invitation-dispatched' | 'identity-conflict' | 'rejected';
  reference: string; // opaque service-owned operation reference
};

interface SharedAuthProvisioningClient {
  startStaffEnrollment(input: StartEnrollment): Promise<EnrollmentReceipt>;
  getStaffEnrollment(operationId: string): Promise<EnrollmentReceipt>;
}
```

Suggested transport: `POST /internal/v1/staff-enrollments` and `GET /internal/v1/staff-enrollments/{operationId}` over authenticated TLS on a private service route. The auth API validates a short-lived service principal and a narrow provisioning permission. The exact credential mechanism and network policy remain a review choice; never use a browser cookie, public keycloak endpoint, static shared admin token, or product database credential as service authentication.

Shared auth owns the idempotency ledger, central identity creation, duplicate-identity conflict handling, and optional notification dispatch. The VMMS worker owns its own outbox lease, retries and mapping from remote terminal states to its local request row. Repeating `start` with the same operation ID and identical content returns the same receipt; changed content under that ID is rejected. Repeating `GET` is read-only. Identity conflict is a terminal manual-review outcome; no email-based linking, enrollment delivery, or VMMS membership occurs.

Service authentication and protocol parsing stay inside the client adapter. It maps only allowlisted remote outcomes to the existing worker result type. If the auth operation remains pending, the worker records/retains the remote operation and releases or renews its lease without treating the request as failed or successful. Each service operation has a bounded timeout; network/5xx/429 errors retry with the same ID, while malformed responses and 4xx input conflicts become sanitized review outcomes. Tokens and raw provider responses are never persisted in VMMS outbox or audit events.

The service must keep invitation delivery disabled until a delivery provider, recipient-verification policy, approval owner, expiry/reissue process, and exact synthetic-vs-real environment behavior are reviewed. This candidate is an interface design only; it authorizes no identity creation or message dispatch.

## Synthesis decision

Not selected yet. Candidate A proposes a synchronous idempotent command. Candidate B separates durable acceptance, identity creation, delivery, and enrollment into an auth-owned operation with polling. The synthesis should test whether an extra remote lifecycle and polling surface are justified given the already durable VMMS queue.

## Tradeoffs accepted

- We accept a second durable operation and polling contract in exchange for separating central identity creation from slower or unavailable invitation delivery.
- We accept that VMMS can display a pending state for longer in exchange for never equating request acceptance, identity creation, invitation dispatch, enrollment, and VMMS activation.
- We accept eventual consistency across two systems; the shared auth operation ID and VMMS request ID make retries traceable without sharing a database.

## Alternatives considered

- Synchronous `create-and-invite`: exposes fewer methods but holds one remote call open across identity and mail delivery, and risks ambiguous success after a timeout. A durable operation resource better represents independent outcomes.
- Direct Keycloak Admin REST from the worker: exposes Keycloak-specific protocol, broad credentials, and provider internals to VMMS; reject.
- Shared database tables: couples products and violates the accepted service boundary; reject.

## Open questions and risks

- Which identity-service principal and transport policy should authenticate VMMS (mTLS, short-lived workload token, or another reviewed method)?
- Who approves each real staff enrollment and its destination address?
- Which delivery provider, expiry, resend and support policy is approved? Until decided, can only synthetic test identities use a local non-delivery adapter?
- What is the precise completion meaning for the VMMS `invitation-issued` state if the remote identity exists but delivery is pending or fails?
- Does the service need a VMMS-specific enrollment scope or a generic product invitation resource with separate permissions?
- What retention applies to remote operation metadata and email address after a terminal conflict?

## Next implementation step

Cross-review this resource model against Candidate A and the current VMMS claim/complete SQL functions, then publish a selected contract and tests before implementing either repository's service code.

## Rationale

This design makes asynchronous identity and delivery states explicit. Its main risk is duplicated queue state: both services must retain matching idempotency semantics and eventual outcomes. Use it only if delivery is genuinely asynchronous or independently retryable; otherwise it may be a shallower interface than Candidate A.

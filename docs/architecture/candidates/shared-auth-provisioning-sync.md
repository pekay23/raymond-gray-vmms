# Candidate A: synchronous shared-auth provisioning command

## Problem

VMMS already accepts an Operator request into a durable outbox and claims it with a lease-protected worker. The worker has no real adapter because the shared-auth repository contains no product provisioning API. Reusing local Keycloak fixture scripts would expose the wrong trust boundary and bypass the auth repository's reviewed-plan requirement.

## Usage (caller's view)

```ts
const outcome = await sharedAuth.provisionIdentityAndInvite({
  operationId: request.operationId, // stable VMMS request UUID
  email: request.email,
  displayName: request.displayName,
});
// `outcome` is mapped to the existing VMMS allowlisted worker result.
```

The worker sends this command only from its separate process using an auth-service credential from the deployment's secret store. It uses the request UUID as the remote idempotency key. A retry after a lost response repeats exactly the same command.

## Shape

```ts
type ProvisionIdentityAndInvite = {
  operationId: string;       // UUID, idempotency key
  email: string;             // requested address; not an identity key
  displayName: string;
};

type ProvisioningOutcome =
  | { kind: "invitation-dispatched"; operationId: string; invitationReference: string }
  | { kind: "identity-already-exists"; operationId: string }
  | { kind: "rejected"; operationId: string; code: "invalid-request" | "policy-denied" }
  | { kind: "retryable-failure"; operationId: string; code: "temporarily-unavailable" };

interface SharedAuthProvisioningClient {
  provisionIdentityAndInvite(input: ProvisionIdentityAndInvite): Promise<ProvisioningOutcome>;
}
```

Wire form is a private endpoint such as `POST /internal/v1/provisioning/identities`, with JSON request/response versions and a mandatory idempotency key matching `operationId`. Replays with the same key and identical body return the same operation result; a different body under the same key returns a conflict. The service stores only an opaque operation ID and non-secret result reference in response data. It never returns a password, passkey material, bearer invitation token, enrollment URL, or stable subject to the VMMS worker.

Shared auth owns central account creation, uniqueness checks, enrollment invitation generation and any approved delivery. VMMS owns its local person, membership, site access, roles, grants, audit and session policy. The endpoint accepts no organization, site, role, capability, product permission, or actor-supplied authorization field. It does not link an existing central account based on email. If a verified identity already exists, the operation returns `identity-already-exists`; VMMS records a reviewable failure and does not link it.

The endpoint is unavailable until an owner-reviewed service-auth mechanism, invitation channel, approver policy, data-handling notice and recovery owner are configured. The VMMS public API remains request-only. No Operator action directly calls this endpoint, and no local fixture script becomes the worker adapter. Service authentication must be mutually authenticated over TLS, bound to a dedicated VMMS workload identity, exact audience and invitation-only scope, rotated from the selected secret manager, and deny browser, normal API and human access. The auth implementation must reject replayed keys with altered payloads and rate-limit the caller. Until those details are selected, only a fake adapter is used in tests.

## Failure behavior

- Network timeout: return `temporarily-unavailable` from the adapter, keep the VMMS request retryable, and retry the same operation UUID.
- Remote response lost after commit: the same idempotency key returns the original result without creating a second identity or sending a second invite.
- Existing identity: persist a permanent review outcome; never match or attach by email.
- Invalid input or policy denial: map only to a stable allowlisted VMMS code. Never persist provider response bodies or secrets.
- Delivery provider unavailable: the auth API must not claim `invitation-dispatched`; retain its own recoverable status and return a retryable outcome.
- VMMS lease expires during the call: a later worker repeats the same idempotent operation; only the current lease can settle VMMS state.

`invitation-dispatched` must mean that the approved delivery adapter accepted the invitation message for delivery. It must not mean merely “central identity row created.” If the reviewed business process wants identity creation before delivery is configured, this candidate needs a different outcome and an explicit VMMS state; that branch is not enabled by this sketch.

## Alternatives considered

- Auth-owned asynchronous operation resource (`POST` returns `202`, VMMS polls): better for long delivery jobs, but requires a second durable queue, status resource, polling/backoff and new VMMS result states. It duplicates the lease/retry responsibility already present in VMMS and is premature until the actual delivery channel is selected.
- VMMS calls Keycloak Admin REST directly: rejected because it couples product code to provider administration, distributes privileged credentials, and violates the shared-auth service boundary.
- Browser or normal Fastify handler calls provisioning: rejected because it gives a human request path provider privileges, lengthens interactive transactions, and weakens durable retry and audit isolation.

## Verification

Add contract tests at both boundaries using a synthetic server and fake delivery adapter: request schema rejects forbidden role/site fields; caller authentication and exact audience are enforced; same-key identical replay returns the original result; same-key changed payload conflicts; duplicate central identity returns a review outcome without linking; no token, password, enrollment URL or subject leaks into response/logs; transient delivery failure does not advance VMMS to invitation-issued; and a lost response followed by worker retry creates one auth operation and one delivery request. Keep the existing PostgreSQL tests for VMMS lease, idempotency, stale lease and runtime privilege boundaries.

## Open questions and risks

- Which service-auth method and owner are approved for the eventual host: mutually authenticated service JWT, mTLS, or another workload identity?
- Who approves an account request, beyond the VMMS Operator's ability to queue it?
- Which enrollment delivery provider, expiry, resend policy and support process are approved?
- Is “invitation-dispatched” the required VMMS outcome, or should VMMS first represent a central account awaiting delivery?
- Which data notice and retention rule govern a name and email sent to shared auth?
- What is the initial production Operator bootstrap and recovery procedure?

## Next step

Review the endpoint semantics, service-auth method and invitation-dispatch meaning with the owner, then implement the same versioned contract in the auth service and VMMS adapter using only synthetic identities and a fake delivery channel.

## Rationale

This keeps the public VMMS command simple and preserves its existing durable idempotency boundary. The adapter hides HTTP, service credentials and response parsing from the worker. A synchronous operation has a smaller surface than adding a second job lifecycle to both services; it is suitable only if the reviewed invitation service can provide idempotent completion quickly enough. Invitation delivery is a separate concern owned by shared auth, not a promise inferred from a successful Keycloak account create.

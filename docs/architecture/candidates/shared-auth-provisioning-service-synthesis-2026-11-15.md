# Shared-auth provisioning service design synthesis

**Decision:** Use a small Node service with a separate PostgreSQL operation ledger and transactional outbox alongside the existing Keycloak container. This is the base for isolated staging implementation only. Production delivery remains gated.

## Caller use

The existing VMMS account worker submits an idempotent operation containing an approved destination and display name. The auth service creates/reconciles a central identity and dispatches an enrollment action through Keycloak. VMMS receives only an opaque operation reference and state. The separate VMMS identity-claim flow links `(issuer, subject)` after verified enrollment; neither service uses email matching, and Keycloak does not assign VMMS roles.

## Type and operation sketch

```ts
type StartAccountProvisioning = {
  operationId: string; // same UUID as Idempotency-Key
  email: string; // verified destination request, never an identity key
  displayName: string;
};

type ProvisioningState =
  | "accepted"
  | "identity-created"
  | "invitation-dispatched"
  | "enrolled"
  | "delivery-pending"
  | "identity-conflict"
  | "expired"
  | "rejected";

interface ProvisioningOperations {
  start(input: StartAccountProvisioning): Promise<AccountProvisioningOutcome>;
  read(operationId: string): Promise<AccountProvisioningOutcome>;
  resend(operationId: string, idempotencyKey: string): Promise<AccountProvisioningOutcome>;
}
```

Routes authenticate a short-lived server token with exact issuer, audience, client and the single VMMS provisioning permission, validate the request once, then call a typed operation service. The domain transition and request-digest comparison are pure. The database layer serializes operation updates and writes the outbox atomically. The Keycloak adapter reconciles a user using an opaque operation-derived username, sets only required enrollment actions, and never accepts or returns a password or token.

## Module map

- `config`: parse required endpoints, audience, credential references, stage-only recipient guard and timeouts at process startup.
- `service-auth`: verify signed service tokens with a maintained JWT/OIDC library and reject all other callers.
- `provisioning-contract`: boundary schemas and allowlisted responses.
- `provisioning-lifecycle`: pure state transitions, digest comparisons, fixed expiry and resend policy.
- `provisioning-store`: separate PostgreSQL operation, audit metadata and outbox tables; transactional leases and idempotency.
- `keycloak-admin`: isolated adapter for the pinned Keycloak Admin REST API and operation-id reconciliation.
- `delivery-worker`: lease and process outbox items; never claim exactly-once delivery.
- `http`: small service boundary for versioned internal routes and health/readiness only.

## Synthesis rationale

Candidate A (Node sidecar + PostgreSQL) fits the existing Keycloak container and VMMS Fastify API without first moving both products to Cloudflare Workers. It makes the saga boundary, durable idempotency and recovery inspectable in local PostgreSQL, and can be exercised with local Keycloak plus a non-delivery mailbox. Cross-judge scores were: stack fit 5/5, boundary security 4/5, retry correctness 5/5, operability/testability 5/5, scope 4/5, compatibility 5/5. A focused permission and staging-network review remains mandatory.

Candidate B (Cloudflare Worker + D1/Queue) scored 2/5 for current stack fit, 5/5 security only with a private service binding, 4/5 retry correctness, 2/5 current operability, 2/5 scope, and 2/5 compatibility. Its private service-binding advantage is unavailable while VMMS uses Fastify and auth uses a container. Moving both runtimes solely for that binding would enlarge rollout risk. Keep a future binding as an option if the product API later moves to Workers.

Graft from Candidate B: use an approved-recipient reference if the VMMS account-approval workflow later provides a stable, auditable reference. For staging, use only synthetic `.test` destinations and Mailpit/local capture; the endpoint remains private and requires the VMMS service identity. No arbitrary internet-facing invitation route is approved.

## Lifecycle and safety decisions

- Store operation ID, canonical request digest, state, fixed expiry, resend count, Keycloak user reference, timestamps and metadata-only audit events in a separate auth provisioning database.
- In one local transaction, accept the operation and add the outbox item. If Keycloak commits but the worker loses the response, find the same operation-derived username and reconcile rather than create a second identity.
- Use Keycloak's per-operation action-email lifespan of 86,400 seconds; allow at most one resend without extending expiry. Keycloak's 26.6+ required-action tokens are one-time after successful completion.
- Staging uses synthetic clients, recipients and local captured mail. No production realm, live account, external sender, DNS, secret or deployment is changed.
- Staging verifies idempotent replay, changed-payload conflict, concurrent duplicate requests, user collision/manual review, worker restart, email expiry, one-resend limit, verified enrollment, redaction and wrong caller/audience/permission denial.

## Deviations and rejected scope

- No Cloudflare Worker migration, D1, Queue, new service binding or new public origin is introduced in this slice.
- No Keycloak Admin REST access is granted to a VMMS browser or ordinary business API request.
- No invitation result activates VMMS membership, site access, roles or signed grants.
- No production identity, email delivery, service credential or user provisioning is authorized by this design.

## References

- [VMMS provisioning architecture](../shared-auth-provisioning.md)
- [VMMS account-provisioning contract](../shared-auth-provisioning-contract.md)
- [Keycloak Admin REST API](https://www.keycloak.org/docs-api/latest/rest-api/index.html)
- [Keycloak one-time required-action token change](https://www.keycloak.org/docs/latest/upgrading/index.html)
- [Keycloak 26.8.0 release notes](https://www.keycloak.org/2026/10/keycloak-2680-released.html)

# Shared-auth provisioning design synthesis

## Rubric and outcome

Two structurally different designs were reviewed against queue/idempotency ownership, honest invitation and identity-conflict outcomes, separation of product authorization, recovery behavior, caller surface, and owner-review clarity.

Candidate A (one idempotent command) is the base. It fits the existing VMMS request queue and lease worker, makes the adapter a small boundary, and avoids adding a second caller-managed polling lifecycle. Candidate B (auth-owned operation resource with POST plus GET) scored better on explicitly separating identity creation and delivery states, but adds remote polling and a second lifecycle before a delivery provider is chosen.

The cross-judge agreed with the base choice. It also identified an essential graft: Candidate A's invitation result must never imply that an identity was merely created or that an invitation was actually dispatched. The synthesized outcome model includes `delivery-pending`, `identity-conflict`, and `invitation-dispatched`. The current worker cannot represent pending delivery, so that outcome remains disabled until a VMMS state/lease/backoff change is designed and tested. Same-key requests must return the auth service's stored current state; altered payload under the same key conflicts.

## Grafts and rejected pieces

- Grafted Candidate B's explicit lifecycle distinctions and identity-claim separation.
- Kept Candidate A's single command interface and existing VMMS queue as the caller retry scheduler.
- Deferred a dedicated GET/poll endpoint. Add one only if measured delivery behavior or host constraints make repeating the idempotent command insufficient.
- Rejected direct Keycloak Admin REST, shared databases, auto-link-by-email, and any response that exposes enrollment secrets or grants VMMS access.

## Verification

Read both candidate packages and the cross-judge findings. The synthesized contract is in `shared-auth-provisioning-contract.md`. After linking AUTH-011, REV-045 and the decision log, `npm run docs:generate`, `npm run docs:check` and all 13 checks in `npm run docs:test` passed. No service code, credentials, provider, real identity, email delivery or auth-repository files were changed.

# Shared-auth provisioning design plan

Goal: define a reviewable, secure boundary between the VMMS account worker and the shared-auth service before implementing any user-provisioning API or sending invitations.

- [x] Ground both repositories, VMMS account request/worker flow, and cross-project boundaries.
- [x] Sketch two distinct end-to-end service shapes and compare them against idempotency, authorization, privacy, delivery, failure recovery, and maintainability.
- [x] Cross-review candidate designs and choose one shape; record alternatives and why they lost.
- [x] Publish the synthesized contract, wire types, operations, security requirements, error mapping, and review questions in `shared-auth-provisioning-contract.md`.
- [x] Link the contract and pending decisions to `AUTH-011`, the review register, and the decision log; run documentation traceability checks.

Scope guard: contract and local synthetic verification design only. No live provider, real identity, invitation delivery, external database, credentials, or production changes.

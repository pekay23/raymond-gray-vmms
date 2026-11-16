# Shared identity provisioning boundary

**Status:** Synthetic Keycloak 26.8.2/PostgreSQL/Mailpit invitation staging is verified. Recipient enrollment, VMMS caller integration and production remain gated. Last reviewed 15 November 2026.

## Caller flow

The VMMS account service submits an invitation request to the shared auth service after the VMMS Operator has reviewed an account request. The auth service creates or reconciles a central identity and sends a one-time enrollment link. VMMS keeps ownership of its account record, organisation/site access and work roles. Central identity creation does not activate a VMMS account or grant a role.

```text
VMMS Operator → VMMS account request → VMMS API
                                      │ approved, role-free invite request
                                      ▼
                            private auth provisioning API
                               │ operation ledger + outbox
                               ▼
                        Keycloak Admin REST API
                               │ verify email + set password
                               ▼
                         controlled mail sender
```

After the person completes central enrollment, VMMS links the returned immutable `(issuer, subject)` only through an explicit, reviewed operation. Never use matching email as an identity link. The VMMS Operator remains separate from the Head of Service Centre and cannot grant work, technical, inspection, release or financial authority.

## API contract

- `POST /internal/v1/vmms/account-provisioning-operations` accepts a VMMS operation UUID, Operator-approved destination address and display name. The caller identity comes from a short-lived service token. Site, role, grants, arbitrary redirect, password and provider credential are rejected or absent from the schema.
- A repeated operation UUID and identical canonical request returns the current operation. Reusing it with changed fields returns `409`.
- `GET /internal/v1/vmms/account-provisioning-operations/{operationId}` returns only the operation reference, allowlisted state and timestamps. It never returns an enrollment URL or token.
- `POST /internal/v1/vmms/account-provisioning-operations/{operationId}/resend` permits one resend, only before the original 24-hour expiry. The expiry does not move. The resend itself has an idempotency key.
- Delivery accepted means the auth mail subsystem accepted the request; it does not mean the person received or completed enrollment.

All browser/API-to-API trust is server-to-server. The auth endpoint requires a signed short-lived service token with exact issuer, audience, calling client and the single VMMS provisioning permission. Staging uses synthetic clients and keys. The production token issuer, hosting network, secret storage and rotation owner remain unapproved.

## Operation state and recovery

```text
accepted → identity-created → invitation-sent → enrolled
    │              │                 │
    └──────────────┴────→ manual-review / delivery-failed / expired
```

The separate provisioning PostgreSQL database stores the canonical request digest, operation state, Keycloak user reference, fixed expiry, resend count, timestamps and an append-only metadata audit record. In one database transaction, accept the operation and add an outbox item. A worker leases outbox items and treats delivery as at-least-once. Keycloak user creation is reconciled with an opaque operation-derived username so a network failure after remote creation cannot create a second user. If another central identity already owns the destination, stop at `manual-review`; do not link it or overwrite it.

Use the supported Keycloak Admin REST API for identity creation and required-action email. For the pinned Keycloak 26.8.2 service, set the action-email `lifespan` to 86,400 seconds and require email verification plus password enrollment. Required-action links are one-time by default in Keycloak 26.6 and later. Staging mail is captured by a local non-delivery inbox. Do not log complete links, access tokens, passwords, recovery material or email message bodies.

If the remote user is created but the local operation update fails, the worker locates the user by its operation-derived username and continues the same operation. If email delivery is uncertain, do not claim exactly-once delivery; record the attempt and require the approved resend path. Expiry and resend limits are enforced transactionally in the operation database, not only in the UI.

## Design choice

The selected staging design is a small Node service with its own PostgreSQL ledger and outbox beside the existing Keycloak container. This fits the current container-based identity service and VMMS Fastify API, keeps provisioning in the identity service, and supports a real transactional ledger without moving either application runtime.

The alternative Cloudflare Worker/D1/Queue design would offer private service bindings only after VMMS itself moves to Workers. Neither repository currently proves that runtime topology. Moving both systems solely to obtain a service binding adds more deployment and storage work, so it is deferred. Retain the concept of an approved recipient reference if the VMMS approval workflow later supplies one; do not replace the staging request contract with an arbitrary-email public API.

## Staging acceptance

- Only a synthetic VMMS service account with the exact issuer, audience and provisioning permission can call the API; browser, wrong-client, wrong-audience and wrong-permission tokens are denied.
- A request with `.test` recipients creates one operation; identical replay returns the same result; changed-payload replay conflicts.
- Concurrent duplicates create at most one central identity and one initial outbox operation.
- An existing identity is marked for review without modification or automatic linking.
- The local mail inbox receives a Keycloak action message whose token expires after 24 hours and is invalidated after successful required actions.
- One resend is accepted before expiry. A second resend, expired operation, changed target, or stale resend request is rejected without extending expiry.
- Worker crash/restart between local commit, Keycloak user creation and status update reconciles without duplicate identity or false enrollment state.
- API responses, logs and metadata audit contain no invitation URL/token, passwords, recovery codes or unrelated product data.
- No real destination, external email sender, production Keycloak realm or production user is used in these checks.

## Production gates

Before production implementation or invitation delivery, review the exact account API operation and require staging evidence. Confirm verified recipient addresses, sender and approved message, support and failure handling, production service credentials, private network path, secret rotation, Keycloak fine-grained permissions, backup/recovery, and the one-time Operator bootstrap. Real users and invitations remain untouched until the owner reviews the exact operation.

## Evidence and references

- The VMMS-side contract is in [shared-auth-provisioning-contract.md](shared-auth-provisioning-contract.md). The separate auth repository has staging-only code in `C:\Projects\raymond-gray-auth\provisioning` and records the approved scope in `docs/user-provisioning-plan.md`; no production identities or email were used.
- [Keycloak Admin REST API](https://www.keycloak.org/docs-api/latest/rest-api/index.html) supports a per-request `lifespan` on `execute-actions-email`.
- [Keycloak upgrade guide](https://www.keycloak.org/docs/latest/upgrading/index.html) documents one-time required-action tokens from Keycloak 26.6 onward.
- [Keycloak 26.8 release notes](https://www.keycloak.org/2026/10/keycloak-2680-released.html) describe the new `invite-user` workflow step. It is not selected because this VMMS flow requires a tested per-operation 24-hour lifespan and bounded resend ledger.

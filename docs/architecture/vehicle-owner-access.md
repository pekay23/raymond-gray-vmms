# Vehicle-owner access contract

Status: implementation contract for USER-019. Owner access is an accepted launch requirement. Staff approval authority, evidence handling, records policy, and exact publication rules still need service-centre and privacy-owner review. The staff lifecycle routes are implemented for verification, but operational use remains unavailable until [private evidence storage/scanning (F-007)](evidence-storage.md), named approvers, and the REV-011 operating policy are approved and provisioned. The public owner API remains unimplemented.

## Identity and access relationship

VMMS grants access to a verified identity through an explicit product relationship. A customer contact record, matching email or phone, registration number, VIN, invoice number, or knowledge of a work order never grants access.

| Record | Purpose | Authority |
| --- | --- | --- |
| Central identity | Authenticates one person. VMMS identifies it only by the verified `(issuer, subject)` pair. | Shared identity provider |
| VMMS owner account | Links that identity to a VMMS owner principal. It contains no staff membership or technical, release, or finance capability. | VMMS |
| Vehicle access relationship | Grants one owner principal an approved, time-bounded view of one vehicle within a specified organisation and site scope. It records evidence, grantor, revision, and effective interval. | VMMS |
| Customer/contact record | Preserves the contact captured for a service interaction. It does not establish identity or vehicle access. | VMMS |

The relationship represents approved VMMS access. It is not a legal title registry and must not claim that VMMS has proven ownership under law. Multiple people may have separate approved relationships to a vehicle; the system does not assume sole ownership. Each person's access is reviewed and revoked independently unless an approved transfer operation explicitly closes a defined set of relationships.

An identity may hold both staff and owner access. The server returns separate workspaces and resolves permissions in the selected context. Owner access never inherits a staff role. Switching context clears owner-specific cached data.

## Relationship lifecycle

Each relationship has a stable ID, organisation, approval site, owner principal, vehicle, valid-from time, optional valid-until time, status, evidence reference, approving actor, reason, and monotonically increasing revision. Time intervals use UTC and the half-open rule `valid_from <= now < valid_until`.

The command aggregate is the vehicle's owner-access scope for one organisation and one site. It owns the shared version used to serialize approval, revocation, expiration, and transfer across co-owners. Each owner relationship is a child with its own append-only revision sequence. A transfer closes only the explicitly selected relationship and creates or renews the selected incoming owner's relationship in the same scope transaction. It does not assume one owner, close unrelated co-owner grants, or rewrite old revisions. Aggregate identity is registered as `vehicle-owner-access` so the event ledger and outbox retain ordinary organisation/site foreign keys.

This site-local aggregate is the current implementation shape, not an approved cross-site customer policy. A vehicle may be present in more than one service site; a transfer or revocation in one site does not mutate relationships at another site. Management must decide whether vehicle access is site-local or follows the vehicle across the organisation before any customer access is enabled. The selected-relationship transfer behavior also needs explicit approval against the co-owner/delegate policy in REV-011.

The lifecycle records immutable revisions for `approved`, `revoked`, `expired`, and `transferred`. A current-access check requires an active owner account, an approved current revision, a valid interval, the requested organisation/site scope, and the relationship's vehicle. Expiry denies access by time comparison even if a scheduled worker has not yet appended the `expired` revision.

Approval, revocation, expiry, and transfer are versioned commands. The caller supplies the expected revision and an idempotency key. The server determines the actor, organisation, site, current version, and permitted vehicle. The mutation, revision, audit record, command receipt, and outbox event commit in one transaction. A retry with the same key and same payload returns the stored result; changed payload or stale revision is rejected. Historical revisions and work-order snapshots are never rewritten.

Only a current `vehicle-owner-access.manage` grant may approve, revoke, expire, or transfer a relationship. `memberships.can_write` is not sufficient. The capability grant is site-scoped, time-bounded, evidence-backed, and provisioned outside the staff command API; until management names approvers and the capability-administration path exists, commands fail closed. Every relationship decision includes a bounded reason and a reference to an accepted protected evidence record. Runtime users cannot create evidence records or grant themselves this capability. Do not store an identity document, unrestricted personal notes, or a local file path in the relationship row. F-007 must implement private object storage and acceptance before real evidence or owner-access commands can be used operationally; records and retention approval remain with O-004.

Migration 006 currently provides evidence metadata and scan-state references only. It is not a file-upload, private-object-storage, malware-scanning, quarantine, or recovery implementation. Test fixtures create synthetic accepted metadata with the database owner role; production code cannot mark evidence accepted. Restricted database helper functions lock current approval grants and accepted evidence inside the caller's scoped transaction without granting the runtime role write access to those records.

For a transfer, the operation closes the selected prior relationship at the effective transfer time, records the prior and next revisions, and creates or approves the new relationship only when its evidence and authority checks pass. The prior identity loses current vehicle access immediately after commit. Existing work orders retain the customer, payer, and owner context captured when the work occurred.

## Tenant and site scope

An owner list is derived from the authenticated owner principal and its current relationships. The browser never supplies an owner ID as authority. A vehicle detail, work-order projection, or document request rechecks the relationship, effective interval, organisation, site scope, and publication state on every request.

The first rollout has one service centre. For later sites, an approval grants access only within its recorded site scope. A new site does not inherit another site's grant. Management may approve a broader organisation-level scope after cross-site customer-service and data-owner rules are defined.

## Customer-facing publication allowlist

Owner APIs use separate response types and database queries. Do not serialize the staff work-order detail object into the owner API. Each item below requires an explicit publication decision from its originating workflow.

| Information | Owner visibility rule |
| --- | --- |
| Vehicle identity | Show only the vehicle fields needed to identify the approved vehicle. Do not use registration or VIN as a lookup credential. |
| Service status | Show a controlled customer-facing status emitted by the workflow. Do not expose internal hold reasons, task assignments, diagnosis notes, competence data, or unreleased safety findings. Exact status labels require SOP review. |
| Estimate and consent | Show only the explicitly published proposal revision associated with this owner and vehicle. Any acceptance must record the exact proposal version and the authenticated actor. Do not imply acceptance from viewing or signing in. |
| Invoice | Show only a published invoice whose approved recipient is this owner. Exclude payer disputes, internal amounts/comments, and another customer's billing data. Finance policy defines the approved recipient and visibility. |
| Handover document | Deliver only an explicitly published revision for the approved relationship. Recheck access and publication on every download. Do not use a long-lived public or signed URL that survives revocation. |
| Vehicle history | Hide prior-owner personal information and prior customer documents by default. A former work record becomes visible only through an explicit customer-facing publication decision that removes prior-owner data and is approved under the records policy. |
| Employee and internal records | Never return employee records, internal notes, audit details, payer disputes, technical authority records, or unredacted diagnostic evidence. |

Customer responses use `Cache-Control: no-store`. Owner data is not saved for offline access. On sign-out, account switch, relationship loss, or session expiry, clear owner query caches and any private local copies. Downloads use an authenticated VMMS endpoint that rechecks the relationship and publication revision.

## Invitation and account linking

There is no public self-registration. An authorised process provisions the central identity and VMMS owner account. An invitation moves from `issued` to exactly one terminal state: `claimed`, `revoked`, or `expired`. It is short-lived, single-use, and bound to the intended VMMS owner identity. Store only a hash of its random claim token. Contact details may deliver an invitation but never resolve identity or authorize access. Claiming the invitation requires the signed-in `(issuer, subject)` to equal its bound identity. Matching email addresses never auto-link accounts. An invitation alone grants no vehicle access. Revoke and expire invitations independently from vehicle relationships.

## Required verification before enabling the owner route

- Real PostgreSQL runtime-role tests prove organisation/site isolation, relationship interval boundaries, concurrent revision changes, idempotent replay, and atomic rollback of relation, revision, audit, receipt, and outbox.
- Two owner principals cannot read one another's vehicles or documents. Owners cannot reach staff APIs. Guessed VINs, registrations, contact details, work-order IDs, and document IDs reveal no data.
- Revocation, expiry, and transfer remove access from list, detail, and download on the next request. Prior work-order/customer snapshots remain intact, and former-owner personal data stays hidden.
- Only published, allowlisted fields serialize. No staff projection, internal note, payer dispute, employee field, or quarantined document appears in owner responses or errors.
- Browser checks cover invite expiry/replay, sign-out, context switch, shared-device cache clearing, offline behavior, and accessible loading/empty/denied states.
- A named manager approves who may grant access, what evidence is acceptable, co-owner/delegate policy, cross-site scope, document/invoice visibility, retention, transfer procedure, and support/recovery policy.

The staff command endpoints currently cover approval, revocation, explicit expiration, and selected-relationship transfer. PostgreSQL integration tests exercise current grant checks, non-writable membership separation, site and organisation denial, idempotent replay/conflict, expiry timing, revision preservation, and rollback on outbox failure. These tests validate only the staff command slice; they do not satisfy F-007, customer publication, account invitation, document-download, cross-site policy, or launch approval.

## Related decisions and tasks

- USER-019 is the authoritative owner-access direction. Prototype data is not a source of owner grants.
- `CUST-001` tracks this contract. `CUST-002` implements relationship commands. `CUST-003` covers invitations and owner identity. `CUST-004` through `CUST-009` cover the allowlisted API, downloads, portal, and tests. `CUST-010` requires operational approval before launch.
- REV-006, REV-011, O-004, O-005, and O-008 remain relevant configuration or management dependencies.
- Backlog import remains separate and starts only after the user obtains a list of clients, customers, vehicles, work, completion status, and available evidence.

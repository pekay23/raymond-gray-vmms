# VMMS Operator account administration

Status: implementation contract for the local VMMS account workflow. The role split is accepted. Identity-provider enrollment, contact delivery and production operations still need review.

## Purpose

Let a designated VMMS Operator manage staff accounts and approved access to VMMS. Keep that work separate from the Head of Service Centre / Operations Admin's site work and staff-role assignments.

The Operator manages who can sign in to VMMS and which sites their VMMS account can access. The Head assigns active staff to existing work-role profiles at a site. Neither action gives a person a technical, inspection, vehicle-release, finance, governance or procedure-publishing grant.

## Records and ownership

| Record | Owner | Meaning |
| --- | --- | --- |
| Central identity | Shared identity service | Authentication methods and stable issuer/subject identity |
| VMMS staff account | VMMS | The local person record linked to a verified central identity |
| Site membership | VMMS | Whether a staff account can enter a site workspace, and whether its access is read-only |
| Role placement | VMMS workforce | A person's work role at a site and reporting line |
| Signed authority or qualification | VMMS authority and governance | A separate, scoped grant that permits a protected action |

The Operator workflow may create or update VMMS staff records and site memberships. It must not create, edit or end work-role placements. It must not edit role definitions, authority grants, qualifications, governance approvals or identity-provider configuration.

## Command boundary

Every command uses the authenticated VMMS session. The server derives the acting Operator, organisation and allowed site scope. The browser never receives identity-provider administration credentials or submits an actor, permission grant or trusted organisation.

The VMMS API records a command, metadata-only audit event, idempotency receipt and outbox item in one database transaction. A separate worker sends a narrow, authenticated request to the shared identity service. The normal VMMS API request and browser never call the identity provider's administrative API.

Account-request creation and Head role-placement changes share the site workforce serialization lock. A request cannot pass its Operator-role check concurrently with a role-placement change that uses the same lock. A second request for the same normalized email at the same site is rejected for review. This duplicate check does not link identities or treat email as an identity key.

The identity service may create or suspend an authentication identity and issue an enrollment invitation. It does not receive VMMS role placements, site memberships, vehicle access, qualifications or workshop grants. VMMS links an identity only after the identity service returns a verified, stable `(issuer, subject)` pair through the approved service contract. Email or username matching never links an existing account.

### Provisioning worker boundary

The account request row is the durable local work queue. A separate database capability role, `vmms_staff_account_worker`, can claim and settle work only through two narrowly granted database functions; it cannot query request emails or activity rows directly. Claims use a bounded lease and `SKIP LOCKED`. Each provider operation uses the request UUID as its stable idempotency key, so lease expiry and retry reuse the original operation ID. A replaced lease token cannot settle the request. Provider outcomes are limited to an opaque reference or a small safe error code; worker activity does not copy email, invitation tokens, credentials or raw provider errors.

The provider adapter receives only the operation ID, email and display name. It does not receive VMMS site access or role information. A “known identity” response becomes a visible failure for review; it never links by email. Retry delay, lease duration and maximum attempts are technical defaults, not approved invitation or support policy.

## Account lifecycle

Use these VMMS states:

| State | Meaning | Allowed next action |
| --- | --- | --- |
| `provisioning-pending` | VMMS accepted the request; the identity-service operation has not finished | Retry the same idempotent operation or review its failure |
| `invitation-issued` | The identity service issued an enrollment invitation | Wait for sign-in, or use the approved reissue/expiry process |
| `active` | A verified identity is linked and the VMMS account is enabled | Update VMMS profile or site access, or suspend the account |
| `suspended` | VMMS denies new sessions and protected actions | Restore access through an audited Operator command |
| `provisioning-failed` | The identity-service operation needs review or a safe retry | Retry with the same operation key, or close with an audited reason |

An identity-service outage does not roll back an accepted VMMS command. The outbox retries with the original operation identifier. A permanent error stays visible for the Operator and does not create a partially active VMMS account.

Suspension takes effect in VMMS immediately: new requests fail, and active VMMS sessions are revoked or rejected at their next authorization check. The worker then suspends the central identity. Re-enabling VMMS access does not silently reissue a password, passkey or invitation.

## Allowed operations

The Operator can:

- request an invitation for a new staff account without creating a named pilot or production user in code;
- review provisioning status and retry a failed idempotent operation;
- update VMMS-owned display and contact fields under the approved identity-linking rules;
- add or remove a staff account's approved site membership and read-only site access;
- suspend or restore a VMMS account, with active-session revocation;
- review account and membership history.

The Operator cannot:

- assign, end or change any work-role placement, including another Operator placement;
- create or change role profiles or their permissions;
- issue or alter technical, inspection, release, financial, governance or procedure-publication authority;
- change identity-provider configuration, credentials, passkeys or recovery methods;
- link identities by matching email, invite themselves into a stronger role, or create an Operator account;
- create accounts for another Raymond Gray product through VMMS.

VMMS normalizes account status with site membership and checks the current work role, qualification and signed grant separately at action time. An active membership is not a sign-off grant.

## Initial Operator bootstrap

Do not make the first Operator through the ordinary Operator workflow. Use a one-time controlled bootstrap in an isolated environment. It must require an explicit deployment secret or authenticated owner operation, create no named real person, record its actor and result, and disable itself after success. Production bootstrap needs a separately reviewed runbook and recovery owner. No such production bootstrap is implemented or approved by this document.

## Required verification

Before the workflow is complete, verify all of the following against local PostgreSQL and a synthetic identity provider:

- a non-Operator cannot create, update, suspend or restore staff accounts;
- an Operator can manage approved account and site access but cannot mutate a role placement or signed grant;
- the Head can assign an existing work role but cannot create, suspend or restore an account;
- an Operator cannot create or delegate another Operator, including through stale commands or a replay;
- duplicate identities are not linked by matching email, and invitation callbacks cannot claim another account;
- provider failures, retries, duplicate delivery, stale versions and command replay preserve one account and one audit trail;
- suspension blocks an existing VMMS session and all later protected requests;
- account and membership views stay within the authenticated organisation and permitted site scope;
- audit payloads contain no password, passkey material, raw invitation token or provider secret.

## Open review items

The following choices do not block local contract and mock-provider work. They block production enrollment or require a reviewed recovery procedure:

- select who may approve an account and site-access request, beyond the accepted Operator role boundary;
- choose invitation delivery, expiry, resend limits and support ownership;
- define identity linking and verified contact-change recovery;
- set account/session revocation timing and outbox alert ownership;
- name and rehearse the initial production Operator bootstrap and emergency recovery owner;
- select the production identity host and its service-to-service credential storage.

Track these against `AUTH-011`, `REV-015`, `REV-040` and `REV-041`. Do not create real accounts or send real invitations while these production choices remain open.

## Current implementation

The local VMMS API can create and list site-scoped account-provisioning requests at `/api/v1/sites/:siteId/staff/account-provisioning-requests`. It requires an active, write-enabled VMMS Operator placement at that site. A request stores the intended email, display name and site access, then writes a generic event, idempotency receipt and outbox record without putting the email into those ledgers.

The local API request remains `queued` until an explicitly supplied adapter processes it. `apps/api/src/staff-account-worker.ts` provides the one-request worker contract; migration `039_staff_account_provisioning_worker.sql` provides its lease, retry, activity and worker-only database functions. The integration test uses a fake provider in a disposable PostgreSQL database. No long-running worker process or shared-auth adapter is connected, so the local or production application does not send invitations or create central identities. A synthetic test result may transition only its isolated test row to `invitation-issued`; it sends no message and creates no VMMS user or membership. Profile updates, suspension, restore, verified identity linking and the production bootstrap remain unimplemented.

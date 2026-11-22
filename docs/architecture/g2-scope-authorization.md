# G2 scope proposal and authorization

**Status:** Selected engineering design; general payer and evidence rules approved in `RG-VMMS-POL-001` under REV-061. The implemented payer-response record is evidence only and does not authorize work, charges, dispatch, or vehicle release.

## Purpose

G2 must prove that the customer approved the exact work to be done and that required staff approvals and policies are valid. A diagnostic finding, intake note, work plan, customer contact note, or task handoff cannot substitute for that proof.

The owner approved a reasonable interim rule: the verified paying client, or a representative whose authority is recorded, may respond to an exact work proposal by phone or written evidence. A changed scope requires a fresh response. A proposal or payer response is not enough to authorize work: applicable charges, required technical review, current procedure, evidence, assignment, consent and action-specific authority must also be satisfied. The system must continue to show G2 as unavailable until every required check passes.

## Selected shape

Keep immutable scope revisions as children of the work-order aggregate. The work order is already the serialization root for tasks, holds, and work plans. A scope revision advances its version, so commands that rely on an older work plan or assignment become stale and must be reviewed again.

Each revision binds:

- its work order, organisation, and site;
- the exact planned task IDs and a canonical digest of the ordered scope;
- whether the request is diagnosis-only or repair;
- a concise rationale, author, database timestamp, revision number, and source work-order version;
- the prior revision it supersedes, when applicable.

Decisions are separate append-only records bound to the exact revision ID and digest. A revised scope always requires fresh decisions. Diagnostic consent never authorizes repair, parts, or additional cost.

An approved payer response to a proposal explicitly marked **Diagnosis** is recorded as evidence of consent to that exact diagnosis scope only. The page must say this plainly and keep the work blocked: this response does not authorize diagnostic execution, repairs, parts, charges, or dispatch. Required price and technical reviews and all applicable procedures, competence, evidence, assignment, and action grants must still pass. A declined response is shown as declined; a Repair proposal response is never labelled diagnostic consent.

## Implemented bounded slice

The first runtime slice now stores append-only draft scope proposals against exact currently planned work-order tasks. A Repair proposal must include a positive, manually entered estimate and explicit ISO currency. The estimate is stored as exact minor units, included in the scope digest, and shown in the payer read-back, so the response applies to the exact tasks and stated amount. Diagnosis proposals may omit an estimate; their approval is diagnosis consent only. The API requires the distinct `work-order.prepare-scope-proposal` grant at action time, validates the current work-order version and task membership, records an authority snapshot, and advances the work-order version atomically with the proposal, audit event, idempotency receipt, and outbox record. Reads stay organisation/site scoped and audited. The UI labels every proposal as unapproved and does not expose the write form without the current grant.

The second runtime slice records an exact payer response for the latest proposal only. It captures whether the payer agreed or declined, how the response was received, the respondent and relationship, how identity and authority were checked, a scope read-back confirmation, attributed notes, and any accepted written evidence. Written responses require accepted evidence files already attached to the same work order; database constraints and triggers enforce the same job, response, and evidence binding. Phone responses cannot carry written attachments. The exact payer party and scope digest are retained. The server requires a current after-sales action grant, writable membership, current work-order version, unchanged proposal and planned tasks, and serializes the change under the work-order root. The response is append-only, audited, idempotent, and advances the work-order version. The response projection is explicitly `blocked` for authorization until price and technical review are complete. The UI explains this boundary. No production grant is seeded.

The estimate is entered by staff; VMMS does not calculate tax, line-item pricing, an invoice, payment, or receipt from it. A payer's acceptance is recorded against the immutable revision and digest, but the response still does not authorize diagnosis, repair, parts, dispatch, or release. No grants are seeded. Full G2 remains incomplete until the exact effective procedure, qualified technical review, required evidence and action-specific authority are implemented and pass the complete verification. No internal Finance approval, tax treatment, financial limit, or live authorization grant is inferred from the estimate.

## Command and data rules

- Use the existing scoped `runStaffCommand` transaction and lock the work-order root before checking the current version.
- Persist the proposal, work-order version increment, audit event, idempotency receipt, and outbox entry atomically.
- Require explicit action-specific grants when the grant policy is available. Until the scope-preparation grant is configured, do not expose the command to production staff.
- Enforce organisation/site/work-order/task composite relationships and forced row-level security. Scope proposals are append-only to the runtime role.
- Return a stale-version conflict if tasks, holds, review, plan, or other work-order changes occurred since the form was loaded.
- Never include evidence bytes, credentials, or unnecessary customer details in domain events.
- Derive readiness from the current revision and all applicable evidence. Never let the browser submit a gate result or readiness flag.
- A payer response is not a charge approval or work authorization. Never infer either from `decision='approved'`.

## Candidate comparison

The selected work-order-child design was compared with a separate `work_authorization_cases` aggregate. A separate case makes approval history easy to query, but every mutation would need coordinated locking and version checks across the case and work order. That creates a larger race and deadlock surface for data that changes permission on the same job. Keeping the revision under the existing work-order lock is the simpler and safer first implementation.

The design retains separate append-only decision rows from the case proposal because each payer, technical, and commercial decision has different evidence and authority requirements.

## Remaining implementation and evidence

REV-061's general payer rule is resolved. The current slice binds a manually entered estimate to repair scope and payer read-back; a separate Finance invoice/payment workflow is deferred. Remaining work includes technical scope review and its qualification/authority, effective manufacturer procedure and evidence checks, and action grants for approval and dispatch. Manufacturer procedures and individual qualifications remain source-backed and cannot be inferred from this decision. Until these controls are implemented and verified, G2, repair dispatch, G3, and G4 remain unavailable.

## Verification required for operational authorization

Before any authorization command can be considered complete, PostgreSQL tests must prove tenant/site isolation, exact task/digest binding, revised-scope invalidation, payer/owner separation, valid and invalid policy behavior, grant/qualification revocation races, replay and changed-payload conflict, stale versions, transaction rollback, and audit/outbox atomicity. Browser tests must show each missing prerequisite and the next permitted action without implying work has been authorized.

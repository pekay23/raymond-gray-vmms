# Controlled-document lifecycle candidate A — revision aggregate commands

**Status:** design candidate only. It grants no authority and changes no runtime behavior.

## Problem

The current staff library exposes only current effective procedures and safely blocks writes from the web runtime. The revision table already names draft, review, approved, effective and superseded states, but has no authoring or governance commands. New commands must preserve the effective-only read contract, accepted evidence rules, site scope, signed-grant separation and atomic command/audit boundary. Actual SOPs, the register, approval authority and distribution policy are not yet available, so the design must remain unusable for operational publication until they are approved.

## Usage (caller's view)

The browser does not set a document status or send an actor, role, organisation, site, approver, or grant. It asks for one named action using the existing staff session and site route. The server derives the actor and scope and checks the corresponding current governance grant.

```ts
// Create a draft revision after uploading its source file to the existing evidence pipeline.
await governance.createDraft(siteId, {
  commandId,
  documentId,
  expectedDocumentVersion,
  reference,
  revisionLabel,
  title,
  ownerName,
  acceptedEvidenceId,
});

// Submit a complete draft for review. The service snapshots its contents and evidence hash.
await governance.submitForReview(siteId, {
  commandId,
  documentId,
  revisionId,
  expectedRevisionVersion,
});

// Approve and publish are separate commands; policy may require a different actor.
await governance.approve(siteId, {
  commandId,
  documentId,
  revisionId,
  expectedRevisionVersion,
  decisionEvidenceId,
  reason,
});
await governance.publish(siteId, {
  commandId,
  documentId,
  revisionId,
  expectedRevisionVersion,
  effectiveFrom,
});
```

The caller receives the resulting scoped revision view and audit reference. A missing/expired grant, missing owner-approved policy, rejected or unscanned evidence, stale version, wrong site, or invalid transition produces an explicit denial/conflict and leaves the aggregate unchanged. A repeated command ID returns its original receipt.

## Shape

### Core data

```ts
type DocumentId = string & { readonly __brand: "DocumentId" };
type RevisionId = string & { readonly __brand: "RevisionId" };
type CommandId = string & { readonly __brand: "CommandId" };
type EvidenceId = string & { readonly __brand: "AcceptedProcedureEvidenceId" };

type RevisionState =
  | { kind: "draft"; version: number }
  | { kind: "review"; version: number; submittedAt: Date; contentHash: string }
  | { kind: "approved"; version: number; decision: ApprovalSnapshot }
  | { kind: "effective"; version: number; effectiveFrom: Date; publishedBy: StaffId }
  | { kind: "superseded"; version: number; supersededAt: Date; replacement: RevisionId }
  | { kind: "rejected" | "withdrawn"; version: number; closedAt: Date; reason: string };

type ApprovalSnapshot = {
  actor: StaffId;
  grantId: GrantId;
  grantRevision: number;
  decidedAt: Date;
  evidenceId: EvidenceId;
  reason: string;
};

type ApprovedGovernancePolicySnapshot = {
  policyId: string;
  policyRevision: number;
  snapshotHash: string;
};

type ControlledRevision = {
  id: RevisionId;
  documentId: DocumentId;
  organisationId: OrganisationId;
  siteId: SiteId;
  reference: string;
  revisionLabel: string;
  title: string;
  ownerName: string;
  evidenceId: EvidenceId;
  sourceHash: string;
  state: RevisionState;
  policySnapshot: ApprovedGovernancePolicySnapshot | null;
};
```

`ApprovedGovernancePolicySnapshot` refers only to a separately approved policy; its rules and combination/separation behavior are not defaulted by this design. Until an applicable policy exists, transition commands are unavailable. The discriminated state keeps state-specific facts together and prevents callers from manufacturing a publication or approval snapshot.

### Public module boundary

```ts
interface ControlledDocumentGovernance {
  createDraft(siteId: SiteId, input: CreateDraft): Promise<RevisionView>;
  reviseDraft(siteId: SiteId, input: ReviseDraft): Promise<RevisionView>;
  submitForReview(siteId: SiteId, input: RevisionCommand): Promise<RevisionView>;
  recordReview(siteId: SiteId, input: ReviewDecision & { outcome: "accept" | "request-changes" | "reject" }): Promise<RevisionView>;
  approve(siteId: SiteId, input: DecisionCommand): Promise<RevisionView>;
  publish(siteId: SiteId, input: PublishCommand): Promise<RevisionView>;
  withdrawDraft(siteId: SiteId, input: RevisionCommand): Promise<RevisionView>;
  recordAcknowledgement(siteId: SiteId, input: AcknowledgeCommand): Promise<AcknowledgementView>;
}
```

All request inputs carry a command ID and expected aggregate version. No request input includes the actor or an asserted grant. `reviseDraft` is valid only before submission. Approval evidence must be accepted, clean-scanned, site-matched governance evidence and its hash is retained in the decision snapshot. Uploading a new source file creates a new draft revision; an approved/effective revision is never overwritten.

### Transition contract

| From | Command | To | Guard |
| --- | --- | --- | --- |
| none | `createDraft` | draft | Active site scope; author grant; unique document/revision identity |
| draft | `reviseDraft` | draft | Author grant; accepted evidence; expected version |
| draft | `submitForReview` | review | Required metadata/evidence present; effective governance policy exists; submit grant |
| review | `recordReview(accept)` | review | Reviewer grant; records the attributable decision; expected version |
| review | `recordReview(request-changes)` | draft | Reviewer grant; reason; expected version |
| review | `recordReview(reject)` | rejected | Reviewer grant; reason; expected version |
| review | `approve` | approved | Approval grant; approved policy requirements met; separation rules where required; accepted decision evidence |
| approved | `publish` | effective | Publish grant or policy-approved delegated publish; dates valid; one transaction closes predecessor and starts successor |
| draft | `withdrawDraft` | withdrawn | Author or separately authorized reviewer grant; reason; no evidence deletion |
| effective | system effect during successor publication | superseded | Same document lock; effective interval closed at successor start; immutable audit trail |
| effective | `recordAcknowledgement` | effective + acknowledgement record | Active staff scope; current policy says acknowledgement required; immutable actor/revision/time record |

`rejected` and `withdrawn` are distinct terminal states. Only an effective revision replaced by a new effective revision becomes `superseded`. Migration 041 does not yet store the rejected/withdrawn states; add them only in a reviewed forward migration.

The existing schema has no `withdrawn` status. Candidate A would add an explicit terminal `withdrawn` state rather than mislabel an unpublished draft as `superseded`; it would require a migration and compatibility review. If the owner decides no withdrawal record is needed, draft deletion remains disallowed until retention policy is decided.

### Transaction and module map

```ts
async function transitionRevision(
  scope: AuthenticatedSiteScope,
  command: GovernanceCommand,
): Promise<RevisionView> {
  return runStaffCommand({
    scope,
    commandId: command.commandId,
    aggregate: { kind: "controlled-document", id: command.documentId },
    expectedVersion: command.expectedVersion,
    authorize: (tx) => requireDocumentGrant(tx, scope.actorId, command.capability),
    execute: (tx) => applyValidatedTransition(tx, scope, command),
    audit: (result) => documentDecisionEvent(result),
  });
}
```

- `controlled-documents.ts` owns the aggregate, current state, transition rules, version checks, policy resolution and revision projections.
- Existing `commands.runStaffCommand` provides the transaction, scope recheck, command receipt, serialization root, audit event and outbox atomicity.
- Existing authority registry is read for the named capability at action time; document commands never write role profiles or grants.
- Existing evidence service validates upload purpose, site, target, clean scan and accepted hash before a revision can leave draft.
- Existing document catalog/download stays read-only and queries only the current effective revision. Generic evidence download keeps its current effective-only predicate.
- An append-only acknowledgement relation records `(organisation, site, revision, staff, acknowledged_at, revision_hash)` only if the approved distribution policy requires it. It does not modify the revision state.

The interface hides transaction ordering, lock acquisition, idempotent replay, grant snapshotting, accepted-evidence checks, predecessor closure and audit persistence. Callers supply only the intended action, expected version, command ID and action-specific facts.

## Synthesis decision

Selected as the synthesis base. The append-only case-ledger alternative's explicit review outcomes were grafted into this transition design. The final accepted, design-only contract is `../controlled-document-governance-lifecycle.md`.

## Tradeoffs accepted

- We accept a serialized per-document write path in exchange for one obvious place to enforce revision ordering and prevent two current revisions.
- We accept separate approval and publication commands in exchange for an explicit, auditable handoff; policy may allow the same person only if the owner approves that rule.
- We accept retaining withdrawn draft metadata in exchange for preserving review history; deletion and retention policy remain owner decisions.
- We accept one new governance module responsibility rather than exposing generic status updates across API routes.

## Alternatives considered

- **Generic revision CRUD with a client-supplied status:** rejected because it leaks the state machine to each caller and turns metadata writes into authority decisions.
- **A separate review-request service between HTTP and the aggregate:** rejected because it forwards the same revision policy across another layer without owning independent domain knowledge.
- **Approved procedure content in a generic evidence route:** rejected because it breaks the current effective-only guard and makes evidence access depend on every caller remembering governance rules.

## Open questions and risks

- Which owner-designated person or governing body can issue author, review, approval and publication grants?
- Must approval always be independent from authorship, and must publication always be a second actor?
- What is the owner-supplied SOP/document register, including identifiers, revisions, effective dates, review intervals and retention rules?
- Which document classifications and distribution audiences are permitted, and who may see drafts or review comments?
- Does acknowledgement apply to all staff, selected roles, or selected documents, and what happens when a required acknowledgement is overdue?
- May an effective revision be withdrawn without replacement in an emergency, and which approved emergency authority and evidence apply?
- Does the current evidence schema support the accepted governance decision record without conflating a procedure file with approval evidence?

Until those questions are resolved in approved policy and grants, all governance write operations remain unimplemented or fail closed. Existing read-only access to effective documents remains unchanged.

## Next implementation step

After owner-supplied SOPs/register and REV-041 authority decisions are accepted, reconcile the schema and grant vocabulary, then implement only the first scoped `createDraft` and `submitForReview` command with PostgreSQL denials and concurrency tests.

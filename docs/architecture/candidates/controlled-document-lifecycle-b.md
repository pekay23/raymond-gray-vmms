# Controlled-document lifecycle — candidate B

## Problem

VMMS currently serves only clean, effective controlled-document revisions to active staff. The revision table already names `draft`, `review`, `approved`, `effective`, and `superseded`, but the system has no governed write operations. The design must add a reviewable lifecycle without guessing who may approve or publish, without allowing a document with unknown approval history to become effective, and without weakening site scope, evidence scanning, immutable read auditing, or the current read-only runtime boundary. The owner will supply the real SOPs and register; only their authorized content can enter operational use.

## Usage (caller's view)

The UI calls typed domain operations, not generic metadata endpoints. It never submits the actor, site, grant, or computed lifecycle state. A command returns the case's current version and available next action; a denied or conflicting action returns a reason and leaves the case unchanged.

```ts
const draft = await documents.openChangeCase(authenticatedSite, {
  commandId,
  documentId,
  baseRevisionId,
  proposed: { title, ownerName, sourceReference, distribution },
  expectedSequence,
});

const submitted = await documents.submitForReview(authenticatedSite, {
  commandId,
  caseId: draft.caseId,
  expectedSequence: draft.sequence,
});

const decision = await documents.recordDecision(authenticatedSite, {
  commandId,
  caseId: submitted.caseId,
  expectedSequence: submitted.sequence,
  decision: "approve",
  evidenceIds,
  rationale,
});

const publication = await documents.publish(authenticatedSite, {
  commandId,
  caseId: decision.caseId,
  expectedSequence: decision.sequence,
  effectiveFrom,
});
```

1. A staff author starts a case for an initial revision or replacement. The server derives the authenticated site and actor, checks the dedicated author grant, and records an immutable `case-opened` event. The file is attached through the existing evidence intent/scan path; an unaccepted, dirty, or out-of-scope file cannot be submitted.
2. The author submits a frozen proposal. A reviewer records a separate review outcome. Approval is a separate decision command, and only an actor with an approved, current approval grant may record it. If policy later requires independence, the case's actor history can prove the author/reviewer/approver separation. No policy is assumed until explicitly approved.
3. A publisher with a separate approved grant publishes the approved revision. The server appends the publish decision and updates the current revision/catalog projection in one `runStaffCommand` transaction. Replacing an effective revision closes it and publishes the new one atomically, so there is no interval with two effective revisions or an accidental loss of the prior version.

## Shape

### Domain records

The governing records are an immutable case event stream, a pure state reducer, and the existing revision/catalog records as the current read model. The event stream is canonical for who proposed, reviewed, decided, published, withdrew, superseded, or acknowledged a revision. The read model stores only the current searchable document and effective revision state used by the existing catalog; it can be rebuilt from the event stream and linked evidence references. A read-model row is never accepted as proof of approval by itself.

```ts
type CaseId = string & { readonly __brand: "ControlledDocumentCaseId" };
type Sequence = number & { readonly __brand: "CaseSequence" };
type LifecycleAction =
  | "author" | "review" | "approve" | "publish" | "withdraw" | "acknowledge";

type DocumentCaseState =
  | { kind: "draft"; sequence: Sequence }
  | { kind: "in-review"; sequence: Sequence; submittedAt: Date }
  | { kind: "changes-requested"; sequence: Sequence; reason: string }
  | { kind: "approved"; sequence: Sequence; approvalEventId: string }
  | { kind: "published"; sequence: Sequence; revisionId: string }
  | { kind: "rejected" | "withdrawn" | "superseded"; sequence: Sequence };

type DocumentCaseEvent =
  | { kind: "case-opened"; eventId: string; actorId: string; scope: AuthenticatedSiteScope; proposal: FrozenProposal }
  | { kind: "submitted"; eventId: string; actorId: string; evidenceIds: string[] }
  | { kind: "review-recorded"; eventId: string; actorId: string; outcome: "accept" | "changes" | "reject"; rationale: string }
  | { kind: "approval-recorded"; eventId: string; actorId: string; approvedSnapshot: ApprovalSnapshot }
  | { kind: "published"; eventId: string; actorId: string; revisionId: string; effectiveFrom: Date }
  | { kind: "revision-superseded"; eventId: string; actorId: string; revisionId: string; byRevisionId: string }
  | { kind: "acknowledged"; eventId: string; actorId: string; revisionId: string; acknowledgedAt: Date }
  | { kind: "withdrawn"; eventId: string; actorId: string; reason: string };

type FrozenProposal = {
  documentId: string;
  baseRevisionId: string | null;
  revision: string;
  title: string;
  ownerName: string;
  evidenceIds: readonly string[];
  reviewDueAt: Date | null;
};

type ApprovalSnapshot = {
  grantId: string;
  grantRevision: number;
  basisEvidenceId: string;
  scope: Scope;
  decidedAt: Date;
  policyVersion: string;
};
```

`DocumentCaseEvent` is append-only. It is not an event bus and does not authorize itself: every command rechecks active membership, same-site scope, the named signed capability grant and any approved separation policy inside the transaction. Decision records snapshot the grant and policy version used at decision time. Revocation affects future commands; it does not rewrite historical evidence.

### Interface and module map

Expose one capability-oriented service (`controlledDocuments`) with named operations. It hides replay, membership recheck, scope setup, version checks, case serialization, grant evaluation, event append, catalog projection update, audit and outbox persistence. It does not expose `setStatus`, table writes, transport types, or a generic transition parameter.

```ts
interface ControlledDocuments {
  openChangeCase(scope: AuthenticatedSiteScope, input: OpenCase): Promise<CaseView>;
  submitForReview(scope: AuthenticatedSiteScope, input: SubmitCase): Promise<CaseView>;
  recordReview(scope: AuthenticatedSiteScope, input: RecordReview): Promise<CaseView>;
  recordApproval(scope: AuthenticatedSiteScope, input: RecordApproval): Promise<CaseView>;
  publish(scope: AuthenticatedSiteScope, input: PublishRevision): Promise<PublishedRevision>;
  withdraw(scope: AuthenticatedSiteScope, input: WithdrawCase): Promise<CaseView>;
  acknowledge(scope: AuthenticatedSiteScope, input: AcknowledgeRevision): Promise<Acknowledgement>;
}

// Every mutating input contains commandId and expectedSequence.
// Public HTTP schemas parse into these domain inputs before reaching the service.
// Implementations call runStaffCommand; bodies are not implemented in this sketch.
```

- `apps/api/src/controlled-documents.ts` owns lifecycle decisions, capability checks, event reduction and catalog eligibility. Keep current list/download operations in the same domain module so every route shares one effective-evidence predicate.
- A new migration adds a site-scoped `controlled_document_cases` header and append-only `controlled_document_case_events`, with unique `(case_id, sequence)` and `(actor_id, command_id)` receipts, RLS, foreign keys to the document/evidence/grant scope, and runtime privileges limited to the command procedures/selected reads. Exact DDL and runtime grant shape require review against the migration owner and actual runtime DB role.
- `apps/api/src/app.ts` adds named command routes and schemas only. Browser pages in a separate governance area display cases and afford only server-returned actions. The staff-wide library remains effective-only.
- A pure reducer folds case events into state and validates legal event order. It is exercised independently from PostgreSQL; database tests prove the serializer, RLS, grant denial, replay, stale sequence, rollback and atomic publish/supersede under the runtime role.

### Transaction and publication rule

Every command runs in `runStaffCommand` with command-specific authorization. The mutation transaction locks the case and, for publication, the document's current-revision serialization root. It rechecks grant validity, evidence accepted/clean state, site scope, effective dates, review outcome and current revision immediately before writing. It appends the decision event, idempotency receipt, audit event and outbox item atomically. Publishing a replacement inserts the new immutable revision and supersedes the old revision in the same transaction. A stale sequence, grant change, scan change or conflicting publication fails without partial writes. Replays return the original receipt before stale-version evaluation.

The current catalog projection is updated in the same transaction as its canonical event and must be rebuildable by a deterministic projector. Add a projection-consistency check before enabling the new write path. If the projection disagrees with folded events, deny publication/read eligibility for that revision and alert; never fall back to trusting `status='effective'` alone.

### What this design deliberately does not decide

- No existing role, including VMMS Operator or Head of Service Centre, receives any lifecycle grant by default.
- There are no default approvers, independent-review rules, deadlines, review intervals, distribution scopes, acknowledgement requirements, retention periods or appeals. These are policy inputs in `REV-041`.
- No catalog/editor UI permits a draft, unknown or unapproved document to appear as current procedure.
- Acknowledgement is not evidence of competence, authorization, reading comprehension or technical sign-off.
- `after-sales` references do not supply or approve SOP content.

### Interface depth

The caller provides a business intent, command identifier and observed case sequence. The service contains complex replay, grant, evidence, serialization and projection logic. A generic event append API would be smaller but would expose lifecycle invariants to every route, so it is rejected. A broad configurable workflow engine would push versioning, separation policy and role design onto operators before governance exists, so this candidate avoids it.

## Synthesis decision

Not yet synthesized. This is candidate B for comparison with the transition-command/revision-aggregate design. The lifecycle must remain design-only until the owner-provided inputs and grant model are approved.

## Tradeoffs accepted

- We accept an append-only event ledger and deterministic projection in exchange for attributable review history and a recoverable publication catalog.
- We accept storing a case event stream alongside the existing revision read model in exchange for preserving the current catalog contract; projection consistency becomes an explicit migration and verification obligation.
- We accept named, narrow commands in exchange for rejecting arbitrary state changes at the API boundary.
- We accept that independent approval is a configurable policy still unapproved, so current code remains closed rather than using a convenient default.

## Alternatives considered

- **Direct revision-state commands:** The service mutates revision state directly and appends audit events. It is simpler to query and aligns with the current table, but callers and mutable rows become the de facto history source. It hides less about reconstructing why a revision became effective.
- **Generic workflow engine:** Operators configure stages, transitions and role mappings. It hides lifecycle changes behind configuration, but exposes a large policy surface and lets unapproved administration define technical document authority. It is too broad for the current requirements.
- **Event-sourced replacement for the whole library:** Rebuild documents and revisions entirely from events. It removes the projection split but widens the migration and read-path change beyond this bounded lifecycle; the current effective-only catalog is already useful and should remain stable.

## Open questions and risks

- Which named authority may author, review, approve, publish, withdraw and assign distribution, and which actions require independent actors?
- Who supplies and verifies the source-document register, revision identity, approval evidence, applicability, effective interval and review date?
- Must every staff member acknowledge every revision, or only affected roles/sites? What counts as a completed acknowledgement and how are missed acknowledgements escalated?
- What are the retention and correction rules for a mistaken decision, emergency withdrawal, future-dated publication, or a document with an unknown historical approval?
- Should the catalog read model be rebuilt at startup, by a controlled repair command, or continuously checked? No repair path should silently restore operational effectivity.
- Case text may contain sensitive unpublished procedures; the owner must approve draft visibility, metadata exposure, retention and download audit rules before UI implementation.
- The case proposal does not select distribution or acknowledgement defaults; the server must resolve both only from an approved policy.

Until these questions are resolved and the source SOPs/register plus signed grants are supplied, do not add lifecycle routes or operational writes. Keep the current library read-only and effective-only.

## Next implementation step

After owner review resolves the governance inputs, write the migration and reducer test first, then implement one idempotent author/submit/review/approve/publish command path behind explicit grants and prove it against PostgreSQL before adding UI controls.

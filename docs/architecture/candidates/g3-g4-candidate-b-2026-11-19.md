# G3/G4 candidate B: Versioned closeout dossier

## Problem

VMMS already records the Operations review, Team Lead assignment and work-plan handoff, along with Technician progress, attributed work entries, task evidence, routine-checklist outcomes, and scoped hold decisions. It has no G3 command, G4 inspection/release command, collection-zone custody transition, or separate Head post-release inspection. The current API deliberately leaves G1–G5 pending. G3/G4 require exact current instructions, scope, task declarations, qualifications, signed action grants, evidence, inspection rules and fault dispositions. The non-obvious problem is to bind each sign-off to the precise records its signer reviewed while preventing mutable live views, stale evidence, a role label, or an earlier sign-off from carrying authority into a later stage.

This candidate models each stage as a versioned closeout dossier: a read-only, immutable manifest of the exact records and policy revisions being presented to one decision. G3, G4, and Head inspection remain separate decisions over separate dossiers. Dossier preparation does not authorize work, clear a hold, or sign a gate.

## Usage (caller's view)

The assigned Supervisor opens **Complete technical work**. VMMS either explains the missing prerequisites or returns the current G3 dossier preview:

```ts
const dossier = await readG3Dossier(scope, workOrderId);
// Includes exact task declarations, work entries, checklist outcomes,
// accepted evidence, scope/source revisions, and unresolved blockers.
```

The Supervisor signs only the dossier they reviewed:

```ts
const completion = await signG3(scope, commandId, {
  workOrderId,
  expectedWorkOrderVersion: dossier.workOrderVersion,
  dossierId: dossier.id,
  dossierDigest: dossier.sha256,
  reason,
});
```

After G3, the eligible Team Lead opens **Inspect and release**. VMMS builds the G4 dossier from the current effective inspection matrix, fault dispositions, accepted evidence, current holds, custody, and the G3 decision. The Team Lead submits the configured check results and signs that exact dossier:

```ts
const release = await signG4(scope, commandId, {
  workOrderId,
  expectedWorkOrderVersion: dossier.workOrderVersion,
  dossierId: dossier.id,
  dossierDigest: dossier.sha256,
  checks: recordedCheckOutcomes,
  faultDispositions,
  reason,
});
```

G4 atomically records technical release and movement to the collection zone. The Head then opens **Post-release inspection**, records the separately authorized inspection against that G4 release, and signs pass or fail. Only a passing current Head decision makes the completion-update action available to the Service Advisor. G5 payment/guarantee and physical departure remain separate and pending.

## Shape

### Dossier model

Use three immutable record families owned by a `work-order-closeout` module:

```ts
type DossierStage = "g3-completion" | "g4-release" | "head-post-release-inspection";

type DossierRecordRef = {
  kind: "task" | "declaration" | "work-entry" | "checklist-outcome" | "evidence"
      | "hold" | "scope" | "procedure" | "inspection-rule" | "fault-disposition"
      | "g3-decision" | "g4-decision" | "custody";
  id: string;
  revision: number | null;
  digest: string | null;
};

type CloseoutDossier = {
  id: string;
  stage: DossierStage;
  workOrderId: string;
  workOrderVersion: number;
  workPlanRevisionId: string;
  scopeRevisionId: string;
  policyPackageId: string;
  policyRevision: number;
  policyDigest: string;
  records: readonly DossierRecordRef[];
  sha256: string;
  preparedAt: string;
};

type CloseoutDecision = {
  id: string;
  stage: DossierStage;
  dossierId: string;
  dossierDigest: string;
  result: "passed" | "failed";
  reason: string;
  actorId: string;
  actorPlacementId: string;
  authoritySnapshot: Readonly<Record<string, unknown>>;
  qualificationSnapshots: readonly Readonly<Record<string, unknown>>[];
  decidedAt: string;
};
```

`records` references immutable rows and accepted-evidence digests; the database also stores normalized dossier-item rows with foreign keys. Do not copy customer contact details or binary evidence into the dossier. Hash a canonical, ordered manifest of IDs, revisions, relevant values and source pins. Recomputing it from the referenced immutable rows must produce the stored digest. The digest is an integrity binding, not a substitute for authorization or evidence validation.

### Transition ownership

1. **Technician execution and declaration.** Keep existing append-only work entries and checklist outcomes as the source history. Add a distinct declaration per assigned task and assignment revision. A declaration snapshots the current task-execution grant, exact qualification, scope revision, policy/source revision, current work-plan/assignment revision and evidence set. It records the worker's attestation; it does not sign G3.
2. **Supervisor G3.** The assigned Supervisor reviews the complete G3 dossier and signs the aggregate technical-completion decision. The command verifies every required task has a current declaration; source-backed required checklist items have complete outcomes; exact task scope and instruction revisions remain effective; evidence is accepted and current; deviations have approved dispositions; and no applicable blocking hold is open. Missing or unknown requirements block dossier preparation and signing.
3. **Configured inspection and Team Lead G4.** Build G4 only from an effective, exact-model inspection policy. Store each configured check result, performer, qualification/authority snapshot, evidence and independence relation in the G4 dossier. The separate Team Lead release decision verifies G3 is current, every required check passed, each outstanding fault has an approved disposition, and no applicable hold blocks release. If the configured policy requires an independent inspector, the verifier grant/qualification and Team Lead release grant/qualification are checked and snapshotted separately.
4. **Head post-release inspection.** After G4 and collection-zone custody have committed, the Head signs a separate inspection decision referencing that exact G4 decision and release dossier. If the Head participated in work requiring independent review, require the approved independent substitute path; hierarchy alone does not make the Head independent.
5. **Failure after release.** A failed Head inspection preserves the G4 decision and records a post-release inspection failure. It must create the configured post-release safety hold/return-to-work action atomically and block customer completion messaging and G5 departure. Do not reopen or erase G4. Until the safe return destination and action authority are configured, show the vehicle as held in the collection zone and prohibit further movement commands.
6. **Service Advisor completion update.** Keep ordinary callback/progress communication available. A distinct `completion-status` update is eligible only after the current Head inspection passes for the current G4 release. Record the update through the canonical audited customer-contact history; do not claim VMMS sent a message. Invoicing, payment/guarantee and handover remain separate G5 commands.

### Public operations and storage

Keep the public application surface command-oriented:

```ts
readCloseoutDossier(scope, workOrderId, stage): Promise<CloseoutDossierView>;
declareTaskWork(scope, commandId, workOrderId, taskId, input): Promise<TaskDeclaration>;
signG3(scope, commandId, input): Promise<CloseoutDecision>;
signG4(scope, commandId, input): Promise<CloseoutDecision>;
recordHeadPostReleaseInspection(scope, commandId, input): Promise<CloseoutDecision>;
recordCompletionStatusContact(scope, commandId, input): Promise<CustomerContactRecord>;
```

Own these operations in `apps/api/src/work-order-closeout.ts`, with transport parsing in `apps/api/src/app.ts`. New migrations should add task declarations, immutable stage dossiers and referenced records, stage-specific decision ledgers, inspection-result rows, and a post-release inspection-failure hold link. Composite organisation/site/work-order foreign keys must bind every relation. Decision, evidence, actor/placement, policy revision, qualification/grant snapshots, reason, timestamp and command receipt are immutable.

Add distinct capabilities for task declaration, G3 completion, configured independent inspection, G4 release, Head inspection and completion-status contact. Extend the narrow database grant-lock allowlist in a new migration only after the signed authority schedule and policy definitions are approved. Never add grants to real accounts from a role label or migration. The application runtime must only read/lock signed grants, not create them.

### Transaction and freshness rules

Each mutating transition follows the existing `runStaffCommand` order: lock/recheck active site membership; lock the site-scoped work order root; lock/recheck the exact action grant and qualification; acquire and check the idempotency receipt; compare expected work-order/dossier/policy versions; then validate sources, assignments, current work, holds, evidence and decision preconditions. Atomically persist the dossier, decision, custody or hold mutation, event, receipt and outbox item. A matching command replays the committed response only after current membership and authority checks; changed payloads conflict.

G3 dossier freshness includes current G2 scope, plan/handoff, task assignments and declarations, latest work entries/checklist outcomes and their evidence scan digests, effective instructions, deviations and current blocking-hold set. G4 freshness additionally includes the committed G3 decision, effective inspection matrix, every configured check, fault disposition and current custody. Head inspection freshness includes the exact G4 release decision and collection-zone custody. Any intervening safety-relevant mutation requires a new dossier. Hold creation/resolution and G4 must serialize on the same work-order root. Tests must prove both hold/release commit orderings and grant-revocation races with independent PostgreSQL sessions.

### Staff screens

- **My assigned tasks:** add a clearly separate “Declare task work complete” step after the existing work-entry/checklist forms. Show required missing items and source-backed policy references; preserve drafts on conflict; never label this button “Job complete.”
- **Work order / Supervisor:** provide the G3 dossier summary with task-by-task status, accepted evidence labels, current sources, open holds and exact blockers. Only the assigned Supervisor with current G3 authority sees the sign action.
- **Work order / Team Lead:** show configured inspection requirements and fault dispositions after G3. Hide release until all required checks pass and the current G4 authority is present. On success, show “Released to collection zone”; do not imply invoice, payment or departure.
- **Head of Service Centre:** show a separate post-release inspection queue and evidence dossier. Pass/fail requires the exact effective inspection rules and grant. A failure message states the vehicle remains held and names the next permitted safety action.
- **Service Advisor:** show “Completion update available” only for a current passing Head decision; otherwise show the current owner/action and reason. Keep progress calls in the ordinary request history, separate from the completion-ready update.
- Every screen has loading, empty, denied, unavailable-policy, stale-version, conflict, offline and saved/recovery states; it must retain the current branding, keyboard flow, responsive layouts and independent scroll regions.

### Verification plan

Use disposable PostgreSQL/API tests with synthetic grants and source packages, plus the real browser work-plan fixture. Prove:

- Wrong site, read-only member, role-only account, unassigned/replaced Supervisor, wrong Team Lead, wrong model/system/task, stale/revoked grant and stale/expired/wrong-scope qualification are denied.
- Missing G2, effective instructions, classification, required declarations, checklist outcomes, accepted evidence, required inspection policy, failed inspection, fault disposition, hold clearance or current custody blocks the relevant stage.
- G3, G4 and Head decisions remain distinct immutable rows with exact actor, role placement, assignment, task/source/evidence versions, policy digest, authority/qualification snapshot, reason and server time.
- Changed task/outcome/evidence/scope/policy/hold between dossier read and sign conflicts with no partial state. A later post-G3 edit cannot reuse the prior G3 decision as current.
- Same-key/same-body retries commit one decision and one custody/hold change; changed-body replay conflicts. Outbox failure rolls back dossier, decision, custody, event and receipt.
- Hold-first denies G4 and leaves prior custody unchanged; release-first rejects ordinary pre-release hold mutation. Post-release inspection failure uses only the configured failure transition and cannot erase G4 or enable Advisor completion contact.
- G4 cannot imply payment, guarantee, receipt, customer handover or physical departure. A Head pass can enable only the distinct completion-status update; it cannot make G5 ready.
- Browser role journeys show each actor's queue, dossier, next action and reason. Test desktop, phone, foldable, tablet, keyboard and 200%/400% zoom; verify purpose-built reports and no accessibility violations. Keep manual role UAT and physical-device checks distinct from automated results.

## Synthesis decision

Candidate B uses one dossier-and-decision pattern across G3, G4 and Head inspection, with stage-specific validators and permissions. It makes the reviewed facts explicit and gives every signer a stable review artifact. G4 and Head inspection are not mutations on the G3 dossier; each receives its own immutable dossier whose references include the preceding decision. The closeout module owns manifest construction and freshness checks; policy evaluation remains a separately approved package and cannot be inferred from UI fields.

## Tradeoffs accepted

- Store normalized record references and immutable decision snapshots, even though this adds rows, in exchange for proving exactly which work/evidence/policy each person reviewed.
- Require refreshing a dossier after any safety-relevant change, even if the change appears unrelated, in exchange for simple freshness semantics under the shared work-order lock.
- Keep stage-specific validators inside one domain module instead of separate G3/G4/Head modules, so snapshot construction and stale-state rules have one owner.
- Keep dossier generation available as a blocked/read-only explanation while signatures remain disabled without approved policy; synthetic acceptance does not establish production readiness.

## Alternatives considered

- **Mutate a `work_orders.state` field through sequential endpoints.** It is smaller, but it exposes the mutable live aggregate rather than a reviewable evidence set and makes it easy for a change between screen load and sign-off to silently alter what was reviewed.
- **Store only the final G3/G4 row with JSON evidence.** It reduces tables but leaks serialization rules into reports, weakens foreign-key integrity for evidence and tasks, and makes exact freshness checks difficult.
- **One omnibus completion command for Supervisor, Team Lead and Head.** It has a small route surface but conflates independent actors, policy checks, custody moves and failure behavior; it cannot preserve the user's required distinct approval sequence.

## Open questions and risks

- Which exact approved source and version defines the task classification, technician declaration, evidence matrix and G3 completion criteria for each model/system/task?
- Which inspection matrix is effective for each vehicle model/variant, which checks require an independent inspector, and how are failed/inconclusive checks dispositioned?
- Where must a vehicle be placed after a failed post-release inspection, who may move it, and which safety hold path is valid after G4?
- Does the Head perform every post-release inspection, or can a separately qualified independent replacement act when the Head took part in the work?
- Which grant registry authority may issue and revoke the separate G3, QA, G4, Head inspection and completion-contact grants, and what evidence must accompany them?
- What exact `completion-status` communication outcome should Service Advisors record, and how must it remain distinct from the existing progress/callback history?
- How will the later G5 invoice/payment/guarantee decision prevent departure while Finance is deferred without making G4 or Head inspection imply commercial clearance?

## Next implementation step

Implement the immutable task-declaration record and G3 dossier read/validation against synthetic policies, keeping the signing command and real operation blocked until the authority, G2 scope, effective instructions and required evidence are configured.

## Grounding references

- `docs/architecture/technical-completion-and-release.md`
- `docs/operations/interim-workshop-operating-policy.md`
- `docs/architecture/task-progress-and-acknowledgement.md`
- `docs/architecture/g2-scope-authorization.md`
- `docs/architecture/work-order-checklists.md`
- `apps/api/src/work-order-task-activity.ts`, `work-order-task-work-entries.ts`, `work-order-checklist-outcomes.ts`, `workshop.ts`, `commands.ts`, `app.ts`
- `apps/web/src/pages/work-order.tsx`, `my-assigned-tasks.tsx`
- `scripts/work-plan-browser.mjs`
- `docs/verification/supervisor-signoff-blocked-state-2026-11-18.md`
- `docs/verification/browser-work-plan/results.json`

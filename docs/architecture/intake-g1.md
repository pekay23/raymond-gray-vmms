# Intake evidence and G1 acceptance

Status: implementation direction for the next intake slice. Complete G1 acceptance is not enabled while the operating policy below remains unresolved.

## Problem

The current reception command creates a scoped, idempotent draft work order with one complaint and leaves every process gate pending. The master specification requires a controlling work order with customer-worded complaints, vehicle identity, custody, condition and photographs, mileage/SOC/fuel, safety triage, and a hold when a vehicle is unsafe. Extending a form alone would leave evidence unattributed and would allow staff to mistake a draft for accepted custody or authorized work.

The system already has a work-order aggregate with optimistic versions, an atomic command envelope, append-only events, receipts and outbox, private evidence, and site-scoped RLS. Intake evidence should use these boundaries. Historical work remains a separate later import under REV-016 and must not be fabricated as current G1 acceptance.

## Usage (caller's view)

The authenticated staff app reads the controlling work order and its recorded intake facts:

```ts
const order = await request(orderPath(site.id, orderId), detailSchema);
renderIntakeEvidence(order.intakeFacts);
```

Staff record an observation through one command. The browser supplies a command ID and expected aggregate version; the server supplies the actor and recorded time:

```ts
const updated = await request(intakeFactsPath(site.id, order.id), detailSchema, {
  method: "POST",
  commandId,
  body: { expectedVersion: order.version, fact: conditionFact },
});
```

Work-order evidence attachments can be referenced only after the server confirms they are accepted, clean, and attached to that same work order. Recording an observation leaves G1 pending:

```ts
const next = await recordIntakeFact(order.id, fact);
assert(next.gates.find(gate => gate.code === "G1")?.state === "pending");
```

## Shape

Represent intake observations as a discriminated set of immutable, attributed facts appended to the existing work-order aggregate. A correction appends a replacement fact with a superseded fact ID and reason; it does not rewrite the original. Each fact may be corrected only once, keeping a single readable correction chain. The work-order version lock serializes the command, and the existing command envelope atomically persists the fact, domain event, receipt, and outbox record. Evidence references are restricted to accepted clean evidence attached to this same work order.

```ts
type IntakeFactInput =
  | { kind: "condition-observation"; area: string; description: string; evidenceIds: readonly EvidenceId[] }
  | { kind: "damage-observation"; area: string; description: string; evidenceIds: readonly EvidenceId[] }
  | { kind: "accessory-observation"; description: string; evidenceIds: readonly EvidenceId[] }
  | { kind: "key-observation"; description: string; evidenceIds: readonly EvidenceId[] }
  | { kind: "fuel-reading"; value: number; unit: string; observation: string }
  | { kind: "custody-observation"; description: string; evidenceIds: readonly EvidenceId[] }
  | { kind: "safety-observation"; description: string; evidenceIds: readonly EvidenceId[] };

type IntakeFact = IntakeFactInput & {
  id: IntakeFactId;
  recordedBy: StaffId;
  recordedAt: Instant;
  supersedesFactId: IntakeFactId | null;
  correctionReason: string | null;
};

interface IntakeEvidence {
  record(workOrderId: WorkOrderId, input: RecordIntakeFactCommand): Promise<WorkOrderDetail>;
}
```

`record()` validates the wire schema, actor authorization, current work-order version, correction scope, and evidence scope at the boundary. The domain operation accepts only parsed values. It never accepts a browser-supplied actor, timestamp, gate state, ownership verification, signature method, or safety threshold. A text observation can preserve what staff saw or were told; it cannot itself prove ownership, signed custody, safe-to-receive status, consent, or work authorization.

The public surface is one command that hides the version/event/receipt/outbox transaction and cross-table evidence validation. Domain and wire types stay private to their service boundaries. The existing work order remains the canonical controlling record, avoiding a second intake/canonical-record promotion model.

G1 acceptance remains unavailable until the owner approves the intake SOP revision and rules for owner/delegate proof, custody acknowledgement and retention, safety triage authority and thresholds, and unsafe-vehicle disposition. Until then, all G1 views remain pending with explicit missing policy/evidence reasons. No generic status mutation can clear the gate. Once approved, add a separate versioned acceptance command that checks the effective policy, records a decision snapshot, creates/links canonical customer and vehicle relationships, and creates a protective hold atomically when required.

## Synthesis decision

The selected base is the append-only fact model. It fits the already-existing work-order version, evidence, command-receipt, event and RLS boundaries, and keeps corrections attributable. Candidate A proposed a new intake-case aggregate that delayed canonical visit/work-order creation until acceptance. That shape creates a second path for reception identity and later promotion, conflicts with the current draft-work-order contract, and makes callers coordinate both records without an approved SOP to justify the extra lifecycle. The selected model adapts the useful readiness/blocker idea from A but defers acceptance policy until it is approved.

This is not a claim that R-M-0035 or R-M-0056 is complete. Exact complaint collection, canonical owner/vehicle reuse, all intake measurements, evidence completeness, G1 acceptance and required operational policies remain in the implementation tracker.

## Tradeoffs accepted

- We accept an append-only fact history in exchange for an attributable correction trail and reproducible intake view; a partial unique index prevents correction branches.
- We accept that a complete-looking reception may remain blocked in exchange for not inventing approval, signature or safety rules.
- We accept expected-version conflicts between concurrent staff in exchange for preventing silent overwrites.
- We accept adding intake facts to the existing work order in exchange for avoiding a second draft aggregate and record-promotion lifecycle.

## Alternatives considered

- **Separate intake-case aggregate:** hides G1 readiness and identity-promotion rules inside one new boundary, but exposes case-to-work-order coordination and requires a second mutable lifecycle. It lost because current work orders already represent reception drafts and the extra promotion model has no requirement-backed need.
- **Mutable field-by-field work-order PATCH:** easy to build in a form but makes corrections, evidence links, versioning and attribution shallow and caller-coordinated. It loses interface depth and auditable reconstruction.
- **Full event-sourced replay service:** gives complete projection replay but duplicates the current relational aggregate/event/outbox authority and adds needless operational steps.

## Open questions and risks

- Which controlled SOP-001 revision defines mandatory check-in fields and permitted exceptions?
- What evidence and named authority verify an owner, co-owner, delegate, or recovery handover?
- Which custody acknowledgement methods are permitted, and what retention rules apply?
- Who may perform safety triage, which criteria make a vehicle unsafe, and what disposition is required?
- How should existing vehicles and customer relationships be matched, reviewed, and linked for repeat visits?
- What is the approved shared-device retention policy for saved intake drafts and evidence references?

These questions are tracked in [the review register](../decisions/review-register.md). Do not record a value as verified, accepted, or safe until the relevant policy is approved and implemented.

## Next implementation step

Implement a site-scoped, append-only intake-fact command and view while keeping the G1 gate pending until policy decisions and the full acceptance flow are verified.

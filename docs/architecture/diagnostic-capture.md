# Diagnostic capture contract

Status: engineering contract for the capture-only implementation slice. The supplied master functional specification and upgrade prompt are authoritative. The controlled SOP library, named diagnostic authority schedule, diagnostic cost limit, repair scope policy, and task/payer estimate rules were not supplied and remain pending under REV-006, REV-008 and REV-009. Capturing an observation does not approve a test, repair, cost, task dispatch, inspection, or vehicle release.

## Source requirements

- `R-M-0015` / `master-0015`: preserve unknown and inconclusive findings honestly.
- `R-M-0061` / `master-0061`: capture DTCs, freeze-frame data, software versions, conditions, photos, measurements, reproduction attempts, diagnostic certainty and residual risk.
- `R-M-0061` / `upgrade-0036`: retain confidence, restrictions and diagnostic-consent separation in one work order.
- `R-M-0061` / `upgrade-0059`: model diagnostic evidence, tests, attachments and procedure references.
- `master-0119`: an inconclusive diagnosis must not be marked repaired; record disposition and residual risk.

## Capture boundary

Store attributable findings against the controlling work order and one of its complaint lines. A finding may also name one task in that same work order. Keep the source observation, diagnostic interpretation, certainty statement, restrictions and residual risk distinct. Corrections append a new finding and reference the finding they supersede; previous findings remain immutable.

The capture command is a staff write command with an authenticated actor and site scope. Its result is a recorded finding only. It does not change task state, infer a repair, clear a hold, pass a gate, authorize labour or cost, or publish information to a vehicle owner. Controlled test dispatch and paid work remain closed until the required consent, named grant, scope revision, equipment, privilege and estimate policy checks are implemented and configured.

## Caller contract sketch

```ts
type DiagnosticObservation =
  | { kind: "dtc"; code: string; system?: string; status?: string; freezeFrame?: Array<{ name: string; value: string; unit?: string }> }
  | { kind: "software-version"; component: string; version: string }
  | { kind: "condition"; description: string }
  | { kind: "measurement"; name: string; value: string; unit: string; condition?: string }
  | { kind: "reproduction-attempt"; conditions: string; outcome: string }
  | { kind: "procedure-reference"; title: string; source: string; revision?: string };

type DiagnosticFindingInput = {
  expectedVersion: number;
  complaintId: string;
  taskId?: string | null;
  observedAt: string;
  summary: string;
  certainty: { state: "stated" | "inconclusive"; explanation: string };
  residualRisk: string;
  restrictions?: string | null;
  observations: DiagnosticObservation[];
  evidenceIds: string[];
  supersedesFindingId?: string | null;
};

recordDiagnosticFinding(scope, commandId, workOrderId, input)
  -> Promise<WorkOrderDetail>;
```

The `stated` certainty value means only that the author recorded their certainty in `explanation`; it is not a system-generated confirmation. `inconclusive` remains a first-class state. Require a non-empty residual-risk statement even for inconclusive findings; do not silently translate a blank or unknown value to “no risk.” `observedAt` is the claimed observation time; actor and `recordedAt` are assigned by the server.

In the browser form, collect each DTC freeze-frame entry as a parameter name, value and optional unit. Retain multiple entries as distinct structured values (bounded to 100 by the API schema); do not flatten them into display text. Each supported observation type must be validated before adding it to the finding, then persisted in the original discriminated-union shape.

Evidence references must point to accepted, clean evidence already attached to the same work order. Unscanned, rejected, cross-site, unrelated-work-order, or owner-private evidence is not accepted by the diagnostic command. Diagnostic observations are not themselves evidence files.

## Persistence and module ownership

- Add an append-only `diagnostic_findings` table with organisation/site/work-order/complaint/task scope, server actor and timestamp, observed time, summary, certainty state and explanation, residual risk, restrictions, typed observations and an optional superseded-finding reference.
- Enforce same-work-order complaint, task and superseded-finding references with composite foreign keys. Keep organisation and site on every row and enable/force RLS using the current transaction scope.
- Store observation detail as a strict discriminated union at the API boundary and JSONB in one versioned schema payload. Keep evidence links relational so PostgreSQL can enforce same-work-order scope.
- Revoke runtime update/delete on findings and evidence links. A new finding supersedes by reference; it never rewrites prior diagnostic history.
- Put validation and `recordDiagnosticFinding` in `apps/api/src/diagnostics.ts`; keep Fastify route wiring in `apps/api/src/app.ts`, the staff projection in `apps/api/src/workshop.ts`, and response/input schemas in `apps/api/src/schemas.ts`.
- Use the existing `runStaffCommand` work-order aggregate, idempotency, expected-version, event and outbox contract. The command appends the finding and increments the work-order version once.
- Project diagnostic findings only into the staff work-order detail. The owner API has an independent allowlist and does not serialize this projection.

## Implemented capture slice

The current code implements structured staff capture only:

- `apps/api/migrations/012_diagnostic_findings.sql` adds scoped, append-only finding and evidence-link tables, forced RLS, composite relationship constraints, and a narrowly granted version-incrementing function.
- `apps/api/src/diagnostics.ts` validates work-order version and complaint/task/supersession scope, accepts only already-attached clean evidence, and records an idempotent work-order event.
- `apps/api/src/schemas.ts` defines the certainty and observation unions, including DTC/freeze-frame, software version, condition, measurement, reproduction attempt, and procedure reference. API text limits match database constraints.
- `apps/api/src/workshop.ts` projects the staff-only finding history; the work-order detail UI can record and review these findings while stating that the record grants no authority.
- `apps/api/test/foundation.test.ts` covers inconclusive risk retention, pending tasks/gates, idempotent replay, changed-payload conflict, stale-version rejection, append-only correction, and runtime update denial.

This is not full diagnostic workflow completion. In particular, controlled tests remain disabled, policy-based dispatch and cost checks are absent, and actual images must be attached as accepted work-order evidence rather than embedded in a finding. The backlog of historic work is a separate future import after the customer/work/completion-status inventory is available.

## Verification contract

- A permitted capture appends exactly one finding and versioned work-order event. Repeating the same command returns the original response; changing its payload conflicts.
- Reject a complaint/task/superseded finding from another work order, site or organisation, and reject evidence that is not accepted and attached to this work order.
- Runtime reads obey RLS. Runtime attempts to update or delete a finding or evidence link fail.
- Inconclusive findings retain observations, restrictions and residual-risk text. They never alter task state or set a repair/release gate to complete.
- Missing or ambiguous certainty, invalid structured observations, empty residual risk, stale work-order version, and unauthorized writes are rejected.
- Test an append-only correction that supersedes an earlier finding while preserving both rows and their original actors/times.

## Local verification record

On 2026-11-08, the API regression and browser workflows passed for this capture slice. `apps/api/test/foundation.test.ts` exercises inconclusive risk retention, pending tasks and gates, replay behavior, stale-version rejection, an append-only correction, and denied runtime updates. `scripts/browser-smoke.mjs` records and reloads an inconclusive finding, then checks the open diagnostic form at 12 viewport sizes. It reports 26 successful browser checks with no uncaught page errors. `npm run verify:responsive` passed 15 device/viewport cases plus 200% and 400% browser zoom. `npm run verify` passed docs/template validation, typechecking, builds and all 37 API tests, including the local S3Mock/ClamAV clean-file, EICAR rejection, duplicate-claim and expired-lease recovery scenarios.

These checks validate the implemented capture slice only. They do not claim that diagnostic consent, test dispatch, repair, estimate approval, inspection, technical release, customer publication, historical import, physical-device acceptance, or operational pilot readiness is complete. Full requirement verification remains open until those dependencies and the complete acceptance criteria are implemented and exercised.

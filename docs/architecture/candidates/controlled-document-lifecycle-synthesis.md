# Controlled-document lifecycle design synthesis

**Decision:** Candidate A, the revision aggregate with named transitions, is the base. The accepted design is [controlled-document-governance-lifecycle.md](../controlled-document-governance-lifecycle.md). This is architecture only; lifecycle writes, document publication, and grants remain gated on the owner's inputs.

## Rubric and cross-judge

| Criterion | Candidate A | Candidate B |
| --- | ---: | ---: |
| Preserves lifecycle states and unknown-as-unapproved | 4/5 | 5/5 |
| Names authority without granting it by role | 4/5 | 5/5 |
| Enforces scope, evidence, audit and concurrency | 4/5 | 4/5 |
| Defines idempotent, recoverable transitions | 5/5 | 4/5 |
| Fits current schema and command boundary | 5/5 | 3/5 |

The independent judge also screened shallow modules, information leakage, temporal decomposition and pass-through methods. It recommended A because the existing revision table and `runStaffCommand` already provide the needed aggregate and transactional boundary. The lead review agrees. Neither candidate has a shallow module, temporal split, or pass-through layer that changes the decision. Candidate B's extra event store and rebuildable catalog projection would create a second source of truth plus a new consistency and recovery obligation beside existing audit events.

Candidate B initially exposed two red flags during the lead screen: the public methods accepted a generic scope type, and the proposal sketch illustrated an `all-site-staff` distribution value while distribution was still unapproved. The candidate was revised to use server-derived `AuthenticatedSiteScope` and removed the distribution default before the judge read it. No candidate-defined role grant or policy default was accepted.

## Grafts

- Grafted from B: make review outcomes explicit (`accept`, `request-changes`, `reject`) and keep review separate from approval.
- Grafted from B: record attributable decision snapshots and policy versions, while using the existing append-only command audit/events rather than creating a parallel case ledger.
- Refined from A: rejected and withdrawn are distinct terminal states; `superseded` is reserved for an effective revision replaced by another. Migration 041 lacks those states, so implementation needs a reviewed forward migration.
- Refined from A: removed example policy values that could be mistaken for defaults. Distribution, separation of duties, acknowledgement and workflow policy remain owner-approved inputs.

## Rejected alternatives

- Rejected B's separate case/event ledger and catalog projection because migration 041 already supplies the revision aggregate and the command boundary already persists audit events atomically. Duplicating that history adds consistency and repair complexity without a demonstrated requirement.
- Rejected generic revision CRUD or status mutation because it exposes authority decisions to callers and can bypass transition-specific evidence and grant checks.
- Rejected a configurable workflow engine because it exposes policy construction to administrators before governance authority is approved.

## Verification

Two independent architecture explorations traced the existing list/download, evidence, scope and signed-grant paths. Two structurally distinct candidates were read in full. The cross-judge scored each against the published rubric; synthesis revised the chosen sketch before acceptance. Documentation traceability and link checks remain to run after the tracker and README updates. No application code, runtime data, role grants, operational SOPs, database rows, or external services were changed.

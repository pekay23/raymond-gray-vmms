# Vehicle learning assessment — Candidate A: versioned assessment snapshot

**Status:** Design candidate only; no schema or application change is made here.\
**Grounding:** `docs/architecture/vehicle-systems-learning.md`, `docs/sources/ev-afro-service-centre-transcription.md`, `apps/api/src/vehicle-learning.ts`, `apps/api/migrations/064_vehicle_learning.sql`, `apps/api/migrations/065_vehicle_learning_history.sql`, `apps/web/src/pages/vehicle-learning.tsx`, and `apps/web/src/api.ts` (traced with CodeGraph on 2026-11-14).

## User path

An after-sales staff member opens Vehicle learning and chooses a make/model/variant study. They record an initial impression, then work through stronger evidence questions and the system register. Each system can be marked observed, confirmed from an allowed source, unknown, or not applicable. The staff member records non-invasive location/source notes, explains energy flow, and answers the handout's four questions. They save a draft, revise it later, or mark it ready for review. Every save remains an immutable, author-scoped version; comments keep their current exact-revision link.

The current PDF is the learning exercise and source of prompts; it does not supply make/model facts. Vehicle-specific claims need their own cited documents and technical review. Submissions remain private to the author until a reviewer scope is approved and implemented.

## Proposed domain type

Keep the exercise as one immutable assessment snapshot on each existing entry revision. Avoid splitting one learner's answer into multiple independently versioned records.

```ts
type EvidenceKind =
  | 'visual'
  | 'label-or-vin'
  | 'approved-oem-document'
  | 'vehicle-interface'
  | 'approved-diagnostic-data';

type ClaimState = 'hypothesis' | 'observed' | 'confirmed' | 'unknown' | 'not-applicable';
type Confidence = 'low' | 'medium' | 'high' | 'not-assessed';

type EvidenceCitation = {
  kind: EvidenceKind;
  sourceTitle: string;
  revisionOrDate: string;
  pageOrSection: string;
};

type Finding = {
  state: ClaimState;
  answer: string;
  confidence: Confidence;
  citations: EvidenceCitation[];
  uncertainty: string;
};

type SystemAssessment = Finding & {
  systemId: string;
  nonInvasiveLocation: string;
};

type VehicleLearningAssessmentV1 = {
  schemaVersion: 1;
  preliminary: {
    bodyStyleAndApproximateSize: string;
    visibleClues: [string, string];
    vehicleType: Finding;
    drivetrain: Finding;
    assumptions: string;
  };
  technicalQuestions: {
    powerSources: Finding;
    tractionMotorCount: Finding;
    drivenAxles: Finding;
    engineRole: Finding;
    chargingTypesAndConnector: Finding;
    voltagePlatform: Finding;
    controllersOrDiagnosticModules: Finding;
    documentationNeeded: string;
  };
  systems: SystemAssessment[];
  energyFlow: {
    driving: string;
    acCharging: string;
    dcCharging: string;
    regenerativeBraking: string;
  };
  explanations: {
    inverterDcDcAndOnboardCharger: string;
    phevVersusErevEvidence: string;
    evidenceForDrivenAxles: string;
    safelyVerifyingHiddenSystems: string;
  };
  learnerQuestions: string;
};
```

The top-level vehicle type remains separate from drivetrain. `EREV` and `REEV` are represented distinctly in the domain even if the original handout groups them in one introductory label; an answer may record uncertainty where the architecture is unclear. A vehicle badge, appearance or photograph can support only an observation, never a confirmed classification.

The system IDs are stable kebab-case identifiers derived from the handout's component register, rather than display strings. The current 26 components stay available, grouped by the handout's Energy storage & control, Traction / power electronics, Charging, Thermal / auxiliary, and Safety & control headings. `not-applicable` requires an explicit reason. Empty or unknown evidence is not coerced to confirmed.

## API and persistence boundary

- Add a strict Zod schema for `VehicleLearningAssessmentV1`; reject unknown keys, invalid enums, duplicate `systemId`s, oversized arrays and overlong text. Validate `confirmed` claims have at least one citation. A citation is descriptive provenance, not proof of technical correctness.
- Add `assessment jsonb NOT NULL` to `vehicle_learning_entries` and `vehicle_learning_entry_revisions`. Update and create commands write the aggregate and its immutable snapshot inside the existing transaction, under the same version check, idempotency receipt, audit event and outbox operation.
- Existing scalar `powertrain`, `drivetrain`, `systems`, `evidence`, and `questions` remain a read-compatibility projection for one transition period. Define one server-side projector from `assessment` to those summary columns. The API must not allow old and new representations to diverge. A later reviewed migration can drop old columns after all readers move to `assessment`.
- Backfill prior rows with `schemaVersion: 1`, preserve their existing selected systems/evidence/questions as legacy, explicitly unclassified data; set new detailed assessment answers to `unknown`/`not-assessed`. Never upgrade old learner guesses to confirmed facts.
- Keep organization/site/author partitioning and current RLS policies unchanged. Activity reads return the entire assessment inside each revision snapshot; comments still target an exact revision. No endpoint reads or mutates operational vehicle/customer/work-order tables.
- Keep assessment in the existing aggregate payload only if event payload minimization review accepts the larger text body. Otherwise include a content digest and store the full snapshot in the revision table in the same transaction. This choice must be settled before implementation; do not silently add large learner narratives to the general event stream.

## UI boundary

Organize the form into handout-aligned collapsible sections: Initial view; Confirm with evidence; System register; Energy flow; Explain what you learned; Questions for review. Keep the source transcript accessible on the page. Use concise help text that defines observation, confirmation, unknown, and not applicable. Display provenance fields only after a learner chooses a supported source type. Provide a visible note that diagnostic evidence is only from data already authorized and available; the form itself grants no access or permission.

Do not present a learner's saved response as a reference catalog entry. A submitted answer remains marked learner-authored/unreviewed. Responsive layouts may use independently scrolling sections; do not force the five-page source transcript into the data entry column.

## Alternatives considered

- **Keep flat system names and two text areas.** Rejected because the handout distinguishes per-item status, source, location, uncertainty, multiple technical questions, energy flow and explanations; unstructured notes cannot be reliably checked or searched.
- **Add a normalized row per answer immediately.** Deferred. It supports aggregate reporting and per-question collaboration, but needs ordering, composite version FKs, more command locking, and many more tables before cross-author review is approved. One immutable JSON snapshot best matches the current save/revise unit and avoids partial assessment revisions.
- **Store a second mutable `assessment` beside old answer fields with independent updates.** Rejected because it permits two conflicting truths. Retain old values only as a server-computed transition projection.
- **Publish learner answers as shared brand facts.** Rejected because no technical review/publishing grant or approved model-specific source has been supplied.

## Verification required before marking complete

- Zod and database round-trip for every enum, section, citation and text bound; reject invalid schema version, duplicate system IDs, `confirmed` without a citation, malformed citation, and unknown fields.
- PostgreSQL tests prove save/revision snapshot is atomic with audit/outbox, idempotent replay preserves the exact snapshot, stale version rejects, old revisions cannot change, and cross-site/author RLS remains closed.
- Migration test proves existing records retain every prior value and are explicitly legacy/unconfirmed.
- Browser path completes each handout section, leaves unknowns unconfirmed, saves, reloads, revises and confirms exact version history; repeat at 280, 320, 390, 540, 768, 820, 1024, 1440 CSS pixels and 200%/400% zoom, keyboard and screen reader.
- Assert no learning answer changes vehicle, work-order, diagnosis, SOP, qualification, repair authority, or a G1-G5 gate.
- Business UAT must include a trainee and experienced Technician/Engineer plus Head access. Review-queue UAT waits for the owner decision under `REV-051`.

## Rationale

The current feature already stores each accepted save as an immutable revision and stores append-only, exact-version comments. A single structured snapshot extends that existing save boundary with fewer new lifecycle concepts than a parallel answer-row subsystem. The main cost is JSONB queryability; it is acceptable for learner submissions, which are private and not an operational search catalog. If later approved technical references need filtering and shared publication, model those as separate normalized records rather than making learner snapshots serve both purposes.

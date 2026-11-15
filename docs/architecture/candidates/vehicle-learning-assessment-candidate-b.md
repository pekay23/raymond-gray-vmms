# Vehicle-learning assessment model — Candidate B

**Status:** Design candidate only; no implementation or reviewer access is enabled.\
**Scope:** Expand the existing private vehicle-learning exercise so answers cover the full EV Afriq worksheet, and preserve each complete answer set as an immutable revision.

## Existing flow and constraints

The current API accepts a vehicle title/make-model, one powertrain, one drivetrain, a flat string list of systems, general evidence text, and questions. `saveVehicleLearning` updates an author-owned draft and inserts an immutable copy to `vehicle_learning_entry_revisions` in the same staff-command transaction. Comments attach to one exact revision and remain author-only. RLS scopes the entry, revision and comment tables to organization, site and actor. The web page displays the complete five-page transcription but the saved answer structure cannot express most worksheet fields. The role check permits active after-sales staff, including Head, trainee, technician and engineer.

The supplied handout is learning content with a non-invasive scope. An answer, submission, comment or review must never become a vehicle fact, diagnostic finding, qualification, repair instruction, or authority decision. Cross-author review remains private and disabled until `REV-051` is resolved.

## Proposed shape: normalized answers under a saved revision

Keep the current learning entry as the mutable, author-owned draft projection and keep one immutable revision header per successful save. Store the worksheet answer groups in normalized child tables keyed to that exact revision. A revision is therefore the complete boundary for answering, reading, commenting on, and eventually reviewing one saved exercise version.

```text
vehicle_learning_entries (existing draft/current projection)
  └── vehicle_learning_entry_revisions (existing immutable version header)
        ├── vehicle_learning_identity_answers
        ├── vehicle_learning_technical_answers
        ├── vehicle_learning_system_answers
        ├── vehicle_learning_energy_paths
        └── vehicle_learning_short_answers

vehicle_learning_comments (existing; exact revision FK)
```

Each child row carries `organisation_id`, `site_id`, `entry_id`, `author_id`, and `revision_number`. Composite foreign keys bind it to the same author-owned entry revision, not merely an unrelated UUID. Each table has a narrow unique key so a revision cannot contain duplicate answers for the same fixed question/system/scenario.

## Type sketch

```ts
type EvidenceKind = 'visual' | 'label-vin' | 'oem-manual' | 'vehicle-ui' | 'diagnostic-data';
type FindingState = 'observed' | 'documentary-confirmed' | 'diagnostic-confirmed' | 'unknown' | 'not-applicable';
type Confidence = 'low' | 'medium' | 'high' | 'unknown';
type VehicleClass = 'BEV' | 'PHEV' | 'HEV' | 'EREV' | 'REEV' | 'ICE' | 'unknown';
type Drivetrain = 'FWD' | 'RWD' | 'AWD' | 'unknown';

type SourceReference = {
  kind: EvidenceKind;
  description: string;       // exact document/display/source, not a bare category
  revisionOrDate: string;
  pageOrSection: string;
};

type IdentityAnswer = {
  bodyStyleAndApproximateSize: string;
  visibleClues: [string, string];
  preliminaryClass: VehicleClass;
  preliminaryDrivetrain: Drivetrain;
  confidence: Confidence;
  assumptions: string;
};

type TechnicalAnswer = {
  question: 'power-source' | 'traction-motor-count' | 'driven-axles' | 'engine-role'
    | 'charging-capability' | 'battery-platform' | 'controller-modules' | 'unknowns';
  finding: string;
  state: FindingState;
  sources: SourceReference[];
  uncertainty: string;
};

type SystemAnswer = {
  systemCode: string;         // fixed catalog key; label comes from a maintained catalog
  state: FindingState;
  nonInvasiveLocation: string;
  sources: SourceReference[];
  note: string;
};

type EnergyPath = {
  scenario: 'driving' | 'ac-charging' | 'dc-charging' | 'regenerative-braking';
  included: boolean | 'unknown';
  explanation: string;        // ordered source -> controls -> conversion -> wheels/battery
  sources: SourceReference[];
  unknowns: string;
};

type ShortAnswer = {
  question: 'inverter-vs-dcdc-vs-obc' | 'phev-vs-erev' | 'prove-driven-axle' | 'hidden-systems-safely';
  response: string;
  sources: SourceReference[];
};
```

The eight technical question keys map to the page-2 questions. The system catalog maps every row on page 3 and page 5 (including the worksheet's combined rows) to a stable code and canonical label. A system answer is required for every selected system, but unanswered systems remain `unknown`; `not-applicable` must be an explicit learner selection, not inferred from missing evidence. The two visible clues are separate fields so a single paragraph cannot silently stand in for both.

## Persistence and API boundary

Add one forward migration after the current learning migrations. It creates the five child tables and indexes, composite revision foreign keys, author/site RLS policies, runtime grants, and immutable-history triggers. Existing learning rows remain valid; migration backfill is not allowed to infer field-level answers from old free-text evidence or selected-system arrays. Legacy revisions may be marked `legacy-unstructured` through an explicit compatibility field or returned without child rows until the owner decides whether they should be shown as historical, incomplete exercises.

Extend the existing strict request schema with the typed answer groups. On every draft save:

1. Validate fixed question/system/scenario keys, bounded text, source-reference requirements for confirmed states, and the requirement that hypotheses can remain unknown.
2. Run the existing author/site/writable-membership guard and lock for the learning entry.
3. Update the current draft projection and insert its revision header.
4. Insert all answer child rows for that revision in the same transaction as the audit, idempotency receipt and outbox item.
5. Return a response assembled from the just-saved revision, not from a best-effort later query.

Activity reads first enforce active membership and the current author-only boundary, then read one revision and its children ordered by stable keys. Never return storage keys or link answers to operational vehicle/customer identifiers. Existing comment commands continue to bind to the revision header; no reviewer read path is introduced in this candidate.

## UI mapping to the complete handout

Keep the source transcription visible as the source of the exercise. Break the answer form into four plain-language stages:

1. **First look:** student/team label, exercise vehicle label, make/model/variant, body style/size, two clues, first guess for class and drivetrain, confidence, assumptions.
2. **Check the evidence:** the eight technical questions, each with finding, evidence type, exact source/revision/page, state and uncertainty.
3. **Identify systems:** all 26 source register components, with a compact status selector, non-invasive location/source, and note. Make unknown the starting state. Offer the page-5 combined worksheet labels as aliases into the same component rows rather than duplicating data.
4. **Explain the system:** four independent energy-path sections and four short technical answers, each with a source/evidence field. Add the learner's general question/comment separately.

The first state is a hypothesis, not a confirmation. A visible clue or badge must not set a confirmed answer. Avoid instructing the learner to open, disconnect, lift, road-test, move, or electrically probe the vehicle. Keep the source's stop notice beside the form and explain that local instructor/OEM authorization is still required for any action outside observation.

## Why this candidate

- Each fact has a stable typed identity, evidence state and exact source location, so later filtering and citation checks do not parse free text or arbitrary JSON.
- A comment continues to point at one whole, immutable worksheet version while answer rows remain easy to query by system/question.
- A broken or partial child write rolls back the entire save instead of creating a revision that appears complete with only some answers.
- Catalog labels and aliases can be revised without changing the meaning of a prior saved answer.

The costs are more joins, tables, migration SQL and transactional test cases. The shape is justified only if the product will use individual system answers for learning/review/search, as required by the exercise. A single JSON snapshot is shorter to build, but makes stable system-level filtering, source validation and relational constraints application-only.

## Verification plan

- Round-trip a complete worksheet revision and ensure every page-2, page-3, page-4 and page-5 prompt maps to an answer field; include partial/unknown answers and an explicit N/A.
- Reject unsupported keys, duplicate keys, invalid states, excessive rows/text, missing evidence on confirmed claims, and comments to absent revisions.
- Verify save + all child rows + immutable revision + audit/outbox receipt are atomic under database failure and idempotent replay.
- Verify parent and child RLS deny another author, another site/organization, clients, public users, roleless users, suspended users and Operator-only accounts; preserve active Head/trainee/technician/engineer access.
- Verify stale versions and submitted-entry mutation fail, and historic child rows/comments cannot be updated/deleted.
- Verify no answer changes operational vehicle, customer, work-order, diagnostic, qualification, SOP or gate data.
- Browser-test keyboard-only entry, validation/status announcements, 200%/400% zoom, mobile/tablet/fold/desktop, save/reload and version-specific comments. Review the printed/transcribed source text on narrow screens.

## Rejected alternatives

- **One large JSONB `assessment` snapshot:** simpler migration and save, but field-level evidence validation and future system catalog searches become application-only; useful as the alternative candidate for cross-judging.
- **One row per answer directly on the mutable entry:** would overwrite what the learner meant in a previous revision and detach comments/review from historical content.
- **One column per source question/system:** embeds this worksheet's labels in schema, makes model-specific extensions awkward, and causes migrations whenever the catalog changes.
- **Create a shared vehicle fact catalog from trainee answers:** wrongly elevates unreviewed submissions to reusable technical truth; wait for named technical owners, verified OEM sources and a separate publication grant under `REV-051`.
- **Allow all after-sales roles to view each other's submitted notes:** contradicts current author-only RLS and would imply review authority from role membership. Keep that boundary until reviewer scope is explicitly decided.

## Open decisions and status

This candidate does not decide reviewer roles, cross-site visibility, retention, technical content ownership, or publication authority. `REV-051` remains pending. No data rows, account grants, or operational records are created by this design. Do not change `USER-041` to complete until the structured exercise, reviewed reference catalog, reviewer workflow, source citations and required UAT are implemented and verified.

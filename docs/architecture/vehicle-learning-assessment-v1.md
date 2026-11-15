# Vehicle learning assessment version 1

**Status:** Implemented assessment and separate review workflow; operational reviewer assignment and owner UAT remain open.\
**Requirement:** `USER-041`\
**Source:** [EV Afriq Service Centre handout](../sources/ev-afro-service-centre-transcription.md)\
**Review boundary:** `REV-051` still controls cross-author review, technical publication, retention and approved model-specific sources.

## User path

An active after-sales staff member opens Vehicle learning, reads the source exercise, and records an unfamiliar vehicle study. The form follows the handout: first observation and hypothesis; stronger evidence questions; component/system register; energy paths; short explanations; and questions for review. The member can save a partial draft, revise it later, attach an append-only comment to an exact saved revision, or submit the current note for review. Only a separately granted reviewer can read submitted revisions. The reviewer can comment, request changes or mark the note reviewed as a learning record; the author can revise after requested changes. No operational grants are seeded.

## One answer set per revision

The assessment is a strict, versioned snapshot stored with the existing learning entry and each immutable entry revision. It is the authoritative learner answer. Existing scalar columns (`powertrain`, `drivetrain`, `systems`, `evidence`, `questions`) remain a compatibility projection during this transition: the server derives them from the assessment when saving. A null assessment on a pre-existing row means legacy free-text data; the read adapter marks it legacy and never upgrades it to a confirmed fact. The exact legacy text and selected topic names remain preserved.

The assessment contains:

- `schemaVersion: 1`.
- Preliminary view: body style/approximate size, two visible clues, vehicle type and drivetrain hypotheses, confidence and assumptions.
- Eight stable technical questions: power source, traction-motor count, driven axle(s), engine role, charging/connector, documented voltage platform, control/diagnostic modules, and documentation still needed.
- A keyed register for all 26 source components/systems. Each starts `unknown`; staff can record `observed`, `documentary-confirmed`, `diagnostic-confirmed`, `unknown`, or `not-applicable`, plus a non-invasive location/source, notes and citations.
- Four energy paths: driving, AC charging, DC charging and regenerative braking. Each records supported/not fitted/unknown, an explanation, citations and remaining unknowns.
- Four short explanations from page 4 and learner questions.

Each finding has a state, answer, confidence, evidence citations and uncertainty note. A citation records source kind, exact source title, revision/date and page/section. A citation records where the learner looked; it does not certify the source or the vehicle fact.

## Validation

- Vehicle type and driven axle remain separate claims. Preliminary answers are hypotheses. EREV and REEV have separate values even though the handout groups them in one introductory choice.
- `observed` needs a visual citation; `documentary-confirmed` needs a label/VIN, approved OEM document or vehicle-interface citation; `diagnostic-confirmed` needs a diagnostic-data citation. The form does not grant diagnostic access or permission.
- `not-applicable` requires a reason. `unknown` remains valid without evidence. A photo, badge or appearance can support an observation only, never a confirmed class or driven axle.
- System and question identifiers are stable keys; duplicate/unknown identifiers and extra object keys are rejected. Text, collection counts and citations are bounded.
- Saving the entry, its assessment projection, immutable revision, audit event, idempotency receipt and outbox item remains one transaction under the existing version lock.

## Data and access boundaries

- Keep organization, site and author scope from the authenticated session. Drafts and prior private revisions remain unavailable to reviewers; submitted revisions are readable only with a current review grant.
- Comments continue to target one exact revision and stay append-only. Authors can read reviewer comments on their own submissions; reviewers can comment only before deciding that exact revision.
- Review decisions are immutable and version-bound. Learning-review authority is separate from technical fact approval, qualification, SOP, repair and publication authority.
- Learner content never writes canonical vehicle/customer/work-order data, diagnosis, repair tasks, SOPs, qualifications, authority grants or G1-G5 decisions.
- No PDF vehicle is identified and no model-specific fact is seeded. A shared reviewed reference catalog and technical publication workflow remain separate future records and commands.
- A separate read-only staff learning library can show only a revision explicitly marked reviewed and opted into same-site sharing. It is not a verified vehicle reference catalog; see [reviewed learning library](vehicle-learning-library.md).
- The PDF's stop boundary remains visible: no HV disconnection, electrical testing, connector removal, underside/lift access, road testing, vehicle movement or live-circuit probing as part of this exercise.

## Selected design and alternatives

The synthesis selects Candidate A's versioned JSON snapshot because the existing save and comment boundaries already treat one complete answer set as a revision. It grafts Candidate B's separate documentary/diagnostic states, stable system keys, and explicit unknown starting state. Candidate B's normalized child tables were not selected: before approved shared catalog/search needs exist, they add five tables, composite-key/RLS policies, ordering, and many more transactional failure cases without changing the revision unit. A future published reference catalog should use separate normalized records rather than query learner snapshots as technical truth.

See [assessment model synthesis](candidates/vehicle-learning-assessment-synthesis.md) and both reviewed candidates for the comparative rationale.

## Verification before completion

Test source coverage for all handout sections; strict schema boundaries and evidence/state combinations; legacy preservation and unconfirmed status; create/save/reload/revise and exact-revision comments; idempotency, stale versions and atomic outbox rollback; author/site RLS; denial of client/public/roleless/suspended/Operator-only accounts; no operational-data side effects; keyboard, automated accessibility, screen-reader, 200%/400% zoom and supported device widths. Run UAT with trainee, experienced technician/engineer and Head accounts. Do not mark `USER-041` complete while reviewer scope, shared reference catalog, model-source approval or UAT remains open.

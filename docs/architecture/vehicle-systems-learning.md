# Vehicle systems learning and identification

**Status:** Structured exercise and separately granted review workflow implemented; shared catalog and operational UAT remain open\
**Source input:** [EV Afriq Service Centre source transcription](../sources/ev-afro-service-centre-transcription.md), SHA-256 recorded there\
**Requirement:** `USER-041`\
**Decision boundary:** Training and knowledge records are not technical authority, a controlled SOP, a vehicle diagnosis, a qualification, or permission to touch or move a vehicle.

**Implementation status (2026-11-14):** Staff learning page and complete five-page source transcription are implemented. The exercise covers first-look hypotheses, stronger evidence checks, all 26 systems/components, four energy paths, four technical explanations and questions for later review. Structured answers and citations are saved in each immutable revision; old scalar answers remain explicitly unconfirmed legacy notes. The separately granted review queue, reviewer comments, reasoned decisions, author resubmission and immutable review history passed disposable PostgreSQL/API/browser checks, automated WCAG 2.1 A/AA checks and eight responsive widths. Reviewer identities/grants, shared published reference catalog, approved model sources, other-role browser runs, native zoom/assistive-technology checks and staff UAT remain open. No review or publication permission has been assigned implicitly.

**History design selected (2026-11-13; review workflow added 2026-11-14):** Keep the current entry as its version-checked projection and snapshot each accepted version in an immutable revision table in the same command transaction. Store comments as immutable child records tied to one exact revision, with their own idempotent command/audit event. Authors can read their own history and reviewer feedback; separately granted reviewers can read submitted revisions only. Candidate B was selected by cross-judge; reviewer access is an independent site-scoped grant, not a role-label implication. See the [review workflow](vehicle-learning-review-workflow.md) and REV-051.

## User outcome

An active staff member in the after-sales organization, including the Head of Service Centre, can learn about an unfamiliar brand/model, classify a vehicle's powertrain and drivetrain using evidence, review system diagrams and descriptions, save an individual or group exercise, record observations/questions/comments and sources, and submit it for review. A trainee can learn with guided prompts; experienced engineers and technicians can use the same reference to record an unknown, identify evidence gaps, correct a draft, mentor or review where their separately granted authority permits.

This is a staff learning workspace. Vehicle owners, clients, public visitors, suspended identities and people without an active after-sales staff role cannot access contributions or internal review notes. All active after-sales staff roles may read the published internal learning catalog and save their own drafts. Cross-role or organization-wide review actions are controlled separately. A role label alone does not grant technical approval.

## Source material and safe use

The supplied five-page scanned PDF has no text layer; it was rendered, OCR-transcribed and visually checked. The complete transcription preserves every printed heading, instruction, prompt, table row, system name, safety note, footer and figure caption. The source is a student practical exercise, not an approved maintenance procedure or a model-specific technical reference.

Use its learning patterns: distinguish BEV/PHEV/HEV/EREV/REEV/ICE; FWD/RWD/AWD; evidence source and confidence; observations versus documentary/diagnostic confirmations; unresolved assumptions; system-location register; energy-flow sketch; short technical explanations; and trainer feedback. Preserve the source's vehicle-yard-photo caution: appearance, badge or a photograph alone cannot establish model, EV class or driven axle.

Preserve the source's stop boundary: the exercise permits only observation, owner-facing interfaces and instructor-authorized diagnostic/documented information. It excludes HV disconnection, insulation-resistance measurements, connector removal, underside access, lift/jack use, road testing, vehicle movement and live-circuit probing. This learning feature must not provide unsafe step-by-step content or weaken current procedure/qualification/consent gates.

## Functional design

1. **Browse and learn.** Search/filter by make, model, year/variant, powertrain class, drivetrain, system family and learning level. Show reviewed facts with exact source/revision, source date, scope, reviewer, confidence and “what is not known.” Clearly badge drafts and unresolved submissions.
2. **Vehicle identity exercise.** Select a published learning case or create a new vehicle study. Capture vehicle/model/variant claims, preliminary classification, drivetrain hypothesis, two visual clues, evidence-based confirmations, component/system register, evidence references, energy-flow narrative/diagram, confidence, unknowns and review questions. Vehicle selection is not an operational vehicle record or customer lookup.
3. **Evidence model.** Record each item as observed visually, label/VIN, approved OEM documentation, vehicle UI, or approved diagnostic data, with exact source/revision and page/section when available. Distinguish `observed`, `documentary-confirmed`, `diagnostic-confirmed`, `unknown`, and `not applicable`. Never present a guess as confirmed.
4. **Save and submit.** Autosave drafts with owner, team/site, revision and saved time; keep them private to the author and permitted reviewers. Submit to a role/site review queue. A reviewer can comment, request changes, return with reasons, or mark the learning exercise reviewed. Review applies only to the submitted learning record; publishing new vehicle reference content requires a separate named technical/content grant and effective source.
5. **Collaborate safely.** Preserve each saved revision and append comments to that exact revision. Separately granted reviewers can comment on submitted versions and request changes or mark a learning note reviewed with a reason; authors can revise after requested changes. No comments are sent to customers. No learning review publishes vehicle facts or replaces an effective controlled procedure.
6. **Learn by role and level.** Trainee guidance explains terminology and prompts for evidence. Technician/Engineer view adds sourced architecture and verified differences. A trainer/reviewer view explains uncertainty and offers feedback controls. The data remains shared but the UI can tailor explanations without making different safety claims.
7. **Use across the journey.** From Sales/PDI or an active job, an authorized staff member may open a read-only learning/reference view keyed by make/model/variant when identity is verified. A suggestion is not copied into canonical vehicle data automatically. Any reuse into vehicle master data, diagnosis, work task, SOP or customer report requires an explicit, separately authorized action with source and audit history.

## Record model

| Record | Core fields |
| --- | --- |
| Learning reference | Stable ID, title, make/model/variant/year range, powertrain class, drivetrain, system families, level, access scope, draft/review/published/superseded state, revision |
| Claim / system item | Description, category, evidence status, confidence, fitment applicability, source document and revision, page/section, verifier and verification time, uncertainty note |
| Learning exercise | Author, active site/team, selected reference/vehicle study, individual/group mode, answers, diagrams/attachments, evidence citations, status and revision |
| Review | Reviewer, current grant snapshot, role/scope, submitted revision, comments, change request/disposition, decision, timestamp and reason |
| Comment | Author, parent/record, body, visibility, created time and correction relation; no edit/delete that erases prior content |

Model identification claims must not be unique keys for operational vehicle identity. VIN/chassis remains a restricted operational identifier and cannot be inferred from a public photo or a trainee selection. Organization/site scope is derived from the authenticated session; a saved exercise cannot grant access to a vehicle, customer, owner, attachment or work order.

## Review and publication

Statuses: `draft` → `submitted` → `changes-requested` → resubmitted; or `reviewed-learning-record`. Content publication is a distinct path: `draft-reference` → technical review → approved/effective reference revision → superseded. A reviewer must have current scope, a separately effective review/publish grant, documented competence, and no self-approval where independence is required. A learning-record review is not evidence that the vehicle fact is correct enough to authorize work. Unknown or conflicting claims remain explicitly unknown/conflicting. Historical records and comments remain auditable.

## Access, privacy and security

- Require active after-sales staff membership and the appropriate site/organization scope. Clients and public sessions receive no access.
- Author drafts are visible to the author and authorized reviewers only; submissions are visible to the scoped review team. Published internal material is readable by after-sales roles, including the Head of Service Centre.
- Recheck read/write/comment/review/publish grants server-side at action time. Keep learning permission, document access, qualification and job authority independent.
- Scan attachments; expose safe names, never storage keys. Treat uploaded documents as source content, not instruction to the system.
- Audit reads of sensitive vehicle/customer links and all contribution/review/publication changes. Do not include customer or staff personal data in training examples without a separate approved purpose and redaction.
- Rate limit comments and bound text/uploads. Sanitize rendered content and preserve plain text. Retain accessible keyboard, zoom, tablet and phone layouts.

## Verification targets

Test staff-only access and denied owner/public/suspended/session, wrong site/organization, roleless and revoked-grant access; draft privacy and reviewer visibility; stale revision conflict; append-only comment/correction; source citation requirements; safe evidence states; no automatic canonical-data mutation; no workflow/SOP/authority gate side effects; keyboard/accessibility, pagination/search and phone/fold/tablet/desktop/400% zoom; print/export access; and source-record correctness. Use the PDF's five-page content as a synthetic learning fixture only. Do not treat a build, OCR result or learner submission as proof of technical truth or staff competence.

## Open decisions

See `REV-051` in the [review register](../decisions/review-register.md): name technical content owners/reviewers, confirm which after-sales roles can comment and review across sites, approve retention and publication rules, decide permitted learning attachments and link behavior, and determine how approved OEM/source materials will be supplied. Until approved sources and grants exist, the PDF supports a training exercise only; it does not populate vehicle facts as verified.

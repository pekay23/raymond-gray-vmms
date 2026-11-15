# Vehicle learning review workflow

**Status: implemented for isolated review; operational reviewer assignment pending owner confirmation.**

## Purpose and boundary

After-sales staff can record and revisit structured learning about unfamiliar vehicle types, drivetrains, energy paths and systems. The EV Afro Service Centre handout is used as a learning exercise. Its scanned contents are transcribed at `docs/sources/ev-afro-service-centre-transcription.md`; it is not an approved service procedure, technical authority or source of vehicle-specific facts.

Learning records never create or update canonical vehicle identities, diagnoses, qualifications, work orders, safety decisions, SOPs, release approvals or repair authority. Learners must mark uncertain facts unknown, explain their evidence and cite source material. A review decision means only that a reviewer considered the learning note and returned feedback or marked it reviewed as a learning record.

## Roles and access

- Active after-sales staff with a site role may create, save and submit their own notes. Drafts remain private to their author.
- A reviewer additionally needs an active site-scoped `vehicle-learning.review` authority grant. Role names alone (including Head of Service Centre) do not confer this grant.
- Grant records are append-only and revisioned. The newest grant revision controls; a revoked or expired newest revision does not fall back to an older grant.
- No operational reviewer grants are seeded. Proposed initial policy: Head of Service Centre plus individually granted reviewers, pending owner confirmation in `docs/decisions/review-register.md` (REV-051).
- Reviewers cannot review their own notes. They see submitted revisions only, never an author's earlier private drafts.

## Workflow

1. A staff member completes the structured vehicle-identification exercise and saves a private draft.
2. The author may revise a draft, add comments tied to an exact saved version, then submit it for review.
3. A separately granted reviewer reads the submitted version and may add a version-linked comment, request changes with a reason, or mark the note reviewed with a reason.
4. A requested-changes decision allows the author to make a new revision and resubmit. The review decision and previous revision remain immutable history.
5. A reviewer may mark the submitted revision as a reviewed learning note and separately choose to share that exact revision with all after-sales staff at the same site. Before sharing, the reviewer checks that it contains no client, staff or vehicle identifiers or other private details. The share choice and immutable snapshot are recorded with the review transaction.
6. Shared notes are read-only, searchable and paginated. They omit authors, reviewers, comments, review reasons, customer/vehicle links and attachment identifiers. A later correction or requested-changes revision never inherits the prior share.
7. A reviewer with a current review grant can withdraw a shared revision for a recorded reason. The immutable snapshot and decision history remain preserved; a separate tombstone hides it from the API and row-level-security projections.

A shared reviewed learning note remains unverified training content. It is not an OEM-confirmed reference, approved procedure, diagnosis, qualification, technical publication or work authority. Technical reference publication remains a separate governed workflow.

All mutations use version checks and idempotent staff commands with audit/outbox handling. Review status and comment visibility are enforced through server authorization and PostgreSQL row-level security, not just UI visibility.

## Open decisions and limits

- Owner must confirm who receives the review grant before staff accounts are provisioned with it. See REV-051.
- A governed, sourced make/model reference catalog and technical review/publishing lifecycle are not included. Do not treat learner submissions as approved vehicle facts.
- Native assistive-technology and user acceptance checks remain outstanding; automated browser checks do not establish workshop usability.
- Existing test data is synthetic and isolated. No business backlog or historical maintenance data has been imported.

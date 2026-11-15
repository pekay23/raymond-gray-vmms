# Vehicle learning current-state verification — 2026-11-14

## Source extraction and use

- `EV AFRO SERVICE CENTRE.pdf` is five scanned pages with no selectable text layer. SHA-256: `79D05F479614C81E29DF8AFD469507FB00184DA0AA200A7B70E0E1FB03F70833`.
- The full transcription in `docs/sources/ev-afro-service-centre-transcription.md` was checked visually against all five page images. It preserves the learning outcomes, exercise schedule, preliminary and stronger-evidence questions, complete component/system register, energy-flow prompts, worksheet, captions, footers, and safety warnings.
- The staff exercise covers the handout’s preliminary vehicle-class/drivetrain hypotheses, two visible clues, eight stronger-evidence questions, all 26 system/component entries, four energy paths, four short explanations, learner questions, and the complete source transcription. Supported findings retain evidence source, revision/date and page/section. No vehicle type, model fact, driven axle, or component fitment is inferred from the yard photograph.
- The handout is treated as a learning exercise, not an approved repair instruction, qualification, diagnostic result, vehicle record, or work authorization. Its non-invasive boundary remains visible in the interface.

## Feature scope exercised

- Workspace navigation and the server role guard include active after-sales roles, including Head of Service Centre, trainees, technicians and engineers. Clients, public users, Operator-only accounts, and identities without an active after-sales role are outside this feature.
- Staff can work through the structured source exercise, save a partial draft, revise a structured assessment, append a comment to a specific saved revision, and submit it for review. Assessment JSON is versioned with each immutable revision; old scalar selections are preserved as explicitly unconfirmed legacy notes.
- Drafts remain private to their author. Reviewers require a separate, active site-scoped `vehicle-learning.review` authority grant; grants are append-only and no operational grants are seeded. A reviewer can read submitted revisions only, add a version-linked comment, request changes with a reason, or mark a note reviewed as a learning record. Authors can see feedback and decisions on their own notes and revise/resubmit after changes are requested. Self-review and stale revisions are denied.
- Review decisions do not validate technical claims, publish a reference, grant qualification or authorize work. A governed shared reference catalog, approved model-specific sources and publication lifecycle remain incomplete under `REV-051`.

## Verification

- `node --import tsx --test apps/api/test/vehicle-learning-assessment.test.ts` — 3 passed: unknown-by-default, evidence validation and legacy preservation.
- `node --import tsx --test --test-name-pattern="vehicle learning review is separately granted" apps/api/test/foundation.test.ts` — 1 passed on disposable PostgreSQL; verifies separate grant, reviewer access, private draft restriction, cross-author feedback, changes-requested resubmission, final review, stale/self-review denial and revoked-grant denial.
- API and web TypeScript checks passed; `npm test --workspace apps/web` — 34 passed; `npm run build --workspace apps/web` — passed.
- `node --import tsx scripts/vehicle-learning-browser.mjs --run` — passed against disposable PostgreSQL with synthetic Team Lead author and Head of Service Centre reviewer. It exercised author comments, reviewer comments, requested changes, author resubmission, final review, draft privacy, stale/self-review safeguards, automated WCAG 2.1 A/AA checks (0 violations) and eight responsive widths (280–1440px, no horizontal overflow). See `docs/verification/vehicle-learning-browser/results.json` and screenshots. No physical device, assistive technology, approved reviewer grant or business UAT was exercised.

## Remaining owner/release work

- Confirm which staff identities receive the separate review grant. `REV-051` remains open and no operational grants are enabled.
- Name technical content owners and approve review/publication grants, retention, and approved model-specific source material.
- Run browser checks as trainee, technician and engineer accounts; conduct native 200%/400% zoom, assistive-technology review, and staff acceptance. The current browser test uses synthetic identities only.
- Do not mark `USER-041` or its build/check tasks complete until review workflow and the remaining acceptance evidence are delivered.

## Fresh attachment check — 2026-11-14

- Rechecked the attached `EV AFRO SERVICE CENTRE.pdf`. It is the same five-page scan already inventoried: SHA-256 `79D05F479614C81E29DF8AFD469507FB00184DA0AA200A7B70E0E1FB03F70833`. `pdftotext -layout` returned only page separators, confirming there is no embedded selectable text to extract directly.
- Rendered and visually inspected all five pages. The existing complete transcription in `docs/sources/ev-afro-service-centre-transcription.md` remains the text source bundled into the staff learning page. The exercise form uses the classification choices, evidence prompts, 26-system register, four energy paths, explanation questions, learner questions, and stop/safety boundary. It does not use the yard photo to assert vehicle facts.
- The server's active after-sales role boundary includes Head of Service Centre, EV/ICE Team Leads, Supervisors, trainee Technicians/Engineers, Service Advisors, Quality Inspectors, Parts/Inventory, Warranty/Customer Support, Finance/Billing and Compliance/Records/HR. This is feature access only; it grants no technical or learning-review privilege.
- Review workflow code uses an explicit site-scoped `vehicle-learning.review` grant and no grant is seeded. A synthetic HSC reviewer passed the queue, submitted-only visibility, reviewer comment, request-changes, author resubmission and final reviewed-note flow. Keep production reviewer identities and technical content review open in `REV-051`.

## Same-site reviewed learning library — 2026-11-14

- Added a separate searchable, paginated library for read-only learning. Only the exact submitted revision marked `reviewed-learning-record` and explicitly opted into sharing is projected. Requested-changes and private reviewed revisions do not appear.
- A currently granted reviewer can withdraw a shared note with a reason. The immutable visibility tombstone snapshots revoker, grant ID/revision and reason; the note and review history remain preserved, and API/RLS reads hide the withdrawn revision.
- The reviewer must acknowledge that shared notes contain no client, staff or vehicle identifiers. The library omits author/reviewer identity, comments, review reasons, and operational record or attachment links. All eleven active after-sales role codes can use the library at their own site; clients, public users and Operator-only users are excluded.
- Every shared item is labeled as unverified training content. Review and sharing do not verify technical claims, publish an OEM reference or authorize work. The source PDF remains the five-page training exercise and its stop/safety instructions remain in the page.
- Independently rendered, OCR-checked and visually inspected all five PDF pages. No substantive text is missing from `docs/sources/ev-afro-service-centre-transcription.md`. The PDF has no selectable text layer. SHA-256 remains `79D05F479614C81E29DF8AFD469507FB00184DA0AA200A7B70E0E1FB03F70833`.
- `node --import tsx --test apps/api/test/vehicle-learning-assessment.test.ts` — 3 passed.
- `node --import tsx --test --test-name-pattern="vehicle learning review is separately granted" apps/api/test/foundation.test.ts` — 1 passed on disposable PostgreSQL, including same-site library visibility, search, safe response shape, requested-changes exclusion, runtime-role RLS, authorization denial and privacy withdrawal.
- API and web TypeScript checks passed. `node --import tsx scripts/vehicle-learning-browser.mjs --run` — passed save/revise/review/share/withdraw, source transcription access, automated WCAG 2.1 A/AA checks (0 violations), and eight responsive widths from 280–1440px without horizontal overflow.
- Still open: run API/browser flows with each distinct workshop role, select operational reviewer identities/grants, approve model-specific technical sources, test with staff and assistive technology, and perform production/UAT review. This feature remains in progress.

## User-requested feature recheck — 2026-11-14

- Reconfirmed the attached PDF is byte-identical to the already transcribed five-page scan (SHA-256 `79D05F479614C81E29DF8AFD469507FB00184DA0AA200A7B70E0E1FB03F70833`). It has no selectable text. The full visually checked OCR transcription is in `docs/sources/ev-afro-service-centre-transcription.md` and is rendered in the staff learning exercise.
- Re-ran `node --import tsx --test apps/api/test/vehicle-learning-assessment.test.ts` (3 passed), `node --import tsx --test --test-name-pattern="vehicle learning review is separately granted" apps/api/test/foundation.test.ts` (1 passed), `npm test --workspace @vmms/web` (34 passed), and `npm run docs:check` (passed; 256 requirements, 678 tasks, 350 source blocks).
- First browser attempt timed out while waiting for the second revision history heading. A clean retry passed all browser phases: saved/revised/submitted exercise and exact-version comment; reviewer feedback and resubmission; explicit sharing and withdrawal; automated WCAG 2.1 A/AA checks (0 violations); eight widths from 280 to 1440 px without horizontal overflow. Latest result is in `docs/verification/vehicle-learning-browser/results.json`.
- The feature is available through active after-sales membership, including Head of Service Centre, technicians, engineers and trainees; clients, public users and accounts outside the after-sales workspace are denied. No operational reviewer grant is seeded.
- Remaining: investigate the intermittent browser wait; conduct API/browser tests for distinct staff roles, native zoom and assistive technology checks, staff UAT, assign approved reviewers, and build the separately governed catalog for sourced, technically approved model-specific references. The PDF itself remains an exercise and does not establish model-specific facts.

## Follow-up verification — 2026-11-14

- Re-ran `node --import tsx --test apps/api/test/vehicle-learning-assessment.test.ts` — 3 passed; `node --import tsx --test --test-name-pattern="vehicle learning review is separately granted" apps/api/test/foundation.test.ts` — 1 passed on disposable PostgreSQL.
- Re-ran `npm test --workspace @vmms/web` — 35 passed, including navigation access for all eleven after-sales roles.
- Re-ran `node --import tsx scripts/vehicle-learning-browser.mjs --run` — passed save/revise/submit, version-linked comments, reviewer feedback/resubmission, same-site sharing/withdrawal, automated WCAG 2.1 A/AA checks, and responsive checks covering phone, tablet, foldable and desktop widths.
- The implementation is already present; this follow-up made no application-code changes. It does not close role-specific live UAT, native assistive-technology checks, technical-source approval, reviewer assignment or staff acceptance.

## Attached source and feature recheck — 2026-11-14

- Re-rendered all five pages of `EV AFRO SERVICE CENTRE.pdf`, freshly OCR-checked each page, and visually inspected the rendered pages. The PDF is image-only; SHA-256 is `79D05F479614C81E29DF8AFD469507FB00184DA0AA200A7B70E0E1FB03F70833`, matching the stored source transcription.
- Checked the transcription against the pages for the student exercise instructions, preliminary vehicle and drivetrain hypotheses, evidence source rules, all 26 component/system rows, the four energy paths, four explanation questions, worksheet fields and both safety warnings. No substantive source text was missing. The yard photo is not used to assert a vehicle identity or driven axle.
- Kept source instructions distinct from the user's product request: active after-sales roles (including the Head, trainees, technicians and engineers) can learn and submit notes; the source's exercise-only safety boundary remains visible. Learning records do not establish procedure, qualification, diagnosis or work authority.
- `node --import tsx --test apps/api/test/vehicle-learning-assessment.test.ts` — 3 passed. `npm test --workspace @vmms/web` — 35 passed, including navigation access for all after-sales role codes.
- `node --import tsx scripts/vehicle-learning-browser.mjs --run` — passed save/revise/submit, revision-linked comments, separate reviewer feedback/resubmission, opt-in same-site sharing and withdrawal, automated WCAG 2.1 A/AA checks, and responsive phone/tablet/foldable/desktop checks.
- Still open under `USER-041`: role-specific API/UAT with named staff, reviewer assignments, native assistive-technology review, staff acceptance, and a governed technical reference catalog populated only from approved model-specific sources. Shared learning notes remain unverified training content.

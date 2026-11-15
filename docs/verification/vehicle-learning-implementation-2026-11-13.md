# Vehicle learning implementation check — 2026-11-13

## Implemented slice

- Active after-sales roles receive a **Vehicle learning** workspace link. The Head of Service Centre, team leads, supervisors, trainee technicians and other defined after-sales roles are included. Sales-only, Operator-only and non-workspace identities do not receive the feature access.
- The page renders the complete five-page transcription of `EV AFRO SERVICE CENTRE.pdf`, including its learning outcomes, prompts, system register, explanations and safety limits. Its student worksheet status is stated beside the source.
- Staff can select a vehicle class, drivetrain and systems, record evidence and questions/comments, save a draft, continue it, and submit it for later review.
- Draft rows, immutable revision snapshots and comments are scoped by organisation, site and author in PostgreSQL RLS. Every save records a snapshot in the same command transaction. Comments are append-only, identify the exact revision and have their own idempotent audit/outbox command. Submitted records cannot be revised through the draft endpoint.
- This feature does not create operational vehicle records, diagnosis, work instructions, competence, release approval or technical authority.

## Verification evidence

- `node --import tsx --test --test-name-pattern='vehicle learning' apps/api/test/foundation.test.ts` — passed. It applied migrations to a disposable PostgreSQL database and checked revision snapshots, append-only revision-linked comments, create/replay, changed-key conflict, site/role denial, author row isolation, stale-version rejection, submission, immutable submissions and rollback when the outbox insert fails.
- `npm run typecheck --workspace apps/api` — passed.
- `npm test --workspace apps/web` — 34 passed, 0 failed, including role navigation coverage.
- `npm run build --workspace apps/web` — passed; the learning page is a separate lazy-loaded chunk.
- The complete API suite passed immediately before the focused learning test was added: 122 passed, 1 optional S3/ClamAV fixture skipped. The focused PostgreSQL test was run after the learning feature changes.
- `node --check scripts/vehicle-learning-browser.mjs` and `node --import tsx scripts/vehicle-learning-browser.mjs --run` — passed against a disposable PostgreSQL database and synthetic Team Lead identity. The browser created a BEV/RWD learning draft, saved a second revision, attached a comment to revision 1, submitted revision 3 and observed it in open history. Automated WCAG 2.1 A/AA scan passed; keyboard Tab reached the source transcript; no horizontal overflow appeared at 280, 320, 390, 540, 768, 820, 1024 or 1440 CSS pixels. Browser errors/outbound requests: none. Evidence and screenshots: `docs/verification/vehicle-learning-browser/`.

## Still open

- Reviewer queue, reviewer-authored replies, reasoned change requests and feedback are not implemented. Submitted notes are saved for later review; reviewer access is intentionally not guessed or granted from a role name.
- Reviewed make/model reference catalog, precise source page/section citations on each answer, diagrams and attachments are not implemented. Revision history is now displayed to the author.
- Repeat learning-page browser checks with Trainee, Technician, Engineer and Head accounts; verify native 200%/400% zoom; perform assistive-technology review and business UAT. The current browser run uses a Team Lead at normal browser zoom.
- No model-specific technical facts are supplied by the source handout. The source does not establish a particular vehicle's class, driven axle or component fitment.

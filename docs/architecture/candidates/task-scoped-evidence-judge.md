# Task-scoped evidence upload — cross-judge

## Rubric scores

Scores are from 1 (weak or incomplete) to 5 (strong and explicit).

| Criterion | Candidate A | Candidate B | Finding |
| --- | ---: | ---: | --- |
| Current assignment and organisation/site/work-order/task/plan/assignment binding | 5 | 5 | Both bind upload intent and final association to the exact current assignment and require a final server-side recheck. |
| Private quarantine and clean-scan safety | 5 | 5 | Both reuse the existing work-order-targeted upload/scanner path and require accepted state plus a matching clean hash before association. |
| Append-only, replay-safe atomic association without changing work-order version/event stream | 4 | 5 | A has a separate task attach command and durable link; B commits the task link in the existing work-entry command, avoiding a second command and keeping the work-order event stream untouched. |
| Read/download/report and correction integrity without storage keys | 5 | 5 | Both extend authorization, correction handling and report projection with safe labels only. |
| Maintainable interface and verifiable denial cases | 4 | 5 | B makes a work entry the one durable association point. A adds an independent attachment action and command, although it allows association before an explanatory entry exists. |
| **Total** | **23/25** | **25/25** | Candidate B is the recommended base. |

## Recommendation

Use Candidate B as the base. Keep task upload intents separately bound to the work order, task, plan revision and assignment revision. Treat uploaded bytes as creator-only staged evidence until the assigned worker records a finding, test, action or follow-up that includes the accepted evidence ID. In the existing task aggregate command, atomically create the immutable task evidence relation alongside the work entry and its evidence relation. Recheck writable membership, active role, current assignment, latest clean verdict/hash, and the exact task-intent binding under the same serialized transaction.

This has the smaller mutation surface: one final command, one task event and receipt/outbox sequence, and no work-order aggregate event/version change. It also makes the report show evidence in the context of the work entry that explains it. Candidate A's separate attach step is useful only if VMMS later needs standalone task attachments that do not document a work entry; that need is not present in the accepted task contract.

## Grafts and cautions

Graft Candidate A's explicit scan-state UI: show selected filename, size, pending/accepted/rejected state, and a separate deliberate save action. Do not allow a pending upload to be attached. Keep file bytes out of browser storage and require reselection after refresh where the browser no longer has the file.

Candidate B must make the task-intent binding immutable and part of idempotent intent creation. A generic unlinked work-order upload must not be promotable into a task work entry merely because the user is currently assigned to that order. Task evidence must remain creator-only before the work entry links it. A later correction must preserve the original entry and original evidence relation; any changed file belongs only to the correction entry.

Neither candidate may whitelist `work-order.evidence-attached` in `currentAssignment()`. That event can reflect changed repair or safety scope and must continue to invalidate handoff. The task evidence association must emit only the appropriate task aggregate event and must not write to `work_orders.version`.

## Verification required

Use PostgreSQL and a real browser journey to verify current-assignee success after handoff; all stated stale, wrong-actor, wrong-site, role-revocation, read-only, pending/rejected/hash-mismatch and wrong-task denials; duplicate/lost-response replay and changed-payload conflict; atomic rollback; unchanged work-order version and event count; creator-only staged access; authorized linked read/download with audit and no storage key; correction preservation; and report labels/pagination. Verify responsive and keyboard behavior. Do not treat synthetic browser fixtures as staff UAT or production scanner/storage proof.

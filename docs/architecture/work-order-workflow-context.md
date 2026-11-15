# Work-order workflow context

The work-order detail screen needs to explain the current step without inventing a single owner or treating a visible action as permission. The server derives the `workflowContext` field from the same site-scoped work-order records used by the existing assignment and handover panels.

## Current stages

| Stored state | Responsible party shown | Next step shown |
| --- | --- | --- |
| Operations review is absent or no longer current | Operations queue | Review the job before assigning a team lead |
| Current Operations review, no current lead assignment | Operations queue | Assign a qualified team lead |
| Current lead assignment, no current work plan | Named team lead | Prepare the work plan |
| Current work plan, no current supervisor handover | Named team lead | Assign a qualified supervisor |
| Current supervisor handover | Named supervisor; individual technician assignments remain in the task section | Assign tasks and record work progress |

The last state can involve several technicians. The summary therefore names the supervisor responsible for the handover while task-level assignees stay attached to their own work. It does not claim one technician owns the entire job.

## Authorization and readiness

The summary is a navigation aid. Every command continues to check current grants, membership, qualification, site, version and any required evidence at save time.

- Operations review readiness comes from the current actor's Operations-review grant check.
- Work-plan readiness and its reason come from the server's work-plan permission check.
- Team-lead assignment, supervisor handover and task-allocation readiness are checked in their existing action sections, which use their own current eligibility reads.
- A blocked reason is shown only when the detail projection has an exact reason for that step. Otherwise, the summary points to the action section that performs the check.

## Inputs that are not configured

- Work orders do not have an approved due-time or repair-deadline field. The projection returns `dueAt: null`; the page says “No due time recorded.” Service-request callback times are not repair deadlines.
- No approved per-job SOP evidence checklist exists yet. The page says it is awaiting approved SOPs. The static G1–G5 placeholders and evidence malware-scan state are not used as evidence requirements.
- Technical completion, independent inspection, team-lead release, invoice approval, payment/guarantee and client handover remain separate transitions. This summary does not imply that those actions are implemented or available.

## Source and checks

The projection is appended to the existing site-scoped, read-audited work-order detail response. It uses Operations review currentness, the current team-lead assignment, work-plan currentness and supervisor handover currentness. The pure stage mapping has focused API tests; the PostgreSQL work-plan browser flow verifies the source state and the rendered next step through review, assignment, work plan and handover. Owner approval of SOPs and scheduling policy, and staff UAT, remain open.

Related policy: [service journey](service-journey.md), [technical completion and release](technical-completion-and-release.md), [USER-040 navigation synthesis](candidates/user040-navigation-synthesis.md).

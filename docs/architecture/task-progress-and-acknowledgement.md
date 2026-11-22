# Task acknowledgement and progress

Status: accepted engineering design for coordination updates. This design does not approve technical execution, completion, inspection, vehicle release or commercial handover.

## Boundary

The current allocation revision is the unit of accountability. A Technician, Engineer or Trainee can acknowledge that exact assignment and append progress, a blocker, a request for help/parts/information/access, or a comment. Each entry records the work plan revision, assignment revision, actor and time. Entries are append-only. A reassignment preserves earlier entries and creates a new active assignment revision.

An update is not a completion claim or permission to begin work. There is no completion state or percentage. Existing safety controls, approved procedures, diagnostic consent and signed authority still govern work. Supervisor completion, Team Lead release, Head inspection, customer contact and G5 handover remain separate future transitions and remain disabled pending their policy and authority prerequisites.

## Command and access

- Read/write requires an active writable site membership and an active Technician/Engineer/Trainee placement.
- The actor must be the current assignee on the current handed-off plan, at the same organisation and site.
- The client supplies the work-plan ID and assignment revision it observed. Stale or reassigned work conflicts and must be refreshed.
- Every command has an idempotency key and runs under the serialized work-order root. Activity does not increment the work-order version or invalidate the work plan.
- Reads show activity attached to the current task. The current assignee can see prior-revision history for that task; removed or former assignees lose access after reassignment.
- The current handoff Supervisor can read the paginated update feed for tasks currently allocated to active direct reports at the same site. The Team Lead currently assigned to the work order and Head of Service Centre can read the feed across that current plan, subject to the same current-Supervisor and direct-report boundary. These oversight reads are site-scoped and audited. They are read-only; they do not approve, resolve or reassign an update request.
- A former assignee or Supervisor who is no longer the current handoff recipient cannot read the task stream. An unassigned Team Lead and other staff cannot use the oversight feed. History remains stored and visible to the current assignee, current Supervisor, assigned Team Lead and Head when the task remains in the current plan.
- Escalation and notification rules remain future work. A request in the feed means the worker is waiting for a response; it does not grant anyone authority to supply parts, access, evidence or approval.

## Plain-language activity types

| Entry | Meaning |
| --- | --- |
| Acknowledgement | The assigned worker has seen this task. |
| Progress | A short update with `working`, `waiting`, or `blocked` status. |
| Request | A request for help, parts, information, access, or evidence. It is not an approval request. |
| Comment | A note attached to the task. |

## Worker report for Supervisor review

An assigned Technician, Engineer or Trainee can send a structured report for Supervisor review after recording work on the current assignment. The report records the worker's summary of actions, checks and results, their reported outcome (`reported-complete`, `reported-incomplete`, or `blocked`), and remaining work or concerns. VMMS snapshots the exact current work-plan and assignment revisions and the task work-entry IDs included in the report. The report is immutable and appears in the existing current-plan Supervisor, assigned Team Lead and Head activity feeds; the Supervisor review inbox links to that work order.

This is the worker's report, not a task state change or sign-off. `reported-complete` is not verified completion. It does not authorize work, satisfy a qualification or action grant, approve a procedure, clear a hold, complete G3, release G4, or permit customer contact or departure. The Supervisor may respond with an attributed coordination note, but that response is not a sign-off. G3 remains unavailable until its effective instructions, evidence rules, action grants and qualifications are configured and checked by the separate G3 command.

The interface must say that updates do not complete the task or authorise work. If a safe operating instruction is not available, the user must contact the Supervisor and follow the effective procedure library.

## Verification

Cover current assignee allowed, wrong actor/role/site denied, stale plan or assignment rejected, duplicate command replayed without duplicate history, different payload under same key rejected, activity append-only, and no work-order version/G3/G4 or grant change. Browser and keyboard checks must confirm the update form is understandable at phone and desktop sizes.
# Cross-work-order requests for supervisor review

Technicians can ask for guidance on an individual task. The request is an append-only activity and does not complete the task, authorize repair, clear a hold, or grant sign-off authority. Supervisors, the Team Lead currently assigned to the work order, and the Head of Service Centre can see unanswered requests on Today.

The queue is limited to the current site, current work plan and handoff, current assignment revision, and the technician's active direct-report placement. Requests disappear when answered or when the underlying assignment/plan is no longer current. Reads are audited and responses are non-cacheable. A queue row links to the work order, where the reviewer can read context and reply using the existing review action.

The queue is an operational inbox only. It is not a task completion, independent inspection, release, or approval workflow.

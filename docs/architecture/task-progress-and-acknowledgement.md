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

The interface must say that updates do not complete the task or authorise work. If a safe operating instruction is not available, the user must contact the Supervisor and follow the effective procedure library.

## Verification

Cover current assignee allowed, wrong actor/role/site denied, stale plan or assignment rejected, duplicate command replayed without duplicate history, different payload under same key rejected, activity append-only, and no work-order version/G3/G4 or grant change. Browser and keyboard checks must confirm the update form is understandable at phone and desktop sizes.

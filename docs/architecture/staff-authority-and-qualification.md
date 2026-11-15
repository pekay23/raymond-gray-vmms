# Staff authority and qualification scope

**Status:** Engineering contract for the empty-by-default authority registry. It does not approve a person, privilege, technical procedure, or operational transition.

## Separate permission from competence

An authority grant answers whether a named person may perform a specific system action at a site during a validity period. A qualification records assessed competence and its approved scope. A job title, administrator flag, team assignment, or qualification by itself grants no system action.

The master specification defines a competence grant as a person, privileges, systems/models, validity, assessor, and restrictions (`master-0137`). The accepted registry starts that record with `staff_qualifications`: named person, qualification code/revision, assessed state, evidence reference, assessor, assessment time, and validity interval. Migration 023 adds the scope arrays `powertrain_classes`, `vehicle_models`, `systems`, and `task_classes`, plus a structured `restrictions` array.

## Fail-closed scope rules

- Empty scope arrays mean no approved scope. They are never a wildcard.
- A class-sensitive assignment requires the qualification's `powertrain_classes` to include the work order's recorded class.
- A qualification with any restriction is not eligible for the current assignment and supervisor-handoff actions. There is no restriction evaluator yet, so the system does not assume a restriction is irrelevant.
- Model, system, and task-class scopes are stored as explicit future decision dimensions. No current execution/signoff action may treat them as evaluated until its owning command checks the specific values against an effective instruction and authority policy.
- Only `accepted` qualifications within their effective dates are considered. Pending, rejected, revoked, expired, inactive-person, and inactive-membership records never qualify.
- For the same person, site, and qualification code, only the highest non-pending revision is considered. A later rejected, revoked, or expired revision cannot cause an older accepted revision to become active again; a pending reassessment leaves the prior accepted revision subject to its original validity dates.
- Grants and qualifications are empty by default. Runtime staff cannot mint, update, or delete them; controlled provisioning is a separate governance task.

The current EV/ICE/HYB team-lead and supervisor assignment operations check class scope and require an empty restrictions list. Hybrid routing remains a manually selected qualified lead per the owner's decision. These checks prove only the assignment qualification contract; they do not authorise repair, technician dispatch, G3 completion, inspection, G4 release, or vehicle departure.

## Work needed before G3/G4

The controlled SOP-002/SOP-003 library, named technical authority schedule, model/system mappings, task requirements, inspection matrix, and restrictions policy are not supplied. Do not seed authority, invent model procedures, or treat an accepted synthetic qualification as a real staff approval.

The G3 implementation must capture technician task assignment and current privilege, effective instruction revision, actual labour and parts, tests and outcomes, deviations, required evidence, and an attributable technician declaration. The assigned eligible supervisor then signs the overall technical completion and the server records its timestamp. G4 remains a separate team-lead release after applicable independent checks. Neither transition is available until the appropriate effective policy and decision evidence can be checked atomically. See `REV-006`, `REV-008`, `REV-009`, `R-M-0037`, and `R-M-0137`.

The exact boundary between an authority registry row and an approval decision snapshot is specified in the [authority decision contract](authority-decision-contract.md). Existing Operations and assignment snapshots are partial evidence only; thresholds, verified signed authority evidence, and links across estimate/task/finance/QA decisions remain open under `R-M-0132`.

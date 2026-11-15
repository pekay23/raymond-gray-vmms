# USER-040 navigation design synthesis

**Selection:** Candidate B, role workbench with contextual records. The cross-judge scored Candidate A 10/12 and Candidate B 11/12 on the six-item rubric. Scores judge design fit only; they are not implementation evidence.

## Why Candidate B is the base

Candidate B gives staff the same Today entry point while keeping Requests, Work Orders and Vehicles/history as distinct record spaces. It describes multi-role staff, Sales-only staff, Operator-only staff and site switching more carefully, and requires failure, empty, denied, offline and unknown states to stay distinct. It avoids turning a linked request and its work order into duplicate actionable records.

## Grafts from Candidate A

- Use a few conditional quick actions that deep-link to current authorized flows; do not create new mutations or approval shortcuts on Today.
- Keep Candidate A's job information contract: display the stored owner/assignment, stored due time, known evidence requirement and exact current block reason only when the scoped projection provides them. If no next action is stored or policy-derived, say so; do not infer it from role names.
- Add explicit viewport, keyboard, zoom, reduced-motion, session-expiry and site-switch checks to Candidate B's responsive/accessibility matrix.

## Rejected or deferred

- Keep **Work orders** as the global label until `REV-039` resolves the proposed “Jobs” wording. Candidate B's original wording was corrected above.
- Do not build a merged cross-domain inbox, generic urgency ranking or universal next-action engine in this navigation slice. Those require explicit projection, audit, site scoping and workflow semantics.
- Do not show Jobs or intake links to Sales-only users solely because they have a non-Operator role. Build the shell from the selected site's available capabilities; the server continues to enforce every direct route and operation.
- Do not claim that every role has a complete Today data feed until its source, failure state and empty state are implemented and tested.
- Keep technical completion, inspection ordering, release, invoice, payment/guarantee, collection and delivery disabled pending the approved SOP, authority schedule and `REV-046`.

## First implementation slice

Add a role-aware Today route and simplify the shell into daily areas and a labelled More area, while retaining every existing route. Preserve current Sales-only and Operator-only destinations until their Today views can show useful, authorized work. Resolve landing navigation against the selected site rather than the first site in the session. Keep current record labels, permissions and workflow policy unchanged.

## Verification boundary

Before moving the USER-040 navigation leaf to verified, test route/link visibility and destination for Head, Advisor, Team Lead, Supervisor, Technician, Sales-only, Operator-only, combined roles and two-site users. Confirm that hidden-link bypasses still receive the server's existing denial; test loading/empty/failure/offline states, keyboard and screen-reader names, 320px–desktop reflow, zoom, and sign-out/site-switch navigation. USER-040 remains in progress until the separate job information contract and its evidence also pass.

# Checklist template and instance storage verification — 2026-11-14

## Result

Added revisioned storage for site-scoped PDI and routine-maintenance templates, work-order checklist instances, immutable item snapshots and append-only item outcomes. Template content and source links are separate from append-only review/effectivity decisions. Applicability requires exact make, model, variant and powertrain. A staff-only read API now filters exact-vehicle templates by current effective source files and the saved publication-grant snapshot; it returns a clear unavailable state when no qualified template is found. The work-order page displays checklist availability and existing records. Runtime access remains SELECT-only; there is no template-authoring or checklist-start route.

All three migrations were applied by disposable PostgreSQL test databases. The latest focused PostgreSQL run passed 3 tests covering intake setup, exact-vehicle checklist availability and checklist instance storage. It verifies active after-sales access, denial for sales-only users, read auditing, exact effective vehicle applicability, current clean source evidence with matching digest/target, current publication-grant snapshot, runtime write denial, refusal of source-free effectivity, work-order-bound snapshots, reason-required outcomes and immutable item definitions. API typecheck passed; all 34 web unit tests passed; the production web build passed. The complete API suite passed: 127 tests, 126 passed, 0 failed and 1 optional S3/ClamAV integration test skipped. During the full run, two fixed-count assertions were replaced with comparisons against the current site-scoped fixture, then both affected tests passed in a focused run and the full suite passed.

## Safety boundary

- No effective procedure, technical inspection value, reviewer grant or OEM schedule was added.
- Checklist instance and item tables remain SELECT-only for the runtime; they cannot yet be created or changed through the application.
- The read path checks exact vehicle applicability and the latest effective decision, then requires source evidence to be accepted, scan-clean, digest-matched, current and linked to the exact controlled-document revision. It also checks the saved publication-grant snapshot against the current active grant before listing a template.
- Those checks only establish read-side eligibility from existing governance records. There is no template authoring/publication command, so the system cannot verify review independence, reviewer placement or approval procedure at decision time.
- Instance start/update, command-level item JSON validation, review, release integration and reports remain unimplemented. The database's immutable snapshots and outcome constraints do not by themselves provide an operational checklist workflow.

## Next work

Continue `BUILD-USER-043-TEMPLATE-001` with a governed authoring/publication command and approved exact-model schedules. Implement the versioned work-order instance command, outcomes, review, reports and complete responsive interactions. Keep these tasks open until their own acceptance evidence exists. The latest full API suite is green, but UAT, live database configuration, browser/device verification and the owner/technical approvals in REV-008 and REV-053 remain open.

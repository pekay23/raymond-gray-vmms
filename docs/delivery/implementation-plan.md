# VMMS implementation plan

This is the execution plan for the new Raymond Gray VMMS. The complete product goal remains active. The first usable delivery is a staff web application for one service centre, with organisation/site boundaries for later expansion. The owner confirmed reliable internet, saved drafts, no real records in the prototype portal, and a separate historical maintenance backlog to import later.

The [system design](../architecture/system-design.md) fixes the engineering shape. The [requirement inventory](../requirements/requirements.json) fixes traceability. [Task data](tasks.json) fixes execution status and dependencies; the [generated tracker](implementation-tracker.md) is its readable view. Pending business choices belong in the [review register](../decisions/review-register.md). The two source DOCX files and their hashes are retained under `docs/sources`.

## Definition of complete

Every applicable requirement has a source, acceptance criteria, implemented server control where required, migration/import decision, test or UAT case, evidence, owner and honest status. All twenty source acceptance scenarios are resolved through passed evidence or an explicitly justified scope decision. No screen, seed account, unit test, graph index or successful build constitutes operational approval.

Completion includes staff and approved vehicle-owner portal access, cross-owner and cross-site isolation, negative safety cases, concurrent stock/finance/release behavior, private evidence handling, reconciliation, measured restore, staff training, pilot acceptance and the post-launch review. Physical-device and native-package promises require their own evidence. Management signs Issue 1.0 operational readiness separately from engineering completion.

## Delivery sequence

| Phase | Deliverable | Exit evidence | Dependencies |
| --- | --- | --- | --- |
| 0 Discovery and contracts | Source extraction, prototype audit, requirement mapping, architecture comparison, review register and task graph | All source blocks accounted for, links/IDs valid, chosen command/module contracts | Supplied specifications and source repositories |
| 1 Web foundation | Individual staff sign-in, current site scope, actual reception queue, persisted reception drafts, C01/C02, planned tasks, scoped protective holds and audit history | Real PostgreSQL API tests and browser end-to-end persistence; no accepted gate implied | Database/runtime role, initial API contract |
| 2 Reception and authorised planning | Canonical customer/vehicle ownership, approved-owner portal, lookup and repeat visits, bookings, custody/photos/triage, G1, diagnostic consent, findings, versioned estimates and G2 task/payer approvals | Reception and owner-access pilot, cross-owner denial and negative consent/scope tests; effective document and authority configuration | Private evidence and approved intake policy |
| 3 Technical safety and quality | Named privileges, model/task limits, supervision, HV permit references, equipment readiness, labour, declarations, independent inspection, risk disposition and G3/G4 | AT-03 through AT-09, AT-14/15 and hold/release races using true runtime role | Signed authority schedule, inspection matrix, model-specific procedures |
| 4 Parts and commercial control | Catalogue/fitment, procurement delegations, receipt/quarantine, lot/serial custody, reservations/issues/returns, cost ledger, payer and recovery, invoices/receipts/G5 | Stock and cost reconciliation, dealer-warranty financial pilot, AT-10 through AT-13 | Finance rates/tax/accounts/terms and integration decisions |
| 5 Governance and readiness | Document revision/effectivity, acknowledgements, audits/CAPA, incidents/emergency records, training, equipment lifecycle and facility acceptance | Controlled SOP-only instructions, effective authority and calibration dashboards, operational readiness cases | Actual draft library/register and management approvals |
| 6 Historical data and reporting | Staging importer, client/customer relationships, source aliases, reviewed status mapping, reconciliation; defined WIP, quality, finance and throughput metrics | Synthetic import tests, real-batch dry run when data arrives, reconciled report drill-down | Historical data inventory and mapping approval |
| 6 Launch engineering | Production identity/MFA, private storage, staging, TLS/domain, monitoring, backup/restore, performance, threat checks, training and user guides | AT-16 through AT-20, staff UAT, restore and recovery evidence | Hosting, operational owner, pilot staff, approved policies |
| 6 Controlled pilot and Issue 1.0 | One site, limited staff and controlled configuration; defect review and management sign-off | Signed pilot record and 30-day safety/quality/finance audit | All launch-critical requirements, rollback/forward recovery |
| 7 Device rollout | PWA installation, shared iMac/Windows/tablet workflow, camera/scan/print and optional native bridges | Device/browser matrix with actual hardware evidence; signed packages only if justified | Procurement and measured hardware needs |

Full offline sync is not a launch dependency under the owner's decision. Its future investigation is tracked separately and cannot be marked implemented by saved drafts. A native application is similarly conditional; supported browser access satisfies the initial platform route only after its browser checks.

## Work in independently verifiable units

For each unit, select the task and linked requirements, inspect the current owning code with CodeGraph, state the behavior to prove, implement the smallest complete operation, and run checks against its real database/API/browser path. Record failures and any new task before moving to the next unit. Use Graphify's local code-only graph for bounded relationships and change impact; neither graph replaces tests.

Commands, data invariants and verification come before their UI controls. Safety actions require denial tests as well as success tests. A command changing release eligibility must use the same aggregate lock/version protocol as hold creation. Stock and financial commands require exact arithmetic, allocation and reversal examples before code.

The first slice intentionally stores intake as a draft because the full evidence pipeline does not yet exist. This proves useful foundations without confusing them with accepted custody, authorised repair or technical release. Later phases complete G1-G5 as independent decisions rather than relaxing the specification to match the initial screens.

## Agent handoff rules

1. Read this plan, the architecture, applicable requirements and exact task acceptance before editing.
2. Assign one writer to each file group, tracker and migration sequence. Use isolated worktrees when edits would overlap.
3. Give each agent exact owned paths, required contract, prohibited shortcuts, test command and evidence path.
4. Install shared dependencies with one owner after manifests are ready. Do not race lockfile writers.
5. The integrating agent reads actual artifacts, runs the affected checks and corrects the shared tracker. A delegate's completion message is not evidence.
6. Update `docs/delivery/decisions.tsv` for material choices, rejected approaches, verified units and verification limits. Keep source claims distinct from runtime proof.

## Status rules

Use the JSON records' explicit status definitions. Planned, in progress, configuration required, blocked, not applicable and verified mean different things. A not-applicable decision needs an owner and reason. Prototype-data migration is not required because the owner confirmed there are no real prototype records. The external maintenance backlog remains planned and cannot inherit that exemption.

Do not mark an entire module or source acceptance scenario complete when only one subcase passes. C02 on the same work order is an important first check, but full AT-02 also needs independent diagnosis. Receipt tests do not establish a release race that does not yet have a release command. Keep the overall goal open while applicable work remains.

## Dependencies that do not stop local implementation

The actual SOP library, staff grants, finance policy, identity provider, hosting account, historical inventory and procurement list are unavailable. Build the configuration model, validation, synthetic cases and review tools now. Leave affected operational approval paths fail-closed. Ask the owner only when the next action needs a real decision, data source or external configuration.

Production purchases, domain changes, publishing and use of real records must be concrete and reviewable before execution. Do not deploy the development seed, development secrets or incomplete gate controls. The local demonstrator is not an operationally approved service centre system.

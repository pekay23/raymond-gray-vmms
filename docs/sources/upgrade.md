# Raymond_Gray_VMMS_Upgrade_Implementation_Prompt.docx

[upgrade-0001] Software Upgrade — Master Implementation Prompt

[upgrade-0002] Ready-to-use instructions for the software development team or AI coding agent

[upgrade-0003] Document status | Development specification — not an approved operational SOP

[upgrade-0004] System title | EV Service Centre Operations & Quality Management System

[upgrade-0005] Design rule | Audit first → reuse/enhance existing → additive migration → test → controlled release

[upgrade-0006] 0. Assignment and operating constraint

[upgrade-0007] Upgrade the EXISTING Raymond Gray Vehicle Maintenance Management System to implement the EV Service Centre Operations & Quality Management System (EVSC-OQMS). This is an in-place, gap-based enhancement. Do not rebuild, replace, replatform, duplicate or delete working functionality merely because this specification describes it. Preserve existing customers, vehicles, service history, jobs, invoices, inventory, identifiers, integrations, branding and access patterns unless a documented migration is approved.

[upgrade-0008] The business rules are the authority; the technology stack is not prescribed. Inspect the actual repository, deployed environment, database schema, interfaces and integrations and use the present architecture unless changes are demonstrably necessary. The SOP library is a controlled DRAFT baseline, not approval to automate unsafe activities or impose unapproved financial limits.

[upgrade-0009] 1. Inputs to ingest and hierarchy

[upgrade-0010] Existing live application, source repository, database/schema, migrations, test suite, environment configuration, deployed workflows and integration contracts.

[upgrade-0011] EV Service Centre Operations & Quality Management System draft library: Operations & Quality Manual; SOPs 001–010; governance SOPs EV-GOV-SOP-001–004; supporting technical, warranty, HV, personnel, parts, equipment and finance forms.

[upgrade-0012] Consolidated Master Document Register (105 entries) and Issue 1.0 Readiness Review; use reference reconciliation/aliases rather than inventing duplicate forms.

[upgrade-0013] Existing company-specific configuration: Raymond Gray as software owner; centre/tenant branding, legal operating entity, site, staff and cost centres are configurable.

[upgrade-0014] If a reference or business decision is unresolved, flag it as CONFIGURATION REQUIRED and retain a safe default that blocks only the affected approval—not unrelated lawful work.

[upgrade-0015] 2. Mandatory discovery audit — perform before code changes

[upgrade-0016] Inventory codebase, framework, services, scheduled jobs, APIs, integrations, authentication, hosting, file storage, queues and reporting stack; document dependencies and deployment process.

[upgrade-0017] Map existing tables/entities, primary/foreign keys, tenancy/site boundaries, data quality, indexes, audit history, backup/restore and retention configuration.

[upgrade-0018] Walk the real workflows for customer/vehicle, booking, check-in, job cards, inspections, estimate approvals, technician dispatch, parts, invoices/payments, warranty, staff, asset/tools and reports.

[upgrade-0019] Build a requirement-by-requirement gap matrix: EXISTING & COMPLIANT / EXISTING NEEDS ENHANCEMENT / MISSING / DUPLICATED / REQUIRES DECISION / NOT APPLICABLE, with code screen/table/API evidence.

[upgrade-0020] Identify duplicate UI features, entity models and document templates; choose one canonical object and migration/alias approach.

[upgrade-0021] Perform security and operational risk review: access permissions, customer data exposure, safety gate bypass, irreversible deletes, accounting consistency and concurrency conflicts.

[upgrade-0022] Present an audit report, proposed change set, migration plan, test plan and rollback plan BEFORE implementing any risky schema or workflow change.

[upgrade-0023] 3. Implementation rulebook

[upgrade-0024] Reuse existing modules when they satisfy the requirement. Enhance with additional fields, states, evidence, permissions or events instead of creating a second module.

[upgrade-0025] Use additive, backward-compatible migrations; avoid destructive changes, silent ID changes, overwritten histories or data copy duplication.

[upgrade-0026] Implement named rights and privileges, not unrestricted permissions inferred from role titles. Honour site/tenant restrictions and segregation of duties.

[upgrade-0027] Every key event is timestamped, attributable and append-only in the audit trail; corrections add a new event or version with reason.

[upgrade-0028] Enforce critical checks server-side / in transactionally secure business logic. UI-only validation is insufficient.

[upgrade-0029] Prefer configuration tables for named approval authorities, monetary ceilings, tax, payers, rates, privileges, retention, status rules and document revisions. Do not hard-code unapproved values.

[upgrade-0030] Never mark documents “approved,” personnel “authorised,” equipment “serviceable,” or jobs “released” without signed/verified evidence.

[upgrade-0031] Safety incidents and urgent protective actions may be logged with emergency exceptions; never interpret this as permission to bypass technical release or perform elective repairs.

[upgrade-0032] Design responsive technician, advisor, parts, inspector and management workflows with offline-friendly drafts where the current platform supports them.

[upgrade-0033] 4. Target functional workstreams

[upgrade-0034] Workstream | Enhance / add only if missing | Non-negotiable acceptance

[upgrade-0035] A. Customer, vehicle and reception | Existing CRM, VIN records, booking, intake, photos, odometer/SOC, condition, custody, accessories, complaints C01+, recovery linkage; detect duplicate VINs. | G1 reception accepted with timestamp and named advisor; repeat-visit links.

[upgrade-0036] B. Integrated work order & diagnosis | One WO with complaint lines, tasks T01+, diagnostic evidence (DTCs, screenshots, versions, manual references), confidence and restrictions; diagnostic consent. | G2 scope/approval gate; no unapproved repair or cost overrun.

[upgrade-0037] C. Workshop, task and QA | Technician assignment against privileges, task logs, actual parts/hours, declaration, independent critical inspection, functional/diagnostic verification and unresolved fault disposition. | G3 technician sign-off; G4 independent checks and signed technical release.

[upgrade-0038] D. HV, HSE and emergencies | Task classification, competent-person privileges, model-specific procedure references, permits, test instrument suitability, stop work, hazard/incident, damaged battery quarantine and response records. | Block affected HV actions until verified authorisation and permits; no generic instruction to isolate HV.

[upgrade-0039] E. Parts, procurement and inventory | Requisition, compatibility evidence, procurement approval, receipt/quarantine, reservation, WO/task issue, serial/batch trace, returns, supplier claims and counts. | No unapproved installation; stock and WO cost reconcile.

[upgrade-0040] F. Warranty, repeat repairs and payer | Case ID, warranty representation and evidence, technical cause, payer per cost line, dealership recharge, supplier/insurance recovery, claim ageing, complaint, goodwill and write-off. | Customer obligation and internal payer are independent; costs never silently absorbed.

[upgrade-0041] G. Competence and authority | Staff profiles, skill matrix, training, supervised experience, assessor evidence, written technical privilege certificates, expiry/revocation, QA/technical release and financial authority. | Named privileges checked at action time; grade ≠ authority.

[upgrade-0042] H. Equipment and facilities | Asset receipt, commissioning, calibration, pre-use checks, planned inspections, quarantine, tool custody, facility punch list and equipment-related job impact. | Block use of unsafe/unverified critical equipment.

[upgrade-0043] I. Finance and performance | Estimate/authorisation, job costing, billing, receipts, dealer invoices, receivables, discounts, WIP, labour productivity, quality and management dashboards. | G5 commercial closure only after G4; reconciled payment and cost records.

[upgrade-0044] J. Governance & document control | Controlled SOP revisions, approval matrix, records retention, incidents, audits, CAPA, change requests, distribution, staff acknowledgement and management reviews. | Only effective approved documents appear as operational instructions.

[upgrade-0045] 5. Canonical workflow and state machine

[upgrade-0046] Use or map current states to the following conceptual lifecycle without requiring identical labels: BOOKED → ARRIVED/RECEIVED (G1) → TRIAGE → DIAGNOSIS AUTHORISED → DIAGNOSING → ESTIMATE PENDING / APPROVED (G2) → DISPATCHED → IN WORK → TECHNICIAN COMPLETE (G3) → QA PENDING → TECHNICAL RELEASED (G4) → INVOICED → HANDED OVER / CLOSED (G5). Branches: HOLD–SAFETY, HOLD–CUSTOMER APPROVAL, HOLD–PARTS, HOLD–EQUIPMENT, HOLD–COMPETENCY, REWORK, DISPUTED PAYER, CANCELLED. Store transitions with actor, authority, time, reason and evidence.

[upgrade-0047] Gate integrity

[upgrade-0048] A work order can be created without repair authorisation. Diagnostic authorisation does not authorise parts replacement.

[upgrade-0049] Revised scope, added costs and new risks must suspend affected tasks until additional approval.

[upgrade-0050] G3 sign-off must show what was done; G4 must be separately signed by an eligible release person and include independent checks when required.

[upgrade-0051] G5 cannot complete with an unresolved technical hold or unapproved financial disposition.

[upgrade-0052] Permit safe administrative progress while an unrelated technical task is held; preserve per-task hold semantics.

[upgrade-0053] 6. Minimum data contracts

[upgrade-0054] Reuse equivalent existing entities. Each must have stable identifiers, owner/site scope, creator/updater metadata, and links to the controlling work order or case as appropriate. Avoid duplicate customer or vehicle truth.

[upgrade-0055] Customer / Organisation / Contacts

[upgrade-0056] Vehicle / VIN / model / variants / ownership

[upgrade-0057] Booking / Recovery / Intake / Custody

[upgrade-0058] WorkOrder / Complaint / Task / StatusEvent

[upgrade-0059] DiagnosticEvidence / Test / Attachment / ProcedureRef

[upgrade-0060] Estimate / Approval / Consent / Revision

[upgrade-0061] TechnicianAssignment / TaskCompletion / LabourEntry

[upgrade-0062] Inspection / CriticalCheck / TechnicalRelease / DefectHold

[upgrade-0063] HVRiskAssessment / PermitReference / Incident / Quarantine

[upgrade-0064] Part / StockLot / PurchaseRequest / PO / Receipt / Issue / Return

[upgrade-0065] WarrantyCase / PayerAllocation / RecoveryClaim / ReworkLink

[upgrade-0066] Employee / Training / CompetencyEvidence / Privilege / Delegation

[upgrade-0067] EquipmentAsset / Calibration / PreUseInspection / Maintenance

[upgrade-0068] Invoice / Payment / Credit / JournalExport / Receivable

[upgrade-0069] ControlledDocument / Revision / Acknowledgement / AuditFinding / CAPA

[upgrade-0070] 7. API, interface and integration expectations

[upgrade-0071] Reuse existing authenticated API patterns; expose new actions as services with server-enforced preconditions and idempotent identifiers.

[upgrade-0072] Provide role-appropriate pages: Front Desk, Technician Workbench, Technical Lead, Quality & Release, Parts, Warranty/Payer, Finance, Compliance/Authorisations and Management Dashboard.

[upgrade-0073] Capture attachments with immutable metadata, access rules, file type constraints, malware checks where supported and traceable export.

[upgrade-0074] Keep existing invoice/accounting/payment or notification integrations intact; extend with event-based adapter contracts where needed.

[upgrade-0075] Support generation of an auditable work-order closeout pack (evidence, approvals, parts, tests, QA, release, charges), not only a printable job card.

[upgrade-0076] Provide data export and admin review for audit without exposing protected employee/customer data to unauthorised users.

[upgrade-0077] 8. Migration, deployment and safeguards

[upgrade-0078] Baseline backup and tested restore; capture row counts, record IDs, foreign-key integrity and audit snapshots.

[upgrade-0079] Create backward-compatible schema migrations and migration tests; preserve legacy IDs, links and document references as aliases.

[upgrade-0080] Backfill only deterministically supported values; label all unmappable/unknown historical approvals as UNKNOWN, not retrospectively approved.

[upgrade-0081] Put new gates behind feature flags/configuration for controlled pilot; run existing workflows regression tests.

[upgrade-0082] Migrate one representative site and sample of historical jobs, verify reconciliation and user acceptance; then deploy incrementally.

[upgrade-0083] Create rollback that preserves newly written records or provides a documented forward-recovery path.

[upgrade-0084] Document every migration, release note, user training need, unresolved decision and post-deployment support owner.

[upgrade-0085] 9. Tests required for completion

[upgrade-0086] ID | UAT / regression acceptance test

[upgrade-0087] AT-01 | Existing vehicle/service records and invoices remain accessible; no duplicates/ID changes.

[upgrade-0088] AT-02 | Second customer complaint creates C02 on same WO, independently diagnosable.

[upgrade-0089] AT-03 | Technician cannot perform HV-restricted task without current model/task privilege and permit.

[upgrade-0090] AT-04 | Diagnostic authorisation alone cannot authorise a replacement part.

[upgrade-0091] AT-05 | Extra cost over approval threshold holds only affected task; revised approval resumes.

[upgrade-0092] AT-06 | A technician cannot perform a required independent check on their own critical task.

[upgrade-0093] AT-07 | Unresolved intermittent fault routes to disposition and release risk decision.

[upgrade-0094] AT-08 | Technical release cannot occur with open safety hold, failed test or missing evidence.

[upgrade-0095] AT-09 | No commercial handover without technical release.

[upgrade-0096] AT-10 | Free-to-customer dealer warranty work posts dealer payer/recharge with receivable tracking.

[upgrade-0097] AT-11 | Supplier recovery is tracked independently from immediate internal payer.

[upgrade-0098] AT-12 | Rework links original WO and cause, with authorised payer and measured repeat rate.

[upgrade-0099] AT-13 | Part issued by lot/serial for compatible VIN; wrong-variant part blocked/quarantined.

[upgrade-0100] AT-14 | Expired calibration / failed lift pre-use check blocks equipment-dependent task.

[upgrade-0101] AT-15 | Expired/revoked authority blocks future approval but preserves historical proof.

[upgrade-0102] AT-16 | Audit trail records immutable previous/new state, actor, timestamps, reason.

[upgrade-0103] AT-17 | Legacy statuses, invoice reports and integrations pass regression tests.

[upgrade-0104] AT-18 | Race condition: two users cannot release same WO with conflicting holds.

[upgrade-0105] AT-19 | Permission/tenant leakage tests prevent cross-site and unauthorised record access.

[upgrade-0106] AT-20 | Backups, restore, deployment and rollback/recovery are exercised.

[upgrade-0107] 10. Required developer deliverables and completion definition

[upgrade-0108] Current-system audit and gap matrix with evidence references, diagram and identified risks.

[upgrade-0109] Prioritised implementation plan and dependency graph; make explicit what is reused, modified, added or deferred.

[upgrade-0110] Schema/data-contract delta and versioned additive migration/restore plan.

[upgrade-0111] Working code, UI/API changes, access policy, feature flags and automated tests.

[upgrade-0112] Field-level mapping to SOP/gate/form references, including canonical/legacy alias reconciliation.

[upgrade-0113] Demo workflows plus UAT evidence for AT-01 through AT-20, with defects and sign-off status.

[upgrade-0114] Admin configuration guide, staff role guides, technical runbook, deployment/rollback instructions and release notes.

[upgrade-0115] Final implementation report specifying which requirements are completed, partially completed, configuration-dependent, or blocked by missing management/technical sign-off.

[upgrade-0116] DEFINITION OF DONE: No requirement is counted complete merely because a screen exists. It must behave correctly in the existing application, preserve historical records, enforce permissions and approval rules in backend logic, pass acceptance tests, and be supported by migration/recovery and user documentation. Issue 1.0 operational approval remains a separate management act.

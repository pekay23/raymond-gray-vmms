# Raymond_Gray_VMMS_Master_Functional_Specification.docx

[master-0001] Master Functional & Technical Requirements Specification

[master-0002] EV Service Centre Operations & Quality Management System integration into the Raymond Gray VMMS

[master-0003] Document status | Development specification — not an approved operational SOP

[master-0004] System title | EV Service Centre Operations & Quality Management System

[master-0005] Design rule | Audit first → reuse/enhance existing → additive migration → test → controlled release

[master-0006] 1. Executive specification and scope

[master-0007] The Raymond Gray Vehicle Maintenance Management System (VMMS) shall support end-to-end operation, safety, accountability, evidence capture, quality assurance, customer treatment, inventory, cost recovery and performance management for a multi-brand automotive/EV service centre. This is a requirements baseline for upgrading an already-built application—not a replacement system design. The application must preserve current working features, reuse the existing data model, and introduce additions only where an audited gap exists.

[master-0008] System / programme title: EV Service Centre Operations & Quality Management System. Raymond Gray remains the product/system name. Site, trading brand, contracting entity, address, logos, labour rates, tax treatment and payer agreements are configurable; they must not be embedded into workflow logic. The operational library currently consists of draft SOPs/forms; digitisation does not confer formal approval or technician authority.

[master-0009] 2. Design principles and non-functional commitments

[master-0010] Single source of truth: customer, VIN, work order, tasks, costing and evidence linked by stable IDs.

[master-0011] Business logic over documents: forms are views/exports of canonical system records, not separate stores of contradictory data.

[master-0012] Five independent process gates: G1 reception, G2 authorised scope, G3 technical completion, G4 quality/technical release, G5 commercial closure.

[master-0013] Segregation: roles coordinate activities; separately assessed and signed privileges determine technical/financial authority.

[master-0014] Explicit payer responsibility: “free to customer” and “free to Service Centre” are never treated as synonyms.

[master-0015] Evidence-first diagnosis and release; preserve unknown/inconclusive findings honestly.

[master-0016] Configurable standards: SOP revision, approved authority, limits, required inspections, rate cards and case classes.

[master-0017] Responsive, accessible and usable workshop experience; minimal duplicate entry, role-specific task queues.

[master-0018] Secure by design: least privilege, encryption in transit/storage where available, auditable events, backup/restore.

[master-0019] Site/model-specific safety rules must come from approved instructions, not invented technical sequences.

[master-0020] 3. Target roles and actions

[master-0021] Persona | Core capabilities | Controls

[master-0022] Service Advisor | Booking, intake, communications, estimate and customer consent, commercial handover | Cannot independently certify safety/repair or decide warranty payer outside authority

[master-0023] Workshop Controller / Job Planner | Workload, task allocation, equipment and availability, WIP escalation | Cannot assign beyond staff authorisation

[master-0024] Technician / Trainee | Diagnosis/repairs within privileges, evidence, time and task sign-off | Trainees require documented supervision; no self-release

[master-0025] Technical Lead | Diagnosis review, scope, specialist escalation and competency-supervised decisions | Not automatically financial approver or independent inspector

[master-0026] Quality Inspector | Critical-task independent verification and quality test evidence | Cannot sign own designated independent inspection

[master-0027] Authorised Release Officer | Final technical release according to named authority | Cannot bypass safety/QA holds

[master-0028] Parts & Inventory | Reservations, receipts, issue/return, supplier claims, counts | Purchases subject to delegation and technical compatibility approval

[master-0029] Warranty / Customer Support | Case handling, coverage evidence, payer proposal, complaint SLA | Cannot unilaterally assign customer liability or waive rights

[master-0030] Finance / Billing | Cost ledger, invoices, receipts, dealer recharge, ageing, write-offs | Financial approval requires named thresholds

[master-0031] Compliance / Records / HR | SOP revisions, audits, CAPA, authorisations, records retention | No retrospective privilege alteration

[master-0032] Head of Service Centre | Oversight, escalations, delegations and management reporting | Approval constrained by agreed legal/financial authority

[master-0033] 4. End-to-end service lifecycle

[master-0034] Gate | Minimum required evidence | System behaviour

[master-0035] G1 — Intake | VIN, owner, complaint(s), custody, condition/photographs, mileage/SOC, safety triage | Creates one WO and Cxx lines; hold unsafe vehicle

[master-0036] G2 — Diagnose and authorise | Customer diagnostic consent; findings; task scope; quote; technical and commercial approvals | Locks unauthorised work; versioned estimates and approvals

[master-0037] G3 — Execute | Current technician privilege, task instructions, labour, parts, tests and technician declaration | Blocks task completion without required evidence; records deviations

[master-0038] G4 — QA/release | Critical inspection, functional verification, outstanding faults, risk disposition, release signatory | No release if open safety hold, failed inspection or missing independent check

[master-0039] G5 — Commercial closure | Invoice, named payer allocations, payment/recharge or credit terms, handover acknowledgement | No customer handover before G4; retain outstanding receivables properly

[master-0040] State model and exception handling

[master-0041] Work orders and tasks have separate state machines so one held task does not freeze an unrelated task.

[master-0042] A hold has type, severity, owner, reason, source, affected scope, opened/closed timestamps and release evidence.

[master-0043] A superseded approval remains historical; scope changes produce a new version and approvals cannot be silently reused.

[master-0044] Incident response, hazardous battery quarantine and road recovery create linked cases but do not automatically create repair authorisation.

[master-0045] Cancelled, no-show, duplicate and repeat work are retained and distinguishable; deleting history is not standard workflow.

[master-0046] 5. Detailed module requirements

[master-0047] M01 — Governance, documents, audits and CAPA

[master-0048] Controlled document object: reference, alias, title, owner, revision, status (draft/review/approved/effective/superseded), effective date, approvers, distribution and review cycle.

[master-0049] Show only current effective SOPs in employee work instructions; drafts accessible to reviewers with conspicuous labels.

[master-0050] Approval/delegation matrix binds person, role, site, privilege, work class, limits, validity and deputy; every decision snapshots the applicable grant.

[master-0051] Internal audit plans/checklists, findings, severity, corrective/preventive actions, root cause, due date, independent effectiveness verification and closure.

[master-0052] Incident/risk log linked to assets, vehicles, employees, work orders; notification/escalation and management review action tracking.

[master-0053] M02 — Customer/vehicle reception and service advisory

[master-0054] Customer/organisation/contact, vehicle VIN and registration, model/variant/powertrain, history, owner changes and communications preferences.

[master-0055] Appointment calendar with capacity, pre-visit parts planning, reminders and arrival/no-show states.

[master-0056] Check-in: complaints in customer wording, vehicle walkaround photos, odometer, SOC/fuel, accessories, pre-existing damage, keys and custody signature.

[master-0057] Customer communications timeline (notifications, estimate, delays, follow-ups) and customer approval artifacts; no invented consent.

[master-0058] Roadside rescue: incident location, dispatch, safety considerations, recovery provider, charges, transfer of custody and arrival verification.

[master-0059] M03 — Diagnosis, estimates and job planning

[master-0060] WO lines for complaint C01… and tasks T01… with links to symptoms, findings, manuals and test records.

[master-0061] Diagnostic capture: DTCs, freeze frame, software versions, conditions, photos, measurements, reproduction attempts, diagnostic certainty and residual risk.

[master-0062] Configurable diagnosis authorisation limit and approval evidence; estimate revision control and granular approval by task and payer.

[master-0063] Task dispatch validates staff competence/privilege, equipment availability and approved work scope.

[master-0064] Unexpected findings initiate variation/hold, customer update, revised cost and authorisation.

[master-0065] M04 — Workshop execution, technical QA and release

[master-0066] Task checklists, start/stop timestamps, work instruction revisions, actual labour, parts and nonconformance events.

[master-0067] Technician declaration records exact actions, tests and outcome; task sign-off is attributable and cannot be overwritten.

[master-0068] Independent inspection assignment for safety-critical tasks; segregation enforced by transaction checks.

[master-0069] Post-repair tests and final scan evidence; status of complaint: resolved, intermittent not reproduced, monitoring, unresolved, unsafe.

[master-0070] Named technical release signature with hard stop on unresolved safety holds; released vehicle locks critical work evidence against silent changes.

[master-0071] M05 — HV safety, battery and emergency readiness

[master-0072] Internal EV/HV authorisation classes, approved vehicle/model privileges, assessed competence, permit validity, supervision and restrictions.

[master-0073] HV task and risk flags trigger gated references to approved model-specific instructions and permits; do not code generic isolation technical values.

[master-0074] Battery impact/thermal/water ingress concerns, quarantine location, escalation, exclusion boundaries and specialist acceptance recorded.

[master-0075] Emergency readiness: shift controllers, verified contacts, evacuation/muster records, drills and incident response evidence.

[master-0076] Unsafe vehicle/asset hold blocks affected job or vehicle release regardless of commercial approvals.

[master-0077] M06 — Parts, procurement and traceability

[master-0078] Catalogue and alternatives with manufacturer part number, variant fitment, approved equivalent and supporting compatibility evidence.

[master-0079] Requisition tied to WO/task or approved stock replenishment; request/technical approval/financial PO approval are separate.

[master-0080] Goods receipt and quarantine records, serial/batch/supplier lot, inspection, stock allocation, issue/return and reserved quantities.

[master-0081] Trace critical fitted part from supplier/PO/receipt to VIN and task, and removed part to custody/disposition/claim.

[master-0082] Reorder levels, ABC/critical spares, backorder visibility, stock counts/variance approvals and supplier nonconformance.

[master-0083] M07 — Warranty, complaints, rework and payer responsibility

[master-0084] Warranty case with sale date, customer representations (written and disputed oral), coverage evidence, sales/dealer obligation and technical causation.

[master-0085] Cost lines with separate proposed and approved payer: customer, dealership, Service Centre, supplier, insurer/logistics, manufacturer, undecided.

[master-0086] Explicit labour/parts/diagnostics/recovery charges and internal recharge; approved goodwill/discount/write-off transactions.

[master-0087] Repeat complaint/rework links original WO, cause, corrective action, cost and responsible budget subject to evidence.

[master-0088] Supplier/insurance recovery independent of initial payer; claim submissions, outcomes, received funds, shortfalls and ageing.

[master-0089] Customer rights and safety controls cannot be overridden by an unresolved internal payer dispute.

[master-0090] M08 — Personnel, training and written authorisations

[master-0091] Employee profiles, grades, qualifications and experience distinct from named task privileges.

[master-0092] Skills matrix for vehicle model/system/tasks, supervised task records, curriculum/trainer attendance, practical assessment evidence.

[master-0093] Written authorisation with assessor, grantor, scope, restrictions, expiry, suspension and reinstatement; history preserved.

[master-0094] At assignment and signoff, verify active privilege and supervision; retrospective privilege changes never rewrite historical authorisation.

[master-0095] Training reminders, expiring certifications and management competency coverage dashboard.

[master-0096] M09 — Equipment, calibration and facility control

[master-0097] Asset register with serial, owner, custodian, commissioning acceptance, location and required inspections.

[master-0098] Calibration certificates, verification, expiry and affected job impact assessment if tool found out of tolerance.

[master-0099] Daily/pre-use inspection for lifts and critical test instruments with serviceable/quarantined status.

[master-0100] Preventive maintenance, fault/quarantine, vendor servicing, tool custody, stocktake and data sanitisation on disposal.

[master-0101] Facility readiness issues/MEP/ventilation/fire/waste punch list with contractor owner and Service Centre technical acceptance recorded separately.

[master-0102] M10 — Finance, operations and management intelligence

[master-0103] Configurable approved rate cards by labour class, service, customer contract, parts markup and currency; tax calculation follows current finance configuration.

[master-0104] Cost by task/WO/case: hours, parts, subcontract, recovery/transport, discounts, write-offs; gross margin and cost-centre allocation.

[master-0105] Invoice/receipt and payer account ledger; dealership warranty recharges, claims, aged debt and recovery reconciliation.

[master-0106] Daily WIP/throughput/holds, staff utilisation, actual vs sold hours, first-time-fix, rework, backlog, turnaround, parts fill rate and safety indicators.

[master-0107] Weekly operations review and monthly manager scorecard with drill-down to source records, definitional metadata and export.

[master-0108] 6. Business rules and validation matrix

[master-0109] Rule | System-enforced behaviour

[master-0110] BR-01 | One controlling work order per visit; many complaint, task, evidence and payer lines.

[master-0111] BR-02 | New repair scope requires its own valid authorisation; diagnostic consent is insufficient.

[master-0112] BR-03 | Technical privilege is named, valid, scoped and tested at action time.

[master-0113] BR-04 | Critical QA inspection is independent when the inspection matrix requires it.

[master-0114] BR-05 | Unsafe/HV/incident holds override commercial urgency and block affected release.

[master-0115] BR-06 | Technical release and commercial closure require different evidence and may have different signatories.

[master-0116] BR-07 | Warranty coverage decision and internal payer allocation are separate records.

[master-0117] BR-08 | Zero customer charge requires an alternative approved budget payer or explicit authorised write-off.

[master-0118] BR-09 | Claim recovery cannot be treated as cash received until payment is reconciled.

[master-0119] BR-10 | Inconclusive diagnosis cannot be automatically marked repaired; disposition and residual risk recorded.

[master-0120] BR-11 | Part fitment needs compatible vehicle variant and traceable approval where relevant.

[master-0121] BR-12 | Equipment out of service blocks affected tasks; assess historical work impacted by calibration failures.

[master-0122] BR-13 | Historical records are appended/versioned, never silently rewritten.

[master-0123] BR-14 | No unauthorised individual may approve their own delegated financial exception.

[master-0124] BR-15 | Document approval only by assigned reviewer/approver; a published template is not SOP approval.

[master-0125] BR-16 | Urgent safety safeguarding and billing approvals are logged separately; do not delay protective action to settle payer.

[master-0126] 7. Conceptual entity and relationship design

[master-0127] These conceptual domains are implementation-neutral. Map each to existing models where possible. The same vehicle must not be replicated between workshop, warranty and inventory modules. Each object should include tenant/site partition, stable ID, created/updated metadata, lifecycle status and policy-based visibility.

[master-0128] Concept | Key fields | Links

[master-0129] Vehicle | VIN (unique within tenant), brand/model/variant/powertrain, history | Customer, WorkOrder, WarrantyCase

[master-0130] WorkOrder | WO reference, visit/custody, gate/current status, site, opened/closed | Vehicle, Complaints, Tasks, Estimates, Release, Invoice

[master-0131] Complaint/Task | Cxx/Txx, problem/repair scope, diagnostic source, owner, state | WO, Evidence, PartsIssue, Labour, Approval

[master-0132] Approval/Authority | grant ID, action class, actor, scope, threshold, revision, signed evidence | Person, estimate/task/finance or QA event

[master-0133] SafetyHold/Permit | type/severity, scope, restrictions, resolver, evidence | WO, Vehicle, Asset, Incident

[master-0134] MaterialTransaction | SKU, lot/serial, quantity, custody, cost, disposition | PO, Receipt, Stock, WO/Task, Return

[master-0135] Warranty/PayerLedger | case, coverage, proposed/approved payer, cost line, claim, settlement | WO, Invoice, SupplierClaim, DealerAccount

[master-0136] Inspection/Release | inspection criteria, inspector, results, release actor, time, residual faults | WO, Task, Hold, Test

[master-0137] CompetencyGrant | person, privileges, systems/models, validity, assessor, restrictions | Assignment, Signoff, Training

[master-0138] Document/Quality | doc ref/version/effective state, audit, CAPA, acknowledgement | Task instructions, Evidence, Incident

[master-0139] 8. Authority and approval mechanics

[master-0140] Delegation configuration

[master-0141] Separate technical, inspection, release, customer/estimate, finance, governance and emergency privilege classes.

[master-0142] Store named individuals and substitutes, site scope, vehicle classes, signed effective interval, monetary thresholds and conflict-of-interest rules.

[master-0143] A person may hold several functions if allowed, but the mandatory independent inspection check cannot be waived by role overlap.

[master-0144] Every approved action stores a snapshot of authority at that time; access changes or revocation affect future acts.

[master-0145] Unapproved rates/limits remain inactive configuration values requiring management action; the system must not guess thresholds.

[master-0146] 9. Detailed reporting and measurement dictionary

[master-0147] Metric | Definition | Breakdown / caveat

[master-0148] Vehicle throughput | Count of distinct WOs G5-closed in period | Day/week/month; segment by payer, make and service class

[master-0149] Work in progress | Open WO by state/hold and ageing | Realtime and daily cutoff

[master-0150] Turnaround time | G5 handover timestamp minus G1 reception | Median, 90th percentile; segment parts/customer holds

[master-0151] Technician utilisation | Recorded productive task time / available scheduled time | Exclude authorised absence; report separately from efficiency

[master-0152] Labour efficiency | Approved/sold standard hours / actual clocked task hours | Only when standard hours available

[master-0153] First-time fix | Eligible completed WOs without linked same-fault return in defined window | Configurable window, exclude unrelated visits

[master-0154] Rework cost | Approved labour+parts+outsourced rework direct cost | By technical cause and approved payer

[master-0155] Dealer warranty receivables | Posted dealer recharges less receipts/credits | Age buckets; unapplied collections separate

[master-0156] Parts fill rate | Task parts fulfilled when required / task parts demand lines | Do not conceal backorder

[master-0157] Diagnostic quality | Complaint lines with evidence and disposition / applicable lines | Exclude N/A documented

[master-0158] Release compliance | Released WOs with all required approvals/checks / released WOs | Goal is 100%, drill down to any exception

[master-0159] HV authorisation coverage | Active named staff privileges vs required task demand | By model/system/site

[master-0160] Customer complaints | Open cases, first response timeliness, resolution and repeat complaints | Avoid implied legal SLA; configurable

[master-0161] Stock variance | Counted minus book quantity/value | By inventory category and approval

[master-0162] 10. Screens and user journeys

[master-0163] Screen / workbench | Required decisions and queues

[master-0164] Advisor daily board | Appointments; arriving vehicles; estimate approvals; customer updates; releases pending handover.

[master-0165] Technician task view | Assigned jobs, approved procedure, pre-task safety/privilege, diagnostic capture, parts issue, actual time, sign-off.

[master-0166] Technical lead console | Unresolved diagnostics, risky variations, review queues, qualified dispatch and root-cause investigations.

[master-0167] QA & release desk | Critical inspections pending, failed tests, open holds, required independent signoffs and vehicle release decision.

[master-0168] Parts counter | Reservations/backorders, fitment check, issue/returns, goods receipt, quarantine and supplier claims.

[master-0169] Warranty & payer desk | Case register, claim evidence, payer per cost line, dealer recharges, disputed cases and recoveries.

[master-0170] Compliance view | Effective SOPs, revisions, staff acknowledgements, expiring authorisations, audits/CAPA and incidents.

[master-0171] Manager dashboard | WIP, bottlenecks, safety, revenue/margin, debt, throughput, repeat faults, staff/equipment readiness.

[master-0172] 11. Security, integrity and operating reliability

[master-0173] Use the existing authentication strategy; add fine-grained authorization checks in backend services and DB access paths.

[master-0174] Protect sensitive customer information, employee competency records, incident data and photos through least-privilege roles and site segregation.

[master-0175] Audit significant read/export actions where sensitive data is involved; record every modification to safety, approval and finance records.

[master-0176] Sensitive evidence must use controlled storage with document hashes where feasible, limited signed access and backup coverage.

[master-0177] Encrypt in transit and at rest as supported, use secure session lifecycle, validation, rate limiting and safe logging with secrets redacted.

[master-0178] Write transactions atomically for stock issue, approved cost allocation, release, invoice and payment; use optimistic locking or equivalent concurrency control.

[master-0179] Establish retention schedules by record class and legal requirements via management configuration; allow legal hold and controlled export.

[master-0180] Backups, restore exercises, test/staging environment, disaster recovery and incident monitoring must be part of acceptance.

[master-0181] Provide accessibility, localization for Ghana cedi and other currencies, correct timezone handling and reliable printable outputs.

[master-0182] 12. Integrations, data imports and documentation mapping

[master-0183] Preserve existing payment, invoice, reminder, email/WhatsApp, document storage, diagnostic file import and finance interfaces if present.

[master-0184] Where manufacturer-specific diagnostic data cannot be integrated automatically, allow traceable upload and manual indexed metadata without pretending to have direct vehicle access.

[master-0185] Allow vehicle history and existing invoice/report exports while retaining source IDs and revision metadata.

[master-0186] Map SOPs to business workflow validations: SOP 001 intake, 002 technical execution, 003 WO, 004 parts, 005 HV, 006 emergency, 007 warranty/payer, 008 competency, 009 equipment, 010 finance, GOV 001–004 governance.

[master-0187] Preserve legacy reference codes and document aliases; canonical naming to be approved before operational Issue 1.0.

[master-0188] Do not convert the 105 master-register entries automatically into 105 separate software modules; group into workflows, reports, templates and controlled records.

[master-0189] 13. Migration and delivery roadmap

[master-0190] Phase | Scope | Exit evidence

[master-0191] 0 — Discover | Repository/DB/workflow audit and requirement mapping; no destructive changes. | Audit, gap map and change-control decision

[master-0192] 1 — Core controls | WO IDs, complaint/task model, approvals, holds and G1–G5 events; reuse existing job card. | Traceable end-to-end pilot

[master-0193] 2 — Safety and QA | Privilege check, critical inspections, model-specific permit references and release controls. | Safety/QA UAT, named authority setup

[master-0194] 3 — Commercial recovery | Payer ledger, warranty, rework, parts and invoicing reconciliation. | Dealer warranty end-to-end financial pilot

[master-0195] 4 — Asset and governance | Equipment readiness, training, document control, audit/CAPA and emergency records. | Operational readiness evidence

[master-0196] 5 — Reporting/launch | Dashboards, staff guides, regression, production pilot, 30-day audit. | Signed management acceptance and staged issue

[master-0197] 14. Detailed acceptance scenarios

[master-0198] AT-01 — Existing vehicle/service records and invoices remain accessible; no duplicates/ID changes.

[master-0199] AT-02 — Second customer complaint creates C02 on same WO, independently diagnosable.

[master-0200] AT-03 — Technician cannot perform HV-restricted task without current model/task privilege and permit.

[master-0201] AT-04 — Diagnostic authorisation alone cannot authorise a replacement part.

[master-0202] AT-05 — Extra cost over approval threshold holds only affected task; revised approval resumes.

[master-0203] AT-06 — A technician cannot perform a required independent check on their own critical task.

[master-0204] AT-07 — Unresolved intermittent fault routes to disposition and release risk decision.

[master-0205] AT-08 — Technical release cannot occur with open safety hold, failed test or missing evidence.

[master-0206] AT-09 — No commercial handover without technical release.

[master-0207] AT-10 — Free-to-customer dealer warranty work posts dealer payer/recharge with receivable tracking.

[master-0208] AT-11 — Supplier recovery is tracked independently from immediate internal payer.

[master-0209] AT-12 — Rework links original WO and cause, with authorised payer and measured repeat rate.

[master-0210] AT-13 — Part issued by lot/serial for compatible VIN; wrong-variant part blocked/quarantined.

[master-0211] AT-14 — Expired calibration / failed lift pre-use check blocks equipment-dependent task.

[master-0212] AT-15 — Expired/revoked authority blocks future approval but preserves historical proof.

[master-0213] AT-16 — Audit trail records immutable previous/new state, actor, timestamps, reason.

[master-0214] AT-17 — Legacy statuses, invoice reports and integrations pass regression tests.

[master-0215] AT-18 — Race condition: two users cannot release same WO with conflicting holds.

[master-0216] AT-19 — Permission/tenant leakage tests prevent cross-site and unauthorised record access.

[master-0217] AT-20 — Backups, restore, deployment and rollback/recovery are exercised.

[master-0218] 15. Approval dependencies, assumptions and exclusions

[master-0219] Management configuration pending

[master-0220] Written named technical/QA/release privilege schedule, roles and substitutes.

[master-0221] Financial delegations, rate cards, goodwill authority, internal dealer recharge terms, account codes and payment terms.

[master-0222] Effective controlled SOP revisions, retention schedules, legal entity name and privacy notices.

[master-0223] Site-specific EV/HV emergency, inspection, equipment commissioning and model-specific technical validation.

[master-0224] Approval that testing supports Issue 1.0—draft technical documents alone do not authorise operational deployment.

[master-0225] Excluded assumptions

[master-0226] No assumption about programming language, hosting provider, database engine or device platform.

[master-0227] No forced replacement of current screens, customer/invoice identifiers or accounting systems.

[master-0228] No manufacturer warranty coverage presumed for imported vehicles and no legal allocation of customer liability without evidence.

[master-0229] No procedural instructions for actual HV isolation derived from generic software rules.

[master-0230] No automatic issuance of staff privileges or financial approval limits from job titles.

[master-0231] No software go-live presented as operational or regulatory certification.

[master-0232] 16. Developer traceability and issue-control deliverables

[master-0233] For each requirement create a trace line: requirement ID → referenced SOP/record → existing feature and code/table → gap classification → planned implementation → migration → server-side control → UAT case → evidence → owner/decision → completion status. Output an as-built system map, updated data dictionary, admin configuration matrix and user manuals.

[master-0234] Recommendation: the implementation prompt is issued to the software development agent with this master specification and the full controlled draft documentation library as attachments. Confirm requirements against the actual installed application; enhancements must be additive and justified. Final Issue 1.0 approval remains a management decision based on completed validation evidence.

# Raymond Gray VMMS documentation

New hosting direction: [16 November managed-services redesign](delivery/managed-services-redesign-plan-2026-11-16.md) and [provider comparison](discovery/managed-auth-and-storage-2026-11-16.md). The owner excludes Railway and user-managed containers. Supabase/Vercel/Cloudflare is a provisional target, with explicit identity-policy and provider-capability gates.

This folder is the project record for the new Raymond Gray Vehicle Maintenance Management System. Start with the [implementation plan](delivery/implementation-plan.md) and [system design](architecture/system-design.md). Agents must follow the accepted decisions, update the tracker, and attach evidence before marking work complete.

## Authority

1. The user's explicit instructions and later approved decisions.
2. The [master functional specification](sources/master.md), with the original DOCX retained alongside it.
3. The [upgrade implementation prompt](sources/upgrade.md) where it is compatible with the above.
4. Accepted architecture decisions and the implementation plan.
5. Existing code and reference applications as evidence, not requirements.

`USER-001` authorises a new implementation rather than the documents' in-place upgrade. It does not authorise deleting records or replacing the existing live portal. Preserve source IDs and audit histories if records are migrated.

The source manifest contains SHA-256 hashes. `scripts/extract-specifications.py` regenerates paragraph and table-row references without changing the original documents. Source references such as `master-0070` are stable for these exact input versions.

## Read by purpose

| Purpose | Document |
| --- | --- |
| Architecture and contracts | [System design](architecture/system-design.md) |
| Current verification and limits | [Latest full local verification](verification/full-local-verification-2026-11-14.md); [browser navigation recheck](verification/checks/browser-navigation-resilience-2026-11-14.md) |
| Staff authority and qualification scope | [Authority and qualification model](architecture/staff-authority-and-qualification.md); [authority decision contract](architecture/authority-decision-contract.md); [partial implementation review](verification/authority-decision-contract-2026-11-14.md) |
| Read-only staff assignment protection | [Writable-membership assignment check](verification/checks/assignment-writable-membership-2026-11-11.md) |
| Google, passkeys, passwords and approved access | [Authentication design](architecture/authentication.md) |
| Shared sign-in across Raymond Gray products | [Shared identity architecture](architecture/shared-identity.md); [staging provisioning design](architecture/shared-auth-provisioning.md); [VMMS caller contract](architecture/shared-auth-provisioning-contract.md); standalone service at `C:\Projects\raymond-gray-auth`; [fresh local sign-in recheck](verification/oidc-local-2026-11-14.md); [RP-initiated sign-out check](verification/oidc-rp-logout-2026-11-14.md) |
| Shared sign-in theme and local persistence | [Responsive theme check](verification/checks/shared-auth-theme-2026-11-11.md); [restart and teardown check](verification/checks/shared-auth-persistence-2026-11-11.md) |
| VMMS Operator account lifecycle | [Operator account administration contract](architecture/operator-account-administration.md) |
| Shared-auth provisioning API and enrollment lifecycle | [VMMS/shared-auth contract](architecture/shared-auth-provisioning-contract.md); auth-side staging implementation in `C:\Projects\raymond-gray-auth\provisioning`; production review still pending under REV-045 |
| Isolated synthetic role test accounts | [Local role rehearsal design](architecture/local-role-fixtures.md) |
| Operator account request verification | [Local request-slice check](verification/checks/operator-account-request-slice-2026-11-10.md) |
| Saved intake and evidence draft recovery | [Saved-draft recovery check](verification/checks/saved-draft-recovery-2026-11-11.md) |
| Internal messages between staff | [Messaging verification](verification/checks/internal-messages-2026-11-11.md) |
| Operator provisioning worker boundary | [Synthetic worker verification](verification/checks/account-provisioning-worker-2026-11-10.md) |
| OIDC session revocation | [Session logout and revocation](architecture/oidc-session-revocation.md); [implementation synthesis](architecture/candidates/oidc-rp-logout-synthesis.md); [local check](verification/oidc-rp-logout-2026-11-14.md) |
| Private attachments, scan quarantine, access and backups | [Evidence storage design](architecture/evidence-storage.md) |
| Synthetic database and attachment restore drill | [Latest local restore check](verification/evidence-backup-restore-drill-2026-11-14.md) |
| ClamAV timeout and malformed-response verification | [Scanner failure checks](verification/checks/evidence-scanner-timeout-2026-11-11.md) |
| Full local S3Mock and ClamAV integration run | [94-test evidence verification](verification/checks/evidence-local-storage-integration-2026-11-11.md) |
| Configured evidence browser recovery | [S3Mock and ClamAV browser verification](verification/checks/evidence-browser-real-services-2026-11-11.md) |
| Latest ClamAV cold-start diagnosis and real-service browser retry | [7-scenario evidence browser verification](verification/checks/evidence-browser-real-services-2026-11-14.md) |
| Evidence scan states and stale attachment recovery | [Browser scan-state check](verification/checks/evidence-browser-scan-states-2026-11-11.md) |
| Staff-only effective procedure library | [Controlled document library](architecture/controlled-document-library.md) |
| Server-timed task labour | [Time-record contract](architecture/task-labour-tracking-v1.md); [implementation and PostgreSQL/browser verification](verification/task-labour-tracking-2026-11-14.md) |
| Vehicle type, drivetrain and systems learning | [Vehicle systems learning design](architecture/vehicle-systems-learning.md); [review workflow](architecture/vehicle-learning-review-workflow.md); [reviewed staff learning library](architecture/vehicle-learning-library.md); [complete source transcription](sources/ev-afro-service-centre-transcription.md); [source review](verification/vehicle-learning-source-review-2026-11-13.md); [current implementation verification](verification/vehicle-learning-current-state-2026-11-14.md); [assessment contract](architecture/vehicle-learning-assessment-v1.md); [assessment design synthesis](architecture/candidates/vehicle-learning-assessment-synthesis.md); [comment/history design review](architecture/candidates/vehicle-learning-comments-cross-judge.md) |
| Pre-delivery PDI and workshop maintenance | [Checklist lifecycle source of truth](architecture/checklist-lifecycle.md); [work-order maintenance implementation](architecture/work-order-checklists.md); [delivery/workshop lifecycle candidates and cross-judge](architecture/candidates/checklist-lifecycle-cross-judge-2026-11-14.md); [draft form](operations/forms/pdi-and-maintenance-checklist-draft.md); [storage and availability verification](verification/checklist-template-storage-2026-11-14.md); [delivery preparation verification](verification/delivery-preparation-2026-11-14.md) |
| Interim SOP drafts and PDI/maintenance forms | [Service intake and job control](operations/sops/SOP-001-service-intake-and-job-control.md); [PDI and vehicle condition](operations/sops/SOP-002-PDI-and-vehicle-condition-record.md); [routine maintenance](operations/sops/SOP-003-routine-maintenance-and-inspection.md); [invoice/payment/receipt/handover](operations/sops/SOP-004-invoice-payment-receipt-and-vehicle-handover.md); [draft checklist form](operations/forms/pdi-and-maintenance-checklist-draft.md); [SOP mapping framework](architecture/sop-validation-mapping.md) |
| Procedure revision, review, approval and publication design | [Governed lifecycle](architecture/controlled-document-governance-lifecycle.md); [design synthesis](architecture/candidates/controlled-document-lifecycle-synthesis.md) |
| Lifecycle architecture process and verification | [Design plan](architecture/controlled-document-lifecycle-design-plan.md); [design review](verification/checks/controlled-document-lifecycle-design-2026-11-12.md) |
| Devices, offline, and domain | [Platform strategy](architecture/platform-strategy.md) |
| Cloudflare/Vercel and per-service runtime selection | [Hosting strategy](architecture/hosting-strategy.md) |
| Dated per-service runtime compatibility, limits and local findings | [Hosting compatibility review](verification/checks/hosting-compatibility-2026-11-14.md) |
| Cloudflare API Worker runtime spike | [Compatibility evidence](verification/checks/cloudflare-api-worker-spike-2026-11-11.md) |
| Cloudflare same-origin API proxy check | [Local Worker integration evidence](verification/checks/cloudflare-same-origin-proxy-2026-11-11.md) |
| Cloudflare frontend Worker to real Node API and PostgreSQL | [Loopback end-to-end proxy evidence](verification/checks/cloudflare-real-api-proxy-2026-11-12.md) |
| Cloudflare proxy harness startup failure cleanup | [Disposable database cleanup evidence](verification/checks/cloudflare-proxy-failure-cleanup-2026-11-12.md) |
| Public landing page and audience access | [Portal entry](architecture/portal-entry-and-audiences.md) |
| Brand assets and generated background | [Visual asset record](architecture/visual-assets.md) |
| After-sales reference pages and forms | [After-sales reference audit](discovery/after-sales-reference-audit.md) |
| Current service request journey review and report gaps | [Service-request journey review](discovery/service-request-journey-review-2026-11-13.md) |
| Draft SOP validation framework | [SOP-to-validation mapping](architecture/sop-validation-mapping.md) |
| Historical maintenance backlog | [Import plan](architecture/historical-import.md) |
| Monthly vehicle sales source | [Sales report inventory](discovery/monthly-sales-report-inventory.md) |
| Owner-only showroom sales staging | [Sales source staging design](architecture/showroom-sales-staging.md) |
| Sales delivery and PDI design | [Design plan](architecture/sales-delivery-and-pdi-design-plan.md); [cross-judged synthesis](architecture/candidates/sales-delivery-pdi-synthesis.md); [API/database verification](verification/checks/sales-delivery-pdi-2026-11-13.md); [browser workflow verification](verification/sales-deliveries-browser-2026-11-13.md); [PDI correction verification](verification/sales-pdi-correction-2026-11-13.md) |
| Export scope and report formats | [Data exports and reporting](architecture/data-export-and-reporting.md) |
| Ghana-first dates, timezones and currency display | [Localization](architecture/localization.md); [technician work-entry timezone check](verification/checks/site-local-work-entry-time-2026-11-13.md); [business-screen timezone wiring](verification/site-timezone-display-2026-11-13.md) |
| Purpose-built printable reports | [Work-order report verification](verification/checks/print-report-layout-2026-11-10.md); [Head overview report verification](verification/checks/head-overview-report-2026-11-11.md); [internal task-progress report verification](verification/task-progress-report-2026-11-13.md); report contract in [reporting](architecture/data-export-and-reporting.md) |
| Manual invoices, external payment verification, receipts and client email | [Selected commercial contract](architecture/manual-finance.md); [design plan](architecture/manual-finance-design-plan.md); [cross-judged synthesis](architecture/candidates/manual-finance-synthesis.md); [draft SOP-004](operations/sops/SOP-004-invoice-payment-receipt-and-vehicle-handover.md) |
| Non-effective Finance configuration proposals | [Draft registry contract](architecture/finance-configuration-drafts.md); [PostgreSQL/API verification](verification/finance-configuration-drafts-2026-11-14.md) |
| Finance setup proposal workspace | [Proposal UI contract](architecture/finance-configuration-draft-ui.md); [browser/API verification](verification/finance-configuration-draft-ui-2026-11-14.md) |
| Parts catalogue proposals and goods receipts | [Selected quarantine foundation](architecture/parts-receipt-foundation.md); [Candidate A](architecture/candidates/parts-foundation-candidate-a-2026-11-15.md); [Candidate B](architecture/candidates/parts-foundation-candidate-b-2026-11-15.md); [cross-judge](architecture/candidates/parts-foundation-cross-judge-2026-11-15.md); owner decisions remain pending under REV-048 |
| Sensitive work-order detail reads | [Read audit design](architecture/sensitive-read-audit.md) |
| Sensitive staff queues and directory reads | [Read audit design](architecture/sensitive-read-audit.md); [queue and lookup verification](verification/checks/sensitive-queue-and-lookup-audit-2026-11-09.md) |
| Customer identity and repeat visits | [Identity boundary and phased CRM design](architecture/customer-and-repeat-visits.md) |
| Client, vehicle owner, visit contact and job handoffs | [Work-order lifecycle and booking identity](architecture/work-order-lifecycle-and-booking.md) |
| Attributed repair history and daily service report | [Service work history and reports](architecture/service-work-history-and-reports.md); [source-reported history](architecture/source-reported-service-history.md) |
| Service-report pagination design review | [Selected pagination synthesis](architecture/candidates/service-report-pagination-synthesis.md) |
| Simple sales-to-service flow, queues and release stages | [After-sales service journey](architecture/service-journey.md); [service requests and callbacks](architecture/service-requests-and-callbacks.md); [request-to-arrival journey review](discovery/service-request-journey-review-2026-11-13.md); [first-save callback verification](verification/service-request-first-save-follow-up-2026-11-13.md); [request-to-arrival verification](verification/service-request-arrival-conversion-2026-11-13.md); [structured caller-detail verification](verification/checks/service-request-caller-details-2026-11-13.md); [lost-response recovery verification](verification/checks/service-request-command-recovery-2026-11-13.md); [correction concurrency verification](verification/checks/service-request-correction-concurrency-2026-11-13.md) |
| Role-based Today, Requests, Work orders and Vehicles navigation | [USER-040 grounding](architecture/candidates/user040-navigation-grounding.md); [Candidate A](architecture/candidates/user040-navigation-candidate-a.md); [selected Candidate B and synthesis](architecture/candidates/user040-navigation-synthesis.md); [job workflow context](architecture/work-order-workflow-context.md); [navigation verification](verification/role-aware-navigation-2026-11-13.md); [workflow-context verification](verification/work-order-workflow-context-2026-11-13.md) |
| Operations review and team-lead assignment | [Separate review and assignment transitions](architecture/operations-review-and-assignment.md) |
| Staff roles, combined duties and reporting structure | [Workforce organogram](architecture/workforce-organogram.md) |
| Supervisor assignment of planned tasks | [Supervisor work allocation](architecture/supervisor-work-allocation.md) |
| Worker acknowledgement, progress, blockers, requests and comments | [Task progress and acknowledgement](architecture/task-progress-and-acknowledgement.md); [supervisor allocation and team update feed](architecture/supervisor-work-allocation.md); [task progress and supervisor feed verification](verification/supervisor-task-activity-2026-11-13.md) |
| Task progress verification | [PostgreSQL and browser check](verification/checks/task-progress-and-acknowledgement-2026-11-13.md) |
| Internal messages between staff | [Internal messages](architecture/internal-messages.md) |
| Technical completion and vehicle release | [G3/G4 transition and evidence contract](architecture/technical-completion-and-release.md) |
| Fail-closed future work-order policy package | [Policy package model](architecture/work-order-policy-package.md) |
| Empty policy ledger storage and verification | [Policy ledger check](verification/checks/work-order-policy-ledger-2026-11-11.md) |
| Service-advisor historical workbook | [Backlog workbook inventory](discovery/service-advisor-backlog-inventory.md) |
| Vehicle identity and history | [Identity attributes and scoped service history](architecture/vehicle-identity-and-history.md) |
| Optional camera VIN scan | [VIN barcode scan](architecture/vin-barcode-scan.md) |
| Versioned historical import templates | [Template package v1](import/historical/v1/README.md) |
| Delivery sequence and completion gates | [Implementation plan](delivery/implementation-plan.md) |
| Owner-prioritized workshop operations pilot and agent build plan | [Operational workshop pilot plan](delivery/operational-workshop-pilot-agent-plan.md); live task status remains in [task data](delivery/tasks.json) and the generated [tracker](delivery/implementation-tracker.md) |
| Documentation, traceability and graph workflow verification | [Source of truth and tracker check](verification/source-of-truth-and-tracker-2026-11-14.md) |
| All tasks | [Task data](delivery/tasks.json) and generated [tracker](delivery/implementation-tracker.md) |
| Requirement traceability | [Requirements](requirements/README.md) and [requirement data](requirements/requirements.json) |
| Business choices awaiting review | [Review register](decisions/review-register.md) |
| Original source documents | [Manifest](sources/manifest.json), [master](sources/master.md), [upgrade](sources/upgrade.md) |
| Reference application audit | [Portal audit](discovery/legacy-portal-audit.md) |
| Borrowed patterns and graph tools | [Reference review](discovery/reference-patterns-and-tooling.md) |
| Verification evidence | [Verification record](verification/README.md) |
| Operator and Head role-boundary evidence | [Operator account boundary check](verification/checks/operator-account-boundary-2026-11-10.md) |
| Local setup and operations | [Development guide](guides/development.md) |
| Plain-language labels and descriptions | [Plain-language interface](guides/plain-language-interface.md) |
| Portal and every-role screen catalogue, including Operator and Head audit screens | [Portal and role screen catalogue](product/portal-and-role-screen-catalog.md); [role navigation browser recheck](verification/role-aware-navigation-2026-11-15.md) |
| Work-order search wording check | [Search wording and accessible name](verification/plain-language-work-order-search-2026-11-14.md) |
| Staff workflow overview | [How work moves through VMMS](guides/how-work-moves-through-vmms.md) |
| Current after-sales report awaiting VIN check | [Pending report intake](operations/pending-report-2026-11-12.md) |
| Procedure-library wording and responsive checks | [Plain-language procedure library verification](verification/checks/plain-language-procedure-library-2026-11-11.md) |
| Decisions and progress | [Run plan](delivery/run-plan.md), [decision trail](delivery/decisions.tsv) |

## Browse as HTML

Generate a self-contained, gitignored HTML copy of these docs for easier reading:

```bash
npm run docs:html
```

Output goes to `docs/html/` (ignored by Git). Open `docs/html/index.html` in any browser. Re-run after doc changes.

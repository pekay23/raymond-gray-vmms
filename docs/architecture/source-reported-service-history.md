# Source-reported service history

Status: implementation in progress; no operating or technical approval is implied.

## Purpose

Staff sometimes receive a report after work has already happened outside VMMS. Preserve its structured concerns, findings, tests, actions and pending work without attributing those actions to the staff member who later enters the report or treating the report as technician sign-off.

The authenticated staff member is the **recorder**. The source report is a separate claim. Unless the source names a performer, VMMS must not infer who performed the described work. A report date is a calendar date, not a fabricated time of day. An attached accepted file establishes only that the file is stored and scanned; it does not prove authorship, truth, completeness or authority.

## Selected workflow

1. A Service Advisor records the vehicle visit and confirms the payer, owner relationship, visit contact, vehicle and VIN.
2. Before Operations review or a work plan exists, the Service Advisor may transcribe one or more source reports. The Head of Service Centre may also record a transcription for oversight. The API derives the recorder and site from the session. This permission is record capture only; it grants no diagnosis, technical, safety, completion, inspection, release or financial authority.
3. Each transcription contains a source title, source date, optional accepted work-order file, and separately typed report items. A concern item creates or links to a canonical complaint. Tests, findings, actions and follow-ups link to the related complaint when known.
4. The report output presents these items under **Earlier reports transcribed for this visit**, with the source date and VMMS recorder. It does not describe the recorder as the technician or source author. It states when the original file or source author was not supplied.
5. Adding or correcting a transcription increments the work-order version. Operations must review the current version before planning or assigning work. Once Operations review or a work plan exists, the source-transcription window is closed; later work is recorded against current assigned tasks by the authenticated worker.
6. Corrections append a new report revision with a required reason. The earlier transcription and its creator, time and contents remain readable. A correction before Operations review makes any earlier review stale through the work-order version change.

## Data shape

- `SourceReport`: site/work-order scope, immutable revision identity, title, source date, optional linked accepted evidence, authenticated recorder and capture time, superseded revision and correction reason.
- `SourceReportItem`: immutable ordinal, item kind (`concern`, `finding`, `test`, `action`, or `follow-up`), result appropriate to its kind, concise summary and detail, optional source occurrence date, and optional complaint association.
- `concern` items map to canonical complaints. Other report items may point to one of those concerns. They do not create tasks or imply that a staff member performed the action.
- Report source metadata belongs once to the report header; the report items preserve the distinct claims and their association to complaints.
- All rows and links use composite organisation/site/work-order foreign keys, forced RLS, immutable runtime grants, transactional commands, idempotency receipts, audit events and outbox items.

## Authorization and boundaries

- Use the current Service Advisor/Head service-request access boundary for source capture; reject an account-only VMMS Operator and site read-only membership.
- Require the current work-order version and serialize with Operations review under the work-order root lock.
- Reject source report creation or correction after Operations review or a work plan exists. Do not weaken the current assigned-task guard or insert source statements into the technician work-entry endpoint.
- Source report claims cannot satisfy G1-G5, diagnostic consent, technical grants, supervisor completion, Team Lead release, Head inspection, customer contact, payment or collection.
- Do not accept recorder identity from a request body. Do not backfill or invent source claims from existing comments, sales records, source workbook cells or actor names.

## Report and interface

The work-order page shows the source transcription as a separate section before Operations review. The entry form offers plain labels and one next action. It distinguishes the source date from the VMMS capture time and the reported concern from a test result. Accepted source files can be linked through the API, but the current form does not yet provide a file picker. Corrections are append-only and the current view exposes earlier versions and correction reasons.

The printable Daily Service Report gives source transcriptions their own section and renders selectable text. It groups items under their source report and complaint references, labels the authenticated user as the recorder, includes supported occurrence dates, and shows correction history. It never merges source claims into technician work entries or presents a non-reproduced test as a resolved concern.

## Current report admission

The supplied service report can be represented after the VIN is verified. Its four concerns remain separate. The road test remains a limited “not heard or reproduced during this test” result. The setting change and radio installation/testing remain source-reported actions; the radio's internet requirement stays visible. Body damage remains pending assessment and planning. The report's named payer is recorded as the service client; vehicle ownership, performer identity, driver details, custody and original source-file attachment remain unknown until confirmed. Do not create a canonical record while the report and sales VIN disagree.

## Verification

Disposable PostgreSQL/API tests now prove Head access, technician/read-only/account-only denial, CSRF protection, closed Operations-review window, stale-version conflict, idempotent retry, append-only correction history, complaint association, no task-work entries and unchanged safety gates. Full API tests pass. API and web builds, 33 web unit tests, docs traceability and the shared responsive baseline pass. A source-report-specific browser/accessibility run, Service Advisor success case, cross-site denial case, concurrent Operations-review race, injected rollback, and source-file picker/safe-display verification remain open. Staff UAT, production storage/scanning and physical-vehicle VIN verification remain separate launch evidence.

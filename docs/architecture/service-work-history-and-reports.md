# Service work history and report output

Status: partially implemented; this document remains the target contract. The current slice records assigned-staff work entries and adds an internal, selectable-text service-report printout. It builds on the [work-order lifecycle](work-order-lifecycle-and-booking.md), [task progress and acknowledgement](task-progress-and-acknowledgement.md), and [reporting rules](data-export-and-reporting.md). It does not itself authorize work or sign-off.

## Keep four kinds of information distinct

1. **Reported concern** — what the client or representative said. Preserve the wording, source and time reported.
2. **Finding or test** — what a named worker observed or attempted under the permitted workflow. Record test conditions and whether the concern was reproduced, not reproduced, inconclusive or not tested. A single test result must not silently close the concern.
3. **Work performed** — an attributed entry stating what was done, when, by whom, against which complaint/task, and what result was checked. Preserve the exact action and any prerequisites or limitations. Do not imply a technical approval.
4. **Decision or handoff** — separately authorized review, completion, inspection, release, customer update or financial action. Store these as their own signed transitions; a work note cannot substitute for one.

## Work history entry

Each entry is append-only and scoped to its work order and site. It contains:

- work-order ID and, where applicable, complaint and assigned-task IDs;
- entry kind (`finding`, `test`, `action`, `blocker`, or `follow-up`);
- clear, plain-language summary and optional detail;
- recorded time and optional observed/performed time, retaining the source when imported;
- actor identity from the authenticated session, never from client-supplied text;
- result and certainty, including `not-reproduced` and `inconclusive`;
- links to accepted evidence and any referenced procedure revision;
- source and provenance for imported or reported material;
- correction entries that point to the original, without deleting or rewriting it.

The current command checks active site membership and current task assignment at write time, requires the current assignment revision and an idempotency key, and atomically records the entry, audit event, receipt and outbox item. It supports optional evidence IDs, append-only corrections and one correction per source entry. The assigned-worker page can select accepted files already attached to the work order or uploaded for the active task, up to 20 per entry, and can submit an append-only correction with a required reason. The picker lists safe file details without fetching file bytes and preserves selected files across pages and exact retry payloads. It does **not yet** check specific work authority or require a work-order revision. The update records what the worker says they observed or did; it cannot mark a task or work order technically complete, clear a safety hold, approve a procedure, release a vehicle or establish customer consent. Do not describe a recorded action as verified completion.

### Reports supplied after work occurred

A report entered after work happened outside VMMS is a **source report transcription**, not an assigned worker's work entry. Keep its source date, individual statements, and authenticated recorder separate from live task work history. See the [source-reported history contract](source-reported-service-history.md). Transcribing a report cannot grant task assignment, repair authority, completion, inspection or release. Before Operations review, only Service Advisor and Head of Service Centre may record this source material under the current design; this write role still requires owner review before operational launch.

### Evidence uploaded during assigned work

Generic work-order evidence is a work-order aggregate change. If it is attached after Supervisor handoff, the current assignment lookup deliberately rejects later task actions because the job may have changed and needs a fresh Operations review and handoff. Do not whitelist generic evidence events: an uploaded file may change the safety or repair scope. The existing task evidence picker can only select files already accepted and attached to the job before handoff.

Migration `062` implements task-scoped upload and attachment bound to the current organisation, site, work order, task, plan revision, assignment revision and authenticated uploader. It reuses private quarantine and malware scanning; pending, quarantined and rejected files cannot be attached. A worker links an accepted file atomically with a work entry. The immutable task relation does not alter the work-order scope version or handoff. Task links and work-entry links are append-only; corrections preserve the selected evidence. Safe file name and media type appear in the service report, never object-storage keys. PostgreSQL/API and browser evidence is recorded in [task evidence verification](../verification/task-scoped-evidence-upload-2026-11-13.md). This local synthetic verification does not establish production storage/scanner readiness or specific work authority.

An entered observation/performed time uses the configured service-centre timezone, not the device timezone. Corrections show the original time in that zone and preserve the exact prior instant when the local field is left unchanged. A new test entry starts with an inconclusive result so the form does not presume whether a reported concern was reproduced.

## Report composition

The **Daily Service Report** is a purpose-built, selectable-text document generated from canonical work-order facts and append-only work history. It is not a screenshot of the application. The current print template includes visit details, concerns, intake notes, diagnostic findings, task work entries, assignment/review context, holds and pending gates. Work-entry evidence is shown by its accepted file name and media type, never by internal evidence IDs or object-storage keys; the API includes only accepted evidence that remains linked to the same site and work order. The API returns entries in fixed pages of 50, ordered by recorded time and ID. Page one carries the report time and work-order details; later pages carry entries only. Each later request rechecks access, work-order version and total entry count against page one, and every page is audited with its actual result count. The print view assembles and validates all pages before it renders the report or enables printing. Missing, duplicated, changed or incomplete pages fail closed. This avoids both silent truncation and storing a duplicate sensitive report snapshot. A filtered or multi-part report format is future work. The full target sections are:

1. report number, generation time, source report date and record state;
2. paying service client, visit contact and vehicle identity, with verified and reported values visibly distinguished;
3. vehicle arrival/custody status and reported concerns, each with its own reference;
4. findings and tests, including conditions and limited results;
5. work recorded, grouped under its complaint/task with actor and time;
6. pending work, blockers and the next responsible role/action;
7. distinct technical completion, inspection, release, customer contact and financial states, shown only when supported by their signed records;
8. evidence list, source notes and explicit report limitations.

The report states when a customer account, payment, technical sign-off or approval is absent. It never turns narrative text into those decisions. An inconclusive test remains inconclusive. If a vehicle identifier conflicts, show each value and its source, mark identity unresolved, and prevent canonical report generation until the vehicle is verified. A private source note may be retained for review without entering it into the canonical vehicle or job history.

## the source-report customer source report mapping

After the VIN is verified on the vehicle or its documents, the supplied 12 November report should produce four separate reported concerns: rear/cabin noise, loud turn-signal sound, missing radio application, and body dents. The road test belongs under the noise concern with the result “not heard or reproduced during this test,” not “repaired.” The softer turn-signal setting and internet-radio installation/testing are separate work entries. The radio entry retains the internet requirement and that the workshop account was logged out, without storing credentials. Bodywork remains a pending assessment and repair plan. Vehicle-retained status and the driver's identity/custody must be confirmed at intake. No sign-off, release, customer callback, invoice, payment or collection is stated in the supplied report.

The owner confirmed the source-report customer as the paying service client. Keep vehicle ownership separate and unverified. The VIN printed in the report (`the reported VIN`) conflicts with the sales workbook value (`the workbook VIN`); neither is canonical until physically/documentarily checked. The prepared source note is [pending service report](../operations/pending-report-2026-11-12.md).

## Acceptance checks

- One work order can hold several concerns without collapsing them into one text field.
- Findings, tests, work actions and pending follow-ups are distinct, attributable, correction-safe and replay-safe.
- A non-reproduced issue remains open until a separately authorized resolution exists.
- A work entry cannot grant task completion, safety clearance, inspection, release, payment or collection.
- The Daily Service Report is purpose-built, accessible, printable, selectable text and paginates long entries without clipping.
- Report output is generated from current authorized data and distinguishes reported, confirmed, unknown and approved facts.
- Conflict, stale-version, replay, wrong-site, wrong-task/actor and missing-authority cases are denied with no partial write.

## Current implementation and remaining work

Migration `059` adds immutable, site-scoped task work entries and their original work-order evidence links; migration `061` audits reads of accepted evidence options; migration `062` adds immutable task-scoped upload and work-entry links. The API checks active assignment and revision, supports replay-safe correction history, emits an outbox event, and audits history/report reads. Staff can enter worker-reported observations, tests, actions and follow-ups, upload accepted evidence after handoff, and correct an earlier entry without erasing it. A disposable PostgreSQL/browser/PDF run verifies response-loss recovery, wrong actor/site and stale assignment denials, pending/quarantined/rejected scan gates, stable work-order scope, correction preservation, readable report evidence labels and no storage keys. The wider target remains incomplete: specific work-authority checks, field-level provenance for source imports, fuller report filtering/sections, full role acceptance and real user acceptance remain open. The Shirley report is still pending physical VIN verification.

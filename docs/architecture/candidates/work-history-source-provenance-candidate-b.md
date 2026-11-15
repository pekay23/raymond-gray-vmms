# Work-history source provenance — Candidate B

Status: design candidate; not selected. This document contains no customer-specific source material.

## Goal and current context

The service work-history contract distinguishes reported concerns, worker findings/tests, work performed, and separately authorized decisions. Work entries already carry an authenticated actor, site/work-order/task scope, recorded and optional observed time, correction links, and accepted evidence links. Commands are idempotent and append-only. The Daily Service Report is assembled from canonical records and work history.

This candidate adds explicit provenance for a source document or external record from which one or more work entries were transcribed, imported, or summarized. Its central model is a normalized source-document/source-record entity linked to multiple entries. Provenance states what a staff member claims about the origin of an entry. It does not establish that the source is authentic, accurate, complete, authorized, or technically valid. Authenticity has no proof unless an accepted source file is linked, and even an accepted file proves only that the system stored and scanned those bytes under its evidence workflow.

## Usage

1. An authorized staff member records a work entry as usual. If it comes from outside the live workflow, they may create or select a source document scoped to the same organisation, site, and work order.
2. The source document records a concise source kind, human-readable title, claimed origin/reference, source date when known, and who entered the provenance claim. It may link to one accepted evidence item already associated with that work order. The UI must label evidence as an attached file, not as proof of the source's truth.
3. One source document can contain several distinct source records, such as separate rows, pages, or sections. The staff member creates a source-record locator for each relevant portion and links it to one or more work entries. A locator is descriptive (for example, “page 2, row 4”), not a copied source narrative.
4. Reports display the linked source title, locator, source date if known, and evidence attachment state. They distinguish “source recorded” from “file attached” and state that provenance is staff-reported. If no file is linked, the report explicitly says the origin was not independently evidenced.
5. To correct a provenance claim, append a correction record with an authenticated actor, timestamp, reason, and superseded claim. Never edit or delete the original source, record, or link. Correcting provenance does not rewrite the work entry; a work-entry correction remains a separate append-only operation.

Source links do not alter assignment, work-order version, safety holds, technical completion, inspection, release, customer consent, or financial state. They cannot be used to infer any such authority.

## Type and schema sketch

The following is conceptual, not a migration specification. All identifiers are UUIDs. Every row and relationship carries organisation/site scope and uses composite foreign keys so cross-site links cannot be represented.

```ts
type SourceKind =
  | "customer-document"
  | "workshop-document"
  | "external-record"
  | "staff-recollection"
  | "other";

type SourceDocument = {
  id: string;
  organisationId: string;
  siteId: string;
  workOrderId: string;
  kind: SourceKind;
  title: string;                 // brief display label, no copied source text
  claimedOrigin: string | null;  // unverified claim
  sourceReference: string | null; // non-secret locator/reference
  sourceDate: string | null;
  recordedAt: string;
  recordedBy: string;            // derived from authenticated session
  acceptedEvidenceId: string | null;
  supersedesSourceDocumentId: string | null;
  correctionReason: string | null;
};

type SourceRecord = {
  id: string;
  organisationId: string;
  siteId: string;
  workOrderId: string;
  sourceDocumentId: string;
  locator: string;                // page, row, section, or stable external ID
  recordedAt: string;
  recordedBy: string;
  supersedesSourceRecordId: string | null;
  correctionReason: string | null;
};

type WorkEntrySourceLink = {
  organisationId: string;
  siteId: string;
  workOrderId: string;
  taskId: string;
  workEntryId: string;
  sourceRecordId: string;
  linkedAt: string;
  linkedBy: string;
};
```

Relational shape:

- `work_order_source_documents`: one row per claimed source document, site- and work-order-scoped, with actor attribution and optional composite FK to accepted work-order evidence.
- `work_order_source_records`: one or more stable locators per source document, immutable with append-only correction rows (or a supersedes chain enforced one-correction-per-source-record).
- `work_order_task_work_entry_sources`: append-only many-to-many links between source records and work entries. Composite foreign keys bind both ends to the same organisation, site, work order, and task scope.
- Add indexes for `(organisation_id, site_id, work_order_id, recorded_at, id)` on documents/records and `(organisation_id, site_id, work_entry_id)` on links. Enable and force RLS on all tables. Runtime access is select/insert only; no update/delete grants. Keep any privileged correction/creation path behind the same command transaction and audit boundary as current work-entry commands.

Do not store a copied full document, unbounded free text, secrets, credentials, raw customer narrative, or file bytes in these tables. Accepted file bytes remain in private evidence storage. A source title, locator, and claimed origin are user-entered assertions and require length and content constraints.

## Function and API signatures

Signatures illustrate the ownership boundaries; exact route naming is open.

```ts
type CreateSourceDocumentInput = {
  kind: SourceKind;
  title: string;
  claimedOrigin?: string;
  sourceReference?: string;
  sourceDate?: string;
  acceptedEvidenceId?: string;
};

type AddSourceRecordInput = {
  sourceDocumentId: string;
  locator: string;
};

type LinkWorkEntrySourceInput = {
  workEntryId: string;
  sourceRecordId: string;
};

createWorkOrderSourceDocument(
  pool: Database, scope: Scope, commandId: string, workOrderId: string,
  input: CreateSourceDocumentInput,
): Promise<SourceDocumentView>;

addWorkOrderSourceRecord(
  pool: Database, scope: Scope, commandId: string, workOrderId: string,
  input: AddSourceRecordInput,
): Promise<SourceRecordView>;

linkWorkEntrySource(
  pool: Database, scope: Scope, commandId: string, workOrderId: string,
  input: LinkWorkEntrySourceInput,
): Promise<WorkEntryView>;

correctWorkOrderSourceRecord(
  pool: Database, scope: Scope, commandId: string, workOrderId: string,
  sourceRecordId: string, input: { locator: string; reason: string },
): Promise<SourceRecordView>;

readWorkOrderServiceReport(
  pool: Database, scope: Scope, workOrderId: string, requestId: string,
  page?: number, expectedVersion?: number, expectedTotal?: number,
): Promise<ServiceReportPageWithProvenance>;
```

Each mutation derives actor and site from `Scope`, requires an idempotency key, validates exact retry payloads, uses the shared command/audit/outbox boundary, checks active site membership, and rechecks accepted evidence state and same-work-order linkage at commit. Work-entry/source linking validates both records in one transaction. A source document must not be linked across work orders or sites. If an accepted evidence item is later unlinked or otherwise no longer eligible, report output omits the file claim and shows provenance as unsupported by a current linked file; it must not silently resolve another file.

## Module, UI, and report impact

- **Database:** Add a migration after the current task-evidence migration. Create the three scoped tables, composite constraints, RLS policies, immutable triggers/grants, indexes, and a sensitive-read action if source history is read separately. The migration must not rewrite prior entries or fabricate source records for them.
- **API/domain:** Add a work-order source-provenance module. Keep source-document validation and link integrity there; keep entry authorization and assignment checks in the existing task-work-entry module. Avoid treating a source record as a work entry or command authorization. Route source mutations through command-specific handlers; extend the report projection with only the display fields needed.
- **Work-entry UI:** Add an optional “Where this came from” panel to the create/correction flow. It supports selecting an existing source document, adding a locator, or creating a source document with minimal metadata. The panel indicates that this is a staff-entered claim. It offers only accepted files already linked to the same work order. Preserve the selected source identifiers across pagination/retry and show explicit loading, empty, failure, conflict, and offline states.
- **Source management UI:** On the work-order history view, show source documents and their linked entries together; avoid a separate broad document-management surface for this candidate. Corrections are explicit and append-only, with actor, time, reason, and prior values visible to staff with access.
- **Daily Service Report:** Add a compact provenance line for each linked work entry: source title, locator, source date if present, and “accepted file attached” or “no accepted source file linked.” Include a report-level note that provenance is recorded by staff and is not independently authenticated. Never show object keys, internal evidence IDs, or private full text.
- **Exports/search:** Do not add independent provenance search or analytics in this candidate. The existing site/work-order access and report pagination/version checks remain authoritative.

## Rationale and scope assessment

Normalization removes repeated source metadata when one document supports several entries and gives stable record locators for precise report drill-down. It can also support append-only correction of the attribution without altering the underlying work entry. Composite site/work-order keys make tenant and job isolation enforceable in PostgreSQL rather than relying on UI discipline.

The cost is substantial for the immediate service-report gap: at least three tables, three command surfaces, correction semantics for metadata and links, RLS/grants/indexes, audit events, UI selection/creation states, and report snapshot-consistency rules. Existing work entries already support accepted evidence links; where the only need is to show an uploaded source file, adding a document/record layer duplicates association state. For a single source report producing a few entries, normalized document and record entities are likely more structure than needed. Candidate B is most justified if the product needs repeated multi-entry imports, stable per-row/page attribution, or source-level correction across many entries.

## Alternatives rejected within Candidate B

- **Free-form provenance text on each entry:** rejected because source labels drift, shared document details are duplicated, and locators cannot be maintained consistently. It remains a viable lower-cost alternative when only a short one-off source note is needed.
- **One `source_document_id` directly on each work entry:** rejected because a document may contain multiple distinct records and a single work entry may draw on multiple source records. This loses locator precision and many-to-many attribution.
- **One unconstrained polymorphic `source_type/source_id` pointer:** rejected because the database cannot enforce that the referenced source belongs to the same work order/site, and each source type would need separate authorization rules.
- **Copy source content into every entry:** rejected because it duplicates potentially sensitive text, creates conflicting copies, and can make an unverified narrative appear canonical.
- **Treat accepted evidence as proof of truth or authority:** rejected. Scanning and storage acceptance do not authenticate the origin, accuracy, completeness, or approval status of the file.

## Risks and controls

| Risk | Control |
| --- | --- |
| A claimed source is mistaken for verified truth | Persistent UI/report wording: “staff-recorded source claim”; display file attachment state separately and state that no authenticity proof exists without a linked accepted source file. Even with a file, do not claim its contents are true. |
| Provenance is interpreted as approval or safety evidence | Explicitly prohibit source links from satisfying G1–G5, technical authority, inspection, release, consent, or payment gates; add server denial tests for any attempted cross-use. |
| Cross-site or cross-job source association | Composite foreign keys, forced RLS, scoped queries, same-scope transaction checks, and negative API/database tests. |
| Duplicate or conflicting retries | Command UUID receipt with payload comparison; identical retry returns the original result, changed payload returns conflict and creates no partial rows. |
| Corrections erase history | Insert-only correction/supersedes chain and one-correction constraint; actor, time, and reason required; never update/delete the original. |
| Source metadata leaks sensitive narrative or secrets | Minimal bounded metadata; no raw document text or credentials; evidence remains private; report emits only title, locator, date, and attachment status. |
| Report changes while provenance is paginated | Include provenance rows in the same consistent report query/version/count contract; fail closed if entries or source links change between pages. |
| Schema complexity exceeds value | Keep UI within work-order context; implement only if multi-entry attribution is an evidenced requirement; otherwise prefer the simpler competing candidate. |

## Gradeable acceptance criteria

1. A source document, its source records, linked entries, and any accepted evidence link are all constrained to the same organisation, site, and work order by database constraints and server checks.
2. One document can have at least two distinct source-record locators, and one source record can link to multiple work entries; report output preserves each locator-to-entry relationship without duplicating document metadata.
3. A work entry may link to multiple source records. Cross-site, cross-work-order, wrong-task, nonexistent, pending, quarantined, rejected, or otherwise unaccepted evidence references fail with no partial mutation.
4. Every create/link/correction command derives actor identity from the session, requires an idempotency key, records audit/outbox effects atomically, returns the original result on an identical retry, and rejects reuse of a key with changed payload.
5. Provenance corrections append a new record with actor, timestamp, and reason, retain the prior record and links, and do not edit or delete the original source claim or work entry.
6. The UI labels source details as staff-reported, distinguishes file attached from no file linked, and never offers a source link as a safety/sign-off action.
7. The report prints source title and locator, reports the accepted-file attachment state, contains no storage key or internal evidence ID, and states the limits of source authenticity and authority.
8. Tests demonstrate that provenance cannot clear a hold, authorize work, complete a task, approve inspection, release a vehicle, record customer consent, or satisfy a financial gate.
9. Existing entries remain unchanged after migration and display no invented provenance. A migration rollback/upgrade rehearsal proves prior work history and accepted evidence links are preserved.
10. PostgreSQL tests exercise RLS, composite-key denials, concurrent duplicate creation/link attempts, append-only enforcement, and report pagination consistency. Browser checks cover create/select, correction history, keyboard access, responsive layout, empty/error/conflict/offline states, and readable printed output.

## Decision needed

Candidate B should be selected only if repeated multi-entry source attribution and stable per-record locators are confirmed product needs. If provenance is only needed to label an occasional report-derived entry, the normalized entity is too much structure and a smaller field/evidence-link design should be preferred. No customer or historical source should be imported as part of this design exercise.

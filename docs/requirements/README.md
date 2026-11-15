# VMMS requirement reference

This inventory translates the supplied specifications and current user directions into traceable requirements and a dependency-based task tracker. The JSON files are canonical; the generated implementation tracker reports current totals and statuses. Captured scope and initial acceptance criteria do not, by themselves, claim that the product is implemented or tested.

## Authority

Current user directions take precedence. `USER-001` authorises a new implementation in this repository, overriding the documents' in-place upgrade and no-rebuild clauses. Their requirements for safe operation, evidence, access control and accountable decisions remain binding.

`USER-002` records that the old portal is a prototype without real operational data. There is no prototype database to migrate for launch. `USER-015` records a separate historical maintenance backlog outside that prototype. Its importer can be built and tested now; importing real records waits for the inventory of clients, their customers, vehicles, jobs, tasks and completion statuses.

The initial product serves one service centre and retains tenant and site boundaries for later expansion. Reliable internet supports a web-first release with saved drafts. Final approvals, financial posting and technical release use online backend checks. Platform support and later native packaging must follow actual device tests and documented decisions.

The document authority is:

1. The [master specification](../sources/master.md).
2. Compatible detail from the [upgrade prompt](../sources/upgrade.md).
3. Source-backed ideas from the existing portal and Smart POS, evaluated as references.

The source [manifest](../sources/manifest.json) records the original DOCX hashes. Stable block references such as `master-0068` point into the extracted source, independent of page layout.

## Machine-readable records

The [requirement inventory](requirements.json) is the canonical requirement record. The [task tracker](../delivery/tasks.json) is the canonical delivery queue. Use their IDs in code reviews, tests, evidence and decisions.

| Record | Purpose |
| --- | --- |
| `R-M-0048` | A requirement derived from master block 0048 |
| `R-U-0071` | Compatible upgrade detail with its own acceptance conditions |
| `BR-01` through `BR-16` | Explicit backend business rules |
| `AT-01` through `AT-20` | The supplied acceptance scenarios |
| `USER-*` | Current user directions and clarifications |
| `HIST-01` through `HIST-11` | Historical backlog import requirements |
| `E00` through `E15` | Delivery epics |
| `BUILD-` and `CHECK-` task prefixes | Separate implementation and acceptance verification |
| `CONFIG-` task prefix | Approved management or technical input |
| `VERIFY-AT-` task prefix | Execution of a supplied acceptance scenario |

Each requirement includes its full source text, source references, module, acceptance conditions, planned implementation, server control, import effects, SOP mapping, existing-source evidence, UAT references, owner, decision and status. The `sourceCoverage` array accounts for all 350 source blocks. It maps 295 blocks to requirements and classifies 55 titles, headings and table headers as context. Compatible duplicate requirements retain all relevant source references.

Each task includes its phase, epic, dependencies, requirement and source links, acceptance conditions, owner, status and evidence. All task dependencies resolve and form an acyclic graph. A parent epic cannot be verified while required child work remains incomplete. Native-package tasks have explicit evaluation conditions.

## Functional coverage

The current requirement totals by module and status are maintained in the canonical [`requirements.json`](requirements.json) `counts` object. `python scripts/project-status.py` verifies those counts against the requirement, source-coverage and status records before generating the tracker.

## Acceptance applicability

`AT-01` remains planned. Its prototype-migration subcase is inapplicable because the prototype contains no real data. Its historical-backlog subcase remains applicable and requires staging, reconciliation, preserved source IDs and business acceptance. Sample tests alone cannot close real-batch acceptance.

The initial web pilot may proceed with that historical subcase explicitly deferred and its data not yet imported. The full project goal still requires the agreed real-backlog import. The tracker keeps those two acceptance points separate.

`AT-17` is initially `not-applicable` to legacy status, invoice-report and integration regression because no real prototype workflow must be carried over. Reopen it if an old interface or record set is explicitly selected for preservation. New integrations still require their own contract and workflow tests. An applicability decision is not a passed test.

All other supplied acceptance scenarios remain planned. Their tasks require actual server behaviour, canonical records and reviewable evidence. A successful build or a visible screen is insufficient.

## Missing controlled inputs

The full controlled SOP library, the 105-entry master document register and the Issue 1.0 readiness review were referenced by the specifications but were not supplied. Every SOP mapping therefore records `library-not-provided`. The inventory preserves the named SOP family without inventing a form number, field mapping or approved revision.

Management must supply named technical, QA, release and financial grants; approved rates and tax treatment; legal identity and notices; retention rules; effective SOP revisions; site/model safety validation; and equipment commissioning evidence. Such gaps prevent the affected approval or operational release. They do not prevent reversible implementation or synthetic verification.

## Completion states

`planned` means captured. `implemented` means code exists but evidence is incomplete. `verified` requires reviewed acceptance evidence and relevant backend, persistence and recovery checks. `configuration-required`, `blocked` and `deferred` identify different reasons that work remains open. `not-applicable` requires an explicit scope decision and rationale.

The overall goal remains active through the agreed historical import, platform scope, staff acceptance, recovery exercises, controlled pilot and management operational approval. Software deployment does not approve an SOP, grant staff authority or certify the service centre.

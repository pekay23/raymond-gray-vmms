# Independent traceability review

Reviewed 7 November 2026. This is a planning review, not runtime or operational acceptance.

## Scope and method

Read AGENTS.md, the documentation entry point, system design, implementation plan, requirement guide, both complete extracted sources, review register and historical-import design. Queried both canonical JSON files for all BR-01 through BR-16 and AT-01 through AT-20 mappings, user directions, configuration requirements, task acceptance, statuses and dependency ancestry. No application code, secrets, live database or deployment was inspected. After this initial review, the integrating agent authorised corrections to the two canonical JSON files. The findings below describe the initial snapshot; the correction record identifies subsequent changes.

## Initial findings

### P1: Configuration input has replaced implementation work

In `docs/requirements/requirements.json`, R-M-0008, R-M-0016, R-M-0032, R-M-0145 and R-M-0179 are functional requirements classified under CONFIG. In `docs/delivery/tasks.json`, each has only a CONFIG task, with O-004 also covering R-M-0179. They have no linked implementation or verification task. These requirements include configurable identity and standards, approval limits, inactive unapproved settings, retention enforcement, legal holds and protected export. Management supplying values does not implement those controls. Separate software implementation and negative-path verification from approval of real policy values. Add explicit links when existing build tasks already implement part of the requirement.

### P1: Completion and deployment milestones omit substantive prerequisites

`G-003` depends on G-002, O-021, P-010 and I-006, but its transitive dependencies exclude VERIFY-AT-01, F-011/P-004 saved drafts, CHECK-R-M-0049 effective instructions, CHECK-R-M-0074 battery quarantine, CHECK-R-M-0075 emergency readiness, CHECK-R-M-0177 secure sessions and many other applicable checks. Thus the full-goal milestone can become ready while required work remains open. The pilot deployment milestone O-020 also omits CONFIG-R-M-0223 site/model safety and equipment validation and those security/readiness checks. O-019's generic acceptance does not enumerate them. Define explicit launch-critical and full-completion requirement sets, and require reviewed implementation, checks and configuration for each. Keep the real historical import explicitly deferred from the pilot but require VERIFY-AT-01 for full completion. Conditional platform work needs a resolved scope decision before it can be excluded.

### P2: Race verification can become ready before the commands exist

`O-012`, which exercises release, hold and stock races, depends only on F-006 event/version/idempotency persistence. VERIFY-AT-18 depends on O-012 and F-009. Neither path requires the release, hold or stock operations whose concurrency is being tested. Add the actual command implementation/check dependencies. State that two independent PostgreSQL sessions use the real runtime role, coordinate overlapping transactions, and assert the allowed final state and atomic audit/receipt/outbox results. Receipt replay alone cannot satisfy the release-versus-hold scenario.

### P2: Critical acceptance details are too generic to guide verification

Fifty-five tasks have only "Attach reviewable evidence that the stated task works before marking it verified." Examples include O-012, O-019, P-001 through P-004 and G-003. BR requirements mostly repeat the source statement plus a generic permitted/denied instruction; their CHECK tasks often repeat module-wide language. For example CHECK-BR-14 discusses rates, payer and posting but never specifies financial self-approval rejection. BR-14 maps to AT-10, which tests dealer warranty recharge, and BR-15 maps to AT-16, which tests audit immutability. Those broad scenarios do not by themselves prove the extra rule. Add dedicated verification cases or explicit scenario subcases with fixtures, permitted/denied outcomes, evidence and reviewer criteria. Prioritise financial self-approval, document approver assignment, historical calibration impact and protective action during payer disputes. Preserve the distinction between primary UAT scenarios and supplementary rule tests.

### P2: The gap matrix remains an unpopulated traceability field

Of 228 requirements, 226 have `existingEvidence.classification = UNKNOWN` and no source references. The prototype audit can remain a separate artifact, but the requirement records currently provide no requirement-level route to its reusable, missing or rejected capabilities. The source requirement master-0233 and upgrade-0019 ask for an evidence-backed gap classification. Reconcile useful audit findings into the affected records. For greenfield work, explicitly record new implementation and the user's override rather than implying every requirement needs legacy compliance evidence. Preserve UNKNOWN only where evidence is genuinely unavailable. Do not label the completed inventory as a completed gap audit until this distinction is resolved.

### P3: The phase narrative and task queue need one interpretation

`docs/delivery/implementation-plan.md` promises a persisted reception queue, C01/C02, planned tasks and holds in phase 1. Their main task families sit in phase 2 or 3 in `tasks.json`, and the plan reuses phase 6 for reporting/import, launch engineering and the pilot. This makes phase completion and agent work selection ambiguous. Define a named first-slice milestone with its exact task IDs and exit checks, then use unique phase names or explicitly document parallel phase-6 workstreams. Keep foundational equipment/authority/document capabilities available before the gates that consume them, even when their broader management interfaces arrive later.

## Confirmed strengths

- All 350 source blocks are represented once in `sourceCoverage`; 295 map to requirements and 55 are actual headings or table context. No missing source IDs, dangling requirement mappings or nonreciprocal source references were found. Stored source text matched the extracted text.
- The 16 business rules and 20 acceptance scenarios preserve their substantive source statements and references. Task dependency IDs resolve. Counts alone do not establish semantic completeness or an executable milestone graph.
- The status snapshot contains no implemented or verified requirements/tasks. AT-17 is explicitly inapplicable with a reopen condition, rather than falsely passed. AT-01 distinguishes the empty prototype from the separate real historical backlog.
- The plan preserves one-site launch with expansion boundaries, reliable internet and saved drafts, and client/customer/work/status import provenance. Unknown historical authority is never treated as signed current approval.
- All SOP mappings say `library-not-provided`; the missing controlled library, 105-entry register and Issue 1.0 inputs are explicit. No approved SOP or technical procedure was invented.
- REV-017 records authorised access to existing online database/environment, GitHub and Vercel configuration, and Cloudflare domain management, while requiring isolation and a reviewable external change.

## Verification limits

This review did not run the repository validator or inspect its implementation. It used fresh JSON queries and source comparison, and inspected task ancestry without claiming runtime gate enforcement or PostgreSQL race proof. It does not establish source-DOCX extraction fidelity, browser/device support, staff UAT, real-backlog reconciliation or production readiness. No management or technical approval is implied.

## Correction record

The authorised JSON corrections add implementation/check tasks for the five configuration-software requirements, rule-specific BR acceptance, exact operation criteria, race-command dependencies, and S-001 through S-006 for the bounded first slice. Named policy approval remains separate. A selected set of requirements now links to concrete sections of the prototype audit; other UNKNOWN capabilities remain explicitly unknown and use a greenfield gap treatment.

G-004 explicitly gates launch on 491 tasks and 212 requirements, including safety settings, staff and owner acceptance, saved drafts, secure evidence, recovery and supported desktop/mobile browsers. Real historical import and final post-pilot acceptance remain outside that launch gate. G-003 requires every other non-epic task and all requirements, including real AT-01 acceptance, the 30-day review and signed Issue 1.0 decision. Requested OS applications remain required unless an explicit owner-approved per-platform exclusion is recorded; deferred status never passes closure.

User clarifications are captured as USER-017 through USER-021. OPS-022 covers authorised provider assessment; ENTRY tasks cover neutral entry and existing asset provenance; CUST tasks cover approved vehicle-owner launch access; AUTH tasks cover primary Google SSO, passkeys and email-or-username/password fallback; RESP tasks cover generated image art direction, delivery budgets, widths/orientations/foldables and 200/400 percent zoom. Each has independent API, browser or evidence checks as appropriate. All new work remains planned.

Final direct checks passed for 233 unique requirements, 551 unique tasks and 17 epics: source-text fidelity against the extracted Markdown, all 350 block mappings, reciprocal references, valid dependency/parent IDs, an acyclic graph, complete launch/full task ancestry, missing configuration decomposition and removal of blanket one-line task acceptance. The launch graph excludes real import and post-launch dependencies while the full graph includes them. The integrating agent still owns generated Markdown, the repository validator and final documentation reconciliation. No runtime feature or approval was marked complete by this correction.

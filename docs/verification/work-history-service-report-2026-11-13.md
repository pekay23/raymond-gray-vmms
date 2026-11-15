# Work history and service report verification

Date: 13 November 2026\
Scope: immutable task work entries, prepared service-report API, and purpose-built print view.

## Results

- `npm run test --workspace @vmms/api` — 121 passed, 0 failed, 1 optional S3/ClamAV test skipped in the previous full run. The focused PostgreSQL foundation scenario was rerun after the evidence-options change and passed; it now verifies that current assignees see accepted work-order attachment metadata, former assignees are denied, oversized evidence pages are rejected, and selected evidence IDs remain on original and corrected entries.
- `npm run test --workspace @vmms/web` — 32 passed, 0 failed in the previous full run.
- API and web type checks passed after the correction/evidence controls were added.
- `npm run build --workspace @vmms/web` and `npm run cloudflare:build --workspace @vmms/web` — passed with no build warnings after splitting third-party modules into bounded vendor chunks. `npm run verify:cloudflare-real-api-proxy` — passed against the local API/PostgreSQL stack, including a synthetic 5.3 MB upload; no remote Cloudflare service was changed.
- `npm run verify:work-plan-browser` — 49 checks passed in a disposable PostgreSQL/browser environment. The service-report view passed automated WCAG 2.1 A/AA checks. A Technician entered synthetic work through the page and appended a reasoned correction while preserving the original. The generated PDF includes both attributed entries as selectable text, excludes workspace chrome and controls, and the longer print document paginated across 10 pages. The broader run verified role-specific workflow, retries, responsive views, and task-progress report access. See [browser results](browser-work-plan/results.json).
- `node --import tsx --test --test-name-pattern="Supervisor task allocations stay scoped" test/foundation.test.ts` — the focused PostgreSQL scenario passed with a 101-entry service report spread across three audited pages. It verifies fixed 50-entry page sizes, page-one-only work-order/report details, missing/stale/version/count-mismatch continuation rejection, duplicate-free aggregation, and the per-page audit count bound.
- `npm run verify:work-plan-browser` — 50 checks passed on 13 November in a fresh disposable PostgreSQL/browser environment. The test uploaded and scanned a synthetic PDF before Operations review, linked it to a Technician work entry after handoff, generated a 101-entry report, held page two at the network boundary, and verified the first/last entries and accepted evidence filename in selectable-text PDF output. The API response included the evidence name and media type without a storage-key field. Report layout had no horizontal overflow at 320, 390, 768 or 1440 px, and its WCAG 2.1 A/AA scan passed. Generated screenshots and JSON remain local verification artifacts under the repository's existing ignore rule.
- `npm run typecheck` and `npm run build` in `apps/web`, plus `npm run typecheck` in `apps/api` — passed after pagination changes; web build reported no chunk-size warnings.
- `npm run docs:generate`, `npm run docs:check`, and `npm run docs:test` — passed.

## What this proves

Task work entries are append-only, attributed to the authenticated staff member, scoped to a current task assignment, and replay-safe. Corrections retain the source entry. Entries stay separate from technical sign-off, inspection, release, payment and collection. The service-report endpoint pages the prepared work-order projection and its work entries; each page rechecks access, work-order version and total count, and records its own result count. The print view validates fixed page metadata, completeness, unique IDs and stable order before showing the report, then generates structured selectable text rather than a screenshot.

The assigned-worker entry form also converts observed/performed times using the service-centre timezone even when the device is in a different zone. A browser check ran with an America/Los_Angeles device timezone against the Africa/Accra test site and verified the persisted instant, corrected form display, and unchanged correction instant. New test entries default to inconclusive.

## Limits and follow-up

- Browser fixtures use synthetic records only.
- Browser fixtures and PostgreSQL checks use synthetic records in disposable databases only. The 101-entry report pagination run does not import synthetic records into the system database.
- Filtered or multi-part report output remains future work.
- Current task work authorization is not checked by the work-entry command. The staff UI states this limit. Specific technical grants and related qualification/policy checks remain unimplemented for this entry path.
- The work-entry UI can select accepted files already attached to the work order and submit append-only corrections with a reason. It cannot upload or attach new evidence from this form; the evidence-upload workflow remains separate.
- A generic work-order attachment added after Supervisor handoff invalidates the current assignment and requires Operations review and a new handoff. The browser scenario attaches its synthetic PDF before review/handoff. A task-scoped evidence upload for files captured during assigned work remains planned under `BUILD-USER-039-TASK-EVIDENCE-001`.
- The work-entry's service-centre-time conversion is covered by [the focused timezone check](checks/site-local-work-entry-time-2026-11-13.md); other screens and print templates still need complete selected-site timezone wiring.
- The print template is an internal workshop service report, not yet the complete customer/management reporting package in the design contract.
- The the source-report customer source report was not entered as a canonical work order. Her payer status is confirmed, but the VIN in the report conflicts with the sales workbook; a staff member must check the vehicle or its documents first. Keep owner and visit contact separate and unresolved until verified.
- No production database, Cloudflare/Vercel service, DNS, real customer record, staff account, or external notification was used or changed.

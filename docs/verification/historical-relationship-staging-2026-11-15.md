# Historical relationship staging verification — 15 November 2026

## Scope and design decision

The historical batch validator now checks date ordering and whether an explicitly supplied client/customer relationship can support a maintenance job's source start date. This remains a private local staging operation; it does not create or update operational records.

Two designs were compared: (A) a conservative helper in the existing validator and (B) a batch-level finding inspector with indexed relationship groups. The cross-judge selected B (24/25) for its validation order, stable quarantine findings and clarity about temporal uncertainty, then grafted A's smaller in-place integration and job start/completion chronology check. The shipped implementation keeps the existing `{code, message}` issue format and adds one private validator call before the existing reference-quarantine propagation. It groups by exact client/customer pair and source-time precision, sorts intervals and job times, and sweeps each group instead of scanning every link for every job.

The boundary rules deliberately avoid unsettled policy. Date-only values compare only with date-only values. Offset timestamps normalize to UTC and compare only with other offset timestamps. Unknown bounds, mixed precision, exact interval boundaries, unavailable job dates, absent source links, incomplete client/customer identity and out-of-period jobs remain quarantined for review. Equal source start/completion values are allowed; completion-before-start is quarantined.

An `ownership-intervals.csv` claim is checked for its own date syntax and bound ordering. Distinct source-reported customer claims for the same vehicle are grouped for review when periods overlap, meet at an unresolved boundary, or cannot be compared because dates are missing or use different precision. This is a review signal, not an exclusive-ownership rule or a choice of current owner. The job's `source_customer_id` is never treated as an owner, payer, or vehicle-owner relationship. No source status approval, gate effect or live database action was added. REV-016 remains open for date-only timezone, interval-end semantics, source mapping and import authorization.

## Verification evidence

- `npm run historical:stage:test`: 48 synthetic tests passed, including dated link coverage, missing/outside/boundary cases, reversed and mixed-precision intervals, chronology, offset normalization, multiple relationship kinds, owner overlap/touching/unknown-period review without owner selection, a service customer distinct from ownership claims, downstream quarantine and a 1,001-job/1,001-link same-pair batch.
- `npm run historical:templates:check`: passed all 12 template/example pairs, source checksum and cross-file references after the synthetic link example was given a fictional date range.
- `npm run historical:templates:test`: 4 passed.
- `npm run docs:check` and `npm run docs:test`: passed after updating the implementation tracker.
- No real workbook or customer rows were opened or modified in this slice. Synthetic input/output remains temporary and no database/store was connected.

## Remaining work

This does not complete `HIST-07` or `HIST-08`. Currency metadata, evidence permission verification, source-specific field/status mappings, target comparison, named batch approval, import commit/reversal, representative real-data rehearsal and post-import reconciliation remain open. The actual maintenance backlog still needs the full source inventory and owner-approved relationship, status, amount and evidence mappings.

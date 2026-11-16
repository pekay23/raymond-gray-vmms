# Parts foundation cross-judge

**Date:** 15 November 2026  
**Scope:** Read-only comparison of Candidate A and Candidate B. Neither design is implemented or selected by this review.

## Recommendation

Use **Candidate B as the base**, with a few concrete data and concurrency details grafted from Candidate A. B is clearer about the caller contract, exact proposal revision binding, immutable correction records, tenant/site access, audited reads, and the hard boundary between quarantine and usable stock. It also describes the future projection as derived from immutable facts instead of maintaining an operational stock counter.

This recommendation is conditional: neither candidate is implementation-ready until the open semantics below are resolved. In particular, do not establish serial uniqueness scope, correction arithmetic, or receipt-reference uniqueness by inference.

## Comparative score

Scores use 1 (weak or materially ambiguous) to 5 (strong and actionable). They judge the written design, not implementation evidence.

| Criterion | Candidate A | Candidate B | Judge |
| --- | ---: | ---: | --- |
| Source correctness and fit with current architecture | 4 | 4 | Both follow the existing single command API, PostgreSQL, `runStaffCommand`, sensitive-read audit, and migration approach. B maps implementation touchpoints more explicitly. |
| Tenant/site privacy | 4 | 5 | Both require scoped supplier associations and protected reads. B states actor/site derivation, read audit, no evidence storage keys, forced RLS, and separate runtime/migration roles more directly. |
| Grant revocation race and audit compatibility | 5 | 5 | Both identify shared grant locks, grant snapshots, and audit allowlist updates. B adds current-grant replay checks and explains compatibility with the existing read audit. |
| Immutable revision/concurrency model | 4 | 5 | A defines immutable catalogue revisions and serial identity concerns. B more clearly separates receipt facts from projections, defines linked corrections, and specifies sorted root locking and expected-version checks. Neither fully defines correction math or receipt-reference uniqueness. |
| No accidental operational stock/fitment approval | 5 | 5 | Both explicitly forbid acceptance, fitment approval, usable quantity, issue, reservation, purchase authority, and financial effects in this slice. B's fixed quarantined state and computed zero availability are particularly direct. |
| Simplicity | 4 | 4 | Both remain within one API/database and avoid a premature inventory service. A's separate custody identities and broad revision structure may be more than the first evidence-capture slice needs. B has more named components and an explicit correction command, but those track real distinctions. |

## Graft into Candidate B

- Add A's explicit receipt timestamp pair: the sender's `receivedAt` claim plus server-recorded time. Preserve both with clear names so event time is not confused with record time.
- Keep A's line-level supplier lot reference, exact unit, source document reference, and serial references. Treat serial identity and uniqueness as unresolved policy until approved.
- Add explicit uniqueness/locking requirements for duplicate serial claims once the approved identity scope is known. Until then, reject or quarantine ambiguous collisions; do not default to organization-wide identity based only on A's proposed default.
- Ensure each receipt line snapshots the exact catalogue revision and relevant evidence IDs. B already requires exact proposal revision binding; A helps make receipt-time provenance explicit.
- Retain A's statement that supplier associations are pre-existing only for this slice. Association management remains a distinct authorized operation.

## Reject or defer

- Reject Candidate A's proposed default that serialized identity is organization-wide. Its text also says the scope needs owner review; the default risks silently imposing cross-site identity semantics and blocking legitimate records.
- Defer A's separate custody-identity entity until receipt correction and duplicate-serial policy are designed. It may be useful later, but it adds identity lifecycle and uniqueness decisions to a slice whose operational stock workflow is explicitly out of scope.
- Do not create either candidate's migration number until migration ordering is checked at implementation time. The repository currently shows migration `078` as the latest numbered migration, but `079` is not reserved.
- Do not seed Parts grants or convert role names into grants. Neither candidate authorizes a role-based shortcut, and the exact named grant owners remain unresolved.
- Do not expose supplier name/details beyond the authorized site association projection. Candidate B includes `supplierName` in the receipt response; specify the field-level access rule before implementing it.

## Blocking ambiguities before implementation

1. **Correction semantics:** Define whether a correction is a replacement declaration, signed delta, reversal plus replacement, or another form. Define how multiple corrections derive a corrected quarantined amount and how invalid negative/over-received results are rejected. Both candidates preserve history but do not fully specify this arithmetic.
2. **Receipt references and replay:** Define duplicate supplier document reference behavior, including whether partial deliveries may share a reference. Command idempotency handles retries but does not settle business-level duplicate receipt detection.
3. **Serial identity:** Decide whether uniqueness is by manufacturer, part, supplier, organisation, site, or a combination, and how transfers/corrections affect it. Until decided, do not establish a global unique key.
4. **Supplier projection:** Define who may read supplier identity and contact data, and ensure read audit events remain metadata-only. A site's association alone should not imply unrestricted supplier detail access.
5. **Evidence linkage:** Validate that evidence belongs to the same organisation/site and is accepted for this record purpose. Malware acceptance proves file handling only, never part compatibility or receipt acceptance.
6. **Quantity domain:** Approve decimal precision, maximum magnitude/scale, and controlled units. No unit conversion or aggregation should occur before policy exists.

## Source and compatibility notes

The accepted system design specifies one canonical PostgreSQL model, named command modules, transaction-local tenant/site context, shared grant locking, immutable events, idempotency receipts, outbox writes, and RLS as defence in depth. Both candidates align with this architecture and avoid a separate inventory microservice.

Candidate B is more implementation-specific about route wiring, response pagination, read audits, runtime grants, real PostgreSQL checks, and browser verification. Candidate A contributes stronger explicit source-time and serial-custody concerns. These are complementary details, not a reason to combine the candidates wholesale.

Neither candidate proves source correctness, privacy, revocation-race safety, or database immutability. Those claims require implementation review and PostgreSQL tests under the actual restricted runtime role. SQLite-only or synthetic browser checks would not establish the database concurrency and RLS claims.

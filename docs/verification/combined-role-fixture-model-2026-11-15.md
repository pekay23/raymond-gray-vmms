# Combined role placements in the local VMMS fixture

**Status:** Manifest and seed-contract slice implemented; saved fixture reconciliation and browser sign-in remain unverified.

## Change

The synthetic staff manifest is now schema version 2. Each synthetic person retains one account and OIDC identity, with one or more separate role placements. Each placement names its own parent role placement. This represents combined engineering and service roles without forcing them to share one reporting line.

The manifest contains 15 staff identities, 18 role placements, and a separate vehicle-owner identity. It includes two synthetic EV Team Lead / Engineer combinations and a Service Advisor / Engineer combination. The Operator remains outside the reporting chain, the Head remains its operational root, and the fixture continues to seed no operational authority grants. Placement and history identifiers are stable per person-role pair. The local rehearsal generator and lifecycle receipt checker now expect 15 staff slots followed by the owner slot.

Database marker version 2 intentionally conflicts with an already seeded version 1 fixture. Preparation will stop rather than update old records in place; the older saved fixture was not touched.

## Verification

- `node --import tsx --test apps/api/test/local-role-fixture-seed.test.ts`: 4 passed.
- `python -m unittest discover -s scripts/local-role-fixtures -p test_create_instance.py -v`: 4 passed; generated slot set is p01-p16, with 15 staff identities followed by the separate owner claim identity.
- `python -m unittest discover -s scripts/local-role-fixtures -p test_lifecycle.py -v`: 13 passed; receipt validation requires all 16 unique synthetic actors.
- `python -m py_compile` for the fixture generator, lifecycle checker, and their tests: passed.
- `npx tsc --noEmit -p apps/api/tsconfig.json`: passed.
- `node --check` for `verify-logins.mjs` and `verify-owner-claim.mjs`: passed.
- `npm run docs:check` and `npm run docs:test`: passed for 256 requirements, 684 tasks and 350 source blocks.
- Manifest parsed as JSON and reconciled to 15 staff identities, 18 role placements, and one separate owner identity.
- `codegraph sync` completed and `codegraph status` reports the index up to date. Argument-scoped `codegraph affected` selected the API manifest test and Python lifecycle test; the separate generator test was run directly.
- No identity provider, database, saved fixture, container, or production account was changed. No local login was run against schema version 2.

## Remaining

The full local role fixture lifecycle is still incomplete under AUTH-015. AUTH-013 remains in progress until a new isolated fixture is safely provisioned and all role logins, combined role workspace behavior, owner claim flow, cleanup, staff acceptance, and production boundaries are verified.

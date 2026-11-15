# Local role fixture port reservation check

Date: 15 November 2026

## Finding

The local fixture generator selected the first currently free port in each range. It did not consider ports saved by stopped fixture installations, so a second installation could be generated with the same ports as an existing one. A read-only inspection of the three saved local installations found seven distinct reserved ports across their configurations.

## Change

The generator now validates each existing fixture's private directory and public state file, checks the installation marker, schema version and per-installation port assignments, then excludes all saved ports when allocating a new instance. Unexpected entries, missing or malformed state, changed ownership markers and invalid port assignments stop creation for manual inspection. No existing installation is rewritten or removed.

## Verification

- `python -m py_compile scripts/local-role-fixtures/create-instance.py scripts/local-role-fixtures/test_create_instance.py` passed.
- `python -m unittest scripts.local-role-fixtures.test_create_instance -k port -v` passed 3 tests, including the new persisted-port and allocator checks and the existing fixture-generation test.
- A read-only validation of the three current local fixture state files succeeded. A fresh allocation avoided all seven saved port numbers and produced five distinct ports.
- An initial full fixture test run hit the helper's eight-second Windows ACL subprocess timeout. A repeat full run passed both existing tests. No fixture containers, files or credentials were changed by these checks.

This verifies only port selection and the existing state-file protections. The AUTH-015 lifecycle commands and startup/shutdown behavior remain incomplete; no database, auth service, API or web app was started or stopped.

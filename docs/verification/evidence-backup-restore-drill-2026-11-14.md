# Synthetic database and evidence restore drill

Date: 14 November 2026

## Result

`npm run evidence:backup:drill` exited successfully against loopback-only VMMS PostgreSQL and S3Mock. The current migrations were applied to a generated scratch source database; the script inserted one synthetic evidence record and 70 synthetic bytes, created a custom-format PostgreSQL dump, restored it to a second generated scratch database, copied the object through S3Mock, exported both metadata catalogs, and ran `scripts/verify-evidence-backup.py`.

- Result: `package-consistent`; one evidence object; all seven verifier checks passed.
- Generated databases: `vmms_evid_drill_src_b985a89b695f4eae84554cfb6c0f6449` and `vmms_evid_drill_restore_b985a89b695f4eae84554cfb6c0f6449`.
- Database snapshot: 722,202 bytes; SHA-256 `3f4ab2c177ceeff90661afe25f403691bda3922c558ea30db8dc33e24f902f2f`.
- Object source and restored size/hash matched. The manifest's provider version identifiers are simulated.
- `npm run evidence:backup:test` passed 12 verifier unit tests.
- The process exited successfully through its run-specific cleanup path. The summary did not separately list the post-cleanup database catalog or object keys.
- Reported `productionCoverage`: `false`.

The script refuses non-loopback PostgreSQL/S3 endpoints, never targets the existing `vmms` database, and uses run-specific database names and a checked temporary directory. It does not remove Docker containers or volumes.

## Limits

This proves the local synthetic backup package and restore path only. It does not prove provider-backed versioning, production backup storage, IAM, encryption, retention, destination isolation, RPO/RTO, monitoring, incident response, named recovery ownership, staging or staff acceptance. Launch recovery remains open under `REV-025`, `EVID-006` and `R-M-0180`.

An earlier local run is recorded at [the 9 November drill note](checks/evidence-backup-restore-drill-2026-11-09.md); it is ignored by the repository's current ignore rules and is retained only as a local historical note.

# Account-provisioning retry after a committed operation

**Result: verified in the local synthetic API integration suite.**

## What was exercised

The test in `apps/api/test/evidence.test.ts` now simulates a shared-auth adapter that records one synthetic invitation operation, then loses its response. The VMMS worker records the attempt as retryable and later retries with the original durable operation ID. The adapter returns the already recorded reference on retry.

The check confirms two adapter calls, the same operation ID on both calls, one synthetic remote creation, and the final VMMS request state `invitation-issued`. No production identity provider or delivery service is called.

## Verification

Command: `npm run test --workspace @vmms/api`

- 142 tests passed.
- 0 tests failed.
- 1 optional local storage test was skipped because its external scanner and storage services were not configured.
- The staff-account worker integration scenario passed using synthetic data and the local PostgreSQL test setup.

## Limits

This verifies the VMMS worker's stable-operation retry behavior against a fake adapter. It does not prove the shared-auth service has an idempotent operation ledger, that invitation delivery is exactly once, that production credentials are secure, or that a person can enroll. The production connector, identity linking, invitation policy, bootstrap and recovery remain pending under `REV-045` and `AUTH-011`.

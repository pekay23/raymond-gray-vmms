# Vehicle-owner read audit

## Scope

The owner vehicle list is the first customer-facing read added to the sensitive-read audit. It returns only the current owner’s approved vehicles and records one metadata-only event in the same database statement. The broader `R-M-0175` requirement remains in progress: other sensitive views, controlled exports/review, safety/approval/finance changes, retention and staff acceptance still need coverage.

## Transaction and authority

`GET /api/v1/owner/vehicles` passes the verified HttpOnly owner-session hash and the server-generated request UUID to `current_vehicle_owner_vehicles`. The function derives organisation, site and owner account from the session row; it sets transaction-local RLS context; then it locks the active account and access scopes and confirms a current approved relationship before returning the existing vehicle projection. It inserts an audit event after preparing the rows in the same SQL statement. If audit insertion fails, PostgreSQL rejects the statement and the API returns no vehicle projection. Invalid, expired, inactive, revoked or transferred sessions produce no success event.

The function is owned by `vmms_owner_read_audit_function_owner`, a NOLOGIN, non-superuser, non-BYPASSRLS role with only the table privileges needed to prepare the projection and append an event. The old one-argument function is dropped so there is no unaudited compatibility path. Runtime can execute the function but cannot directly read or mutate the event table.

## Event fields and access

`owner_vehicle_read_events` records organisation, site and owner account IDs; fixed action `owner-vehicle-list-read-prepared`; projection revision 1; returned row count; server-generated request UUID; and database timestamp. It stores no vehicle IDs, registration, make/model, customer fields, session hash, URL, IP, user agent or query. The identifiers remain linkable metadata and are not anonymous.

Forced RLS binds each insert to transaction-local organisation, site and owner context. The audit table has no runtime grants; its insert privilege is column-limited to the restricted function owner. A trigger rejects updates and deletes. Database owners remain a separate administrative trust boundary.

## Limits and follow-up

The event means the server prepared and committed a projection before responding; it does not prove delivery or human viewing. Events do not identify which vehicles appeared. Measure event volume and define retention before production; do not expire them automatically without an approved policy. Add coverage for other sensitive customer views and controlled exports as their contracts are designed.

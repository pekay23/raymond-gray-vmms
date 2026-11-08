# Initial web and API contract

This contract bounds the first implementation unit. It does not claim completion of reception, G1, technical release, or any commercial workflow. Intakes are persisted reception drafts until their required evidence is implemented and checked.

All paths are under `/api/v1`. JSON uses camelCase. UUIDs identify entities and commands. A same-origin session determines the person; a site path selects only among that person's active memberships. Request bodies cannot select an organisation or actor. Return `404` for another site's object. List counts and history use the same scope as their records.

## Identity

- `GET /session` sets the CSRF cookie and returns either `{authenticated:false}` or `{authenticated:true,user:{id,displayName},sites:[{id,name,code,canWrite}]}`.
- `POST /session` accepts `{username,password}` with `X-CSRFToken` and returns the authenticated session shape. Invalid credentials return a generic `401` error. Apply a bounded login throttle. Production identity and MFA remain separate tracked work.
- `DELETE /session` logs out with CSRF validation and returns `{authenticated:false}`. The client clears draft and query state.
- `GET /health` returns service readiness without configuration or customer information.

## Work orders

- `GET /sites/{siteId}/work-orders?q=...` returns `{items:[WorkOrderSummary],totals:{open,held,intakeDrafts},asOf}`. Bound results to 100, newest first. Search matches reference, VIN, registration and customer name in the authorised site only. Pagination is required before a larger rollout.
- `GET /sites/{siteId}/work-orders/{id}` returns `WorkOrderDetail`.
- `POST /sites/{siteId}/intake-drafts` accepts `{customer:{name,phone,email},vehicle:{vin,registration,make,model},odometerKm,socPercent,complaint}`. All keys are required; `socPercent` may be null. This creates customer and vehicle identity only after scoped duplicate checks, a visit, one work order and C01. An existing VIN must never silently change owner or duplicate a customer. Reject with a stable conflict until an explicit existing-vehicle selection flow exists.
- `POST /sites/{siteId}/work-orders/{id}/complaints` accepts `{expectedVersion,wording}` and returns the updated detail. The server allocates C02 onward.
- `POST /sites/{siteId}/work-orders/{id}/tasks` accepts `{expectedVersion,complaintId,title}`. The server creates a planned task T01 onward. Planned tasks are not authorised or dispatched work.
- `POST /sites/{siteId}/work-orders/{id}/holds` accepts `{expectedVersion,scope:{kind:'workOrder'}|{kind:'task',taskId},category,severity,reason,source}`. Category is `safety|approval|parts|equipment|competency|other`, severity is `stop|warning`. The reporting person owns the hold initially. `source` is a recorded observation/reference, not a fabricated evidence-object ID. All technical holds remain open in this unit. Resolution needs a separately implemented authority/evidence command.

Mutations require `Idempotency-Key`, a UUID generated once for the user's submitted intent and retained across retry. The scope of a key is person, organisation, site and command key. Include operation and target in the fingerprint. Same content returns the stored response; changed content conflicts. Replays recheck active membership and current command authority before returning old responses. Only successful commands produce receipts; validation and conflict failures have no business writes. The shared transaction shape is defined in the [aggregate command, event and outbox contract](aggregate-command-contract.md).

## Staff-managed vehicle-owner access

Owner-account creation and central identity linking are provisioned separately; a contact record never creates an owner principal. Staff may manage a site's access scope only with the explicit `vehicle-owner-access.manage` grant and an accepted evidence record. Ordinary writable membership is insufficient. These management routes do not create a public owner portal or self-registration path.

- `POST /sites/{siteId}/vehicles/{vehicleId}/owner-access/approve` accepts `{expectedVersion,ownerAccountId,evidenceRecordId,reason,validUntil?}` and creates or renews that owner's approved relationship.
- `POST /sites/{siteId}/owner-access/{accessScopeId}/relationships/{relationshipId}/revoke` accepts `{expectedVersion,evidenceRecordId,reason}` and appends a revocation revision.
- `POST /sites/{siteId}/owner-access/{accessScopeId}/relationships/{relationshipId}/expire` accepts `{expectedVersion}` and appends an expiration revision only after the approved interval has ended.
- `POST /sites/{siteId}/owner-access/{accessScopeId}/relationships/{relationshipId}/transfer` accepts `{expectedVersion,newOwnerAccountId,evidenceRecordId,reason,validUntil?}`. It closes only the selected relationship and approves the specified incoming owner in one command.

All commands lock the vehicle's site access scope, use its expected aggregate version, and append immutable relationship revisions. An approved status becomes inaccessible at `validUntil` even before the expiration revision is appended. The public owner API and invitation flow remain separately gated by CUST-003..010.

## Projections

`WorkOrderSummary` contains `id,reference,version,createdAt,customerName,vehicleLabel,vin,registration,status,complaintCount,openHoldCount`. `status` is `intakeDraft` in this unit; holds are independent records.

`WorkOrderDetail` adds `customer:{id,name,phone,email}`, `vehicle:{id,vin,registration,make,model}`, `odometerKm,socPercent`, `complaints:[{id,reference,wording}]`, `tasks:[{id,reference,title,complaintId,state:'planned'}]`, `holds:[{id,category,severity,reason,source,taskId,openedAt,openedBy}]`, `history:[{id,action,at,actor,reason}]`, and `gates:[{code,label,state:'pending',missing:[string]}]`. `taskId` is null for a work-order hold. No gate is marked accepted in this unit.

Use ISO 8601 UTC timestamps. Show the site timezone in the UI. Money is absent from this first slice; later contracts use integer minor units plus explicit currency.

## Errors

Errors have `{error:{code,message,fields?}}`. Use `400` for validation, `401` for missing/invalid session, `403` for an inactive or unwritable membership, `404` for invisible records, `409` for stale version, duplicate VIN or idempotency conflict, and `429` for throttled login. A stale response includes `currentVersion` in the error object. Never expose SQL, secrets, or another site's details.

No generic status PATCH, gate acceptance, authority seed, hold-resolution shortcut, stock movement, payment or release endpoint exists in this unit. Later implementations extend the versioned contract with named commands and their tests.

# Current web and API contract

This document records the currently implemented web/API slice. It includes later additions to the initial intake contract. It does not claim completion of reception, G1, technical completion/release, invoicing, payment or collection. A persisted reception draft is not accepted custody, repair approval or a passed gate.

All paths are under `/api/v1`. JSON uses camelCase. UUIDs identify entities and commands. A same-origin session determines the person; a site path selects only among that person's active memberships. Request bodies cannot select an organisation or actor. Return `404` for another site's object. List counts and history use the same scope as their records.

## Identity

- `GET /session` sets the CSRF cookie and returns either `{authenticated:false}` or `{authenticated:true,user:{id,displayName},sites:[{id,name,code,canWrite}]}`.
- `POST /session` exists only in `NODE_ENV=test` for isolated test fixtures. Production sign-in uses the OIDC start/callback routes and central identity service; do not document or expose a production password-login endpoint here.
- `DELETE /session` logs out with CSRF validation and returns `{authenticated:false}`. The client clears draft and query state.
- `GET /health` returns service readiness without configuration or customer information.
- `GET /auth/oidc/start` and `/auth/oidc/callback` run the staff OIDC flow. Owner sign-in uses its separate `/owner/auth/oidc/start` route and owner session. Production provider and domain configuration remain launch dependencies.

## Work orders

- `GET /sites/{siteId}/work-orders?q=...&queue=...&page=...&pageSize=...` returns `{items:[WorkOrderSummary],pagination:{page,pageSize,totalItems,totalPages},totals:{open,held,intakeDrafts},asOf}`. Page size is limited to 100 and results are newest first. Search matches reference, VIN, registration and paying-client name inside the authenticated site. A summary includes `clientName` (nullable), not `customerName`.
- `queue` defaults to `all`. `operations` shows jobs needing Operations review or lead assignment; `awaiting-operations` shows jobs without a current review unless the latest lead assignment already belongs to the latest review; `held` shows jobs with a recorded hold; `awaiting-lead` shows jobs whose latest Operations review matches the current work-order version and has no lead assignment; `assigned` follows the latest lead assignment when it belongs to the latest review; `team-lead` and `supervisor` follow the current user's latest assignment or handoff. These are site-scoped work-list filters, not grants: each command checks current membership, authority, qualification and gate requirements independently. Technician, service-advisor, parts and inspector work queues remain future workflow work.
- `GET /sites/{siteId}/work-orders/{id}` returns `WorkOrderDetail`.
- `GET /sites/{siteId}/clients/lookup?q=...`, `/parties/lookup?q=...`, and `/vehicles/lookup?vin=...` return only same-site matches. Existing client, owner, contact and vehicle IDs must be explicitly selected; an existing VIN never silently changes its recorded owner.
- `POST /sites/{siteId}/intake-drafts` accepts separate `client`, `owner`, `visitContact` and `vehicle` choices. Each client/owner/contact choice is explicitly `existing` with a same-site `partyId`, or `new` with its allowed fields; vehicle is `existing` with a `vehicleId` or `new` with VIN, registration, make/model and optional variant/powertrain. The command also requires `odometerKm`, nullable `socPercent`, `powertrainClass` (`EV|HYB|ICE`), `warrantyStatus` (`confirmed|not-confirmed|unknown`), `warrantyConfirmationNote` and the first `complaint`. Confirmed warranty requires a recorded basis; other states reject a confirmation note. Success creates/uses scoped canonical parties and vehicle, a visit, one work order and C01 in one command. The booking reference uses the paying client's cross-powertrain sequence and snapshots confirmed powertrain/warranty-at-creation. It does not accept custody or pass G1.
- `POST /sites/{siteId}/work-orders/{id}/complaints` accepts `{expectedVersion,wording}` and returns the updated detail. The server allocates C02 onward.
- `POST /sites/{siteId}/work-orders/{id}/tasks` accepts `{expectedVersion,complaintId,title}`. The server creates a planned task T01 onward. Planned tasks are not authorised or dispatched work.
- `POST /sites/{siteId}/work-orders/{id}/holds` accepts `{expectedVersion,scope:{kind:'workOrder'}|{kind:'task',taskId},category,severity,reason,source}`. Category is `safety|approval|parts|equipment|competency|other`, severity is `stop|warning`. The reporting person owns the hold initially. `source` is a recorded observation/reference, not a fabricated evidence-object ID. All technical holds remain open in this unit. Resolution needs a separately implemented authority/evidence command.
- `POST /sites/{siteId}/work-orders/{id}/intake-facts` records an attributed reception observation with expected version and accepted attached evidence IDs. It can correct an earlier observation with a reason; it does not prove custody, ownership, safety clearance or G1.
- `POST /sites/{siteId}/work-orders/{id}/diagnostic-findings` records an append-only structured finding linked to a concern and optional planned task, including certainty, residual risk, restrictions and evidence. It never authorizes diagnosis, testing or repair and does not advance a gate.
- `POST /sites/{siteId}/work-orders/{id}/operations-review` records review of the current version. `GET .../eligible-team-leads` returns qualified, currently assignable leads. `POST .../team-lead-assignment` requires the current review, selected qualified lead and reason.
- `POST /sites/{siteId}/work-orders/{id}/work-plan-revisions` stores a versioned ordered draft for the assigned lead. `GET .../eligible-supervisors` returns eligible supervisors. `POST .../supervisor-handoff` binds the handoff to the exact current plan revision. These operations do not authorize repair or sign off technical completion.
- Evidence uses scoped upload intents, quarantine and scan results; work-order attachment is a versioned command. Only accepted, clean evidence can be downloaded or linked to a work-order observation. Storage and scanner configuration must be present for the full upload path.

Mutations require `Idempotency-Key`, a UUID generated once for the user's submitted intent and retained across retry. The scope of a key is person, organisation, site and command key. Include operation and target in the fingerprint. Same content returns the stored response; changed content conflicts. Replays recheck active membership and current command authority before returning old responses. Only successful commands produce receipts; validation and conflict failures have no business writes. The shared transaction shape is defined in the [aggregate command, event and outbox contract](aggregate-command-contract.md).

## Staff-managed vehicle-owner access

Owner-account creation and central identity linking are provisioned separately; a contact record never creates an owner principal. Staff may manage a site's access scope only with the explicit `vehicle-owner-access.manage` grant and an accepted evidence record. Ordinary writable membership is insufficient. These management routes do not create a public owner portal or self-registration path.

- `POST /sites/{siteId}/vehicles/{vehicleId}/owner-access/approve` accepts `{expectedVersion,ownerAccountId,evidenceRecordId,reason,validUntil?}` and creates or renews that owner's approved relationship.
- `POST /sites/{siteId}/owner-access/{accessScopeId}/relationships/{relationshipId}/revoke` accepts `{expectedVersion,evidenceRecordId,reason}` and appends a revocation revision.
- `POST /sites/{siteId}/owner-access/{accessScopeId}/relationships/{relationshipId}/expire` accepts `{expectedVersion}` and appends an expiration revision only after the approved interval has ended.
- `POST /sites/{siteId}/owner-access/{accessScopeId}/relationships/{relationshipId}/transfer` accepts `{expectedVersion,newOwnerAccountId,evidenceRecordId,reason,validUntil?}`. It closes only the selected relationship and approves the specified incoming owner in one command.

All commands lock the vehicle's site access scope, use its expected aggregate version, and append immutable relationship revisions. An approved status becomes inaccessible at `validUntil` even before the expiration revision is appended. The public owner API and invitation flow remain separately gated by CUST-003..010.

## Projections

`WorkOrderSummary` contains `id,reference,version,createdAt,clientName,vehicleLabel,vin,registration,status,complaintCount,openHoldCount`. The current API schema fixes `status` to `intakeDraft`; it does not yet project later lifecycle or closed states.

`WorkOrderDetail` adds paying `client`, reported `owner`, `visitContact`, client booking snapshots, Operations review and capability, team-lead assignment, work-plan draft, supervisor handoff, vehicle and same-site vehicle history, odometer and battery charge, complaints, planned tasks, holds, evidence, reception observations, diagnostic findings, event history and five gates. The current projection keeps every gate `pending`. `taskId` is null for a work-order-wide hold. Estimates, invoice, technical release, accepted custody and a closed-at field are not yet implemented; they are not empty successful records.

Use ISO 8601 UTC timestamps. Show the site timezone in the UI. Money is absent from this first slice; later contracts use integer minor units plus explicit currency.

## Errors

Errors have `{error:{code,message,fields?}}`. Use `400` for validation, `401` for missing/invalid session, `403` for an inactive or unwritable membership, `404` for invisible records, `409` for stale version, duplicate VIN or idempotency conflict, and `429` for throttled login. A stale response includes `currentVersion` in the error object. Never expose SQL, secrets, or another site's details.

No generic status PATCH, gate-acceptance shortcut, authority seed, hold-resolution shortcut, stock movement, estimate approval, invoice, payment, technical completion, vehicle release, collection or delivery endpoint is implemented in this slice. New workflow commands must extend this contract with their owning domain schema, action-time authority check, aggregate version, idempotency receipt, atomic audit/outbox write and permitted/denied-path tests.

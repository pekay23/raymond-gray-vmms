# Existing portal source audit

Date: 2026-11-07. Reference repository: `C:/Projects/raymond-gray-platform`. Inspected HEAD: `46d84de` with a modified `AGENTS.md`. This was a read-only source investigation. No application tests, deployed workflows, database queries, schema changes, credential reads, or migration operations were performed.

The existing portal provides public booking, technician assignment, estate maintenance, invoices, notifications, storage, and a responsive portal shell. The inspected vehicle workflow is a booking status pipeline. It does not establish compliance with the master specification's independent gates, scoped technical authority, payer ledger, and evidence requirements. Preserve the existing service while building and verifying the replacement separately.

## Source precedence

The user's 2026-11-07 instruction authorizes a new implementation and overrides the source documents' in-place-only implementation constraint. It does not authorize losing existing records. Preserve legacy IDs, history, interfaces, and unknown approval states through an explicit migration and reconciliation process.

The source repository's `AGENTS.md` and `docs/HANDOFF.md` describe an earlier Supabase authentication architecture. Current code differs. `src/lib/auth.ts:23` initializes NextAuth with a credential login-token provider. `src/lib/prisma.ts:9` describes a primary database and optional secondary writes. Configuration names and comments identify possible providers, but this audit did not inspect deployed connection values and cannot identify the actual production provider.

## Traced workflows

### Authentication and authorization

`src/lib/auth.ts:23` configures NextAuth. The credential provider looks up a `PasskeyChallenge` of type `login_token`, checks expiry, deletes it, loads the associated `User`, and admits an `APPROVED` user. JWT and session callbacks copy application role, status, IDs, and department into the session. `auth()` at line 104 wraps that session and supports `SUPER_ADMIN` impersonation, retaining `originalAdminId`.

`src/lib/api-helpers.ts:23` admits a minimum role by numeric hierarchy. `requireOneOfRoles()` at line 41 checks explicit roles. `requireStaffCapability()` at line 58 delegates to the staff department capability map. These are useful route guard conventions, but do not establish a person's time-valid, site-specific technical or financial privilege. Higher administrative role automatically passes the former role guards.

`src/lib/property-filter.ts:14` reads the selected facility from `rg_property`. `propertyWhere()` at line 29 produces `{facilityId}` or `{}` for all properties. This is a display/query selection mechanism. The inspected helper does not establish facility membership or a tenant boundary. A selected site must never substitute for an authorized site in VMMS.

### Public booking to technician completion

`src/app/api/vehicle-bookings/route.ts:27` receives public bookings, rate limits by IP, validates input, generates a human-readable job ID, and creates a `VehicleBooking`. After persistence it starts Google Sheets and email work. Its CORS constant at line 14 allows `https://vehicleservices.raymond-gray.org`; the nearby comment names a different origin. Preserve the actual integration contract after confirming the live caller.

`src/lib/job-id.ts:7` reads the highest existing `RGV-xxxxx` job ID and increments it. The read-then-create operation has no observed shared sequence or transaction, so simultaneous bookings can compete for the same unique job ID. Preserve old IDs during migration; allocate new references with a database-backed sequence or transaction.

`src/app/api/vehicle-bookings/[id]/route.ts:8` lets an admin update booking fields. Assignment checks that the proposed technician is an approved technician. It then updates the booking and broadcasts status changes. This path has no inspected task/model privilege, permit, evidence, scope-version, or G1-G5 validation. Its `DELETE` handler at line 118 physically deletes a booking.

`src/app/(portal)/technician/vehicle-jobs/[id]/page.tsx:12` authenticates the technician and verifies assignment before showing the booking. `src/app/api/technician/vehicle-jobs/[id]/status/route.ts:6` allows the assigned approved technician to set `IN_PROGRESS` or `COMPLETED`. Its `updateMany` condition rechecks assignment, but does not compare the previous state or a record version. It has no inspected technical-completion declaration or independent release record.

### Estate work orders and invoices

`src/app/api/admin/work-orders/route.ts:21` guards the estate board with `requireStaffCapability("work-orders")`, accepts a facility filter, and queries Prisma `Task`. Creation at line 78 allocates a `WO-xxx` reference from the most recently created task and writes one task. PATCH at line 111 directly changes status, assignee, and priority. This is a second workflow distinct from `VehicleBooking`; do not merge their records based on matching display references.

`src/app/(portal)/admin/work-orders/page.tsx:48` reads that API through `usePaginatedList`, offers status filters, and creates or changes estate tasks. The page's `WorkOrder` interface is an estate-task projection rather than a controlling vehicle work order with complaint and task lines.

`src/app/api/admin/invoices/[id]/route.ts:5` uses an admin guard and loads `Invoice` with its estate `Task`, company, facility, and assignee. `prisma/schema.prisma:688` stores invoice amount as `Float`, optional unique task link, status, dates, and payment method. `VehicleBooking` separately contains invoice number, quote amount, approved amount, and payment-status text. No cross-object reconciliation was proven. New money calculations need exact decimal or integer minor units and a currency, separate payer allocations, and reconciled receipts.

## Data and operating controls

| Area | Observed source | Consequence for the replacement |
| --- | --- | --- |
| Customer and vehicle identity | `prisma/schema.prisma:328` `VehicleBooking` embeds contact, make/model, registration, and job fields. No VIN field exists in that model. | Retain raw source fields and aliases. Resolve customer and VIN identity in staging; do not invent missing VINs or merge by registration alone. |
| Organisation and site | `User` at line 95 has company and base-facility links. `Facility` at line 485 belongs to company. `Task` at line 565 permits nullable company and facility. | Determine business tenancy and service-centre site separately from customer companies. Record an explicit approved mapping. |
| Stock | `InventoryItem` at line 375 has SKU, quantity, location, and floating-point cost. | Count reconciliation, lot/serial provenance, reservations, compatibility, and issue/return ledger need separate implementation. |
| Authority | `User.skills` and role/status are present. | Skills and roles cannot become approved grants during import. Historical authority remains unknown unless supported by evidence. |
| Persistence | `src/lib/prisma.ts:34` runs the primary mutation, then starts optional secondary mutation without awaiting it. Secondary failure is logged. | Do not copy this mechanism as synchronization or backup. It has no observed durable retry, conflict handling, atomic cross-database commit, or reconciliation. |
| Database TLS | `src/lib/prisma.ts:16` and line 26 set `rejectUnauthorized: false`. | Configure certificate verification for the new service and test its actual connection policy. |
| Attachments | `src/lib/supabase/storage.ts:24` uploads client-side, defaults upsert to true, and returns `getPublicUrl()`. | Retain legacy URL aliases while importing evidence. New evidence needs private access, immutable metadata, hashes, validation, retention, and controlled signed delivery. Actual bucket access policies were not verified. |
| Offline mutations | `src/app/sw.ts:14` defines a 24-hour background-sync queue; lines 26-31 match every mutating `/api/` request. `src/hooks/useOfflineQueue.ts:4` counts that queue. | Do not queue safety release, financial approval, or arbitrary destructive requests as generic HTTP retries. Define supported draft commands, idempotency, identity expiry, version checks, and conflict review. |
| Realtime | `src/lib/realtime/events.ts:25` publishes best-effort Supabase broadcast after a write. | A realtime message is a refresh hint, never evidence that a transaction or audit record committed. Validate channel authorization in the deployment. |
| Audit | No `AuditLog` model was returned by the targeted schema search. Inspected booking/task writes update current records directly. | Significant event history, authority snapshots, sensitive access events, and append-only correction semantics remain unproven. Do not infer compliance from timestamps. |

## Reuse decisions

Reuse business vocabulary and public integration field contracts where validated. The portal shell's configurable navigation, pagination, table-to-mobile-card approach, and 44-pixel touch convention are useful UI references. Reimplement them against the new design system rather than copying role hierarchy or estate assumptions into the VMMS domain.

Retain existing `User.id`, `User.displayId`, `User.authId`, booking `id` and `jobId`, task `id` and `ref`, invoice `id` and `invoiceNo`, attachment URLs, and relationship IDs as typed source aliases. A source-system identifier plus entity type must accompany every alias because display IDs from different workflows can overlap.

The inspected integration candidates are Google Sheets, Resend email, Supabase Storage, Supabase Realtime, Web Push, and the separate vehicle-services public booking client. Configuration availability and successful operation were not tested. Accounting, payment-gateway settlement, WhatsApp delivery, diagnostic hardware, backup scheduling, and production recovery remain discovery items rather than assumed existing capabilities.

## Migration conditions

1. Obtain a permitted export and backup manifest. Inventory every actual table, record count, ID, storage object, integration, and active workflow from that snapshot.
2. Import into staging with source IDs and raw values. Record duplicate candidates and unmapped statuses for human review. Preserve old `COMPLETED` as historical status, not proof of technical release.
3. Reconcile relationships, invoice totals, historical records, and attachment checksums. Report missing evidence separately from import defects.
4. Verify public booking and staff access through adapters. Keep old interfaces available until replacement behavior and consumers have passed acceptance.
5. Rehearse cutover and forward recovery, including records written after the export. Freeze or route writes explicitly at cutover; do not use the old optional dual-write extension as the migration protocol.
6. Require management acceptance of reconciliation and the pilot before switching production traffic.

## Evidence limits and rationale

CodeGraph was used first for code exploration. It warned that some entries lagged current disk edits. `auth.ts` and `prisma.ts` were therefore read directly, and the Prisma schema was inspected directly after CodeGraph could not resolve it. The traced source contradicts older repository documentation, so current files take precedence for this report.

Relevant source history includes `721ac8f` titled `chore: optimize auth performance and fix admin UI/UX bugs` for the authentication and persistence files, and `da516a1` titled `feat: implement comprehensive smart estate portal with QR scanning, AI insights, workflow management, and passkey authentication`. Commit subjects show the change areas, not proof of the original design's reasoning. No external tickets, operator interviews, live telemetry, or database evidence were reviewed.

No working functionality was removed or copied into the new product by this investigation. The final reference-tree status also showed `.codegraph/.gitignore` modified after CodeGraph exploration; its contents were not edited manually. This is a bounded source audit, not a comprehensive penetration test or a claim about the current production environment.

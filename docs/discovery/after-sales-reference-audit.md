# After-sales reference audit

**Status:** read-only source review; operational validation remains pending.

## Scope and limits

Reviewed `C:\Projects\after-sales` as a reference implementation for pages, forms, data organization, and workflow. This review inspected source and supplied form images only. It did not run the app, access its database, inspect live customer records, or establish management approval. No source files in that project were changed. Handwritten customer, vehicle, and staff values in form images are intentionally not reproduced here.

## Product shape

The project is a Next.js App Router application backed by Supabase. Its navigation covers Dashboard, PDI, Repairs, Maintenance, After-Sale Issues, Vehicles, Clients, Service Requests, and Admin. Desktop uses a side navigation and mobile uses a bottom navigation. PDI, repair, maintenance, and issue logs share list, filtering, detail, and edit patterns. Vehicle detail presents a service history timeline. Forms can look up a vehicle by chassis and offer a create-vehicle path when no match is found. PDI and service request flows support evidence uploads. The project includes filtered Excel export affordances.

These are source-level findings, not claims that each page or export was exercised successfully at runtime.

## PDI form reviewed

The two supplied PDI form pages show model, registration/chassis, location, inspection date, and a structured checklist. The checklist groups cover exterior, interior, EV electrical, and mechanical/safety items. The second page includes body-damage views, comments, and Technical Lead/PDI Officer name, signature, and pass/fail clearance fields. The inspected seed checklist contains 22 items. A build guide elsewhere describes progress as “18 of 24,” so the reference materials disagree on the checklist count; VMMS must derive counts from the current approved form revision rather than hard-code either value.

The React checklist component has per-item checks and notes, section grouping, progress, and a hidden serialized form value. The PDI form also models chassis, inspection, body condition, scans, and clearance. The inspected flow permits Passed with unchecked items if a comment is entered, and a database trigger derives Completed from Passed and marks the vehicle Sold. Treat these as legacy behavior to review, not as safe VMMS policy.

## Data and authority boundaries observed

The reference schema keeps vehicles and PDI/repair/maintenance/issue logs in separate tables, with chassis as a global vehicle key and client name on vehicle/log records. Its database policies describe only Admin and Staff roles, with broad read/add/edit access for active staff and delete access for admins. The PDI form’s typed names and signatures do not provide independent, signed, scoped authority grants. The reviewed repair/maintenance statuses are generic completion labels.

These boundaries conflict with VMMS requirements for organisation/site scoping, separate payer/client, vehicle owner and visit contact, action-time grants, decision snapshots, independent inspection, and the G1–G5 command gates. A reference PDI Passed value cannot satisfy a VMMS gate or authorize release, payment, or vehicle collection.

## Patterns VMMS can adapt

- Chassis/VIN-first lookup with an explicit human review step.
- One canonical vehicle record with an attributable service history timeline.
- Checklists embedded in the relevant form, with per-item notes and revision-derived progress.
- A damage diagram with comments and linked evidence.
- Navigation shaped around staff work areas and adapted to narrow screens.
- Domain-specific filtered exports and reports.

## Patterns VMMS must replace or constrain

- Scope every record and query to the authenticated organisation and site; chassis identity is not a substitute for tenant scope.
- Keep payer/client, vehicle owner, and visit contact distinct.
- Route each new job through Operations review, a qualified lead assignment, supervisor execution and completion, lead release, and advisor collection/payment coordination.
- Enforce signed role grants and independent inspection on the server. Typed names, signatures, generic “Fixed/Done,” or PDI Passed status do not establish authority.
- Keep safety holds, G1–G5, payer terms, warranties, and release policy fail-closed until approved policy and evidence exist.
- Do not copy the reference Sold trigger or allow an incomplete checklist to pass a safety gate through a free-text comment.

## Pending evidence

The owner will provide the current SOP documents and any later workbook/source files. After receipt, document control must inventory revision, approval, effective date, applicable vehicle/work scope, responsible authority, and mapped VMMS validation. Until then, the mapping in [SOP validation mapping](../architecture/sop-validation-mapping.md) is a design aid only; no reference-project checklist is an approved procedure.

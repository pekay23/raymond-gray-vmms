# PDI and routine maintenance checklist form — draft

**Status:** Draft template; not effective and not authorization to work\
**Template revision:** 0.1\
**Review:** Technical owner, Quality and management approval required

The template produces a structured report from recorded checklist items. It does not take a screenshot of the work-order page. Every template revision is linked to the applicable vehicle scope and source procedure. A checklist generated from this draft must carry a visible draft watermark and cannot satisfy a work, safety, inspection, release or delivery gate.

## Header

| Field | Capture |
| --- | --- |
| Visit / booking | VMMS reference, site, opened date/time and visit type (PDI or routine maintenance) |
| Client and contacts | Paying client, reported owner and visit contact, each with relationship and verification state |
| Vehicle | Verified VIN/chassis, model, variant, model year, powertrain, registration if applicable, odometer and unit |
| Schedule basis | Last verified service date/odometer, applicable next milestone, source file/revision and reviewer; allow `unknown` |
| Authorization | Consent by purpose, authorized scope, customer decision record and any limits |
| Template and evidence | Checklist/template ID and revision, approved OEM procedure IDs/revisions, attached evidence status |

## Item table

Use one durable row per task or observation. Support adding model-specific items from approved templates without changing the historical template revision.

| ID | Area / required task | Procedure ID and revision | Applicability | Result | Actual observation/value and unit | Reason/comment | Evidence | Assigned staff | Review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | Applicable / N/A with reason | Pass / Fail / Not checked / Not completed / Blocked | Record only what was observed or measured | Required unless approved rule says otherwise | Accepted file(s) or none | Named accountable worker | Pending / Accepted / Returned with reason |

## Suggested configurable PDI areas

Identity and delivery documents; exterior/body/glass/lighting; wheels/tyres; cabin/seating/restraints; controls and warnings; display/software and customer setup; powertrain and energy system; charging/fuel interface; approved leak/fluid checks; brakes/steering/suspension; accessories and supplied items; cleanliness/presentation; road test if separately authorized; open defects, holds and follow-up. Each area expands only from an approved model-specific checklist.

## Suggested configurable maintenance areas

Manufacturer-scheduled tasks due by time or mileage; verified service history; customer-reported issues; approved general condition observations; diagnostics/road test when consented; approved parts and materials; additional work approval; completed and uncompleted task summary; hold/return reason; next manufacturer milestone. The 10,000 km / 12-month reminder is an intake trigger. The exact service list must come from the effective manufacturer schedule for the exact vehicle.

## Status and validation rules

- `Completed` requires the assigned worker, time, applicable procedure, expected evidence/measurement and required Supervisor review.
- `Failed`, `Not checked`, `Not completed`, `Blocked` and `Not applicable` require a plain-language reason. A failure may open or link a work order/task; it must not silently disappear from the report.
- Each requested item has a disposition: approved and assigned, declined by the proper decision maker, deferred with an owner/follow-up, not applicable with reason, or blocked pending evidence/authority.
- Keep technician/engineer task updates, Supervisor technical completion, Team Lead release and Head inspection as distinct actors and decisions. A higher role may take charge only when the relevant grant and workflow allow it; this does not rewrite the original assignment or work history.
- Record corrections as new, attributable revisions. Do not overwrite prior results, evidence, signer or timestamp.
- An open hold, missing procedure, absent authority, failed mandatory item or required missing sign-off prevents the overall state from becoming `Complete` or `Ready for delivery`.

## Generated report layout

1. Purpose-built cover: business/site, PDI or maintenance report, booking number, report date and status.
2. Vehicle and customer relationship summary, clearly distinguishing paying client, reported owner and visit contact.
3. Schedule basis and source procedure revision, with any unknown baseline stated plainly.
4. Concerns and checklist outcomes grouped by area, including full comments, reasons, measurements/units and accepted evidence labels.
5. Completed versus incomplete/failed/blocked/not-checked counts and a detailed table for each open item with assigned person and next step.
6. Review and correction history: Supervisor, Team Lead and Head sign-offs separately; names, role/grant snapshot, decision and time.
7. Next action, next due basis, open holds and client-approved/declined/deferred work.
8. Footer with version, generated time, page number, source disclaimer and “This report is not a work authorization” where appropriate.

Client versions omit restricted internal notes, staff contact data, credentials, internal flags and financial details not relevant to that recipient. Staff reports follow the approved role/site access policy.

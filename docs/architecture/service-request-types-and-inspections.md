# Service request intake and inspection types

**Status:** Recommended implementation refinement from management guidance received 20 November 2026. The intake model and safety boundaries are accepted for build planning. Exact inspection schedules, fee amounts, third-party identity checks and publication rules remain open where identified below.

**Implementation checkpoint:** Staff request entry stores one of four service types, preserves it in saved drafts, and displays it in the request list/detail. PDI requests can record a reported source (showroom stock, partner garage, other or unknown); PSAI requests can record a shipping reference. Advisor reception carries these reported facts and the type into the work order; the work-order screen and standard print report show the category and applicable context. This does not yet provide customer/third-party entry, verified vehicle matching, dedicated PSAI/PDI checklists or report templates, or commercial fee handling.

## Management direction

- Use one Service Request workflow to onboard work, whether a client submits it or staff record it on a client's behalf.
- The Service Advisor reviews requests and converts an accepted request into one workshop work order.
- Keep Post Shipping Acceptance Inspection (PSAI) distinct from Pre-Delivery Inspection (PDI).
- A Service Centre PDI may concern a vehicle from showroom stock or a partner garage. The PDI service has a fee regardless of which third party requested it.
- Where a vehicle has an existing service record, a requester may supply identifying details so the Service Advisor can find and confirm the correct vehicle record.

### Additional management clarification

Management clarified that the Service Centre receives inspection requests from third parties and charges for the inspection regardless of who makes the request. This applies to both named inspection types in this workflow: Post Shipping Acceptance Inspection (PSAI) and Service Centre Pre-Delivery Inspection (PDI). Recording a request through staff does not change its type or remove the fee. The request page is the common way to onboard this work; a Service Advisor reviews the submitted request and processes an accepted, arrived vehicle into a work order for workshop fulfilment. Staff may also use the same intake for requests they receive directly from existing clients.

For an approved client account, the request form may look up a vehicle using details the account is permitted to access. When the submitted identifier matches one of that account's already-authorized vehicles, the form can prefill its known details and show the permitted vehicle context. It must not expose another client's vehicle or prior inspection records. A third-party requester can submit the identifying details they have; the form must not confirm or deny a match. The Service Advisor performs the site-scoped match and confirms the vehicle before conversion. This interprets “the record will show up” as a safe, authorized prefill/match, not a public vehicle-history search.

## Chosen intake model

Service Request is the single intake path for:

1. Repair or maintenance concern.
2. Routine maintenance request.
3. PSAI request.
4. Service Centre PDI request.

An authenticated client, an approved vehicle owner, a third-party garage, showroom, shipper or other organization, or an authorized staff member acting for a client can start a request. A third party can request a PSAI or Service Centre PDI without becoming the vehicle owner or payer. Keep requester, paying client, reported owner, vehicle, presenting contact, and vehicle source as separate facts. Do not infer that the requester owns the vehicle or pays the invoice. Every PSAI and Service Centre PDI carries the required inspection fee regardless of requester category; only the explicitly confirmed paying client is billed.

The public or customer-facing entry point creates a request only. It must not create a work order, accept custody, approve diagnosis or repair, grant vehicle-history access, or expose whether a submitted VIN/registration matches another client's record. Until the requester's identity and authority to see a vehicle record are verified, accept the supplied vehicle details as reported information and leave the canonical match for authorized staff review. For an approved authenticated client, show only vehicles that the account is already allowed to see.

Staff can create the same request for a caller or an existing client. Record the authenticated staff member as the request recorder and preserve the contact's name, contact details and relationship as reported information. Existing callbacks, notes, correction history and request-to-work-order linking remain on the canonical service-request record.

## Service Advisor review and conversion

The Service Advisor queue shows the requested service type, requester, reported vehicle details, paying-client claim, source, callback action and evidence available to the staff member's role. The Advisor can request more information, correct reported details with an auditable reason, associate an already-authorized canonical vehicle/client, or convert the request to a work order.

Conversion is one versioned, idempotent command. It must:

- Confirm the paying client, vehicle match or explicitly unresolved identity, visit contact, and source of the vehicle.
- Preserve the original request claims and their corrections; never overwrite them with the canonical match.
- Create exactly one work order, link it to the request, and place it in the Operations review queue.
- Carry the requested service type and applicable source/context into the work order.
- Reject stale, duplicate, cross-site, unauthorized and incomplete conversions without partial records.
- Keep custody, consent, G1/G2, technical work, inspection, release, invoicing, payment and departure as separate later steps.

If the vehicle is already at the service centre, reception can still create a work order directly and optionally link an existing request. If it is not yet present, the request remains a request until reception confirms arrival. An inspection request must not be described as accepted or scheduled until staff record that decision.

## PSAI and Service Centre PDI

These are fee-bearing service-centre work-order types, separate from routine maintenance and repair:

| Type | Meaning | Required context |
| --- | --- | --- |
| PSAI | Post Shipping Acceptance Inspection requested after vehicle shipment | Shipping/source reference when available; vehicle identity; requester; paying client; applicable approved inspection revision |
| Service Centre PDI | Pre-Delivery Inspection requested from the service centre before the vehicle is delivered to its next recipient | Delivery source (`showroom stock`, `partner garage`, or reviewed `other`); intended recipient/contact when known; paying client; applicable approved inspection revision |

A PSAI and Service Centre PDI are workshop service requests and, after Advisor conversion and reception, work orders. The fee rule applies to either inspection type regardless of requester; it does not make the requester the payer. They are not the Sales department's delivery-preparation record. Internal Sales delivery preparation and its eventual Sales PDI remain a separate later workflow. Do not create a Sales delivery or infer a completed sale as a side effect of an external Service Centre PDI.

The system may suggest a known vehicle to authorized staff after a site-scoped VIN/chassis or registration search. It may also prefill a vehicle for an authenticated client only when that vehicle is already authorized to that account. It must show the source and verification state and require the Advisor to confirm the exact vehicle. A third-party or anonymous form must never reveal whether a submitted VIN/chassis/registration has a match, nor return vehicle or inspection history. A conflict, ambiguous match or unverified identifier stays unresolved; it is never silently merged.

PSAI and Service Centre PDI use separate, context-specific checklist template revisions and report headings. Neither uses a generic maintenance list. The 10,000 km/12-month reminder is not an inspection procedure. No checklist can be activated until the exact vehicle/model/variant source, revision, applicability and required measurement/evidence rules are approved.

## PDI fee and manual payment

Management's instruction that PSAI and Service Centre PDI are fee-bearing regardless of who submits or records the request is a business rule. Record the required inspection charge on the approved quote/invoice; do not create a requester, showroom, garage, client or staff-entry path that silently waives it. The payer remains the explicitly confirmed client, which may be different from the requester, owner or vehicle source.

No fee amount, currency/tax basis, quote expiry, refund/cancellation treatment or price authority was supplied. Until those values and grants are configured, either inspection request can be received and reviewed, but its billable quote cannot be issued and the vehicle cannot pass commercial handover. Keep the existing manual-payment rule: issue an invoice, have staff verify external payment, and create a receipt only after that verification. No payment gateway is introduced.

## Safety, privacy and audit

- Request details are reported claims, not verified owner, payer, vehicle, consent, diagnosis or approval.
- Public intake uses abuse controls and must avoid a vehicle/customer enumeration oracle. Exact verification, contact proof, rate limits and anti-automation controls are implementation prerequisites for public access.
- Only authorized customer accounts see their already-approved vehicles or request history. A third-party requester sees only their submitted request status and only after their own identity is verified.
- Operations approval and work-plan handoff remain required. No request type bypasses G1/G2/G3/G4, required holds, evidence, qualifications or independent inspection.
- Store actor, role/site scope, source, request type, vehicle-match state, every correction, conversion decision, price acceptance and later work-order transitions in the audit history.

## Rollout sequence

1. Add request type and safe requester/vehicle-source facts to the request model and staff queue.
2. Build customer/third-party request entry with protected vehicle matching and saved draft/retry behavior.
3. Add Service Advisor review, question-back and one-command conversion to a typed work order.
4. Add distinct PSAI and Service Centre PDI checklist/report templates and the required PDI fee line.
5. Keep data-driven procedures, grants and invoice issuance fail-closed until their exact approved configuration exists.
6. Verify full request-to-arrival-to-Operations browser journeys with PostgreSQL, role isolation, anonymous/user privacy cases, responsive/accessibility checks and idempotent concurrent conversion.

## Review items

Tracked in `REV-064` and `REV-065` in the review register:

- Exact external requester authentication and proof-of-authority rules, and which request statuses an unapproved requester can see. The safe default is request-only submission without vehicle-match disclosure; an authorized client may see only vehicles already linked to their account.
- Exact PSAI and Service Centre PDI checklist ownership, reviewer independence and handover rules.
- PSAI/PDI fee amounts, currency/tax basis, and who may set or change them; whether rates differ by inspection type.
- Approved matching keys and disclosure rules for showing an existing vehicle to a customer or third party. Current recommendation: allow exact lookup/prefill for an already-authorized client; accept reported identifiers from third parties without confirming a match; let staff verify privately.
- Which required fields distinguish a showroom-stock, partner-garage or other delivery source.


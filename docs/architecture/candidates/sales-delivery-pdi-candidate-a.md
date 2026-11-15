# Candidate A: Versioned sales delivery with a source-attributed event ledger

**Status:** Architecture candidate for `USER-037`; not accepted and not authorization to create operational sales or PDI records. Read with the [design plan](../sales-delivery-and-pdi-design-plan.md), [vehicle identity and history](../vehicle-identity-and-history.md), [customer and repeat visits](../customer-and-repeat-visits.md), and [service journey](../service-journey.md).

## Proposal

Treat each delivered vehicle as one organisation-wide canonical vehicle, and each delivery as a site-scoped, versioned business record linked to that vehicle. Store delivery facts and PDI observations in typed relational tables. Use the existing command boundary and immutable domain-event ledger to record who changed the record, why, and which version changed. The relational rows remain the source of truth; the event ledger is the audit trail. This does not require rebuilding the application as a full event-sourced system.

The first release captures a delivery and any source-supported PDI observations. It does not issue an operational sale invoice, certify PDI completion, pass a work-order gate, verify current ownership, or create a service client or owner account.

## Record shape

```ts
type SalesDelivery = {
  id: UUID;
  organisationId: UUID;
  siteId: UUID;
  vehicleId: UUID;
  version: number;
  deliveredAt: Instant;
  purchaserAtDelivery: SourceClaim<string> | null;
  sourceReference: string | null;
  recordedBy: StaffUserId;
  recordedAt: Instant;
};

type PdiObservation = {
  id: UUID;
  organisationId: UUID;
  siteId: UUID;
  deliveryId: UUID;
  area: string;
  observation: string;
  sourceReference: string | null;
  recordedBy: StaffUserId;
  recordedAt: Instant;
  correctsObservationId: UUID | null;
  correctionReason: string | null;
};

type SourceClaim<T> = {
  value: T;
  source: string;
  certainty: 'reported' | 'verified';
};
```

The purchaser name is explicitly a claim about the purchaser at delivery. It cannot populate the current owner, service client, payer, visit contact or owner-portal relationship. PDI observations remain source-attributed observations. The schema has no `passed`, `safe`, `approved`, `G1`–`G5`, or release field; those outcomes require separate approved procedures and authorized commands.

Vehicle creation or selection is part of the delivery command, not a fuzzy background match:

- Normalize a VIN for comparison, validate the canonical VIN format, and enforce one canonical VIN per organisation with a database uniqueness constraint.
- For an existing VIN, require the staff member to select the matching vehicle. Never silently merge two vehicle records or rewrite an existing VIN.
- A uniqueness race returns the already-existing vehicle as a conflict for staff review. It must not create a second canonical vehicle or choose a vehicle based on purchaser, registration, model or a partial VIN.
- Registration is optional. An absent or not-yet-issued registration remains `null`; do not insert placeholders such as `N/A` into the canonical registration field.
- If the VIN is absent, invalid or conflicts with another source, preserve the submitted item in a non-operational staging/review path. It cannot create a canonical vehicle or delivery until identity is resolved.

## Commands and access

`recordSalesDelivery` accepts an explicitly selected existing vehicle ID or a proposed new vehicle identity, delivery date, optional purchaser claim, optional source reference and optional PDI observations. It takes a command ID and expected version where a delivery is being amended. It never accepts actor, organisation, site, canonical status, owner/payer links, PDI outcome or safety gate values from the caller.

At action time, the server requires active writable membership at the delivery site and a current, separate sales-delivery grant. A Sales role label alone is not authority. Vehicle, delivery, PDI observation, command receipt, domain event and outbox change commit together. Cross-site or cross-organisation IDs fail closed. Reads and history use scoped projections and sensitive-read auditing. Cross-site service-history visibility stays limited by `REV-011` until reviewed.

Corrections append a new attributed observation or a versioned delivery correction with a reason. Do not overwrite the original purchaser claim or PDI observation. Keep the original source and record timestamp available in vehicle history.

## First-use screen

Put **Record a delivery** under the **Vehicles** area in the short primary path. Open one guided form:

1. **Vehicle** — scan or enter the full VIN, then explicitly choose the existing vehicle or record a new one. Registration is optional.
2. **Delivery** — enter the delivery date and, if available, the purchaser name as reported at delivery.
3. **PDI notes** — add only observations supported by the supplied source form. Label them “Notes recorded” until approved PDI rules and authority exist; do not show a completion switch or green pass badge.
4. **Review and save** — show the VIN, optional registration, date, purchaser source label and observation count; explain any duplicate-VIN conflict in plain language.

After save, open a concise vehicle-history view with separate **Delivery**, **PDI notes**, **Service requests** and **Workshop jobs** sections. Users see only sections available to their site access. Avoid a sales dashboard full of unrelated metrics or fields; allow the person to record the delivery and return to the vehicle history in one flow.

## Tradeoffs

This model gives delivery and PDI corrections a clear version, actor, reason and replay behavior. It reuses existing command/audit/outbox infrastructure, keeps fields queryable, and makes purchaser non-inference and PDI boundaries explicit. Its costs are a delivery aggregate, migrations and correction commands, plus extra care when one command creates a vehicle and its first delivery atomically. The scope should remain limited to facts supported by the sales source; it must not become a second customer-management system.

## Rejected alternatives

- **Full event sourcing for vehicle and sales history:** rejected because VMMS already has relational canonical records plus an append-only domain-event ledger. Replaying every event to construct vehicle identity adds operational complexity without improving this first sales-entry workflow.
- **One mutable vehicle row with purchaser and PDI columns:** rejected because later deliveries and PDI observations would overwrite each other and lose source history. It also encourages a purchaser field to be mistaken for the current owner.
- **Generic JSON PDI checklist with pass/fail:** rejected until an approved, versioned PDI form and decision authority exist. Free-form observations preserve source facts without claiming technical approval.
- **Promote the workbook directly into canonical vehicles/deliveries:** rejected because historical purchaser claims, malformed VINs, missing registrations, uncertain site mapping and source conflicts need row-level review. Staging remains isolated until explicit promotion is approved.
- **A separate sales customer table or automatic identity matching:** rejected because it can duplicate the canonical party registry and incorrectly link purchaser, current owner and service payer.

## Design score

Score: 1 (weak) to 5 (strong) against the design-plan rubric. Higher is better; the score measures this candidate's fit, not implementation evidence.

| Criterion | Score | Reason |
| --- | ---: | --- |
| Unique canonical VIN | 5 | Organisation-level uniqueness, explicit selection, atomic conflict handling and no silent merge. |
| Purchaser non-inference | 5 | Purchaser-at-delivery is a typed source claim with no path to owner, client, payer or portal access. |
| PDI is not safety approval | 5 | PDI is observation-only; there are no pass, approval, gate or release fields. |
| Role/site authorization | 5 | Server-side current membership and separate grant are checked at action time; reads and writes are scoped. |
| Missing registration | 5 | Null registration is valid and does not block delivery capture. |
| Concise first-use UI | 4 | One guided flow and a focused vehicle history; VIN conflict review adds a necessary step for exceptional records. |
| **Total** | **29 / 30** | Strong fit; requires comparison with Candidate B before selection. |

## Open decisions and limitations

- Owner and management still need to approve the Sales role/grant mapping and whether Sales access is site-specific or shared across sites.
- The approved PDI source form and any later PDI completion authority remain pending. This candidate does not invent either.
- VIN correction authority and cross-site history access remain pending under `REV-028` and `REV-011`.
- Missing VIN and source-conflict staging must be reconciled with the existing historical-import pipeline before implementation.
- Compare this event-ledger aggregate with Candidate B's simpler append-only source-observation design. Do not implement or mark `USER-037` verified until the design review, owner decisions, authorization model and evidence plan are accepted.

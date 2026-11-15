# Sales delivery and PDI candidate B: staged records

**Status:** Candidate only. Not selected, implemented or approved for operational use. No live workbook or customer data was used.

## Problem

Sales delivery facts and PDI observations arrive at different points in the work and may be entered by different authorized staff. The design must connect them to the same canonical vehicle without treating the purchaser as the current owner or service payer, and without making a recorded PDI observation look like a safety approval. The accepted vehicle contract requires an organisation-unique, immutable canonical VIN and site-scoped history; authorization, identity correction and PDI procedure decisions remain gated by the review register.

## Usage

1. Sales opens **Record a delivery**, searches by VIN or scans one after choosing the scan action, then selects the exact canonical vehicle. If none exists, the staff member reviews the VIN and creates the canonical vehicle through a separate, explicit action before returning to the delivery form.
2. Sales records the delivery date and purchaser-at-delivery claim, with its source. They can leave registration blank. Saving records the delivery; it does not set an owner, service client, payer, warranty result, owner account, PDI outcome or workshop approval.
3. When supported by the supplied source form, an authorized staff member opens the saved delivery and adds one or more PDI observations. A staff member can return later to add another observation. The screen says **Add PDI observations** and **PDI observations recorded**; it has no “pass,” “complete,” “safe” or “approved” action.
4. After-Sales staff search the same canonical vehicle and see the attributed delivery and observations in its permitted site history. A later visit explicitly selects this vehicle. It does not create a second identity from the purchaser name, registration or a similar VIN.

## Shape

This is a staged record model, not a multi-section delivery form. Each step has its own permission, command, audit event and error recovery. The common vehicle resolver hides VIN search and duplicate handling; callers receive an explicit selected identity or a reason they must stop and resolve it.

```typescript
type CanonicalVehicleSelection =
  | { kind: 'existing'; vehicleId: UUID; confirmedVin: string }
  | { kind: 'created'; vehicleId: UUID; confirmedVin: string };

type RecordDelivery = {
  vehicle: CanonicalVehicleSelection;
  deliveredAt: Instant;
  purchaserAtDelivery: SourceClaim<string> | null;
  sourceReference: string;
  registrationAtDelivery: string | null;
};

type AddPdiObservation = {
  deliveryId: UUID;
  area: string;
  observation: string;
  sourceReference: string | null;
};

type VehicleHistoryEntry =
  | { kind: 'delivery'; deliveryId: UUID; vehicleId: UUID; recordedAt: Instant; recordedBy: StaffUserId }
  | { kind: 'pdi-observation'; deliveryId: UUID; observationId: UUID; recordedAt: Instant; recordedBy: StaffUserId };
```

`SourceClaim<string>` preserves who reported the purchaser name and the source. It is not a `PartyId`, owner relationship, client link or owner-access grant. A registration value is a delivery-time observation and may be `null`; it is not a vehicle identity key.

Suggested operations:

```typescript
resolveOrCreateCanonicalVehicle(scope, confirmedVin, identityFacts)
recordSalesDelivery(scope, commandId, deliveryInput)
addPdiObservation(scope, commandId, observationInput)
readVehicleSalesAndPdiHistory(scope, vehicleId, page)
```

The API derives organisation, site, actor and time of recording from the authenticated context. `resolveOrCreateCanonicalVehicle` requires the staff member to select an existing result or explicitly confirm creation; a database unique constraint and VIN serialization lock reject duplicate or concurrent creation. It returns no identity on an ambiguous match. The separate delivery command references only the canonical `vehicleId`; it never accepts a free-text VIN as a substitute for that reference. A 17-character VIN that cannot be verified, conflicts with an existing vehicle, or fails the canonical format remains unresolved. Nonstandard chassis identifiers need an approved identity policy before they can be linked as canonical vehicles.

Delivery and PDI observations are organisation/site scoped records linked to the canonical vehicle. Each write uses the existing staff-command contract: active membership and current permission check, expected aggregate version where the parent changes, idempotency receipt, append-only domain event and outbox item in one transaction. Corrections append a new attributed record and retain the earlier source. Site reads are audited. Cross-site history is denied until `REV-011` is resolved.

Permission checks are separate at each action: `sales.delivery.record` for the delivery and `pdi.observation.record` for an observation. They are server-side, site-scoped capabilities assigned through the approved role/grant configuration. A role label, manager status or staff account alone is insufficient. The exact role mapping remains unapproved; implementation and live use must stay unavailable until it is configured. Neither capability grants diagnosis, repair, inspection, technical completion, release, payment approval or owner access.

No PDI checklist, result vocabulary, “complete” flag or automatic follow-up deadline is defined here. Until an owner-approved PDI form and procedure exist, only source-backed factual observations can be entered. An empty observation list means **No PDI observations recorded**, not “PDI passed,” “PDI failed” or “PDI still required.”

## Rationale

Separating delivery from later PDI observations matches when the information becomes available and keeps the first Sales task short. The vehicle resolver owns the identity decision once; delivery and PDI commands then depend on the stable vehicle ID. This concentrates duplicate detection, site visibility, source attribution and permissions behind a small set of operations. The user interface exposes two record actions instead of asking a Sales user to complete unrelated fields before a delivery can be saved.

## Score against the design rubric

Scores are 1–5, where 5 means the candidate has a strong explicit control and 1 means it leaves the concern mostly open. Scores evaluate the design shape, not operational readiness.

| Criterion | Score | Evidence in this candidate | Remaining gate |
| --- | ---: | --- | --- |
| One canonical VIN | 5 | Explicit selection/create flow; delivery references a canonical vehicle ID; unique constraint and serialized creation reject duplicate VINs. Ambiguous or unverified identity cannot be linked. | Confirm how genuine nonstandard chassis identifiers fit canonical identity under `REV-028`/`REV-044`. |
| Purchaser is not inferred to be owner or payer | 5 | Purchaser is a source claim only. No party, client, owner relation, warranty decision or owner access is created from it. | Staff must select payer and owner separately in later workflows. |
| PDI is not safety approval | 5 | PDI stores source-backed observations only. No pass/completion state or G1–G5 transition exists. | Owner supplies and approves the form and procedure before checklist-based PDI work is built. |
| Role and site authorization | 4 | Every action is server-checked for current membership, explicit action permission and site scope; reads are audited. | Role/grant mapping and named authority configuration are not approved. |
| Missing registration | 5 | Registration at delivery is nullable and never used as a placeholder or identity key. | Any later canonical identity correction follows `REV-028`. |
| Concise first-use UI | 4 | Sales completes a short delivery step; PDI is a later, separate action with plain labels. | The staged handoff adds another screen and could feel slower when one person enters both records. Test with Sales and PDI staff. |

## Rejected alternatives

- **One long delivery-and-PDI form:** rejected because it mixes separate actors and different timing, delays saving a confirmed delivery, and makes a purchaser or PDI entry easy to mistake for owner or safety approval. It exposes more fields at first use.
- **A prebuilt PDI checklist with pass/fail and completion status:** rejected until the owner provides the approved form and procedure. It would invent technical criteria and could imply safety authority.
- **Promote the sales workbook directly into operational vehicles, owners and service clients:** rejected because workbook customer names are purchaser-at-delivery claims, some chassis values need review, and source data cannot establish current ownership or payer. Keep the workbook in restricted staging until its mapping is approved.
- **Create a separate vehicle history table duplicating deliveries and work orders:** rejected because it adds a second source of truth and reconciliation work. History should be a scoped read projection over canonical vehicle, delivery and observation records.

## Open questions and risks

- Which staff roles may create delivery records, and which may add PDI observations? Resolve the permission mapping before enabling either action.
- Which approved source form supplies PDI fields and required evidence? Until supplied, do not show checklist completion or safety status.
- What evidence and authority are required to register a vehicle whose VIN is missing, nonstandard or in conflict? Keep such records unresolved until `REV-028`/`REV-044` are settled.
- Is an organisation-scoped delivery visible at every service site, or only at its original site? Do not expand history visibility beyond the accepted site boundary while `REV-011` remains open.

## Synthesis status

This is Candidate B for cross-judging against a structurally distinct Candidate A. It is not the selected design. The synthesis must compare interface depth, duplicate handling, operational role timing and the authorized history boundary, then update the design plan and tracker through their single designated writer.

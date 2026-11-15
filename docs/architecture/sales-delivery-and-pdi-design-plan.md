# Sales delivery and PDI design plan

Status: selected design with a local implementation and real-browser workflow evidence; not launch-ready and no operational sale or PDI record has been created. Sales/PDI history reads now enforce the same Head of Service Centre, Sales Representative, and PDI Observer roles shown by the current Vehicles navigation. Wider workshop-role access is pending review under REV-049.

## User outcome

A sales staff member records a vehicle delivery once. After-Sales staff can then find the same vehicle and see the source-attributed delivery and PDI observations in its history. The purchaser-at-delivery remains a historical claim; the system does not silently set the current owner, service client, payer or owner-portal access.

## Caller flow

1. A staff member with the Sales role opens **Sales and deliveries**.
2. They search for the vehicle by VIN. If it already exists, they explicitly select it. Otherwise canonical vehicle creation and its first delivery save together in one transaction. A site can record only one initial delivery per canonical vehicle; the API command and database index reject duplicates.
3. They enter the delivery date and purchaser-at-delivery name as source observations. Current owner and service client remain separate facts and are not inferred.
4. They record only PDI observations supported by the source form available to them. Until approved PDI instructions and a controlled form are supplied, the system stores those entries as observations and cannot call the PDI complete, safe, passed or approved.
5. After saving, the vehicle history links to the delivery. A later visit selects the same canonical vehicle rather than creating a second VIN record.

## Domain boundaries

```typescript
type SalesDelivery = {
  id: UUID;
  organisationId: UUID;
  siteId: UUID;
  vehicleId: UUID;
  version: number;
  deliveredAt: Instant;
  purchaserAtDeliveryClaim: SourceClaim<string>;
  recordedBy: StaffUserId;
};

type PdiObservation = {
  id: UUID;
  deliveryId: UUID;
  area: string;
  observation: string;
  sourceReference: string | null;
  recordedBy: StaffUserId;
  recordedAt: Instant;
};

type SourceClaim<T> = { value: T; source: string; certainty: 'reported' | 'verified' };
```

PDI observations are not technical task completion, G1-G5 approval, a safety release, warranty confirmation, or owner/payer identity. Corrections append a new attributed entry and preserve the original. Vehicle VIN is organisation-unique; site-visible history is scoped and access-audited. Sales role access cannot change workshop records or create technical, inspection, release or financial grants.

## Design decision rubric

- One canonical vehicle identity, with explicit same-site selection and duplicate-VIN refusal.
- Preserve the delivery source, actor, instant, purchaser claim and PDI observation history without identity inference.
- Do not present PDI completion or safety status until approved instructions and form rules exist.
- Keep role and site checks on the server; a Sales placement grants only the intended record-entry action.
- Enforce sales/PDI history read roles on the server as well as hiding the navigation item; an active site membership alone is insufficient.
- Keep the first-use screen to one delivery flow and a concise vehicle-history view.
- Support missing registration and uncertain details without fake values or blocking unrelated fact capture.

## Architecture process

- [x] Ground in current vehicle, party, work-order, role and command patterns.
- [x] Produce two structurally different candidate designs and rationales.
- [x] Cross-judge the candidates against the rubric; select and record the synthesis.
- [x] Implement the initial delivery command, immutable PDI observations, role-scoped vehicle-history read and Sales screen. The history selection flow attaches PDI notes to an existing delivery rather than creating a duplicate delivery.
- [x] Complete the reasoned PDI correction path from the vehicle history screen. Corrections append through the same command and preserve the source note; vehicle identity changes remain separately gated under `REV-028`.
- [x] Verify PostgreSQL constraints, role/site denial, replay, duplicate-delivery refusal, append-only PDI correction and the real-browser responsive/accessibility journey. See [PDI correction evidence](../verification/sales-pdi-correction-2026-11-13.md).
- [x] Record this slice in the requirement, task tracker and verification evidence. `USER-037`, its parent BUILD/CHECK tasks and `E18` remain in progress until source imports, vehicle/delivery correction rules, role review and staff acceptance close.

## Known review gates

- Owner-provided PDI procedure/form and technical approval remain pending. No check list, pass result or safety sign-off is invented.
- Historical monthly sales rows remain in the restricted staging schema. They are not promoted by this workflow.
- Current service report identity review remains pending under `REV-047`; the conflicting VIN is not used to create a vehicle or delivery.
- Exact role-to-action mapping for `sales-representative` and `pdi-observer` must be reviewed before enabling operational writes. The design names do not grant technical or sign-off authority.

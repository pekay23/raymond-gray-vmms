# Customer identity and repeat visits

**Status:** Repeat-visit implementation remains in place. The 8 November 2026 business direction replaces the earlier proposed meaning of `customer` with three explicit roles: client/payer, reported vehicle owner and visit contact. The selected party model and workflow are defined in [work-order lifecycle and booking identity](work-order-lifecycle-and-booking.md). CRM implementation and verification remain in progress under `R-M-0054`.

## Problem

The initial reception command creates one generic customer row from the person entered at reception. That design does not distinguish the paying client, the vehicle owner and the person staff deal with during a visit. A person bringing a vehicle may be its owner, driver, delegate, recovery operator or another reporter. VIN matching alone cannot determine any of those roles.

## Caller contract

Reception can search the selected site for a VIN, explicitly select a vehicle already recorded at that site, and open another visit. Staff can explicitly reuse a same-site paying client, reported owner, and visit contact; each role is chosen independently, so one person may intentionally be selected for multiple roles without the system inferring role equality. Owner matches can be a person or organisation, while visit contacts must be people. The vehicle owner is recorded as a separate reported relationship when known. A new vehicle can be recorded with an unknown owner. Neither matching nor selecting a party verifies ownership or grants owner portal access.

```ts
type VehicleForVisit =
  | { kind: "new"; vin: string; registration: string; make: string; model: string }
  | { kind: "existing"; vehicleId: string };

type OpenVisit = {
  vehicle: VehicleForVisit;
  client: PartySelection;
  vehicleOwner: ReportedOwnerSelection | null;
  visitContact: VisitContactSelection;
  odometerKm: number;
  socPercent: number | null;
  complaint: string;
};
```

The API derives actor, organisation and site from the authenticated membership. It checks that an existing vehicle and each selected party have a record at the selected site, and validates the role-specific party type at command time. Party lookup only includes parties already used at that site in any role. It does not search the organisation-wide directory or expose other-site matches. New VIN creation retains the organisation-level lock and unique constraint. A VIN already used elsewhere in the organisation produces a generic conflict without revealing the other site's record. The work order records the client party as the party that pays. The visit records the person staff deal with. Owner information is a separate evidence-state relationship and cannot grant owner portal access.

## Decision and alternatives

### Earlier slice: reception contact plus explicit vehicle reuse

This safe first slice enables repeat visits at the first service centre while preserving current work-order projections and the existing vehicle association. `vehicles.customer_id` became nullable; null means no customer association is recorded, not that the vehicle has no owner. Existing associations are never changed by intake. The new party-role model extends this slice without changing its site-local lookup boundary.

### Current target: canonical party and role registry

Represent people and organisations as canonical parties. Record the paying client on the booking, the visit contact on the visit, and the vehicle owner as a separately versioned reported relationship with provenance. Do not auto-merge identities or infer ownership, authority or communications consent. Keep historical role unknown when the source does not establish it. The implementation sequence and remaining approvals are in [work-order lifecycle and booking identity](work-order-lifecycle-and-booking.md).

### Rejected: keep duplicate-VIN rejection

This avoids changing a vehicle association but prevents a previously recorded vehicle from receiving another visit through reception.

## Boundaries and open decisions

- `owner-access` remains a separate evidence-backed approval capability. VIN, visit contact, name or phone matching cannot approve or invite an owner.
- Search is limited to vehicles with a visit at the selected site. Cross-site lookup and record visibility require a decision under `REV-011`.
- The intake UI permits explicit party reuse and retains selected owner/contact IDs in saved drafts. A changed role detail clears that selection and creates a new party on submission. Staff must not silently merge records. Cross-site lookup remains closed under `REV-011`.
- The master specification's organisation/contact model, owner-history lifecycle, communications preferences and client code setup remain incomplete. Keep `BUILD-R-M-0054` in progress until these are implemented and verified.
- `REV-008` controls the required reception fields, custody acknowledgement and retention policy. `REV-011` controls owner/delegate proof and cross-site privacy. Neither is inferred by this slice.
- Historical maintenance activity/customer/vehicle data import is deferred under `REV-016` until the owner supplies an inventory, data list and completion-status mapping.

## Verification evidence

Verification covers new vehicle intake creating no customer-on-file link; distinct payer, reported owner and visit contact projections; repeat use of site-local owner and contact records; rejection of cross-site party selection; unchanged vehicle association; idempotent command replay; and no owner-access grant from party reuse. The browser flow additionally exercises same-site reuse of client, vehicle, owner and visit contact. Cross-site party visibility approval under `REV-011` remains pending.

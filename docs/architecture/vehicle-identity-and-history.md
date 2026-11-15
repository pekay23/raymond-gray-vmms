# Vehicle identity and visit history

**Status:** Site-scoped identity enrichment and history selected for implementation. Cross-site history remains open under `REV-011`; identity correction authority is open under `REV-028`.

## Requirement

`master-0054` calls for vehicle VIN, registration, model, variant and powertrain, with history. `master-0129` requires canonical vehicle identity and VIN uniqueness. The repeat-visit flow already gives each vehicle one canonical VIN and allows multiple visits without rewriting its customer association.

## Contract

- Keep VIN organisation-unique and immutable after creation. The VIN lock and unique constraint remain the final duplicate barrier.
- Capture variant and powertrain when known. Unknown or unavailable values remain `null`; reception does not guess or derive a powertrain from a model label.
- Show canonical vehicle identity on each work order.
- Show visit history only for this vehicle at the currently selected service site. Include work-order reference, visit date, registration snapshot, odometer, SOC and recorded customer concerns. Do not include another site's history or owner-access data.
- History is a read projection over the canonical visits, work orders and complaint records, not a second source of truth.
- Keep vehicle relationship reports and owner portal authorization separate. This slice does not identify an owner, infer ownership changes or enable owner data publication.

## Alternatives considered

### Selected: canonical optional identity fields plus a site-local history projection

This provides the exact vehicle attributes named in the specification and gives advisors same-site repeat-visit context using existing canonical records. It adds no duplicate history store and respects the unresolved cross-site access boundary in `REV-011`.

### Organisation-wide history at every site

This would give a full vehicle timeline, but `REV-011` has not established cross-site visibility or who may access another site's customer/vehicle history. Defer until approved.

### Separate history snapshots on each work order

This duplicates visit and complaint records, risks stale copies and creates reconciliation rules without a requirement. Keep history as a projection instead.

## Boundaries and follow-up

- Vehicle identity fields currently have no staff correction workflow. Do not add casual edits or overwrite provenance. A future identity-revision command needs a named authority, correction reason and cross-site propagation rule under `REV-028`.
- Customer/person/organisation/contact history remains a separate `R-M-0054` slice. The visit contact is not a verified vehicle owner or owner-account identity.
- Owner-access lifecycle remains evidence-backed and site-scoped. No vehicle history endpoint is added to the customer portal.
- Historical customer and service records remain deferred under `REV-016` until the owner supplies an inventory and source-status mapping.

## Verification

Verify new and legacy vehicles project nullable variant/powertrain safely; intake persists supplied values; repeated visits add history rows without changing vehicle identity; history excludes another site; and owner-access state and the all-pending intake gates do not change.

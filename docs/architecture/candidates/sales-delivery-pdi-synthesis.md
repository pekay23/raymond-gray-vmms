# Sales delivery and PDI design synthesis

**Status:** selected engineering design for `USER-037`; operational role mapping and source procedures remain review gates.

## Decision

Use Candidate B's staged workflow: record a confirmed delivery first, then append factual PDI observations when an approved source is available. Graft in Candidate A's transactional boundary so creation of a new canonical vehicle and its first delivery either both commit or neither does. A PDI observation is never a PDI pass, completion, safety clearance, technical sign-off, or release.

The flow is intentionally narrow:

1. A staff member explicitly selects an exact existing VIN or records a new canonical vehicle and delivery in one transaction.
2. The delivery stores its date, optional registration-at-delivery, purchaser-at-delivery claim, and source.
3. An authorized staff member can later append source-backed PDI observations. Corrections retain the earlier fact and add a reasoned record.
4. Same-site After-Sales users can find the canonical vehicle and its permitted history. A later visit selects that same vehicle.

Purchaser-at-delivery is not converted into current owner, service payer, client, visit contact, warranty decision, or owner portal access. The 133-row monthly sales workbook remains restricted to staging pending row-level scope and identity review. No rows are promoted by this workflow.

## Cross-judge

The independent cross-judge scored Candidate A at 29/30 and Candidate B at 28/30. Candidate B was selected because separate delivery and later PDI actions match the timing and keep initial entry simple. Candidate A's strongest controls are grafted in: atomic vehicle-plus-delivery creation, explicit unresolved VIN handling, duplicate conflict rather than fuzzy merge, and source-preserving correction history.

| Criterion | Candidate A | Candidate B | Selected control |
| --- | ---: | ---: | --- |
| One canonical VIN | 5 | 5 | Exact selection, org-wide uniqueness, no silent merge |
| Purchaser not inferred as owner or payer | 5 | 5 | Historical source claim only |
| PDI is not a safety approval | 5 | 5 | Append-only observations; no outcome field |
| Role and site authorization | 5 | 4 | Server-side action checks and site scope; exact role mapping remains pending |
| Missing registration | 5 | 5 | Nullable; no placeholder |
| Concise first use | 4 | 4 | Save delivery before later PDI entry |

## Rejected designs

- Do not create a canonical vehicle in a separate committed step before its delivery. This can leave an orphan identity when delivery capture fails.
- Do not infer a vehicle from a partial VIN, registration, purchaser, model, or similar record. A unique conflict requires staff review.
- Do not add PDI pass/fail, completion, safety, approval, or release fields until the owner provides an approved PDI form and procedure with the responsible authority.
- Do not create a separate sales customer registry or infer owner, payer, service client, or portal access from the purchaser name.
- Do not promote historical sales rows or expand cross-site history while their review gates remain open.

## Authorization and review gates

The design requires separate, server-enforced actions for recording delivery and adding PDI observations. The proposed role placement names are **Sales Representative** and **PDI Observer**; their exact mapping and who may assign them must be reviewed before operational use. Existing separation of VMMS Operator account management from Head of Service Centre staff-role assignment remains in force. These role names grant no technical, inspection, release, financial, or governance authority.

Still open:

- Owner-provided PDI form, procedures, evidence, and responsible role.
- Exact role-to-action mapping for sales delivery and PDI note entry.
- Evidence and authority for nonstandard, missing, or conflicting vehicle identifiers (`REV-028`/`REV-044`).
- Cross-site history permissions (`REV-011`).
- Site and staff access, date exceptions, and promotion approval for the staged sales workbook (`REV-044`).

The current the source-report customer report is not admitted as a work order. Payer is confirmed; the report VIN conflicts with the sales workbook, and the physical vehicle or its documents must confirm the VIN first (`REV-047`).

## Review evidence

- Design plan: [sales delivery and PDI](../sales-delivery-and-pdi-design-plan.md)
- Candidate A: [versioned delivery and event ledger](sales-delivery-pdi-candidate-a.md)
- Candidate B: [staged delivery and PDI entry](sales-delivery-pdi-candidate-b.md)
- Cross-judge conclusion: Candidate B as base, with atomic creation and source-correction controls from A.

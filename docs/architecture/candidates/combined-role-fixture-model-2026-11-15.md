# Combined-role fixture model synthesis

**Status:** Selected for the local synthetic role fixture, schema version 2.

## Caller shape

One synthetic staff persona has one account and one OIDC identity. Its `placements` list contains one or more active roles. Each placement has a role code and a nullable parent reference made from the parent persona key and parent role code. Stable database IDs derive from the persona-role pair. The owner identity remains separate from staff.

```json
{
  "key": "ev-lead",
  "placements": [
    { "roleCode": "ev-team-lead", "reportsTo": { "personaKey": "head", "roleCode": "head-service-centre" } },
    { "roleCode": "technician-engineer-trainee", "reportsTo": { "personaKey": "supervisor", "roleCode": "supervisor" } }
  ]
}
```

## Candidates and decision

- **Candidate A (selected):** Keep placements nested under each staff persona and identify a parent by persona plus role. This is the smallest change from the existing persona-first manifest and avoids duplicating identity details.
- **Candidate B (rejected as the base):** Normalize all role placements into a top-level list with their own keys and a parent placement key. This is useful if placements later gain independent identity or lifecycle metadata, but adds a separate key namespace and a second manifest collection without that current need.

The independent cross-judge selected Candidate A. The implementation grafts Candidate B's explicit parent-placement existence checks and reporting-cycle rejection. It also rejects duplicate role codes for one persona and prevents the Operator from being either inside the reporting chain or a reporting parent.

## Verification and limits

Four focused manifest/seed-contract tests pass, including combined roles, distinct reporting lines, missing parents, duplicate placements, Operator separation and cycles. The API typecheck passes. Manifest version 2 has not been applied to a saved database or identity provider; runtime login and workspace behavior remain unverified. Existing version 1 fixtures must stop safely on manifest drift.

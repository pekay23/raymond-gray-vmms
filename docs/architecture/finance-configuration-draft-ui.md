# Finance configuration proposal workspace

**Status:** Implemented and verified against disposable PostgreSQL and browser fixtures. The page records non-effective proposals only.\
**Requirement:** `USER-044`\
**API owner:** `apps/api/src/finance-configuration.ts` and the existing site-scoped read/save routes.

## User flow

1. A staff member opens **Finance setup** from the selected site workspace.
2. The page requests the authorized, paginated proposal list. A read grant provides read-only access; a manage grant also permits creating or revising proposals. With no current grant, the page explains that access has not been assigned.
3. A manager starts a proposal or opens its current revision. Earlier revisions remain available to inspect but cannot be edited.
4. The manager enters proposal values, adds a reason for the revision, and saves. A new proposal uses a new UUID and `expectedRevision: 0`; a revision uses the current displayed revision number.
5. The server checks the current grant and expected revision again. A conflict refreshes the list and asks the user to reopen the latest revision.

## API response additions

```ts
type FinanceConfigurationDraftListItem = FinanceConfigurationDraftRevision & {
  isCurrent: boolean;
};

type FinanceConfigurationDraftList = {
  items: FinanceConfigurationDraftListItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  canManage: boolean;
};
```

`canManage` is derived from the current site-scoped grant while the API holds the existing grant lock. `isCurrent` is derived from whether a later immutable revision exists for the same draft. Neither value is accepted from the browser. The list route still returns 403 without an active read or manage grant, and the save route rechecks manage permission independently.

## Browser module boundary

- `apps/web/src/pages/finance-setup.tsx` owns the page state, accessible proposal form, paginated list, current-revision selection and save feedback.
- `apps/web/src/api.ts` owns strict response/request schemas and derives the browser types from them.
- `apps/web/src/workspace-navigation.ts` controls whether a staff session may open the route. Navigation is discoverability only; it does not grant Finance access. The API remains authoritative.
- `apps/api/src/finance-configuration.ts` remains the source of authorization and immutable history. It derives `canManage` and `isCurrent` for the read model.

The form groups the existing contract fields into business identity, currency and policy references, invoices and receipts, payment evidence and guarantees, email and client contact, records and corrections, and source references. Labels use plain language while preserving field meaning. Blank optional proposal fields serialize as `null`; no guessed policy values are inserted.

## Safety and failure states

- Every item and revision is labeled **Proposal only — not approved or in use**.
- A successful save remains `state: draft-only` and `operationallyEffective: false`.
- The page contains no approval, publication, invoice, payment, receipt, email, or vehicle-release action.
- Read-only users see no editor. Users with no Finance grant see a clear access-required message without proposal data.
- Offline, loading, empty, validation, server, stale-revision, and save-success states are visible and accessible.
- Credential-like values are rejected by the server; real credentials are never stored in the proposal registry.

## Alternatives considered

1. **Chosen: enrich the existing paginated list response.** It already requires a current Finance read/manage grant. Returning the server-derived edit flag and current-revision marker avoids a separate permission endpoint and prevents role-label guessing.
2. **Separate Finance access bootstrap endpoint.** This can hide the list request until permissions are known, but adds another endpoint and a permission-to-list race while the existing list already authorizes access. It does not remove the required authorization on list or save.

The chosen design keeps one authorization boundary for the page's read model and leaves save as its own command boundary.

## Verification boundary

Use disposable PostgreSQL and synthetic grants to verify no grant, read-only, manage, revoked and expired access; site isolation; current versus prior revisions; pagination; expected-revision conflict; credential-pattern rejection; and draft-only responses. Browser checks cover keyboard use, accessible field errors, responsive states and clear denial for unauthorized staff. This does not approve Finance policy or prove invoice/payment/receipt/email/G5 behavior.

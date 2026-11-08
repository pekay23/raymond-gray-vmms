# Portal entry and audience access

Use `vmms.raymond-gray.org` as a service portal. The public root should explain whose portal it is and provide the appropriate sign-in route. Keep detailed marketing, company history, service promotion and search-oriented content on the main company website. A public marketing site and an operational staff application have different navigation and access needs.

## First release

Show Raymond Gray identity, the title Service centre portal, and a main Sign in to VMMS heading. The owner explicitly included approved vehicle owners in the launch scope. Provide clear staff and vehicle-owner access through working authentication and relationship permissions. The generic heading must not imply that an unfinished customer backend works. The first engineering slice may exercise staff access, but launch requires the owner portal and its tests.

Use the existing logos, icons and browser tab assets from the Raymond Gray main project as directed by the owner. Record copied asset paths and check light/dark use, sizing and tab rendering. Provide an official-company-site link once its destination is confirmed. Display a support contact only after an approved contact is configured. Do not invent a phone number, legal entity, service promise or system-availability claim.

There is no public self-registration or anonymous work-order search. The page does not expose WIP counts, vehicle registration, VIN, customer names or staff records. Authenticated staff go directly to their authorised work area and current site. An expired session returns them to sign-in with an honest reason and safe return path.

## Audience scope

| Audience | Entry and permitted purpose | Excluded by default |
| --- | --- | --- |
| Staff | Individual staff sign-in, site-scoped operational queues and named capabilities | Another site's records without membership; technical/financial authority inferred from role |
| Client organisation, later workstream | Invited dealer/fleet/account contact views explicitly linked vehicles, requests, agreed estimates, payer documents and service history | Other client organisations, internal diagnosis discussions, employee competence, internal payer disputes and unrestricted exports |
| Vehicle customer, launch scope | Invited or explicitly approved vehicle owner views approved status updates, customer-facing estimates/consent, invoices and handover documents as those workflows become available | Another owner's vehicle, previous owner's personal information, internal warranty allocation and staff records |

A contracting client, vehicle owner, driver and payer are different relationships. Do not use one `customer` flag to represent them all. Customer/vehicle ownership and delegated client access require time-bounded relationship records, approval/revocation and audit. A shared phone number, email address or registration is not sufficient proof of access.

The launch root supports staff and approved vehicle-owner access. It may offer two labelled routes or one common sign-in followed by an authorised workspace choice; the server must determine actual access in either case. Business-client access can join later. One identity holding several legitimate relationships chooses a permitted workspace after authentication; a hidden menu never substitutes for server authorization.

The owner identity, relationship lifecycle, tenant/site scope, publication allowlist and required privacy checks are specified in [`vehicle-owner-access.md`](vehicle-owner-access.md). Keep the owner route disabled until its API, document, invitation, browser and management-approval tasks pass.

## Booking and public service information

A public request-a-service link can point to a separately reviewed booking flow. The old portal audit identifies a vehicle-services booking integration, but its live caller and destination must be confirmed before linking or preserving it. A public request remains untrusted input until staff receive and triage it. It cannot create technical authority, expose a customer's existing records or imply an approved appointment/cost.

## Decisions and tasks

The initial staff entry is part of the web foundation. The approved vehicle-owner portal is an explicit launch requirement. It needs relationship permissions, identity/invitation policy, consent presentation, privacy review and browser/API tests before its link appears. Business-client account access is a later workstream. The public root's support and website destinations remain owner-review items.

Check account enumeration, rate limits, reset/invitation expiry, cross-client access, ownership transfer, revoked delegates, downloadable documents and shared-device sign-out before enabling external accounts. Current staff-only tests do not prove customer-portal safety.

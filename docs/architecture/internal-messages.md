# Internal staff messages

**Status:** first-slice implementation contract. This does not approve message retention or external delivery.

## Audience and boundaries

- The Head of Service Centre / Operations Admin can send an in-app message to explicitly selected, active staff accounts at the same site.
- A message may be linked to a work order at that same site. Selecting recipients does not grant them any other work-order permission.
- Only the sender and named recipients can read a message. Staff membership is checked on every request. Vehicle owners, clients and other external identities have no access.
- Message text and recipients are immutable after sending. A recipient can record a one-way read receipt; they cannot clear or change it.
- This slice has no attachments, group-wide broadcast, edit/delete, cross-site access, email, SMS, WhatsApp or push delivery.

## API contract

All routes use the current staff session and site scope. Commands require CSRF and a UUID `Idempotency-Key`.

| Method and route | Access | Contract |
| --- | --- | --- |
| `GET /api/v1/sites/:siteId/staff/messages?page=1&pageSize=25` | Active staff membership | Returns `{ canSend, items, page, pageSize, totalCount, totalPages }`. It includes only messages sent by the current user or addressed to them. Results are newest first. Reads are metadata-audited; message text is not copied into the audit record. The route sets `Cache-Control: no-store`. |
| `POST /api/v1/sites/:siteId/staff/messages` | Writable membership, active Head of Service Centre role, and `STAFF_MESSAGES_ENABLED=true` outside production | Body: `{ recipientUserIds: UUID[], workOrderId: UUID|null, body: string }`. Require 1–50 distinct active site staff recipients, exclude the sender, and require 1–5000 non-whitespace characters. Empty recipient arrays are invalid. The server returns the created message item. |
| `POST /api/v1/sites/:siteId/staff/messages/:messageId/read` | Active named recipient | Body is empty. Adds one read receipt for the current user. A repeated read returns the original receipt and creates no duplicate event. |

Each message item has `{ id, senderUserId, senderName, recipients, body, workOrderId, workOrderReference, createdAt, readAt }`. Each recipient item has `{ userId, displayName, readAt }`. A recipient sees their own recipient row and `readAt`; the sender sees every named recipient and their receipt time. Other recipients do not see each other's receipt time. The `canSend` flag is true only for a current Head of Service Centre when `STAFF_MESSAGES_ENABLED` is enabled. The browser never enables sending on its own authority.

The API never accepts actor, organisation, site, sender, recipient identity state, or message timestamp from the browser. The server derives these from session and site membership. A work-order link is checked under the same organisation and site before commit.

## Persistence

Use a message root and recipient rows, each scoped by organisation and site. Enforce the site-scoped work-order foreign key, active staff membership at send time, unique `(message_id, recipient_user_id)` recipients and unique one-way read receipts. Lock recipient membership rows in stable user-ID order while sending, synchronized with membership deactivation. Force row-level security for runtime access and restrict it to the current sender/recipient; site-only RLS is insufficient. Add a membership activation epoch and snapshot it on messages/recipients so a reactivated employee cannot see messages from a prior membership period. The message body and recipient set are append-only. Sender, recipients and message content are committed together with the aggregate event, idempotency receipt and outbox item. The outbox records the internal event only; no delivery adapter is enabled.

Reads are audited with count and context metadata; do not retain search/body terms. API responses containing message text use `Cache-Control: no-store`. Audit events and read receipts retain actor and timestamp. Existing rows remain subject to the retention rule once REV-042 has an approved value. `STAFF_MESSAGES_ENABLED` defaults to false, cannot be enabled in production before REV-042 approval, and must be explicitly enabled in development/test to exercise sending.

## Verification boundary

Local verification uses synthetic accounts and a disposable PostgreSQL database. It must prove Head-only sends, explicit-recipient visibility, read receipt idempotence, same-site work-order validation, current-membership checks, cross-site denial, immutable message content, transaction rollback and no outbound notification. Browser coverage must exercise sender and recipient views at phone, tablet and desktop sizes with keyboard and screen-reader labels. This evidence does not prove retention approval, production identity, staff acceptance or external delivery.

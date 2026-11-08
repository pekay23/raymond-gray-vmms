# Platform and offline strategy

Hosting provider decision: follow [`hosting-strategy.md`](hosting-strategy.md). Cloudflare is the provisional edge/web default, not a blanket Workers requirement. The VMMS API, Next.js applications and shared Keycloak service retain per-service runtime gates until verified.

Build the browser application first and host it at `vmms.raymond-gray.org`, subject to domain-owner configuration. The name is clear, matches the product, and keeps the public company website separate from staff operations. `service.raymond-gray.org` is a reasonable alternative if the product name changes, but changing to a broader name adds no launch benefit. Keep customer-facing booking on a separately reviewed route or hostname. Do not expose the staff application's records through a public booking API.

The owner confirmed that the first site usually has reliable internet and that computers and tablets will be procured later. Start with one cloud-authoritative database and responsive staff workflows. Support additional sites in the model from the first migration. This is a production architecture decision, not a claim that deployment or devices have already been validated.

## Sequence

| Stage | Staff experience | Data authority | Exit evidence |
| --- | --- | --- | --- |
| Web launch | Responsive browser on existing computers and phones | Cloud PostgreSQL | Signed pilot, server-side gate tests, browser and restore evidence |
| Installable web app | Home-screen or dock launch, cached static shell, saved drafts | Same cloud API | Installation and draft-recovery checks on actual target browsers |
| Site devices | Managed shared iMacs, Windows PCs and tablets, each employee signs in individually | Same cloud API | Camera, scanning, print, accessibility, lock and account-switch checks |
| Optional native packages | Desktop bridge or mobile package only where hardware or distribution demands it | Same cloud API and command contracts | Signed package, secure token store, update and device-specific tests |
| Optional offline site service | Only if measured outage costs justify operating a local service | Explicitly designed site command authority with cloud reconciliation | Conflict, lease expiry, outage, backup and recovery drills |

Do not create a separate Windows database and a separate web application at launch. That would introduce multi-writer reconciliation before it solves a demonstrated operational problem. Develop locally on Windows, deploy the server to a managed Linux environment, and use the same staff web app across site equipment.

## Device support is a test matrix

| OS | First delivery route | Native route if justified | Required evidence |
| --- | --- | --- | --- |
| Windows | Edge or Chrome browser/PWA | Evaluate Tauri for local printing, serial or diagnostic bridges | Supported Windows version, installation, camera, printing, account lock |
| macOS and iMac | Safari web app or Chrome browser/PWA | Evaluate Tauri with signed and notarised app | Actual macOS and Safari versions, camera/print, update recovery |
| iOS and iPadOS | Safari browser and home-screen web app | Evaluate a mobile package with camera/scanner and managed distribution | Real-device storage, suspension, camera, touch, accessibility and account switching |
| Android | Chrome or managed browser/PWA | Evaluate native package only for measured platform needs | Real-device offline storage, camera/scanner, printing and updates |
| HarmonyOS | Browser first, exact OS/browser version recorded | Separate ArkTS/ArkWeb investigation if native distribution is required | Test Huawei device; do not assume Android package compatibility |
| Linux and other OSs | A supported standards-compliant browser | Case-by-case, no unsupported native promise | The same critical workflow suite on the actual browser |

Apple documents [Safari web apps on Mac](https://support.apple.com/en-ie/104996) and [home-screen web apps on iPhone](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/27/ios/27). Huawei documents [ArkWeb's separate web-component runtime](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/web-component-process/). These establish available delivery routes. They do not establish that VMMS has passed on those devices. Native packaging decisions remain conditional until hardware and workflow evidence exist.

## Saved drafts

A draft is unsubmitted work, visibly labelled as stored in this tab and with its save time. It is not a work-order number, stock movement, consent, authority, invoice, or release. It receives a stable local draft ID. Submission uses a distinct server command ID and the latest server version; a rejected or conflicting submission retains the draft for the author to resolve.

Until the shared-device policy is approved, persist only after the user explicitly chooses **Save in this tab**. After that opt-in, later field edits update the same draft immediately. Store it in `sessionStorage`, scoped by authenticated person and site; closing the tab ends its normal lifetime, and sign-out or site switching clears the accessible records. Browser session restoration can vary, so an approved retention limit and physical-device checks remain required before rollout. Browser storage may be evicted and is never the only record of a committed transaction. Display storage failures and pending submissions instead of claiming that a save succeeded.

The service worker may cache versioned static assets. It must not generically cache authenticated API responses or replay mutating requests. No service worker or local draft may approve scope, certify competence, issue parts, post payment, technically release a vehicle, or close a job offline.

## If full sync becomes necessary

Write a separate accepted design before implementation. Classify each command as draft-only, online-required, or explicitly delegated offline. Record a device ID, authenticated actor, operation UUID, payload fingerprint, expected aggregate version, policy version, local sequence and server receipt. Keep an append-only outbox and a reviewable conflict inbox.

The server rechecks membership, current privilege, scope, equipment and holds at commit time. Revoked or expired grants do not remain valid because a device was offline. Safety and financial transitions use the latest server state. Resolve conflicts by domain rule or named reviewer, never timestamp-based last-write-wins over stock, money, approvals or release.

Evaluate a site-local service only if several workers must transact throughout long outages. Such a service needs deployment, power protection, backups, a site authority model and revocation behavior. It is a distinct operating commitment, not a free feature of a desktop wrapper.

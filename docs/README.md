# Raymond Gray VMMS documentation

This folder is the project record for the new Raymond Gray Vehicle Maintenance Management System. Start with the [implementation plan](delivery/implementation-plan.md) and [system design](architecture/system-design.md). Agents must follow the accepted decisions, update the tracker, and attach evidence before marking work complete.

## Authority

1. The user's explicit instructions and later approved decisions.
2. The [master functional specification](sources/master.md), with the original DOCX retained alongside it.
3. The [upgrade implementation prompt](sources/upgrade.md) where it is compatible with the above.
4. Accepted architecture decisions and the implementation plan.
5. Existing code and reference applications as evidence, not requirements.

`USER-001` authorises a new implementation rather than the documents' in-place upgrade. It does not authorise deleting records or replacing the existing live portal. Preserve source IDs and audit histories if records are migrated.

The source manifest contains SHA-256 hashes. `scripts/extract-specifications.py` regenerates paragraph and table-row references without changing the original documents. Source references such as `master-0070` are stable for these exact input versions.

## Read by purpose

| Purpose | Document |
| --- | --- |
| Architecture and contracts | [System design](architecture/system-design.md) |
| Google, passkeys, passwords and approved access | [Authentication design](architecture/authentication.md) |
| Shared sign-in across Raymond Gray products | [Shared identity architecture](architecture/shared-identity.md); standalone service at `C:\Projects\raymond-gray-auth` |
| Private attachments, scan quarantine, access and backups | [Evidence storage design](architecture/evidence-storage.md) |
| Devices, offline, and domain | [Platform strategy](architecture/platform-strategy.md) |
| Cloudflare/Vercel and per-service runtime selection | [Hosting strategy](architecture/hosting-strategy.md) |
| Public landing page and audience access | [Portal entry](architecture/portal-entry-and-audiences.md) |
| Brand assets and generated background | [Visual asset record](architecture/visual-assets.md) |
| Historical maintenance backlog | [Import plan](architecture/historical-import.md) |
| Delivery sequence and completion gates | [Implementation plan](delivery/implementation-plan.md) |
| All tasks | [Task data](delivery/tasks.json) and generated [tracker](delivery/implementation-tracker.md) |
| Requirement traceability | [Requirements](requirements/README.md) and [requirement data](requirements/requirements.json) |
| Business choices awaiting review | [Review register](decisions/review-register.md) |
| Original source documents | [Manifest](sources/manifest.json), [master](sources/master.md), [upgrade](sources/upgrade.md) |
| Reference application audit | [Portal audit](discovery/legacy-portal-audit.md) |
| Borrowed patterns and graph tools | [Reference review](discovery/reference-patterns-and-tooling.md) |
| Verification evidence | [Verification record](verification/README.md) |
| Local setup and operations | [Development guide](guides/development.md) |
| Decisions and progress | [Run plan](delivery/run-plan.md), [decision trail](delivery/decisions.tsv) |

The JSON requirement and task records are canonical. Human-readable trackers are generated from them. Architecture decisions define implementation policy; review items explicitly marked pending do not constitute management approval.

# Working on Raymond Gray VMMS

Read `docs/README.md`, `docs/architecture/system-design.md`, `docs/delivery/implementation-plan.md`, and the affected entries in `docs/requirements/requirements.json` and `docs/delivery/tasks.json` before implementation. If a named document has not yet been written, consult `docs/delivery/run-plan.md` and finish the design rather than guessing its contents.

The user's greenfield instruction overrides source-document directions to upgrade in place. The master specification's functional, safety, evidence, and data-preservation requirements remain binding. The old portal is a reference. The user later authorised use of its available database and deployment configuration when necessary. Inspect only required configuration without printing secrets, prefer an isolated VMMS database/namespace and credentials, and prepare a reviewable deployment before external changes. Do not modify unrelated portal source or deploy over it.

## CodeGraph

In repositories with a `.codegraph/` directory, use `codegraph explore` before grep, find, or reading code to locate or understand symbols. Name a file to inspect its current source. Check for stale-index warnings. Run `codegraph sync` after changes and use `codegraph affected` to select relevant checks. If the graph is absent, use `rg`; do not initialise other repositories without the user's request. This repository is authorised for indexing.

Use `docs/discovery/reference-patterns-and-tooling.md` for Graphify. Prefer local deterministic code analysis. Do not send customer records, staff data, credentials, or private source to a model-backed graph builder. Graphs help locate evidence; they never replace reading the owning code or running checks.

## Implementation rules

- Keep canonical customer, vehicle, work-order, and financial records in one server-owned model. Partition every business query by authenticated organisation and site.
- Separate role labels from signed technical, inspection, release, governance, and financial grants. Test grants at action time and retain decision snapshots.
- Enforce G1 through G5 independently on the server. Diagnostic consent does not authorise repair. Safety holds and required independent inspection cannot be bypassed.
- Treat draft SOPs and unknown historical approvals as draft or unknown. Never manufacture authority, technical HV procedures, tax rates, monetary limits, payer terms, or management approval.
- Use command-specific server operations for safety and commercial transitions. Persist the mutation, audit event, idempotency receipt, and outbox item atomically. Reject stale versions.
- Build accessible, responsive workflows for named staff. Show why an action is blocked and the next permissible action. Show loading, empty, failure, conflict, and offline states.
- Preserve the approved Raymond Gray branding and workshop-image baseline. The user requires explicit approval before new artistic expressions or visual-direction changes. Prepare separate concrete concepts for review first. Functional accessibility, authentication, responsive adaptation and aspect-ratio variants may proceed within the existing direction.
- Assign agents disjoint files or worktrees. Keep one writer for shared trackers and migrations. Review their actual artifacts before integrating.
- Add tasks discovered during work. A task is done only when its acceptance criteria have evidence. Update requirement status independently from task status. Passing a build does not complete UAT.
- Keep documents in `docs/`. Put unresolved choices in `docs/decisions/review-register.md`. Append material choices to `docs/delivery/decisions.tsv`.
- Run relevant unit, API, database, browser, and security checks for the changed behavior. Record failures and untested platforms honestly. Do not label SQLite-only tests as PostgreSQL concurrency proof.
- Leave production data, DNS, paid resources, store publishing, and real notifications untouched until their exact change is reviewable and authorised.

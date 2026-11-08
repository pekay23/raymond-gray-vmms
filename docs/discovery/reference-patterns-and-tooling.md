# Reference patterns and local graph tools

Reviewed on 7 November 2026. The reference repositories were inspected without changing their files or reading environment secrets. These findings concern checked-out code and documentation, not production behaviour. CodeGraph was used before locating code in Smart POS because that repository has a `.codegraph` index.

## Smart POS findings

The existing POS has two distinct implementations. Its Windows client uses Tauri, React, Rust, and SQLite. Its hosted browser client uses React and a Rust API backed by PostgreSQL. Root `README.md` and `apps/api/README.md` describe the hosted product as incomplete. `apps/web/README.md:3` explicitly lists durable offline sync among the missing capabilities. Its planned outbox is an idea to evaluate, not a working sync component to transplant.

The repository has no commit at `HEAD` and the inspected files appear as untracked files in `git status`. File and symbol references below identify this local snapshot. They cannot be pinned to a reference commit.

Patterns worth implementing independently in VMMS are:

| Pattern | Current source evidence in `C:/Projects/smart-pos-rebuild` | VMMS use |
| --- | --- | --- |
| Atomic business mutation and audit | `apps/api/src/payment_options.rs`, `create`, lines 128–188, starts a transaction, writes the option, appends an audit event, and commits. | Gate changes, authority decisions, and payer changes must commit together with their audit records. |
| Transaction-local tenant and site context | `apps/api/src/drawer.rs`, `set_context`, lines 948–970, sets identity, tenant, membership, branch, and station using transaction-local `set_config`. | Derive tenant and site from authenticated membership. Apply them to each transaction rather than trusting posted scope fields. |
| Serialised shared financial operation | `apps/api/src/drawer.rs`, `lock_station`, lines 937–946, uses a transaction-scoped PostgreSQL advisory lock. `consume_challenge`, lines 911–922, consumes a matching, unexpired challenge once. | Use row locks or an explicitly justified transaction lock when safety release races against a hold or another release. A lock alone does not implement VMMS policy. |
| Idempotent operation contract | `apps/api/src/stock_transfers.rs`, `request`, lines 110–123, receives an idempotency key and hashes the raw payload. `validate_transition`, lines 721–777, requires a revision and validates allowed actions. Its test `transfer_movement_keys_are_deterministic_bounded_and_product_specific`, lines 993–1002, distinguishes products. | Persist command ID, payload fingerprint, actor scope, and response. Replaying the same command returns the original result. Reusing a key for different content produces a conflict. |
| Explicit custody stages | `apps/api/src/stock_transfers.rs`, `TransferHeader`, lines 45–68, separates requested, accepted, dispatched, received, rejected, and cancelled actors and times. | Part procurement, quarantine, issue, return, and removed-part custody need their own records rather than one editable quantity. |
| Count reconciliation against later movements | `apps/desktop/src-tauri/src/inventory_counts.rs`, `save_stock_count_counts`, lines 263–352, snapshots a movement cursor. `post_stock_count`, lines 355–476, adds later movements to the physical count within a transaction. `reconciled_stock`, lines 23–41, rejects negative or excessive results. | A workshop count must preserve parts issued after the item was physically counted. Use an append-only movement sequence and an explicit posting command. |
| Bounded image inputs | `apps/api/src/hosted_images.rs`, `MAX_IMAGE_BYTES`, line 7, and `validated_content_type`, lines 59 onwards. | Evidence uploads need bounded sizes and content validation, plus VMMS-specific immutable metadata, quarantine, malware processing, and scoped download access. |
| Desktop update separation | `apps/desktop/README.md:21` documents the update feed and unresolved production signing and hosting. `docs/IMPLEMENTATION_TRACKER.md` records local update drills and remaining checks. | Signed installation, data preservation, update rollback, and feed operation are separate acceptance tasks. A desktop build does not prove distribution readiness. |

These are design references. No POS source was copied. `LICENSE` contains the GNU Affero General Public License version 3. Any later source reuse needs a deliberate licensing decision recorded before copying. The new VMMS can implement the transaction, movement, and revision concepts independently.

The POS desktop window has a minimum size of 900 by 640 in `apps/desktop/src-tauri/tauri.conf.json`. That desktop layout is not evidence of phone or tablet support. Its `targets: all` bundle setting is also not proof that Windows, macOS, Linux, mobile, or HarmonyOS packages have been built and tested. VMMS needs its own responsive acceptance matrix.

## Graphify findings

The inspected Graphify checkout is `C:/Projects/graphify`, commit `0b60d47e6cd9338c51143f39f35b6c45c8453385`. `pyproject.toml` reports version `0.9.74`; the installed `graphify --version` reports the same version. These facts identify the inspected source and installed version separately.

`graphify/cli.py:2458` dispatches `update` to `graphify.watch._rebuild_code`. `graphify/watch.py:1425` describes that operation as a code rebuild without an LLM. `graphify/cli.py:3740` resolves an extraction backend only when semantic files or LLM deduplication require one. The public command help confirms the following commands:

```powershell
# Initial local AST index, after the new application has source files.
graphify extract C:\Projects\raymond-gray-vmms --code-only --no-cluster --max-workers 2

# Refresh after edits or a branch update. No semantic document extraction.
graphify update C:\Projects\raymond-gray-vmms --no-cluster

# Run from the VMMS repository root after its graph exists.
graphify query "work order release authority" --budget 1600
graphify affected "releaseWorkOrder" --depth 2
graphify explain "WorkOrder"
```

The first command excludes documents, images, and PDFs from semantic extraction. `--no-cluster` also avoids optional clustering work. `update` does not support `--max-workers`; do not copy extraction flags onto that command. Refreshing an index does not verify application behaviour.

The README lists TypeScript, TSX, JavaScript, Python, Rust, C#, Kotlin, Swift, Dart, and SQL among supported inputs. SQL needs the optional SQL grammar. TypeScript and TSX are supported in the base dependency set through tree-sitter. Documentation describes additional language support and optional grammar packages in `README.md:343` onwards and `pyproject.toml`.

Do not run an unrestricted semantic extraction over the VMMS repository by default. Graphify's documented headless extraction can auto-detect an API provider from configured keys. Documents, PDFs, and images may then be sent to that provider, and semantic extraction consumes model quota. `README.md:605–609` documents the local code path, provider routing, and the project's no-telemetry policy. That policy is a repository claim, not an independent network audit. The code-only commands above avoid the semantic extraction path.

Graphify respects `.gitignore` and `.graphifyignore` according to `README.md:433–435`. Add explicit exclusions for secrets, real customer exports, employee records, database backups, uploads, generated output, and dependency directories. Keep machine-specific graph caches and absolute-path markers local. Do not enable global cross-project graph merging for this application by default.

## CodeGraph workflow

The user authorises CodeGraph for the new VMMS. Initialise it when source exists, then use the repository's index before searches and broad file reads. In already indexed reference repositories, use the MCP tool with `projectPath`, or run the CLI from that repository:

```powershell
codegraph explore "WorkOrder release authority"
```

Name exact symbols or files when a broad query returns irrelevant results. The Smart POS query for generic `sync` and `inbox` terms returned the support issue inbox, so it was narrowed to stock and transaction modules. A failed broad lookup is not evidence that an implementation is absent. The explicit source documentation above is the evidence that durable POS sync remains unimplemented.

Use CodeGraph for current symbol source and call paths. Use Graphify for bounded relationship queries and change impact. Use runtime tests, transaction integration tests, browser checks, and restoration drills to prove behaviour. Record test evidence independently of the graphs.

## Scope limits

No reference builds, database migrations, authenticated browser workflows, payment-provider operations, or hardware tests were executed during this audit. Existing tests and tracker claims are identified as source evidence only. No production readiness or portability is inferred from them.

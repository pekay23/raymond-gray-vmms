# Source of truth, tracker and graph workflow check

Date: 14 November 2026

## Documentation entry and authority

- `docs/README.md` is the documentation index and identifies the implementation plan, architecture, requirements, tracker, decisions, review register and verification record.
- The repository `AGENTS.md` directs contributors to read the index, system design, implementation plan and affected requirement/task records before coding.
- `docs/architecture/system-design.md` names the master functional specification as binding, the compatible upgrade prompt as supporting detail, and reference applications as evidence only.
- Pending management and technical choices are listed in `docs/decisions/review-register.md`; draft SOPs remain non-effective and non-authorizing.

## Traceability result

`npm run docs:generate`, `npm run docs:check` and `npm run docs:test` pass. The current inventory contains 256 requirements, 684 tasks and 350 extracted source blocks. The traceability checks cover stale count detection, reciprocal source links, task/requirement references, BUILD/CHECK task paths, decision log integrity and false-completion rejection.

The generated human-readable tracker is `docs/delivery/implementation-tracker.md`; `docs/requirements/requirements.json` and `docs/delivery/tasks.json` are canonical. Open items remain open and the full VMMS goal remains active.

## Local graph workflow

The VMMS repository has a CodeGraph index and a local Graphify graph at `graphify-out/graph.json`. The graph workflow and privacy/cost boundary are documented in `docs/discovery/reference-patterns-and-tooling.md` and `AGENTS.md`.

- CodeGraph was queried before code searches for authority and work-order symbols, then used to select the affected PostgreSQL checks.
- Local Graphify query: `graphify query "authority grant scope decision snapshots" --budget 1600`. It reported 3,619 indexed nodes and a 26-node result. Graphify noted that the complete answer was about 1,895 tokens despite the requested budget, so future calls should use narrower terms or `get_node`.
- `graphify update C:\Projects\raymond-gray-vmms --no-cluster` rebuilt the local graph without LLM extraction: 4,457 nodes and 8,767 edges. It emitted an optional `pypdf`-missing warning while skipping PDF text extraction; PDF extraction was not part of this code graph refresh.
- No customer records, employee records, credentials, or private source were sent to a model-backed graph service.

## Ongoing goal

The conversation goal service returned status `active` on 14 November 2026. This confirms the completion goal has not been closed; it does not prove product completion. Production identity and hosting, technical/financial policy, historical backlog import, staff UAT, physical-device checks, recovery targets and management launch approval remain separate gates in the tracker.

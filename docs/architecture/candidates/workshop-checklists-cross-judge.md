# Workshop checklist design cross-judge

## Rubric

Scores are 1 (weak) to 5 (strong), based on the two candidate documents and the draft checklist form.

| Criterion | Candidate A: separate aggregate | Candidate B: work-order child |
| --- | ---: | ---: |
| Canonical visit identity and avoiding duplicate state | 4 | 5 |
| Immutable template and outcome provenance | 5 | 5 |
| Command, scope, RLS, idempotency, audit and outbox discipline | 4 | 5 |
| Fail-closed behavior without invented procedures or grants | 5 | 5 |
| Separation from repair tasks and G3/G4/Head/G5 decisions | 5 | 5 |
| Purpose-built reports, privacy and pagination | 4 | 5 |
| **Total** | **27/30** | **30/30** |

## Recommendation

Use **Candidate B** as the base. The checklist belongs to the canonical work-order visit, and the existing work-order root lock gives changes a clear serialization boundary for current vehicle, consent, holds and assignment checks. Its checklist tables remain separate from repair tasks, so an inspection result cannot silently become repair work or a sign-off. Candidate B is also more explicit about effective source applicability, report pagination and audience-specific output.

This is an architecture selection only. It does not activate a template, grant a permission, authorize work or resolve the open review policy.

## Grafts and refinements

- Preserve Candidate A's explicit `expectedChecklistVersion` on each item update and its clear report statement that an item result never completes the work order.
- Keep the Candidate B rule that operational checklist creation requires an effective exact-model template. If the product later supports a source-free training/authoring draft, store it in the governed template-authoring workflow, label it non-effective, and prohibit it from generating operational outcomes or satisfying a work gate.
- Treat template revisions and outcome corrections as immutable snapshots. Store event/outbox metadata only; keep evidence and private comments in their scoped records.
- Ensure report pagination is stable against concurrent edits (version/snapshot or detected result-count/version change), and apply client allow-listing in the report service.

## Rejected shape and risks to validate

Candidate A's separate aggregate could reduce lock contention, but it leaves work-order consent, holds and assignment coordination across aggregate roots. It also permits a nullable template revision in its proposed checklist shape; without a stronger non-effective state boundary, an untemplated record could be mistaken for operational work. Revisit the separate aggregate only if measured contention warrants it and cross-root consistency is specified.

Before production behavior, validate the exact OEM sources and model/variant fit, template author/reviewer/publisher grants, independent review needs, measurement/evidence/retention rules, report disclosure policy and any relationship to G2/G3/G4/G5. No generic EV or 10,000 km procedure is inferred from the current material.

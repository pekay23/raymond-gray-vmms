# Work-history source provenance — cross-judge

Status: independent design review; no implementation selected here.

## Rubric

Scores use 1–5, where 5 is strongest fit for the stated criterion.

| Criterion | Candidate A: per-entry block | Candidate B: normalized source records | Notes |
| --- | ---: | ---: | --- |
| Keeps the model as small as the immediate need | 5 | 2 | A adds nullable fields to an existing immutable entry. B adds three scoped tables, source commands, links, and correction rules. |
| Separates source attribution from authenticated VMMS recorder | 5 | 5 | Both keep actor identity server-derived and label source details as claims. |
| Avoids implying authenticity, truth, or sign-off | 4 | 4 | Both state the limits and prohibit using provenance for authority gates. These limits need to survive into persistent UI and report wording. |
| Supports later structured service-report rendering | 5 | 4 | A provides a typed per-entry block, including source statement. B provides reusable document/locator structure, but intentionally omits source narrative. |
| Preserves corrections and historical rows honestly | 5 | 4 | Both are append-only and avoid inferred backfills. A directly fits the existing entry correction chain; B adds separate correction/link lifecycle. |
| Defines who may record source-derived history | 2 | 2 | Neither resolves the current task-entry endpoint's current-assignment requirement or defines an authorized historical-entry route. |

## Recommendation

Advance Candidate A as the minimal design, with a required scope expansion before implementation: define an authorized command for source-derived history when the recorder is not currently assigned to that task. Keep `actor_user_id` and placement derived from the authenticated session; retain source kind, label, statement, and source-reported time as separately labeled claims. Preserve the existing source/evidence distinction and do not let provenance influence safety, completion, inspection, release, consent, or finance decisions.

Candidate A best matches an occasional report transcription and later structured rendering while keeping each immutable entry self-contained. Revisit Candidate B only if product evidence establishes repeated multi-entry imports, stable page/row locators, or shared source-level correction as a real operating need.

## Weaknesses and implementation gate

- **Candidate A:** bounded free text can still be mistaken for verified history unless the entry form, history, and print report visibly distinguish source statement from the authenticated recorder's own entry. Repeated source metadata can drift. Its proposed worker UI also assumes the assigned-worker path.
- **Candidate B:** materially expands schema, authorization, audit, correction, and UI surface for an unproven need. It does not itself preserve the source's relevant wording, so the later report may have only title/locator metadata. Linking a source record to an entry does not solve creating that entry outside the assigned-worker path.
- **Neither is implementable as written for the broad use case:** CodeGraph inspection of `recordMyTaskWorkEntry` shows it calls `assertCurrentAssignment` during both authorization and apply. Provenance fields added to that command would therefore still require a current task assignment. Expand the design to state which role/grant may record a transcription, whether that operation is separate from assigned work notes, how it is scoped and audited, and how stale assignment checks apply (or do not apply) to that operation. Do not weaken the existing endpoint's assignment guard implicitly.

No customer records or source contents were opened or included in this review.

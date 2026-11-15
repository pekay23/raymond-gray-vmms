# Vehicle-learning assessment design synthesis — 2026-11-14

## Rubric and candidates

The design needed to cover every section of the five-page handout, keep one complete answer set immutable per revision, preserve exact-version comments and current author/site privacy, validate evidence states without implying authority, and fit the existing save model with a small maintainable surface.

- [Candidate A](vehicle-learning-assessment-candidate-a.md) stores one versioned JSON assessment snapshot on the existing aggregate/revision.
- [Candidate B](vehicle-learning-assessment-candidate-b.md) stores worksheet answers in normalized child tables beneath each immutable revision.

## Pick

Select Candidate A as the base. Its snapshot aligns with the current revision boundary and avoids partial answer writes, multiple RLS policies, ordered child-record reads, and schema growth before shared technical references or per-system query needs are approved.

The cross-judge scored A/B: handout coverage 4/5 and 5/5; immutable revision/comment binding 5/5 and 5/5; privacy/authority 5/5 and 5/5; evidence validation/single truth 4/5 and 5/5; migration/maintenance fit 5/5 and 3/5. The judge selected A with the following grafts.

## Grafts

- From Candidate B: keep `documentary-confirmed` distinct from `diagnostic-confirmed`.
- From Candidate B: use stable keys for each system and question; begin all system statuses as `unknown`.
- From Candidate B: classify legacy selections as unconfirmed and preserve their exact old text.
- From the judge: derive any compatibility scalar summaries from the structured snapshot. Do not allow old scalar fields and the assessment to be edited as competing truths.

## Rejections

- Do not normalize into five child tables yet. It increases migration, transaction, RLS and read complexity without changing the all-or-nothing revision unit.
- Do not publish learner answers as shared make/model facts. Model-specific technical content needs approved sources, named technical owners and a separate publication grant.
- Do not widen reviewer visibility by removing author filters. `REV-051` and the user's reviewer-scope choice must precede cross-author reads or review commands.

## Verification

This document records a design selection, not implementation evidence. The contract is [vehicle-learning-assessment-v1.md](../vehicle-learning-assessment-v1.md). `USER-041` stays in progress until the structured exercise, migrations, API/UI, tests, role/browser coverage and remaining owner review are complete.

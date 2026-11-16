# Staff workflow guide reconciliation — 2026-11-15

## Finding and correction

The plain-language guide lagged behind the owner's approved sign-off order and implemented work-history/report features. Although its diagram showed an independent check before Team Lead release, a later note said the check's position was undecided, and the diagram combined Team Lead release with Head review. The guide also described the action journal and Daily Service Report as not implemented and overstated who could view Sales vehicle history.

Updated [`how-work-moves-through-vmms.md`](../guides/how-work-moves-through-vmms.md) to reflect the approved high-level order from `REV-046`:

1. Supervisor records technical completion.
2. Team Lead records final release and moves the vehicle to the collection zone.
3. Head of Service Centre inspects and signs off.
4. Service Advisor may give the post-repair customer update.

The guide now says those approval commands are not implemented. Where the approved policy requires independent checks, those checks must pass before Team Lead release. Required functional checks and approved disposition of outstanding faults remain release prerequisites even when no independent check applies. Their matrix, eligible reviewers and evidence rules remain pending under `REV-035`. The Head's post-release inspection is separate. The guide also leaves cleanliness and invoice timing open under `REV-057`, states that payment or an approved showroom guarantee must be checked before handover, and limits vehicle-history access to the roles currently supported under `REV-049`.

The guide now describes the attributed work-action journal and purpose-built Daily Service Report as implemented in tested slices, while keeping full report scope, the VIN discrepancy for the November 12 report, approvals, customer updates and end-to-end user acceptance open.

## Review basis

- `docs/architecture/service-journey.md`
- `docs/architecture/technical-completion-and-release.md`
- `docs/architecture/service-work-history-and-reports.md`
- `docs/decisions/review-register.md` entries REV-035, REV-046, REV-049 and REV-057
- Owner's workflow clarification recorded in the review register
- `master-0038` independent-verification requirement

This is a documentation correction only. It does not implement or enable G2/G3/G4, independent inspection, Head inspection, finance, collection or delivery commands.

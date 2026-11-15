# Service-request and service-journey review — 13 November 2026

## Current end-to-end map

1. **Sales and delivery:** Sales staff record delivery facts against one vehicle record. PDI staff add source-backed observations. A purchaser claim does not become a verified owner or service payer.
2. **Customer contact:** Sales, an advisor or another authorized staff member records a service request with the caller, reported relationship, concern, reported vehicle/client, callback owner, next action and follow-up time. It does not create a workshop job.
3. **Callback and confirmation:** The responsible staff member records each attempt and outcome, corrects contact details through an attributed history entry, and keeps unresolved requests in the role-scoped queue.
4. **Vehicle arrival:** The Advisor or permitted reception role confirms the actual paying client, owner claim, visit contact and vehicle. Request-based reception displays the original request beside these fields and requires confirmation.
5. **Operations review:** Saving the arrival creates one visit and one work order and places it into the Operations review/assignment path. It does not authorize diagnosis or repair.
6. **Workshop work:** Operations reviews and assigns a qualified lead; the lead prepares a plan and hands it to a supervisor; the supervisor allocates individual tasks; assigned workers acknowledge and report progress. The new job summary points to the current stored stage.
7. **Completion, customer and commercial handover:** The accepted sequence is Supervisor technical completion → Team Lead final release and collection-zone placement → Head inspection/sign-off → Advisor customer update, invoice review, payment/showroom guarantee and collection/paid delivery. Those sign-off and financial commands stay unavailable until approved SOPs, authority grants, evidence requirements and commercial policy exist.

## Review findings

- The service-request feature is a separate, site-scoped pre-job workflow with role-filtered queues, caller details, callbacks, corrections, close/reopen history and both conversion-to-arrival and explicit link-to-existing-job paths.
- The current request form captures channel, caller, relationship, concern, reported vehicle and reported payer, but keeps the concern and reported vehicle mostly as free text. The first save now optionally includes the next contact step and time, assigns that follow-up to the creating staff member, and keeps it distinct from the later outbound contact history. This removes a second setup action without treating the incoming call as a successful contact. Keep this as call/request intake; do not put workshop diagnosis or performed work in this form.
- The conversion previously reused generic reception wording without restating the request facts. The new arrival panel names the source and distinguishes reported values from confirmed facts; the save action states that Operations review follows and repair authority is not implied.
- Sales/PDI observations are source-backed vehicle history. The workflow intentionally does not turn a sales record directly into a repair job. A sales contact can create a separate request when a concern is reported; the reported client/vehicle must still be confirmed at arrival.
- Work-plan, supervisor handoff, task allocation, technician progress and read-only supervisor progress review exist in verified slices. Supervisor completion sign-off, Team Lead release, Head inspection, Advisor contact history, invoice, payment/guarantee and handover remain incomplete.
- Task progress comments are not yet an attributable repair-action journal. The current work-order print summary is not a complete daily service report. Build separate finding/test/action history and generate the report from those records under the [work-history and report contract](../architecture/service-work-history-and-reports.md).
- Role/screen UAT, broad callback time-zone behavior, simultaneous-tab acceptance and full Sales-to-vehicle-handover browser coverage remain open. Synthetic evidence is not staff UAT or production readiness.

## Simplifying the interface

Keep the staff path to **Today → Requests → Work orders → Vehicles**. Use Today for role-specific work that needs attention; Requests for calls and callbacks; one work-order page for review, planning and task history; Vehicles for sales/PDI and service history. Keep staff administration, controlled documents, reports and messages in secondary areas. Each page should state one next action, who is responsible, what fact still needs confirmation, and why a blocked action cannot proceed. The current work-order step summary is a small first slice of that design, not completion of USER-040.

## Evidence

- [Request-to-arrival conversion verification](../verification/service-request-arrival-conversion-2026-11-13.md)
- [Service request close/reopen verification](../verification/checks/service-request-close-reopen-2026-11-13.md)
- [Work-order workflow-context verification](../verification/work-order-workflow-context-2026-11-13.md)
- [Service work history and report design](../architecture/service-work-history-and-reports.md)
- [Service journey and policy boundaries](../architecture/service-journey.md)

## Pending user input

The 12 November the source-report customer report remains prepared as a source note only. The payer is confirmed, but the report VIN and sales workbook VIN differ at one character. Verify the VIN on the physical vehicle or its documents before creating a canonical vehicle or job. Actual actions and the report must later be entered through the work-history feature; the current comments and summary cannot faithfully represent them as verified workshop work.

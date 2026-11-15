# Plain-language interface

**Status:** Plain-language direction approved. High-confidence wording changes applied; specialised terminology and remaining screen coverage still need review.

Use short, familiar labels and one clear action per button. Explain a specialised term when staff first need it. A correct screen label must identify the person, vehicle, record or action actually shown. It does not need to copy the workbook column name. Keep API fields, database names and import provenance independent from screen wording.

## Party names

Keep these people and organisations distinct wherever they appear:

| Meaning | Screen label |
| --- | --- |
| Person or organisation paying for the work | Paying client |
| Person reported to own the vehicle | Vehicle owner |
| Person the service centre contacts for this visit | Visit contact |

Do not infer one role from another. In particular, a showroom shown as the paying client must not be labelled as the visit contact.

## Applied wording corrections

- Work-order queue column: **Paying client** (it displayed `clientName`, not a visit contact).
- Intake field: **Paying client name** (formerly “Client / payer name”).
- Intake field: **Vehicle owner name** (formerly “Owner name”).
- Optional client-code field now says it is optional and explains when a system-issued code is used.
- Intake is labelled **Register a vehicle visit** in its page title and queue action.
- Team-lead and supervisor queues name the work assigned to the signed-in person.
- Older reception observations now say **Corrected by a newer entry** while remaining visible for history.
- Missing battery charge is labelled **Battery charge not recorded**.
- Diagnostic freeze-frame values are labelled **Diagnostic snapshot readings**, with a brief explanation that preserves the tool term.
- The diagnostic finding form asks **How certain is this finding?** and **Why did you choose this option?**; the technical state and explanation fields are unchanged.
- The diagnostic form uses **Detailed observations** instead of “Structured observations.”
- Procedure search says **another name** instead of “alias,” and explains that only procedures marked current are shown.
- Owner history in the printed work-order summary describes a superseded owner report as **Replaced by newer information**.
- Hold scope asks **What does this hold apply to?** and explains the available choices.
- The controlled procedure library says **approved for use** and **current** instead of “effective” and “superseded.” It calls a document number a **version** and its start date **In use from**. The underlying procedure states and dates are unchanged.
- The Head overview and workforce page say **staff role assignments** instead of “role placements.” The roster no longer shows the internal record version; the API still checks it when a role changes.
- The work-plan section is **Team lead's work plan**. The version badge says **Version**, and the save action says **Save updated plan**. The server still creates and tracks work-plan revisions.
- Team-lead choices show the person's name without internal qualification codes such as `EV-TEAM-LEAD`; the page still explains that only currently qualified leads can be assigned, and the server continues to enforce the qualification.
- The printed work-order summary calls an observation **Vehicle or key handover** instead of “Vehicle custody.” The report describes the observation and does not say that custody was accepted.

## Wording changes and owner review

These wording changes aim to reduce internal or specialist terms while preserving the underlying workflow. They do not rename API fields, database values, booking references or imported source labels.

| Current wording | Suggested wording | Reason |
| --- | --- | --- |
| Work queue | Show jobs | Applied to the queue filter. Makes clear that this control filters the job list. |
| Work orders (main navigation and page title) | Jobs | Shorter and familiar. Explain once that a job holds the visit, concerns, tasks, files and approvals; keep “work order” in formal record and audit detail. Pending owner review because it affects global navigation. |
| Supervisor handoff | Assign a supervisor | Applied. Describes the action directly. The note is called a handover note. |
| Optional vehicle engine field | Engine or motor | Applied with examples. The booking-number selector stays “Vehicle type for booking number.” |
| Booking powertrain class | Vehicle type for booking number | Applied. Explains why the choice is needed; the saved class remains exact. |
| Concern-wide diagnostic finding | Whole concern | Applied to show that a finding applies to the concern rather than one task. The task picker says “No related task.” |
| Certainty recorded by author | Stated by staff member | Applied. Keeps the meaning while using familiar words. |
| Accepted work-order evidence | Link files that passed the security check | Applied. Describes the scan result without implying repair approval. |
| Invitation identity it was issued to | Account named in your invitation | Applied. Tells the person which account to use. |
| Qualification | Current approval for this vehicle type | Explain the term at first use; do not change qualification records or eligibility rules. |
| Technical completion | Supervisor sign-off | Suggested for staff-facing status labels; keep the formal technical record name where precision is required. |
| Team-lead work plan | Team lead's work plan | Applied. Makes the role owner clear. |
| Custody observation | Vehicle or key handover | Applied to the reception observation choice; this does not itself record accepted custody or pass G1. |
| Work orders | Keep pending | “Jobs” may blur a whole work order with the separate tasks it contains; owner review is needed. |

Keep “work plan” for now because it matches the service workflow the owner described. Keep VIN but expand it as “Vehicle identification number (VIN)” at the first point of use. Do not replace safety or payment terms with friendlier wording that changes their authority or gate meaning.

The work-plan explanation now omits the internal G2 code and says plainly that the draft does not give permission to start work or approve extra or changed repairs. This retains the workflow restriction without requiring staff to know an internal gate label.

Combustion engine (ICE) is the inclusive vehicle label; petrol and diesel are examples, not the full category. Saved intake drafts now retain selected client and vehicle IDs and recheck them through the selected service centre. If a saved record cannot be confirmed, submission stays blocked. Older draft versions did not store those IDs, so the screen asks staff to search and select each record or confirm it as new after the current-site lookup returns no match.

## Review standard

For every changed label, confirm that it names the correct record or action, works for staff and approved vehicle owners, is readable at narrow widths and browser zoom, and does not rely on colour or an unexplained abbreviation. Verify screen-reader names after changing visible labels. Preserve original spreadsheet terms only where import records require source traceability.

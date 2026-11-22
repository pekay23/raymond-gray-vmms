# Maintenance checklist start gate

## Current behavior

Routine-maintenance checklists remain drafts after preparation. The work-order screen labels a draft as non-authorizing. On an assigned technician task, the action is now “View details,” not “Record outcome”; opening it explains that VMMS cannot start the checklist and that the draft must not be used as a work instruction. The outcome form remains unavailable until the checklist is already in progress.

## Why activation is still gated

The accepted generic evidence and authority rules do not supply vehicle-specific instructions or named signed grants. The current review register records that exact manufacturer schedules, item applicability, qualifications and grants, tool/equipment controls, and effective vehicle templates are still pending under REV-053, with controlled SOP approval pending under REV-008. REV-006 and REV-035 also govern named action authority and G3/G4 execution and inspection records; REV-009 governs model-specific EV/HV controls.

An activation command must serialize with work-order edits and vehicle safety holds, then recheck consent, authorized scope, current source, assignment, signed authority, qualification, safety policy, and evidence requirements. A checklist state change cannot be treated as a shortcut around G1-G5 or as a technical sign-off. The activation and verification tasks are now explicit in the tracker and stay planned until those inputs and lock-order proof exist.

## Verification

- The assigned-task browser check uses a synthetic draft and verifies the blocked explanation appears with no outcome save action.
- The same harness verifies an already-in-progress synthetic checklist can open the outcome form and save a result. This is UI evidence only; it does not establish a valid production source, grant or qualification.
- The current API suite passes, but does not prove successful database-backed activation. No activation command exists.

## Browser verification

The assigned-task browser check passes for technician draft blocking and in-progress outcome entry at 320, 390, 768, 1024 and 1440px. It also covers pagination, empty/failure states, keyboard search and Axe accessibility. Data is synthetic; this does not establish production authorization, staff acceptance or physical-device behavior.

# SOP-to-validation mapping

**Status:** draft mapping framework; source SOPs and named approvals have not been supplied.

This document defines how owner-provided procedures will be connected to VMMS validations. It does not author, infer, approve, or replace a technical procedure. The `after-sales` PDI form is a legacy form reference only, not an approved SOP.

| Source register entry | VMMS validation area | Evidence needed before the mapping can be accepted |
| --- | --- | --- |
| SOP-001 Intake | Intake identity, complaint, consent, initial condition and review handoff | Approved intake SOP revision; required fields and permitted transitions |
| SOP-002 Technical execution | Assigned work, work steps, findings, evidence and completion proposal | Approved work procedure per vehicle/system scope; authorized competency and evidence requirements |
| SOP-003 Work order | Work-order creation, scope revision, task and status controls | Approved work-order lifecycle and accountable roles |
| SOP-004 Parts | Request, reservation, issue, return and traceability | Approved parts controls and any financial/inventory authority |
| SOP-005 High-voltage | HV work authorization and safety controls | Owner-provided current procedure, applicability, qualified authority, equipment and independent checks; never infer steps from the PDI checklist |
| SOP-006 Emergency | Stop-work, incident, escalation and recovery | Approved emergency response and reporting procedure |
| SOP-007 Warranty and payer | Coverage evidence, payer, authorization, claim and reconciliation | Approved warranty evidence rules, payer terms, rates and financial authority |
| SOP-008 Competency | Qualification scope, validity, renewal and assignment eligibility | Approved competency matrix and named grant/qualification evidence |
| SOP-009 Equipment | Required equipment, calibration, availability and record | Approved equipment list, check interval, calibration evidence and responsibility |
| SOP-010 Finance | Estimate, invoice, payment, guarantee and reconciliation | Approved finance controls, taxes, rates, limits, payment and showroom-guarantee evidence |
| GOV-001–004 | Governance, approvals, records, access, review and audit | Approved governance register, decision owners, revision/effective dates and audit/retention rules |

## Mapping protocol

For each supplied controlled document, record its stable ID, title, revision, approval evidence, effective and superseded dates, applicability, owner, and access classification in the controlled-document library. Break requirements into individual validations with explicit allowed and denied actions, required evidence, server command, audit event, and test case. Cross-reference those tests to the requirement and tracker IDs. Validate access and scope separately from procedure correctness. Keep draft, missing, expired, superseded, or historically unknown material visibly distinct and fail closed where it gates a decision.

The SOP register names in the table come from the master specification. They remain placeholders until the actual documents and register are received. A mapping is not complete merely because a related page, field, or software gate exists: acceptance requires review by the designated procedure owner and passing implementation evidence. Unknown approvals remain unknown.

## Current reference-derived design input

The [after-sales reference audit](../discovery/after-sales-reference-audit.md) records transferable form patterns and explicit incompatibilities. Its 22-item PDI seed list, inconsistent guide count, manual name/signature fields, generic statuses, and Sold trigger are excluded from VMMS authority and gate policy.

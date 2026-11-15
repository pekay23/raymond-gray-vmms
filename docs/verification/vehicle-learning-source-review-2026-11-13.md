# Vehicle-systems learning source review

Date: 2026-11-14\
Result: **All five PDF pages were transcribed and visually checked; the staff learning exercise is implemented; technical source approval and the scoped reviewer workflow remain open.**

## Extraction evidence

- Source file: `EV AFRO SERVICE CENTRE.pdf`, 5 scanned pages, 32,798,097 bytes, SHA-256 `79D05F479614C81E29DF8AFD469507FB00184DA0AA200A7B70E0E1FB03F70833`.
- `pdfinfo` reports no text layer and no encryption. Each page was rendered and run through English OCR; the transcript was checked against all five rendered page images, including the component register and the second worksheet page.
- Full text is preserved in [the source transcription](../sources/ev-afro-service-centre-transcription.md), including every heading, prompt, table row, system/component name, safety note, figure caption and footer. Formatting and line wrapping are normalized; OCR-only errors were corrected from the scan.
- No vehicle identity or powertrain was inferred from the yard photograph.

## Content used in the design

The source supplies a structured learning pattern: preliminary classification, stronger evidence sources, confidence/assumptions, unknowns, a system register, energy-flow diagrams, short explanations and instructor review. The proposed feature carries those into the staff learning catalog and saved exercise workflow; see [vehicle systems learning design](../architecture/vehicle-systems-learning.md).

The PDF describes a student exercise, not a signed SOP or model-specific service manual. It explicitly excludes HV disconnection, electrical testing, connector removal, underside/lift access, road testing and vehicle movement within this exercise. The design preserves this as a source boundary and does not make the document a job procedure, qualification, diagnosis, vehicle record or authorization.

## User direction and source instructions

The user's product direction is to provide an internal learning area for active after-sales roles, including the Head of Service Centre, trainees, technicians and engineers; let staff identify unfamiliar vehicle types, drivetrains and systems; capture evidence, comments and questions; and save or submit learning for later review.

The PDF is source material for the learning exercise, not an instruction to change the application architecture, grant roles, approve procedures or perform service work. Its student prompts and safety limits are represented as exercise content. They do not replace the user's role/access direction or separately approved workshop SOPs. The interface makes clear that learning notes do not authorize diagnosis, repair, vehicle movement or high-voltage work.

The implemented API permits active after-sales roles, including `head-service-centre`, `technician-engineer-trainee`, technicians/engineers and the other defined after-sales roles. Client, public and outside-workspace identities are excluded. Staff can save author-scoped drafts, submit them for review, retain immutable revisions and add append-only comments to their own saved versions. The web page presents the complete transcription alongside the structured exercise.

## Outstanding

- Reviewer queue, reviewer feedback and cross-author review access are not implemented. Submitted records remain visible only to their author until review roles and grants are approved under `REV-051`.
- Technical content owners, publication grants, retention and cross-site contribution rules require review under `REV-051`.
- Model-specific vehicle facts need current approved OEM or other technical sources before they may appear as verified reference content.
- No operational vehicle/customer data was created from this PDF.

See [vehicle learning implementation verification](vehicle-learning-implementation-2026-11-13.md) for test and browser evidence, and [vehicle systems learning design](../architecture/vehicle-systems-learning.md) for the current data and authority boundaries.

# PDI observation correction check

Date: 13 November 2026

## Scope

This change adds a correction form to the existing Sales and deliveries page. A PDI Observer can start from a recorded note, change its area, wording or source reference, and must enter a reason. Saving appends a correction to the same delivery. The original note remains unchanged and visible. Changing the VIN search or selected delivery clears the correction draft. No history access roles were added.

## Results

- PostgreSQL/API foundation checks: 73 passed, 0 failed. They cover missing-reason rejection, denial without the PDI Observer role, successful correction, exact replay, changed-payload conflict, and preservation of the original note.
- Real PostgreSQL/API/browser journey: passed. It records a synthetic delivery and PDI note, corrects the note, reloads the page, and verifies both entries and the reason remain visible.
- Responsive layout: passed at 280, 320, 344, 390, 768, 844, 1024 and 1440 pixel viewport widths without horizontal overflow or clipped controls.
- Automated WCAG 2.1 A/AA scan: no violations. The first scan caught a mismatch between the correction button's visible text and accessible name; the wording was aligned and the full scan passed on rerun.
- Browser console/page errors: none.
- Workspace TypeScript checks, web unit suite and web production build: passed.
- Documentation tracker and traceability checks: passed.

## Limits

All records used for this check were synthetic and isolated in a disposable PostgreSQL database. This does not approve a PDI procedure or turn an observation into a pass, completion, safety or release sign-off. Staff acceptance, screen-reader testing, real workbook reconciliation and operational role review remain open.

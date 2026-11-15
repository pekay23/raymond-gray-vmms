# First-save service-request follow-up verification — 13 November 2026

## Outcome

Passed locally with synthetic records. A staff member can save an inbound request and, when needed, its next contact step and callback time together. The creator is assigned the planned follow-up. Saving the incoming request does not create an outbound contact-history entry; an actual attempt is still recorded as a separate action.

## Evidence

| Check | Result |
| --- | --- |
| API foundation suite | 121 passed, 0 failed, 1 optional local S3/ClamAV fixture skipped. PostgreSQL coverage verifies the follow-up owner/action/due instant, no-follow-up defaults, callback-without-action rejection, and no fabricated contact-history entry. |
| Web test suite | 33 passed, 0 failed. Includes site-timezone conversion, daylight-saving gap/repeated-time refusal, and legacy request-draft defaults. |
| `npm run typecheck` | Passed for API and web. |
| `npm run build --workspace @vmms/web` | Passed. |
| `npm run verify:service-requests-browser` | Passed against a disposable PostgreSQL database and synthetic records. The browser created an incoming request with a planned callback, recovered the same request after a simulated lost response, verified caller and follow-up details, kept initial contact history empty, then recorded an outbound attempt separately. The complete request journey also passed at 320, 390, 768 and 1440 pixels with zero page errors and no automated WCAG 2.1 A/AA violations. |
| `npm run docs:generate` and `npm run docs:test` | Passed after adding the implementation and verification work items to the full-completion tracker. |
| `git diff --check` | Passed. |

Callback input is interpreted in the configured service-centre timezone and stored as a UTC instant. The date conversion rejects daylight-saving times that either do not exist or occur twice. Current launch configuration is `Africa/Accra`; broader site-timezone use still needs its configuration path and UAT.

## Remaining limits

This is local synthetic verification, not staff acceptance or production readiness. The business still needs to confirm who should own callbacks for combined roles and validate the workflow with staff. The separate outbound-contact action and its outcome remain necessary evidence after an actual call. No customer record, workshop database, deployment, notification or production setting was changed by this check.

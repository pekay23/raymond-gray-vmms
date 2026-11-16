# Role navigation and selected-site routing recheck

**Result: verified against the local web app on 15 November 2026.**

Command: `node scripts/workspace-navigation-browser.mjs`

The browser assertions passed for Head with Operator duties, Service Advisor, Technician, Sales-only, Operator-only, Finance-only, and multi-site selected-role landing. They check permitted and hidden navigation, role-appropriate landing pages, denied direct routes, and the Head's responsive widths. Finance setup is hidden from the Head and opens only for the Finance/Billing role; the Finance page receives a synthetic 403 until a server grant is supplied. Finance and combined Compliance/Records/HR do not receive work-order routes from those roles alone. The Head's direct Finance route redirects to Today. Keyboard opening of “More sections” and automated WCAG 2.1 A/AA results for the Head's Today page also pass. The Head does not see the Operator's staff-account page.

The script supplies synthetic API responses and role sessions; it does not call the VMMS API, shared auth, or a production identity provider. This verifies displayed navigation and route handling, not server authorization, real sign-in, manual assistive-technology use, production account enrollment, or operational UAT. Finance API authorization remains grant-based and must be proven separately against the real API and database.

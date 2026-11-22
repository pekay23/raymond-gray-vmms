# Prompt for the parallel VMMS implementation agent

Continue implementation of the Raymond Gray VMMS product in `C:\Projects\raymond-gray-vmms`. Read `AGENTS.md`, `docs/README.md`, `docs/architecture/system-design.md`, `docs/delivery/implementation-plan.md`, and the relevant requirement and task entries before changing code. Follow the workshop operations pilot priorities and preserve server-enforced tenant/site isolation, grants, safety gates, audit, idempotency, and existing branding.

Own VMMS product pages, their business APIs, and related tests. Choose a coherent unfinished workshop workflow from the current tracker, implement it end to end, and record its actual verification and remaining gaps. Inspect the current working tree first and preserve unrelated changes. Use CodeGraph as required by the repository instructions.

Another agent owns the shared identity migration in `C:\Projects\raymond-gray-auth`, its Vercel/Neon identity infrastructure, and the VMMS OIDC/session integration. Do not modify that repository, `apps/api/src/oidc-*`, auth/session routes or middleware, identity migrations, deployment configuration, root environment files, or managed-services redesign documents. Do not deploy, change DNS, or change live data. If a product workflow needs an identity change, describe the needed contract in your report instead of implementing it.

Avoid editing shared `docs/delivery/tasks.json`, `docs/requirements/requirements.json`, `docs/delivery/decisions.tsv`, or `docs/decisions/review-register.md` while the identity agent is active. Provide exact proposed task and requirement updates in your handoff so the integrating agent can make them as the single writer. You may add a feature-specific design or verification report under `docs/` with a unique filename.

Run the meaningful checks required by the repository for your changed behavior. Report changed files, commands and results, unresolved safety or policy decisions, and any integration requirements. Do not claim production or UAT completion from local checks.

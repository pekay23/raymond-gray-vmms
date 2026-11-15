# Candidate B: compare the Worker with the container API boundary

## Caller usage

Run one shared black-box HTTP scenario suite against two isolated targets: the ordinary Node container API and an opt-in Cloudflare Worker adapter. Each target gets a fresh migrated PostgreSQL database and synthetic fixtures. Compare session/CSRF, site denial, transaction races, and a streamed evidence upload above the Vercel Function body limit.

## Module sketch

- Keep `apps/api/src/server.ts` as the known Node/container entry point.
- Put the Worker adapter in a separate opt-in entry point and Wrangler file.
- Give the Worker a Hyperdrive binding and the container a normal local `DATABASE_URL`.
- Drive both through the same HTTP scenario helpers; clean databases and processes in `finally` blocks.
- Retain a Worker-to-container service binding as a fallback only if direct adaptation fails and the additional network boundary is justified.

## Rationale

This candidate focuses on comparative evidence and keeps business behavior provider-neutral. It avoids inferring compatibility from a Worker bundle and makes it possible to compare the same API contract against the established Node runtime.

Its main cost is harness size and maintenance: runtime-specific fixtures, DB lifecycle and adapter setup must remain isolated from normal development. It still does not validate remote Hyperdrive pooling, provider ingress limits, real object storage/scanning, or deployment operations.

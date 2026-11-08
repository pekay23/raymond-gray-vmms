# Architecture comparison rubric

Compare whole designs before selecting the implementation. Produce caller usage first, type and command contracts, module ownership, deployment map, data and authority invariants, tradeoffs, and a falsifiable validation plan.

| Criterion | Weight | What earns a strong score |
| --- | --- | --- |
| Transaction and safety integrity | 30 | G1-G5, per-task holds, named grants, independent inspection, versioned scope, atomic stock/finance/release, race and replay behavior are concrete |
| Web-first delivery and maintainability | 25 | A small deployable architecture with explicit ownership and useful framework support, without requiring a native release to launch |
| Data protection and operations | 20 | Tenant/site boundaries, secure staff identity, auditable evidence, reversible migration, restore and monitoring have owners and checks |
| Device and offline evolution | 15 | Browser capability matrix, draft loss controls, authority revalidation and conflict semantics are realistic across requested OSs |
| Cost and agent efficiency | 10 | Narrow source queries, shared contracts, deterministic checks, limited infrastructure and a small set of dependencies reduce recurring work |

Reject designs that infer authority from job titles, use eventual dual writes as canonical persistence, allow release offline, promise one native runtime covers HarmonyOS without evidence, or call a screen complete without server tests. A design must preserve unknown diagnosis and unknown historical approval states.

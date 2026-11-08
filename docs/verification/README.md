# Verification record

The project goal is not complete. Evidence belongs here or in a linked deterministic test artifact. A statement in a candidate design or reference repository is not proof that the new implementation works.

## Evidence levels

| Level | What it establishes | What it does not establish |
| --- | --- | --- |
| Source audit | The inspected code contains a stated mechanism | Runtime correctness or production configuration |
| Unit test | A bounded function behaves as asserted | Database, identity or browser integration |
| PostgreSQL API integration | Actual constraints, runtime permissions, transactions and API effects | Physical-device behavior, backup operation or staff acceptance |
| Browser end to end | Staff can use the real web/API path with persisted results | iOS/macOS/HarmonyOS hardware support unless run there |
| Operational rehearsal | A measured restore, import or recovery procedure works on its recorded environment | Management authority or regulatory certification |
| Staff UAT | Named staff accepted defined workflows on a dated configuration | Other workflows or future policy versions |

Use `VERIFIED`, `NOT VERIFIED`, or `INCONCLUSIVE` for individual claims. Unavailable infrastructure and absent source material are not passing results. Record the command, date, environment, result, scope and limitations. Sanitise secrets and real customer/staff information.

## Required first-slice proof

- Session lifecycle, CSRF, login failures and current site membership.
- Cross-site list/detail/mutation denial, runtime-role RLS and connection reuse.
- One visit/work order for an intake command, duplicate replay and changed-payload conflict.
- C02 on the same work order, planned task creation, task/work-order hold scope.
- Expected-version conflicts, concurrent command behavior and atomic rollback.
- Runtime audit update/delete denial.
- Browser sign-in, empty/list/search/detail, form validation, persistence, draft recovery, failed saves, account/site switching, keyboard use and narrow layout.

These checks cannot complete G1, full AT-02, G2-G5, finance, HV, physical-device, restore, historical import or launch acceptance. Each later unit adds its own traceable evidence.

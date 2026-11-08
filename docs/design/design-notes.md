# Visual direction review

Prepared 7 November 2026. Open [visual-directions.html](visual-directions.html) directly in a browser. It needs no development server, authentication or external font service. Assets resolve from this repository through `../../apps/web/`.

On 8 November 2026, the owner confirmed that independently scrolling columns or sections are acceptable. For dense desktop work, consider a queue column beside the selected work record so each can scroll without moving the other. At phone, tablet portrait and narrow foldable widths, reflow into one natural scroll surface. Preserve keyboard navigation, visible focus and understandable reading order; do not trap pointer, touch or keyboard scrolling. Validate the exact behavior on each workflow instead of applying nested scrolling indiscriminately.

The board is a separate review artifact. Neither switching proposals nor using its preview controls records approval. No application, requirement or task file was changed for this design study.

## Choices

- **Current baseline, Workshop desk.** Source reconstruction of the inspected split sign-in screen: photograph and charcoal left panel, system sans-serif, white form and emerald actions. It is not a live screenshot.
- **A, Service ledger.** Brand blue ordinary actions, a narrow blue record spine, restrained red identity marker, technical sans-serif headings and ruled operational records. The existing portrait is shown intact alongside the form on wide screens. The compact phone form omits the decorative image.
- **B, Editorial record.** Serif headings, paper-toned canvas, blue title, charcoal actions and a bounded portrait with a margin caption. The form and service-record excerpt retain plain, readable system sans-serif. This has a more deliberate reading rhythm and a stronger owner-facing editorial character.

A is my recommendation for reception work because its hierarchy extends directly into task lists, evidence and work-order records. B is a distinct alternative if the owner wants a more editorial character. Both are proposals requiring explicit approval. A combined direction would need its own reviewable revision.

## What remains constant

Both proposals use the existing Raymond Gray logo files and exactly the same `apps/web/assets/sign-in/workshop-portrait.png`. No new imagery was generated. The workshop image remains a generated decorative concept, not evidence of an actual named facility. There are no fabricated business metrics, customer records or performance claims.

The operational excerpt illustrates an empty queue, independent gate labels and truthful draft/hold language. It does not prove workflow implementation. Google, passkey and password controls in the proposals are static visual specimens of requested functionality. They neither collect credentials nor invoke authentication.

## Render checks

Headless Microsoft Edge rendered all three directions using the bundled Playwright runtime. At 320, 390, 768, 1280 and 1920 pixel viewport widths, all assets decoded and the page had no horizontal document overflow. No JavaScript page errors were recorded. The phone preview reflowed independently through CSS container queries. Clicking a mock control displayed the explicit nonfunctional-preview notice.

I inspected the rendered A, B and phone screenshots. The proposals are distinct in composition and typography, while the logo and uncropped portrait remain legible. This bounded check is not a full accessibility audit, real-device validation, provider integration test or operational acceptance.

Rendered snapshots:

- [Current baseline](review-baseline.png)
- [A, Service ledger](review-ledger.png)
- [B, Editorial record](review-editorial.png)
- [A at phone width](review-ledger-phone.png)

## Owner decision — 8 November 2026

The owner selected the current Workshop desk baseline after reviewing both visual studies. Keep the existing charcoal/workshop image panel, transparent brand mark, white form and current typography/layout character. Improve the sign-in page and add the approved sign-in options within this baseline. Do not apply the Service ledger or Editorial directions.

The owner also asked for more color later through small sticker/tag accents or thin card/section highlights rather than fully colored boxes. This styling is deferred; keep the page as it is visually for now. Any later palette and status-color proposal needs owner review, accessible contrast and states that remain understandable without color alone.

Functional responsive work, authentication and permission checks continue under their existing authorisation. The decision selects a visual baseline; it does not mark the implementation audit trail, provider integrations or real-device verification complete.

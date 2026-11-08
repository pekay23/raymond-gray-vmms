# Raymond Gray portal visual assets

The owner directed reuse of the main project's logos, icons and browser tab assets, then requested a generated workshop image for the dark sign-in panel and a logo without an opaque background.

## Brand sources

Copy original brand files from `C:/Projects/raymond-gray-platform/public` without changing the emblem or wordmark. The light-context horizontal logo is `images/logos/RaymondgraylogoNoBG.png`. The dark-context variant is `images/logos/Raymondgraylogo169WhiteNoBG.png`. Both contain a genuine alpha channel. The rendered page must use the transparent files without a white CSS plate.

The icon sources are `favicon.ico`, `favicon-32x32.png`, `favicon-16x16.png` and `apple-touch-icon.png`. Their VMMS copies live at the web app's public root. Logos live under `apps/web/public/brand`. Browser checks verify delivery and actual image decoding; a filename alone does not prove a transparent or legible result.

## Generated background

The built-in image generation tool produced four source masters, retained under `apps/web/assets/sign-in`: portrait, square, panorama and the original sign-in composition. The generated originals are kept separately under the Codex generated-images directory. This is a decorative concept photograph, not evidence of Raymond Gray's actual facility, equipment, staff or vehicle inventory. The logo and all text are separate HTML/image elements.

`apps/web/scripts/build-images.mjs` uses the pinned Sharp dependency to build AVIF and WebP derivatives into `apps/web/public/images/workshop`; the generated manifest is `apps/web/src/generated/workshop-images.json`. It records source and output SHA-256 hashes, dimensions and byte sizes. The pipeline does not enlarge, crop or stretch a source and skips unchanged outputs. The current set contains 20 derivatives across the portrait, square and panorama masters, with widths up to 1440 pixels where the source permits. Total generated delivery image size is 632,804 bytes in the verified generation run. Rebuild with `npm run assets:generate --workspace @vmms/web`.

`WorkshopPicture` selects portrait, panorama or square compositions based on viewport width and aspect ratio, then uses responsive `srcset` selection. The whole workshop/car composition uses contained rendering. The adaptive selection and 15 viewport/orientation cases have passed the responsive harness; browser-level 200% and 400% zoom evidence is pending and must not be inferred from resized viewport tests. Device and operating-system validation remains separate from these browser checks.

The base generation prompt for the related workshop image family was:

> Use case: photorealistic-natural. Asset type: background photograph for the dark left panel of the Raymond Gray vehicle maintenance portal sign-in page. Generate a refined editorial automotive workshop interior, a modern multi-brand EV service bay, with a graphite electric car seen at a three-quarter rear angle in the lower right half and precise workshop architecture receding into the distance. Portrait 3:4 composition designed for a tall login panel. The entire upper left quarter must remain quiet, deep charcoal and nearly black so a separately overlaid transparent red emblem and blue/white wordmark can stay readable. The mid-left area must be dark and uncluttered for large white text. Put the recognisable vehicle and workshop details mainly in the lower right and bottom half, with soft natural workshop light, subtle cool steel reflections and warm neutral highlights. Professional, realistic, restrained, detailed photographic textures, believable vehicle proportions, no people, no exaggerated neon, no decorative circuitry, no gradients as graphic art. Do not render any text, logos, brand names, signage, UI, buttons or watermarks. This is a decorative concept image, not a depiction of an actual named facility.

Use it only as a decorative sign-in background with empty alternative text. Preserve readable white text, visible brand colors, a usable login form and a compact phone layout. The fallback is a dark neutral background if the photograph cannot load. Do not bake interface text or the logo into the generated photograph.

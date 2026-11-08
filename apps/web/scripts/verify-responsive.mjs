import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const modulePath = process.argv[2];
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
const channel = process.env.VMMS_BROWSER_CHANNEL || "msedge";
const url = process.env.VMMS_WEB_URL || "http://127.0.0.1:5173";
const output = resolve(root, "test-results/responsive");
const manifest = JSON.parse(await readFile(resolve(root, "src/generated/workshop-images.json"), "utf8"));
await mkdir(output, { recursive: true });
const checks = [];
const errors = [];
const browser = await chromium.launch({ headless: true, channel });

async function inspect(page, label, expectedZoom = 1) {
  await page.getByRole("heading", { name: "Sign in to VMMS" }).waitFor();
  await page.locator(".sign-in-picture img").evaluate((image) => image.decode());
  const geometry = await page.evaluate(() => {
    const image = document.querySelector(".sign-in-picture img");
    const logo = document.querySelector('img[alt="Raymond Gray"]');
    const main = document.querySelector("main");
    if (!(image instanceof HTMLImageElement) || !(logo instanceof HTMLImageElement) || !(main instanceof HTMLElement)) throw new Error("The sign-in page is incomplete");
    const logoBounds = logo.getBoundingClientRect();
    const mainBounds = main.getBoundingClientRect();
    const controls = [...main.querySelectorAll("input, button, a[href]")].map((element) => {
      const rect = element.getBoundingClientRect();
      return { name: element.getAttribute("aria-label") || element.getAttribute("id") || element.textContent?.trim(), width: rect.width, height: rect.height, left: rect.left, right: rect.right };
    });
    return {
      cssWidth: window.innerWidth,
      outerWidth: window.outerWidth,
      dpr: window.devicePixelRatio,
      scrollWidth: document.documentElement.scrollWidth,
      image: { src: image.currentSrc, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, fit: getComputedStyle(image).objectFit },
      logo: { width: logoBounds.width, height: logoBounds.height, naturalWidth: logo.naturalWidth, naturalHeight: logo.naturalHeight, left: logoBounds.left, right: logoBounds.right },
      main: { left: mainBounds.left, right: mainBounds.right }, controls,
    };
  });
  assert(geometry.scrollWidth <= geometry.cssWidth + 1, `${label}: horizontal overflow`);
  assert.equal(geometry.image.fit, "contain", `${label}: image must preserve the full composition`);
  assert(/\.(avif|webp)$/.test(geometry.image.src), `${label}: unoptimised source selected`);
  const selected = Object.values(manifest.variants).flatMap((variant) => [...variant.webp, ...variant.avif]).find((image) => geometry.image.src.endsWith(image.src));
  assert(selected, `${label}: delivery image is absent from manifest`);
  assert(Math.abs(geometry.logo.width / geometry.logo.height - geometry.logo.naturalWidth / geometry.logo.naturalHeight) < 0.02, `${label}: logo is distorted`);
  assert(geometry.logo.left >= -1 && geometry.logo.right <= geometry.cssWidth + 1, `${label}: logo is cropped`);
  assert(geometry.main.left >= -1 && geometry.main.right <= geometry.cssWidth + 1, `${label}: main content exceeds viewport`);
  for (const control of geometry.controls) {
    assert(control.height >= 43.5, `${label}: ${control.name} has a small touch target`);
    assert(control.left >= -1 && control.right <= geometry.cssWidth + 1, `${label}: ${control.name} exceeds viewport`);
  }
  assert(Math.abs(geometry.dpr - expectedZoom) < 0.1, `${label}: actual browser zoom was not applied`);
  if (expectedZoom !== 1) assert(Math.abs(geometry.cssWidth * expectedZoom - geometry.outerWidth) < 30, `${label}: browser zoom did not reflow the viewport`);
  await page.screenshot({ path: resolve(output, `${label}.png`), fullPage: true });
  checks.push({ name: label, result: "VERIFIED", ...geometry, selectedBytes: selected.bytes });
  process.stdout.write(`VERIFIED ${label}: ${geometry.cssWidth}px, ${selected.src}, ${selected.bytes} bytes\n`);
  return geometry;
}

try {
  const viewports = [
    ["phone-280", 280, 653], ["phone-320", 320, 568], ["phone-390", 390, 844],
    ["fold-540", 540, 720], ["tablet-768", 768, 1024], ["fold-820", 820, 1180],
    ["tablet-1024", 1024, 768], ["desktop-1440", 1440, 1000],
    ["desktop-1920", 1920, 1080], ["desktop-2560", 2560, 1440],
    ["phone-landscape-568", 568, 320], ["phone-landscape-844", 844, 390],
    ["fold-landscape-720", 720, 540], ["fold-landscape-1180", 1180, 820],
    ["desktop-wide-2560", 2560, 1080],
  ];
  for (const [label, width, height] of viewports) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push({ label, message: error.message }));
    await page.goto(url);
    await inspect(page, label);
    await context.close();
  }
  await browser.close();
  for (const zoom of [2, 4]) {
    const label = `browser-zoom-${zoom * 100}`;
    const profile = await mkdtemp(resolve(tmpdir(), "vmms-responsive-zoom-"));
    await mkdir(resolve(profile, "Default"), { recursive: true });
    await writeFile(resolve(profile, "Default/Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: Math.log(zoom) / Math.log(1.2) } } }));
    let context;
    try {
      context = await chromium.launchPersistentContext(profile, {
        headless: true, channel, viewport: null,
        args: ["--window-size=1440,1000", "--force-device-scale-factor=1"],
      });
      const page = context.pages()[0] || await context.newPage();
      page.on("pageerror", (error) => errors.push({ label, message: error.message }));
      await page.goto(url);
      await inspect(page, label, zoom);
    } finally {
      await context?.close();
      assert.equal(dirname(profile), resolve(tmpdir()));
      assert(basename(profile).startsWith("vmms-responsive-zoom-"));
      await rm(profile, { recursive: true, force: true });
    }
  }
  assert.deepEqual(errors, [], "Uncaught page errors occurred");
} catch (error) {
  checks.push({ name: "Responsive verification", result: "NOT VERIFIED", message: error.message });
  process.exitCode = 1;
  process.stderr.write(`${error.stack}\n`);
} finally {
  await browser.close().catch(() => {});
  await writeFile(resolve(output, "results.json"), JSON.stringify({ recordedAt: new Date().toISOString(), url, scope: "Local Edge desktop sign-in viewport and native browser-zoom checks only. No physical-device, folding hinge, iOS/Safari, Android, HarmonyOS or other OS acceptance claim.", checks, pageErrors: errors }, null, 2) + "\n");
}

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const modulePath = process.argv.slice(2).find(argument => !argument.startsWith("--"));
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
const channel = process.env.VMMS_BROWSER_CHANNEL || "msedge";
let url = process.env.VMMS_WEB_URL;
let vite;
const output = resolve(root, "../../docs/verification/browser/responsive-image-audit");
const reportPath = resolve(root, "../../docs/verification/checks/responsive-image-audit-2026-11-10.json");
const manifest = JSON.parse(await readFile(resolve(root, "src/generated/workshop-images.json"), "utf8"));
const brandManifest = JSON.parse(await readFile(resolve(root, "src/generated/brand-images.json"), "utf8"));
await mkdir(output, { recursive: true });
await mkdir(dirname(reportPath), { recursive: true });
const checks = [];
const errors = [];
const screenshotFiles = [];
const browser = await chromium.launch({ headless: true, channel });
const screenshotLabels = new Set(["phone-390", "fold-820", "desktop-1440", "phone-retina-390", "desktop-retina-1440", "workspace-regular-logo", "browser-zoom-400", "owner-sign-in-browser-zoom-400"]);

async function saveScreenshot(page, label) {
  const path = resolve(output, `${label}.png`);
  await page.screenshot({ path, fullPage: true });
  screenshotFiles.push(`docs/verification/browser/responsive-image-audit/${label}.png`);
}

function captureImageResponses(page) {
  const bytesByPath = new Map();
  const pending = [];
  page.on("response", (response) => {
    if (response.request().resourceType() !== "image") return;
    const path = new URL(response.url()).pathname;
    if (!path.startsWith("/images/workshop/") && !path.startsWith("/brand/optimized/") && !path.startsWith("/brand/raymond-gray-logo")) return;
    const readBody = response.body().then((body) => bytesByPath.set(path, body.byteLength)).catch(() => {});
    pending.push(readBody);
  });
  return { bytesByPath, settle: () => Promise.all(pending) };
}

async function useUnauthenticatedSessions(page) {
  await page.route("**/api/v1/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.route("**/api/v1/owner/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: false }),
  }));
}

function manifestImage(path) {
  return Object.values(manifest.variants).flatMap((variant) => [...variant.webp, ...variant.avif]).find((image) => image.src === path);
}

function manifestBrandImage(path) {
  for (const variant of Object.values(brandManifest.variants)) {
    const image = variant.webp.find((item) => item.src === path);
    if (image) return { ...image, bytes: image.bytes };
    if (variant.fallback === path) {
      const source = brandManifest.inputs.find((input) => `/brand/${input.file}` === path);
      if (source) return { src: path, width: source.width, height: source.height, bytes: source.bytes };
    }
  }
  return undefined;
}

async function inspect(page, label, expectedZoom = 1, audience = "staff", expectedDpr = 1, imageResponses) {
  await page.getByRole("heading", { name: audience === "owner" ? "Vehicle owner sign in" : "Sign in to VMMS" }).waitFor();
  await page.locator(".sign-in-picture img").evaluate((image) => image.decode());
  await page.locator('img[alt="Raymond Gray"]').evaluate((image) => image.decode());
  await imageResponses.settle();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const geometry = await page.evaluate(() => {
    const image = document.querySelector(".sign-in-picture img");
    const logo = document.querySelector('img[alt="Raymond Gray"]');
    const main = document.querySelector("main");
    if (!(image instanceof HTMLImageElement) || !(logo instanceof HTMLImageElement) || !(main instanceof HTMLElement)) throw new Error("The sign-in page is incomplete");
    const logoBounds = logo.getBoundingClientRect();
    const mainBounds = main.getBoundingClientRect();
    const controls = [...main.querySelectorAll("input, button, a[href]")].map((element) => {
      const rect = element.getBoundingClientRect();
              const labelText = element instanceof HTMLInputElement
                ? [...(element.labels ?? [])].map((label) => label.textContent?.trim()).filter(Boolean).join(" ")
                : "";
              const name = element.getAttribute("aria-label") || labelText || element.getAttribute("id") || element.textContent?.trim() || "";
              return { name, width: rect.width, height: rect.height, left: rect.left, right: rect.right };
    });
    return {
      cssWidth: window.innerWidth,
      outerWidth: window.outerWidth,
      dpr: window.devicePixelRatio,
      scrollWidth: document.documentElement.scrollWidth,
      image: { src: image.currentSrc, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, fit: getComputedStyle(image).objectFit },
      logo: { src: logo.currentSrc, width: logoBounds.width, height: logoBounds.height, naturalWidth: logo.naturalWidth, naturalHeight: logo.naturalHeight, left: logoBounds.left, right: logoBounds.right },
      layoutShift: window.__vmmsLayoutShift ?? 0,
      main: { left: mainBounds.left, right: mainBounds.right }, controls,
    };
  });
  assert(geometry.scrollWidth <= geometry.cssWidth + 1, `${label}: horizontal overflow`);
  assert.equal(geometry.image.fit, "contain", `${label}: image must preserve the full composition`);
  assert(/\.(avif|webp)$/.test(geometry.image.src), `${label}: unoptimised source selected`);
  const selected = manifestImage(new URL(geometry.image.src).pathname);
  assert(selected, `${label}: delivery image is absent from manifest`);
  const selectedLogo = manifestBrandImage(new URL(geometry.logo.src).pathname);
  assert(selectedLogo, `${label}: brand logo is absent from manifest`);
  const backgroundResponseBytes = imageResponses.bytesByPath.get(new URL(geometry.image.src).pathname);
  const logoResponseBytes = imageResponses.bytesByPath.get(new URL(geometry.logo.src).pathname);
  assert.equal(imageResponses.bytesByPath.size, 2, `${label}: the page must load only its selected workshop image and logo`);
  assert.equal(backgroundResponseBytes, selected.bytes, `${label}: workshop image response bytes differ from its manifest`);
  assert.equal(logoResponseBytes, selectedLogo.bytes, `${label}: logo response bytes differ from its manifest`);
  assert(backgroundResponseBytes <= 90 * 1024, `${label}: selected workshop image exceeds the 90 KiB budget`);
  assert(logoResponseBytes <= 45 * 1024, `${label}: selected logo exceeds the 45 KiB budget`);
  assert(backgroundResponseBytes + logoResponseBytes <= 135 * 1024, `${label}: above-fold image total exceeds the 135 KiB budget`);
  // naturalHeight is rounded to whole CSS pixels by the browser, so compare the
  // rendered box with the manifest's source dimensions instead.
  assert(Math.abs(geometry.logo.width / geometry.logo.height - selectedLogo.width / selectedLogo.height) < 0.025, `${label}: logo aspect ratio differs from its optimized source: ${JSON.stringify({ logo: geometry.logo, source: { width: selectedLogo.width, height: selectedLogo.height } })}`);
  assert(geometry.logo.left >= -1 && geometry.logo.right <= geometry.cssWidth + 1, `${label}: logo is cropped`);
  assert(geometry.main.left >= -1 && geometry.main.right <= geometry.cssWidth + 1, `${label}: main content exceeds viewport`);
  for (const control of geometry.controls) {
    assert(control.name.trim().length > 0, `${label}: interactive control has no accessible name`);
    assert(control.height >= 43.5, `${label}: ${control.name} has a small touch target`);
    assert(control.left >= -1 && control.right <= geometry.cssWidth + 1, `${label}: ${control.name} exceeds viewport`);
  }
  assert(Math.abs(geometry.dpr - expectedZoom * expectedDpr) < 0.1, `${label}: actual browser zoom or device scale was not applied`);
  if (expectedZoom !== 1) assert(Math.abs(geometry.cssWidth * expectedZoom - geometry.outerWidth) < 30, `${label}: browser zoom did not reflow the viewport`);
  assert(geometry.layoutShift <= 0.01, `${label}: sign-in layout shift ${geometry.layoutShift} exceeds 0.01`);
  if (screenshotLabels.has(label)) await saveScreenshot(page, label);
  checks.push({ name: label, result: "VERIFIED", ...geometry, imageResponses: { workshopBytes: backgroundResponseBytes, logoBytes: logoResponseBytes, aboveFoldBytes: backgroundResponseBytes + logoResponseBytes }, selectedWorkshopBytes: selected.bytes, selectedLogoBytes: selectedLogo.bytes });
  process.stdout.write(`VERIFIED ${label}: ${geometry.cssWidth}px at DPR ${geometry.dpr}, workshop ${backgroundResponseBytes} bytes, logo ${logoResponseBytes} bytes, layout shift ${geometry.layoutShift}\n`);
  return geometry;
}

try {
  if (!url) {
    vite = await createServer({ root, configFile: resolve(root, "vite.config.ts"), server: { host: "127.0.0.1", port: 0, strictPort: false } });
    await vite.listen();
    const address = vite.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Could not resolve the isolated responsive-test server address.");
    url = `http://127.0.0.1:${address.port}`;
  }
  const target = new URL(url);
  assert(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname), "Responsive verification must use a loopback web origin.");
  const viewports = [
    ["phone-280", 280, 653], ["phone-320", 320, 568], ["phone-390", 390, 844],
    ["fold-540", 540, 720], ["tablet-768", 768, 1024], ["fold-820", 820, 1180],
    ["tablet-1024", 1024, 768], ["desktop-1440", 1440, 1000],
    ["desktop-1920", 1920, 1080], ["desktop-2560", 2560, 1440],
    ["phone-landscape-568", 568, 320], ["phone-landscape-844", 844, 390],
    ["fold-landscape-720", 720, 540], ["fold-landscape-1180", 1180, 820],
    ["desktop-wide-2560", 2560, 1080],
    ["phone-retina-390", 390, 844, 2], ["desktop-retina-1440", 1440, 1000, 2],
  ];
  const focusedViewport = process.argv.find(argument => argument.startsWith("--viewport="))?.slice("--viewport=".length);
  const selectedViewports = focusedViewport ? viewports.filter(([label]) => label === focusedViewport) : viewports;
  assert(!focusedViewport || selectedViewports.length === 1, `Unknown responsive viewport: ${focusedViewport}`);
  for (const [label, width, height, dpr = 1] of selectedViewports) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    await useUnauthenticatedSessions(page);
    await page.addInitScript(() => {
      window.__vmmsLayoutShift = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__vmmsLayoutShift += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    const imageResponses = captureImageResponses(page);
    page.on("pageerror", (error) => errors.push({ label, message: error.message }));
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await inspect(page, label, 1, "staff", dpr, imageResponses);
    await context.close();
  }
  const noSiteContext = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2 });
  try {
    const page = await noSiteContext.newPage();
    await page.addInitScript(() => {
      window.__vmmsLayoutShift = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__vmmsLayoutShift += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    const imageResponses = captureImageResponses(page);
    page.on("pageerror", (error) => errors.push({ label: "workspace-regular-logo", message: error.message }));
    await page.route("**/api/v1/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true, user: { id: "10000000-0000-4000-8000-000000000001", displayName: "Synthetic staff" }, sites: [] }) }));
    await page.route("**/api/v1/owner/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: false }) }));
    await page.goto(`${url}/?audience=staff`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByRole("heading", { name: "You do not have service-centre access yet" }).waitFor();
    const logo = page.locator('img[alt="Raymond Gray"]');
    await logo.evaluate((image) => image.decode());
    await imageResponses.settle();
    const geometry = await logo.evaluate((image) => {
      const bounds = image.getBoundingClientRect();
      return { src: image.currentSrc, width: bounds.width, height: bounds.height, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, layoutShift: window.__vmmsLayoutShift ?? 0 };
    });
    const selectedLogo = manifestBrandImage(new URL(geometry.src).pathname);
    assert(selectedLogo, "workspace-regular-logo: logo source is absent from manifest");
    assert.equal(imageResponses.bytesByPath.size, 1, "workspace-regular-logo: no-site page must load only its logo");
    assert.equal(imageResponses.bytesByPath.get(new URL(geometry.src).pathname), selectedLogo.bytes, "workspace-regular-logo: logo response bytes differ from its manifest");
    assert(imageResponses.bytesByPath.get(new URL(geometry.src).pathname) <= 45 * 1024, "workspace-regular-logo: logo exceeds the 45 KiB budget");
    assert(Math.abs(geometry.width - 176) < 1, `workspace-regular-logo: expected 176px regular logo, got ${geometry.width}px`);
    assert(Math.abs(geometry.width / geometry.height - selectedLogo.width / selectedLogo.height) < 0.02, "workspace-regular-logo: logo is distorted");
    assert(geometry.layoutShift <= 0.01, `workspace-regular-logo: layout shift ${geometry.layoutShift} exceeds 0.01`);
    await saveScreenshot(page, "workspace-regular-logo");
    checks.push({ name: "workspace-regular-logo", result: "VERIFIED", ...geometry, logoBytes: imageResponses.bytesByPath.get(new URL(geometry.src).pathname), scope: "Authenticated staff account with no assigned site" });
    process.stdout.write(`VERIFIED workspace-regular-logo: ${geometry.width}px, ${selectedLogo.bytes} bytes, layout shift ${geometry.layoutShift}\n`);
  } finally {
    await noSiteContext.close();
  }
  await browser.close();
  for (const audience of ["staff", "owner"]) {
    for (const zoom of [2, 4]) {
    const label = `${audience === "owner" ? "owner-sign-in-" : ""}browser-zoom-${zoom * 100}`;
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
      await useUnauthenticatedSessions(page);
      await page.addInitScript(() => {
        window.__vmmsLayoutShift = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__vmmsLayoutShift += entry.value;
        }).observe({ type: "layout-shift", buffered: true });
      });
      const imageResponses = captureImageResponses(page);
      page.on("pageerror", (error) => errors.push({ label, message: error.message }));
      await page.goto(audience === "owner" ? `${url}/?audience=owner` : url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await inspect(page, label, zoom, audience, 1, imageResponses);
    } finally {
      await context?.close();
      assert.equal(dirname(profile), resolve(tmpdir()));
      assert(basename(profile).startsWith("vmms-responsive-zoom-"));
      await rm(profile, { recursive: true, force: true });
    }
  }
  }
  assert.deepEqual(errors, [], "Uncaught page errors occurred");
} catch (error) {
  checks.push({ name: "Responsive verification", result: "NOT VERIFIED", message: error.message });
  process.exitCode = 1;
  process.stderr.write(`${error.stack}\n`);
} finally {
  await browser.close().catch(() => {});
  await vite?.close();
  await writeFile(reportPath, JSON.stringify({ recordedAt: new Date().toISOString(), url, budgets: { workshopImageBytes: 90 * 1024, logoBytes: 45 * 1024, aboveFoldImageBytes: 135 * 1024, layoutShift: 0.01 }, screenshotFiles, scope: "Local Edge sign-in image selection and response-body-byte checks at 17 emulated viewports, including DPR 2, plus the authenticated no-site staff state regular logo and staff/owner 200% and 400% native browser zoom. No physical-device, folding hinge, iOS/Safari, Android, HarmonyOS, other OS or throttled-network acceptance claim.", checks, pageErrors: errors }, null, 2) + "\n");
}

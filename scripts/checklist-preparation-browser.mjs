import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const root = resolve(import.meta.dirname, "..");
const siteId = "10000000-0000-4000-8000-000000000001";
const workOrderId = "20000000-0000-4000-8000-000000000001";
const templateRevisionId = "30000000-0000-4000-8000-000000000001";
const checklistId = "40000000-0000-4000-8000-000000000001";
const fixtureHtmlPath = resolve(root, "apps/web/test/checklist-preparation.html");
const now = "2026-11-19T12:00:00.000Z";
const commands = [];
let prepared = false;
let vite;
let browser;
const pageErrors = [];

function checklistRows() {
  return prepared ? [{ id: checklistId, kind: "routine-maintenance", state: "draft", version: 1,
    scheduleBasis: "unknown", templateCode: "BYD-SEALION-06-RM", templateRevision: 3,
    templateRevisionId, odometerAtStartKm: 12000, createdAt: now }] : [];
}

try {
  await rm(fixtureHtmlPath, { force: true });
  await writeFile(fixtureHtmlPath, "<!doctype html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1.0\"><title>Maintenance checklist preparation verification</title></head><body><div id=\"root\"></div><script type=\"module\" src=\"./checklist-preparation.tsx\"></script></body></html>\n");
  vite = await createServer({ configFile: resolve(root, "apps/web/vite.config.ts"), root: resolve(root, "apps/web"),
    server: { host: "127.0.0.1", port: 0, strictPort: false }, logLevel: "error" });
  await vite.listen();
  const address = vite.httpServer.address();
  assert(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true, channel: process.env.VMMS_BROWSER_CHANNEL || "msedge" });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await context.route("**/api/v1/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const checklistPath = `/api/v1/sites/${siteId}/work-orders/${workOrderId}/checklists`;
    if (url.pathname !== checklistPath) return route.fulfill({ status: 404, contentType: "application/json",
      body: JSON.stringify({ error: { code: "NOT_STUBBED", message: "No synthetic response is configured." } }) });
    if (request.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json",
      headers: { "cache-control": "no-store" }, body: JSON.stringify({
        workOrderId, workOrderVersion: 4,
        vehicle: { make: "BYD", model: "Sealion 06", variant: "DM-i", powertrain: "HYB" },
        checklists: checklistRows(),
        availableTemplates: [{ id: templateRevisionId, code: "BYD-SEALION-06-RM", revision: 3,
          kind: "routine-maintenance", make: "BYD", model: "Sealion 06", variant: "DM-i", powertrain: "HYB",
          effectiveFrom: "2026-10-01T00:00:00.000Z" }],
        canPrepare: true, prepareBlockReason: null, unavailableReason: null,
        pagination: { page: 1, pageSize: 10, totalItems: checklistRows().length, totalPages: checklistRows().length ? 1 : 0 },
      }) });
    assert.equal(request.method(), "POST");
    const body = request.postDataJSON();
    const commandId = request.headers()["idempotency-key"];
    assert.ok(commandId, "Checklist draft preparation must carry an idempotency key.");
    commands.push({ commandId, body });
    if (commands.length === 1) {
      prepared = true;
      return route.abort("failed");
    }
    assert.equal(commandId, commands[0].commandId, "Retry after a lost response must reuse the same command ID.");
    assert.deepEqual(body, commands[0].body, "Retry after a lost response must reuse the exact command body.");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workOrderId,
      checklist: { id: checklistId, kind: "routine-maintenance", state: "draft", version: 1,
        scheduleBasis: "unknown", odometerAtStartKm: 12000, templateRevisionId, createdAt: now } }) });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`${origin}/test/checklist-preparation.html`, { waitUntil: "domcontentloaded" });
  const panel = page.getByRole("region", { name: "Routine maintenance" });
  await panel.getByText("Approved routine maintenance lists for this vehicle", { exact: true }).waitFor();
  await panel.getByText("The 10,000 km or 12-month reminder does not decide which work to perform.", { exact: false }).waitFor();
  await panel.getByText("Preparing a draft does not record customer consent or authorize inspection or repair.", { exact: false }).waitFor();
  await panel.getByRole("button", { name: "Prepare draft", exact: true }).click();
  await panel.getByRole("alert").waitFor();
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].body, { expectedWorkOrderVersion: 4, templateRevisionId, scheduleBasis: "unknown" });
  await panel.getByRole("button", { name: "Prepare draft", exact: true }).click();
  await page.getByText("Checklist draft prepared. It does not authorize work.", { exact: true }).waitFor();
  await panel.getByText("Draft only. VMMS cannot start this checklist yet.", { exact: false }).waitFor();
  await panel.getByText("A checklist already exists for this revision", { exact: true }).waitFor();
  assert.equal(commands.length, 2);

  const checks = [];
  for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert(geometry.document <= geometry.viewport + 1, `Checklist page overflows at ${width}px.`);
    checks.push({ name: `No horizontal overflow at ${width}px`, result: "VERIFIED" });
  }
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  assert.deepEqual(axe.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(node => node.target) })), [],
    "Checklist preparation page has automated WCAG 2.1 A/AA violations.");
  assert.deepEqual(pageErrors, [], `Browser errors: ${pageErrors.join("; ")}`);
  checks.push({ name: "Checklist draft preparation uses a stable idempotency key after a lost response", result: "VERIFIED" });
  checks.push({ name: "A prepared checklist stays visibly draft-only and does not authorize work", result: "VERIFIED" });
  checks.push({ name: "Automated WCAG 2.1 A/AA scan passes", result: "VERIFIED" });
  const report = { recordedAt: new Date().toISOString(), result: "PASS", browser: `Chromium ${browser.version()}`,
    checks, commandCount: commands.length, axeViolations: axe.violations.length, pageErrors,
    limitations: ["The browser uses synthetic API responses; server authorization, transaction, and audit behavior are covered separately by disposable-PostgreSQL tests.", "This is not staff UAT or production verification."] };
  await mkdir(resolve(root, "docs/verification"), { recursive: true });
  await writeFile(resolve(root, "docs/verification/checklist-preparation-browser-2026-11-19.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await context.close();
} finally {
  await browser?.close();
  await vite?.close();
  await rm(fixtureHtmlPath, { force: true });
}

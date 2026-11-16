import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
process.loadEnvFile(resolve(root, '.env'));
const modulePath = process.argv[2];
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const { default: AxeBuilder } = await import('@axe-core/playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.VMMS_BROWSER_CHANNEL || 'msedge' });
const output = resolve(root, process.env.VMMS_BROWSER_OUTPUT_DIR || 'docs/verification/browser');
await mkdir(output, { recursive: true });
const checks = [];
const errors = [];
const accessibilityScans = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => {
  window.__vmmsBarcodeValue = '1HGCM82633A004352';
  window.__vmmsDelayCamera = false;
  window.__vmmsDenyCamera = false;
  window.__vmmsCameraRequestCount = 0;
  window.__vmmsDetectorSawStream = false;
  window.__vmmsCameraTrackStopped = false;
  window.__vmmsResolveCamera = null;
  window.__vmmsBarcodeDetector = class {
      static async getSupportedFormats() { return ['code_39', 'code_128', 'data_matrix', 'qr_code']; }
      async detect(video) {
        window.__vmmsDetectorSawStream = video.srcObject instanceof MediaStream;
        return [{ rawValue: window.__vmmsBarcodeValue }];
      }
  };
  Object.defineProperty(window, 'BarcodeDetector', { configurable: true, writable: true, value: window.__vmmsBarcodeDetector });
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    configurable: true,
    value: () => {
      window.__vmmsCameraRequestCount += 1;
      if (window.__vmmsDenyCamera) return Promise.reject(new DOMException('Synthetic camera permission denial', 'NotAllowedError'));
      return new Promise((resolve) => {
        const openStream = () => {
          window.__vmmsCameraTrackStopped = false;
          const stream = new MediaStream();
          const track = { stop: () => { window.__vmmsCameraTrackStopped = true; } };
          Object.defineProperty(stream, 'getTracks', { value: () => [track] });
          resolve(stream);
        };
        if (window.__vmmsDelayCamera) window.__vmmsResolveCamera = openStream;
        else openStream();
      });
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
    configurable: true,
    get: () => HTMLMediaElement.HAVE_ENOUGH_DATA,
  });
  HTMLVideoElement.prototype.play = async () => {};
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', (error) => errors.push(error.message));
const url = process.env.VMMS_WEB_URL || 'http://127.0.0.1:5173';
const isLoopback = (hostname) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
const webOrigin = new URL(url);
const oidcIssuer = new URL(process.env.OIDC_ISSUER || '');
const database = new URL(process.env.DATABASE_URL || '');
assert(isLoopback(webOrigin.hostname), 'Browser smoke tests must target a local VMMS instance.');
assert(isLoopback(oidcIssuer.hostname), 'Browser smoke tests must use a local OIDC provider.');
assert(isLoopback(database.hostname), 'Browser smoke tests must use a local development database.');
assert(process.env.OIDC_DEV_TEST_PASSWORD, 'The local synthetic OIDC account is not provisioned.');
const check = (name) => {
  checks.push({ name, result: 'VERIFIED', at: new Date().toISOString() });
  process.stdout.write(`VERIFIED: ${name}\n`);
};
async function verifyAccessibility(pageName) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const violations = result.violations.map(({ id, impact, description, help, nodes }) => ({
    id, impact, description, help,
    nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
  }));
  accessibilityScans.push({ page: pageName, violations });
  assert.deepEqual(violations, [], `${pageName} has accessibility violations: ${JSON.stringify(violations)}`);
  check(`Automated WCAG 2.1 A/AA accessibility scan passes on ${pageName}`);
}
const authenticatedViewportMatrix = [
  { width: 280, height: 653, name: 'compact phone' },
  { width: 320, height: 568, name: 'small phone' },
  { width: 390, height: 844, name: 'phone' },
  { width: 344, height: 882, name: 'folded device' },
  { width: 673, height: 841, name: 'unfolded device' },
  { width: 540, height: 720, name: 'large phone landscape' },
  { width: 768, height: 1024, name: 'tablet portrait' },
  { width: 820, height: 1180, name: 'large tablet portrait' },
  { width: 1024, height: 768, name: 'tablet landscape' },
  { width: 1023, height: 768, name: 'compact navigation before desktop rail' },
  { width: 1100, height: 720, name: 'narrow desktop' },
  { width: 1279, height: 800, name: 'desktop before rail breakpoint' },
  { width: 1280, height: 800, name: 'desktop at rail breakpoint' },
  { width: 1440, height: 1000, name: 'desktop' },
  { width: 1920, height: 1080, name: 'wide desktop' },
  { width: 2560, height: 1080, name: 'ultrawide desktop' },
];
async function verifyResponsiveRoute(routeName) {
  for (const viewport of authenticatedViewportMatrix) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForFunction((width) =>
      Number.parseFloat(document.documentElement.style.getPropertyValue('--vmms-visual-viewport-width')) === width,
    viewport.width);
    const layout = await page.evaluate(() => {
      const main = document.querySelector('main');
      const controls = [...(main?.querySelectorAll('a,button,input,select,textarea') ?? [])]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => {
          const box = element.getBoundingClientRect();
          const referencedName = element.getAttribute('aria-labelledby')
            ?.split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
            .filter(Boolean)
            .join(' ');
          const labels = 'labels' in element
            ? [...(element.labels ?? [])].map((label) => label.textContent?.trim() ?? '').filter(Boolean).join(' ')
            : '';
          const imageText = [...(element.querySelectorAll?.('img[alt]') ?? [])].map((image) => image.getAttribute('alt')?.trim() ?? '').filter(Boolean).join(' ');
          const name = element.getAttribute('aria-label') || referencedName || labels
            || element.textContent?.trim() || imageText || element.getAttribute('title') || '';
          return {
            name,
            left: box.left,
            right: box.right,
            height: box.height,
            isButton: element instanceof HTMLButtonElement,
          };
        });
      return { documentWidth: document.documentElement.scrollWidth, controls };
    });
    assert.equal(layout.documentWidth, viewport.width, `${viewport.name} ${routeName} page must not overflow horizontally`);
    assert(
      layout.controls.every((control) => control.name.trim().length > 0),
      `${viewport.name} ${routeName} has interactive controls without accessible names: ${JSON.stringify(layout.controls.filter((control) => !control.name.trim()))}`,
    );
    assert(
      layout.controls.every((control) => control.left >= -1 && control.right <= viewport.width + 1),
      `${viewport.name} ${routeName} controls must remain inside the viewport: ${JSON.stringify(layout.controls.filter((control) => control.left < -1 || control.right > viewport.width + 1))}`,
    );
    const navigation = await page.evaluate(() => {
      const sidebar = document.querySelector('aside');
      const nav = sidebar?.querySelector('nav[aria-label="Primary navigation"]');
      const links = [...(nav?.querySelectorAll('a') ?? [])].filter((link) => link.getClientRects().length > 0);
      const hiddenLinks = [...(nav?.querySelectorAll('a') ?? [])].filter((link) => link.getClientRects().length === 0);
      const moreDisclosure = nav?.querySelector('details > summary');
      const signOut = [...(sidebar?.querySelectorAll('button') ?? [])].find((button) => /sign out/i.test(button.textContent ?? ''));
      const rect = (element) => {
        const box = element?.getBoundingClientRect();
        return box ? { left: box.left, right: box.right, top: box.top, height: box.height } : null;
      };
      return {
        sidebarPosition: sidebar ? getComputedStyle(sidebar).position : null,
        nav: rect(nav),
        links: links.map(rect),
        hiddenLinkCount: hiddenLinks.length,
        moreDisclosure: rect(moreDisclosure),
        signOut: rect(signOut),
      };
    });
    if (viewport.width === 390 && viewport.height === 844)
      await page.screenshot({ path: resolve(output, `${routeName}-phone.png`), fullPage: true });
    if (navigation.sidebarPosition !== null) {
      assert.equal(navigation.sidebarPosition, 'sticky', `${viewport.name} ${routeName} sidebar must remain independently scrollable`);
      assert(navigation.links.length > 0, `${viewport.name} ${routeName} navigation links must remain present`);
      assert(navigation.nav && navigation.nav.height > 0, `${viewport.name} ${routeName} primary navigation must remain visible`);
      assert(navigation.links.every((link) => link && link.left >= navigation.nav.left - 1 && link.right <= navigation.nav.right + 1 && link.height > 0), `${viewport.name} ${routeName} navigation items must fit the available navigation area: ${JSON.stringify({ nav: navigation.nav, links: navigation.links.filter((link) => !link || link.left < navigation.nav.left - 1 || link.right > navigation.nav.right + 1 || link.height <= 0) })}`);
      if (navigation.hiddenLinkCount > 0) assert(navigation.moreDisclosure && navigation.moreDisclosure.height > 0, `${viewport.name} ${routeName} collapsed navigation items must have a visible disclosure control`);
      assert(navigation.signOut && navigation.signOut.height > 0, `${viewport.name} ${routeName} sign-out must remain visible`);
    }
    if (viewport.width === 390 && viewport.height === 844) {
      const smallTargets = layout.controls.filter((control) => control.isButton && control.height < 44);
      assert.deepEqual(smallTargets, [], `${routeName} phone action buttons must meet the 44-pixel minimum: ${JSON.stringify(smallTargets)}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const hasWorkspaceNavigation = await page.locator('aside nav[aria-label="Primary navigation"]').count() > 0;
  if (hasWorkspaceNavigation) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const phoneRail = await page.evaluate(() => ({
    scrollY: window.scrollY,
    navTop: document.querySelector('aside nav[aria-label="Primary navigation"]')?.getBoundingClientRect().top ?? null,
    signOutBottom: [...(document.querySelector('aside')?.querySelectorAll('button') ?? [])]
      .find((button) => /sign out/i.test(button.textContent ?? ''))?.getBoundingClientRect().bottom ?? null,
  }));
  assert(phoneRail.scrollY > 0, 'Phone intake should exercise independent page scrolling');
  assert(phoneRail.navTop !== null && phoneRail.navTop >= 0, 'Phone navigation rail should remain pinned while the intake page scrolls');
  assert(phoneRail.signOutBottom !== null && phoneRail.signOutBottom <= 844, 'Phone sign-out should remain reachable while the intake page scrolls');
  await page.evaluate(() => window.scrollTo(0, 0));
  }
  check(`Authenticated ${routeName} layout fits ${authenticatedViewportMatrix.length} phone, foldable, tablet and desktop viewports; phone buttons meet 44 pixels`);
}

async function verifyAuthenticatedZoom(routeName, pathname, audience = 'staff', prepare) {
  for (const zoom of [2, 4]) {
    const profile = await mkdtemp(join(tmpdir(), 'vmms-authenticated-zoom-'));
    let zoomContext;
    try {
      zoomContext = await chromium.launchPersistentContext(profile, {
        headless: true,
        channel: process.env.VMMS_BROWSER_CHANNEL || 'msedge',
        viewport: { width: Math.round(1440 / zoom), height: 1000 },
        args: ['--force-device-scale-factor=1'],
      });
      if (audience === 'owner') {
        await zoomContext.route(`${url}/api/v1/session`, (route) => route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ authenticated: false }),
        }));
        await zoomContext.route(`${url}/api/v1/owner/session`, (route) => route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ authenticated: true, audience: 'owner' }),
        }));
      await zoomContext.route(`${url}/api/v1/owner/vehicles`, (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'cache-control': 'no-store' },
        body: JSON.stringify({ vehicles: [{ id: '3b7c6d6e-4c50-4b34-8ecf-7f92475f67de', registration: 'QA-OWNER-01', make: 'Synthetic', model: 'Electric Touring' }] }),
      }));
      } else {
        const staffCookies = await context.cookies(`${url}/api/v1`);
        assert(staffCookies.some((cookie) => cookie.name === 'vmms_session'), 'The source browser has no staff session cookie to transfer.');
        await zoomContext.addCookies(staffCookies);
      }
      const zoomPage = zoomContext.pages()[0] || await zoomContext.newPage();
      zoomPage.setDefaultTimeout(15000);
      zoomPage.on('pageerror', (error) => errors.push(`${routeName} ${zoom * 100}%: ${error.message}`));
      if (audience === 'staff') {
        await zoomPage.goto(new URL('/api/v1/session', url).href);
        const session = JSON.parse(await zoomPage.locator('body').innerText());
        assert.equal(session.authenticated, true, `${routeName} ${zoom * 100}%: the isolated browser did not receive the signed-in staff session.`);
      }
      await zoomPage.goto(new URL(pathname, url).href);
      await zoomPage.getByRole('main').waitFor();
      await prepare?.(zoomPage);
      const layout = await zoomPage.evaluate(() => {
        const controls = [...document.querySelectorAll('a[href],button,input,select,textarea')]
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => {
            const box = element.getBoundingClientRect();
            const labelledBy = element.getAttribute('aria-labelledby')?.split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent?.trim() ?? '').filter(Boolean).join(' ');
            const labels = 'labels' in element
              ? [...(element.labels ?? [])].map((label) => label.textContent?.trim() ?? '').filter(Boolean).join(' ')
              : '';
            const imageText = [...(element.querySelectorAll?.('img[alt]') ?? [])]
              .map((image) => image.getAttribute('alt')?.trim() ?? '').filter(Boolean).join(' ');
            return {
              name: element.getAttribute('aria-label') || labelledBy || labels || element.textContent?.trim() || imageText || element.getAttribute('title') || '',
              left: box.left,
              right: box.right,
              height: box.height,
              isButton: element instanceof HTMLButtonElement,
              disabled: element instanceof HTMLButtonElement ? element.disabled : false,
            };
          });
        const clippedText = [...document.querySelectorAll('main h1,main h2,main label,main legend,main button,main a,main p,main [role="alert"],main [role="status"],.sign-in-visual h1,.sign-in-visual p,.sign-in-visual [role="status"],.sign-in-visual [role="alert"]')]
          .filter((element) => element.getClientRects().length > 0 && !element.closest('.sr-only') && getComputedStyle(element).textOverflow !== 'ellipsis')
          .flatMap((element) => {
            const bounds = element.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(element);
            return [...range.getClientRects()]
              .filter((fragment) => fragment.width > 0 && (fragment.left < bounds.left - 1 || fragment.right > bounds.right + 1))
              .map(() => element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || element.tagName);
          });
        const dpr = window.devicePixelRatio || 1;
        const visibleWidth = window.innerWidth;
        const hero = document.querySelector('.sign-in-visual');
        const heroBounds = hero?.getBoundingClientRect();
        const clippedHeroText = [...(hero?.querySelectorAll('h1,p,[role="status"],[role="alert"]') ?? [])]
          .filter((element) => element.getClientRects().length > 0)
          .flatMap((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return [...range.getClientRects()]
              .filter((fragment) => fragment.width > 0 && (fragment.left < (heroBounds?.left ?? 0) - 1 || fragment.right > (heroBounds?.right ?? visibleWidth) + 1 || fragment.right > visibleWidth + 1))
              .map(() => element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || element.tagName);
          });
        const clippedBrand = [...document.querySelectorAll('.sign-in-visual img[alt]')]
          .filter((image) => image.getClientRects().length > 0)
          .filter((image) => {
            const bounds = image.getBoundingClientRect();
            const visual = document.querySelector('.sign-in-visual').getBoundingClientRect();
            return bounds.left < visual.left - 1 || bounds.right > visual.right + 1 || bounds.right > visibleWidth + 1;
          })
          .map((image) => image.getAttribute('alt') || 'brand image');
        const signInLayout = document.querySelector('.sign-in-layout');
        const signInBounds = signInLayout?.getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          visibleWidth,
          visualScale: window.visualViewport?.scale ?? 1,
          screenWidth: window.screen.width,
          compactViewport: document.documentElement.dataset.vmmsCompactViewport === 'true',
          layoutWidth: signInBounds?.width ?? null,
          layoutTracks: signInLayout ? getComputedStyle(signInLayout).gridTemplateColumns : null,
          heroFontSize: signInLayout?.querySelector('.sign-in-visual h1') ? getComputedStyle(signInLayout.querySelector('.sign-in-visual h1')).fontSize : null,
          dpr,
          documentWidth: document.documentElement.scrollWidth,
          controls,
          clippedText,
          clippedBrand,
          clippedHeroText,
        };
      });
      assert.equal(layout.viewportWidth, Math.round(1440 / zoom), `${routeName}: ${zoom * 100}% equivalent reflow viewport was not applied`);
      assert.equal(layout.dpr, 1, `${routeName}: reflow simulation must keep the display scale at 100%`);
      assert(layout.documentWidth <= layout.viewportWidth + 1, `${routeName} ${zoom * 100}%: document overflows horizontally`);
      assert(layout.controls.every((control) => control.name.trim().length > 0), `${routeName} ${zoom * 100}%: a visible control has no accessible name`);
      assert(layout.controls.every((control) => control.left >= -1 && control.right <= layout.visibleWidth + 1), `${routeName} ${zoom * 100}%: a visible control is clipped horizontally (layout ${layout.viewportWidth}px, visible ${layout.visibleWidth}px, scale ${layout.visualScale})`);
      assert.deepEqual(layout.clippedText, [], `${routeName} ${zoom * 100}%: visible text is clipped inside its box`);
      assert.deepEqual(layout.clippedBrand, [], `${routeName} ${zoom * 100}%: the brand image is clipped by the hero or viewport`);
      assert.deepEqual(layout.clippedHeroText, [], `${routeName} ${zoom * 100}%: hero text is clipped by the hero or visible viewport (layout ${layout.viewportWidth}px, visible ${layout.visibleWidth}px, scale ${layout.visualScale})`);
      assert.equal(layout.compactViewport, layout.visibleWidth <= 640, `${routeName} ${zoom * 100}%: compact layout must follow the visible viewport`);
      if (layout.compactViewport) {
        if (layout.layoutTracks !== null) {
          assert(layout.layoutWidth <= layout.visibleWidth + 1, `${routeName} ${zoom * 100}%: sign-in page exceeds the visible width (${JSON.stringify(layout)})`);
          assert.equal(layout.layoutTracks.trim().split(/\s+/).length, 1, `${routeName} ${zoom * 100}%: sign-in page must use one column`);
          assert(Number.parseFloat(layout.heroFontSize) <= 28.1, `${routeName} ${zoom * 100}%: compact hero type did not scale to the visible viewport (${JSON.stringify(layout)})`);
        }
      }
      const smallButtons = layout.controls.filter((control) => control.isButton && !control.disabled && control.height < 43.5);
      assert.deepEqual(smallButtons, [], `${routeName} ${zoom * 100}%: an enabled button is below 44 CSS pixels`);
      await zoomPage.keyboard.press('Tab');
      const focused = await zoomPage.evaluate(() => {
        const element = document.activeElement;
        if (!(element instanceof HTMLElement)) return null;
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return { visibleFocus: element.matches(':focus-visible') && (style.outlineStyle !== 'none' || style.boxShadow !== 'none'), left: box.left, right: box.right };
      });
      assert(focused?.visibleFocus, `${routeName} ${zoom * 100}%: keyboard focus is not visible`);
      assert(focused.left >= -1 && focused.right <= layout.viewportWidth + 1, `${routeName} ${zoom * 100}%: keyboard focus is outside the viewport`);
      await zoomPage.screenshot({ path: resolve(output, `${routeName}-zoom-${zoom * 100}.png`), fullPage: true });
      check(`Authenticated ${routeName} passes ${zoom * 100}% equivalent reflow, name, clipping, target and keyboard-focus checks`);
    } finally {
      await zoomContext?.close();
      await rm(profile, { recursive: true, force: true });
    }
  }
}

async function verifyContinuousStaffNavigationResize() {
  await page.setViewportSize({ width: 1440, height: 768 });
  const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
  await collapse.click();
  const railWidth = await page.locator('#workspace-navigation').evaluate(element => element.getBoundingClientRect().width);
  assert.equal(railWidth, 88, 'The collapsed desktop rail must retain a consistent icon width.');
  assert(await page.getByRole('button', { name: 'Expand sidebar', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  check('Desktop navigation retracts to an icon rail and expands with accessible controls');
  for (const width of [280, 320, 390, 540, 768, 820, ...Array.from({ length: 11 }, (_, index) => 880 + index * 4), ...Array.from({ length: 17 }, (_, index) => 960 + index * 8), 899, 900]) {
    await page.setViewportSize({ width, height: 768 });
    if (width < 900) {
      const menu = page.getByRole('button', { name: /navigation menu/i });
      if (await menu.isVisible() && await menu.getAttribute('aria-expanded') === 'false') await menu.click();
    }
    const state = await page.evaluate(() => {
      const sidebar = document.querySelector('aside');
      const nav = sidebar?.querySelector('nav[aria-label="Primary navigation"]');
      const links = [...(nav?.querySelectorAll('a') ?? [])];
      const signOut = [...(sidebar?.querySelectorAll('button') ?? [])]
        .find((button) => /sign out/i.test(button.textContent ?? ''));
      const visible = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility === 'visible'
          && rect.width > 0 && rect.height > 0
          && rect.left >= -1 && rect.right <= window.innerWidth + 1;
      };
      const rect = (element) => {
        const box = element?.getBoundingClientRect();
        return box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null;
      };
      return {
        documentWidth: document.documentElement.scrollWidth,
        sidebar: rect(sidebar),
        sidebarPosition: sidebar ? getComputedStyle(sidebar).position : null,
        sidebarDisplay: sidebar ? getComputedStyle(sidebar).display : null,
        nav: rect(nav),
        linksVisible: links.map(visible),
        links: links.map(rect),
        signOutVisible: visible(signOut),
        signOut: rect(signOut),
      };
    });
    assert.equal(state.documentWidth, width, `${width}px resize must not create page overflow`);
    assert.equal(state.sidebarPosition, 'sticky', `${width}px navigation must remain independently scrollable`);
    assert(state.nav && state.nav.top >= -1 && state.nav.bottom <= 768, `${width}px navigation must fit the viewport`);
    assert(state.linksVisible.length > 0 && state.linksVisible.every(Boolean), `${width}px every rendered navigation link must remain visible: ${JSON.stringify(state)}`);
    assert(state.signOutVisible, `${width}px sign-out must remain visible in the viewport`);
    assert(state.signOut && state.signOut.top >= -1 && state.signOut.bottom <= 768, `${width}px sign-out must fit the viewport`);
    if (width >= 900) assert.equal(state.sidebarDisplay, 'flex', `${width}px should use the independent desktop rail`);
    else assert.equal(state.sidebarDisplay, 'grid', `${width}px should use the compact navigation bar`);
  }
  await page.setViewportSize({ width: 1024, height: 500 });
  const compactHeight = await page.evaluate(() => {
    const sidebar = document.querySelector('aside');
    const nav = sidebar?.querySelector('nav[aria-label="Primary navigation"]');
    const signOut = [...(sidebar?.querySelectorAll('button') ?? [])]
      .find((button) => /sign out/i.test(button.textContent ?? ''));
    const box = (element) => {
      const rect = element?.getBoundingClientRect();
      return rect ? { top: rect.top, bottom: rect.bottom } : null;
    };
    return {
      nav: box(nav),
      signOut: box(signOut),
      signOutVisible: !!signOut && getComputedStyle(signOut).visibility === 'visible'
        && getComputedStyle(signOut).display !== 'none'
        && signOut.getBoundingClientRect().width > 0,
    };
  });
  assert(compactHeight.signOutVisible, '500px-tall desktop rail must keep sign-out visible');
  assert(compactHeight.signOut && compactHeight.signOut.top >= -1 && compactHeight.signOut.bottom <= 500, '500px-tall desktop rail must keep sign-out within the viewport');
  assert(compactHeight.nav && compactHeight.nav.bottom <= compactHeight.signOut.top, '500px-tall desktop navigation must end above the pinned account controls');
  await page.setViewportSize({ width: 1440, height: 1000 });
  check('Sidebar navigation and sign-out stay visible while resizing across the 900px rail breakpoint and at compact desktop height');
}

try {
  await page.goto(url);
  await page.getByRole('heading', { name: 'Sign in to VMMS' }).waitFor();
  await verifyAccessibility('staff and owner sign-in');
  const brand = page.getByRole('img', { name: /Raymond Gray/i }).first();
  assert(await brand.evaluate((image) => image.complete && image.naturalWidth > 0));
  assert.equal((await page.request.get(`${url}/favicon.ico`)).status(), 200);
  await page.screenshot({ path: resolve(output, 'sign-in-desktop.png'), fullPage: true });
  check('Official brand image and favicon load on the portal sign-in page');
  assert(await page.getByRole('radio', { name: 'Team member' }).isChecked());
  await verifyResponsiveRoute('sign-in');
  const syntheticClaimToken = 'A'.repeat(43);
  await page.goto(`${url}/#owner-invitation=${syntheticClaimToken}`);
  await page.getByRole('heading', { name: 'Vehicle owner sign in' }).waitFor();
  assert.equal(await page.evaluate(() => window.location.hash), '', 'Invitation token fragments must be removed from browser history before sign-in.');
  await page.getByText('Invitation link ready. Continue with the account named in your invitation.', { exact: true }).waitFor();
  assert(await page.getByRole('radio', { name: 'Vehicle owner' }).isChecked());
  await verifyResponsiveRoute('owner-sign-in');
  let ownerStartRequest;
  const ownerStartRoute = `${url}/api/v1/owner/auth/oidc/start`;
  const mockIdentityUrl = `${oidcIssuer.origin}/mock-owner-sign-in`;
  await page.route(ownerStartRoute, async (route) => {
    ownerStartRequest = {
      body: route.request().postDataJSON(),
      csrf: route.request().headers()['x-csrftoken'],
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authorizationUrl: mockIdentityUrl }) });
  });
  await page.route(mockIdentityUrl, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Mock identity sign in</title>' }));
  await page.getByRole('button', { name: 'Continue with invitation', exact: true }).click();
  await page.waitForURL(mockIdentityUrl);
  assert.deepEqual(ownerStartRequest?.body, { claimToken: syntheticClaimToken });
  assert.equal(typeof ownerStartRequest?.csrf, 'string');
  assert(ownerStartRequest.csrf.length >= 32);
  assert.equal(new URL(page.url()).hash, '', 'Invitation token must not follow navigation to the identity provider.');
  check('Owner invitation token is posted in the body after fragment cleanup; owner sign-in uses the API authorization URL');
  await page.unroute(ownerStartRoute);
  await page.unroute(mockIdentityUrl);
  const ownerSessionRoute = `${url}/api/v1/owner/session`;
  await page.route(ownerSessionRoute, (route) => route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: true, audience: 'owner' }) })
    : route.continue());
  const ownerVehiclesRoute = `${url}/api/v1/owner/vehicles`;
  await page.route(ownerVehiclesRoute, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store' },
    body: JSON.stringify({ vehicles: [{ id: '3b7c6d6e-4c50-4b34-8ecf-7f92475f67de', registration: 'QA-OWNER-01', make: 'Synthetic', model: 'Electric Touring' }] }),
  }));
  await page.goto(`${url}/?audience=owner`);
  await page.getByRole('heading', { name: 'Your account is connected' }).waitFor();
  await page.getByRole('heading', { name: 'Vehicles linked to your account' }).waitFor();
  await page.getByRole('heading', { name: 'Synthetic Electric Touring', exact: true }).waitFor();
  await page.getByText('Registration: QA-OWNER-01', { exact: true }).waitFor();
  await verifyAccessibility('vehicle owner portal');
  await verifyResponsiveRoute('owner-portal');
  await verifyAuthenticatedZoom('owner-portal', '/?audience=owner', 'owner');
  let ownerBrowserLogoutRequest;
  const ownerBrowserLogoutRoute = `${url}/api/v1/auth/oidc/logout`;
  await page.route(ownerBrowserLogoutRoute, async (route) => {
    ownerBrowserLogoutRequest = route.request();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      localSignedOut: true,
      centralLogout: 'started',
      // Stand in for the already-tested provider callback and its fixed staff destination.
      logoutUrl: `${url}/?audience=staff`,
    }) });
  });
  await page.getByRole('button', { name: 'Switch to team member sign in', exact: true }).click();
  assert.equal(ownerBrowserLogoutRequest?.method(), 'POST', 'Owner-to-team switching must use the shared sign-out command.');
  assert.deepEqual(ownerBrowserLogoutRequest?.postDataJSON(), { destination: 'staff' });
  assert.equal(typeof ownerBrowserLogoutRequest?.headers()['x-csrftoken'], 'string', 'Owner-to-team switching must include the CSRF token.');
  await page.getByRole('heading', { name: 'Sign in to VMMS', exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('audience'), 'staff', 'Owner-to-team switching must select staff sign-in after logout.');
  check('Owner-to-team switch revokes this browser session and opens the team member sign-in screen');
  await page.unroute(ownerBrowserLogoutRoute);
  await page.unroute(ownerSessionRoute);
  await page.unroute(ownerVehiclesRoute);
  check('Owner portal shows only linked vehicle details, omits internal status and records, and explains unpublished updates');
  await page.goto(url);
  await page.getByRole('heading', { name: 'Sign in to VMMS' }).waitFor();
  await page.getByRole('button', { name: /continue to secure sign-in/i }).click();
  await page.waitForURL((identityUrl) => identityUrl.origin === oidcIssuer.origin
    && identityUrl.pathname.includes('/protocol/openid-connect/auth'));
  await page.getByLabel('Username or email', { exact: true }).fill(process.env.OIDC_DEV_TEST_USERNAME || 'vmms.advisor.local');
  await page.getByLabel('Password', { exact: true }).fill(process.env.OIDC_DEV_TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: 'Today', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Open work orders', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: 'Work orders', exact: true }).waitFor();
  const staffSession = await page.evaluate(async () => {
    const response = await fetch('/api/v1/session', { cache: 'no-store' });
    return response.json();
  });
  const staffDisplayName = staffSession.user?.displayName;
  assert.equal(typeof staffDisplayName, 'string');
  const zoomSite = staffSession.sites?.find(site => site.canWrite);
  assert(zoomSite, 'The browser smoke account needs a writable synthetic site for authenticated zoom checks.');
  check('Individual staff signs in through the local identity provider and VMMS API');
  let ownerAccessExpired = false;
  await page.route(`${url}/api/v1/owner/session`, (route) => route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: !ownerAccessExpired, ...(ownerAccessExpired ? {} : { audience: 'owner' }) }) })
    : route.continue());
  await page.route(`${url}/api/v1/owner/vehicles`, (route) => ownerAccessExpired
    ? route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Owner access has expired.' } }) })
    : route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({ vehicles: [{ id: '3b7c6d6e-4c50-4b34-8ecf-7f92475f67de', registration: 'QA-OWNER-02', make: 'Synthetic', model: 'Shared-session test vehicle' }] }),
    }));
  await page.goto(`${url}/?audience=owner`);
  await page.getByRole('heading', { name: 'Synthetic Shared-session test vehicle', exact: true }).waitFor();
  ownerAccessExpired = true;
  await page.context().setOffline(true);
  await page.getByText('Connect to the internet to view your vehicles.').waitFor();
  await page.context().setOffline(false);
  await page.getByRole('heading', { name: 'Vehicle owner sign in', exact: true }).waitFor();
  await page.goto(`${url}/?audience=staff`);
  await page.getByRole('heading', { level: 1, name: 'Today', exact: true }).waitFor();
  const staffReturnState = await page.evaluate(async () => {
    const [staff, owner] = await Promise.all([
      fetch('/api/v1/session', { cache: 'no-store' }).then(response => response.json()),
      fetch('/api/v1/owner/session', { cache: 'no-store' }).then(response => response.json()),
    ]);
    return {
      search: window.location.search,
      heading: document.querySelector('h1')?.textContent?.trim() ?? null,
      staffAuthenticated: staff.authenticated,
      ownerAuthenticated: owner.authenticated,
    };
  });
  assert.match(new URL(page.url()).pathname, /^\/sites\/[^/]+\/today$/, 'The staff workspace must land on the staff Today page after owner-session expiry.');
  assert.equal(staffReturnState.heading, 'Today', `Staff workspace did not open after owner-session expiry: ${JSON.stringify(staffReturnState)}`);
  await page.getByRole('link', { name: 'Open work orders', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: 'Work orders', exact: true }).waitFor();
  const staffAfterOwnerExpiry = await page.evaluate(async () => (await fetch('/api/v1/session', { cache: 'no-store' })).json());
  assert.equal(staffAfterOwnerExpiry.authenticated, true, 'Owner expiry must preserve the independent staff session.');
  await page.unroute(`${url}/api/v1/owner/session`);
  await page.unroute(`${url}/api/v1/owner/vehicles`);
  check('An expired owner data request clears owner access and preserves the signed-in staff workspace');
  await verifyAccessibility('staff work-order queue');
  await verifyAuthenticatedZoom('queue', `/sites/${zoomSite.id}/work-orders`, 'staff', async zoomPage => {
    await zoomPage.getByRole('heading', { level: 1, name: 'Work orders', exact: true }).waitFor();
  });
  await verifyContinuousStaffNavigationResize();
  await page.getByRole('link', { name: 'Register a vehicle visit', exact: true }).click();
  const clientLookupRoute = `${url}/api/v1/sites/${zoomSite.id}/clients/lookup*`;
  await page.route(clientLookupRoute, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { id: '11111111-1111-4111-8111-111111111111', clientCode: 'QA-SAME-01', kind: 'organisation', name: 'Synthetic focus client' },
      { id: '22222222-2222-4222-8222-222222222222', clientCode: 'QA-SAME-02', kind: 'organisation', name: 'Synthetic focus client' },
    ]),
  }));
  await page.getByLabel('Find an existing paying client', { exact: true }).fill('Synthetic focus client');
  await page.getByRole('button', { name: 'Search paying clients', exact: true }).click();
  const focusResults = page.getByRole('button').filter({ hasText: 'Synthetic focus client' });
  await focusResults.first().waitFor();
  assert.equal(await focusResults.count(), 2);
  await focusResults.nth(0).click();
  await page.waitForFunction(() => document.activeElement?.id === 'selected-client');
  await page.getByRole('button', { name: 'Use a new client', exact: true }).click();
  await focusResults.nth(1).click();
  await page.waitForFunction(() => document.activeElement?.id === 'selected-client');
  assert.equal(await page.locator('[role="status"][aria-live="polite"]').textContent(), 'Selected paying client Synthetic focus client.');
  await page.getByRole('button', { name: 'Use a new client', exact: true }).click();
  await page.unroute(clientLookupRoute);
  check('Repeated selection with the same announcement returns keyboard focus to the selected client');
  const vehicleType = page.getByLabel('Vehicle type for booking number', { exact: true });
  assert.equal(await vehicleType.inputValue(), '', 'A new job must require an explicit vehicle type; EV must not be assumed.');
  assert.equal(await vehicleType.getAttribute('required') !== null, true);
  await vehicleType.selectOption('EV');
  check('A new job requires an explicit vehicle type before booking or lead routing');
  const vinField = page.getByLabel('Vehicle identification number (VIN)', { exact: true });
  assert.equal(await page.evaluate(() => window.__vmmsCameraRequestCount), 0, 'The camera must not be requested before the advisor chooses to scan.');
  await page.evaluate(() => { window.BarcodeDetector = undefined; });
  await vinField.fill('1HGCM82633A004352');
  await page.getByRole('button', { name: 'Scan VIN barcode', exact: true }).click();
  await page.getByText('Camera barcode scanning is not available in this browser. Enter the VIN below.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__vmmsCameraRequestCount), 0, 'An unsupported browser must not request camera access.');
  assert.equal(await vinField.inputValue(), '1HGCM82633A004352', 'Manual VIN entry must remain usable without barcode support.');
  check('Unsupported browsers keep manual VIN entry available without requesting camera access');
  await page.evaluate(() => { window.BarcodeDetector = window.__vmmsBarcodeDetector; window.__vmmsDenyCamera = true; });
  await vinField.fill('');
  await page.getByRole('button', { name: 'Scan VIN barcode', exact: true }).click();
  await page.getByText('Camera permission was not granted. Enter the VIN below or allow camera access and try again.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__vmmsCameraRequestCount), 1, 'The denied camera request must be counted once.');
  await vinField.fill('1HGCM82633A004352');
  assert.equal(await vinField.inputValue(), '1HGCM82633A004352', 'Manual VIN entry must remain usable after camera permission is denied.');
  check('Camera permission denial explains the fallback and preserves manual VIN entry');
  await page.evaluate(() => { window.__vmmsDenyCamera = false; });
  await vinField.fill('');
  await page.evaluate(() => { window.__vmmsDelayCamera = true; window.__vmmsCameraTrackStopped = false; });
  await page.getByRole('button', { name: 'Scan VIN barcode', exact: true }).click();
  await page.getByRole('button', { name: 'Requesting camera…', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__vmmsCameraRequestCount), 2, 'The permission-denied attempt and the later deferred request must each be counted once.');
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Work orders', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: 'Work orders', exact: true }).waitFor();
  await page.evaluate(() => { window.__vmmsResolveCamera?.(); window.__vmmsDelayCamera = false; });
  await page.waitForFunction(() => window.__vmmsCameraTrackStopped === true);
  check('A camera stream granted after leaving intake is immediately stopped');
  await page.getByRole('link', { name: 'Register a vehicle visit', exact: true }).click();
  await vinField.waitFor();
  await page.getByLabel('Vehicle type for booking number', { exact: true }).selectOption('EV');
  await page.getByRole('button', { name: 'Scan VIN barcode', exact: true }).click();
  await page.getByText('VIN scanned. Review it in the field before continuing.', { exact: true }).waitFor();
  assert.equal(await vinField.inputValue(), '1HGCM82633A004352');
  assert.equal(await page.evaluate(() => window.__vmmsDetectorSawStream), true, 'Barcode detection must receive a video element connected to the acquired stream.');
  await page.waitForFunction(() => window.__vmmsCameraTrackStopped === true);
  await page.evaluate(() => { window.__vmmsBarcodeValue = 'invalid barcode'; });
  await page.getByRole('button', { name: 'Scan VIN barcode', exact: true }).click();
  await page.getByText('The code scanned was not a valid 17-character VIN. Enter the VIN below.', { exact: true }).waitFor();
  assert.equal(await vinField.inputValue(), '1HGCM82633A004352', 'An invalid scan must not overwrite the VIN field.');
  await page.waitForFunction(() => window.__vmmsCameraTrackStopped === true);
  check('VIN barcode scanning accepts a valid VIN for review and rejects invalid values without replacing the field');
  const stamp = String(Date.now());
const clientCode = `T${Date.now().toString(36).toUpperCase()}`;
  const vin = `RGVM${stamp}`;
  const registration = `QA-${stamp.slice(-6)}`;
  await page.getByLabel('Paying client name', { exact: true }).fill(`Synthetic browser client ${stamp}`);
  await page.getByLabel('Client code (optional)', { exact: true }).fill(clientCode);
  await page.getByLabel('Vehicle owner name', { exact: true }).fill(`Synthetic browser owner ${stamp}`);
  await page.getByLabel('Visit contact name', { exact: true }).fill(`Synthetic browser customer ${stamp}`);
  await page.getByLabel('Phone number', { exact: true }).fill('+233200000000');
  await vinField.fill(vin);
  await page.getByRole('button', { name: 'Save in this tab', exact: true }).click();
  const recoveredName = `Synthetic browser customer ${stamp} updated`;
  await page.getByLabel('Visit contact name', { exact: true }).fill(recoveredName);
  await page.reload();
  assert.equal(await page.getByLabel('Visit contact name', { exact: true }).inputValue(), recoveredName);
  assert.equal(await page.getByLabel('Vehicle type for booking number', { exact: true }).inputValue(), 'EV');
  check('Opted-in intake draft automatically saves later edits and recovers after refresh');
  const draftScope = await page.evaluate(async () => {
    const response = await fetch('/api/v1/session', { cache: 'no-store' });
    const session = await response.json();
    return {
      userId: session.user.id,
      devSite: session.sites.find((site) => site.code === 'DEV'),
      qaSite: session.sites.find((site) => site.code === 'QA'),
    };
  });
  assert(draftScope.devSite && draftScope.qaSite, 'The loopback seed must provide DEV and synthetic QA sites.');
  const scopedDraftKey = `vmms:draft:v3:${draftScope.userId}:${draftScope.devSite.id}`;
  const previousDraftKey = `vmms:draft:v2:${draftScope.userId}:${draftScope.devSite.id}`;
  const otherSiteDraftKey = `vmms:draft:v3:${draftScope.userId}:${draftScope.qaSite.id}`;
  const otherAccountDraftKey = `vmms:draft:v1:99999999-9999-4999-8999-999999999999:${draftScope.devSite.id}`;
  const previousVersionDraft = await page.evaluate((key) => sessionStorage.getItem(key), scopedDraftKey);
  assert.notEqual(previousVersionDraft, null);
  await page.evaluate(({ otherSiteKey, otherAccountKey }) => {
    sessionStorage.setItem(otherSiteKey, 'synthetic-other-site-draft');
    sessionStorage.setItem(otherAccountKey, 'synthetic-other-account-draft');
  }, { otherSiteKey: otherSiteDraftKey, otherAccountKey: otherAccountDraftKey });
  await page.getByLabel('Service centre', { exact: true }).selectOption(draftScope.qaSite.id);
  await page.getByRole('heading', { name: 'Work orders', exact: true }).waitFor();
  assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), scopedDraftKey), null);
  assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), otherSiteDraftKey), null);
  assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), otherAccountDraftKey), 'synthetic-other-account-draft');
  await page.getByLabel('Service centre', { exact: true }).selectOption(draftScope.devSite.id);
  await page.getByRole('heading', { name: 'Work orders', exact: true }).waitFor();
  await page.evaluate(({ key, draft }) => sessionStorage.setItem(key, draft), { key: previousDraftKey, draft: previousVersionDraft });
  const visitEntry = page.getByRole('link', { name: 'Register a vehicle visit', exact: true });
  if (await visitEntry.count()) await visitEntry.click();
  else await page.getByRole('link', { name: 'Start intake', exact: true }).click();
  await page.getByLabel('Visit contact name', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Visit contact name', { exact: true }).inputValue(), recoveredName);
  assert.equal(await page.getByLabel('Vehicle type for booking number', { exact: true }).inputValue(), '',
    'Migrating an older saved draft must clear its assumed EV type and require confirmation again.');
  await page.getByText(/older draft cannot confirm whether the paying client is new or already saved/i).waitFor();
  await page.getByText(/older draft cannot confirm whether the vehicle is new or already saved/i).waitFor();
  await page.getByLabel('Vehicle type for booking number', { exact: true }).selectOption('EV');
  await page.locator('form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await page.getByText('Review the paying client before submitting this visit.', { exact: true }).waitFor();
  await page.getByLabel('Find an existing paying client', { exact: true }).fill(clientCode);
  await page.getByRole('button', { name: 'Search paying clients', exact: true }).click();
  await page.getByText('No existing client matched. Register a new paying client below.', { exact: true }).waitFor();
  const confirmNewClient = page.getByRole('button', { name: 'Use these details as a new client', exact: true });
  assert.equal(await confirmNewClient.isEnabled(), true, 'A successful no-match result for the current search should allow explicit new-client confirmation.');
  await page.getByLabel('Find an existing paying client', { exact: true }).fill(`DIFFERENT-${stamp}`);
  assert.equal(await confirmNewClient.isDisabled(), true, 'Changing the search must clear a prior no-match confirmation.');
  await page.getByLabel('Find an existing paying client', { exact: true }).fill(clientCode);
  await page.getByRole('button', { name: 'Search paying clients', exact: true }).click();
  await page.getByText('No existing client matched. Register a new paying client below.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Use these details as a new client', exact: true }).click();
  await page.locator('form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await page.getByText('Review the vehicle before submitting this visit.', { exact: true }).waitFor();
  const vehicleLookupPath = /\/api\/v1\/sites\/[^/]+\/vehicles\/lookup\?vin=/;
  let interceptNoVehicleMatch = true;
  const noVehicleMatch = async (route) => {
    if (!interceptNoVehicleMatch) return route.continue();
    interceptNoVehicleMatch = false;
    await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
  };
  await page.route(vehicleLookupPath, noVehicleMatch);
  await page.getByRole('button', { name: 'Find vehicle at this site', exact: true }).click();
  await page.getByText('No vehicle with this VIN is recorded at this site. Enter its details below to create a new vehicle record.', { exact: true }).waitFor();
  await page.unroute(vehicleLookupPath, noVehicleMatch);
  const confirmNewVehicle = page.getByRole('button', { name: 'Enter a new vehicle', exact: true });
  assert.equal(await confirmNewVehicle.isEnabled(), true, 'A successful current-site VIN no-match should permit explicit new-vehicle confirmation.');
  await confirmNewVehicle.click();
  check('Legacy draft vehicle review permits a new vehicle only after a successful site-scoped VIN no-match');
  assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), previousDraftKey), null);
  check('Older saved drafts keep their entries and require vehicle type and client/vehicle identity review before submission');
  check('Switching sites removes this account’s drafts across sites and preserves other account storage');
  await page.evaluate((key) => sessionStorage.removeItem(key), otherAccountDraftKey);
  await page.evaluate((key) => sessionStorage.removeItem(key), scopedDraftKey);
  const expiredLegacyDraftKey = `vmms:draft:v1:${draftScope.userId}:${draftScope.devSite.id}`;
  await page.evaluate(({ key, savedAt }) => {
    sessionStorage.setItem(key, JSON.stringify({
      draftId: '11111111-1111-4111-8111-111111111111',
      commandId: '22222222-2222-4222-8222-222222222222',
      fields: {
        customerName: 'Expired synthetic customer', phone: '+233200000000', email: '',
        vin: 'RGVM0000000000001', registration: 'QA-EXPIRED', make: 'Synthetic',
        model: 'Expired', variant: '', powertrain: '', odometerKm: '1', socPercent: '', complaint: 'Expired draft',
      },
      savedAt,
    }));
  }, { key: expiredLegacyDraftKey, savedAt: new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString() });
  await page.reload();
  await page.getByRole('alert').getByText(/saved draft expired and was removed/i).waitFor();
  assert.equal(await page.getByLabel('Visit contact name', { exact: true }).inputValue(), '');
  assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), expiredLegacyDraftKey), null);
  check('An expired intake draft is removed, not recovered or submitted');
  await page.getByLabel('Paying client name', { exact: true }).fill(`Synthetic browser client ${stamp}`);
  await page.getByLabel('Client code (optional)', { exact: true }).fill(clientCode);
  await page.getByLabel('Vehicle owner name', { exact: true }).fill(`Synthetic browser owner ${stamp}`);
  await page.getByLabel('Visit contact name', { exact: true }).fill(recoveredName);
  await page.getByLabel('Phone number', { exact: true }).fill('+233200000000');
  await page.getByLabel('Vehicle identification number (VIN)', { exact: true }).fill(vin);
  await page.getByLabel('Registration number', { exact: true }).fill(registration);
  await page.getByLabel('Make', { exact: true }).fill('Development');
  await page.getByLabel('Model', { exact: true }).fill('EV demonstrator');
  await page.getByLabel('Variant', { exact: true }).fill('Touring');
  await page.getByLabel('Engine or motor', { exact: true }).fill('Battery electric');
  await page.getByLabel('Vehicle type for booking number', { exact: true }).selectOption('EV');
  await page.getByLabel('Odometer reading in kilometres', { exact: true }).fill('12000');
  await page.getByLabel('Battery charge (%)', { exact: true }).fill('55');
  await page.getByLabel('What needs attention?', { exact: true }).fill('Synthetic report: charging pauses intermittently.');
  await verifyAccessibility('new intake form');
  await page.getByRole('button', { name: 'Save in this tab', exact: true }).click();
  await page.reload();
  await page.getByLabel('Registration number', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Registration number', { exact: true }).inputValue(), registration);
  assert.equal(await page.getByLabel('Variant', { exact: true }).inputValue(), 'Touring');
  assert.equal(await page.getByLabel('Engine or motor', { exact: true }).inputValue(), 'Battery electric');
  check('Explicit unsubmitted tab draft survives refresh');
  await context.setOffline(true);
  await page.getByText(/offline/i).first().waitFor();
  assert(await page.getByRole('button', { name: 'Register visit for Operations review', exact: true }).isDisabled());
  await context.setOffline(false);
  check('Offline mode preserves form entries and blocks submission');
  const createDraftButton = page.getByRole('button', { name: 'Register visit for Operations review', exact: true });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Register visit for Operations review'));
    return navigator.onLine && Boolean(button && !button.disabled);
  });
  const createResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && /\/api\/v1\/sites\/[^/]+\/intake-drafts$/.test(new URL(response.url()).pathname),
  );
  await createDraftButton.click();
  const createResponse = await createResponsePromise;
  assert(createResponse.ok(), `Synthetic intake failed: HTTP ${createResponse.status()} ${await createResponse.text()}`);
  await page.getByRole('heading', { name: new RegExp(`^EV-${clientCode}-00001$`) }).waitFor();
  const orderUrl = page.url();
  const reviewPanel = page.locator("section[aria-labelledby='operations-review-title']");
  await reviewPanel.getByRole('heading', { name: 'Operations review', exact: true }).waitFor();
  await reviewPanel.getByText('Awaiting review', { exact: true }).waitFor();
  await reviewPanel.getByText('You need current Operations permission to record or update this review.', { exact: true }).waitFor();
  const operationsPanel = page.locator("section[aria-labelledby='operations-assignment-title']");
  await operationsPanel.getByRole('heading', { name: 'Team-lead assignment', exact: true }).waitFor();
  await operationsPanel.getByText('You need current Operations permission to assign a team lead.', { exact: true }).waitFor();
  assert.equal(await operationsPanel.getByLabel('Team lead qualified for EV', { exact: true }).count(), 0);
  await page.getByRole('heading', { name: 'Assign a supervisor' }).waitFor();
  await page.getByText('Assign a team lead before handing over this job.', { exact: true }).waitFor();
  check('New work orders show separate Operations review and assignment states and hide protected actions without grants');
  const complaintsSection = page.locator("section[aria-labelledby='complaints-title']");
  await complaintsSection.getByText('C01', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add concern', exact: true }).click();
  await page.getByLabel("Customer's wording", { exact: true }).fill('Synthetic report: rattle over uneven roads.');
  await page.getByRole('button', { name: 'Save concern', exact: true }).click();
  const savedToast = page.getByRole('status').filter({ hasText: 'Job update saved.' });
  await savedToast.waitFor({ state: 'visible' });
  assert.equal(await savedToast.getAttribute('data-visible'), 'true', 'Save confirmation should enter its visible state');
  assert.match(await savedToast.evaluate((element) => getComputedStyle(element).transitionDuration), /0\.15s/, 'Save confirmation should use the fast fade transition');
  const focusReturn = page.getByRole('link', { name: 'Work orders', exact: true }).first();
  await focusReturn.evaluate((element) => { element.dataset.toastFocusReturn = 'true'; });
  await focusReturn.focus();
  await savedToast.getByRole('button', { name: 'Dismiss notification', exact: true }).focus();
  await savedToast.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await savedToast.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-toast-focus-return')), 'true',
    'Dismissing a focused notification must return focus to the control used before entering it.');
  check('Dismissing a focused save notification restores keyboard focus to the previous control');
  await complaintsSection.getByText('C02', { exact: true }).waitFor();
  const historySection = page.locator("section[aria-labelledby='history-title']");
  await historySection.getByText('Customer concern added', { exact: true }).waitFor();
  await historySection.locator('li').filter({ hasText: staffDisplayName }).first().waitFor();
  check('C02 appears in attributable work-order history');
  await page.reload();
  await complaintsSection.getByText('C02', { exact: true }).waitFor();
  await historySection.getByText('Customer concern added', { exact: true }).waitFor();
  await historySection.locator('li').filter({ hasText: staffDisplayName }).first().waitFor();
  assert.equal(page.url(), orderUrl);
  check('Real intake, C02 and attributable event history persist through refresh on one work order');
  await page.locator('#workspace-main').getByRole('link', { name: 'Work orders', exact: true }).click();
  await page.getByRole('heading', { name: 'Work orders', exact: true }).waitFor();
  await page.getByText('Paying client', { exact: true }).waitFor();
  await page.getByText(`Synthetic browser client ${stamp}`, { exact: true }).waitFor();
  assert.equal(await page.getByText(recoveredName, { exact: true }).count(), 0,
    'The visit contact must not be presented as the paying client in the work-order list.');
  const paginationStatus = page.getByRole('status').filter({ hasText: /Page \d+ of \d+/ });
  await paginationStatus.waitFor({ state: 'visible' });
  const paginationText = () => paginationStatus.innerText().then((text) => text.replace(/\s+/g, ' ').trim());
  assert.match(await paginationText(), /Showing \d+–\d+ of \d+ work orders · Page 1 of \d+/);
  assert.equal(await page.getByLabel('Rows per page', { exact: false }).count(), 1);
  const nextPage = page.getByRole('button', { name: 'Next', exact: true });
  const previousPage = page.getByRole('button', { name: 'Previous', exact: true });
  if (await nextPage.isEnabled()) {
    await nextPage.click();
    await paginationStatus.getByText(/Page 2 of/).waitFor();
    await previousPage.click();
    await paginationStatus.getByText(/Page 1 of/).waitFor();
  } else {
    assert.equal(await previousPage.isEnabled(), false, 'The first and only page must not have an enabled Previous control.');
  }
  check('Work-order queue exposes pagination status and navigates pages when another page exists');
  await page.getByLabel('Search by booking number, vehicle ID, registration or client', { exact: true }).fill(`NO-MATCH-${stamp}`);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByText('No matching work orders', { exact: true }).waitFor();
  check('Reception search shows its empty state for a query with no matches');
  await page.getByRole('link', { name: 'Register a vehicle visit', exact: true }).click();
  await page.getByRole('button', { name: 'Save in this tab', exact: true }).click();
  await page.getByLabel('Vehicle identification number (VIN)', { exact: true }).fill(vin);
  const lookupResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'GET' && /\/api\/v1\/sites\/[^/]+\/vehicles\/lookup\?vin=/.test(response.url()),
  );
  await page.getByRole('button', { name: 'Find vehicle at this site', exact: true }).click();
  const lookupResponse = await lookupResponsePromise;
  assert(lookupResponse.ok(), `Site-local vehicle lookup failed: HTTP ${lookupResponse.status()} ${await lookupResponse.text()}`);
  await page.getByRole('button', { name: 'Use this vehicle', exact: true }).click();
  assert(await page.getByText('This visit records a new reported owner for this work order; it does not change verified owner access.').isVisible());
  await page.getByLabel('Find an existing paying client', { exact: true }).fill(clientCode);
  await page.getByRole('button', { name: 'Search paying clients', exact: true }).click();
  await page.getByText(`${clientCode} · organisation`, { exact: true }).click();
  await page.getByLabel('Find a previous vehicle owner', { exact: true }).fill(`Synthetic browser owner ${stamp}`);
  await page.getByRole('button', { name: 'Search owners', exact: true }).click();
  await page.getByRole('button').filter({ hasText: `Synthetic browser owner ${stamp}` }).getByText('Select', { exact: true }).click();
  await page.getByLabel('Find a previous visit contact', { exact: true }).fill(recoveredName);
  await page.getByRole('button', { name: 'Search contacts', exact: true }).click();
  await page.getByRole('button').filter({ hasText: recoveredName }).getByText('Select', { exact: true }).click();
  await page.getByText(`Selected vehicle owner (as reported): Synthetic browser owner ${stamp}`).waitFor();
  await page.getByText(`Selected visit contact: ${recoveredName}`).waitFor();
  await page.reload();
  await page.locator('p').filter({ hasText: 'Selected client:' }).filter({ hasText: clientCode }).waitFor();
  await page.getByText('Existing vehicle selected', { exact: true }).waitFor();
  await page.getByText(`Selected vehicle owner (as reported): Synthetic browser owner ${stamp}`).waitFor();
  await page.getByText(`Selected visit contact: ${recoveredName}`).waitFor();
  check('Recovered intake draft revalidates and restores selected client, vehicle, owner and visit contact at the current site');
  await page.getByLabel('Odometer reading in kilometres', { exact: true }).fill('12100');
  await page.getByLabel('Battery charge (%)', { exact: true }).fill('54');
  await page.getByLabel('Vehicle type for booking number', { exact: true }).selectOption('EV');
  await page.getByLabel('What needs attention?', { exact: true }).fill('Synthetic repeat-visit browser check.');
  const repeatResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && /\/api\/v1\/sites\/[^/]+\/intake-drafts$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Register visit for Operations review', exact: true }).click();
  const repeatResponse = await repeatResponsePromise;
  assert(repeatResponse.ok(), `Repeat visit failed: HTTP ${repeatResponse.status()} ${await repeatResponse.text()}`);
  await page.getByRole('heading', { name: new RegExp(`^EV-${clientCode}-00002$`) }).waitFor();
  await page.getByText(recoveredName, { exact: true }).waitFor();
  assert.equal(await page.locator("section[aria-labelledby='visit-title'] ol > li").count(), 2);
  assert.equal(await page.getByLabel('Vehicle identification number (VIN)', { exact: true }).count(), 0);
  check('Reception explicitly reuses same-site vehicle, payer, reported owner and visit contact without granting owner access');
  await page.goto(orderUrl);
  await page.locator("section[aria-labelledby='complaints-title']").getByText('C02', { exact: true }).waitFor();
  const recoveryIntentCreatePattern = /\/api\/v1\/sites\/[^/]+\/work-orders\/[^/]+\/evidence\/intents$/;
  const recoveryIntentId = '33333333-3333-4333-8333-333333333333';
  const recoveryIntentStatusPattern = new RegExp(`/api/v1/sites/[^/]+/evidence/intents/${recoveryIntentId}$`);
  const interruptedUploadPattern = /\/api\/v1\/sites\/[^/]+\/evidence\/intents\/[^/]+\/content$/;
  let interruptedUpload = false;
  const uploadRequests = [];
  let recoveryIntentBody;
  const recoveryFile = {
    name: 'synthetic-recovery.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% Synthetic VMMS browser recovery fixture\n'),
  };
  await page.route(recoveryIntentCreatePattern, async (route) => {
    recoveryIntentBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: recoveryIntentId,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        maxBytes: 10 * 1024 * 1024,
        expectedBytes: recoveryFile.buffer.length,
        displayName: recoveryFile.name,
        declaredMediaType: recoveryFile.mimeType,
        state: 'issued',
      }),
    });
  });
  await page.route(recoveryIntentStatusPattern, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: recoveryIntentId,
        purpose: 'work-order',
        targetId: orderUrl.split('/').at(-1),
        displayName: recoveryFile.name,
        declaredMediaType: recoveryFile.mimeType,
        expectedBytes: recoveryFile.buffer.length,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        state: 'issued',
        evidenceId: null,
        evidenceState: null,
      }),
    });
  });
  await page.route(interruptedUploadPattern, async (route) => {
    uploadRequests.push(route.request().url());
    if (!interruptedUpload && route.request().method() === 'PUT') {
      interruptedUpload = true;
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        evidenceId: '44444444-4444-4444-8444-444444444444',
        state: 'pending',
        sha256: 'a'.repeat(64),
        sizeBytes: recoveryFile.buffer.length,
        mediaType: recoveryFile.mimeType,
      }),
    });
  });
  await page.getByLabel(/Keep this upload’s recovery details in this tab/).check();
  await page.locator('#work-order-evidence-file').setInputFiles(recoveryFile);
  await page.getByRole('button', { name: 'Upload evidence', exact: true }).click();
  await page.getByText(/upload could not be confirmed/i).waitFor();
  assert.equal(interruptedUpload, true, 'The synthetic upload must be interrupted after its recovery intent is created.');
  await page.reload();
  await page.getByText('An upload was interrupted', { exact: true }).waitFor();
  await page.locator('#work-order-evidence-file').setInputFiles(recoveryFile);
  await page.getByRole('button', { name: 'Resume upload', exact: true }).click();
  await page.getByRole('status').getByText('The upload is private and waiting for its security check.', { exact: true }).waitFor();
  assert.deepEqual(recoveryIntentBody, {
    displayName: recoveryFile.name,
    declaredMediaType: recoveryFile.mimeType,
    expectedBytes: recoveryFile.buffer.length,
  });
  assert.equal(uploadRequests.length, 2);
  assert.equal(uploadRequests[0], uploadRequests[1], 'Recovery must retry the original upload intent after refresh.');
  await page.unroute(interruptedUploadPattern);
  await page.unroute(recoveryIntentStatusPattern);
  await page.unroute(recoveryIntentCreatePattern);
  check('Interrupted evidence upload recovers after browser refresh and file reselection');
  await page.getByRole('button', { name: 'Plan task', exact: true }).click();
  const firstTaskTitle = 'Inspect the reported charging interruption';
  await page.getByLabel('Proposed task', { exact: true }).fill(firstTaskTitle);
  const taskCommandPattern = /\/api\/v1\/sites\/[^/]+\/work-orders\/[^/]+\/tasks$/;
  const firstTaskAttempts = [];
  let loseFirstTaskResponse = true;
  await page.route(taskCommandPattern, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    firstTaskAttempts.push({
      commandId: route.request().headers()['idempotency-key'],
      body: route.request().postDataJSON(),
    });
    if (loseFirstTaskResponse) {
      loseFirstTaskResponse = false;
      const response = await route.fetch();
      assert(response.ok(), `The real task command did not reach persistence: HTTP ${response.status()}`);
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Save planned task', exact: true }).click();
  await page.getByRole('alert').getByText(/server could not be reached/i).waitFor();
  assert.equal(await page.getByLabel('Proposed task', { exact: true }).inputValue(), firstTaskTitle, 'A lost response must keep the proposed task text.');
  await page.getByRole('button', { name: 'Save planned task', exact: true }).click();
  await page.getByText('Inspect the reported charging interruption', { exact: true }).waitFor();
  const taskSavedToast = page.getByRole('status').filter({ hasText: 'Job update saved.' });
  await taskSavedToast.waitFor({ state: 'visible' });
  await focusReturn.evaluate((element) => { element.dataset.toastFocusReturn = 'true'; });
  await focusReturn.focus();
  await taskSavedToast.waitFor({ state: 'hidden', timeout: 6000 });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-toast-focus-return')), 'true',
    'Automatic notification expiry must leave focus on the user’s current control.');
  check('A save notification fades automatically without moving keyboard focus');
  assert.equal(firstTaskAttempts.length, 2, 'The committed task must be retried with one stable command identity.');
  assert.ok(firstTaskAttempts[0].commandId);
  assert.equal(firstTaskAttempts[1].commandId, firstTaskAttempts[0].commandId, 'A retry after a lost response must reuse the same idempotency key.');
  assert.deepEqual(firstTaskAttempts[1].body, firstTaskAttempts[0].body);
  await page.unroute(taskCommandPattern);
  await historySection.getByText('Task planned', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('Inspect the reported charging interruption', { exact: true }).waitFor();
  assert.equal(await page.locator("section[aria-labelledby='tasks-title'] li").filter({ hasText: firstTaskTitle }).count(), 1, 'Idempotent retry must not create a duplicate task.');
  await historySection.getByText('Task planned', { exact: true }).waitFor();
  check('A committed task with a dropped response retries under the same command ID without duplication');
  await page.getByRole('button', { name: 'Report hold', exact: true }).click();
  await page.getByLabel('What does this hold apply to?', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Category', { exact: true }).selectOption('parts');
  await page.getByLabel('Severity', { exact: true }).selectOption('stop');
  await page.getByLabel('Reason', { exact: true }).fill('Wait for part identity confirmation.');
  await page.getByLabel('Observation or source reference', { exact: true }).fill('Synthetic browser scenario; inspection record BR-QA-1.');
  await page.getByRole('button', { name: 'Save hold', exact: true }).click();
  await historySection.getByText('Hold reported', { exact: true }).waitFor();
  const taskSection = page.locator("section[aria-labelledby='tasks-title']");
  const firstTask = taskSection.locator('li').filter({ hasText: 'Inspect the reported charging interruption' });
  await firstTask.getByText(/open hold/i).waitFor();
  check('Protective hold is attributable to the selected task');
  await page.getByRole('button', { name: 'Plan task', exact: true }).click();
  const secondTaskTitle = 'Plan a separate visual assessment';
  await page.getByLabel('Proposed task', { exact: true }).fill(secondTaskTitle);
  const reconnectAttempts = [];
  let reconnectRouteFailure = true;
  await page.route(taskCommandPattern, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    reconnectAttempts.push({
      commandId: route.request().headers()['idempotency-key'],
      body: route.request().postDataJSON(),
    });
    if (reconnectRouteFailure) {
      reconnectRouteFailure = false;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Save planned task', exact: true }).click();
  await page.getByRole('alert').getByText(/server could not be reached/i).waitFor();
  assert.equal(await page.getByLabel('Proposed task', { exact: true }).inputValue(), secondTaskTitle, 'An unavailable command must keep the proposed task text.');
  await context.setOffline(true);
  await page.getByText(/offline/i).first().waitFor();
  const browserCookies = await context.cookies(`${url}/api/v1`);
  const browserCookieHeader = browserCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  const csrfCookie = browserCookies.find((cookie) => cookie.name === 'vmms_csrf');
  assert(csrfCookie, 'The connected staff browser should have its CSRF cookie.');
  const orderParts = new URL(orderUrl).pathname.split('/');
  const apiSiteId = orderParts.at(-3);
  const apiOrderId = orderParts.at(-1);
  const detailResponse = await fetch(`${url}/api/v1/sites/${apiSiteId}/work-orders/${apiOrderId}`, {
    headers: { Cookie: browserCookieHeader },
  });
  assert(detailResponse.ok, `Could not read the synthetic work order while the browser was offline: HTTP ${detailResponse.status}`);
  const latestDetail = await detailResponse.json();
  const csrfToken = decodeURIComponent(csrfCookie.value);
  const concurrentResponse = await fetch(`${url}/api/v1/sites/${apiSiteId}/work-orders/${apiOrderId}/complaints`, {
    method: 'POST',
    headers: {
      Cookie: browserCookieHeader,
      Origin: new URL(url).origin,
      'Content-Type': 'application/json',
      'X-CSRFToken': csrfToken,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ expectedVersion: latestDetail.version, wording: 'Synthetic reconnect conflict check.' }),
  });
  assert(concurrentResponse.ok, `Could not advance the synthetic work-order version while the browser was offline: HTTP ${concurrentResponse.status} ${await concurrentResponse.text()}`);
  await context.setOffline(false);
  await page.getByText(/connected/i).first().waitFor();
  const reconnectConflictResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && /\/api\/v1\/sites\/[^/]+\/work-orders\/[^/]+\/tasks$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Save planned task', exact: true }).click();
  const reconnectConflict = await reconnectConflictResponse;
  assert.equal(reconnectConflict.status(), 409, `The reconnect retry should surface a real version conflict, got HTTP ${reconnectConflict.status()}.`);
  await page.getByRole('alert').getByText('Your form entries have been kept.', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Proposed task', { exact: true }).inputValue(), secondTaskTitle, 'A version conflict must keep the proposed task text.');
  assert.equal(reconnectAttempts.length, 2);
  assert.ok(reconnectAttempts[0].commandId);
  assert.equal(reconnectAttempts[1].commandId, reconnectAttempts[0].commandId, 'A reconnect retry that conflicts must retain its original command ID.');
  assert.deepEqual(reconnectAttempts[1].body, reconnectAttempts[0].body, 'A reconnect retry must preserve the original command payload and expected version.');
  await page.getByRole('button', { name: 'Refresh work order', exact: true }).click();
  await page.getByText('Synthetic reconnect conflict check.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Proposed task', { exact: true }).inputValue(), secondTaskTitle, 'Refreshing after conflict must retain the form entries.');
  await page.getByRole('button', { name: 'Save planned task', exact: true }).click();
  await page.getByText(secondTaskTitle, { exact: true }).waitFor();
  assert.equal(reconnectAttempts.length, 3);
  assert.notEqual(reconnectAttempts[2].commandId, reconnectAttempts[1].commandId, 'After a definitive conflict, the refreshed command must use a new idempotency key.');
  assert(reconnectAttempts[2].body.expectedVersion > reconnectAttempts[1].body.expectedVersion, 'The refreshed retry must use the current work-order version.');
  await page.unroute(taskCommandPattern);
  const secondTask = taskSection.locator('li').filter({ hasText: 'Plan a separate visual assessment' });
  assert.equal(await taskSection.locator('li').count(), 2);
  assert.equal(await secondTask.getByText(/open hold/i).count(), 0, 'A task-scoped hold must not attach to an unrelated planned task');
  check('A reconnect retry reuses its command ID, surfaces the real version conflict, and succeeds after refresh');
  await page.reload();
  await page.locator("section[aria-labelledby='holds-title']").getByText('Wait for part identity confirmation.', { exact: true }).waitFor();
  await page.getByText('Plan a separate visual assessment', { exact: true }).waitFor();
  check('Task-scoped hold and unrelated task remain distinct after refresh');
  const intakeFactsSection = page.locator("section[aria-labelledby='intake-facts-title']");
  await intakeFactsSection.getByLabel('What are you recording?', { exact: true }).selectOption('damage-observation');
  await intakeFactsSection.getByLabel('Vehicle area', { exact: true }).fill('left rear door');
  await intakeFactsSection.getByLabel('What was observed or reported?', { exact: true }).fill('A scrape was visible before work began.');
  const intakeFactResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/intake-facts'),
  );
  await intakeFactsSection.getByRole('button', { name: 'Record observation', exact: true }).click();
  const intakeFactResponse = await intakeFactResponsePromise;
  assert.equal(intakeFactResponse.status(), 200, 'Recording a vehicle check-in note must be accepted by the API');
  await intakeFactsSection.getByRole('status').getByText('Saved. The initial vehicle checks are still pending.', { exact: true }).waitFor();
  await page.reload();
  const persistedIntakeFactsSection = page.locator("section[aria-labelledby='intake-facts-title']");
  await persistedIntakeFactsSection.getByText('left rear door · A scrape was visible before work began.', { exact: true }).waitFor();
  check('Vehicle check-in notes persist with attribution and leave the initial checks pending');
  await page.getByRole('button', { name: 'Record finding', exact: true }).click();
  await page.getByLabel('Finding summary', { exact: true }).fill('Charging concern remains unresolved after workshop observation.');
  await page.getByLabel('How certain is this finding?', { exact: true }).selectOption('inconclusive');
  await page.getByLabel('Why did you choose this option?', { exact: true }).fill('The intermittent condition was not present during the available test window.');
  await page.getByText('Detailed observations', { exact: true }).waitFor();
  await page.getByLabel('Residual risk or what remains unknown', { exact: true }).fill('The charging interruption may recur; the system is not represented as cleared.');
  await page.getByLabel('Observation type', { exact: true }).selectOption('dtc');
  await verifyResponsiveRoute('diagnostic-dtc-freeze-frame');
  await page.getByLabel('Diagnostic trouble code', { exact: true }).fill('P0ABC');
  await page.getByLabel('Parameter name', { exact: true }).fill('Engine speed');
  await page.getByLabel('Value', { exact: true }).fill('840');
  await page.getByLabel('Unit', { exact: true }).fill('rpm');
  await page.getByRole('button', { name: 'Add reading', exact: true }).click();
  await page.getByText('Engine speed: 840 rpm', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add observation', exact: true }).click();
  await page.getByLabel('Observation type', { exact: true }).selectOption('software-version');
  await page.getByLabel('Component or module', { exact: true }).fill('Battery management system');
  await page.getByLabel('Software version', { exact: true }).fill('6.2.1');
  await page.getByRole('button', { name: 'Add observation', exact: true }).click();
  await page.getByLabel('Observation type', { exact: true }).selectOption('condition');
  await page.getByLabel('Observed condition', { exact: true }).fill('Intermittent charging interruption reported by the driver.');
  await page.getByRole('button', { name: 'Add observation', exact: true }).click();
  await page.getByLabel('Observation type', { exact: true }).selectOption('measurement');
  await page.getByLabel('Measurement', { exact: true }).fill('Battery voltage');
  await page.getByLabel('Value', { exact: true }).fill('398');
  await page.getByLabel('Unit', { exact: true }).fill('V');
  await page.getByLabel('Measurement condition', { exact: true }).fill('Vehicle stationary after the reported interruption.');
  await page.getByRole('button', { name: 'Add observation', exact: true }).click();
  await page.getByLabel('Observation type', { exact: true }).selectOption('reproduction-attempt');
  await page.getByLabel('Attempt conditions', { exact: true }).fill('AC charging under the workshop supply.');
  await page.getByLabel('Observed outcome', { exact: true }).fill('The interruption did not recur during this attempt.');
  await page.getByRole('button', { name: 'Add observation', exact: true }).click();
  await page.getByLabel('Observation type', { exact: true }).selectOption('procedure-reference');
  await page.getByLabel('Procedure or manual title', { exact: true }).fill('Approved diagnostic guide');
  await page.getByLabel('Source reference', { exact: true }).fill('Manual reference REG-TEST-01');
  await page.getByLabel('Revision', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Add observation', exact: true }).click();
  await page.getByRole('button', { name: 'Save diagnostic finding', exact: true }).click();
  const diagnosticsSection = page.locator("section[aria-labelledby='diagnostics-title']");
  await diagnosticsSection.getByText('Charging concern remains unresolved after workshop observation.', { exact: true }).waitFor();
  await diagnosticsSection.getByText('Inconclusive', { exact: true }).waitFor();
  await diagnosticsSection.getByText(/· Whole concern/).waitFor();
  await diagnosticsSection.getByText(/Residual risk: The charging interruption may recur; the system is not represented as cleared\./).waitFor();
  await diagnosticsSection.getByText(/Diagnostic snapshot readings: Engine speed 840 rpm/).waitFor();
  await diagnosticsSection.getByText(/Battery management system software version 6\.2\.1/).waitFor();
  await diagnosticsSection.getByText(/Condition: Intermittent charging interruption reported by the driver\./).waitFor();
  await diagnosticsSection.getByText(/Battery voltage: 398 V/).waitFor();
  await diagnosticsSection.getByText(/Reproduction attempt · AC charging under the workshop supply\./).waitFor();
  await diagnosticsSection.getByText(/Procedure: Approved diagnostic guide · Manual reference REG-TEST-01 · 2/).waitFor();
  assert.equal(await taskSection.locator('li').count(), 2, 'Recording a finding must not advance or remove planned tasks.');
  await page.reload();
  await diagnosticsSection.getByText('P0ABC', { exact: false }).waitFor();
  await diagnosticsSection.getByText(/Diagnostic snapshot readings: Engine speed 840 rpm/).waitFor();
  await diagnosticsSection.getByText('Inconclusive', { exact: true }).waitFor();
  check('Staff can record and revisit an inconclusive diagnostic finding without changing task state');
  await page.getByRole('button', { name: 'Record finding', exact: true }).click();
  const relatedTask = page.getByLabel('Related planned task (optional)', { exact: false });
  await relatedTask.waitFor();
  assert.equal(await relatedTask.locator('option').first().textContent(), 'No related task');
  const certainty = page.getByLabel('How certain is this finding?', { exact: true });
  assert.equal(await certainty.locator('option').first().textContent(), 'Stated by staff member');
  check('Diagnostic form labels describe task links and staff certainty in plain language');
  await verifyResponsiveRoute('diagnostic-form');
  await page.getByRole('button', { name: 'Close form', exact: true }).click();
  await page.screenshot({ path: resolve(output, 'work-order-desktop.png'), fullPage: true });
  await verifyResponsiveRoute('work-order');
  const responsiveSiteId = new URL(orderUrl).pathname.split('/')[2];
  await verifyAuthenticatedZoom('work-order', new URL(orderUrl).pathname);
  await verifyAuthenticatedZoom('intake', new URL(orderUrl).pathname, 'staff', async zoomPage => {
    await zoomPage.goto(`${url}/sites/${responsiveSiteId}/work-orders`);
    await zoomPage.getByRole('heading', { level: 1, name: 'Work orders', exact: true }).waitFor();
    await zoomPage.getByRole('link', { name: 'Register a vehicle visit', exact: true }).click();
    await zoomPage.getByLabel('Paying client name', { exact: true }).waitFor();
  });
  await verifyAuthenticatedZoom('diagnostic-form', new URL(orderUrl).pathname, 'staff', async zoomPage => {
    await zoomPage.getByRole('button', { name: 'Record finding', exact: true }).click();
    await zoomPage.getByLabel('Finding summary', { exact: true }).waitFor();
  });
  await page.getByRole('link', { name: 'Work orders', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Work orders', exact: true }).waitFor();
  const workOrderSearch = page.getByRole('searchbox', {
    name: 'Search by booking number, vehicle ID, registration or client',
    exact: true,
  });
  await workOrderSearch.waitFor();
  assert.equal(await workOrderSearch.getAttribute('placeholder'), 'Booking no., vehicle ID, registration or client');
  check('Work-order search explains its accepted references in plain language and its accessible name');
  await verifyResponsiveRoute('queue');
  await page.getByRole('link', { name: 'Register a vehicle visit', exact: true }).click();
  await page.getByRole('heading', { name: 'Register a vehicle visit', exact: true }).waitFor();
  await verifyResponsiveRoute('intake');
  await page.goto(orderUrl);
  await page.getByRole('button', { name: 'Add concern', exact: true }).waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Add concern', exact: true }).focus();
  await page.keyboard.press('Tab');
  const keyboardFocus = await page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return null;
    const style = getComputedStyle(element);
    return {
      label: element.getAttribute('aria-label') || element.textContent?.trim(),
      visible: element.matches(':focus-visible') && (style.outlineStyle !== 'none' || style.boxShadow !== 'none'),
    };
  });
  assert.equal(keyboardFocus?.label, 'Plan task');
  assert.equal(keyboardFocus?.visible, true, 'Keyboard focus must remain visible in the staff workspace');
  check('Staff workspace actions remain keyboard reachable with visible focus');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedMotion = await page.evaluate(() => ({
    requested: matchMedia('(prefers-reduced-motion: reduce)').matches,
    activeMotion: document.getAnimations().filter((animation) => animation.playState === 'running').length,
  }));
  assert.equal(reducedMotion.requested, true);
  assert.equal(reducedMotion.activeMotion, 0, 'Reduced-motion preference must not leave active page animations');
  check('Authenticated workspace respects the reduced-motion preference');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const siblingTab = await context.newPage();
  await siblingTab.goto(orderUrl);
  await siblingTab.getByRole('button', { name: 'Add concern', exact: true }).waitFor();
  await page.getByRole('button', { name: /sign out/i }).click();
  await page.getByRole('heading', { level: 1, name: 'You’re signed out', exact: true }).waitFor();
  await page.getByRole('status').getByText('We could not confirm sign-out from the shared account service. VMMS access on this browser is still cleared.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('vmms')).length), 0);
  await siblingTab.getByRole('heading', { name: 'Sign in to VMMS' }).waitFor();
  assert.equal(await siblingTab.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('vmms')).length), 0);
  check('VMMS sign-out clears the current session, reports unavailable central sign-out and clears the other tab');
  await siblingTab.close();
  await context.clearCookies({ domain: new URL(oidcIssuer).hostname });
  await page.getByRole('link', { name: 'Sign in to the staff workspace', exact: true }).click();
  await page.getByRole('button', { name: /continue to secure sign-in/i }).click({ noWaitAfter: true });
  await page.getByLabel('Username or email', { exact: true }).waitFor();
  await page.getByLabel('Username or email', { exact: true }).fill('vmms.browser.switch.local');
  await page.getByLabel('Password', { exact: true }).fill(process.env.OIDC_DEV_TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.getByRole('heading', { name: 'No work role is assigned', exact: true, level: 1 }).waitFor();
  const alternateSession = await page.evaluate(async () => {
    const response = await fetch('/api/v1/session', { cache: 'no-store' });
    return response.json();
  });
  assert.equal(alternateSession.authenticated, true);
  assert.notEqual(alternateSession.user.id, draftScope.userId, 'Account switch must establish a different VMMS staff identity.');
  assert.equal(alternateSession.sites.length, 1);
  assert.equal(alternateSession.sites[0].code, 'QA');
  assert.equal(alternateSession.sites[0].canWrite, false);
  await page.getByText('Synthetic QA centre · QA', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Register a vehicle visit', exact: true }).count(), 0, 'The roleless QA identity must not be offered vehicle-visit registration.');
  const crossAccountAccess = await page.evaluate(async ({ siteId, orderId }) => {
    const response = await fetch(`/api/v1/sites/${siteId}/work-orders/${orderId}`, { cache: 'no-store' });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { siteId: draftScope.devSite.id, orderId: new URL(orderUrl).pathname.split('/').at(-1) });
  assert.equal(crossAccountAccess.status, 403, 'A different account without DEV membership must be denied the first user’s work order.');
  assert.equal(JSON.stringify(crossAccountAccess.body).includes('Synthetic report:'), false, 'Denied account responses must not disclose the first user’s record.');
  check('A signed-in identity with no work role sees a clear access state, is scoped to QA and cannot access the first account’s DEV work order');
  await page.getByRole('button', { name: /sign out/i }).click();
  await page.getByRole('heading', { level: 1, name: 'You’re signed out', exact: true }).waitFor();
  await context.clearCookies({ domain: new URL(oidcIssuer).hostname });
  assert.deepEqual(errors, [], 'Browser must have no uncaught page errors');
  check('No uncaught browser errors during the tested staff workflow');
} catch (error) {
  checks.push({ name: 'Browser smoke execution', result: 'NOT VERIFIED', reason: error.message, at: new Date().toISOString() });
  await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
  process.stderr.write(`${error.stack}\n`);
} finally {
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ recordedAt: new Date().toISOString(), browser: browser.version(), url, scope: 'Local synthetic staff workflow including intake observation and diagnostic finding capture; owner sign-in, invitation token handling, and unpublished-record owner shell. Responsive checks cover sign-in, diagnostic form, and tested portal routes; automated Axe scans cover sign-in, owner portal, work-order queue and intake form; no physical-device, release, finance, or operational acceptance claim.', authenticatedViewports: authenticatedViewportMatrix.map(({ width, height, name }) => ({ width, height, name })), checks, accessibilityScans, pageErrors: errors }, null, 2) + '\n');
  process.stdout.write(`${checks.filter((item) => item.result === 'VERIFIED').length} browser checks verified.\n`);
  await browser.close();
}

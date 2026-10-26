import { expect, test, type Page, type Request, type Response, type TestInfo } from '@playwright/test';

const failureReports = new WeakMap<TestInfo, () => Promise<void>>();

// The test has already failed and its original error is registered before this
// guarded hook. The normal page fixture remains alive until after the hook.
test.afterEach(async ({}, testInfo) => {
  const report = failureReports.get(testInfo);
  failureReports.delete(testInfo);
  if (report) {
    try { await report(); } catch { /* Reporting never replaces the test error. */ }
  }
});

async function fragmentSnapshot(page: Page, phase: string, targetId: string) {
  return page.evaluate(({ phase, targetId }) => {
    const publicUrl = (value: string) => { const url = new URL(value); return `${url.origin}${url.pathname}${url.hash}`; };
    const geometry = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const ancestors = [];
      let parent = element.parentElement;
      for (let depth = 0; parent && depth < 8; depth++, parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent);
        ancestors.push({
          tag: parent.tagName, id: parent.id.slice(0, 100),
          hidden: parent.hidden, ariaHidden: parent.getAttribute('aria-hidden'), inert: parent.hasAttribute('inert'),
          display: parentStyle.display, visibility: parentStyle.visibility,
          streamContainer: /^(?:S|B):/.test(parent.id),
        });
      }
      return {
        tag: element.tagName, id: element.id, text: element.textContent?.trim().slice(0, 100),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom },
        display: style.display, visibility: style.visibility,
        position: style.position, scrollMarginTop: style.scrollMarginTop, ancestors,
      };
    };
    const matches = (id: string) => Array.from(document.querySelectorAll('[id]')).filter(element => element.id === id);
    const targets = matches(targetId);
    const fragment = decodeURIComponent(location.hash.slice(1));
    const fragmentTargets = fragment ? matches(fragment) : [];
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return {
      phase, url: publicUrl(location.href), readyState: document.readyState,
      visibilityState: document.visibilityState, timeOrigin: performance.timeOrigin,
      navigation: navigation ? { url: publicUrl(navigation.name), type: navigation.type, domContentLoadedEventEnd: navigation.domContentLoadedEventEnd, loadEventEnd: navigation.loadEventEnd, duration: navigation.duration } : null,
      fonts: document.fonts.status, viewport: { width: innerWidth, height: innerHeight },
      scroll: { x: scrollX, y: scrollY, restoration: history.scrollRestoration, element: document.scrollingElement?.tagName, top: document.scrollingElement?.scrollTop, height: document.scrollingElement?.scrollHeight },
      target: { id: targetId, count: targets.length, samples: targets.slice(0, 3).map(geometry) },
      fragment: { id: fragment, count: fragmentTargets.length, samples: fragmentTargets.slice(0, 3).map(geometry) },
    };
  }, { phase, targetId });
}

function fragmentDiagnostics(page: Page, testInfo: TestInfo, targetId: string, label: string) {
  const navigationEvents: { event: string; url: string }[] = [];
  const sessionResponses: { status: number; path: string }[] = [];
  let navigationOverflow = false;
  let sessionOverflow = false;
  let passiveObservationUnavailable = false;
  const recordNavigation = (event: string, value = page.url()) => {
    try {
      const url = new URL(value);
      if (navigationEvents.length < 12) navigationEvents.push({ event, url: `${url.origin}${url.pathname}${url.hash}` });
      else navigationOverflow = true;
    } catch { passiveObservationUnavailable = true; }
  };
  const navigated = (frame: ReturnType<Page['mainFrame']>) => { if (frame === page.mainFrame()) recordNavigation('main-frame-navigation'); };
  const documentReady = () => recordNavigation('domcontentloaded');
  const loaded = () => recordNavigation('load');
  const requested = (request: Request) => {
    try {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) recordNavigation('document-request', request.url());
    } catch { passiveObservationUnavailable = true; }
  };
  const responded = (response: Response) => {
    try {
      const url = new URL(response.url());
      if (url.origin !== new URL(page.url()).origin || url.pathname !== '/api/auth/session') return;
      // HTTP transport status only, not session identity/health. No body, cookies,
      // headers, query, user information, message, stack or new request is read.
      if (sessionResponses.length < 8) sessionResponses.push({ status: response.status(), path: url.pathname });
      else sessionOverflow = true;
    } catch { passiveObservationUnavailable = true; }
  };
  // These synchronous Node event listeners never evaluate page code, read layout,
  // wait for navigation/body/fonts, or change the original success-path awaits.
  page.on('framenavigated', navigated);
  page.on('domcontentloaded', documentReady);
  page.on('load', loaded);
  page.on('request', requested);
  page.on('response', responded);
  return {
    async reportFailure() {
      // Run only in the guarded post-failure hook, with an independent hard cap;
      // do not read private timeout state or delay the original error's throw.
      const budget = 750;
      let active = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<void>(resolve => {
        timer = setTimeout(() => { active = false; resolve(); }, budget);
      });
      const reporting = (async () => {
        try {
          // The original assertion has ALREADY failed. This is the only page
          // evaluation/layout read and the only attachment in either journey.
          const snapshot = await fragmentSnapshot(page, 'after-original-failure', targetId);
          if (!active) return;
          const evidence = JSON.stringify({ label, outcome: 'failed', navigationEvents, navigationOverflow, sessionResponses, sessionOverflow, passiveObservationUnavailable, snapshot });
          console.warn(`Public fragment failure diagnostic: ${evidence}`);
          await testInfo.attach(`public-${label}-fragment-failure.json`, { body: Buffer.from(evidence), contentType: 'application/json' });
        } catch {
          if (active) console.warn(`Public ${label}-fragment diagnostic unavailable; original failure retained.`);
        }
      })();
      try {
        await Promise.race([reporting, deadline]);
      } finally {
        active = false;
        if (timer !== undefined) clearTimeout(timer);
      }
    },
    dispose() {
      page.off('framenavigated', navigated);
      page.off('domcontentloaded', documentReady);
      page.off('load', loaded);
      page.off('request', requested);
      page.off('response', responded);
    },
  };
}

// Keep these anonymous regressions independent of the serial account/ledger flow.
// First load the fragment, then navigate home through the client-side brand link
// so the help route has the same cached initial-fragment history as the defect.
test('returns from cached first-workflow help through the brand and home CTA to exactly one fragment', async ({ page }, testInfo) => {
  const diagnostic = fragmentDiagnostics(page, testInfo, 'erste-rechnung-title', 'first-workflow');
  try {
    await page.goto('/help#erste-rechnung');
    const origin = new URL(page.url()).origin;
    const expected = `${origin}/help#erste-rechnung`;
    await expect(page).toHaveURL(expected);
    await expect(page.locator('#erste-rechnung-title')).toBeVisible();
    await page.getByRole('link', { name: 'Bivaro Startseite', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/`);
    const workflow = page.getByRole('link', { name: 'Erste Rechnung', exact: true });
    await expect(workflow).toHaveAttribute('href', '/help#erste-rechnung');
    await workflow.click();
    await expect(page).toHaveURL(expected);
    await expect(page.locator('#erste-rechnung')).toBeInViewport();
    await expect(page.locator('#erste-rechnung-title')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('cached-help-first-workflow-exact-fragment.png'), fullPage: true });
  } catch (error) {
    failureReports.set(testInfo, () => diagnostic.reportFailure());
    throw error;
  } finally {
    diagnostic.dispose();
  }
});

test('returns from cached offer help through the brand and home footer to exactly one fragment', async ({ page }, testInfo) => {
  const diagnostic = fragmentDiagnostics(page, testInfo, 'angebot', 'offer');
  try {
    await page.goto('/help#angebot');
    const origin = new URL(page.url()).origin;
    const expected = `${origin}/help#angebot`;
    await expect(page).toHaveURL(expected);
    await expect(page.locator('#angebot')).toBeVisible();
    await page.getByRole('link', { name: 'Bivaro Startseite', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/`);
    const offer = page.getByRole('navigation', { name: 'Weitere Informationen', exact: true })
      .getByRole('link', { name: 'Angebot und Quellcode', exact: true });
    await expect(offer).toHaveAttribute('href', '/help#angebot');
    await offer.click();
    await expect(page).toHaveURL(expected);
    await expect(page.locator('#angebot')).toBeInViewport();
    await expect(page.locator('#angebot')).toContainText('Angebot');
    await page.screenshot({ path: testInfo.outputPath('cached-help-footer-offer-exact-fragment.png'), fullPage: true });
  } catch (error) {
    failureReports.set(testInfo, () => diagnostic.reportFailure());
    throw error;
  } finally {
    diagnostic.dispose();
  }
});

import { expect, test, type Page, type TestInfo } from '@playwright/test';

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
  const recordNavigation = (event: string) => {
    const url = new URL(page.url());
    if (navigationEvents.length < 12) navigationEvents.push({ event, url: `${url.origin}${url.pathname}${url.hash}` });
  };
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) recordNavigation('main-frame-navigation'); });
  page.on('domcontentloaded', () => recordNavigation('domcontentloaded'));
  page.on('load', () => recordNavigation('load'));
  const snapshots: Awaited<ReturnType<typeof fragmentSnapshot>>[] = [];
  return {
    async observe(phase: string) {
      try { snapshots.push(await fragmentSnapshot(page, phase, targetId)); }
      catch { recordNavigation(`snapshot-unavailable:${phase}`); }
    },
    async report(outcome: string) {
      // Diagnostics never scroll, wait for fonts, retry, relax strict locators or
      // replace the original assertion/error. Only public paths/hashes are kept.
      try {
        const evidence = JSON.stringify({ label, outcome, navigationEvents, snapshots });
        console.warn(`Public fragment diagnostic: ${evidence}`);
        await testInfo.attach(`public-${label}-fragment-diagnostic.json`, { body: Buffer.from(evidence), contentType: 'application/json' });
      } catch {
        console.warn(`Public ${label}-fragment diagnostic unavailable; original outcome retained.`);
      }
    },
  };
}

// Keep these anonymous regressions independent of the serial account/ledger flow.
// First load the fragment, then navigate home through the client-side brand link
// so the help route has the same cached initial-fragment history as the defect.
test('returns from cached first-workflow help through the brand and home CTA to exactly one fragment', async ({ page }, testInfo) => {
  const diagnostic = fragmentDiagnostics(page, testInfo, 'erste-rechnung-title', 'first-workflow');
  let outcome = 'failed';
  try {
    await page.goto('/help#erste-rechnung');
    await diagnostic.observe('initial-document');
    const origin = new URL(page.url()).origin;
    const expected = `${origin}/help#erste-rechnung`;
    await expect(page).toHaveURL(expected);
    await expect(page.locator('#erste-rechnung-title')).toBeVisible();
    await page.getByRole('link', { name: 'Bivaro Startseite', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/`);
    await diagnostic.observe('home-after-brand');
    const workflow = page.getByRole('link', { name: 'Erste Rechnung', exact: true });
    await expect(workflow).toHaveAttribute('href', '/help#erste-rechnung');
    await workflow.click();
    await expect(page).toHaveURL(expected);
    await diagnostic.observe('returned-help-before-viewport');
    await expect(page.locator('#erste-rechnung')).toBeInViewport();
    await expect(page.locator('#erste-rechnung-title')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('cached-help-first-workflow-exact-fragment.png'), fullPage: true });
    outcome = 'passed';
  } catch (error) {
    await diagnostic.observe('failure');
    throw error;
  } finally {
    await diagnostic.report(outcome);
  }
});

test('returns from cached offer help through the brand and home footer to exactly one fragment', async ({ page }, testInfo) => {
  const diagnostic = fragmentDiagnostics(page, testInfo, 'angebot', 'offer');
  let outcome = 'failed';
  try {
    await page.goto('/help#angebot');
    await diagnostic.observe('initial-document');
    const origin = new URL(page.url()).origin;
    const expected = `${origin}/help#angebot`;
    await expect(page).toHaveURL(expected);
    await expect(page.locator('#angebot')).toBeVisible();
    await page.getByRole('link', { name: 'Bivaro Startseite', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/`);
    await diagnostic.observe('home-after-brand');
    const offer = page.getByRole('navigation', { name: 'Weitere Informationen', exact: true })
      .getByRole('link', { name: 'Angebot und Quellcode', exact: true });
    await expect(offer).toHaveAttribute('href', '/help#angebot');
    await offer.click();
    await expect(page).toHaveURL(expected);
    await diagnostic.observe('returned-help-before-viewport');
    await expect(page.locator('#angebot')).toBeInViewport();
    await expect(page.locator('#angebot')).toContainText('Angebot');
    await page.screenshot({ path: testInfo.outputPath('cached-help-footer-offer-exact-fragment.png'), fullPage: true });
    outcome = 'passed';
  } catch (error) {
    await diagnostic.observe('failure');
    throw error;
  } finally {
    await diagnostic.report(outcome);
  }
});

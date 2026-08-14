/**
 * Phone-viewport regression checks (issue #4883, part of the responsive-first direction in #4875).
 *
 * Loads each already-responsive page on an iPhone-class device and fails if anything in the layout reaches past
 * the viewport's edges. As #4875 retires the UA redirects page by page, each converted page gets added here so it
 * can't silently regress; today's job is to lock in the pages that already behave.
 *
 * This is a LAYOUT gate, not the error gate — pages.spec.js asserts pages initialize without console errors.
 */
const {devices} = require('@playwright/test');
const {test, expect, stubMapbox, waitForAppReady, STORAGE_STATE} = require('./fixtures');

// A phone, not just a narrow window: the mobile user agent, touch, and device pixel ratio all come with it, so a
// page that only holds together for a desktop UA fails here the way it would on a real phone. 390x844 is
// iPhone-class and the narrow end of what we design for. The device descriptor also carries the browser Apple
// ships it with, which has to be put back — chromium is the one browser this suite installs.
const PHONE = {...devices['iPhone 13'], defaultBrowserType: 'chromium', viewport: {width: 390, height: 844}};

test.use(PHONE);

// mapbox: page builds a Mapbox map at init — stub it (see fixtures.js) so a dummy CI key can't hang init.
// The landing page, /gallery and /labelMap are absent on purpose: a mobile user agent is still redirected off them
// to /mobileLanding, and they join this list as #4875 phase 2 converts and un-redirects them one at a time.
const PAGES = [
  {path: '/signIn'},
  {path: '/signUp'},
  {path: '/about'},
  {path: '/leaderboard'},
  {path: '/routes'},
  {path: '/stories'},
  {path: '/help'},
  {path: '/labelingGuide'},
  {path: '/api'},
  {path: '/v3/api-docs/rawLabels'},
  {path: '/v3/api-docs/streets'},
  {path: '/cities', mapbox: true},
  {path: '/mobileLanding'},
];

/**
 * Reports every visible element whose box reaches past the viewport horizontally.
 *
 * Runs in the page. Measuring boxes rather than scroll extent is the point: `body { overflow-x: clip }` (main.css)
 * keeps overflowing content from ever growing the scroll width, so the page hides its own overflow — the content is
 * simply lost off the edge, which is what #4857's footer did.
 *
 * Two things are deliberately not overflow. An element inside a horizontally scrollable/clipping ancestor is
 * contained by design (our convention for wide tables, diagrams and code blocks), so the walk up looks for one —
 * stopping below <body>, whose own clip is what this check exists to see through. And anything under 2x2 px is the
 * screen-reader-only idiom (Bootstrap's `.sr-only` parks a clipped 1x1 box at a negative offset), not content.
 */
const FIND_OVERFLOW = () => {
  const viewportWidth = document.documentElement.clientWidth;
  const clipsHorizontally = (el) => ['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(el).overflowX);
  const offenders = [];
  for (const el of document.body.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    if (box.right <= viewportWidth + 0.5 && box.left >= -0.5) continue;
    let contained = false;
    for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (clipsHorizontally(parent)) { contained = true; break; }
    }
    if (contained) continue;
    const name = el.id ? `#${el.id}` : `.${String(el.className).trim().split(/\s+/).join('.')}`;
    offenders.push(`<${el.tagName.toLowerCase()}>${name} spans ${Math.round(box.left)}..${Math.round(box.right)}px`);
  }
  return {
    viewportWidth,
    scrollWidth: document.scrollingElement.scrollWidth,
    clientWidth: document.scrollingElement.clientWidth,
    offenders,
  };
};

/**
 * Asserts nothing in the page's layout sticks out past the viewport horizontally.
 *
 * @param {import('@playwright/test').Page} page - The page to measure.
 * @param {string} path - The path under test, for the failure message.
 */
async function expectNoHorizontalOverflow(page, path) {
  // Web fonts change text metrics, so measuring before they land would measure a layout no one sees.
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.evaluate(FIND_OVERFLOW);
  expect(layout.offenders, `${path} has content past the ${layout.viewportWidth}px viewport`).toEqual([]);
  // Backstop for overflow on <html>, which body's overflow-x: clip doesn't cover. One px of slack: sub-pixel
  // layout rounds up into scrollWidth on pages that fit.
  expect(layout.scrollWidth, `${path} scrolls horizontally`).toBeLessThanOrEqual(layout.clientWidth + 1);
}

// A viewport-sized shot of a failure usually cuts off the element that caused it, so keep the whole page.
test.afterEach(async ({page}, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach('full-page', {body: await page.screenshot({fullPage: true}), contentType: 'image/png'});
});

for (const p of PAGES) {
  test(`${p.path} fits a phone viewport`, async ({page, context}) => {
    if (p.mapbox) await stubMapbox(context);
    const response = await page.goto(p.path);
    expect(response.status(), `${p.path} responded ${response.status()}`).toBeLessThan(400);
    // A page that redirected a mobile user agent elsewhere would otherwise pass by measuring the wrong page.
    expect(new URL(page.url()).pathname, `${p.path} redirected`).toBe(p.path);
    await waitForAppReady(page);
    await expectNoHorizontalOverflow(page, p.path);
  });
}

// A layout check that can't fail is worse than no check, and the two exemptions above are where that would happen
// quietly. Injecting one of each shape proves the detector still tells them apart.
test('the overflow check sees overflow, and only overflow', async ({page}) => {
  await page.goto('/signIn');
  await waitForAppReady(page);
  await page.evaluate(() => {
    const add = (id, style, parent = document.body) => {
      const el = document.createElement('div');
      el.id = id;
      el.style.cssText = style;
      parent.append(el);
      return el;
    };
    add('probe-overflowing', 'width: 900px; height: 40px;');
    add('probe-scrolled', 'width: 900px; height: 40px;', add('probe-scroller', 'overflow-x: auto; width: 100%;'));
    add('probe-screen-reader-only', 'position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden;');
  });

  const {offenders} = await page.evaluate(FIND_OVERFLOW);
  expect(offenders.join('\n')).toContain('#probe-overflowing');
  expect(offenders.join('\n')).not.toContain('#probe-scrolled');
  expect(offenders.join('\n')).not.toContain('#probe-screen-reader-only');
});

test.describe('registered-user pages', () => {
  test.use({storageState: STORAGE_STATE});

  test('/dashboard fits a phone viewport', async ({page, context}) => {
    await stubMapbox(context); // The contribution choropleth is a Mapbox map.
    const response = await page.goto('/dashboard');
    expect(response.status(), `/dashboard responded ${response.status()}`).toBeLessThan(400);
    expect(page.url(), 'a bounced session would measure /signIn instead').toContain('/dashboard');
    await waitForAppReady(page);
    await expectNoHorizontalOverflow(page, '/dashboard');
  });
});

/**
 * The label card's paging arrows at the end of the list keep keyboard focus (#5135).
 *
 * An arrow can switch itself off while focused, as Prev does when it pages back to the first card. The native
 * `disabled` attribute would make the browser drop focus to the body without a word, so the arrow takes
 * `aria-disabled="true"`, which blocks nothing on its own. This checks both halves in a real browser: focus stays
 * on the arrow and a screen reader is told it is off, and a switched-off arrow ignores Enter, Space and a click. The
 * jsdom tests cover the same logic, but focus loss and Playwright's view of the button's state need real layout.
 *
 * Gallery's expanded view hosts the card rather than LabelMap's popup: it opens from a plain card click on CI's
 * seed and a dev database alike, while a LabelMap marker is a feature on a Mapbox canvas the stub draws no map on,
 * which leaves nothing to click. Both hosts switch their arrows through the same pagingArrows.js. Prev at the first
 * card is the end used, since every gallery has a first card and only a short one has its last card on the first page.
 */
const {test, expect, serveAnyPano, loadAndSettle} = require('./fixtures');
const AxeBuilder = require('@axe-core/playwright').default;
const {PAGES} = require('./pages');
const {WCAG_TAGS, partitionViolations, formatViolations} = require('./a11y-allowlist');

const GALLERY = PAGES.find((p) => p.path === '/gallery');
// The a11y-allowlist.js key for the open card, a render state the page walk never reaches.
const A11Y_STATE = `${GALLERY.path} [expanded card]`;
const NO_BACKUP_404 = /status of 404 .*\/backupImage\/[^/]+\/metadata\)$/;

/**
 * The label the expanded view is showing, as it writes it into the shareable ?labelId= param.
 * @param {import('@playwright/test').Page} page - The Gallery page.
 * @returns {Promise<?string>} The label id, or null with the view closed.
 */
async function shownLabelId(page) {
  return new URL(page.url()).searchParams.get('labelId');
}

test('Prev at the first card switches off with aria-disabled, keeps focus, and ignores presses', async ({page,
  context, consoleErrors}) => {
  // A dev database's panos are live; this lets the Maps stub stand in for them. CI's are expired and use backups.
  await serveAnyPano(context);
  await loadAndSettle(page, context, GALLERY);

  // Card images carry `label_id_<id>`, in the order the expanded view pages through them.
  const images = page.locator('.gallery-card .static-gallery-image');
  const cardCount = await images.count();
  test.skip(cardCount < 2, `Gallery shows ${cardCount} card(s); paging needs at least two`);
  const labelIdOf = async (i) => (await images.nth(i).getAttribute('id')).replace('label_id_', '');
  const [firstId, secondId] = [await labelIdOf(0), await labelIdOf(1)];

  // The holder rather than the image: a card whose crop is missing covers its image with a placeholder, which opens
  // the card just the same.
  await page.locator('.gallery-card .image-holder').nth(1).click();
  const view = page.locator('.gallery-expanded-view');
  await expect(view).toBeVisible();
  await expect.poll(() => shownLabelId(page)).toBe(secondId);
  const prev = view.locator('.label-detail__paging--prev');
  const next = view.locator('.label-detail__paging--next');
  await expect(prev).not.toHaveAttribute('aria-disabled', 'true');

  // Paging back to the first card switches off the arrow that was pressed.
  await prev.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => shownLabelId(page), 'Prev did not page back to the first card').toBe(firstId);
  await expect(prev).toHaveAttribute('aria-disabled', 'true');
  await expect(prev, 'native disabled drops focus to the body (#5135)').not.toHaveAttribute('disabled');
  await expect(prev, 'switching off moved focus off the arrow').toBeFocused();

  // Each press dispatches its click synchronously, before Playwright's call returns, so the label read after it is
  // the outcome. `force` because Playwright, like a screen reader, treats an aria-disabled button as disabled and would
  // otherwise wait for it; the point here is what a pointer that clicks it anyway gets.
  const presses = {
    Enter: () => page.keyboard.press('Enter'),
    Space: () => page.keyboard.press('Space'),
    click: () => prev.click({force: true}),
  };
  for (const [name, press] of Object.entries(presses)) {
    await press();
    expect(await shownLabelId(page), `${name} on the switched-off Prev changed the label`).toBe(firstId);
    await expect(prev, `${name} switched Prev back on`).toHaveAttribute('aria-disabled', 'true');
  }
  await prev.focus();
  await expect(prev).toBeFocused();

  // axe in the switched-off state, over the open card: the grid it dims is the page a11y.spec.js already gates, and
  // that dimming's own contrast failure is #5917.
  const results = await new AxeBuilder({page}).include('.gallery-expanded-view').withTags(WCAG_TAGS).analyze();
  const {blocking, staleEntries} = partitionViolations(A11Y_STATE, results.violations);
  for (const entry of staleEntries) {
    test.info().annotations.push({type: 'stale-a11y-allowlist',
      description: `${A11Y_STATE}: '${entry.rule}' on '${entry.selector}' no longer fires (${entry.issue})`});
  }
  expect(formatViolations(blocking), 'WCAG 2.1 AA violations in the card with Prev switched off').toEqual([]);

  // Paging forward again gives Prev somewhere to go, so it switches back on.
  await next.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => shownLabelId(page), 'Next did not page forward').toBe(secondId);
  await expect(prev).not.toHaveAttribute('aria-disabled', 'true');
  await expect(prev).not.toHaveAttribute('disabled');

  // A dev database has expired panos with no backup on disk. /backupImage/:id/metadata answers those with a 404 that
  // the card handles (it falls back to the crop) but Chromium logs. CI installs a backup for every seeded pano, so
  // there the same 404 means the media went missing, and it still fails.
  const errors = process.env.CI ? consoleErrors : consoleErrors.filter((e) => !NO_BACKUP_404.test(e));
  expect(errors).toEqual([]);
});

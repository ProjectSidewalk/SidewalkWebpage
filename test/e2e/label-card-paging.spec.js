/**
 * The label card's paging arrows keep keyboard focus when they switch off (#5135). Paging Gallery's open card back
 * to the first label switches off Prev, which must keep focus, ignore presses, and pass axe. Gallery hosts the card
 * because LabelMap's markers sit on a map canvas with nothing a spec can click.
 */
const {test, expect, serveAnyPano, loadAndSettle} = require('./fixtures');
const AxeBuilder = require('@axe-core/playwright').default;
const {PAGES} = require('./pages');
const {OTHER_FORCED_STATES, WCAG_TAGS, partitionViolations, formatViolations} = require('./a11y-allowlist');

const GALLERY = PAGES.find((p) => p.path === '/gallery');
// The a11y-allowlist.js key for the open card.
const A11Y_STATE = OTHER_FORCED_STATES.galleryExpandedCard;
const NO_BACKUP_404 = /status of 404 .*\/backupImage\/[^/]+\/metadata\)$/;

/**
 * The label the expanded view shows, read from its ?labelId= param.
 * @param {import('@playwright/test').Page} page - The Gallery page.
 * @returns {Promise<?string>} The label id, or null with the view closed.
 */
async function shownLabelId(page) {
  return new URL(page.url()).searchParams.get('labelId');
}

test('Prev at the first card switches off with aria-disabled, keeps focus, and ignores presses', async ({page,
  context, consoleErrors}) => {
  // Lets the Maps stub stand in for a dev database's live panos.
  await serveAnyPano(context);
  await loadAndSettle(page, context, GALLERY);

  // Card images carry `label_id_<id>`, in the order the expanded view pages through them.
  const images = page.locator('.gallery-card .static-gallery-image');
  const cardCount = await images.count();
  test.skip(cardCount < 2, `Gallery shows ${cardCount} card(s); paging needs at least two`);
  const labelIdOf = async (i) => (await images.nth(i).getAttribute('id')).replace('label_id_', '');
  const [firstId, secondId] = [await labelIdOf(0), await labelIdOf(1)];

  // The holder, not the image: a missing crop covers the image with a placeholder.
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

  // Each press clicks synchronously, so the label read right after is its outcome. `force` because Playwright
  // waits on an aria-disabled button; this tests what clicking it anyway does.
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

  // Just the open card: a11y.spec.js already gates the grid behind it.
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

  // A dev database's expired panos have no backup, so /backupImage/:id/metadata 404s and the card falls back to the
  // crop. CI has a backup for every seeded pano, so there a 404 still fails.
  const errors = process.env.CI ? consoleErrors : consoleErrors.filter((e) => !NO_BACKUP_404.test(e));
  expect(errors).toEqual([]);
});

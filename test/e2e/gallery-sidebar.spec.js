/**
 * Gallery's filter column on a short window (#5967): every filter has to be reachable without scrolling the cards.
 *
 * The column sticks under the navbar, so whatever part of it is below the fold stays there until the page runs out.
 * Only a browser can say whether it fits the window or scrolls on its own.
 */
const {test, expect, loadAndSettle} = require('./fixtures');
const {PAGES} = require('./pages');

const GALLERY = PAGES.find((p) => p.path === '/gallery');

/**
 * Reads where the column sits and whether it scrolls.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{bottom: number, windowHeight: number, scrolls: boolean, position: string, overflowY: string}>}
 */
function sidebarLayout(page) {
  return page.locator('.sidebar').evaluate((sidebar) => {
    const {position, overflowY} = getComputedStyle(sidebar);
    return {
      bottom: sidebar.getBoundingClientRect().bottom,
      windowHeight: window.innerHeight,
      scrolls: sidebar.scrollHeight > sidebar.clientHeight,
      position,
      overflowY,
    };
  });
}

test.describe('on a short laptop window', () => {
  test.use({viewport: {width: 1366, height: 768}});

  test('/gallery reaches every filter without scrolling the cards', async ({page, context}) => {
    await loadAndSettle(page, context, GALLERY);

    // A local database has tags and so a tag list to open; CI's small seed may have none.
    const tagToggle = page.locator('.sidebar .filter-sidebar__tag-toggle:visible').first();
    if (await tagToggle.count() && await tagToggle.getAttribute('aria-expanded') !== 'true') await tagToggle.click();

    const layout = await sidebarLayout(page);
    expect(layout.bottom, 'the column ends inside the window').toBeLessThanOrEqual(layout.windowHeight);

    // Focusing the last filter scrolls the column, not the page, and leaves it on screen. Its name is what gets
    // measured, because the checkbox itself is visually hidden.
    const lastRow = page.locator('.sidebar .filter-sidebar__item').last();
    await lastRow.locator('input').focus();
    await expect(lastRow.locator('.filter-sidebar__item-name')).toBeInViewport({ratio: 1});
    expect(await page.evaluate(() => window.scrollY), 'the page stayed where it was').toBe(0);
  });
});

test.describe('on a tall window', () => {
  test.use({viewport: {width: 1366, height: 1400}});

  test('/gallery shows the whole filter column with no scrollbar of its own', async ({page, context}) => {
    await loadAndSettle(page, context, GALLERY);
    expect((await sidebarLayout(page)).scrolls).toBe(false);
  });
});

test.describe('stacked above the cards', () => {
  test.use({viewport: {width: 768, height: 700}});

  test('/gallery lets the filters scroll with the page', async ({page, context}) => {
    await loadAndSettle(page, context, GALLERY);
    await page.locator('#gallery-filter-toggle').click();
    const layout = await sidebarLayout(page);
    expect(layout.position).toBe('static');
    expect(layout.overflowY).toBe('visible');
    expect(layout.scrolls).toBe(false);
  });
});

test('/gallery tabs from a filter to its "Only" button, which works by keyboard (#5999)', async ({page, context}) => {
  await loadAndSettle(page, context, GALLERY);
  const labelTypes = page.locator('.sidebar [data-filter-section="label-type"]');
  const row = labelTypes.locator('.filter-sidebar__item-row').nth(1);
  const only = row.locator('.filter-sidebar__only');

  // Stepping back and forward arrives by keyboard, which is what shows "Only". Chrome drops focus to the page on the
  // next Tab if the button it is heading for stops being rendered as the checkbox lets go.
  await expect(row.locator('input')).toBeEnabled();
  await row.locator('input').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(only).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(only).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(labelTypes.locator('.filter-sidebar__checkbox:checked')).toHaveCount(1);
  await expect(row.locator('input')).toBeChecked();
});

test('/gallery hides "Only" without moving the filters or holding focus (#5999)', async ({page, context}) => {
  await loadAndSettle(page, context, GALLERY);
  const cell = page.locator('.sidebar .filter-sidebar__severity-cell').nth(1);
  const only = cell.locator('.filter-sidebar__only');
  const width = () => only.evaluate((el) => el.getBoundingClientRect().width);

  // In some languages "Only" is the widest thing in its severity column, so it holds its width while out of sight.
  const hiddenWidth = await width();
  expect(hiddenWidth).toBeGreaterThan(0);
  await cell.hover();
  expect(await width()).toBe(hiddenWidth);

  // Once the pointer leaves, a clicked "Only" is out of sight again, and Space must not be able to press it there.
  await only.click();
  await page.mouse.move(0, 0);
  await expect(only).not.toBeFocused();
});

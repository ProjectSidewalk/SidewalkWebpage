/** Expert Validate as the suite's admin, on the Maps stub so nothing is billed. */
const {test, expect, serveAnyPano, signInAsAdmin, loadValidate, pastDoubleTapGuard, nextLabel, currentLabelId,
  readLabel} = require('./fixtures');

test.beforeEach(async ({page, context}) => {
  await serveAnyPano(context);
  await signInAsAdmin(context);
  const onMission = await loadValidate(page, '/expertValidate');
  test.skip(!onMission, 'Expert Validate settled on the no-mission modal, so there is nothing to validate');
  // The mission-start tutorial holds the keyboard until closed; clicked from the page, as its own overlay covers it.
  await page.evaluate(() => document.querySelector('.mission-start-tutorial-done-btn').click());
});

test.describe('the tag search box lets S submit after a tag is added (#5946)', () => {
  test('a tag clicked in the list leaves the box, and S submits it', async ({page, consoleErrors}) => {
    const {id, tag} = await agreeAndOpenTags(page);

    await page.locator('#select-tag-ts-dropdown [data-selectable]').first().click();
    await expect(page.locator('#select-tag-ts-control')).not.toBeFocused();

    await page.keyboard.press('s');
    await nextLabel(page, id);
    await expect.poll(async () => (await readLabel(page, id)).tags, `label ${id} was not saved with "${tag}"`)
      .toContain(tag);
    expect(consoleErrors).toEqual([]);
  });

  test('a tag picked by Enter keeps the box, and one Escape closes the list and leaves it', async ({page,
    consoleErrors}) => {
    const {id, tag} = await agreeAndOpenTags(page);
    const box = page.locator('#select-tag-ts-control');

    await page.keyboard.press('Enter');
    await expect(box).toBeFocused();
    // Still the box's own key: S types into the search and reopens the list instead of submitting.
    await page.keyboard.press('s');
    await expect(box).toHaveValue('s');
    await expect(box).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('Escape');
    await expect(box).not.toBeFocused();
    await expect(box).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('s');
    await nextLabel(page, id);
    await expect.poll(async () => (await readLabel(page, id)).tags, `label ${id} was not saved with "${tag}"`)
      .toContain(tag);
    expect(consoleErrors).toEqual([]);
  });
});

/**
 * Agrees with the label on screen, which shows the tag editor, and focuses the tag search with its list open.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{id: number, tag: string}>} The label, and the tag at the top of the list, which a pick takes.
 */
async function agreeAndOpenTags(page) {
  await pastDoubleTapGuard(page);
  const id = await currentLabelId(page);
  await page.locator('#validate-yes-button').click();
  await page.locator('#select-tag-ts-control').click();
  const first = page.locator('#select-tag-ts-dropdown [data-selectable]').first();
  await expect(first).toBeVisible();
  // Highlighted, so Enter picks it too.
  await expect(first).toHaveClass(/active/);
  return {id, tag: await first.getAttribute('data-value')};
}

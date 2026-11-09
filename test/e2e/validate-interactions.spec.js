/**
 * Validate's verdicts end to end (#4948). ValidateSubmissionSpec covers the endpoint; this covers the UI that builds
 * the payload.
 *
 * Nothing here is billed (#5129). On CI every seeded pano is expired, so Validate shows the committed backups in
 * Pannellum. On a dev database the panos are live, and `serveAnyPano` lets the Maps stub stand in for them: it draws
 * nothing, but the menu, shortcuts and undo don't need the image.
 *
 * Counts are compared with a reading taken just before each vote, not fixed numbers, because other users (and a CI
 * retry) vote on the same labels. Expert Validate's tests are in this file for the same reason: its admin votes on the
 * same seeded labels, and one file runs its tests one at a time, so no vote lands between a reading and its check.
 */
const {test, expect, serveAnyPano, signInAsAdmin, loadValidate, pastDoubleTapGuard, nextLabel, currentLabelId,
  readLabel} = require('./fixtures');

const COUNT_FIELD = {Agree: 'num_agree', Disagree: 'num_disagree', Unsure: 'num_unsure'};

test.describe('Validate', () => {
  test.beforeEach(async ({page, context}) => {
    await serveAnyPano(context);
    await startMission(page, '/validate');
  });

  test('Agree, Disagree and Unsure clicked in the menu are saved', async ({page, consoleErrors}) => {
    const buttons = {Agree: '#validate-yes-button', Disagree: '#validate-no-button', Unsure: '#validate-unsure-button'};
    for (const [verdict, button] of Object.entries(buttons)) {
      const label = await startVote(page);
      await page.locator(button).click();
      await page.locator('#validate-submit-button').click();
      await nextLabel(page, label.id);
      await expectSaved(page, label, verdict);
    }
    expect(consoleErrors).toEqual([]);
  });

  test('Agree, Disagree and Unsure by keyboard shortcut are saved', async ({page, consoleErrors}) => {
    // Each verdict's keys, and each way to submit: S, and Enter from anywhere.
    const shortcuts = [['Agree', 'a', 'Enter'], ['Disagree', 'n', 's'], ['Unsure', 'u', 'Enter']];
    for (const [verdict, key, submit] of shortcuts) {
      const label = await startVote(page);
      await page.keyboard.press(key);
      await page.keyboard.press(submit);
      await nextLabel(page, label.id);
      await expectSaved(page, label, verdict);
    }
    expect(consoleErrors).toEqual([]);
  });

  test('undo takes back a saved verdict and lets it be changed', async ({page, consoleErrors}) => {
    // By button, by B, and by Ctrl+Z, each once the verdict has reached the server.
    const undos = [
      () => page.locator('#validate-undo-button').click(),
      () => page.keyboard.press('b'),
      () => page.keyboard.press('Control+z'),
    ];
    const undoButton = page.locator('#validate-undo-button');
    // Nothing to go back to on the mission's first label.
    await expect(undoButton).toBeDisabled();
    for (const undo of undos) {
      const label = await startVote(page);
      await page.keyboard.press('y');
      await page.keyboard.press('Enter');
      await nextLabel(page, label.id);
      await expectSaved(page, label, 'Agree');

      await expect(undoButton).toBeEnabled();
      await undo();
      await expect.poll(() => currentLabelId(page), 'undo did not go back to the label').toBe(label.id);
      // The menu shows the verdict being taken back, so it can be changed rather than chosen again.
      await expect(page.locator('#validate-yes-button')).toHaveClass(/is-chosen/);
      await expectSaved(page, label, null);

      await pastDoubleTapGuard(page);
      await page.keyboard.press('n');
      await page.keyboard.press('Enter');
      await nextLabel(page, label.id);
      await expectSaved(page, label, 'Disagree');
    }
    expect(consoleErrors).toEqual([]);
  });
});

test.describe('Expert Validate, as the suite\'s admin', () => {
  test.beforeEach(async ({page, context}) => {
    await serveAnyPano(context);
    await signInAsAdmin(context);
    await startMission(page, '/expertValidate');
  });

  // The tag search box gives the keys back after a pick, so S submits (#5946).
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
 * Loads a Validate page and closes its mission-start tutorial, which holds the keyboard until closed. Skips the test
 * when the page has no mission to give.
 * @param {import('@playwright/test').Page} page
 * @param {string} path
 */
async function startMission(page, path) {
  const onMission = await loadValidate(page, path);
  test.skip(!onMission, `${path} settled on the no-mission modal, so there is nothing to validate`);
  // Clicked from the page, as the tutorial's own overlay covers the button.
  await page.evaluate(() => document.querySelector('.mission-start-tutorial-done-btn').click());
}

test('the Details popover links the label id to the label\'s page', async ({page, consoleErrors}) => {
  const id = await currentLabelId(page);
  await page.locator('#pano-info-button').click();
  // The suite's user isn't an admin, so the link is the public page rather than the admin view.
  const link = page.locator('#pano-info-popover [data-field="label-id"] a');
  await expect(link).toHaveAttribute('href', `/label/${id}`);
  await expect(link).toHaveAttribute('target', '_blank');
  expect(consoleErrors).toEqual([]);
});

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{id: number, counts: Record<string, number>}>} The current label and its counts before the vote.
 */
async function startVote(page) {
  await pastDoubleTapGuard(page);
  const id = await currentLabelId(page);
  return {id, counts: countsOf(await readLabel(page, id))};
}

/**
 * Waits until the server has the viewer's verdict on a label, and only that one vote added to its counts.
 * @param {import('@playwright/test').Page} page
 * @param {{id: number, counts: Record<string, number>}} label From startVote.
 * @param {?string} verdict Null after an undo.
 */
async function expectSaved(page, label, verdict) {
  const expected = {...label.counts};
  if (verdict) expected[COUNT_FIELD[verdict]] += 1;
  await expect.poll(async () => {
    const saved = await readLabel(page, label.id);
    return {verdict: saved.user_validation, counts: countsOf(saved)};
  }, `label ${label.id} was not saved as ${verdict}`).toEqual({verdict, counts: expected});
}

/**
 * @param {Record<string, any>} label A GET /label/id/:id response.
 * @returns {Record<string, number>} Its three verdict counts.
 */
function countsOf(label) {
  return Object.fromEntries(Object.values(COUNT_FIELD).map((field) => [field, label[field]]));
}

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

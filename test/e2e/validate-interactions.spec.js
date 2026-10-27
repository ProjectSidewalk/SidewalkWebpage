/**
 * Validate's verdicts end to end (#4948). ValidateSubmissionSpec covers the endpoint; this covers the UI that builds
 * the payload.
 *
 * Nothing here is billed (#5129). On CI every seeded pano is expired, so Validate shows the committed backups in
 * Pannellum. On a dev database the panos are live, and `serveAnyPano` lets the Maps stub stand in for them: it draws
 * nothing, but the menu, shortcuts and undo don't need the image.
 *
 * Counts are compared with a reading taken just before each vote, not fixed numbers, because other users (and a CI
 * retry) vote on the same labels.
 */
const {test, expect, serveAnyPano, loadValidate, expectMissionInCi} = require('./fixtures');

const COUNT_FIELD = {Agree: 'num_agree', Disagree: 'num_disagree', Unsure: 'num_unsure'};

test.beforeEach(async ({page, context}) => {
  await serveAnyPano(context);
  const onMission = await loadValidate(page, '/validate');
  expectMissionInCi(onMission);
  test.skip(!onMission, 'Validate settled on the no-mission modal, so there is nothing to validate');
  // The mission-start tutorial holds the keyboard until closed; clicked from the page, as its own overlay covers it.
  await page.evaluate(() => document.querySelector('.mission-start-tutorial-done-btn').click());
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

    await page.keyboard.press('n');
    await page.keyboard.press('Enter');
    await nextLabel(page, label.id);
    await expectSaved(page, label, 'Disagree');
  }
  expect(consoleErrors).toEqual([]);
});

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{id: number, counts: Record<string, number>}>} The current label and its counts before the vote.
 */
async function startVote(page) {
  // A verdict within LabelContainer.VERDICT_GRACE_MS of the label appearing is dropped as a double tap.
  await page.waitForTimeout(500);
  const id = await currentLabelId(page);
  return {id, counts: countsOf(await readLabel(page, id))};
}

/**
 * Waits for Validate to move on from a label and finish loading the next one: the tool ignores input until then.
 * @param {import('@playwright/test').Page} page
 * @param {number} fromId The label just validated.
 */
async function nextLabel(page, fromId) {
  await expect.poll(() => currentLabelId(page), 'the verdict did not move Validate to the next label')
    .not.toBe(fromId);
  await expect(page.locator('#svv-application-holder')).not.toHaveClass(/validate-disabled/);
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
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>} The id of the label on screen.
 */
function currentLabelId(page) {
  return page.evaluate(() => window.svv.labelContainer.getCurrentLabel().getAuditProperty('labelId'));
}

/**
 * Through the page's session, so `user_validation` is this user's verdict.
 * @param {import('@playwright/test').Page} page
 * @param {number} id
 * @returns {Promise<Record<string, any>>} The GET /label/id/:id response.
 */
async function readLabel(page, id) {
  const response = await page.request.get(`/label/id/${id}`);
  expect(response.ok(), `GET /label/id/${id} responded ${response.status()}`).toBe(true);
  return response.json();
}

/**
 * @param {Record<string, any>} label A GET /label/id/:id response.
 * @returns {Record<string, number>} Its three verdict counts.
 */
function countsOf(label) {
  return Object.fromEntries(Object.values(COUNT_FIELD).map((field) => [field, label[field]]));
}

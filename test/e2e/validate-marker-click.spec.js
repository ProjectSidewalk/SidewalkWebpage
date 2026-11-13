/**
 * Validate's label marker with a real mouse (#4843): hover opens the card, a click pins it, a second click closes it,
 * and a drag is a pan. Uses the Maps stub or Pannellum backup, so nothing is billed.
 */
const {test, expect, serveAnyPano, loadValidate, pastDoubleTapGuard} = require('./fixtures');

// Past the 200 ms hover grace timer, so a check that the card stays up (or down) runs after the timer could fire.
const PAST_HIDE_DELAY_MS = 600;

test.beforeEach(async ({page, context}) => {
  await serveAnyPano(context);
  const onMission = await loadValidate(page, '/validate');
  test.skip(!onMission, 'Validate settled on the no-mission modal, so there is no label marker');
  // Close the mission-start tutorial, which holds the keyboard. Clicked in-page, since its overlay covers it.
  await page.evaluate(() => document.querySelector('.mission-start-tutorial-done-btn').click());
  await expect(page.locator('#validate-pano-marker')).toBeVisible();
});

test('hovering the marker shows the card, and leaving it hides the card', async ({page, consoleErrors}) => {
  const card = page.locator('#label-card');
  await expect(card).toBeHidden();
  await page.locator('#validate-pano-marker').hover();
  await expect(card).toBeVisible();
  await moveAway(page);
  await expect(card).toBeHidden();
  expect(consoleErrors).toEqual([]);
});

test('a click pins the card past the pointer leaving, and a second click closes it', async ({page, consoleErrors}) => {
  const marker = page.locator('#validate-pano-marker');
  const card = page.locator('#label-card');

  await marker.click();
  await expect(card).toBeVisible();
  await moveAway(page);
  await page.waitForTimeout(PAST_HIDE_DELAY_MS);
  await expect(card, 'a pinned card closed when the pointer left the marker').toBeVisible();
  await expect(marker).toHaveAttribute('aria-expanded', 'true');

  await marker.click();
  await expect(card).toBeHidden();
  await expect(marker).toHaveAttribute('aria-expanded', 'false');
  // Unpinned, it is a hover card again.
  await moveAway(page);
  await marker.hover();
  await expect(card).toBeVisible();
  await moveAway(page);
  await expect(card).toBeHidden();
  expect(consoleErrors).toEqual([]);
});

test('a press that drags from the marker is a pan, not a click that pins', async ({page, consoleErrors}) => {
  const marker = page.locator('#validate-pano-marker');
  const card = page.locator('#label-card');

  await marker.hover();
  await expect(card).toBeVisible();
  const {x, y} = await centerOf(marker);
  // Past the 5 px click slop and back, so the release lands on the marker and fires a click there.
  await page.mouse.down();
  await page.mouse.move(x + 30, y, {steps: 6});
  await page.mouse.move(x, y, {steps: 6});
  await page.mouse.up();
  await expect(card, 'the pan did not take the card down').toBeHidden();
  await page.waitForTimeout(PAST_HIDE_DELAY_MS);
  await expect(card, 'the release at the end of a drag pinned the card').toBeHidden();

  // Still a hover card: shown on the way in, gone on the way out.
  await moveAway(page);
  await marker.hover();
  await expect(card).toBeVisible();
  await moveAway(page);
  await expect(card).toBeHidden();
  expect(consoleErrors).toEqual([]);
});

test('after a click pins the card, shortcut keys still reach Validate', async ({page, consoleErrors}) => {
  const marker = page.locator('#validate-pano-marker');
  const card = page.locator('#label-card');
  await pastDoubleTapGuard(page);

  await marker.click();
  await expect(card).toBeVisible();
  // A focused marker would send Y and Enter to the card instead of the page.
  await expect(marker).not.toBeFocused();
  await page.keyboard.press('y');
  await expect(page.locator('#validate-yes-button'), 'Y after a click on the marker did not choose Agree')
    .toHaveClass(/is-chosen/);
  // And an ordinary shortcut leaves a pinned card up.
  await expect(card).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('Enter and Space on the focused marker toggle the card', async ({page, consoleErrors}) => {
  const marker = page.locator('#validate-pano-marker');
  const card = page.locator('#label-card');

  // Keyboard focus opens the card, as Tab onto the marker does.
  await marker.focus();
  await expect(card).toBeVisible();
  for (const [key, shown] of [['Enter', false], ['Enter', true], ['Space', false], ['Space', true]]) {
    await page.keyboard.press(key);
    if (shown) await expect(card, `${key} did not open the card`).toBeVisible();
    else await expect(card, `${key} did not close the card`).toBeHidden();
    await expect(marker).toHaveAttribute('aria-expanded', String(shown));
    await expect(marker, `${key} moved focus off the marker`).toBeFocused();
  }
  expect(consoleErrors).toEqual([]);
});

/**
 * @param {import('@playwright/test').Locator} locator
 * @returns {Promise<{x: number, y: number}>} The element's center in page coordinates.
 */
async function centerOf(locator) {
  const box = await locator.boundingBox();
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

/**
 * Moves the mouse to the pano corner furthest from the marker, clear of both the marker and the card.
 * @param {import('@playwright/test').Page} page
 */
async function moveAway(page) {
  const layer = await page.locator('#view-control-layer').boundingBox();
  const marker = await centerOf(page.locator('#validate-pano-marker'));
  const inset = 40;
  const corners = [
    {x: layer.x + inset, y: layer.y + layer.height - inset},
    {x: layer.x + layer.width - inset, y: layer.y + layer.height - inset},
    {x: layer.x + layer.width - inset, y: layer.y + inset},
    {x: layer.x + inset, y: layer.y + inset},
  ];
  const card = await page.locator('#label-card').boundingBox();
  const inCard = (p) => card
    && p.x >= card.x && p.x <= card.x + card.width && p.y >= card.y && p.y <= card.y + card.height;
  const far = corners.filter((p) => !inCard(p))
    .sort((a, b) => Math.hypot(b.x - marker.x, b.y - marker.y) - Math.hypot(a.x - marker.x, a.y - marker.y));
  await page.mouse.move(far[0].x, far[0].y);
}

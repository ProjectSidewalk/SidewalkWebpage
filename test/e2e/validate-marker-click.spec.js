/**
 * Validate's label marker as a pointer control (#4843). Hover opens the label card as before; a click pins it open
 * so it outlasts the pointer leaving, a second click closes it, and a press that drags is a pan rather than a click.
 * The jsdom suites (validateLabelCardPin, validateMarkerActivation) run these handlers against a stub marker; this
 * runs them against the real marker on the real pano layer, with the real event order a mouse produces, which is
 * where a press that steals focus or an overlay that eats the click would show.
 *
 * The marker is a DOM element in #view-control-layer, drawn over whichever viewer is up, so the same marker is under
 * test on both pano paths: on CI every seeded pano is expired and Pannellum shows the committed backup; on a dev
 * database `serveAnyPano` lets the Maps stub stand in. Nothing here is billed (#5129).
 */
const {test, expect, serveAnyPano, loadValidate} = require('./fixtures');

// Comfortably past LabelVisibilityControl's 200 ms hover grace timer, for asserting that a card *stays* up (or down):
// a polling expect would pass on its first look, before the timer had a chance to fire.
const PAST_HIDE_DELAY_MS = 600;

test.beforeEach(async ({page, context}) => {
  await serveAnyPano(context);
  const onMission = await loadValidate(page, '/validate');
  test.skip(!onMission, 'Validate settled on the no-mission modal, so there is no label marker');
  // The mission-start tutorial holds the keyboard until closed; clicked from the page, as its own overlay covers it.
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
  // Out well past the 5 px click slop and back, so the release lands on the marker and a click event does fire there.
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
  // A focused marker routes keys to the card, where Y means nothing and Enter toggles the card instead of submitting.
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
 * Moves the mouse onto the pano, clear of both the marker and the card, so the marker sees a real mouseout and
 * nothing re-enters the card. Picks whichever corner of the pano layer is furthest from the marker.
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

/**
 * Waits out LabelContainer.VERDICT_GRACE_MS from the label appearing, inside which a verdict is a dropped double tap.
 * @param {import('@playwright/test').Page} page
 */
async function pastDoubleTapGuard(page) {
  await page.waitForFunction(() => {
    const labelContainer = window.svv.labelContainer;
    return Date.now() - labelContainer.getProperty('renderedTimestamp') > labelContainer.constructor.VERDICT_GRACE_MS;
  });
}

/**
 * A drag on the label card's imagery ends wherever the mouse is let go (#5295, #5294).
 *
 * This checks the release events the viewers wait for, not one viewer's pan, so it holds whichever viewer the label
 * lands in (the Maps stub on a dev database, Pannellum on CI's seed).
 */
const {test, expect, serveAnyPano, waitForAppReady} = require('./fixtures');

test('a drag on the label card let go off the imagery ends', async ({page, context, consoleErrors}) => {
  await serveAnyPano(context);
  await page.goto('/gallery');
  await waitForAppReady(page);
  await page.locator('#page-loading').waitFor({state: 'hidden'});
  const firstCard = page.locator('.gallery-card .static-gallery-image').first();
  test.skip(await firstCard.count() === 0, 'the connected database has no Gallery cards');
  await firstCard.click();
  await expect(page.locator('.gallery-expanded-view .label-detail__pano-loading')).toBeHidden({timeout: 30_000});

  const released = await dragFromPano(page, page.locator('.gallery-expanded-view .label-detail__meta-row'));
  expect(released.mouseup, 'GSV, Panoramax, Pannellum and the crop end a drag on mouseup').toBe('pano');
  expect(released.pointerup, 'Infra3D ends a drag on a pointerup aimed at its canvas').toBe('pano');
  expect(consoleErrors).toEqual([]);
});

/**
 * Presses the middle of the card's imagery, drags onto `target`, lets go there, and reports where the release went.
 * @param {import('@playwright/test').Page} page - The Gallery page, expanded view open.
 * @param {import('@playwright/test').Locator} target - What to let go over.
 * @returns {Promise<{mouseup: string, pointerup: string}>} For each release event that reached the window, 'pano' if it
 *   was aimed inside the imagery, 'elsewhere' if not; 'none' if it never arrived.
 */
async function dragFromPano(page, target) {
  const pano = await page.locator('.gallery-expanded-view .label-detail__pano').boundingBox();
  const start = {x: pano.x + pano.width / 2, y: pano.y + pano.height / 2};
  const end = await target.boundingBox();
  const releasedAt = {x: end.x + end.width / 2, y: end.y + end.height / 2};

  // Listen where the viewers do: on window, after the event has bubbled.
  await page.evaluate(({x, y}) => {
    const holder = document.querySelector('.gallery-expanded-view .label-detail__pano');
    if (!holder.contains(document.elementFromPoint(x, y))) throw new Error('the press would miss the imagery');
    window.dragRelease = {mouseup: 'none', pointerup: 'none'};
    for (const type of ['mouseup', 'pointerup']) {
      window.addEventListener(type, (e) => {
        window.dragRelease[type] = holder.contains(e.target) ? 'pano' : 'elsewhere';
      }, {once: true});
    }
  }, start);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(releasedAt.x, releasedAt.y, {steps: 10});
  await page.mouse.up();
  return page.evaluate(() => window.dragRelease);
}

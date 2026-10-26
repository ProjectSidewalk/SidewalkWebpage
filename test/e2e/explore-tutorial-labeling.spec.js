/**
 * Explore's data-collection write path end to end (#4777 Phase B): a fresh user walks the first labeling steps of the
 * tutorial, and the label they place comes back out of the server with what they gave it. The backend specs
 * (ExploreSubmissionSpec) cover the endpoint; this covers the half they can't, the UI that builds the payload.
 *
 * The tutorial is the one labeling flow a browser test can drive deterministically: every fresh anonymous user gets
 * the same pano at the same POV, and its imagery is local. It runs on the Google Maps stub like the rest of the suite,
 * so nothing is billed (#5129); the stub never draws the pano, but Explore takes clicks on its own drawing layer and
 * projects them through the POV, which the stub keeps.
 *
 * Tutorial labels are left out of /v3/api/rawLabels, so the label is read back through GET /label/id/:id, the
 * endpoint behind the label card.
 */
const {test, expect, stubMapbox, waitForAppReady} = require('./fixtures');

// The tutorial pano's size and camera heading, as served by GsvViewer's custom-pano provider and evolution 360.
const TUTORIAL_PANO = {width: 4096, height: 2048, cameraHeading: 50.3866};

// Where the 'label-attribute-1' step in OnboardingStates.js wants the curb ramp, in its own units: the tutorial's
// coordinates are 3.25x the pano's.
const CURB_RAMP_TARGET = {x: 1170 / 3.25, y: 3800 / 3.25};

test('a curb ramp labeled in the Explore tutorial is saved with its severity and tag', async ({page, context,
  consoleErrors}) => {
  await stubMapbox(context);
  await page.goto('/explore');
  await waitForAppReady(page);
  await page.locator('#page-loading').waitFor({state: 'hidden'});

  const intro = page.locator('#tutorial-intro-next-btn');
  while (await intro.isVisible()) await intro.click();
  await page.locator('#onboarding-ok-button').click();
  await page.locator('#mode-switch-button-curb-ramp').click();

  // The label is submitted as soon as it's placed; the response swaps its temporary id for the saved one.
  const placed = page.waitForResponse(async (r) => r.request().method() === 'POST'
    && new URL(r.url()).pathname === '/task' && (await r.json()).label_ids?.length > 0);
  const layer = await page.locator('#label-drawing-layer').boundingBox();
  const pov = await page.evaluate(() => window.svl.panoManager.getPov());
  const target = povToCanvas(panoCoordToPov(CURB_RAMP_TARGET), pov, layer.width, layer.height);
  await page.mouse.click(layer.x + target.x, layer.y + target.y);
  const labelIds = (await (await placed).json()).label_ids;
  expect(labelIds).toHaveLength(1);
  const labelId = labelIds[0].label_id;

  // The rating and tag the tutorial asks for, so it moves on rather than asking for a redo.
  await page.locator('label[for="explore-severity-radio-2"]').click();
  const tag = page.locator('#context-menu-tag-section .context-menu-tag[data-tag-id="2"]');
  await tag.click();
  await expect(tag).toHaveClass(/tag-pill--active/);
  expect(consoleErrors).toEqual([]);

  // Leaving the page flushes the edits made since the label was placed, as it does for a real user.
  await page.goto('/');
  await expect.poll(async () => {
    const label = await (await page.request.get(`/label/id/${labelId}`)).json();
    return {
      type: label.label_type, severity: label.severity, tags: label.tags, tutorial: label.tutorial, pano: label.pano_id,
    };
  }).toEqual({type: 'CurbRamp', severity: 2, tags: ['points into traffic'], tutorial: true, pano: 'tutorial'});
});

/**
 * Inverts util.pano.povToPanoCoord for the tutorial pano.
 * @param {{x: number, y: number}} coord - A point on the pano image.
 * @returns {{heading: number, pitch: number}} The POV that centers it.
 */
function panoCoordToPov(coord) {
  const {width, height, cameraHeading} = TUTORIAL_PANO;
  return {heading: (cameraHeading - 180 + 360 * coord.x / width + 720) % 360, pitch: 90 * (1 - 2 * coord.y / height)};
}

/**
 * Copy of util.pano.centeredPovToCanvasCoord with the zoomToFov field of view, which is what Explore's 3:2 canvas
 * renders. A copy because the page's bundle doesn't expose `util`, and its module can't load outside a browser.
 * @param {{heading: number, pitch: number}} centered - The POV that centers the point.
 * @param {{heading: number, pitch: number, zoom: number}} pov - The viewer's current POV.
 * @param {number} width - Canvas width in CSS px.
 * @param {number} height - Canvas height in CSS px.
 * @returns {{x: number, y: number}} Where the point sits on the canvas.
 */
function povToCanvas(centered, pov, width, height) {
  const rad = Math.PI / 180;
  const fov = (126.5 - pov.zoom * 36.75) * rad;
  const f = (width / 2) / Math.tan(fov / 2);
  const [h, p, h0, p0] = [centered.heading * rad, centered.pitch * rad, pov.heading * rad, pov.pitch * rad];
  const [x, y, z] = [f * Math.cos(p) * Math.sin(h), f * Math.cos(p) * Math.cos(h), f * Math.sin(p)];
  const [x0, y0, z0] = [f * Math.cos(p0) * Math.sin(h0), f * Math.cos(p0) * Math.cos(h0), f * Math.sin(p0)];
  const t = (x0 * x0 + y0 * y0 + z0 * z0) / (x0 * x + y0 * y + z0 * z);
  const du = t * (x * Math.cos(h0) - y * Math.sin(h0));
  const dv = t * (-x * Math.sin(p0) * Math.sin(h0) - y * Math.sin(p0) * Math.cos(h0) + z * Math.cos(p0));
  return {x: width / 2 + du, y: height / 2 - dv};
}

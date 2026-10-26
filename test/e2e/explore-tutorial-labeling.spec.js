/**
 * Explore's write path end to end (#4777): a fresh user labels a curb ramp in the tutorial, and the server hands back
 * what they gave it. ExploreSubmissionSpec covers the endpoint; this covers the UI that builds the payload.
 *
 * The tutorial gives every new user the same pano and POV, and runs on the Maps stub, so nothing is billed (#5129).
 * The stub draws no pano, but Explore takes clicks on its own layer and projects them through the POV, which the stub
 * keeps. rawLabels omits tutorial labels, so the label is read back from GET /label/id/:id.
 */
const {test, expect, stubMapbox, waitForAppReady} = require('./fixtures');

// The tutorial pano, as GsvViewer's custom-pano provider and evolution 360 serve it.
const TUTORIAL_PANO = {width: 4096, height: 2048, cameraHeading: 50.3866};

// The curb ramp the 'label-attribute-1' step in OnboardingStates.js asks for; its coordinates are 3.25x the pano's.
const CURB_RAMP_TARGET = {x: 1170 / 3.25, y: 3800 / 3.25};

test('a curb ramp labeled in the Explore tutorial is saved with its severity and tag', async ({page, context,
  consoleErrors}) => {
  await stubMapbox(context);
  await page.goto('/explore');
  await waitForAppReady(page);
  await page.locator('#page-loading').waitFor({state: 'hidden'});

  const intro = page.locator('#tutorial-intro-next-btn');
  await intro.waitFor();
  while (await intro.isVisible()) await intro.click();
  await page.locator('#onboarding-ok-button').click();
  await page.locator('#mode-switch-button-curb-ramp').click();

  // The label is saved as soon as it's placed; the response maps its temporary id to the saved one.
  const placed = page.waitForResponse(async (r) => r.request().method() === 'POST'
    && new URL(r.url()).pathname === '/task' && (await r.json()).label_ids?.length > 0);
  const layer = await page.locator('#label-drawing-layer').boundingBox();
  const pov = await page.evaluate(() => window.svl.panoManager.getPov());
  const target = povToCanvas(panoCoordToPov(CURB_RAMP_TARGET), pov, layer.width, layer.height);
  await page.mouse.click(layer.x + target.x, layer.y + target.y);
  // Only an accepted click reaches the rating step and the save; a miss asks the user to delete the label.
  await expect(page.locator('#severity-menu'), 'the tutorial rejected the click as off target').toBeVisible();
  const labelIds = (await (await placed).json()).label_ids;
  expect(labelIds).toHaveLength(1);
  const labelId = labelIds[0].label_id;

  // The rating and tag the tutorial asks for, so it doesn't ask for a redo.
  await page.locator('label[for="explore-severity-radio-2"]').click();
  const tag = page.locator('#context-menu-tag-section .context-menu-tag[data-tag-id="2"]');
  await tag.click();
  await expect(tag).toHaveClass(/tag-pill--active/);

  // Leaving the page saves the later edits, as it does for a real user.
  await page.goto('/');
  let label;
  await expect.poll(async () => {
    const response = await page.request.get(`/label/id/${labelId}`);
    if (!response.ok()) return `HTTP ${response.status()}`;
    label = await response.json();
    return {
      type: label.label_type, severity: label.severity, tags: label.tags, tutorial: label.tutorial, pano: label.pano_id,
    };
  }).toEqual({type: 'CurbRamp', severity: 2, tags: ['points into traffic'], tutorial: true, pano: 'tutorial'});

  // Where the label sits: the view it was placed from, and the click on its canvas.
  expect({heading: label.heading, pitch: label.pitch, zoom: label.zoom}).toEqual(pov);
  const scale = label.canvas_width / layer.width;
  expect(Math.abs(label.canvas_x - target.x * scale)).toBeLessThan(2);
  expect(Math.abs(label.canvas_y - target.y * scale)).toBeLessThan(2);
  expect(consoleErrors).toEqual([]);
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
 * Copy of util.pano.centeredPovToCanvasCoord at the zoomToFov field of view, which Explore's 3:2 canvas renders. A
 * copy because the bundle doesn't expose `util`, and its module can't load outside a browser.
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

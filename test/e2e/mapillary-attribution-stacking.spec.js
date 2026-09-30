/**
 * Mapillary's attribution pill takes clicks where the SDK renders it, in Validate and Explore (#5600).
 *
 * The pill has to stay inside the SDK's own DOM, because MapillaryJS patches it in place per image and a moved pill
 * goes stale. That leaves it inside the pano container, under the click-handling control layer, unless the page CSS
 * releases the pano's stacking context for Mapillary and lifts the pill one level above that layer. Nothing else
 * notices when that breaks: a z-index, transform, opacity, filter or isolation added to #svv-panorama or #pano later
 * silently traps the pill again, and a click on it pans the pano instead of opening the image page.
 *
 * Every case is synthetic markup via setContent, in the SDK's real DOM shape, so no database, imagery key or seeded
 * city is involved; `--no-deps` runs this file without the chromium project's `setup`. The stylesheets are read from
 * this checkout's public/ and inlined rather than linked from the app on :9000, so the spec checks the CSS of the
 * tree it runs from even when :9000 serves another checkout. A probe placed after the control layer at the pill's own
 * z-index stands in for the overlays that must keep painting over the pill: the border frame, loading status and zoom
 * stack in Validate, the border frame in Explore.
 */
const fs = require('fs');
const path = require('path');
const {test, expect} = require('./fixtures');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * The given stylesheets from this checkout, as one string for page.addStyleTag.
 * @param {string[]} relativePaths - Paths under public/.
 * @returns {string} Their concatenated contents.
 */
function readStylesheets(relativePaths) {
  return relativePaths.map((p) => fs.readFileSync(path.join(REPO_ROOT, 'public', p), 'utf8')).join('\n');
}

// Sizes the tool pages set at runtime, pinned so the fixture lays out like a boxed desktop pano at scale 1.
const LAYOUT_VARS = '--ui-scale: 1; --pano-width: 720px; --pano-height: 480px; --header-height: 0px;';

/** The attribution subtree as MapillaryJS 4.1.2 renders it, inside the SDK's render root. */
const SDK_DOM = `
  <div class="mapillary-dom">
    <div class="mapillary-dom-renderer">
      <div class="mapillary-attribution-container">
        <a class="mapillary-attribution-icon-container" href="https://www.mapillary.com/app/user/someone">
          <div class="mapillary-attribution-logo"></div>
        </a>
        <a class="mapillary-attribution-image-container" href="https://www.mapillary.com/app/?pKey=1">
          <div class="mapillary-attribution-username">image by someone</div>
          <div class="mapillary-attribution-date">Nov 11, 2024</div>
        </a>
      </div>
    </div>
  </div>`;

/**
 * What the pointer hits at the centre of the pill's image link, and at a point where the probe overlaps the pill.
 * @param {import('@playwright/test').Page} page - The fixture page.
 * @returns {Promise<{atLink: string, atProbe: string}>} The hit elements' id or class.
 */
async function hitTest(page) {
  return page.evaluate(() => {
    const describe = (el) => (el ? el.id || el.className : 'nothing');
    const link = document.querySelector('.mapillary-attribution-image-container').getBoundingClientRect();
    const probe = document.getElementById('probe').getBoundingClientRect();
    const hitAt = (x, y) => document.elementFromPoint(x, y)?.closest('#probe, .mapillary-attribution-image-container,'
      + ' #view-control-layer, #user-control-layer') ?? null;
    return {
      atLink: describe(hitAt(link.left + link.width / 2, link.top + link.height / 2)),
      atProbe: describe(hitAt(probe.left + probe.width / 2, probe.top + probe.height / 2)),
    };
  });
}

test.describe('Mapillary attribution stacking', () => {
  test('Validate: the pill is clickable in place, and later overlays still cover it', async ({page}) => {
    await page.setContent(`<!doctype html><html><head></head>
      <body style="margin: 0; ${LAYOUT_VARS}">
        <div id="svv-panorama-holder">
          <div id="svv-panorama" class="mapillary-viewer">${SDK_DOM}</div>
          <div id="view-control-layer"></div>
          <div id="probe" style="position: absolute; z-index: 3; right: 0; bottom: 0; width: 30px; height: 40px;"></div>
        </div>
      </body></html>`);
    await page.addStyleTag({content: readStylesheets([
      'vendor/mapillary/mapillary-4.1.2.css', 'css/main.css', 'css/pages/validate/svv-panorama.css',
    ])});

    const {atLink, atProbe} = await hitTest(page);
    expect(atLink).toBe('mapillary-attribution-image-container');
    expect(atProbe).toBe('probe');
  });

  // The release is scoped to Mapillary's class because the fence still matters for Google: its z-indexed controls
  // would otherwise paint, and take taps, over the Pannellum fallback while a live pano loads behind it (#5453).
  test('Validate: the pano keeps its stacking context for other providers', async ({page}) => {
    await page.setContent(`<!doctype html><html><head></head>
      <body style="margin: 0; ${LAYOUT_VARS}">
        <div id="svv-panorama-holder"><div id="svv-panorama"></div><div id="view-control-layer"></div></div>
      </body></html>`);
    await page.addStyleTag({content: readStylesheets(['css/main.css', 'css/pages/validate/svv-panorama.css'])});

    const isolation = await page.evaluate(() => getComputedStyle(document.getElementById('svv-panorama')).isolation);
    expect(isolation).toBe('isolate');
  });

  test('Explore: the pill is clickable in place, and the border frame still covers it', async ({page}) => {
    await page.setContent(`<!doctype html><html><head></head>
      <body style="margin: 0; ${LAYOUT_VARS}">
        <div id="street-view-holder" class="tool-ui">
          <div id="pano" class="window-streetview mapillary-viewer">${SDK_DOM}</div>
          <div id="user-control-layer" class="window-streetview">
            <div id="view-control-layer" class="window-streetview"></div>
            <div id="label-drawing-layer" class="window-streetview"></div>
          </div>
          <div id="probe" style="position: absolute; z-index: 2; left: 0; bottom: 0; width: 30px; height: 40px;"></div>
        </div>
      </body></html>`);
    await page.addStyleTag({content: readStylesheets([
      'vendor/mapillary/mapillary-4.1.2.css', 'css/main.css', 'css/pages/explore/svl-canvas.css',
      'css/pages/explore/svl.css',
    ])});

    const {atLink, atProbe} = await hitTest(page);
    expect(atLink).toBe('mapillary-attribution-image-container');
    expect(atProbe).toBe('probe');
  });

  test('Explore: the pano keeps its stacking context for other providers', async ({page}) => {
    await page.setContent(`<!doctype html><html><head></head>
      <body style="margin: 0; ${LAYOUT_VARS}">
        <div id="street-view-holder"><div id="pano" class="window-streetview"></div></div>
      </body></html>`);
    await page.addStyleTag({content: readStylesheets(['css/main.css', 'css/pages/explore/svl-canvas.css'])});

    const zIndex = await page.evaluate(() => getComputedStyle(document.getElementById('pano')).zIndex);
    expect(zIndex).toBe('0');
  });
});

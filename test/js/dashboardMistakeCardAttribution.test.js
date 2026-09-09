/**
 * Tests the imagery credit on a dashboard "recent mistakes" card (public/js/user-dashboard/MistakeGallery.js, #5254).
 *
 * The card shows the label's saved crop, which is our own copy of the provider's image, so it has to credit that
 * provider the same way the Gallery and landing cards do. The real overlays are loaded instead of fake ones, since
 * the whole point is checking that the card hooks them up.
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub, installUtilitiesMisc, REPO_ROOT } = require('./loadGlobalScript');

const GALLERY_SRC = fs.readFileSync(path.join(REPO_ROOT, 'public/js/user-dashboard/MistakeGallery.js'), 'utf8');
const LOGO_SRC = fs.readFileSync(path.join(REPO_ROOT, 'public/js/common/pano-viewer/src/PanoViewerLogo.js'), 'utf8');
const ATTRIBUTION_SRC =
  fs.readFileSync(path.join(REPO_ROOT, 'public/js/common/pano-viewer/src/PanoAttribution.js'), 'utf8');

const CROP_URL = '/cropImage/Obstacle/501?exp=1&sig=x';
const GSV_URL = 'https://maps.googleapis.com/maps/api/streetview?pano=abc123';

const MAPILLARY_LINE = {
  holder: '© jacobwhall',
  provider: 'Mapillary',
  license: 'CC BY-SA 4.0',
  license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
};

/** One record shaped like an entry from GET /userapi/mistakes, defaulting to a Mapillary crop. */
function mistake(overrides = {}) {
  return {
    label_id: 501, pano_id: 'abc123', heading: 12, pitch: -5, zoom: 1,
    canvas_x: 180, canvas_y: 360, label_type: 'Obstacle',
    time_validated: '2026-07-01T12:00:00Z', validator_comment: null,
    crop_url: CROP_URL, image_url: null,
    pano_source: 'mapillary', attribution: MAPILLARY_LINE, ...overrides,
  };
}

describe('the dashboard mistake card\'s imagery credit', () => {
  const logo = () => document.querySelector('.ud-card-img .pano-viewer-logo');
  const attribution = () => document.querySelector('.ud-card-img .pano-attribution');
  const photo = () => document.querySelector('.ud-card-photo');

  let mistakes;

  async function renderGallery(opts = {}) {
    document.body.innerHTML = '<div id="ud-mistakes"></div>';
    const gallery = new window.MistakeGallery(document.getElementById('ud-mistakes'), { userId: 'ada', ...opts });
    await gallery.render();
  }

  beforeAll(() => {
    window.i18next = { t: (key) => key };
    // The logo measures itself to report how wide it is. jsdom lays nothing out, so there's nothing to measure.
    window.ResizeObserver = class { observe() {} disconnect() {} };
    window.util = { assetPath: assetPathStub, EXPLORE_CANVAS_WIDTH: 720, EXPLORE_CANVAS_HEIGHT: 480 };
    installUtilitiesMisc();
    window.eval(`${LOGO_SRC}\nwindow.createPanoViewerLogo = createPanoViewerLogo;`);
    window.eval(`${ATTRIBUTION_SRC}\nwindow.createPanoAttribution = createPanoAttribution;`);
    window.eval(`${GALLERY_SRC}\nwindow.MistakeGallery = MistakeGallery;`);
  });

  beforeEach(() => {
    mistakes = [mistake()];
    window.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ Obstacle: mistakes }) }));
  });

  it('credits a Mapillary crop with the source logo and the licence line', async () => {
    await renderGallery();

    expect(logo().style.display).toBe('flex');
    expect(logo().querySelector('img').src).toContain('mapillary-logo-white.png');
    expect(attribution().hidden).toBe(false);
    expect(attribution().textContent).toContain('© jacobwhall');
    const license = attribution().querySelector('a');
    expect(license.href).toBe(MAPILLARY_LINE.license_url);
    expect(license.textContent).toContain('CC BY-SA 4.0');
  });

  // The small form leaves out the provider's name, since the logo next to it already says Mapillary.
  it('leaves the provider name to the logo', async () => {
    await renderGallery();

    expect(attribution().textContent).not.toContain('Mapillary');
  });

  // Google gives us a copyright line but no licence, and the logo already says it's Google, so text would be clutter.
  it('shows the Google logo but no licence pill on a Street View crop', async () => {
    mistakes = [mistake({
      pano_source: 'gsv', image_url: GSV_URL, attribution: { holder: '© 2025 Google', provider: null, license: null },
    })];
    await renderGallery();

    expect(logo().querySelector('img').src).toContain('google-logo.svg');
    expect(attribution().hidden).toBe(true);
  });

  it('shows nothing to credit when the label has no imagery at all', async () => {
    mistakes = [mistake({ crop_url: null, image_url: null })];
    await renderGallery();

    expect(photo()).toBeNull();
    expect(logo()).toBeNull();
    expect(attribution()).toBeNull();
  });

  // Only a Street View label has a still to fall back to -- the server sends no image_url for any other source -- and
  // that still is the same panorama as the crop, so the credit already showing is still the right one.
  it('keeps the credit up when an expired crop falls back to the still', async () => {
    mistakes = [mistake({
      pano_source: 'gsv', image_url: GSV_URL, attribution: { holder: '© 2025 Google', provider: null, license: null },
    })];
    await renderGallery();

    photo().dispatchEvent(new window.Event('error'));

    expect(photo().src).toContain(GSV_URL);
    expect(logo().style.display).toBe('flex');
  });

  // A Mapillary crop has no still behind it, so an expired one leaves the card with no image and no credit.
  it('drops a Mapillary credit when its crop expires, since there is no still behind it', async () => {
    await renderGallery();
    expect(logo().style.display).toBe('flex');

    photo().dispatchEvent(new window.Event('error'));

    expect(photo()).toBeNull();
    expect(logo().style.display).toBe('none');
    expect(attribution().hidden).toBe(true);
  });

  // The licence link has to stay reachable, so it must not sit inside the button that opens the label popup.
  it('keeps the licence link out of the popup button', async () => {
    await renderGallery({ labelPopup: { open: () => {} } });

    expect(document.querySelector('.ud-card-open')).not.toBeNull();

    expect(attribution().closest('.ud-card-open')).toBeNull();
    expect(attribution().querySelector('a')).not.toBeNull();
  });
});

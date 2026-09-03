/**
 * Tests for public/js/common/pano-viewer/src/PanoAttribution.js, the imagery-attribution overlay shown while Project
 * Sidewalk displays its own copy of a panorama — the self-hosted Pannellum pano or the static crop (#4865).
 *
 * The line is structured by the server (holder / provider / licence / licence URL), so the overlay never has to know
 * which providers carry a licence: it links whatever licence it is handed and nothing else.
 */

const fs = require('fs');
const path = require('path');

const ATTRIBUTION_PATH = path.resolve(__dirname, '..', '..', 'public/js/common/pano-viewer/src/PanoAttribution.js');

/** Load PanoAttribution.js (a plain top-level function declaration, concatenation-style). */
function loadAttribution() {
  const src = fs.readFileSync(ATTRIBUTION_PATH, 'utf8');
  return (0, eval)(`${src}\ncreatePanoAttribution;`);
}

const MAPILLARY = {
  holder: '© jacobwhall',
  provider: 'Mapillary',
  license: 'CC BY-SA 4.0',
  license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
};

describe('createPanoAttribution', () => {
  const createPanoAttribution = loadAttribution();
  let container;
  let overlay;

  beforeEach(() => {
    document.body.innerHTML = '<div id="pano"></div>';
    container = document.getElementById('pano');
    overlay = createPanoAttribution(container);
  });

  const el = () => container.querySelector('.pano-attribution');

  it('starts hidden, mounted in the container', () => {
    expect(el()).not.toBeNull();
    expect(el().hidden).toBe(true);
  });

  it('shows holder, provider and licence, linking only the licence', () => {
    overlay.show(MAPILLARY);

    expect(el().hidden).toBe(false);
    expect(el().textContent).toBe('© jacobwhall · Mapillary · CC BY-SA 4.0');
    const links = el().querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('CC BY-SA 4.0');
    expect(links[0].href).toBe(MAPILLARY.license_url);
    expect(links[0].target).toBe('_blank');
    expect(links[0].rel).toBe('noopener');
  });

  it("shows a provider's own copyright string as plain text", () => {
    overlay.show({ holder: '© 2025 Google', provider: null, license: null, license_url: null });

    expect(el().hidden).toBe(false);
    expect(el().textContent).toBe('© 2025 Google');
    expect(el().querySelector('a')).toBeNull();
  });

  it('hides for a missing or empty attribution, and on hide()', () => {
    overlay.show(MAPILLARY);
    overlay.show(null);
    expect(el().hidden).toBe(true);

    overlay.show(MAPILLARY);
    overlay.show({ holder: '' });
    expect(el().hidden).toBe(true);

    overlay.show(MAPILLARY);
    overlay.hide();
    expect(el().hidden).toBe(true);
  });

  it('replaces the previous line rather than appending to it', () => {
    overlay.show(MAPILLARY);
    overlay.show({ holder: '© 2025 Google' });

    expect(el().textContent).toBe('© 2025 Google');
    expect(el().querySelector('a')).toBeNull();
  });
});

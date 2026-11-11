/**
 * The message a labeler gets when Explore moves them off a street it couldn't show them (#4918).
 *
 * This one is not a tip. Explore relocates the labeler without being asked, and the toast is the only thing that
 * accounts for the screen changing under them — so unlike the keyboard-shortcut nudges it is shown without a "don't
 * show again" button, and a labeler who silenced it back when it had one gets it back. The opt-out list lives in
 * localStorage and never expires, so "silenced once" otherwise means "silenced on that browser forever": the account
 * this was found on had it silenced, which is exactly why the teleports looked unexplained.
 */

import { loadModules, mockModule, useUtil } from './loader.js';

mockModule('i18next', () => ({ default: { t: (key, interpolation) => JSON.stringify({ key, ...interpolation }) } }));

describe('the "we moved you off that street" message', () => {
  let stored;
  let getStreetNameNear;
  let alertController;
  let stuckAlert;
  let AlertController;
  let StuckAlert;

  /** Builds the pano the toasts float over, and the collaborators AlertController reads at construction. */
  const setUp = ({ silenced = [] } = {}) => {
    document.body.innerHTML = '<div id="pano"></div>';
    stored = { alertDontShowList: silenced };
    alertController = new AlertController({
      get: (key) => stored[key],
      set: (key, value) => { stored[key] = value; },
    });
    stuckAlert = new StuckAlert(alertController, { onPanoChanged: () => {} });
  };

  beforeEach(async () => {
    getStreetNameNear = vi.fn(() => Promise.resolve(null));
    useUtil({ misc: { getStreetNameNear } });

    ({ AlertController, StuckAlert } = await loadModules('frontend/js/explore/alert/AlertController.js',
      'frontend/js/explore/alert/StuckAlert.js'));
  });

  /** What the toast currently displays, per the i18next stub's serialization. */
  const shown = () => JSON.parse(document.querySelector('.ps-toast__message').textContent);
  const shownKey = () => shown().key;
  const bannerVisible = () => document.querySelector('.ps-toast') !== null;
  const optOutOffered = () => document.querySelector('.ps-toast__button') !== null;

  it('is shown without the option to silence it', () => {
    setUp();

    stuckAlert.stuckSkippedStreet();

    expect(bannerVisible()).toBe(true);
    expect(shownKey()).toBe('popup.stuck-skipped-street');
    expect(optOutOffered()).toBe(false);
  });

  it('reaches a labeler who silenced it, and clears the silence', () => {
    setUp({ silenced: ['zoomMessage', 'stuckStreetSkipped'] });

    stuckAlert.stuckSkippedStreet();

    expect(bannerVisible()).toBe(true);
    expect(stored.alertDontShowList).toEqual(['zoomMessage']);
  });

  it('leaves other messages silenced, since those still offer the choice', () => {
    setUp({ silenced: ['stuckSuggestion'] });

    stuckAlert.panoVisited('pano-a');
    stuckAlert.panoVisited('pano-a');
    stuckAlert.panoVisited('pano-a');

    expect(bannerVisible()).toBe(false);
    expect(stored.alertDontShowList).toEqual(['stuckSuggestion']);
  });

  it('names the street the labeler landed on when the lookup finds one', async () => {
    setUp();
    getStreetNameNear.mockResolvedValue('Palisade Ave');

    await stuckAlert.announceSkippedStreetNear({ lat: 40.9, lng: -74.0 }, 'mapbox-token');

    expect(shownKey()).toBe('popup.stuck-skipped-street-named');
    expect(shown().streetName).toBe('Palisade Ave');
  });

  it('still says something when the street cannot be named', async () => {
    setUp();
    getStreetNameNear.mockResolvedValue(null);

    await stuckAlert.announceSkippedStreetNear({ lat: 40.9, lng: -74.0 }, 'mapbox-token');

    // Geocoding is decoration; losing it must not cost the labeler the explanation itself.
    expect(shownKey()).toBe('popup.stuck-skipped-street');
    expect(bannerVisible()).toBe(true);
  });
});

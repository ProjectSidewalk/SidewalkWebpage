/**
 * Tests for Explore's AlertController (#5830): its tips and notices are toasts over the pano, one at a time, and the
 * "don't show again" button on a tip silences that tip for good.
 */

import { loadModules, mockModule } from './loader.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

describe('AlertController', () => {
  let AlertController;
  let stored;
  let alerts;

  beforeEach(async () => {
    vi.useFakeTimers();
    // As on the page: the tool ships hidden until Main reveals it, and a load that stops early never does.
    document.body.innerHTML = '<div class="tool-ui ps-invisible"><div id="pano"></div></div>';
    ({ AlertController } = await loadModules('frontend/js/explore/alert/AlertController.js'));
    stored = {};
    alerts = new AlertController({ get: (key) => stored[key], set: (key, value) => { stored[key] = value; } });
  });

  afterEach(() => vi.useRealTimers());

  const toasts = () => [...document.querySelectorAll('.ps-toast')];

  test('shows its message on <body>, outside the hidden tool, so a load that stopped can still say why', () => {
    alerts.showAlert('Imagery failed to load.', 'imageryLoadFailed');

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].parentElement).toBe(document.body);
    expect(toasts()[0].dataset.anchor).toBe('pano');
  });

  test('keeps the markup a translation carries, such as a key name', () => {
    alerts.showAlert('Press <kbd>Z</kbd> to zoom.', 'zoomMessage', true);

    expect(document.querySelector('.ps-toast__message kbd').textContent).toBe('Z');
  });

  test('"don\'t show again" silences that tip from then on', () => {
    alerts.showAlert('Tip', 'zoomMessage', true);
    document.querySelector('.ps-toast__button').click();
    vi.advanceTimersByTime(1000);

    expect(stored.alertDontShowList).toEqual(['zoomMessage']);
    expect(toasts()).toHaveLength(0);

    alerts.showAlert('Tip', 'zoomMessage', true);
    expect(toasts()).toHaveLength(0);
  });

  test('a notice without the button offers no opt-out', () => {
    alerts.showAlert('Moved you.', 'stuckStreetSkipped', false);

    expect(document.querySelector('.ps-toast__button')).toBeNull();
  });

  test('a newer alert replaces the one showing rather than stacking under it', () => {
    alerts.showAlert('First', 'a', true);
    alerts.showAlert('Second', 'b', true);
    vi.advanceTimersByTime(1000); // The first one's fade-out.

    expect(toasts().map((t) => t.querySelector('.ps-toast__message').textContent)).toEqual(['Second']);
  });
});

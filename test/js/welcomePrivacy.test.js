/**
 * Tests for the two privacy toggles on the welcome page a new account lands on
 * (frontend/js/common/WelcomePrivacy.js). They save the moment they are flipped, with no Save button, so a choice
 * someone walks away from must still be written, two quick flips must not race, and a save that failed must not leave
 * a setting on screen that the server never took (#5840).
 */

import { loadModules, mockModule } from './loader.js';
import { routeFetch, sentRequests, flush, textOf } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { t: (key) => `t(${key})` } }));

const SAVE_URL = '/dashboard/settings';

let WelcomePrivacy;

beforeEach(async () => {
  // The privacy panel of authentication/welcome.scala.html, cut down: both boxes render disabled until JS runs.
  document.body.innerHTML = `
    <div class="wl-privacy-toggles">
      <label class="wl-check" for="wl-on-leaderboard">
        <input type="checkbox" id="wl-on-leaderboard" disabled checked>
      </label>
      <label class="wl-check" for="wl-public-profile">
        <input type="checkbox" id="wl-public-profile" disabled>
      </label>
    </div>
    <p class="wl-privacy-status" id="wl-privacy-status" role="status" aria-live="polite"></p>`;
  window.logWebpageActivity = vi.fn();
  ({ WelcomePrivacy } = await loadModules('frontend/js/common/WelcomePrivacy.js'));
});

const leaderboard = () => document.getElementById('wl-on-leaderboard');
const profile = () => document.getElementById('wl-public-profile');
const status = () => document.getElementById('wl-privacy-status');

/** @param {HTMLInputElement} box - The checkbox to flip, as a click would. */
const flip = (box) => {
  box.checked = !box.checked;
  box.dispatchEvent(new Event('change'));
};

describe('WelcomePrivacy', () => {
  it('turns on the boxes the page rendered inert, once it can save them', () => {
    new WelcomePrivacy({ saveUrl: SAVE_URL });

    expect(leaderboard().disabled).toBe(false);
    expect(profile().disabled).toBe(false);
  });

  it('saves both settings the moment one is flipped, and says so', async () => {
    const fetchStub = routeFetch({ [`POST ${SAVE_URL}`]: { success: true } });
    new WelcomePrivacy({ saveUrl: SAVE_URL });

    flip(profile());

    expect(sentRequests(fetchStub)).toEqual([
      { method: 'POST', url: SAVE_URL, body: { on_leaderboard: true, public_profile: true } },
    ]);
    expect(window.logWebpageActivity)
      .toHaveBeenCalledWith('Click_module=WelcomePrivacy_setting=PublicProfile_value=true');
    await flush();
    expect(textOf(status())).toBe('t(dashboard:settings-form.saved)');
    expect(status().classList.contains('saved')).toBe(true);
    expect(profile().checked).toBe(true);
  });

  it('holds both boxes still while a save is in flight, so two saves cannot land out of order', async () => {
    let answer;
    routeFetch({ [`POST ${SAVE_URL}`]: () => new Promise((resolve) => { answer = resolve; }) });
    new WelcomePrivacy({ saveUrl: SAVE_URL });

    flip(leaderboard());

    expect(window.logWebpageActivity)
      .toHaveBeenCalledWith('Click_module=WelcomePrivacy_setting=Leaderboard_value=false');
    expect(leaderboard().disabled).toBe(true);
    expect(profile().disabled).toBe(true);
    expect(textOf(status())).toBe('t(dashboard:settings-form.saving)');
    expect(status().className).toBe('wl-privacy-status');

    answer({ success: true });
    await flush();
    expect(leaderboard().disabled).toBe(false);
    expect(profile().disabled).toBe(false);
  });

  it('puts the box back and shows the server\'s reason when the save is refused', async () => {
    routeFetch({ [`POST ${SAVE_URL}`]: { status: 400, body: { success: false, error: 'Invalid settings' } } });
    new WelcomePrivacy({ saveUrl: SAVE_URL });

    flip(leaderboard());
    await flush();

    expect(leaderboard().checked).toBe(true);
    expect(textOf(status())).toBe('Invalid settings');
    expect(status().classList.contains('failed')).toBe(true);
    expect(status().classList.contains('saved')).toBe(false);
  });

  it('puts the box back with a general message when the save never reaches the server', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    routeFetch({ [`POST ${SAVE_URL}`]: new TypeError('Failed to fetch') });
    new WelcomePrivacy({ saveUrl: SAVE_URL });

    flip(profile());
    await flush();

    expect(profile().checked).toBe(false);
    expect(textOf(status())).toBe('t(dashboard:settings-form.save-failed)');
    expect(consoleError).toHaveBeenCalledWith('Failed to save settings', expect.any(TypeError));
  });
});

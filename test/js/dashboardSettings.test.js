/**
 * Tests the Settings page's Save (frontend/js/user-dashboard/Settings.js, #5840): what one save sends, how its
 * outcome reads beside the button, the reload a units change needs, and the unsaved-edits guard's view of the form.
 * TeamActions.js and saveUserSettings.js are the real ones, so a save onto a new team is checked all the way through
 * to the Leave button moving onto it.
 */

import { loadModules, mockModule } from './loader.js';
import { navigationAttempts } from './fakes.js';
import { flush, routeFetch, sentRequests } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

// The guard's own prompt has its own suite; here only what Settings hands it matters.
let guard;
mockModule('frontend/js/common/UnsavedChangesGuard.js', () => ({
  UnsavedChangesGuard: class { constructor(opts) { guard = opts; } },
}));

const reloads = navigationAttempts();

let Settings;

beforeAll(async () => {
  // TeamActions wires its buttons on ready; this suite only needs its in-place update after a save.
  window.appManager = { ready: () => {} };
  ({ Settings } = await loadModules('frontend/js/user-dashboard/Settings.js'));
});

beforeEach(() => reloads.mockClear());

const SAVE_URL = '/dashboard/settings';

/**
 * Draws a cut-down copy of userDashboard/settings.scala.html for a user on the open team Rovers, with Walkers to
 * switch to, and starts Settings on it.
 * @param {string} [units] - The units choice the page was rendered with.
 * @returns {Settings} The started form.
 */
function renderSettings(units = 'auto') {
  document.body.innerHTML = `
    <input id="set-username" type="text" value="mikey">
    <select id="set-units">
      <option value="auto">Follow language</option><option value="metric">Metric</option>
      <option value="imperial">Imperial</option>
    </select>
    <select id="set-team" data-current-team="3" data-placeholder="Choose a team…">
      <option value="3" selected>Rovers</option><option value="7">Walkers</option>
    </select>
    <div class="ud-team-actions" data-user-id="u-1">
      <button type="button" class="ud-leave-team-btn" data-team-name="Rovers" data-team-open="true">Leave</button>
    </div>
    <input type="checkbox" id="set-news-email" checked>
    <input type="checkbox" id="set-community-service">
    <input type="checkbox" id="set-on-leaderboard" checked>
    <input type="checkbox" id="set-public-profile">
    <button type="button" id="set-save-btn">Save changes</button>
    <span id="set-save-status" role="status"></span>`;
  document.getElementById('set-units').value = units;
  return new Settings({ saveUrl: SAVE_URL, currentUnits: units });
}

const $ = (selector) => document.querySelector(selector);
/** @returns {{text: string, classes: Array<string>}} The status line beside Save. */
const status = () => ({ text: $('#set-save-status').textContent, classes: [...$('#set-save-status').classList] });

/** Clicks Save and lets the request finish. */
async function clickSave() {
  $('#set-save-btn').click();
  await flush();
}

test('a save sends every setting at once, leaving the team alone when it wasn\'t changed', async () => {
  renderSettings();
  const fetch = routeFetch({ [`POST ${SAVE_URL}`]: { success: true } });
  $('#set-username').value = '  mikey2 ';
  await clickSave();
  expect(sentRequests(fetch)).toEqual([{
    method: 'POST', url: SAVE_URL,
    body: {
      username: 'mikey2', on_leaderboard: true, public_profile: false, community_service: false,
      measurement_system: 'auto', news_email: true, team_id: null,
    },
  }]);
  expect(status()).toEqual({ text: 'dashboard:settings-form.saved', classes: ['ud-save-ok'] });
  expect($('#set-save-btn').disabled).toBe(false);
  expect(reloads).not.toHaveBeenCalled();
});

test('the status says it\'s saving, and Save is locked, until the server answers', async () => {
  renderSettings();
  let answer;
  routeFetch({ [`POST ${SAVE_URL}`]: () => new Promise((resolve) => { answer = resolve; }) });
  $('#set-save-btn').click();
  expect(status()).toEqual({ text: 'dashboard:settings-form.saving', classes: [] });
  expect($('#set-save-btn').disabled).toBe(true);
  answer({ success: true });
  await flush();
  expect($('#set-save-btn').disabled).toBe(false);
});

test('a save onto another team moves Leave to it, and the next save doesn\'t write it again', async () => {
  renderSettings();
  const fetch = routeFetch({ [`POST ${SAVE_URL}`]: { success: true } });
  $('#set-team').value = '7';
  expect(guard.isDirty()).toBe(true);
  await clickSave();
  expect(sentRequests(fetch)[0].body.team_id).toBe(7);
  expect($('.ud-leave-team-btn').dataset.teamName).toBe('Walkers');
  expect(guard.isDirty()).toBe(false);

  await clickSave();
  expect(sentRequests(fetch)[1].body.team_id).toBeNull();
});

test('a user on no team saving with the placeholder picked leaves their membership alone', async () => {
  renderSettings();
  $('#set-team').innerHTML = '<option value="" selected>Choose a team…</option><option value="7">Walkers</option>';
  $('#set-team').dataset.currentTeam = '';
  const fetch = routeFetch({ [`POST ${SAVE_URL}`]: { success: true } });
  await clickSave();
  expect(sentRequests(fetch)[0].body.team_id).toBeNull();
});

test('a save that changes the units reloads, so every distance redraws in them', async () => {
  renderSettings('auto');
  routeFetch({ [`POST ${SAVE_URL}`]: { success: true } });
  $('#set-units').value = 'metric';
  await clickSave();
  expect(reloads).toHaveBeenCalledTimes(1);
  expect(status().text).not.toBe('dashboard:settings-form.saved');
});

test.each([
  ['the server\'s reason, like a taken username', { status: 400, body: { error: 'That username is taken.' } },
    'That username is taken.'],
  ['a generic failure when the server gives none', { status: 500, body: {} }, 'dashboard:settings-form.save-failed'],
  ['a generic failure when the reply isn\'t JSON, like a proxy\'s error page', { status: 502 },
    'dashboard:settings-form.save-failed'],
])('a refused save shows %s, and the edits still count as unsaved', async (_, reply, shown) => {
  renderSettings();
  routeFetch({ [`POST ${SAVE_URL}`]: reply });
  $('#set-username').value = 'taken';
  await clickSave();
  expect(status()).toEqual({ text: shown, classes: ['ud-save-err'] });
  expect($('#set-save-btn').disabled).toBe(false);
  expect(guard.isDirty()).toBe(true);
});

test('a save that never reaches the server shows a generic failure and logs why', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  renderSettings();
  const offline = new TypeError('Failed to fetch');
  routeFetch({ [`POST ${SAVE_URL}`]: offline });
  $('#set-username').value = 'offline';
  await clickSave();
  expect(status()).toEqual({ text: 'dashboard:settings-form.save-failed', classes: ['ud-save-err'] });
  expect(error).toHaveBeenCalledWith('Failed to save settings', offline);
});

describe('the unsaved-edits guard', () => {
  test('sees the form as clean on load and edited after a change', () => {
    renderSettings();
    expect(guard.isDirty()).toBe(false);
    $('#set-public-profile').checked = true;
    expect(guard.isDirty()).toBe(true);
  });

  test('saves on the way out without the units reload, since the next page renders in them anyway', async () => {
    renderSettings('auto');
    routeFetch({ [`POST ${SAVE_URL}`]: { success: true } });
    $('#set-units').value = 'imperial';
    await expect(guard.save()).resolves.toBe(true);
    expect(reloads).not.toHaveBeenCalled();
    expect(status().text).toBe('dashboard:settings-form.saved');
  });

  test('tells the guard when that save failed, so the user isn\'t walked off with their edits lost', async () => {
    renderSettings();
    routeFetch({ [`POST ${SAVE_URL}`]: { status: 400, body: { error: 'Nope.' } } });
    await expect(guard.save()).resolves.toBe(false);
  });

  test('logs which button the user picked, and doesn\'t trip on a page with no logger', () => {
    renderSettings();
    window.logWebpageActivity = vi.fn();
    guard.onChoice('discard');
    expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=UnsavedSettings_choice=discard');
    delete window.logWebpageActivity;
    expect(() => guard.onChoice('stay')).not.toThrow();
  });
});

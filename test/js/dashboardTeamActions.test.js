/**
 * Tests the team controls the dashboard, Settings, and leaderboard share (frontend/js/user-dashboard/TeamActions.js):
 * creating a team, joining one from the dashboard dropdown, and leaving one. Every finished change reloads the page,
 * except on Settings, where a reload would throw away unsaved edits, so there the dropdown and Leave button have to
 * be moved onto the new team by hand (#5147, #5840).
 */

import { loadModules, mockModule } from './loader.js';
import { navigationAttempts } from './fakes.js';
import { flush, routeFetch, sentRequests } from './support/routeFetch.js';

// Keys come back as their own text, with the team name tacked on, so a test can tell which message was picked.
mockModule('i18next', () => ({ default: { t: (key, opts) => (opts?.name ? `${key} (${opts.name})` : key) } }));

let confirmAnswer;
const confirmDialog = { confirm: vi.fn(async () => confirmAnswer) };
mockModule('frontend/js/common/ConfirmDialog.js', () => ({ ConfirmDialog: confirmDialog }));

const reloads = navigationAttempts();

let TeamActions;

beforeAll(async () => {
  // jsdom has no modal dialogs; these do the one thing the module relies on, the `open` attribute.
  window.HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };
  // The module wires itself once the app is ready, on a page with no team dialog at all, the way an unrelated page
  // that bundles it would. The Leave handler is on the document, so it stays live for every page drawn below.
  let ready;
  window.appManager = { ready: (fn) => { ready = fn; } };
  document.body.innerHTML = '';
  ({ TeamActions } = await loadModules('frontend/js/user-dashboard/TeamActions.js'));
  ready();
});

afterAll(() => {
  delete window.HTMLDialogElement.prototype.showModal;
  delete window.HTMLDialogElement.prototype.close;
});

beforeEach(() => {
  confirmAnswer = true;
  reloads.mockClear();
});

/** A cut-down copy of userDashboard/_createTeamDialog.scala.html. */
const DIALOG = `
  <dialog id="ud-create-team-dialog">
    <form id="ud-create-team-form">
      <input id="ud-team-name" type="text">
      <textarea id="ud-team-desc"></textarea>
      <div id="ud-team-error" role="alert" hidden></div>
      <button type="button" id="ud-team-cancel">Cancel</button>
      <button type="submit" id="ud-team-submit">Create</button>
    </form>
  </dialog>`;

/**
 * The Create/Leave pair, as userDashboard/_teamActions.scala.html renders it.
 * @param {?{id: number, name: string, open: boolean}} team - The user's team, if any.
 * @returns {string} The markup.
 */
const teamActions = (team) => `
  <div class="ud-team-actions" data-user-id="u-1">
    <button type="button" class="ud-create-team-btn">Create a team</button>
    ${team ? `<button type="button" class="ud-leave-team-btn" data-team-name="${team.name}"
        data-team-open="${team.open}">Leave team</button>` : ''}
  </div>`;

/**
 * The options either page lists: the current team (or a placeholder) first and selected, then the open teams.
 * @param {?{id: number, name: string}} team - The user's team, if any.
 * @param {Array<{id: number, name: string}>} joinable - The open teams they aren't on.
 * @returns {string} The markup.
 */
const teamOptions = (team, joinable) => `
  ${team ? `<option value="${team.id}" selected>${team.name}</option>`
    : '<option value="" selected>Choose a team…</option>'}
  ${joinable.map((t) => `<option value="${t.id}">${t.name}</option>`).join('')}`;

const ROVERS = { id: 3, name: 'Rovers', open: true };
const CLOSED = { id: 4, name: 'Ms. Frizzle’s class', open: false };
const OPEN_TEAMS = [{ id: 7, name: 'Walkers' }, { id: 8, name: 'Rollers' }];

/**
 * Draws the dashboard's team card (userDashboard/dashboard.scala.html) and wires it as page load would.
 * @param {?{id: number, name: string, open: boolean}} [team] - The user's team, if any.
 */
function dashboard(team = ROVERS) {
  document.body.innerHTML = `
    <div class="ud-team-card">
      <select id="ud-team-select" data-current-team="${team ? team.id : ''}">${teamOptions(team, OPEN_TEAMS)}</select>
      <button type="button" class="ud-join-team-btn" data-user-id="u-1" disabled>Join</button>
      ${teamActions(team)}
    </div>
    ${DIALOG}`;
  TeamActions.init();
  TeamActions.initJoin();
}

/**
 * Draws the Settings team section (userDashboard/settings.scala.html) and wires it as page load would.
 * @param {?{id: number, name: string, open: boolean}} [team] - The user's team, if any.
 */
function settings(team = ROVERS) {
  document.body.innerHTML = `
    <select id="set-team" data-current-team="${team ? team.id : ''}" data-placeholder="Choose a team…">
      ${teamOptions(team, OPEN_TEAMS)}
    </select>
    ${teamActions(team)}
    ${DIALOG}`;
  TeamActions.init();
  TeamActions.initJoin();
}

const $ = (selector) => document.querySelector(selector);
const dialog = () => $('#ud-create-team-dialog');
const errorText = () => ($('#ud-team-error').hidden ? null : $('#ud-team-error').textContent);
/** @returns {Array<string>} The Settings dropdown's options as "value:label", selected ones starred. */
const settingsOptions = () => [...$('#set-team').options]
  .map((o) => `${o.value}:${o.textContent}${o.selected ? '*' : ''}`);
/** @returns {?{name: string, open: string}} What the Leave button says it would leave, or null if there's none. */
const leaveButton = () => {
  const btn = $('.ud-leave-team-btn');
  return btn && { name: btn.dataset.teamName, open: btn.dataset.teamOpen };
};

/**
 * Opens the create dialog, types a team, and submits it.
 * @param {string} name - What goes in the name field.
 * @param {string} [description] - What goes in the description field.
 */
async function createTeam(name, description = '') {
  $('.ud-create-team-btn').click();
  $('#ud-team-name').value = name;
  $('#ud-team-desc').value = description;
  $('#ud-create-team-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
}

/** Clicks Leave and lets the confirmation and request finish. */
async function leave() {
  $('.ud-leave-team-btn').click();
  await flush();
}

describe('creating a team', () => {
  test('opens on a clean form, without the last attempt\'s name or error', async () => {
    dashboard();
    routeFetch({ 'POST /userapi/createTeam': { status: 400, body: { error: 'That name is taken.' } } });
    await createTeam('Rovers');
    expect(errorText()).toBe('That name is taken.');
    dialog().close();

    $('.ud-create-team-btn').click();
    expect(dialog().hasAttribute('open')).toBe(true);
    expect($('#ud-team-name').value).toBe('');
    expect(errorText()).toBeNull();
  });

  test('Cancel closes the dialog without saving anything', () => {
    dashboard();
    const fetch = routeFetch({});
    $('.ud-create-team-btn').click();
    $('#ud-team-cancel').click();
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('a one-letter name is refused before anything is sent', async () => {
    dashboard();
    const fetch = routeFetch({});
    await createTeam(' R ');
    expect(errorText()).toBe('dashboard:team-dialog.name-too-short');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('on the dashboard, a new team is sent trimmed and the page reloads onto it', async () => {
    dashboard();
    const fetch = routeFetch({ 'POST /userapi/createTeam': { success: true, team_id: 12 } });
    await createTeam('  Sidewalk Scouts ', ' We map on Saturdays. ');
    expect(sentRequests(fetch)).toEqual([{
      method: 'POST',
      url: '/userapi/createTeam',
      body: { name: 'Sidewalk Scouts', description: 'We map on Saturdays.' },
    }]);
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(reloads).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['an error the server words itself', { status: 400, body: { error: 'Please pick a kinder name.' } },
      'Please pick a kinder name.'],
    ['a refusal with no message', { status: 500, body: {} }, 'dashboard:team-dialog.create-failed'],
    ['a reply that isn\'t JSON', { status: 502 }, 'dashboard:team-dialog.create-failed'],
    ['a 200 that says it didn\'t work', { success: false }, 'dashboard:team-dialog.create-failed'],
  ])('%s is shown in the dialog, which stays open for another try', async (_, reply, shown) => {
    dashboard();
    routeFetch({ 'POST /userapi/createTeam': reply });
    await createTeam('Sidewalk Scouts');
    expect(errorText()).toBe(shown);
    expect(dialog().hasAttribute('open')).toBe(true);
    expect($('#ud-team-submit').disabled).toBe(false);
    expect(reloads).not.toHaveBeenCalled();
  });

  test('a request that never arrives says so and is logged', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    dashboard();
    const failure = new TypeError('Failed to fetch');
    routeFetch({ 'POST /userapi/createTeam': failure });
    await createTeam('Sidewalk Scouts');
    expect(errorText()).toBe('dashboard:team-dialog.network-error');
    expect(error).toHaveBeenCalledWith('Create team failed', failure);
    expect($('#ud-team-submit').disabled).toBe(false);
  });

  test('on Settings, the dropdown and Leave move to the new team, and the open team left stays a choice', async () => {
    settings(ROVERS);
    routeFetch({ 'POST /userapi/createTeam': { success: true, team_id: 12 } });
    await createTeam('Sidewalk Scouts');
    expect(reloads).not.toHaveBeenCalled();
    expect(settingsOptions()).toEqual(['12:Sidewalk Scouts*', '3:Rovers', '7:Walkers', '8:Rollers']);
    expect($('#set-team').dataset.currentTeam).toBe('12');
    expect(leaveButton()).toEqual({ name: 'Sidewalk Scouts', open: 'true' });
  });

  test('on Settings, a closed team left behind drops out of the dropdown, since it can\'t be rejoined', async () => {
    settings(CLOSED);
    routeFetch({ 'POST /userapi/createTeam': { success: true, team_id: 12 } });
    await createTeam('Sidewalk Scouts');
    expect(settingsOptions()).toEqual(['12:Sidewalk Scouts*', '7:Walkers', '8:Rollers']);
  });

  test('on Settings with no team, the placeholder gives way and the new Leave button works', async () => {
    settings(null);
    routeFetch({
      'POST /userapi/createTeam': { success: true, team_id: 12 },
      'PUT /userapi/leaveTeam': {},
    });
    await createTeam('Sidewalk Scouts');
    expect(settingsOptions()).toEqual(['12:Sidewalk Scouts*', '7:Walkers', '8:Rollers']);
    expect(leaveButton()).toEqual({ name: 'Sidewalk Scouts', open: 'true' });

    await leave();
    expect(confirmDialog.confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: 'dashboard:team-leave-confirm-open (Sidewalk Scouts)',
    }));
    expect(leaveButton()).toBeNull();
  });
});

describe('joining a team from the dashboard', () => {
  test('Join only wakes up once a different team is picked, including after a back-forward restore', () => {
    dashboard(ROVERS);
    const select = $('#ud-team-select');
    const join = $('.ud-join-team-btn');
    expect(join.disabled).toBe(true);

    select.value = '7';
    select.dispatchEvent(new Event('change'));
    expect(join.disabled).toBe(false);

    // The browser puts the old pick back without a change event.
    select.value = '3';
    window.dispatchEvent(new Event('pageshow'));
    expect(join.disabled).toBe(true);
  });

  test('a user on no team can\'t join the placeholder', () => {
    dashboard(null);
    expect($('.ud-join-team-btn').disabled).toBe(true);
  });

  test('joining sends the user and team, then reloads onto it', async () => {
    dashboard(ROVERS);
    const fetch = routeFetch({ 'PUT /userapi/setUserTeam': {} });
    $('#ud-team-select').value = '8';
    $('#ud-team-select').dispatchEvent(new Event('change'));
    $('.ud-join-team-btn').click();
    await flush();
    expect(sentRequests(fetch).map((r) => r.url)).toEqual(['/userapi/setUserTeam?userId=u-1&teamId=8']);
    expect(reloads).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['refused', { status: 500, body: {} }, 500],
    ['never answered', new TypeError('Failed to fetch'), expect.any(TypeError)],
  ])('a join the server %s is logged and Join can be tried again', async (_, reply, logged) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    dashboard(ROVERS);
    routeFetch({ 'PUT /userapi/setUserTeam': reply });
    $('#ud-team-select').value = '7';
    $('#ud-team-select').dispatchEvent(new Event('change'));
    $('.ud-join-team-btn').click();
    await flush();
    expect(error).toHaveBeenCalledWith('Join team failed', logged);
    expect($('.ud-join-team-btn').disabled).toBe(false);
    expect(reloads).not.toHaveBeenCalled();
  });

  test.each([
    ['the team they\'re on', ROVERS, '3'],
    ['the placeholder', null, ''],
  ])('a Join a failed attempt left awake sends nothing once the dropdown is back on %s', async (_, team, back) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    dashboard(team);
    const fetch = routeFetch({ 'PUT /userapi/setUserTeam': { status: 500, body: {} } });
    const select = $('#ud-team-select');
    select.value = '7';
    select.dispatchEvent(new Event('change'));
    $('.ud-join-team-btn').click();
    // Switched back while the request is out; its failure then re-enables the button.
    select.value = back;
    select.dispatchEvent(new Event('change'));
    await flush();
    expect($('.ud-join-team-btn').disabled).toBe(false);

    $('.ud-join-team-btn').click();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('leaving a team', () => {
  test('asks first, warning when the team is closed, and sends nothing if the user backs out', async () => {
    dashboard(CLOSED);
    const fetch = routeFetch({});
    confirmAnswer = false;
    await leave();
    expect(confirmDialog.confirm).toHaveBeenCalledWith({
      message: 'dashboard:team-leave-confirm-closed (Ms. Frizzle’s class)',
      confirmText: 'dashboard:team-leave',
      cancelText: 'common:cancel',
      danger: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('a click anywhere else on the page asks nothing', () => {
    dashboard();
    $('.ud-create-team-btn').click();
    expect(confirmDialog.confirm).not.toHaveBeenCalled();
  });

  test('on the dashboard, leaving sends the user and reloads', async () => {
    dashboard(ROVERS);
    const fetch = routeFetch({ 'PUT /userapi/leaveTeam': {} });
    await leave();
    expect(sentRequests(fetch).map((r) => r.url)).toEqual(['/userapi/leaveTeam?userId=u-1']);
    expect(reloads).toHaveBeenCalledTimes(1);
  });

  test('on Settings, leaving an open team shows the placeholder and keeps the team to rejoin', async () => {
    settings(ROVERS);
    routeFetch({ 'PUT /userapi/leaveTeam': {} });
    await leave();
    expect(reloads).not.toHaveBeenCalled();
    expect(settingsOptions()).toEqual([':Choose a team…*', '3:Rovers', '7:Walkers', '8:Rollers']);
    expect($('#set-team').dataset.currentTeam).toBe('');
    expect(leaveButton()).toBeNull();
  });

  test('on Settings, leaving a closed team takes it out of the dropdown', async () => {
    settings(CLOSED);
    routeFetch({ 'PUT /userapi/leaveTeam': {} });
    await leave();
    expect(settingsOptions()).toEqual([':Choose a team…*', '7:Walkers', '8:Rollers']);
  });

  test.each([
    ['refused', { status: 403, body: {} }, 403],
    ['never answered', new TypeError('Failed to fetch'), expect.any(TypeError)],
  ])('a leave the server %s is logged and the user stays on the team', async (_, reply, logged) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    settings(ROVERS);
    routeFetch({ 'PUT /userapi/leaveTeam': reply });
    await leave();
    expect(error).toHaveBeenCalledWith('Leave team failed', logged);
    expect(leaveButton()).toEqual({ name: 'Rovers', open: 'true' });
    expect($('.ud-leave-team-btn').disabled).toBe(false);
  });
});

describe('a Settings save onto another team', () => {
  test('moves Leave and the "already on" mark there', () => {
    settings(ROVERS);
    $('#set-team').value = '7';
    TeamActions.settingsTeamSaved(7);
    expect($('#set-team').dataset.currentTeam).toBe('7');
    // Only a team they're already on can be closed, so the one they just picked from the list must be open.
    expect(leaveButton()).toEqual({ name: 'Walkers', open: 'true' });
    // An open team they moved off stays in the list to switch back to.
    expect(settingsOptions()).toEqual(['3:Rovers', '7:Walkers*', '8:Rollers']);
  });

  test('takes a closed team they moved off out of the list, since it can\'t be picked again', () => {
    settings(CLOSED);
    $('#set-team').value = '7';
    TeamActions.settingsTeamSaved(7);
    expect(settingsOptions()).toEqual(['7:Walkers*', '8:Rollers']);
  });

  test('from no team, drops the placeholder, so a later leave leaves just one', async () => {
    settings(null);
    $('#set-team').value = '7';
    TeamActions.settingsTeamSaved(7);
    expect(settingsOptions()).toEqual(['7:Walkers*', '8:Rollers']);

    routeFetch({ 'PUT /userapi/leaveTeam': {} });
    await leave();
    expect(settingsOptions()).toEqual([':Choose a team…*', '7:Walkers', '8:Rollers']);
  });
});

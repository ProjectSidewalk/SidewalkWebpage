/** Tests for the admin Management page: the users table and its controls, team toggles and maintenance jobs (#5840). */

import { loadModules, mockModule } from './loader.js';
import { flush, routeFetch, sentRequests, textOf } from './support/routeFetch.js';

const ConfirmDialog = { confirm: vi.fn() };
mockModule('frontend/js/common/ConfirmDialog.js', () => ({ ConfirmDialog }));

const { ManagementPage } = await loadModules('frontend/js/admin-dashboard/ManagementPage.js');

const URLS = {
  userStatsUrl: '/adminapi/getUserStats',
  setRoleUrl: '/adminapi/setRole',
  setTeamUrl: '/userapi/setUserTeam',
  teamStatusUrl: '/adminapi/updateTeamStatus',
  teamVisibilityUrl: '/adminapi/updateTeamVisibility',
  clearCacheUrl: '/adminapi/clearPlayCache',
  recalcStatsUrl: '/adminapi/updateUserStats',
  recalcPriorityUrl: '/adminapi/recalculateStreetPriority',
  recalcValidationCountsUrl: '/adminapi/recalculateValidationCounts',
  generateCropsUrl: '/adminapi/generateCrops',
  rebuildSidewalkPresenceUrl: '/adminapi/rebuildSidewalkPresence',
  refreshPlacesUrl: '/adminapi/refreshPlaces',
  refreshBasemapUrl: '/adminapi/refreshBasemap',
  recountGradientStalenessUrl: '/adminapi/recountStreetGradientStaleness',
};

const ROLES = ['Registered', 'Researcher', 'Administrator'];

/** The maintenance buttons as the view lists them: id, confirm text. */
const JOBS = [
  ['mgmt-recalc-stats', 'Recalculate user stats for every contributor?'],
  ['mgmt-recalc-priority', 'Recalculate street priority for all streets?'],
  ['mgmt-recalc-validation-counts', 'Recount validations on every label?'],
  ['mgmt-generate-crops', 'Generate missing crops?'],
  ['mgmt-rebuild-sidewalk-presence', 'Rebuild sidewalk presence for every street?'],
  ['mgmt-refresh-places', 'Fetch places from OpenStreetMap?'],
  ['mgmt-refresh-basemap', 'Rebuild the minimap basemap?'],
  ['mgmt-recount-gradient-staleness', 'Recount street gradient staleness?'],
  ['mgmt-clear-cache', 'Clear the server cache?'],
];

const JOB_BUTTONS = JOBS.map(([id, confirm]) => `
  <button type="button" class="coverage-sort-btn mgmt-run" id="${id}" data-confirm="${confirm}">Run</button>`).join('');

const MARKUP = `
  <div class="coverage-status" id="mgmt-status" role="status" aria-live="polite">Loading…</div>
  <input type="search" id="mgmt-user-search" class="ps-input mgmt-search">
  <span class="mgmt-count dq-sub" id="mgmt-user-count"></span>
  <div class="ps-pager ps-pager--spread" id="mgmt-pagination-top"></div>
  <div class="ps-table-scroll"><div id="mgmt-users"></div></div>
  <div class="ps-pager ps-pager--spread" id="mgmt-pagination-bottom"></div>
  <div id="mgmt-teams"></div>
  <div class="mgmt-actions">${JOB_BUTTONS}</div>
  <p class="mgmt-result dq-sub" id="mgmt-maint-result" role="status" aria-live="polite"></p>`;

/** One user_stats row, as the admin endpoint writes it. */
function user(id, overrides = {}) {
  return {
    user_id: id,
    username: id,
    email: `${id}@example.org`,
    role: 'Registered',
    team: null,
    sign_up_time: '2025-01-01T00:00:00Z',
    last_sign_in_time: '2026-01-01T00:00:00Z',
    sign_in_count: 3,
    labels: 10,
    own_validated: 10,
    own_validated_agreed_pct: 0.9,
    others_validated: 0,
    others_validated_agreed_pct: 0,
    high_quality: true,
    high_quality_manual: null,
    ...overrides,
  };
}

const TEAMS = [
  { team_id: 1, name: 'Alpha', description: 'First <b>team</b>', open: true, visible: true },
  { team_id: 2, name: 'Bravo', description: '', open: false, visible: false },
];

/**
 * Builds the view and starts the page with the given stats reply.
 * @param {any} stats - What /adminapi/getUserStats answers.
 * @param {Record<string, any>} [routes] - Answers for the save endpoints.
 * @param {string} [markup] - The page's DOM, when a test needs less of it.
 * @returns {Promise<{sent: Function}>} The log of requests made.
 */
async function load(stats, routes = {}, markup = MARKUP) {
  document.body.innerHTML = markup;
  const stub = routeFetch({ [URLS.userStatsUrl]: stats, ...routes });
  const sent = () => sentRequests(stub);
  await new ManagementPage(URLS, ROLES).init();
  return { sent };
}

const status = () => document.getElementById('mgmt-status');
const userRows = () => [...document.querySelectorAll('#mgmt-users tbody tr')];
const cells = (tr) => [...tr.cells].map(textOf);
const names = () => userRows().map((tr) => textOf(tr.cells[0]));
const sortBy = (key) => document.querySelector(`.mgmt-sort[data-key="${key}"]`).click();
const pager = (id = 'mgmt-pagination-top') => document.getElementById(id);
const pagerStatus = () => textOf(pager().querySelector('.ps-pager-status'));
const pageButton = (token, id) => pager(id).querySelector(`.ps-pager-btn[data-page="${token}"]`);

/** Picks an option in a select and fires the change the page listens for. */
function choose(select, value) {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  ConfirmDialog.confirm = vi.fn(() => Promise.resolve(true));
});

describe('loading', () => {
  test('hides the status line once the data is in', async () => {
    await load({ user_stats: [user('ada')], teams: TEAMS });
    expect(status().classList.contains('ps-hidden')).toBe(true);
    expect(status().classList.contains('error')).toBe(false);
  });

  test('says so in red when the data does not load', async () => {
    await load({ status: 500, body: 'boom' });
    expect(status().textContent).toBe('Could not load management data. Please try again.');
    expect(status().classList.contains('error')).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });

  test('treats an empty reply as no users and no teams', async () => {
    await load(null);
    expect(textOf(document.getElementById('mgmt-users'))).toBe('No users match your search.');
    expect(textOf(document.getElementById('mgmt-teams'))).toBe('No teams in this city.');
    expect(document.getElementById('mgmt-user-count').textContent).toBe('0 users');
    expect(pager().innerHTML).toBe('');
  });

  test('still draws the tables on a page missing its search box, pagers and status lines', async () => {
    const bare = '<div id="mgmt-users"></div><div id="mgmt-teams"></div>';
    await load({ user_stats: [user('ada')], teams: TEAMS }, {}, bare);
    expect(names()).toEqual(['ada']);
    expect(document.querySelectorAll('#mgmt-teams tbody tr')).toHaveLength(2);
  });
});

describe('the users table', () => {
  test('shows each user with role, team, quality, accuracy, dates and sign-ins', async () => {
    await load({ user_stats: [user('ada', { team: 'Alpha', sign_in_count: 1234 })], teams: TEAMS });
    const [name, email, role, team, quality, accuracy, , , signIns] = cells(userRows()[0]);
    expect(name).toBe('ada');
    expect(userRows()[0].querySelector('a').getAttribute('href')).toBe('/admin/user/ada');
    expect(email).toBe('ada@example.org');
    expect(role).toContain('Registered');
    expect(userRows()[0].querySelector('[data-kind="team"]').value).toBe('1');
    expect(team).toContain('Alpha');
    expect(quality).toBe('High');
    // The endpoint sends a 0–1 share, shown as a percent of how many were judged.
    expect(accuracy).toBe('90% of 10');
    expect(signIns).toBe((1234).toLocaleString());
  });

  test('fills the gaps a sparse row leaves with dashes, zeros and the user id', async () => {
    await load({ user_stats: [user('u-1', {
      username: null, email: null, team: 'Gone team', sign_up_time: null, last_sign_in_time: 'not a date',
      sign_in_count: null, own_validated: 0, high_quality: false,
    })], teams: TEAMS });
    const [name, email, , , quality, accuracy, signedUp, lastIn, signIns] = cells(userRows()[0]);
    expect(name).toBe('u-1');
    expect(email).toBe('');
    // A team the list doesn't have leaves the select on its blank choice.
    expect(userRows()[0].querySelector('[data-kind="team"]').value).toBe('');
    expect(quality).toBe('Low');
    // Nobody judged this user's labels, so there's no rate rather than a 0%.
    expect(accuracy).toBe('—');
    expect(signedUp).toBe('—');
    expect(lastIn).toBe('—');
    expect(signIns).toBe('0');
  });

  test('tags a quality an admin set by hand as manual', async () => {
    await load({ user_stats: [user('ada', { high_quality_manual: false, high_quality: false })], teams: [] });
    expect(cells(userRows()[0])[4]).toBe('Low manual');
  });

  test('reads an accuracy already sent as a percent without scaling it again', async () => {
    await load({ user_stats: [user('ada', { own_validated_agreed_pct: 85 }), user('bo', {
      own_validated_agreed_pct: null })], teams: [] });
    expect(userRows().map((tr) => cells(tr)[5])).toEqual(['85% of 10', '0% of 10']);
  });

  test('locks the role of a user whose role admins cannot assign', async () => {
    const { sent } = await load({ user_stats: [user('turk', { role: 'Turker' })], teams: [] });
    const select = userRows()[0].querySelector('.mgmt-select');
    expect(select.disabled).toBe(true);
    expect(select.getAttribute('aria-label')).toBe('Role for turk (locked)');
    expect(select.textContent).toBe('Turker');
    choose(select, 'Turker');
    await flush();
    expect(sent()).toHaveLength(1);
  });

  test('gives the quality and accuracy headers an explanation', async () => {
    await load({ user_stats: [user('ada')], teams: [] });
    const tipped = [...document.querySelectorAll('.mgmt-sort[data-ps-tooltip]')].map((b) => b.dataset.key);
    expect(tipped).toEqual(['high_quality', 'own_validated_agreed_pct']);
  });
});

describe('sorting users', () => {
  const USERS = [
    user('cyd', { last_sign_in_time: '2026-03-01T00:00:00Z', email: 'z@example.org', role: 'Researcher',
      team: 'Bravo', high_quality: false, own_validated_agreed_pct: 0.5, sign_in_count: 1,
      sign_up_time: '2024-01-01T00:00:00Z' }),
    user('ada', { last_sign_in_time: '2026-01-01T00:00:00Z', email: null, role: null, team: null,
      own_validated_agreed_pct: null, sign_in_count: null, sign_up_time: null }),
    user('Bo', { last_sign_in_time: null, username: 'Bo', email: 'a@example.org', team: 'Alpha',
      own_validated_agreed_pct: 0.7, sign_in_count: 9 }),
    user('dee', { username: null, last_sign_in_time: '2026-02-01T00:00:00Z' }),
  ];

  test('opens on the most recent sign-in first', async () => {
    await load({ user_stats: USERS, teams: TEAMS });
    expect(names()).toEqual(['cyd', 'dee', 'ada', 'Bo']);
    const th = document.querySelector('.mgmt-sort[data-key="last_sign_in_time"]').closest('th');
    expect(th.getAttribute('aria-sort')).toBe('descending');
    expect(th.textContent).toContain('▼');
  });

  test('sorts text columns A to Z first and number columns biggest first, flipping on a second click', async () => {
    await load({ user_stats: USERS, teams: TEAMS });
    sortBy('username');
    // Case doesn't matter, and a missing name sorts as blank.
    expect(names()).toEqual(['dee', 'ada', 'Bo', 'cyd']);
    const th = document.querySelector('.mgmt-sort[data-key="username"]').closest('th');
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    sortBy('username');
    expect(names()).toEqual(['cyd', 'Bo', 'ada', 'dee']);
    sortBy('sign_in_count');
    expect(names()).toEqual(['Bo', 'dee', 'cyd', 'ada']);
  });

  test('can sort by every column', async () => {
    await load({ user_stats: USERS, teams: TEAMS });
    const orders = {};
    for (const key of ['email', 'role', 'team', 'high_quality', 'own_validated_agreed_pct', 'sign_up_time']) {
      sortBy(key);
      orders[key] = names();
    }
    expect(orders).toEqual({
      email: ['ada', 'Bo', 'dee', 'cyd'],
      role: ['ada', 'Bo', 'dee', 'cyd'],
      team: ['ada', 'dee', 'Bo', 'cyd'],
      high_quality: ['ada', 'Bo', 'dee', 'cyd'],
      own_validated_agreed_pct: ['dee', 'Bo', 'cyd', 'ada'],
      sign_up_time: ['Bo', 'dee', 'cyd', 'ada'],
    });
  });

  test('a second click on the opening column puts the oldest sign-in first', async () => {
    await load({ user_stats: USERS, teams: TEAMS });
    sortBy('last_sign_in_time');
    expect(names()).toEqual(['Bo', 'ada', 'dee', 'cyd']);
  });

  test('ignores a click in the table that is not on a header', async () => {
    await load({ user_stats: USERS, teams: TEAMS });
    userRows()[0].cells[1].click();
    expect(names()).toEqual(['cyd', 'dee', 'ada', 'Bo']);
  });
});

describe('searching users', () => {
  const USERS = [user('ada', { email: 'lovelace@example.org' }), user('bo'), user('cyd')];

  test('matches on username or email and counts the matches', async () => {
    await load({ user_stats: USERS, teams: [] });
    const input = document.getElementById('mgmt-user-search');
    input.value = 'LOVELACE';
    input.dispatchEvent(new Event('input'));
    expect(names()).toEqual(['ada']);
    expect(document.getElementById('mgmt-user-count').textContent).toBe('1 of 3 users');

    input.value = 'bo';
    input.dispatchEvent(new Event('input'));
    expect(names()).toEqual(['bo']);
  });

  test('skips a user with no username or email rather than failing', async () => {
    await load({ user_stats: [...USERS, user('u-9', { username: null, email: null })], teams: [] });
    const input = document.getElementById('mgmt-user-search');
    input.value = 'cyd';
    input.dispatchEvent(new Event('input'));
    expect(names()).toEqual(['cyd']);
  });

  test('says nothing matched, and drops the pager', async () => {
    await load({ user_stats: USERS, teams: [] });
    const input = document.getElementById('mgmt-user-search');
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    expect(textOf(document.getElementById('mgmt-users'))).toBe('No users match your search.');
    expect(pager().innerHTML).toBe('');
  });
});

describe('paging users', () => {
  // Sign-ins counted down, so the default sort keeps u00 first.
  const USERS = Array.from({ length: 45 }, (_, i) => user(`u${String(i).padStart(2, '0')}`, {
    last_sign_in_time: new Date(Date.UTC(2026, 0, 45 - i)).toISOString(),
  }));

  test('shows 20 a page, with both pagers saying where you are', async () => {
    await load({ user_stats: USERS, teams: [] });
    expect(userRows()).toHaveLength(20);
    expect(pagerStatus()).toBe('1–20 of 45 · Page 1 of 3');
    expect(textOf(pager('mgmt-pagination-bottom').querySelector('.ps-pager-status'))).toBe(pagerStatus());
    expect(pageButton('first').disabled).toBe(true);
    expect(pageButton('prev').disabled).toBe(true);
    expect(pageButton('next').disabled).toBe(false);
  });

  test('steps through pages from either pager and keeps focus on the button pressed', async () => {
    await load({ user_stats: USERS, teams: [] });
    pageButton('next').click();
    expect(pagerStatus()).toBe('21–40 of 45 · Page 2 of 3');
    expect(names()[0]).toBe('u20');
    expect(document.activeElement).toBe(pageButton('next'));

    pageButton('last', 'mgmt-pagination-bottom').click();
    expect(pagerStatus()).toBe('41–45 of 45 · Page 3 of 3');
    expect(userRows()).toHaveLength(5);
    // Last is now disabled, so focus lands on the first button still usable.
    expect(document.activeElement).toBe(pageButton('first', 'mgmt-pagination-bottom'));

    pageButton('prev').click();
    expect(pagerStatus()).toBe('21–40 of 45 · Page 2 of 3');
    pageButton('first').click();
    expect(pagerStatus()).toBe('1–20 of 45 · Page 1 of 3');
  });

  test('ignores clicks on a disabled button or on the page readout', async () => {
    await load({ user_stats: USERS, teams: [] });
    pageButton('prev').click();
    pager().querySelector('.ps-pager-status').click();
    expect(pagerStatus()).toBe('1–20 of 45 · Page 1 of 3');
  });

  test('changing rows per page starts over on page 1 and updates both pagers', async () => {
    await load({ user_stats: USERS, teams: [] });
    pageButton('next').click();
    const select = pager('mgmt-pagination-bottom').querySelector('.ps-pager-size select');
    choose(select, '50');
    expect(userRows()).toHaveLength(45);
    expect(pagerStatus()).toBe('1–45 of 45 · Page 1 of 1');
    expect(pager().querySelector('.ps-pager-size select').value).toBe('50');
    expect(document.activeElement).toBe(pager('mgmt-pagination-bottom').querySelector('.ps-pager-size select'));
  });

  test('ignores a change event from anything but the rows-per-page select', async () => {
    await load({ user_stats: USERS, teams: [] });
    pager().querySelector('.ps-pager-controls').dispatchEvent(new Event('change', { bubbles: true }));
    expect(userRows()).toHaveLength(20);
  });

  test('sorting or searching goes back to page 1', async () => {
    await load({ user_stats: USERS, teams: [] });
    pageButton('last').click();
    sortBy('sign_in_count');
    expect(pagerStatus()).toBe('1–20 of 45 · Page 1 of 3');
    pageButton('last').click();
    const input = document.getElementById('mgmt-user-search');
    input.value = 'u0';
    input.dispatchEvent(new Event('input'));
    expect(pagerStatus()).toBe('1–10 of 10 · Page 1 of 1');
  });
});

describe('changing a role', () => {
  test('sends the new role and confirms it on the status line', async () => {
    const { sent } = await load({ user_stats: [user('ada')], teams: [] },
      { 'PUT /adminapi/setRole': { role: 'Researcher' } });
    choose(userRows()[0].querySelector('[data-kind="role"]'), 'Researcher');
    await flush();
    expect(sent().at(-1)).toEqual({ method: 'PUT', url: '/adminapi/setRole',
      body: { user_id: 'ada', role_id: 'Researcher' } });
    expect(status().textContent).toBe('Set ada to Researcher.');
    expect(status().classList.contains('ps-hidden')).toBe(false);
  });

  test('keeps the choice when the server replies with no body', async () => {
    await load({ user_stats: [user('ada')], teams: [] }, { 'PUT /adminapi/setRole': undefined });
    const select = userRows()[0].querySelector('[data-kind="role"]');
    choose(select, 'Administrator');
    await flush();
    expect(status().textContent).toBe('Set ada to Administrator.');
    sortBy('role');
    expect(userRows()[0].querySelector('[data-kind="role"]').value).toBe('Administrator');
  });

  test('puts the old role back and shows the server\'s reason when refused', async () => {
    await load({ user_stats: [user('ada')], teams: [] },
      { 'PUT /adminapi/setRole': { status: 403, body: 'Only owners can do that' } });
    const select = userRows()[0].querySelector('[data-kind="role"]');
    choose(select, 'Administrator');
    await flush();
    expect(select.value).toBe('Registered');
    expect(status().textContent).toBe('Could not change role: Only owners can do that');
    expect(status().classList.contains('error')).toBe(true);
  });
});

describe('changing a team', () => {
  test('sends the user to the chosen team and names it', async () => {
    const { sent } = await load({ user_stats: [user('ada')], teams: TEAMS }, { 'PUT /userapi/setUserTeam': {} });
    choose(userRows()[0].querySelector('[data-kind="team"]'), '2');
    await flush();
    expect(sent().at(-1)).toMatchObject({ method: 'PUT', url: '/userapi/setUserTeam?userId=ada&teamId=2' });
    expect(status().textContent).toBe('Assigned ada to Bravo.');
  });

  test('puts the old team back when refused', async () => {
    await load({ user_stats: [user('ada', { team: 'Alpha' })], teams: TEAMS },
      { 'PUT /userapi/setUserTeam': { status: 500 } });
    const select = userRows()[0].querySelector('[data-kind="team"]');
    choose(select, '2');
    await flush();
    expect(select.value).toBe('1');
    expect(status().textContent).toBe('Could not change team: HTTP 500');
  });

  test('goes back to no team when refused for a user who had none', async () => {
    await load({ user_stats: [user('ada')], teams: TEAMS }, { 'PUT /userapi/setUserTeam': { status: 500 } });
    const select = userRows()[0].querySelector('[data-kind="team"]');
    choose(select, '2');
    await flush();
    expect(select.value).toBe('');
  });
});

describe('the teams table', () => {
  test('lists each team with its settings and a validate link, escaping what teams typed', async () => {
    await load({ user_stats: [], teams: TEAMS });
    const [alpha, bravo] = [...document.querySelectorAll('#mgmt-teams tbody tr')];
    expect(cells(alpha)).toEqual(['Alpha', 'First <b>team</b>', 'Open', 'Visible', 'Validate']);
    expect(alpha.querySelector('b')).toBeNull();
    expect(alpha.querySelector('a').getAttribute('href')).toBe('/admin/team/1');
    expect(alpha.querySelector('.dq-validate-btn').getAttribute('href')).toBe('/expertValidate?teams=1');
    expect(cells(bravo).slice(2, 4)).toEqual(['Closed', 'Hidden']);
  });

  test('closing a team tells the server and flips the button', async () => {
    const { sent } = await load({ user_stats: [], teams: TEAMS }, { 'PUT /adminapi/updateTeamStatus/1': {} });
    const button = document.querySelector('.mgmt-toggle[data-kind="status"][data-team-id="1"]');
    button.click();
    await flush();
    expect(sent().at(-1)).toEqual({ method: 'PUT', url: '/adminapi/updateTeamStatus/1', body: { open: false } });
    expect(button.textContent).toBe('Closed');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.classList.contains('is-off')).toBe(true);
    expect(status().textContent).toBe('Team 1: open → Closed.');
  });

  test('showing a hidden team tells the server and flips the button', async () => {
    const { sent } = await load({ user_stats: [], teams: TEAMS }, { 'PUT /adminapi/updateTeamVisibility/2': {} });
    const button = document.querySelector('.mgmt-toggle[data-kind="visibility"][data-team-id="2"]');
    button.click();
    await flush();
    expect(sent().at(-1).body).toEqual({ visible: true });
    expect(button.textContent).toBe('Visible');
    expect(status().textContent).toBe('Team 2: visible → Visible.');
  });

  test('leaves the button alone and says why when the change fails', async () => {
    await load({ user_stats: [], teams: TEAMS }, { 'PUT /adminapi/updateTeamStatus/1': { status: 403, body: 'nope' } });
    const button = document.querySelector('.mgmt-toggle[data-kind="status"][data-team-id="1"]');
    button.click();
    await flush();
    expect(button.textContent).toBe('Open');
    expect(status().textContent).toBe('Could not update team: nope');
  });

  test('ignores clicks elsewhere in the table', async () => {
    const { sent } = await load({ user_stats: [], teams: TEAMS });
    document.querySelector('#mgmt-teams tbody td').click();
    await flush();
    expect(sent()).toHaveLength(1);
  });
});

describe('maintenance jobs', () => {
  const result = () => document.getElementById('mgmt-maint-result');

  test('each job asks with its own question, then calls its endpoint', async () => {
    const routes = Object.fromEntries(Object.values(URLS).map((url) => [url, {}]));
    routes[URLS.recountGradientStalenessUrl] = { streets_unsampled: 1200, streets_stale: 3 };
    const { sent } = await load({ user_stats: [], teams: [] }, routes);
    for (const [id] of JOBS) {
      document.getElementById(id).click();
      await flush();
    }
    expect(ConfirmDialog.confirm.mock.calls.map(([opts]) => opts.message)).toEqual(JOBS.map(([, q]) => q));
    expect(sent().slice(1).map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET /adminapi/updateUserStats',
      'GET /adminapi/recalculateStreetPriority',
      'POST /adminapi/recalculateValidationCounts',
      'POST /adminapi/generateCrops',
      'POST /adminapi/rebuildSidewalkPresence',
      'POST /adminapi/refreshPlaces',
      'POST /adminapi/refreshBasemap',
      'POST /adminapi/recountStreetGradientStaleness',
      'PUT /adminapi/clearPlayCache',
    ]);
  });

  test('says Done for a job that finishes before it answers', async () => {
    await load({ user_stats: [], teams: [] }, { [URLS.clearCacheUrl]: {} });
    const button = document.getElementById('mgmt-clear-cache');
    button.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(button.disabled).toBe(true);
    expect(result().textContent).toBe('Running: clear server cache…');
    await flush();
    expect(result().textContent).toBe('Done: clear server cache.');
    expect(button.disabled).toBe(false);
  });

  test('says Started for a job that keeps running in the background', async () => {
    await load({ user_stats: [], teams: [] }, { [URLS.generateCropsUrl]: {} });
    document.getElementById('mgmt-generate-crops').click();
    await flush();
    expect(result().textContent).toBe(
      'Started: generate crops. It runs in the background; Health (Owners) reports the result.');
  });

  test('reports the gradient recount\'s counts', async () => {
    await load({ user_stats: [], teams: [] },
      { [URLS.recountGradientStalenessUrl]: { streets_unsampled: 1200, streets_stale: 3 } });
    document.getElementById('mgmt-recount-gradient-staleness').click();
    await flush();
    expect(result().textContent).toBe('Done: 1,200 street(s) with no grade, 3 sampled on an older geometry.');
  });

  test('says which job failed and why, in red, and frees the button', async () => {
    await load({ user_stats: [], teams: [] }, { [URLS.recalcStatsUrl]: { status: 500, body: 'timed out' } });
    const button = document.getElementById('mgmt-recalc-stats');
    button.click();
    await flush();
    expect(result().textContent).toBe('Failed: recalculate user stats — timed out');
    expect(result().classList.contains('error')).toBe(true);
    expect(button.disabled).toBe(false);
  });

  test('does nothing when the admin cancels', async () => {
    ConfirmDialog.confirm = vi.fn(() => Promise.resolve(false));
    const { sent } = await load({ user_stats: [], teams: [] });
    document.getElementById('mgmt-clear-cache').click();
    await flush();
    expect(sent()).toHaveLength(1);
    expect(result().textContent).toBe('');
  });
});

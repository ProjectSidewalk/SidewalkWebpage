/**
 * Tests for the admin team page (#5381): what the member table shows, how the totals read, and that the roster
 * controls call the endpoints the server actually exposes.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { metricDistanceUtil } from './fakes.js';
import { flush, routeFetch, sentRequests, textOf } from './support/routeFetch.js';

useUtil(metricDistanceUtil);

// Removing a member asks first; the dialog itself is not under test, so it answers yes without a DOM.
const ConfirmDialog = { confirm: vi.fn(() => Promise.resolve(true)) };
mockModule('frontend/js/common/ConfirmDialog.js', () => ({ ConfirmDialog }));

const { TeamPage } = await loadModules('frontend/js/admin-dashboard/TeamPage.js');

const TEAM_ID = 7;

const OVERVIEW = {
  team: { team_id: TEAM_ID, name: 'Ms. Frizzle’s class', description: '', open: true, visible: true },
  members: [
    { user_id: 'u1', username: 'ada', role: 'Registered', labels: 40, validations: 12, distance_meters: 2500,
      labels_validated: 20, labels_agreed: 19, last_active: '2026-09-10T12:00:00Z', high_quality: true,
      excluded: false },
    { user_id: 'u2', username: 'bo', role: 'Registered', labels: 5, validations: 0, distance_meters: 0,
      labels_validated: 0, labels_agreed: 0, last_active: null, high_quality: false, excluded: true },
  ],
  totals: { members: 2, labels: 45, validations: 12, distance_meters: 2500, labels_validated: 20, labels_agreed: 19 },
};

/**
 * @returns {Promise<{page: object, calls: Array<{url: string, method: string}>}>} The started page and a log of every
 *          request it made, so a test can assert on what it asked the server to do.
 */
async function load() {
  document.body.innerHTML = `
    <div id="team-status"></div>
    <span id="kpi-team-members"></span><span id="kpi-team-labels"></span>
    <span id="kpi-team-validations"></span><span id="kpi-team-distance"></span>
    <span id="kpi-team-accuracy"></span><span id="kpi-team-accuracy-note"></span>
    <button id="team-status-toggle" data-on="true">Open</button>
    <button id="team-visibility-toggle" data-on="true">Visible</button>
    <div id="team-members"></div>
    <input type="search" id="team-add-search">
    <div id="team-add-results"></div>`;

  const calls = [];
  window.fetch = vi.fn((url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET' });
    if (url.startsWith('/adminapi/team')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(OVERVIEW) });
    }
    if (url.startsWith('/adminapi/userSearch')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([
        { user_id: 'u3', username: 'cyd', email: 'cyd@example.org', role: 'Registered', team: 'Другая команда' },
        { user_id: 'u1', username: 'ada', email: 'ada@example.org', role: 'Registered', team: 'Ms. Frizzle’s class' },
      ]) });
    }
    return Promise.resolve({ ok: true, text: () => Promise.resolve('{}') });
  });
  ConfirmDialog.confirm = vi.fn(() => Promise.resolve(true));

  const page = new TeamPage(TEAM_ID, {
    overviewUrl: '/adminapi/team',
    userSearchUrl: '/adminapi/userSearch',
    setTeamUrl: '/userapi/setUserTeam',
    leaveTeamUrl: '/userapi/leaveTeam',
    teamStatusUrl: '/adminapi/updateTeamStatus',
    teamVisibilityUrl: '/adminapi/updateTeamVisibility',
  });
  await page.init();
  return { page, calls };
}

/**
 * Types into the add-member box and waits out the search debounce and the response.
 *
 * @param {string} query - What to type.
 */
async function search(query) {
  const input = document.getElementById('team-add-search');
  input.value = query;
  input.dispatchEvent(new Event('input'));
  await new Promise((resolve) => setTimeout(resolve, 300));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** @returns {Array<Array<string>>} The member table's rows, each as its cells' text. */
const rows = () => Array.from(document.querySelectorAll('#team-members tbody tr'))
  .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim()));

describe('the member table', () => {
  test('lists members with their counts, accuracy, and quality', async () => {
    await load();
    const [ada, bo] = rows();
    expect(ada[0]).toBe('ada');
    expect(ada[2]).toBe('40');
    expect(ada[3]).toBe('12');
    expect(ada[4]).toBe('2.5 km');
    expect(ada[5]).toBe('95% of 20');
    expect(ada[7]).toBe('High');
    // Nobody has judged bo's labels, so there is no rate to report -- not a 0%.
    expect(bo[5]).toBe('—');
    expect(bo[6]).toBe('—');
    expect(bo[7]).toContain('excluded');
  });

  test('starts sorted by labels, most first, and re-sorts on a header click', async () => {
    await load();
    expect(rows().map((r) => r[0])).toEqual(['ada', 'bo']);
    document.querySelector('.mgmt-sort[data-key="username"]').click();
    expect(rows().map((r) => r[0])).toEqual(['ada', 'bo']);
    document.querySelector('.mgmt-sort[data-key="username"]').click();
    expect(rows().map((r) => r[0])).toEqual(['bo', 'ada']);
  });

  test('does not make the Remove column sortable', async () => {
    await load();
    expect(document.querySelector('.mgmt-sort[data-key="actions"]')).toBeNull();
    const headers = Array.from(document.querySelectorAll('#team-members thead th')).map((th) => th.textContent.trim());
    expect(headers[headers.length - 1]).toBe('Remove');
  });

  test('links each member to their admin profile', async () => {
    await load();
    expect(document.querySelector('#team-members a').getAttribute('href')).toBe('/admin/user/ada');
  });
});

describe('the team stats', () => {
  test('pool the members rather than averaging their rates', async () => {
    await load();
    expect(document.getElementById('kpi-team-members').textContent).toBe('2');
    expect(document.getElementById('kpi-team-labels').textContent).toBe('45');
    expect(document.getElementById('kpi-team-distance').textContent).toBe('2.5 km');
    expect(document.getElementById('kpi-team-accuracy').textContent).toBe('95%');
    expect(document.getElementById('kpi-team-accuracy-note').textContent).toBe('of 20 judged labels');
  });
});

describe('the roster controls', () => {
  test('remove asks first, then calls leaveTeam for that member and reloads', async () => {
    const { calls } = await load();
    document.querySelector('.team-remove[data-user-id="u1"]').click();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ConfirmDialog.confirm).toHaveBeenCalled();
    expect(calls.some((c) => c.url === '/userapi/leaveTeam?userId=u1' && c.method === 'PUT')).toBe(true);
    expect(calls.filter((c) => c.url.startsWith('/adminapi/team')).length).toBe(2);
  });

  test('add sends the member to this team', async () => {
    const { calls } = await load();
    await search('cyd');
    document.querySelector('.team-add[data-user-id="u3"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.some((c) => c.url === '/userapi/setUserTeam?userId=u3&teamId=7' && c.method === 'PUT')).toBe(true);
  });

  test('clearing the search box drops a response still in flight', async () => {
    await load();
    // Held open by hand, so the box is cleared while the request is genuinely outstanding.
    let release;
    window.fetch = vi.fn((url) => (url.startsWith('/adminapi/userSearch')
      ? new Promise((resolve) => {
          release = () => resolve({ ok: true, json: () => Promise.resolve([
            { user_id: 'u3', username: 'cyd', email: 'cyd@example.org', role: 'Registered', team: null },
          ]) });
        })
      : Promise.resolve({ ok: true, json: () => Promise.resolve(OVERVIEW) })));

    await search('cyd');
    expect(release).toBeInstanceOf(Function);
    await search('');
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.getElementById('team-add-results').innerHTML).toBe('');
  });

  test('a search result already on this team offers no Add button', async () => {
    await load();
    await search('a');
    expect(document.querySelector('.team-add[data-user-id="u1"]')).toBeNull();
    expect(document.querySelector('.team-add[data-user-id="u3"]')).not.toBeNull();
  });

  test('leaves the confirmation on the status line after the reload it triggers', async () => {
    await load();
    document.querySelector('.team-remove[data-user-id="u1"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const status = document.getElementById('team-status');
    expect(status.textContent).toBe('Removed ada from this team.');
    expect(status.classList.contains('ps-hidden')).toBe(false);
  });

  test('the status toggle flips the button and tells the server', async () => {
    const { calls } = await load();
    document.getElementById('team-status-toggle').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.some((c) => c.url === '/adminapi/updateTeamStatus/7' && c.method === 'PUT')).toBe(true);
    expect(document.getElementById('team-status-toggle').textContent).toBe('Closed');
  });
});

/** The view's header, stats, member table and search box, the team's toggles set as given. */
function buildDom({ open = true, visible = true } = {}) {
  document.body.innerHTML = `
    <button type="button" class="mgmt-toggle" id="team-status-toggle" data-on="${open}">
      ${open ? 'Open' : 'Closed'}</button>
    <button type="button" class="mgmt-toggle" id="team-visibility-toggle" data-on="${visible}">
      ${visible ? 'Visible' : 'Hidden'}</button>
    <div class="coverage-status" id="team-status" role="status" aria-live="polite">Loading team…</div>
    <span id="kpi-team-members">—</span><span id="kpi-team-labels">—</span>
    <span id="kpi-team-validations">—</span><span id="kpi-team-distance">—</span>
    <span id="kpi-team-accuracy">—</span><span id="kpi-team-accuracy-note"></span>
    <div class="ps-table-scroll"><div id="team-members"></div></div>
    <input type="search" id="team-add-search" class="ps-input mgmt-search">
    <div id="team-add-results"></div>`;
}

/**
 * Builds the view, answers fetch from `routes`, and starts the page.
 * @param {Record<string, any>} routes - See routeFetch; the overview defaults to OVERVIEW.
 * @param {object} [dom] - The header toggles' starting state.
 * @returns {Promise<{sent: Function}>} The log of requests made.
 */
async function start(routes = {}, dom = {}) {
  buildDom(dom);
  const stub = routeFetch({ '/adminapi/team/7': OVERVIEW, ...routes });
  const sent = () => sentRequests(stub);
  ConfirmDialog.confirm = vi.fn(() => Promise.resolve(true));
  await new TeamPage(TEAM_ID, {
    overviewUrl: '/adminapi/team',
    userSearchUrl: '/adminapi/userSearch',
    setTeamUrl: '/userapi/setUserTeam',
    leaveTeamUrl: '/userapi/leaveTeam',
    teamStatusUrl: '/adminapi/updateTeamStatus',
    teamVisibilityUrl: '/adminapi/updateTeamVisibility',
  }).init();
  return { sent };
}

const status = () => document.getElementById('team-status');
const results = () => document.getElementById('team-add-results');
const memberNames = () => rows().map((r) => r[0]);
const sortTeamBy = (key) => document.querySelector(`.mgmt-sort[data-key="${key}"]`).click();

/** One member row, as /adminapi/team writes it. */
function member(name, overrides = {}) {
  return {
    user_id: name, username: name, role: 'Registered', labels: 1, validations: 1, distance_meters: 100,
    labels_validated: 0, labels_agreed: 0, last_active: null, high_quality: false, excluded: false, ...overrides,
  };
}

describe('loading the team', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('an empty team invites adding members and reads its stats as zero', async () => {
    await start({ '/adminapi/team/7': { team: OVERVIEW.team, members: [], totals: {} } });
    expect(textOf(document.getElementById('team-members'))).toBe('Nobody is on this team yet. Add members below.');
    expect(document.getElementById('kpi-team-members').textContent).toBe('0');
    expect(document.getElementById('kpi-team-labels').textContent).toBe('0');
    expect(document.getElementById('kpi-team-validations').textContent).toBe('0');
    expect(document.getElementById('kpi-team-accuracy').textContent).toBe('—');
    expect(document.getElementById('kpi-team-accuracy-note').textContent).toBe('no labels judged yet');
    expect(status().classList.contains('ps-hidden')).toBe(true);
  });

  test('treats an empty reply as an empty team', async () => {
    await start({ '/adminapi/team/7': null });
    expect(textOf(document.getElementById('team-members'))).toBe('Nobody is on this team yet. Add members below.');
  });

  test('says so in red when the team does not load', async () => {
    await start({ '/adminapi/team/7': { status: 500 } });
    expect(status().textContent).toBe('Could not load this team. Please try again.');
    expect(status().classList.contains('error')).toBe(true);
  });

  test('asks for a reload when the page is missing a part it needs', async () => {
    buildDom();
    document.getElementById('team-add-search').remove();
    const stub = routeFetch({});
    await new TeamPage(TEAM_ID, { overviewUrl: '/adminapi/team' }).init();
    expect(status().textContent).toBe('This page did not load correctly. Please reload.');
    expect(stub).not.toHaveBeenCalled();
  });
});

describe('sorting members', () => {
  const MEMBERS = [
    member('cyd', { role: 'Researcher', labels: 5, validations: 0, distance_meters: 0, labels_validated: 10,
      labels_agreed: 5, last_active: '2026-01-01T00:00:00Z', high_quality: true }),
    member('ada', { role: null, labels: 0, validations: 7, distance_meters: 900, labels_validated: 4,
      labels_agreed: 4 }),
    member('Bo', { labels: 5, validations: null, distance_meters: null, last_active: '2026-02-01T00:00:00Z' }),
  ];
  const load3 = () => start({ '/adminapi/team/7': { ...OVERVIEW, members: MEMBERS } });

  test('breaks a tie on the opening labels column by name', async () => {
    await load3();
    expect(memberNames()).toEqual(['Bo', 'cyd', 'ada']);
  });

  test('sorts by each column, text A to Z and numbers biggest first', async () => {
    await load3();
    const orders = {};
    for (const key of ['role', 'validations', 'distance_meters', 'accuracy', 'last_active', 'high_quality']) {
      sortTeamBy(key);
      orders[key] = memberNames();
    }
    expect(orders).toEqual({
      role: ['ada', 'Bo', 'cyd'],
      validations: ['ada', 'Bo', 'cyd'],
      distance_meters: ['ada', 'Bo', 'cyd'],
      // A member nobody has judged sorts below everyone who has been.
      accuracy: ['ada', 'cyd', 'Bo'],
      last_active: ['Bo', 'cyd', 'ada'],
      high_quality: ['cyd', 'ada', 'Bo'],
    });
  });

  test('a second click on the opening column puts the fewest labels first', async () => {
    await load3();
    sortTeamBy('labels');
    expect(memberNames()).toEqual(['ada', 'Bo', 'cyd']);
    const th = document.querySelector('.mgmt-sort[data-key="labels"]').closest('th');
    expect(th.getAttribute('aria-sort')).toBe('ascending');
  });

  test('ignores a click in the table that is not on a header or button', async () => {
    const { sent } = await load3();
    document.querySelector('#team-members tbody td').click();
    await flush();
    expect(memberNames()).toEqual(['Bo', 'cyd', 'ada']);
    expect(sent()).toHaveLength(1);
  });
});

describe('removing a member', () => {
  test('does nothing when the admin cancels', async () => {
    const { sent } = await start();
    ConfirmDialog.confirm = vi.fn(() => Promise.resolve(false));
    document.querySelector('.team-remove[data-user-id="u1"]').click();
    await flush();
    expect(sent()).toHaveLength(1);
  });

  test('says why when the server refuses', async () => {
    await start({ 'PUT /userapi/leaveTeam': { status: 403, body: 'Not allowed' } });
    document.querySelector('.team-remove[data-user-id="u1"]').click();
    await flush();
    expect(status().textContent).toBe('Could not remove ada: Not allowed');
    expect(status().classList.contains('error')).toBe(true);
  });
});

describe('searching for members to add', () => {
  test('says when nobody matches, including an empty reply', async () => {
    await start({ '/adminapi/userSearch?query=zz': [], '/adminapi/userSearch?query=yy': null });
    await search('zz');
    expect(textOf(results())).toBe('No users match your search.');
    await search('yy');
    expect(textOf(results())).toBe('No users match your search.');
  });

  test('notes the team a match is on now, and nothing for one on no team', async () => {
    await start({ '/adminapi/userSearch': [
      { user_id: 'u3', username: 'cyd', email: null, role: 'Registered', team: 'Другая команда' },
      { user_id: 'u4', username: 'dee', email: 'dee@example.org', role: 'Registered', team: null },
    ] });
    await search('d');
    const [cyd, dee] = [...results().querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map(textOf));
    expect(cyd).toEqual(['cyd', '', 'Registered', 'on Другая команда', 'Add']);
    expect(dee).toEqual(['dee', 'dee@example.org', 'Registered', '', 'Add']);
  });

  test('says the search failed', async () => {
    await start({ '/adminapi/userSearch': { status: 500 } });
    await search('cyd');
    expect(textOf(results())).toBe('Search failed: Request failed (500): /adminapi/userSearch?query=cyd');
  });

  test('a failed search answered after a newer one does not replace its results', async () => {
    let failFirst;
    await start({
      '/adminapi/userSearch?query=old': () => new Promise((resolve) => { failFirst = () => resolve({ status: 500 }); }),
      '/adminapi/userSearch?query=new': [{ user_id: 'u4', username: 'dee', role: 'Registered', team: null }],
    });
    await search('old');
    await search('new');
    failFirst();
    await flush();
    expect(textOf(results())).toContain('dee');
    expect(textOf(results())).not.toContain('failed');
  });
});

describe('adding a member', () => {
  const routes = (addAnswer = {}) => ({
    '/adminapi/userSearch': [
      { user_id: 'u3', username: 'cyd', email: 'cyd@example.org', role: 'Registered', team: 'Other team' },
      { user_id: 'u4', username: 'dee', email: 'dee@example.org', role: 'Registered', team: null },
    ],
    'PUT /userapi/setUserTeam': addAnswer,
  });

  test('warns that it moves someone off their current team, then adds them and searches again', async () => {
    const { sent } = await start(routes());
    await search('d');
    document.querySelector('.team-add[data-user-id="u3"]').click();
    await flush();
    expect(ConfirmDialog.confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: 'cyd is on Other team. Adding them here removes them from that team.',
    }));
    expect(sent().slice(-3).map((r) => `${r.method} ${r.url}`)).toEqual([
      'PUT /userapi/setUserTeam?userId=u3&teamId=7', 'GET /adminapi/team/7', 'GET /adminapi/userSearch?query=d',
    ]);
    expect(status().textContent).toBe('Added cyd to this team.');
  });

  test('adds someone on no team without asking', async () => {
    const { sent } = await start(routes());
    await search('d');
    document.querySelector('.team-add[data-user-id="u4"]').click();
    await flush();
    expect(ConfirmDialog.confirm).not.toHaveBeenCalled();
    expect(sent().some((r) => r.url === '/userapi/setUserTeam?userId=u4&teamId=7')).toBe(true);
  });

  test('leaves someone where they are when the admin cancels the move', async () => {
    const { sent } = await start(routes());
    await search('d');
    ConfirmDialog.confirm = vi.fn(() => Promise.resolve(false));
    document.querySelector('.team-add[data-user-id="u3"]').click();
    await flush();
    expect(sent().some((r) => r.method === 'PUT')).toBe(false);
  });

  test('says why when the server refuses', async () => {
    await start(routes({ status: 409, body: 'Team is closed' }));
    await search('d');
    document.querySelector('.team-add[data-user-id="u4"]').click();
    await flush();
    expect(status().textContent).toBe('Could not add dee: Team is closed');
  });

  test('ignores a click in the results that is not on an Add button', async () => {
    const { sent } = await start(routes());
    await search('d');
    results().querySelector('td').click();
    await flush();
    expect(sent().some((r) => r.method === 'PUT')).toBe(false);
  });
});

describe('the header toggles', () => {
  test('opening a closed team and showing a hidden one say so', async () => {
    const { sent } = await start({ 'PUT /adminapi/updateTeam': {} }, { open: false, visible: false });
    document.getElementById('team-status-toggle').click();
    await flush();
    expect(document.getElementById('team-status-toggle').textContent).toBe('Open');
    expect(status().textContent).toBe('Team open → Open.');
    document.getElementById('team-visibility-toggle').click();
    await flush();
    expect(sent().at(-1)).toEqual({ method: 'PUT', url: '/adminapi/updateTeamVisibility/7', body: { visible: true } });
    expect(document.getElementById('team-visibility-toggle').getAttribute('aria-pressed')).toBe('true');
    expect(status().textContent).toBe('Team visible → Visible.');
  });

  test('leaves the button alone and says why when the change fails', async () => {
    await start({ 'PUT /adminapi/updateTeam': { status: 500, body: 'db down' } });
    document.getElementById('team-status-toggle').click();
    await flush();
    expect(textOf(document.getElementById('team-status-toggle'))).toBe('Open');
    expect(status().textContent).toBe('Could not update team: db down');
  });
});

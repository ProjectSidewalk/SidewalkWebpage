/**
 * Tests for the admin team page (#5381): what the member table shows, how the totals read, and that the roster
 * controls call the endpoints the server actually exposes.
 *
 * Runs under jsdom (jest.config.js). TeamPage and AdminShell are bare top-level classes loaded by <script> tags, so
 * they are eval'd into global scope rather than required.
 */

const fs = require('fs');
const path = require('path');
const { loadGlobalScript } = require('./loadGlobalScript');

// The page fetches through util.fetchJson.
loadGlobalScript('public/js/common/utilities.js');

const src = (rel) => fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');

let TeamPage;

beforeAll(() => {
  global.AdminShell = (0, eval)(`${src('public/js/admin-dashboard/AdminShell.js')}\nAdminShell;`);
  TeamPage = (0, eval)(`${src('public/js/admin-dashboard/TeamPage.js')}\nTeamPage;`);
});

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
  global.fetch = jest.fn((url, opts = {}) => {
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
  global.ConfirmDialog = { confirm: jest.fn(() => Promise.resolve(true)) };

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
    expect(global.ConfirmDialog.confirm).toHaveBeenCalled();
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
    global.fetch = jest.fn((url) => (url.startsWith('/adminapi/userSearch')
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

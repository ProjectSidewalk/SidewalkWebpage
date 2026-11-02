/** Tests for the Manage user page's Save button, its by-date task flags, and its comment timestamps (#5840). */

import { loadModules, mockModule } from './loader.js';
import { navigationAttempts } from './fakes.js';
import { flush, routeFetch } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { language: 'en' } }));
const ConfirmDialog = { confirm: vi.fn() };
mockModule('frontend/js/common/ConfirmDialog.js', () => ({ ConfirmDialog }));

const { AdminUser } = await loadModules('frontend/js/user-dashboard/AdminUser.js');

const URLS = { saveUrl: '/adminapi/saveUserSettings', flagsUrl: '/adminapi/setTaskFlagsBeforeDate',
  hoursUrl: '/adminapi/users/u1/crossCityHours' };

const HOURS = { total_hours: 2, cities: [], show_breakdown: false, unreachable_cities: 0 };

/**
 * The account form, stats strip, flag blocks and comment table of manageUser.scala.html.
 * @param {object} [opts]
 * @param {string} [opts.quality] - The quality dropdown's starting value.
 * @param {boolean} [opts.excluded] - Whether the user starts excluded.
 * @param {string} [opts.infra3d] - 'on', 'off' (shown but the admin can't grant it), or 'none' (not this deployment).
 */
function buildDom({ quality = 'auto', excluded = false, infra3d = 'none' } = {}) {
  const infra = infra3d === 'none' ? ''
    : `<input type="checkbox" id="au-infra3d-access" checked ${infra3d === 'off' ? 'disabled' : ''}>`;
  document.body.innerHTML = `
    <input id="au-username" type="text" value="  mapper  ">
    <select id="au-role"><option value="Registered" selected>Registered</option><option value="Turker">Turker</option>
    </select>
    <select id="au-team"><option value="">No team</option><option value="12">Ms. Frizzle's class</option></select>
    <select id="au-quality" ${excluded ? 'disabled' : ''}>
      <option value="auto">Automatic</option><option value="true">High quality</option>
      <option value="false">Low quality</option>
    </select>
    <input type="checkbox" id="au-excluded" ${excluded ? 'checked' : ''}>
    <input type="checkbox" id="au-community-service">
    <input type="checkbox" id="au-on-leaderboard" checked>
    <input type="checkbox" id="au-public-profile">
    ${infra}
    <button type="button" id="au-save-btn">Save</button>
    <span class="ud-save-status" id="au-save-status"></span>
    <span class="ps-kpi-value" id="au-high-quality">${excluded ? 'Excluded' : 'Low'}</span>
    ${['low_quality', 'incomplete'].map((flag) => `
      <div class="ud-form ud-admin-flag" data-flag="${flag}">
        <input class="ud-admin-flag-date" id="au-date-${flag}" type="date">
        <button type="button" class="ud-admin-flag-set">Set flags</button>
        <button type="button" class="ud-admin-flag-remove">Remove flags</button>
        <span class="ud-save-status ud-admin-flag-status"></span>
      </div>`).join('')}
    <time class="ud-admin-ts" id="ts-good" datetime="2026-08-20T03:00:00Z">2026-08-20 03:00</time>
    <time class="ud-admin-ts" id="ts-bad" datetime="">unknown</time>`;
  document.getElementById('au-quality').value = quality;
}

/**
 * Builds the page and its controller against stubbed endpoints.
 * @param {object} [answers] - What the save and flag endpoints answer; each may be a body, `{ status, body }`, an
 *   Error, or a function of the URL.
 * @param {object} [dom] - Options for `buildDom`.
 * @returns {import('vitest').Mock} The fetch stub.
 */
function load(answers = {}, dom = {}) {
  buildDom(dom);
  const stub = routeFetch({
    [URLS.saveUrl]: answers.save ?? { success: true, high_quality: true, excluded: false, username: 'mapper' },
    [URLS.flagsUrl]: answers.flags ?? { tasks_updated: 3 },
    [URLS.hoursUrl]: HOURS,
  });
  new AdminUser({ userId: 'u1', username: 'mapper', ...URLS, pageUrlFor: (u) => `/admin/user/${u}/manage` });
  return stub;
}

/** @returns {Array<object>} The parsed bodies of every request sent to the given endpoint. */
const sent = (stub, url) => stub.mock.calls.filter(([u]) => u === url).map(([, opts]) => ({
  method: opts.method, body: JSON.parse(opts.body),
}));

const saveStatus = () => document.getElementById('au-save-status');

/** Clicks Save and waits for the request and its answer. */
async function save() {
  document.getElementById('au-save-btn').click();
  await flush();
}

beforeEach(() => {
  ConfirmDialog.confirm = vi.fn(() => Promise.resolve(true));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('saving the account settings', () => {
  test('sends the whole form in one PUT, with "Automatic" quality and no team as nulls', async () => {
    const stub = load();
    await save();
    expect(sent(stub, URLS.saveUrl)).toEqual([{ method: 'PUT', body: {
      user_id: 'u1', username: 'mapper', role: 'Registered', team_id: null, high_quality_manual: null,
      excluded: false, community_service: false, on_leaderboard: true, public_profile: false,
    } }]);
  });

  test('sends a chosen team as a number and a chosen quality as true or false', async () => {
    const stub = load({}, { quality: 'false' });
    document.getElementById('au-team').value = '12';
    await save();
    document.getElementById('au-quality').value = 'true';
    await save();
    const [low, high] = sent(stub, URLS.saveUrl).map((r) => r.body);
    expect([low.team_id, low.high_quality_manual, high.high_quality_manual]).toEqual([12, false, true]);
  });

  test('sends the infra3D access box only where the admin may grant it', async () => {
    let stub = load({}, { infra3d: 'on' });
    await save();
    expect(sent(stub, URLS.saveUrl)[0].body.infra3d_access).toBe(true);
    stub = load({}, { infra3d: 'off' });
    await save();
    expect(sent(stub, URLS.saveUrl)[0].body).not.toHaveProperty('infra3d_access');
  });

  test('disables Save and says it is saving while the request is out', async () => {
    buildDom();
    let finish;
    vi.stubGlobal('fetch', vi.fn((url) => (url === URLS.saveUrl
      ? new Promise((resolve) => { finish = resolve; })
      : Promise.resolve({ ok: true, json: async () => HOURS }))));
    new AdminUser({ userId: 'u1', username: 'mapper', ...URLS, pageUrlFor: (u) => u });
    document.getElementById('au-save-btn').click();
    await flush();
    expect(document.getElementById('au-save-btn').disabled).toBe(true);
    expect(saveStatus().textContent).toBe('Saving…');
    expect(saveStatus().className).toBe('ud-save-status');
    finish({ ok: true, json: async () => ({ success: true }) });
    await flush();
    expect(document.getElementById('au-save-btn').disabled).toBe(false);
  });

  test('confirms success and shows the quality the server worked out', async () => {
    load();
    await save();
    expect(saveStatus().textContent).toBe('Saved ✓');
    expect(saveStatus().classList.contains('ud-save-ok')).toBe(true);
    expect(document.getElementById('au-high-quality').textContent).toBe('High');
    load({ save: { success: true, high_quality: false, excluded: false, username: 'mapper' } });
    await save();
    expect(document.getElementById('au-high-quality').textContent).toBe('Low');
  });

  test('leaves the quality alone when the server does not say what it is', async () => {
    load({ save: { success: true } });
    await save();
    expect(saveStatus().textContent).toBe('Saved ✓');
    expect(document.getElementById('au-high-quality').textContent).toBe('Low');
  });

  test('moves to the new address after a rename instead of reporting success', async () => {
    const navigations = navigationAttempts();
    load({ save: { success: true, high_quality: true, excluded: false, username: 'cartographer' } });
    await save();
    expect(navigations).toHaveBeenCalledTimes(1);
    expect(saveStatus().textContent).toBe('Saving…');
  });

  test('shows the server\'s reason when it refuses the save', async () => {
    load({ save: { status: 400, body: { success: false, error: 'That username is taken.' } } });
    await save();
    expect(saveStatus().textContent).toBe('That username is taken.');
    expect(saveStatus().classList.contains('ud-save-err')).toBe(true);
    expect(document.getElementById('au-save-btn').disabled).toBe(false);
  });

  test('says the save failed when the refusal gives no reason, or the request fails outright', async () => {
    load({ save: { status: 500 } });
    await save();
    expect(saveStatus().textContent).toBe('Save failed.');
    load({ save: new Error('offline') });
    await save();
    expect(saveStatus().textContent).toBe('Save failed.');
    expect(saveStatus().classList.contains('ud-save-err')).toBe(true);
    expect(console.error).toHaveBeenCalledWith('Failed to save user settings', expect.any(Error));
  });
});

describe('excluding a user', () => {
  /** Checks the Excluded box as a click would. */
  const checkExcluded = () => {
    const box = document.getElementById('au-excluded');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
  };

  test('asks first, and saves nothing when the admin backs out', async () => {
    const stub = load();
    ConfirmDialog.confirm = vi.fn(() => Promise.resolve(false));
    checkExcluded();
    await save();
    expect(ConfirmDialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Exclude mapper?',
      confirmText: 'Exclude user', danger: true }));
    expect(sent(stub, URLS.saveUrl)).toEqual([]);
  });

  test('saves once confirmed, shows the user as excluded, and does not ask again', async () => {
    const stub = load({ save: { success: true, high_quality: false, excluded: true, username: 'mapper' } });
    checkExcluded();
    await save();
    expect(sent(stub, URLS.saveUrl)[0].body).toMatchObject({ excluded: true, high_quality_manual: false });
    expect(document.getElementById('au-high-quality').textContent).toBe('Excluded');
    await save();
    expect(ConfirmDialog.confirm).toHaveBeenCalledTimes(1);
    expect(sent(stub, URLS.saveUrl)).toHaveLength(2);
  });

  test('keeps low quality after a saved exclusion is unchecked, rather than restoring the earlier choice', async () => {
    load({ save: { success: true, high_quality: false, excluded: true, username: 'mapper' } }, { quality: 'true' });
    checkExcluded();
    await save();
    const box = document.getElementById('au-excluded');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(document.getElementById('au-quality').value).toBe('false');
  });

  test('does not ask again about a user who was already excluded', async () => {
    const stub = load({}, { excluded: true });
    await save();
    expect(ConfirmDialog.confirm).not.toHaveBeenCalled();
    expect(sent(stub, URLS.saveUrl)).toHaveLength(1);
  });
});

describe('flagging work by date', () => {
  /**
   * Picks a date in one flag block and clicks one of its buttons.
   * @param {string} flag - 'low_quality' or 'incomplete'.
   * @param {string} date - The date input's value.
   * @param {boolean} set - True for Set flags, false for Remove flags.
   * @returns {HTMLElement} The block.
   */
  const flagBlock = (flag, date, set) => {
    const block = document.querySelector(`.ud-admin-flag[data-flag="${flag}"]`);
    block.querySelector('.ud-admin-flag-date').value = date;
    block.querySelector(set ? '.ud-admin-flag-set' : '.ud-admin-flag-remove').click();
    return block;
  };
  const statusOf = (block) => block.querySelector('.ud-admin-flag-status');
  const SEPT_1 = new Date(2026, 8, 1);

  test('asks for a date before doing anything', async () => {
    const stub = load();
    const block = flagBlock('low_quality', '', true);
    await flush();
    expect(statusOf(block).textContent).toBe('Choose a date first.');
    expect(statusOf(block).classList.contains('ud-save-err')).toBe(true);
    expect(sent(stub, URLS.flagsUrl)).toEqual([]);
  });

  test('sets the flag on tasks before local midnight on the chosen date, and says how many', async () => {
    const stub = load();
    const block = flagBlock('low_quality', '2026-09-01', true);
    expect(Array.from(block.querySelectorAll('button')).every((b) => b.disabled)).toBe(true);
    expect(statusOf(block).textContent).toBe('Updating…');
    await flush();
    expect(sent(stub, URLS.flagsUrl)).toEqual([{ method: 'PUT', body: { user_id: 'u1', date: SEPT_1.toISOString(),
      flag: 'low_quality', state: true } }]);
    expect(statusOf(block).textContent).toBe(`Flagged 3 tasks before ${SEPT_1.toLocaleDateString()}.`);
    expect(statusOf(block).classList.contains('ud-save-ok')).toBe(true);
    expect(Array.from(block.querySelectorAll('button')).some((b) => b.disabled)).toBe(false);
  });

  test('clears the flag, and counts a single task in the singular', async () => {
    const stub = load({ flags: { tasks_updated: 1 } });
    const block = flagBlock('incomplete', '2026-09-01', false);
    await flush();
    expect(sent(stub, URLS.flagsUrl)[0].body).toMatchObject({ flag: 'incomplete', state: false });
    expect(statusOf(block).textContent).toBe(`Cleared the flag on 1 task before ${SEPT_1.toLocaleDateString()}.`);
  });

  test('reads an answer with no count as zero tasks', async () => {
    load({ flags: { status: 200 } });
    const block = flagBlock('incomplete', '2026-09-01', true);
    await flush();
    expect(statusOf(block).textContent).toBe(`Flagged 0 tasks before ${SEPT_1.toLocaleDateString()}.`);
  });

  test('says the flags did not change when the server refuses', async () => {
    load({ flags: { status: 400, body: { status: 'Error' } } });
    const block = flagBlock('low_quality', '2026-09-01', true);
    await flush();
    expect(statusOf(block).textContent).toBe('Flags failed to change.');
    expect(statusOf(block).classList.contains('ud-save-err')).toBe(true);
    expect(Array.from(block.querySelectorAll('button')).some((b) => b.disabled)).toBe(false);
  });
});

describe('comment timestamps', () => {
  test('show in the reader\'s zone, and an unreadable one is left as the server wrote it', () => {
    load();
    // Pacific time, where 03:00 UTC is the evening before.
    expect(document.getElementById('ts-good').textContent).toBe('Aug 19, 2026, 8:00 PM');
    expect(document.getElementById('ts-bad').textContent).toBe('unknown');
  });
});

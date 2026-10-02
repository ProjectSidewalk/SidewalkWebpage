/**
 * Tests for the Imagery page's "Imagery sources" panel (#5407): the list of Mapillary creators a deployment favours,
 * the add / remove controls that edit it, and the Prefer / Restrict choice of how they are used.
 *
 * What matters is that the panel never misstates which state the deployment is in. An empty list has to read as
 * "unfiltered" in words rather than as a blank, the status has to say whether listed creators are preferred or
 * exclusive, a failed load must not leave a stale list on screen, a refused add has to say why in the server's words
 * (a typo'd username is the expected mistake), removing the last creator has to say what it reopens before it
 * happens, and the radios must never show a mode the server didn't take.
 */

const fs = require('fs');
const path = require('path');

const JS_DIR = path.resolve(__dirname, '..', '..', 'public/js/admin-dashboard');

/** Loads AdminShell + the panel into global scope. */
function loadPanel() {
  const shell = fs.readFileSync(path.join(JS_DIR, 'AdminShell.js'), 'utf8');
  const panel = fs.readFileSync(path.join(JS_DIR, 'MapillarySourcesPanel.js'), 'utf8');
  return (0, eval)(`${shell}\nglobalThis.AdminShell = AdminShell;\n${panel}\nMapillarySourcesPanel;`);
}

const MapillarySourcesPanel = loadPanel();

const MARKUP = `
  <fieldset>
    <input type="radio" name="imagery-sources-mode" value="prefer">
    <input type="radio" name="imagery-sources-mode" value="restrict">
  </fieldset>
  <div id="imagery-sources-status"></div>
  <div id="imagery-sources-list"></div>
  <form id="imagery-sources-form">
    <input type="text" id="imagery-sources-username">
    <button type="submit">Add creator</button>
  </form>
  <p id="imagery-sources-error" hidden></p>`;

const source = (username, addedBy = 'jon') => ({
  source_type: 'creator', source_value: username, added_by: addedBy, added_at: '2026-09-18T17:00:00Z',
});

/** A fetch Response stand-in. */
const reply = (body, ok = true, status = 200) => ({
  ok, status, statusText: ok ? 'OK' : 'Error', json: () => Promise.resolve(body),
});

/** Lets the panel's chained awaits settle. */
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

/**
 * Renders the panel over a server that holds `sources` and applies adds/removes to it, so a reload after an edit shows
 * what a real server would.
 *
 * @param {Array<object>} sources - The server's starting list.
 * @param {object} [overrides] - Per-method responders `(url, options) => Response`, to fail a call.
 * @param {string} [mode] - The server's starting mode.
 * @returns {Promise<Array<{url: string, method: string, body: any}>>} The recorded requests.
 */
async function renderPanel(sources, overrides = {}, mode = 'prefer') {
  document.body.innerHTML = MARKUP;
  const requests = [];
  let serverMode = mode;
  global.fetch = jest.fn((url, options = {}) => {
    const method = options.method || 'GET';
    requests.push({ url, method, body: options.body ? JSON.parse(options.body) : undefined });
    if (overrides[method]) return Promise.resolve(overrides[method](url, options));
    if (method === 'POST') sources.push(source(JSON.parse(options.body).username));
    if (method === 'PUT') serverMode = JSON.parse(options.body).mode;
    if (method === 'DELETE') {
      const username = decodeURIComponent(url.split('/').pop());
      sources.splice(sources.findIndex((s) => s.source_value === username), 1);
    }
    return Promise.resolve(reply(method === 'GET' ? { provider: 'mapillary', mode: serverMode, sources: [...sources] }
      : { status: 'success', added: 1 }));
  });
  await new MapillarySourcesPanel({ sourcesUrl: '/adminapi/mapillarySources' }).init();
  return requests;
}

const status = () => document.getElementById('imagery-sources-status').textContent;
const error = () => document.getElementById('imagery-sources-error');
const checkedMode = () => document.querySelector('input[name="imagery-sources-mode"]:checked')?.value;
const listedCreators = () => [...document.querySelectorAll('tr[data-username]')].map((row) => row.dataset.username);

/** The message the confirmation dialog was opened with. */
const confirmMessage = () => globalThis.ConfirmDialog.confirm.mock.calls[0][0].message;

/** Types a username and submits the form. */
async function add(username) {
  document.getElementById('imagery-sources-username').value = username;
  document.getElementById('imagery-sources-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  globalThis.ConfirmDialog = { confirm: jest.fn(() => Promise.resolve(true)) };
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

test('is a no-op on a deployment whose page carries no panel', async () => {
  document.body.innerHTML = '';
  global.fetch = jest.fn();
  await new MapillarySourcesPanel({ sourcesUrl: '/adminapi/mapillarySources' }).init();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('an empty list reads as unfiltered, in words', async () => {
  await renderPanel([]);
  expect(status()).toMatch(/^Unfiltered/);
  expect(listedCreators()).toEqual([]);
});

test('lists the creators, who added each, and links their Mapillary profile', async () => {
  await renderPanel([source('profjfray'), source('handmade', null)]);
  expect(status()).toBe('Preferring imagery from 2 creators; everyone\'s imagery is used where theirs isn\'t nearby.');
  expect(listedCreators()).toEqual(['profjfray', 'handmade']);
  const link = document.querySelector('tr[data-username="profjfray"] a');
  expect(link.href).toBe('https://www.mapillary.com/app/user/profjfray');
  expect(link.rel).toContain('noopener');
  // When it was added reads as a date and time, keeping the exact instant for assistive tech and copy-paste.
  const added = document.querySelector('tr[data-username="profjfray"] time');
  expect(added.getAttribute('datetime')).toBe('2026-09-18T17:00:00Z');
  expect(added.textContent).toBe(globalThis.AdminShell.dateTime('2026-09-18T17:00:00Z'));
  expect(added.textContent).toMatch(/2026/);
  // A source added by hand in SQL has no admin behind it, and says so rather than showing a blank.
  expect(document.querySelector('tr[data-username="handmade"]').textContent).toContain('not recorded');
});

test('escapes a username rather than rendering it', async () => {
  await renderPanel([source('<img src=x onerror=alert(1)>')]);
  expect(document.querySelector('#imagery-sources-list img')).toBeNull();
});

test('a failed load clears the list and says so, rather than leaving it looking current', async () => {
  await renderPanel([source('profjfray')], { GET: () => reply({ message: 'boom' }, false, 500) });
  expect(listedCreators()).toEqual([]);
  expect(status()).toBe('Could not load the imagery sources: boom');
});

test('adding posts the trimmed username, reloads, and clears the field', async () => {
  const requests = await renderPanel([]);
  await add('  profjfray ');
  expect(requests.find((r) => r.method === 'POST')).toEqual({
    url: '/adminapi/mapillarySources/creators', method: 'POST', body: { username: 'profjfray' },
  });
  expect(listedCreators()).toEqual(['profjfray']);
  expect(status()).toMatch(/^Preferring imagery from 1 creator;/);
  expect(document.getElementById('imagery-sources-username').value).toBe('');
  expect(error().hidden).toBe(true);
});

test('re-adding a listed creator warns without asking the server', async () => {
  const requests = await renderPanel([source('profjfray')]);
  await add(' profjfray ');
  expect(requests.some((r) => r.method === 'POST')).toBe(false);
  expect(error().hidden).toBe(false);
  expect(error().textContent).toBe('"profjfray" is already a listed creator, so nothing changed.');
  expect(document.getElementById('imagery-sources-username').value).toBe(' profjfray ');
  expect(listedCreators()).toEqual(['profjfray']);
});

test('warns when the server reports the creator was already listed, e.g. added meanwhile in another tab', async () => {
  const sources = [];
  await renderPanel(sources, {
    POST: () => {
      sources.push(source('profjfray', 'alice'));
      return reply({ status: 'success', username: 'profjfray', added: 0 });
    },
  });
  await add('profjfray');
  expect(error().textContent).toBe('"profjfray" is already a listed creator, so nothing changed.');
  expect(listedCreators()).toEqual(['profjfray']);
  expect(document.querySelector('button[type="submit"]').disabled).toBe(false);
});

test('re-adding a listed creator in different case warns without asking the server', async () => {
  const requests = await renderPanel([source('profjfray')]);
  await add('ProfJFray');
  expect(requests.some((r) => r.method === 'POST')).toBe(false);
  expect(error().textContent).toBe('"profjfray" is already a listed creator, so nothing changed.');
});

test('an already-listed warning names Mapillary\'s spelling, not what was typed', async () => {
  await renderPanel([], { POST: () => reply({ status: 'success', username: 'profjfray', added: 0 }) });
  await add('ProfJFray');
  expect(error().textContent).toBe('"profjfray" is already a listed creator, so nothing changed.');
});

test('a blank username is not sent', async () => {
  const requests = await renderPanel([]);
  await add('   ');
  expect(requests.some((r) => r.method === 'POST')).toBe(false);
});

test('a refused add shows the server\'s reason and keeps what was typed', async () => {
  const refusal = 'Mapillary has no 360° imagery under the username \'profjfrey\'.';
  await renderPanel([], { POST: () => reply({ status: 'Error', message: refusal }, false, 422) });
  await add('profjfrey');
  expect(error().hidden).toBe(false);
  expect(error().textContent).toBe(`Could not add "profjfrey": ${refusal}`);
  expect(document.getElementById('imagery-sources-username').value).toBe('profjfrey');
  expect(document.querySelector('button[type="submit"]').disabled).toBe(false);
});

test('a refusal with no JSON body falls back to the status line', async () => {
  await renderPanel([], {
    POST: () => ({ ok: false, status: 502, statusText: 'Bad Gateway', json: () => Promise.reject(new Error('html')) }),
  });
  await add('profjfray');
  expect(error().textContent).toBe('Could not add "profjfray": 502 Bad Gateway');
});

test('removing the last creator warns that the deployment becomes unfiltered', async () => {
  const requests = await renderPanel([source('profjfray')]);
  document.querySelector('button[data-action="remove"]').click();
  await flush();
  expect(confirmMessage()).toMatch(/only listed creator.*every Mapillary contributor/);
  expect(requests.find((r) => r.method === 'DELETE').url).toBe('/adminapi/mapillarySources/creators/profjfray');
  expect(status()).toMatch(/^Unfiltered/);
});

test('removing one of several says only that their imagery stops being favoured', async () => {
  await renderPanel([source('profjfray'), source('alice')]);
  document.querySelector('tr[data-username="alice"] button').click();
  await flush();
  expect(confirmMessage()).toBe('Remove alice? Explore will stop favouring their imagery.');
  expect(listedCreators()).toEqual(['profjfray']);
});

test('a cancelled removal sends nothing', async () => {
  globalThis.ConfirmDialog.confirm.mockResolvedValue(false);
  const requests = await renderPanel([source('profjfray')]);
  document.querySelector('button[data-action="remove"]').click();
  await flush();
  expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
  expect(listedCreators()).toEqual(['profjfray']);
});

test('a failed removal says so and leaves the creator listed with a usable button', async () => {
  await renderPanel([source('profjfray')], { DELETE: () => reply({ message: 'nope' }, false, 500) });
  const button = document.querySelector('button[data-action="remove"]');
  button.click();
  await flush();
  expect(error().textContent).toBe('Could not remove "profjfray": nope');
  expect(listedCreators()).toEqual(['profjfray']);
  expect(button.disabled).toBe(false);
});

describe('mode', () => {
  test('checks the server\'s mode and says what it means', async () => {
    await renderPanel([source('profjfray')], {}, 'restrict');
    expect(checkedMode()).toBe('restrict');
    expect(status()).toBe('Restricted to imagery from 1 creator.');
  });

  test('switching to Prefer sends it without asking, and the status follows', async () => {
    const requests = await renderPanel([source('profjfray')], {}, 'restrict');
    const prefer = document.querySelector('input[value="prefer"]');
    prefer.checked = true;
    prefer.dispatchEvent(new Event('change'));
    await flush();
    expect(globalThis.ConfirmDialog.confirm).not.toHaveBeenCalled();
    expect(requests.find((r) => r.method === 'PUT')).toEqual({
      url: '/adminapi/mapillarySources/mode', method: 'PUT', body: { mode: 'prefer' },
    });
    expect(checkedMode()).toBe('prefer');
    expect(status()).toMatch(/^Preferring/);
  });

  test('switching to Restrict confirms first, warning that streets stay open until a re-scan', async () => {
    const requests = await renderPanel([source('profjfray')]);
    const restrict = document.querySelector('input[value="restrict"]');
    restrict.checked = true;
    restrict.dispatchEvent(new Event('change'));
    await flush();
    expect(confirmMessage()).toMatch(/re-run/);
    expect(requests.find((r) => r.method === 'PUT').body).toEqual({ mode: 'restrict' });
    expect(status()).toMatch(/^Restricted/);
  });

  test('a cancelled switch to Restrict sends nothing and puts the radio back', async () => {
    globalThis.ConfirmDialog.confirm.mockResolvedValue(false);
    const requests = await renderPanel([source('profjfray')]);
    const restrict = document.querySelector('input[value="restrict"]');
    restrict.checked = true;
    restrict.dispatchEvent(new Event('change'));
    await flush();
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
    expect(checkedMode()).toBe('prefer');
  });

  test('a refused switch says so and puts the radio back', async () => {
    await renderPanel([source('profjfray')], { PUT: () => reply({ message: 'nope' }, false, 409) }, 'restrict');
    const prefer = document.querySelector('input[value="prefer"]');
    prefer.checked = true;
    prefer.dispatchEvent(new Event('change'));
    await flush();
    expect(error().textContent).toBe('Could not change how listed creators are used: nope');
    expect(checkedMode()).toBe('restrict');
  });
});

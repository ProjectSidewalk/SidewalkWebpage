/**
 * Tests the dashboard's "My Routes" rows (frontend/js/user-dashboard/MyRoutes.js, #3343): dates shown in the
 * reader's own timezone, the share link a copy hands out, renaming in place, and deleting with a confirmation. The
 * rows are server-rendered, so the fixture copies dashboard.scala.html's markup (#5840).
 */

import { loadModules, mockModule } from './loader.js';
import { flush, routeFetch, sentRequests } from './support/routeFetch.js';

mockModule('i18next', () => ({
  default: { language: 'en', t: (key, opts) => (opts?.name ? `${key} (${opts.name})` : key) },
}));

let confirmAnswer;
const confirmDialog = { confirm: vi.fn(async () => confirmAnswer) };
mockModule('frontend/js/common/ConfirmDialog.js', () => ({ ConfirmDialog: confirmDialog }));
const copyToClipboard = vi.fn();
mockModule('frontend/js/common/copyToClipboard.js', () => ({ copyToClipboard }));
const toast = { show: vi.fn() };
mockModule('frontend/js/common/Toast.js', () => ({ Toast: toast }));

const { MyRoutes } = await loadModules('frontend/js/user-dashboard/MyRoutes.js');

/**
 * One route row, as dashboard.scala.html renders it.
 * @param {number} id - The route id.
 * @param {string} name - The route's name.
 * @param {object} [opts]
 * @param {string} [opts.slug] - Its share slug; empty for a route that has none.
 * @param {string} [opts.savedAt] - The `datetime` the server stamped, an ISO instant in UTC.
 * @returns {string} The markup.
 */
const row = (id, name, { slug = `walk-${id}`, savedAt = '2026-03-04T03:30:00Z' } = {}) => `
  <li class="ud-route-row" data-route-id="${id}" data-slug="${slug}">
    <a class="ud-route-view" data-route-id="${id}" href="/routeBuilder?preview=${id}"></a>
    <div class="ud-route-info">
      <span class="ud-route-name">${name}</span>
      <span class="ud-route-meta"><time class="ud-route-date" datetime="${savedAt}">Mar 4, 2026</time></span>
    </div>
    <div class="ud-route-actions">
      <a class="ud-route-explore" data-route-id="${id}" href="/explore?routeId=${id}">Explore</a>
      <a class="ud-route-labelmap" data-route-id="${id}" href="/labelMap?routes=${id}">Label map</a>
      <button type="button" class="ud-route-copy" data-route-id="${id}">Copy link</button>
      <button type="button" class="ud-route-rename" data-route-id="${id}">Rename</button>
      <button type="button" class="ud-route-delete" data-route-id="${id}">Delete</button>
    </div>
  </li>`;

/**
 * Draws the routes section around the given rows and wires it, as the dashboard entry does.
 * @param {...string} rows - Row markup from `row`.
 */
function renderRoutes(...rows) {
  document.body.innerHTML = `
    <ul class="ud-routes" id="ud-routes-list" data-max-name-length="80">${rows.join('')}</ul>
    <div class="ud-nudge" id="ud-routes-empty" hidden>No routes yet.</div>
    <span id="ud-routes-status" role="status"></span>`;
  new MyRoutes(document.getElementById('ud-routes-list')).init();
}

const $ = (selector, root = document) => root.querySelector(selector);
/** @returns {HTMLElement} The row for a route. */
const rowFor = (id) => $(`.ud-route-row[data-route-id="${id}"]`);
const announced = () => $('#ud-routes-status').textContent;

beforeEach(() => {
  confirmAnswer = true;
  window.logWebpageActivity = vi.fn();
});

test('a route saved on a Tuesday evening in Seattle reads as Tuesday, not as the UTC Wednesday', () => {
  renderRoutes(row(1, 'Evening loop'), row(2, 'Undated', { savedAt: 'not a date' }));
  expect($('.ud-route-date', rowFor(1)).textContent).toBe('Mar 3, 2026');
  // A stamp the browser can't read keeps the server's own rendering.
  expect($('.ud-route-date', rowFor(2)).textContent).toBe('Mar 4, 2026');
});

test('Copy hands out the short /r/ link, or the routeId link for a route without a slug, and logs it', () => {
  renderRoutes(row(1, 'Loop'), row(2, 'Old route', { slug: '' }));
  $('.ud-route-copy', rowFor(1)).click();
  $('.ud-route-copy', rowFor(2)).click();
  expect(copyToClipboard.mock.calls.map(([, url]) => url))
    .toEqual(['http://localhost/r/walk-1', 'http://localhost/explore?routeId=2']);
  expect(copyToClipboard.mock.calls[0][0]).toBe($('.ud-route-copy', rowFor(1)));
  expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=RouteList_Copy_RouteId=1');
});

test('each link out of a row logs which one was followed', () => {
  renderRoutes(row(5, 'Loop'));
  // Followed links would navigate jsdom away; only the logging is under test.
  const stay = (e) => e.preventDefault();
  document.addEventListener('click', stay);
  $('.ud-route-explore').click();
  $('.ud-route-labelmap').click();
  $('.ud-route-view').click();
  document.removeEventListener('click', stay);
  expect(window.logWebpageActivity.mock.calls.map(([a]) => a)).toEqual([
    'Click_module=RouteList_Explore_RouteId=5',
    'Click_module=RouteList_LabelMap_RouteId=5',
    'Click_module=RouteList_View_RouteId=5',
  ]);
});

describe('renaming a route', () => {
  /**
   * Opens the rename box on a row and types a new name.
   * @param {number} id - The route.
   * @param {string} name - What to type.
   * @returns {HTMLInputElement} The rename box.
   */
  const startRename = (id, name) => {
    $('.ud-route-rename', rowFor(id)).click();
    const input = $('.ud-route-rename-input', rowFor(id));
    input.value = name;
    return input;
  };
  const press = (input, key) => input.dispatchEvent(new KeyboardEvent('keydown', { key }));

  test('opens a box holding the current name, capped at the server\'s length, and opens only once', () => {
    renderRoutes(row(1, 'Loop'));
    $('.ud-route-rename').click();
    $('.ud-route-rename').click();
    const input = $('.ud-route-rename-input');
    expect(document.querySelectorAll('.ud-route-rename-form')).toHaveLength(1);
    expect(input.value).toBe('Loop');
    expect(input.maxLength).toBe(80);
    expect(document.activeElement).toBe(input);
    expect($('.ud-route-name').hidden).toBe(true);
  });

  test('Save sends the trimmed name, then shows the server\'s, updates the share link, and announces it', async () => {
    renderRoutes(row(1, 'Loop'));
    const fetch = routeFetch({ 'PUT /userapi/routes/1': { name: 'Lake loop', slug: 'lake-loop' } });
    startRename(1, '  Lake loop ');
    $('.ud-route-rename-save').click();
    await flush();
    expect(sentRequests(fetch)).toEqual([{ method: 'PUT', url: '/userapi/routes/1', body: { name: 'Lake loop' } }]);
    expect($('.ud-route-name').textContent).toBe('Lake loop');
    expect($('.ud-route-name').hidden).toBe(false);
    expect($('.ud-route-rename-form')).toBeNull();
    expect(rowFor(1).dataset.slug).toBe('lake-loop');
    expect(announced()).toBe('dashboard:routes-renamed');
    expect(document.activeElement).toBe($('.ud-route-rename'));
    expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=RouteList_Rename_RouteId=1');
  });

  test('Enter saves too, and a reply without a slug keeps the old link', async () => {
    renderRoutes(row(1, 'Loop'));
    routeFetch({ 'PUT /userapi/routes/1': { name: 'Lake loop' } });
    press(startRename(1, 'Lake loop'), 'Enter');
    await flush();
    expect($('.ud-route-name').textContent).toBe('Lake loop');
    expect(rowFor(1).dataset.slug).toBe('walk-1');
  });

  test.each([
    ['Escape', (input) => press(input, 'Escape'), 'Lake loop'],
    ['Cancel', () => $('.ud-route-rename-cancel').click(), 'Lake loop'],
    ['Save with the name unchanged', () => $('.ud-route-rename-save').click(), 'Loop'],
    ['Save with the box emptied', () => $('.ud-route-rename-save').click(), '   '],
  ])('%s closes the box without sending anything', async (_, close, typed) => {
    renderRoutes(row(1, 'Loop'));
    const fetch = routeFetch({});
    const input = startRename(1, typed);
    press(input, 'a');
    expect($('.ud-route-rename-form')).not.toBeNull();
    close(input);
    await flush();
    expect($('.ud-route-rename-form')).toBeNull();
    expect($('.ud-route-name').textContent).toBe('Loop');
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    ['the server\'s own words, like a name the profanity guard caught', { message: 'Please choose another name.' },
      'Please choose another name.'],
    ['a generic error when the server gives no message', {}, 'dashboard:routes-error'],
  ])('a refused name shows %s and leaves the box open', async (_, body, shown) => {
    renderRoutes(row(1, 'Loop'));
    routeFetch({ 'PUT /userapi/routes/1': { status: 400, body } });
    startRename(1, 'Rude name');
    $('.ud-route-rename-save').click();
    await flush();
    expect(toast.show).toHaveBeenCalledWith({ message: shown, reference: $('.ud-route-rename') });
    expect($('.ud-route-rename-form')).not.toBeNull();
    expect($('.ud-route-name').textContent).toBe('Loop');
  });

  test('a rename that never reaches the server is logged and shows the generic error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderRoutes(row(1, 'Loop'));
    const failure = new TypeError('Failed to fetch');
    routeFetch({ 'PUT /userapi/routes/1': failure });
    startRename(1, 'Lake loop');
    $('.ud-route-rename-save').click();
    await flush();
    expect(error).toHaveBeenCalledWith('Route rename failed', failure);
    expect(toast.show).toHaveBeenCalledWith({ message: 'dashboard:routes-error', reference: $('.ud-route-rename') });
  });
});

describe('deleting a route', () => {
  /**
   * Clicks a row's Delete and lets the confirmation and request finish.
   * @param {number} id - The route.
   */
  const clickDelete = async (id) => {
    $('.ud-route-delete', rowFor(id)).click();
    await flush();
  };

  test('asks first, naming the route, and sends nothing if the user backs out', async () => {
    renderRoutes(row(1, 'Loop'));
    const fetch = routeFetch({});
    confirmAnswer = false;
    await clickDelete(1);
    expect(confirmDialog.confirm).toHaveBeenCalledWith({
      message: 'dashboard:routes-delete-confirm (Loop)',
      confirmText: 'common:delete',
      cancelText: 'common:cancel',
      danger: true,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(rowFor(1)).not.toBeNull();
  });

  test('removes the row and announces it, keeping the list while others remain', async () => {
    renderRoutes(row(1, 'Loop'), row(2, 'Hill'));
    const fetch = routeFetch({ 'DELETE /userapi/routes/1': {} });
    await clickDelete(1);
    expect(sentRequests(fetch)).toEqual([{ method: 'DELETE', url: '/userapi/routes/1', body: undefined }]);
    expect(rowFor(1)).toBeNull();
    expect(announced()).toBe('dashboard:routes-deleted (Loop)');
    expect($('#ud-routes-list').hidden).toBe(false);
    expect($('#ud-routes-empty').hidden).toBe(true);
    expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=RouteList_Delete_RouteId=1');
  });

  test('deleting the last route swaps the list for the empty-state nudge', async () => {
    renderRoutes(row(1, 'Loop'));
    routeFetch({ 'DELETE /userapi/routes/1': {} });
    await clickDelete(1);
    expect($('#ud-routes-list').hidden).toBe(true);
    expect($('#ud-routes-empty').hidden).toBe(false);
  });

  test('a route already gone (deleted in another tab) keeps its row and shows the generic error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderRoutes(row(1, 'Loop'));
    routeFetch({ 'DELETE /userapi/routes/1': { status: 404, body: {} } });
    await clickDelete(1);
    expect(error).toHaveBeenCalledWith('Route delete failed', expect.objectContaining({
      message: 'delete failed: 404',
    }));
    expect(toast.show).toHaveBeenCalledWith({ message: 'dashboard:routes-error', reference: $('.ud-route-delete') });
    expect(rowFor(1)).not.toBeNull();
  });
});

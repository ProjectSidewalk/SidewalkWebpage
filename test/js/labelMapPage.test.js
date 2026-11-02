/** Tests for the admin Label Map page: the map it asks for, its loading overlay, and its label-ID search (#5840). */

import { loadModules, mockModule } from './loader.js';
import { flush, textOf } from './support/routeFetch.js';

// The map, popup, overlay and filter sidebar each have suites of their own; here they record what the page asks.
let calls;
let popupResult;
let mapResult;
mockModule('frontend/js/common/label-detail/LabelPopup.js', () => ({
  LabelPopup: (...args) => { calls.popupArgs = args; return popupResult(); },
}));
mockModule('frontend/js/ps-map/createPSMap.js', () => ({
  createPSMap: (params) => { calls.mapParams = params; return mapResult(); },
}));
mockModule('frontend/js/ps-map/MapLoadingOverlay.js', () => ({
  MapLoadingOverlay: class {
    show() { calls.overlay.push('show'); }

    hide() { calls.overlay.push('hide'); }

    showError() { calls.overlay.push('error'); }
  },
}));
mockModule('frontend/js/ps-map/MapSidebarFilter.js', () => ({
  MapSidebarFilter: class { constructor(...args) { calls.sidebar = args; } },
}));
const { LabelMapPage } = await loadModules('frontend/js/admin-dashboard/LabelMapPage.js');

// The search form from app/views/admin/dashboard/labelMap.scala.html.
const MARKUP = `
  <form class="label-map-search" id="label-map-search">
    <input type="number" id="label-map-search-input">
    <button type="submit" id="label-map-search-btn">Open</button>
    <span class="label-map-search-msg dq-sub" id="label-map-search-msg" role="status"></span>
  </form>
  <div id="admin-labelmap-choropleth"></div>`;

const OPTS = { mapboxToken: 'pk.test', viewerType: function Viewer() {}, accessToken: 'tok', username: 'mikey' };

let popup;
let mapData;

/** @returns {Promise<void>} Resolves once the page has started. */
async function start(markup = MARKUP) {
  document.body.innerHTML = markup;
  await new LabelMapPage(OPTS).init();
}

/** Types a label ID into the search box and submits it. */
function search(value) {
  document.getElementById('label-map-search-input').value = value;
  document.getElementById('label-map-search').dispatchEvent(new Event('submit', { cancelable: true }));
}

const message = () => document.getElementById('label-map-search-msg');

beforeEach(() => {
  calls = { overlay: [] };
  popup = { showLabel: vi.fn() };
  mapData = { updateLabelType: vi.fn(), setLabelDeleted: vi.fn() };
  popupResult = () => Promise.resolve(popup);
  mapResult = () => Promise.resolve(['map', 1, 2, 3, mapData]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(window, 'open').mockImplementation(() => null);
});

describe('the map', () => {
  test('asks for every label in the city, with the admin popup wired in and an overlay while it loads', async () => {
    await start();
    expect(calls.popupArgs.slice(0, 4)).toEqual([true, OPTS.viewerType, 'tok', 'mikey']);
    expect(calls.mapParams).toMatchObject({
      mapName: 'admin-labelmap-choropleth', mapboxApiKey: 'pk.test', labelsURL: '/adminapi/labels/all',
      uiSource: 'AdminLabelMap', popupLabelViewer: popup, highQualityFilter: true,
    });

    calls.mapParams.onMapReady();
    expect(calls.overlay).toEqual(['hide', 'show']);
    expect(calls.sidebar).toEqual(['map', mapData, { highQualityFilter: true }]);
  });

  test('a label type or deletion changed from the popup updates the dot on the map', async () => {
    await start();
    const { onEdit, onDelete } = calls.popupArgs[4];
    onEdit({ label_id: 5, label_type: 'Obstacle' });
    onDelete({ label_id: 6, deleted: true });
    expect(mapData.updateLabelType).toHaveBeenCalledWith(5, 'Obstacle');
    expect(mapData.setLabelDeleted).toHaveBeenCalledWith(6, true);
  });

  test('popup edits before the map data has loaded are dropped rather than throwing', async () => {
    let finishMap;
    mapResult = () => new Promise((resolve) => { finishMap = resolve; });
    document.body.innerHTML = MARKUP;
    const done = new LabelMapPage(OPTS).init();
    await flush();
    const { onEdit, onDelete } = calls.popupArgs[4];
    expect(() => onEdit({ label_id: 5, label_type: 'Obstacle' })).not.toThrow();
    expect(() => onDelete({ label_id: 5, deleted: true })).not.toThrow();
    finishMap(['map', 1, 2, 3, {}]);
    await done;
    expect(() => onEdit({ label_id: 5, label_type: 'Obstacle' })).not.toThrow();
  });

  test('a map that fails to load turns the overlay into an error', async () => {
    mapResult = () => Promise.reject(new Error('labels feed down'));
    await start();
    expect(calls.overlay).toEqual(['error']);
    expect(calls.sidebar).toBeUndefined();
  });

  test('the map still loads when the popup fails to build', async () => {
    popupResult = () => Promise.reject(new Error('no dialog markup'));
    await start();
    expect(calls.mapParams.popupLabelViewer).toBeNull();
    expect(calls.overlay).toEqual(['hide']);
  });
});

describe('the label-ID search', () => {
  test('opens the label in the popup and clears any earlier message', async () => {
    await start();
    search('abc');
    search('42');
    expect(popup.showLabel).toHaveBeenCalledWith(42, 'AdminLabelMap');
    expect(textOf(message())).toBe('');
    expect(message().classList.contains('error')).toBe(false);
  });

  test('refuses an empty, zero or negative ID with a message', async () => {
    await start();
    for (const value of ['', '0', '-3']) {
      search(value);
      expect(textOf(message())).toBe('Enter a numeric label ID.');
      expect(message().classList.contains('error')).toBe(true);
    }
    expect(popup.showLabel).not.toHaveBeenCalled();
  });

  test('without the popup, opens the standalone label page in a new tab', async () => {
    popupResult = () => Promise.reject(new Error('no dialog markup'));
    await start();
    search('42');
    expect(window.open).toHaveBeenCalledWith('/admin/label/42', '_blank', 'noopener');
  });

  test('works while the map is still loading', async () => {
    mapResult = () => new Promise(() => {});
    document.body.innerHTML = MARKUP;
    new LabelMapPage(OPTS).init();
    await flush();
    search('7');
    expect(popup.showLabel).toHaveBeenCalledWith(7, 'AdminLabelMap');
  });

  test('a bad ID with no message line on the page is still refused quietly', async () => {
    await start(MARKUP.replace(/<span class="label-map-search-msg[^]*?<\/span>/, ''));
    search('0');
    expect(popup.showLabel).not.toHaveBeenCalled();
  });

  test('a page without the search form still loads the map', async () => {
    await start('<div id="admin-labelmap-choropleth"></div>');
    expect(calls.sidebar).toBeDefined();
  });
});

/**
 * Tests the contribution map the dashboard and public profile share (frontend/js/user-dashboard/contributionMap.js,
 * #5840): what it asks the shared PSMap for, the label clicks it routes to the page's popup, the scroll-wheel zoom
 * that only works with the pointer over the map, and that a map that fails to load still settles the promise the
 * dashboard's sections are waiting on.
 */

import { loadModules, mockModule } from './loader.js';
import { flush } from './support/routeFetch.js';

/** What the fakes saw during one load; rebuilt per test. */
let h;

mockModule('frontend/js/ps-map/createPSMap.js', () => ({
  createPSMap: (params) => {
    h.params = params;
    return h.created;
  },
}));
mockModule('frontend/js/ps-map/MapSidebarFilter.js', () => ({
  MapSidebarFilter: class { constructor(...args) { h.filterArgs = args; } },
}));

const { loadContributionMap } = await loadModules('frontend/js/user-dashboard/contributionMap.js');

/** @returns {object} A Mapbox map with just the scroll-zoom handler, recording whether it's on. */
const fakeMap = () => {
  const map = { zoomOnScroll: true };
  map.scrollZoom = { enable: () => { map.zoomOnScroll = true; }, disable: () => { map.zoomOnScroll = false; } };
  return map;
};

const OPTS = { mapId: 'user-dashboard-choropleth', mapboxApiKey: 'pk.test', streetsURL: '/s', labelsURL: '/l' };

beforeEach(() => {
  h = { map: fakeMap(), layers: { tracker: true } };
  h.created = Promise.resolve([h.map, null, null, null, h.layers]);
  window.appManager = { ready: (fn) => fn() };
  document.body.innerHTML = `
    <div id="user-dashboard-choropleth-holder"><div id="user-dashboard-choropleth"></div></div>`;
  delete window.udLabelPopupReady;
});

test('waits for the app to be ready before building anything', () => {
  window.appManager = { ready: () => {} };
  loadContributionMap(OPTS);
  expect(h.params).toBeUndefined();
});

test('draws the mapper\'s streets and labels, legend tucked away, without the high-quality filter', async () => {
  await expect(loadContributionMap(OPTS)).resolves.toBe(h.map);
  expect(h.params).toMatchObject({
    mapName: 'user-dashboard-choropleth', mapboxApiKey: 'pk.test', streetsURL: '/s', labelsURL: '/l',
    regionsURL: '/regions', uiSource: 'UserMap', sidebarStartsCollapsed: true, differentiateUnauditedStreets: true,
  });
  expect(h.filterArgs).toEqual([h.map, h.layers, { highQualityFilter: false }]);
});

test('the wheel zooms the map only while the pointer is over it, and scrolls the page otherwise', async () => {
  await loadContributionMap(OPTS);
  const holder = document.getElementById('user-dashboard-choropleth-holder');
  expect(h.map.zoomOnScroll).toBe(false);
  holder.dispatchEvent(new MouseEvent('mouseenter'));
  expect(h.map.zoomOnScroll).toBe(true);
  holder.dispatchEvent(new MouseEvent('mouseleave'));
  expect(h.map.zoomOnScroll).toBe(false);
});

describe('with clickable labels', () => {
  test('a label click opens the page\'s popup once it\'s ready, whenever that is', async () => {
    let popupReady;
    window.udLabelPopupReady = new Promise((resolve) => { popupReady = resolve; });
    await loadContributionMap(OPTS);

    const popup = { showLabel: vi.fn(async () => {}) };
    const shown = h.params.popupLabelViewer.showLabel(42, 'UserMap');
    popupReady(popup);
    await shown;
    expect(popup.showLabel).toHaveBeenCalledWith(42, 'UserMap');
  });

  test('a click does nothing when the page\'s popup failed to build', async () => {
    window.udLabelPopupReady = Promise.resolve(null);
    await loadContributionMap(OPTS);
    await expect(h.params.popupLabelViewer.showLabel(42, 'UserMap')).resolves.toBeUndefined();
  });
});

test('a map that fails to load is logged and settles as null, so no section waits forever', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const failure = new Error('style failed');
  h.created = Promise.reject(failure);
  await expect(loadContributionMap(OPTS)).resolves.toBeNull();
  await flush();
  expect(error).toHaveBeenCalledWith('Contribution map failed to load', failure);
});

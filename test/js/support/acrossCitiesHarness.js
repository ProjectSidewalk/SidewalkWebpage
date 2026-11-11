/**
 * Shared setup for the Across Cities suites (#5840): stubs each endpoint a suite names and fails the test on any other,
 * so a suite states only the payloads it cares about.
 */

import { loadModules, mockModule } from '../loader.js';

// The real library can't draw under jsdom, and loading it trips Vite's file-access check in a worktree.
mockModule('frontend/js/common/mapboxgl.js', () => ({ default: {} }));

const SCORECARDS_URL = '/adminapi/cityScorecards';
const CITIES_URL = '/v3/api/cities';
const FUNNELS_URL = '/adminapi/cityFunnels';
const TRAFFIC_URL = '/adminapi/cityTraffic';

/** One scorecard row: an active city with no anomalies, plus the overrides. */
export function makeCity(id, overrides = {}) {
  return {
    city_id: id, city_name: id, url: `https://${id}.example.org`, lifecycle: 'active', anomalies: [],
    weekly_trend: [], ...overrides,
  };
}

function respond(body) {
  if (body instanceof Error) return Promise.reject(body);
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

/**
 * Loads a fresh AcrossCitiesPage into `markup`, stubs the endpoints, and runs `init()`. A body may be an Error to
 * reject that request; leaving citiesGeo, funnels or traffic out gives the page no URL for it.
 *
 * @param {object} opts
 * @param {string} opts.markup - Only the elements the suite reads need be there.
 * @param {object|Error} [opts.scorecards] - Fields of the scorecards body; the rest default to empty.
 * @param {object|Error|null} [opts.citiesGeo]
 * @param {object|Error|((window: string) => object|Error)} [opts.funnels] - A body, or one per requested window.
 * @param {object|Error} [opts.traffic]
 * @param {string} [opts.mapboxToken]
 * @param {string} [opts.storiesPath]
 * @param {(modules: object) => void} [opts.beforeInit] - Runs before `init()` draws, e.g. to spy on MiniLineChart.
 * @returns {Promise<{fetch: Function, modules: object}>} The fetch stub, and the modules the page was loaded with
 *   (AcrossCitiesPage, MiniLineChart and `util`, one instance each).
 */
export async function renderAcrossCities({ markup, scorecards = {}, citiesGeo, funnels, traffic, mapboxToken,
  storiesPath, beforeInit }) {
  const modules = await loadModules('frontend/js/admin-dashboard/AcrossCitiesPage.js',
    'frontend/js/admin-dashboard/MiniLineChart.js', 'frontend/js/common/utilities.js');
  document.body.innerHTML = markup;
  const body = scorecards instanceof Error ? scorecards : {
    cities: [], summary: {}, over_time_all_time: [], over_time_daily: [], window_summary: null, window_by_city: {},
    ...scorecards,
  };
  // The page catches every failed request, so an unexpected one is recorded and failed here instead.
  const unexpected = [];
  const fetch = vi.fn((url) => {
    const [path, query] = url.split('?');
    if (path === SCORECARDS_URL) return respond(body);
    if (path === CITIES_URL && citiesGeo !== undefined) return respond(citiesGeo);
    if (path === TRAFFIC_URL && traffic !== undefined) return respond(traffic);
    if (path === FUNNELS_URL && funnels !== undefined) {
      const win = new URLSearchParams(query).get('window');
      return respond(typeof funnels === 'function' ? funnels(win) : funnels);
    }
    unexpected.push(url);
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
  vi.stubGlobal('fetch', fetch);
  const page = new modules.AcrossCitiesPage({
    scorecardsUrl: SCORECARDS_URL,
    citiesUrl: citiesGeo === undefined ? undefined : CITIES_URL,
    funnelsUrl: funnels === undefined ? undefined : FUNNELS_URL,
    trafficUrl: traffic === undefined ? undefined : TRAFFIC_URL,
    mapboxToken,
    storiesPath,
  });
  beforeInit?.(modules);
  await page.init();
  expect(unexpected, 'requests no stub answers').toEqual([]);
  return { fetch, modules };
}

/**
 * The speed limit sign (frontend/js/common/SpeedLimit.js) over Explore's and Validate's pano. Explore shows the limit
 * of the loaded street nearest the labeler, and asks our server only once they wander off our street network;
 * Validate shows the limit of the street under the label being judged, for the label types it is context for. A
 * wrong number on the sign is worse than none, so these pin when it shows, what it says, and that a slow answer for
 * an old spot can't overwrite the current one. (#5840)
 */

import { loadModules, mockModule } from './loader.js';
import { flush, routeFetch, sentRequests } from './support/routeFetch.js';

const i18next = { isInitialized: true, t: (key, { speed, units }) => `${key} ${speed} ${units}` };
mockModule('i18next', () => ({ default: i18next }));

const { SpeedLimit } = await loadModules('frontend/js/common/SpeedLimit.js');

/** A street in Seattle running east-west along latitude 47.6. */
const STREET = [[-122.33, 47.6], [-122.32, 47.6]];
/** A spot on that street. */
const ON_STREET = { lat: 47.6, lng: -122.325 };
/** A spot about a kilometer north of it, off our street network. */
const OFF_NETWORK = { lat: 47.61, lng: -122.325 };

/**
 * An Explore task for one street, as TaskContainer holds it.
 * @param {?string} maxSpeed - The street's OSM maxspeed, e.g. '25 mph'.
 * @param {Array<Array<number>>} [coordinates] - Its geometry, [lng, lat] pairs.
 * @returns {object} The task.
 */
const task = (maxSpeed, coordinates = STREET) => ({
  getGeoJSON: () => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }),
  getProperty: (key) => ({ maxSpeed })[key],
});

/**
 * A pano viewer that lets a test move the labeler to another pano.
 * @returns {{viewer: object, moveTo: (panoId: string) => void}} The viewer, and a call that fires its pano_changed.
 */
function fakeViewer() {
  const listeners = [];
  let panoId = 'pano-0';
  const viewer = {
    addListener: vi.fn((event, listener) => listeners.push(listener)),
    getPanoId: () => panoId,
  };
  return {
    viewer,
    moveTo: (id) => {
      panoId = id;
      for (const listener of listeners) listener();
    },
  };
}

/**
 * Renders the sign as explore.scala.html does.
 * @returns {{sign: HTMLElement, number: HTMLElement, units: HTMLElement}} The sign and its two lines of text.
 */
function renderSign() {
  document.body.innerHTML = `
    <div id="speed-limit-sign" class="speed-limit-sign" data-design-style="us-canada" tabindex="0" role="img">
      <div class="speed-limit-holder">
        <span class="speed-limit-text"><span id="speed-limit">N/A</span><span id="speed-limit-sub">N/A</span></span>
      </div>
    </div>`;
  return {
    sign: document.getElementById('speed-limit-sign'),
    number: document.getElementById('speed-limit'),
    units: document.getElementById('speed-limit-sub'),
  };
}

let els;
beforeEach(() => {
  els = renderSign();
});

/** @returns {?string} What the sign reads, e.g. '25 mph', or null while it is hidden. */
const shown = () => (els.sign.style.display === 'flex' ? `${els.number.innerText} ${els.units.innerText}` : null);

describe('in Explore', () => {
  let position;
  let tasks;
  let viewer;
  let moveTo;
  let onboarding;

  /**
   * Builds Explore's sign for the given city.
   * @param {string} [countryId] - The city's country.
   * @returns {SpeedLimit} The sign.
   */
  const build = (countryId = 'usa') => new SpeedLimit(() => viewer, () => position, () => onboarding, countryId,
    { taskContainer: { getTasks: () => tasks } });

  beforeEach(() => {
    position = ON_STREET;
    tasks = [task('25 mph')];
    onboarding = false;
    ({ viewer, moveTo } = fakeViewer());
  });

  test('shows the limit of the street the labeler is on, and names it for a screen reader', async () => {
    build();
    await flush();
    expect(shown()).toBe('25 mph');
    expect(els.sign.getAttribute('aria-label')).toBe('common:speed-limit-aria-label 25 mph');
  });

  test('picks the nearest of the loaded streets', async () => {
    const parallel = (lat) => [[-122.33, lat], [-122.32, lat]];
    tasks = [task('40 mph', parallel(47.605)), task('25 mph'), task('30 mph', parallel(47.595))];
    build();
    await flush();
    expect(shown()).toBe('25 mph');
  });

  test.each([
    ['usa', 'us-canada', '30 mph'],
    ['canada', 'us-canada', '30 km/h'],
    ['netherlands', 'non-us-canada', '30 km/h'],
  ])('in %s, draws the %s sign and reads a bare number in the local units', async (country, design, reads) => {
    tasks = [task('30')];
    build(country);
    await flush();
    expect(els.sign.dataset.designStyle).toBe(design);
    expect(shown()).toBe(reads);
  });

  test('stays hidden during the tutorial', async () => {
    onboarding = true;
    build();
    await flush();
    expect(shown()).toBeNull();
  });

  test('stays hidden on a street with no known limit', async () => {
    tasks = [task(null)];
    build();
    await flush();
    expect(shown()).toBeNull();
  });

  test('asks our server once the labeler wanders off the street network', async () => {
    position = OFF_NETWORK;
    const fetchStub = routeFetch({ '/speedLimit': { max_speed: '40 km/h' } });
    build();
    await flush();
    expect(shown()).toBe('40 km/h');
    expect(sentRequests(fetchStub)).toEqual([
      { method: 'GET', url: `/speedLimit?lat=${OFF_NETWORK.lat}&lng=${OFF_NETWORK.lng}`, body: undefined },
    ]);
  });

  test('asks only once per pano, even when two updates race', async () => {
    position = OFF_NETWORK;
    const fetchStub = routeFetch({ '/speedLimit': { max_speed: '40 km/h' } });
    build();
    moveTo('pano-0');
    await flush();
    moveTo('pano-0');
    await flush();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(shown()).toBe('40 km/h');
  });

  test('forgets the oldest panos once it has remembered a hundred', async () => {
    position = OFF_NETWORK;
    const fetchStub = routeFetch({ '/speedLimit': { max_speed: '40 km/h' } });
    build();
    for (let i = 1; i <= 100; i++) moveTo(`pano-${i}`);
    await flush();
    expect(fetchStub).toHaveBeenCalledTimes(101);

    moveTo('pano-100');
    await flush();
    expect(fetchStub).toHaveBeenCalledTimes(101);
    moveTo('pano-0');
    await flush();
    expect(fetchStub).toHaveBeenCalledTimes(102);
  });

  test.each([
    ['knows no limit there', { max_speed: null }],
    ['answers without one', {}],
    ['fails', { status: 500 }],
    ['can\'t be reached', new TypeError('Failed to fetch')],
  ])('stays hidden off the network when the server %s', async (_, answer) => {
    position = OFF_NETWORK;
    routeFetch({ '/speedLimit': answer });
    build();
    await flush();
    expect(shown()).toBeNull();
  });

  test('never lets a slow answer for an earlier spot overwrite the current one', async () => {
    position = OFF_NETWORK;
    let answerSlowly;
    routeFetch({ '/speedLimit': () => new Promise((resolve) => { answerSlowly = resolve; }) });
    build();
    await flush();

    position = ON_STREET;
    moveTo('pano-1');
    await flush();
    expect(shown()).toBe('25 mph');

    answerSlowly({ max_speed: '60 km/h' });
    await flush();
    expect(shown()).toBe('25 mph');
  });

  // At page load the pano position and the street list can lag the sign; asking the server then would be pointless.
  test('waits for the position and the streets to load rather than asking the server', async () => {
    vi.useFakeTimers();
    position = null;
    tasks = [];
    const fetchStub = routeFetch({ '/speedLimit': { max_speed: '40 km/h' } });
    build();
    moveTo('pano-0');
    await vi.advanceTimersByTimeAsync(0);
    expect(shown()).toBeNull();

    position = ON_STREET;
    tasks = [task('25 mph')];
    await vi.advanceTimersByTimeAsync(1000);
    expect(shown()).toBe('25 mph');
    expect(fetchStub).not.toHaveBeenCalled();
    // The two early updates shared one re-check.
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('in Validate', () => {
  let currentLabel;
  let viewer;

  /**
   * A label as Validate's LabelContainer serves it.
   * @param {string} labelType - Its type.
   * @param {?string} maxSpeed - The limit of the street it is on.
   * @returns {object} The label.
   */
  const label = (labelType, maxSpeed) => ({ getAuditProperty: (key) => ({ labelType, maxSpeed })[key] });

  /** @returns {SpeedLimit} Validate's sign, which never asks for a position or streets. */
  const build = () => new SpeedLimit(() => viewer, () => null, () => false, 'usa',
    { labelContainer: { getCurrentLabel: () => currentLabel } });

  beforeEach(() => {
    ({ viewer } = fakeViewer());
  });

  test('shows the limit of the street under a missing curb ramp', async () => {
    currentLabel = label('NoCurbRamp', '25 mph');
    build();
    await flush();
    expect(shown()).toBe('25 mph');
  });

  test('stays hidden for a label type the limit is no context for', async () => {
    currentLabel = label('CurbRamp', '25 mph');
    build();
    await flush();
    expect(shown()).toBeNull();
  });

  test('stays hidden for a label on a street with no known limit', async () => {
    currentLabel = label('NoCurbRamp', undefined);
    build();
    await flush();
    expect(shown()).toBeNull();
  });

  // The sign is built before the first label arrives.
  test('stays hidden until there is a label to judge', async () => {
    currentLabel = null;
    const sign = build();
    await flush();
    expect(shown()).toBeNull();

    currentLabel = label('NoCurbRamp', '25 mph');
    sign.refresh();
    await flush();
    expect(shown()).toBe('25 mph');
  });
});

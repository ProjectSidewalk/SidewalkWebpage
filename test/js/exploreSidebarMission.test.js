/**
 * The right sidebar's mission heading and the two-segment neighborhood progress bar
 * (frontend/js/explore/sidebar/MissionPanel.js and RegionProgressBar.js, #5840): which heading and sentence each
 * mission type gets, when the exit-route link shows, and how the bar splits the region between you and everyone else.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakeTracker } from './fakes.js';

mockModule('i18next', () => ({ default: {
  // A key with values reads `key[name=value,...]`; the region sentence carries the distance placeholder the real
  // translation has, so the test can see it filled in.
  t: (key, opts) => {
    if (key === 'right-ui.current-mission.message') return `Explore ${opts.regionName} for __PLACEHOLDER__`;
    const vars = Object.entries(opts ?? {}).filter(([name]) => name !== 'interpolation')
      .map(([name, value]) => `${name}=${value}`);
    return vars.length ? `${key}[${vars.join(',')}]` : key;
  },
} }));

// A street's length is whatever its fake says, so the bar's arithmetic is checked on round numbers.
mockModule('@turf/turf', () => ({ length: (geoJson) => geoJson.properties.length }));

describe('MissionPanel', () => {
  let MissionPanel;
  let tracker;

  const header = () => document.getElementById('current-mission-header').innerHTML;
  const description = () => document.getElementById('current-mission-description');
  const exitLink = () => document.getElementById('explore-sidebar__exit-route');

  /**
   * @param {string} missionType - The mission's type.
   * @param {number} [miles] - Its length.
   * @returns {object} The mission as the panel reads it.
   */
  const mission = (missionType, miles = 0.5) => ({
    getProperty: (key) => ({ missionType })[key],
    getDistance: () => miles,
  });

  /**
   * Builds the panel for a region or route.
   * @param {object} [options]
   * @param {boolean} [options.isRoute] - Whether the labeler is on a user-defined route.
   * @param {?string} [options.regionName] - The current region's name, or null when there is no region yet.
   * @returns {MissionPanel} The panel.
   */
  function panel({ isRoute = false, regionName = 'Ballard' } = {}) {
    const region = regionName === null ? null : { getProperty: (key) => ({ name: regionName })[key] };
    return new MissionPanel({ routeName: 'Lake loop' }, { isRoute, currentRegion: () => region }, tracker);
  }

  beforeEach(async () => {
    document.body.innerHTML = `
      <h1 id="current-mission-header"></h1>
      <a id="explore-sidebar__exit-route" href="/explore"></a>
      <p id="current-mission-description"></p>`;
    useUtil({ distanceToString: (meters) => `${Math.round(meters)} m` });
    tracker = fakeTracker();
    ({ MissionPanel } = await loadModules('frontend/js/explore/sidebar/MissionPanel.js'));
  });

  it('names the region and the mission\'s length for a regular mission, with no exit link', () => {
    panel().setMessage(mission('audit'));

    expect(header()).toBe('right-ui.current-mission.header');
    expect(description().innerHTML).toBe('Explore Ballard for 805 m');
    expect(exitLink().hidden).toBe(true);
  });

  it('names the route on a user-defined route and offers the exit link', () => {
    panel({ isRoute: true }).setMessage(mission('audit'));

    expect(header()).toBe('right-ui.current-mission.header-route');
    expect(description().innerHTML).toBe('right-ui.current-mission.message-route[routeName=Lake loop]');
    expect(exitLink().hidden).toBe(false);
  });

  it('shows the tutorial sentence during the tutorial', () => {
    panel().setMessage(mission('auditOnboarding'));

    expect(header()).toBe('right-ui.current-mission.header');
    expect(description().innerHTML).toBe('tutorial.mission-message');
  });

  it('shows the free-exploration heading alone, with nothing under it', () => {
    panel().setMessage(mission('exploreAddress'));

    expect(header()).toBe('right-ui.current-mission.header-free-explore');
    expect(description().innerHTML).toBe('');
  });

  it('leaves the region name blank until there is a region', () => {
    panel({ regionName: null }).setMessage(mission('audit'));

    expect(description().innerHTML).toBe('Explore  for 805 m');
  });

  it('logs a click on the exit link; the link itself does the leaving', () => {
    panel({ isRoute: true });
    exitLink().addEventListener('click', (e) => e.preventDefault());

    exitLink().click();

    expect(tracker.push).toHaveBeenCalledWith('Click_ExitRoute', { source: 'sidebar' });
  });

  it('keeps the whole sentence on hover only when it is clipped to its one line', () => {
    const p = panel();
    Object.defineProperty(description(), 'scrollWidth', { value: 400, configurable: true });
    Object.defineProperty(description(), 'clientWidth', { value: 200, configurable: true });
    p.setMessage(mission('audit'));
    expect(description().title).toBe('Explore Ballard for 805 m');

    Object.defineProperty(description(), 'scrollWidth', { value: 200, configurable: true });
    p.setMessage(mission('audit'));
    expect(description().title).toBe('');
  });
});

describe('RegionProgressBar', () => {
  let RegionProgressBar;

  const IDS = { fill: 'region-fill', you: 'region-you', community: 'region-community', rate: 'region-rate' };
  const width = (id) => document.getElementById(id).style.width;
  const rate = () => document.getElementById('region-rate').textContent;

  /**
   * Builds the bar over a task container with the given distances.
   * @param {object} distances
   * @param {number} [distances.total] - The region's total street length.
   * @param {number} [distances.you] - Your audited distance, the street underway included.
   * @param {number} [distances.everyone] - Everyone's completed distance, yours included.
   * @param {number[]} [distances.completed] - The lengths of the streets you have finished.
   * @param {boolean} [isRoute] - Whether the labeler is on a user-defined route.
   * @returns {RegionProgressBar} The bar.
   */
  function bar({ total = 10, you = 2.5, everyone = 6, completed = [1, 1] } = {}, isRoute = false) {
    const taskContainer = {
      getTotalTaskDistance: () => total,
      getCompletedTaskDistance: () => you,
      getAllUsersCompletedTaskDistance: () => everyone,
      getCompletedTasks: () => completed.map((length) => ({ getGeoJSON: () => ({ properties: { length } }) })),
    };
    return new RegionProgressBar(IDS, { isRoute }, taskContainer);
  }

  beforeEach(async () => {
    document.body.innerHTML = `
      <div id="region-fill"><div id="region-community"></div><div id="region-you"></div></div>
      <span id="region-rate"></span>`;
    document.documentElement.dataset.measurementSystem = 'metric';
    ({ RegionProgressBar } = await loadModules('frontend/js/explore/sidebar/RegionProgressBar.js'));
  });

  it('fills the pill to what everyone has done, split between you and the rest as shares of the pill', () => {
    bar().update();

    // Yours is 2.5 of 10; the rest is everyone's 6 less the 2 you finished, so 4 of 10.
    expect(width('region-fill')).toBe('65%');
    expect(width('region-you')).toBe('38.5%');
    expect(width('region-community')).toBe('61.5%');
    expect(rate()).toBe('65%');
  });

  it('shows only your own progress on a user-defined route', () => {
    bar({}, true).update();

    expect(width('region-fill')).toBe('25%');
    expect(width('region-you')).toBe('100%');
    expect(width('region-community')).toBe('0%');
    expect(rate()).toBe('25%');
  });

  it('never overflows the track when the figures add up to more than the region', () => {
    bar({ everyone: 20, completed: [] }).update();

    expect(width('region-fill')).toBe('100%');
    expect(width('region-you')).toBe('25%');
    expect(width('region-community')).toBe('75%');
    expect(rate()).toBe('100%');
  });

  it('reads 99% rather than 100% while anything is left', () => {
    bar({ you: 9.96, everyone: 0, completed: [] }).update();

    expect(rate()).toBe('99%');
  });

  it('shows an empty bar, segments untouched, when nobody has started', () => {
    bar({ you: 0, everyone: 0, completed: [] }).update();

    expect(width('region-fill')).toBe('0%');
    expect(width('region-you')).toBe('');
    expect(rate()).toBe('0%');
  });

  it('does nothing while the region has no streets to measure yet', () => {
    bar({ total: 0 }).update();

    expect(width('region-fill')).toBe('');
    expect(rate()).toBe('');
  });

  it('does nothing on a page without the bar', () => {
    document.getElementById('region-rate').remove();

    expect(() => bar().update()).not.toThrow();
    expect(width('region-fill')).toBe('');
  });
});

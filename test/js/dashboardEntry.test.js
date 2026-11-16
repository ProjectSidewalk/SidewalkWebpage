/**
 * Tests for the user dashboard's entry (frontend/js/pages/dashboard/dashboard.js) and the public profile's
 * (dashboard/publicProfile.js): which sections each boots from the markup and page data present, what it hands
 * them, and that a failed badge or popup setup leaves the rest of the page working. The sections themselves have
 * suites of their own, so here they are fakes that record what they were given (#5840).
 */

import { loadModules, mockModule } from './loader.js';
import { flush } from './support/routeFetch.js';

/** What the fakes saw during one page load, by section name; rebuilt per test. */
let h;

/**
 * A stand-in for a dashboard section class that records how it was built and started.
 * @param {string} name - The key its record goes under in `h`.
 * @returns {Function} The fake class.
 */
function recordingSection(name) {
  return class {
    constructor(...args) {
      if (h.throwOn === name) throw new Error(`${name} broke`);
      h[name] = { args, rendered: false, inited: false };
    }

    render() { h[name].rendered = true; }

    init() { h[name].inited = true; }
  };
}

mockModule('frontend/js/common/label-detail/LabelPopup.js', () => ({
  LabelPopup: (...args) => { h.popupArgs = args; return h.popupResult(); },
}));
mockModule('frontend/js/common/pano-viewer/viewerClassFor.js', () => ({
  viewerClassFor: (src) => { h.imagerySource = src; return h.Viewer; },
}));
mockModule('frontend/js/user-dashboard/contributionMap.js', () => ({
  loadContributionMap: (opts) => { h.contributionMap = opts; return h.mapReady; },
}));
mockModule('frontend/js/user-dashboard/TeamActions.js', () => ({}));
mockModule('frontend/js/user-dashboard/DashboardBadges.js', () => ({ DashboardBadges: recordingSection('badges') }));
mockModule('frontend/js/user-dashboard/CrossCityStats.js', () => ({ CrossCityStats: recordingSection('cities') }));
mockModule('frontend/js/user-dashboard/MyRoutes.js', () => ({ MyRoutes: recordingSection('routes') }));
mockModule('frontend/js/user-dashboard/OutdatedStreets.js', () => ({ OutdatedStreets: recordingSection('reaudit') }));
mockModule('frontend/js/user-dashboard/MistakeGallery.js', () => ({ MistakeGallery: recordingSection('mistakes') }));
mockModule('frontend/js/user-dashboard/StoriesSection.js', () => ({ StoriesSection: recordingSection('stories') }));

// Every section the dashboard view can render, as userDashboard.scala.html marks them up.
const ALL_SECTIONS = `
  <div id="ud-badges"></div>
  <section id="ud-cities-section" data-stats-url="/userapi/crossCityStats"></section>
  <ul id="ud-routes-list"></ul>
  <ul id="ud-reaudit-list"></ul>
  <div id="ud-mistakes" data-user-id="u-1" data-limit="9" data-read-only="true"></div>
  <a id="ud-mistakes-seeall"></a>
  <div id="ud-stories" data-stories-url="/userapi/stories" data-story-url-base="/stories"></div>
  <dialog id="ud-story-composer"></dialog>
  <div class="ud-acc-fill" data-ud-pct="37.5"></div>
  <div class="ud-acc-fill"></div>`;

/**
 * Loads an entry with the given page-entry data and markup, and lets its ready handler finish.
 * @param {string} entry - Path of the page entry under frontend/js/pages/dashboard/.
 * @param {Record<string, string>} [dataset] - The page-entry `data-*` values, camelCased.
 * @param {string} [markup] - The page's sections.
 * @returns {Promise<void>} Resolves once the page has started.
 */
async function boot(entry, dataset = {}, markup = ALL_SECTIONS) {
  const entryData = {
    mapboxApiKey: 'pk.test', streetsUrl: '/streets', labelsUrl: '/labels', imagerySource: 'gsv',
    imageryAccessToken: 'tok', ...dataset,
  };
  const attrs = Object.entries(entryData)
    .map(([k, v]) => `data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${v}"`).join(' ');
  document.body.innerHTML = `<div id="page-entry" ${attrs}></div>${markup}`;
  await loadModules(`frontend/js/pages/dashboard/${entry}`);
  await flush();
}

beforeEach(() => {
  h = { Viewer: function Viewer() {}, mapReady: Promise.resolve('map'), throwOn: null };
  h.popup = { showLabel: vi.fn() };
  h.popupResult = () => Promise.resolve(h.popup);
  window.appManager = { ready: (fn) => fn() };
});

describe('the user dashboard', () => {
  test('draws the user\'s contribution map with clickable labels, before the app is ready', async () => {
    window.appManager = { ready: () => {} };
    await boot('dashboard.js');
    expect(h.contributionMap).toEqual({
      mapId: 'user-dashboard-choropleth', mapboxApiKey: 'pk.test', streetsURL: '/streets', labelsURL: '/labels',
    });
  });

  test('sizes each accuracy bar from its percentage', async () => {
    await boot('dashboard.js');
    const [withPct, withoutPct] = document.querySelectorAll('.ud-acc-fill');
    expect(withPct.style.width).toBe('37.5%');
    expect(withoutPct.style.width).toBe('');
  });

  test('boots every section on the page with its own data and the shared popup', async () => {
    await boot('dashboard.js', { currentCityName: 'Seattle', username: 'mikey', viewerUsername: 'mikey' });
    expect(h.badges.rendered).toBe(true);
    expect(h.cities.args[1]).toEqual({
      statsUrl: '/userapi/crossCityStats', currentCityName: 'Seattle', mapboxApiKey: 'pk.test',
    });
    expect(h.cities.rendered).toBe(true);
    expect(h.routes.inited).toBe(true);
    expect(h.reaudit.args[1].mapReady).toBe(h.mapReady);
    expect(h.reaudit.inited).toBe(true);
    expect(h.mistakes.args[1]).toEqual({
      userId: 'u-1', limit: 9, seeAllEl: document.getElementById('ud-mistakes-seeall'), labelPopup: h.popup,
      readOnly: true,
    });
    expect(h.mistakes.rendered).toBe(true);
    const stories = h.stories.args[1];
    expect(stories).toMatchObject({
      labelPopup: h.popup, composerDialog: document.getElementById('ud-story-composer'),
      storiesUrl: '/userapi/stories', currUsername: 'mikey',
    });
    expect(stories.storyUrlFor(12)).toBe('/stories/12');
    expect(h.stories.rendered).toBe(true);
    await expect(window.udLabelPopupReady).resolves.toBe(h.popup);
  });

  test('a page without those sections boots none of them', async () => {
    await boot('dashboard.js', {}, '');
    for (const name of ['badges', 'cities', 'routes', 'reaudit', 'mistakes', 'stories']) {
      expect(h[name]).toBeUndefined();
    }
  });

  test('the mistake gallery shows six editable cards when the view sets no limit or mode', async () => {
    await boot('dashboard.js', {}, '<div id="ud-mistakes" data-user-id="u-1"></div>');
    expect(h.mistakes.args[1]).toMatchObject({ limit: 6, readOnly: false, seeAllEl: null });
  });

  test('the user\'s own popup is a user view, with an anonymous viewer passed as no one', async () => {
    const showLabel = h.popup.showLabel;
    await boot('dashboard.js', { imagerySource: 'infra3d', viewerUsername: '', username: '' });
    expect(h.imagerySource).toBe('infra3d');
    expect(h.popupArgs).toEqual([false, h.Viewer, 'tok', null, { showLabelMapLink: true, showExploreHereLink: true }]);
    expect(h.stories.args[1].currUsername).toBeNull();
    // Opened labels are logged under whichever section opened them, not as the admin dashboard.
    expect(h.popup.showLabel).toBe(showLabel);
  });

  test('an admin\'s view opens labels as the admin dashboard', async () => {
    const showLabel = h.popup.showLabel;
    await boot('dashboard.js', { adminView: 'true', viewerUsername: 'admin' });
    expect(h.popupArgs.slice(0, 4)).toEqual([true, h.Viewer, 'tok', 'admin']);
    h.popup.showLabel(4);
    expect(showLabel).toHaveBeenCalledWith(4, 'AdminUserDashboard');
  });

  test('a popup that fails to build leaves the cards on their inline controls', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('viewer down');
    h.popupResult = () => Promise.reject(failure);
    await boot('dashboard.js', { adminView: 'true' });
    expect(error).toHaveBeenCalledWith('Label popup init failed; mistake cards will use inline controls only', failure);
    expect(h.mistakes.args[1].labelPopup).toBeNull();
    await expect(window.udLabelPopupReady).resolves.toBeNull();
  });

  test('badges that fail to render don\'t stop the rest of the page', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.throwOn = 'badges';
    await boot('dashboard.js');
    expect(error).toHaveBeenCalledWith('Badge render failed', expect.any(Error));
    expect(h.stories.rendered).toBe(true);
  });
});

describe('the public profile', () => {
  test('draws the mapper\'s contribution map and badges, with a user-view popup', async () => {
    await boot('publicProfile.js', { username: 'viewer' });
    expect(h.contributionMap).toEqual({
      mapId: 'public-profile-choropleth', mapboxApiKey: 'pk.test', streetsURL: '/streets', labelsURL: '/labels',
    });
    expect(h.badges.rendered).toBe(true);
    expect(h.popupArgs)
      .toEqual([false, h.Viewer, 'tok', 'viewer', { showLabelMapLink: true, showExploreHereLink: true }]);
    await expect(window.udLabelPopupReady).resolves.toBe(h.popup);
  });

  test('an anonymous viewer is passed as no one, and a page without badges skips them', async () => {
    await boot('publicProfile.js', { username: '' }, '');
    expect(h.popupArgs[3]).toBeNull();
    expect(h.badges).toBeUndefined();
  });

  test('badges or a popup that fail leave the map up, its labels just not clickable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('viewer down');
    h.throwOn = 'badges';
    h.popupResult = () => Promise.reject(failure);
    await boot('publicProfile.js');
    expect(error).toHaveBeenCalledWith('Badge render failed', expect.any(Error));
    expect(error).toHaveBeenCalledWith('Label popup init failed; map labels will not be clickable', failure);
    await expect(window.udLabelPopupReady).resolves.toBeNull();
  });
});

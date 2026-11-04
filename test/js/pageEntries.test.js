/**
 * Tests for the small page entries in frontend/js/pages/ (#5840): each reads its page's data and boots that page's
 * parts, which have suites of their own and are fakes here that record what they were handed. The /cities page's
 * stats grid is filled by its entry itself, so that is tested in full.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { flush, routeFetch } from './support/routeFetch.js';

/** What the fakes saw during one page load, by part name; rebuilt per test. */
let h;

/**
 * A stand-in for a page part's class that records how it was built and what it was asked to do.
 * @param {string} name - The key its record goes under in `h`.
 * @returns {Function} The fake class.
 */
function recordingClass(name) {
  return class {
    constructor(...args) {
      (h[name] ||= []).push({ args, calls: [] });
      this.record = h[name].at(-1);
    }

    init() { this.record.calls.push('init'); }

    setLabelPopup(popup) { this.record.calls.push(['setLabelPopup', popup]); }

    renderRegions(data) { this.record.calls.push(['renderRegions', data]); }

    renderStreets(data) { this.record.calls.push(['renderStreets', data]); }
  };
}

mockModule('i18next', () => ({
  default: { t: (key, opts) => (opts ? `${key} ${Object.values(opts).join(' ')}` : key) },
}));
mockModule('frontend/js/common/label-detail/LabelPopup.js', () => ({
  LabelPopup: (...args) => { h.popupArgs = args; return h.popupResult(); },
}));
mockModule('frontend/js/common/pano-viewer/viewerClassFor.js', () => ({
  viewerClassFor: (src) => { h.imagerySource = src; return h.Viewer; },
}));
mockModule('frontend/js/ps-map/createPSMap.js', () => ({
  createPSMap: (params) => { (h.maps ||= []).push(params); return h.mapResult(params); },
}));
mockModule('frontend/js/AccessScoreSpotlight.js', () => ({ AccessScoreSpotlight: recordingClass('spotlight') }));
mockModule('frontend/js/LandingValidationGrid.js', () => ({ LandingValidationGrid: recordingClass('grid') }));
mockModule('frontend/js/common/TablePager.js', () => ({ TablePager: recordingClass('pager') }));
mockModule('frontend/js/user-dashboard/TeamActions.js', () => ({}));
mockModule('frontend/js/community/StoryListPage.js', () => ({ StoryListPage: recordingClass('storyList') }));
mockModule('frontend/js/community/RouteListPage.js', () => ({ RouteListPage: recordingClass('routeList') }));
mockModule('frontend/js/route-builder/RouteBuilder.js', () => ({ RouteBuilder: recordingClass('routeBuilder') }));
mockModule('frontend/js/shared-label/SharedLabel.js', () => ({ SharedLabelPage: recordingClass('sharedLabel') }));
mockModule('frontend/js/gallery/Main.js', () => ({ startGallery: (params) => { h.gallery = params; } }));
mockModule('frontend/js/common/WelcomePrivacy.js', () => ({ WelcomePrivacy: recordingClass('welcome') }));
mockModule('frontend/js/user-dashboard/Settings.js', () => ({ Settings: recordingClass('settings') }));
mockModule('frontend/js/user-dashboard/AccountForm.js', () => ({ AccountForm: recordingClass('accountForm') }));
mockModule('frontend/js/user-dashboard/AdminUser.js', () => ({ AdminUser: recordingClass('adminUser') }));
// Modules imported only for what they set up on load; each has its own suite, and here they'd reach for markup or
// globals these pages don't have.
for (const sideEffectsOnly of ['homepage.js', 'common/AppManager.js', 'common/AuthModal.js', 'common/Navbar.js',
  'common/TestServerBanner.js', 'common/psTooltip.js']) {
  mockModule(`frontend/js/${sideEffectsOnly}`, () => ({}));
}
mockModule('frontend/js/common/footerLogging.js', () => ({ initFooterLogging: () => { h.footerLogging = true; } }));

/**
 * Loads an entry over the given markup, with the given page-entry data, and lets its ready handlers finish.
 * @param {string} entry - Path under frontend/js/pages/.
 * @param {object} [opts]
 * @param {Record<string, string>} [opts.data] - The page-entry `data-*` values, camelCased.
 * @param {string} [opts.markup] - The rest of the page.
 * @returns {Promise<void>} Resolves once the page has started.
 */
async function boot(entry, { data = {}, markup = '' } = {}) {
  document.body.innerHTML = `<div id="page-entry"></div>${markup}`;
  Object.assign(document.getElementById('page-entry').dataset, data);
  await loadModules(`frontend/js/pages/${entry}`);
  await flush();
}

const el = (id) => document.getElementById(id);

beforeEach(() => {
  h = { Viewer: function Viewer() {}, mapResult: () => Promise.resolve([{ resize: vi.fn() }]) };
  h.popup = { id: 'popup' };
  h.popupResult = () => Promise.resolve(h.popup);
  window.appManager = { ready: (fn) => fn() };
  window.logWebpageActivity = vi.fn();
});

describe('/cities', () => {
  const MARKUP = `
    <div id="page-loading"></div>
    <div id="access-score-spotlight-container"></div>
    <span id="stat-cities">-</span><span id="stat-distance">-</span>
    <span id="stat-labels">-</span><span id="stat-validations">-</span>
    <p id="cta-community-count"></p>`;

  test('ranks cities, draws the city map, and fills the stats from the API', async () => {
    routeFetch({
      '/v3/api/aggregateStats': { num_cities: 56, km_explored: 1234, total_labels: 900, total_validations: 77 },
    });
    useUtil({ longDistanceToString: (km) => `${km} km` });
    await boot('deploymentSites.js', { data: { mapboxApiKey: 'pk.test' }, markup: MARKUP });

    expect(h.spotlight[0].args).toEqual([el('access-score-spotlight-container'), { crossCity: true }]);
    expect(h.maps[0]).toMatchObject({ mapName: 'cities-map', mapboxApiKey: 'pk.test', loadCities: true });
    expect(window.citiesMap.resize).toHaveBeenCalled();
    expect(el('stat-cities').textContent).toBe('56');
    expect(el('stat-distance').textContent).toBe('1234 km');
    expect(el('stat-labels').textContent).toBe('common:format-number 900');
    expect(el('stat-validations').textContent).toBe('common:format-number 77');
    expect(el('cta-community-count').hidden).toBe(false);
    expect(el('cta-community-count').textContent).toBe('common:cities-cta-join 56');
  });

  test('missing counts show as zero, and the "join n communities" lead is hidden rather than saying zero', async () => {
    routeFetch({ '/v3/api/aggregateStats': {} });
    useUtil({ longDistanceToString: (km) => `${km} km` });
    await boot('deploymentSites.js', { markup: MARKUP });
    expect(el('stat-cities').textContent).toBe('0');
    expect(el('stat-distance').textContent).toBe('0 km');
    expect(el('stat-labels').textContent).toBe('common:format-number 0');
    expect(el('stat-validations').textContent).toBe('common:format-number 0');
    expect(el('cta-community-count').hidden).toBe(true);
    expect(el('cta-community-count').textContent).toBe('');
  });

  test('a failed stats request leaves the placeholders and logs', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    routeFetch({ '/v3/api/aggregateStats': { status: 503 } });
    await boot('deploymentSites.js', { markup: MARKUP });
    expect(el('stat-cities').textContent).toBe('-');
    expect(error).toHaveBeenCalledWith('Failed to load aggregate stats:', new Error('HTTP 503'));
  });

  test('a map that fails still takes the loading screen down', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('style 500');
    h.mapResult = () => Promise.reject(failure);
    routeFetch({ '/v3/api/aggregateStats': {} });
    await boot('deploymentSites.js', { markup: MARKUP });
    expect(error).toHaveBeenCalledWith('Error loading cities map:', failure);
    expect(el('page-loading').style.display).toBe('none');
  });
});

describe('the mobile landing page', () => {
  const MARKUP = `
    <a id="mobile-hero-cta-btn"></a><a id="mobile-bottom-cta-btn"></a>
    <div id="partners-container">
      <a id="named" data-partner-source="sdot"><img id="logo"></a>
      <a id="unnamed" data-partner-source=""></a>
      <p id="blurb"></p>
    </div>`;

  test('logs each call to action by where it sits', async () => {
    await boot('mobileLanding.js', { markup: MARKUP });
    el('mobile-hero-cta-btn').click();
    el('mobile-bottom-cta-btn').click();
    expect(window.logWebpageActivity.mock.calls).toEqual([
      ['Click_module=StartValidating_location=MobileLanding'],
      ['Click_module=StartValidating_location=MobileLanding_bottom'],
    ]);
  });

  test('logs a partner click by its source, from anywhere inside the link, and ignores the rest', async () => {
    await boot('mobileLanding.js', { markup: MARKUP });
    el('logo').click();
    el('unnamed').click();
    el('blurb').click();
    expect(window.logWebpageActivity.mock.calls).toEqual([
      ['Click_module=Partner_source=sdot'], ['Click_module=Partner_source=unknown'],
    ]);
  });
});

describe('the leaderboard', () => {
  test('pages the team board, logging each page turned', async () => {
    await boot('dashboard/leaderboard.js', {
      markup: '<table><tbody id="ud-team-board"></tbody></table><nav id="ud-team-pager"></nav>',
    });
    const [board, pager, logPage] = h.pager[0].args;
    expect([board, pager]).toEqual([el('ud-team-board'), el('ud-team-pager')]);
    logPage(2);
    expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=TeamBoardPage_page=2');

    delete window.logWebpageActivity;
    expect(() => logPage(3)).not.toThrow();
  });

  test('a leaderboard with no team board pages nothing', async () => {
    await boot('dashboard/leaderboard.js', { markup: '<table><tbody id="ud-team-board"></tbody></table>' });
    expect(h.pager).toBeUndefined();
  });
});

describe('/stories', () => {
  test('lists the stories, then opens their labels in a user-view popup', async () => {
    await boot('stories.js', { data: { imagerySource: 'gsv', imageryAccessToken: 'tok', username: 'mikey' } });
    expect(h.storyList[0].calls).toEqual(['init', ['setLabelPopup', h.popup]]);
    expect(h.imagerySource).toBe('gsv');
    expect(h.popupArgs).toEqual([false, h.Viewer, 'tok', 'mikey']);
  });

  test('an anonymous visitor is passed as no one, and a failed popup leaves the links navigating', async () => {
    await boot('stories.js', { data: { username: '' } });
    expect(h.popupArgs[3]).toBeNull();

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('viewer down');
    h.popupResult = () => Promise.reject(failure);
    await boot('stories.js');
    expect(h.storyList.at(-1).calls).toEqual(['init']);
    expect(error).toHaveBeenCalledWith(
      'Stories page: label popup failed to initialize; links will navigate instead.', failure);
  });
});

describe('the landing page', () => {
  test('builds the validation grid and spotlight, then loads both maps on first interaction', async () => {
    useUtil({ onFirstInteractionOrIdle: (fn) => fn(), importOrReload: (load) => load() });
    await boot('home.js', {
      data: { mapboxApiKey: 'pk.test' },
      markup: '<div id="landing-validation-container"></div><div id="access-score-spotlight-container"></div>',
    });
    expect(h.grid[0].args).toEqual([el('landing-validation-container')]);
    expect(h.spotlight[0].args).toEqual([el('access-score-spotlight-container')]);
    expect(h.maps.map((m) => [m.mapName, m.mapboxApiKey])).toEqual([
      ['landing-choropleth', 'pk.test'], ['deployment-map', 'pk.test'],
    ]);
    expect(window.choropleth).toBeDefined();
    expect(window.deploymentMap).toBeDefined();
  });

  test('a map bundle that fails to load is logged', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('chunk 404');
    useUtil({ onFirstInteractionOrIdle: (fn) => fn(), importOrReload: () => Promise.reject(failure) });
    await boot('home.js');
    expect(error).toHaveBeenCalledWith('Failed to load the landing page maps', failure);
  });
});

describe('the route builder', () => {
  test('asks for regions, streets and map params at once, and draws each layer as it lands', async () => {
    const fetchJson = vi.fn((url) => Promise.resolve(`${url} body`));
    useUtil({ fetchJson });
    await boot('routeBuilder.js', { data: { mapboxApiKey: 'pk.test', signedIn: 'true', minutesPerHundredM: '1.5' } });
    expect(fetchJson.mock.calls.map(([url]) => url))
      .toEqual(['/regions', '/contribution/streets/all?filterLowQuality=true', '/cityMapParams']);
    expect(h.routeBuilder[0].args).toEqual(['pk.test', '/cityMapParams body', true, 1.5]);
    expect(h.routeBuilder[0].calls).toEqual([
      ['renderRegions', '/regions body'], ['renderStreets', '/contribution/streets/all?filterLowQuality=true body'],
    ]);
  });

  test('a layer that fails to load is logged, and the other still draws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('500');
    useUtil({ fetchJson: (url) => (url === '/regions' ? Promise.reject(failure) : Promise.resolve({})) });
    await boot('routeBuilder.js', { data: { signedIn: 'false' } });
    expect(h.routeBuilder[0].args[2]).toBe(false);
    expect(error).toHaveBeenCalledWith('Failed to load or draw regions:', failure);
    expect(h.routeBuilder[0].calls).toEqual([['renderStreets', {}]]);

    useUtil({ fetchJson: (url) => (url.startsWith('/contribution') ? Promise.reject(failure) : Promise.resolve({})) });
    await boot('routeBuilder.js');
    expect(error).toHaveBeenCalledWith('Failed to load or draw streets:', failure);
  });
});

describe('the other single-purpose entries', () => {
  test('/routes lists the routes', async () => {
    await boot('routes.js');
    expect(h.routeList[0].calls).toEqual(['init']);
  });

  test('a shared label\'s page gets the server\'s label data', async () => {
    await boot('sharedLabel.js', { markup: '<script type="application/json" id="page-data">{"label_id":4}</script>' });
    expect(h.sharedLabel[0].args).toEqual([{ label_id: 4 }]);
  });

  test('the gallery starts with the session data and the city\'s viewer', async () => {
    await boot('gallery.js', {
      markup: '<script type="application/json" id="page-data">{"imagerySource":"gsv"}</script>',
    });
    expect(h.gallery).toEqual({ imagerySource: 'gsv', viewerType: h.Viewer });
  });

  test('the welcome page saves its privacy choice to the page\'s URL', async () => {
    await boot('welcome.js', { data: { saveUrl: '/userapi/privacy' } });
    expect(h.welcome[0].args).toEqual([{ saveUrl: '/userapi/privacy' }]);
  });

  test('settings get the account\'s values, and both account forms are wired once the DOM is in', async () => {
    await boot('dashboard/settings.js', {
      data: { saveUrl: '/userapi/settings', username: 'mikey', units: 'metric' },
      markup: '<form id="set-password-form"></form><form id="set-devices-form"></form>',
    });
    expect(h.settings[0].args)
      .toEqual([{ saveUrl: '/userapi/settings', currentUsername: 'mikey', currentUnits: 'metric' }]);
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(h.accountForm.map((r) => r.args[0])).toEqual([el('set-password-form'), el('set-devices-form')]);
  });

  test('the manage-user page gets the user and their endpoints, and links each user\'s own page', async () => {
    const data = { userId: 'u-1', username: 'mikey', saveUrl: '/s', flagsUrl: '/f', hoursUrl: '/h' };
    await boot('dashboard/manageUser.js', { data });
    const [opts] = h.adminUser[0].args;
    expect(opts).toMatchObject(data);
    expect(opts.pageUrlFor('a b/c')).toBe('/admin/user/a%20b%2Fc/manage');
  });

  test('every page starts the app manager with the server\'s config, and logs footer clicks', async () => {
    const ready = [];
    useUtil({ onDomReady: (fn) => ready.push(fn) });
    window.appManager = { init: vi.fn() };
    await boot('main.js', {
      markup: `<script type="application/json" id="page-config">
        {"csrfToken":"t","i18next":{"lng":"en"},"globals":{"a":1}}
      </script>`,
    });
    expect(h.footerLogging).toBe(true);
    ready.forEach((fn) => fn());
    expect(window.appManager.init).toHaveBeenCalledWith('t', { lng: 'en' }, { a: 1 });
  });
});

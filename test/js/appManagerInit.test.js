/**
 * `window.appManager.init` (frontend/js/common/AppManager.js), the start-up every page runs before any of its own
 * code: page globals, the CSRF fetch wrapper, translations (with India's and Zurich's word overrides merged in), the
 * `distance` formatter every distance on the site is printed through, and `logWebpageActivity`. Runs the real i18next
 * against the real locale files, served through a stubbed fetch, so what is asserted is the text a reader sees (#5840).
 */

import fs from 'fs';
import path from 'path';
import { loadModules, REPO_ROOT } from './loader.js';
import { flush, routeFetch, sentRequests } from './support/routeFetch.js';

/**
 * @param {string} file - A file under public/locales, e.g. 'en/common.json'.
 * @returns {object} Its translations.
 */
const locale = (file) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'public', 'locales', file), 'utf8'));

/** The distance words main.scala.html stamps for a metric reader. */
const METRIC_WORDS = { unitAbbr: 'km', unitAbbrSmall: 'm', unitName: 'kilometers', unitNameSingular: 'kilometer' };
/** And for an imperial one. */
const IMPERIAL_WORDS = { unitAbbr: 'mi', unitAbbrSmall: 'ft', unitName: 'miles', unitNameSingular: 'mile' };

/** Every English common-namespace file, as the server lists them in the page config. */
const LOCALE_FILES = ['locales/en/common.json', 'locales/en/common-india.json', 'locales/en/common-zurich.json'];

/**
 * The i18next parameters main.scala.html hands `init`, for an English page in a US city.
 * @param {object} [overrides] - Fields to replace.
 * @returns {object} The parameters.
 */
const i18nParams = (overrides = {}) => ({
  language: 'en',
  supportedLanguages: ['en', 'es'],
  localeFiles: LOCALE_FILES,
  defaultNS: 'common',
  namespaces: ['common'],
  countryId: 'usa',
  unitWords: METRIC_WORDS,
  ...overrides,
});

let appManager;
let i18next;
let util;
let fetchStub;

/**
 * Serves the locale files and the activity log, then loads a fresh AppManager without starting it.
 * @param {object} [routes] - More fetch routes, or replacements for these.
 */
async function load(routes = {}) {
  fetchStub = routeFetch({
    '/assets/locales/en/common.json': locale('en/common.json'),
    '/assets/locales/en/common-india.json': locale('en/common-india.json'),
    '/assets/locales/en/common-zurich.json': locale('en/common-zurich.json'),
    'POST /userapi/logWebpageActivity': {},
    ...routes,
  });
  ({ util } = await loadModules('frontend/js/common/AppManager.js', 'frontend/js/common/utilities.js'));
  ({ default: i18next } = await import('i18next'));
  appManager = window.appManager;
}

/**
 * Loads a fresh AppManager and runs the page start-up.
 * @param {object} [params] - Overrides for the i18next parameters.
 * @param {object} [globals] - What the page puts on `window`.
 * @returns {Promise<void>} Settles once start-up has.
 */
async function start(params = {}, globals = {}) {
  await load();
  return appManager.init('csrf-token', i18nParams(params), globals);
}

afterEach(() => {
  delete window.appManager;
  delete window.logWebpageActivity;
  delete document.documentElement.dataset.measurementSystem;
  document.body.innerHTML = '';
});

describe('AppManager start-up', () => {
  test('puts the page\'s globals on window before anything else runs', async () => {
    await load();
    const seen = vi.fn();
    appManager.addInitTask('reads-a-global', () => seen(window.regionId));
    await appManager.init('csrf-token', i18nParams(), { regionId: 12 });
    expect(window.regionId).toBe(12);
    expect(seen).toHaveBeenCalledWith(12);
    delete window.regionId;
  });

  test('starts once, however many times it is asked', async () => {
    await load();
    const first = appManager.init('csrf-token', i18nParams());
    expect(appManager.init('csrf-token', i18nParams())).toBe(first);
    await first;
    expect(sentRequests(fetchStub).filter(({ url }) => url.endsWith('/en/common.json'))).toHaveLength(1);
  });

  test('refuses a task added after start-up began, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await load();
    const started = appManager.init('csrf-token', i18nParams());
    const late = vi.fn();
    appManager.addInitTask('late', late);
    await started;
    expect(late).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('Cannot add init task \'late\' - initialization already started');
  });

  test('waits for an asynchronous task before calling the page ready', async () => {
    await load();
    let finish;
    appManager.addInitTask('slow', () => new Promise((resolve) => { finish = resolve; }));
    const ready = vi.fn();
    appManager.ready(ready);
    const started = appManager.init('csrf-token', i18nParams());
    await flush();
    expect(ready).not.toHaveBeenCalled();
    finish();
    await started;
    expect(ready).toHaveBeenCalledTimes(1);
  });

  test('names the task that failed and never calls the page ready', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await load();
    const cause = new Error('boom');
    appManager.addInitTask('page-setup', () => { throw cause; });
    const ready = vi.fn();
    appManager.ready(ready);
    await expect(appManager.init('csrf-token', i18nParams()))
      .rejects.toThrow('Initialization failed at task: page-setup');
    expect(ready).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('Init task \'page-setup\' failed:', cause);
    expect(error).toHaveBeenCalledWith('Application initialization failed:', expect.any(Error));
  });
});

describe('AppManager.ready', () => {
  test('runs a callback straight away once the page is ready', async () => {
    await start();
    const callback = vi.fn();
    appManager.ready(callback);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test('keeps going past a callback that throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await load();
    const cause = new Error('page bug');
    const after = vi.fn();
    appManager.ready(() => { throw cause; });
    appManager.ready(after);
    await appManager.init('csrf-token', i18nParams());
    expect(after).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('Error executing app ready callback:', cause);
  });

  test('warns about, and ignores, something that is not a function', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await load();
    appManager.ready('loadMap');
    expect(appManager.readyCallbacks).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith('AppManager.ready() expects a function as argument');
  });
});

describe('translations', () => {
  test('translates the page\'s static markup once the strings arrive', async () => {
    await load();
    document.body.innerHTML = '<span data-i18n="common:curb-ramp">Curb Ramp</span>';
    await appManager.init('csrf-token', i18nParams({ countryId: 'india' }));
    expect(document.querySelector('span').textContent).toBe('Curb Style');
  });

  test('lays India\'s words over the base ones, keeping the base for everything India doesn\'t change', async () => {
    await start({ countryId: 'india' });
    expect(i18next.t('common:curb-ramp')).toBe('Curb Style');
    expect(i18next.t('common:tag.parked bike')).toBe('parked bike/cycle');
    expect(i18next.t('common:no-curb-ramp')).toBe(locale('en/common.json')['no-curb-ramp']);
  });

  test('lays Zurich\'s words over the base ones', async () => {
    await start({ countryId: 'switzerland' });
    expect(i18next.t('common:tag.pole')).toBe('pole / traffic sign / lamppost');
  });

  test('uses no override in a country that has none', async () => {
    await start();
    expect(i18next.t('common:curb-ramp')).toBe('Curb Ramp');
    expect(sentRequests(fetchStub).map(({ url }) => url)).not.toContainEqual(expect.stringContaining('-india'));
  });

  // Most overrides exist only in English; asking for the rest would print a 404 per namespace per page.
  test('requests only the files that exist, falling back to English for the rest', async () => {
    await start({ language: 'es', countryId: 'india' });
    expect(sentRequests(fetchStub).map(({ url }) => url).sort()).toEqual([
      '/assets/locales/en/common-india.json', '/assets/locales/en/common.json',
    ]);
    expect(i18next.t('common:curb-ramp')).toBe('Curb Style');
  });

  test('says so loudly when the page lists no locale files at all', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await start({ localeFiles: [] });
    expect(error).toHaveBeenCalledWith('AppManager: no locale files listed, so nothing will be translated');
  });

  test('still finishes start-up when a file fails, and logs why', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await load({ '/assets/locales/en/common.json': { status: 404 } });
    const ready = vi.fn();
    appManager.ready(ready);
    await appManager.init('csrf-token', i18nParams());
    expect(ready).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith([expect.stringContaining('/assets/locales/en/common.json')]);
  });
});

describe('the distance formatter', () => {
  describe('for a metric reader', () => {
    beforeEach(async () => {
      document.documentElement.dataset.measurementSystem = 'metric';
      await start({ unitWords: METRIC_WORDS });
    });

    test('rounds a mission-scale distance to the nearest 25 m', () => {
      expect(util.distanceToString(437)).toBe('425 m');
    });

    test('prints a long distance in kilometers, to the precision asked', () => {
      expect(util.longDistanceToString(12.345, 1)).toBe('12.3 km');
      expect(util.metersToLongDistanceString(1500, 1)).toBe('1.5 km');
    });

    test('drops the unit where a column header already names it', () => {
      expect(util.longDistanceToString(1234.5, 0, false)).toBe('1,235');
    });

    test('prints a short distance exactly rather than to the nearest 25', () => {
      expect(util.fineDistanceToString(1.5, 1)).toBe('1.5 m');
    });

    test('plots a distance in kilometers', () => {
      expect(util.metersToLongDistance(2500)).toBe(2.5);
    });

    // Sums over an empty set come back null from the server.
    test('reads a missing distance as zero', () => {
      expect(util.longDistanceToString(null)).toBe('0 km');
      expect(util.metersToLongDistanceString(undefined)).toBe('0 km');
      expect(util.fineDistanceToString(null)).toBe('0 m');
      expect(util.metersToLongDistance(null)).toBe(0);
    });

    test('fills in the reader\'s unit name in any string, with no argument at the call site', () => {
      i18next.addResource('en', 'common', 'test-goal', 'Walk {{meters, distance(style: small)}} of {{unitName}}');
      expect(i18next.t('common:test-goal', { meters: 437 })).toBe('Walk 425 m of kilometers');
    });
  });

  describe('for an imperial reader', () => {
    beforeEach(async () => {
      document.documentElement.dataset.measurementSystem = 'imperial';
      await start({ unitWords: IMPERIAL_WORDS });
    });

    test('converts a mission-scale distance to feet before rounding it', () => {
      // 437 m is 1,433.7 ft.
      expect(util.distanceToString(437)).toBe('1,425 ft');
    });

    test('converts a long distance to miles', () => {
      expect(util.longDistanceToString(12.345, 1)).toBe('7.7 mi');
    });

    test('converts a short distance to feet', () => {
      expect(util.fineDistanceToString(1.5)).toBe('5 ft');
    });

    test('plots a distance in miles', () => {
      expect(util.metersToLongDistance(1609.344)).toBeCloseTo(1, 10);
    });
  });
});

describe('logWebpageActivity', () => {
  test('posts the activity in a request that outlives the page it is sent from', async () => {
    await start();
    window.logWebpageActivity('Click_module=Navbar_target=Explore');
    await flush();
    const [request] = sentRequests(fetchStub).filter(({ url }) => url === '/userapi/logWebpageActivity');
    expect(request).toEqual({
      method: 'POST', url: '/userapi/logWebpageActivity', body: 'Click_module=Navbar_target=Explore',
    });
    expect(fetchStub.mock.lastCall[1].keepalive).toBe(true);
    // Through the CSRF wrapper, so Play accepts it.
    expect(fetchStub.mock.lastCall[1].headers.get('Csrf-Token')).toBe('csrf-token');
  });

  test('logs a rejected entry', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await load({ 'POST /userapi/logWebpageActivity': { status: 500 } });
    await appManager.init('csrf-token', i18nParams());
    window.logWebpageActivity('Click_module=Navbar_target=Explore');
    await flush();
    expect(error).toHaveBeenCalledWith('logWebpageActivity failed: 500');
  });

  test('logs a request that never got through', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const offline = new TypeError('Failed to fetch');
    await load({ 'POST /userapi/logWebpageActivity': offline });
    await appManager.init('csrf-token', i18nParams());
    window.logWebpageActivity('Click_module=Navbar_target=Explore');
    await flush();
    expect(error).toHaveBeenCalledWith(offline);
  });
});

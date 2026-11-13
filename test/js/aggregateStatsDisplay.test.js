/**
 * What frontend/js/common/aggregateStats.js writes on each of the three pages that load it: the API docs landing
 * paragraph, the Cities API intro, and the About page's live numbers. Each page has only its own target, and a failed
 * load must leave every page readable, with the About page's server-rendered numbers in place. The retry timing has
 * its own suite (aggregateStatsRetry.test.js). (#5840)
 */

import { loadModules, mockModule } from './loader.js';
import { routeFetch } from './support/routeFetch.js';

const i18next = { t: (key, { val }) => Number(val).toLocaleString('en-US') };
mockModule('i18next', () => ({ default: i18next }));

// jsdom lacks AbortSignal.timeout(); fetch is stubbed, so the signal never has to fire.
if (typeof AbortSignal.timeout !== 'function') AbortSignal.timeout = () => new AbortController().signal;

window.appManager = { ready: () => {} };
const { loadProjectSidewalkStats } = await loadModules('frontend/js/common/aggregateStats.js');

/** A /v3/api/aggregateStats answer, snake_case as the API serves it. */
const STATS = {
  status: 'OK',
  km_explored: 32456.7,
  km_explored_no_overlap: 30000,
  total_labels: 1650000,
  total_validations: 2100000,
  num_cities: 54,
  num_countries: 13,
  num_languages: 7,
  by_label_type: {},
};

/** The no-JS fallbacks, cut down from apiDocs/index, apiDocs/cities and about.scala.html. */
const PAGES = {
  landing: '<p id="project-sidewalk-aggregate-stats">We have deployed Project Sidewalk in cities.</p>',
  cities: '<p id="cities-deployment-stats">Project Sidewalk is deployed in multiple cities.</p>',
  about: `
    <span class="about-stat-number" data-live-stat="km_explored">30,000+</span>
    <span class="about-stat-number" data-live-stat="num_cities">54</span>`,
};

/** @returns {string} What a reader sees on the page, whitespace collapsed. */
const pageText = () => document.body.textContent.replace(/\s+/g, ' ').trim();

/**
 * Loads the stats against the given answer, skipping the retries' waits.
 * @param {any} answer - What /v3/api/aggregateStats answers every attempt with (see routeFetch).
 */
async function load(answer) {
  vi.useFakeTimers();
  routeFetch({ '/v3/api/aggregateStats': answer });
  const done = loadProjectSidewalkStats();
  await vi.runAllTimersAsync();
  await done;
}

describe('a successful load', () => {
  test('fills the API docs landing paragraph with the live counts', async () => {
    document.body.innerHTML = PAGES.landing;
    await load(STATS);
    expect(pageText()).toContain('in 54 cities across 13 countries and 7 natively translated languages');
    expect(pageText()).toContain('assessed over 32,457 km (20,168 mi) of city streets');
    expect(pageText()).toContain('contributing 1,650,000 labels and 2,100,000 validations');
  });

  test('fills the Cities API intro', async () => {
    document.body.innerHTML = PAGES.cities;
    await load(STATS);
    expect(pageText()).toContain('Project Sidewalk is deployed in 54 cities across 13 countries.');
  });

  test('replaces only the numbers on the About page, keeping its translated copy', async () => {
    document.body.innerHTML = PAGES.about;
    await load(STATS);
    expect([...document.querySelectorAll('[data-live-stat]')].map((el) => el.textContent)).toEqual(['32,457', '54']);
  });
});

describe('a failed load', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('keeps the landing paragraph readable and says why the numbers are missing', async () => {
    document.body.innerHTML = PAGES.landing;
    await load({ status: 503 });
    expect(pageText()).toContain('assessed thousands of kilometers of city streets');
    expect(pageText()).toContain('Unable to load real-time statistics. Unable to fetch aggregate statistics: HTTP 503');
  });

  test('keeps the Cities API intro readable', async () => {
    document.body.innerHTML = PAGES.cities;
    await load({ status: 503 });
    expect(pageText()).toContain('deployed in multiple cities across several countries');
    expect(pageText()).toContain('Unable to load real-time statistics.');
  });

  test('leaves the About page\'s own numbers in place', async () => {
    document.body.innerHTML = PAGES.about;
    await load({ status: 503 });
    expect([...document.querySelectorAll('[data-live-stat]')].map((el) => el.textContent)).toEqual(['30,000+', '54']);
  });

  test('turns down an answer missing a count rather than print "undefined cities"', async () => {
    document.body.innerHTML = PAGES.landing;
    await load({ ...STATS, num_cities: undefined });
    expect(pageText()).toContain('Missing or invalid fields in API response: num_cities');
    expect(pageText()).not.toContain('undefined');
  });

  test.each([
    ['TimeoutError', 'Request timed out after 15 seconds'],
    ['AbortError', 'Request timed out after 15 seconds'],
    ['TypeError', 'Failed to fetch'],
  ])('explains a %s in words a reader can act on', async (name, message) => {
    document.body.innerHTML = PAGES.landing;
    await load(Object.assign(new Error(name === 'TypeError' ? 'Failed to fetch' : 'signal is aborted'), { name }));
    expect(pageText()).toContain(message);
    expect(pageText()).not.toContain('signal is aborted');
  });

  test('shows a loading note while the numbers are on their way', async () => {
    document.body.innerHTML = PAGES.landing + PAGES.cities;
    routeFetch({ '/v3/api/aggregateStats': () => new Promise(() => {}) });
    loadProjectSidewalkStats();
    expect(document.getElementById('project-sidewalk-aggregate-stats').textContent)
      .toBe('Loading Project Sidewalk statistics...');
    expect(pageText()).toContain('deployed in multiple cities across several countries');
  });
});

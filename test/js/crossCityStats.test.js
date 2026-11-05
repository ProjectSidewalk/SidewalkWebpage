/**
 * Tests for CrossCityStats, the dashboard's "Cities you've mapped" section (#4496).
 *
 * The section's whole premise is that its numbers reconcile — with the hero KPIs above it and with each other — so
 * the cases here are the ones where a plausible implementation quietly stops adding up: a band total that floors
 * differently than the column it sums, and an intro that asserts work an empty account hasn't done. The escaping
 * cases cover the other direction: i18next escapes interpolated values by default, which is wrong both for a string
 * going into textContent and for one this file escapes itself.
 */

import fs from 'fs';
import path from 'path';
import { loadModules, mockModule, REPO_ROOT } from './loader.js';
import { routeFetch, textOf } from './support/routeFetch.js';
import { fakeMapboxgl } from './support/psMapHarness.js';

const STATS_URL = '/userapi/crossCityStats';
const CITIES_URL = '/v3/api/cities';

// The shared fake popup has no remove(); the map's mouseleave closes the popup with it.
const mapboxgl = fakeMapboxgl();
const RecordingPopup = mapboxgl.Popup;
mapboxgl.Popup = class extends RecordingPopup {
  /** @returns {object} This popup, closed. */
  remove() { this.open = false; return this; }
};
mockModule('frontend/js/common/mapboxgl.js', () => ({ default: mapboxgl }));

/** The subset of dashboard.json this section reads, verbatim, so the tests break if a placeholder is renamed. */
const STRINGS = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'public/locales/en/dashboard.json'), 'utf8')).cities;

const htmlEscape = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Minimal i18next stand-in that reproduces the one behavior under test: with the app's `escapeValue: false` default
 * (AppManager._setupI18next), interpolated values are HTML-escaped only where the call asks for it.
 */
const i18nextStub = {
  language: 'en',
  t(namespacedKey, opts = {}) {
    const template = STRINGS[namespacedKey.replace('dashboard:cities.', '')];
    if (template === undefined) return namespacedKey;
    const escapes = opts.interpolation?.escapeValue === true;
    return Object.entries(opts).reduce((out, [name, value]) => {
      if (name === 'interpolation') return out;
      return out.split(`{{${name}}}`).join(escapes ? htmlEscape(value) : String(value));
    }, template);
  },
};

/** The section markup from dashboard.scala.html, trimmed to what CrossCityStats touches. */
function buildDom() {
  document.body.innerHTML = `
    <span id="ud-cities-status" role="status" aria-live="polite"></span>
    <div class="page-section" id="ud-cities-section" hidden>
      <h2 class="page-heading" id="cities">Cities you've mapped <a href="#cities" class="permalink">#</a></h2>
      <p id="ud-cities-intro"></p>
      <div class="ud-community-band" id="ud-cities-band" hidden>
        <span id="ud-cities-total-cities"></span>
        <span id="ud-cities-total-labels"></span>
        <span id="ud-cities-total-validations"></span>
        <span id="ud-cities-total-distance"></span>
      </div>
      <p id="ud-cities-map-caption" hidden></p>
      <div id="ud-cities-map" hidden></div>
      <div id="ud-cities-table-holder"></div>
      <p id="ud-cities-footnote" hidden></p>
      <div id="ud-cities-nudge" hidden></div>
    </div>
    <div class="ud-trophy-case"></div>
    <div class="ud-nudge" id="ud-trophy-none">No trophies yet.</div>`;
  return document.getElementById('ud-cities-section');
}

const city = (overrides) => ({
  city_id: 'seattle',
  city_name: 'Seattle',
  city_url: 'https://sidewalk-sea.cs.washington.edu',
  is_current_city: false,
  labels: 10,
  validations: 5,
  missions: 2,
  distance: 1.0,
  live_distance: false,
  last_activity: null,
  ...overrides,
});

/**
 * Runs a full render() against stubbed endpoints and returns the section element.
 * @param {object} payload - What the stats endpoint answers (any `routeFetch` answer).
 * @param {object} [opts] - CrossCityStats options to add or replace.
 * @param {object} [geo] - What /v3/api/cities answers, for a render that draws the map.
 * @returns {Promise<HTMLElement>} The section.
 */
async function render(payload, opts = {}, geo = { cities: [] }) {
  const section = buildDom();
  routeFetch({ [STATS_URL]: payload, [CITIES_URL]: geo });
  await new CrossCityStats(section, { statsUrl: STATS_URL, currentCityName: 'Seattle', ...opts }).render();
  return section;
}

const payloadOf = (cities, extra = {}) => ({
  cities,
  total_labels: cities.reduce((s, c) => s + c.labels, 0),
  total_validations: cities.reduce((s, c) => s + c.validations, 0),
  total_missions: cities.reduce((s, c) => s + c.missions, 0),
  total_distance: cities.reduce((s, c) => s + c.distance, 0),
  public_city_count: 51,
  distance_unit: 'km',
  ...extra,
});

mockModule('i18next', () => ({ default: i18nextStub }));
const { CrossCityStats } = await loadModules('frontend/js/user-dashboard/CrossCityStats.js');

const text = (section, id) => section.querySelector(`#${id}`).textContent;

describe('the roll-up band', () => {
  test('totals the distance column as displayed, not as stored', async () => {
    // Each row floors to 1.5, so the column reads 4.5. Flooring the raw sum instead gives 4.6 — a band that is a
    // tenth above the three numbers printed directly beneath it.
    const cities = [city({ distance: 1.55 }), city({ city_id: 'a', distance: 1.55 }),
      city({ city_id: 'b', distance: 1.55 })];
    const section = await render(payloadOf(cities));

    expect(text(section, 'ud-cities-total-distance')).toBe('4.5 km');
  });

  test('floors rather than rounds, matching the hero KPI', async () => {
    const cities = [city({ distance: 2.99 }), city({ city_id: 'a', distance: 0 })];
    const section = await render(payloadOf(cities));

    expect(section.querySelector('#ud-cities-table-holder').textContent).toContain('2.9 km');
    expect(text(section, 'ud-cities-total-distance')).toBe('2.9 km');
  });

  test('survives a sum that floating point leaves a hair under its decimal', async () => {
    // 0.7 + 0.1 is 0.7999999999999999; flooring that again would print 0.7 for a column that reads 0.7 and 0.1.
    const cities = [city({ distance: 0.7 }), city({ city_id: 'a', distance: 0.1 })];
    const section = await render(payloadOf(cities));

    expect(text(section, 'ud-cities-total-distance')).toBe('0.8 km');
  });
});

describe('the intro line', () => {
  test('does not claim work in a city for an account that has done none', async () => {
    const section = await render(payloadOf([]));

    expect(text(section, 'ud-cities-intro')).toBe(STRINGS['intro-empty']);
    expect(text(section, 'ud-cities-intro')).not.toContain('Seattle');
  });

  test('names the city for a mapper who has worked in exactly one', async () => {
    const section = await render(payloadOf([city({ is_current_city: true })]));

    expect(text(section, 'ud-cities-intro')).toBe('Your work in Seattle so far. '
      + 'One account works in every Project Sidewalk city.');
  });
});

describe('the city column', () => {
  test('links every city the mapper has worked in, launched publicly or not', async () => {
    // An unlaunched deployment reaches the payload with a URL like any other: the mapper has already been there, so
    // withholding the link only costs them the trip (#4979).
    const cities = [city(), city({ city_id: 'crowdstudy', city_name: 'Crowd Study', city_url: 'https://study.example' })];
    const section = await render(payloadOf(cities));

    const hrefs = [...section.querySelectorAll('#ud-cities-table-holder a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://sidewalk-sea.cs.washington.edu/dashboard', 'https://study.example/dashboard']);
  });

  test('leaves a city with no URL as plain text rather than a dead link', async () => {
    const section = await render(payloadOf([city({ city_url: '' })]));
    const holder = section.querySelector('#ud-cities-table-holder');

    expect(holder.querySelector('a')).toBeNull();
    expect(holder.textContent).toContain('Seattle');
  });
});

describe('city names carrying HTML metacharacters', () => {
  const apostrophe = { city_id: 'cda', city_name: "Coeur d'Alene", is_current_city: true };

  test('read as themselves in a plain-text sink', async () => {
    const section = await render(payloadOf([city(apostrophe)]));

    expect(text(section, 'ud-cities-intro')).toContain("Coeur d'Alene");
    expect(text(section, 'ud-cities-intro')).not.toContain('&#39;');
  });

  test('survive the footnote, the other string this file drops into textContent', async () => {
    const section = await render(payloadOf([city(apostrophe), city({ city_id: 'a' })]));

    expect(text(section, 'ud-cities-footnote')).toContain("Coeur d'Alene");
    expect(text(section, 'ud-cities-footnote')).not.toContain('&#39;');
  });

  test('are escaped exactly once on the way into a table cell', async () => {
    const section = await render(payloadOf([city(apostrophe), city({ city_id: 'a' })]));

    // Escaped twice, this cell would read "Coeur d&#39;Alene" once the parser is done with it.
    expect(section.querySelector('#ud-cities-table-holder th[scope="row"] a').textContent).toBe("Coeur d'Alene");
  });

  test('do not double-escape a translated string this file escapes itself', async () => {
    // "you're here" carries an apostrophe in the string itself, which i18next never escapes — only #esc should.
    const section = await render(payloadOf([city({ is_current_city: true }), city({ city_id: 'a' })]));
    const badge = section.querySelector('.ud-cities-here');

    expect(badge.textContent).toBe("you're here");
  });
});

describe('the section announcement', () => {
  test('tells assistive tech which section arrived, naming it without the permalink hash', async () => {
    await render(payloadOf([city({ is_current_city: true })]));

    expect(document.getElementById('ud-cities-status').textContent)
      .toBe("New section available: Cities you've mapped.");
  });

  test('stays silent when the breakdown cannot be computed', async () => {
    const section = await render({ unavailable: true });

    expect(section.hidden).toBe(true);
    expect(document.getElementById('ud-cities-status').textContent).toBe('');
  });
});

describe('loading the breakdown', () => {
  test('keeps the section hidden, and says why in the console, when the request fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const section = await render({ status: 503 });

    expect(section.hidden).toBe(true);
    expect(error).toHaveBeenCalledWith('Cross-city stats failed to load; hiding the section', expect.any(Error));
  });

  test('asks the page shell to add the section to "On this page" once it shows', async () => {
    const shell = { refreshTableOfContents: vi.fn() };
    window.adminShell = shell;
    const section = await render(payloadOf([city({ is_current_city: true })]));
    delete window.adminShell;

    expect(section.hidden).toBe(false);
    expect(shell.refreshTableOfContents).toHaveBeenCalledTimes(1);
  });

  test('reads a payload with no city list as an account with no work yet', async () => {
    const section = await render({ public_city_count: 51, distance_unit: 'km' });

    expect(text(section, 'ud-cities-intro')).toBe(STRINGS['intro-empty']);
    expect(section.querySelector('#ud-cities-table-holder').children).toHaveLength(0);
  });
});

describe('the nudge toward other cities', () => {
  test('tells a one-city mapper their account already works everywhere, and links the city list', async () => {
    const section = await render(payloadOf([city({ is_current_city: true })]));
    const nudge = section.querySelector('#ud-cities-nudge');

    expect(nudge.hidden).toBe(false);
    expect(textOf(nudge)).toBe('Project Sidewalk maps sidewalks in 51 cities, and your account already works in '
      + 'every one. See every city');
    expect(nudge.querySelector('a').getAttribute('href')).toBe('/cities');
  });

  test('invites someone with no work anywhere to pick a city', async () => {
    const section = await render(payloadOf([]));

    expect(textOf(section.querySelector('#ud-cities-nudge')))
      .toBe('Project Sidewalk maps sidewalks in 51 cities. Pick one and start exploring. See every city');
  });

  test('is not shown to a mapper with several cities, who gets the band instead', async () => {
    const section = await render(payloadOf([city(), city({ city_id: 'a' })]));

    expect(section.querySelector('#ud-cities-nudge').hidden).toBe(true);
    expect(section.querySelector('#ud-cities-band').hidden).toBe(false);
    expect(text(section, 'ud-cities-intro'))
      .toBe("You've contributed in 2 Project Sidewalk cities — 20 labels in all.");
  });
});

describe('the Globetrotter trophy', () => {
  test('lands first in the trophy case and clears its "no trophies" note', async () => {
    document.body.innerHTML = '';
    const section = await render(payloadOf([city(), city({ city_id: 'a' }), city({ city_id: 'b' })]));

    const trophy = document.querySelector('.ud-trophy-case').firstElementChild;
    expect(trophy.classList.contains('ud-trophy-globetrotter')).toBe(true);
    expect(textOf(trophy)).toBe('🌍 Globetrotter Active in 3 cities');
    expect(document.getElementById('ud-trophy-none').hidden).toBe(true);
    expect(section.hidden).toBe(false);
  });

  test('is not awarded for a single city', async () => {
    await render(payloadOf([city({ is_current_city: true })]));

    expect(document.querySelector('.ud-trophy-globetrotter')).toBeNull();
    expect(document.getElementById('ud-trophy-none').hidden).toBe(false);
  });
});

describe('the distance footnote', () => {
  test('stays hidden when every city\'s distance was measured live', async () => {
    const cities = [city({ live_distance: true }), city({ city_id: 'a', live_distance: true })];
    const section = await render(payloadOf(cities));

    expect(section.querySelector('#ud-cities-footnote').hidden).toBe(true);
  });

  test('names the deployment from the page when this city is not among the rows', async () => {
    const section = await render(payloadOf([city({ city_name: 'Chicago' }), city({ city_id: 'a', city_name: 'Oslo' })]),
      { currentCityName: 'Zürich' });

    expect(text(section, 'ud-cities-footnote')).toContain('Distance outside Zürich');
  });
});

describe('the band\'s big numbers', () => {
  /**
   * @param {HTMLElement} section - The rendered section.
   * @param {string} id - A band tile's id.
   * @returns {{full: ?string, short: ?string, text: string}} The tile's exact and short forms, if split.
   */
  const tile = (section, id) => {
    const el = section.querySelector(`#${id}`);
    return {
      full: el.querySelector('.ud-value-full')?.textContent ?? null,
      short: el.querySelector('.ud-value-short')?.textContent ?? null,
      text: el.textContent,
    };
  };

  test('carry the exact figure plus a short one for narrow widths, once they pass ten thousand', async () => {
    const cities = [city({ labels: 1234567, validations: 12345, distance: 12000.25 }),
      city({ city_id: 'a', labels: 0, validations: 0, distance: 345.5 })];
    const section = await render(payloadOf(cities));

    expect(tile(section, 'ud-cities-total-labels'))
      .toEqual({ full: '1,234,567', short: '1.2M', text: '1,234,5671.2M' });
    expect(tile(section, 'ud-cities-total-validations')).toMatchObject({ full: '12,345', short: '12k' });
    expect(tile(section, 'ud-cities-total-distance')).toMatchObject({ full: '12345.7 km', short: '12k km' });
    expect(section.querySelector('#ud-cities-total-labels .ud-value-short').getAttribute('aria-hidden')).toBe('true');
  });

  test('call a count that rounds to a thousand thousands a million, not "1000k"', async () => {
    const section = await render(payloadOf([city({ labels: 999999 }), city({ city_id: 'a', labels: 0 })]));

    expect(tile(section, 'ud-cities-total-labels').short).toBe('1.0M');
  });

  test('leave a small figure as one plain number', async () => {
    const section = await render(payloadOf([city({ validations: 0 }), city({ city_id: 'a', validations: 0 })]));

    expect(tile(section, 'ud-cities-total-validations')).toEqual({ full: null, short: null, text: '0' });
  });

  test('drop the unit cleanly when the payload has none', async () => {
    const section = await render(payloadOf([city({ distance: 12000 }), city({ city_id: 'a', distance: 1 })],
      { distance_unit: undefined }));

    expect(tile(section, 'ud-cities-total-distance')).toMatchObject({ full: '12001.0', short: '12k' });
  });
});

describe('the last-labeled column', () => {
  /**
   * @param {HTMLElement} section - The rendered section.
   * @returns {Array<string>} Each row's last-labeled cell.
   */
  const lastLabeled = (section) =>
    [...section.querySelectorAll('#ud-cities-table-holder tbody tr')].map((tr) => tr.lastElementChild.textContent);

  test('reads a month and year, or a dash for a city the mapper only validated in', async () => {
    const section = await render(payloadOf([city({ last_activity: '2026-03-15T18:00:00Z' }),
      city({ city_id: 'a', last_activity: null }), city({ city_id: 'b', last_activity: 'garbled' })]));

    expect(lastLabeled(section)).toEqual(['Mar 2026', '—', '—']);
  });
});

describe('a section missing its optional pieces', () => {
  test('still shows what it can rather than throwing', async () => {
    document.body.innerHTML = '<div id="ud-cities-section" hidden></div>';
    const section = document.getElementById('ud-cities-section');
    routeFetch({ [STATS_URL]: payloadOf([city(), city({ city_id: 'a' })]) });
    await new CrossCityStats(section, { statsUrl: STATS_URL, currentCityName: 'Seattle', mapboxApiKey: 'pk.test' })
      .render();

    routeFetch({ [STATS_URL]: payloadOf([city()]) });
    await new CrossCityStats(section, { statsUrl: STATS_URL, currentCityName: 'Seattle' }).render();

    expect(section.hidden).toBe(false);
  });

  test('draws the map and awards the trophy without a map caption or a "no trophies" note', async () => {
    document.body.innerHTML = `
      <div id="ud-cities-section" hidden><div id="ud-cities-map" hidden></div></div>
      <div class="ud-trophy-case"></div>`;
    const section = document.getElementById('ud-cities-section');
    routeFetch({ [STATS_URL]: payloadOf([city(), city({ city_id: 'a' })]),
      [CITIES_URL]: { cities: [{ city_id: 'seattle', center_lng: -122.3, center_lat: 47.6 }] } });

    await new CrossCityStats(section, { statsUrl: STATS_URL, currentCityName: 'Seattle', mapboxApiKey: 'pk.test' })
      .render();

    expect(section.querySelector('#ud-cities-map').hidden).toBe(false);
    expect(document.querySelector('.ud-trophy-globetrotter')).not.toBeNull();
  });
});

describe('the world map', () => {
  /** @returns {object} The one map the section drew. */
  const theMap = () => mapboxgl.maps.at(-1);

  /**
   * One city as /v3/api/cities sends it.
   * @param {string} id - Its city_id.
   * @param {?[number, number]} center - Its [lng, lat], or null for a city with no map parameters.
   * @returns {object} The city entry.
   */
  const geoCity = (id, center) => ({
    city_id: id, city_name_short: id, ...(center ? { center_lng: center[0], center_lat: center[1] } : {}),
  });

  const CITIES = [
    city({ city_id: 'seattle', labels: 400, validations: 5 }),
    city({ city_id: 'chicago', city_name: 'Chicago', labels: 100, validations: 0 }),
    city({ city_id: 'oslo', city_name: 'Oslo', labels: 0 }),
    city({ city_id: 'newberg', city_name: 'Newberg', labels: 3 }),
  ];
  const GEO = { cities: [geoCity('seattle', [-122.3, 47.6]), geoCity('chicago', [-87.6, 41.9]),
    geoCity('oslo', [10.7, 59.9]), geoCity('newberg', null), geoCity('zurich', [8.5, 47.4])] };

  beforeEach(() => {
    mapboxgl.maps.length = 0;
    mapboxgl.popups.length = 0;
    mapboxgl.accessToken = null;
  });

  test('draws one dot per city with a known center, sized by area to the labels there', async () => {
    const section = await render(payloadOf(CITIES), { mapboxApiKey: 'pk.test' }, GEO);
    await theMap().fire('load');

    expect(mapboxgl.accessToken).toBe('pk.test');
    expect(section.querySelector('#ud-cities-map').hidden).toBe(false);
    expect(section.querySelector('#ud-cities-map-caption').hidden).toBe(false);
    const { features } = theMap().sources['ud-cities'].data;
    // Newberg has no center and Zürich has no work, so neither gets a dot.
    expect(features.map((f) => f.geometry.coordinates)).toEqual([[-122.3, 47.6], [-87.6, 41.9], [10.7, 59.9]]);
    // Chicago has a quarter of Seattle's labels, so half its extra radius; Oslo's none gets the minimum dot.
    expect(features.map((f) => f.properties.radius)).toEqual([24, 15, 6]);
    expect(theMap().layers['ud-cities-circles'].paint['circle-radius']).toEqual(['get', 'radius']);
  });

  test('opens on the mapper\'s own footprint', async () => {
    await render(payloadOf(CITIES), { mapboxApiKey: 'pk.test' }, GEO);
    await theMap().fire('load');

    expect(theMap().fits).toEqual([{ bounds: [[-122.3, 41.9], [10.7, 59.9]], options: { padding: 60, maxZoom: 6,
      duration: 0 } }]);
  });

  test('names the city and its counts on hover, and clears it when the pointer leaves', async () => {
    await render(payloadOf(CITIES), { mapboxApiKey: 'pk.test' }, GEO);
    await theMap().fire('load');
    const chicago = theMap().sources['ud-cities'].data.features[1];

    await theMap().fire('mouseenter:ud-cities-circles', { features: [chicago] });
    const [popup] = mapboxgl.popups;
    const shown = document.createElement('div');
    shown.innerHTML = popup.html;
    expect(textOf(shown)).toBe('Chicago 100 labels · 0 validations');
    expect(popup.lngLat).toEqual([-87.6, 41.9]);
    expect(theMap().getCanvas().style.cursor).toBe('pointer');

    await theMap().fire('mouseleave:ud-cities-circles');
    expect(popup.open).toBe(false);
    expect(theMap().getCanvas().style.cursor).toBe('');
  });

  test('is skipped without a Mapbox token, without even asking where the cities are', async () => {
    const section = await render(payloadOf(CITIES), {}, GEO);

    expect(mapboxgl.maps).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalledWith(CITIES_URL, expect.anything());
    expect(section.querySelector('#ud-cities-map').hidden).toBe(true);
  });

  test('is skipped, with the rest of the section intact, when the city list fails to load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const section = await render(payloadOf(CITIES), { mapboxApiKey: 'pk.test' }, { status: 500 });

    expect(mapboxgl.maps).toHaveLength(0);
    expect(section.querySelector('#ud-cities-map').hidden).toBe(true);
    expect(section.querySelectorAll('#ud-cities-table-holder tbody tr')).toHaveLength(4);
    expect(error)
      .toHaveBeenCalledWith('City coordinates failed to load; skipping the cross-city map', expect.any(Error));
  });

  test('is skipped when the city list is not a list, or none of the mapper\'s cities has a center', async () => {
    await render(payloadOf(CITIES), { mapboxApiKey: 'pk.test' }, {});
    await render(payloadOf(CITIES), { mapboxApiKey: 'pk.test' }, { cities: [geoCity('seattle', null)] });

    expect(mapboxgl.maps).toHaveLength(0);
    expect(document.getElementById('ud-cities-map').hidden).toBe(true);
  });
});

/**
 * Tests for CrossCityStats, the dashboard's "Cities you've mapped" section (#4496).
 *
 * The section's whole premise is that its numbers reconcile — with the hero KPIs above it and with each other — so
 * the cases here are the ones where a plausible implementation quietly stops adding up: a band total that floors
 * differently than the column it sums, and an intro that asserts work an empty account hasn't done. The escaping
 * cases cover the other direction: i18next escapes interpolated values by default, which is wrong both for a string
 * going into textContent and for one this file escapes itself.
 *
 * Runs under jsdom (jest.config.js). CrossCityStats is a bare top-level class in a concatenated bundle, so it is
 * eval'd into global scope rather than required.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATS_SRC = fs.readFileSync(path.join(REPO_ROOT, 'public/js/user-dashboard/CrossCityStats.js'), 'utf8');
const MATH_SRC = fs.readFileSync(path.join(REPO_ROOT, 'public/js/common/utilitiesMath.js'), 'utf8');

/** The subset of dashboard.json this section reads, verbatim, so the tests break if a placeholder is renamed. */
const STRINGS = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'public/locales/en/dashboard.json'), 'utf8')).cities;

const htmlEscape = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Minimal i18next stand-in that reproduces the one behavior under test: interpolated values are HTML-escaped unless
 * the caller passes `interpolation: { escapeValue: false }`.
 */
const i18nextStub = {
  language: 'en',
  t(namespacedKey, opts = {}) {
    const template = STRINGS[namespacedKey.replace('dashboard:cities.', '')];
    if (template === undefined) return namespacedKey;
    const escapes = opts.interpolation?.escapeValue !== false;
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
    <div class="api-section" id="ud-cities-section" hidden>
      <h2 class="api-heading" id="cities">Cities you've mapped <a href="#cities" class="permalink">#</a></h2>
      <p id="ud-cities-intro"></p>
      <div class="ud-community-band" id="ud-cities-band" hidden>
        <span id="ud-cities-total-cities"></span>
        <span id="ud-cities-total-labels"></span>
        <span id="ud-cities-total-validations"></span>
        <span id="ud-cities-total-distance"></span>
      </div>
      <div id="ud-cities-map"></div>
      <div id="ud-cities-table-holder"></div>
      <p id="ud-cities-footnote" hidden></p>
      <div id="ud-cities-nudge" hidden></div>
    </div>
    <div class="ud-trophy-case"></div>`;
  return document.getElementById('ud-cities-section');
}

const city = (overrides) => ({
  city_id: 'seattle',
  city_name: 'Seattle',
  city_url: 'https://sidewalk-sea.cs.washington.edu',
  linkable: true,
  is_current_city: false,
  labels: 10,
  validations: 5,
  missions: 2,
  distance: 1.0,
  live_distance: false,
  last_activity: null,
  ...overrides,
});

/** Runs a full render() against a stubbed endpoint payload and returns the section element. */
async function render(payload, opts = {}) {
  const section = buildDom();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => payload });
  await new CrossCityStats(section, { currentCityName: 'Seattle', ...opts }).render();
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

let CrossCityStats;

beforeAll(() => {
  (0, eval)(MATH_SRC);
  global.i18next = i18nextStub;
  CrossCityStats = (0, eval)(`${STATS_SRC}\nCrossCityStats;`);
});

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
    const section = buildDom();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ unavailable: true }) });
    await new CrossCityStats(section, { currentCityName: 'Seattle' }).render();

    expect(section.hidden).toBe(true);
    expect(document.getElementById('ud-cities-status').textContent).toBe('');
  });
});

/**
 * Tests for the admin Sidewalks page coordinator (#5724).
 *
 * The map, KPIs, review lists and region table all derive from one join of street geometry onto per-face presence
 * rows, so the cases drive the real page, table and map (against a `mapboxgl` double) and check that they agree.
 * The review lists are the page's reason to exist, so each list's membership rule has a case of its own.
 *
 * Runs under jsdom (jest.config.js).
 */

const { loadModules, realUtil } = require('./loadGlobalScript');

window.util = realUtil();
// jsdom has no layout, so it leaves scrollIntoView out; the region table calls it.
window.HTMLElement.prototype.scrollIntoView = () => {};

const { SidewalksPage } = loadModules('frontend/js/admin-dashboard/SidewalksPage.js');

/**
 * Mapbox GL cannot run under jsdom; this records what the map was told and fires 'load' on the next tick, or, with
 * holdLoad, only when the test calls `state.fireLoad()`.
 */
function stubMapbox({ holdLoad = false } = {}) {
  const state = { filters: [], halos: [], fits: [], featureStates: [], fireLoad: null };
  global.mapboxgl = {
    accessToken: null,
    Map: class {
      constructor(options) {
        if (!options.bounds.flat().every(Number.isFinite)) throw new Error('Invalid LngLat object');
      }

      addControl() {}

      on(event, layerOrHandler) {
        if (event !== 'load') return;
        if (holdLoad) state.fireLoad = layerOrHandler;
        else setTimeout(layerOrHandler, 0);
      }

      addSource(id, source) { state.source = source; }

      addLayer() {}

      setFilter(layer, expression) {
        (layer.includes('halo') ? state.halos : state.filters).push(expression);
      }

      setFeatureState(target, value) { state.featureStates.push({ target, value }); }

      fitBounds(box, options) { state.fits.push({ box, options }); }

      getCanvas() { return { style: {} }; }
    },
    Popup: class {
      setLngLat() { return this; }

      setHTML() { return this; }

      addTo() { return this; }

      remove() { return this; }
    },
    NavigationControl: class {},
  };
  return state;
}

const MARKUP = `
  <span id="kpi-absent"></span><span id="kpi-absent-note"></span>
  <span id="kpi-single"></span><span id="kpi-single-note"></span>
  <span id="kpi-confirmed"></span><span id="kpi-confirmed-note"></span>
  <span id="kpi-rebuilt"></span><span id="kpi-rebuilt-note"></span>
  <div id="sidewalks-status"></div>
  <form id="sidewalks-filters">
    <select id="sidewalks-min-users"><option value="1">1</option><option value="2">2</option></select>
    <input type="checkbox" id="sidewalks-confirmed-only">
    <div id="sidewalks-basis-filters"></div>
  </form>
  <div id="sidewalks-map"></div>
  <div id="sidewalks-legend"></div>
  <p id="sidewalks-filter-note"></p>
  <select id="sidewalks-flag"></select>
  <input id="sidewalks-flag-search" type="search">
  <p id="sidewalks-flag-description"></p>
  <p id="sidewalks-flag-focus"></p>
  <table id="sidewalks-flag-table"></table>
  <input id="sidewalks-region-search" type="search">
  <table id="sidewalks-region-table"></table>
`;

/** One face as /adminapi/sidewalkPresence returns it: audited, sidewalk present, nothing labeled. */
const face = (side, overrides = {}) => ({
  street_side: side,
  presence: 'present',
  presence_basis: 'audited_no_labels',
  no_sidewalk_label_count: 0,
  no_sidewalk_user_count: 0,
  validated_no_sidewalk_count: 0,
  rejected_no_sidewalk_count: 0,
  label_count: 0,
  problem_label_count: 0,
  curb_ramp_count: 0,
  last_no_sidewalk_label_at: null,
  ...overrides,
});

/** One street row: 1 km long in Ballard, with the given faces. */
const street = (id, left, right, overrides = {}) => ({
  street_edge_id: id,
  region_id: 10,
  region_name: 'Ballard',
  way_type: 'residential',
  length_m: 1000,
  audit_count: 1,
  faces: [left, right],
  ...overrides,
});

const absent = (overrides = {}) => ({
  presence: 'absent', presence_basis: 'no_sidewalk_labels', no_sidewalk_label_count: 1, no_sidewalk_user_count: 1,
  label_count: 1, last_no_sidewalk_label_at: '2026-05-01T00:00:00Z', ...overrides,
});

/**
 * A city with one street per review list, plus a clean one and an unaudited one.
 *
 *   1: left absent on one labeler (single_labeler)
 *   2: left absent from three labelers, right absent only via the left's tag (other_side_tag)
 *   3: both sides absent from two labelers each, with curb ramps (curb_ramps)
 *   4: left absent from two labelers, with an obstacle label (problem_labels); confirmed by a validator
 *   5: sidewalk on both sides
 *   6: unaudited, in Downtown
 */
const CITY = [
  street(1, face('left', absent()), face('right')),
  street(2, face('left', absent({ no_sidewalk_label_count: 3, no_sidewalk_user_count: 3 })),
    face('right', { presence: 'absent', presence_basis: 'other_side_tag' })),
  street(3, face('left', absent({ no_sidewalk_user_count: 2, curb_ramp_count: 1 })),
    face('right', absent({ no_sidewalk_user_count: 2, curb_ramp_count: 1 }))),
  street(4, face('left', absent({ no_sidewalk_user_count: 2, problem_label_count: 2, validated_no_sidewalk_count: 1 })),
    face('right')),
  street(5, face('left'), face('right')),
  street(6, face('left', { presence: 'unknown', presence_basis: 'unaudited' }),
    face('right', { presence: 'unknown', presence_basis: 'unaudited' }),
  { region_id: 11, region_name: 'Downtown', audit_count: 0 }),
];

/** GeoJSON for the given street ids, in the shape /v3/api/streets serves. */
const geojson = (ids) => ({
  type: 'FeatureCollection',
  features: ids.map((id) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[-122.3 - id / 100, 47.6], [-122.3, 47.6 + id / 100]] },
    properties: { street_edge_id: id },
  })),
});

/** Renders the page against canned responses and waits for the map's load event. */
async function renderPage({ streets = CITY, ids = [1, 2, 3, 4, 5, 6], rebuiltAt = '2026-10-08T03:30:00Z' } = {}) {
  document.body.innerHTML = MARKUP;
  const mapState = stubMapbox();
  global.fetch = jest.fn((url) => Promise.resolve({
    ok: true,
    json: async () => (url === '/presence' ? { rebuilt_at: rebuiltAt, streets } : geojson(ids)),
  }));
  await new SidewalksPage({ mapboxToken: 'pk.test', streetsUrl: '/streets', presenceUrl: '/presence' }).init();
  await new Promise((resolve) => setTimeout(resolve, 1));
  return mapState;
}

const text = (id) => document.getElementById(id).textContent;
// Flag rows are keyed street_edge_id * 2 + (right ? 1 : 0); this reads them back as "street:side".
const flagRows = () => [...document.querySelectorAll('#sidewalks-flag-table tbody tr[data-row-id]')]
  .map((tr) => Number(tr.dataset.rowId))
  .map((id) => `${Math.floor(id / 2)}:${id % 2 ? 'right' : 'left'}`);
const regionRows = () => [...document.querySelectorAll('#sidewalks-region-table tbody tr[data-row-id]')];
const pickFlag = (key) => {
  const select = document.getElementById('sidewalks-flag');
  select.value = key;
  select.dispatchEvent(new Event('change'));
};

describe('SidewalksPage.join', () => {
  test('draws every street twice, one feature per side, keyed by street and side', () => {
    const features = SidewalksPage.join(geojson([1]), [CITY[0]]);
    expect(features.map((f) => f.properties.face_id)).toEqual(['1:left', '1:right']);
    expect(features[0].geometry).toBe(features[1].geometry);
  });

  test('tells each side what the other side is, and the street\'s curb ramp total', () => {
    const [left, right] = SidewalksPage.join(geojson([3]), [CITY[2]]);
    expect(left.properties.other_presence).toBe('absent');
    expect(right.properties.other_presence).toBe('absent');
    expect(left.properties.street_curb_ramp_count).toBe(2);
  });

  test('takes the later side\'s NoSidewalk date as an instant, not the lexically larger string', () => {
    // The server drops zero seconds, so "10:00Z" is the earlier time yet sorts after "10:00:30Z".
    const dated = street(1, face('left', absent({ last_no_sidewalk_label_at: '2025-06-01T10:00Z' })),
      face('right', absent({ last_no_sidewalk_label_at: '2025-06-01T10:00:30Z' })));
    const [left] = SidewalksPage.join(geojson([1]), [dated]);
    expect(left.properties.street_last_no_sidewalk_label_at).toBe('2025-06-01T10:00:30Z');
  });

  test('drops a street with no geometry rather than drawing it nowhere', () => {
    expect(SidewalksPage.join(geojson([1]), CITY.slice(0, 2)).map((f) => f.properties.street_edge_id))
      .toEqual([1, 1]);
  });
});

describe('the Sidewalks page', () => {
  test('counts no-sidewalk sides over audited sides only', async () => {
    await renderPage();
    // 10 audited sides (streets 1-5); 6 absent: 1L, 2L, 2R, 3L, 3R, 4L.
    expect(text('kpi-absent')).toBe('60%');
    expect(text('kpi-absent-note')).toContain('6 of 10');
    expect(text('kpi-absent-note')).toContain('6.0 km');
    expect(text('kpi-single')).toBe('17%');
    expect(text('kpi-confirmed')).toBe('1');
  });

  test('says when the table has never been rebuilt instead of showing a date', async () => {
    await renderPage({ rebuiltAt: null });
    expect(text('kpi-rebuilt')).toBe('never');
  });

  test('puts each street on the review list its evidence calls for', async () => {
    await renderPage();
    expect(flagRows()).toEqual(['1:left']);
    pickFlag('other_side_tag');
    expect(flagRows()).toEqual(['2:right']);
    pickFlag('curb_ramps');
    // A street-level list: one row for the street, not one per side.
    expect(flagRows()).toEqual(['3:left']);
    pickFlag('problem_labels');
    expect(flagRows()).toEqual(['4:left']);
    pickFlag('not_audited');
    expect(flagRows()).toEqual(['6:left']);
  });

  test('lists a street too short to see on the map by its length', async () => {
    const sliver = street(7, face('left', { presence: 'unknown', presence_basis: 'unaudited' }),
      face('right', { presence: 'unknown', presence_basis: 'unaudited' }), { audit_count: 0, length_m: 0.47 });
    await renderPage({ streets: [...CITY, sliver], ids: [1, 2, 3, 4, 5, 6, 7] });
    pickFlag('not_audited');
    expect(flagRows().sort()).toEqual(['6:left', '7:left']);
    const evidence = [...document.querySelectorAll('#sidewalks-flag-table tbody tr')].map((tr) => tr.textContent);
    expect(evidence.some((text) => text.includes('0.5 m long'))).toBe(true);
  });

  test('gives both sides of one street their own row when both are on a list', async () => {
    const both = street(7, face('left', absent({ problem_label_count: 1 })),
      face('right', absent({ problem_label_count: 1 })));
    await renderPage({ streets: [...CITY, both], ids: [1, 2, 3, 4, 5, 6, 7] });
    pickFlag('problem_labels');
    expect(flagRows().sort()).toEqual(['4:left', '7:left', '7:right']);
  });

  test('names each list with how many rows it holds', async () => {
    await renderPage();
    const options = [...document.querySelectorAll('#sidewalks-flag option')].map((o) => o.textContent.trim());
    expect(options).toEqual(expect.arrayContaining([expect.stringMatching(/one person's word \(1\)$/)]));
  });

  test('focuses a street on the map when its row is chosen', async () => {
    const map = await renderPage();
    document.querySelector('#sidewalks-flag-table tbody tr[data-row-id="2"] button').click();
    expect(map.halos.at(-1)).toEqual(['in', ['get', 'face_id'], ['literal', ['1:left', '1:right']]]);
    expect(map.fits.at(-1).options.maxZoom).toBe(17);
  });

  test('lists a never-audited street even when one side has a verdict from partial-audit labels', async () => {
    // A face's own NoSidewalk labels outrank the audit check, so one side is absent and the other unaudited.
    const partial = street(7, face('left', absent()),
      face('right', { presence: 'unknown', presence_basis: 'unaudited' }), { audit_count: 0 });
    await renderPage({ streets: [...CITY, partial], ids: [1, 2, 3, 4, 5, 6, 7] });
    pickFlag('not_audited');
    expect(flagRows().sort()).toEqual(['6:left', '7:left']);
  });

  test('a street-level list reads "both" for the side and takes the later of the two sides\' dates', async () => {
    const dated = street(7,
      face('left', absent({
        no_sidewalk_user_count: 2, curb_ramp_count: 1, last_no_sidewalk_label_at: '2024-01-05T00:00:00Z',
      })),
      face('right', absent({ no_sidewalk_user_count: 2, last_no_sidewalk_label_at: '2025-06-01T00:00:00Z' })));
    await renderPage({ streets: [...CITY, dated], ids: [1, 2, 3, 4, 5, 6, 7] });
    pickFlag('curb_ramps');
    const row = document.querySelector('#sidewalks-flag-table tbody tr[data-row-id="14"]');
    expect(row.textContent).toContain('both');
    expect(row.textContent).toContain(new Date('2025-06-01T00:00:00Z').toLocaleDateString());
  });

  test('a right-side row focuses its own street, highlights the row and says so', async () => {
    const map = await renderPage();
    pickFlag('other_side_tag');
    document.querySelector('#sidewalks-flag-table tbody tr[data-row-id="5"] button').click();
    expect(map.halos.at(-1)).toEqual(['in', ['get', 'face_id'], ['literal', ['2:left', '2:right']]]);
    expect(document.querySelector('#sidewalks-flag-table tr[data-row-id="5"]').classList.contains('is-highlighted'))
      .toBe(true);
    expect(text('sidewalks-flag-focus')).toBe('Showing street 2 on the map.');
  });

  test('a chosen row stays highlighted through a re-sort and a search that keeps it', async () => {
    await renderPage();
    const row = () => document.querySelector('#sidewalks-flag-table tbody tr[data-row-id="2"]');
    row().querySelector('button').click();
    document.querySelector('#sidewalks-flag-table th[data-key="weight"]').click();
    expect(row().classList.contains('is-highlighted')).toBe(true);
    const search = document.getElementById('sidewalks-flag-search');
    search.value = 'Ballard';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(row().classList.contains('is-highlighted')).toBe(true);
  });

  test('choosing a row scrolls the map into view, without animation when motion is reduced', async () => {
    await renderPage();
    const scrolls = [];
    const original = window.HTMLElement.prototype.scrollIntoView;
    window.HTMLElement.prototype.scrollIntoView = function record(options) { scrolls.push([this.id, options]); };
    window.matchMedia = jest.fn(() => ({ matches: true }));
    try {
      document.querySelector('#sidewalks-flag-table tbody tr[data-row-id="2"] button').click();
    } finally {
      window.HTMLElement.prototype.scrollIntoView = original;
      delete window.matchMedia;
    }
    expect(scrolls).toEqual([['sidewalks-map', { behavior: 'auto', block: 'center' }]]);
  });

  test('a street chosen before the map loads is marked once it does', async () => {
    document.body.innerHTML = MARKUP;
    const map = stubMapbox({ holdLoad: true });
    global.fetch = jest.fn((url) => Promise.resolve({
      ok: true,
      json: async () => (url === '/presence' ? { rebuilt_at: '2026-10-08T03:30:00Z', streets: CITY }
        : geojson([1, 2, 3, 4, 5, 6])),
    }));
    const loaded = new SidewalksPage({ mapboxToken: 'pk.test', streetsUrl: '/streets', presenceUrl: '/presence' })
      .init();
    while (!map.fireLoad) await new Promise((resolve) => setTimeout(resolve, 0));
    document.querySelector('#sidewalks-flag-table tbody tr[data-row-id="2"] button').click();
    expect(map.halos).toEqual([]);
    map.fireLoad();
    await loaded;
    expect(map.halos.at(-1)).toEqual(['in', ['get', 'face_id'], ['literal', ['1:left', '1:right']]]);
  });

  test('switching lists or changing a filter lets go of the chosen street', async () => {
    const map = await renderPage();
    document.querySelector('#sidewalks-flag-table tbody tr[data-row-id="2"] button').click();
    pickFlag('other_side_tag');
    expect(map.halos.at(-1)).toEqual(['in', ['get', 'face_id'], ['literal', []]]);
    expect(text('sidewalks-flag-focus')).toBe('');
    pickFlag('single_labeler');
    document.querySelector('#sidewalks-flag-table tbody tr[data-row-id="2"] button').click();
    document.getElementById('sidewalks-min-users').dispatchEvent(new Event('change', { bubbles: true }));
    expect(map.halos.at(-1)).toEqual(['in', ['get', 'face_id'], ['literal', []]]);
  });

  test('raising the labeler minimum hides one-labeler sides and says how many remain', async () => {
    const map = await renderPage();
    expect(text('sidewalks-filter-note')).toBe('Showing 12 of 12 sides.');
    const select = document.getElementById('sidewalks-min-users');
    select.value = '2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(text('sidewalks-filter-note')).toBe('Showing 11 of 12 sides.');
    expect(JSON.stringify(map.filters.at(-1))).toContain('["get","no_sidewalk_user_count"],2');
  });

  test('the confirmed-only box hides unconfirmed no-sidewalk sides on the map and in the count alike', async () => {
    const map = await renderPage();
    const box = document.getElementById('sidewalks-confirmed-only');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    // Of the 6 absent sides only 4L is confirmed, so 5 drop out of 12.
    expect(text('sidewalks-filter-note')).toBe('Showing 7 of 12 sides.');
    expect(JSON.stringify(map.filters.at(-1))).toContain('["get","validated_no_sidewalk_count"],1');
  });

  test('unchecking a basis drops its sides from the map and the count alike', async () => {
    const map = await renderPage();
    const box = document.querySelector('input[name="sidewalks-basis"][value="other_side_tag"]');
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(text('sidewalks-filter-note')).toBe('Showing 11 of 12 sides.');
    expect(JSON.stringify(map.filters.at(-1))).not.toContain('"other_side_tag"');
  });

  test('offers a basis checkbox for exactly the bases the city has', async () => {
    await renderPage();
    const bases = [...document.querySelectorAll('input[name="sidewalks-basis"]')].map((input) => input.value);
    expect(bases.sort()).toEqual(['audited_no_labels', 'no_sidewalk_labels', 'other_side_tag', 'unaudited']);
  });

  test('rolls regions up separately, with unaudited sides out of the no-sidewalk share', async () => {
    await renderPage();
    const rows = [...document.querySelectorAll('#sidewalks-region-table tbody tr')]
      .map((tr) => [...tr.cells].map((td) => td.textContent.trim()));
    expect(rows).toEqual(expect.arrayContaining([
      ['Ballard', '100%', '60%', '6.0', '1', '1'],
      ['Downtown', '0%', '0%', '0.0', '0', '0'],
    ]));
  });

  test('a region is a button, stays highlighted through a re-sort, and a second press clears it', async () => {
    const map = await renderPage();
    const ballard = () => regionRows().find((tr) => tr.textContent.includes('Ballard'));
    ballard().querySelector('button').click();
    expect(map.fits).toHaveLength(1);
    expect(ballard().classList.contains('is-highlighted')).toBe(true);
    document.querySelector('#sidewalks-region-table th[data-key="region_name"]').click();
    expect(ballard().classList.contains('is-highlighted')).toBe(true);
    ballard().querySelector('button').click();
    expect(ballard().classList.contains('is-highlighted')).toBe(false);
  });

  test('a region button says whether it is pressed, and choosing a street lets go of the region', async () => {
    await renderPage();
    const ballardButton = () => regionRows().find((tr) => tr.textContent.includes('Ballard')).querySelector('button');
    expect(ballardButton().getAttribute('aria-pressed')).toBe('false');
    ballardButton().click();
    expect(ballardButton().getAttribute('aria-pressed')).toBe('true');
    document.querySelector('#sidewalks-region-table th[data-key="region_name"]').click();
    expect(ballardButton().getAttribute('aria-pressed')).toBe('true');
    document.querySelector('#sidewalks-flag-table tbody tr[data-row-id="2"] button').click();
    expect(ballardButton().getAttribute('aria-pressed')).toBe('false');
  });

  test('escapes a region name in the tables', async () => {
    const hostile = CITY.map((s) => ({ ...s, region_name: '<img src=x onerror=alert(1)>' }));
    await renderPage({ streets: hostile });
    expect(document.querySelector('#sidewalks-region-table img')).toBeNull();
    expect(document.querySelector('#sidewalks-flag-table img')).toBeNull();
    expect(regionRows()[0].textContent).toContain('<img src=x');
  });

  test('explains an empty city rather than drawing an empty map', async () => {
    await renderPage({ streets: [], ids: [] });
    expect(text('sidewalks-status')).toContain('No open street has a sidewalk verdict yet');
  });
});

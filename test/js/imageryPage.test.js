/**
 * Tests for the Imagery page coordinator (#4908).
 *
 * Everything above the pipeline section is derived from one joined list, so the property worth pinning is that the
 * map, the KPIs, both tables and the roll-ups cannot disagree about the same city. The cases here drive the real
 * tier classifier, table and map (against a `mapboxgl` double) rather than stubbing them, because a page that
 * quietly counts re-audits one way in a KPI and another way in the legend is exactly the failure a per-unit test
 * cannot see.
 *
 * The two counts the page shows *are* deliberately different — the KPI uses the site-wide re-audit flag, the map
 * tier counts only audits that carry weight in the priority formula — and that difference has its own case, because
 * a reader who noticed it and found no explanation would reasonably conclude one of them is a bug.
 *
 * Runs under jsdom (jest.config.js). The page's classes are bare top-level declarations in a concatenated bundle, so
 * they are eval'd into global scope rather than required.
 */

const fs = require('fs');
const path = require('path');

const JS_DIR = path.resolve(__dirname, '..', '..', 'public/js/admin-dashboard');

/** Chart calls, recorded instead of drawn. */
const charts = [];

/** Loads the page and every class it collaborates with into global scope. */
function loadPage() {
  const read = (file) => fs.readFileSync(path.join(JS_DIR, file), 'utf8');
  globalThis.MiniLineChart = {
    renderInto: (host, labels, series, options) => charts.push({ host, labels, series, options }),
  };
  return (0, eval)([
    read('AdminShell.js'), 'globalThis.AdminShell = AdminShell;',
    read('StreetPriorityMap.js'), 'globalThis.StreetPriorityTiers = StreetPriorityTiers;',
    'globalThis.StreetPriorityMap = StreetPriorityMap;',
    read('StreetPriorityTable.js'), 'globalThis.StreetPriorityTable = StreetPriorityTable;',
    read('ImageryPipelinePanel.js'), 'globalThis.ImageryPipelinePanel = ImageryPipelinePanel;',
    read('ImageryPage.js'), 'ImageryPage;',
  ].join('\n'));
}

const ImageryPage = loadPage();

/** Mapbox GL cannot run under jsdom; this records what the map was told and fires 'load' immediately. */
function stubMapbox() {
  const state = { featureStates: [], handlers: [] };
  global.mapboxgl = {
    accessToken: null,
    Map: class {
      constructor(options) {
        // Mapbox rejects a non-finite bounds box, which is what a FeatureCollection with no features produces.
        if (!options.bounds.flat().every(Number.isFinite)) throw new Error('Invalid LngLat object');
        state.options = options;
      }

      addControl() {}

      on(event, layerOrHandler, maybeHandler) {
        if (event === 'load') { setTimeout(layerOrHandler, 0); return; }
        state.handlers.push({ event, layer: layerOrHandler, handler: maybeHandler });
      }

      addSource() {}

      addLayer() {}

      setFeatureState(target, value) { state.featureStates.push({ target, value }); }

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
  <span id="kpi-needs-reaudit"></span><span id="kpi-needs-reaudit-note"></span>
  <span id="kpi-unaudited"></span><span id="kpi-unaudited-note"></span>
  <span id="kpi-rotation"></span><span id="kpi-rotation-note"></span>
  <span id="kpi-last-poll"></span><span id="kpi-last-poll-note"></span>
  <div id="imagery-status"></div>
  <div id="imagery-priority-map"></div>
  <div class="street-status-legend" id="imagery-legend"></div>
  <p id="imagery-priority-note"></p>
  <input id="imagery-region-search" type="search">
  <table id="imagery-region-table"></table>
  <p id="imagery-street-intro"></p>
  <table id="imagery-street-table"></table>
  <p id="imagery-street-note"></p>
  <select id="imagery-range"><option value="30">30</option></select>
  <div id="imagery-pipeline-status"></div><div id="imagery-jobs"></div><p id="imagery-failure-note"></p>
  <div id="imagery-poll-chart"></div><div id="imagery-flag-chart"></div>
  <div id="imagery-rotation"></div>
  <div id="imagery-freshness-chart"></div><p id="imagery-freshness-note"></p>
`;

const NOW = Date.parse('2026-08-20T12:00:00Z');
const POLL = 'check-imagery-age-actor';

/** One street row as /adminapi/streetPriority returns it: never audited, never polled, one mile long. */
const street = (overrides = {}) => ({
  street_edge_id: 1,
  region_id: 10,
  region_name: 'Ballard',
  priority: 1,
  fresh_good_count: 0,
  outdated_good_count: 0,
  bad_count: 0,
  outdated: false,
  last_audit_date: null,
  median_newest_capture: null,
  imagery_updated_at: null,
  length_m: 1609.34,
  ...overrides,
});

/** A city with one street of every tier, plus a second region. */
const CITY = [
  street({ street_edge_id: 1, priority: 1 }),
  street({ street_edge_id: 2, priority: 0.667, outdated_good_count: 1, outdated: true,
    last_audit_date: '2021-05-04', median_newest_capture: '2025-06-01',
    imagery_updated_at: '2026-08-15T00:45:00Z' }),
  street({ street_edge_id: 3, priority: 0.5, fresh_good_count: 1, last_audit_date: '2026-01-10',
    median_newest_capture: '2025-01-01', imagery_updated_at: '2026-02-01T00:45:00Z' }),
  street({ street_edge_id: 4, region_id: 11, region_name: 'Downtown', priority: 0.333, fresh_good_count: 2,
    last_audit_date: '2026-07-01', median_newest_capture: '2026-07-20',
    imagery_updated_at: '2024-03-01T00:45:00Z' }),
];

/** GeoJSON for the given street ids, in the shape /v3/api/streets serves. */
const geojson = (ids = [1, 2, 3, 4]) => ({
  type: 'FeatureCollection',
  features: ids.map((id) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[-122.3 - id / 100, 47.6], [-122.3, 47.6 + id / 100]] },
    properties: { street_edge_id: id, region_id: 0, way_type: 'residential' },
  })),
});

/** A pipeline report; the page reads only its jobs, run_days, batch size and job roles. */
const report = (overrides = {}) => ({
  days: 30,
  since: '2026-07-21T12:00:00Z',
  jobs: [{
    job_name: POLL,
    label: 'Imagery age poll',
    scheduled_at: '00:45',
    last_status: 'succeeded',
    last_started_at: '2026-08-20T00:45:00Z',
    last_manual_run_at: null,
    last_details: { streets_selected: 500, streets_polled: 480 },
    hours_since_last_run: 11,
    overdue: false,
    runs_in_window: 30,
    failures_in_window: 0,
  }],
  run_days: [{ day: '2026-08-19', streets_polled: 400, streets_skipped: 100, audits_flagged: 2,
    audits_unflagged: 0, streets_selected: 500, streets_refreshed: 3, poll_failures: 0, sync_failures: 0 }],
  poll_batch_size: 500,
  overdue_after_hours: 36,
  poll_job: POLL,
  sync_job: 'imagery-freshness-sync',
  ...overrides,
});

/** Renders the page against canned responses and waits for the map's load event. */
async function renderPage({ streets = CITY, features, pipeline = report(), failStreets = false } = {}) {
  document.body.innerHTML = MARKUP;
  charts.length = 0;
  const mapState = stubMapbox();
  global.fetch = jest.fn((url) => {
    if (url.startsWith('/adminapi/imageryFreshness')) {
      return Promise.resolve({ ok: true, json: async () => pipeline });
    }
    if (url === '/priority') return Promise.resolve({ ok: true, json: async () => ({ streets }) });
    if (failStreets) return Promise.resolve({ ok: false, status: 500 });
    return Promise.resolve({ ok: true, json: async () => (features || geojson()) });
  });

  const page = new ImageryPage({
    mapboxToken: 'pk.test',
    streetsUrl: '/streets',
    priorityUrl: '/priority',
    pipelineUrl: '/adminapi/imageryFreshness',
    pipelineDays: 30,
  });
  await page.init();
  // The map resolves its init on a 'load' the double defers by a tick, and the pipeline panel is deliberately not
  // awaited by init(); both have landed after the timer queue drains.
  await new Promise((resolve) => setTimeout(resolve, 1));
  return { page, mapState };
}

const text = (id) => document.getElementById(id).textContent;
const regionRows = () => [...document.querySelectorAll('#imagery-region-table tbody tr')];
const streetRows = () => [...document.querySelectorAll('#imagery-street-table tbody tr')];

beforeEach(() => { jest.spyOn(Date, 'now').mockReturnValue(NOW); });

afterEach(() => {
  jest.restoreAllMocks();
  delete global.mapboxgl;
});

describe('ImageryPage KPIs', () => {
  test('counts re-audits with the site-wide flag, so the number matches Overview and Coverage', async () => {
    await renderPage();
    // Street 2 is the only one carrying `outdated`; the tier count would agree here, and the case below is the one
    // where they diverge.
    expect(text('kpi-needs-reaudit')).toBe('1');
    expect(text('kpi-needs-reaudit-note')).toBe('1.0 mi of audited street with newer imagery');
  });

  test('counts never-audited streets out of every routable street', async () => {
    await renderPage();
    expect(text('kpi-unaudited')).toBe('1');
    expect(text('kpi-unaudited-note')).toBe('of 4 routable streets');
  });

  test('reports how much of the audited city the rotation has actually reached', async () => {
    await renderPage();
    // Three streets have been audited; all three carry a polled capture date.
    expect(text('kpi-rotation')).toBe('100%');
    expect(text('kpi-rotation-note')).toContain('3 of 3 audited streets');
  });

  test('reports an unmeasured audited street as unmeasured rather than as up to date', async () => {
    await renderPage({
      streets: [
        street({ street_edge_id: 1, fresh_good_count: 1, last_audit_date: '2026-01-01' }),
        street({ street_edge_id: 2, fresh_good_count: 1, last_audit_date: '2026-01-01',
          median_newest_capture: '2026-02-02' }),
      ],
      features: geojson([1, 2]),
    });
    expect(text('kpi-rotation')).toBe('50%');
  });

  test('renders the rotation share as an em dash rather than 0% when nothing has been audited', async () => {
    await renderPage({ streets: [street({ street_edge_id: 1 })], features: geojson([1]) });
    expect(text('kpi-rotation')).toBe('0%');
    expect(text('kpi-rotation-note')).toContain('0 of 0 audited streets');
  });

  test('reports the last poll from the pipeline report', async () => {
    await renderPage();
    expect(text('kpi-last-poll')).toBe('11h ago');
    expect(text('kpi-last-poll-note')).toBe('480 of 500 selected streets refreshed');
  });

  test('finds the poll by the role the report assigns, not by a job name of its own', async () => {
    // The job names live in ScheduledJobs. A copy kept here would survive a rename as a permanent "never" — the KPI
    // would report the pipeline dead while it ran perfectly well.
    const jobs = report().jobs.map((entry) => ({ ...entry, job_name: 'imagery-age-poll-v2' }));
    await renderPage({ pipeline: report({ jobs, poll_job: 'imagery-age-poll-v2' }) });
    expect(text('kpi-last-poll')).toBe('11h ago');
  });

  test('says plainly when the poll has never run here', async () => {
    await renderPage({
      pipeline: report({ jobs: [{ job_name: POLL, last_status: 'never_run', hours_since_last_run: null }] }),
    });
    expect(text('kpi-last-poll')).toBe('never');
    expect(text('kpi-last-poll-note')).toContain('no recorded run');
  });

  test('reports a poll that ran but polled nothing with the reason it recorded', async () => {
    await renderPage({
      pipeline: report({
        jobs: [{ job_name: POLL, last_status: 'succeeded', hours_since_last_run: 60,
          last_details: { not_polled_reason: 'provider has no age query' } }],
      }),
    });
    expect(text('kpi-last-poll')).toBe('2d ago');
    expect(text('kpi-last-poll-note')).toBe('provider has no age query');
  });
});

describe('ImageryPage legend', () => {
  test('doubles as the city-wide tier breakdown', async () => {
    await renderPage();
    const items = [...document.querySelectorAll('#imagery-legend .street-status-legend-item')]
      .map((el) => el.textContent.replace(/\s+/g, ' ').trim());
    expect(items).toEqual([
      'Not yet audited (1)', 'Needs re-audit (1)', 'Audited once (1)', 'Audited 2+ times (1)',
    ]);
  });

  test('reports the priority range without spreading one argument per street', async () => {
    // `Math.min(...values)` overflows the call stack in a city with tens of thousands of streets, which is most of
    // them; this asserts the range is right and the big-city case below asserts it survives the size.
    await renderPage();
    expect(text('imagery-priority-note')).toContain('ranges from 0.333 to 1.000');
  });

  test('survives a city with more streets than a spread call can carry', async () => {
    const many = Array.from({ length: 200000 }, (_, i) => street({ street_edge_id: i + 1, priority: 1 - i / 1e6 }));
    await renderPage({ streets: many, features: geojson([1, 2]) });
    expect(text('imagery-priority-note')).toContain('ranges from 0.800 to 1.000');
  });

  test('explains the two re-audit counts only when they actually differ', async () => {
    await renderPage();
    expect(text('imagery-priority-note')).not.toContain('site-wide re-audit flag');

    // A street whose only audits are low-quality carries the flag but sits in the unaudited tier: the tier counts
    // only audits with weight in the priority formula, the flag counts every completed audit.
    await renderPage({
      streets: [
        street({ street_edge_id: 1 }),
        street({ street_edge_id: 2, bad_count: 2, outdated: true, last_audit_date: '2020-01-01' }),
      ],
      features: geojson([1, 2]),
    });
    const note = text('imagery-priority-note');
    expect(note).toContain('0 streets sit in the re-audit tier while 1 carry the site-wide re-audit flag');
  });
});

describe('ImageryPage tables', () => {
  test('ranks regions by mean priority, with each tier counted', async () => {
    await renderPage();
    const rows = regionRows();
    expect(rows).toHaveLength(2);
    expect(rows[0].cells[0].textContent).toBe('Ballard');
    // Ballard holds priorities 1, 0.667 and 0.5; Downtown holds only 0.333.
    expect(rows[0].cells[1].textContent).toBe('0.722');
    expect(rows[0].cells[2].textContent).toBe('1');
    expect(rows[0].cells[3].textContent).toBe('1');
    expect(rows[0].cells[4].textContent).toBe('1.0');
    expect(rows[1].cells[0].textContent).toBe('Downtown');
  });

  test('lists the highest-priority streets city-wide until a region is pinned', async () => {
    await renderPage();
    expect(streetRows().map((tr) => tr.dataset.rowId)).toEqual(['1', '2', '3', '4']);
    expect(text('imagery-street-note')).toContain('Showing 4 of 4 routable streets');
    expect(text('imagery-street-intro')).toContain('city-wide');
  });

  test('narrows the street queue to a pinned region, and says whose queue it is', async () => {
    await renderPage();
    regionRows()[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(streetRows().map((tr) => tr.dataset.rowId)).toEqual(['4']);
    expect(text('imagery-street-intro')).toContain('Downtown');
    expect(text('imagery-street-note')).toContain('Showing 1 of 1 routable streets');
  });

  test('goes back to the city-wide ranking when the pinned region is clicked again', async () => {
    await renderPage();
    regionRows()[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const pinned = regionRows().find((tr) => tr.cells[0].textContent === 'Downtown');
    pinned.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(streetRows()).toHaveLength(4);
    expect(text('imagery-street-intro')).toContain('city-wide');
  });

  test('caps the street queue and says how much of the pool it is showing', async () => {
    const many = Array.from({ length: 80 }, (_, i) => street({ street_edge_id: i + 1, priority: 1 - i / 1000 }));
    await renderPage({ streets: many, features: geojson(many.map((s) => s.street_edge_id)) });
    expect(streetRows()).toHaveLength(50);
    expect(text('imagery-street-note')).toContain('Showing 50 of 80 routable streets');
    // Explore picks at random among ties, so the list is a sample of the frontier rather than a running order.
    expect(text('imagery-street-note')).toContain('at random among ties');
  });

  test('links each street into Explore rather than pinning when the link is clicked', async () => {
    await renderPage();
    const link = streetRows()[0].querySelector('a');
    expect(link.getAttribute('href')).toBe('/explore?streetEdgeId=1');
    expect(link.getAttribute('rel')).toBe('noopener');
  });
});

describe('ImageryPage brushing', () => {
  test('brushes a hovered region across the map and the region table', async () => {
    const { mapState } = await renderPage();
    regionRows()[0].dispatchEvent(new window.Event('pointerover', { bubbles: true }));
    const selected = mapState.featureStates.filter((s) => s.value.selected === true).map((s) => s.target.id);
    expect(selected.sort()).toEqual([1, 2, 3]);
    expect(regionRows()[0].classList.contains('highlighted')).toBe(true);
  });

  test('reverts a transient hover to the pinned region rather than to nothing', async () => {
    const { mapState } = await renderPage();
    regionRows().find((tr) => tr.cells[0].textContent === 'Downtown')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    mapState.featureStates.length = 0;

    regionRows()[0].dispatchEvent(new window.Event('pointerover', { bubbles: true }));
    document.querySelector('#imagery-region-table tbody').dispatchEvent(new window.Event('pointerleave'));

    const stillSelected = mapState.featureStates.filter((s) => s.value.selected === true).map((s) => s.target.id);
    expect(stillSelected).toContain(4);
    const highlighted = regionRows().filter((tr) => tr.classList.contains('highlighted'));
    expect(highlighted.map((tr) => tr.cells[0].textContent)).toEqual(['Downtown']);
  });

  test('does not narrow the street queue on hover, only on a pin', async () => {
    await renderPage();
    regionRows().find((tr) => tr.cells[0].textContent === 'Downtown')
      .dispatchEvent(new window.Event('pointerover', { bubbles: true }));
    expect(streetRows()).toHaveLength(4);
  });
});

describe('ImageryPage rotation roll-up', () => {
  const rollupRow = (label) => [...document.querySelectorAll('#imagery-rotation tbody tr')]
    .find((tr) => tr.cells[0].textContent === label);

  test('separates streets with any imagery record from streets the poll has actually reached', async () => {
    await renderPage();
    expect(rollupRow('Routable streets').cells[1].textContent).toBe('4');
    expect(rollupRow('With any imagery record').cells[1].textContent).toBe('3');
    expect(rollupRow('With a polled capture date').cells[1].textContent).toBe('3');
    expect(rollupRow('Audited and polled').cells[2].textContent).toContain('100% of audited streets');
  });

  test('counts a recent refresh against the clock, not against the window the charts use', async () => {
    await renderPage();
    // Only street 2's imagery record was written inside the last 30 days.
    expect(rollupRow('Refreshed in the last 30 days').cells[1].textContent).toBe('1');
  });

  test('projects a full pass from what the poll has been managing per night', async () => {
    await renderPage();
    // Three audited streets at 400 a night is one night, and the batch size comes from the server's own config.
    expect(rollupRow('Full pass over audited streets').cells[1].textContent).toBe('~1 nights');
    expect(rollupRow('Full pass over audited streets').cells[2].textContent).toContain('batch size 500');
  });

  test('says the rotation is not advancing rather than projecting from zero', async () => {
    await renderPage({ pipeline: report({ run_days: [] }) });
    expect(rollupRow('Full pass over audited streets').cells[1].textContent).toBe('—');
    expect(rollupRow('Full pass over audited streets').cells[2].textContent).toContain('not advancing');
  });

  test('finds the oldest imagery record by instant, not by comparing timestamp strings', async () => {
    await renderPage({
      streets: [
        street({ street_edge_id: 1, imagery_updated_at: '2026-01-01T23:00:00Z' }),
        street({ street_edge_id: 2, imagery_updated_at: '2026-01-02T00:00:00+02:00' }),
      ],
      features: geojson([1, 2]),
    });
    // The second instant is 2026-01-01T22:00Z — earlier — but sorts later as a string.
    expect(rollupRow('Oldest imagery record').cells[1].textContent).toBe('2026-01-02');
  });
});

describe('ImageryPage freshness histogram', () => {
  const buckets = () => charts[charts.length - 1];

  test('buckets each audited-and-polled street by how much newer its imagery is', async () => {
    await renderPage({
      streets: [
        street({ street_edge_id: 1, last_audit_date: '2026-01-01', median_newest_capture: '2025-06-01' }),
        street({ street_edge_id: 2, last_audit_date: '2026-01-01', median_newest_capture: '2026-01-01' }),
        street({ street_edge_id: 3, last_audit_date: '2026-01-01', median_newest_capture: '2026-03-01' }),
        street({ street_edge_id: 4, last_audit_date: '2020-01-01', median_newest_capture: '2026-01-01' }),
      ],
      features: geojson([1, 2, 3, 4]),
    });
    const chart = buckets();
    expect(chart.labels).toEqual(['not newer', '≤ 3 months', '3–12 months', '1–2 years', '2–5 years', '5+ years']);
    // Imagery older than the audit, and imagery exactly as old, both read as "not newer"; the 2020 audit is six
    // years behind its imagery and lands in the last bucket.
    expect(chart.series[0].values).toEqual([2, 1, 0, 0, 0, 1]);
  });

  test('puts each bucket boundary on the lower side, so no street falls between two buckets', async () => {
    const audited = (id, capture) =>
      street({ street_edge_id: id, last_audit_date: '2020-01-01', median_newest_capture: capture });
    await renderPage({
      streets: [
        audited(1, '2020-01-01'), // 0 days -> not newer
        audited(2, '2020-03-31'), // 90 days -> <= 3 months
        audited(3, '2020-04-01'), // 91 days -> 3-12 months
        audited(4, '2020-12-31'), // 365 days -> 3-12 months
        audited(5, '2021-01-01'), // 366 days -> 1-2 years
        audited(6, '2021-12-31'), // 730 days -> 1-2 years
        audited(7, '2022-01-01'), // 731 days -> 2-5 years
        audited(8, '2024-12-30'), // 1825 days -> 2-5 years
        audited(9, '2024-12-31'), // 1826 days -> 5+ years
      ],
      features: geojson([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    });
    expect(buckets().series[0].values).toEqual([1, 1, 2, 2, 2, 1]);
  });

  test('says how many audited streets are missing from the chart, and why', async () => {
    await renderPage();
    const note = text('imagery-freshness-note');
    expect(note).toContain('3 audited streets have a polled capture date');
    expect(note).toContain('0 have not been polled conclusively yet');
  });
});

describe('ImageryPage loading states', () => {
  test('says a city with no routable streets has no ranking, without treating it as an error', async () => {
    await renderPage({ streets: [] });
    expect(text('imagery-status')).toContain('No routable streets in this city yet');
    expect(document.getElementById('imagery-status').classList.contains('error')).toBe(false);
    expect(document.getElementById('imagery-status').classList.contains('hidden')).toBe(false);
  });

  test('keeps the tables when no geometry matched, rather than handing Mapbox an empty bounds box', async () => {
    // A bounds box built from no features is a box of infinities, which takes the whole page down on construction.
    await renderPage({ features: geojson([9999]) });
    expect(text('imagery-status')).toContain('the map is empty');
    expect(regionRows()).toHaveLength(2);
  });

  test('hides the status line once the page has loaded', async () => {
    await renderPage();
    expect(document.getElementById('imagery-status').classList.contains('hidden')).toBe(true);
  });

  test('reports a failed street fetch instead of leaving the page on "Loading"', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await renderPage({ failStreets: true });
    expect(text('imagery-status')).toContain('Could not load street priority data');
    expect(document.getElementById('imagery-status').classList.contains('error')).toBe(true);
  });

  test('renders the pipeline section even when the street fetch fails, since it needs nothing from it', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await renderPage({ failStreets: true });
    expect(document.querySelectorAll('#imagery-jobs tbody tr')).toHaveLength(1);
  });
});

describe('ImageryPage join', () => {
  test('drops streets Explore cannot route to, whatever the GeoJSON carries', async () => {
    const { mapState } = await renderPage({ streets: [CITY[0]], features: geojson([1, 2, 3]) });
    // The GeoJSON carries every street including retired ones; only the priority rows say what is routable, so a
    // retired street joined in would render as "never audited, highest priority".
    expect(mapState.options.bounds).toEqual([[-122.31, 47.6], [-122.3, 47.61]]);
  });

  test('stamps the tier onto the rows the tables and roll-ups read, not only onto the map features', async () => {
    await renderPage();
    const tierCells = streetRows().map((tr) => tr.cells[3].textContent);
    expect(tierCells).toEqual(['Not yet audited', 'Needs re-audit', 'Audited once', 'Audited 2+ times']);
  });
});

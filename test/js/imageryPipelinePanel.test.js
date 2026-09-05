/**
 * @jest-environment <rootDir>/test/js/support/timeZoneJsdomEnvironment.js
 * @jest-environment-options {"timeZone": "Australia/Sydney"}
 */

/**
 * Tests for the Imagery page's pipeline panel (#4908).
 *
 * The panel answers one question — is anything still producing the re-audit signal — and it has to answer it from
 * evidence that is mostly absent: a night with no run has no row at all. So the cases here are about what silence is
 * rendered as. The banner's ladder is ordered worst-first and each rung must be reachable, a night nothing ran must
 * occupy an empty slot on the chart rather than vanish from it, and an empty jobs list must read as a failed read
 * rather than as a quiet night.
 *
 * Pinned to Australia/Sydney: the day axis is built with local date arithmetic and read back as UTC dates, so a
 * UTC-only worker would make every "does the axis line up with the server's nights" assertion vacuous.
 */

const fs = require('fs');
const path = require('path');

const JS_DIR = path.resolve(__dirname, '..', '..', 'public/js/admin-dashboard');

/** Chart calls, recorded instead of drawn — MiniLineChart has its own tests. */
const charts = [];

/** Loads AdminShell + the panel into global scope, with MiniLineChart stubbed. */
function loadPanel() {
  const shell = fs.readFileSync(path.join(JS_DIR, 'AdminShell.js'), 'utf8');
  const panel = fs.readFileSync(path.join(JS_DIR, 'ImageryPipelinePanel.js'), 'utf8');
  globalThis.MiniLineChart = {
    renderInto: (host, labels, series, options) => charts.push({ host, labels, series, options }),
  };
  return (0, eval)(`${shell}\nglobalThis.AdminShell = AdminShell;\n${panel}\nImageryPipelinePanel;`);
}

const ImageryPipelinePanel = loadPanel();

const MARKUP = `
  <select id="imagery-range">
    <option value="30">30</option><option value="90">90</option><option value="365">365</option>
  </select>
  <div id="imagery-pipeline-status"></div>
  <div id="imagery-jobs"></div>
  <p id="imagery-failure-note"></p>
  <div id="imagery-poll-chart"></div>
  <p id="imagery-no-imagery-note"></p>
  <div id="imagery-flag-chart"></div>
`;

const POLL = 'check-imagery-age-actor';
const SYNC = 'imagery-freshness-sync';

/** One `jobs` entry, healthy unless overridden. */
const job = (overrides = {}) => ({
  job_name: POLL,
  label: 'Imagery age poll',
  scheduled_at: '00:45',
  last_status: 'succeeded',
  last_started_at: '2026-08-20T00:45:00Z',
  last_manual_run_at: null,
  last_manual_status: null,
  last_details: { streets_selected: 500, streets_polled: 480 },
  last_error: null,
  hours_since_last_run: 11,
  overdue: false,
  runs_in_window: 30,
  failures_in_window: 0,
  ...overrides,
});

/** One night's counts, quiet unless overridden. */
const night = (day, overrides = {}) => ({
  day,
  streets_selected: 0,
  streets_polled: 0,
  streets_skipped: 0,
  streets_refreshed: 0,
  audits_flagged: 0,
  audits_unflagged: 0,
  poll_failures: 0,
  sync_failures: 0,
  ...overrides,
});

/** A report as /adminapi/imageryFreshness serves it. */
const report = (overrides = {}) => ({
  days: 3,
  since: '2026-08-17T09:00:00Z',
  jobs: [job(), job({ job_name: SYNC, label: 'Imagery freshness sync', scheduled_at: '01:45' })],
  run_days: [night('2026-08-18', { streets_polled: 400, streets_skipped: 100, audits_flagged: 6 })],
  poll_batch_size: 500,
  no_imagery_batch_size: 25,
  overdue_after_hours: 36,
  poll_job: POLL,
  sync_job: SYNC,
  ...overrides,
});

/** Stands the panel up against one canned response and waits for its first render. */
async function renderPanel(payload = report(), opts = {}) {
  document.body.innerHTML = MARKUP;
  charts.length = 0;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => payload });
  const panel = new ImageryPipelinePanel({ pipelineUrl: '/adminapi/imageryFreshness', days: 30, ...opts });
  await panel.init();
  return panel;
}

const statusText = () => document.getElementById('imagery-pipeline-status').textContent;
const statusHtml = () => document.getElementById('imagery-pipeline-status').innerHTML;

beforeAll(() => {
  // Proves the pinned zone actually took: in Sydney this instant is already the 18th locally.
  expect(new Date(Date.parse('2026-08-17T16:00:00Z')).getDate()).toBe(18);
});

afterEach(() => { jest.restoreAllMocks(); });

describe('ImageryPipelinePanel banner', () => {
  test('reports a healthy pipeline with what it actually did', async () => {
    await renderPanel();
    expect(statusHtml()).toContain('ac-badge--good');
    expect(statusText()).toContain('Polled 400 streets in the last 3 days and flagged 6 audits');
  });

  test('leads with a poll that has never run, because nothing downstream can matter then', async () => {
    await renderPanel(report({ jobs: [job({ last_status: 'never_run' })] }));
    expect(statusHtml()).toContain('ac-badge--bad');
    expect(statusText()).toContain('has never run here');
  });

  test('calls out a poll that runs but cannot poll, separately from one that is not running', async () => {
    // A rotated-out API key looks identical to a healthy pipeline from the schedule's side: the job succeeds nightly.
    await renderPanel(report({
      jobs: [job({ last_details: { not_polled_reason: 'no Mapillary key configured' } })],
    }));
    expect(statusHtml()).toContain('ac-badge--bad');
    expect(statusText()).toContain('running but not polling: no Mapillary key configured');
  });

  test('reports an overdue poll against the window the server defines, not a number of its own', async () => {
    await renderPanel(report({ jobs: [job({ overdue: true })], overdue_after_hours: 72 }));
    expect(statusText()).toContain('over 72 hours');
    expect(statusHtml()).toContain('ac-badge--bad');
  });

  test('reports the most recent poll failing as a warning, since earlier nights may still have flagged', async () => {
    await renderPanel(report({ jobs: [job({ last_status: 'failed', last_error: 'HTTP 429' })] }));
    expect(statusHtml()).toContain('ac-badge--warn');
    expect(statusText()).toContain('HTTP 429');
  });

  test('reports a healthy poll whose flag sync is not running', async () => {
    // The two failures look the same from outside — nothing new gets flagged — so the sync gets its own rung.
    await renderPanel(report({
      jobs: [job(), job({ job_name: SYNC, overdue: true, last_error: null })],
    }));
    expect(statusHtml()).toContain('ac-badge--warn');
    expect(statusText()).toContain('flag sync');
  });

  test('reports a poll that ran all window and refreshed nothing', async () => {
    await renderPanel(report({ run_days: [night('2026-08-18', { streets_skipped: 500 })] }));
    expect(statusHtml()).toContain('ac-badge--warn');
    expect(statusText()).toContain('refreshed no streets in the last 3 days');
  });

  test('finds the poll by the role the report assigns, not by a name of its own', async () => {
    // The job names live in ScheduledJobs. A copy kept here would survive a rename as a poll it can never find, and
    // an unfindable poll reads exactly like one that has never run — a healthy pipeline reported as dead.
    await renderPanel(report({
      jobs: [job({ job_name: 'imagery-age-poll-v2' })],
      poll_job: 'imagery-age-poll-v2',
    }));
    expect(statusHtml()).toContain('ac-badge--good');
    expect(statusText()).toContain('Polled 400 streets');
  });

  test('reads a report with no jobs at all as the worst case rather than as healthy', async () => {
    await renderPanel(report({ jobs: [] }));
    expect(statusHtml()).toContain('ac-badge--bad');
  });

  test('escapes an error message rather than interpolating it into the banner', async () => {
    await renderPanel(report({ jobs: [job({ last_status: 'failed', last_error: '<img src=x>' })] }));
    expect(statusHtml()).not.toContain('<img');
  });
});

describe('ImageryPipelinePanel jobs table', () => {
  test('renders one row per job, through the shared formatters', async () => {
    await renderPanel();
    const rows = [...document.querySelectorAll('#imagery-jobs tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0].cells[0].textContent).toBe('Imagery age poll');
    expect(rows[0].cells[1].textContent).toBe('00:45');
    expect(rows[0].cells[2].innerHTML).toContain('ac-badge--good');
    expect(rows[0].cells[4].textContent).toContain('streets polled: 480');
  });

  test('says the panel is blind when the job list is empty, rather than showing a clean table', async () => {
    // The roster is a compile-time constant server-side, so an empty list can only mean the read failed.
    await renderPanel(report({ jobs: [] }));
    const jobs = document.getElementById('imagery-jobs');
    expect(jobs.textContent).toContain('blind, not clear');
    expect(jobs.querySelector('.ac-badge--bad')).not.toBeNull();
  });
});

describe('ImageryPipelinePanel failure note', () => {
  test('says plainly when nothing failed', async () => {
    await renderPanel();
    expect(document.getElementById('imagery-failure-note').textContent)
      .toBe('No run of either job failed in the last 3 days.');
  });

  test('names the nights that failed, which the last-run table cannot show', async () => {
    // The jobs table reports each job's *last* run, so a pipeline failing every other night reads as healthy there
    // whenever the most recent run happened to succeed.
    await renderPanel(report({
      run_days: [
        night('2026-08-18', { poll_failures: 1 }),
        night('2026-08-19', { sync_failures: 2 }),
        night('2026-08-20', { streets_polled: 400 }),
      ],
    }));
    const note = document.getElementById('imagery-failure-note').textContent;
    expect(note).toContain('2 of the last 3 nights');
    expect(note).toContain('2026-08-18, 2026-08-19');
  });
});

describe('ImageryPipelinePanel charts', () => {
  test('gives every night in the window a slot, so a night nothing ran is visibly empty', async () => {
    await renderPanel();
    const [poll] = charts;
    // since is 2026-08-17 and the window is 3 days, so the axis runs 17th through 20th inclusive.
    expect(poll.labels).toEqual(['08-17', '08-18', '08-19', '08-20']);
    expect(poll.series.find((s) => s.key === 'polled').values).toEqual([0, 400, 0, 0]);
    expect(poll.series.find((s) => s.key === 'skipped').values).toEqual([0, 100, 0, 0]);
  });

  test('lines the axis up with the server\'s nights from a viewer east of UTC', async () => {
    // The axis is built with local date arithmetic and read back as UTC dates, which is the frame the server keys its
    // nights in. In Sydney the local date is a day ahead for most of the UTC day, so a slip shows here and nowhere
    // else: the 400 polled streets would land on the wrong bar, or on none.
    await renderPanel();
    const polled = charts[0].series.find((s) => s.key === 'polled').values;
    expect(charts[0].labels[polled.indexOf(400)]).toBe('08-18');
  });

  test('charts flags in both directions, since clearing one is as normal as raising it', async () => {
    await renderPanel();
    const flags = charts[1];
    expect(flags.series.map((s) => s.key)).toEqual(['flagged', 'unflagged']);
    expect(flags.series[0].values).toEqual([0, 6, 0, 0]);
  });

  test('draws the nightly batch size as the line the bars are read against', async () => {
    // A bar's height says nothing on its own: 400 polled is most of a 500-street batch and a fraction of a 5,000 one.
    await renderPanel();
    expect(charts[0].options.refLine).toEqual({ value: 500, key: 'batch', label: 'batch size 500' });
    expect(charts[0].options.ariaLabel).toContain('500');
  });

  test('leaves the target off when the server reports no usable batch size', async () => {
    await renderPanel(report({ poll_batch_size: 0 }));
    expect(charts[0].options.refLine).toBeUndefined();
  });

  test('keeps the target off the flag chart, which counts audits rather than streets', async () => {
    await renderPanel();
    expect(charts[1].options.refLine).toBeUndefined();
  });

  test('labels both charts for screen readers', async () => {
    await renderPanel();
    charts.forEach((chart) => expect(chart.options.ariaLabel).toBeTruthy());
  });
});

describe('ImageryPipelinePanel window selector', () => {
  test('opens on the window the server chose as its default', async () => {
    await renderPanel(report(), { days: 90 });
    expect(document.getElementById('imagery-range').value).toBe('90');
    expect(global.fetch).toHaveBeenCalledWith('/adminapi/imageryFreshness?days=90', expect.anything());
  });

  test('refetches when the reader picks another window', async () => {
    const panel = await renderPanel();
    const select = document.getElementById('imagery-range');
    select.value = '365';
    select.dispatchEvent(new window.Event('change'));
    await new Promise(process.nextTick);
    expect(global.fetch).toHaveBeenLastCalledWith('/adminapi/imageryFreshness?days=365', expect.anything());
    expect(panel).toBeDefined();
  });

  test('ends on the window the selector says, even when the reader flips through them', async () => {
    // The queued window is compared against the window that was actually fetched, not against the selector's current
    // value — those are equal by the time the request lands, so comparing them drops the queued load and leaves the
    // charts a window behind the control that appears to drive them.
    document.body.innerHTML = MARKUP;
    charts.length = 0;
    const resolvers = [];
    global.fetch = jest.fn(() => new Promise((resolve) => {
      resolvers.push(() => resolve({ ok: true, json: async () => report() }));
    }));

    const panel = new ImageryPipelinePanel({ pipelineUrl: '/adminapi/imageryFreshness', days: 30 });
    const started = panel.init();
    const select = document.getElementById('imagery-range');
    select.value = '90';
    select.dispatchEvent(new window.Event('change'));
    select.value = '365';
    select.dispatchEvent(new window.Event('change'));

    resolvers[0]();
    await new Promise(process.nextTick);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenLastCalledWith('/adminapi/imageryFreshness?days=365', expect.anything());

    resolvers[1]();
    await started;
  });

  test('does not refetch when the queued window is the one already showing', async () => {
    document.body.innerHTML = MARKUP;
    const resolvers = [];
    global.fetch = jest.fn(() => new Promise((resolve) => {
      resolvers.push(() => resolve({ ok: true, json: async () => report() }));
    }));

    const panel = new ImageryPipelinePanel({ pipelineUrl: '/adminapi/imageryFreshness', days: 30 });
    const started = panel.init();
    const select = document.getElementById('imagery-range');
    select.value = '90';
    select.dispatchEvent(new window.Event('change'));
    select.value = '30';
    select.dispatchEvent(new window.Event('change'));

    resolvers[0]();
    await started;
    await new Promise(process.nextTick);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('ImageryPipelinePanel failure handling', () => {
  test('says the history could not be read rather than leaving the loading line up', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    document.body.innerHTML = MARKUP;
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    await new ImageryPipelinePanel({ pipelineUrl: '/adminapi/imageryFreshness', days: 30 }).init();
    expect(statusText()).toContain('Could not load the pipeline history');
    expect(document.getElementById('imagery-pipeline-status').classList.contains('error')).toBe(true);
  });

  test('hands the report to its owner only when one arrived', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const onLoaded = jest.fn();
    document.body.innerHTML = MARKUP;
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    await new ImageryPipelinePanel({ pipelineUrl: '/x', days: 30, onLoaded }).init();
    expect(onLoaded).not.toHaveBeenCalled();
  });

  test('hands the loaded report to its owner, so the page fills its KPIs from the same fetch', async () => {
    const onLoaded = jest.fn();
    await renderPanel(report(), { onLoaded });
    expect(onLoaded).toHaveBeenCalledWith(expect.objectContaining({ poll_batch_size: 500 }));
  });
});

describe('the regained-imagery rotation line', () => {
  test('totals the rotation over the window and names its nightly size', async () => {
    await renderPanel(report({
      run_days: [
        night('2026-08-18', { no_imagery_selected: 25, no_imagery_polled: 24, reopen_candidates: 1 }),
        night('2026-08-19', { no_imagery_selected: 25, no_imagery_polled: 25, reopen_candidates: 0 }),
      ],
    }));

    const text = document.getElementById('imagery-no-imagery-note').textContent;
    expect(text).toContain('49 of 50');
    expect(text).toContain('1 for review');
    expect(text).toContain('25 a night');
  });

  test('says a rotation covered nothing rather than leaving the line blank', async () => {
    // The counters exist because a rotation that stopped looks exactly like a city whose retired streets never
    // regain imagery. A blank line here would put that failure mode straight back.
    await renderPanel(report());
    expect(document.getElementById('imagery-no-imagery-note').textContent)
      .toMatch(/No retired street was re-checked/);
  });
});

/**
 * Tests for the "Nightly jobs" panel on /admin/health (#4928).
 *
 * The panel's whole job is to be honest about what it does not know, so the contracts worth pinning are the ones that
 * decide whether a row reads as healthy: an unrecognized status must not render green, a hand-triggered run must sit
 * beside the schedule's record rather than replace it, an empty panel is a failed read rather than a quiet night, and
 * the rows sort worst-first because on a healthy night every row says the same thing.
 *
 * Runs under jsdom (jest.config.js). HealthPage and AdminShell are bare top-level classes in a concatenated bundle,
 * so they are eval'd into global scope rather than required.
 */

const fs = require('fs');
const path = require('path');

const JS_DIR = path.resolve(__dirname, '..', '..', 'public/js/admin-dashboard');

/** Loads AdminShell into global scope and returns the HealthPage class. */
function loadPage() {
  const shell = fs.readFileSync(path.join(JS_DIR, 'AdminShell.js'), 'utf8');
  const page = fs.readFileSync(path.join(JS_DIR, 'HealthPage.js'), 'utf8');
  return (0, eval)(`${shell}\nglobalThis.AdminShell = AdminShell;\n${page}\nHealthPage;`);
}

const HealthPage = loadPage();

const MARKUP = `
  <span id="kpi-locks"></span><span id="kpi-idle"></span><span id="kpi-slow"></span>
  <span id="kpi-conns"></span><span id="kpi-evos"></span><span id="kpi-panos"></span>
  <p id="health-pulse"></p><p id="health-meta"></p><span id="health-meta-age"></span>
  <div id="health-jobs"></div><p id="health-jobs-note"></p>
  <div id="health-locks"></div><div id="health-idle"></div><div id="health-active"></div>
  <div id="health-evolutions"></div><div id="health-bloat"></div><div id="health-conns"></div>
  <div id="health-panos"></div><p id="health-panos-note"></p><div id="health-panos-tiles"></div>
`;

const THRESHOLDS = {
  idle_txn_warn_seconds: 120,
  idle_txn_bad_seconds: 600,
  lock_wait_warn_seconds: 10,
  lock_wait_bad_seconds: 60,
  active_query_warn_seconds: 30,
  active_query_bad_seconds: 120,
  bloat_warn_ratio: 0.2,
  bloat_bad_ratio: 0.4,
  bloat_min_dead_tuples: 10000,
  vacuum_age_warn_seconds: 604800,
  conn_pool_max: 25,
  conn_warn_active: 17,
  conn_bad_active: 22,
  job_overdue_hours: 36,
  job_window_days: 7,
};

/** One nightly_jobs entry, healthy unless overridden. */
function job(overrides = {}) {
  return {
    job_name: 'check-image-expiry-actor',
    label: 'Imagery expiry sweep',
    scheduled_at: '00:15',
    last_started_at: '2026-08-20T00:15:00Z',
    last_finished_at: '2026-08-20T00:20:00Z',
    last_duration_seconds: 300,
    last_status: 'succeeded',
    last_details: { panos_checked: 1200, gone: 3 },
    last_error: null,
    hours_since_last_run: 4,
    overdue: false,
    last_manual_run_at: null,
    last_manual_status: null,
    runs_in_window: 7,
    failures_in_window: 0,
    ...overrides,
  };
}

/** Renders the panel for a set of job rows and returns the page's DOM. */
async function render(jobs) {
  document.body.innerHTML = MARKUP;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      generated_at: '2026-08-20T04:00:00Z',
      current_database: 'sidewalk',
      current_role: 'sidewalk',
      can_see_all_queries: true,
      blocking_sessions: [],
      idle_in_transaction: [],
      active_queries: [],
      stuck_evolutions: [],
      table_bloat: [],
      connections: [],
      pano_backups: null,
      nightly_jobs: jobs,
      thresholds: THRESHOLDS,
    }),
  });
  // init() also starts poll and age tickers; stub them so jsdom isn't left with live intervals.
  jest.spyOn(global, 'setInterval').mockImplementation(() => 0);
  await new HealthPage({ healthUrl: '/adminapi/dbHealth' }).init();
}

/** The rendered row for each job, as [label, badge text, when, duration, result, failures]. */
function rows() {
  return [...document.querySelectorAll('#health-jobs tbody tr')]
    .map((tr) => [...tr.cells].map((td) => td.textContent.replace(/\s+/g, ' ').trim()));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the nightly jobs panel', () => {
  test('renders a row per job with its schedule, duration and recorded counts', async () => {
    await render([job()]);
    const [label, scheduled, badge, when, duration, result, failures] = rows()[0];
    expect(label).toBe('Imagery expiry sweep');
    expect(scheduled).toBe('00:15');
    expect(badge).toBe('ok');
    expect(when).toMatch(/ago|2026/);
    expect(duration).toBe('5m 0s');
    // Details are rendered as whatever the job stored, rather than by naming fields the panel is taught one by one.
    expect(result).toBe('panos checked: 1,200, gone: 3');
    expect(failures).toBe('0/7');
  });

  test('reads an unknown status as a reason to look, not a clean bill of health', async () => {
    await render([job({ last_status: 'quarantined' })]);
    const badge = document.querySelector('#health-jobs tbody td:nth-child(3) span');
    // A status the server grows and this page has not learned yet must never render as healthy — that is the one
    // direction a health panel cannot be allowed to drift.
    expect(badge.className).toContain('ac-badge--warn');
    expect(badge.textContent).toBe('quarantined');
  });

  test('sorts an unknown status to the top, ahead of the healthy rows', async () => {
    await render([
      job({ label: 'Healthy', last_status: 'succeeded' }),
      job({ label: 'Unknown', last_status: 'quarantined' }),
    ]);
    expect(rows().map((r) => r[0])).toEqual(['Unknown', 'Healthy']);
  });

  test('sorts overdue jobs above everything, then worst status first', async () => {
    await render([
      job({ label: 'Fine', last_status: 'succeeded', overdue: false }),
      job({ label: 'Failed', last_status: 'failed', overdue: false }),
      job({ label: 'Never run', last_status: 'never_run', overdue: true }),
      job({ label: 'Overdue but ok', last_status: 'succeeded', overdue: true }),
    ]);
    expect(rows().map((r) => r[0])).toEqual(['Never run', 'Overdue but ok', 'Failed', 'Fine']);
  });

  test('labels a job whose last scheduled run succeeded but is too old as overdue', async () => {
    await render([job({ last_status: 'succeeded', overdue: true })]);
    const badge = document.querySelector('#health-jobs tbody td:nth-child(3) span');
    expect(badge.textContent).toBe('overdue');
    expect(badge.className).toContain('ac-badge--warn');
  });

  test('keeps a failed job red even when it is also overdue', async () => {
    await render([job({ last_status: 'failed', overdue: true })]);
    const badge = document.querySelector('#health-jobs tbody td:nth-child(3) span');
    expect(badge.className).toContain('ac-badge--bad');
    expect(badge.textContent).toBe('failed');
  });

  test('shows a hand-triggered run beside the schedule\'s record, not in place of it', async () => {
    await render([job({
      last_status: 'failed',
      last_error: 'java.io.IOException: provider timeout',
      last_manual_run_at: '2026-08-20T09:00:00Z',
      last_manual_status: 'succeeded',
    })]);
    const [, , badge, when, , result] = rows()[0];
    // The morning-after "run it now" click proves the code works, not that anything is still firing it, so the badge
    // and the error still describe the night.
    expect(badge).toBe('failed');
    expect(result).toBe('java.io.IOException: provider timeout');
    expect(when).toMatch(/manual/);
    expect(when).toMatch(/succeeded/);
  });

  test('says a job has never run rather than leaving the cell blank', async () => {
    await render([job({
      last_started_at: null,
      last_finished_at: null,
      last_duration_seconds: null,
      last_status: 'never_run',
      last_details: null,
      hours_since_last_run: null,
      overdue: true,
      runs_in_window: 0,
      failures_in_window: 0,
    })]);
    const [, , badge, when, duration, result] = rows()[0];
    expect(badge).toBe('never run');
    expect(when).toBe('never');
    expect(duration).toBe('—');
    expect(result).toBe('—');
  });

  test('flags a non-zero failure count in the window', async () => {
    await render([job({ runs_in_window: 7, failures_in_window: 3 })]);
    const cell = document.querySelector('#health-jobs tbody td:nth-child(7)');
    expect(cell.textContent.trim()).toBe('3/7');
    expect(cell.querySelector('.ac-badge--warn')).not.toBeNull();
  });

  test('reads an empty panel as a failed read, never as a quiet night', async () => {
    await render([]);
    // The roster is a compile-time constant, so the server always returns a row per job unless the read failed and
    // was recovered to an empty list. Rendering that as "nothing scheduled" would be the exact blind spot the panel
    // exists to close.
    const panel = document.getElementById('health-jobs');
    expect(panel.querySelector('.ac-badge--bad')).not.toBeNull();
    expect(panel.textContent).toMatch(/blind, not clear/);
    expect(panel.querySelector('table')).toBeNull();
  });

  test('summarizes overdue jobs beneath the table, in the server\'s own threshold', async () => {
    await render([job(), job({ label: 'Other', overdue: true })]);
    expect(document.getElementById('health-jobs-note').textContent)
      .toBe('1 job has not succeeded on schedule in the last 36 hours.');
  });

  test('says so plainly when every job is healthy', async () => {
    await render([job()]);
    expect(document.getElementById('health-jobs-note').textContent)
      .toBe('Every job has succeeded on schedule within the last 36 hours.');
  });

  test('escapes a job label and a recorded error rather than trusting them as markup', async () => {
    await render([job({ label: '<img src=x onerror=1>', last_status: 'failed', last_error: '<b>boom</b>' })]);
    const panel = document.getElementById('health-jobs');
    expect(panel.querySelector('img')).toBeNull();
    expect(panel.querySelector('b')).toBeNull();
    expect(panel.textContent).toMatch(/<img src=x onerror=1>/);
  });
});

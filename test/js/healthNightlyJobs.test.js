/**
 * Tests for the "Nightly jobs" panel on /admin/health (#4928), and for the page's other panels and polling (#5840).
 *
 * The panel's whole job is to be honest about what it does not know, so the contracts worth pinning are the ones that
 * decide whether a row reads as healthy: an unrecognized status must not render green, a hand-triggered run must sit
 * beside the schedule's record rather than replace it, an empty panel is a failed read rather than a quiet night, and
 * the rows sort worst-first because on a healthy night every row says the same thing.
 */

import { loadModules } from './loader.js';
import { flush, textOf } from './support/routeFetch.js';

const { HealthPage } = await loadModules('frontend/js/admin-dashboard/HealthPage.js');

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
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
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
  }));
  // init() also starts poll and age tickers; stub them so jsdom isn't left with live intervals.
  vi.spyOn(window, 'setInterval').mockImplementation(() => 0);
  await new HealthPage({ healthUrl: '/adminapi/dbHealth' }).init();
}

/** The rendered row for each job, as [label, badge text, when, duration, result, failures]. */
function rows() {
  return [...document.querySelectorAll('#health-jobs tbody tr')]
    .map((tr) => [...tr.cells].map((td) => td.textContent.replace(/\s+/g, ' ').trim()));
}

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

  test('sorts the same way whichever order the server sends', async () => {
    await render([
      job({ label: 'Fine', last_status: 'succeeded' }),
      job({ label: 'Running', last_status: 'running' }),
      job({ label: 'Unknown', last_status: 'quarantined' }),
      job({ label: 'Late', overdue: true }),
    ]);
    expect(rows().map((r) => r[0])).toEqual(['Late', 'Unknown', 'Running', 'Fine']);
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

  test('shows a run its process died in as interrupted, in the bad tone, between abandoned and failed', async () => {
    await render([
      job({ label: 'Failed', last_status: 'failed' }),
      job({ label: 'Interrupted', last_status: 'interrupted' }),
      job({ label: 'Abandoned', last_status: 'abandoned' }),
    ]);
    expect(rows().map((r) => r[0])).toEqual(['Abandoned', 'Interrupted', 'Failed']);
    const badge = [...document.querySelectorAll('#health-jobs tbody tr')][1].querySelector('td:nth-child(3) span');
    expect(badge.textContent).toBe('interrupted');
    expect(badge.className).toContain('ac-badge--bad');
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

/** The view's KPI row, meta line and panels, with their production ids. */
const PAGE_MARKUP = `
  <div class="ac-pulse" id="health-pulse" role="status" aria-live="polite">Loading health…</div>
  <span id="kpi-blocking">—</span><span id="kpi-active">—</span><span id="kpi-idle">—</span>
  <span id="kpi-evolutions">—</span><span id="kpi-bloat">—</span><span id="kpi-connections">—</span>
  <span id="kpi-panos">—</span>
  <p class="ac-note" id="health-meta"></p>
  <div id="health-jobs"></div><p class="ac-note" id="health-jobs-note"></p>
  <div id="health-locks"></div><div id="health-active"></div><div id="health-idle"></div>
  <div id="health-evolutions"></div><div id="health-bloat"></div><div id="health-connections"></div>
  <div id="health-panos"></div><p class="ac-note" id="health-panos-note"></p>`;

/** A quiet /adminapi/dbHealth payload: nothing blocking, idle, slow, stuck or bloated. */
function health(overrides = {}) {
  return {
    generated_at: '2026-08-20T04:00:00Z',
    current_database: 'sidewalk',
    current_role: 'sidewalk_seattle',
    can_see_all_queries: true,
    blocking_sessions: [],
    idle_in_transaction: [],
    active_queries: [],
    stuck_evolutions: [],
    table_bloat: [],
    connections: [],
    pano_backups: null,
    nightly_jobs: [job()],
    thresholds: THRESHOLDS,
    ...overrides,
  };
}

/**
 * Starts the page on the given replies, one per request (the last repeats), and catches its timers.
 * @param {...any} replies - Payloads, or Errors for a failed request.
 * @returns {Promise<{fetch: import('vitest').Mock, visibilityChange: Function, poll: Function, tick: Function}>} The
 *   fetch stub, plus the page's tab-visibility handler, poll and 1-second age ticker, to run by hand.
 */
async function start(...replies) {
  document.body.innerHTML = PAGE_MARKUP;
  let n = 0;
  const fetch = vi.fn(async () => {
    const reply = replies[Math.min(n++, replies.length - 1)];
    if (reply instanceof Error) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => reply };
  });
  vi.stubGlobal('fetch', fetch);
  const timers = [];
  vi.spyOn(window, 'setInterval').mockImplementation((fn, ms) => {
    timers.push({ fn, ms });
    return 0;
  });
  // Kept off the real document, where every earlier test's page is still listening.
  let onVisible;
  const addListener = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, fn, opts) => {
    if (type === 'visibilitychange') onVisible = fn;
    else addListener(type, fn, opts);
  });
  await new HealthPage({ healthUrl: '/adminapi/dbHealth', pollSeconds: 20 }).init();
  return {
    fetch,
    visibilityChange: () => onVisible(),
    poll: () => timers.find((t) => t.ms === 20000).fn(),
    tick: () => timers.find((t) => t.ms === 1000).fn(),
  };
}

const text = (id) => textOf(document.getElementById(id));
const kpi = (id) => {
  const el = document.getElementById(id);
  return [el.textContent, [...el.classList].find((c) => c.startsWith('health-kpi--')).replace('health-kpi--', '')];
};
const panelRows = (id) => [...document.querySelectorAll(`#${id} tbody tr`)].map((tr) => [...tr.cells].map(textOf));
const badgeTone = (el) => [...el.querySelector('.ac-badge').classList].find((c) => c.startsWith('ac-badge--'))
  .replace('ac-badge--', '');

describe('a quiet database', () => {
  test('reads all clear, with every panel saying what it found nothing of', async () => {
    await start(health());
    expect(text('health-pulse')).toBe('All clear — nothing blocking, stuck, or idle too long.');
    expect(badgeTone(document.getElementById('health-pulse'))).toBe('good');
    expect(kpi('kpi-blocking')).toEqual(['0', 'good']);
    expect(kpi('kpi-active')).toEqual(['0', 'good']);
    expect(kpi('kpi-idle')).toEqual(['0', 'good']);
    expect(kpi('kpi-evolutions')).toEqual(['0', 'good']);
    expect(kpi('kpi-bloat')).toEqual(['0', 'good']);
    expect(kpi('kpi-connections')).toEqual(['0', 'ok']);
    // No pano stats is unknown, not healthy, so it isn't green.
    expect(kpi('kpi-panos')).toEqual(['—', 'ok']);
    expect(text('health-locks')).toBe('✓ No sessions are blocking others.');
    expect(text('health-active')).toBe('✓ No long-running queries.');
    expect(text('health-idle')).toBe('✓ No sessions are idle in a transaction.');
    expect(text('health-evolutions')).toBe('✓ All evolutions are applied cleanly.');
    expect(text('health-bloat')).toBe('✓ No stats for the largest tables.');
    expect(text('health-connections')).toBe('✓ No client connections.');
    expect(text('health-panos')).toBe('✓ Pano backup stats are unavailable.');
  });

  test('reads a payload with no job list as a blind jobs panel', async () => {
    await start(health({ nightly_jobs: undefined }));
    expect(text('health-jobs')).toMatch(/blind, not clear/);
  });

  test('treats missing lists and thresholds as empty', async () => {
    await start({ nightly_jobs: [job()] });
    expect(text('health-pulse')).toMatch(/^All clear/);
    expect(text('health-locks')).toBe('✓ No sessions are blocking others.');
    expect(text('health-meta')).toBe('updated 0s ago');
  });
});

describe('the meta line', () => {
  test('names the database and role, and warns when the role cannot see other sessions', async () => {
    await start(health({ can_see_all_queries: false }));
    const meta = text('health-meta');
    expect(meta).toMatch(/^updated 0s ago · db sidewalk · role sidewalk_seattle · role lacks pg_read_all_stats/);
    expect(meta).toContain("panels show only this app's own sessions");
  });

  test('counts the age up between polls, in seconds then minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { tick } = await start(health());
      vi.advanceTimersByTime(42000);
      tick();
      expect(text('health-meta-age')).toBe('42s ago');
      vi.advanceTimersByTime(150000);
      tick();
      expect(text('health-meta-age')).toBe('3m ago');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the pulse', () => {
  test('lists every problem, and goes red for blocking or stuck work', async () => {
    await start(health({
      blocking_sessions: [{ pid: 1, blocking_count: 1 }, { pid: 2, blocking_count: 1 }],
      idle_in_transaction: [{ pid: 3, idle_seconds: 700 }],
      active_queries: [{ pid: 4, query_seconds: 40 }],
      stuck_evolutions: [{ schema: 'sidewalk_seattle', id: 400 }],
      table_bloat: [{ schema_name: 's', rel_name: 't', dead_ratio: 0.5, dead_tuples: 50000, live_tuples: 1 }],
    }));
    expect(text('health-pulse')).toBe('Needs attention — 2 blocking sessions, 1 long idle transaction, '
      + '1 long-running query, 1 stuck evolution, 1 bloated table');
    expect(badgeTone(document.getElementById('health-pulse'))).toBe('bad');
  });

  test('stays amber for a long idle transaction alone, with plurals for several', async () => {
    await start(health({ idle_in_transaction: [{ idle_seconds: 600 }, { idle_seconds: 900 }, { idle_seconds: 5 }] }));
    expect(text('health-pulse')).toBe('Needs attention — 2 long idle transactions');
    expect(badgeTone(document.getElementById('health-pulse'))).toBe('warn');
  });

  test('goes amber for slow queries and red once one passes the bad line', async () => {
    await start(health({ active_queries: [{ query_seconds: 31 }, { query_seconds: null }] }));
    expect(text('health-pulse')).toBe('Needs attention — 2 long-running queries');
    expect(badgeTone(document.getElementById('health-pulse'))).toBe('warn');
    await start(health({ active_queries: [{ query_seconds: 121 }] }));
    expect(badgeTone(document.getElementById('health-pulse'))).toBe('bad');
  });

  test('stays amber for bloat alone, and red when a stuck evolution comes with it', async () => {
    const bloat = { dead_ratio: 0.25, dead_tuples: 20000 };
    await start(health({ table_bloat: [bloat, bloat] }));
    expect(text('health-pulse')).toBe('Needs attention — 2 bloated tables');
    expect(badgeTone(document.getElementById('health-pulse'))).toBe('warn');
    await start(health({ table_bloat: [bloat], stuck_evolutions: [{}, {}] }));
    expect(text('health-pulse')).toBe('Needs attention — 2 stuck evolutions, 1 bloated table');
    expect(badgeTone(document.getElementById('health-pulse'))).toBe('bad');
  });

  test('keeps the last good panels and says the poll failed, with the reason', async () => {
    const { poll } = await start(health({ blocking_sessions: [{ pid: 7, blocking_count: 1 }] }), new Error());
    poll();
    await flush();
    expect(text('health-pulse')).toBe('Could not load health data. Request failed (503): /adminapi/dbHealth');
    expect(panelRows('health-locks')).toHaveLength(1);
  });
});

describe('the KPI tones', () => {
  test('flag each kind of trouble in its own tone', async () => {
    await start(health({
      blocking_sessions: [{ pid: 1 }],
      active_queries: [{ query_seconds: 10 }],
      idle_in_transaction: [{ idle_seconds: 130 }, {}],
      stuck_evolutions: [{}],
      table_bloat: [{ dead_ratio: 0.3, dead_tuples: 20000 }],
      connections: [{ usename: 'a', state: 'active', count: 1200 }, { usename: 'b', state: 'idle' }],
      pano_backups: { labeled_panos: 2000000, backed_up: 0, unchecked: 0, no_backup: 0, at_risk: 3400 },
    }));
    expect(kpi('kpi-blocking')).toEqual(['1', 'bad']);
    expect(kpi('kpi-active')).toEqual(['1', 'warn']);
    expect(kpi('kpi-idle')).toEqual(['2', 'warn']);
    expect(kpi('kpi-evolutions')).toEqual(['1', 'bad']);
    expect(kpi('kpi-bloat')).toEqual(['1', 'warn']);
    expect(kpi('kpi-connections')).toEqual(['1,200', 'ok']);
    expect(kpi('kpi-panos')).toEqual(['3k', 'warn']);
  });

  test('turn the long-query count red past the bad line, and at-risk panos green at zero', async () => {
    await start(health({
      active_queries: [{ query_seconds: 500 }],
      pano_backups: { labeled_panos: 0, backed_up: 0, unchecked: 0, no_backup: 0, at_risk: 0 },
    }));
    expect(kpi('kpi-active')).toEqual(['1', 'bad']);
    expect(kpi('kpi-panos')).toEqual(['0', 'good']);
  });
});

describe('the session panels', () => {
  test('list blocking sessions with their state, wait tone, locks and query', async () => {
    await start(health({ blocking_sessions: [
      { pid: 11, usename: 'sidewalk', state: 'idle in transaction', xact_seconds: 75, blocking_count: 3,
        max_wait_seconds: 61, held_locks: 'ExclusiveLock on label', query: 'UPDATE label SET x = 1' },
      { pid: 12, usename: null, state: 'active', xact_seconds: null, blocking_count: 1, max_wait_seconds: 15,
        held_locks: null, query: null },
      { pid: 13, usename: 'a', state: 'idle', blocking_count: 1, max_wait_seconds: null, query: 'x'.repeat(200) },
      { pid: 14, usename: 'b', state: null, blocking_count: 1, max_wait_seconds: 2, query: 'SELECT 1' },
    ] }));
    const [first, second, third, fourth] = panelRows('health-locks');
    expect(first).toEqual(['11', 'sidewalk', 'idle in transaction', '1m 15s', '3', '1m 1s', 'ExclusiveLock on label',
      'UPDATE label SET x = 1']);
    // A role that can't read another session's statement sees it hidden, not blank.
    expect(second).toEqual(['12', '—', 'active', '—', '1', '15s', '—', 'hidden']);
    expect(third[7]).toBe(`${'x'.repeat(160)}…`);
    expect(fourth[2]).toBe('—');
    const rowsEls = document.querySelectorAll('#health-locks tbody tr');
    expect([...rowsEls].map((tr) => badgeTone(tr.cells[4]))).toEqual(['bad', 'warn', 'ok', 'ok']);
    expect([...rowsEls].slice(0, 3).map((tr) => badgeTone(tr.cells[2]))).toEqual(['warn', 'ok', 'good']);
  });

  test('list long-running queries, toned by how long they have run', async () => {
    await start(health({ active_queries: [
      { pid: 21, usename: 'sidewalk', application_name: 'psql', query_seconds: 130, wait_event_type: 'Lock',
        query: 'SELECT pg_sleep(130)' },
      { pid: 22, query_seconds: 45 },
      { pid: 23, query_seconds: null },
    ] }));
    const rows = panelRows('health-active');
    expect(rows[0]).toEqual(['21', 'sidewalk', 'psql', '2m 10s', 'Lock', 'SELECT pg_sleep(130)']);
    expect(rows[1]).toEqual(['22', '—', '—', '45s', '—', 'hidden']);
    const tones = [...document.querySelectorAll('#health-active tbody tr')].map((tr) => badgeTone(tr.cells[3]));
    expect(tones).toEqual(['bad', 'warn', 'ok']);
  });

  test('list idle transactions, toned by how long they have sat', async () => {
    await start(health({ idle_in_transaction: [
      { pid: 31, usename: 'sidewalk', application_name: 'app', idle_seconds: 601, xact_seconds: 700, query: 'BEGIN' },
      { pid: 32, idle_seconds: 121 },
      { pid: 33 },
    ] }));
    const rows = panelRows('health-idle');
    expect(rows[0]).toEqual(['31', 'sidewalk', 'app', '10m 1s', '11m 40s', 'BEGIN']);
    expect(rows[2]).toEqual(['33', '—', '—', '—', '—', 'hidden']);
    const tones = [...document.querySelectorAll('#health-idle tbody tr')].map((tr) => badgeTone(tr.cells[3]));
    expect(tones).toEqual(['bad', 'warn', 'ok']);
  });
});

describe('the stuck evolutions panel', () => {
  test('lists each with its state, when it was applied and what went wrong', async () => {
    await start(health({ stuck_evolutions: [
      { schema: 'sidewalk_seattle', id: 401, state: 'applying_up', applied_at: '2026-08-19 03:00:00.123456',
        last_problem: 'ERROR: <relation> missing' },
      { schema: 'sidewalk_chicago', id: 402, state: null, applied_at: null, last_problem: null },
    ] }));
    expect(panelRows('health-evolutions')).toEqual([
      ['sidewalk_seattle', '401', 'applying_up', '2026-08-19 03:00:00', 'ERROR: <relation> missing'],
      ['sidewalk_chicago', '402', 'unknown', '—', '—'],
    ]);
  });
});

describe('the table bloat panel', () => {
  test('flags only tables with enough dead rows, and says when one was never vacuumed', async () => {
    await start(health({ table_bloat: [
      { schema_name: 'sidewalk_seattle', rel_name: 'label', live_tuples: 2500000, dead_tuples: 1500000,
        dead_ratio: 0.375, vacuum_age_seconds: 90000 },
      { schema_name: 'sidewalk_seattle', rel_name: 'audit_task', live_tuples: 999, dead_tuples: 999600,
        dead_ratio: 0.5, vacuum_age_seconds: null },
      // Lots of dead rows by ratio, but too few to matter.
      { schema_name: 'sidewalk_seattle', rel_name: 'tiny', live_tuples: 1, dead_tuples: 9, dead_ratio: 0.9,
        vacuum_age_seconds: 5 },
      { schema_name: 'sidewalk_seattle', rel_name: 'fresh', live_tuples: 'n/a', dead_tuples: null, dead_ratio: null,
        vacuum_age_seconds: 5 },
      { schema_name: 'sidewalk_seattle', rel_name: 'clean', live_tuples: 100000, dead_tuples: 10000,
        dead_ratio: 0.1, vacuum_age_seconds: 5 },
    ] }));
    expect(panelRows('health-bloat')).toEqual([
      ['sidewalk_seattle', 'label', '2.5M', '1.5M', '37.5%', '1d 1h ago'],
      ['sidewalk_seattle', 'audit_task', '999', '1.0M', '50.0%', 'never'],
      ['sidewalk_seattle', 'tiny', '1', '9', '90.0%', '5s ago'],
      ['sidewalk_seattle', 'fresh', '—', '0', '—', '5s ago'],
      ['sidewalk_seattle', 'clean', '100k', '10k', '10.0%', '5s ago'],
    ]);
    const rows = [...document.querySelectorAll('#health-bloat tbody tr')];
    expect(rows.map((tr) => badgeTone(tr.cells[4]))).toEqual(['warn', 'bad', 'good', 'good', 'good']);
    expect(rows.map((tr) => tr.classList.contains('ac-row--flagged'))).toEqual([true, true, false, false, false]);
  });
});

describe('the connections panel', () => {
  test('folds the counts into one row per role, busiest first, toned against the pool', async () => {
    await start(health({ connections: [
      { usename: 'sidewalk_seattle', state: 'active', count: 5 },
      { usename: 'sidewalk_seattle', state: 'idle', count: 10 },
      { usename: 'sidewalk_chicago', state: 'active', count: 22 },
      { usename: 'sidewalk_chicago', state: 'idle in transaction', count: 1 },
      { usename: 'sidewalk_dc', state: 'active', count: 17 },
      { usename: null, state: 'active', count: null },
    ] }));
    expect(panelRows('health-connections')).toEqual([
      ['sidewalk_chicago', '22', '0', '23'],
      ['sidewalk_dc', '17', '0', '17'],
      ['sidewalk_seattle', '5', '10', '15'],
      ['—', '0', '0', '0'],
    ]);
    const tones = [...document.querySelectorAll('#health-connections tbody tr')].map((tr) => badgeTone(tr.cells[1]));
    expect(tones).toEqual(['bad', 'warn', 'ok', 'ok']);
    expect(document.querySelector('#health-connections thead').textContent).toContain('Active (pool 25)');
  });
});

describe('the pano downloads panel', () => {
  const PANOS = { labeled_panos: 4000, backed_up: 3000, unchecked: 600, no_backup: 400, at_risk: 120 };

  test('shows each count with its share of labeled panos, flagging any at risk', async () => {
    await start(health({ pano_backups: PANOS }));
    const cards = [...document.querySelectorAll('#health-panos .ps-kpi')].map(textOf);
    expect(cards).toEqual(['4k Labeled panos', '3k Backed up (75%)', '600 Unchecked (15%)', '400 No backup (10%)',
      '120 At risk (3%)']);
    expect(document.querySelectorAll('#health-panos .ac-badge--warn')).toHaveLength(1);
    expect(text('health-panos-note')).toBe('Backup status fills in nightly, so a large "unchecked" count is normal.');
  });

  test('reads every share as 0% when nothing is labeled', async () => {
    await start(health({ pano_backups: { labeled_panos: 0, backed_up: 0, unchecked: 0, no_backup: 0, at_risk: 0 } }));
    expect(text('health-panos')).toContain('Backed up (0%)');
    expect(document.querySelector('#health-panos .ac-badge')).toBeNull();
  });

  test('leaves the cards alone on a poll that brings nothing new, so keyboard focus survives', async () => {
    const { poll } = await start(health({ pano_backups: PANOS }), health({ pano_backups: PANOS }),
      health({ pano_backups: { ...PANOS, at_risk: 121 } }), health());
    const card = document.querySelector('#health-panos .ps-kpi');
    poll();
    await flush();
    expect(document.querySelector('#health-panos .ps-kpi')).toBe(card);
    poll();
    await flush();
    expect(document.querySelector('#health-panos .ps-kpi')).not.toBe(card);
    expect(text('health-panos')).toContain('121 At risk');
    poll();
    await flush();
    expect(text('health-panos')).toBe('✓ Pano backup stats are unavailable.');
  });
});

describe('polling', () => {
  test('polls only while the tab is showing, and catches up when it comes back', async () => {
    const { fetch, poll, visibilityChange } = await start(health());
    expect(fetch).toHaveBeenCalledTimes(1);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    poll();
    visibilityChange();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    hidden.mockReturnValue(false);
    visibilityChange();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    poll();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test('never stacks a second request on one still in flight', async () => {
    const { fetch, poll, visibilityChange } = await start(health());
    let release;
    fetch.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ ok: true, status: 200, json: async () => health() });
    }));
    poll();
    poll();
    visibilityChange();
    expect(fetch).toHaveBeenCalledTimes(2);
    release();
    await flush();
    poll();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test('shows nothing for the age before the first load succeeds', async () => {
    const { tick } = await start(new Error());
    tick();
    expect(text('health-meta')).toBe('');
    expect(text('health-pulse')).toMatch(/^Could not load health data\./);
  });

  test('uses a 20-second poll when none is given', async () => {
    document.body.innerHTML = PAGE_MARKUP;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => health() })));
    const setInterval = vi.spyOn(window, 'setInterval').mockImplementation(() => 0);
    await new HealthPage({ healthUrl: '/adminapi/dbHealth' }).init();
    expect(setInterval.mock.calls.map(([, ms]) => ms)).toEqual([20000, 1000]);
  });
});

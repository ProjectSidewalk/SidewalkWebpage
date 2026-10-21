/**
 * Tests for the "Database backups" panel on /admin/health (#4571).
 *
 * What matters is how each server state reads: an unset directory must stay neutral (dev and the test stage have no
 * backups and must not be scolded), an unreadable one must be red, and a kind's row must carry the server's verdict
 * rather than one this page re-derives.
 */

import { loadModules } from './loader.js';

const { HealthPage } = await loadModules('frontend/js/admin-dashboard/HealthPage.js');

const MARKUP = `
  <span id="kpi-backups"></span>
  <p id="health-pulse"></p><p id="health-meta"></p>
  <div id="health-jobs"></div><p id="health-jobs-note"></p>
  <div id="health-locks"></div><div id="health-idle"></div><div id="health-active"></div>
  <div id="health-evolutions"></div><div id="health-bloat"></div><div id="health-connections"></div>
  <div id="health-panos"></div><p id="health-panos-note"></p>
  <div id="health-backups"></div><p id="health-backups-note"></p>
`;

const DAY = 86400000;

const THRESHOLDS = {
  idle_txn_warn_seconds: 120, idle_txn_bad_seconds: 600, lock_wait_warn_seconds: 10, lock_wait_bad_seconds: 60,
  active_query_warn_seconds: 30, active_query_bad_seconds: 120, bloat_warn_ratio: 0.2, bloat_bad_ratio: 0.4,
  bloat_min_dead_tuples: 10000, vacuum_age_warn_seconds: 604800, conn_pool_max: 25, conn_warn_active: 17,
  conn_bad_active: 22, job_overdue_hours: 36, job_window_days: 7,
  backup_newest_warn_ms: 2 * DAY, backup_newest_bad_ms: 4 * DAY, backup_kind_warn_ms: 3 * DAY,
  backup_kind_bad_ms: 6 * DAY, backup_small_ratio: 0.25,
};

/** A scanned report with one fresh SQL dump and a base backup that has dropped out. */
function scanned() {
  const sqlAt = Date.now() - 14 * 3600000;
  return {
    state: 'ok', status: 'bad', checked_at_ms: Date.now(), newest_kind: 'sql', newest_modified_ms: sqlAt,
    newest_status: 'good', other_count: 1,
    kinds: [
      { kind: 'sql', label: 'SQL dump (pg_dumpall)', count: 4, newest_name: 'prod.sql', newest_modified_ms: sqlAt,
        newest_bytes: 343e9, median_bytes: 340e9, status: 'good', note: 'fresh' },
      { kind: 'base', label: 'File-level copy (pg_basebackup)', count: 0, status: 'bad', note: 'none_found' },
    ],
  };
}

/** Renders the page for a `backups` payload. */
async function render(backups) {
  document.body.innerHTML = MARKUP;
  window.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      generated_at: '2026-10-21T04:00:00Z', current_database: 'sidewalk', current_role: 'sidewalk',
      can_see_all_queries: true, blocking_sessions: [], idle_in_transaction: [], active_queries: [],
      stuck_evolutions: [], table_bloat: [], connections: [], pano_backups: null, nightly_jobs: [],
      thresholds: THRESHOLDS, backups,
    }),
  });
  vi.spyOn(window, 'setInterval').mockImplementation(() => 0);
  await new HealthPage({ healthUrl: '/adminapi/dbHealth' }).init();
}

const text = (id) => document.getElementById(id).textContent.replace(/\s+/g, ' ').trim();

describe('the database backups panel', () => {
  test('stays neutral when no backup directory is configured, and leaves the pulse alone', async () => {
    await render({ state: 'not_configured', status: 'neutral', checked_at_ms: 0, kinds: [], other_count: 0 });
    expect(text('health-backups')).toContain('No backup directory is configured');
    expect(document.querySelector('#health-backups .ac-badge').className).toContain('ac-badge--ok');
    expect(document.getElementById('kpi-backups').className).toContain('health-kpi--ok');
    expect(text('health-pulse')).not.toContain('backup');
  });

  test('goes red when the directory is configured but unreadable', async () => {
    await render({ state: 'unavailable', status: 'bad', checked_at_ms: 0, error: 'The backup directory does not exist.',
      kinds: [], other_count: 0 });
    expect(text('health-backups')).toContain('does not exist');
    expect(document.querySelector('#health-backups .ac-badge').className).toContain('ac-badge--bad');
    expect(document.getElementById('kpi-backups').className).toContain('health-kpi--bad');
    expect(text('health-pulse')).toContain('backup directory unreadable');
  });

  test('renders a row per kind with the server verdict, sizes in decimal units, and a summary', async () => {
    await render(scanned());
    const rows = [...document.querySelectorAll('#health-backups tbody tr')]
      .map((tr) => [...tr.cells].map((td) => td.textContent.trim()));
    expect(rows[0][0]).toBe('SQL dump (pg_dumpall)');
    expect(rows[0][1]).toBe('fresh');
    expect(rows[0][3]).toBe('14h ago');
    expect(rows[0][4]).toBe('343 GB');
    expect(rows[1][1]).toBe('none found');
    expect(rows[1][6]).toBe('0');
    expect(document.querySelectorAll('#health-backups tbody tr')[1].className).toContain('ac-row--flagged');
    expect(text('health-backups-note')).toContain('Newest: SQL dump (pg_dumpall), 14h ago, 343 GB.');
    expect(text('health-backups-note')).toContain('1 other file');
    expect(document.getElementById('kpi-backups').textContent).toBe('14h ago');
    expect(document.getElementById('kpi-backups').className).toContain('health-kpi--bad');
    expect(text('health-pulse')).toContain('stale or missing backups');
  });

  test('reads a status it has not been taught as a reason to look, not as healthy', async () => {
    const report = scanned();
    report.kinds[0].status = 'quarantined';
    await render(report);
    expect(document.querySelector('#health-backups tbody .ac-badge').className).toContain('ac-badge--warn');
  });
});

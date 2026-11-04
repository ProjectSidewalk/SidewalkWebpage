/**
 * Tests for the connection-slot headroom on /admin/health (#5238).
 *
 * Every city's app is its own pool against one Postgres, so the number that predicts refused connections is the
 * cluster's share of usable slots, not any one city's count. The contracts pinned here are the ones that decide
 * whether the page warns in time: the KPI and summary tone follow the server's thresholds, an unreadable limit reads
 * as unknown rather than healthy, and a stressed cluster reaches the page-level pulse.
 */

import { loadModules } from './loader.js';

const { HealthPage } = await loadModules('frontend/js/admin-dashboard/HealthPage.js');

const MARKUP = `
  <span id="kpi-connections"></span>
  <p id="health-pulse"></p><p id="health-meta"></p>
  <div id="health-jobs"></div><p id="health-jobs-note"></p>
  <div id="health-locks"></div><div id="health-idle"></div><div id="health-active"></div>
  <div id="health-evolutions"></div><div id="health-bloat"></div>
  <div id="health-connections-summary"></div><div id="health-connections"></div>
  <div id="health-panos"></div><p id="health-panos-note"></p>
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
  conn_slots_warn_ratio: 0.7,
  conn_slots_bad_ratio: 0.9,
  job_overdue_hours: 36,
  job_window_days: 7,
};

/** A connection_slots payload on prod's shape (200 max, 3 superuser-reserved) with `inUse` client backends. */
function slots(inUse) {
  return { max_connections: 200, reserved_connections: 3, usable_connections: 197, in_use: inUse,
    used_ratio: inUse / 197 };
}

/** Renders the page for one connection_slots value. */
async function render(connectionSlots) {
  document.body.innerHTML = MARKUP;
  window.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      generated_at: '2026-10-21T04:00:00Z',
      current_database: 'sidewalk_prod',
      current_role: 'sidewalk_seattle',
      can_see_all_queries: false,
      blocking_sessions: [],
      idle_in_transaction: [],
      active_queries: [],
      stuck_evolutions: [],
      table_bloat: [],
      connections: [{ usename: 'sidewalk_seattle', state: 'idle', count: 2 }],
      connection_slots: connectionSlots,
      pano_backups: null,
      nightly_jobs: [],
      thresholds: THRESHOLDS,
    }),
  });
  vi.spyOn(window, 'setInterval').mockImplementation(() => 0);
  await new HealthPage({ healthUrl: '/adminapi/dbHealth' }).init();
}

const text = (id) => document.getElementById(id).textContent.replace(/\s+/g, ' ').trim();

describe('the connection-slot headroom', () => {
  test.each([
    [40, 'good'],
    [137, 'good'], // 69.5%: just under the warning line
    [138, 'warn'], // 70.1%
    [177, 'warn'], // 89.8%: shows as "90%" but is still under the bad line
    [178, 'bad'], // 90.4%
  ])('tones the KPI for %i of 197 slots as %s', async (inUse, tone) => {
    await render(slots(inUse));
    const kpi = document.getElementById('kpi-connections');
    expect(kpi.textContent).toBe(`${inUse}/197`);
    expect(kpi.className).toBe(`health-kpi--${tone}`);
  });

  test('summarizes cluster use in words, so severity does not rest on color', async () => {
    await render(slots(152));
    expect(text('health-connections-summary')).toBe(
      '77% 152 of 197 usable slots in use across the cluster (200 max, 3 reserved for administrators). '
      + 'Headroom is getting low.');
    expect(document.querySelector('#health-connections-summary .ac-badge').className).toContain('ac-badge--warn');
  });

  test('raises a stressed cluster to the page-level pulse', async () => {
    await render(slots(190));
    expect(text('health-pulse')).toContain('Needs attention');
    expect(text('health-pulse')).toContain('96% of database connection slots in use');
    expect(text('health-connections-summary')).toContain('Close to refusing new connections.');
  });

  test('stays quiet in the pulse while there is headroom', async () => {
    await render(slots(40));
    expect(text('health-pulse')).toContain('All clear');
  });

  test('reads an unreadable limit as unknown, never as healthy', async () => {
    await render(null);
    const kpi = document.getElementById('kpi-connections');
    expect(kpi.textContent).toBe('—');
    expect(kpi.className).toBe('health-kpi--ok');
    expect(text('health-connections-summary')).toContain('slot headroom is unknown');
    expect(document.querySelector('#health-connections-summary .ac-badge').className).toContain('ac-badge--bad');
  });

  test("labels each role's active count with this app's own pool ceiling", async () => {
    await render(slots(40));
    expect(text('health-connections')).toContain("Active (this app's pool: 25)");
  });
});

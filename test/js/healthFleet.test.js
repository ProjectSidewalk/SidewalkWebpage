/**
 * The "Fleet" panel on /admin/health (#4548). It exists for the minutes after a release, so what matters is that a
 * city not yet restarted, one that is down, and one whose database failed each read as a problem and sort above the
 * healthy rows, and that a fleet probe failure never hides the page's own database signals.
 */

import { loadModules } from './loader.js';
import { routeFetch, textOf } from './support/routeFetch.js';

const { HealthPage } = await loadModules('frontend/js/admin-dashboard/HealthPage.js');

const MARKUP = `
  <p id="health-pulse"></p><p id="health-meta"></p>
  <div id="health-fleet"></div><p id="health-fleet-note"></p>
  <div id="health-jobs"></div><p id="health-jobs-note"></p>
  <div id="health-locks"></div><div id="health-idle"></div><div id="health-active"></div>
  <div id="health-evolutions"></div><div id="health-bloat"></div><div id="health-connections"></div>
  <div id="health-panos"></div><p id="health-panos-note"></p>
`;

const DB_HEALTH = {
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
  nightly_jobs: [],
  thresholds: { job_overdue_hours: 36, job_window_days: 7 },
};

/** One fleet row whose instance answers healthily on the given build. */
function city(cityId, name, sha, overrides = {}) {
  return {
    city_id: cityId,
    city_name: name,
    url: `https://${cityId}.example`,
    http_status: 200,
    health: {
      status: 'ok',
      git_sha: sha,
      git_describe: `v11.20.0-g${sha.slice(0, 7)}`,
      git_dirty: false,
      version: '11.20.0',
      version_released_at: '2026-08-19T00:00:00Z',
      city_id: cityId,
      environment: 'prod',
      app_started_at: '2026-08-20T03:00:00Z',
    },
    error: null,
    ...overrides,
  };
}

/** Renders the page with the given fleet answer (a body, or `{ status, body }` for a failure). */
async function render(fleet) {
  document.body.innerHTML = MARKUP;
  routeFetch({ '/adminapi/dbHealth': DB_HEALTH, '/adminapi/fleetHealth': fleet });
  vi.spyOn(window, 'setInterval').mockImplementation(() => 0);
  await new HealthPage({ healthUrl: '/adminapi/dbHealth', fleetUrl: '/adminapi/fleetHealth' }).init();
}

/** Each rendered row as [city, status, build, version, started]. */
const rows = () => [...document.querySelectorAll('#health-fleet tbody tr')].map((tr) => [...tr.cells].map(textOf));

describe('the fleet panel', () => {
  test('shows every city with its build, and marks the instance being viewed', async () => {
    await render({
      generated_at: '2026-08-20T04:00:00Z',
      this_city_id: 'seattle',
      this_git_sha: 'aaaaaaa111',
      cities: [city('seattle', 'Seattle, WA', 'aaaaaaa111'), city('chicago', 'Chicago, IL', 'aaaaaaa111')],
      not_deployed: ['crowdstudy', 'staging'],
    });
    expect(rows().map((r) => r[0])).toEqual(['Chicago, IL', 'Seattle, WA (this instance)']);
    expect(rows()[0].slice(1, 4)).toEqual(['ok', 'v11.20.0-gaaaaaaa', '11.20.0']);
    expect(document.querySelectorAll('#health-fleet .ac-row--flagged')).toHaveLength(0);
    const note = textOf(document.getElementById('health-fleet-note'));
    expect(note).toContain('2 of 2 cities are healthy and on this build');
    // A city with no instance on this stage is absent by design, so it is named rather than shown as down.
    expect(note).toContain('no instance on this stage: crowdstudy, staging');
  });

  test('flags a city still on another build, one whose database failed, and one that is down, worst first', async () => {
    await render({
      generated_at: '2026-08-20T04:00:00Z',
      this_city_id: 'seattle',
      this_git_sha: 'aaaaaaa111',
      cities: [
        city('seattle', 'Seattle, WA', 'aaaaaaa111'),
        city('oslo', 'Oslo', 'bbbbbbb222'),
        city('chicago', 'Chicago, IL', 'aaaaaaa111', {
          http_status: 503,
          health: { ...city('chicago', 'Chicago, IL', 'aaaaaaa111').health, status: 'error', version: null },
        }),
        city('cdmx', 'Mexico City', 'aaaaaaa111', { http_status: null, health: null, error: 'ConnectException' }),
      ],
    });
    expect(rows().map((r) => [r[0], r[1]])).toEqual([
      ['Mexico City', 'unreachable ConnectException'],
      ['Chicago, IL', 'error'],
      ['Oslo', 'other build'],
      ['Seattle, WA (this instance)', 'ok'],
    ]);
    // The SHA decides "other build"; the describe label is cosmetic.
    expect(rows()[2][2]).toBe('v11.20.0-gbbbbbbb');
    expect(document.querySelectorAll('#health-fleet .ac-row--flagged')).toHaveLength(3);
    const note = textOf(document.getElementById('health-fleet-note'));
    expect(note).toContain('1 of 4 cities are healthy and on this build');
    expect(note).toContain('2 not answering healthily');
  });

  test('reads a 200 that is not a health document as a problem row, not a healthy one', async () => {
    await render({
      generated_at: '2026-08-20T04:00:00Z',
      this_city_id: 'seattle',
      this_git_sha: 'aaaaaaa111',
      cities: [city('oslo', 'Oslo', 'x', { health: null, error: 'HTTP 200 with no health body' })],
    });
    expect(rows()[0][1]).toBe('HTTP 200 HTTP 200 with no health body');
    expect(rows()[0][2]).toBe('—');
  });

  test('a failed fleet probe marks only its own panel and leaves the database signals rendered', async () => {
    await render({ status: 500, body: 'boom' });
    expect(textOf(document.getElementById('health-fleet'))).toContain('Could not probe the fleet.');
    expect(textOf(document.getElementById('health-pulse'))).toContain('All clear');
  });
});

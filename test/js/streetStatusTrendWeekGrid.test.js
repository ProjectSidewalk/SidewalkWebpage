/**
 * @jest-environment <rootDir>/test/js/support/timeZoneJsdomEnvironment.js
 * @jest-environment-options {"timeZone": "Australia/Sydney"}
 */

/**
 * Timezone edge cases of the "Recently changed" week grid on /admin/street-status (#4928).
 *
 * The grid is generated client-side and zero-filled against the server's ISO week buckets, so the two have to agree on
 * which weeks exist. Both ways they can disagree are properties of the *viewer's* zone rather than of an instant, and
 * neither is reachable from a UTC test process — so this file pins itself to Sydney, which is east of UTC (where the
 * current week can be dropped) and observes daylight saving (where a local-time step lands off Monday). The rest of
 * the section's behavior is covered in streetStatusTrend.test.js under the default zone.
 *
 * Runs under jsdom. These are bare top-level classes in a concatenated bundle, so they are eval'd into global scope.
 */

const fs = require('fs');
const path = require('path');

const JS_DIR = path.resolve(__dirname, '..', '..', 'public/js/admin-dashboard');

function loadPage() {
  const read = (file) => fs.readFileSync(path.join(JS_DIR, file), 'utf8');
  return (0, eval)(
    `${read('MiniLineChart.js')}\nglobalThis.MiniLineChart = MiniLineChart;\n`
    + `${read('StreetStatusMap.js')}\nglobalThis.StreetStatusColors = StreetStatusColors;\n`
    + `${read('AdminShell.js')}\nglobalThis.AdminShell = AdminShell;\n`
    + `${read('StreetStatusTrend.js')}\nStreetStatusTrend;`
  );
}

const StreetStatusTrend = loadPage();

const MARKUP = `
  <div id="street-status-trend-section">
    <select id="trend-range"><option value="3">3</option><option value="5">5</option></select>
    <div id="trend-status"></div>
    <p id="trend-status-summary"></p>
    <div class="mini-host" id="trend-status-chart"></div>
    <div class="mini-host" id="trend-reports-chart"></div>
    <p id="trend-expiry-note"></p>
    <div class="mini-host" id="trend-expiry-chart"></div>
    <p id="trend-corroborated-intro"></p>
    <div id="trend-corroborated"></div>
    <div id="trend-regions"></div>
  </div>
`;

async function render(data) {
  document.body.innerHTML = MARKUP;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK', json: async () => data });
  await new StreetStatusTrend({ trendUrl: '/adminapi/streetStatusTrend', weeks: data.weeks }).init();
}

/** The x-axis labels, selected by their anchor so the y-axis ticks sharing the class don't come along. */
function weekLabels() {
  return [...document.querySelectorAll('#trend-status-chart text.mini-axis[text-anchor="middle"]')]
    .map((t) => t.textContent);
}

/** One status-change row per week start, so a dropped week shows up as a missing bar and a smaller total. */
function changes(weekStarts) {
  return weekStarts.map((week) => ({ week_start: week, new_status: 'no_imagery', street_count: 1 }));
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('the test environment really is east of UTC', () => {
  // Without this the two cases below would pass for the wrong reason: in a UTC process the local date and the UTC
  // date never disagree, so neither edge can arise at all.
  expect(new Date(Date.parse('2026-08-16T16:00:00Z')).getDate()).toBe(17);
});

describe('the week grid, for a viewer east of UTC', () => {
  test('keeps the current week during their Monday morning', async () => {
    // 02:00 Monday in Sydney is still 16:00 Sunday in UTC. Stopping the grid on "later than Date.now()" compares this
    // Monday's UTC midnight against that earlier instant, breaks a week early, and drops the newest bucket from all
    // three charts — with the headline still counting it, so the page contradicts itself.
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-17T02:00:00+10:00'));
    const weeks = ['2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17'];
    await render({
      weeks: 3,
      since: '2026-07-27T00:00:00+10:00',
      status_changes: changes(weeks),
      no_imagery_reports: [],
      panos_expired: [],
      top_report_regions: [],
      corroborated_streets: [],
      min_reporters: 2,
      panos_expired_undated: 0,
    });

    expect(weekLabels()).toEqual(['Jul 27', 'Aug 3', 'Aug 10', 'Aug 17']);
    expect(document.getElementById('trend-status-summary').textContent).toBe('4 status changes in this window.');
  });

  test('holds a seven-day step across a daylight-saving change, landing on Mondays throughout', async () => {
    // Sydney leaves daylight saving on 5 April 2026, mid-window. Stepping in local time would put the weeks after it
    // an hour off and land them on a Sunday, generating week starts the server never emits.
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-13T12:00:00+10:00'));
    const weeks = ['2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30', '2026-04-06', '2026-04-13'];
    await render({
      weeks: 5,
      since: '2026-03-09T00:00:00+11:00',
      status_changes: changes(weeks),
      no_imagery_reports: [],
      panos_expired: [],
      top_report_regions: [],
      corroborated_streets: [],
      min_reporters: 2,
      panos_expired_undated: 0,
    });

    expect(weekLabels()).toEqual(['Mar 9', 'Mar 16', 'Mar 23', 'Mar 30', 'Apr 6', 'Apr 13']);
    expect(document.getElementById('trend-status-summary').textContent).toBe('6 status changes in this window.');
  });
});

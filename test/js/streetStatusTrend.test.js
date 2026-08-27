/**
 * Tests for the "Recently changed" section of /admin/street-status (#4928).
 *
 * The section reads a sparse server payload — only weeks that had something to report — and zero-fills it against a
 * grid of week starts it generates itself. That grid is the whole risk: if it and the server's ISO week buckets
 * disagree by so much as an hour, rows land on a `week_start` the client never asks for and disappear from the chart
 * with nothing on the page to say so. So the cases here are the boundaries — a window that crosses a daylight-saving
 * change, a viewer east of UTC on a Monday morning — plus the rule that the headline can only ever count bars that
 * are actually on screen.
 *
 * Runs under jsdom (jest.config.js). These are bare top-level classes in a concatenated bundle, so they are eval'd
 * into global scope rather than required; StreetStatusColors (in StreetStatusMap.js) owns the status palette and
 * MiniLineChart does the drawing, so both have to be present first.
 */

const fs = require('fs');
const path = require('path');

const JS_DIR = path.resolve(__dirname, '..', '..', 'public/js/admin-dashboard');

/** Loads the section's dependencies into global scope and returns the StreetStatusTrend class. */
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
    <select id="trend-range"><option value="13">13</option><option value="26">26</option></select>
    <div id="trend-status"></div>
    <p id="trend-status-summary"></p>
    <div class="mini-host" id="trend-status-chart"></div>
    <div class="mini-host" id="trend-reports-chart"></div>
    <p id="trend-expiry-note"></p>
    <div class="mini-host" id="trend-expiry-chart"></div>
    <div id="trend-reopen-candidates"></div>
    <p id="trend-corroborated-intro"></p>
    <div id="trend-corroborated"></div>
    <div id="trend-regions"></div>
  </div>
`;

/** One regained-imagery queue row with the fields the endpoint emits. */
function candidate(overrides = {}) {
  return {
    street_edge_id: 555,
    region_id: 7,
    region_name: 'Broadview',
    n_panos: 3,
    newest_capture: '2026-08-01',
    first_detected_at: '2026-08-10T09:30:00Z',
    last_detected_at: '2026-08-14T09:30:00Z',
    ...overrides,
  };
}

/** A payload with the shape the endpoint emits; every series defaults to empty. */
function payload(overrides = {}) {
  return {
    weeks: 3,
    since: '2026-07-27T00:00:00-07:00',
    status_changes: [],
    no_imagery_reports: [],
    pano_imagery_changes: [],
    top_report_regions: [],
    corroborated_streets: [],
    min_reporters: 2,
    panos_expired_undated: 0,
    ...overrides,
  };
}

async function render(data, { weeks = 3, onShowStreet } = {}) {
  document.body.innerHTML = MARKUP;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK', json: async () => data });
  await new StreetStatusTrend({ trendUrl: '/adminapi/streetStatusTrend', weeks, onShowStreet }).init();
}

/**
 * The x-axis labels MiniLineChart drew, one per generated week start. Selected by their anchor, which is what
 * separates them from the y-axis ticks sharing the same class.
 */
function weekLabels() {
  return [...document.querySelectorAll('#trend-status-chart text.mini-axis[text-anchor="middle"]')]
    .map((t) => t.textContent);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the week grid', () => {
  const MONDAY = '2026-07-27T00:00:00-07:00';

  test('starts at the window the server reported and steps a week at a time', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-17T12:00:00-07:00'));
    await render(payload({
      since: MONDAY,
      weeks: 3,
      status_changes: [
        { week_start: '2026-07-27', new_status: 'no_imagery', street_count: 1 },
        { week_start: '2026-08-03', new_status: 'no_imagery', street_count: 2 },
        { week_start: '2026-08-10', new_status: 'no_imagery', street_count: 3 },
        { week_start: '2026-08-17', new_status: 'no_imagery', street_count: 4 },
      ],
    }));
    // Four Mondays from the window start through today: every bucket the server can return has a slot.
    expect(document.getElementById('trend-status-summary').textContent).toBe('10 status changes in this window.');
    expect(weekLabels().length).toBeGreaterThan(0);
  });

  test('stops at today rather than drawing weeks that have not happened', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-03T12:00:00Z'));
    await render(payload({ since: MONDAY, weeks: 26 }));
    // The window is 26 weeks wide but only two of its Mondays have happened.
    expect(weekLabels()).toEqual(['Jul 27', 'Aug 3']);
  });

  // The two grid edges that only exist away from UTC — dropping the current week for a viewer to the east, and
  // stepping across a daylight-saving change — are in streetStatusTrendWeekGrid.test.js, which pins its timezone.
});

describe('the status-change chart', () => {
  test('counts only what it can draw, so the headline can never exceed the bars', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-17T12:00:00-07:00'));
    await render(payload({
      since: '2026-07-27T00:00:00-07:00',
      weeks: 3,
      status_changes: [
        { week_start: '2026-08-10', new_status: 'no_imagery', street_count: 5 },
        // A bucket the grid has no slot for: totalling the raw rows would report it above bars that omit it.
        { week_start: '2026-07-20', new_status: 'no_imagery', street_count: 99 },
      ],
    }));
    expect(document.getElementById('trend-status-summary').textContent).toBe('5 status changes in this window.');
  });

  test('says nothing changed rather than reporting a zero', async () => {
    await render(payload());
    expect(document.getElementById('trend-status-summary').textContent)
      .toBe('No street changed status in this window.');
  });

  test('draws a line per status, so a flat zero is visible as an answer', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-17T12:00:00-07:00'));
    await render(payload({
      since: '2026-07-27T00:00:00-07:00',
      status_changes: [{ week_start: '2026-08-10', new_status: 'closed', street_count: 2 }],
    }));
    // Dropping a series with no data would make "nothing was retired this quarter" indistinguishable from a chart
    // that failed to render.
    const legend = document.getElementById('trend-status-chart').textContent;
    StreetStatusColors.STATUSES.forEach((status) => expect(legend).toContain(status.label));
  });

  test('names one change as singular', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-17T12:00:00-07:00'));
    await render(payload({
      since: '2026-07-27T00:00:00-07:00',
      status_changes: [{ week_start: '2026-08-10', new_status: 'closed', street_count: 1 }],
    }));
    expect(document.getElementById('trend-status-summary').textContent).toBe('1 status change in this window.');
  });
});

describe('the imagery-change chart', () => {
  /** Every bar tooltip the chart drew, which is where the per-series values are legible. */
  function expiryTips() {
    return [...document.querySelectorAll('#trend-expiry-chart title')].map((t) => t.textContent);
  }

  test('charts losses and recoveries as separate series', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-17T12:00:00-07:00'));
    await render(payload({
      since: '2026-07-27T00:00:00-07:00',
      pano_imagery_changes: [{ week_start: '2026-08-10', expired_count: 4, returned_count: 2 }],
    }));
    expect(expiryTips()).toContain('Aug 10 · Imagery went away: 4 panos');
    expect(expiryTips()).toContain('Aug 10 · Imagery came back: 2 panos');
    // Two series means a legend, which is the only thing naming which colour is which.
    expect(document.getElementById('trend-expiry-chart').textContent).toContain('Imagery came back');
  });

  test('leaves a loss in the week it happened when the imagery later comes back', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-17T12:00:00-07:00'));
    await render(payload({
      since: '2026-07-27T00:00:00-07:00',
      pano_imagery_changes: [
        { week_start: '2026-07-27', expired_count: 6, returned_count: 0 },
        { week_start: '2026-08-10', expired_count: 0, returned_count: 6 },
      ],
    }));
    // Why the series reads an event log rather than pano_data.expired_at (#4947): a recovery clears that column, so
    // reading it would empty the week the loss belongs to and these six panos would chart as nothing at all.
    expect(expiryTips()).toContain('Jul 27 · Imagery went away: 6 panos');
    expect(expiryTips()).toContain('Aug 10 · Imagery came back: 6 panos');
  });

  test('zero-fills a week the server had nothing to report for', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-17T12:00:00-07:00'));
    await render(payload({
      since: '2026-07-27T00:00:00-07:00',
      pano_imagery_changes: [{ week_start: '2026-08-10', expired_count: 1, returned_count: 0 }],
    }));
    expect(expiryTips()).toContain('Aug 3 · Imagery went away: 0 panos');
    expect(expiryTips()).toContain('Aug 10 · Imagery went away: 1 pano');
  });
});

describe('the expiry note', () => {
  test('says how many expired panos the chart cannot account for', async () => {
    await render(payload({ panos_expired_undated: 1234 }));
    expect(document.getElementById('trend-expiry-note').textContent)
      .toMatch(/^1,234 panos were already expired before any of this was recorded/);
  });

  test('warns that those panos can still chart a recovery with no loss before it', async () => {
    await render(payload({ panos_expired_undated: 1234 }));
    // Losses that predate the log, recoveries that don't: the page has to own the asymmetry or it reads as a bug.
    expect(document.getElementById('trend-expiry-note').textContent)
      .toMatch(/recovery, with no matching loss before it/);
  });

  test('stays silent when every expired pano is accounted for', async () => {
    await render(payload({ panos_expired_undated: 0 }));
    expect(document.getElementById('trend-expiry-note').textContent).toBe('');
  });
});

describe('the regained-imagery queue', () => {
  test('lists each candidate with its evidence and its actions', async () => {
    await render(payload({ reopen_candidates: [candidate()] }));
    const row = document.querySelector('#trend-reopen-candidates tbody tr');
    const text = row.textContent.replace(/\s+/g, ' ');
    expect(text).toContain('Broadview');
    expect(text).toContain('3');
    expect(text).toContain('2026-08-01');
    // The detection timestamp is trimmed to a date, like the corroborated queue's.
    expect(text).toContain('2026-08-14');
    expect([...row.querySelectorAll('button')].map((b) => b.textContent.trim())).toEqual(['Reopen', 'Dismiss']);
    // Each row's buttons name their street: a screen reader hearing six identical "Reopen"s learns nothing.
    expect(row.querySelector('[data-action="reopen"]').getAttribute('aria-label')).toBe('Reopen street 555');
    expect(row.querySelector('[data-action="dismiss"]').getAttribute('aria-label')).toBe('Dismiss street 555');
  });

  test('points the street id at the map above rather than at Explore, which cannot serve a retired street', async () => {
    const onShowStreet = jest.fn().mockReturnValue(true);
    await render(payload({ reopen_candidates: [candidate()] }), { onShowStreet });
    const container = document.getElementById('trend-reopen-candidates');
    // An anchor here would be a link to /explore, which answers a 500 for every street this queue lists.
    expect(container.querySelector('a')).toBeNull();

    container.querySelector('[data-action="locate"]').click();
    expect(onShowStreet).toHaveBeenCalledWith(555);
    expect(container.querySelector('.reopen-queue-error')).toBeNull();
  });

  test('says so when the map cannot show the street yet, instead of looking broken', async () => {
    await render(payload({ reopen_candidates: [candidate()] }), { onShowStreet: () => false });
    document.querySelector('[data-action="locate"]').click();
    expect(document.querySelector('.reopen-queue-error').textContent).toMatch(/map is still loading/);
  });

  test('renders the street id as plain text when the page offered no map handler', async () => {
    await render(payload({ reopen_candidates: [candidate()] }));
    expect(document.querySelector('[data-action="locate"]')).toBeNull();
    expect(document.querySelector('#trend-reopen-candidates tbody tr td').textContent).toContain('555');
  });

  test('says the queue is empty rather than rendering a headerless table', async () => {
    await render(payload({ reopen_candidates: [] }));
    expect(document.querySelector('#trend-reopen-candidates table')).toBeNull();
    expect(document.getElementById('trend-reopen-candidates').textContent)
      .toMatch(/No retired street currently shows regained imagery/);
  });

  test('tolerates a payload with no reopen_candidates field at all', async () => {
    // Pre-#4929 cached payloads and older fixtures simply lack the field; the section must not throw over it.
    await render(payload());
    expect(document.getElementById('trend-reopen-candidates').textContent)
      .toMatch(/No retired street currently shows regained imagery/);
  });

  test('escapes a region name rather than trusting it as markup', async () => {
    await render(payload({ reopen_candidates: [candidate({ region_name: '<img src=x onerror=1>' })] }));
    expect(document.querySelector('#trend-reopen-candidates img')).toBeNull();
    expect(document.getElementById('trend-reopen-candidates').textContent).toContain('<img src=x onerror=1>');
  });

  test('shows an em dash when the provider reported no capture date', async () => {
    await render(payload({ reopen_candidates: [candidate({ newest_capture: null })] }));
    expect(document.querySelector('#trend-reopen-candidates tbody tr').textContent).toContain('—');
  });

  test('reopens only after confirmation, via PUT, then reloads the trend', async () => {
    await render(payload({ reopen_candidates: [candidate()] }));
    globalThis.ConfirmDialog = { confirm: jest.fn().mockResolvedValue(true) };
    const reopenBtn = [...document.querySelectorAll('#trend-reopen-candidates button')]
      .find((b) => b.textContent === 'Reopen');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK', json: async () => payload({ reopen_candidates: [] }),
    });

    reopenBtn.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(globalThis.ConfirmDialog.confirm).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith('/adminapi/streets/555/reopen', { method: 'PUT' });
    // The reload after a successful action, so the queue and the status-change chart both reflect the reopen.
    expect(global.fetch).toHaveBeenLastCalledWith('/adminapi/streetStatusTrend?weeks=3', expect.anything());
    expect(document.getElementById('trend-reopen-candidates').textContent)
      .toMatch(/No retired street currently shows regained imagery/);
  });

  test('does nothing when the confirmation is declined', async () => {
    await render(payload({ reopen_candidates: [candidate()] }));
    globalThis.ConfirmDialog = { confirm: jest.fn().mockResolvedValue(false) };
    const reopenBtn = [...document.querySelectorAll('#trend-reopen-candidates button')]
      .find((b) => b.textContent === 'Reopen');
    global.fetch = jest.fn();

    reopenBtn.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('dismisses without confirmation, via DELETE', async () => {
    await render(payload({ reopen_candidates: [candidate()] }));
    globalThis.ConfirmDialog = { confirm: jest.fn() };
    const dismissBtn = [...document.querySelectorAll('#trend-reopen-candidates button')]
      .find((b) => b.textContent === 'Dismiss');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK', json: async () => payload({ reopen_candidates: [] }),
    });

    dismissBtn.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(globalThis.ConfirmDialog.confirm).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith('/adminapi/streets/555/reopenCandidate', { method: 'DELETE' });
  });

  test('quotes the server\'s explanation of a refusal, next to the buttons as well as at the top', async () => {
    await render(payload({ reopen_candidates: [candidate()] }));
    globalThis.ConfirmDialog = { confirm: jest.fn().mockResolvedValue(true) };
    const reopenBtn = [...document.querySelectorAll('#trend-reopen-candidates button')]
      .find((b) => b.textContent === 'Reopen');
    // A 409 is the stale-row case, and the server says which status the street actually has -- far more use than
    // the status code, which is all the admin would otherwise get.
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: async () => ({ status: 'Error', message: "Street 555 is 'open', not 'no_imagery'." }),
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    reopenBtn.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(document.getElementById('trend-status').textContent).toMatch(/Street 555 is 'open', not 'no_imagery'\./);
    // A 409 says this row is stale, and reloading is what clears it: the server's queue read filters on status.
    expect(global.fetch).toHaveBeenLastCalledWith('/adminapi/streetStatusTrend?weeks=3', expect.anything());
    // #trend-status is at the top of the section, several screens above these buttons.
    expect(document.querySelector('.reopen-queue-error').textContent).toMatch(/Could not reopen street 555/);
    [...document.querySelectorAll('#trend-reopen-candidates button')]
      .forEach((b) => expect(b.disabled).toBe(false));
  });

  test('falls back to the status code when the failure body is not the JSON we expect', async () => {
    await render(payload({ reopen_candidates: [candidate()] }));
    globalThis.ConfirmDialog = { confirm: jest.fn().mockResolvedValue(true) };
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 502, statusText: 'Bad Gateway', json: async () => { throw new Error('not json'); },
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    [...document.querySelectorAll('#trend-reopen-candidates button')]
      .find((b) => b.textContent === 'Reopen').click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(document.getElementById('trend-status').textContent).toMatch(/HTTP 502/);
  });
});

describe('the awaiting-confirmation queue', () => {
  test('takes its corroboration threshold from the server rather than assuming one', async () => {
    await render(payload({ min_reporters: 4 }));
    // A local default would read correctly right up until the server's threshold changed, and then silently lie.
    expect(document.getElementById('trend-corroborated-intro').textContent)
      .toMatch(/at least 4 different labeler accounts/);
  });

  test('lists each street with a link to explore it', async () => {
    await render(payload({
      corroborated_streets: [{
        street_edge_id: 4321,
        region_id: 7,
        region_name: 'Broadview',
        reporter_count: 3,
        report_count: 5,
        last_reported_at: '2026-08-14T09:30:00Z',
      }],
    }));
    const row = document.querySelector('#trend-corroborated tbody tr');
    expect(row.textContent.replace(/\s+/g, ' ')).toContain('Broadview');
    expect(row.querySelector('a').getAttribute('href')).toBe('/explore?streetEdgeId=4321');
    // The timestamp is trimmed to a date; the time of day says nothing a reviewer can act on.
    expect(row.textContent).toContain('2026-08-14');
  });

  test('says the queue is empty rather than rendering a headerless table', async () => {
    await render(payload({ corroborated_streets: [] }));
    expect(document.querySelector('#trend-corroborated table')).toBeNull();
    expect(document.getElementById('trend-corroborated').textContent)
      .toMatch(/No street has been reported by that many labelers/);
  });

  test('escapes a region name rather than trusting it as markup', async () => {
    await render(payload({
      corroborated_streets: [{
        street_edge_id: 1,
        region_id: 1,
        region_name: '<img src=x onerror=1>',
        reporter_count: 2,
        report_count: 2,
        last_reported_at: '2026-08-14T09:30:00Z',
      }],
    }));
    expect(document.querySelector('#trend-corroborated img')).toBeNull();
    expect(document.getElementById('trend-corroborated').textContent).toContain('<img src=x onerror=1>');
  });
});

describe('the reports-by-region table', () => {
  test('lists regions with both counts', async () => {
    await render(payload({
      top_report_regions: [{ region_id: 3, region_name: 'Pinehurst', report_count: 12, street_count: 9 }],
    }));
    const cells = [...document.querySelectorAll('#trend-regions tbody td')].map((td) => td.textContent.trim());
    expect(cells).toEqual(['Pinehurst', '9', '12']);
  });

  test('says so when nothing was reported', async () => {
    await render(payload({ top_report_regions: [] }));
    expect(document.getElementById('trend-regions').textContent).toMatch(/No missing-imagery reports/);
  });
});

describe('loading and failure', () => {
  test('reports a failed fetch without touching the snapshot above it', async () => {
    document.body.innerHTML = MARKUP;
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' });
    await new StreetStatusTrend({ trendUrl: '/adminapi/streetStatusTrend', weeks: 3 }).init();
    const status = document.getElementById('trend-status');
    expect(status.textContent).toMatch(/Could not load recent changes: 503/);
    expect(status.classList.contains('error')).toBe(true);
  });

  test('requests the window the selector shows', async () => {
    await render(payload(), { weeks: 26 });
    expect(global.fetch).toHaveBeenCalledWith('/adminapi/streetStatusTrend?weeks=26', expect.anything());
  });

  test('refetches when the window changes', async () => {
    await render(payload(), { weeks: 26 });
    const range = document.getElementById('trend-range');
    range.value = '13';
    range.dispatchEvent(new Event('change'));
    await Promise.resolve();
    await Promise.resolve();
    expect(global.fetch).toHaveBeenLastCalledWith('/adminapi/streetStatusTrend?weeks=13', expect.anything());
  });
});

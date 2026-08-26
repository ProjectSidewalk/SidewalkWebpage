/**
 * Tests for AdminShell's shared formatting helpers (#4928).
 *
 * Every admin dashboard page formats its durations, counts, timestamps and tables through these, so two pages can
 * only ever render the same value the same way. That guarantee is worth exactly as much as the edges are pinned: the
 * cases here are the tier boundaries a hand-written formatter tends to get wrong, plus the escaping, which is what
 * stands between user-supplied text and innerHTML.
 *
 * Runs under jsdom (jest.config.js). AdminShell is a bare top-level class in a concatenated bundle, so it is eval'd
 * into global scope rather than required.
 */

const fs = require('fs');
const path = require('path');

const SHELL_PATH = path.resolve(__dirname, '..', '..', 'public/js/admin-dashboard/AdminShell.js');

/** Load AdminShell.js and return the class binding. */
function loadShell() {
  const src = fs.readFileSync(SHELL_PATH, 'utf8');
  return (0, eval)(`${src}\nAdminShell;`);
}

const AdminShell = loadShell();

describe('AdminShell.nil', () => {
  test('is true only for null and undefined, not for falsy values that are real data', () => {
    expect(AdminShell.nil(null)).toBe(true);
    expect(AdminShell.nil(undefined)).toBe(true);
    // A count of zero and an empty string are answers, not absences; treating them as missing is how a real "0"
    // becomes an em dash.
    expect(AdminShell.nil(0)).toBe(false);
    expect(AdminShell.nil('')).toBe(false);
    expect(AdminShell.nil(false)).toBe(false);
  });
});

describe('AdminShell.esc', () => {
  test('escapes every character that could break out of markup', () => {
    expect(AdminShell.esc(`<script>alert("x") & 'y'</script>`))
      .toBe('&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;');
  });

  test('renders an absent value as empty rather than as the string "null"', () => {
    expect(AdminShell.esc(null)).toBe('');
    expect(AdminShell.esc(undefined)).toBe('');
  });

  test('escapes ampersands before the entities it introduces, so they are not double-escaped', () => {
    expect(AdminShell.esc('&lt;')).toBe('&amp;lt;');
  });
});

describe('AdminShell.num', () => {
  test('groups thousands', () => {
    expect(AdminShell.num(1234567)).toBe('1,234,567');
    expect(AdminShell.num(0)).toBe('0');
  });
});

describe('AdminShell.dur', () => {
  test('renders an absent duration as an em dash, which is what an open run has', () => {
    expect(AdminShell.dur(null)).toBe('—');
    expect(AdminShell.dur(undefined)).toBe('—');
  });

  test('steps through the seconds / minutes / hours / days tiers', () => {
    expect(AdminShell.dur(0)).toBe('0s');
    expect(AdminShell.dur(59)).toBe('59s');
    expect(AdminShell.dur(60)).toBe('1m 0s');
    expect(AdminShell.dur(200)).toBe('3m 20s');
    expect(AdminShell.dur(3600)).toBe('1h 0m');
    expect(AdminShell.dur(7500)).toBe('2h 5m');
  });

  test('rolls over into days rather than counting hours indefinitely', () => {
    // The tier a formatter that stops at hours gets wrong: a 26-hour run has to read "1d 2h" everywhere it appears.
    expect(AdminShell.dur(93900)).toBe('1d 2h');
    expect(AdminShell.dur(356400)).toBe('4d 3h');
  });

  test('clamps a negative duration rather than rendering "-3s"', () => {
    expect(AdminShell.dur(-3)).toBe('0s');
  });
});

describe('AdminShell.relativeTime', () => {
  const NOW = Date.parse('2026-08-20T12:00:00Z');

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('steps through the just-now / minutes / hours / days tiers', () => {
    expect(AdminShell.relativeTime(new Date(NOW - 30 * 1000))).toBe('just now');
    expect(AdminShell.relativeTime(new Date(NOW - 12 * 60 * 1000))).toBe('12m ago');
    expect(AdminShell.relativeTime(new Date(NOW - 3 * 3600 * 1000))).toBe('3h ago');
    expect(AdminShell.relativeTime(new Date(NOW - 5 * 24 * 3600 * 1000))).toBe('5d ago');
  });

  test('falls back to a date once "N days ago" stops being the useful reading', () => {
    // Past a week the relative form stops answering the question anyone is asking of it.
    const old = AdminShell.relativeTime(new Date(NOW - 40 * 24 * 3600 * 1000));
    expect(old).not.toMatch(/ago/);
    expect(old).toMatch(/2026/);
  });

  test('omits the year when asked, which is what the activity feed wants', () => {
    const old = AdminShell.relativeTime(new Date(NOW - 40 * 24 * 3600 * 1000), { withYear: false });
    expect(old).not.toMatch(/2026/);
  });

  test('treats a future timestamp as now rather than counting backwards', () => {
    expect(AdminShell.relativeTime(new Date(NOW + 60 * 60 * 1000))).toBe('just now');
  });

  test('echoes an unparseable timestamp by default, and returns the caller\'s placeholder when given one', () => {
    expect(AdminShell.relativeTime('not a date')).toBe('not a date');
    expect(AdminShell.relativeTime('not a date', { invalid: '' })).toBe('');
  });
});

describe('AdminShell.tableHtml', () => {
  test('marks text columns for left alignment and leaves numeric ones to sit over their .ac-num cells', () => {
    const html = AdminShell.tableHtml(['Job', ['Duration', true]], '<tr><td>x</td><td>y</td></tr>');
    document.body.innerHTML = html;
    const headers = [...document.querySelectorAll('th')];
    expect(headers.map((th) => th.textContent)).toEqual(['Job', 'Duration']);
    expect(headers[0].className).toBe('ac-th-text');
    expect(headers[1].className).toBe('');
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  test('wraps the table so wide content scrolls inside its own container', () => {
    document.body.innerHTML = AdminShell.tableHtml(['A'], '');
    expect(document.querySelector('.ac-table-wrap .ac-table')).not.toBeNull();
  });
});

describe('AdminShell.setText / setHtml', () => {
  test('do nothing when the element is not on this page', () => {
    document.body.innerHTML = '';
    expect(() => AdminShell.setText('missing', 'x')).not.toThrow();
    expect(() => AdminShell.setHtml('missing', '<b>x</b>')).not.toThrow();
  });

  test('setText does not interpret markup, so a value never has to be escaped twice', () => {
    document.body.innerHTML = '<p id="target"></p>';
    AdminShell.setText('target', '<b>not bold</b>');
    expect(document.getElementById('target').querySelector('b')).toBeNull();
    expect(document.getElementById('target').textContent).toBe('<b>not bold</b>');
  });
});

describe('AdminShell.jobStatusBadge', () => {
  /** One `nightly_jobs` entry, succeeded and on schedule unless overridden. */
  const job = (overrides = {}) => ({ last_status: 'succeeded', overdue: false, ...overrides });

  test('tones each status the panels have been taught', () => {
    expect(AdminShell.jobStatusBadge(job())).toContain('ac-badge--good');
    expect(AdminShell.jobStatusBadge(job({ last_status: 'running' }))).toContain('ac-badge--ok');
    expect(AdminShell.jobStatusBadge(job({ last_status: 'failed' }))).toContain('ac-badge--bad');
    expect(AdminShell.jobStatusBadge(job({ last_status: 'abandoned' }))).toContain('ac-badge--bad');
    expect(AdminShell.jobStatusBadge(job({ last_status: 'never_run' }))).toContain('ac-badge--bad');
  });

  test('does not render a status it has never seen as healthy', () => {
    // A status the server grows and the page has not learned must read as a reason to look. Green here is the one
    // direction these panels must never drift, because nobody investigates a green row.
    const badge = AdminShell.jobStatusBadge(job({ last_status: 'quarantined' }));
    expect(badge).toContain('ac-badge--warn');
    expect(badge).toContain('quarantined');
  });

  test('lets overdue outrank a last run that succeeded', () => {
    const badge = AdminShell.jobStatusBadge(job({ overdue: true }));
    expect(badge).toContain('ac-badge--warn');
    expect(badge).toContain('overdue');
  });

  test('keeps a bad status bad when the job is also overdue', () => {
    // Downgrading "failed and overdue" to a warning would understate the worse of the two facts.
    expect(AdminShell.jobStatusBadge(job({ last_status: 'failed', overdue: true }))).toContain('ac-badge--bad');
  });

  test('escapes an unrecognized status rather than rendering it as markup', () => {
    expect(AdminShell.jobStatusBadge(job({ last_status: '<img src=x>' }))).not.toContain('<img');
  });
});

describe('AdminShell.jobLastRun', () => {
  const NOW = Date.parse('2026-08-20T12:00:00Z');

  beforeEach(() => { jest.spyOn(Date, 'now').mockReturnValue(NOW); });
  afterEach(() => { jest.restoreAllMocks(); });

  test('reports a job the schedule has never fired as never, not as its manual run', () => {
    // A hand-run job proves the code works, not that anything is firing it, so it must not read as a scheduled run.
    const html = AdminShell.jobLastRun({
      last_started_at: null,
      last_manual_run_at: '2026-08-20T10:00:00Z',
      last_manual_status: 'succeeded',
    });
    expect(html).toMatch(/^never/);
    expect(html).toContain('manual 2h ago: succeeded');
  });

  test('reports the scheduled run alone when nobody has hand-triggered the job', () => {
    const html = AdminShell.jobLastRun({ last_started_at: '2026-08-20T09:00:00Z', last_manual_run_at: null });
    expect(html).toBe('3h ago');
    expect(html).not.toContain('manual');
  });

  test('mutes the manual note so it reads as an aside to the schedule record', () => {
    const html = AdminShell.jobLastRun({
      last_started_at: '2026-08-19T12:00:00Z',
      last_manual_run_at: '2026-08-20T11:00:00Z',
      last_manual_status: 'failed',
    });
    expect(html).toContain('1d ago');
    expect(html).toContain('<span class="ac-muted"> · manual 1h ago: failed</span>');
  });
});

describe('AdminShell.jobDetails', () => {
  test('prefers the error when the run failed, since its counts mean nothing then', () => {
    expect(AdminShell.jobDetails({ last_error: 'boom', last_details: { streets_polled: 5 } })).toBe('boom');
  });

  test('flattens a run\'s counts into readable pairs', () => {
    expect(AdminShell.jobDetails({ last_details: { streets_polled: 1234, not_polled_reason: 'no key' } }))
      .toBe('streets polled: 1,234, not polled reason: no key');
  });

  test('renders a run that recorded nothing as an em dash rather than an empty cell', () => {
    expect(AdminShell.jobDetails({})).toBe('—');
    expect(AdminShell.jobDetails({ last_details: {} })).toBe('—');
    expect(AdminShell.jobDetails({ last_details: 'not an object' })).toBe('—');
  });

  test('keeps a zero count, which is the answer a quiet night actually gives', () => {
    expect(AdminShell.jobDetails({ last_details: { audits_flagged: 0, audits_unflagged: null } }))
      .toBe('audits flagged: 0');
  });
});

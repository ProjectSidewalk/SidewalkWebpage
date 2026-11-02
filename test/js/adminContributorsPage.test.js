/** Tests for the admin Contributors page: its totals, quality and role bars, leaderboards and histograms (#5840). */

import { loadModules } from './loader.js';
import { flush, routeFetch, textOf } from './support/routeFetch.js';

const { ContributorsPage } = await loadModules('frontend/js/admin-dashboard/ContributorsPage.js');

const URLS = { userStatsUrl: '/adminapi/getUserStats', leaderboardsUrl: '/adminapi/contributorLeaderboards' };

/** The ids contributors.scala.html gives the page's own sections (the funnels have their own suite). */
const MARKUP = `
  <span id="kpi-contributors">—</span><span id="kpi-high-quality">—</span><span id="kpi-low-quality">—</span>
  <span id="kpi-labels-high-quality">—</span><span id="kpi-labels-high-quality-note"></span>
  <div class="coverage-status" id="contrib-status">Loading contributor data…</div>
  <div id="contrib-quality"></div>
  <div id="contrib-label-source"></div>
  <div id="contrib-label-role"></div>
  <div id="contrib-top-labelers"></div>
  <div id="contrib-top-validators"></div>
  <div class="dq-rows" id="contrib-accuracy"></div>
  <div class="dq-rows" id="contrib-roles"></div>`;

/** @returns {object} One /adminapi/getUserStats row; agreement is a 0-1 fraction unless given otherwise. */
const user = (username, role, labels, highQuality, ownValidated = 0, agreed = 0) => ({
  user_id: `id-${username}`, username, email: `${username}@example.org`, role, team: null, sign_in_count: 1,
  labels, own_validated: ownValidated, own_validated_agreed_pct: agreed, high_quality: highQuality,
});

const USERS = [
  user('ada', 'Registered', 100, true, 10, 0.92),
  user('bo', 'Turker', 30, false, 5, 0.4),
  user('cyd', 'Researcher', 20, true),
  user('dee', 'Anonymous', 50, false, 2, 1),
  user('eve', 'Registered', 0, true, 3, 0.5),
  user('fay', 'Volunteer', 10, false, 1, 0.75),
  user('gil', 'Registered', 5, true),
];

const BOARDS = {
  top_labelers: [
    { user_id: 'id-ada', username: 'ada', role: 'Registered', labels: 1234, own_validated: 10,
      own_validated_agreed_pct: 0.92, high_quality: true,
      label_type_counts: [{ label_type: 'CurbRamp', count: 3 }, { label_type: 'Weird', count: 1 }],
      severity_counts: [{ severity: 1, count: 2 }, { severity: 3, count: 1 }, { severity: 5, count: 1 }] },
    { user_id: 'id-x', username: null, role: null, labels: null, own_validated: 0, own_validated_agreed_pct: 0,
      high_quality: false, label_type_counts: [], severity_counts: [] },
    { user_id: null, username: null, role: 'Turker', labels: 1, own_validated: 1, own_validated_agreed_pct: null,
      high_quality: false },
  ],
  top_validators: [
    { user_id: 'id-bo', username: 'bo', role: 'Turker', validations: 20, agree: 15, disagree: 5, unsure: 0,
      agreement_pct: 85.5 },
    { user_id: 'id-cyd', username: 'cyd', role: null, validations: 0, agree: 0, disagree: 0, unsure: 0,
      agreement_pct: 0 },
    { user_id: 'id-z', username: 'z', role: 'Registered', validations: null, agree: null, disagree: 2, unsure: null,
      agreement_pct: null },
  ],
};

/**
 * Starts the page against the given endpoint answers.
 * @param {object} [answers] - Per endpoint (`stats`, `boards`), what it answers.
 * @returns {Promise<void>} Resolves once the page has rendered.
 */
async function load(answers = {}) {
  document.body.innerHTML = MARKUP;
  routeFetch({
    [URLS.userStatsUrl]: answers.stats ?? { user_stats: USERS, teams: [] },
    [URLS.leaderboardsUrl]: answers.boards ?? BOARDS,
  });
  await new ContributorsPage(URLS).init();
  await flush();
}

const text = (id) => textOf(document.getElementById(id));

/** @returns {Array<string>} The legend entries of the stacked bar in the given section, as read. */
const legend = (id) => Array.from(document.querySelectorAll(`#${id} .contrib-legend-item`)).map(textOf);

/** @returns {Array<string>} The segment widths of the stacked bar in the given section. */
const widths = (id) => Array.from(document.querySelectorAll(`#${id} .contrib-seg`)).map((s) => s.style.width);

/** @returns {Array<[string, string]>} The label and count of each bar row in the given section. */
const barRows = (id) => Array.from(document.querySelectorAll(`#${id} .contrib-row`))
  .map((r) => [textOf(r.querySelector('.contrib-row-label')), textOf(r.querySelector('.contrib-row-count'))]);

/** @returns {Array<Array<string>>} The leaderboard's body rows, each as its cells' text. */
const tableRows = (id) => Array.from(document.querySelectorAll(`#${id} tbody tr`))
  .map((tr) => Array.from(tr.querySelectorAll('td')).map(textOf));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the headline numbers', () => {
  test('count only people who placed labels, and the share of labels from high-quality ones', async () => {
    await load();
    expect(text('kpi-contributors')).toBe('6');
    expect(text('kpi-high-quality')).toBe('3');
    expect(text('kpi-low-quality')).toBe('3');
    expect(text('kpi-labels-high-quality')).toBe('58%');
    expect(text('kpi-labels-high-quality-note')).toBe('125 of 215 labels');
    expect(document.getElementById('contrib-status').classList.contains('ps-hidden')).toBe(true);
  });

  test('show a dash, not 0%, when nobody has placed a label', async () => {
    await load({ stats: { user_stats: [user('eve', 'Registered', 0, true)] } });
    expect(text('kpi-contributors')).toBe('0');
    expect(text('kpi-labels-high-quality')).toBe('—');
    expect(text('kpi-labels-high-quality-note')).toBe('0 of 0 labels');
  });

  test('read a stats answer with no user list as an empty city', async () => {
    await load({ stats: {} });
    expect(text('kpi-contributors')).toBe('0');
  });

  test('report a failed load on the status line', async () => {
    await load({ boards: { status: 500 } });
    const status = document.getElementById('contrib-status');
    expect(status.textContent).toBe('Could not load contributor data. Please try again.');
    expect(status.classList.contains('error')).toBe(true);
    expect(text('kpi-contributors')).toBe('—');
  });
});

describe('the stacked bars', () => {
  test('split contributors by quality, with counts and shares', async () => {
    await load();
    expect(legend('contrib-quality')).toEqual(['High-quality 3 (50%)', 'Low-quality 3 (50%)']);
    expect(widths('contrib-quality')).toEqual(['50%', '50%']);
  });

  test('split labels by the quality of whoever placed them', async () => {
    await load();
    expect(legend('contrib-label-source')).toEqual(['From high-quality users 125 (58%)',
      'From low-quality users 90 (42%)']);
  });

  test('split labels by role, largest first, in each role\'s color and grey for one it does not know', async () => {
    await load();
    expect(legend('contrib-label-role')).toEqual(['Registered 105 (49%)', 'Anonymous 50 (23%)', 'Turker 30 (14%)',
      'Researcher 20 (9%)', 'Volunteer 10 (5%)']);
    const colors = Array.from(document.querySelectorAll('#contrib-label-role .contrib-swatch'))
      .map((s) => s.style.background);
    expect(colors[0]).toBe('rgb(0, 114, 178)');
    expect(colors[4]).toBe('rgb(153, 153, 153)');
  });

  test('draw empty bars at 0% rather than dividing by zero', async () => {
    await load({ stats: { user_stats: [] } });
    expect(legend('contrib-quality')).toEqual(['High-quality 0 (0%)', 'Low-quality 0 (0%)']);
    expect(widths('contrib-quality')).toEqual(['0%', '0%']);
    expect(legend('contrib-label-role')).toEqual([]);
  });
});

describe('the accuracy histogram', () => {
  const BUCKETS = ['< 50%', '50–70%', '70–80%', '80–90%', '90–95%', '95–100%'];

  test('buckets contributors with validated labels by agreement rate, read as fractions', async () => {
    await load();
    expect(barRows('contrib-accuracy')).toEqual([['< 50%', '1'], ['50–70%', '0'], ['70–80%', '1'],
      ['80–90%', '0'], ['90–95%', '1'], ['95–100%', '1']]);
  });

  test('reads the same rates given as percents', async () => {
    const asPercents = USERS.map((u) => ({ ...u, own_validated_agreed_pct: u.own_validated_agreed_pct * 100 }));
    await load({ stats: { user_stats: asPercents } });
    expect(barRows('contrib-accuracy').map((r) => r[1])).toEqual(['1', '0', '1', '0', '1', '1']);
    expect(barRows('contrib-accuracy').map((r) => r[0])).toEqual(BUCKETS);
  });

  test('puts a contributor with no rate in the lowest bucket', async () => {
    const hal = { ...user('hal', 'Registered', 4, true, 2), own_validated_agreed_pct: null };
    await load({ stats: { user_stats: [hal] } });
    expect(barRows('contrib-accuracy')[0]).toEqual(['< 50%', '1']);
  });

  test('says so when nobody has had a label validated', async () => {
    await load({ stats: { user_stats: [user('cyd', 'Researcher', 20, true)] } });
    expect(text('contrib-accuracy')).toBe('No contributors with validated labels yet.');
  });
});

describe('the contributors-by-role rows', () => {
  test('count contributors per role, most first', async () => {
    await load();
    expect(barRows('contrib-roles')).toEqual([['Registered', '2'], ['Turker', '1'], ['Researcher', '1'],
      ['Anonymous', '1'], ['Volunteer', '1']]);
    expect(document.querySelector('#contrib-roles .dq-bar').style.width).toBe('100%');
  });
});

describe('the top labelers table', () => {
  test('ranks labelers with role, count, accuracy and quality', async () => {
    await load();
    const [ada, nameless, unknown] = tableRows('contrib-top-labelers');
    expect([ada[0], ada[1], ada[2], ada[3], ada[6], ada[7]]).toEqual(['1', 'ada', 'Registered', '1,234', '92% of 10',
      'High']);
    expect([nameless[1], nameless[2], nameless[3], nameless[4], nameless[5], nameless[6], nameless[7]])
      .toEqual(['id-x', '', '0', '—', '—', '—', 'Low']);
    expect([unknown[1], unknown[6]]).toEqual(['Unknown', '0% of 1']);
  });

  test('links each labeler to their admin profile', async () => {
    await load();
    const hrefs = Array.from(document.querySelectorAll('#contrib-top-labelers tbody a'))
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/admin/user/ada', '/admin/user/id-x', '/admin/user/Unknown']);
  });

  test('right-aligns the number columns', async () => {
    await load();
    const numeric = Array.from(document.querySelectorAll('#contrib-top-labelers th'))
      .map((th) => [th.textContent, th.classList.contains('num')]);
    expect(numeric).toEqual([['#', true], ['Contributor', false], ['Role', false], ['Labels', true],
      ['Label types', false], ['Severity', false], ['Accuracy', true], ['Quality', true]]);
  });

  test('shows the label-type mix in label-type colors, grey for a type with no color', async () => {
    await load();
    const segs = Array.from(document.querySelectorAll('#contrib-top-labelers .contrib-typeseg'));
    expect(segs.map((s) => s.dataset.psTooltip)).toEqual(['CurbRamp: 3 (75%)', 'Weird: 1 (25%)']);
    expect(segs.map((s) => s.style.width)).toEqual(['75%', '25%']);
    expect(segs[1].style.background).toBe('rgb(153, 153, 153)');
    expect(document.querySelector('.contrib-typebar').getAttribute('aria-label'))
      .toBe('CurbRamp: 3 (75%), Weird: 1 (25%)');
  });

  test('folds an out-of-range severity into the nearest of the three levels', async () => {
    await load();
    expect(document.querySelector('.contrib-sevdist').getAttribute('aria-label'))
      .toBe('Severity 1: 2 (50%), Severity 2: 0 (0%), Severity 3: 2 (50%)');
    const heights = Array.from(document.querySelectorAll('.contrib-sevbar > span')).map((s) => s.style.height);
    expect(heights).toEqual(['100%', '0%', '100%']);
  });

  test('says so when nobody has labeled, or the answer has no leaderboard', async () => {
    await load({ boards: { top_labelers: [], top_validators: [] } });
    expect(text('contrib-top-labelers')).toBe('No labelers yet.');
    await load({ boards: {} });
    expect(text('contrib-top-labelers')).toBe('No labelers yet.');
  });
});

describe('the top validators table', () => {
  test('ranks validators with their verdict split and agreement, read as a percent', async () => {
    await load();
    const [bo, cyd, z] = tableRows('contrib-top-validators');
    expect(bo).toEqual(['1', 'bo', 'Turker', '20', '75% / 25% / 0%', '86% of 20']);
    expect(cyd).toEqual(['2', 'cyd', '', '0', '—', '—']);
    expect(z).toEqual(['3', 'z', 'Registered', '0', '0% / 100% / 0%', '—']);
  });

  test('draws a verdict segment only for the votes they cast', async () => {
    await load();
    const segs = document.querySelector('#contrib-top-validators tbody tr').querySelectorAll('.contrib-verdictseg');
    expect(Array.from(segs).map((s) => [s.className, s.dataset.psTooltip])).toEqual([
      ['contrib-verdictseg is-agree', 'Agree: 15 (75%)'],
      ['contrib-verdictseg is-disagree', 'Disagree: 5 (25%)'],
    ]);
  });

  test('says so when nobody has validated', async () => {
    await load({ boards: { top_labelers: [] } });
    expect(text('contrib-top-validators')).toBe('No one has validated others’ labels yet.');
  });
});

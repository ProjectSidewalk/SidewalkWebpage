/** Tests for the admin Humans vs AI page: the KPIs, the summary line, and each of the AI's three lenses (#5840). */

import { loadModules } from './loader.js';
import { flush, routeFetch, textOf } from './support/routeFetch.js';

const { HumanVsAiPage } = await loadModules('frontend/js/admin-dashboard/HumanVsAiPage.js');

// The page's elements, as humansVsAi.scala.html serves them.
const MARKUP = `
  <span id="kpi-ai-labels">—</span><span id="kpi-ai-labels-note"></span>
  <span id="kpi-ai-validations">—</span><span id="kpi-ai-validations-note"></span>
  <span id="kpi-ai-assessed">—</span><span id="kpi-ai-assessed-note"></span>
  <div class="coverage-status" id="hva-status">Loading comparison…</div>
  <p class="hva-summary" id="hva-summary"></p>
  <div class="hva-empty" id="hva-labeler-empty" hidden>No AI-placed labels in this city.</div>
  <div id="hva-labeler-body" hidden>
    <div id="hva-type-mix"></div><div id="hva-acceptance"></div><div id="hva-severity"></div>
  </div>
  <div class="hva-empty" id="hva-validator-empty" hidden>No AI validations in this city.</div>
  <div id="hva-validator-body" hidden><div id="hva-val-volume"></div><div id="hva-verdicts"></div></div>
  <div class="hva-empty" id="hva-tagger-empty" hidden>No AI tagger assessments in this city.</div>
  <div id="hva-tagger-body" hidden><div id="hva-tags"></div></div>`;

const LABEL_TYPES = {
  label_types: [
    { name: 'CurbRamp', display_name: 'Curb Ramp', color: '#90C31F', small_icon_url: '/icons/CurbRamp_small.png' },
    { name: 'Obstacle', display_name: 'Obstacle', color: '#78B0EA', small_icon_url: '' },
    // A type util.misc doesn't know, so its color comes from the API instead.
    { name: 'Puddle', color: '#123456' },
    { name: 'Mystery' },
  ],
};

/** One labeler group as /adminapi/humanVsAi sends it. */
function labeler(group, total, typeStats = [], severityCounts = []) {
  return { group, total, validated: 0, correct: 0, type_stats: typeStats, severity_counts: severityCounts };
}

/** A city where the AI does all three jobs. */
const BUSY = {
  labelers: [
    labeler('human', 900, [
      { label_type: 'CurbRamp', count: 600, validated: 100, correct: 90 },
      { label_type: 'Obstacle', count: 300, validated: 5, correct: 4 },
    ], [{ severity: 1, count: 50 }, { severity: 3, count: 10 }]),
    labeler('ai', 100, [{ label_type: 'CurbRamp', count: 100, validated: 40, correct: 30 }],
      [{ severity: 2, count: 7 }]),
  ],
  validators: [
    { group: 'human', total: 400, agree: 300, disagree: 80, unsure: 20 },
    { group: 'ai', total: 100, agree: 50, disagree: 50, unsure: 0 },
  ],
  tagger: {
    labels_assessed: 250, avg_confidence: 0.834,
    ai_tags: [{ tag: 'narrow', count: 40 }, { tag: '<b>steep</b>', count: 10 }],
    human_tags: [{ tag: 'narrow', count: 4000 }],
  },
};

/** A city with no AI activity at all, the way the server sends it: both groups present, all zeros. */
const QUIET = {
  labelers: [labeler('human', 0), labeler('ai', 0)],
  validators: [
    { group: 'human', total: 0, agree: 0, disagree: 0, unsure: 0 },
    { group: 'ai', total: 0, agree: 0, disagree: 0, unsure: 0 },
  ],
  tagger: { labels_assessed: 0, avg_confidence: null, ai_tags: [], human_tags: [] },
};

/**
 * Builds the page with the given answers and lets it load.
 * @param {object} stats - The /adminapi/humanVsAi body, or an `{ status }` error.
 * @param {object} [labelTypes] - The /v3/api/labelTypes body.
 */
async function render(stats, labelTypes = LABEL_TYPES) {
  document.body.innerHTML = MARKUP;
  routeFetch({ '/adminapi/humanVsAi': stats, '/v3/api/labelTypes': labelTypes });
  await new HumanVsAiPage({ statsUrl: '/adminapi/humanVsAi', labelTypesUrl: '/v3/api/labelTypes' }).init();
  await flush();
}

const text = (id) => textOf(document.getElementById(id));
const hidden = (id) => document.getElementById(id).hidden;

/** @returns {Array<{label: string, human: string, ai: string, aiMuted: boolean}>} Each paired-bar group, as read. */
function groups(id) {
  return [...document.querySelectorAll(`#${id} .hva-group`)].map((g) => ({
    label: textOf(g.querySelector('.hva-group-label')),
    human: textOf(g.querySelector('.hva-bar--human .hva-bar-value')),
    ai: textOf(g.querySelector('.hva-bar--ai .hva-bar-value')),
    aiMuted: g.querySelector('.hva-bar--ai').classList.contains('hva-bar--muted'),
    humanMuted: g.querySelector('.hva-bar--human').classList.contains('hva-bar--muted'),
  }));
}

describe('Humans vs AI — KPIs and summary', () => {
  test('gives the AI’s share of labels and validations, and its tagger confidence', async () => {
    await render(BUSY);
    expect(text('kpi-ai-labels')).toBe('100');
    expect(text('kpi-ai-labels-note')).toBe('10% of 1,000 labels');
    expect(text('kpi-ai-validations')).toBe('100');
    expect(text('kpi-ai-validations-note')).toBe('20% of 500 validations');
    expect(text('kpi-ai-assessed')).toBe('250');
    expect(text('kpi-ai-assessed-note')).toBe('avg confidence 83%');
  });

  test('says so instead of 0% when there is nothing to take a share of', async () => {
    await render(QUIET);
    expect(text('kpi-ai-labels')).toBe('0');
    expect(text('kpi-ai-labels-note')).toBe('no labels yet');
    expect(text('kpi-ai-validations-note')).toBe('no validations yet');
    expect(text('kpi-ai-assessed-note')).toBe('no assessments yet');
  });

  test('names every job the AI does here in one sentence', async () => {
    await render(BUSY);
    expect(text('hva-summary')).toBe('Here, the AI places labels, validates labels, and tags labels.');
  });

  test.each([
    ['only labels', { ...QUIET, labelers: BUSY.labelers }, 'Here, the AI places labels.'],
    ['labels and tags', { ...QUIET, labelers: BUSY.labelers, tagger: BUSY.tagger },
      'Here, the AI places labels and tags labels.'],
    ['nothing', QUIET, 'No AI activity in this city yet, so everything below is human-only.'],
  ])('reads naturally when the AI does %s', async (_, stats, expected) => {
    await render(stats);
    expect(text('hva-summary')).toBe(expected);
  });

  test('treats a response missing the groups as no activity rather than failing', async () => {
    await render({});
    expect(text('kpi-ai-labels-note')).toBe('no labels yet');
    expect(hidden('hva-labeler-empty')).toBe(false);
    expect(hidden('hva-validator-empty')).toBe(false);
    expect(hidden('hva-tagger-empty')).toBe(false);
  });

  test('hides the loading line once the data is in', async () => {
    await render(BUSY);
    const status = document.getElementById('hva-status');
    expect(status.textContent).toBe('');
    expect(status.classList.contains('ps-hidden')).toBe(true);
    expect(status.classList.contains('error')).toBe(false);
  });

  test('reports a failed request as an error instead of leaving the page loading', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await render({ status: 500 });
    const status = document.getElementById('hva-status');
    expect(status.textContent).toBe('Could not load the comparison. Please try again.');
    expect(status.classList.contains('error')).toBe(true);
    expect(status.classList.contains('ps-hidden')).toBe(false);
  });
});

describe('Humans vs AI — labeler lens', () => {
  test('shows the empty note, not the charts, when the AI placed no labels', async () => {
    await render(QUIET);
    expect(hidden('hva-labeler-empty')).toBe(false);
    expect(hidden('hva-labeler-body')).toBe(true);
    expect(document.getElementById('hva-type-mix').innerHTML).toBe('');
  });

  test('compares label counts per type, busiest type first', async () => {
    await render(BUSY);
    expect(hidden('hva-labeler-body')).toBe(false);
    expect(hidden('hva-labeler-empty')).toBe(true);
    expect(groups('hva-type-mix')).toMatchObject([
      { label: 'Curb Ramp', human: '600', ai: '100' },
      { label: 'Obstacle', human: '300', ai: '0' },
    ]);
  });

  test('shows a type’s icon where the API gives one, and a color dot where it doesn’t', async () => {
    await render(BUSY);
    const [curbRamp, obstacle] = document.querySelectorAll('#hva-type-mix .hva-type');
    expect(curbRamp.querySelector('img').getAttribute('src')).toBe('/icons/CurbRamp_small.png');
    expect(obstacle.querySelector('img')).toBeNull();
    // Obstacle's color comes from util.misc's canonical table.
    expect(obstacle.querySelector('.hva-dot').style.background).toBe('rgb(120, 176, 234)');
  });

  test('falls back to the API’s color, then grey, for a type util.misc doesn’t know', async () => {
    await render({
      ...BUSY,
      labelers: [
        labeler('human', 3, [{ label_type: 'Puddle', count: 2 }, { label_type: 'Mystery', count: 1 }]),
        labeler('ai', 1, [{ label_type: 'Unlisted', count: 1 }]),
      ],
    });
    const dots = [...document.querySelectorAll('#hva-type-mix .hva-type')]
      .map((el) => [textOf(el), el.querySelector('.hva-dot').style.background]);
    expect(dots).toEqual([
      ['Puddle', 'rgb(18, 52, 86)'],
      ['Mystery', 'rgb(153, 153, 153)'],
      // Not in /v3/api/labelTypes at all: its machine name and grey.
      ['Unlisted', 'rgb(153, 153, 153)'],
    ]);
  });

  test('scales count bars against the largest count on either side', async () => {
    await render(BUSY);
    const widths = [...document.querySelectorAll('#hva-type-mix .dq-bar')].map((bar) => bar.style.width);
    expect(widths).toEqual(['100%', `${(100 / 600) * 100}%`, '50%', '0%']);
  });

  test('gives each type’s correct rate, muting a side with too few validated labels', async () => {
    await render(BUSY);
    expect(groups('hva-acceptance')).toEqual([
      { label: 'Curb Ramp', human: '90% of 100 validated', ai: '75% of 40 validated', humanMuted: false,
        aiMuted: false },
      // The AI placed no obstacles, so it has no rate at all; the 5 human ones are too few to trust.
      { label: 'Obstacle', human: '80% of 5 validated', ai: '— none validated', humanMuted: true, aiMuted: true },
    ]);
  });

  test('says no validated labels yet when no type has any', async () => {
    await render({
      ...BUSY,
      labelers: [labeler('human', 5, [{ label_type: 'CurbRamp', count: 5 }]),
        labeler('ai', 5, [{ label_type: 'CurbRamp', count: 5, validated: 0 }])],
    });
    expect(text('hva-acceptance')).toBe('No validated labels yet.');
  });

  test('compares severity ratings level by level', async () => {
    await render(BUSY);
    expect(groups('hva-severity')).toMatchObject([
      { label: 'Severity 1', human: '50', ai: '0' },
      { label: 'Severity 2', human: '0', ai: '7' },
      { label: 'Severity 3', human: '10', ai: '0' },
    ]);
  });

  test('says no severity ratings yet when nobody rated anything', async () => {
    await render({
      ...BUSY,
      labelers: [labeler('human', 5, [{ label_type: 'CurbRamp', count: 5 }]),
        { group: 'ai', total: 5, type_stats: [{ label_type: 'CurbRamp' }] }],
    });
    expect(text('hva-severity')).toBe('No severity ratings yet.');
    // A type stat with no count still gets a row, at zero.
    expect(groups('hva-type-mix')).toMatchObject([{ label: 'Curb Ramp', human: '5', ai: '0' }]);
  });

  test('draws a legend above each comparison', async () => {
    await render(BUSY);
    for (const id of ['hva-type-mix', 'hva-acceptance', 'hva-severity']) {
      expect(text(id)).toMatch(/^Human AI/);
    }
  });
});

describe('Humans vs AI — validator lens', () => {
  test('shows the empty note when the AI cast no votes', async () => {
    await render(QUIET);
    expect(hidden('hva-validator-empty')).toBe(false);
    expect(hidden('hva-validator-body')).toBe(true);
  });

  test('compares vote volume and each side’s agree / disagree / unsure mix', async () => {
    await render(BUSY);
    expect(groups('hva-val-volume')).toMatchObject([{ label: 'Validations', human: '400', ai: '100' }]);
    const rows = [...document.querySelectorAll('#hva-verdicts .hva-verdict-row')];
    expect(rows.map((r) => textOf(r))).toEqual(['Humans 75% / 20% / 5% 400', 'AI 50% / 50% / 0% 100']);
    expect(rows[1].querySelector('.contrib-verdictbar').getAttribute('aria-label'))
      .toBe('Agree: 50 (50%), Disagree: 50 (50%), Unsure: 0 (0%)');
    // No sliver for a verdict nobody gave.
    expect(rows[1].querySelectorAll('.contrib-verdictseg')).toHaveLength(2);
    expect(rows[0].querySelector('.is-unsure').dataset.psTooltip).toBe('Unsure: 20 (5%)');
  });

  test('shows a dash, not a bar, for a side whose votes are all missing', async () => {
    await render({
      ...BUSY,
      validators: [{ group: 'human', total: 0 }, { group: 'ai', total: 3, agree: 3 }],
    });
    const [humans, ai] = document.querySelectorAll('#hva-verdicts .hva-verdict-row');
    expect(textOf(humans)).toBe('Humans — 0');
    expect(humans.querySelector('.contrib-verdictbar')).toBeNull();
    expect(textOf(ai)).toBe('AI 100% / 0% / 0% 3');
    expect(groups('hva-val-volume')).toMatchObject([{ human: '0', ai: '3' }]);
  });
});

describe('Humans vs AI — tagger lens', () => {
  test('shows the empty note when the AI tagger assessed nothing', async () => {
    await render(QUIET);
    expect(hidden('hva-tagger-empty')).toBe(false);
    expect(hidden('hva-tagger-body')).toBe(true);
  });

  test('ranks each side’s tags, scaled within its own list', async () => {
    await render(BUSY);
    const [aiList, humanList] = document.querySelectorAll('#hva-tags .hva-taglist');
    expect(textOf(aiList.querySelector('.hva-taglist-title'))).toBe('AI tagger');
    expect([...aiList.querySelectorAll('.contrib-row')].map(textOf)).toEqual(['narrow 40', '<b>steep</b> 10']);
    expect([...aiList.querySelectorAll('.dq-bar')].map((b) => b.style.width)).toEqual(['100%', '25%']);
    expect(aiList.querySelector('b')).toBeNull();
    expect([...humanList.querySelectorAll('.contrib-row')].map(textOf)).toEqual(['narrow 4,000']);
    expect(humanList.querySelector('.dq-bar').style.width).toBe('100%');
  });

  test('shows at most twelve tags per side', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ tag: `tag${i}`, count: 15 - i }));
    await render({ ...BUSY, tagger: { labels_assessed: 1, ai_tags: many, human_tags: many } });
    for (const list of document.querySelectorAll('#hva-tags .hva-taglist')) {
      expect(list.querySelectorAll('.contrib-row')).toHaveLength(12);
    }
  });

  test('says No tags for the AI side when the tagger sent no tag list', async () => {
    await render({ ...BUSY, tagger: { labels_assessed: 3, human_tags: [{ tag: 'narrow', count: 2 }] } });
    expect(textOf(document.querySelector('#hva-tags .hva-taglist'))).toBe('AI tagger No tags.');
  });

  test('says No tags for a side with none, and counts a tag missing its count as zero', async () => {
    await render({ ...BUSY, tagger: { labels_assessed: 3, ai_tags: [{ tag: 'odd' }] } });
    const [aiList, humanList] = document.querySelectorAll('#hva-tags .hva-taglist');
    expect(textOf(aiList.querySelector('.contrib-row'))).toBe('odd 0');
    expect(aiList.querySelector('.dq-bar').style.width).toBe('0%');
    expect(textOf(humanList)).toBe('Humans No tags.');
    expect(text('kpi-ai-assessed-note')).toBe('no assessments yet');
  });
});

describe('Humans vs AI — page shell', () => {
  test('still draws the lenses when the KPIs, summary and status line are missing from the page', async () => {
    document.body.innerHTML = MARKUP;
    for (const id of ['hva-summary', 'hva-status', 'kpi-ai-labels', 'hva-labeler-empty']) {
      document.getElementById(id).remove();
    }
    routeFetch({ '/adminapi/humanVsAi': BUSY, '/v3/api/labelTypes': LABEL_TYPES });
    await new HumanVsAiPage({ statsUrl: '/adminapi/humanVsAi', labelTypesUrl: '/v3/api/labelTypes' }).init();
    expect(groups('hva-type-mix')).toHaveLength(2);
  });

  test('a missing status line doesn’t turn a failed load into a crash', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    document.body.innerHTML = '';
    routeFetch({ '/adminapi/humanVsAi': { status: 500 }, '/v3/api/labelTypes': LABEL_TYPES });
    const page = new HumanVsAiPage({ statsUrl: '/adminapi/humanVsAi', labelTypesUrl: '/v3/api/labelTypes' });
    await expect(page.init()).resolves.toBeUndefined();
  });
});

describe('Humans vs AI — label types', () => {
  test('uses machine names when /v3/api/labelTypes sends no list', async () => {
    await render(BUSY, {});
    expect(groups('hva-type-mix').map((g) => g.label)).toEqual(['CurbRamp', 'Obstacle']);
  });
});

/**
 * Tests for the hero band and per-city tables on /admin/across-cities (#4329): each table's order, which rows it
 * flags, and the derived figures a quiet formatter change would get wrong.
 */

import { useUtil } from './loader.js';
import { metricDistanceUtil } from './fakes.js';
import { makeCity, renderAcrossCities } from './support/acrossCitiesHarness.js';

useUtil(metricDistanceUtil);

const MARKUP = `
  <span id="hero-cities"></span><span id="hero-users"></span><span id="hero-multi-city"></span>
  <span id="hero-walked"></span><span id="hero-labels"></span><span id="hero-agreement"></span>
  <table id="ac-table">
    <thead>
      <tr>
        <th data-sort="city_name">City</th>
        <th data-sort="lifecycle">Status</th>
        <th data-sort="coverage">Coverage</th>
        <th data-sort="total_labels">Labels</th>
      </tr>
    </thead>
    <tbody id="ac-tbody"></tbody>
  </table>
  <div id="ac-status"></div>
  <table><tbody id="ac-coverage-tbody"></tbody></table>
  <table><tbody id="ac-effort-tbody"></tbody></table>
  <table><tbody id="ac-quality-tbody"></tbody></table>
  <div id="ac-patterns-legend"></div>
  <div id="ac-patterns"></div>`;

async function render(cities, summary = {}) {
  await renderAcrossCities({ markup: MARKUP, scorecards: { cities, summary } });
}

function rows(tbodyId) {
  return [...document.querySelectorAll(`#${tbodyId} tr`)];
}

/** Reads the link, not the cell, so anomaly chips beside the name don't leak in. */
function cityOrder(tbodyId) {
  return rows(tbodyId).map((tr) => tr.cells[0].querySelector('a').textContent);
}

function rowFor(tbodyId, name) {
  return rows(tbodyId).find((tr) => tr.cells[0].querySelector('a').textContent === name);
}

function sortBy(key) {
  document.querySelector(`#ac-table thead th[data-sort="${key}"]`).click();
}

describe('Across Cities — hero band', () => {
  it('fills the project totals, with a dash for a headcount the endpoint left out', async () => {
    await render([], { num_cities: 54, total_walked_km: 1234, total_labels: 1500000, global_agreement: 0.876 });
    const text = (id) => document.getElementById(id).textContent;
    expect(text('hero-cities')).toBe('54');
    expect(text('hero-users')).toBe('—');
    expect(text('hero-multi-city')).toBe('—');
    expect(text('hero-walked')).toBe('1,234 km');
    expect(text('hero-labels')).toBe('1,500,000');
    expect(text('hero-agreement')).toBe('88%');
  });

  it('shows a zero headcount as zero, not as missing', async () => {
    await render([], { total_users: 0 });
    expect(document.getElementById('hero-users').textContent).toBe('0');
  });
});

describe('Across Cities — scorecard table', () => {
  const FIXTURE = [
    makeCity('alpha', { coverage: 0.5, lifecycle: 'stalled', total_labels: 12345 }),
    makeCity('bravo', { coverage: 0.9, lifecycle: 'wrapped_up', total_labels: 900 }),
    makeCity('charlie', { coverage: 0.1, lifecycle: 'mystery', total_labels: 2500000 }),
    makeCity('delta', { coverage: 0.3, anomalies: ['high_disagreement'], last_activity: null }),
  ];

  it('opens on coverage, highest first, and counts the rows', async () => {
    await render(FIXTURE);
    expect(cityOrder('ac-tbody')).toEqual(['bravo', 'alpha', 'delta', 'charlie']);
    expect(document.getElementById('ac-status').textContent).toBe('4 cities.');
  });

  it('sorts Status by lifecycle stage, with a state it does not know last', async () => {
    await render(FIXTURE);
    sortBy('lifecycle');
    // A new column starts descending, so the first click puts the unknown state on top.
    expect(cityOrder('ac-tbody')).toEqual(['charlie', 'alpha', 'bravo', 'delta']);
    sortBy('lifecycle');
    expect(cityOrder('ac-tbody')).toEqual(['delta', 'bravo', 'alpha', 'charlie']);
  });

  it('starts a City sort A to Z', async () => {
    await render(FIXTURE);
    sortBy('city_name');
    expect(cityOrder('ac-tbody')).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
  });

  it('sorts an accented name with its unaccented letter, not after Z', async () => {
    await render([makeCity('zurich'), makeCity('Évora'), makeCity('denver')]);
    sortBy('city_name');
    expect(cityOrder('ac-tbody')).toEqual(['denver', 'Évora', 'zurich']);
  });

  it('flags rows whose lifecycle or anomalies need attention, and chips each anomaly', async () => {
    await render(FIXTURE);
    const row = (name) => rowFor('ac-tbody', name);
    expect(row('alpha').classList).toContain('ac-row--flagged');
    expect(row('bravo').classList).not.toContain('ac-row--flagged');
    expect(row('delta').classList).toContain('ac-row--flagged');
    expect(row('delta').querySelector('.ac-chip--warn').textContent).toBe('High disagreement');
  });

  it('badges a lifecycle state it does not know with the raw state', async () => {
    await render(FIXTURE);
    const charlie = rowFor('ac-tbody', 'charlie');
    expect(charlie.querySelector('.ac-badge').textContent).toBe('mystery');
  });

  it('compacts large counts, keeping the exact figure in the title', async () => {
    await render(FIXTURE);
    const cell = (name) => rowFor('ac-tbody', name).cells[3];
    expect(cell('alpha').textContent).toBe('12k');
    expect(cell('alpha').title).toBe('12,345');
    expect(cell('bravo').textContent).toBe('900');
    expect(cell('charlie').textContent).toBe('2.5M');
  });

  it('moves to the next unit where the smaller one would round up into it', async () => {
    await render([makeCity('a', { total_labels: 999_950 })]);
    expect(rowFor('ac-tbody', 'a').cells[3].textContent).toBe('1M');
  });

  it('says "never" for a city with no activity', async () => {
    await render(FIXTURE);
    expect(rowFor('ac-tbody', 'delta').cells[7].textContent).toBe('never');
  });

  it('shows an empty state when there are no cities', async () => {
    await render([]);
    expect(document.getElementById('ac-tbody').textContent).toBe('No cities to show.');
    expect(document.getElementById('ac-status').textContent).toBe('');
  });
});

describe('Across Cities — coverage table', () => {
  it('orders by coverage and gives short distances one decimal, long ones none', async () => {
    await render([
      makeCity('small', { coverage: 0.2, audited_km: 12.46, total_km: 62.3, km_remaining: 49.84 }),
      makeCity('big', { coverage: 0.6, audited_km: 1240.2, total_km: 2067, km_remaining: 826.8, lifecycle: 'stalled' }),
    ]);
    expect(cityOrder('ac-coverage-tbody')).toEqual(['big', 'small']);
    const [big, small] = rows('ac-coverage-tbody');
    expect(small.cells[4].textContent).toBe('12.5 / 62.3');
    expect(small.cells[5].textContent).toBe('49.8');
    expect(big.cells[4].textContent).toBe('1,240 / 2,067');
    expect(big.classList).toContain('ac-row--flagged');
    expect(small.classList).not.toContain('ac-row--flagged');
  });
});

describe('Across Cities — contributors & effort table', () => {
  it('orders by labelers and reads each timing in the unit that fits it', async () => {
    await render([
      makeCity('quick', { num_labelers: 5, seconds_to_validate_10: 8.2, seconds_per_100m: 144 }),
      makeCity('slow', { num_labelers: 50, seconds_to_validate_10: 4680, seconds_per_100m: null }),
    ]);
    expect(cityOrder('ac-effort-tbody')).toEqual(['slow', 'quick']);
    const [slow, quick] = rows('ac-effort-tbody');
    expect(quick.cells[5].textContent).toBe('8s');
    expect(quick.cells[6].textContent).toBe('2.4 min');
    expect(slow.cells[5].textContent).toBe('1.3 h');
    // No time recorded is a dash, not "0s", which would read as instant.
    expect(slow.cells[6].textContent).toBe('—');
  });

  it('moves to the next unit where the smaller one would round up into it', async () => {
    await render([makeCity('a', { seconds_to_validate_10: 59.6, seconds_per_100m: 3598 })]);
    const [row] = rows('ac-effort-tbody');
    expect(row.cells[5].textContent).toBe('1.0 min');
    expect(row.cells[6].textContent).toBe('1.0 h');
  });

  it('shows a dash when no validation time was recorded', async () => {
    await render([makeCity('a', { seconds_to_validate_10: 0 })]);
    expect(rows('ac-effort-tbody')[0].cells[5].textContent).toBe('—');
  });

  it('pairs the median with the 90th percentile, rounded', async () => {
    await render([makeCity('a', { labels_per_user_median: 12.6, labels_per_user_p90: 140.2 })]);
    expect(rows('ac-effort-tbody')[0].cells[2].textContent).toBe('13 · 140');
  });
});

describe('Across Cities — data quality table', () => {
  it('orders by the share of labels validated', async () => {
    await render([
      makeCity('low', { labels_validated_share: 0.1 }),
      makeCity('high', { labels_validated_share: 0.8 }),
    ]);
    expect(cityOrder('ac-quality-tbody')).toEqual(['high', 'low']);
  });

  it('derives agreement and the low-quality share from the raw counts', async () => {
    await render([makeCity('a', {
      validations_agree: 30, validations_disagree: 10, active_contributors: 90, low_quality_contributors: 10,
      total_validations: 1234, total_labels: 1000, validations_per_label: 1.234,
    })]);
    const row = rows('ac-quality-tbody')[0];
    expect(row.cells[2].textContent.trim()).toBe('1.2');
    expect(row.cells[2].title).toBe('1,234 validations / 1,000 labels');
    expect(row.cells[3].textContent).toBe('75%');
    expect(row.cells[8].textContent.trim()).toBe('10%');
    expect(row.cells[8].title).toBe('10 of 100 contributors');
  });

  it('shows a dash for agreement when nothing was validated, and flags high disagreement', async () => {
    await render([makeCity('a', { anomalies: ['high_disagreement'] })]);
    const row = rows('ac-quality-tbody')[0];
    expect(row.cells[3].textContent).toBe('—');
    expect(row.cells[8].textContent.trim()).toBe('0%');
    expect(row.classList).toContain('ac-row--flagged');
  });
});

describe('Across Cities — label-type mix', () => {
  const byType = (counts) => Object.fromEntries(Object.entries(counts).map(([k, labels]) => [k, { labels }]));

  it('lists only the label types some city has, in the backend order', async () => {
    await render([
      makeCity('a', { total_labels: 30, by_label_type: byType({ Obstacle: 10, CurbRamp: 20 }) }),
      makeCity('b', { total_labels: 5, by_label_type: byType({ Signal: 5, NoSidewalk: 0 }) }),
    ]);
    const expected = window.labelTypes.map((lt) => lt.name)
      .filter((n) => ['CurbRamp', 'Obstacle', 'Signal'].includes(n));
    const shown = [...document.querySelectorAll('#ac-patterns-legend .ac-legend-item')]
      .map((el) => el.textContent.trim());
    const names = { CurbRamp: 'Curb ramp', Obstacle: 'Obstacle', Signal: 'Signal' };
    expect(shown).toEqual(expected.map((n) => names[n]));
  });

  it('draws each city as one bar split by share, busiest city first', async () => {
    await render([
      makeCity('small', { total_labels: 5, by_label_type: byType({ Signal: 5 }) }),
      makeCity('big', { total_labels: 40, by_label_type: byType({ CurbRamp: 30, Obstacle: 10 }) }),
    ]);
    const bars = [...document.querySelectorAll('#ac-patterns .ac-pattern-row')];
    expect(bars.map((r) => r.querySelector('.ac-pattern-city a').textContent)).toEqual(['big', 'small']);
    const segs = [...bars[0].querySelectorAll('.ac-stack-seg')];
    expect(segs.map((s) => s.style.width)).toEqual(['75%', '25%']);
    expect(segs[0].getAttribute('data-ps-tooltip')).toBe('Curb ramp: 30 (75%)');
    expect(bars[0].querySelector('.ac-stack').getAttribute('aria-label'))
      .toBe('Curb ramp: 30 (75%), Obstacle: 10 (25%)');
  });

  it('says "no labels" for a city with none', async () => {
    await render([
      makeCity('busy', { total_labels: 1, by_label_type: byType({ CurbRamp: 1 }) }),
      makeCity('empty', { total_labels: 0 }),
    ]);
    const empty = document.querySelectorAll('#ac-patterns .ac-pattern-row')[1];
    expect(empty.querySelector('.ac-stack-empty').textContent).toBe('no labels');
    expect(empty.querySelector('.ac-stack').getAttribute('aria-label')).toBe('No labels');
  });
});

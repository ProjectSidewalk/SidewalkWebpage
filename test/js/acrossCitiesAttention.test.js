/**
 * Tests for the pulse line and the "needs attention" panel on /admin/across-cities (#4329): which cities make the
 * panel (never one that wrapped up), worst first, each with a reason in its own numbers. Traffic and story items are
 * covered in their own suites.
 */

import { useUtil } from './loader.js';
import { metricDistanceUtil } from './fakes.js';
import { makeCity, renderAcrossCities } from './support/acrossCitiesHarness.js';

useUtil(metricDistanceUtil);

const MARKUP = '<div id="ac-pulse"></div><div id="ac-attention"></div>';

/** Renders the page with these scorecard rows and summary block. */
async function render(cities, summary = {}) {
  await renderAcrossCities({ markup: MARKUP, scorecards: { cities, summary } });
}

function items() {
  return [...document.querySelectorAll('#ac-attention .ov-attention-item')];
}

describe('Across Cities — pulse line', () => {
  it('counts cities by lifecycle in a fixed order, leaving out states no city is in', async () => {
    await render([
      makeCity('a', { lifecycle: 'stalled' }), makeCity('b'), makeCity('c'), makeCity('d', { lifecycle: 'low_traction' }),
    ]);
    expect(document.getElementById('ac-pulse').textContent)
      .toBe('Comparing 4 cities · 2 active · 1 stalled · 1 low traction.');
  });

  it('says "city" for one', async () => {
    await render([makeCity('a', { lifecycle: 'wrapped_up' })]);
    expect(document.getElementById('ac-pulse').textContent).toBe('Comparing 1 city · 1 wrapped up.');
  });
});

describe('Across Cities — needs attention', () => {
  it('reports all clear when no city needs a look, and never flags a city that wrapped up', async () => {
    await render([makeCity('a'), makeCity('b', { lifecycle: 'wrapped_up' })]);
    expect(items()).toHaveLength(0);
    expect(document.getElementById('ac-attention').textContent).toContain('All clear');
  });

  it('explains a stalled city with its own coverage, quiet days and contributors', async () => {
    await render([makeCity('a', {
      lifecycle: 'stalled', coverage: 0.4, days_since_activity: 45, active_contributors: 1200,
    })]);
    expect(items()).toHaveLength(1);
    expect(items()[0].querySelector('.ov-attention-text').textContent)
      .toBe('a — stalled at 40% coverage, quiet for 45 days, 1,200 contributors');
    expect(items()[0].querySelector('.ov-attention-go').textContent).toBe('Stalled →');
  });

  it('says a low-traction city never took off, and that it has no activity when none is recorded', async () => {
    await render([makeCity('a', { lifecycle: 'low_traction', coverage: 0.02, active_contributors: 3 })]);
    expect(items()[0].querySelector('.ov-attention-text').textContent)
      .toBe('a — never took off: no recorded activity, 2% coverage, 3 contributors');
  });

  it('compares high disagreement against the cross-city median', async () => {
    await render([makeCity('a', { anomalies: ['high_disagreement'], validation_disagreement_rate: 0.31 })],
      { median_disagreement_rate: 0.12 });
    expect(items()[0].querySelector('.ov-attention-text').textContent)
      .toBe('a — 31% of human validations disagree (median 12%)');
    expect(items()[0].querySelector('.ov-attention-go').textContent).toBe('High disagreement →');
  });

  it('states the re-audit backlog as a share of mapped distance, with the thresholds that flagged it', async () => {
    await render([makeCity('a', { anomalies: ['reaudit_backlog'], reaudit_km: 30, mapped_km: 100 })],
      { reaudit_backlog_share: 0.2, min_mapped_km_for_reaudit_flag: 50 });
    expect(items()[0].querySelector('.ov-attention-text').textContent).toBe('a — 30 km of 100 km mapped (30%) has '
      + 'newer imagery than its audits; flagged at ≥20% of mapped, once ≥50 km is mapped');
  });

  it('shows a flag it has no wording for as the flag itself, rather than dropping it', async () => {
    await render([makeCity('a', { anomalies: ['brand_new_flag'] })]);
    expect(items()[0].querySelector('.ov-attention-text').textContent).toBe('a — brand_new_flag');
    expect(items()[0].classList).toContain('ov-attention--info');
  });

  it('puts the worst first: low traction, then warnings, then notes', async () => {
    await render([
      makeCity('note', { anomalies: ['reaudit_backlog'], mapped_km: 1 }),
      makeCity('warn', { lifecycle: 'stalled' }),
      makeCity('bad', { lifecycle: 'low_traction' }),
    ]);
    expect(items().map((a) => a.querySelector('strong').textContent)).toEqual(['bad', 'warn', 'note']);
  });

  it('links each item to its city in a new tab, and to nowhere when the city has no URL', async () => {
    await render([makeCity('a', { lifecycle: 'stalled' }), makeCity('b', { lifecycle: 'stalled', url: null })]);
    const [a, b] = items();
    expect(a.getAttribute('href')).toBe('https://a.example.org');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener');
    expect(b.getAttribute('href')).toBe('#');
    expect(b.hasAttribute('target')).toBe(false);
  });

  it('escapes the city name', async () => {
    await render([makeCity('a', { city_name: '<img src=x onerror=alert(1)>', lifecycle: 'stalled' })]);
    expect(document.querySelector('#ac-attention img')).toBeNull();
    expect(items()[0].querySelector('strong').textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

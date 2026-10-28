/**
 * Tests for the engagement funnels on /admin/across-cities (#288). A window change refetches; a breakdown change
 * re-splits cached data without one. The backend's step list decides the columns, and a failed fetch must not blank
 * what was already drawn.
 */

import { useUtil } from './loader.js';
import { metricDistanceUtil } from './fakes.js';
import { makeCity, renderAcrossCities } from './support/acrossCitiesHarness.js';

useUtil(metricDistanceUtil);

const MARKUP = `
  <div id="ac-pulse"></div>
  <div id="ac-funnel-window">
    <button class="ac-toggle-btn is-active" data-window="30d">30 days</button>
    <button class="ac-toggle-btn" data-window="90d">90 days</button>
  </div>
  <div id="ac-funnel-dim">
    <button class="ac-toggle-btn is-active" data-dim="all">All</button>
    <button class="ac-toggle-btn" data-dim="role">Role</button>
  </div>
  <div id="ac-funnel-status"></div>
  <div id="ac-funnels"></div>`;

/** One endpoint-shaped segment, with its conversions derived from the per-step account counts. */
function seg(steps) {
  return {
    steps,
    step_conversion: steps.map((v, i) => (i === 0 ? 1 : v / steps[i - 1])),
    overall_conversion: steps[steps.length - 1] / steps[0],
  };
}

const MAPPING = {
  steps: ['visited', 'took_step', 'labeled'],
  cities: [
    { ...makeCity('alpha'), all: seg([100, 50, 10]), registered: seg([40, 30, 8]), anonymous: seg([60, 20, 2]) },
    { ...makeCity('bravo'), all: seg([20, 15, 8]), registered: seg([20, 15, 8]) },
  ],
};
const CONTRIBUTION = { steps: ['visited', 'contributed'], cities: [{ ...makeCity('alpha'), all: seg([100, 30]) }] };

async function render(funnels) {
  return renderAcrossCities({ markup: MARKUP, scorecards: { cities: [makeCity('alpha')] }, funnels });
}

function blocks() {
  return [...document.querySelectorAll('#ac-funnels .ac-funnel-block')];
}

function tableText(block) {
  return [...block.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map((td) => td.textContent.trim()));
}

function funnelRequests(fetch) {
  return fetch.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/adminapi/cityFunnels'));
}

function click(groupId, attr, value) {
  document.querySelector(`#${groupId} [data-${attr}="${value}"]`).click();
}

describe('Across Cities — engagement funnels', () => {
  it('asks for the 30-day window first and reports how many cities have data', async () => {
    const { fetch } = await render({ funnels: { mapping: MAPPING } });
    expect(funnelRequests(fetch)).toEqual(['/adminapi/cityFunnels?window=30d']);
    expect(document.getElementById('ac-funnel-status').textContent).toBe('2 cities with funnel data.');
  });

  it('shows mapping before contribution whatever order the endpoint sends, and skips one it left out', async () => {
    await render({ funnels: { contribution: CONTRIBUTION, mapping: MAPPING } });
    expect(blocks().map((b) => b.querySelector('h3').textContent)).toEqual(['Mapping funnel', 'Contribution funnel']);
    await render({ funnels: { contribution: CONTRIBUTION } });
    expect(blocks().map((b) => b.querySelector('h3').textContent)).toEqual(['Contribution funnel']);
  });

  it('takes its columns from the step list, with the full step name a hover away', async () => {
    await render({ funnels: { mapping: { ...MAPPING, steps: ['visited', 'took_step', 'mystery_step'] } } });
    const heads = [...blocks()[0].querySelectorAll('thead th')];
    expect(heads.map((th) => th.textContent)).toEqual(['City', 'New', 'Took a step', 'mystery_step', 'Overall']);
    expect(heads[1].getAttribute('data-ps-tooltip')).toBe('New account, visited this city');
    // A card that would only repeat the header isn't drawn, so it isn't a tab stop either.
    expect(heads[2].hasAttribute('data-ps-tooltip')).toBe(false);
    expect(heads[2].hasAttribute('tabindex')).toBe(false);
    expect(heads[3].hasAttribute('data-ps-tooltip')).toBe(false);
  });

  it('ranks rows by overall conversion and titles each count with its drop-off', async () => {
    await render({ funnels: { mapping: MAPPING } });
    expect(tableText(blocks()[0])).toEqual([['bravo', '20', '15', '8', '40%'], ['alpha', '100', '50', '10', '10%']]);
    const alpha = blocks()[0].querySelectorAll('tbody tr')[1];
    expect(alpha.cells[1].title).toBe('100 accounts');
    expect(alpha.cells[2].title).toBe('50 — 50% of previous step');
  });

  it('sizes each bar against its own segment’s first step, busiest city first', async () => {
    await render({ funnels: { mapping: MAPPING } });
    const panels = [...blocks()[0].querySelectorAll('.ac-funnel-panel')];
    expect(panels.map((p) => p.querySelector('.ac-funnel-panel-title').textContent)).toEqual(['alpha', 'bravo']);
    const widths = [...panels[1].querySelectorAll('.ac-funnel-bar-fill')].map((f) => f.style.width);
    expect(widths).toEqual(['100%', '75%', '40%']);
    const vals = [...panels[1].querySelectorAll('.ac-funnel-bar-val')].map((v) => v.textContent);
    expect(vals).toEqual(['20', '15 · 75%', '8 · 53%']);
    expect(panels[0].querySelector('.ac-funnel-legend')).toBeNull();
  });

  it('splits by role without refetching, adding a Group column and skipping segments a city lacks', async () => {
    const { fetch } = await render({ funnels: { mapping: MAPPING } });
    click('ac-funnel-dim', 'dim', 'role');
    expect(funnelRequests(fetch)).toHaveLength(1);
    expect(document.querySelector('#ac-funnel-dim [data-dim="role"]').classList).toContain('is-active');
    expect(document.querySelector('#ac-funnel-dim [data-dim="all"]').classList).not.toContain('is-active');
    expect(blocks()[0].querySelector('thead th:nth-child(2)').textContent).toBe('Group');
    expect(tableText(blocks()[0]).map((r) => r.slice(0, 2))).toEqual([
      ['bravo', 'Registered'], ['alpha', 'Registered'], ['alpha', 'Anonymous'],
    ]);
    const legend = blocks()[0].querySelector('.ac-funnel-panel .ac-funnel-legend');
    expect(legend.textContent).toBe('RegisteredAnonymous');
    // bravo has no anonymous segment, so its anonymous bars are empty rather than missing.
    const bravoBars = blocks()[0].querySelectorAll('.ac-funnel-panel')[1].querySelectorAll('.ac-funnel-bar-fill');
    expect(bravoBars[1].style.width).toBe('0%');
  });

  it('refetches for a new window, and not for the window already shown', async () => {
    const { fetch } = await render((win) => ({ funnels: { mapping: win === '90d' ? MAPPING : CONTRIBUTION } }));
    click('ac-funnel-window', 'window', '30d');
    expect(funnelRequests(fetch)).toHaveLength(1);
    click('ac-funnel-window', 'window', '90d');
    await vi.waitFor(() => expect(blocks()[0].querySelector('h3').textContent).toBe('Mapping funnel'));
    expect(funnelRequests(fetch)).toEqual(['/adminapi/cityFunnels?window=30d', '/adminapi/cityFunnels?window=90d']);
  });

  it('shows an empty state when no city has data', async () => {
    await render({ funnels: { mapping: { steps: ['visited', 'labeled'], cities: [] } } });
    const empty = blocks()[0].querySelector('tbody td');
    expect(empty.textContent).toBe('No funnel data to show.');
    expect(empty.getAttribute('colspan')).toBe('4');
    expect(blocks()[0].querySelector('.ac-funnel-grid').innerHTML).toBe('');
    expect(document.getElementById('ac-funnel-status').textContent).toBe('No funnel data yet.');
  });

  it('says so when the fetch fails, leaving the rest of the page drawn', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await render(new Error('boom'));
    expect(document.getElementById('ac-funnel-status').textContent).toBe('Could not load funnel data.');
    expect(document.getElementById('ac-pulse').textContent).toContain('Comparing 1 city');
  });

  it('keeps the funnels already shown when a window change fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await render((win) => (win === '90d' ? new Error('boom') : { funnels: { mapping: MAPPING } }));
    click('ac-funnel-window', 'window', '90d');
    await vi.waitFor(() =>
      expect(document.getElementById('ac-funnel-status').textContent).toBe('Could not load funnel data.'));
    expect(blocks()[0].querySelector('h3').textContent).toBe('Mapping funnel');
  });
});

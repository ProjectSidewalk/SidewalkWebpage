/** Tests for the engagement funnels on the admin Contributors page: bars, breakdowns and the window picker (#5840). */

import { loadModules } from './loader.js';
import { flush, routeFetch, textOf } from './support/routeFetch.js';

const { FunnelsSection } = await loadModules('frontend/js/admin-dashboard/FunnelsSection.js');

const OPTS = {
  funnelsUrl: '/adminapi/funnels',
  hostId: 'funnel-blocks',
  statusId: 'funnel-status',
  windowToggleId: 'funnel-window',
  dimToggleId: 'funnel-dim',
};

/** The funnel section of contributors.scala.html. */
const MARKUP = `
  <div class="ac-toggle" id="funnel-window">
    <button type="button" class="ac-toggle-btn is-active" data-window="30d">Last 30 days</button>
    <button type="button" class="ac-toggle-btn" data-window="90d">Last 90 days</button>
    <button type="button" class="ac-toggle-btn" data-window="all">All time</button>
  </div>
  <div class="ac-toggle" id="funnel-dim">
    <button type="button" class="ac-toggle-btn is-active" data-dim="all">All users</button>
    <button type="button" class="ac-toggle-btn" data-dim="role">Registered vs anonymous</button>
    <button type="button" class="ac-toggle-btn" data-dim="device">Desktop vs mobile</button>
  </div>
  <div id="funnel-blocks"></div>
  <div class="coverage-status" id="funnel-status"></div>`;

/**
 * @param {number[]} steps - Accounts reaching each step.
 * @returns {object} A segment as the endpoint sends it, with each step's share of the step before.
 */
const seg = (steps) => ({
  steps,
  step_conversion: steps.map((v, i) => (i === 0 ? 1 : steps[i - 1] > 0 ? v / steps[i - 1] : 0)),
  overall_conversion: steps[0] > 0 ? steps[steps.length - 1] / steps[0] : 0,
});

/** @returns {object} A funnel's segments, the role and device splits each partitioning `all`. */
const segments = (all, registered, desktop, mobile) => ({
  all: seg(all),
  registered: seg(registered),
  anonymous: seg(all.map((v, i) => v - registered[i])),
  desktop: seg(desktop),
  mobile: seg(mobile),
  device_unknown: seg(all.map((v, i) => v - desktop[i] - mobile[i])),
});

const MAPPING = {
  steps: ['visited', 'tutorial_started', 'tutorial_finished', 'took_step', 'labeled', 'mission_completed'],
  segments: segments([12000, 6000, 4500, 1500, 900, 30], [2000, 1500, 1200, 800, 600, 25],
    [10000, 6000, 4500, 1500, 900, 30], [0, 0, 0, 0, 0, 0]),
};
const CONTRIBUTION = {
  steps: ['visited', 'contributed', 'contribution_completed'],
  segments: segments([800, 200, 50], [300, 150, 40], [500, 180, 50], [300, 20, 0]),
};

/** @returns {object} An /adminapi/funnels answer for one window. */
const answer = (window, funnels = { mapping: MAPPING, contribution: CONTRIBUTION }) => ({
  window, computed_at: '2026-10-29T03:00:00Z', funnels,
});

/**
 * Starts the section against the given answers, by window.
 * @param {Record<string, any>} [byWindow] - What `/adminapi/funnels?window=<w>` answers, for each window.
 * @returns {Promise<import('vitest').Mock>} The fetch stub, once the first window has rendered.
 */
async function load(byWindow = {}) {
  document.body.innerHTML = MARKUP;
  const routes = { '/adminapi/funnels?window=': (url) => byWindow[new URL(url, 'http://x').searchParams.get('window')]
    ?? answer('30d') };
  const stub = routeFetch(routes);
  await new FunnelsSection(OPTS).init();
  return stub;
}

const status = () => textOf(document.getElementById('funnel-status'));
const titles = () => Array.from(document.querySelectorAll('.ac-funnel-block-title')).map(textOf);

/** @returns {Array<{label: string, bars: string[]}>} The given funnel block's steps, each with its bars' text. */
const steps = (block = 0) => Array.from(document.querySelectorAll('.ac-funnel-block')[block]
  .querySelectorAll('.ac-funnel-step')).map((step) => ({
  label: textOf(step.querySelector('.ac-funnel-step-label')),
  bars: Array.from(step.querySelectorAll('.ac-funnel-bar-val')).map(textOf),
}));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the funnels', () => {
  test('draw both funnels, mapping first, and say when the data is from', async () => {
    await load();
    expect(titles()).toEqual(['Mapping funnel', 'Contribution funnel']);
    expect(status()).toBe('Data as of Oct 28, 2026.');
  });

  test('label each step and give its count and share of the step before', async () => {
    await load();
    expect(steps(0)).toEqual([
      { label: 'New account, visited this city', bars: ['12k'] },
      { label: 'Started tutorial', bars: ['6.0k · 50%'] },
      { label: 'Finished or skipped tutorial, in any city', bars: ['4.5k · 75%'] },
      { label: 'Took a step', bars: ['1.5k · 33%'] },
      { label: 'Placed a label', bars: ['900 · 60%'] },
      { label: 'Completed a mapping mission', bars: ['30 · 3%'] },
    ]);
    expect(steps(1).map((s) => s.label)).toEqual(['New account, visited this city', 'Labeled or validated',
      'Completed a labeling/validation mission']);
  });

  test('size each bar against the funnel\'s first step, and give exact counts on hover', async () => {
    await load();
    const bars = Array.from(document.querySelectorAll('.ac-funnel-block')[0].querySelectorAll('.ac-funnel-bar'));
    expect(bars.map((b) => b.querySelector('.ac-funnel-bar-fill').style.width))
      .toEqual(['100%', '50%', '37.5%', '12.5%', '7.5%', '0.3%']);
    expect(bars[0].dataset.psTooltip).toBe('New account, visited this city: 12,000 accounts');
    expect(bars[1].dataset.psTooltip).toBe('Started tutorial: 6,000 — 50% of previous step');
  });

  test('show a step the page has no name for by its key', async () => {
    await load({ '30d': answer('30d', { contribution: { steps: ['visited', 'shared_a_photo'],
      segments: segments([10, 4], [5, 2], [10, 4], [0, 0]) } }) });
    expect(titles()).toEqual(['Contribution funnel']);
    expect(steps(0)[1]).toEqual({ label: 'shared_a_photo', bars: ['4 · 40%'] });
  });

  test('leave the date off when the server has none', async () => {
    await load({ '30d': { ...answer('30d'), computed_at: null } });
    expect(status()).toBe('');
  });

  test('show a date it cannot read as the server wrote it', async () => {
    await load({ '30d': { ...answer('30d'), computed_at: 'last Tuesday' } });
    expect(status()).toBe('Data as of last Tuesday.');
  });

  test('point to the recompute endpoint when there is no funnel data yet', async () => {
    await load({ '30d': { window: '30d', computed_at: null, funnels: {} } });
    expect(document.getElementById('funnel-blocks').innerHTML).toBe('');
    expect(status()).toBe('No funnel data yet. Recompute it at /adminapi/updateFunnelStats.');
  });

  test('read an answer with no funnels as no data yet', async () => {
    await load({ '30d': {} });
    expect(status()).toBe('No funnel data yet. Recompute it at /adminapi/updateFunnelStats.');
  });

  test('report a failed load and keep what was already drawn', async () => {
    await load({ '90d': { status: 500 } });
    document.querySelector('[data-window="90d"]').click();
    await flush();
    expect(status()).toBe('Could not load funnel data.');
    expect(titles()).toEqual(['Mapping funnel', 'Contribution funnel']);
  });
});

describe('the breakdown toggle', () => {
  test('splits each step into registered and anonymous bars, with a legend', async () => {
    const fetch = await load();
    document.querySelector('[data-dim="role"]').click();
    const legend = Array.from(document.querySelectorAll('.ac-funnel-block')[0]
      .querySelectorAll('.ac-funnel-legend-item')).map(textOf);
    expect(legend).toEqual(['Registered', 'Anonymous']);
    expect(steps(0)[0].bars).toEqual(['2.0k', '10k']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('splits into desktop, mobile and unknown, and draws an empty segment as zero-width bars', async () => {
    await load();
    document.querySelector('[data-dim="device"]').click();
    expect(steps(0)[1].bars).toEqual(['6.0k · 60%', '0 · 0%', '0 · 0%']);
    const fills = Array.from(document.querySelectorAll('.ac-funnel-block')[0].querySelectorAll('.ac-funnel-step')[0]
      .querySelectorAll('.ac-funnel-bar-fill')).map((f) => f.style.width);
    expect(fills).toEqual(['100%', '0%', '100%']);
  });

  test('marks only the chosen breakdown active, and ignores a click on the one already chosen', async () => {
    await load();
    document.querySelector('[data-dim="role"]').click();
    const blocks = document.getElementById('funnel-blocks').innerHTML;
    document.querySelector('[data-dim="role"]').click();
    expect(document.getElementById('funnel-blocks').innerHTML).toBe(blocks);
    const active = Array.from(document.querySelectorAll('#funnel-dim .ac-toggle-btn.is-active'))
      .map((b) => b.dataset.dim);
    expect(active).toEqual(['role']);
  });
});

describe('the window picker', () => {
  test('fetches the chosen window and redraws from it', async () => {
    const fetch = await load({ all: answer('all', { mapping: { ...MAPPING,
      segments: segments([50000, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1]) } }) });
    document.querySelector('[data-window="all"]').click();
    await flush();
    expect(fetch).toHaveBeenLastCalledWith('/adminapi/funnels?window=all', expect.anything());
    expect(titles()).toEqual(['Mapping funnel']);
    expect(steps(0)[0].bars).toEqual(['50k']);
    const active = Array.from(document.querySelectorAll('#funnel-window .ac-toggle-btn.is-active'))
      .map((b) => b.dataset.window);
    expect(active).toEqual(['all']);
  });

  test('does not refetch the window already shown', async () => {
    const fetch = await load();
    document.querySelector('[data-window="30d"]').click();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

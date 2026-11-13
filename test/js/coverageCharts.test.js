/** Tests for the Coverage page's Vega charts: the per-region bars and the coverage histogram (#5840). */

import { loadModules, mockModule } from './loader.js';
import { fakeVegaEmbed } from './support/adminMapHarness.js';

let vega = fakeVegaEmbed();
mockModule('vega-embed', () => ({ default: (...args) => vega.embed(...args) }));
const { CoverageBars, CoverageHistogram } = await loadModules('frontend/js/admin-dashboard/CoverageBars.js',
  'frontend/js/admin-dashboard/CoverageHistogram.js');

const BARS = [
  { region_id: 1, name: 'Downtown', completion_rate: 0.8, color: 'rgb(1, 2, 3)' },
  { region_id: 2, name: 'Ballard', completion_rate: 0.1, color: 'rgb(4, 5, 6)' },
];
const BUCKETS = [
  { index: 0, label: '0–10%', count: 3, color: 'rgb(1, 1, 1)' },
  { index: 1, label: '10–20%', count: 0, color: 'rgb(2, 2, 2)' },
];

/** @returns {{opts: object, events: string[]}} Chart callbacks that log into `events`, under the given names. */
function logging(click, hover, hoverEnd) {
  const events = [];
  return {
    events,
    opts: {
      [click]: (id) => events.push(`click ${id}`),
      [hover]: (id) => events.push(`hover ${id}`),
      [hoverEnd]: () => events.push('hover end'),
    },
  };
}

beforeEach(() => {
  vega = fakeVegaEmbed();
});

describe('CoverageBars', () => {
  test('draws one bar per region in its own color, sorted by coverage', async () => {
    await new CoverageBars('coverage-bars').render(BARS);
    const { target, spec } = vega.charts[0];
    expect(target).toBe('#coverage-bars');
    expect(spec.data.values).toEqual(BARS);
    expect(spec.encoding.y.sort).toBe('-x');
    expect(spec.encoding.color).toMatchObject({ field: 'color', scale: null });
  });

  test('sorting by name redraws alphabetically and releases the old chart', async () => {
    const bars = new CoverageBars('coverage-bars');
    await bars.render(BARS);
    await bars.setSort('name');
    expect(vega.charts[1].spec.encoding.y.sort).toBe('ascending');
    expect(vega.charts[1].spec.data.values).toEqual(BARS);
    expect(vega.charts[0].finalized).toBe(true);
    expect(vega.charts[1].finalized).toBe(false);
  });

  test('clicking a bar pins its region; a click on empty space does nothing', async () => {
    const { opts, events } = logging('onBarClick', 'onBarHover', 'onBarHoverEnd');
    await new CoverageBars('coverage-bars', opts).render(BARS);
    vega.charts[0].fire('click', { region_id: '2' });
    vega.charts[0].fire('click');
    vega.charts[0].fire('click', {});
    expect(events).toEqual(['click 2']);
  });

  test('hover fires once per bar, and moving off the bars or out of the chart ends it once', async () => {
    const { opts, events } = logging('onBarClick', 'onBarHover', 'onBarHoverEnd');
    await new CoverageBars('coverage-bars', opts).render(BARS);
    const chart = vega.charts[0];
    chart.fire('pointermove', { region_id: 1 });
    chart.fire('pointermove', { region_id: 1 });
    chart.fire('pointermove');
    chart.fire('pointerout');
    chart.fire('pointermove', { region_id: 2 });
    chart.fire('pointerout');
    expect(events).toEqual(['hover 1', 'hover end', 'hover 2', 'hover end']);
  });

  test('dims all bars but the chosen ones, and restores them on clear', async () => {
    const bars = new CoverageBars('coverage-bars');
    await bars.render(BARS);
    bars.highlightBar(2);
    bars.clearHighlight();
    expect(vega.charts[0].signals).toEqual([
      { name: 'externalSelect', value: [2] },
      { name: 'externalSelect', value: null },
    ]);
  });

  test('highlighting before the chart has drawn is a no-op rather than an error', () => {
    const bars = new CoverageBars('coverage-bars');
    expect(() => { bars.highlightBars([1]); bars.clearHighlight(); }).not.toThrow();
  });

  test('works without any callbacks', async () => {
    await new CoverageBars('coverage-bars').render(BARS);
    vega.charts[0].fire('click', { region_id: 1 });
    vega.charts[0].fire('pointermove', { region_id: 1 });
    vega.charts[0].fire('pointerout');
    expect(vega.charts).toHaveLength(1);
  });
});

describe('CoverageHistogram', () => {
  test('draws one bar per coverage bucket, in bucket order', async () => {
    await new CoverageHistogram('coverage-histogram').render(BUCKETS);
    const { target, spec } = vega.charts[0];
    expect(target).toBe('#coverage-histogram');
    expect(spec.data.values).toEqual(BUCKETS);
    expect(spec.encoding.x.sort).toEqual({ field: 'index' });
  });

  test('a redraw releases the previous chart', async () => {
    const histogram = new CoverageHistogram('coverage-histogram');
    await histogram.render(BUCKETS);
    await histogram.render(BUCKETS);
    expect(vega.charts.map((c) => c.finalized)).toEqual([true, false]);
  });

  test('clicking a bucket reports its index, including the first; empty space does nothing', async () => {
    const { opts, events } = logging('onBinClick', 'onBinHover', 'onBinHoverEnd');
    await new CoverageHistogram('coverage-histogram', opts).render(BUCKETS);
    vega.charts[0].fire('click', { index: 0 });
    vega.charts[0].fire('click');
    expect(events).toEqual(['click 0']);
  });

  test('hover fires once per bucket and ends once when the pointer leaves', async () => {
    const { opts, events } = logging('onBinClick', 'onBinHover', 'onBinHoverEnd');
    await new CoverageHistogram('coverage-histogram', opts).render(BUCKETS);
    const chart = vega.charts[0];
    chart.fire('pointerout');
    chart.fire('pointermove', { index: '1' });
    chart.fire('pointermove', { index: 1 });
    chart.fire('pointermove', {});
    chart.fire('pointermove', { index: 0 });
    chart.fire('pointerout');
    expect(events).toEqual(['hover 1', 'hover end', 'hover 0', 'hover end']);
  });

  test('works without any callbacks', async () => {
    await new CoverageHistogram('coverage-histogram').render(BUCKETS);
    vega.charts[0].fire('click', { index: 0 });
    vega.charts[0].fire('pointermove', { index: 0 });
    vega.charts[0].fire('pointerout');
    expect(vega.charts).toHaveLength(1);
  });
});

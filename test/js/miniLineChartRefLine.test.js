/**
 * Tests for frontend/js/admin-dashboard/MiniLineChart.js reference lines (#4908).
 *
 * The Imagery page's "streets polled per night" chart is unreadable without one: a 400-street bar is most of a
 * 500-street batch and a twelfth of a 5,000-street batch, and only the target says which. So the contract worth
 * pinning is that the line lands where the data would put it, and that a target above every bar widens the y scale
 * instead of being drawn off the top — which would read as "no target" rather than "target never met".
 *
 * Runs under jsdom (jest.config.js); MiniLineChart.svg is a pure string builder, so tests parse its output into a
 * detached container and assert on the resulting DOM.
 */

const { loadModules, realUtil } = require('./loadGlobalScript');

window.util = realUtil();


/** Loads a fresh MiniLineChart class. */
function loadMiniLineChart() {
  return loadModules('frontend/js/admin-dashboard/MiniLineChart.js').MiniLineChart;
}

describe('MiniLineChart reference line', () => {
  const CATS = ['Mon', 'Tue', 'Wed'];
  const VALUES = [100, 400, 250];
  let MiniLineChart;

  /** Render one bar series into a detached div and return the div for querying. */
  function render(opts = {}) {
    const div = document.createElement('div');
    div.innerHTML = MiniLineChart.svg(CATS, [{ name: 'Polled', key: 'polled', values: VALUES }],
      { kind: 'bar', maxXLabels: 3, ...opts });
    return div;
  }

  /** The y coordinate of the tallest bar's top edge. */
  const tallestBarTop = (div) => Math.min(...[...div.querySelectorAll('rect.mini-bar')].map((r) => +r.getAttribute('y')));

  beforeEach(() => {
    MiniLineChart = loadMiniLineChart();
  });

  test('puts the line exactly where a bar of the same value would end', () => {
    const div = render({ refLine: { value: 400, key: 'batch' } });
    const line = div.querySelector('line.mini-ref');
    expect(+line.getAttribute('y1')).toBeCloseTo(tallestBarTop(div), 1);
  });

  test('draws the line flat across the full plot width', () => {
    const div = render({ refLine: { value: 400 } });
    const line = div.querySelector('line.mini-ref');
    expect(line.getAttribute('y1')).toBe(line.getAttribute('y2'));
    expect(+line.getAttribute('x2')).toBeGreaterThan(+line.getAttribute('x1'));
  });

  test('widens the y scale so a target above every bar stays on the chart', () => {
    // Without this the line is drawn above the plot and clipped by the viewBox, so a batch the poll never fills
    // would look like a chart with no target at all.
    const div = render({ refLine: { value: 5000, key: 'batch' } });
    const y = +div.querySelector('line.mini-ref').getAttribute('y1');
    expect(y).toBeGreaterThanOrEqual(14); // the top margin
    expect(y).toBeLessThan(tallestBarTop(div));
  });

  test('labels the line, and keys it for styling', () => {
    const div = render({ refLine: { value: 500, key: 'batch', label: 'batch size 500' } });
    expect(div.querySelector('line.mini-ref--batch')).not.toBeNull();
    expect(div.querySelector('text.mini-ref-label--batch').textContent).toBe('batch size 500');
  });

  test('escapes the label rather than letting it reach the SVG as markup', () => {
    const div = render({ refLine: { value: 500, label: '<script>x</script>' } });
    expect(div.querySelector('script')).toBeNull();
    expect(div.querySelector('text.mini-ref-label').textContent).toBe('<script>x</script>');
  });

  test('draws no label when none is given', () => {
    const div = render({ refLine: { value: 500 } });
    expect(div.querySelector('line.mini-ref')).not.toBeNull();
    expect(div.querySelector('text.mini-ref-label')).toBeNull();
  });

  test.each([
    ['omitted', undefined],
    ['a non-numeric value', { value: 'lots' }],
    ['an infinite value', { value: Infinity }],
  ])('draws nothing for %s', (_label, refLine) => {
    expect(render({ refLine }).querySelector('line.mini-ref')).toBeNull();
  });

  test('moves the label below the line when a bar\'s value label would sit under it', () => {
    // The last bar meets the target, so its value text sits at the label's height; the label is long enough to reach
    // across that bar's band from the right edge.
    const label = 'trailing average across every deployment: 250 a day';
    const div = render({ barValues: true, refLine: { value: 250, label } });
    const lineY = +div.querySelector('line.mini-ref').getAttribute('y1');
    expect(+div.querySelector('text.mini-ref-label').getAttribute('y')).toBeGreaterThan(lineY);
    // Without bar values there is nothing to dodge, so the same label stays above.
    const plain = render({ refLine: { value: 250, label } });
    expect(+plain.querySelector('text.mini-ref-label').getAttribute('y')).toBeLessThan(lineY);
  });

  test('keeps the label above the line when nothing is in its way', () => {
    const div = render({ refLine: { value: 50, label: 'avg: 50/day' } });
    const lineY = +div.querySelector('line.mini-ref').getAttribute('y1');
    expect(+div.querySelector('text.mini-ref-label').getAttribute('y')).toBeLessThan(lineY);
  });

  test('marks the label aria-hidden only when the caller says the text alternative carries it', () => {
    expect(render({ refLine: { value: 50, label: 'x' } }).querySelector('text.mini-ref-label')
      .hasAttribute('aria-hidden')).toBe(false);
    expect(render({ refLine: { value: 50, label: 'x', labelInAriaLabel: true } }).querySelector('text.mini-ref-label')
      .getAttribute('aria-hidden')).toBe('true');
  });

  test('counts x labels back from the emphasized index so it is always labeled', () => {
    const cats = Array.from({ length: 30 }, (_, i) => `d${i}`);
    const div = document.createElement('div');
    div.innerHTML = MiniLineChart.svg(cats, [{ name: 'N', key: 'n', values: cats.map(() => 1) }],
      { kind: 'bar', maxXLabels: 6, emphasisIndex: 29 });
    const labels = [...div.querySelectorAll('text.mini-axis')].map((t) => t.textContent)
      .filter((t) => t.startsWith('d'));
    expect(labels).toContain('d29');
    expect(labels.length).toBe(6);
  });

  test('draws no x labels for an empty series, even with the emphasis on its (nonexistent) last point', () => {
    const div = document.createElement('div');
    div.innerHTML = MiniLineChart.svg([], [{ name: 'N', key: 'n', values: [] }], { kind: 'bar', emphasisIndex: -1 });
    expect([...div.querySelectorAll('text.mini-axis')].some((t) => t.getAttribute('y') === '212')).toBe(false);
  });

  test('leaves line charts free to use one too', () => {
    const div = render({ kind: 'line', refLine: { value: 400 } });
    expect(div.querySelector('line.mini-ref')).not.toBeNull();
  });
});

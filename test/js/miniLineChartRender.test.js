/** Tests for MiniLineChart's lines, gaps, legend, rich point cards, and drawing into a live container (#5840). */

import { loadModules } from './loader.js';

const { MiniLineChart } = await loadModules('frontend/js/admin-dashboard/MiniLineChart.js');

/**
 * @param {string[]} categories - X labels.
 * @param {Array<object>} series - The series to draw.
 * @param {object} [opts] - Chart options.
 * @returns {HTMLDivElement} A detached div holding the chart.
 */
function render(categories, series, opts = {}) {
  const div = document.createElement('div');
  div.innerHTML = MiniLineChart.svg(categories, series, opts);
  return div;
}

describe('line charts', () => {
  test('break the line at a missing value and skip its dot', () => {
    const div = render(['Mon', 'Tue', 'Wed', 'Thu'], [{ name: 'Labels', key: 'l', values: [1, null, 3, 4] }]);
    const moves = div.querySelector('path.mini-line').getAttribute('d').split(' ').map((p) => p[0]);
    expect(moves).toEqual(['M', 'M', 'L']);
    expect(div.querySelectorAll('circle.mini-pt')).toHaveLength(3);
  });

  test('center a lone point rather than pinning it to the left edge', () => {
    const div = render(['Mon'], [{ name: 'Labels', key: 'l', values: [5] }], { width: 400 });
    const grid = div.querySelector('line.mini-grid');
    const middle = (Number(grid.getAttribute('x1')) + Number(grid.getAttribute('x2'))) / 2;
    expect(Number(div.querySelector('circle').getAttribute('cx'))).toBeCloseTo(middle, 0);
  });

  test('size the dots as asked', () => {
    const div = render(['a', 'b'], [{ name: 'x', key: 'k', values: [1, 2] }], { dotRadius: 2 });
    expect(div.querySelector('circle').getAttribute('r')).toBe('2');
  });

  test('add a legend only when there is more than one series', () => {
    const one = render(['a', 'b'], [{ name: 'Registered', key: 'r', values: [1, 2] }]);
    expect(one.querySelector('.mini-legend')).toBeNull();
    const two = render(['a', 'b'], [
      { name: 'Registered', key: 'r', values: [1, 2] },
      { name: '<Anon>', key: 'a', values: [2, 1] },
    ]);
    const items = Array.from(two.querySelectorAll('.mini-legend-item'));
    expect(items.map((i) => i.textContent)).toEqual(['Registered', '<Anon>']);
    expect(items[1].querySelector('.mini-swatch--a')).not.toBeNull();
  });

  test('name the chart for screen readers, with a default', () => {
    expect(render(['a'], [], {}).querySelector('svg').getAttribute('aria-label')).toBe('Line chart');
    expect(render(['a'], [], { ariaLabel: 'Labels over time' }).querySelector('svg').getAttribute('aria-label'))
      .toBe('Labels over time');
  });
});

describe('bar charts', () => {
  test('leave a gap with no bar and no hover target for a missing value', () => {
    const div = render(['a', 'b', 'c'], [{ name: 'x', key: 'k', values: [3, null, 2] }], { kind: 'bar' });
    expect(div.querySelectorAll('rect.mini-bar')).toHaveLength(2);
    expect(div.querySelectorAll('rect.mini-bar-hit')).toHaveLength(2);
  });
});

describe('rich point cards', () => {
  const SERIES = [{ name: 'Labels', key: 'l', values: [1, 2], tooltips: ['Mon: 1', 'Tue: 2'],
    tooltipsHtml: ['<b>Mon</b> 1 label', null] }];

  test('make a point with a card focusable and named, in place of a native tooltip', () => {
    const div = render(['Mon', 'Tue'], SERIES);
    const [rich, plain] = div.querySelectorAll('circle');
    expect(rich.getAttribute('tabindex')).toBe('0');
    expect(rich.getAttribute('role')).toBe('img');
    expect(rich.getAttribute('aria-label')).toBe('Mon: 1');
    expect(rich.dataset.psTooltipHtml).toBe('<b>Mon</b> 1 label');
    expect(rich.querySelector('title')).toBeNull();
    expect(plain.querySelector('title').textContent).toBe('Tue: 2');
  });

  test('turn the chart into a group so its focusable points stay reachable', () => {
    expect(render(['Mon', 'Tue'], SERIES).querySelector('svg').getAttribute('role')).toBe('group');
    expect(render(['Mon', 'Tue'], [{ ...SERIES[0], tooltipsHtml: undefined }]).querySelector('svg')
      .getAttribute('role')).toBe('img');
  });

  test('make a pinnable card\'s point a button that opens a dialog', () => {
    const rich = render(['Mon', 'Tue'], SERIES, { pinnableTips: true }).querySelector('circle');
    expect(rich.getAttribute('role')).toBe('button');
    expect(rich.getAttribute('aria-haspopup')).toBe('dialog');
    expect(rich.getAttribute('aria-expanded')).toBe('false');
    expect(rich.hasAttribute('data-ps-tooltip-pinnable')).toBe(true);
  });

  test('give bars the same cards', () => {
    const hit = render(['Mon', 'Tue'], SERIES, { kind: 'bar' }).querySelector('rect.mini-bar-hit');
    expect(hit.dataset.psTooltipHtml).toBe('<b>Mon</b> 1 label');
  });
});

describe('renderInto', () => {
  const CATS = ['Mon', 'Tue', 'Wed'];
  const SERIES = [{ name: 'Labels', key: 'l', values: [1, 2, 3] }];
  /** The callbacks handed to `new ResizeObserver(cb)`, so a test can resize the container by hand. */
  let resizeCallbacks;

  beforeEach(() => {
    resizeCallbacks = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb) { resizeCallbacks.push(cb); }
      observe() {}
    });
  });

  afterEach(() => {
    delete window.SVGElement.prototype.getBBox;
  });

  /** @returns {HTMLDivElement} A container `width` px wide. */
  const container = (width) => {
    const div = document.createElement('div');
    Object.defineProperty(div, 'clientWidth', { value: width, configurable: true });
    return div;
  };

  const viewWidth = (div) => Number(div.querySelector('svg').getAttribute('viewBox').split(' ')[2]);

  test('draws at the container\'s width, but never narrower than 280 px', () => {
    const wide = container(1000);
    MiniLineChart.renderInto(wide, CATS, SERIES);
    expect(viewWidth(wide)).toBe(1000);
    const narrow = container(100);
    MiniLineChart.renderInto(narrow, CATS, SERIES);
    expect(viewWidth(narrow)).toBe(280);
  });

  test('falls back to 760 px for a container with no layout yet', () => {
    const hidden = container(0);
    MiniLineChart.renderInto(hidden, CATS, SERIES);
    expect(viewWidth(hidden)).toBe(760);
  });

  test('does nothing without a container', () => {
    expect(() => MiniLineChart.renderInto(null, CATS, SERIES)).not.toThrow();
  });

  test('redraws at the new width when the container is resized, with the latest data', () => {
    const div = container(500);
    MiniLineChart.renderInto(div, CATS, SERIES);
    MiniLineChart.renderInto(div, ['A', 'B'], [{ name: 'Labels', key: 'l', values: [9, 9] }]);
    expect(resizeCallbacks).toHaveLength(1);
    Object.defineProperty(div, 'clientWidth', { value: 900, configurable: true });
    resizeCallbacks[0]();
    expect(viewWidth(div)).toBe(900);
    expect(div.querySelectorAll('circle')).toHaveLength(2);
  });

  test('works where ResizeObserver is missing', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const div = container(500);
    expect(() => MiniLineChart.renderInto(div, CATS, SERIES)).not.toThrow();
    expect(div.querySelector('svg')).not.toBeNull();
  });

  test('widens the margins to fit a label the browser measures past the edge, once', () => {
    const div = container(500);
    // The first draw's y ticks are measured as poking 20 px out the left, and its last x label 10 px out the right.
    let measured = 0;
    window.SVGElement.prototype.getBBox = function () {
      measured += 1;
      if (this.getAttribute('text-anchor') === 'end') return { x: -20, width: 40 };
      if (this.textContent === 'Wed') return { x: 495, width: 15 };
      return { x: 100, width: 0 };
    };
    MiniLineChart.renderInto(div, CATS, SERIES);
    const grid = div.querySelector('line.mini-grid');
    expect(Number(grid.getAttribute('x1'))).toBe(68);
    expect(500 - Number(grid.getAttribute('x2'))).toBeGreaterThanOrEqual(24);
    const calls = measured;
    resizeCallbacks[0]();
    expect(measured).toBe(calls);
    expect(Number(div.querySelector('line.mini-grid').getAttribute('x1'))).toBe(68);
  });

  test('keeps the first draw when every label already fits', () => {
    const div = container(500);
    window.SVGElement.prototype.getBBox = () => ({ x: 100, width: 10 });
    MiniLineChart.renderInto(div, CATS, SERIES);
    expect(Number(div.querySelector('line.mini-grid').getAttribute('x1'))).toBe(48);
  });

  test('keeps the first draw when the labels cannot be measured yet', () => {
    const div = container(500);
    window.SVGElement.prototype.getBBox = () => {
      throw new Error('not laid out');
    };
    MiniLineChart.renderInto(div, CATS, SERIES);
    expect(Number(div.querySelector('line.mini-grid').getAttribute('x1'))).toBe(48);
  });
});

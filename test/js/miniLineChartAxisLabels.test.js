/**
 * Tests for public/js/admin-dashboard/MiniLineChart.js axis-label fitting (#4855).
 *
 * Anything drawn outside the SVG's viewBox is clipped, so the chart's margins have to be sized to the labels they
 * host: the cumulative all-time charts on /admin/across-cities reach seven-digit y ticks, and multi-year x axes carry
 * dates long enough to run off the right edge. These tests pin "the label fits" as a geometry contract, using a
 * conservative independent width estimate (a generic sans at 11px averages well under 5.2px per digit/letter), so
 * they fail if a margin ever stops making room rather than only if a specific pixel value changes.
 *
 * Runs under jsdom (jest.config.js); MiniLineChart.svg is a pure string builder, so tests parse its output into a
 * detached container and assert on the resulting DOM.
 */

const fs = require('fs');
const path = require('path');

const CHART_PATH = path.resolve(__dirname, '..', '..', 'public/js/admin-dashboard/MiniLineChart.js');

/** Lower bound on rendered width, in px, of an axis label at the chart's 11px font. */
const MIN_PX_PER_CHAR = 5.2;

/** Load MiniLineChart.js (a plain top-level class declaration, concatenation-style) and return the class. */
function loadMiniLineChart() {
    const src = fs.readFileSync(CHART_PATH, 'utf8');
    // Indirect eval runs the script in global scope; the trailing expression hands the class binding back out.
    return (0, eval)(`${src}\nMiniLineChart;`);
}

describe('MiniLineChart axis labels', () => {
    const WIDTH = 760;
    let MiniLineChart;

    /** Render a line series into a detached div and return the div for querying. */
    function render(categories, values, opts = {}) {
        const div = document.createElement('div');
        div.innerHTML = MiniLineChart.svg(categories, [{ name: 'Total labels', key: 'aclabels', values }],
            { width: WIDTH, ...opts });
        return div;
    }

    /** The plot's left edge, which is also where the y-axis tick labels end. */
    function plotLeft(div) {
        return Number(div.querySelector('line.mini-grid').getAttribute('x1'));
    }

    /** The y-axis tick labels, right-aligned against the plot's left edge. */
    function yTicks(div) {
        return [...div.querySelectorAll('text.mini-axis')]
            .filter((t) => t.getAttribute('text-anchor') === 'end')
            .map((t) => ({ text: t.textContent, x: Number(t.getAttribute('x')) }));
    }

    /** The x-axis category labels, centered on their data point. */
    function xLabels(div) {
        return [...div.querySelectorAll('text.mini-axis')]
            .filter((t) => t.getAttribute('text-anchor') === 'middle')
            .map((t) => ({ text: t.textContent, x: Number(t.getAttribute('x')) }));
    }

    beforeEach(() => {
        MiniLineChart = loadMiniLineChart();
    });

    test('wide y ticks fit between the SVG edge and the plot', () => {
        const div = render(['Jan 2020', 'Aug 2026'], [12000, 1400146], { tickFormat: (v) => v.toLocaleString() });
        for (const tick of yTicks(div)) {
            expect(tick.x).toBeGreaterThanOrEqual(tick.text.length * MIN_PX_PER_CHAR);
        }
    });

    test('small y ticks keep the standard margin, so short-number charts are unchanged', () => {
        const div = render(['Jan', 'Feb', 'Mar'], [10, 40, 100]);
        expect(plotLeft(div)).toBe(48);
    });

    test('the left margin grows with the widest tick, not the last one drawn', () => {
        const fmt = (v) => v.toLocaleString();
        const narrow = plotLeft(render(['Jan', 'Feb'], [10, 100], { tickFormat: fmt }));
        const wide = plotLeft(render(['Jan', 'Feb'], [10, 1400146], { tickFormat: fmt }));
        expect(wide).toBeGreaterThan(narrow);
    });

    test('a long trailing x label fits inside the right edge', () => {
        const cats = ['Jan 5 2020', 'Mar 8 2023', 'Aug 10 2026'];
        const div = render(cats, [1, 2, 3]);
        const last = xLabels(div).pop();
        expect(last.text).toBe('Aug 10 2026');
        expect(WIDTH - last.x).toBeGreaterThanOrEqual((last.text.length / 2) * MIN_PX_PER_CHAR);
    });

    test('a long leading x label fits inside the left edge', () => {
        const cats = ['Jan 5 2020', 'Mar 8 2023', 'Aug 10 2026'];
        const div = render(cats, [1, 2, 3], { tickFormat: () => '0' });
        const first = xLabels(div).shift();
        expect(first.x).toBeGreaterThanOrEqual((first.text.length / 2) * MIN_PX_PER_CHAR);
    });

    test('percentage ticks (yMax 1) still render one label per gridline', () => {
        const pct = (v) => `${Math.round(v * 100)}%`;
        const div = render(['Jan', 'Feb'], [0.5, 0.9], { yMax: 1, tickFormat: pct });
        expect(yTicks(div).map((t) => t.text)).toEqual(['0%', '25%', '50%', '75%', '100%']);
    });
});

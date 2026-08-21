/**
 * Tests for public/js/admin-dashboard/MiniLineChart.js y-axis tick values and formatting (#4855).
 *
 * The axis rounds its top up to a nice step and abbreviates the labels, so gridlines land on numbers a reader can
 * compare at a glance instead of quarters of the data max. Precision moves to the tooltips rather than being lost,
 * which is the part worth pinning: these tests cover the scale, the abbreviation, the integer-data case, and that an
 * explicit yMax (the Data Quality agreement chart) still wins.
 *
 * Runs under jsdom (jest.config.js); MiniLineChart.svg is a pure string builder, so tests parse its output into a
 * detached container and assert on the resulting DOM.
 */

const fs = require('fs');
const path = require('path');

const CHART_PATH = path.resolve(__dirname, '..', '..', 'public/js/admin-dashboard/MiniLineChart.js');

/** Load MiniLineChart.js (a plain top-level class declaration, concatenation-style) and return the class. */
function loadMiniLineChart() {
    const src = fs.readFileSync(CHART_PATH, 'utf8');
    // Indirect eval runs the script in global scope; the trailing expression hands the class binding back out.
    return (0, eval)(`${src}\nMiniLineChart;`);
}

describe('MiniLineChart y-axis ticks', () => {
    let MiniLineChart;

    /** Render a line series into a detached div and return the div for querying. */
    function render(values, opts = {}) {
        const div = document.createElement('div');
        const categories = values.map((_, i) => `w${i}`);
        div.innerHTML = MiniLineChart.svg(categories, [{ name: 'Total labels', key: 'aclabels', values }],
            { width: 760, ...opts });
        return div;
    }

    /** The y-axis tick labels, bottom-to-top (the order svg() draws them). */
    function tickText(div) {
        return [...div.querySelectorAll('text.mini-axis')]
            .filter((t) => t.getAttribute('text-anchor') === 'end')
            .map((t) => t.textContent);
    }

    beforeEach(() => {
        MiniLineChart = loadMiniLineChart();
    });

    test('rounds the axis top up so ticks are whole steps, abbreviated', () => {
        expect(tickText(render([12000, 640000, 1400146]))).toEqual(['0', '400k', '800k', '1.2M', '1.6M']);
    });

    test('keeps a tight axis rather than jumping to the next power of ten', () => {
        // 2.28M sits just above a 2M axis; the 1-2-5 ladder's next rung (4M) would leave the line hugging the floor.
        const ticks = tickText(render([4000, 980000, 2276971]));
        expect(ticks).toEqual(['0', '600k', '1.2M', '1.8M', '2.4M']);
    });

    test('whole-number data never gets fractional ticks', () => {
        expect(tickText(render([1, 2, 3]))).toEqual(['0', '1', '2', '3', '4']);
        expect(tickText(render([2, 5, 9]))).toEqual(['0', '3', '6', '9', '12']);
    });

    test('values under a thousand stay exact', () => {
        expect(tickText(render([10, 40, 100]))).toEqual(['0', '25', '50', '75', '100']);
    });

    test('an explicit yMax is used as given', () => {
        const pct = (v) => `${Math.round(v * 100)}%`;
        expect(tickText(render([0.5, 0.93], { yMax: 1, tickFormat: pct })))
            .toEqual(['0%', '25%', '50%', '75%', '100%']);
    });

    test('tooltips carry the exact value the axis abbreviates', () => {
        const div = render([12000, 1400146]);
        const tips = [...div.querySelectorAll('circle title')].map((t) => t.textContent);
        expect(tips[tips.length - 1]).toContain('1,400,146');
    });
});

/**
 * Tests for public/js/admin-dashboard/MiniLineChart.js bar-mode value labels and emphasis (#4686).
 *
 * The rolling-7-day "this week" charts on /admin/across-cities label each bar with its value and emphasize the final,
 * still-accumulating "today" bar. These tests pin that contract: one label per bar (including a "0" over an empty
 * band, which draws no rect), the --emphasis classes landing on exactly the requested index, and the default bar
 * output staying label-free so other MiniLineChart callers are unaffected.
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

describe('MiniLineChart bar mode', () => {
    const CATS = ['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'];
    const VALUES = [5, 0, 1234, 8, 15, 3, 2];
    let MiniLineChart;

    /** Render one bar series into a detached div and return the div for querying. */
    function render(opts = {}) {
        const div = document.createElement('div');
        div.innerHTML = MiniLineChart.svg(CATS, [{ name: 'Labels', key: 'aclabels', values: VALUES }],
            { kind: 'bar', maxXLabels: 7, ...opts });
        return div;
    }

    beforeEach(() => {
        MiniLineChart = loadMiniLineChart();
    });

    test('barValues draws one formatted label per bar, including "0" over a zero band with no rect', () => {
        const div = render({ barValues: true });
        const labels = [...div.querySelectorAll('text.mini-value')].map((t) => t.textContent);
        expect(labels).toEqual(['5', '0', '1,234', '8', '15', '3', '2']);
        // The zero value draws a label but no bar.
        expect(div.querySelectorAll('rect.mini-bar')).toHaveLength(6);
    });

    test('barValues labels use a caller-supplied valueFormat', () => {
        const div = render({ barValues: true, valueFormat: (v) => `${v}!` });
        const labels = [...div.querySelectorAll('text.mini-value')].map((t) => t.textContent);
        expect(labels[2]).toBe('1234!');
    });

    test('emphasisIndex marks exactly that bar, its value label, and its x label', () => {
        const last = VALUES.length - 1;
        const div = render({ barValues: true, emphasisIndex: last });
        expect(div.querySelectorAll('rect.mini-bar--emphasis')).toHaveLength(1);
        const emphValues = div.querySelectorAll('text.mini-value--emphasis');
        expect(emphValues).toHaveLength(1);
        expect(emphValues[0].textContent).toBe('2');
        const emphAxis = div.querySelectorAll('text.mini-axis--emphasis');
        expect(emphAxis).toHaveLength(1);
        expect(emphAxis[0].textContent).toBe('Thu');
    });

    test('defaults stay label- and emphasis-free', () => {
        const div = render();
        expect(div.querySelectorAll('text.mini-value')).toHaveLength(0);
        expect(div.querySelectorAll('.mini-bar--emphasis, .mini-axis--emphasis')).toHaveLength(0);
    });
});

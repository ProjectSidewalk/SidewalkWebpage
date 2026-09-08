/**
 * Tests for AccessScoreHistogram (public/js/access-score/src/AccessScoreHistogram.js, #5217): the score
 * distribution as twenty named buttons — bar heights and ramp colors, the city needle and the two carets, and the
 * brush by keyboard (Arrow/Shift+Arrow/Enter/Escape) and by pointer (click to toggle, drag to sweep).
 */

const {stubI18next, stubUtilMisc, loadSources, rgb} = require('./support/accessScoreDockHarness');

describe('AccessScoreHistogram', () => {
    let onBrush;
    let onHover;
    let onHoverEnd;
    let chart;
    const N = 20;
    const bins = (values) => values.map((value, k) => ({from: k / N, to: (k + 1) / N, value}));

    /** Draws the chart with a bin value equal to its index (so the last bar is the tallest) and no brush. */
    function draw(over = {}) {
        chart.draw({
            shapeKey: 'streets', unit: 'streets', bins: bins(Array.from({length: N}, (_, k) => k)), total: 190,
            needle: {score: 0.62, label: 'City 62'}, brush: null, selection: 0.3, hover: null, ...over,
        });
    }

    const buttons = () => Array.from(document.querySelectorAll('.acs-histogram__bin'));
    const bars = () => document.querySelector('.acs-histogram__bars');

    beforeAll(() => {
        stubI18next();
        stubUtilMisc();
        loadSources();
    });

    beforeEach(() => {
        document.body.innerHTML = '<div id="acs-histogram"></div>';
        onBrush = jest.fn();
        onHover = jest.fn();
        onHoverEnd = jest.fn();
        chart = new window.AccessScoreHistogram(document.getElementById('acs-histogram'), {onBrush, onHover, onHoverEnd});
        draw();
    });

    test('renders one named button per bin, sized against a nice ceiling and colored by the ramp', () => {
        expect(buttons()).toHaveLength(N);
        // Every bin says its range and what it holds, so the chart reads without color or a pointer.
        expect(buttons()[8].getAttribute('aria-label')).toBe('bin-streets from=40 to=45 length=length-large km=8');
        expect(buttons()[8].getAttribute('data-ps-tooltip')).toBe(buttons()[8].getAttribute('aria-label'));
        // The tallest bar (19) sits under a ceiling of 20, so the gridlines land on round figures.
        const fills = buttons().map((b) => b.querySelector('.acs-histogram__bar'));
        expect(fills[19].style.height).toBe('95%');
        expect(fills[10].style.height).toBe('50%');
        expect(document.querySelector('.acs-histogram__gridline--top span').textContent).toBe('length-large km=20');
        // Each bar wears the map's color for the scores it counts.
        expect(fills[0].style.backgroundColor).toBe(rgb(window.ScoreRamp.at(0.025)));
        expect(fills[19].style.backgroundColor).toBe(rgb(window.ScoreRamp.at(0.975)));
        // Only the first bin is in the tab order; the rest are reached with the arrow keys.
        expect(buttons().map((b) => b.getAttribute('tabindex'))).toEqual(['0', ...Array(N - 1).fill('-1')]);
    });

    test('places the city needle and the selection caret, and moves the hover caret on its own', () => {
        const needle = document.querySelector('.acs-histogram__needle');
        expect(needle.hidden).toBe(false);
        expect(needle.style.left).toBe('62%');
        expect(needle.textContent.trim()).toBe('City 62');
        const selection = document.querySelector('.acs-histogram__caret--selection');
        expect(selection.style.left).toBe('30%');
        const hover = document.querySelector('.acs-histogram__caret--hover');
        expect(hover.hidden).toBe(true);
        chart.markHover(0.8);
        expect(hover.hidden).toBe(false);
        expect(hover.style.left).toBe('80%');
        chart.markHover(null);
        expect(hover.hidden).toBe(true);
        draw({needle: null, selection: null});
        expect(needle.hidden).toBe(true);
        expect(selection.hidden).toBe(true);
    });

    test('shows the brush as pressed bins and mutes the rest; an empty chart says so', () => {
        draw({brush: {from: 8, to: 12}});
        expect(buttons()[9].getAttribute('aria-pressed')).toBe('true');
        expect(buttons()[9].classList.contains('acs-histogram__bin--out')).toBe(false);
        expect(buttons()[3].getAttribute('aria-pressed')).toBe('false');
        expect(buttons()[3].classList.contains('acs-histogram__bin--out')).toBe(true);
        draw({bins: bins(Array(N).fill(0)), total: 0});
        expect(document.querySelector('.acs-histogram__empty').hidden).toBe(false);
        expect(buttons()[3].classList.contains('acs-histogram__bin--out')).toBe(false);
    });

    test('keyboard: arrows move focus, Enter toggles a bin, Shift+Arrow extends, Escape clears', () => {
        const key = (el, k, shiftKey = false) =>
            el.dispatchEvent(new KeyboardEvent('keydown', {key: k, shiftKey, bubbles: true}));
        buttons()[0].focus();
        key(buttons()[0], 'ArrowRight');
        expect(document.activeElement).toBe(buttons()[1]);
        expect(buttons()[1].getAttribute('tabindex')).toBe('0');
        expect(onHover).toHaveBeenLastCalledWith(1);
        // Enter on a button arrives as a click with no pointer behind it.
        buttons()[1].dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 0}));
        expect(onBrush).toHaveBeenLastCalledWith({from: 1, to: 2, final: true});
        draw({brush: {from: 1, to: 2}});
        key(buttons()[1], 'ArrowRight', true);
        expect(onBrush).toHaveBeenLastCalledWith({from: 1, to: 3, final: true});
        draw({brush: {from: 1, to: 3}});
        // Extending from the brush's left edge keeps the right edge where it is.
        key(buttons()[2], 'Home', true);
        expect(onBrush).toHaveBeenLastCalledWith({from: 0, to: 3, final: true});
        draw({brush: {from: 0, to: 3}});
        key(buttons()[0], 'Escape');
        expect(onBrush).toHaveBeenLastCalledWith(null);
        // Enter on the bin that is the whole brush clears it rather than re-pressing it.
        draw({brush: {from: 4, to: 5}});
        buttons()[4].dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 0}));
        expect(onBrush).toHaveBeenLastCalledWith(null);
        // A pointer's click is not a second toggle: the release already handled it.
        onBrush.mockClear();
        buttons()[4].dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1}));
        expect(onBrush).not.toHaveBeenCalled();
    });

    test('pointer: a click toggles one bin, a drag sweeps a range and commits on release', () => {
        bars().getBoundingClientRect = () => ({left: 0, width: 200});
        const pointer = (type, el, clientX) =>
            el.dispatchEvent(new MouseEvent(type, {bubbles: true, clientX, button: 0}));
        pointer('pointerdown', buttons()[3], 35);
        pointer('pointerup', buttons()[3], 35);
        expect(onBrush).toHaveBeenLastCalledWith({from: 3, to: 4, final: true});

        onBrush.mockClear();
        pointer('pointerdown', buttons()[3], 35);
        pointer('pointermove', buttons()[3], 55);
        expect(onBrush).toHaveBeenLastCalledWith({from: 3, to: 6, final: false});
        pointer('pointermove', buttons()[3], 15);
        expect(onBrush).toHaveBeenLastCalledWith({from: 1, to: 4, final: false});
        pointer('pointerup', buttons()[3], 15);
        expect(onBrush).toHaveBeenLastCalledWith({from: 1, to: 4, final: true});

        // Resting on a bin reports a hover; leaving the bars ends it.
        onHover.mockClear();
        pointer('pointermove', buttons()[7], 75);
        expect(onHover).toHaveBeenLastCalledWith(7);
        bars().dispatchEvent(new MouseEvent('pointerleave'));
        expect(onHoverEnd).toHaveBeenCalled();
    });
});

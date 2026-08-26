/**
 * Tests for public/js/ps-map/MapStatusPill.js (#5002): the zoom-floor hint shows immediately, the loading note
 * only after its anti-flicker delay (and never while suppressed), and idle/error hide the pill.
 */

const fs = require('fs');
const path = require('path');

const PILL_SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'public/js/ps-map/MapStatusPill.js'), 'utf8');

describe('MapStatusPill', () => {
    let container;

    beforeAll(() => {
        window.i18next = { t: (key) => key };
        window.eval(`${PILL_SRC}\nwindow.MapStatusPill = MapStatusPill;`);
    });

    beforeEach(() => {
        jest.useFakeTimers();
        document.body.innerHTML = '<div id="map"></div>';
        container = document.getElementById('map');
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    const pillEl = () => container.querySelector('.map-status-pill');

    test('belowFloor shows the zoom hint immediately', () => {
        const pill = new window.MapStatusPill(container);
        expect(pillEl().hidden).toBe(true);

        pill.setState('belowFloor');
        expect(pillEl().hidden).toBe(false);
        expect(pillEl().textContent).toBe('labelmap:zoom-in-for-labels');
        expect(pillEl().getAttribute('role')).toBe('status');
    });

    test('loading shows only after the anti-flicker delay', () => {
        const pill = new window.MapStatusPill(container);
        pill.setState('loading');
        expect(pillEl().hidden).toBe(true);

        jest.advanceTimersByTime(400);
        expect(pillEl().hidden).toBe(false);
        expect(pillEl().textContent).toBe('labelmap:loading-labels');
    });

    test('a fast refetch (loading then idle inside the delay) never shows the pill', () => {
        const pill = new window.MapStatusPill(container);
        pill.setState('loading');
        jest.advanceTimersByTime(200);
        pill.setState('idle');
        jest.advanceTimersByTime(400);
        expect(pillEl().hidden).toBe(true);
    });

    test('loading stays hidden while suppressed (the full overlay is already up)', () => {
        const pill = new window.MapStatusPill(container, { suppressLoading: () => true });
        pill.setState('loading');
        jest.advanceTimersByTime(400);
        expect(pillEl().hidden).toBe(true);
    });

    test('idle and error both hide an active hint', () => {
        const pill = new window.MapStatusPill(container);
        pill.setState('belowFloor');
        pill.setState('idle');
        expect(pillEl().hidden).toBe(true);

        pill.setState('belowFloor');
        pill.setState('error');
        expect(pillEl().hidden).toBe(true);
    });
});

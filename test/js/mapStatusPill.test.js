/**
 * Tests for frontend/js/ps-map/MapStatusPill.js (#5002): the zoom-floor hint shows immediately, the loading note
 * only after its anti-flicker delay (and never while suppressed), and idle/error hide the pill. The hint's close
 * button and its hover/focus pause follow the shared Toast convention (#5415).
 */

const { loadModules } = require('./loadGlobalScript');


describe('MapStatusPill', () => {
    let container;

    beforeAll(() => {
        window.i18next = { t: (key) => key };
        Object.assign(window, loadModules('frontend/js/ps-map/MapStatusPill.js'));
    });

    beforeEach(() => {
        jest.useFakeTimers();
        window.logWebpageActivity = jest.fn();
        document.body.innerHTML = '<div id="map"></div>';
        container = document.getElementById('map');
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    const pillEl = () => container.querySelector('.map-status-pill');
    const textEl = () => container.querySelector('.map-status-pill__text');
    const closeEl = () => container.querySelector('.map-status-pill__close');

    test('belowFloor shows the zoom hint immediately', () => {
        const pill = new window.MapStatusPill(container);
        expect(pillEl().hidden).toBe(true);

        pill.setState('belowFloor');
        expect(pillEl().hidden).toBe(false);
        expect(textEl().textContent).toBe('labelmap:zoom-in-for-labels');
        expect(pillEl().getAttribute('role')).toBe('status');
    });

    test('the zoom hint fades after a few seconds, and only comes back after the floor is crossed again', () => {
        const pill = new window.MapStatusPill(container);
        pill.setState('belowFloor');
        jest.advanceTimersByTime(window.MapStatusPill.HINT_DURATION_MS - 1);
        expect(pillEl().hidden).toBe(false);
        jest.advanceTimersByTime(1);
        expect(pillEl().classList.contains('map-status-pill--leaving')).toBe(true);
        expect(pillEl().hidden).toBe(false); // still painted while it fades
        jest.advanceTimersByTime(window.MapStatusPill.FADE_MS);
        expect(pillEl().hidden).toBe(true);

        // Still below the floor: a repeat of the same state is not a new arrival.
        pill.setState('belowFloor');
        expect(pillEl().hidden).toBe(true);
        // Zoom in (idle), then back out: the hint is worth showing again.
        pill.setState('idle');
        pill.setState('belowFloor');
        expect(pillEl().hidden).toBe(false);
        expect(pillEl().classList.contains('map-status-pill--leaving')).toBe(false);
    });

    test('loading shows only after the anti-flicker delay', () => {
        const pill = new window.MapStatusPill(container);
        pill.setState('loading');
        expect(pillEl().hidden).toBe(true);

        jest.advanceTimersByTime(400);
        expect(pillEl().hidden).toBe(false);
        expect(textEl().textContent).toBe('labelmap:loading-labels');
        expect(closeEl().hidden).toBe(true); // a self-clearing status, not a hint: nothing to dismiss
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

    test('the zoom hint offers a labeled close button', () => {
        const pill = new window.MapStatusPill(container);
        pill.setState('belowFloor');
        expect(closeEl().tagName).toBe('BUTTON');
        expect(closeEl().type).toBe('button');
        expect(closeEl().getAttribute('aria-label')).toBe('common:close');
        expect(closeEl().hidden).toBe(false);
        expect(closeEl().querySelector('.map-status-pill__close-icon').getAttribute('aria-hidden')).toBe('true');
    });

    test('closing hides the hint at once and logs it, until the floor is crossed again', () => {
        const pill = new window.MapStatusPill(container);
        pill.setState('belowFloor');
        closeEl().click();
        expect(pillEl().hidden).toBe(true);
        expect(pillEl().classList.contains('map-status-pill--leaving')).toBe(false);
        expect(window.logWebpageActivity).toHaveBeenCalledTimes(1);
        expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=MapStatusPill_Dismiss');

        pill.setState('belowFloor');
        expect(pillEl().hidden).toBe(true);
        jest.advanceTimersByTime(window.MapStatusPill.HINT_DURATION_MS + window.MapStatusPill.FADE_MS);
        expect(pillEl().hidden).toBe(true);

        pill.setState('idle');
        pill.setState('belowFloor');
        expect(pillEl().hidden).toBe(false);
    });

    test('closing from the keyboard returns focus to the map canvas, not the top of the page', () => {
        container.innerHTML = '<canvas class="mapboxgl-canvas" tabindex="0"></canvas>';
        const pill = new window.MapStatusPill(container);
        pill.setState('belowFloor');
        closeEl().focus();
        closeEl().click();
        expect(document.activeElement).toBe(container.querySelector('canvas'));
        expect(pillEl().hidden).toBe(true);
    });

    test.each([
        ['hover', 'mouseenter', 'mouseleave'],
        ['focus', 'focusin', 'focusout'],
    ])('%s holds the fade, and leaving restarts the full countdown', (_name, enterEvent, leaveEvent) => {
        const pill = new window.MapStatusPill(container);
        pill.setState('belowFloor');
        jest.advanceTimersByTime(5000);
        const target = enterEvent === 'mouseenter' ? pillEl() : closeEl();
        target.dispatchEvent(new Event(enterEvent, { bubbles: enterEvent !== 'mouseenter' }));
        jest.advanceTimersByTime(6000);
        expect(pillEl().hidden).toBe(false);
        expect(pillEl().classList.contains('map-status-pill--leaving')).toBe(false);

        target.dispatchEvent(new Event(leaveEvent, { bubbles: leaveEvent !== 'mouseleave' }));
        jest.advanceTimersByTime(window.MapStatusPill.HINT_DURATION_MS - 1);
        expect(pillEl().classList.contains('map-status-pill--leaving')).toBe(false);
        jest.advanceTimersByTime(1);
        expect(pillEl().classList.contains('map-status-pill--leaving')).toBe(true);
    });
});

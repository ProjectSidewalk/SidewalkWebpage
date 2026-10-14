/**
 * Tests for frontend/js/validate/data/Form.js's exit flushes (issue #5561).
 *
 * A page going away (`pagehide`) sends what it has buffered in a POST that outlives it. So does a page merely going
 * out of sight (`visibilitychange` to hidden): on iOS that is the state a tab is killed from when memory runs short,
 * and a killed page fires no `pagehide` at all, so what is buffered when it goes hidden is exactly what a kill would
 * lose. Each flush records why it happened, so the interaction log can tell a background kill (`PageHidden` last)
 * from a foreground crash (a verdict last).
 */

import { loadModules } from './loader.js';
import { fakeTracker, navigationAttempts } from './fakes.js';

const { Form } = await loadModules('frontend/js/validate/data/Form.js');

// How the suite proves the page was never reloaded (the blanket `catch -> location.reload()` #2745 removed).
const reloads = navigationAttempts();

/**
 * Puts the document into the given visibility state and announces it, the way the browser does.
 * @param {string} state - 'hidden' or 'visible'.
 */
function setVisibility(state) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
}

describe('Form exit flushes (issue #5561)', () => {
    let form;
    let payload;
    const tracker = fakeTracker({ record: vi.fn() });

    // One Form for the whole suite: its constructor leaves exit listeners on the shared window and document, so a
    // Form per test would have every earlier one answering the events too, and the POST counts would be theirs.
    beforeAll(() => {
        form = new Form('/validationTask', { source: 'Validate', validateParams: {} }, tracker);
    });

    beforeEach(() => {
        window.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }));
        tracker.push.mockClear();
        tracker.record.mockClear();
        vi.spyOn(console, 'error').mockImplementation(() => {});

        payload = { validations: [{ label_id: 1 }], interactions: [] };
        vi.spyOn(form, 'compileSubmissionData').mockReturnValue(payload);
    });

    afterEach(() => {
        delete window.fetch;
        setVisibility('visible');
    });

    /** @returns {object} The options the one exit POST was sent with. */
    function exitPostOptions() {
        expect(window.fetch).toHaveBeenCalledTimes(1);
        const [url, options] = window.fetch.mock.calls[0];
        expect(url).toBe('/validationTask');
        return options;
    }

    test('going hidden sends the buffer in a keepalive POST and says why', () => {
        setVisibility('hidden');

        const options = exitPostOptions();
        expect(options.method).toBe('POST');
        expect(options.keepalive).toBe(true);
        expect(options.body).toBe(JSON.stringify(payload));
        expect(tracker.record).toHaveBeenCalledWith('PageHidden');
        expect(tracker.record).not.toHaveBeenCalledWith('Unload');
    });

    test('coming back into view sends nothing', () => {
        setVisibility('visible');

        expect(window.fetch).not.toHaveBeenCalled();
        expect(tracker.record).not.toHaveBeenCalled();
    });

    test('pagehide still sends the buffer, recorded as an unload', () => {
        window.dispatchEvent(new Event('pagehide'));

        const options = exitPostOptions();
        expect(options.keepalive).toBe(true);
        // Recorded, not pushed: a push could trip the count backstop and send the buffer ahead of this POST.
        expect(tracker.record).toHaveBeenCalledWith('Unload');
        expect(tracker.push).not.toHaveBeenCalled();
    });

    test('hidden then gone drains the buffer each time, so nothing is sent twice', () => {
        // compileSubmissionData drains the buffer as it snapshots it (the real one calls tracker.refresh()), so the
        // second flush sees only what accumulated in between. Model that: the snapshot after the first is empty.
        form.compileSubmissionData
            .mockReturnValueOnce(payload)
            .mockReturnValueOnce({ validations: [], interactions: [] });

        setVisibility('hidden');
        window.dispatchEvent(new Event('pagehide'));

        expect(window.fetch).toHaveBeenCalledTimes(2);
        const bodies = window.fetch.mock.calls.map(([, options]) => JSON.parse(options.body));
        expect(bodies[0].validations).toHaveLength(1);
        expect(bodies[1].validations).toHaveLength(0);
    });

    test('never reloads the page on the way out', () => {
        setVisibility('hidden');
        window.dispatchEvent(new Event('pagehide'));

        expect(reloads).not.toHaveBeenCalled();
    });

    test('a hidden flush that fails is logged and retried, since the page usually comes back', async () => {
        vi.useFakeTimers();
        window.fetch = vi.fn()
            .mockImplementationOnce(() => Promise.reject(new Error('blip')))
            .mockImplementation(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }));

        setVisibility('hidden');
        await Promise.resolve();
        await Promise.resolve();
        expect(tracker.push).toHaveBeenCalledWith('SubmitFailed', expect.objectContaining({ attempt: 0 }));

        await vi.advanceTimersByTimeAsync(2000);
        expect(window.fetch).toHaveBeenCalledTimes(2);
        expect(window.fetch.mock.calls[1][1].body).toBe(JSON.stringify(payload));
    });

    test('a pagehide flush that fails is left alone: nothing is there to retry it', async () => {
        window.fetch = vi.fn(() => Promise.reject(new Error('blip')));

        window.dispatchEvent(new Event('pagehide'));
        await Promise.resolve();
        await Promise.resolve();

        expect(window.fetch).toHaveBeenCalledTimes(1);
        expect(tracker.push).not.toHaveBeenCalledWith('SubmitFailed', expect.anything());
    });

    test('a flush too big for the keepalive budget goes out as an ordinary request', () => {
        form.compileSubmissionData.mockReturnValue({
            validations: [], interactions: [{ note: 'x'.repeat(70000) }],
        });

        setVisibility('hidden');

        expect(exitPostOptions().keepalive).toBe(false);
    });
});

/**
 * Tests for public/js/validate/src/data/Form.js's exit flushes (issue #5561).
 *
 * A page going away (`pagehide`) sends what it has buffered in a POST that outlives it. So does a page merely going
 * out of sight (`visibilitychange` to hidden): on iOS that is the state a tab is killed from when memory runs short,
 * and a killed page fires no `pagehide` at all, so what is buffered when it goes hidden is exactly what a kill would
 * lose. Each flush records why it happened, so the interaction log can tell a background kill (`PageHidden` last)
 * from a foreground crash (a verdict last).
 *
 * Runs under jsdom (jest.config.js sets testEnvironment) so window/document exist.
 */

const fs = require('fs');
const path = require('path');

const { windowWithStubbedLocation, runScriptWithWindow, newLocationStub, resetLocationStub } =
    require('./support/windowWithStubbedLocation');

const FORM_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/data/Form.js');

/**
 * Load the `Form` class out of the production file, the same way validateFormSubmit.test.js does.
 * @param {Window} win - The `window` the loaded source should see.
 * @returns {Function} The Form class.
 */
function loadFormClass(win) {
    const src = fs.readFileSync(FORM_PATH, 'utf8');
    return runScriptWithWindow(src + '\nreturn Form;\n', win);
}

const locationStub = newLocationStub();
const Form = loadFormClass(windowWithStubbedLocation(locationStub));

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

    // One Form for the whole suite: its constructor leaves exit listeners on the shared window and document, so a
    // Form per test would have every earlier one answering the events too, and the POST counts would be theirs.
    beforeAll(() => {
        form = new Form('/validationTask');
    });

    beforeEach(() => {
        global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }));
        global.svv = { tracker: { push: jest.fn() } };
        resetLocationStub(locationStub);

        payload = { validations: [{ label_id: 1 }], interactions: [] };
        jest.spyOn(form, 'compileSubmissionData').mockReturnValue(payload);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete global.fetch;
        delete global.svv;
        setVisibility('visible');
    });

    /** @returns {object} The options the one exit POST was sent with. */
    function exitPostOptions() {
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, options] = global.fetch.mock.calls[0];
        expect(url).toBe('/validationTask');
        return options;
    }

    test('going hidden sends the buffer in a keepalive POST and says why', () => {
        setVisibility('hidden');

        const options = exitPostOptions();
        expect(options.method).toBe('POST');
        expect(options.keepalive).toBe(true);
        expect(options.body).toBe(JSON.stringify(payload));
        expect(svv.tracker.push).toHaveBeenCalledWith('PageHidden');
        expect(svv.tracker.push).not.toHaveBeenCalledWith('Unload');
    });

    test('coming back into view sends nothing', () => {
        setVisibility('visible');

        expect(global.fetch).not.toHaveBeenCalled();
        expect(svv.tracker.push).not.toHaveBeenCalled();
    });

    test('pagehide still sends the buffer, recorded as an unload', () => {
        window.dispatchEvent(new Event('pagehide'));

        const options = exitPostOptions();
        expect(options.keepalive).toBe(true);
        expect(svv.tracker.push).toHaveBeenCalledWith('Unload');
    });

    test('hidden then gone drains the buffer each time, so nothing is sent twice', () => {
        // compileSubmissionData drains the buffer as it snapshots it (the real one calls tracker.refresh()), so the
        // second flush sees only what accumulated in between. Model that: the snapshot after the first is empty.
        form.compileSubmissionData
            .mockReturnValueOnce(payload)
            .mockReturnValueOnce({ validations: [], interactions: [] });

        setVisibility('hidden');
        window.dispatchEvent(new Event('pagehide'));

        expect(global.fetch).toHaveBeenCalledTimes(2);
        const bodies = global.fetch.mock.calls.map(([, options]) => JSON.parse(options.body));
        expect(bodies[0].validations).toHaveLength(1);
        expect(bodies[1].validations).toHaveLength(0);
    });

    test('never reloads the page on the way out', () => {
        setVisibility('hidden');
        window.dispatchEvent(new Event('pagehide'));

        expect(locationStub.reload).not.toHaveBeenCalled();
    });
});

/**
 * Tests for public/js/validate/src/Tracker.js — the timed interaction-buffer flush (issue #4429).
 *
 * Pins the flush lifecycle: a deadline is armed by the first push after a drain and fires ~60s later; every drain
 * path funnels through refresh(), which cancels the pending deadline, so an idle tab (whose buffer holds only the
 * post-flush RefreshTracker marker) never flushes on its own; the 200-action count remains as an event-storm
 * backstop. Also pins the removal of the one-hour-gap page reload (#3226's temporary_label_id guard, which Validate
 * never needed — it has no temp label ids).
 *
 * Runs under jsdom (jest.config.js sets testEnvironment) so window/document exist.
 */

const fs = require('fs');
const path = require('path');

const { windowWithStubbedLocation, runScriptWithWindow, newLocationStub, resetLocationStub } =
    require('./support/windowWithStubbedLocation');

const TRACKER_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/Tracker.js');

const FLUSH_INTERVAL_MS = 60000;

/**
 * Load the `Tracker` class out of the production file. Like Form.js, it is a bare `class Tracker {}` that the Grunt
 * bundle concatenates into page scope, so we evaluate the source as a function body that returns the class. String
 * concatenation (not a template literal) is used so the backticks inside Tracker.js aren't reinterpreted.
 * @param {Window} win - The `window` the loaded source should see.
 * @returns {Function} The Tracker class.
 */
function loadTrackerClass(win) {
    const src = fs.readFileSync(TRACKER_PATH, 'utf8');
    return runScriptWithWindow(src + '\nreturn Tracker;\n', win);
}

// Loaded once against a window carrying this stub, so the stub has to outlive any one test -- beforeEach resets
// its fields in place rather than rebuilding the object the proxy closed over.
const locationStub = newLocationStub();
const Tracker = loadTrackerClass(windowWithStubbedLocation(locationStub));

describe('Tracker timed flush (issue #4429)', () => {
    let tracker;
    let compiledPayload;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(1_000_000);

        // The constructor binds low-level window events through jQuery; a stub with a no-op .on() is enough.
        global.$ = jest.fn(() => ({ on: jest.fn() }));

        // Minimal svv surface. compileSubmissionData mimics the production Form.js contract: it synchronously drains
        // the tracker (tracker.refresh()) before returning the payload snapshot.
        compiledPayload = { interactions: [] };
        global.svv = {
            form: {
                compileSubmissionData: jest.fn(() => {
                    tracker.refresh();
                    return compiledPayload;
                }),
                submit: jest.fn()
            }
        };

        resetLocationStub(locationStub);

        tracker = new Tracker();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        delete global.svv;
        delete global.$;
    });

    test('the first push arms a deadline that flushes the compiled payload as an intermediate submit', () => {
        tracker.push('ValidationButtonClick_Agree');

        expect(svv.form.compileSubmissionData).not.toHaveBeenCalled();
        jest.advanceTimersByTime(FLUSH_INTERVAL_MS);

        expect(svv.form.compileSubmissionData).toHaveBeenCalledTimes(1);
        expect(svv.form.compileSubmissionData).toHaveBeenCalledWith(false);
        expect(svv.form.submit).toHaveBeenCalledTimes(1);
        expect(svv.form.submit).toHaveBeenCalledWith(compiledPayload, true);
    });

    test('the deadline is fixed from the first unflushed push, not slid by later pushes', () => {
        tracker.push('ValidationButtonClick_Agree');
        jest.advanceTimersByTime(FLUSH_INTERVAL_MS - 1000);
        tracker.push('ValidationButtonClick_Disagree'); // 59s in; must not postpone the deadline.

        jest.advanceTimersByTime(999);
        expect(svv.form.submit).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        expect(svv.form.submit).toHaveBeenCalledTimes(1);
    });

    test('an idle tab stays quiet after a flush (the RefreshTracker marker never re-arms the deadline)', () => {
        tracker.push('ValidationButtonClick_Agree');
        jest.advanceTimersByTime(FLUSH_INTERVAL_MS);
        expect(svv.form.submit).toHaveBeenCalledTimes(1);

        // The drain left the buffer holding only the synthetic RefreshTracker marker; with no further user activity
        // there must be no second flush, no matter how long the tab sits.
        jest.advanceTimersByTime(10 * 60 * 1000);
        expect(svv.form.submit).toHaveBeenCalledTimes(1);
        expect(tracker.getActions().map((a) => a.action)).toEqual(['RefreshTracker']);
    });

    test('refresh() on its own never arms the deadline', () => {
        tracker.refresh();

        jest.advanceTimersByTime(10 * 60 * 1000);
        expect(svv.form.compileSubmissionData).not.toHaveBeenCalled();
        expect(svv.form.submit).not.toHaveBeenCalled();
    });

    test('an external drain (mission complete / pagehide) cancels the pending deadline', () => {
        tracker.push('ValidationButtonClick_Agree');
        jest.advanceTimersByTime(FLUSH_INTERVAL_MS / 2);

        // Both the mission-complete submit and the pagehide handler drain via compileSubmissionData -> refresh().
        tracker.refresh();

        jest.advanceTimersByTime(10 * 60 * 1000);
        expect(svv.form.submit).not.toHaveBeenCalled();
    });

    test('the action-count backstop still flushes immediately and cancels the pending deadline', () => {
        for (let i = 0; i < 201; i++) {
            tracker.push('LowLevelEvent_mousemove');
        }

        expect(svv.form.compileSubmissionData).toHaveBeenCalledTimes(1);
        expect(svv.form.submit).toHaveBeenCalledTimes(1);
        expect(svv.form.submit).toHaveBeenCalledWith(compiledPayload, true);

        // The deadline armed by the first push must not produce a second, near-empty flush.
        jest.advanceTimersByTime(10 * 60 * 1000);
        expect(svv.form.submit).toHaveBeenCalledTimes(1);
    });

    test('the next push after a drain arms a fresh deadline', () => {
        tracker.push('ValidationButtonClick_Agree');
        jest.advanceTimersByTime(FLUSH_INTERVAL_MS);
        expect(svv.form.submit).toHaveBeenCalledTimes(1);

        tracker.push('ValidationButtonClick_Disagree');
        jest.advanceTimersByTime(FLUSH_INTERVAL_MS);
        expect(svv.form.submit).toHaveBeenCalledTimes(2);
    });

    test('a >1h gap between pushes does not reload the page', () => {
        tracker.push('ValidationButtonClick_Agree');
        jest.setSystemTime(1_000_000 + 2 * 60 * 60 * 1000);
        tracker.push('ValidationButtonClick_Disagree');

        expect(locationStub.reload).not.toHaveBeenCalled();
    });

    test('a deadline firing before init finishes is a no-op that self-heals on the next push', () => {
        global.svv = {}; // svv.form doesn't exist yet.
        tracker = new Tracker();

        tracker.push('ValidationButtonClick_Agree');
        expect(() => jest.advanceTimersByTime(FLUSH_INTERVAL_MS)).not.toThrow();

        // Once init has finished, the next push re-arms and the flush goes through.
        global.svv = {
            form: {
                compileSubmissionData: jest.fn(() => {
                    tracker.refresh();
                    return compiledPayload;
                }),
                submit: jest.fn()
            }
        };
        tracker.push('ValidationButtonClick_Disagree');
        jest.advanceTimersByTime(FLUSH_INTERVAL_MS);

        expect(svv.form.submit).toHaveBeenCalledTimes(1);
        expect(svv.form.submit).toHaveBeenCalledWith(compiledPayload, true);
    });
});

/**
 * Tests for frontend/js/validate/Tracker.js — the timed interaction-buffer flush (issue #4429).
 *
 * Pins the flush lifecycle: a deadline is armed by the first push after a drain and fires ~60s later; every drain
 * path funnels through refresh(), which cancels the pending deadline, so an idle tab (whose buffer holds only the
 * post-flush RefreshTracker marker) never flushes on its own; the 200-action count remains as an event-storm
 * backstop. Also pins the removal of the one-hour-gap page reload (#3226's temporary_label_id guard, which Validate
 * never needed — it has no temp label ids).
 *
 * Runs under jsdom (jest.config.js sets testEnvironment) so window/document exist.
 */

const path = require('path');
const { loadModules } = require('./loadGlobalScript');


const TRACKER_PATH = path.resolve(__dirname, '..', '..', 'frontend/js/validate/Tracker.js');

const FLUSH_INTERVAL_MS = 60000;

const Tracker = loadModules(TRACKER_PATH).Tracker;

// jsdom reports a page reload as a "Not implemented: navigation" error on the console, so a spy there is how the
// suite proves the page was never reloaded (the blanket `catch -> location.reload()` #2745 removed).
let consoleError;
const reloadAttempts = () => consoleError.mock.calls.filter(([msg]) => String(msg).includes('Not implemented: navigation'));

describe('Tracker timed flush (issue #4429)', () => {
    let tracker;
    let form;
    let compiledPayload;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(1_000_000);

        // A minimal Form. compileSubmissionData mimics the production Form.js contract: it synchronously drains the
        // tracker (tracker.refresh()) before returning the payload snapshot.
        compiledPayload = { interactions: [] };
        form = {
            compileSubmissionData: jest.fn(() => {
                tracker.refresh();
                return compiledPayload;
            }),
            submit: jest.fn()
        };

        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        tracker = new Tracker();
        tracker.onFlush(() => form.submit(form.compileSubmissionData(false), true));
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    test('the first push arms a deadline that flushes the compiled payload as an intermediate submit', () => {
        tracker.push('ValidationButtonClick_Agree');

        expect(form.compileSubmissionData).not.toHaveBeenCalled();
        jest.advanceTimersByTime(FLUSH_INTERVAL_MS);

        expect(form.compileSubmissionData).toHaveBeenCalledTimes(1);
        expect(form.compileSubmissionData).toHaveBeenCalledWith(false);
        expect(form.submit).toHaveBeenCalledTimes(1);
        expect(form.submit).toHaveBeenCalledWith(compiledPayload, true);
    });

    test('the deadline is fixed from the first unflushed push, not slid by later pushes', () => {
        tracker.push('ValidationButtonClick_Agree');
        jest.advanceTimersByTime(FLUSH_INTERVAL_MS - 1000);
        tracker.push('ValidationButtonClick_Disagree'); // 59s in; must not postpone the deadline.

        jest.advanceTimersByTime(999);
        expect(form.submit).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        expect(form.submit).toHaveBeenCalledTimes(1);
    });

    test('an idle tab stays quiet after a flush (the RefreshTracker marker never re-arms the deadline)', () => {
        tracker.push('ValidationButtonClick_Agree');
        jest.advanceTimersByTime(FLUSH_INTERVAL_MS);
        expect(form.submit).toHaveBeenCalledTimes(1);

        // The drain left the buffer holding only the synthetic RefreshTracker marker; with no further user activity
        // there must be no second flush, no matter how long the tab sits.
        jest.advanceTimersByTime(10 * 60 * 1000);
        expect(form.submit).toHaveBeenCalledTimes(1);
        expect(tracker.getActions().map((a) => a.action)).toEqual(['RefreshTracker']);
    });

    test('refresh() on its own never arms the deadline', () => {
        tracker.refresh();

        jest.advanceTimersByTime(10 * 60 * 1000);
        expect(form.compileSubmissionData).not.toHaveBeenCalled();
        expect(form.submit).not.toHaveBeenCalled();
    });

    // A verdict is worth more than the interactions around it, and on a phone the page can be killed without any
    // exit event firing (#5561), so Label.validate() asks for the flush now rather than at the deadline.
    describe('flushSoon() (issue #5561)', () => {
        const VERDICT_FLUSH_DELAY_MS = 1000;

        test('sends the buffer about a second later instead of at the 60 s deadline', () => {
            tracker.push('ValidationButtonClick_Agree');
            tracker.flushSoon();

            jest.advanceTimersByTime(VERDICT_FLUSH_DELAY_MS - 1);
            expect(form.submit).not.toHaveBeenCalled();

            jest.advanceTimersByTime(1);
            expect(form.submit).toHaveBeenCalledTimes(1);
            expect(form.submit).toHaveBeenCalledWith(compiledPayload, true);
        });

        test('a quick run of verdicts becomes one flush, timed from the last of them', () => {
            tracker.push('ValidationButtonClick_Agree');
            tracker.flushSoon();
            jest.advanceTimersByTime(VERDICT_FLUSH_DELAY_MS / 2);
            tracker.push('ValidationButtonClick_Disagree');
            tracker.flushSoon();

            jest.advanceTimersByTime(VERDICT_FLUSH_DELAY_MS - 1);
            expect(form.submit).not.toHaveBeenCalled();

            jest.advanceTimersByTime(1);
            expect(form.submit).toHaveBeenCalledTimes(1);
        });

        test('replaces the pending deadline rather than adding a second flush after it', () => {
            tracker.push('ValidationButtonClick_Agree');
            tracker.flushSoon();
            jest.advanceTimersByTime(VERDICT_FLUSH_DELAY_MS);
            expect(form.submit).toHaveBeenCalledTimes(1);

            // Only the post-flush marker is buffered now; the original 60 s deadline must not fire on it.
            jest.advanceTimersByTime(10 * 60 * 1000);
            expect(form.submit).toHaveBeenCalledTimes(1);
        });

        test('an external drain in the meantime cancels it', () => {
            tracker.push('ValidationButtonClick_Agree');
            tracker.flushSoon();
            tracker.refresh(); // Mission complete or pagehide got there first.

            jest.advanceTimersByTime(10 * 60 * 1000);
            expect(form.submit).not.toHaveBeenCalled();
        });

        test('the next push after it arms an ordinary deadline again', () => {
            tracker.push('ValidationButtonClick_Agree');
            tracker.flushSoon();
            jest.advanceTimersByTime(VERDICT_FLUSH_DELAY_MS);

            tracker.push('LowLevelEvent_mousemove');
            jest.advanceTimersByTime(FLUSH_INTERVAL_MS - 1);
            expect(form.submit).toHaveBeenCalledTimes(1);
            jest.advanceTimersByTime(1);
            expect(form.submit).toHaveBeenCalledTimes(2);
        });
    });

    test('an external drain (mission complete / pagehide) cancels the pending deadline', () => {
        tracker.push('ValidationButtonClick_Agree');
        jest.advanceTimersByTime(FLUSH_INTERVAL_MS / 2);

        // Both the mission-complete submit and the pagehide handler drain via compileSubmissionData -> refresh().
        tracker.refresh();

        jest.advanceTimersByTime(10 * 60 * 1000);
        expect(form.submit).not.toHaveBeenCalled();
    });

    test('the action-count backstop still flushes immediately and cancels the pending deadline', () => {
        for (let i = 0; i < 201; i++) {
            tracker.push('LowLevelEvent_mousemove');
        }

        expect(form.compileSubmissionData).toHaveBeenCalledTimes(1);
        expect(form.submit).toHaveBeenCalledTimes(1);
        expect(form.submit).toHaveBeenCalledWith(compiledPayload, true);

        // The deadline armed by the first push must not produce a second, near-empty flush.
        jest.advanceTimersByTime(10 * 60 * 1000);
        expect(form.submit).toHaveBeenCalledTimes(1);
    });

    test('the next push after a drain arms a fresh deadline', () => {
        tracker.push('ValidationButtonClick_Agree');
        jest.advanceTimersByTime(FLUSH_INTERVAL_MS);
        expect(form.submit).toHaveBeenCalledTimes(1);

        tracker.push('ValidationButtonClick_Disagree');
        jest.advanceTimersByTime(FLUSH_INTERVAL_MS);
        expect(form.submit).toHaveBeenCalledTimes(2);
    });

    test('a >1h gap between pushes does not reload the page', () => {
        tracker.push('ValidationButtonClick_Agree');
        jest.setSystemTime(1_000_000 + 2 * 60 * 60 * 1000);
        tracker.push('ValidationButtonClick_Disagree');

        expect(reloadAttempts()).toHaveLength(0);
    });

    test('a deadline firing before init finishes is a no-op that self-heals on the next push', () => {
        tracker = new Tracker(); // No Form has registered a flush yet.

        tracker.push('ValidationButtonClick_Agree');
        expect(() => jest.advanceTimersByTime(FLUSH_INTERVAL_MS)).not.toThrow();

        // Once init has finished, the next push re-arms and the flush goes through.
        tracker.onFlush(() => form.submit(form.compileSubmissionData(false), true));
        tracker.push('ValidationButtonClick_Disagree');
        jest.advanceTimersByTime(FLUSH_INTERVAL_MS);

        expect(form.submit).toHaveBeenCalledTimes(1);
        expect(form.submit).toHaveBeenCalledWith(compiledPayload, true);
    });
});

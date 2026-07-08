/**
 * Tests for public/js/SVValidate/src/data/Form.js `submit()`.
 *
 * Pins the resilience contract introduced for issue #2745: a failed data POST must NOT reload the page (a reload
 * mid-mission reset the user to the first validation and, when it looped, produced the browser's "A problem
 * repeatedly occurred" crash page). Instead a failed submit retries the same snapshot, and an error thrown while
 * applying the response is logged but never retried (the data already reached the server).
 *
 * Runs under jsdom (jest.config.js sets testEnvironment) so window/document exist.
 */

const fs = require('fs');
const path = require('path');

const FORM_PATH = path.resolve(__dirname, '..', '..', 'public/js/SVValidate/src/data/Form.js');

/**
 * Load the `Form` class out of the production file. Unlike the api-docs preview modules, Form.js is a bare
 * `class Form {}` that the Grunt bundle simply concatenates into the page scope (it does not assign to `window`), so
 * we wrap the source in an IIFE that returns the class rather than relying on a global assignment. String
 * concatenation (not a template literal) is used so the backticks inside Form.js aren't reinterpreted.
 * @returns {Function} The Form class.
 */
function loadFormClass() {
    const src = fs.readFileSync(FORM_PATH, 'utf8');
    return (0, eval)('(() => {\n' + src + '\nreturn Form;\n})()');
}

const Form = loadFormClass();

/** Stub `fetch` to resolve with the given JSON body and an OK status. */
function stubFetchOk(body) {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }));
}

describe('Form.submit (issue #2745 resilience)', () => {
    let form;

    beforeEach(() => {
        jest.useFakeTimers();

        // Minimal svv surface that submit() touches.
        global.svv = {
            tracker: { push: jest.fn() },
            missionContainer: { createAMission: jest.fn() },
            labelContainer: {
                resetLabelList: jest.fn(),
                renderCurrentLabel: jest.fn(() => Promise.resolve())
            },
            modalMissionComplete: { nextMissionLoaded: jest.fn(), hide: jest.fn() },
            modalNoNewMission: { show: jest.fn() }
        };

        // jsdom's location.reload can't be called/spied directly, so replace location with a stub we can assert on.
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { reload: jest.fn(), replace: jest.fn(), href: '' }
        });

        form = new Form('/validationTask');
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        delete global.fetch;
        delete global.svv;
    });

    test('a failed POST retries the same snapshot instead of reloading the page', async () => {
        const payload = { validations: [{ label_id: 1 }] };
        global.fetch = jest.fn(() => Promise.reject(new Error('network down')));

        await form.submit(payload);

        // The page must never reload, and the first attempt is logged as a failure.
        expect(window.location.reload).not.toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(svv.tracker.push).toHaveBeenCalledWith('SubmitFailed', expect.objectContaining({ attempt: 0 }));

        // The retry fires after the backoff and resends the exact same snapshot.
        await jest.advanceTimersByTimeAsync(2000);
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(global.fetch).toHaveBeenLastCalledWith('/validationTask', expect.objectContaining({
            body: JSON.stringify(payload)
        }));
    });

    test('a non-OK HTTP response is treated as a failure and retried, not reloaded', async () => {
        global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }));

        await form.submit({});

        expect(window.location.reload).not.toHaveBeenCalled();
        expect(svv.tracker.push).toHaveBeenCalledWith('SubmitFailed', expect.anything());
    });

    test('gives up after the retry cap without ever reloading', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('down')));

        await form.submit({});
        // Initial attempt + 5 retries (backoff 2000 * attempt#): 2000+4000+6000+8000+10000 = 30000ms.
        await jest.advanceTimersByTimeAsync(30100);

        expect(global.fetch).toHaveBeenCalledTimes(6);
        expect(svv.tracker.push).toHaveBeenCalledWith('SubmitFailedGaveUp', expect.anything());
        expect(window.location.reload).not.toHaveBeenCalled();
    });

    test('an error while applying the response is logged but not retried or reloaded', async () => {
        stubFetchOk({ has_mission_available: true, mission: { mission_id: 1 }, progress: {}, labels: [] });
        svv.missionContainer.createAMission = jest.fn(() => { throw new Error('render boom'); });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        await form.submit({});

        expect(errorSpy).toHaveBeenCalled();
        expect(window.location.reload).not.toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalledTimes(1); // response handling errors must not resubmit
    });

    test('an intermediate (mid-mission) submit skips mission-transition handling', async () => {
        // has_mission_available:false would normally pop the "no new mission" modal; an intermediate flush must not.
        stubFetchOk({ has_mission_available: false });

        await form.submit({}, true);

        expect(svv.modalNoNewMission.show).not.toHaveBeenCalled();
        expect(svv.missionContainer.createAMission).not.toHaveBeenCalled();
    });

    test('a successful mission-complete submit loads the next mission', async () => {
        stubFetchOk({
            has_mission_available: true,
            mission: { mission_id: 2 },
            progress: { agree_count: 1 },
            labels: [{ label_id: 9 }]
        });

        await form.submit({});

        expect(svv.missionContainer.createAMission).toHaveBeenCalledWith({ mission_id: 2 }, { agree_count: 1 });
        expect(svv.labelContainer.resetLabelList).toHaveBeenCalledWith([{ label_id: 9 }]);
        expect(svv.modalMissionComplete.nextMissionLoaded).toHaveBeenCalled();
        expect(window.location.reload).not.toHaveBeenCalled();
    });

    test('a successful submit schedules no retry', async () => {
        stubFetchOk({ has_mission_available: true, mission: { mission_id: 3 }, progress: {}, labels: [] });

        await form.submit({});
        await jest.advanceTimersByTimeAsync(60000); // let any erroneously-scheduled retry fire

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(svv.tracker.push).not.toHaveBeenCalledWith('SubmitFailed', expect.anything());
    });

    test('an unparseable response body is treated as a transient failure and retried', async () => {
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON'))
        }));

        await form.submit({});

        expect(window.location.reload).not.toHaveBeenCalled();
        expect(svv.tracker.push).toHaveBeenCalledWith('SubmitFailed', expect.objectContaining({ attempt: 0 }));
        await jest.advanceTimersByTimeAsync(2000);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('a non-intermediate submit with no mission available shows the no-new-mission modal', async () => {
        stubFetchOk({ has_mission_available: false });

        await form.submit({});

        expect(svv.modalMissionComplete.hide).toHaveBeenCalled();
        expect(svv.modalNoNewMission.show).toHaveBeenCalled();
    });

    test('a mission-available response with a null mission is a no-op (mid-mission flush shape)', async () => {
        // The server returns has_mission_available:true with mission:null while a mission is still in progress; the
        // handler must not try to create a mission or pop the no-new-mission modal.
        stubFetchOk({ has_mission_available: true, mission: null });

        await form.submit({});

        expect(svv.missionContainer.createAMission).not.toHaveBeenCalled();
        expect(svv.modalNoNewMission.show).not.toHaveBeenCalled();
        expect(window.location.reload).not.toHaveBeenCalled();
    });

    test('sends a JSON POST to the configured URL', async () => {
        stubFetchOk({ has_mission_available: true, mission: null });
        const payload = { validations: [{ label_id: 7 }] };

        await form.submit(payload);

        expect(global.fetch).toHaveBeenCalledWith('/validationTask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(payload)
        });
    });

    test('never rejects, even when every attempt fails (callers do not catch)', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('down')));

        await expect(form.submit({})).resolves.toBeUndefined();
        // Flush all scheduled retries; a rejection from any of them would surface as an unhandled rejection.
        await jest.advanceTimersByTimeAsync(60000);
    });

    test('retries back off linearly (2s, then 4s, then 6s)', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('down')));

        await form.submit({});
        expect(global.fetch).toHaveBeenCalledTimes(1);

        // Retry 1 is scheduled 2000ms after the initial failure...
        await jest.advanceTimersByTimeAsync(1999);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(global.fetch).toHaveBeenCalledTimes(2);

        // ...retry 2 comes 4000ms after retry 1...
        await jest.advanceTimersByTimeAsync(3999);
        expect(global.fetch).toHaveBeenCalledTimes(2);
        await jest.advanceTimersByTimeAsync(1);
        expect(global.fetch).toHaveBeenCalledTimes(3);

        // ...and retry 3 comes 6000ms after retry 2.
        await jest.advanceTimersByTimeAsync(5999);
        expect(global.fetch).toHaveBeenCalledTimes(3);
        await jest.advanceTimersByTimeAsync(1);
        expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    test('logs increasing attempt numbers, gives up with the final count, and never retries again', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('down')));

        await form.submit({});
        await jest.advanceTimersByTimeAsync(30100); // 2+4+6+8+10s of backoff exhausts the 5 retries

        for (let attempt = 0; attempt <= 5; attempt++) {
            expect(svv.tracker.push).toHaveBeenCalledWith('SubmitFailed', expect.objectContaining({ attempt }));
        }
        expect(svv.tracker.push).toHaveBeenCalledWith('SubmitFailedGaveUp', { attempts: 5 });

        // Once it has given up, no further attempt may ever fire.
        await jest.advanceTimersByTimeAsync(600000);
        expect(global.fetch).toHaveBeenCalledTimes(6);
    });

    test('a submit that fails once still completes the mission transition after a successful retry', async () => {
        let calls = 0;
        global.fetch = jest.fn(() => {
            calls += 1;
            if (calls === 1) return Promise.reject(new Error('blip'));
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    has_mission_available: true,
                    mission: { mission_id: 4 },
                    progress: {},
                    labels: []
                })
            });
        });

        await form.submit({});
        await jest.advanceTimersByTimeAsync(2000);

        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(svv.missionContainer.createAMission).toHaveBeenCalledWith({ mission_id: 4 }, {});
        expect(svv.modalMissionComplete.nextMissionLoaded).toHaveBeenCalled();
        expect(svv.tracker.push).not.toHaveBeenCalledWith('SubmitFailedGaveUp', expect.anything());
    });

    test('a rejected renderCurrentLabel is logged but never retried or reloaded', async () => {
        stubFetchOk({ has_mission_available: true, mission: { mission_id: 1 }, progress: {}, labels: [] });
        svv.labelContainer.renderCurrentLabel = jest.fn(() => Promise.reject(new Error('render failed')));
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        await form.submit({});
        await jest.advanceTimersByTimeAsync(60000);

        expect(errorSpy).toHaveBeenCalled();
        expect(svv.modalMissionComplete.nextMissionLoaded).not.toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(window.location.reload).not.toHaveBeenCalled();
    });

    test('a failed submit still retries (and gives up) cleanly when the tracker is unavailable', async () => {
        svv.tracker = undefined; // e.g. a failure before the tracker finished initializing
        global.fetch = jest.fn(() => Promise.reject(new Error('down')));

        await expect(form.submit({})).resolves.toBeUndefined();
        await jest.advanceTimersByTimeAsync(30100);

        expect(global.fetch).toHaveBeenCalledTimes(6);
        expect(window.location.reload).not.toHaveBeenCalled();
    });

    test('a failed intermediate submit stays intermediate across retries (never loads a mission)', async () => {
        let calls = 0;
        // Fail the first attempt, then succeed with a response that WOULD trigger mission handling if not intermediate.
        global.fetch = jest.fn(() => {
            calls += 1;
            if (calls === 1) return Promise.reject(new Error('blip'));
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ has_mission_available: false })
            });
        });

        await form.submit({}, true);
        await jest.advanceTimersByTimeAsync(2000);

        expect(global.fetch).toHaveBeenCalledTimes(2);
        // Even though the retry succeeded with has_mission_available:false, the intermediate flag must persist so the
        // "no new mission" modal is never shown mid-mission.
        expect(svv.modalNoNewMission.show).not.toHaveBeenCalled();
    });
});

/**
 * What Explore does differently on a route walk now that a route may run through several neighborhoods (#3488).
 *
 * Three small contracts, each a line or two of production code that nothing else exercises:
 *   - the earlier-labels fetch names the walk, so the server can gather labels from every region the route touches
 *     rather than from the page's region alone;
 *   - a submission on a walk never asks for the region's live street priorities, since the route's next street is
 *     fixed by its walking order;
 *   - a priority refresh that names a street this page has no task for is skipped, not applied to `_tasks[-1]`.
 *
 * LabelContainer, Form and TaskContainer are loaded as modules and built against the fewest collaborators each needs.
 */

import { loadModules, stubUtil } from './loadGlobalScript.js';
import { fakeTracker } from './fakes.js';


/** Stubs fetch to answer every request with `body`, and returns the mock so the URL it was called with can be read. */
function fetchAnswering(body) {
    window.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => body }));
    return window.fetch;
}

/** Lets the promise chain behind a fetch settle before asserting on its side effects. */
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('LabelContainer.fetchLabelsToResumeMission', () => {
    let container;

    beforeEach(async () => {
        Object.assign(window, await loadModules('frontend/js/explore/label/LabelContainer.js'));
        container = new window.LabelContainer(1, {}, {}, {}, {}, { on: vi.fn() }, {}, { get: () => null }, {},
            fakeTracker());
    });

    it('names the route walk so the server gathers labels from every region it runs through', async () => {
        const fetch = fetchAnswering({ labels: [] });
        const callback = vi.fn();

        container.fetchLabelsToResumeMission(7, 42, callback);
        await flushPromises();

        const url = new URL(fetch.mock.calls[0][0], 'http://localhost');
        expect(url.pathname).toBe('/label/resumeMission');
        expect(url.searchParams.get('regionId')).toBe('7');
        expect(url.searchParams.get('userRouteId')).toBe('42');
        expect(callback).toHaveBeenCalledWith({ labels: [] });
    });

    it('asks for the region alone when the user is not on a walk', async () => {
        const fetch = fetchAnswering({ labels: [] });

        container.fetchLabelsToResumeMission(7, null);
        await flushPromises();

        const url = new URL(fetch.mock.calls[0][0], 'http://localhost');
        expect(url.searchParams.get('regionId')).toBe('7');
        expect(url.searchParams.has('userRouteId')).toBe(false);
    });
});

describe('Form.submitData street-priority refresh on a route walk', () => {
    /** A task most of the way down its street, past the 60% mark at which a region audit asks for fresh priorities. */
    function nearlyDoneTask() {
        return {
            getAuditTaskId: () => 12,
            getStreetEdgeId: () => 34,
            getProperty: () => null,
            isComplete: () => false,
            getMissionStart: () => null,
            getAuditedDistance: () => 0.9,
            lineDistance: () => 1,
            setProperty: vi.fn(),
        };
    }

    /** Builds a Form with no labels or panos staged, posting to a fetch that records each request body. */
    async function buildForm(userRouteId) {
        Object.assign(window, await loadModules('frontend/js/explore/data/Form.js'));
        const missionProps = { missionId: 5, distanceProgress: 0, distance: 100, isComplete: false, skipped: false };
        const mission = { getProperty: (k) => missionProps[k] };
        return new window.Form(
            '/task',
            { userRouteId, regionId: 1, isOnboarding: false, isExploreAddressMode: false },
            { getLabelsToLog: () => [], clearLabelsToLog: vi.fn(), getAllLabels: () => [] }, // labelContainer
            { on: vi.fn() }, // missionModel
            { getCurrentMission: () => mission, updateDistanceProgress: vi.fn() }, // missionContainer
            { getStagedPanoData: () => [], getPanoData: () => null }, // panoStore
            { getCurrentTask: nearlyDoneTask, updateTaskPriorities: vi.fn(), onTaskEnded: vi.fn(), onTaskLeft: vi.fn() },
            { getPosition: () => ({ lat: 41.85, lng: -87.65 }) }, // panoManager
            { getActions: () => [], refresh: vi.fn(), push: vi.fn(), setAuditTaskID: vi.fn() }, // tracker
        );
    }

    /** Submits once and returns the `audit_task` block of the request body the server would have received. */
    async function submittedAuditTask(userRouteId) {
        const bodies = [];
        window.fetch = vi.fn((url, opts) => {
            bodies.push(JSON.parse(opts.body));
            return Promise.resolve({
                ok: true,
                json: async () => ({ audit_task_id: 12, label_ids: [], refresh_page: false }),
            });
        });
        await (await buildForm(userRouteId)).submitData(nearlyDoneTask());
        return bodies[0].audit_task;
    }

    beforeEach(() => {
        window.AsyncLock = class { async acquire(key, fn) { return fn(); } };
        stubUtil({
            getBrowser: () => 'chrome',
            getBrowserVersion: () => '1',
            getOperatingSystem: () => 'linux',
            math: { kmsToMeters: (km) => km * 1000 },
            pano: { TUTORIAL_PANO_IDS: new Set(['tutorial', 'afterWalkTutorial']) },
        });
        window.i18next = { language: 'en' };
    });

    it('asks for fresh priorities on a region audit once most of the street is walked', async () => {
        expect((await submittedAuditTask(null)).request_updated_street_priority).toBe(true);
    });

    it('never asks for them on a route walk, whose next street is fixed by the route', async () => {
        expect((await submittedAuditTask(42)).request_updated_street_priority).toBe(false);
    });
});

describe('TaskContainer.updateTaskPriorities', () => {
    /** A loaded task, remembering what priority it was set to. */
    const makeTask = (streetEdgeId) => ({
        getStreetEdgeId: () => streetEdgeId,
        setProperty: vi.fn(),
    });

    let container;

    beforeEach(async () => {
        Object.assign(window, await loadModules('frontend/js/explore/task/TaskContainer.js'));
        const initialTask = {
            getAuditTaskId: () => null, isResumed: () => false, cameFromTaskList: () => false, getProperty: () => false,
        };
        container = new window.TaskContainer(initialTask, {}, { isRoute: true }, {}, {}, {}, fakeTracker());
    });

    it('applies a new priority to the task that street belongs to', () => {
        const [a, b] = [makeTask(101), makeTask(102)];
        container._tasks = [a, b];

        container.updateTaskPriorities([{ street_edge_id: 102, priority: 0.25 }]);

        expect(b.setProperty).toHaveBeenCalledWith('priority', 0.25);
        expect(a.setProperty).not.toHaveBeenCalled();
    });

    it('skips a street it has no task for instead of writing the priority onto the last task', () => {
        // The server reports every street of the region whose priority changed, and a route walk only loads the
        // route's streets, so another user's audit of an off-route street names an id this page never saw. With
        // findIndex that was -1, and `_tasks[-1]` threw on every such refresh.
        const last = makeTask(101);
        container._tasks = [makeTask(100), last];

        expect(() => container.updateTaskPriorities([{ street_edge_id: 999, priority: 0.5 }])).not.toThrow();
        expect(last.setProperty).not.toHaveBeenCalled();
    });
});

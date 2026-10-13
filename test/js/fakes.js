/**
 * The collaborators the Explore, Validate and Gallery suites hand a constructor when they are not what is under test
 * (#5649). One place to edit when a constructor's contract changes, instead of the same literal in every suite. Each
 * takes overrides, so a suite that needs one method to answer differently keeps the rest.
 */

/**
 * A `common/Gate` that holds nothing: every call is a spy, every question answers "not held".
 * @param {object} [overrides] - Members to replace, e.g. `{ isHeld: () => true }`.
 * @returns {object} The gate.
 */
export function fakeGate(overrides = {}) {
    return {
        hold: vi.fn(),
        release: vi.fn(),
        isHeld: () => false,
        isHeldExcept: () => false,
        onChanged: vi.fn(),
        ...overrides,
    };
}

/**
 * A Tracker (Explore's or Validate's) that records nothing: `push` and the rest are spies a suite can assert on.
 * @param {object} [overrides] - Members to replace.
 * @returns {object} The tracker.
 */
export function fakeTracker(overrides = {}) {
    return {
        push: vi.fn(),
        setAuditTaskID: vi.fn(),
        trackPano: vi.fn(),
        getActions: () => [],
        refresh: vi.fn(),
        ...overrides,
    };
}

/**
 * An `explore/task/TaskContainer` whose current task is whatever the given function answers, read on every call, so a
 * suite can move the labeler to another street by reassigning a variable.
 * @param {() => object} [getCurrentTask] - What `getCurrentTask` answers.
 * @param {object} [overrides] - Members to add or replace.
 * @returns {object} The task container.
 */
export function fakeTaskContainer(getCurrentTask = () => null, overrides = {}) {
    return {
        getCurrentTask,
        onCurrentTaskChanged: vi.fn(),
        ...overrides,
    };
}

/**
 * An `explore/panorama/PanoManager` that answers for the given viewer and takes listeners without calling them.
 * @param {object} [viewer] - What `panoViewer` is, and where the pano id, position and POV come from.
 * @param {object} [overrides] - Members to add or replace.
 * @returns {object} The pano manager.
 */
export function fakePanoManager(viewer = {}, overrides = {}) {
    return {
        get panoViewer() { return viewer; },
        getPanoId: () => viewer.getPanoId?.(),
        getPosition: () => viewer.getPosition?.(),
        getPov: () => viewer.getPov?.(),
        onPovChanged: vi.fn(),
        onPanoChanged: vi.fn(),
        ...overrides,
    };
}

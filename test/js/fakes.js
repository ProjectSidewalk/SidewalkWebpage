/**
 * The collaborators the Explore, Validate and Gallery suites hand a constructor when they are not what is under test
 * (#5649). One place to edit when a constructor's contract changes, instead of the same literal in every suite. Each
 * takes overrides, so a suite that needs one method to answer differently keeps the rest.
 */

import { mockModule } from './loader.js';

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
        onChanged: vi.fn(),
        ...overrides,
    };
}

/**
 * Counts the page navigations jsdom refuses (a `location.reload()`, say). jsdom reports them only on its own virtual
 * console, never through `console.error`, so a spy there would miss every one.
 * @returns {import('vitest').Mock} Called once per attempt with jsdom's error.
 */
export function navigationAttempts() {
    const attempts = vi.fn();
    window._settings.virtualConsole.on('jsdomError', (error) => {
        if (error.message.includes('Not implemented: navigation')) attempts(error);
    });
    return attempts;
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
        trackMissions: vi.fn(),
        flushSoon: vi.fn(),
        onFlush: vi.fn(),
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

/**
 * Replaces the pano area's overlays, `createPanoViewerLogo` and `createPanoAttribution`, for whatever loads next: the
 * real logo watches its holder with a ResizeObserver, which jsdom lacks. Every method is a spy, so a suite can read
 * what the subject told each overlay. Call it again (in a `beforeEach`, say) for a fresh pair.
 * @returns {{logo: object, attribution: object, createPanoViewerLogo: Function, createPanoAttribution: Function}}
 *   The overlays the subject is handed, and the factories it gets them from.
 */
export function fakePanoOverlays() {
    const logo = { showPrimaryLogo: vi.fn(), showSourceLogo: vi.fn(), hide: vi.fn() };
    const attribution = { show: vi.fn(), hide: vi.fn() };
    const createPanoViewerLogo = vi.fn(() => logo);
    const createPanoAttribution = vi.fn(() => attribution);
    mockModule('frontend/js/common/pano-viewer/PanoViewerLogo.js', () => ({ createPanoViewerLogo }));
    mockModule('frontend/js/common/pano-viewer/PanoAttribution.js', () => ({ createPanoAttribution }));
    return { logo, attribution, createPanoViewerLogo, createPanoAttribution };
}

/**
 * Replaces what a LabelDetail card builds for itself and a suite of the card never exercises: the badge tracker, the
 * hide toggle, the story section, the pano info popover, and the popup pano manager, whose `create` answers with
 * whatever the given function returns, read when the card asks so a suite can rebuild it per test.
 * @param {() => object} getPanoManager - The pano manager the card is handed.
 */
export function mockLabelDetailCollaborators(getPanoManager) {
    mockModule('frontend/js/common/BadgeAchievements.js',
        () => ({ BadgeAchievements: { seedCounts() {}, recordValidation() {} } }));
    mockModule('frontend/js/common/LabelVisibilityToggle.js', () => ({ LabelVisibilityToggle: class {} }));
    mockModule('frontend/js/common/label-detail/PopupPanoManager.js',
        () => ({ PopupPanoManager: { create: async () => getPanoManager() } }));
    mockModule('frontend/js/common/label-detail/StorySection.js', () => ({ StorySection: class { setLabel() {} } }));
    mockModule('frontend/js/common/pano-viewer/PanoInfoPopover.js', () => ({ PanoInfoPopover: class {} }));
}

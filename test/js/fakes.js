/**
 * The collaborators the suites hand a constructor when they are not what is under test (#5649). One place to edit when
 * a constructor's contract changes, instead of the same literal in every suite. Each takes overrides, so a suite that
 * needs one method to answer differently keeps the rest.
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
  // jsdom keeps the console it was built with on the window's settings, with no public way at it from a page.
  const virtualConsole = window._settings?.virtualConsole;
  if (!virtualConsole) throw new Error('this jsdom keeps its virtual console elsewhere than window._settings');
  virtualConsole.on('jsdomError', (error) => {
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
    getPanoId: () => viewer.getPanoId(),
    getPosition: () => viewer.getPosition(),
    getPov: () => viewer.getPov(),
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
  // The real popover appends its (i) trigger into the host span, which the card's Details chip forwards clicks to.
  mockModule('frontend/js/common/pano-viewer/PanoInfoPopover.js', () => ({
    PanoInfoPopover: class {
      /** @param {HTMLElement} host - The span the trigger goes in. */
      constructor(host) { host.append(document.createElement('img')); }
    },
  }));
}

/**
 * An in-memory `explore/data/Storage` TemporaryStorage, with its JSON round trip, so a suite can seed what a page
 * remembers and read back what it saved.
 * @param {object} [seed] - What is already remembered, by key.
 * @returns {{get: (key: string) => any, set: (key: string, value: any) => void}} The storage.
 */
export function fakeStorage(seed = {}) {
  const store = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    get: (key) => (store.has(key) ? JSON.parse(store.get(key)) : null),
    set: (key, value) => store.set(key, JSON.stringify(value)),
  };
}

/**
 * A CanvasRenderingContext2D that records every drawing call with the style in effect when it was made, for the
 * minimap overlays (the fog, the progress ring, the route inset), which jsdom's canvas can neither draw nor read back.
 * `calls` holds `{method, args, fillStyle, strokeStyle, lineWidth, op}` in order; `gradients` every radial gradient
 * created, with the color stops it was given.
 * @returns {object} The context.
 */
export function fakeCanvasCtx() {
  const ctx = { calls: [], gradients: [], globalCompositeOperation: 'source-over' };
  const methods = ['setTransform', 'fillRect', 'clearRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo',
    'lineTo', 'arc', 'fill', 'stroke', 'save', 'restore', 'translate', 'rotate', 'setLineDash'];
  for (const method of methods) {
    ctx[method] = (...args) => {
      ctx.calls.push({
        method, args, fillStyle: ctx.fillStyle, strokeStyle: ctx.strokeStyle, lineWidth: ctx.lineWidth,
        op: ctx.globalCompositeOperation,
      });
    };
  }
  ctx.createRadialGradient = (...args) => {
    const gradient = { args, stops: [], addColorStop: (offset, color) => gradient.stops.push([offset, color]) };
    ctx.gradients.push(gradient);
    return gradient;
  };
  /**
   * @param {string} method - A context method name.
   * @returns {object[]} The recorded calls to it, oldest first.
   */
  ctx.callsTo = (method) => ctx.calls.filter((call) => call.method === method);
  return ctx;
}

/**
 * A canvas element as the minimap overlays use one: a context, a displayed size, and a bitmap size they set. A plain
 * object, since jsdom's canvas has no 2D context.
 * @param {number} [clientWidth] - Displayed width in CSS px; 0 stands for a canvas not laid out yet.
 * @param {number} [clientHeight] - Displayed height in CSS px.
 * @returns {object} The canvas, with its context at `ctx`.
 */
export function fakeCanvas(clientWidth = 200, clientHeight = 200) {
  const ctx = fakeCanvasCtx();
  return {
    ctx,
    clientWidth,
    clientHeight,
    width: 0,
    height: 0,
    getContext: () => ctx,
    // Read when asked, so a test can resize the canvas between renders by setting clientWidth.
    getBoundingClientRect() {
      return { width: this.clientWidth, height: this.clientHeight };
    },
  };
}

/**
 * The `util` distance members as a metric reader sees them, for `useUtil`: the real ones need the i18next formatter
 * that AppManager registers, which a suite loading a page module on its own doesn't have.
 */
export const metricDistanceUtil = {
  isMetric: () => true,
  metersToLongDistance: (meters) => (meters || 0) / 1000,
  longDistanceToString: (km, precision = 0, withUnit = true) => {
    const number = (km || 0).toLocaleString('en', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
    return withUnit ? `${number} km` : number;
  },
  fineDistanceToString: (meters, precision = 0) => `${(meters || 0).toFixed(precision)} m`,
  unitWords: () => ({ unitAbbr: 'km', unitAbbrSmall: 'm', unitName: 'kilometers', unitNameSingular: 'kilometer' }),
};

/**
 * Shared setup for the tutorial suites (#5840). The tutorial's script (OnboardingStates) and the class that plays it
 * (Onboarding) are the real ones; everything they drive is a stand-in that records what it was told and lets a test
 * act as the labeler: pick a label type, place a label, rate it, tag it, turn, zoom, walk, press Ok.
 *
 * Google Maps' event bus is a small double, so a test can turn the camera and fire the pano's `pov_changed`. Floating
 * UI is a double that positions the callout once when it is attached; `world.floating.update()` runs it again. Label
 * is reduced to the two statics the tutorial calls, since drawing an icon and building a minimap marker are Label's
 * own business.
 *
 * SEVERITY and TAGS below hold each step's right answer, so a change to a step's answer in OnboardingStates.js
 * changes them too.
 */

import { loadModules, mockModule } from '../loader.js';
import { fakeGate, fakeTracker, navigationAttempts } from '../fakes.js';

/** What the doubles share with the test: reset by `setupOnboarding`, read and steered by the test. */
export const world = {};

mockModule('i18next', () => ({ default: { t: (key) => key } }));
mockModule('frontend/js/explore/label/Label.js', () => ({
  Label: {
    renderLabelIcon: (...args) => world.icons.push(args),
    createMinimapMarker: (minimap, labelType, latLng) => world.markers.push({ labelType, latLng }),
  },
}));
mockModule('@floating-ui/dom', () => ({
  // Runs one positioning pass at once, as autoUpdate does on attach, and records the teardown.
  autoUpdate: (reference, floating, update) => {
    world.floating = { reference, update, cleanup: vi.fn() };
    update();
    return world.floating.cleanup;
  },
  computePosition: (reference, floating, options) => {
    world.floating.options = options;
    return Promise.resolve({ x: 12, y: 34, placement: world.floatingPlacement ?? options.placement });
  },
  flip: (options) => ({ name: 'flip', options }),
  offset: (value) => ({ name: 'offset', value }),
  shift: (options) => ({ name: 'shift', options }),
  size: (options) => ({ name: 'size', options }),
}));

export const { Onboarding, OnboardingStates, util } = await loadModules(
  'frontend/js/explore/onboarding/Onboarding.js', 'frontend/js/explore/onboarding/OnboardingStates.js',
  'frontend/js/common/utilities.js',
);

/**
 * Each reload the tutorial asks for. jsdom can't navigate and `location` can't be stubbed, so a reload is counted as
 * jsdom refusing one. Its call history is emptied before each test.
 */
export const navigations = navigationAttempts();

/**
 * The right answer to each rating and tagging step, by the step's label number. The tutorial copy names them; the
 * script's transitions are what check them.
 */
export const SEVERITY = { 1: 2, 2: 1, 3: 2, 4: 2, 6: 1, 8: 1 };
export const TAGS = { 1: [2], 3: [23], 4: [5], 7: [20, 21] };

/** The parts of the Explore page the tutorial reaches for, by id, class, or the selectors its states name. */
const PAGE = `
  <button id="navbar-retake-tutorial-btn"></button>
  <div id="explore-sidebar">
    <div id="minimap-column"><div id="minimap-holder"></div></div>
    <div id="explore-control-stuck"></div>
  </div>
  <div id="street-view-holder">
    <canvas id="onboarding-canvas"></canvas>
    <div id="onboarding-holder"></div>
    <div id="onboarding-message-holder"></div>
    <div id="onboarding-background"></div>
    <div id="hand-gesture-holder" class="ps-hidden"></div>
    <div id="nav-arrows"></div>
    <div id="drawing-layer"></div>
    <div id="hover-card"></div>
    <div id="compass-message-holder"><div id="compass-message"></div></div>
    <div id="context-menu-holder">
      <div id="severity-menu">
        <input type="radio" name="severity" value="1"><input type="radio" name="severity" value="2">
        <input type="radio" name="severity" value="3">
      </div>
      <div id="context-menu-tag-section"><div id="context-menu-tag-holder"></div></div>
    </div>
  </div>
  <div class="label-type-button-holder" val="CurbRamp"></div>
  <template id="onboarding-outro">
    <video class="tutorial-complete__hero" data-poster="still.jpg"></video>
    <button type="button" class="motion-toggle" aria-pressed="false"></button>
    <button type="button" id="onboarding-ok-button">Start contributing</button>
  </template>`;

/** A 2D context double that records each call, and each property set as `['=', name, value]`, in `world.draws`. */
function fakeContext() {
  return new Proxy({}, {
    get: (target, key) => (key in target ? target[key] : (...args) => world.draws.push([key, ...args])),
    set: (target, key, value) => {
      target[key] = value;
      world.draws.push(['=', key, value]);
      return true;
    },
  });
}

/**
 * A placed label as the tutorial reads one.
 * @param {string} labelType
 * @param {{x: number, y: number}} panoXY - Where it landed on the pano image, in the image's own pixel units.
 * @returns {object} The label.
 */
export function fakeLabel(labelType, panoXY) {
  const properties = { panoXY, tagIds: [], povOfLabelIfCentered: { heading: 230, pitch: -6, zoom: 1 } };
  return {
    deleted: false,
    hoverInfo: 'hidden',
    getProperty: (key) => properties[key],
    setProperty: (key, value) => { properties[key] = value; },
    getLabelType: () => labelType,
    isDeleted() { return this.deleted; },
    getHoverInfoVisibility() { return this.hoverInfo; },
  };
}

/**
 * Builds the page and starts the tutorial.
 * @param {object} [options]
 * @param {boolean} [options.reducedMotion] - Whether the visitor asked for reduced motion.
 * @param {boolean} [options.start] - Whether to call `start()`, or leave that to the test.
 * @returns {{onboarding: Onboarding, c: object}} The tutorial and its collaborators.
 */
export function setupOnboarding({ reducedMotion = false, start = true } = {}) {
  for (const key of Object.keys(world)) delete world[key];
  Object.assign(world, { draws: [], icons: [], markers: [], povListeners: new Map(), now: 0 });
  document.body.innerHTML = PAGE;
  const byId = (id) => document.getElementById(id);

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(fakeContext);
  vi.spyOn(performance, 'now').mockImplementation(() => world.now);
  vi.stubGlobal('matchMedia', (query) => ({ matches: reducedMotion && query.includes('reduce') }));
  // Animation frames run only when the test calls `world.frame()`, so the blinking and the entrance are steppable.
  world.frames = new Map();
  let nextFrameId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    world.frames.set(nextFrameId, cb);
    return nextFrameId++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id) => world.frames.delete(id));
  world.frame = (ms = 16) => {
    world.now += ms;
    const due = [...world.frames.values()];
    world.frames.clear();
    due.forEach((cb) => cb(world.now));
  };
  world.resizeObservers = [];
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb) {
      this.cb = cb;
      world.resizeObservers.push(this);
    }

    observe(el) {
      this.target = el;
    }
  });
  vi.stubGlobal('google', {
    maps: {
      event: {
        addListener: (target, name, fn) => {
          const handle = { name };
          world.povListeners.set(handle, fn);
          return handle;
        },
        removeListener: (handle) => world.povListeners.delete(handle),
      },
    },
  });
  // jsdom has no media playback; `world.play` builds what play() settles with, at the moment it is called.
  world.play = () => Promise.resolve();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => world.play());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});

  // The listeners each collaborator was handed, so the test can play the labeler's side.
  const on = { labeled: [], modeChanged: [], zoomed: [], labelRemoved: [] };
  const subscribe = (list) => (listener) => {
    list.push(listener);
    return () => {
      const i = list.indexOf(listener);
      if (i !== -1) list.splice(i, 1);
    };
  };

  world.pov = { heading: 0, pitch: 0, zoom: 1 };
  const mission = { setProperty: vi.fn() };
  const c = {
    on,
    mission,
    minimap: {
      setBasemapVisible: vi.fn(), blinkMinimap: vi.fn(), stopBlinkingMinimap: vi.fn(), addMarker: vi.fn(),
    },
    panoManager: {
      panoViewer: { gsvPano: {} },
      getPov: () => ({ ...world.pov }),
      setPov: vi.fn((pov) => { world.pov = { ...pov }; }),
      setHeadingRange: vi.fn(),
    },
    navArrows: { showing: fakeGate(), show: vi.fn(), blink: vi.fn() },
    compass: {
      click: fakeGate(),
      hideMessage: vi.fn(),
      showMessage: vi.fn(),
      blink: vi.fn(),
      stopBlinking: vi.fn(),
      attachMessageClickHandler: vi.fn((fn) => { world.compassClick = fn; }),
      detachMessageClickHandler: vi.fn(),
      getCompassMessageHolder: () => ({ message: byId('compass-message') }),
      directionToImagePath: (direction) => `/img/${direction}.svg`,
    },
    navigationService: { walking: fakeGate(), moveToPano: vi.fn(() => Promise.resolve()) },
    missionContainer: { getCurrentMission: () => mission },
    labelContainer: {
      deleting: fakeGate(),
      getLatestLabel: () => world.label,
      onLabelRemoved: subscribe(on.labelRemoved),
    },
    observedArea: { resetCurrentPano: vi.fn() },
    form: { submitData: vi.fn(() => Promise.resolve()) },
    missionProgressBar: { update: vi.fn() },
    panoOverlayControls: { disableButtons: vi.fn(), blinkStuckButton: vi.fn(), stopBlinkingStuckButton: vi.fn() },
    labelModes: {
      switching: fakeGate(), enableMode: vi.fn(), disableMode: vi.fn(), onModeChanged: subscribe(on.modeChanged),
    },
    ribbon: { startBlinking: vi.fn(), stopBlinking: vi.fn() },
    canvas: { onLabeled: subscribe(on.labeled) },
    contextMenu: {
      isOpen: () => world.contextMenuOpen ?? false,
      getTargetLabel: () => world.label,
      hide: vi.fn(),
      disableRatingSeverity: vi.fn(),
      disableTagging: vi.fn(),
      enableRatingSeverityForTutorialLabel: vi.fn(),
      enableTaggingForTutorialLabel: vi.fn(),
    },
    zoomControl: {
      zoomInGate: fakeGate(),
      zoomOutGate: fakeGate(),
      blinkZoomIn: vi.fn(),
      blinkZoomOut: vi.fn(),
      stopBlinking: vi.fn(),
      onZoomed: subscribe(on.zoomed),
    },
    tracker: fakeTracker(),
  };

  const ui = {
    canvas: { drawingLayer: byId('drawing-layer'), hoverCard: byId('hover-card') },
    minimap: { holder: byId('minimap-holder') },
    streetview: { navArrows: byId('nav-arrows') },
    contextMenu: {
      holder: byId('context-menu-holder'),
      severityMenu: byId('severity-menu'),
      radioButtons: [...document.querySelectorAll('#severity-menu input')],
      tagSection: byId('context-menu-tag-section'),
      tagHolder: byId('context-menu-tag-holder'),
    },
    onboarding: {
      canvas: byId('onboarding-canvas'),
      holder: byId('onboarding-holder'),
      messageHolder: byId('onboarding-message-holder'),
      background: byId('onboarding-background'),
      handGestureHolder: byId('hand-gesture-holder'),
    },
  };
  c.ui = ui;
  c.frame = { width: 720, height: 480, iconRadius: 17 };
  c.states = new OnboardingStates(c.contextMenu, c.compass, c.panoManager, ui.minimap);

  const onboarding = new Onboarding(ui, c.frame, c.states, c.minimap, c.panoManager, c.navArrows, c.compass,
    c.navigationService, c.missionContainer, c.labelContainer, c.observedArea, c.form, c.missionProgressBar,
    c.panoOverlayControls, c.labelModes, c.ribbon, c.canvas, c.contextMenu, c.zoomControl, c.tracker);
  if (start) onboarding.start();
  return { onboarding, c };
}

/**
 * @param {object} c - The collaborators `setupOnboarding` returned.
 * @returns {string} The id of the state the tutorial is on, read from the last transition it logged.
 */
export function currentStep(c) {
  const transitions = c.tracker.push.mock.calls.filter(([name]) => name === 'Onboarding_Transition');
  return transitions.at(-1)?.[1].onboardingTransition;
}

/**
 * @param {object} c - The collaborators `setupOnboarding` returned.
 * @returns {object} The current state's script entry.
 */
export function currentState(c) {
  return c.states.get().find((state) => state.id === currentStep(c));
}

/**
 * Turns the camera, firing `pov_changed` the way the pano does.
 * @param {number} heading
 * @param {number} [pitch] - Defaults to the current pitch.
 */
export function turnTo(heading, pitch = world.pov.pitch) {
  world.pov = { ...world.pov, heading, pitch };
  [...world.povListeners.values()].forEach((fn) => fn());
}

/** Presses the message box's Ok button. */
export function pressOk() {
  document.getElementById('onboarding-ok-button').click();
}

/**
 * Picks a label type in the ribbon (or by its keyboard shortcut).
 * @param {object} c - The collaborators `setupOnboarding` returned.
 * @param {string} mode - A label type, or 'Walk'.
 */
export function selectMode(c, mode) {
  [...c.on.modeChanged].forEach((fn) => fn(mode));
}

/**
 * Places a label of the current step's type, on its target or a long way off.
 * @returns {object} The label.
 */
export function placeLabel(c, { accurate = true } = {}) {
  const props = currentState(c).properties[0];
  const offset = accurate ? 0 : props.tolerance * 2;
  const label = fakeLabel(props.labelType, {
    x: (props.imageX + offset) / Onboarding.TUTORIAL_PANO_SCALE_FACTOR,
    y: props.imageY / Onboarding.TUTORIAL_PANO_SCALE_FACTOR,
  });
  world.label = label;
  [...c.on.labeled].forEach((fn) => fn(label));
  return label;
}

/**
 * Deletes the label the step asked the labeler to remove.
 * @param {object} c - The collaborators `setupOnboarding` returned.
 */
export function deleteLabel(c) {
  world.label.deleted = true;
  [...c.on.labelRemoved].forEach((fn) => fn());
}

/**
 * Picks a rating in the context menu.
 * @param {number} severity - 1 to 3.
 */
export function rate(severity) {
  const radio = document.querySelector(`#severity-menu input[value="${severity}"]`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));
}

/**
 * Sets the label's tags, as the context menu does before it announces the change.
 * @param {number[]} tagIds
 */
export function tag(tagIds) {
  world.label.setProperty('tagIds', tagIds);
  document.getElementById('context-menu-tag-holder').dispatchEvent(new Event('tagIds-updated'));
}

/**
 * Zooms the pano in or out.
 * @param {object} c - The collaborators `setupOnboarding` returned.
 * @param {'in'|'out'} direction
 */
export function zoom(c, direction) {
  [...c.on.zoomed].forEach((fn) => fn(direction));
}

/** Waits out the promise chains a step started (the walk's move, the end's submit). */
export async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/**
 * Does whatever the current step asks, correctly, and returns the step it was on.
 * @returns {Promise<string>}
 */
export async function doStep(c) {
  const state = currentState(c);
  const props = Array.isArray(state.properties) ? state.properties[0] : state.properties;
  switch (props.action) {
    case 'Instruction':
      pressOk();
      break;
    case 'SelectLabelType':
    case 'RedoSelectLabelType':
      selectMode(c, props.labelType);
      break;
    case 'LabelAccessibilityAttribute':
      placeLabel(c);
      break;
    case 'RateSeverity':
    case 'RedoRateSeverity':
      rate(SEVERITY[props.labelNumber]);
      break;
    case 'AddTag':
    case 'RedoAddTag':
      tag(TAGS[props.labelNumber]);
      break;
    case 'AdjustHeadingAngle':
      turnTo(props.heading);
      break;
    case 'Zoom':
      zoom(c, props.type);
      break;
    case 'WalkTowards':
      world.compassClick();
      await flush();
      break;
    case 'DeleteAccessibilityAttribute':
      deleteLabel(c);
      break;
    default:
      throw new Error(`no way to do step ${state.id} (${props.action})`);
  }
  return state.id;
}

/**
 * Does correct steps until the tutorial reaches `stopAt`, or its end when none is given.
 * @param {object} c - The collaborators `setupOnboarding` returned.
 * @param {string} [stopAt] - The step to stop on.
 * @returns {Promise<string[]>} The ids of the steps done along the way.
 */
export async function playUntil(c, stopAt = 'end-onboarding') {
  const visited = [];
  for (let guard = 0; guard < 200; guard++) {
    if (currentStep(c) === stopAt) return visited;
    if (currentStep(c) === 'end-onboarding') break;
    visited.push(await doStep(c));
  }
  throw new Error(`never reached ${stopAt}; stopped at ${currentStep(c)}`);
}

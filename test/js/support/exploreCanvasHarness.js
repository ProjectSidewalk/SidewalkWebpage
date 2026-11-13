/**
 * Builds Explore's label canvas over fakes of everything it talks to (#5840), for the suites that drive it through
 * the pano's pointer events and the hover card. The pano layers are laid out at the logical 720x480 so a pointer
 * position is a canvas position, and jsdom's canvas, which has no 2D context, is given a recording one.
 */

import { mockModule } from '../loader.js';
import { makeRecordingCtx } from '../canvasCtxStub.js';
import { fakeGate, fakePanoManager, fakeTaskContainer, fakeTracker } from '../fakes.js';

/** @type {Array<object>} The share widgets built so far, newest last; emptied by `canvasPage`. */
export const shareWidgets = [];

/**
 * Replaces the canvas's share widget with a recorder and the Label class with one whose cursor is a token naming
 * the armed type, for whatever loads next.
 */
export function mockCanvasCollaborators() {
  mockModule('frontend/js/common/share/ShareWidget.js', () => ({
    ShareWidget: class {
      constructor(trigger, opts) {
        this.trigger = trigger;
        this.opts = opts;
        this.open = false;
        this.setTarget = vi.fn();
        this.close = vi.fn();
        shareWidgets.push(this);
      }

      isOpen() { return this.open; }
    },
  }));
  mockModule('frontend/js/explore/label/Label.js', () => ({
    Label: { CURSOR_ICON_SIZE: 38, getCursorImageUrl: (mode) => (mode === 'Walk' ? null : `cursor-${mode}`) },
  }));
}

/**
 * @param {object} [opts]
 * @param {string} [opts.labelType]
 * @param {string} [opts.panoId] - The pano the label was placed on.
 * @param {{x: number, y: number}} [opts.at] - Where it sits on the canvas; the pointer is on it within 15 px.
 * @param {boolean} [opts.deleted]
 * @param {object} [opts.props] - More properties, e.g. `{ labelId: 12, tagIds: [1] }`.
 * @returns {object} A label with the methods Canvas calls, remembering what it is told.
 */
export function makeLabel({ labelType = 'CurbRamp', panoId = 'pano1', at = { x: 100, y: 100 }, deleted = false,
  props = {} } = {}) {
  const all = { labelType, labelId: 'DefaultValue', tagIds: [], severity: null, description: '', tutorial: false,
    ...props };
  let hoverVisibility = 'hidden';
  let visibility = 'visible';
  return {
    className: 'Label',
    isOn: (x, y) => !deleted && Math.abs(x - at.x) <= 15 && Math.abs(y - at.y) <= 15,
    render: vi.fn(),
    isVisible: () => visibility === 'visible',
    isDeleted: () => deleted,
    getHoverInfoVisibility: () => hoverVisibility,
    setHoverInfoVisibility: (v) => { hoverVisibility = v; },
    setVisibility: vi.fn((v) => { visibility = v; }),
    getPanoId: () => panoId,
    getLabelType: () => labelType,
    getCanvasXY: () => at,
    getProperty: (key) => all[key],
    setProperty: vi.fn((key, value) => { all[key] = value; }),
  };
}

/** A rect of the given size at the page's origin, for the layers jsdom would otherwise measure as empty. */
const rectOf = (width, height) => () => ({ left: 0, top: 0, right: width, bottom: height, width, height });

/**
 * Lays out the pano's layers, the hover card and the pano viewer's canvas, and gives jsdom's canvases a 2D context.
 * @param {object} [opts]
 * @param {number} [opts.displayWidth=720] - How wide the pano shows on screen; 1440 is the tool at twice its size.
 * @param {boolean} [opts.withShare=true] - Whether the hover card has a share button.
 * @param {{width: number, height: number}} [opts.panoCanvas] - The pano viewer's bitmap size.
 * @returns {{ui: object, streetviewUi: object, ctx: object, holder: HTMLElement}} What Canvas is handed.
 */
export function canvasPage({ displayWidth = 720, withShare = true, panoCanvas = { width: 720, height: 480 } } = {}) {
  shareWidgets.length = 0;
  document.body.innerHTML = `
    <div id="svl-application-holder"><div id="street-view-holder">
      <div id="interaction-area-holder">
        <div id="view-control-layer"></div>
        <div id="label-drawing-layer"></div>
        <canvas id="label-canvas"></canvas>
        <canvas class="pano-canvas" width="${panoCanvas.width}" height="${panoCanvas.height}"></canvas>
      </div>
    </div></div>
    <div id="label-hover-card">
      <button id="hover-card-edit"></button><button id="hover-card-delete"></button>
      <div class="share">${withShare ? '<button id="hover-card-share"></button>' : ''}</div>
    </div>`;
  const displayHeight = displayWidth * 480 / 720;
  for (const id of ['view-control-layer', 'label-drawing-layer']) {
    document.getElementById(id).getBoundingClientRect = rectOf(displayWidth, displayHeight);
  }
  const ctx = Object.assign(makeRecordingCtx(), { clearRect: vi.fn(), setTransform: vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function dataUrl() {
    return `data:${this.width}x${this.height}`;
  });
  return {
    ui: {
      drawingLayer: document.getElementById('label-drawing-layer'),
      hoverCard: document.getElementById('label-hover-card'),
      hoverCardEdit: document.getElementById('hover-card-edit'),
      hoverCardDelete: document.getElementById('hover-card-delete'),
      hoverCardShare: document.getElementById('hover-card-share'),
    },
    streetviewUi: { viewControlLayer: document.getElementById('view-control-layer') },
    ctx,
    holder: document.getElementById('interaction-area-holder'),
  };
}

/**
 * The fakes Canvas is built over, each remembering the listeners it was handed so a suite can fire them.
 * @param {object} [opts]
 * @param {Array<object>} [opts.labels] - What the label container holds, read live.
 * @param {object} [opts.config] - Overrides for `{ isOnboarding: false, makeCrops: true }`.
 * @param {string} [opts.mode='Walk'] - The armed type.
 * @returns {object} The collaborators, by the names Canvas's constructor gives them, plus the fire helpers.
 */
export function canvasCollaborators({ labels = [], config = {}, mode = 'Walk' } = {}) {
  const listeners = { mode: [], pov: [], moveStarted: [], moveFinished: [], menuChange: [], placed: [], removed: [] };
  const take = (name) => vi.fn((listener) => listeners[name].push(listener));
  let pov = { heading: 90, pitch: -10, zoom: 1 };
  const panoViewer = {
    getPanoId: () => 'pano1',
    getPosition: () => ({ lat: 47.6, lng: -122.3 }),
    getPov: () => pov,
    getCanvasClass: () => 'pano-canvas',
  };
  const c = {
    config: { isOnboarding: false, makeCrops: true, ...config },
    frame: { width: 720, height: 480, iconRadius: 17, renderedHFov: () => 90 },
    labelCardView: { render: vi.fn() },
    labelModes: {
      onModeChanged: take('mode'),
      getMode: () => mode,
      getSelectedLabelType: () => (mode === 'Walk' ? undefined : mode),
      backToWalk: vi.fn(),
    },
    contextMenu: {
      onChange: take('menuChange'),
      show: vi.fn(),
      isOpen: () => false,
      getTargetLabel: () => null,
      labelTags: [
        { tag_id: 1, label_type: 'CurbRamp', tag: 'narrow' },
        { tag_id: 2, label_type: 'CurbRamp', tag: 'odd' },
      ],
    },
    labelContainer: {
      onLabelPlaced: take('placed'),
      onLabelRemoved: take('removed'),
      getCanvasLabels: () => labels,
      createLabel: vi.fn((params) => makeLabel({ labelType: params.labelType, props: params })),
      canDelete: () => true,
      removeLabel: vi.fn(),
    },
    missionContainer: { getCurrentMission: () => ({ getProperty: () => 7 }) },
    taskContainer: fakeTaskContainer(() => ({ getAuditTaskId: () => 9 })),
    panoManager: fakePanoManager(panoViewer, {
      onPovChanged: take('pov'),
      panning: fakeGate(),
      updatePov: vi.fn(),
    }),
    navigationService: { onMoveStarted: take('moveStarted'), onMoveFinished: take('moveFinished') },
    form: { submitData: vi.fn(async () => {}), ensureLabelSaved: vi.fn(async () => {}) },
    audioEffect: { load: vi.fn(), play: vi.fn() },
    tracker: fakeTracker(),
    /** Fires one of Canvas's subscriptions by name (a key of `listeners` above) with the given arguments. */
    fire: (name, ...args) => listeners[name].forEach((listener) => listener(...args)),
    setPov: (next) => { pov = next; },
    setMode: (next) => { mode = next; },
  };
  return c;
}

/**
 * @param {Function} Canvas - The class, loaded by the suite.
 * @param {object} page - From `canvasPage`.
 * @param {object} c - From `canvasCollaborators`.
 * @returns {object} The canvas.
 */
export function buildCanvas(Canvas, page, c) {
  return new Canvas(page.ui, page.streetviewUi, c.config, c.frame, c.labelCardView, c.labelModes, c.contextMenu,
    c.labelContainer, c.missionContainer, c.taskContainer, c.panoManager, c.navigationService, c.form,
    c.audioEffect, c.tracker);
}

/**
 * Sends a pointer event to a pano layer at an on-screen position.
 * @param {Element} el
 * @param {string} type - 'mousedown', 'mouseup', 'mousemove' or 'mouseleave'.
 * @param {number} [x]
 * @param {number} [y]
 */
export function pointer(el, type, x = 0, y = 0) {
  el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: type !== 'mouseleave' }));
}

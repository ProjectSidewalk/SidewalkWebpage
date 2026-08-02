/**
 * Tests for mark placement and editing in public/js/admin-dashboard/ExampleAnnotatorPage.js (#4723).
 *
 * The geometry here is the part that fails silently: a mark stores normalised coordinates, so a hit test measured in
 * the wrong space, or a whole-mark drag that shifts one endpoint further than the other, produces marks that still
 * render — just in the wrong place, on a photo nobody re-opens. Everything below is asserted on the stored manifest
 * rather than on the rendered SVG, because the manifest is what gets committed.
 *
 * Runs under jsdom (set in jest.config.js via testEnvironment).
 */

const fs = require('fs');
const path = require('path');
const { loadGlobalScript, REPO_ROOT } = require('./loadGlobalScript');

/** Photo box the stage is pretended to occupy; 3:2, matching the example aspect ratio. */
const BOX = { left: 0, top: 0, width: 600, height: 400 };

const FIXTURE = `
  <input type="radio" name="ex-source" value="tree" id="ex-source-tree-radio" checked>
  <input type="radio" name="ex-source" value="label" id="ex-source-label-radio">
  <div id="ex-source-tree-panel"><select id="ex-image-select"></select></div>
  <div id="ex-source-label-panel" hidden>
    <form id="ex-label-form"><input id="ex-label-id"></form>
    <span id="ex-label-msg"></span>
    <dl id="ex-label-meta"></dl>
    <div id="ex-destination-row">
      <select id="ex-destination"></select>
      <label id="ex-destination-custom-field"><input id="ex-destination-custom"></label>
      <select id="ex-format"><option value="webp">webp</option></select>
    </div>
    <p id="ex-destination-path"></p>
  </div>
  <select id="ex-mark-type"><option value="arrow">arrow</option><option value="marker">marker</option>
    <option value="extent">extent</option></select>
  <select id="ex-preview-size"><option value="0">full</option></select>
  <button id="ex-undo"></button><button id="ex-clear"></button><button id="ex-copy"></button>
  <button id="ex-download"></button><button id="ex-export"></button>
  <div id="ex-stage">
    <img id="ex-photo">
    <svg id="ex-marks"></svg>
    <svg id="ex-ghost"></svg>
  </div>
  <p id="ex-json"></p><p id="ex-status"></p><p id="ex-hint"></p>
`;

let page;

/** Loads a bare `class` declaration, which — unlike a function — never becomes a property of the global object. */
function loadClass(relativePath, name) {
  const source = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
  window.eval(`${source}\nwindow.${name} = ${name};`);
}

beforeAll(() => {
  global.i18next = { t: (key) => key };
  loadGlobalScript('public/js/common/utilitiesSidewalk.js');
});

beforeEach(() => {
  document.body.innerHTML = FIXTURE;
  loadClass('public/js/admin-dashboard/ExampleAnnotatorPage.js', 'ExampleAnnotatorPage');

  const photo = document.getElementById('ex-photo');
  photo.getBoundingClientRect = () => BOX;
  // jsdom loads no images, so the intrinsic size the aspect ratio is derived from has to be declared.
  Object.defineProperty(photo, 'naturalWidth', { value: 1440, configurable: true });
  Object.defineProperty(photo, 'naturalHeight', { value: 960, configurable: true });
  document.getElementById('ex-stage').setPointerCapture = () => {};

  page = new window.ExampleAnnotatorPage(['CurbRamp/severity-2.png'], {}, {});
  page.init();
});

/**
 * @param {string} type - `'pointerdown'`, `'pointermove'`, or `'pointerup'`.
 * @param {number} u - Fraction of the photo's width.
 * @param {number} v - Fraction of the photo's height.
 */
function fire(type, u, v) {
  // jsdom has no PointerEvent constructor; the handlers only read clientX/clientY/pointerId, which MouseEvent carries.
  // Rounded because jsdom coerces the coordinates to a long by truncation, so an unrounded 0.58 * 400 arrives as 231
  // rather than 232 and normalises back to 0.578. A real pointer reports device pixels; this matches that.
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: Math.round(BOX.left + u * BOX.width),
    clientY: Math.round(BOX.top + v * BOX.height),
  });
  event.pointerId = 1;
  document.getElementById('ex-stage').dispatchEvent(event);
}

/**
 * @param {number} u1 @param {number} v1 @param {number} u2 @param {number} v2
 */
function drag(u1, v1, u2, v2) {
  fire('pointerdown', u1, v1);
  fire('pointermove', u2, v2);
  fire('pointerup', u2, v2);
}

/** @returns {Array<object>} The marks currently stored for the loaded image. */
function marks() {
  return JSON.parse(document.getElementById('ex-json').textContent)['CurbRamp/severity-2']?.marks || [];
}

/** @param {string} type */
function setMarkType(type) {
  document.getElementById('ex-mark-type').value = type;
}

describe('placing a mark', () => {
  test('the arrow head lands on the first press, so the precise end is the one aimed by hand', () => {
    drag(0.30, 0.70, 0.10, 0.20);
    expect(marks()).toEqual([{ type: 'arrow', from: [0.1, 0.2], to: [0.3, 0.7] }]);
  });

  test('a press that barely moves is a stray click, not a zero-length mark', () => {
    drag(0.50, 0.50, 0.51, 0.51);
    expect(marks()).toEqual([]);
  });

  test('a marker is a single click and stores one point', () => {
    setMarkType('marker');
    fire('pointerdown', 0.42, 0.58);
    expect(marks()).toEqual([{ type: 'marker', at: [0.42, 0.58] }]);
  });

  test('the mark type is stored as chosen, so an extent is not silently filed as an arrow', () => {
    setMarkType('extent');
    drag(0.20, 0.80, 0.70, 0.80);
    expect(marks()[0].type).toBe('extent');
  });
});

describe('moving a placed mark', () => {
  beforeEach(() => {
    drag(0.30, 0.70, 0.10, 0.20); // from [0.1, 0.2] -> to [0.3, 0.7]
  });

  test('grabbing an end re-aims that end and leaves the other alone', () => {
    drag(0.30, 0.70, 0.60, 0.55);
    expect(marks()).toEqual([{ type: 'arrow', from: [0.1, 0.2], to: [0.6, 0.55] }]);
  });

  test('grabbing the body shifts both ends by the same delta, so length and angle survive', () => {
    const midpoint = [(0.1 + 0.3) / 2, (0.2 + 0.7) / 2];
    drag(midpoint[0], midpoint[1], midpoint[0] + 0.1, midpoint[1] + 0.05);
    expect(marks()).toEqual([{ type: 'arrow', from: [0.2, 0.25], to: [0.4, 0.75] }]);
  });

  test('a move edits the mark rather than adding one', () => {
    drag(0.30, 0.70, 0.60, 0.55);
    expect(marks()).toHaveLength(1);
  });

  test('a marker can be picked back up and dropped somewhere else', () => {
    document.getElementById('ex-clear').click();
    setMarkType('marker');
    fire('pointerdown', 0.40, 0.40);
    drag(0.40, 0.40, 0.65, 0.30);
    expect(marks()).toEqual([{ type: 'marker', at: [0.65, 0.3] }]);
  });

  test('the topmost mark is the one grabbed, matching what is drawn over what', () => {
    // Drawn well clear of the first arrow — starting a drag inside its grab radius would move it, not add a mark.
    drag(0.80, 0.30, 0.90, 0.10);
    drag(0.80, 0.30, 0.30, 0.70); // now both arrowheads sit on the same point
    drag(0.30, 0.70, 0.50, 0.50);
    expect(marks()[1].to).toEqual([0.5, 0.5]);
    expect(marks()[0].to).toEqual([0.3, 0.7]);
  });

  // The grab radius is a circle on screen, so on a 3:2 photo it spans 1.5x less of the width than of the height.
  // Measured in raw normalised units instead it would be an oval, reaching half again too far sideways — these two
  // cases are the same 0.035 offset from the same arrowhead and must come out differently.
  test('the same offset reaches the head vertically but not horizontally, since one unit of u is 1.5 of v', () => {
    drag(0.3, 0.735, 0.45, 0.45);
    expect(marks()).toHaveLength(1);
    expect(marks()[0].to).toEqual([0.45, 0.45]); // grabbed and re-aimed
  });

  test('a press 0.035 to the side of the head misses it and starts a new mark instead', () => {
    drag(0.335, 0.7, 0.60, 0.40);
    expect(marks()).toHaveLength(2);
    expect(marks()[0].to).toEqual([0.3, 0.7]); // the first arrow is untouched
    expect(marks()[1].to).toEqual([0.335, 0.7]);
  });
});

describe('undo', () => {
  test('steps back over a move, restoring where the end used to point', () => {
    drag(0.30, 0.70, 0.10, 0.20);
    drag(0.30, 0.70, 0.60, 0.55);
    document.getElementById('ex-undo').click();
    expect(marks()).toEqual([{ type: 'arrow', from: [0.1, 0.2], to: [0.3, 0.7] }]);
  });

  test('steps back over a placement too, so one press is one step either way', () => {
    drag(0.30, 0.70, 0.10, 0.20);
    document.getElementById('ex-undo').click();
    expect(marks()).toEqual([]);
  });

  test('does nothing at the bottom of the stack rather than throwing', () => {
    expect(() => document.getElementById('ex-undo').click()).not.toThrow();
    expect(marks()).toEqual([]);
  });
});

describe('manifest keys', () => {
  test.each([
    ['CurbRamp/severity-2.png', 'CurbRamp/severity-2'],
    ['CurbRamp/severity-2.webp', 'CurbRamp/severity-2'],
    ['_common/unsure-1.jpg', '_common/unsure-1'],
  ])('%s is keyed as %s, so the record survives a change of format', (file, key) => {
    document.body.innerHTML = FIXTURE;
    loadClass('public/js/admin-dashboard/ExampleAnnotatorPage.js', 'ExampleAnnotatorPage');
    const photo = document.getElementById('ex-photo');
    photo.getBoundingClientRect = () => BOX;
    Object.defineProperty(photo, 'naturalWidth', { value: 1440, configurable: true });
    Object.defineProperty(photo, 'naturalHeight', { value: 960, configurable: true });
    document.getElementById('ex-stage').setPointerCapture = () => {};

    new window.ExampleAnnotatorPage([file], {}, {}).init();
    drag(0.30, 0.70, 0.10, 0.20);
    expect(Object.keys(JSON.parse(document.getElementById('ex-json').textContent))).toContain(key);
  });
});

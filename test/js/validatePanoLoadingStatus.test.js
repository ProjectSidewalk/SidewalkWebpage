/**
 * Tests for the status Validate shows over a pano that is slow to load (issue #5581), in
 * public/js/validate/src/panorama/PanoLoadingStatus.js and the markup both Validate views carry for it.
 *
 * Without a status, a slow load reads as a hang: a dimmed tool and a wait cursor on desktop, nothing at all on mobile.
 * The status only helps if it stays out of the way of the fast loads most labels get, so the assertions cover both
 * halves: nothing for a load under DELAY_MS, and a visible, announced message for one over it.
 *
 * The DOM under test is cut from the real Twirl views, so a change to the markup that the class depends on (the live
 * region staying rendered, the box inside it being what hides) fails here rather than on a screen reader.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATUS_PATH = path.join(REPO_ROOT, 'public/js/validate/src/panorama/PanoLoadingStatus.js');
const DESKTOP_VIEW_PATH = path.join(REPO_ROOT, 'app/views/apps/validate.scala.html');
const MOBILE_VIEW_PATH = path.join(REPO_ROOT, 'app/views/apps/mobileValidate.scala.html');
const CSS_PATH = path.join(REPO_ROOT, 'public/css/pages/validate/svv-panorama.css');

/**
 * Load a bare `class` declaration out of a production file (same trick as validateSkipUnrenderableLabel.test.js).
 * @param {string} filePath - Absolute path to the production file.
 * @param {string} className - Name of the class the file declares.
 * @returns {Function} The class.
 */
function loadClassFromFile(filePath, className) {
  const src = fs.readFileSync(filePath, 'utf8');
  return (0, eval)('(() => {\n' + src + '\nreturn ' + className + ';\n})()');
}

/**
 * The status markup out of a Twirl view, with its asset reference turned into a plain URL so jsdom can parse it.
 * @param {string} viewPath - Absolute path to the view.
 * @returns {string} The `#svv-pano-loading` element's HTML.
 */
function statusMarkup(viewPath) {
  const view = fs.readFileSync(viewPath, 'utf8');
  const match = view.match(/<div id="svv-pano-loading"[\s\S]*?<\/div>\s*<\/div>/);
  if (!match) throw new Error(`No #svv-pano-loading in ${viewPath}`);
  return match[0].replace(/@assets\.path\("([^"]+)"\)/g, '/assets/$1');
}

describe.each([
  ['desktop', DESKTOP_VIEW_PATH],
  ['mobile', MOBILE_VIEW_PATH],
])('the pano loading status (%s view, issue #5581)', (_layout, viewPath) => {
  let PanoLoadingStatus;
  let status;
  let region;
  let box;
  let text;

  beforeEach(() => {
    jest.useFakeTimers();
    global.i18next = {t: jest.fn((key) => `t(${key})`)};
    document.body.innerHTML = `<div id="svv-panorama-holder">${statusMarkup(viewPath)}</div>`;
    PanoLoadingStatus = loadClassFromFile(STATUS_PATH, 'PanoLoadingStatus');
    region = document.getElementById('svv-pano-loading');
    box = region.querySelector('.svv-pano-loading__box');
    text = region.querySelector('.svv-pano-loading__text');
    status = new PanoLoadingStatus(region);
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
    delete global.i18next;
  });

  test('is a polite status region that is always rendered, with only its box hidden at rest', () => {
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    // Unhiding a live region is not reliably announced; revealing content inside one that is already there is.
    expect(region.hidden).toBe(false);
    expect(box.hidden).toBe(true);
    expect(text.dataset.i18n).toBe('common:loading-imagery');
    // The animation is decoration; the text is the message.
    expect(region.querySelector('img').getAttribute('alt')).toBe('');
  });

  test('stays hidden for a load that finishes inside the delay, so fast loads never flicker it', () => {
    status.begin();
    jest.advanceTimersByTime(PanoLoadingStatus.DELAY_MS - 1);
    expect(box.hidden).toBe(true);

    status.end();
    jest.advanceTimersByTime(PanoLoadingStatus.DELAY_MS * 5);
    expect(box.hidden).toBe(true);
    expect(status.isShowing()).toBe(false);
  });

  test('appears once a load has run for the delay, saying it is loading imagery', () => {
    status.begin();
    jest.advanceTimersByTime(PanoLoadingStatus.DELAY_MS);

    expect(box.hidden).toBe(false);
    expect(status.isShowing()).toBe(true);
    expect(text.textContent).toBe('t(common:loading-imagery)');
  });

  test('switches to the skipping message at once when a label is deferred', () => {
    status.begin();
    status.setMessage('validate:pano-loading.skipping');

    expect(box.hidden).toBe(false);
    expect(text.textContent).toBe('t(validate:pano-loading.skipping)');
    // Kept in data-i18n too, so a re-translation of the page keeps the message that is actually up.
    expect(text.dataset.i18n).toBe('validate:pano-loading.skipping');

    // The pending loading message must not replace it when its timer would have fired.
    jest.advanceTimersByTime(PanoLoadingStatus.DELAY_MS);
    expect(text.textContent).toBe('t(validate:pano-loading.skipping)');
  });

  test('is hidden when the load ends, and the next load starts over from "loading"', () => {
    status.begin();
    status.setMessage('validate:pano-loading.skipping');
    status.end();
    expect(box.hidden).toBe(true);

    status.begin();
    expect(box.hidden).toBe(true);
    jest.advanceTimersByTime(PanoLoadingStatus.DELAY_MS);
    expect(text.textContent).toBe('t(common:loading-imagery)');
  });
});

describe('the pano loading status degrades quietly without its markup', () => {
  test('a page without the element gets no status and no errors', () => {
    const PanoLoadingStatus = loadClassFromFile(STATUS_PATH, 'PanoLoadingStatus');
    const status = new PanoLoadingStatus(null);
    expect(() => {
      status.begin();
      status.setMessage('validate:pano-loading.skipping');
      status.end();
    }).not.toThrow();
    expect(status.isShowing()).toBe(false);
  });
});

describe('the pano loading status stylesheet', () => {
  test('lets the hidden attribute win over the box\'s flex display', () => {
    // Without this rule `display: flex` overrides [hidden], and the box would sit on every pano all the time.
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.svv-pano-loading__box\[hidden\]\s*\{\s*display:\s*none;/);
  });
});

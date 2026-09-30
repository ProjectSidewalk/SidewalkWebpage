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
  const match = view.match(/<div id="svv-pano-loading"[\s\S]*?<\/div>\s*<span class="svv-pano-loading__announce[^>]*><\/span>\s*<\/div>/);
  if (!match) throw new Error(`No #svv-pano-loading in ${viewPath}`);
  return match[0].replace(/@assets\.path\("([^"]+)"\)/g, '/assets/$1');
}

/**
 * Whether the box is hidden the way the style guide prescribes, with `.ps-hidden`.
 * @param {HTMLElement} el - The element to check.
 * @returns {boolean} True if it carries the class.
 */
function hidden(el) {
  return el.classList.contains('ps-hidden');
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
  let announce;

  beforeEach(() => {
    jest.useFakeTimers();
    global.i18next = {t: jest.fn((key) => `t(${key})`)};
    document.body.innerHTML = `<div id="svv-panorama-holder">${statusMarkup(viewPath)}</div>`;
    PanoLoadingStatus = loadClassFromFile(STATUS_PATH, 'PanoLoadingStatus');
    region = document.getElementById('svv-pano-loading');
    box = region.querySelector('.svv-pano-loading__box');
    text = region.querySelector('.svv-pano-loading__text');
    announce = region.querySelector('.svv-pano-loading__announce');
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
    expect(hidden(box)).toBe(true);
    expect(text.dataset.i18n).toBe('common:loading-imagery');
    // The animation is decoration; the text is the message.
    expect(region.querySelector('img').getAttribute('alt')).toBe('');
  });

  test('stays hidden for a load that finishes inside the delay, so fast loads never flicker it', () => {
    status.begin();
    jest.advanceTimersByTime(PanoLoadingStatus.DELAY_MS - 1);
    expect(hidden(box)).toBe(true);

    status.end();
    jest.advanceTimersByTime(PanoLoadingStatus.DELAY_MS * 5);
    expect(hidden(box)).toBe(true);
    expect(status.isShowing()).toBe(false);
  });

  test('appears once a load has run for the delay, saying it is loading imagery', () => {
    status.begin();
    jest.advanceTimersByTime(PanoLoadingStatus.DELAY_MS);

    expect(hidden(box)).toBe(false);
    expect(status.isShowing()).toBe(true);
    expect(text.textContent).toBe('t(common:loading-imagery)');
    expect(announce.textContent).toBe('t(common:loading-imagery)');
  });

  test('captions a blank pano area at once, but tells the screen reader only when the load turns slow', () => {
    // The box is aria-hidden, so showing it early says nothing to assistive tech; the span is what it hears.
    expect(box.getAttribute('aria-hidden')).toBe('true');
    expect(announce.classList.contains('sr-only')).toBe(true);

    const onShown = jest.fn();
    status.begin(onShown, { immediate: true });
    expect(hidden(box)).toBe(false);
    expect(text.textContent).toBe('t(common:loading-imagery)');
    expect(announce.textContent).toBe('');
    expect(onShown).not.toHaveBeenCalled();

    jest.advanceTimersByTime(PanoLoadingStatus.DELAY_MS - 1);
    expect(announce.textContent).toBe('');
    jest.advanceTimersByTime(1);
    expect(announce.textContent).toBe('t(common:loading-imagery)');
    expect(onShown).toHaveBeenCalledTimes(1);
  });

  test('an immediate box that ends fast is never announced or reported, like a delayed one', () => {
    const onShown = jest.fn();
    status.begin(onShown, { immediate: true });
    status.end();
    jest.advanceTimersByTime(PanoLoadingStatus.DELAY_MS * 2);
    expect(hidden(box)).toBe(true);
    expect(announce.textContent).toBe('');
    expect(onShown).not.toHaveBeenCalled();
  });

  test('switches to the skipping message at once when a label is deferred', () => {
    status.begin();
    status.setMessage('validate:pano-loading.skipping');

    expect(hidden(box)).toBe(false);
    expect(text.textContent).toBe('t(validate:pano-loading.skipping)');
    expect(announce.textContent).toBe('t(validate:pano-loading.skipping)');
    // Kept in data-i18n too, so a re-translation of the page keeps the message that is actually up.
    expect(text.dataset.i18n).toBe('validate:pano-loading.skipping');

    // The pending loading message must not replace it when its timer would have fired.
    jest.advanceTimersByTime(PanoLoadingStatus.DELAY_MS);
    expect(text.textContent).toBe('t(validate:pano-loading.skipping)');
  });

  test('reports coming into view once per load, whether by the delay or by a message', () => {
    const onShown = jest.fn();
    status.begin(onShown);
    jest.advanceTimersByTime(PanoLoadingStatus.DELAY_MS);
    status.setMessage('validate:pano-loading.skipping'); // Already showing, so not a second appearance.
    expect(onShown).toHaveBeenCalledTimes(1);

    const shownByMessage = jest.fn();
    status.begin(shownByMessage);
    status.setMessage('validate:pano-loading.skipping');
    expect(shownByMessage).toHaveBeenCalledTimes(1);
  });

  test('says nothing about a load that ended before it appeared', () => {
    const onShown = jest.fn();
    status.begin(onShown);
    status.end();
    jest.advanceTimersByTime(PanoLoadingStatus.DELAY_MS * 2);
    expect(onShown).not.toHaveBeenCalled();
  });

  test('is hidden when the load ends, and the next load starts over from "loading"', () => {
    status.begin();
    status.setMessage('validate:pano-loading.skipping');
    status.end();
    expect(hidden(box)).toBe(true);
    // Emptied, so the next slow load's text is a change the live region reports rather than a repeat it may skip.
    expect(announce.textContent).toBe('');

    status.begin();
    expect(hidden(box)).toBe(true);
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

describe('the pano loading status degrades quietly with its markup half there', () => {
  test('a box without its text element is treated as no status, rather than throwing mid-render', () => {
    global.i18next = {t: jest.fn((key) => key)};
    document.body.innerHTML = '<div id="svv-pano-loading"><div class="svv-pano-loading__box ps-hidden"></div></div>';
    const PanoLoadingStatus = loadClassFromFile(STATUS_PATH, 'PanoLoadingStatus');
    const status = new PanoLoadingStatus(document.getElementById('svv-pano-loading'));
    expect(() => {
      status.begin();
      status.setMessage('validate:pano-loading.skipping');
      status.end();
    }).not.toThrow();
    expect(status.isShowing()).toBe(false);
    document.body.innerHTML = '';
    delete global.i18next;
  });
});

describe('the pano loading status stylesheet', () => {
  test('leaves hiding to .ps-hidden, whose !important beats the box\'s flex display', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).not.toMatch(/\.svv-pano-loading__box\[hidden\]/);
    const mainCss = fs.readFileSync(path.join(REPO_ROOT, 'public/css/main.css'), 'utf8');
    expect(mainCss).toMatch(/\.ps-hidden\s*\{\s*display:\s*none !important;/);
  });
});

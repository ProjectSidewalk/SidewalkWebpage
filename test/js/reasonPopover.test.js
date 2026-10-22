/**
 * Tests for the reason pop-up (frontend/js/common/ReasonPopover.js, #5475): where it appears, how it leaves, and
 * the keys it answers while open. What a pick does is the host's (labelDetailReasonPopover.test.js,
 * galleryReasonPopover.test.js); here the host is a stub that records what it was told.
 *
 * jsdom has no Popover API, so the pop-up runs on its `hidden` fallback, and lays nothing out, so the element is
 * given a size by hand and the anchor a rectangle.
 */

import fs from 'fs';
import path from 'path';
import { loadModules, mockModule, REPO_ROOT } from './loader.js';

const EN_COMMON = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'public/locales/en/common.json'), 'utf8'));

/** @returns {string|undefined} What the real English common.json holds at a `common:` key. */
function lookup(key) {
  const [ns, rest] = key.split(':');
  if (ns !== 'common') return undefined;
  return rest.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), EN_COMMON);
}

mockModule('i18next', () => ({
  default: {
    t: (key) => (typeof lookup(key) === 'string' ? lookup(key) : key),
    exists: (key) => typeof lookup(key) === 'string',
  },
}));

let ReasonPopover;
let reasonPopover;
let popover;
let host;
let anchor;
let onPick;
let onOther;
let onDismiss;

const el = () => document.querySelector('.reason-popover');
const chips = () => [...document.querySelectorAll('.reason-popover .reason-chips__group .reason-chips__chip')];
const other = () => document.querySelector('.reason-popover .reason-chips__chip--other');
const isShown = () => el() && !el().hidden;

/**
 * @param {HTMLElement} target - A vote control the pop-up will hang off.
 * @param {{top: number, left: number, width?: number, height?: number}} rect - Where it sits in the viewport.
 */
function placeAt(target, { top, left, width = 60, height = 40 }) {
  target.getBoundingClientRect = () => ({ top, left, width, height, right: left + width, bottom: top + height });
}

/** Opens the pop-up on the host's anchor for a CurbRamp Disagree (three reasons). */
function open(overrides = {}) {
  return popover.open({
    anchor, host, labelType: 'CurbRamp', vote: 'Disagree', onPick, onOther, onDismiss, ...overrides,
  });
}

beforeEach(async () => {
  document.body.innerHTML = `
    <div id="host">
      <button id="anchor" data-reason-anchor></button>
      <button id="other-vote" data-reason-anchor></button>
      <input id="field">
    </div>
    <button id="elsewhere"></button>`;
  host = document.getElementById('host');
  anchor = document.getElementById('anchor');
  placeAt(anchor, { top: 400, left: 300 });
  onPick = vi.fn();
  onOther = vi.fn();
  onDismiss = vi.fn();
  window.innerWidth = 1024;
  window.innerHeight = 768;
  ({ ReasonPopover, reasonPopover } = await loadModules('frontend/js/common/ReasonPopover.js'));
  popover = reasonPopover();
  // jsdom lays nothing out; the pop-up is 300×120 here.
  Object.defineProperties(el(), { offsetWidth: { value: 300 }, offsetHeight: { value: 120 } });
});

// Each test loads the module afresh, and the instance before it keeps its document-wide listeners; closed, it
// answers nothing, so the next test's keys and presses reach only its own.
afterEach(() => popover.close());

describe('opening', () => {
  test('is one element for the page, a named dialog hidden until a vote asks for it', () => {
    expect(document.querySelectorAll('.reason-popover')).toHaveLength(1);
    expect(el().getAttribute('role')).toBe('dialog');
    expect(isShown()).toBeFalsy();
    expect(reasonPopover()).toBe(popover);
  });

  test('shows the vote\'s reasons for the type, marks the host, and says which host it is open for', () => {
    expect(open({ selected: 'driveway' })).toBe(true);
    expect(isShown()).toBe(true);
    expect(chips().map((c) => c.dataset.reasonId)).toEqual(['wrong-type', 'driveway', 'driveway-transition']);
    expect(chips()[1].getAttribute('aria-pressed')).toBe('true');
    expect(other()).not.toBeNull();
    expect(el().classList.contains('reason-popover--disagree')).toBe(true);
    expect(host.classList.contains('has-reason-popover')).toBe(true);
    expect(popover.isOpenFor(host)).toBe(true);
    expect(popover.isOpenFor(document.getElementById('elsewhere'))).toBe(false);
    expect(popover.anchor).toBe(anchor);
    // The dialog is named by the chips' own prompt, so the question is announced once.
    expect(document.getElementById(el().getAttribute('aria-labelledby')).textContent).toBe('Why do you disagree?');
  });

  test('opens nothing for a type or vote with no canned reasons', () => {
    expect(open({ labelType: 'Other' })).toBe(false);
    expect(isShown()).toBeFalsy();
    expect(host.classList.contains('has-reason-popover')).toBe(false);
    expect(open({ vote: 'Agree' })).toBe(false);
  });

  test('sits above the anchor, centred on it, with the tail at the anchor\'s centre', () => {
    open();
    // Anchor centre x = 330; 300 wide → left 180. Top = 400 - 120 - 10px gap.
    expect(el().style.left).toBe('180px');
    expect(el().style.top).toBe('270px');
    expect(el().style.getPropertyValue('--reason-popover-tail-x')).toBe('150px');
    expect(el().classList.contains('reason-popover--below')).toBe(false);
  });

  test('flips below an anchor near the top of the viewport, and the tail follows', () => {
    placeAt(anchor, { top: 20, left: 300 });
    open();
    expect(el().style.top).toBe('70px'); // 20 + 40 + 10.
    expect(el().classList.contains('reason-popover--below')).toBe(true);
  });

  test('stays inside the viewport at an edge, moving the box but not the tail', () => {
    placeAt(anchor, { top: 400, left: 0 });
    open();
    expect(el().style.left).toBe('8px');
    // Anchor centre is at x = 30, which is 22px into the box; the tail keeps clear of the corner at 18px.
    expect(el().style.getPropertyValue('--reason-popover-tail-x')).toBe('22px');
  });

  test('a keyboard open moves focus into the chips; a pointer open leaves it alone', () => {
    anchor.focus();
    open();
    expect(document.activeElement).toBe(anchor);
    open({ viaKeyboard: true, selected: 'driveway' });
    expect(document.activeElement).toBe(chips()[1]);
    expect(popover.containsFocus()).toBe(true);
  });

  test('opening for another host moves the question there and unmarks the first', () => {
    open();
    const second = document.getElementById('elsewhere');
    placeAt(second, { top: 500, left: 500 });
    expect(open({ host: second, anchor: second })).toBe(true);
    expect(host.classList.contains('has-reason-popover')).toBe(false);
    expect(second.classList.contains('has-reason-popover')).toBe(true);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('leaving', () => {
  test('the close control dismisses and says so', () => {
    open();
    el().querySelector('[data-action="close"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(isShown()).toBeFalsy();
    expect(host.classList.contains('has-reason-popover')).toBe(false);
    expect(onDismiss).toHaveBeenCalledWith('close', false);
  });

  test('Escape dismisses from the keyboard, and its keyup never reaches the page', () => {
    open();
    const pageKeyup = vi.fn();
    document.addEventListener('keyup', pageKeyup);
    const keydown = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(keydown);
    expect(keydown.defaultPrevented).toBe(true);
    expect(onDismiss).toHaveBeenCalledWith('escape', true);
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
    expect(pageKeyup).not.toHaveBeenCalled();
    // The swallow is one keyup deep: the next Escape is the page's again.
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
    expect(pageKeyup).toHaveBeenCalledTimes(1);
  });

  test('a press outside dismisses; one on the anchor, inside the pop-up, or on another vote control does not', () => {
    open();
    const press = (target) => target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    press(anchor);
    press(chips()[0]);
    // Another vote control on the same card is a re-vote for that control to handle, not a dismissal.
    press(document.getElementById('other-vote'));
    expect(isShown()).toBe(true);
    expect(onDismiss).not.toHaveBeenCalled();
    press(document.getElementById('elsewhere'));
    expect(isShown()).toBeFalsy();
    expect(onDismiss).toHaveBeenCalledWith('outside', false);
  });

  test('a host-driven close tells no one, and returns focus to the anchor only if it was inside', () => {
    open({ viaKeyboard: true });
    expect(popover.containsFocus()).toBe(true);
    popover.close();
    expect(isShown()).toBeFalsy();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(anchor);

    document.getElementById('elsewhere').focus();
    open();
    popover.close();
    expect(document.activeElement).toBe(document.getElementById('elsewhere'));
  });

  test('"Other…" closes first and then hands over, so the host can move focus where it likes', () => {
    open();
    other().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(isShown()).toBeFalsy();
    expect(onOther).toHaveBeenCalledWith(false);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('keys', () => {
  const key = (code, target = document.body) => {
    const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  test('digits pick 1–N and N+1 is Other, claimed so the page never sees them; the rest fall through', () => {
    open();
    expect(key('Digit2').defaultPrevented).toBe(true);
    expect(onPick).toHaveBeenCalledWith('driveway', true);
    expect(key('Numpad4').defaultPrevented).toBe(true);
    expect(onOther).toHaveBeenCalledWith(true);
    open();
    expect(key('Digit5').defaultPrevented).toBe(false);
    expect(key('KeyA').defaultPrevented).toBe(false);
  });

  test('digits typed into a field are the field\'s', () => {
    open();
    const field = document.getElementById('field');
    field.focus();
    expect(key('Digit1', field).defaultPrevented).toBe(false);
    expect(onPick).not.toHaveBeenCalled();
  });

  test('nothing answers while closed', () => {
    expect(key('Digit1').defaultPrevented).toBe(false);
    expect(key('Escape').defaultPrevented).toBe(false);
    expect(onPick).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('after a pick', () => {
  test('busy takes no pick, and a saved reason is marked, announced, then leaves on its own', () => {
    vi.useFakeTimers();
    open();
    popover.setBusy(true);
    expect(chips()[0].getAttribute('aria-disabled')).toBe('true');
    chips()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPick).not.toHaveBeenCalled();

    popover.markSaved('driveway');
    expect(chips()[1].getAttribute('aria-pressed')).toBe('true');
    expect(chips()[0].getAttribute('aria-disabled')).toBe('false');
    const saved = el().querySelector('.reason-popover__saved');
    expect(saved.hidden).toBe(false);
    expect(saved.textContent).toBe('Reason saved');
    expect(el().classList.contains('reason-popover--saved')).toBe(true);

    vi.advanceTimersByTime(ReasonPopover.SAVED_HOLD_MS - 1);
    expect(isShown()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isShown()).toBeFalsy();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  test('a failed save puts the chips back in play and says why', () => {
    open();
    popover.setBusy(true);
    popover.markFailed();
    expect(chips()[0].getAttribute('aria-disabled')).toBe('false');
    expect(el().querySelector('.reason-popover__hint').textContent).toBe('labelmap:comment-save-failed');
    expect(isShown()).toBe(true);
  });

  test('a reopen before the hold ends cancels the close', () => {
    vi.useFakeTimers();
    open();
    popover.markSaved('driveway');
    open({ selected: 'driveway' });
    vi.advanceTimersByTime(ReasonPopover.SAVED_HOLD_MS + 1);
    expect(isShown()).toBe(true);
    expect(el().querySelector('.reason-popover__saved').hidden).toBe(true);
  });
});

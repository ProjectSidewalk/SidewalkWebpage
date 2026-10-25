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
let ReasonChips;
let reasonPopover;
let popover;
let host;
let anchor;
let onPick;
let onOther;
let onSubmitOther;
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
    anchor, host, labelType: 'CurbRamp', vote: 'Disagree', onPick, onOther, onSubmitOther, onDismiss, ...overrides,
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
  onSubmitOther = vi.fn();
  onDismiss = vi.fn();
  window.innerWidth = 1024;
  window.innerHeight = 768;
  ({ ReasonPopover, reasonPopover, ReasonChips } = await loadModules(
    'frontend/js/common/ReasonPopover.js',
    'frontend/js/common/ReasonChips.js',
  ));
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

  test('opening for another host moves the question there, and the first hears it was dismissed', () => {
    const onClose = vi.fn(() => expect(popover.isOpenFor(host)).toBe(false));
    open({ onClose });
    const second = document.getElementById('elsewhere');
    placeAt(second, { top: 500, left: 500 });
    // A keyboard vote on another card: no press outside, so only the move can tell the first card.
    expect(open({ host: second, anchor: second, onDismiss: vi.fn() })).toBe(true);
    expect(host.classList.contains('has-reason-popover')).toBe(false);
    expect(second.classList.contains('has-reason-popover')).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('outside', false);
    expect(popover.isOpenFor(second)).toBe(true);
  });

  test('a vote on another host that offers no reason still dismisses the first, as a move does', () => {
    const onClose = vi.fn();
    open({ onClose });
    const second = document.getElementById('elsewhere');
    expect(open({ host: second, anchor: second, vote: 'Agree', onDismiss: vi.fn() })).toBe(false);
    expect(popover.isOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('outside', false);
  });

  test('a re-vote on the same host redraws without closing or dismissing', () => {
    const onClose = vi.fn();
    open({ onClose });
    open({ onClose, vote: 'Unsure' });
    expect(onClose).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  test('lives inside a <dialog> host, which a modal makes the only reachable part of the page, and back out', () => {
    document.body.insertAdjacentHTML('beforeend', '<dialog id="card"><button id="card-vote"></button></dialog>');
    const card = document.getElementById('card');
    const cardVote = document.getElementById('card-vote');
    placeAt(cardVote, { top: 400, left: 300 });
    open({ host: card, anchor: cardVote });
    expect(el().parentElement).toBe(card);
    expect(isShown()).toBe(true);
    open();
    expect(el().parentElement).toBe(document.body);
    expect(isShown()).toBe(true);
  });

  test('closes, quietly, when its <dialog> host closes under it', () => {
    document.body.insertAdjacentHTML('beforeend', '<dialog id="card"><button id="card-vote"></button></dialog>');
    const card = document.getElementById('card');
    const onClose = vi.fn();
    open({ host: card, anchor: document.getElementById('card-vote'), onClose });
    card.dispatchEvent(new Event('close'));
    expect(popover.isOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
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

  test('the close control is named for a screen reader rather than read as its glyph', () => {
    open();
    expect(el().querySelector('[data-action="close"]').getAttribute('aria-label')).toBe('Dismiss');
  });

  test('closes without a dismissal once the card it hangs off has been re-rendered away', () => {
    open();
    host.remove();
    window.dispatchEvent(new Event('scroll'));
    expect(isShown()).toBeFalsy();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  test('opens nothing for a card already re-rendered away, so no invisible pop-up is left taking clicks', () => {
    host.remove();
    expect(open({ viaKeyboard: true })).toBe(false);
    expect(isShown()).toBeFalsy();
    expect(popover.isOpen()).toBe(false);
    expect(el().contains(document.activeElement)).toBe(false);
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

  test('"Other…" opens its field in place, and unsaved words keep a click outside from closing it', () => {
    open({ otherText: '' });
    other().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(isShown()).toBe(true);
    expect(onOther).toHaveBeenCalledWith(false);
    const input = el().querySelector('.reason-chips__other-input');
    const press = () => document.getElementById('elsewhere')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    input.value = 'words';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    press();
    expect(isShown()).toBe(true);
    el().querySelector('.reason-chips__other-save')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
    expect(onSubmitOther).toHaveBeenCalledWith('words', true);
    popover.markSaved(ReasonChips.OTHER);
    expect(el().querySelector('.reason-popover__saved').textContent).toBe('Reason saved');

    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    press();
    expect(isShown()).toBeFalsy();
    expect(onDismiss).toHaveBeenCalledWith('outside', false);
  });

  test('a re-vote on the same card keeps half-typed words; another card starts fresh', () => {
    open();
    other().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    const field = () => el().querySelector('.reason-chips__other-input');
    field().value = 'half typed';
    open({ vote: 'Unsure', labelType: 'CurbRamp' });
    expect(field()?.value).toBe('half typed');

    const elsewhere = document.getElementById('elsewhere');
    placeAt(elsewhere, { top: 400, left: 600 });
    open({ host: elsewhere, anchor: elsewhere });
    expect(field()).toBeNull();
  });

  test('typing into the field during the "Reason saved" hold keeps the pop-up open', () => {
    vi.useFakeTimers();
    open();
    other().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    popover.markSaved(ReasonChips.OTHER);
    const field = el().querySelector('.reason-chips__other-input');
    field.value = 'one more thing';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(ReasonPopover.SAVED_HOLD_MS + 1);
    expect(isShown()).toBe(true);
    expect(el().querySelector('.reason-popover__saved').textContent).toBe('');
  });
});

describe('keys', () => {
  const key = (code, target = document.body) => {
    const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  test('Tab from the vote goes into the pop-up and Tab off its end comes back to the page after the vote', () => {
    const tab = (target, shiftKey = false) => {
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event;
    };
    const inside = () => [...el().querySelectorAll('button, input')].filter((n) => n.tabIndex >= 0 && !n.closest('[hidden]'));
    anchor.focus();
    open();
    expect(tab(anchor).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(chips()[0]);
    expect(tab(chips()[0], true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(anchor);
    // Anywhere else, Tab is the browser's.
    expect(tab(document.getElementById('field')).defaultPrevented).toBe(false);
    // Shift+Tab from what follows the vote steps back in at the pop-up's end.
    tab(document.getElementById('other-vote'), true);
    expect(document.activeElement).toBe(inside().at(-1));
  });

  test('Tab out lands past a vote that is disabled while its pick saves, and reaches a <summary>', () => {
    const tab = (target) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    const last = () => [...el().querySelectorAll('button, input')].filter((n) => n.tabIndex >= 0 && !n.closest('[hidden]')).at(-1);
    const details = document.createElement('details');
    details.innerHTML = '<summary id="stories">Stories</summary>';
    anchor.after(details);
    // Something tabbable ahead of the vote, where a position taken from the disabled vote's index would land.
    host.before(document.createElement('button'));
    open({ viaKeyboard: true });
    anchor.disabled = true;
    last().focus();
    tab(last());
    expect(popover.isOpen()).toBe(false);
    expect(document.activeElement).toBe(document.getElementById('stories'));
  });

  test('with words held and nothing after the vote, Tab out is left to the browser', () => {
    document.getElementById('other-vote').remove();
    document.getElementById('field').remove();
    document.getElementById('elsewhere').remove();
    const tab = (target) => {
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event;
    };
    open({ viaKeyboard: true });
    other().click();
    const field = el().querySelector('.reason-chips__other-form input');
    field.value = 'half typed';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    const last = [...el().querySelectorAll('button, input')].filter((n) => n.tabIndex >= 0 && !n.closest('[hidden]')).at(-1);
    last.focus();
    expect(tab(last).defaultPrevented).toBe(false);
    expect(popover.isOpen()).toBe(true);
  });

  test('Tab past its last control closes it, as a click elsewhere does, unless "Other…" holds words', () => {
    const tab = (target) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    const last = () => [...el().querySelectorAll('button, input')].filter((n) => n.tabIndex >= 0 && !n.closest('[hidden]')).at(-1);
    open({ viaKeyboard: true });
    last().focus();
    tab(last());
    expect(popover.isOpen()).toBe(false);
    expect(onDismiss).toHaveBeenCalledWith('tab', true);
    expect(document.activeElement).toBe(document.getElementById('other-vote'));

    onDismiss.mockClear();
    open({ viaKeyboard: true });
    other().click();
    const field = el().querySelector('.reason-chips__other-form input');
    field.value = 'half typed';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    last().focus();
    tab(last());
    expect(popover.isOpen()).toBe(true);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.getElementById('other-vote'));
  });

  test('arrows move between chips even with a pano viewer swallowing them for the page', async () => {
    const { util } = await loadModules('frontend/js/common/pano-viewer/panoUtilities.js',
      'frontend/js/common/utilities.js');
    // The viewers' guard (GsvViewer, Infra3dViewer, PannellumViewer): a window capture listener, so it runs first.
    const guard = (e) => {
      if (util.pano.keyBelongsToPage(e.target)) return;
      if (e.key.startsWith('Arrow')) e.stopPropagation();
    };
    window.addEventListener('keydown', guard, { capture: true });
    try {
      open({ viaKeyboard: true });
      expect(document.activeElement).toBe(chips()[0]);
      chips()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(chips()[1]);
      // Outside the pop-up the pano keeps its arrows; a text field keeps them for its cursor.
      const onPage = vi.fn();
      document.body.addEventListener('keydown', onPage);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(onPage).not.toHaveBeenCalled();
      document.body.removeEventListener('keydown', onPage);
      expect(util.pano.keyBelongsToPage(document.getElementById('field'))).toBe(true);
    } finally {
      window.removeEventListener('keydown', guard, { capture: true });
    }
  });

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

  test('a shifted digit is a symbol, not a pick', () => {
    open();
    const event = new KeyboardEvent('keydown', { code: 'Digit1', shiftKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
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
    expect(el().querySelector('.reason-popover__saved').textContent).toBe('Reason saved');
    expect(el().querySelector('.reason-popover__foot').classList.contains('reason-popover__foot--empty')).toBe(false);
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
    expect(el().querySelector('.reason-popover__saved').textContent).toBe('');
    expect(el().querySelector('.reason-popover__foot').classList.contains('reason-popover__foot--empty')).toBe(true);
  });
});

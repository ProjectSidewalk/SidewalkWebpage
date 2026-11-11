/**
 * Tests Explore's keyboard shortcuts (frontend/js/explore/keyboard/KeyboardManager.js) (#5840): the walking keys and
 * when they stand aside, Space's step along the route, the keys that close the context menu, zoom, the severity and
 * tag keys of an open label, and how a letter printed in the UI becomes a key. The mode letters, F and Space on a
 * checkbox have their own suites.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakeGate, fakeTracker } from './fakes.js';
import { flush } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

describe('Explore KeyboardManager', () => {
  let KeyboardManager;
  /** Each manager built gets a lock of its own: its window listeners can't be removed, so `afterEach` locks it. */
  const locks = [];
  /** The current manager's lock. */
  let lock;
  let menuOpen;
  let panningHeld;
  let targetLabel;
  let tagsDisabled;
  let ratingDisabled;
  let moved;
  const tracker = fakeTracker();
  const canvas = { showLabelHoverInfo: vi.fn() };
  const contextMenu = {
    isOpen: () => menuOpen,
    getTargetLabel: () => targetLabel,
    hide: vi.fn(() => { menuOpen = false; }),
    onTextFieldFocusChanged: vi.fn((listener) => { contextMenu.textFieldFocused = listener; }),
    isTaggingDisabled: () => tagsDisabled,
    isRatingSeverityDisabled: () => ratingDisabled,
    handleSeverityPopup: vi.fn(),
    checkRadioButton: vi.fn(),
    labelTags: [
      { tag_id: 1, tag: 'narrow', label_type: 'CurbRamp' },
      { tag_id: 2, tag: 'not visible', label_type: 'CurbRamp' },
      { tag_id: 3, tag: 'unclear if needed', label_type: 'NoCurbRamp' },
    ],
  };
  const navigationService = {
    canWalk: () => true,
    moveToLinkedPano: vi.fn(() => Promise.resolve(moved)),
    moveForward: vi.fn(() => Promise.resolve()),
  };
  const labelModes = { switchTo: vi.fn(), backToWalk: vi.fn() };
  const zoomControl = { zoomIn: vi.fn(), zoomOut: vi.fn() };
  const panoManager = {
    panning: fakeGate({ isHeld: () => panningHeld }),
    getPov: () => ({ heading: 1, pitch: -5, zoom: 2 }),
    setPov: vi.fn(),
  };
  const compass = { getTargetAngle: () => 91 };
  let streetEnded;
  const streetProgress = { isLabelBeforeJumpArmed: () => streetEnded };
  const immersiveMode = { toggle: vi.fn() };

  /** @returns {object} A label of the given type, as the shortcuts read it. */
  const labelOf = (labelType) => ({ getProperty: (key) => ({ labelType }[key]) });

  /** @returns {string} The physical key a US layout types `key` on, for an event that doesn't name one. */
  const codeFor = (key) => {
    if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
    return key === ' ' ? 'Space' : key;
  };

  /** Presses a key on the page: keydown then keyup, with `init` on both. */
  function press(key, init = {}) {
    const events = [];
    for (const type of ['keydown', 'keyup']) {
      const event = new KeyboardEvent(type, { key, code: codeFor(key), bubbles: true, cancelable: true, ...init });
      document.body.dispatchEvent(event);
      events.push(event);
    }
    return events;
  }

  beforeAll(async () => {
    ({ KeyboardManager } = await loadModules('frontend/js/explore/keyboard/KeyboardManager.js'));
  });

  beforeEach(() => {
    lock = { held: false };
    locks.push(lock);
    menuOpen = false;
    panningHeld = false;
    targetLabel = null;
    tagsDisabled = false;
    ratingDisabled = false;
    moved = true;
    streetEnded = false;
    document.body.innerHTML = '<button data-tag-id="1"></button><button data-tag-id="2"></button>';
    const own = lock;
    const gate = fakeGate({ isHeld: () => own.held });
    new KeyboardManager(gate, canvas, contextMenu, navigationService, labelModes, zoomControl, panoManager, compass,
      streetProgress, immersiveMode, tracker);
    contextMenu.textFieldFocused(false);
  });

  afterEach(() => {
    for (const earlier of locks) earlier.held = true;
  });

  describe('walking keys', () => {
    it('turns the view two degrees per arrow, wrapping, and hides the menu and hover card', () => {
      press('ArrowLeft');
      expect(panoManager.setPov).toHaveBeenCalledWith({ heading: 359, pitch: -5, zoom: 2 });
      press('ArrowRight');
      expect(panoManager.setPov).toHaveBeenCalledWith({ heading: 3, pitch: -5, zoom: 2 });
      expect(contextMenu.hide).toHaveBeenCalledTimes(2);
      expect(canvas.showLabelHoverInfo).toHaveBeenCalledWith(undefined);
    });

    it('stands aside while a pan is in flight', () => {
      panningHeld = true;
      press('ArrowLeft');
      expect(panoManager.setPov).not.toHaveBeenCalled();
    });

    it('steps to the linked pano ahead or behind on the up and down arrows', () => {
      press('ArrowUp');
      expect(navigationService.moveToLinkedPano).toHaveBeenCalledWith(0);
      press('ArrowDown');
      expect(navigationService.moveToLinkedPano).toHaveBeenCalledWith(180);
    });

    it.each([
      ['the shortcuts are paused', () => { lock.held = true; }],
      ['the labeler is typing a description', () => contextMenu.textFieldFocused(true)],
      ['the context menu is open', () => { menuOpen = true; }],
    ])('does nothing while %s', (_, arrange) => {
      arrange();
      press('ArrowLeft');
      press('ArrowUp');
      expect(panoManager.setPov).not.toHaveBeenCalled();
      expect(navigationService.moveToLinkedPano).not.toHaveBeenCalled();
    });
  });

  describe('Space', () => {
    it('steps along the route rather than wherever the camera faces, and says the link did it', async () => {
      const [keydown] = press(' ');
      expect(keydown.defaultPrevented).toBe(true);
      await flush();
      expect(navigationService.moveToLinkedPano).toHaveBeenCalledWith(90, { alertOnFailure: false });
      expect(navigationService.moveForward).not.toHaveBeenCalled();
      expect(tracker.push).toHaveBeenCalledWith('KeyboardShortcut_MoveForwardAlongRoute', { usedRoute: false });
    });

    it('falls back to the street-aware step when no link goes that way', async () => {
      moved = false;
      press(' ');
      await flush();
      expect(navigationService.moveForward).toHaveBeenCalledTimes(1);
      expect(tracker.push).toHaveBeenCalledWith('KeyboardShortcut_MoveForwardAlongRoute', { usedRoute: true });
    });

    it('does nothing once the street has ended and the prompt to move on is up (#5918)', async () => {
      streetEnded = true;
      const [keydown] = press(' ');
      expect(keydown.defaultPrevented).toBe(true);
      await flush();
      expect(navigationService.moveToLinkedPano).not.toHaveBeenCalled();
      expect(navigationService.moveForward).not.toHaveBeenCalled();
      expect(tracker.push).not.toHaveBeenCalledWith('KeyboardShortcut_MoveForwardAlongRoute', expect.anything());
    });

    it('leaves Space to a focused radio button, which has no other key', () => {
      document.body.insertAdjacentHTML('beforeend', '<input id="radio" type="radio">');
      const keydown = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
      document.getElementById('radio').dispatchEvent(keydown);
      expect(keydown.defaultPrevented).toBe(false);
      expect(navigationService.moveToLinkedPano).not.toHaveBeenCalled();
    });

    it('keeps a failed step out of the console\'s unhandled rejections, and logs no move', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      navigationService.moveToLinkedPano.mockImplementationOnce(() => Promise.reject(new Error('no imagery')));
      press(' ');
      await flush();
      expect(console.error).toHaveBeenCalledWith('Spacebar route-advance failed:', expect.any(Error));
      expect(tracker.push).not.toHaveBeenCalledWith('KeyboardShortcut_MoveForwardAlongRoute', expect.anything());
    });
  });

  describe('closing the context menu', () => {
    beforeEach(() => {
      menuOpen = true;
      targetLabel = labelOf('CurbRamp');
    });

    it('saves and closes on Enter, filing both rows under the label', () => {
      press('Enter');
      expect(contextMenu.handleSeverityPopup).toHaveBeenCalledTimes(1);
      expect(contextMenu.hide).toHaveBeenCalledTimes(1);
      expect(tracker.push).toHaveBeenCalledWith('KeyboardShortcut_CloseContextMenu', null, targetLabel);
      expect(tracker.push).toHaveBeenCalledWith('ContextMenu_ClosePressEnter', null, targetLabel);
    });

    it('cancels on Escape, back to walking with the hover card gone', () => {
      press('Escape');
      expect(contextMenu.hide).toHaveBeenCalledTimes(1);
      expect(tracker.push).toHaveBeenCalledWith('ContextMenu_CloseKeyboardShortcut', { code: 'Escape' }, targetLabel);
      expect(labelModes.backToWalk).toHaveBeenCalledTimes(1);
      expect(canvas.showLabelHoverInfo).toHaveBeenCalledWith(undefined);
    });

    it('works from inside the description box too, where other shortcuts stand aside', () => {
      contextMenu.textFieldFocused(true);
      press('Enter');
      expect(contextMenu.hide).toHaveBeenCalledTimes(1);
      menuOpen = true;
      press('c');
      expect(labelModes.switchTo).not.toHaveBeenCalled();
    });

    it('does nothing on Enter while the menu is closed, or while the shortcuts are paused', () => {
      menuOpen = false;
      press('Enter');
      lock.held = true;
      menuOpen = true;
      press('Enter');
      press('Escape');
      expect(contextMenu.hide).not.toHaveBeenCalled();
      expect(labelModes.backToWalk).not.toHaveBeenCalled();
    });
  });

  describe('Z', () => {
    it('zooms in, or out with Shift, and logs which', () => {
      press('z');
      expect(zoomControl.zoomIn).toHaveBeenCalledTimes(1);
      expect(tracker.push).toHaveBeenCalledWith('KeyboardShortcut_ZoomIn', { code: 'KeyZ' });
      press('Z', { shiftKey: true });
      expect(zoomControl.zoomOut).toHaveBeenCalledTimes(1);
      expect(tracker.push).toHaveBeenCalledWith('KeyboardShortcut_ZoomOut', { code: 'KeyZ' });
      expect(contextMenu.hide).not.toHaveBeenCalled();
    });

    it('closes an open context menu first', () => {
      menuOpen = true;
      targetLabel = labelOf('CurbRamp');
      press('z');
      expect(tracker.push).toHaveBeenCalledWith('KeyboardShortcut_CloseContextMenu', null, targetLabel);
      expect(contextMenu.hide).toHaveBeenCalledTimes(1);
      expect(zoomControl.zoomIn).toHaveBeenCalledTimes(1);
    });
  });

  describe('rating the open label', () => {
    beforeEach(() => {
      menuOpen = true;
      targetLabel = labelOf('CurbRamp');
    });

    it.each([1, 2, 3])('presses the severity %i radio from the digit row or the numpad', (severity) => {
      press(String(severity), { code: `Digit${severity}` });
      press(String(severity), { code: `Numpad${severity}` });
      expect(contextMenu.checkRadioButton).toHaveBeenCalledTimes(2);
      expect(contextMenu.checkRadioButton).toHaveBeenCalledWith(severity);
      expect(tracker.push).toHaveBeenCalledWith(`KeyboardShortcut_Severity_${severity}`, { code: `Numpad${severity}` },
        targetLabel);
    });

    it('leaves a label that takes no rating alone', () => {
      ratingDisabled = true;
      press('2', { code: 'Digit2' });
      expect(contextMenu.checkRadioButton).not.toHaveBeenCalled();
    });

    it('does nothing with no label open, or with the menu closed', () => {
      targetLabel = null;
      press('2', { code: 'Digit2' });
      menuOpen = false;
      targetLabel = labelOf('CurbRamp');
      press('2', { code: 'Digit2' });
      expect(contextMenu.checkRadioButton).not.toHaveBeenCalled();
    });
  });

  describe('tagging the open label', () => {
    const tagButton = (id) => document.querySelector(`[data-tag-id="${id}"]`);

    beforeEach(() => {
      menuOpen = true;
      targetLabel = labelOf('CurbRamp');
      for (const button of document.querySelectorAll('[data-tag-id]')) button.click = vi.fn();
    });

    it('clicks the tag whose underlined letter was pressed, letters and punctuation alike', () => {
      press('a');
      expect(tagButton(1).click).toHaveBeenCalledTimes(1);
      press('[', { code: 'BracketLeft' });
      expect(tagButton(2).click).toHaveBeenCalledTimes(1);
      // The E that means Walk with the menu closed is a tag letter here, and this type has no tag on it.
      press('e');
      expect(labelModes.switchTo).not.toHaveBeenCalled();
    });

    it('only offers the open label type\'s tags', () => {
      targetLabel = labelOf('NoCurbRamp');
      press('a');
      expect(tagButton(1).click).not.toHaveBeenCalled();
      // Its own tag's button isn't on the page, which is not an error.
      expect(() => press('u')).not.toThrow();
    });

    it('stands aside while the menu\'s tags are disabled, or there is no label', () => {
      tagsDisabled = true;
      press('a');
      tagsDisabled = false;
      targetLabel = null;
      press('a');
      expect(tagButton(1).click).not.toHaveBeenCalled();
    });

    it('reads a tag whose printed shortcut is a digit, and skips one with no letter yet', () => {
      useUtil({
        misc: {
          getLabelDescriptions: (type) => (type === 'CurbRamp'
            ? { keyChar: 'C', tagInfo: { narrow: { keyChar: '5' } } } : undefined),
        },
      });
      try {
        press('5', { code: 'Digit5' });
        expect(tagButton(1).click).toHaveBeenCalledTimes(1);
        expect(tagButton(2).click).not.toHaveBeenCalled();
      } finally {
        useUtil();
      }
    });
  });

  it('skips a label type that has no letter yet', () => {
    useUtil({ misc: { getLabelDescriptions: (type) => (type === 'CurbRamp' ? { keyChar: 'C' } : undefined) } });
    try {
      press('c');
      press('m');
      expect(labelModes.switchTo).toHaveBeenCalledTimes(1);
      expect(labelModes.switchTo).toHaveBeenCalledWith('CurbRamp');
    } finally {
      useUtil();
    }
  });
});

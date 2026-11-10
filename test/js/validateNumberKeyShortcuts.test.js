/**
 * Tests for the number-key shortcuts in Validate's KeyboardManager (frontend/js/validate/keyboard/
 * KeyboardManager.js), covering the fourth Missing Curb Ramp disagree reason added for #4871, plus the Ctrl+Z undo,
 * the H, Z and C letter keys, and Escape in a comment box or the tag picker, which share the manager's key handling.
 *
 * The reason buttons are one fixed set of elements reused across label types, and `defaultOption` is the flag saying
 * "this type offers this reason" — so the same keypress has to mean different things depending on the label on screen.
 * The rule these pin down: a number key picks the reason it maps to when the type offers it, and otherwise focuses the
 * comment box. That makes the comment box key move from 4 to 5 on the one type with a fourth reason, and leaves it on
 * 4 everywhere else.
 *
 * One instance serves the whole file: the constructor registers a window listener that cannot be unregistered.
 */

import { loadModules } from './loader.js';
import { fakeGate, fakeTracker } from './fakes.js';

const { KeyboardManager } = await loadModules('frontend/js/validate/keyboard/KeyboardManager.js');

/**
 * A menu control with its click spied; `chosen` marks the verdict. A real element, since the manager compares the
 * comment boxes against document.activeElement.
 */
function makeControl({ chosen = false } = {}) {
  const control = document.createElement('textarea');
  control.classList.toggle('is-chosen', chosen);
  control.click = vi.fn();
  return control;
}

/**
 * Dispatches a number keydown. Both `code` and `key` are set because the manager switches on `code` but reads the
 * digit off `key`.
 */
function pressDigit(n) {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    code: `Digit${n}`, key: String(n), bubbles: true, cancelable: true,
  }));
}

/** The reason buttons a label type offers, as `#renderReasonButtons` leaves the DOM for that type. */
function renderReasons(offered) {
  document.body.innerHTML = [1, 2, 3, 4]
    .map((n) => `<button id="no-button-${n}" class="${offered.includes(n) ? 'defaultOption' : ''}"></button>`)
    .join('');
}

describe('KeyboardManager number-key shortcuts', () => {
  const validationMenuUi = {};
  const clicks = [];
  // The manager keeps the collaborators it was built with, so each test swaps the objects behind these proxies.
  let current = {};
  const live = (name) => new Proxy({}, { get: (_, key) => current[name][key] });
  const config = { adminVersion: false };
  // What pauses the shortcuts, and the label container's loading listener, which the manager registers once.
  const keyboardLock = fakeGate();
  let onLoadingChange;

  beforeAll(() => {
    Object.assign(validationMenuUi, {
      optionalCommentTextBox: makeControl(),
      disagreeReasonTextBox: makeControl(),
      unsureReasonTextBox: makeControl(),
      submitButton: makeControl(),
      yesButton: makeControl(),
      noButton: makeControl(),
      unsureButton: makeControl(),
    });

    // The manager looks the reason buttons and severity radios up by id and clicks them natively.
    document.addEventListener('click', (e) => clicks.push(/** @type {Element} */ (e.target).id));

    new KeyboardManager(
      { validationMenu: validationMenuUi, undoValidation: { undoButton: live('undoButton') } }, config,
      keyboardLock,
      { onLoadingChange: (listener) => { onLoadingChange = listener; } }, live('labelVisibilityControl'), live('labelCard'), live('validationMenu'),
      live('zoomControl'), live('undoValidation'), live('immersiveMode'), live('imageAdjustmentsPopover'),
      live('tracker'),
    );
  });

  beforeEach(() => {
    clicks.length = 0;
    config.adminVersion = false;
    current = {
      labelVisibilityControl: { hideLabelCard: vi.fn(), isVisible: () => true, isCardHeldOpen: () => false },
      labelCard: { isPopoverOpen: () => false, closeTypeDropdown: () => false },
      validationMenu: { inWrongTypeView: () => false },
      imageAdjustmentsPopover: { isOpen: () => false },
      undoValidation: { canUndo: () => false },
      tracker: fakeTracker(),
    };
    for (const box of ['optionalCommentTextBox', 'disagreeReasonTextBox', 'unsureReasonTextBox']) {
      validationMenuUi[box].click = vi.fn();
    }
  });

  /**
     * Selects a verdict, as clicking Agree / Disagree / Unsure would. 'wrongType' is Disagree with the "wrong label
     * type" reason picked on Expert Validate, where the menu swaps the reasons for the type picker's section.
     */
  function choose(verdict) {
    validationMenuUi.yesButton = makeControl({ chosen: verdict === 'yes' });
    validationMenuUi.noButton = makeControl({ chosen: verdict === 'no' || verdict === 'wrongType' });
    validationMenuUi.unsureButton = makeControl({ chosen: verdict === 'unsure' });
    current.validationMenu = { inWrongTypeView: () => verdict === 'wrongType' };
  }

  describe('on a label type with a fourth disagree reason (Missing Curb Ramp)', () => {
    beforeEach(() => {
      renderReasons([1, 2, 3, 4]);
      choose('no');
    });

    it('4 picks the fourth reason', () => {
      pressDigit(4);

      expect(clicks).toEqual(['no-button-4']);
      expect(validationMenuUi.disagreeReasonTextBox.click).not.toHaveBeenCalled();
    });

    it('5 focuses the comment box, which 4 no longer reaches', () => {
      pressDigit(5);

      expect(clicks).toEqual([]);
      expect(validationMenuUi.disagreeReasonTextBox.click).toHaveBeenCalledTimes(1);
    });

    it('1-3 still pick their own reasons', () => {
      pressDigit(1);
      pressDigit(2);
      pressDigit(3);

      expect(clicks).toEqual(['no-button-1', 'no-button-2', 'no-button-3']);
    });
  });

  describe('on a label type with three disagree reasons', () => {
    beforeEach(() => {
      // The fourth button is still in the DOM for every type — only the `defaultOption` flag differs.
      renderReasons([1, 2, 3]);
      choose('no');
    });

    it('4 focuses the comment box rather than picking the hidden fourth button', () => {
      pressDigit(4);

      expect(clicks).toEqual([]);
      expect(validationMenuUi.disagreeReasonTextBox.click).toHaveBeenCalledTimes(1);
    });

    it('5 focuses the comment box too', () => {
      pressDigit(5);

      expect(validationMenuUi.disagreeReasonTextBox.click).toHaveBeenCalledTimes(1);
    });

    it('1-3 still pick their own reasons', () => {
      pressDigit(2);

      expect(clicks).toEqual(['no-button-2']);
    });
  });

  describe('on the "wrong label type" disagree (Expert Validate, #3671, #5409)', () => {
    /** The severity section as the menu leaves it: shown only once a rated type is picked. */
    function renderSeveritySection(shown) {
      document.body.innerHTML = `
                <div id="validate-severity-section" style="display: ${shown ? 'block' : 'none'}"></div>
                <label id="severity-button-1"><input type="radio" id="validate-severity-radio-1"></label>
                <label id="severity-button-2"><input type="radio" id="validate-severity-radio-2"></label>`;
    }

    beforeEach(() => {
      config.adminVersion = true;
      choose('wrongType');
    });

    it('digits rate severity by clicking the radio once a type with a rating has been picked', () => {
      renderSeveritySection(true);

      pressDigit(2);

      expect(clicks).toEqual(['validate-severity-radio-2']);
    });

    it('digits do nothing while the severity section is hidden, so no rating rides along unseen', () => {
      renderSeveritySection(false);

      pressDigit(2);

      expect(clicks).toEqual([]);
      expect(validationMenuUi.optionalCommentTextBox.click).not.toHaveBeenCalled();
    });

    it('4 and 5 reach the comment box rather than severity buttons that do not exist', () => {
      renderSeveritySection(true);

      pressDigit(4);
      pressDigit(5);

      expect(clicks).toEqual([]);
      expect(validationMenuUi.optionalCommentTextBox.click).toHaveBeenCalledTimes(2);
    });

    it('C reaches the optional comment box, not the hidden disagree reason box', () => {
      renderSeveritySection(false);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', key: 'c', bubbles: true }));

      expect(validationMenuUi.optionalCommentTextBox.click).toHaveBeenCalledTimes(1);
      expect(validationMenuUi.disagreeReasonTextBox.click).not.toHaveBeenCalled();
    });
  });

  describe('Enter', () => {
    /** Presses Enter from whatever has focus. */
    function pressEnter() {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }));
    }

    beforeEach(() => {
      document.body.innerHTML = '<input id="select-tag-ts-control" type="text"><input id="other" type="text">';
      validationMenuUi.submitButton.click = vi.fn();
    });

    afterEach(() => {
      document.body.innerHTML = ''; // A box left focused would mute the shortcuts in later tests.
    });

    it('submits from anywhere else, a comment box included', () => {
      document.getElementById('other').focus();
      pressEnter();

      expect(validationMenuUi.submitButton.click).toHaveBeenCalled();
    });

    it('is the tag picker\'s own key while its box has focus, so it does not submit', () => {
      document.getElementById('select-tag-ts-control').focus();
      pressEnter();

      expect(validationMenuUi.submitButton.click).not.toHaveBeenCalled();
    });
  });

  describe('Escape in the tag picker (#5946)', () => {
    beforeEach(() => {
      document.body.innerHTML = '<input id="select-tag-ts-control" type="text">';
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('leaves the box in one press, so S submits again', () => {
      const box = document.getElementById('select-tag-ts-control');
      box.focus();
      box.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));

      expect(document.activeElement).not.toBe(box);
      expect(current.tracker.push).toHaveBeenCalledWith('KeyboardShortcut_UnfocusTagSearch', { code: 'Escape' });

      validationMenuUi.submitButton.click = vi.fn();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's', bubbles: true, cancelable: true }));
      expect(validationMenuUi.submitButton.click).toHaveBeenCalled();
    });
  });

  describe('Ctrl+Z, the other way to press Back (#5409)', () => {
    let undoButton;

    /** Presses Ctrl+Z, or Cmd+Z when `mac` is set. */
    function pressUndo({ mac = false } = {}) {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'KeyZ', key: 'z', ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true,
      }));
    }

    beforeEach(() => {
      undoButton = makeControl();
      current.undoButton = undoButton;
      current.undoValidation = { canUndo: () => true };
      current.zoomControl = { zoomIn: vi.fn(), zoomOut: vi.fn() };
    });

    it('clicks Back', () => {
      pressUndo();

      expect(undoButton.click).toHaveBeenCalledTimes(1);
    });

    it('works as Cmd+Z, without the bare Z zoom riding along', () => {
      pressUndo({ mac: true });

      expect(undoButton.click).toHaveBeenCalledTimes(1);
      expect(current.zoomControl.zoomIn).not.toHaveBeenCalled();
      expect(current.zoomControl.zoomOut).not.toHaveBeenCalled();
    });

    it('does nothing while Back is disabled', () => {
      current.undoValidation.canUndo = () => false;

      pressUndo();

      expect(undoButton.click).not.toHaveBeenCalled();
    });

    it('leaves the comment box to the browser, where it undoes what was typed', () => {
      const commentBox = validationMenuUi.optionalCommentTextBox;
      document.body.appendChild(commentBox);
      commentBox.focus();

      pressUndo();

      expect(undoButton.click).not.toHaveBeenCalled();
      commentBox.remove();
    });
  });

  describe('on the other verdicts', () => {
    it('4 and 5 focus the optional comment box on Agree, never a severity button', () => {
      renderReasons([1, 2, 3, 4]);
      choose('yes');

      pressDigit(4);
      pressDigit(5);

      expect(clicks).toEqual([]);
      expect(validationMenuUi.optionalCommentTextBox.click).toHaveBeenCalledTimes(2);
    });

    it('4 and 5 focus the comment box on Unsure', () => {
      renderReasons([1, 2, 3, 4]);
      choose('unsure');

      pressDigit(4);
      pressDigit(5);

      expect(clicks).toEqual([]);
      expect(validationMenuUi.unsureReasonTextBox.click).toHaveBeenCalledTimes(2);
    });
  });

  describe('the verdicts\' own number keys', () => {
    /** The severity radios and the Unsure reasons, as the menu leaves the DOM on a type with three of each. */
    function renderSeverityAndUnsureReasons() {
      document.body.innerHTML = [1, 2, 3].map((n) => `
        <input type="radio" id="validate-severity-radio-${n}">
        <button id="unsure-button-${n}" class="defaultOption"></button>`).join('');
    }

    beforeEach(() => {
      renderSeverityAndUnsureReasons();
    });

    it('on Agree in Expert Validate, 1-3 rate the label by clicking the severity radio', () => {
      config.adminVersion = true;
      choose('yes');

      pressDigit(1);
      pressDigit(3);

      expect(clicks).toEqual(['validate-severity-radio-1', 'validate-severity-radio-3']);
    });

    it('on Agree in regular Validate, which has no rating, 1-3 do nothing', () => {
      choose('yes');

      pressDigit(2);

      expect(clicks).toEqual([]);
    });

    it('on Unsure, 1-3 pick the Unsure reasons', () => {
      choose('unsure');

      pressDigit(1);
      pressDigit(2);

      expect(clicks).toEqual(['unsure-button-1', 'unsure-button-2']);
    });

    it('before any verdict is chosen, number keys do nothing', () => {
      choose(null);

      pressDigit(1);
      pressDigit(4);

      expect(clicks).toEqual([]);
      for (const box of ['optionalCommentTextBox', 'disagreeReasonTextBox', 'unsureReasonTextBox']) {
        expect(validationMenuUi[box].click).not.toHaveBeenCalled();
      }
    });
  });

  describe('letter shortcuts', () => {
    /**
     * Presses a letter key on the page.
     * @param {string} code - The key's code, e.g. 'KeyH'.
     * @param {boolean} [shiftKey] - Whether Shift is held.
     */
    function pressKey(code, shiftKey = false) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, shiftKey, bubbles: true, cancelable: true }));
    }

    let visible;

    beforeEach(() => {
      document.body.innerHTML = '';
      visible = true;
      current.labelVisibilityControl = {
        ...current.labelVisibilityControl,
        isVisible: () => visible,
        hideLabel: vi.fn(() => { visible = false; }),
        unhideLabel: vi.fn(() => { visible = true; }),
      };
      current.zoomControl = { zoomIn: vi.fn(), zoomOut: vi.fn() };
    });

    it('H hides the label, and a second H brings it back, each logged as a keyboard toggle', () => {
      pressKey('KeyH');
      pressKey('KeyH');

      expect(current.labelVisibilityControl.hideLabel).toHaveBeenCalledTimes(1);
      expect(current.labelVisibilityControl.unhideLabel).toHaveBeenCalledTimes(1);
      expect(current.tracker.push.mock.calls).toEqual([
        ['KeyboardShortcut_HideLabel', { code: 'KeyH' }],
        ['KeyboardShortcut_UnhideLabel', { code: 'KeyH' }],
      ]);
    });

    it('Z zooms in and Shift+Z zooms out', () => {
      pressKey('KeyZ');
      pressKey('KeyZ', true);

      expect(current.zoomControl.zoomIn).toHaveBeenCalledTimes(1);
      expect(current.zoomControl.zoomOut).toHaveBeenCalledTimes(1);
      expect(current.tracker.push.mock.calls).toEqual([
        ['KeyboardShortcut_ZoomIn', { code: 'KeyZ' }],
        ['KeyboardShortcut_ZoomOut', { code: 'KeyZ' }],
      ]);
    });

    it('C on Disagree goes to the disagree reason box', () => {
      choose('no');

      pressKey('KeyC');

      expect(validationMenuUi.disagreeReasonTextBox.click).toHaveBeenCalledTimes(1);
    });

    it('C before any verdict is chosen goes nowhere', () => {
      choose(null);

      pressKey('KeyC');

      for (const box of ['optionalCommentTextBox', 'disagreeReasonTextBox', 'unsureReasonTextBox']) {
        expect(validationMenuUi[box].click).not.toHaveBeenCalled();
      }
    });
  });

  it('a label starting to load pauses the shortcuts, and they come back once it is on screen', () => {
    onLoadingChange(true);
    expect(keyboardLock.hold).toHaveBeenCalledWith('loading');

    onLoadingChange(false);
    expect(keyboardLock.release).toHaveBeenCalledWith('loading');
  });

  it('Escape in a comment box takes focus out of it, so the shortcuts work again', () => {
    const commentBox = validationMenuUi.optionalCommentTextBox;
    document.body.appendChild(commentBox);
    commentBox.focus();

    commentBox.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));

    expect(document.activeElement).not.toBe(commentBox);
    expect(current.tracker.push).toHaveBeenCalledWith('KeyboardShortcut_UnfocusComment', { code: 'Escape' });
    commentBox.remove();
  });

  describe('in a comment box, with what else is going on', () => {
    let commentBox;

    beforeEach(() => {
      commentBox = validationMenuUi.optionalCommentTextBox;
      document.body.appendChild(commentBox);
      commentBox.focus();
    });

    afterEach(() => {
      commentBox.remove(); // A box left focused would mute the shortcuts in later tests.
    });

    it('Escape still leaves the box while the shortcuts are paused', () => {
      const isHeld = keyboardLock.isHeld;
      keyboardLock.isHeld = () => true;
      try {
        commentBox.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
      } finally {
        keyboardLock.isHeld = isHeld;
      }
      expect(document.activeElement).not.toBe(commentBox);
    });

    it('Escape leaves the box rather than closing an open label card popover', () => {
      current.labelCard = { isPopoverOpen: () => true, closeTypeDropdown: vi.fn(() => false) };
      commentBox.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));

      expect(document.activeElement).not.toBe(commentBox);
      expect(current.labelCard.closeTypeDropdown).not.toHaveBeenCalled();
      expect(current.tracker.push).toHaveBeenCalledWith('KeyboardShortcut_UnfocusComment', { code: 'Escape' });
    });

    it('a key that finishes input-method text (Chinese, Japanese) is the input method\'s, not a shortcut', () => {
      validationMenuUi.submitButton.click = vi.fn();
      for (const key of ['Enter', 'Escape']) {
        commentBox.dispatchEvent(new KeyboardEvent('keydown', { code: key, key, isComposing: true, bubbles: true }));
      }
      expect(validationMenuUi.submitButton.click).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(commentBox);
    });
  });

  it('other keys in a comment box are left to the box', () => {
    const commentBox = validationMenuUi.optionalCommentTextBox;
    document.body.appendChild(commentBox);
    commentBox.focus();

    commentBox.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyY', key: 'y', bubbles: true }));

    expect(document.activeElement).toBe(commentBox);
    expect(current.tracker.push).not.toHaveBeenCalled();
    commentBox.remove();
  });
});

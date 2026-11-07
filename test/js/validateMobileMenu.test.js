/**
 * Tests for frontend/js/validate/menu/MobileValidationMenu.js, the verdict menu along the bottom of mobile Validate:
 * which reasons it offers for a label's type, what each tap records on the label and in the log, what a submit sends,
 * how it puts itself back after an Undo, and that nothing lands while the next label is still loading (#5840).
 */

import { loadModules, useUtil } from './loader.js';
import { fakeTracker } from './fakes.js';
import { flush } from './support/routeFetch.js';
import { FakeLabel } from './support/labelContainerHarness.js';

/**
 * The reasons each type's menu offers, in the shape `buildReasonButtonInfo` gives them: CurbRamp's three and three,
 * and Crosswalk's four and two, per the backend catalog. Texts carry the `<br>` the real translations wrap with.
 */
const REASONS = {
  'curb-ramp': {
    'no-button-1': { reasonId: 'wrong-type', buttonText: 'Wrong<br>type', tooltipText: 'It is not a curb ramp (1)' },
    'no-button-2': {
      reasonId: 'driveway', buttonText: 'It is a<br>driveway', tooltipText: 'Driveways are not ramps (2)',
      tooltipImage: 'images/examples/driveway.png',
    },
    'no-button-3': {
      reasonId: 'driveway-transition', buttonText: 'Driveway<br>transition', tooltipText: 'Where a drive meets (3)',
    },
    'unsure-button-1': { reasonId: 'better-image', buttonText: 'Need a<br>better image', tooltipText: 'Blurry (1)' },
    'unsure-button-2': {
      reasonId: 'placement-incorrect', buttonText: 'Placed<br>wrong', tooltipText: 'Off target (2)',
    },
    'unsure-button-3': {
      reasonId: 'ramp-required-unsure', buttonText: 'Ramp<br>needed?', tooltipText: 'Not sure one is needed (3)',
    },
  },
  'crosswalk': {
    'no-button-1': { reasonId: 'wrong-type', buttonText: 'Wrong<br>type', tooltipText: 'Not a crosswalk (1)' },
    'no-button-2': {
      reasonId: 'no-visible-crosswalk', buttonText: 'No crosswalk', tooltipText: 'Nothing painted (2)',
    },
    'no-button-3': { reasonId: 'stop-line', buttonText: 'Stop line', tooltipText: 'Only a stop line (3)' },
    'no-button-4': { reasonId: 'speed-bump', buttonText: 'Speed bump', tooltipText: 'A painted bump (4)' },
    'unsure-button-1': { reasonId: 'better-image', buttonText: 'Need a<br>better image', tooltipText: 'Blurry (1)' },
    'unsure-button-2': {
      reasonId: 'placement-incorrect', buttonText: 'Placed<br>wrong', tooltipText: 'Off target (2)',
    },
  },
};

/** What the stubbed image fetch hands back for an example image, as `util.getImage` does: a data URL. */
const IMAGE_DATA = 'data:image/png;base64,AAAA';

/** The fixed "now" every verdict is cast at. */
const NOW = new Date('2026-08-15T12:00:00Z');

/**
 * The menu as app/views/apps/mobileValidate.scala.html renders it, cut down to what the menu touches.
 * @returns {string} The markup.
 */
function mobileMenuMarkup() {
  return `
    <div id="validation-button-holder">
      <button type="button" id="validate-no-button"><img src="disagree.svg" class="validate-page-button__icon" alt="">
        NO</button>
      <button type="button" id="validate-unsure-button"><img src="unsure.svg" class="validate-page-button__icon" alt="">
        UNSURE</button>
      <button type="button" id="validate-yes-button"><img src="agree.svg" class="validate-page-button__icon" alt="">
        YES</button>
    </div>
    <img src="notch.svg" id="mobile-popup-notch" alt="">
    <div id="validate-why-no-section" class="validation-menu-section">
      <div id="no-reason-options">
        <button type="button" id="no-button-1" class="validation-reason-button button button--small"></button>
        <button type="button" id="no-button-2" class="validation-reason-button button button--small"></button>
        <button type="button" id="no-button-3" class="validation-reason-button button button--small"></button>
        <button type="button" id="no-button-4" class="validation-reason-button button button--small"></button>
        <div class="validate-text-input"><input type="text" id="add-disagree-comment"></div>
      </div>
      <div id="no-submit-section">
        <button type="button" id="no-menu-skip-reason-button" class="validate-page-button">Skip</button>
        <button type="button" id="no-menu-submit-button" class="validate-page-button">Submit</button>
      </div>
    </div>
    <div id="validate-why-unsure-section" class="validation-menu-section">
      <div id="unsure-reason-options">
        <button type="button" id="unsure-button-1" class="validation-reason-button button button--small"></button>
        <button type="button" id="unsure-button-2" class="validation-reason-button button button--small"></button>
        <button type="button" id="unsure-button-3" class="validation-reason-button button button--small"></button>
        <div class="validate-text-input"><input type="text" id="add-unsure-comment"></div>
      </div>
      <div id="unsure-submit-section">
        <button type="button" id="unsure-menu-skip-reason-button" class="validate-page-button">Skip</button>
        <button type="button" id="unsure-menu-submit-button" class="validate-page-button">Submit</button>
      </div>
    </div>`;
}

/** @returns {HTMLElement} The element with that id. */
const $ = (id) => document.getElementById(id);

/** @returns {boolean} Whether the element with that id is marked as the validator's pick. */
const chosen = (id) => $(id).classList.contains('is-chosen');

describe('mobile Validate verdict menu', () => {
  let MobileValidationMenu;
  let tracker;
  let labelContainer;
  let label;
  let loading;
  let hoverDevice;
  let reducedMotion;
  let getImage;
  /**
   * Every listener the menu added, so `tap` can call them with an event jsdom would mark untrusted.
   * @type {Array<{target: EventTarget, type: string, listener: Function}>}
   */
  let listeners;

  /**
   * Fires what a real finger would: an event the browser made, which jsdom cannot forge (its `isTrusted` is fixed to
   * false on anything a script dispatches), so the element's own listeners are called with one directly.
   * @param {HTMLElement} el - What was tapped.
   * @param {string} [type] - The event, 'click' unless said otherwise.
   */
  function tap(el, type = 'click') {
    const event = { isTrusted: true, type, target: el };
    for (const entry of listeners) if (entry.target === el && entry.type === type) entry.listener(event);
  }

  /**
   * Types into a reason box, or clears it, as the validator would.
   * @param {HTMLInputElement} box - The text box.
   * @param {string} text - What it now holds.
   */
  function typeInto(box, text) {
    box.value = text;
    box.dispatchEvent(new Event('input'));
  }

  /**
   * Puts a label on screen the way LabelContainer does, by telling every onLabelReady listener.
   * @param {FakeLabel} next - The label coming on screen.
   */
  function showLabel(next) {
    label = next;
    labelContainer.onLabelReady.mock.calls.forEach(([listener]) => listener(next));
  }

  /**
   * A label of the given type with no verdict yet.
   * @param {string} [labelType] - Its type.
   * @param {Record<string, any>} [props] - Properties already on it, as an Undo leaves them.
   * @returns {FakeLabel} The label.
   */
  function newLabel(labelType = 'CurbRamp', props = {}) {
    const fake = new FakeLabel({ labelId: 7, labelType });
    Object.assign(fake.props, props);
    return fake;
  }

  /** @returns {object} The menu, built over the page as Main.js builds it, with a fresh CurbRamp label on screen. */
  function buildMenu() {
    const menuUI = {
      yesButton: $('validate-yes-button'),
      noButton: $('validate-no-button'),
      unsureButton: $('validate-unsure-button'),
      noMenu: $('validate-why-no-section'),
      disagreeReasonOptions: $('no-reason-options'),
      disagreeReasonTextBox: $('add-disagree-comment'),
      unsureMenu: $('validate-why-unsure-section'),
      unsureReasonOptions: $('unsure-reason-options'),
      unsureReasonTextBox: $('add-unsure-comment'),
      mobilePopupNotch: $('mobile-popup-notch'),
    };
    const menu = new MobileValidationMenu(menuUI, REASONS, labelContainer, tracker);
    showLabel(newLabel());
    return menu;
  }

  /** @returns {Array} What was sent to be saved: `validateCurrentLabel`'s arguments, one entry per submit. */
  const submits = () => labelContainer.validateCurrentLabel.mock.calls;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }).setSystemTime(NOW);
    document.body.innerHTML = mobileMenuMarkup();
    loading = false;
    hoverDevice = false;
    reducedMotion = false;
    vi.stubGlobal('matchMedia', (query) => ({
      matches: (query === '(hover: hover)' && hoverDevice)
        || (query === '(prefers-reduced-motion: reduce)' && reducedMotion),
    }));
    getImage = vi.fn(async () => IMAGE_DATA);
    useUtil({ getImage });
    listeners = [];
    const add = EventTarget.prototype.addEventListener;
    vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (type, listener, options) {
      listeners.push({ target: this, type, listener });
      return add.call(this, type, listener, options);
    });

    tracker = fakeTracker();
    labelContainer = {
      onLabelReady: vi.fn(),
      dropInputWhileLoading: vi.fn(() => loading),
      getCurrentLabel: () => label,
      // On screen well past the double-tap window unless a test says otherwise.
      getProperty: vi.fn((key) => (key === 'renderedTimestamp' ? NOW.getTime() - 5000 : undefined)),
      validateCurrentLabel: vi.fn(),
    };
    ({ MobileValidationMenu } = await loadModules('frontend/js/validate/menu/MobileValidationMenu.js'));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('the reasons on offer', () => {
    test('a type shows only its own reasons, with their text, and hides the slots it has no reason for', () => {
      buildMenu();

      expect($('no-button-2').innerHTML).toBe('It is a<br>driveway');
      expect($('no-button-2').style.display).toBe('flex');
      expect($('no-button-2').classList.contains('defaultOption')).toBe(true);
      expect($('no-button-4').style.display).toBe('none'); // CurbRamp has three disagree reasons, not four.
      expect($('no-button-4').classList.contains('defaultOption')).toBe(false);
      expect($('unsure-button-3').style.display).toBe('flex');
    });

    test('the next label redraws the shared buttons for its own type', () => {
      buildMenu();

      showLabel(newLabel('Crosswalk'));

      expect($('no-button-4').innerHTML).toBe('Speed bump');
      expect($('no-button-4').style.display).toBe('flex');
      expect($('no-button-4').classList.contains('defaultOption')).toBe(true);
      expect($('unsure-button-3').style.display).toBe('none'); // Crosswalk has two unsure reasons.
      expect($('unsure-button-3').classList.contains('defaultOption')).toBe(false);
    });

    // A tap on a touch screen would pin the card open over the pano with no way to dismiss it.
    test('a touch screen gets no tooltip cards', async () => {
      buildMenu();
      await flush();

      expect($('no-button-1').hasAttribute('data-ps-tooltip-html')).toBe(false);
      expect($('no-button-2').hasAttribute('data-ps-tooltip-html')).toBe(false);
    });

    test('a device with a pointer gets a tooltip card, with the example image where the reason has one', async () => {
      hoverDevice = true;
      buildMenu();

      expect($('no-button-1').getAttribute('data-ps-tooltip-html')).toBe('It is not a curb ramp (1)');
      // The example image arrives once fetched.
      expect($('no-button-2').hasAttribute('data-ps-tooltip-html')).toBe(false);
      await flush();
      expect(getImage).toHaveBeenCalledWith('images/examples/driveway.png');
      expect($('no-button-2').getAttribute('data-ps-tooltip-html'))
        .toBe(`Driveways are not ramps (2)<br/><img src="${IMAGE_DATA}" height="140"/>`);
    });

    test('a reason the next type words differently loses the old tooltip', () => {
      hoverDevice = true;
      buildMenu();

      showLabel(newLabel('Crosswalk'));

      expect($('no-button-2').getAttribute('data-ps-tooltip-html')).toBe('Nothing painted (2)');
    });

    test('an example image that arrives after the next label is drawn is dropped, not put on its buttons', async () => {
      hoverDevice = true;
      buildMenu();

      showLabel(newLabel('Crosswalk'));
      await flush();

      expect($('no-button-2').getAttribute('data-ps-tooltip-html')).toBe('Nothing painted (2)');
    });

    test('an example image that fails to load still leaves the tooltip text', async () => {
      hoverDevice = true;
      getImage.mockRejectedValue(new Error('Image not found'));
      buildMenu();
      await flush();

      expect($('no-button-2').getAttribute('data-ps-tooltip-html')).toBe('Driveways are not ramps (2)');
    });
  });

  describe('Yes', () => {
    test('a tap marks Yes, records Agree on the label and submits it with no comment', () => {
      buildMenu();

      tap($('validate-yes-button'));

      expect(chosen('validate-yes-button')).toBe(true);
      expect(chosen('validate-no-button')).toBe(false);
      expect($('validate-why-no-section').style.display).toBe('none');
      expect(label.getProperty('validationResult')).toBe('Agree');
      expect(label.getProperty('comment')).toBe('');
      expect(label.getProperty('reasonId')).toBeNull();
      expect(tracker.push).toHaveBeenCalledWith('ValidationButtonClick_Agree');
      expect(tracker.push).toHaveBeenCalledWith('Click=Submit_Validation=Agree');
      expect(submits()).toEqual([['Agree', NOW, '']]);
    });

    test('a scripted click is logged as a keyboard shortcut, as on desktop', () => {
      buildMenu();

      $('validate-yes-button').click();

      expect(tracker.push).toHaveBeenCalledWith('ValidationKeyboardShortcut_Agree');
      expect(tracker.push).toHaveBeenCalledWith('ValidationKeyboardShortcut_Submit_Validation=Agree');
      expect(submits()).toHaveLength(1);
    });

    // The label is not there long enough to have been looked at, so the tap is taken for the tail of a double tap.
    test('a tap within a moment of the label appearing is logged and dropped, not submitted', () => {
      buildMenu();
      labelContainer.getProperty.mockImplementation(() => NOW.getTime() - 100);

      tap($('validate-yes-button'));

      expect(submits()).toEqual([]);
      expect(tracker.push).toHaveBeenCalledWith('ValidateInputDropped_Debounce', {
        source: 'Submit=Agree', sinceMs: 100,
      });
      expect(document.querySelector('.validate-verdict-float')).toBeNull();
    });
  });

  describe('the thumb that floats off a verdict', () => {
    test('a submit sends a copy of that button\'s own icon up from it, which removes itself when done', () => {
      buildMenu();

      tap($('validate-yes-button'));

      const floater = document.querySelector('.validate-verdict-float');
      expect(floater.getAttribute('src')).toBe('agree.svg');
      expect(floater.parentElement).toBe(document.body);
      floater.dispatchEvent(new Event('animationend'));
      expect(document.querySelector('.validate-verdict-float')).toBeNull();
    });

    test('a quick second verdict replaces the first thumb rather than racing it', () => {
      buildMenu();

      tap($('validate-yes-button'));
      tap($('validate-no-button'));
      tap($('no-menu-submit-button'));

      const floaters = document.querySelectorAll('.validate-verdict-float');
      expect(floaters).toHaveLength(1);
      expect(floaters[0].getAttribute('src')).toBe('disagree.svg');
    });

    test('a validator who asked for less motion gets no thumb, but the verdict still goes through', () => {
      reducedMotion = true;
      buildMenu();

      tap($('validate-unsure-button'));
      tap($('unsure-menu-submit-button'));

      expect(document.querySelector('.validate-verdict-float')).toBeNull();
      expect(submits()).toEqual([['Unsure', NOW, '']]);
    });
  });

  // The two reason menus behave alike, so each case runs against both.
  const MENUS = [
    {
      vote: 'Disagree', verdictButton: 'validate-no-button', menu: 'validate-why-no-section',
      otherMenu: 'validate-why-unsure-section', notch: 'mobile-popup-notch-no', otherNotch: 'mobile-popup-notch-unsure',
      reasonButton: 'no-button-2', otherReasonButton: 'no-button-1', textBox: 'add-disagree-comment',
      submit: 'no-menu-submit-button', skip: 'no-menu-skip-reason-button', option: 'disagreeOption',
      typed: 'disagreeReasonTextBox', reason: 'DisagreeReason', textBoxEvent: 'DisagreeReasonTextbox',
      reasonText: 'It is a driveway', reasonId: 'driveway',
    },
    {
      vote: 'Unsure', verdictButton: 'validate-unsure-button', menu: 'validate-why-unsure-section',
      otherMenu: 'validate-why-no-section', notch: 'mobile-popup-notch-unsure', otherNotch: 'mobile-popup-notch-no',
      reasonButton: 'unsure-button-1', otherReasonButton: 'unsure-button-2', textBox: 'add-unsure-comment',
      submit: 'unsure-menu-submit-button', skip: 'unsure-menu-skip-reason-button', option: 'unsureOption',
      typed: 'unsureReasonTextBox', reason: 'UnsureReason', textBoxEvent: 'UnsureReasonTextbox',
      reasonText: 'Need a better image', reasonId: 'better-image',
    },
  ];

  describe.each(MENUS)('$vote', (m) => {
    test('a tap opens its reason menu under a notch pointing at it, and submits nothing yet', () => {
      buildMenu();
      $('mobile-popup-notch').classList.add(m.otherNotch);

      tap($(m.verdictButton));

      expect(chosen(m.verdictButton)).toBe(true);
      expect(chosen('validate-yes-button')).toBe(false);
      expect($(m.menu).style.display).toBe('flex');
      expect($(m.otherMenu).style.display).toBe('none');
      expect($('mobile-popup-notch').classList.contains(m.notch)).toBe(true);
      expect($('mobile-popup-notch').classList.contains(m.otherNotch)).toBe(false);
      expect(label.getProperty('validationResult')).toBe(m.vote);
      expect(tracker.push).toHaveBeenCalledWith(`ValidationButtonClick_${m.vote}`);
      expect(submits()).toEqual([]);
    });

    test('a scripted click is logged as a keyboard shortcut', () => {
      buildMenu();

      $(m.verdictButton).click();

      expect(tracker.push).toHaveBeenCalledWith(`ValidationKeyboardShortcut_${m.vote}`);
    });

    test('a canned reason is marked, kept on the label, and submitted as its text and id', () => {
      buildMenu();
      tap($(m.verdictButton));

      tap($(m.reasonButton));
      tap($(m.submit));

      expect(chosen(m.reasonButton)).toBe(true);
      expect(tracker.push).toHaveBeenCalledWith(`Click=${m.reason}_Option=${m.reasonButton}`);
      expect(tracker.push).toHaveBeenCalledWith(`Click=Submit_Validation=${m.vote}`);
      // The line break the button wraps its text with is not part of the reason.
      expect(submits()).toEqual([[m.vote, NOW, m.reasonText]]);
      expect(label.getProperty('reasonId')).toBe(m.reasonId);
    });

    test('a scripted reason pick and submit are logged as keyboard shortcuts', () => {
      buildMenu();
      tap($(m.verdictButton));

      $(m.reasonButton).click();
      $(m.submit).click();

      expect(tracker.push).toHaveBeenCalledWith(`KeyboardShortcut_${m.reason}_Option=${m.reasonButton}`);
      expect(tracker.push).toHaveBeenCalledWith(`ValidationKeyboardShortcut_Submit_Validation=${m.vote}`);
    });

    test('picking another reason moves the mark to it', () => {
      buildMenu();
      tap($(m.verdictButton));

      tap($(m.reasonButton));
      tap($(m.otherReasonButton));

      expect(chosen(m.reasonButton)).toBe(false);
      expect(chosen(m.otherReasonButton)).toBe(true);
      expect(label.getProperty(m.option)).toBe(m.otherReasonButton);
    });

    test('typing a reason of their own picks the box over any canned reason, and is what gets submitted', () => {
      buildMenu();
      tap($(m.verdictButton));
      tap($(m.reasonButton));

      typeInto($(m.textBox), 'hidden by a parked car');
      tap($(m.submit));

      expect(chosen(m.textBox)).toBe(true);
      expect(chosen(m.reasonButton)).toBe(false);
      expect(label.getProperty(m.option)).toBe('other');
      expect(label.getProperty(m.typed)).toBe('hidden by a parked car');
      expect(submits()).toEqual([[m.vote, NOW, 'hidden by a parked car']]);
      expect(label.getProperty('reasonId')).toBeNull();
    });

    test('clearing the box takes the pick back off it', () => {
      buildMenu();
      tap($(m.verdictButton));
      typeInto($(m.textBox), 'hidden');

      typeInto($(m.textBox), '');

      expect(chosen(m.textBox)).toBe(false);
      expect(label.getProperty(m.option)).toBeUndefined();
    });

    test('a canned reason picked after typing empties the box', () => {
      buildMenu();
      tap($(m.verdictButton));
      typeInto($(m.textBox), 'hidden');

      tap($(m.reasonButton));

      expect($(m.textBox).value).toBe('');
      expect(chosen(m.textBox)).toBe(false);
      expect(label.getProperty(m.option)).toBe(m.reasonButton);
    });

    test('a tap on the box focuses it and is logged', () => {
      buildMenu();
      tap($(m.verdictButton));

      tap($(m.textBox));
      expect(document.activeElement).toBe($(m.textBox));
      expect(tracker.push).toHaveBeenCalledWith(`Click=${m.textBoxEvent}`);

      $(m.textBox).click();
      expect(tracker.push).toHaveBeenCalledWith(`KeyboardShortcut=${m.textBoxEvent}`);
    });

    test('submitting with no reason picked sends an empty comment', () => {
      buildMenu();
      tap($(m.verdictButton));

      tap($(m.submit));

      expect(submits()).toEqual([[m.vote, NOW, '']]);
      expect(label.getProperty('reasonId')).toBeNull();
    });

    test('Skip drops the reason already picked and submits without one', () => {
      buildMenu();
      tap($(m.verdictButton));
      tap($(m.reasonButton));

      tap($(m.skip));

      expect(label.getProperty(m.option)).toBeUndefined();
      expect(tracker.push).toHaveBeenCalledWith(`Click=${m.reason}_Skip`);
      expect(tracker.push).toHaveBeenCalledWith(`Click=Submit_Validation=${m.vote}`);
      expect(submits()).toEqual([[m.vote, NOW, '']]);
    });

    test('a scripted Skip is logged as a keyboard shortcut submit', () => {
      buildMenu();
      tap($(m.verdictButton));

      $(m.skip).click();

      expect(tracker.push).toHaveBeenCalledWith(`ValidationKeyboardShortcut_Submit_Validation=${m.vote}`);
    });
  });

  describe('the next label', () => {
    test('a new label starts from a blank menu', () => {
      buildMenu();
      tap($('validate-no-button'));
      tap($('no-button-2'));
      typeInto($('add-unsure-comment'), 'too dark');

      showLabel(newLabel());

      for (const id of ['validate-yes-button', 'validate-no-button', 'validate-unsure-button', 'no-button-2',
        'add-unsure-comment']) {
        expect({ [id]: chosen(id) }).toEqual({ [id]: false });
      }
      expect($('validate-why-no-section').style.display).toBe('none');
      expect($('mobile-popup-notch').classList.contains('mobile-popup-notch-no')).toBe(false);
      expect($('add-unsure-comment').value).toBe('');
    });

    test('a submit keeps what was typed on the label, so Undo can bring it back', () => {
      buildMenu();
      typeInto($('add-disagree-comment'), 'a pole');
      tap($('validate-unsure-button'));
      typeInto($('add-unsure-comment'), 'too dark');

      tap($('unsure-menu-submit-button'));

      expect(label.getProperty('disagreeReasonTextBox')).toBe('a pole');
      expect(label.getProperty('unsureReasonTextBox')).toBe('too dark');
    });
  });

  describe('coming back to a label with Undo', () => {
    test.each([
      ['Agree', 'validate-yes-button', null],
      ['Disagree', 'validate-no-button', 'validate-why-no-section'],
      ['Unsure', 'validate-unsure-button', 'validate-why-unsure-section'],
    ])('an %s verdict is shown again as it was cast', (result, button, openMenu) => {
      buildMenu();

      showLabel(newLabel('CurbRamp', { validationResult: result }));

      expect(chosen(button)).toBe(true);
      for (const section of ['validate-why-no-section', 'validate-why-unsure-section']) {
        expect($(section).style.display).toBe(section === openMenu ? 'flex' : 'none');
      }
    });

    test('the canned reasons they had picked are marked again', () => {
      buildMenu();
      $('no-button-1').classList.add('is-chosen');

      showLabel(newLabel('CurbRamp', {
        validationResult: 'Disagree', disagreeOption: 'no-button-3', unsureOption: 'unsure-button-2',
      }));

      expect(chosen('no-button-1')).toBe(false);
      expect(chosen('no-button-3')).toBe(true);
      expect(chosen('unsure-button-2')).toBe(true);
      expect(chosen('add-disagree-comment')).toBe(false);
      expect($('add-disagree-comment').value).toBe('');
    });

    test('the reasons they had typed are put back in their boxes', () => {
      buildMenu();

      showLabel(newLabel('CurbRamp', {
        validationResult: 'Unsure', disagreeOption: 'other', disagreeReasonTextBox: 'a pole',
        unsureOption: 'other', unsureReasonTextBox: 'too dark',
      }));

      expect(chosen('add-disagree-comment')).toBe(true);
      expect($('add-disagree-comment').value).toBe('a pole');
      expect(chosen('add-unsure-comment')).toBe(true);
      expect($('add-unsure-comment').value).toBe('too dark');
    });

    test('a verdict given with no reason comes back with none marked', () => {
      buildMenu();
      typeInto($('add-unsure-comment'), 'left over');

      showLabel(newLabel('CurbRamp', { validationResult: 'Unsure' }));

      expect(document.querySelectorAll('.validation-reason-button.is-chosen')).toHaveLength(0);
      expect($('add-unsure-comment').value).toBe('');
    });
  });

  // Mid-load, "the current label" is already the next one while the previous one's pano is still on screen, so
  // anything written now would land on a label the validator has not seen (#5211).
  describe('while the next label is loading', () => {
    test.each([
      ['Yes', 'validate-yes-button', 'Agree'],
      ['No', 'validate-no-button', 'Disagree'],
      ['Unsure', 'validate-unsure-button', 'Unsure'],
      ['a disagree reason', 'no-button-1', 'DisagreeReason'],
      ['an unsure reason', 'unsure-button-1', 'UnsureReason'],
      ['disagree Skip', 'no-menu-skip-reason-button', 'DisagreeReason_Skip'],
      ['unsure Skip', 'unsure-menu-skip-reason-button', 'UnsureReason_Skip'],
      ['disagree Submit', 'no-menu-submit-button', 'Submit=Disagree'],
      ['unsure Submit', 'unsure-menu-submit-button', 'Submit=Unsure'],
    ])('a tap on %s is dropped without touching the label or the log', (what, id, source) => {
      buildMenu();
      loading = true;

      tap($(id));

      expect(labelContainer.dropInputWhileLoading).toHaveBeenCalledWith(source);
      expect(label.props).toEqual({});
      expect(tracker.push).not.toHaveBeenCalled();
      expect(submits()).toEqual([]);
      expect(document.querySelectorAll('.is-chosen')).toHaveLength(0);
    });

    test.each([
      ['disagree', 'add-disagree-comment', 'DisagreeReason'],
      ['unsure', 'add-unsure-comment', 'UnsureReason'],
    ])('typing in the %s box, or clearing it, leaves the label alone', (which, id, source) => {
      buildMenu();
      loading = true;

      typeInto($(id), 'hidden');
      typeInto($(id), '');

      expect(labelContainer.dropInputWhileLoading).toHaveBeenCalledWith(source);
      expect(label.props).toEqual({});
      expect(chosen(id)).toBe(false);
    });
  });
});

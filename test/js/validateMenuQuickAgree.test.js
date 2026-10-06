/**
 * Tests for ValidationMenu's `quickAgree` option (#5580, Decision 2): on a touch-primary device Agree submits on the
 * tap, as /mobile always has, while a mouse keeps Agree-then-Submit and the optional comment box. Disagree and Unsure
 * wait for Submit either way, and a Submit with no reason chosen sends the verdict without one (mobile's Skip).
 *
 * The thumb that floats off the tapped button comes along with quickAgree, so the float is checked here too: it shows
 * for a counted verdict, never for a mouse, never under reduced motion, and never for a tap the double-tap grace drops.
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub, installUtilitiesMisc, REPO_ROOT, installEscapeHTML, loadModules } = require('./loadGlobalScript');

let reducedMotion;

beforeAll(() => {
  // jsdom has no matchMedia. A hovering mouse, with reduced motion off unless a case turns it on.
  window.matchMedia = (query) => /** @type {MediaQueryList} */ ({
    matches: query === '(prefers-reduced-motion: reduce)' ? reducedMotion : true,
  });
  window.util = {
    assetPath: assetPathStub,
    camelToKebab: (s) => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
    getImage: () => Promise.resolve('img'),
  };
  installUtilitiesMisc();
  installEscapeHTML();
  window.i18next = { t: (key) => key };
  window.structuredClone ??= (v) => JSON.parse(JSON.stringify(v)); // Missing from this jsdom.
  window.eval(fs.readFileSync(path.join(REPO_ROOT, 'public/vendor/tom-select/tom-select-2.6.2.base.min.js'), 'utf8'));
  for (const relPath of ['frontend/js/validate/util/ConstantsValidate.js', 'frontend/js/validate/label/Label.js',
    'frontend/js/validate/menu/ValidationMenu.js']) {
    Object.assign(window, loadModules(relPath));
  }
});

describe('ValidationMenu quickAgree', () => {
  let label;
  let validateCurrentLabel;
  let renderedAt;
  const byId = (id) => document.getElementById(id);
  const verdictButton = (id) => `<button id="${id}"><img class="validate-page-button__icon" src="/t.svg" alt=""></button>`;

  /**
   * Builds the menu against a fresh page and label.
   * @param {object} [opts] - ValidationMenu's options.
   * @returns {object} The menu.
   */
  function build(opts) {
    const menu = new window.ValidationMenu({
      holder: byId('validation-menu-holder'),
      yesButton: byId('validate-yes-button'),
      noButton: byId('validate-no-button'),
      unsureButton: byId('validate-unsure-button'),
      optionalCommentSection: byId('validate-optional-comment-section'),
      optionalCommentTextBox: byId('add-optional-comment'),
      noMenu: byId('validate-why-no-section'),
      disagreeReasonOptions: byId('no-reason-options'),
      disagreeReasonTextBox: byId('add-disagree-comment'),
      unsureMenu: byId('validate-why-unsure-section'),
      unsureReasonOptions: byId('unsure-reason-options'),
      unsureReasonTextBox: byId('add-unsure-comment'),
      submitButton: byId('validate-submit-button'),
    }, opts);
    menu.resetMenu(label);
    return menu;
  }

  beforeEach(() => {
    reducedMotion = false;
    document.body.innerHTML = `
      <div id="validation-menu-holder">
        ${verdictButton('validate-yes-button')}${verdictButton('validate-no-button')}
        ${verdictButton('validate-unsure-button')}
        <div id="validate-optional-comment-section"><input id="add-optional-comment"></div>
        <div id="validate-why-no-section"><div id="no-reason-options">
          ${[1, 2, 3, 4].map((n) => `<button id="no-button-${n}" class="validation-reason-button"></button>`).join('')}
          <input id="add-disagree-comment">
        </div></div>
        <div id="validate-why-unsure-section"><div id="unsure-reason-options">
          ${[1, 2, 3].map((n) => `<button id="unsure-button-${n}" class="validation-reason-button"></button>`).join('')}
          <input id="add-unsure-comment">
        </div></div>
        <button id="validate-submit-button" disabled></button>
      </div>`;

    label = new window.Label({
      label_id: 7, label_type: 'Obstacle', severity: 2, tags: [], ai_tags: null, ai_tags_not_present: null,
      heading: 0, pitch: 0, zoom: 1, canvas_x: 0, canvas_y: 0, pano_id: 'p',
    });
    validateCurrentLabel = jest.fn();
    renderedAt = Date.now() - 5000; // Long past the double-tap grace.
    window.svv = {
      adminVersion: false,
      tracker: { push: jest.fn() },
      labelContainer: {
        getCurrentLabel: () => label,
        dropInputWhileLoading: jest.fn(() => false),
        getProperty: (key) => (key === 'renderedTimestamp' ? renderedAt : undefined),
        validateCurrentLabel,
      },
      panoManager: { styleMarkerForLabel: jest.fn() },
      labelCard: { render: jest.fn() },
    };
    window.defineValidateConstants();
  });

  it('submits Agree on the tap, once, without opening the comment box', () => {
    build({ quickAgree: true });
    byId('validate-yes-button').click();

    expect(validateCurrentLabel).toHaveBeenCalledTimes(1);
    expect(validateCurrentLabel).toHaveBeenCalledWith('Agree', expect.any(Date), '');
    expect(byId('validate-optional-comment-section').style.display).toBe('none');
    expect(byId('validate-yes-button').classList.contains('is-chosen')).toBe(true);
    // Nothing in the immersive dock opens for the frames before the next label: no Submit row, no close control.
    expect(byId('validation-menu-holder').classList.contains('has-verdict')).toBe(false);
    expect(byId('validate-submit-button').disabled).toBe(true);
  });

  it('waits for Submit without quickAgree, with the comment box open', () => {
    build();
    byId('validate-yes-button').click();

    expect(validateCurrentLabel).not.toHaveBeenCalled();
    expect(byId('validate-optional-comment-section').style.display).toBe('block');

    byId('validate-submit-button').click();
    expect(validateCurrentLabel).toHaveBeenCalledTimes(1);
    expect(validateCurrentLabel).toHaveBeenCalledWith('Agree', expect.any(Date), '');
  });

  it('logs a shortcut Agree under quickAgree as a shortcut submit', () => {
    build({ quickAgree: true });
    byId('validate-yes-button').click(); // jsdom's click is untrusted, as a shortcut's scripted click is.

    expect(window.svv.tracker.push).toHaveBeenCalledWith('ValidationKeyboardShortcut_Submit_Validation=Agree');
  });

  it('still waits for Submit on Disagree, and a Submit with no reason sends it without one', () => {
    build({ quickAgree: true });
    byId('validate-no-button').click();
    expect(byId('validation-menu-holder').classList.contains('has-verdict')).toBe(true);

    expect(validateCurrentLabel).not.toHaveBeenCalled();
    expect(byId('validate-why-no-section').style.display).toBe('block');

    byId('validate-submit-button').click();
    expect(validateCurrentLabel).toHaveBeenCalledWith('Disagree', expect.any(Date), '');
  });

  it('floats the verdict\'s thumb off its button under quickAgree', () => {
    build({ quickAgree: true });
    byId('validate-yes-button').click();

    const floats = document.querySelectorAll('.validate-verdict-float');
    expect(floats).toHaveLength(1);
    expect(floats[0].getAttribute('src')).toBe('/t.svg');
  });

  it('floats the Disagree thumb too, once its Submit counts', () => {
    build({ quickAgree: true });
    byId('validate-no-button').click();
    byId('validate-submit-button').click();
    expect(document.querySelectorAll('.validate-verdict-float')).toHaveLength(1);
  });

  it('never floats for a mouse', () => {
    build();
    byId('validate-yes-button').click();
    byId('validate-submit-button').click();
    expect(document.querySelector('.validate-verdict-float')).toBeNull();
  });

  it('never floats under reduced motion, though the verdict still counts', () => {
    reducedMotion = true;
    build({ quickAgree: true });
    byId('validate-yes-button').click();
    expect(document.querySelector('.validate-verdict-float')).toBeNull();
    expect(validateCurrentLabel).toHaveBeenCalledTimes(1);
  });

  it('neither floats nor submits a tap inside the double-tap grace', () => {
    renderedAt = Date.now();
    build({ quickAgree: true });
    byId('validate-yes-button').click();
    expect(validateCurrentLabel).not.toHaveBeenCalled();
    expect(document.querySelector('.validate-verdict-float')).toBeNull();
    expect(window.svv.tracker.push).toHaveBeenCalledWith('ValidateInputDropped_Debounce', expect.anything());
  });

  it('shows just the chosen Agree on an undo back to it, with no comment box to flash open', () => {
    label.setProperty('validationResult', 'Agree');
    build({ quickAgree: true });
    expect(byId('validate-yes-button').classList.contains('is-chosen')).toBe(true);
    expect(byId('validate-optional-comment-section').style.display).toBe('none');
    expect(byId('validation-menu-holder').classList.contains('has-verdict')).toBe(false);
  });
});

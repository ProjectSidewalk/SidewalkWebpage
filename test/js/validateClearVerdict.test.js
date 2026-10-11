/**
 * Tests for taking a verdict back from immersive Validate's dock (DesktopValidationMenu.clearVerdict, #5560).
 *
 * The X in the dock's corner is the only way to un-answer a label without submitting it, so what must hold is that
 * nothing of the answer survives it: not the verdict, not a reason, not typed text, and not an enabled Submit that
 * would send it anyway. The X hides itself with the verdict, so the tests also pin where keyboard focus goes, and that
 * the X, like every other menu control, refuses to act while the next label's pano is still loading (#5211).
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub, installUtilitiesMisc, REPO_ROOT, installEscapeHTML, loadModules } = require('./loadGlobalScript');

/**
 * Loads bare top-level declarations out of a production file into window scope.
 * @param {string} relPath - Path under the repo root.
 * @param {...string} names - The classes or functions the file declares.
 */
function loadClass(relPath) {
  Object.assign(window, loadModules(relPath));
}

beforeAll(() => {
  window.matchMedia = () => /** @type {MediaQueryList} */ ({ matches: true }); // jsdom has none; act as a mouse.
  window.util = {
    assetPath: assetPathStub,
    isMobile: () => false,
    camelToKebab: (s) => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
    getImage: () => Promise.resolve('img'),
  };
  installUtilitiesMisc();
  installEscapeHTML();
  window.i18next = { t: (key) => key };
  window.structuredClone ??= (v) => JSON.parse(JSON.stringify(v)); // Missing from this jsdom.
  window.eval(fs.readFileSync(path.join(REPO_ROOT, 'public/vendor/tom-select/tom-select-2.6.2.base.min.js'), 'utf8'));
  loadClass('frontend/js/validate/util/ConstantsValidate.js');
  loadClass('frontend/js/validate/label/Label.js');
  loadClass('frontend/js/validate/menu/DesktopValidationMenu.js');
});

describe('DesktopValidationMenu.clearVerdict', () => {
  let label;
  let loading;
  let tracker;
  let labelContainer;
  const config = { adminVersion: false, tagsByLabelType: { Obstacle: [] } };
  const byId = (id) => document.getElementById(id);

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="validation-menu-holder">
        <button id="validate-verdict-clear"></button>
        <button id="validate-yes-button"></button>
        <button id="validate-no-button"></button>
        <button id="validate-unsure-button"></button>
        <template id="current-tag-template"><div class="current-tag"><div class="tag-name"></div><button class="remove-tag-x"></button></div></template>
        <div id="validate-tags-section">
          <div id="current-tags-list"></div>
          <div id="sidewalk-ai-suggestions-block"><template id="sidewalk-ai-suggested-tag-template"><div class="sidewalk-ai-suggested-tag"></div></template></div>
          <select id="select-tag"></select>
        </div>
        <div id="validate-severity-section"><div id="validate-severity-header"></div>
          <div id="severity-radio-holder">${[1, 2, 3].map((n) => `
            <label class="severity-button" id="severity-button-${n}" data-severity="${n}">
              <input type="radio" name="label-severity" id="validate-severity-radio-${n}" class="severity-button__radio">
              <img class="severity-button__icon" alt=""><span class="severity-button__label"></span>
            </label>`).join('')}
          </div>
        </div>
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
    }, config);
    loading = false;
    tracker = { push: jest.fn() };
    labelContainer = {
      getCurrentLabel: () => label,
      dropInputWhileLoading: jest.fn(() => loading),
      onLabelShown: jest.fn(),
    };

    const menu = new window.DesktopValidationMenu({
      holder: byId('validation-menu-holder'),
      verdictClearButton: byId('validate-verdict-clear'),
      yesButton: byId('validate-yes-button'),
      noButton: byId('validate-no-button'),
      unsureButton: byId('validate-unsure-button'),
      tagsMenu: byId('validate-tags-section'),
      severityMenu: byId('validate-severity-section'),
      optionalCommentSection: byId('validate-optional-comment-section'),
      optionalCommentTextBox: byId('add-optional-comment'),
      noMenu: byId('validate-why-no-section'),
      disagreeReasonOptions: byId('no-reason-options'),
      disagreeReasonTextBox: byId('add-disagree-comment'),
      unsureMenu: byId('validate-why-unsure-section'),
      unsureReasonOptions: byId('unsure-reason-options'),
      unsureReasonTextBox: byId('add-unsure-comment'),
      submitButton: byId('validate-submit-button'),
      currentTags: byId('current-tags-list'),
      aiSuggestionSection: byId('sidewalk-ai-suggestions-block'),
      currentTagTemplate: byId('current-tag-template'),
      aiSuggestedTagTemplate: byId('sidewalk-ai-suggested-tag-template'),
    }, config, window.buildReasonButtonInfo(), labelContainer, { render: jest.fn(), onTypePicked: jest.fn() },
    { styleMarkerForLabel: jest.fn() }, tracker);
    menu.resetMenu(label);
  });

  /** Answers No with a typed reason, the fullest state there is to take back. */
  function answerNoWithReason() {
    byId('validate-no-button').click();
    byId('add-disagree-comment').value = 'blocked by a car';
    label.setProperty('disagreeReasonTextBox', 'blocked by a car');
  }

  it('forgets the verdict, its reasons and typed text, and disables Submit', () => {
    answerNoWithReason();
    expect(byId('validation-menu-holder').classList.contains('has-verdict')).toBe(true);
    expect(byId('validate-submit-button').disabled).toBe(false);

    byId('validate-verdict-clear').click();

    expect(label.getProperty('validationResult')).toBeUndefined();
    expect(label.getProperty('disagreeOption')).toBeUndefined();
    // Back to the empty strings Label starts them at, not undefined.
    expect(label.getProperty('disagreeReasonTextBox')).toBe('');
    expect(label.getProperty('agreeComment')).toBe('');
    expect(byId('add-disagree-comment').value).toBe('');
    expect(byId('validate-no-button').classList.contains('is-chosen')).toBe(false);
    expect(byId('validation-menu-holder').classList.contains('has-verdict')).toBe(false);
    expect(byId('validate-submit-button').disabled).toBe(true);
  });

  it('logs the verdict it took back', () => {
    answerNoWithReason();
    byId('validate-verdict-clear').click();
    expect(tracker.push).toHaveBeenCalledWith('Click_ClearVerdict', { verdict: 'Disagree' });
  });

  it('does nothing, and logs nothing, when there is no verdict to take back', () => {
    byId('validate-verdict-clear').click();
    expect(tracker.push).not.toHaveBeenCalledWith('Click_ClearVerdict', expect.anything());
  });

  it('moves focus from the X, which hides itself, to the verdict button it undid', () => {
    answerNoWithReason();
    byId('validate-verdict-clear').focus();
    byId('validate-verdict-clear').click();
    expect(document.activeElement).toBe(byId('validate-no-button'));
  });

  it('leaves focus alone when the X was clicked without being focused', () => {
    answerNoWithReason();
    byId('add-disagree-comment').focus();
    byId('validate-verdict-clear').click();
    expect(document.activeElement).toBe(byId('add-disagree-comment'));
  });

  it('refuses to act while the next label is loading (#5211)', () => {
    answerNoWithReason();
    loading = true;
    byId('validate-verdict-clear').click();
    expect(labelContainer.dropInputWhileLoading).toHaveBeenCalledWith('ClearVerdict');
    expect(label.getProperty('validationResult')).toBe('Disagree');
  });
});

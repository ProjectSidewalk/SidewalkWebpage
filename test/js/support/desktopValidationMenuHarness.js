/**
 * Desktop Validate's verdict menu as the page hands it to DesktopValidationMenu: the markup cut down from
 * app/views/apps/validate.scala.html, and the elements object Main.js builds from it, so every suite drives the menu
 * against the elements the real page gives it (#5840).
 */

/**
 * Draws the menu column into the page. Only Expert Validate's markup has the label type picker section.
 * @param {{adminVersion?: boolean}} [opts] - Whether this is Expert Validate.
 * @returns {object} The menu's elements, keyed the way Main.js passes them to DesktopValidationMenu.
 */
export function renderDesktopMenu({ adminVersion = false } = {}) {
  const severityButtons = [1, 2, 3].map((n) => `
    <label class="severity-button" id="severity-button-${n}" for="validate-severity-radio-${n}" data-severity="${n}">
      <input type="radio" name="label-severity" id="validate-severity-radio-${n}" value="${n}"
        class="severity-button__radio">
      <img src="" alt="" class="severity-button__icon"><span class="severity-button__label"></span>
    </label>`).join('');
  const reasonButtons = (prefix, count) => [...Array(count).keys()]
    .map((i) => `<button type="button" id="${prefix}${i + 1}" class="validation-reason-button"></button>`).join('');

  document.body.innerHTML = `
    <template id="current-tag-template">
      <div class="current-tag tag-pill">
        <div class="tag-name"></div><button type="button" class="remove-tag-x"></button>
      </div>
    </template>
    <div id="validation-menu-holder">
      <button type="button" id="validate-verdict-clear" aria-label="Clear your answer"></button>
      <div id="main-validate-section">
        <div id="main-validate-header"></div>
        <button type="button" id="validate-yes-button"></button>
        <button type="button" id="validate-no-button"></button>
        <button type="button" id="validate-unsure-button"></button>
      </div>
      ${adminVersion ? `<div id="validate-label-type-section">
        <div id="label-type-picker" aria-labelledby="validate-label-type-header"></div>
      </div>` : ''}
      <div id="validate-tags-section">
        <div id="validate-tags-header">Add/remove tags</div>
        <div id="current-tags-list"></div>
        <div id="sidewalk-ai-suggestions-block">
          <div class="sidewalk-ai-suggestions-list-holder">
            <template id="sidewalk-ai-suggested-tag-template">
              <div class="sidewalk-ai-suggested-tag tag-pill"></div>
            </template>
          </div>
        </div>
        <select id="select-tag" multiple aria-hidden="true"></select>
      </div>
      <div id="validate-severity-section">
        <div id="validate-severity-header"></div>
        <div id="severity-radio-holder" role="radiogroup" aria-labelledby="validate-severity-header">
          ${severityButtons}
        </div>
      </div>
      <div id="validate-optional-comment-section"><input type="text" id="add-optional-comment"></div>
      <div id="validate-why-no-section">
        <div id="no-reason-options">
          ${reasonButtons('no-button-', 4)}
          <div class="validate-text-input"><input type="text" id="add-disagree-comment"></div>
        </div>
      </div>
      <div id="validate-why-unsure-section">
        <div id="unsure-reason-options">
          ${reasonButtons('unsure-button-', 3)}
          <div class="validate-text-input"><input type="text" id="add-unsure-comment"></div>
        </div>
      </div>
      <div id="validate-submit-section">
        <button type="button" id="validate-undo-button"></button>
        <button type="button" id="validate-submit-button"><u>S</u>ubmit</button>
      </div>
    </div>`;

  const byId = (id) => document.getElementById(id);
  return {
    holder: byId('validation-menu-holder'),
    verdictClearButton: byId('validate-verdict-clear'),
    header: byId('main-validate-header'),
    yesButton: byId('validate-yes-button'),
    noButton: byId('validate-no-button'),
    unsureButton: byId('validate-unsure-button'),
    labelTypeMenu: byId('validate-label-type-section'),
    labelTypePicker: byId('label-type-picker'),
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
    mobilePopupNotch: null,
    currentTags: byId('current-tags-list'),
    aiSuggestionSection: byId('sidewalk-ai-suggestions-block'),
    currentTagTemplate: byId('current-tag-template'),
    aiSuggestedTagTemplate: byId('sidewalk-ai-suggested-tag-template'),
  };
}

/**
 * Clicks the way a mouse does. The menu logs a mouse click and a keyboard shortcut (a scripted `click()`) under
 * different names by reading `isTrusted`, which a page can never set. jsdom does set it on the click a `<label>` passes
 * on to its control, so the click goes through a throwaway label.
 * @param {HTMLElement} target - What is clicked; a button or input with an id.
 */
export function trustedClick(target) {
  const label = document.createElement('label');
  label.htmlFor = target.id;
  document.body.append(label);
  label.click();
  label.remove();
}

/**
 * Initializes the primary validation UI at the bottom of the mobile screen.
 */

import { svv } from '../svv.js';
import { util } from '../../common/utilities.js';
import { LabelContainer } from '../label/LabelContainer.js';
/** @typedef {import('../label/Label.js').Label} Label */

export class MobileValidationMenu {
  #menuUI;
  #disagreeReasonButtons;
  #unsureReasonButtons;

  /**
   * @param {Record<string, HTMLElement>} menuUI - Validation menu UI elements.
   */
  constructor(menuUI) {
    this.#menuUI = menuUI;
    this.#disagreeReasonButtons = MobileValidationMenu.#reasonButtonsIn(menuUI.disagreeReasonOptions);
    this.#unsureReasonButtons = MobileValidationMenu.#reasonButtonsIn(menuUI.unsureReasonOptions);

    this.#init();
  }

  #init() {
    const menuUI = this.#menuUI;

    // Add onclick for each validation button. An untrusted (scripted) click is logged as a shortcut, as on desktop.
    menuUI.yesButton.addEventListener('click', (e) => {
      // A tap that lands while the next label's pano is still loading would be answering the label on screen and
      // recording it against the one behind it (#5211). The verdict row is dimmed for that window; this is what
      // catches a tap that beat the class onto the page.
      if (svv.labelContainer.dropInputWhileLoading('Agree')) return;
      svv.tracker.push(e.isTrusted ? 'ValidationButtonClick_Agree' : 'ValidationKeyboardShortcut_Agree');
      this.#setYesView();
      svv.labelContainer.getCurrentLabel().setProperty('validationResult', 'Agree');

      // Not adding comments on mobile when voting yes, just submit the validation.
      this.#validateLabel('Agree', !e.isTrusted);
    });
    menuUI.noButton.addEventListener('click', (e) => {
      if (svv.labelContainer.dropInputWhileLoading('Disagree')) return;
      svv.tracker.push(e.isTrusted ? 'ValidationButtonClick_Disagree' : 'ValidationKeyboardShortcut_Disagree');
      this.#setNoView();
      svv.labelContainer.getCurrentLabel().setProperty('validationResult', 'Disagree');
    });
    menuUI.unsureButton.addEventListener('click', (e) => {
      if (svv.labelContainer.dropInputWhileLoading('Unsure')) return;
      svv.tracker.push(e.isTrusted ? 'ValidationButtonClick_Unsure' : 'ValidationKeyboardShortcut_Unsure');
      this.#setUnsureView();
      svv.labelContainer.getCurrentLabel().setProperty('validationResult', 'Unsure');
    });

    // Add onclick for disagree and unsure reason buttons.
    // Both loops guard ahead of their tracker push rather than leaving it to the setter they call: the push
    // would otherwise record the reason as chosen and the drop would be logged right after it, so the one
    // interaction the load guard exists to refuse is the one that reads in the logs as having landed (#5211).
    for (const reasonButton of this.#disagreeReasonButtons) {
      reasonButton.addEventListener('click', (e) => {
        if (svv.labelContainer.dropInputWhileLoading('DisagreeReason')) return;
        svv.tracker.push(`${e.isTrusted ? 'Click=' : 'KeyboardShortcut_'}DisagreeReason_Option=${reasonButton.id}`);
        this.#setDisagreeReason(reasonButton.id);
      });
    }
    for (const reasonButton of this.#unsureReasonButtons) {
      reasonButton.addEventListener('click', (e) => {
        if (svv.labelContainer.dropInputWhileLoading('UnsureReason')) return;
        svv.tracker.push(`${e.isTrusted ? 'Click=' : 'KeyboardShortcut_'}UnsureReason_Option=${reasonButton.id}`);
        this.#setUnsureReason(reasonButton.id);
      });
    }

    // Log clicks to the two text boxes.
    menuUI.disagreeReasonTextBox.addEventListener('click', (e) => {
      menuUI.disagreeReasonTextBox.focus();
      svv.tracker.push(e.isTrusted ? 'Click=DisagreeReasonTextbox' : 'KeyboardShortcut=DisagreeReasonTextbox');
    });
    menuUI.unsureReasonTextBox.addEventListener('click', (e) => {
      menuUI.unsureReasonTextBox.focus();
      svv.tracker.push(e.isTrusted ? 'Click=UnsureReasonTextbox' : 'KeyboardShortcut=UnsureReasonTextbox');
    });

    // Add oninput for disagree and unsure other reason text boxes.
    // Guarded at the handler, not left to the setter each one calls: the empty branch writes the cleared reason onto
    // the current label directly, so without this the two branches would answer a mid-load event differently. They
    // are believed unreachable then — KeyboardManager goes inert while a reason box has focus, so a load cannot start
    // from there, and once one has the box is only reachable by pointer, which is blocked — but half a guard on a
    // handler is a trap for whoever changes it next (#5211).
    menuUI.disagreeReasonTextBox.addEventListener('input', () => {
      if (svv.labelContainer.dropInputWhileLoading('DisagreeReason')) return;
      if (menuUI.disagreeReasonTextBox.value === '') {
        menuUI.disagreeReasonTextBox.classList.remove('is-chosen');
        svv.labelContainer.getCurrentLabel().setProperty('disagreeOption', undefined);
      } else {
        this.#setDisagreeReason('other');
      }
    });
    menuUI.unsureReasonTextBox.addEventListener('input', () => {
      if (svv.labelContainer.dropInputWhileLoading('UnsureReason')) return;
      if (menuUI.unsureReasonTextBox.value === '') {
        menuUI.unsureReasonTextBox.classList.remove('is-chosen');
        svv.labelContainer.getCurrentLabel().setProperty('unsureOption', undefined);
      } else {
        this.#setUnsureReason('other');
      }
    });

    // Add onclick for the submit buttons in the no and unsure menus.
    document.getElementById('no-menu-submit-button').addEventListener('click', (e) => {
      this.#validateLabel('Disagree', !e.isTrusted);
    });
    document.getElementById('unsure-menu-submit-button').addEventListener('click', (e) => {
      this.#validateLabel('Unsure', !e.isTrusted);
    });

    // Add onclick for the skip-reason buttons, which submit the validation without an associated reason.
    // Guarded here rather than left to #validateLabel: these clear the reason on the current label before they
    // submit, so mid-load the clear lands on the label that isn't on screen yet, even though the submit is refused.
    // Their own sources, not the reason setters': a skip is a submit, so a drop here means the validator was ahead
    // of a slow load, which is the opposite of what a dropped reason pick means.
    document.getElementById('no-menu-skip-reason-button').addEventListener('click', (e) => {
      if (svv.labelContainer.dropInputWhileLoading('DisagreeReason_Skip')) return;
      svv.tracker.push('Click=DisagreeReason_Skip');
      svv.labelContainer.getCurrentLabel().setProperty('disagreeOption', undefined);
      this.#validateLabel('Disagree', !e.isTrusted);
    });
    document.getElementById('unsure-menu-skip-reason-button').addEventListener('click', (e) => {
      if (svv.labelContainer.dropInputWhileLoading('UnsureReason_Skip')) return;
      svv.tracker.push('Click=UnsureReason_Skip');
      svv.labelContainer.getCurrentLabel().setProperty('unsureOption', undefined);
      this.#validateLabel('Unsure', !e.isTrusted);
    });
  }

  resetMenu(label) {
    const menuUI = this.#menuUI;
    const prevValResult = label.getProperty('validationResult');

    // Rerender the reason buttons, so that they match the correct label type when we allow such an undo (#4034).
    this.#renderReasonButtons(label);

    if (prevValResult === undefined) {
      // This is a new label (not returning from an undo), so reset everything.
      menuUI.yesButton.classList.remove('is-chosen');
      menuUI.noButton.classList.remove('is-chosen');
      menuUI.unsureButton.classList.remove('is-chosen');
      menuUI.noMenu.style.display = 'none';
      menuUI.unsureMenu.style.display = 'none';
      menuUI.mobilePopupNotch.classList.remove('mobile-popup-notch-no', 'mobile-popup-notch-unsure');
      MobileValidationMenu.#clearChosen(this.#disagreeReasonButtons);
      MobileValidationMenu.#clearChosen(this.#unsureReasonButtons);
      menuUI.disagreeReasonTextBox.classList.remove('is-chosen');
      menuUI.unsureReasonTextBox.classList.remove('is-chosen');
      menuUI.disagreeReasonTextBox.value = '';
      menuUI.unsureReasonTextBox.value = '';
    } else {
      // This is a validation that they are going back to, so update all the views to match what they had before.
      const disagreeOption = label.getProperty('disagreeOption');
      MobileValidationMenu.#clearChosen(this.#disagreeReasonButtons);
      if (disagreeOption === 'other') {
        menuUI.disagreeReasonTextBox.classList.add('is-chosen');
        menuUI.disagreeReasonTextBox.value = label.getProperty('disagreeReasonTextBox');
      } else {
        menuUI.disagreeReasonTextBox.classList.remove('is-chosen');
        menuUI.disagreeReasonTextBox.value = '';
        this.#reasonButton(disagreeOption)?.classList.add('is-chosen');
      }

      const unsureOption = label.getProperty('unsureOption');
      MobileValidationMenu.#clearChosen(this.#unsureReasonButtons);
      if (unsureOption === 'other') {
        menuUI.unsureReasonTextBox.classList.add('is-chosen');
        menuUI.unsureReasonTextBox.value = label.getProperty('unsureReasonTextBox');
      } else {
        menuUI.unsureReasonTextBox.classList.remove('is-chosen');
        menuUI.unsureReasonTextBox.value = '';
        this.#reasonButton(unsureOption)?.classList.add('is-chosen');
      }

      if (prevValResult === 'Agree') this.#setYesView();
      else if (prevValResult === 'Disagree') this.#setNoView();
      else if (prevValResult === 'Unsure') this.#setUnsureView();
    }
  }

  /**
   * @param {HTMLElement} options - A reason menu's options holder.
   * @returns {HTMLElement[]} Its reason buttons, in menu order.
   */
  static #reasonButtonsIn(options) {
    return [...options.querySelectorAll(':scope > .validation-reason-button')];
  }

  /**
   * @param {HTMLElement[]} buttons
   */
  static #clearChosen(buttons) {
    for (const button of buttons) button.classList.remove('is-chosen');
  }

  /**
   * @param {string|undefined} id - A reason button's id; undefined for a label with no reason picked.
   * @returns {HTMLElement|null}
   */
  #reasonButton(id) {
    return [...this.#disagreeReasonButtons, ...this.#unsureReasonButtons].find((b) => b.id === id) ?? null;
  }

  /**
   * Fills in the text, tooltip, and visibility of every disagree and unsure reason button for a label's type.
   *
   * The buttons are one shared set of elements, so a type that offers a given reason gets it shown and marked
   * `defaultOption`, while a type that doesn't offer it gets it hidden.
   *
   * @param {Label} label - The label whose type the buttons should describe.
   */
  #renderReasonButtons(label) {
    const labelType = util.camelToKebab(label.getAuditProperty('labelType'));
    for (const reasonButton of [...this.#disagreeReasonButtons, ...this.#unsureReasonButtons]) {
      const buttonInfo = svv.reasonButtonInfo[labelType][reasonButton.id];
      if (buttonInfo) {
        reasonButton.innerHTML = buttonInfo.buttonText;

        reasonButton.removeAttribute('data-ps-tooltip');
        if (buttonInfo.tooltipImage) {
          util.getImage(buttonInfo.tooltipImage).then((img) => {
            MobileValidationMenu.#addTooltip(reasonButton, buttonInfo.tooltipText, img);
          });
        } else {
          MobileValidationMenu.#addTooltip(reasonButton, buttonInfo.tooltipText);
        }

        reasonButton.classList.add('defaultOption');
        reasonButton.style.display = 'flex';
      } else {
        reasonButton.style.display = 'none';
        reasonButton.classList.remove('defaultOption');
      }
    }
  }

  #setYesView() {
    const menuUI = this.#menuUI;
    menuUI.yesButton.classList.add('is-chosen');
    menuUI.noButton.classList.remove('is-chosen');
    menuUI.unsureButton.classList.remove('is-chosen');

    menuUI.noMenu.style.display = 'none';
    menuUI.unsureMenu.style.display = 'none';
    menuUI.mobilePopupNotch.classList.remove('mobile-popup-notch-no', 'mobile-popup-notch-unsure');
  }

  #setNoView() {
    const menuUI = this.#menuUI;
    menuUI.yesButton.classList.remove('is-chosen');
    menuUI.noButton.classList.add('is-chosen');
    menuUI.unsureButton.classList.remove('is-chosen');
    menuUI.noMenu.style.display = 'flex';
    menuUI.unsureMenu.style.display = 'none';
    menuUI.mobilePopupNotch.classList.remove('mobile-popup-notch-unsure');
    menuUI.mobilePopupNotch.classList.add('mobile-popup-notch-no');
  }

  #setUnsureView() {
    const menuUI = this.#menuUI;
    menuUI.yesButton.classList.remove('is-chosen');
    menuUI.noButton.classList.remove('is-chosen');
    menuUI.unsureButton.classList.add('is-chosen');
    menuUI.noMenu.style.display = 'none';
    menuUI.unsureMenu.style.display = 'flex';
    menuUI.mobilePopupNotch.classList.remove('mobile-popup-notch-no');
    menuUI.mobilePopupNotch.classList.add('mobile-popup-notch-unsure');
  }

  /**
   * Adds a tooltip to the given element with the given text and image (if given).
   * @param {Element} elem - Element to add the tooltip to.
   * @param {string} tooltipText - Text to display in the tooltip.
   * @param {string} [img] - Optional image to display in the tooltip.
   */
  static #addTooltip(elem, tooltipText, img) {
    if (!window.matchMedia('(hover: hover)').matches) return; // A tap would pin it open on a touch device.
    const imgHtml = img ? `<br/><img src="${util.escapeHTML(img)}" height="140"/>` : '';
    // eslint-disable-next-line ps/escape-in-markup -- translations can contain <b>.
    elem.setAttribute('data-ps-tooltip', `${tooltipText}${imgHtml}`);
  }

  // VALIDATING 'NO' SECTION.
  /**
   * Records the reason chosen for a disagree verdict.
   *
   * Guarded because a reason button keeps focus after a click, and Enter natively activates a focused button whether
   * or not KeyboardManager is listening — so a second Enter inside the load window writes the reason onto the label
   * that hasn't appeared on screen yet (#5211). `resetMenu` clears the chosen styling for a new label but not its
   * properties, so the reason would ride along invisibly and be submitted as the canned comment for a reason nobody
   * picked for the label it lands on.
   *
   * @param {string} id - Id of the chosen reason button, or 'other' for the free-text box.
   */
  #setDisagreeReason(id) {
    if (svv.labelContainer.dropInputWhileLoading('DisagreeReason')) return;
    const menuUI = this.#menuUI;
    MobileValidationMenu.#clearChosen(this.#disagreeReasonButtons);
    if (id === 'other') {
      menuUI.disagreeReasonTextBox.classList.add('is-chosen');
      svv.labelContainer.getCurrentLabel().setProperty('disagreeOption', 'other');
    } else {
      menuUI.disagreeReasonTextBox.classList.remove('is-chosen');
      menuUI.disagreeReasonTextBox.value = '';
      svv.labelContainer.getCurrentLabel().setProperty('disagreeOption', id);
      this.#reasonButton(id)?.classList.add('is-chosen');
    }
  }

  // VALIDATING 'UNSURE' SECTION.
  /**
   * Records the reason chosen for an unsure verdict.
   *
   * Guarded because a reason button keeps focus after a click, and Enter natively activates a focused button whether
   * or not KeyboardManager is listening — so a second Enter inside the load window writes the reason onto the label
   * that hasn't appeared on screen yet (#5211). `resetMenu` clears the chosen styling for a new label but not its
   * properties, so the reason would ride along invisibly and be submitted as the canned comment for a reason nobody
   * picked for the label it lands on.
   *
   * @param {string} id - Id of the chosen reason button, or 'other' for the free-text box.
   */
  #setUnsureReason(id) {
    if (svv.labelContainer.dropInputWhileLoading('UnsureReason')) return;
    const menuUI = this.#menuUI;
    MobileValidationMenu.#clearChosen(this.#unsureReasonButtons);
    if (id === 'other') {
      menuUI.unsureReasonTextBox.classList.add('is-chosen');
      svv.labelContainer.getCurrentLabel().setProperty('unsureOption', 'other');
    } else {
      menuUI.unsureReasonTextBox.classList.remove('is-chosen');
      menuUI.unsureReasonTextBox.value = '';
      svv.labelContainer.getCurrentLabel().setProperty('unsureOption', id);
      this.#reasonButton(id)?.classList.add('is-chosen');
    }
  }

  saveValidationState() {
    const menuUI = this.#menuUI;
    const currLabel = svv.labelContainer.getCurrentLabel();
    currLabel.setProperty('disagreeReasonTextBox', menuUI.disagreeReasonTextBox.value);
    currLabel.setProperty('unsureReasonTextBox', menuUI.unsureReasonTextBox.value);
  }

  /**
   * Validates a single label from a button click.
   * @param {string} action - Validation action - must be one of Agree, Disagree, or Unsure.
   * @param {boolean} keyboardShortcut - Whether or not the validation was triggered by a keyboard shortcut.
   */
  #validateLabel(action, keyboardShortcut) {
    // Everything below writes to whatever getCurrentLabel() returns, which mid-load is already the next label (#5211).
    if (svv.labelContainer.dropInputWhileLoading(`Submit=${action}`)) return;

    const actionStr = keyboardShortcut ? 'ValidationKeyboardShortcut_Submit_Validation=' : 'Click=Submit_Validation=';
    const timestamp = new Date();
    svv.tracker.push(actionStr + action);
    const currLabel = svv.labelContainer.getCurrentLabel();

    // Save anything they typed in either text box so that it's there again if they undo their validation.
    this.saveValidationState();

    // Fill in the comment based on the disagree options they picked or one of the free form text boxes.
    let comment = '';
    if (action === 'Disagree') {
      const disagreeReason = currLabel.getProperty('disagreeOption');
      if (disagreeReason === 'other') {
        comment = currLabel.getProperty('disagreeReasonTextBox');
      } else if (disagreeReason) {
        comment = this.#reasonButton(disagreeReason).innerHTML.replace('<br>', ' ');
      }
    } else if (action === 'Unsure') {
      const unsureReason = currLabel.getProperty('unsureOption');
      if (unsureReason === 'other') {
        comment = currLabel.getProperty('unsureReasonTextBox');
      } else if (unsureReason) {
        comment = this.#reasonButton(unsureReason).innerHTML.replace('<br>', ' ');
      }
    }
    currLabel.setProperty('comment', comment);

    // A verdict counts once the label has been on screen long enough to have been looked at (LabelContainer has the
    // reasoning). Double-tap protection swallows the rest without a trace on screen, so the log is where it shows.
    const sinceMs = timestamp.getTime() - svv.labelContainer.getProperty('renderedTimestamp');
    if (sinceMs > LabelContainer.VERDICT_GRACE_MS) {
      MobileValidationMenu.#floatVerdict(action);
      svv.labelContainer.validateCurrentLabel(action, timestamp, comment);
    } else {
      svv.tracker.push('ValidateInputDropped_Debounce', { source: `Submit=${action}`, sinceMs });
    }
  }

  /**
   * Sends the verdict's own thumb floating up off the button that cast it, confirming the tap where the thumb already
   * is. The icon is cloned from the button so the two can never drift apart, and it takes itself off the page when
   * the animation ends. Nothing happens for a visitor who asked for less motion — the button's chosen state, which
   * they keep, already says what was picked.
   *
   * @param {string} action - The verdict cast: 'Agree', 'Disagree', or 'Unsure'.
   */
  static #floatVerdict(action) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const buttonIds = {
      Agree: 'validate-yes-button', Disagree: 'validate-no-button', Unsure: 'validate-unsure-button',
    };
    const button = document.getElementById(buttonIds[action]);
    const icon = button?.querySelector('.validate-page-button__icon');
    if (!icon) return;

    // One at a time: a quick second verdict should replace the last one's thumb, not race it up the screen.
    document.querySelectorAll('.validate-verdict-float').forEach((stale) => stale.remove());

    const floater = /** @type {HTMLElement} */ (icon.cloneNode());
    floater.className = 'validate-verdict-float';
    const box = button.getBoundingClientRect();
    floater.style.left = `${box.left + box.width / 2}px`;
    floater.style.top = `${box.top}px`;
    floater.addEventListener('animationend', () => floater.remove());
    document.body.appendChild(floater);
  }
}

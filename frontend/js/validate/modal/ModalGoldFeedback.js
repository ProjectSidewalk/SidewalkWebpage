/**
 * Explains a training example the validator just got wrong (#1445), in a modal with the label's own crop and the
 * reason's text. A right answer gets nothing: the examples are there to correct, not to quiz.
 */

import i18next from 'i18next';
import { util } from '../../common/utilities.js';
import { validationReasons } from '../../common/validationReasons.js';
import '../../../css/components/gold-feedback.css';
/** @typedef {import('../label/Label.js').Label} Label */
/** @typedef {import('../../common/Gate.js').Gate} Gate */
/** @typedef {import('../Tracker.js').Tracker} Tracker */

/**
 * The dialog's elements, as Main collects them.
 * @typedef {object} GoldFeedbackUi
 * @property {HTMLDialogElement} panel
 * @property {HTMLImageElement} image
 * @property {HTMLElement} heading
 * @property {HTMLElement} text
 * @property {HTMLElement} advice
 * @property {HTMLButtonElement} okButton
 */

export class ModalGoldFeedback {
  /** @type {GoldFeedbackUi} */
  #ui;
  /** @type {Gate} */
  #keyboardLock;
  /** @type {Tracker} */
  #tracker;
  /** @type {(() => void) | null} Resolves the pending show(); null while nothing is up. */
  #dismiss = null;

  /**
   * @param {GoldFeedbackUi} ui
   * @param {Gate} keyboardLock - Held while the explanation is up, so a shortcut can't vote on the next label.
   * @param {Tracker} tracker - Logs the explanation and its dismissal.
   */
  constructor(ui, keyboardLock, tracker) {
    this.#ui = ui;
    this.#keyboardLock = keyboardLock;
    this.#tracker = tracker;
  }

  /**
   * The menu's tooltip is written for someone choosing the reason; a few read better to someone who missed it.
   * @param {string} reasonId
   * @param {string} labelType
   * @returns {string}
   */
  static explanation(reasonId, labelType) {
    const own = `validate:gold-feedback.explanation.${reasonId}`;
    return i18next.exists(own) ? i18next.t(own) : (validationReasons.tooltip(reasonId, labelType) ?? '');
  }

  /**
   * Shows why the label is wrong, and resolves once the validator has read it and pressed the button.
   * @param {Label} label - The example, whose `goldReason` audit property names the reason.
   * @param {string} vote - What they answered ('Agree' or 'Unsure'), for the log.
   * @returns {Promise<void>}
   */
  show(label, vote) {
    const labelType = label.getAuditProperty('labelType');
    const reasonId = label.getAuditProperty('goldReason');
    const crop = label.getAuditProperty('goldCropUrl');
    this.#tracker.push('ModalGoldFeedback_Shown', { labelId: label.getAuditProperty('labelId'), reasonId, vote });

    const ui = this.#ui;
    ui.heading.innerHTML = validationReasons.text(reasonId) ?? reasonId;
    ui.text.innerHTML = ModalGoldFeedback.explanation(reasonId, labelType);
    const no = `<strong class="gold-feedback__vote">${util.escapeHTML(i18next.t('common:no'))}</strong>`;
    ui.advice.innerHTML = i18next.t('validate:gold-feedback.advice', { no, interpolation: { escapeValue: true } });
    if (crop) ui.image.src = crop;
    else ui.image.removeAttribute('src');
    ui.image.hidden = !crop;
    ui.panel.showModal();
    this.#keyboardLock.hold('gold-feedback');

    return new Promise((resolve) => {
      this.#dismiss = () => {
        this.#dismiss = null;
        this.#tracker.push('ModalGoldFeedback_ClickOK');
        ui.panel.close();
        ui.okButton.onkeydown = null;
        this.#keyboardLock.release('gold-feedback');
        resolve();
      };
      ui.okButton.onclick = this.#dismiss;
      // Esc goes through the same path, so the mission moves on rather than the dialog just vanishing.
      ui.panel.oncancel = (e) => {
        e.preventDefault();
        this.#dismiss?.();
      };
      // Enter is the vote shortcut and may still be held: its repeats would press this button before anything was read.
      ui.okButton.onkeydown = (e) => {
        if (e.repeat) e.preventDefault();
      };
      ui.okButton.focus();
    });
  }
}

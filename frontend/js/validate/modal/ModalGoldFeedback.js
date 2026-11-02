/**
 * Explains a known-answer example the validator just got wrong (#1445), in the mission modal's elements (as
 * ModalNoNewMission does), with the reason menu's own text and example image. A right answer gets nothing: the
 * examples are there to correct, not to quiz.
 */

import i18next from 'i18next';
import { util } from '../../common/utilities.js';
import { validationReasons } from '../../common/validationReasons.js';
/** @typedef {import('../label/Label.js').Label} Label */
/** @typedef {import('../../common/Gate.js').Gate} Gate */
/** @typedef {import('../Tracker.js').Tracker} Tracker */
/** @typedef {import('../util/ConstantsValidate.js').ReasonButton} ReasonButton */

export class ModalGoldFeedback {
  #uiModalMission;
  /** @type {Record<string, Record<string, ReasonButton>>} */
  #reasonButtonInfo;
  /** @type {Gate} */
  #keyboardLock;
  /** @type {Tracker} */
  #tracker;
  /** @type {(() => void) | null} Resolves the pending show(); null while nothing is up. */
  #dismiss = null;

  /**
   * @param {object} uiModalMission - Mission modal UI elements, shared with ModalMission and ModalNoNewMission.
   * @param {Record<string, Record<string, ReasonButton>>} reasonButtonInfo - The reasons' texts and example images,
   *     by kebab-case label type and menu position (buildReasonButtonInfo).
   * @param {Gate} keyboardLock - Held while the explanation is up, so a shortcut can't vote on the next label.
   * @param {Tracker} tracker - Logs the explanation and its dismissal.
   */
  constructor(uiModalMission, reasonButtonInfo, keyboardLock, tracker) {
    this.#uiModalMission = uiModalMission;
    this.#reasonButtonInfo = reasonButtonInfo;
    this.#keyboardLock = keyboardLock;
    this.#tracker = tracker;
  }

  /** @returns {boolean} Whether the explanation is on screen. */
  isShowing() {
    return this.#dismiss !== null;
  }

  /**
   * The reason menu's entry, which carries the example image; looked up by id, since the menu keys buttons by position.
   * @param {string} labelType - The label's type, e.g. 'CurbRamp'.
   * @param {string} reasonId - The pinned reason.
   * @returns {?ReasonButton}
   */
  #reasonButton(labelType, reasonId) {
    const buttons = this.#reasonButtonInfo[util.camelToKebab(labelType)] ?? {};
    return Object.values(buttons).find((b) => b.reasonId === reasonId) ?? null;
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
    const reasonText = validationReasons.text(reasonId) ?? reasonId;
    const explanation = validationReasons.tooltip(reasonId, labelType);
    const image = this.#reasonButton(labelType, reasonId)?.tooltipImage;
    this.#tracker.push('ModalGoldFeedback_Shown', { labelId: label.getAuditProperty('labelId'), reasonId, vote });

    const ui = this.#uiModalMission;
    ui.missionTitle.innerHTML = i18next.t('gold-feedback.title');
    /* eslint-disable ps/escape-in-markup -- the reason's text and tooltip are our locale strings, written as HTML */
    ui.instruction.innerHTML = `
      <p class="modal-gold-feedback__intro">${i18next.t('gold-feedback.body')}</p>
      <p class="modal-gold-feedback__reason">${reasonText}</p>
      ${explanation ? `<p class="modal-gold-feedback__explanation">${explanation}</p>` : ''}
      ${image ? `<img src="${util.escapeHTML(image)}" class="modal-gold-feedback__image" alt="">` : ''}`;
    /* eslint-enable ps/escape-in-markup */
    ui.eyebrow?.replaceChildren();
    ui.missionTitle.style.whiteSpace = '';
    ui.missionTitle.style.fontSize = '';
    ui.closeButton.innerHTML = i18next.t('gold-feedback.ok');
    if (!util.isMobile()) ui.closeButton.style.width = 'fit-content';
    ui.background.style.visibility = 'visible';
    ui.holder.style.visibility = 'visible';
    ui.foreground.style.visibility = 'visible';
    ui.foreground.scrollTop = 0;
    ui.holder.classList.remove('ps-hidden');
    this.#keyboardLock.hold('gold-feedback');

    return new Promise((resolve) => {
      this.#dismiss = () => {
        this.#dismiss = null;
        this.#tracker.push('ModalGoldFeedback_ClickOK');
        ui.background.style.visibility = 'hidden';
        ui.holder.style.visibility = 'hidden';
        ui.foreground.style.visibility = 'hidden';
        this.#keyboardLock.release('gold-feedback');
        resolve();
      };
      // Assigned, not added: ModalMission and ModalNoNewMission use this same button, and each show must replace
      // the other's handler.
      ui.closeButton.onclick = this.#dismiss;
      ui.closeButton.focus();
    });
  }
}

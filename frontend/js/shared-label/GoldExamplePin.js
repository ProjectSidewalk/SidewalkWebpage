/**
 * The admin label page's control for making a label a training example (#1445). The reasons offered are the type's
 * Disagree reasons, since the reason is what the validator is told.
 */

import { util } from '../common/utilities.js';
import { validationReasons } from '../common/validationReasons.js';

export class GoldExamplePin {
  #labelId;
  /** @type {?string} The pinned reason's id, or null while the label is not an example. */
  #reason;
  #select;
  #pinButton;
  #unpinButton;
  #status;

  /**
   * @param {HTMLElement} root - The panel, with its select, buttons and status line inside.
   * @param {{labelId: number, labelType: string, goldReason: ?string}} config - The label and its current pin.
   */
  constructor(root, { labelId, labelType, goldReason }) {
    this.#labelId = labelId;
    this.#reason = goldReason;
    this.#select = root.querySelector('#spotlight-gold-reason');
    this.#pinButton = root.querySelector('#spotlight-gold-pin');
    this.#unpinButton = root.querySelector('#spotlight-gold-unpin');
    this.#status = root.querySelector('#spotlight-gold-status');

    const reasons = validationReasons.forLabel(labelType, 'Disagree');
    for (const reason of reasons) {
      const option = document.createElement('option');
      option.value = reason.id;
      option.textContent = reason.text;
      this.#select.appendChild(option);
    }
    // A type with no canned reasons (Other, Occlusion) has nothing to teach with.
    if (reasons.length === 0) {
      this.#select.disabled = true;
      this.#pinButton.disabled = true;
      this.#status.textContent = 'This label type has no reasons to teach with.';
    }
    this.#pinButton.addEventListener('click', () => this.#pin());
    this.#unpinButton.addEventListener('click', () => this.#unpin());
    this.#render();
  }

  /** A pinned reason the menu no longer offers (the label's type changed) is left unselected and said so. */
  #render() {
    const offered = this.#reason && [...this.#select.options].some((o) => o.value === this.#reason);
    if (offered) this.#select.value = this.#reason;
    else if (this.#reason) this.#status.textContent = 'The pinned reason no longer fits this label type; pick another.';
    this.#pinButton.textContent = this.#reason ? 'Update reason' : 'Use as training example';
    this.#unpinButton.hidden = !this.#reason;
  }

  /** What the server's refusal codes (GoldExampleController) mean to the admin. */
  static #REFUSALS = {
    no_such_label: 'No label with this id.',
    label_unusable: 'A deleted or tutorial label can\'t be shown in Validate, so it can\'t teach.',
    reason_not_offered: 'This label type doesn\'t offer that reason for a No.',
  };

  async #pin() {
    const reason = this.#select.value;
    this.#status.textContent = '';
    try {
      const response = await fetch('/adminapi/goldExamples', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ label_id: this.#labelId, reason }),
      });
      if (!response.ok) {
        const code = (await response.json().catch(() => ({}))).error;
        this.#status.textContent = GoldExamplePin.#REFUSALS[code] ?? 'Could not save.';
        return;
      }
      this.#reason = reason;
      this.#status.textContent = 'Saved. Validators will see this label.';
      this.#render();
    } catch (err) {
      this.#status.textContent = 'Could not save.';
      console.error('Gold example pin failed.', err);
    }
  }

  async #unpin() {
    this.#status.textContent = '';
    try {
      await util.fetchJson(`/adminapi/goldExamples/${this.#labelId}`, { method: 'DELETE' });
      this.#reason = null;
      this.#status.textContent = 'Removed.';
    } catch (err) {
      this.#status.textContent = 'Could not remove.';
      console.error('Gold example unpin failed.', err);
    }
    this.#render();
  }
}

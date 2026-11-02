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
    this.#reason = goldReason ?? null;
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

  #render() {
    if (this.#reason) this.#select.value = this.#reason;
    this.#pinButton.textContent = this.#reason ? 'Update reason' : 'Use as training example';
    this.#unpinButton.hidden = !this.#reason;
  }

  async #pin() {
    const reason = this.#select.value;
    this.#status.textContent = '';
    try {
      await util.fetchJson('/adminapi/goldExamples', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label_id: this.#labelId, reason }),
      });
      this.#reason = reason;
      this.#status.textContent = 'Saved. New validators will see this label.';
    } catch (err) {
      this.#status.textContent = 'Could not save.';
      console.error('Gold example pin failed.', err);
    }
    this.#render();
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

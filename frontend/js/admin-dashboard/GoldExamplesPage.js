/**
 * GoldExamplesPage — the /admin/goldExamples list of training examples (#1445). Pinning happens on the label's admin
 * page; this page only lists and removes. Admin-only page, English-only by convention.
 */

import { AdminShell } from './AdminShell.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { util } from '../common/utilities.js';
import { validationReasons } from '../common/validationReasons.js';

export class GoldExamplesPage {
  /** Why a pin can't be served (GoldExampleProblem), as the badge says it. */
  static #PROBLEMS = {
    label_deleted: 'label deleted', reason_not_offered: 'reason no longer fits', imagery_gone: 'imagery gone',
  };

  #statusEl;
  #listEl;

  init() {
    this.#statusEl = document.getElementById('gold-examples-status');
    this.#listEl = document.getElementById('gold-examples-list');
    this.#listEl.addEventListener('click', (e) => {
      const button = /** @type {HTMLElement} */ (e.target).closest('[data-unpin]');
      if (button) this.#unpin(Number(button.dataset.unpin), button.dataset.labelType);
    });
    this.#load();
  }

  async #load() {
    try {
      const data = await util.fetchJson('/adminapi/goldExamples');
      this.#render(data.gold_examples);
      this.#statusEl.textContent = data.gold_examples.length === 0
        ? 'No training examples yet.'
        : `${data.gold_examples.length} pinned.`;
    } catch (err) {
      this.#statusEl.textContent = 'Could not load the training examples.';
      console.error('Gold examples page: load failed.', err);
    }
  }

  /**
   * @param {Array<Record<string, any>>} examples - The rows, newest pin first.
   */
  #render(examples) {
    const rows = examples.map((ex) => {
      const id = Number(ex.label_id);
      const type = util.escapeHTML(ex.label_type);
      const reason = util.escapeHTML(validationReasons.text(ex.reason) ?? ex.reason);
      const crop = ex.crop_url
        ? `<img src="${util.escapeHTML(ex.crop_url)}" class="gold-examples-thumb" alt="">`
        : '<span class="gold-examples-thumb gold-examples-thumb--none">no crop</span>';
      const problem = GoldExamplesPage.#PROBLEMS[ex.problem];
      const gone = problem ? `<span class="ac-badge ac-badge--warn">${problem}</span>` : '';
      return `
        <tr>
          <td>${crop}</td>
          <td class="gold-examples-label">
            <a href="/admin/label/${id}">Label ${id}</a>
            <span class="gold-examples-type">${type}</span> ${gone}
          </td>
          <td>${reason}</td>
          <td>${util.escapeHTML(ex.pinned_by)} · ${util.escapeHTML(AdminShell.relativeTime(ex.pinned_at))}</td>
          <td class="num">${Number(ex.answered)}</td>
          <td class="num">${Number(ex.missed)}</td>
          <td>
            <button type="button" class="button button--secondary button--small" data-unpin="${id}"
              data-label-type="${type}">Remove</button>
          </td>
        </tr>`;
    }).join('');
    /** @type {Array<string|[string, boolean]>} */
    const headers = ['Crop', 'Label', 'Reason', 'Pinned by', ['Answered', true], ['Missed', true], ''];
    this.#listEl.innerHTML = examples.length === 0 ? '' : AdminShell.tableHtml(headers, rows);
  }

  /**
   * @param {number} labelId - The example to unpin.
   * @param {string} labelType - For the confirmation's wording.
   */
  async #unpin(labelId, labelType) {
    const ok = await ConfirmDialog.confirm({
      message: `Stop using label ${labelId} (${labelType}) as a training example? Validators who saw it keep their
        answers.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    try {
      await util.fetchJson(`/adminapi/goldExamples/${labelId}`, { method: 'DELETE' });
      await this.#load();
    } catch (err) {
      this.#statusEl.textContent = 'Could not remove the example.';
      console.error('Gold examples page: remove failed.', err);
    }
  }
}

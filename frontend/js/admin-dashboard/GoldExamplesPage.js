/**
 * GoldExamplesPage — the /admin/goldExamples list of training examples (#1445). Pinning happens on the label's admin
 * page; this page only lists and removes. Admin-only, so English only.
 */

import { AdminShell } from './AdminShell.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { util } from '../common/utilities.js';
import { validationReasons } from '../common/validationReasons.js';
import '../common/utilitiesSidewalk.js';

export class GoldExamplesPage {
  /** Why a pin can't be served (GoldExampleProblem), as the badge says it. */
  static #PROBLEMS = {
    label_deleted: 'label deleted', reason_not_offered: 'reason no longer fits', imagery_gone: 'imagery gone',
  };

  /**
   * Label type, in canonical order, leads both the Label and Reason sort keys, so either groups a type's examples.
   * @type {Array<{key: string, label: string, num?: boolean, sort?: (ex: Record<string, any>) => any}>}
   */
  static #COLUMNS = [
    { key: 'crop', label: 'Crop' },
    { key: 'label', label: 'Label', sort: (ex) => [GoldExamplesPage.#typeRank(ex), Number(ex.label_id)] },
    { key: 'reason', label: 'Reason',
      sort: (ex) => [GoldExamplesPage.#typeRank(ex), validationReasons.text(ex.reason) ?? ex.reason] },
    { key: 'pinned_by', label: 'Pinned by', sort: (ex) => [ex.pinned_by.toLowerCase(), AdminShell.ts(ex.pinned_at)] },
    { key: 'pinned_at', label: 'Pinned', sort: (ex) => [AdminShell.ts(ex.pinned_at)] },
    { key: 'answered', label: 'Answered', num: true, sort: (ex) => [Number(ex.answered)] },
    { key: 'missed', label: 'Missed', num: true, sort: (ex) => [Number(ex.missed)] },
    // Unsortable: it holds buttons.
    { key: 'actions', label: '' },
  ];

  /** @returns {number} The label type's place in the canonical order the page is stamped with. */
  static #typeRank(ex) {
    return util.misc.VALID_LABEL_TYPES.indexOf(ex.label_type);
  }

  #statusEl;
  #listEl;
  /** @type {Array<Record<string, any>>} */
  #examples = [];
  #sort = { key: 'pinned_at', dir: 'desc' };

  init() {
    this.#statusEl = document.getElementById('gold-examples-status');
    this.#listEl = document.getElementById('gold-examples-list');
    this.#listEl.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      const button = target.closest('[data-unpin]');
      if (button) {
        this.#unpin(Number(button.dataset.unpin), button.dataset.labelType);
        return;
      }
      const th = target.closest('th[data-sort]');
      if (th) this.#sortBy(th.dataset.sort);
    });
    // Headers are interactive, so they need to be operable from the keyboard (WCAG 2.1.1).
    this.#listEl.addEventListener('keydown', (e) => {
      const th = /** @type {HTMLElement} */ (e.target).closest('th[data-sort]');
      if (th && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        this.#sortBy(th.dataset.sort);
      }
    });
    this.#load();
  }

  async #load() {
    try {
      const data = await util.fetchJson('/adminapi/goldExamples');
      this.#examples = data.gold_examples;
      this.#render();
      this.#statusEl.textContent = this.#examples.length === 0
        ? 'No training examples yet.'
        : `${this.#examples.length} pinned.`;
    } catch (err) {
      this.#statusEl.textContent = 'Could not load the training examples.';
      console.error('Gold examples page: load failed.', err);
    }
  }

  /** A new column starts biggest or newest first, except the text columns, which read A→Z. */
  #sortBy(key) {
    if (this.#sort.key === key) this.#sort.dir = this.#sort.dir === 'asc' ? 'desc' : 'asc';
    else this.#sort = { key, dir: ['label', 'reason', 'pinned_by'].includes(key) ? 'asc' : 'desc' };
    this.#render();
  }

  /** @returns {Array<Record<string, any>>} Newest pin first among equals. */
  #sorted() {
    const col = GoldExamplesPage.#COLUMNS.find((c) => c.key === this.#sort.key);
    const dir = this.#sort.dir === 'asc' ? 1 : -1;
    const compare = (a, b) => (typeof a === 'string' ? a.localeCompare(b) : a - b);
    return this.#examples.slice().sort((a, b) => {
      const av = col.sort(a);
      const bv = col.sort(b);
      for (let i = 0; i < av.length; i++) {
        const c = compare(av[i], bv[i]);
        if (c !== 0) return c * dir;
      }
      return AdminShell.ts(b.pinned_at) - AdminShell.ts(a.pinned_at);
    });
  }

  #render() {
    if (this.#examples.length === 0) {
      this.#listEl.innerHTML = '';
      return;
    }
    const head = GoldExamplesPage.#COLUMNS.map((c) => {
      const classes = [c.num ? '' : 'ac-th-text', c.key === this.#sort.key ? 'ac-sorted' : ''].filter(Boolean);
      const cls = classes.length ? ` class="${classes.join(' ')}"` : '';
      if (!c.sort) return `<th${cls}>${util.escapeHTML(c.label)}</th>`;
      const sorted = c.key === this.#sort.key;
      const aria = sorted ? ` aria-sort="${this.#sort.dir === 'asc' ? 'ascending' : 'descending'}"` : '';
      const dirAttr = sorted ? ` data-dir="${this.#sort.dir}"` : '';
      // eslint-disable-next-line ps/escape-in-markup -- the key is a fixed word from #COLUMNS
      return `<th${cls} data-sort="${c.key}" tabindex="0"${aria}${dirAttr}>${util.escapeHTML(c.label)}</th>`;
    }).join('');
    const rows = this.#sorted().map((ex) => {
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
          <td>
            <a href="/admin/label/${id}">Label ${id}</a>
            <span class="gold-examples-type">${type}</span>${gone}
          </td>
          <td class="gold-examples-reason">${reason}</td>
          <td>${util.escapeHTML(ex.pinned_by)}</td>
          <td>${util.escapeHTML(AdminShell.relativeTime(ex.pinned_at))}</td>
          <td class="num">${Number(ex.answered)}</td>
          <td class="num">${Number(ex.missed)}</td>
          <td>
            <button type="button" class="button button--secondary button--tiny" data-unpin="${id}"
              data-label-type="${type}">Remove</button>
          </td>
        </tr>`;
    }).join('');
    this.#listEl.innerHTML = `
      <div class="ac-table-wrap">
        <table class="ps-table ps-table--compact ac-table gold-examples-table">
          <thead><tr>${head}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
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

/** Pages through a table the server rendered in full, by swapping which rows are hidden; never fetches (#5762). */

import '../../css/components/pager.css';

export class TablePager {
  #rows;
  #pageSize;
  #page;
  #pageCount;
  #prev;
  #next;
  #pageNum;
  #onPage;

  /**
   * @param {HTMLTableSectionElement} tbody - The table body, carrying `data-page-size` and the opening `data-page`.
   * @param {HTMLElement} nav - The `.ps-pager` bar under the table.
   * @param {(page: number) => void} [onPage] - Called with the 1-based page after each move, for logging.
   */
  constructor(tbody, nav, onPage = () => {}) {
    this.#rows = [...tbody.rows];
    this.#pageSize = Number(tbody.dataset.pageSize);
    this.#page = Number(tbody.dataset.page);
    this.#pageCount = Math.ceil(this.#rows.length / this.#pageSize);
    this.#prev = /** @type {HTMLButtonElement} */ (nav.querySelector('[data-step="-1"]'));
    this.#next = /** @type {HTMLButtonElement} */ (nav.querySelector('[data-step="1"]'));
    this.#pageNum = nav.querySelector('.ps-pager-page');
    this.#onPage = onPage;
    this.#prev.addEventListener('click', () => this.#go(-1));
    this.#next.addEventListener('click', () => this.#go(1));
  }

  /**
   * Moves one page back or forward.
   * @param {number} step - -1 for the previous page, 1 for the next.
   */
  #go(step) {
    // Read before disabling: the browser drops focus to <body> the moment a focused button turns disabled, which would
    // strand a keyboard user at the top of the page.
    const clicked = document.activeElement;
    this.#page = Math.min(this.#pageCount - 1, Math.max(0, this.#page + step));
    this.#rows.forEach((row, i) => {
      row.hidden = Math.floor(i / this.#pageSize) !== this.#page;
    });
    this.#pageNum.textContent = String(this.#page + 1);
    this.#prev.disabled = this.#page === 0;
    this.#next.disabled = this.#page === this.#pageCount - 1;

    if (clicked instanceof HTMLButtonElement && clicked.disabled) (step < 0 ? this.#next : this.#prev).focus();
    this.#onPage(this.#page + 1);
  }
}

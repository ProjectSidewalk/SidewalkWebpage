/**
 * The city reports page's table (#6041). The server renders every row in its default order (scored neighborhoods
 * lowest first, then the rest), so the page reads without a script; this module only reorders, hides and marks those
 * rows from the shared state, and reports clicks and hovers back to it. It never builds a cell, so the server stays the
 * one source of what a row says.
 */

/**
 * @typedef {object} CityReportTableRow
 * @property {number} id
 * @property {string} name
 * @property {boolean} scored
 * @property {?number} score - 0 to 1.
 * @property {?number} completion - Explored share, 0 to 1; null with no streets, so such a row sorts last.
 * @property {?number} reviewed - Percent of observations reviewed.
 * @property {?string} latest - The latest observation's date, ISO, so it sorts as text.
 * @property {?number} imagery - Median imagery year.
 * @property {?number} labelers
 * @property {?number} density - Observations per explored km or mile.
 */

/** The column each lens colors the map by, so its header can say so. */
const LENS_COLUMNS = { score: 'score', explored: 'explored', problem: 'why' };

/** Each sortable column's value on a row; `explored` sorts on completion. */
const SORT_VALUES = {
  name: (r) => r.name,
  score: (r) => r.score,
  explored: (r) => r.completion,
  reviewed: (r) => r.reviewed,
  latest: (r) => r.latest,
  imagery: (r) => r.imagery,
  labelers: (r) => r.labelers,
  density: (r) => r.density,
};

/**
 * Orders rows by a column. Under Score, an unscored row always comes after every scored one, whichever way the column
 * sorts: "not scored" is not a low score. Elsewhere a row with no value comes last either way. Ties keep the server's
 * order, which `index` carries.
 *
 * @param {Array<CityReportTableRow & {index: number}>} rows - The rows, each with its place in the server's order.
 * @param {?string} column - A key of SORT_VALUES, or null for the server's order.
 * @param {'asc' | 'desc'} dir
 * @returns {Array<CityReportTableRow & {index: number}>} A new, sorted array.
 */
export function sortRows(rows, column, dir) {
  const value = column ? SORT_VALUES[column] : null;
  if (!value) return [...rows].sort((a, b) => a.index - b.index);
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const missingX = x === null || x === undefined;
    const missingY = y === null || y === undefined;
    if (missingX || missingY) return missingX === missingY ? a.index - b.index : (missingX ? 1 : -1);
    const order = typeof x === 'string' ? x.localeCompare(/** @type {string} */ (y)) : x - /** @type {number} */ (y);
    return order === 0 ? a.index - b.index : sign * order;
  });
}

export class CityReportTable {
  /** @type {HTMLTableElement} */
  #table;
  /** @type {import('./CityReportState.js').CityReportState} */
  #state;
  /** @type {Array<CityReportTableRow & {index: number}>} */
  #rows;
  /** @type {Map<number, HTMLTableRowElement>} */
  #rowElements = new Map();

  /**
   * @param {HTMLTableElement} table - The server-rendered table.
   * @param {CityReportTableRow[]} rows - The page's data for each row, in the server's order.
   * @param {import('./CityReportState.js').CityReportState} state - The page's shared state.
   */
  constructor(table, rows, state) {
    this.#table = table;
    this.#state = state;
    this.#rows = rows.map((r, index) => ({ ...r, index }));
    for (const tr of table.tBodies[0].rows) this.#rowElements.set(Number(tr.dataset.regionId), tr);
    this.#bindEvents();
    // The phone layout shows the header row as sort buttons only from here on, once they do something.
    table.classList.add('is-sortable');
    state.subscribe((_, change) => this.#render(change.type));
    this.#render(null);
  }

  /** Sort buttons, row clicks and row hovers, all delegated from the table. */
  #bindEvents() {
    this.#table.addEventListener('click', (e) => {
      const target = /** @type {Element} */ (e.target);
      const sort = /** @type {?HTMLElement} */ (target.closest('button[data-sort]'));
      if (sort) {
        this.#state.setSort(sort.dataset.sort);
        return;
      }
      // A click on a row selects it, except on its links, which leave the page.
      if (target.closest('a, button:not(.reports-table__select)')) return;
      const id = this.#rowId(target);
      if (id !== null) this.#state.select(id, 'Table');
    });
    this.#table.tBodies[0].addEventListener('mouseover', (e) => {
      const id = this.#rowId(/** @type {Element} */ (e.target));
      if (id !== null) this.#state.hover(id, 'Table');
    });
    this.#table.tBodies[0].addEventListener('mouseout', (e) => {
      const from = /** @type {Element} */ (e.target).closest('tr');
      const to = /** @type {?Node} */ (e.relatedTarget);
      // Moving between a row's own cells is not leaving it.
      if (from && !(to instanceof Node && from.contains(to))) this.#state.hover(null, 'Table');
    });
  }

  /**
   * @param {Element} element - Something inside a body row.
   * @returns {?number} That row's region id.
   */
  #rowId(element) {
    const tr = /** @type {?HTMLElement} */ (element.closest('tbody tr'));
    return tr ? Number(tr.dataset.regionId) : null;
  }

  /**
   * Brings the table in line with the state. A hover touches only the tint, since it fires on every row the pointer
   * crosses.
   * @param {?string} changeType - What changed, or null to draw everything.
   */
  #render(changeType) {
    if (changeType === 'hover') {
      this.#markHover();
      return;
    }
    if (changeType === null || changeType === 'sort') this.#order();
    if (changeType === null || changeType === 'filter' || changeType === 'select') this.#filter();
    if (changeType === null || changeType === 'select') this.#markSelection();
    if (changeType === null || changeType === 'lens') this.#markLens();
    if (changeType === null) this.#markHover();
  }

  /** Reorders the body rows and says on the sorted header which way it sorts. */
  #order() {
    const { column, dir } = this.#state.sort;
    const body = this.#table.tBodies[0];
    for (const row of sortRows(this.#rows, column, dir)) body.append(this.#rowElements.get(row.id));
    for (const th of this.#table.tHead.querySelectorAll('th[data-column]')) {
      const header = /** @type {HTMLElement} */ (th);
      if (column && header.dataset.column === column) {
        header.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
      } else {
        header.removeAttribute('aria-sort');
      }
    }
  }

  /** Hides the rows the filter leaves out; the map fades the same ones. */
  #filter() {
    for (const [id, tr] of this.#rowElements) tr.hidden = !this.#state.inFilter(id);
  }

  /** Tints the selected row and presses its "Show on map" button. */
  #markSelection() {
    for (const [id, tr] of this.#rowElements) {
      const selected = id === this.#state.selected;
      tr.classList.toggle('is-selected', selected);
      tr.querySelector('.reports-table__select')?.setAttribute('aria-pressed', String(selected));
    }
  }

  /** Tints the row under the pointer, wherever the pointer is. */
  #markHover() {
    for (const [id, tr] of this.#rowElements) tr.classList.toggle('is-hovered', id === this.#state.hovered);
  }

  /** Marks the column holding what the map is colored by, header and cells alike. */
  #markLens() {
    const column = LENS_COLUMNS[this.#state.lens];
    for (const cell of this.#table.querySelectorAll('[data-column]')) {
      cell.classList.toggle('is-lens', /** @type {HTMLElement} */ (cell).dataset.column === column);
    }
  }
}

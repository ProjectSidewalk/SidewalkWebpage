/**
 * The city reports page's one shared state (#6041): which neighborhood is selected and which is under the pointer, what
 * the map is colored by, which neighborhoods are shown, and how the table is sorted. The map, the table and the panel
 * each draw from it and write to it, never to each other, so the two drawings of the same rows can't drift apart.
 *
 * Pure: it holds values and tells listeners, and touches no DOM.
 */

/** @typedef {'score' | 'explored' | 'problem'} CityReportLens */
/** @typedef {'all' | 'scored' | 'unscored'} CityReportFilter */
/** @typedef {'select' | 'hover' | 'lens' | 'filter' | 'sort'} CityReportChangeType */

/**
 * @typedef {object} CityReportChange
 * @property {CityReportChangeType} type - What changed.
 * @property {string} [from] - For a selection, where it was made: `Map`, `Table` or `Filter`; for a hover, `Map` or
 *   `Table`, since the page previews only a map hover in its panel.
 */

const LENSES = new Set(['score', 'explored', 'problem']);
const FILTERS = new Set(['all', 'scored', 'unscored']);

export class CityReportState {
  /** @type {Map<number, boolean>} Whether each neighborhood is scored, by id. */
  #scored;
  /** @type {?number} */
  #selected;
  /** @type {?number} */
  #hovered = null;
  /** @type {CityReportLens} */
  #lens;
  /** @type {CityReportFilter} */
  #filter = 'all';
  /** @type {{column: ?string, dir: 'asc' | 'desc'}} */
  #sort = { column: null, dir: 'asc' };
  /** @type {Set<(state: CityReportState, change: CityReportChange) => void>} */
  #listeners = new Set();

  /**
   * @param {Array<{id: number, scored: boolean}>} rows - Every neighborhood on the page.
   * @param {object} [options] - Where to start.
   * @param {?number} [options.selected=null] - The neighborhood selected on arrival.
   * @param {CityReportLens} [options.lens='score'] - What the map is colored by on arrival.
   * @param {?{column: string, dir: 'asc' | 'desc'}} [options.sort=null] - The sort the server's order already is, so
   *   the header says so and a first click on it turns it around rather than repeating it; null when no column's
   *   sort matches that order.
   */
  constructor(rows, { selected = null, lens = 'score', sort = null } = {}) {
    this.#scored = new Map(rows.map((r) => [r.id, r.scored]));
    this.#selected = selected;
    this.#lens = lens;
    if (sort) this.#sort = { column: sort.column, dir: sort.dir };
  }

  /** @returns {?number} The selected neighborhood's id. */
  get selected() {
    return this.#selected;
  }

  /** @returns {?number} The id of the neighborhood under the pointer, on the map or in the table. */
  get hovered() {
    return this.#hovered;
  }

  /** @returns {CityReportLens} */
  get lens() {
    return this.#lens;
  }

  /** @returns {CityReportFilter} */
  get filter() {
    return this.#filter;
  }

  /** @returns {{column: ?string, dir: 'asc' | 'desc'}} A copy; a null column is the server's own order. */
  get sort() {
    return { ...this.#sort };
  }

  /**
   * Hears every change from now on.
   * @param {(state: CityReportState, change: CityReportChange) => void} listener
   * @returns {() => void} Stops it hearing.
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Selects a neighborhood everywhere. Picking one the filter hides shows everything again, since a selection nobody
   * can see in the table would leave the panel describing a row that isn't there.
   * @param {number} id - The region id.
   * @param {string} from - Where it was picked: `Map`, `Table` or `Filter`, for the log.
   */
  select(id, from) {
    if (id === this.#selected && this.inFilter(id)) return;
    this.#selected = id;
    if (!this.inFilter(id)) this.#filter = 'all';
    this.#notify({ type: 'select', from });
  }

  /**
   * @param {?number} id - The neighborhood now under the pointer, or null for none.
   * @param {string} from - Where the pointer is: `Map` or `Table`.
   */
  hover(id, from) {
    if (id === this.#hovered) return;
    this.#hovered = id;
    this.#notify({ type: 'hover', from });
  }

  /** @param {CityReportLens} lens */
  setLens(lens) {
    if (!LENSES.has(lens)) throw new Error(`Unknown lens: ${lens}`);
    if (lens === this.#lens) return;
    this.#lens = lens;
    this.#notify({ type: 'lens' });
  }

  /** @param {CityReportFilter} filter */
  setFilter(filter) {
    if (!FILTERS.has(filter)) throw new Error(`Unknown filter: ${filter}`);
    if (filter === this.#filter) return;
    this.#filter = filter;
    this.#notify({ type: 'filter' });
  }

  /**
   * Sorts the table by a column: ascending the first time, then the other way on each repeat.
   * @param {string} column - The column's name, as its header's `data-sort` gives it.
   */
  setSort(column) {
    const dir = this.#sort.column === column && this.#sort.dir === 'asc' ? 'desc' : 'asc';
    this.#sort = { column, dir };
    this.#notify({ type: 'sort' });
  }

  /**
   * @param {number} id - A region id.
   * @returns {boolean} Whether the filter shows it.
   */
  inFilter(id) {
    if (this.#filter === 'all') return true;
    return (this.#filter === 'scored') === Boolean(this.#scored.get(id));
  }

  /** @returns {number[]} The neighborhoods the filter hides, which the map fades, in the page's order. */
  fadedIds() {
    return [...this.#scored.keys()].filter((id) => !this.inFilter(id));
  }

  /** @param {CityReportChange} change */
  #notify(change) {
    for (const listener of this.#listeners) listener(this, change);
  }
}

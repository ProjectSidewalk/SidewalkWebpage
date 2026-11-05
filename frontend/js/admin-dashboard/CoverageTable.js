/**
 * Searchable, sortable region table for the Coverage page's distribution view. Provides per-region drill-down that
 * scales to large deployments where per-region bars don't: filter by name, sort by any column (defaults to
 * least-covered first — the actionable end), and hover/click a row to brush that region on the map. highlightRows()
 * lets the coordinator reflect a selection coming from the map or the histogram (e.g. a whole coverage bucket).
 */

import { util } from '../common/utilities.js';
import { CoverageFormat } from './CoverageMap.js';

export class CoverageTable {
  /** Column definitions: key into the row object, header label, and value formatter. */
  static #COLS = [
    { key: 'name', label: 'Region', fmt: (v) => v },
    { key: 'completion_rate', label: 'Coverage', fmt: (v) => CoverageFormat.pct(v) },
    { key: 'audited_distance_m', label: 'Audited', fmt: (v) => util.metersToLongDistanceString(v, 1) },
    { key: 'total_distance_m', label: 'Total', fmt: (v) => util.metersToLongDistanceString(v, 1) },
    { key: 'label_count', label: 'Labels', fmt: (v) => (v || 0).toLocaleString() },
    { key: 'user_count', label: 'Contributors', fmt: (v) => (v || 0).toLocaleString() },
  ];

  #tableId;
  #searchId;
  #onRowClick;
  #onRowHover;
  #onRowHoverEnd;
  #rows = [];
  #sortKey = 'completion_rate';
  #sortDir = 1; // 1 = ascending (least-covered first), -1 = descending.
  #filter = '';
  #hoverId = null;
  #highlighted = new Set(); // Kept so a re-sort or search, which redraws the rows, doesn't drop the highlight.

  /**
   * @param {string} tableId - ID of the <table> element.
   * @param {string} searchId - ID of the search <input> element.
   * @param {{onRowClick: (id: number) => void, onRowHover: (id: number) => void,
   *          onRowHoverEnd: () => void}} opts
   */
  constructor(tableId, searchId, opts) {
    this.#tableId = tableId;
    this.#searchId = searchId;
    this.#onRowClick = opts.onRowClick;
    this.#onRowHover = opts.onRowHover;
    this.#onRowHoverEnd = opts.onRowHoverEnd;
  }

  /**
   * Renders the table and wires search, sort, and row interactions (once).
   * @param {Array<Record<string, any>>} rows - Region rows (region_id, name, completion_rate, distances, counts).
   */
  render(rows) {
    this.#rows = rows;
    const table = document.getElementById(this.#tableId);
    table.innerHTML = `<thead>${this.#headerRowHtml()}</thead>`;
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    this.#renderBody();
    this.#wireEvents(table, tbody);
  }

  /** @returns {string} The header row, its arrow on the sorted column. */
  #headerRowHtml() {
    const ths = CoverageTable.#COLS.map((c) => {
      const arrow = c.key === this.#sortKey ? (this.#sortDir === 1 ? ' ▲' : ' ▼') : '';
      return `<th data-key="${c.key}" role="button" tabindex="0" scope="col">${c.label}${arrow}</th>`;
    }).join('');
    return `<tr>${ths}</tr>`;
  }

  #renderBody() {
    const tbody = document.getElementById(this.#tableId).querySelector('tbody');
    const filter = this.#filter.toLowerCase();
    const visible = this.#rows
      .filter((r) => !filter || r.name.toLowerCase().includes(filter))
      .sort((a, b) => {
        const av = a[this.#sortKey];
        const bv = b[this.#sortKey];
        if (typeof av === 'string') return av.localeCompare(bv) * this.#sortDir;
        return ((av || 0) - (bv || 0)) * this.#sortDir;
      });

    tbody.innerHTML = visible.map((r) => {
      const cells = CoverageTable.#COLS.map((c) => `<td>${util.escapeHTML(c.fmt(r[c.key]))}</td>`).join('');
      return `<tr data-region-id="${util.escapeHTML(r.region_id)}">${cells}</tr>`;
    }).join('');
    this.#paintHighlight();
  }

  /**
   * Wires sorting, search and row hover/click; render() calls it once per table.
   * @param {HTMLElement} table - The table.
   * @param {HTMLTableSectionElement} tbody - Its body, whose rows are redrawn but which itself stays.
   */
  #wireEvents(table, tbody) {
    // Redraws only the row, so the listeners on <thead> survive, and keeps focus on the header a key press sorted.
    const refreshHeader = () => {
      const thead = table.querySelector('thead');
      const focused = /** @type {HTMLElement} */ (document.activeElement);
      const focusedKey = thead.contains(focused) ? focused.dataset.key : null;
      thead.innerHTML = this.#headerRowHtml();
      if (focusedKey) /** @type {HTMLElement} */ (thead.querySelector(`th[data-key="${focusedKey}"]`)).focus();
    };

    table.querySelector('thead').addEventListener('click', (e) => {
      const th = /** @type {Element} */ (e.target).closest('th[data-key]');
      if (th) this.#sortBy(th.dataset.key, refreshHeader);
    });
    table.querySelector('thead').addEventListener('keydown', (e) => {
      const th = /** @type {Element} */ (e.target).closest('th[data-key]');
      if (th && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        this.#sortBy(th.dataset.key, refreshHeader);
      }
    });

    const search = /** @type {HTMLInputElement} */ (document.getElementById(this.#searchId));
    if (search) {
      search.addEventListener('input', () => {
        this.#filter = search.value;
        this.#renderBody();
      });
    }

    tbody.addEventListener('pointerover', (e) => {
      const tr = /** @type {Element} */ (e.target).closest('tr[data-region-id]');
      const id = tr ? Number(tr.dataset.regionId) : null;
      if (id === this.#hoverId) return;
      this.#hoverId = id;
      if (id !== null) this.#onRowHover(id);
      else this.#onRowHoverEnd();
    });
    tbody.addEventListener('pointerleave', () => {
      if (this.#hoverId === null) return;
      this.#hoverId = null;
      this.#onRowHoverEnd();
    });
    tbody.addEventListener('click', (e) => {
      const tr = /** @type {Element} */ (e.target).closest('tr[data-region-id]');
      if (tr) this.#onRowClick(Number(tr.dataset.regionId));
    });
  }

  #sortBy(key, refreshHeader) {
    if (this.#sortKey === key) {
      this.#sortDir *= -1;
    } else {
      this.#sortKey = key;
      this.#sortDir = 1;
    }
    refreshHeader();
    this.#renderBody();
  }

  /** Highlights the rows for the given region ids (e.g. a histogram bucket). @param {number[]} ids */
  highlightRows(ids) {
    this.#highlighted = new Set(ids.map(Number));
    this.#paintHighlight();
  }

  /** Clears all row highlights. */
  clearHighlight() {
    this.#highlighted.clear();
    this.#paintHighlight();
  }

  #paintHighlight() {
    const tbody = document.getElementById(this.#tableId).querySelector('tbody');
    tbody.querySelectorAll('tr[data-region-id]').forEach((tr) => {
      tr.classList.toggle('is-highlighted', this.#highlighted.has(Number(tr.dataset.regionId)));
    });
  }
}

/**
 * Searchable, sortable region table for the Coverage page's distribution view. Provides per-region drill-down that
 * scales to large deployments where per-region bars don't: filter by name, sort by any column (defaults to
 * least-covered first — the actionable end), and hover/click a row to brush that region on the map. highlightRows()
 * lets the coordinator reflect a selection coming from the map or the histogram (e.g. a whole coverage bucket).
 */
class CoverageTable {
  /** Column definitions: key into the row object, header label, and value formatter. */
  static #COLS = [
    { key: 'name', label: 'Region', fmt: (v) => v },
    { key: 'completion_rate', label: 'Coverage', fmt: (v) => CoverageFormat.pct(v) },
    { key: 'audited_distance_m', label: 'Audited', fmt: (v) => CoverageFormat.km(v) },
    { key: 'total_distance_m', label: 'Total', fmt: (v) => CoverageFormat.km(v) },
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

  /**
   * @param {string} tableId - id of the <table> element.
   * @param {string} searchId - id of the search <input> element.
   * @param {{onRowClick?: function(number): void, onRowHover?: function(number): void,
   *          onRowHoverEnd?: function(): void}} [opts]
   */
  constructor(tableId, searchId, opts = {}) {
    this.#tableId = tableId;
    this.#searchId = searchId;
    this.#onRowClick = opts.onRowClick || (() => {});
    this.#onRowHover = opts.onRowHover || (() => {});
    this.#onRowHoverEnd = opts.onRowHoverEnd || (() => {});
  }

  /**
   * Renders the table and wires search, sort, and row interactions (once).
   * @param {Array<object>} rows - Region rows (region_id, name, completion_rate, distances, counts).
   */
  render(rows) {
    this.#rows = rows;
    const table = document.getElementById(this.#tableId);
    table.innerHTML = this.#headerHtml();
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    this.#renderBody();
    this.#wireEvents(table, tbody);
  }

  #headerHtml() {
    const ths = CoverageTable.#COLS.map((c) => {
      const arrow = c.key === this.#sortKey ? (this.#sortDir === 1 ? ' ▲' : ' ▼') : '';
      return `<th data-key="${c.key}" role="button" tabindex="0" scope="col">${c.label}${arrow}</th>`;
    }).join('');
    return `<thead><tr>${ths}</tr></thead>`;
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
      const cells = CoverageTable.#COLS.map((c) => `<td>${c.fmt(r[c.key])}</td>`).join('');
      return `<tr data-region-id="${r.region_id}">${cells}</tr>`;
    }).join('');
  }

  #wireEvents(table, tbody) {
    // Update the sort indicator in the header without rebuilding the whole table.
    const refreshHeader = () => {
      table.querySelector('thead').outerHTML = this.#headerHtml();
    };

    table.querySelector('thead').addEventListener('click', (e) => {
      const th = e.target.closest('th[data-key]');
      if (th) this.#sortBy(th.dataset.key, refreshHeader);
    });
    table.querySelector('thead').addEventListener('keydown', (e) => {
      const th = e.target.closest('th[data-key]');
      if (th && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        this.#sortBy(th.dataset.key, refreshHeader);
      }
    });

    const search = document.getElementById(this.#searchId);
    if (search) {
      search.addEventListener('input', () => {
        this.#filter = search.value;
        this.#renderBody();
      });
    }

    tbody.addEventListener('pointerover', (e) => {
      const tr = e.target.closest('tr[data-region-id]');
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
      const tr = e.target.closest('tr[data-region-id]');
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
    const set = new Set(ids.map(Number));
    const tbody = document.getElementById(this.#tableId).querySelector('tbody');
    tbody.querySelectorAll('tr[data-region-id]').forEach((tr) => {
      tr.classList.toggle('highlighted', set.has(Number(tr.dataset.regionId)));
    });
  }

  /** Clears all row highlights. */
  clearHighlight() {
    const tbody = document.getElementById(this.#tableId).querySelector('tbody');
    tbody.querySelectorAll('tr.highlighted').forEach((tr) => tr.classList.remove('highlighted'));
  }
}

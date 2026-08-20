/**
 * Sortable (and optionally searchable) table for the Imagery page's two work lists: regions ranked by re-audit need,
 * and the streets inside the pinned region (#4908).
 *
 * One class rather than two because the two tables differ only in their columns and their row key — the sorting,
 * searching, and map-brushing behavior is the same, and is the same behavior the Coverage and Street Status tables
 * already have. Columns declare how to read, format, and sort a value, so a display format that differs from the sort
 * key (a date rendered as "3 years ago", a count rendered with a bar) can't quietly sort on the rendered string.
 */
class StreetPriorityTable {
  #tableId;
  #searchId;
  #columns;
  #rowKey;
  #searchFields;
  #onRowClick;
  #onRowHover;
  #onRowHoverEnd;
  #rows = [];
  #sortKey;
  #sortDir;
  #filter = '';
  #hoverId = null;
  #wired = false;

  /**
   * @param {string} tableId - id of the <table> element.
   * @param {{columns: Array<{key: string, label: string, numeric?: boolean, format?: function(object): string,
   *          sortValue?: function(object): (number|string)}>, rowKey: string, searchId?: string,
   *          searchFields?: string[], sortKey?: string, sortDir?: number, onRowClick?: function(number): void,
   *          onRowHover?: function(number): void, onRowHoverEnd?: function(): void}} opts - Column definitions, the
   *   row property used as the brushing id, and the optional search input + interaction hooks.
   */
  constructor(tableId, opts) {
    this.#tableId = tableId;
    this.#columns = opts.columns;
    this.#rowKey = opts.rowKey;
    this.#searchId = opts.searchId || null;
    this.#searchFields = opts.searchFields || [];
    this.#sortKey = opts.sortKey || opts.columns[0].key;
    this.#sortDir = opts.sortDir || -1;
    this.#onRowClick = opts.onRowClick || (() => {});
    this.#onRowHover = opts.onRowHover || (() => {});
    this.#onRowHoverEnd = opts.onRowHoverEnd || (() => {});
  }

  /**
   * Renders the table, wiring search, sort, and row interactions on the first call.
   *
   * @param {Array<object>} rows - Row objects; each must carry the configured rowKey property.
   */
  render(rows) {
    this.#rows = rows;
    const table = document.getElementById(this.#tableId);
    if (!table) return;
    table.innerHTML = this.#headerHtml();
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    this.#renderBody();
    if (!this.#wired) {
      this.#wireEvents(table, tbody);
      this.#wired = true;
    }
  }

  #headerHtml() {
    const arrowFor = (key) => (key === this.#sortKey ? (this.#sortDir === 1 ? ' ▲' : ' ▼') : '');
    const ths = this.#columns.map((column) => {
      const sorted = column.key === this.#sortKey;
      const ariaSort = sorted ? (this.#sortDir === 1 ? 'ascending' : 'descending') : 'none';
      return `<th data-key="${column.key}" role="button" tabindex="0" scope="col" aria-sort="${ariaSort}">`
        + `${column.label}${arrowFor(column.key)}</th>`;
    }).join('');
    return `<thead><tr>${ths}</tr></thead>`;
  }

  #renderBody() {
    const table = document.getElementById(this.#tableId);
    const tbody = table.querySelector('tbody');
    const filter = this.#filter.toLowerCase();
    const column = this.#columns.find((c) => c.key === this.#sortKey);
    const sortValue = (row) => (column && column.sortValue ? column.sortValue(row) : row[this.#sortKey]);

    const visible = this.#rows
      .filter((row) => !filter || this.#searchFields.some((f) => String(row[f] ?? '').toLowerCase().includes(filter)))
      .sort((a, b) => {
        const av = sortValue(a);
        const bv = sortValue(b);
        if (typeof av === 'string' || typeof bv === 'string') {
          return String(av).localeCompare(String(bv)) * this.#sortDir;
        }
        return ((av || 0) - (bv || 0)) * this.#sortDir;
      });

    tbody.innerHTML = visible.map((row) => {
      const cells = this.#columns
        .map((c) => `<td>${c.format ? c.format(row) : StreetPriorityTable.#cell(row[c.key])}</td>`).join('');
      return `<tr data-row-id="${row[this.#rowKey]}">${cells}</tr>`;
    }).join('');

    if (visible.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${this.#columns.length}" class="ac-muted">Nothing to show.</td></tr>`;
    }
  }

  #wireEvents(table, tbody) {
    const refreshHeader = () => {
      table.querySelector('thead').outerHTML = this.#headerHtml();
    };
    const sortHandler = (e) => {
      const th = e.target.closest('th[data-key]');
      if (!th) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      if (e.type === 'keydown') e.preventDefault();
      this.#sortBy(th.dataset.key, refreshHeader);
    };
    // Delegated on the table, not the thead: sorting replaces the thead element, so a listener bound to it would be
    // discarded after the first sort.
    table.addEventListener('click', sortHandler);
    table.addEventListener('keydown', sortHandler);

    const search = this.#searchId ? document.getElementById(this.#searchId) : null;
    if (search) {
      search.addEventListener('input', () => {
        this.#filter = search.value;
        this.#renderBody();
      });
    }

    tbody.addEventListener('pointerover', (e) => {
      const tr = e.target.closest('tr[data-row-id]');
      const id = tr ? Number(tr.dataset.rowId) : null;
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
      const tr = e.target.closest('tr[data-row-id]');
      // A link inside a row (e.g. "explore") navigates instead of pinning.
      if (tr && !e.target.closest('a')) this.#onRowClick(Number(tr.dataset.rowId));
    });
  }

  #sortBy(key, refreshHeader) {
    // A new numeric column starts descending (most-first); a text column starts ascending (A→Z).
    if (this.#sortKey === key) {
      this.#sortDir *= -1;
    } else {
      const column = this.#columns.find((c) => c.key === key);
      this.#sortKey = key;
      this.#sortDir = column && column.numeric === false ? 1 : -1;
    }
    refreshHeader();
    this.#renderBody();
  }

  /** Highlights the rows with the given ids. @param {number[]} ids */
  highlightRows(ids) {
    const set = new Set(ids.map(Number));
    const tbody = document.getElementById(this.#tableId)?.querySelector('tbody');
    if (!tbody) return;
    tbody.querySelectorAll('tr[data-row-id]').forEach((tr) => {
      tr.classList.toggle('highlighted', set.has(Number(tr.dataset.rowId)));
    });
  }

  /** Clears all row highlights. */
  clearHighlight() {
    const tbody = document.getElementById(this.#tableId)?.querySelector('tbody');
    tbody?.querySelectorAll('tr.highlighted').forEach((tr) => tr.classList.remove('highlighted'));
  }

  /**
   * Renders a cell with no declared format: escaped text, or an em dash when the row carries nothing there.
   *
   * @param {*} value - Anything renderable; null and undefined become an em dash.
   * @returns {string} HTML-safe text.
   */
  static #cell(value) {
    return AdminShell.nil(value) ? '—' : AdminShell.esc(value);
  }
}

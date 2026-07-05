/**
 * Searchable, sortable per-region street-status table for the Street Status page (#4331). Each row breaks a region's
 * streets down by status (open / no_imagery / closed / disabled) with a total and an inline 100%-stacked bar, so an
 * admin can eyeball which neighborhoods have lots of missing imagery or disabled streets. Defaults to most-missing-
 * imagery first — the actionable end. Hover/click a row to brush that region's segments on the map; highlightRows()
 * reflects a selection coming from the map.
 */
class StreetStatusTable {
  /** Status columns (key/label/color) come from the shared palette so table + map + legend agree. */
  static #STATUS_COLS = StreetStatusColors.STATUSES;

  #tableId;
  #searchId;
  #onRowClick;
  #onRowHover;
  #onRowHoverEnd;
  #rows = [];
  #sortKey = 'no_imagery'; // Default: surface the regions with the most missing imagery first.
  #sortDir = -1;           // -1 = descending.
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
   * @param {Array<object>} rows - Per-region rows (region_id, name, open, no_imagery, closed, disabled, total).
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
    const arrowFor = (key) => (key === this.#sortKey ? (this.#sortDir === 1 ? ' ▲' : ' ▼') : '');
    const th = (key, label) =>
      `<th data-key="${key}" role="button" tabindex="0" scope="col">${label}${arrowFor(key)}</th>`;
    const statusThs = StreetStatusTable.#STATUS_COLS.map((c) => th(c.key, c.label)).join('');
    // The distribution (stacked-bar) column is purely visual, so it is not a sortable header.
    return `<thead><tr>
            ${th('name', 'Region')}${statusThs}${th('total', 'Total')}
            <th scope="col">Distribution</th>
        </tr></thead>`;
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
      const statusCells = StreetStatusTable.#STATUS_COLS
        .map((c) => `<td>${(r[c.key] || 0).toLocaleString()}</td>`).join('');
      return `<tr data-region-id="${r.region_id}">`
        + `<td>${r.name}</td>${statusCells}<td>${(r.total || 0).toLocaleString()}</td>`
        + `<td>${StreetStatusTable.#barHtml(r)}</td></tr>`;
    }).join('');
  }

  /** Builds an inline 100%-stacked bar (one span per status, sized by share) for a region row. */
  static #barHtml(r) {
    const total = r.total || 0;
    if (!total) return '<div class="street-status-bar" aria-hidden="true"></div>';
    const segments = StreetStatusTable.#STATUS_COLS
      .filter((c) => (r[c.key] || 0) > 0)
      .map((c) => {
        const pct = ((r[c.key] / total) * 100).toFixed(2);
        const title = `${c.label}: ${(r[c.key] || 0).toLocaleString()}`;
        return `<span style="width:${pct}%;background:${c.color}" title="${title}"></span>`;
      }).join('');
    return `<div class="street-status-bar" aria-hidden="true">${segments}</div>`;
  }

  #wireEvents(table, tbody) {
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
    // New numeric column starts descending (most-first); the name column starts ascending (A→Z).
    if (this.#sortKey === key) {
      this.#sortDir *= -1;
    } else {
      this.#sortKey = key;
      this.#sortDir = key === 'name' ? 1 : -1;
    }
    refreshHeader();
    this.#renderBody();
  }

  /** Highlights the rows for the given region ids. @param {number[]} ids */
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

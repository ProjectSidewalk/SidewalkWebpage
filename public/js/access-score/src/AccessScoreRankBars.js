/**
 * One row of the rank list: a neighborhood or a street, whichever unit is in force.
 * @typedef {object} AccessScoreRankRow
 * @property {number} id - The region's or street's id.
 * @property {string} name - What to show; the caller has already named an unnamed way.
 * @property {number} score - In [0, 1].
 * @property {string} label - The row's accessible name, which also carries its tooltip: the caller writes it,
 *   since a neighborhood's says how much of it was explored and a street's says how long it is.
 */

/**
 * What the rank list draws.
 * @typedef {object} AccessScoreRankBarsData
 * @property {string} shapeKey - Identifies the roster: the rows are rebuilt when it changes.
 * @property {AccessScoreRankRow[]} rows - In the order they should read, from `AccessScoreModel#rankedRegions`
 *   or `#rankedStreets`.
 * @property {?Set<number>} outIds - The rows a brush leaves out, muted in place; null with no brush. The owner
 *   decides what "out" means, since a brush can be a score range or a set of slope classes (#5223).
 * @property {?number} selectedId - The row to mark, or null.
 * @property {string} note - A line under the list ("15 neighborhoods below the completion floor", "Top 20 of
 *   2,134 scored streets"), or '' for none.
 * @property {string} empty - What to say instead of an empty list, which differs by unit: a neighborhood can be
 *   ranked once it is explored enough, a street once it is audited at all.
 */

/**
 * The scored units ranked in the AccessScore insights dock (#5217): the neighborhoods, every one with enough
 * data and best first, or — in the streets unit — one end of the street leaderboard (#5223). Each row is a
 * button carrying its name, a bar colored by the ramp at its score, and the figure.
 *
 * This view answers "where does this one sit among the others", so it is never reduced to the selection: a
 * selected row is marked in place (`aria-current`) and a brush mutes the rows outside its range rather
 * than removing them. Rows keep their identity across updates — a weight change reorders the existing buttons
 * rather than rebuilding them, so focus and hover survive a slider drag.
 *
 * Callbacks: `onSelect(id)` on a click; `onHover(id)` and `onHoverEnd()` as the pointer or focus rests on a row.
 * @augments {AccessScoreChart<AccessScoreRankBarsData>}
 */
class AccessScoreRankBars extends AccessScoreChart {
  #els = null;
  #rows = new Map();
  #selectedId = null;

  /** @param {AccessScoreRankBarsData} data - What to draw. */
  render(data) {
    const c = this.container;
    c.innerHTML = `
      <ol class="acs-rank__rows"></ol>
      <p class="acs-rank__note" hidden></p>
      <p class="acs-rank__empty" hidden></p>`;
    this.#els = {
      list: c.querySelector('.acs-rank__rows'),
      note: c.querySelector('.acs-rank__note'),
      empty: c.querySelector('.acs-rank__empty'),
    };
    this.#rows = new Map();
    for (const r of data.rows) {
      const li = document.createElement('li');
      li.innerHTML = `
        <button type="button" class="acs-rank__row" data-row-id="${r.id}">
          <span class="acs-rank__pos"></span>
          <span class="acs-rank__name">${AccessScoreChart.esc(r.name)}</span>
          <span class="acs-rank__track"><span class="acs-rank__bar"></span></span>
          <span class="acs-rank__score"></span>
        </button>`;
      this.#rows.set(r.id, {
        li,
        button: li.querySelector('.acs-rank__row'),
        pos: li.querySelector('.acs-rank__pos'),
        bar: li.querySelector('.acs-rank__bar'),
        score: li.querySelector('.acs-rank__score'),
      });
    }
    this.#bind();
    this.update(data);
  }

  /** @param {AccessScoreRankBarsData} data - What to draw, over the rows of the last render. */
  update(data) {
    const list = this.#els.list;
    // Appending an existing node moves it, so the reorder is the sort itself, with no teardown.
    data.rows.forEach((r, i) => {
      const row = this.#rows.get(r.id);
      list.appendChild(row.li);
      row.pos.textContent = AccessScoreChart.number(i + 1);
      row.bar.style.width = `${r.score * 100}%`;
      row.bar.style.backgroundColor = ScoreRamp.at(r.score);
      row.score.textContent = AccessScoreChart.score(r.score);
      row.button.classList.toggle('acs-rank__row--out', Boolean(data.outIds?.has(r.id)));
      // A name like "Al 'Ummah Community Center" reaches the accessible name as written, and the tooltip (an HTML
      // sink) escaped exactly once.
      row.button.setAttribute('aria-label', r.label);
      // The name column is narrow enough to clip a long name; the tooltip carries the whole line.
      row.button.setAttribute('data-ps-tooltip', AccessScoreChart.esc(r.label));
    });
    this.#markSelected(data.selectedId);
    this.#els.note.hidden = data.note === '';
    this.#els.note.textContent = data.note;
    this.#els.empty.hidden = data.rows.length > 0;
    this.#els.empty.textContent = data.empty;
  }

  /**
   * Marks a set of rows as hovered — the map's own hover, or a histogram bin's members.
   * @param {Iterable<number>} ids - Region or street ids, whichever the rows are.
   */
  highlight(ids) {
    const set = new Set(ids);
    for (const [id, row] of this.#rows) row.button.classList.toggle('acs-rank__row--hover', set.has(id));
  }

  /** Drops the hover marks. */
  clearHighlight() {
    for (const row of this.#rows.values()) row.button.classList.remove('acs-rank__row--hover');
  }

  #markSelected(id) {
    const changed = id !== this.#selectedId;
    this.#selectedId = id;
    for (const [rid, row] of this.#rows) {
      if (rid === id) row.button.setAttribute('aria-current', 'true');
      else row.button.removeAttribute('aria-current');
    }
    // A selection made on the map may be far down a long list; bring it into view once, not on every redraw.
    if (changed && id !== null) this.#rows.get(id)?.li.scrollIntoView?.({ block: 'nearest' });
  }

  #bind() {
    const list = this.#els.list;
    const idOf = (e) => {
      const button = e.target.closest?.('.acs-rank__row');
      return button ? Number(button.dataset.rowId) : null;
    };
    list.addEventListener('click', (e) => {
      const id = idOf(e);
      if (id !== null) this.emit('onSelect', id);
    });
    list.addEventListener('pointerover', (e) => {
      const id = idOf(e);
      if (id !== null) this.emit('onHover', id);
    });
    list.addEventListener('pointerleave', () => this.emit('onHoverEnd'));
    list.addEventListener('focusin', (e) => {
      const id = idOf(e);
      if (id !== null) this.emit('onHover', id);
    });
    list.addEventListener('focusout', (e) => {
      if (!list.contains(e.relatedTarget)) this.emit('onHoverEnd');
    });
  }
}

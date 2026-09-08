/**
 * The neighborhoods ranked by score in the AccessScore insights dock (#5217): every region with enough data,
 * best first, each a button carrying its name, a bar colored by the ramp at its score, and the figure.
 *
 * This view answers "where does this one sit among the others", so it is never reduced to the selection: a
 * selected neighborhood is marked in place (`aria-current`) and a brush mutes the rows outside its range rather
 * than removing them. Rows keep their identity across updates — a weight change reorders the existing buttons
 * rather than rebuilding them, so focus and hover survive a slider drag.
 *
 * Callbacks: `onSelect(regionId)` on a click; `onHover(regionId)` and `onHoverEnd()` as the pointer or focus
 * rests on a row.
 */
class AccessScoreRankBars extends AccessScoreChart {
  #els = null;
  #rows = new Map();
  #selectedId = null;

  /**
   * @param {object} data - `{shapeKey, rows, brush, selectedId, hoverId, floored}`: `rows` from
   *   `AccessScoreModel#rankedRegions` (the shape key names their ids), `brush` `{from, to}` in bin indices or
   *   null, `selectedId` the region to mark or null, `floored` how many regions the completion floor left out.
   */
  render(data) {
    const c = this.container;
    c.innerHTML = `
      <ol class="acs-rank__rows"></ol>
      <p class="acs-rank__note" hidden></p>
      <p class="acs-rank__empty" hidden>${i18next.t('accessscore:rank-empty')}</p>`;
    this.#els = {
      list: c.querySelector('.acs-rank__rows'),
      note: c.querySelector('.acs-rank__note'),
      empty: c.querySelector('.acs-rank__empty'),
    };
    this.#rows = new Map();
    for (const r of data.rows) {
      const li = document.createElement('li');
      li.innerHTML = `
        <button type="button" class="acs-rank__row" data-region-id="${r.regionId}">
          <span class="acs-rank__pos"></span>
          <span class="acs-rank__name">${AccessScoreChart.esc(r.name)}</span>
          <span class="acs-rank__track"><span class="acs-rank__bar"></span></span>
          <span class="acs-rank__score"></span>
        </button>`;
      this.#rows.set(r.regionId, {
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

  update(data) {
    const list = this.#els.list;
    // Appending an existing node moves it, so the reorder is the sort itself, with no teardown.
    data.rows.forEach((r, i) => {
      const row = this.#rows.get(r.regionId);
      list.appendChild(row.li);
      row.pos.textContent = AccessScoreChart.number(i + 1);
      row.bar.style.width = `${r.score * 100}%`;
      row.bar.style.backgroundColor = ScoreRamp.at(r.score);
      row.score.textContent = AccessScoreChart.score(r.score);
      const bin = AccessScoreModel.binOf(r.score);
      row.button.classList.toggle('acs-rank__row--out', Boolean(data.brush) && (bin < data.brush.from
        || bin >= data.brush.to));
      const label = i18next.t('accessscore:rank-row', {
        position: i + 1, name: r.name, score: AccessScoreChart.score(r.score),
        percent: Math.round(r.completion * 100),
      });
      row.button.setAttribute('aria-label', label);
      // The name column is narrow enough to clip a long name; the tooltip carries the whole line.
      row.button.setAttribute('data-ps-tooltip', AccessScoreChart.esc(label));
    });
    this.#markSelected(data.selectedId);
    this.#els.note.hidden = data.floored === 0;
    this.#els.note.textContent = i18next.t('accessscore:rank-floored', { count: data.floored });
    this.#els.empty.hidden = data.rows.length > 0;
  }

  /**
   * Marks a set of regions as hovered — the map's own hover, or a histogram bin's members.
   * @param {Iterable<number>} ids - Region ids.
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
      return button ? Number(button.dataset.regionId) : null;
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

/**
 * What drives the scores in the AccessScore insights dock (#5217): one diverging bar per scored type — its mean
 * effect per street over the streets in scope (and in the brush, when there is one), helps to the right in the
 * ramp's good color and hurts to the left in its bad color — sorted by how much it moves the score, with the
 * cluster count behind it as the secondary figure.
 *
 * This is the map hover's "helped most by / hurt most by" line, generalized to a population: brush the 20–40
 * range and the view says what is dragging those streets down. The rating breakdown of the clusters is in each
 * bar's tooltip rather than on the bar, where it read as inventory. A type's name toggles its dots on the map.
 *
 * Callbacks: `onToggleType(type, shown)` when a type's name is clicked.
 */
class AccessScoreDriversBars extends AccessScoreChart {
  #els = null;
  #rows = new Map();

  /**
   * @param {object} data - `{shapeKey, rows, hidden, streets}`: `rows` one per scored type, `{type, mean,
   *   count, buckets}` (`mean` the type's mean term per audited street from `AccessScoreModel#contributions`,
   *   `count` and `buckets` from `clusterBreakdown`), `hidden` the set of types whose map dots are off, `streets`
   *   how many audited streets were counted.
   */
  render(data) {
    const c = this.container;
    c.innerHTML = `
      <ol class="acs-drivers__rows"></ol>
      <div class="acs-drivers__axis" aria-hidden="true">
        <span>${i18next.t('accessscore:row-hurts')}</span>
        <span>${i18next.t('accessscore:row-helps')}</span>
      </div>
      <p class="acs-drivers__empty" hidden>${i18next.t('accessscore:drivers-empty')}</p>`;
    this.#els = { list: c.querySelector('.acs-drivers__rows'), empty: c.querySelector('.acs-drivers__empty') };
    this.#rows = new Map();
    for (const { type } of data.rows) {
      const li = document.createElement('li');
      li.className = 'acs-drivers__row';
      li.dataset.type = type;
      li.innerHTML = `
        <button type="button" class="acs-drivers__type" aria-pressed="true">
          <img class="acs-drivers__icon" src="${util.misc.getIconImagePaths(type).iconImagePath}" alt="">
          <span class="acs-drivers__name">${AccessScoreChart.esc(AccessScoreChart.typeName(type))}</span>
        </button>
        <span class="acs-drivers__track" role="img" tabindex="0">
          <span class="acs-drivers__zero"></span>
          <span class="acs-drivers__bar"></span>
        </span>
        <span class="acs-drivers__value"></span>
        <span class="acs-drivers__count"></span>`;
      const row = {
        li,
        toggle: li.querySelector('.acs-drivers__type'),
        track: li.querySelector('.acs-drivers__track'),
        bar: li.querySelector('.acs-drivers__bar'),
        value: li.querySelector('.acs-drivers__value'),
        count: li.querySelector('.acs-drivers__count'),
      };
      row.toggle.addEventListener('click', () => {
        this.emit('onToggleType', type, row.toggle.getAttribute('aria-pressed') !== 'true');
      });
      this.#rows.set(type, row);
    }
    this.update(data);
  }

  update(data) {
    const max = Math.max(0.05, ...data.rows.map((r) => Math.abs(r.mean)));
    const sorted = [...data.rows].sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean));
    for (const r of sorted) {
      const row = this.#rows.get(r.type);
      // Appending an existing node moves it, so the sort is the reorder.
      this.#els.list.appendChild(row.li);
      const shown = !data.hidden.has(r.type);
      const name = AccessScoreChart.typeName(r.type);
      row.toggle.setAttribute('aria-pressed', String(shown));
      const stateKey = shown ? 'accessscore:cluster-type-shown' : 'accessscore:cluster-type-hidden';
      row.toggle.setAttribute('aria-label', i18next.t(stateKey, { type: name }));
      row.li.classList.toggle('acs-drivers__row--hidden', !shown);
      const helps = r.mean > 0;
      row.bar.classList.toggle('acs-drivers__bar--help', helps);
      row.bar.classList.toggle('acs-drivers__bar--hurt', !helps && r.mean < 0);
      row.bar.style.width = `${(Math.abs(r.mean) / max) * 50}%`;
      const value = AccessScoreDriversBars.#signed(r.mean);
      row.value.textContent = value;
      row.count.textContent = AccessScoreChart.number(r.count);
      const parts = [];
      for (const [bucket, count] of Object.entries(r.buckets)) {
        if (count === 0) continue;
        const rating = bucket === 'null'
          ? i18next.t('accessscore:cluster-unrated')
          : i18next.t(`common:${util.misc.getRatingLevelKeys(r.type)[Number(bucket)]}`);
        parts.push(`${AccessScoreChart.number(count)} ${rating}`);
      }
      const label = i18next.t('accessscore:drivers-row', {
        type: name, value, streets: AccessScoreChart.number(data.streets), count: AccessScoreChart.number(r.count),
        parts: parts.join(', '),
      });
      row.track.setAttribute('aria-label', label);
      row.track.setAttribute('data-ps-tooltip', AccessScoreChart.esc(label));
    }
    this.#els.empty.hidden = data.streets > 0;
  }

  /** A signed per-street effect, as text ("+1.43", "−0.20"). */
  static #signed(value) {
    return (value >= 0 ? '+' : '−') + Math.abs(value).toFixed(2);
  }
}

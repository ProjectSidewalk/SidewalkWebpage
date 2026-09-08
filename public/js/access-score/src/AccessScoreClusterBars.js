/**
 * The clusters behind the scores, by type and rating, in the AccessScore insights dock (#5217): one row per
 * scored type — its icon, its name as a toggle for its dots on the map, a bar stacked by rating bucket, and the
 * count — computed over whatever the dock's scope and brush leave in.
 *
 * Rating colors come from `util.misc.getSeverityLevelColors`, which flips the scale for a positive type (a curb
 * ramp rated 1 is *good*; an obstacle rated 1 is a mild problem), so the two kinds of type read on different
 * palettes and the legend shows both. Bar lengths are relative to the largest type in view.
 *
 * Callbacks: `onToggleType(type, shown)` when a type's name is clicked.
 */
class AccessScoreClusterBars extends AccessScoreChart {
  #els = null;

  /**
   * @param {object} data - `{shapeKey, types, total, buckets, hidden, streets}`: `types` and `total` from
   *   `AccessScoreModel#clusterBreakdown`, `buckets` the engine's severity buckets in order, `hidden` the set of
   *   types whose map dots are off, `problemTypes` the set of types that count against accessibility.
   */
  render(data) {
    const c = this.container;
    const rated = data.buckets.filter((b) => b !== 'null');
    // One representative type per kind: the palette is the kind's, not the type's.
    const swatch = (color, text) => `
      <span class="acs-clusters__legend-item">
        <span class="acs-clusters__swatch" style="background: ${color};"></span>${text}
      </span>`;
    const legend = (kind, type) => `
      <span class="acs-clusters__legend-group">
        <span class="acs-clusters__legend-kind">${i18next.t(`accessscore:cluster-legend-${kind}`)}</span>
        ${rated.map((b) => swatch(util.misc.getSeverityLevelColors(Number(b), type).face,
          i18next.t(`common:${util.misc.getRatingLevelKeys(type)[Number(b)]}`))).join('')}
      </span>`;
    c.innerHTML = `
      <div class="acs-clusters__legend" aria-hidden="true">
        ${legend('features', 'CurbRamp')}
        ${legend('problems', 'Obstacle')}
        ${swatch('var(--color-neutral-400)', i18next.t('accessscore:cluster-unrated'))}
      </div>
      <ol class="acs-clusters__rows">
        ${data.types.map(({ type }) => `
          <li class="acs-clusters__row" data-type="${type}">
            <button type="button" class="acs-clusters__type" aria-pressed="true">
              <img class="acs-clusters__icon" src="${util.misc.getIconImagePaths(type).iconImagePath}" alt="">
              <span class="acs-clusters__name">${AccessScoreChart.esc(AccessScoreChart.typeName(type))}</span>
            </button>
            <span class="acs-clusters__bar" role="img" tabindex="0">
              ${data.buckets.map((b) => `<span class="acs-clusters__seg" data-bucket="${b}"></span>`).join('')}
            </span>
            <span class="acs-clusters__count"></span>
          </li>`).join('')}
      </ol>
      <p class="acs-clusters__empty" hidden>${i18next.t('accessscore:clusters-empty')}</p>`;
    this.#els = {
      rows: Object.fromEntries(data.types.map(({ type }) => {
        const row = c.querySelector(`.acs-clusters__row[data-type="${type}"]`);
        const segs = Object.fromEntries(data.buckets.map((b) =>
          [b, row.querySelector(`.acs-clusters__seg[data-bucket="${b}"]`)]));
        for (const b of data.buckets) {
          // Unrated clusters (a type without a rating, or a label left unrated) take the neutral wash.
          const colors = b === 'null' ? null : util.misc.getSeverityLevelColors(Number(b), type);
          segs[b].style.backgroundColor = colors ? colors.face : 'var(--color-neutral-400)';
        }
        return [type, {
          row,
          toggle: row.querySelector('.acs-clusters__type'),
          bar: row.querySelector('.acs-clusters__bar'),
          segs,
          count: row.querySelector('.acs-clusters__count'),
        }];
      })),
      empty: c.querySelector('.acs-clusters__empty'),
    };
    for (const [type, row] of Object.entries(this.#els.rows)) {
      row.toggle.addEventListener('click', () => {
        const shown = row.toggle.getAttribute('aria-pressed') !== 'true';
        this.emit('onToggleType', type, shown);
      });
    }
    this.update(data);
  }

  update(data) {
    const max = Math.max(0, ...data.types.map((t) => t.total));
    for (const entry of data.types) {
      const row = this.#els.rows[entry.type];
      const shown = !data.hidden.has(entry.type);
      const name = AccessScoreChart.typeName(entry.type);
      row.toggle.setAttribute('aria-pressed', String(shown));
      const stateKey = shown ? 'accessscore:cluster-type-shown' : 'accessscore:cluster-type-hidden';
      row.toggle.setAttribute('aria-label', i18next.t(stateKey, { type: name }));
      row.row.classList.toggle('acs-clusters__row--hidden', !shown);
      row.bar.style.width = `${max > 0 ? (entry.total / max) * 100 : 0}%`;
      const parts = [];
      for (const [bucket, count] of Object.entries(entry.buckets)) {
        row.segs[bucket].style.flexGrow = String(count);
        row.segs[bucket].hidden = count === 0;
        if (count > 0) {
          const rating = bucket === 'null'
            ? i18next.t('accessscore:cluster-unrated')
            : i18next.t(`common:${util.misc.getRatingLevelKeys(entry.type)[Number(bucket)]}`);
          parts.push(`${AccessScoreChart.number(count)} ${rating}`);
        }
      }
      const label = i18next.t('accessscore:cluster-bar', {
        type: name, count: AccessScoreChart.number(entry.total), parts: parts.join(', '),
      });
      row.bar.setAttribute('aria-label', label);
      row.bar.setAttribute('data-ps-tooltip', AccessScoreChart.esc(label));
      row.count.textContent = AccessScoreChart.number(entry.total);
    }
    this.#els.empty.hidden = data.total > 0;
  }
}

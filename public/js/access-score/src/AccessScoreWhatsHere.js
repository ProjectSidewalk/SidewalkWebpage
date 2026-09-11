/**
 * What's here, in the AccessScore insights dock (#5217): one row per scored label type — its icon, name, cluster
 * count, and a bar split by rating — over the scope in view (the city, the selected neighborhood or street, further
 * narrowed by a brush). It answers the tool's "why" in the vocabulary readers already know from Explore: how many
 * curb ramps, how many of them bad; how many obstacles, how many severe.
 *
 * The bar's segments wear the label card's own rating colors, so a "bad" segment reads the same here as on a
 * label, and the scale runs the right way per type (a 3 is a bad curb ramp and a severe obstacle). Bar lengths are
 * relative to the largest row in view. The rows only read: the map's dots are the map's business.
 */
class AccessScoreWhatsHere extends AccessScoreChart {
  #els = null;
  #rows = new Map();

  /**
   * @param {object} data - `{shapeKey, rows, caption, empty}`: `rows` one per scored type in the engine's order,
   *   `{type, count, buckets, rated}` (`count` and `buckets` from `AccessScoreModel#clusterBreakdown`, `rated`
   *   false for a type the engine counts without a rating), `caption` the scope's wording, `empty` true when the
   *   scope holds no audited street.
   */
  render(data) {
    const c = this.container;
    c.innerHTML = `
      <p class="acs-whats-here__caption"></p>
      <ol class="acs-whats-here__rows"></ol>
      <p class="acs-whats-here__empty" hidden>${i18next.t('accessscore:whats-here-empty')}</p>`;
    this.#els = {
      caption: c.querySelector('.acs-whats-here__caption'),
      list: c.querySelector('.acs-whats-here__rows'),
      empty: c.querySelector('.acs-whats-here__empty'),
    };
    this.#rows = new Map();
    for (const { type, buckets, rated } of data.rows) {
      const li = document.createElement('li');
      li.className = 'acs-whats-here__row';
      li.dataset.type = type;
      // An unrated type is one segment; a rated one has a segment per bucket, the unrated bucket last.
      const segments = rated
        ? Object.keys(buckets).map((b) => `<span class="acs-whats-here__segment" data-bucket="${b}"></span>`)
        : ['<span class="acs-whats-here__segment acs-whats-here__segment--unrated" data-bucket="all"></span>'];
      li.innerHTML = `
        <span class="acs-whats-here__type">
          <img class="acs-whats-here__icon" src="${util.misc.getIconImagePaths(type).iconImagePath}" alt="">
          <span class="acs-whats-here__name">
            <span class="acs-whats-here__name-long">${AccessScoreChart.esc(AccessScoreChart.typeName(type))}</span>
            <span class="acs-whats-here__name-short">${AccessScoreChart.esc(AccessScoreWhatsHere.#shortName(type))}</span>
          </span>
        </span>
        <span class="acs-whats-here__track" role="img" tabindex="0">
          <span class="acs-whats-here__bar">${segments.join('')}</span>
        </span>
        <span class="acs-whats-here__count"></span>`;
      const row = {
        li,
        track: li.querySelector('.acs-whats-here__track'),
        bar: li.querySelector('.acs-whats-here__bar'),
        segments: Object.fromEntries(Array.from(li.querySelectorAll('.acs-whats-here__segment'))
          .map((el) => [el.dataset.bucket, el])),
        count: li.querySelector('.acs-whats-here__count'),
      };
      if (rated) {
        // As a custom property rather than a background: the label card's helper hands back `var(--…)` tokens,
        // and the stylesheet resolves the token where an inline shorthand would not be portable.
        for (const [bucket, el] of Object.entries(row.segments)) {
          const colors = bucket === 'null' ? null : util.misc.getSeverityLevelColors(Number(bucket), type);
          if (colors) el.style.setProperty('--acs-segment', colors.face);
        }
      }
      this.#rows.set(type, row);
      this.#els.list.appendChild(li);
    }
    this.update(data);
  }

  update(data) {
    this.#els.caption.textContent = data.caption;
    const max = Math.max(1, ...data.rows.map((r) => r.count));
    for (const r of data.rows) {
      const row = this.#rows.get(r.type);
      const name = AccessScoreChart.typeName(r.type);
      row.li.classList.toggle('acs-whats-here__row--none', r.count === 0);
      row.bar.style.width = `${(r.count / max) * 100}%`;
      if (r.rated) {
        for (const [bucket, el] of Object.entries(row.segments)) {
          const n = r.buckets[bucket] || 0;
          el.style.flexGrow = String(n);
          el.hidden = n === 0;
        }
      }
      row.count.textContent = AccessScoreChart.number(r.count);
      const parts = [];
      if (r.rated) {
        for (const [bucket, count] of Object.entries(r.buckets)) {
          if (count === 0) continue;
          const rating = bucket === 'null'
            ? i18next.t('accessscore:cluster-unrated')
            : i18next.t(`common:${util.misc.getRatingLevelKeys(r.type)[Number(bucket)]}`);
          parts.push(`${AccessScoreChart.number(count)} ${rating}`);
        }
      }
      const count = AccessScoreChart.number(r.count);
      // Plain text: the accessible name takes it as is, the tooltip (an HTML sink) escaped exactly once.
      let label;
      if (r.count === 0) label = AccessScoreChart.text('accessscore:whats-here-row-none', { type: name });
      else if (parts.length === 0) label = AccessScoreChart.text('accessscore:whats-here-row-unrated', { type: name, count });
      else label = AccessScoreChart.text('accessscore:whats-here-row', { type: name, count, parts: parts.join(', ') });
      row.track.setAttribute('aria-label', label);
      row.track.setAttribute('data-ps-tooltip', AccessScoreChart.esc(label));
    }
    this.#els.empty.hidden = !data.empty;
    this.#els.list.hidden = data.empty;
  }

  /** The short type name for a narrow panel ("Ramp" for "Curb Ramp"), from the tool's own strings. */
  static #shortName(type) {
    return i18next.t(`accessscore:type-short-${util.camelToKebab(type)}`);
  }
}

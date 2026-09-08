/**
 * The labels behind one cluster, all at once (#5217): a modal sheet opened from a cluster dot, with a compact
 * card per label — its saved crop (or the pano's backup image), rating, tags, votes, and date — so the reader
 * sees the agreement a cluster stands for without paging. A card opens the full label card.
 *
 * Crops rather than live panos: a cluster of ten would otherwise be ten street-view loads. A label with neither
 * a crop nor a backup image shows its type icon in place of a picture.
 */
class AccessScoreClusterSheet {
  /** More cards than this and the sheet says how many it left out rather than fetching a wall of metadata. */
  static MAX_CARDS = 24;

  #dialog;
  #onOpenLabel;
  #log;
  #els;
  #openToken = 0;

  /**
   * @param {object} options - Callbacks.
   * @param {function} options.onOpenLabel - Called with `(labelId, clusterLabelIds)` when a card is chosen.
   * @param {function} [options.log] - Called with `(kind, value)` for an interaction worth logging.
   */
  constructor({ onOpenLabel, log = () => {} }) {
    this.#onOpenLabel = onOpenLabel;
    this.#log = log;
    this.#dialog = document.createElement('dialog');
    this.#dialog.className = 'acs-sheet';
    this.#dialog.setAttribute('aria-labelledby', 'acs-sheet-title');
    this.#dialog.innerHTML = `
      <div class="acs-sheet__head">
        <img class="acs-sheet__icon" alt="">
        <div class="acs-sheet__titles">
          <h2 class="acs-sheet__title" id="acs-sheet-title"></h2>
          <p class="acs-sheet__meta"></p>
        </div>
        <button type="button" class="acs-sheet__close" aria-label="${AccessScoreChart.esc(i18next.t('common:close'))}">
          <img src="${util.assetPath('images/icons/cross.svg')}" alt="">
        </button>
      </div>
      <p class="acs-sheet__status" role="status"></p>
      <ul class="acs-sheet__grid"></ul>
      <p class="acs-sheet__more" hidden></p>`;
    document.body.appendChild(this.#dialog);
    this.#els = {
      icon: this.#dialog.querySelector('.acs-sheet__icon'),
      title: this.#dialog.querySelector('.acs-sheet__title'),
      meta: this.#dialog.querySelector('.acs-sheet__meta'),
      status: this.#dialog.querySelector('.acs-sheet__status'),
      grid: this.#dialog.querySelector('.acs-sheet__grid'),
      more: this.#dialog.querySelector('.acs-sheet__more'),
    };
    this.#dialog.querySelector('.acs-sheet__close').addEventListener('click', () => this.close());
    // A click on the backdrop closes; a click inside the box (its padding included) does not.
    this.#dialog.addEventListener('click', (e) => {
      if (e.target !== this.#dialog) return;
      const r = this.#dialog.getBoundingClientRect();
      const inside = r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right;
      if (!inside) this.close();
    });
    this.#els.grid.addEventListener('click', (e) => {
      const card = e.target.closest('.acs-sheet__card');
      if (!card) return;
      const labelId = Number(card.dataset.labelId);
      this.#log('SheetOpenLabel_labelId', labelId);
      this.close();
      this.#onOpenLabel(labelId, this.#ids);
    });
  }

  #ids = [];

  /**
   * Opens the sheet for a cluster and loads its labels.
   * @param {object} props - The cluster's properties from the map layer: `label_type`, `label_ids`,
   *                         `cluster_size`, `median_severity`, `street_edge_id`.
   * @param {string} [effect] - An optional line saying what the cluster's type does to its street's score.
   */
  async open(props, effect = '') {
    const type = props.label_type;
    const ids = props.label_ids || [];
    this.#ids = ids;
    const token = ++this.#openToken;
    this.#els.icon.src = util.misc.getIconImagePaths(type).iconImagePath;
    this.#els.title.textContent = i18next.t('accessscore:sheet-title', { type: AccessScoreChart.typeName(type) });
    const rating = util.misc.labelTypeHasSeverity(type) && props.median_severity
      ? i18next.t(`common:${util.misc.getRatingLevelKeys(type)[props.median_severity]}`)
      : null;
    this.#els.meta.textContent = [
      i18next.t('accessscore:sheet-meta', { count: ids.length, street: props.street_edge_id }),
      rating,
      effect,
    ].filter(Boolean).join(' · ');
    this.#els.grid.innerHTML = '';
    this.#els.more.hidden = ids.length <= AccessScoreClusterSheet.MAX_CARDS;
    this.#els.more.textContent = i18next.t('accessscore:sheet-more',
      { count: Math.max(0, ids.length - AccessScoreClusterSheet.MAX_CARDS) });
    this.#els.status.textContent = i18next.t('accessscore:sheet-loading');
    if (!this.#dialog.open) this.#dialog.showModal();

    const shown = ids.slice(0, AccessScoreClusterSheet.MAX_CARDS);
    const results = await Promise.allSettled(shown.map((id) => fetch(`/label/id/${id}`).then((r) => {
      if (!r.ok) throw new Error(`label ${id}: HTTP ${r.status}`);
      return r.json();
    })));
    if (token !== this.#openToken) return; // Another cluster was opened while these loaded.
    const loaded = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    this.#els.status.textContent = loaded.length === shown.length
      ? ''
      : i18next.t('accessscore:sheet-error', { count: shown.length - loaded.length });
    this.#els.grid.innerHTML = loaded.map((label) => this.#cardHtml(label)).join('');
    // A card whose image fails to load falls back to the type icon, the same as one that never had an image.
    for (const img of this.#els.grid.querySelectorAll('.acs-sheet__image')) {
      img.addEventListener('error', () => {
        img.replaceWith(AccessScoreClusterSheet.#placeholder(type));
      }, { once: true });
    }
  }

  /** Closes the sheet, if open. */
  close() {
    if (this.#dialog.open) this.#dialog.close();
  }

  /** One label's card: image or placeholder, then rating, tags, votes, and the date it was labeled. */
  #cardHtml(label) {
    const type = label.label_type;
    const src = label.crop_url || label.backup_image_url;
    const image = src
      ? `<img class="acs-sheet__image" src="${AccessScoreChart.esc(src)}" alt="" loading="lazy">`
      : AccessScoreClusterSheet.#placeholder(type).outerHTML;
    const rating = util.misc.labelTypeHasSeverity(type) && label.severity
      ? i18next.t(`common:${util.misc.getRatingLevelKeys(type)[label.severity]}`)
      : null;
    const tags = (label.tags || []).map((tag) => `<span class="acs-sheet__tag">${
      AccessScoreChart.esc(i18next.t(`common:tag.${tag}`, { defaultValue: tag }))}</span>`).join('');
    const votes = i18next.t('accessscore:sheet-votes', {
      agree: AccessScoreChart.number(label.num_agree || 0), disagree: AccessScoreChart.number(label.num_disagree || 0),
    });
    const date = label.timestamp
      ? new Intl.DateTimeFormat(i18next.language, { dateStyle: 'medium' }).format(new Date(label.timestamp))
      : '';
    const name = [rating, votes, date].filter(Boolean).join(' · ');
    return `
      <li>
        <button type="button" class="acs-sheet__card" data-label-id="${label.label_id}"
                aria-label="${AccessScoreChart.esc(i18next.t('accessscore:sheet-open', { label: name }))}">
          <span class="acs-sheet__figure">${image}</span>
          <span class="acs-sheet__caption">
            ${rating ? `<span class="acs-sheet__rating">${AccessScoreChart.esc(rating)}</span>` : ''}
            <span class="acs-sheet__votes">${AccessScoreChart.esc(votes)}</span>
            ${tags ? `<span class="acs-sheet__tags">${tags}</span>` : ''}
            <span class="acs-sheet__date">${AccessScoreChart.esc(date)}</span>
          </span>
        </button>
      </li>`;
  }

  /** The stand-in for a label with no picture: its type icon on a neutral panel. */
  static #placeholder(type) {
    const el = document.createElement('span');
    el.className = 'acs-sheet__placeholder';
    el.innerHTML = `<img src="${util.misc.getIconImagePaths(type).iconImagePath}" alt="">
      <span>${AccessScoreChart.esc(i18next.t('accessscore:sheet-no-image'))}</span>`;
    return el;
  }
}

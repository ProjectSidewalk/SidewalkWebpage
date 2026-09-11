/**
 * The labels behind one cluster, all at once (#5217): a modal sheet of `LabelMiniCard`s opened from a cluster dot,
 * so the reader sees the agreement a cluster stands for, and can add to it, without paging. Crops rather than
 * live panos: a cluster of ten would otherwise be ten street-view loads.
 */
class AccessScoreClusterSheet {
  /** More cards than this and the sheet says how many it left out rather than fetching a wall of metadata. */
  static MAX_CARDS = 24;

  #dialog;
  #onOpenLabel;
  #log;
  #els;
  #openToken = 0;
  /** The cards on show, by label id, so a vote cast in the full label card can be reflected here. */
  #cards = new Map();

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
    this.#els.title.textContent = AccessScoreChart.text('accessscore:sheet-title', { type: AccessScoreChart.typeName(type) });
    const rating = util.misc.labelTypeHasSeverity(type) && props.median_severity
      ? i18next.t(`common:${util.misc.getRatingLevelKeys(type)[props.median_severity]}`)
      : null;
    this.#els.meta.textContent = [
      i18next.t('accessscore:sheet-meta', { count: ids.length, street: props.street_edge_id }),
      rating,
      effect,
    ].filter(Boolean).join(' · ');
    this.#els.grid.innerHTML = '';
    this.#cards.clear();
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
    for (const label of loaded) {
      const card = new LabelMiniCard(label, {
        size: 'sheet',
        source: 'AccessScoreSheet',
        log: this.#log,
        onOpen: (labelId) => {
          this.#log('SheetOpenLabel_labelId', labelId);
          this.close();
          this.#onOpenLabel(labelId, this.#ids);
        },
      });
      this.#cards.set(label.label_id, card);
      this.#els.grid.appendChild(card.element);
    }
  }

  /**
   * Re-renders one card from fresh label JSON, after a vote cast in the full label card.
   * @param {object} label - A `/label/id/:id` JSON.
   */
  refreshLabel(label) {
    this.#cards.get(label.label_id)?.update(label);
  }

  /** Closes the sheet, if open. */
  close() {
    if (this.#dialog.open) this.#dialog.close();
  }
}

/**
 * The labels behind one cluster, all at once (#5217): a modal sheet of `LabelMiniCard`s opened from a cluster dot,
 * so the reader sees the agreement a cluster stands for, and can add to it, without paging. Crops rather than
 * live panos: a cluster of ten would otherwise be ten street-view loads.
 *
 * Prev and next arrows (#5748), as the label card has, step to the next cluster on the map through a navigator
 * the host supplies: the nearest not yet visited, and back along the trail. The arrow keys do the same.
 */

import i18next from 'i18next';
import { LabelMiniCard } from '../common/LabelMiniCard.js';
import { util } from '../common/utilities.js';
import '../common/utilitiesSidewalk.js';
/** @typedef {import('./AccessScoreClusterLayer.js').AccessScoreClusterProps} AccessScoreClusterProps */

export class AccessScoreClusterSheet {
  /** More cards than this and the sheet says how many it left out rather than fetching a wall of metadata. */
  static MAX_CARDS = 24;

  #dialog;
  #onOpenLabel;
  #log;
  #onLoaded;
  #onNavigate;
  /** @type {?{next: (id: number) => ?number, prev: (id: number) => ?number, hasNext: (id: number) => boolean,
   *   hasPrev: (id: number) => boolean, onRefresh: (cb: () => void) => void}} */
  #nav = null;
  #els;
  #openToken = 0;
  /** The cards on show, by label id, so a vote cast in the full label card can be reflected here. */
  #cards = new Map();

  /**
   * @param {object} options - Callbacks.
   * @param {(labelId: number, clusterLabelIds: number[]) => void} options.onOpenLabel - Called when a card is
   *   chosen, with the cluster's label ids for the card's arrows to page through.
   * @param {(kind: string, value?: string|number) => void} [options.log] - Called for an interaction worth logging.
   * @param {(clusterId: ?number) => void} [options.onClose] - Called as the sheet closes, however it closes, with
   *   the cluster it was showing.
   * @param {(clusterId: ?number) => void} [options.onLoaded] - Called once a cluster's cards are on show, when the
   *   sheet has its full size: a host placing something beside it (#5748) can only do so then.
   * @param {(clusterId: number) => void} [options.onNavigate] - Called with the cluster an arrow lands on; the
   *   host opens it as a click on its dot would.
   */
  constructor({ onOpenLabel, log = () => {}, onClose = () => {}, onLoaded = () => {}, onNavigate = () => {} }) {
    this.#onOpenLabel = onOpenLabel;
    this.#log = log;
    this.#onLoaded = onLoaded;
    this.#onNavigate = onNavigate;
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
        <button type="button" class="acs-sheet__paging acs-sheet__paging--prev" data-acs-page="prev"
            aria-label="${util.escapeHTML(i18next.t('accessscore:sheet-prev'))}" aria-keyshortcuts="ArrowLeft" hidden>
          <img src="${util.assetPath('images/icons/chevron-left-feather.svg')}" alt="">
        </button>
        <button type="button" class="acs-sheet__paging acs-sheet__paging--next" data-acs-page="next"
            aria-label="${util.escapeHTML(i18next.t('accessscore:sheet-next'))}" aria-keyshortcuts="ArrowRight" hidden>
          <img src="${util.assetPath('images/icons/chevron-right-feather.svg')}" alt="">
        </button>
        <button type="button" class="acs-sheet__close" aria-label="${util.escapeHTML(i18next.t('common:close'))}">
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
      prev: this.#dialog.querySelector('.acs-sheet__paging--prev'),
      next: this.#dialog.querySelector('.acs-sheet__paging--next'),
    };
    this.#els.prev.addEventListener('click', () => this.#page('prev'));
    this.#els.next.addEventListener('click', () => this.#page('next'));
    // The arrow keys page as the chips do, unless the reader is typing in something of the sheet's own.
    this.#dialog.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      this.#page(e.key === 'ArrowLeft' ? 'prev' : 'next');
    });
    this.#dialog.querySelector('.acs-sheet__close').addEventListener('click', () => this.close());
    // The dialog's own event, so Escape and the backdrop count as well as the button.
    this.#dialog.addEventListener('close', () => onClose(this.#clusterId));
    // A click on the backdrop closes; a click inside the box (its padding included) does not.
    this.#dialog.addEventListener('click', (e) => {
      if (e.target !== this.#dialog) return;
      const r = this.#dialog.getBoundingClientRect();
      const inside = r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right;
      if (!inside) this.close();
    });
  }

  #ids = [];
  /** @type {?number} The cluster on show, so a host can tie the sheet to its dot. */
  #clusterId = null;

  /** @returns {HTMLDialogElement} The sheet's own element. */
  get dialog() {
    return this.#dialog;
  }

  /** @returns {?number} The cluster on show, or null. */
  get clusterId() {
    return this.#clusterId;
  }

  /**
   * Gives the arrows somewhere to go: a navigator over the clusters on the map, in `nearbyLabelNavigator.js`'s
   * shape. The arrows appear with it and follow its refreshes, since a viewport refetch changes what is reachable.
   * @param {{next: (id: number) => ?number, prev: (id: number) => ?number, hasNext: (id: number) => boolean,
   *   hasPrev: (id: number) => boolean, onRefresh: (cb: () => void) => void}} nav - The navigator.
   */
  setNavigator(nav) {
    if (nav !== this.#nav) nav.onRefresh(() => this.#updatePaging());
    this.#nav = nav;
    this.#els.prev.hidden = false;
    this.#els.next.hidden = false;
    this.#updatePaging();
  }

  /** Switches off an arrow with no cluster to go to. */
  #updatePaging() {
    const id = this.#clusterId;
    const can = (fn) => this.#nav !== null && id !== null && fn(id);
    // `aria-disabled` so the arrow just pressed keeps focus (#5135); #page() checks it.
    this.#els.prev.setAttribute('aria-disabled', String(!can((i) => this.#nav.hasPrev(i))));
    this.#els.next.setAttribute('aria-disabled', String(!can((i) => this.#nav.hasNext(i))));
  }

  /**
   * Steps to the previous or next cluster and hands it to the host to open. Checks the arrow first, since even a
   * fruitless next() or prev() changes the navigator's history.
   * @param {'prev'|'next'} direction - Which way to step.
   */
  #page(direction) {
    if (!this.#nav || this.#clusterId === null) return;
    if (this.#els[direction].getAttribute('aria-disabled') === 'true') return;
    const id = direction === 'prev' ? this.#nav.prev(this.#clusterId) : this.#nav.next(this.#clusterId);
    if (id === null || id === undefined) return;
    this.#log('SheetPage', direction);
    this.#onNavigate(id);
  }

  /**
   * Opens the sheet for a cluster and loads its labels.
   * @param {AccessScoreClusterProps} props - The cluster's properties from the map layer.
   * @param {string} [effect] - An optional line saying what the cluster's type does to its street's score.
   */
  async open(props, effect = '') {
    const type = props.label_type;
    const ids = props.label_ids || [];
    this.#ids = ids;
    this.#clusterId = props.label_cluster_id ?? null;
    const token = ++this.#openToken;
    this.#els.icon.src = util.misc.getIconImagePaths(type).iconImagePath;
    this.#els.title.textContent = i18next.t('accessscore:sheet-title', { type: util.misc.labelTypeName(type) });
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
    const shown = ids.slice(0, AccessScoreClusterSheet.MAX_CARDS);
    // The stylesheet sizes the sheet from this: as many cards wide as the cluster has, up to the window's width.
    this.#dialog.style.setProperty('--acs-sheet-cards', String(Math.max(1, shown.length)));
    this.#updatePaging();
    if (!this.#dialog.open) this.#dialog.showModal();

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
    this.#onLoaded(this.#clusterId);
  }

  /**
   * Re-renders one card from fresh label JSON, after a vote cast in the full label card.
   * @param {Record<string, any>} label - A `/label/id/:id` JSON.
   */
  refreshLabel(label) {
    this.#cards.get(label.label_id)?.update(label);
  }

  /** Closes the sheet, if open. */
  close() {
    if (this.#dialog.open) this.#dialog.close();
  }
}

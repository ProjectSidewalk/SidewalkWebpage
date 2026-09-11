/**
 * The photo strip in the AccessScore insights dock (#5217): a scrollable ribbon of label crops from the scope in
 * view, so the imagery behind a score is one glance away rather than a click into a cluster. A thumbnail opens the
 * full label card, whose arrows page through the strip.
 *
 * Source is the cluster feed for one neighborhood (`/v3/api/labelClusters?regionId=…`), cached for the page's life,
 * because a street is a filter over its neighborhood's clusters and a city has too many clusters to fetch for a
 * dozen pictures. The brush never narrows the strip: a brush is a set of street ids across the city and the strip
 * draws from one neighborhood's feed. One label per cluster, worst-rated and largest clusters first, capped at
 * `MAX_PHOTOS`; a label with neither a crop nor a backup image shows its type icon in its place.
 */
class AccessScorePhotoStrip {
  /** Enough to fill the ribbon with a scroll's worth; more is a wall of fetches for pictures nobody reaches. */
  static MAX_PHOTOS = 12;

  #types;
  #onOpenLabel;
  #log;
  #els;
  #clustersByRegion = new Map();
  #labelsById = new Map();
  #ids = [];
  #token = 0;

  /**
   * @param {HTMLElement} container - The element the strip renders into.
   * @param {object} options - Configuration and callbacks.
   * @param {Array<string>} options.types - The scored label types the feed is asked for.
   * @param {function} options.onOpenLabel - Called with `(labelId, stripLabelIds)` when a thumbnail is chosen.
   * @param {function} [options.log] - Called with `(kind, value)` for an interaction worth logging.
   */
  constructor(container, { types, onOpenLabel, log = () => {} }) {
    this.#types = types;
    this.#onOpenLabel = onOpenLabel;
    this.#log = log;
    container.innerHTML = `
      <p class="acs-photos__caption"></p>
      <p class="acs-photos__status" role="status"></p>
      <ul class="acs-photos__ribbon"></ul>`;
    this.#els = {
      caption: container.querySelector('.acs-photos__caption'),
      status: container.querySelector('.acs-photos__status'),
      ribbon: container.querySelector('.acs-photos__ribbon'),
    };
    this.#els.ribbon.addEventListener('click', (e) => {
      const item = e.target.closest('.acs-photos__item');
      if (!item) return;
      const labelId = Number(item.dataset.labelId);
      this.#log('PhotoStrip_labelId', labelId);
      this.#onOpenLabel(labelId, this.#ids);
    });
  }

  /**
   * Shows the photos of a scope, replacing whatever was there. A scope that resolves to no neighborhood (a city
   * with nothing scored yet) shows the empty state.
   *
   * @param {object} scope - Where the photos come from.
   * @param {string} scope.caption - The strip's caption, already worded.
   * @param {?number} scope.regionId - The neighborhood whose cluster feed is read; null for none.
   * @param {?number} [scope.streetId] - Keep only the clusters on this street…
   * @param {Set<number>} [scope.intersectionIds] - …or at these intersections (its ends).
   * @returns {Promise<void>} Resolves once the strip is drawn (or superseded by a later call).
   */
  async show({ caption, regionId, streetId = null, intersectionIds = null }) {
    const token = ++this.#token;
    this.#els.caption.textContent = caption;
    this.#els.ribbon.innerHTML = '';
    this.#ids = [];
    if (regionId === null || regionId === undefined) {
      this.#els.status.textContent = i18next.t('accessscore:photos-empty');
      return;
    }
    this.#els.status.textContent = i18next.t('accessscore:photos-loading');
    let clusters;
    try {
      clusters = await this.#clusters(regionId);
    } catch (e) {
      console.warn('AccessScore photo strip: cluster feed failed', e);
      clusters = [];
    }
    if (token !== this.#token) return; // The scope moved on while the feed loaded.
    if (streetId !== null) {
      clusters = clusters.filter((p) => p.street_edge_id === streetId
        || (intersectionIds && intersectionIds.has(p.intersection_id)));
    }
    // Worst first: 3 is the bad end of both rating scales; unrated clusters trail, larger ones ahead of smaller.
    const picked = clusters
      .filter((p) => Array.isArray(p.label_ids) && p.label_ids.length > 0)
      .sort((a, b) => (b.median_severity ?? 0) - (a.median_severity ?? 0) || (b.cluster_size - a.cluster_size))
      .slice(0, AccessScorePhotoStrip.MAX_PHOTOS);
    if (picked.length === 0) {
      this.#els.status.textContent = i18next.t('accessscore:photos-empty');
      return;
    }
    const labels = await Promise.all(picked.map((p) => this.#label(p.label_ids[0]).then(
      (label) => ({ label, cluster: p }),
      () => null,
    )));
    if (token !== this.#token) return;
    const loaded = labels.filter(Boolean);
    this.#ids = loaded.map(({ label }) => label.label_id);
    this.#els.status.textContent = loaded.length === 0 ? i18next.t('accessscore:photos-empty') : '';
    this.#els.ribbon.innerHTML = loaded.map(({ label, cluster }) => this.#itemHtml(label, cluster)).join('');
    // A picture that fails to load falls back to the type icon, like one that never had a picture.
    for (const img of this.#els.ribbon.querySelectorAll('.acs-photos__image')) {
      img.addEventListener('error', () => {
        img.replaceWith(AccessScoreClusterSheet.placeholder(img.dataset.type));
      }, { once: true });
    }
  }

  /** One neighborhood's scored clusters, fetched once. */
  #clusters(regionId) {
    if (!this.#clustersByRegion.has(regionId)) {
      const url = new URL('/v3/api/labelClusters', window.location.origin);
      url.searchParams.set('labelType', this.#types.join(','));
      url.searchParams.set('regionId', String(regionId));
      const request = fetch(url).then((r) => {
        if (!r.ok) throw new Error(`labelClusters regionId=${regionId}: HTTP ${r.status}`);
        return r.json();
      }).then((fc) => (fc.features || []).map((f) => f.properties));
      // A failed fetch is not cached: the next scope change retries it.
      request.catch(() => this.#clustersByRegion.delete(regionId));
      this.#clustersByRegion.set(regionId, request);
    }
    return this.#clustersByRegion.get(regionId);
  }

  /** One label's card data, fetched once. */
  #label(id) {
    if (!this.#labelsById.has(id)) {
      const request = fetch(`/label/id/${id}`).then((r) => {
        if (!r.ok) throw new Error(`label ${id}: HTTP ${r.status}`);
        return r.json();
      });
      request.catch(() => this.#labelsById.delete(id));
      this.#labelsById.set(id, request);
    }
    return this.#labelsById.get(id);
  }

  /** One thumbnail: the crop (or the placeholder), its type badge, and a name for the tooltip and screen readers. */
  #itemHtml(label, cluster) {
    const type = label.label_type;
    const src = label.crop_url || label.backup_image_url;
    const typeName = AccessScoreChart.typeName(type);
    const rating = util.misc.labelTypeHasSeverity(type) && label.severity
      ? i18next.t(`common:${util.misc.getRatingLevelKeys(type)[label.severity]}`)
      : null;
    const alt = [typeName, rating].filter(Boolean).join(', ');
    const tip = [typeName, rating, cluster.region_name].filter(Boolean).join(' · ');
    const image = src
      ? `<img class="acs-photos__image" src="${AccessScoreChart.esc(src)}" alt="" loading="lazy"
             data-type="${AccessScoreChart.esc(type)}">`
      : AccessScoreClusterSheet.placeholder(type).outerHTML;
    return `
      <li>
        <button type="button" class="acs-photos__item" data-label-id="${label.label_id}"
                aria-label="${AccessScoreChart.esc(i18next.t('accessscore:photos-open', { label: alt }))}"
                data-ps-tooltip="${AccessScoreChart.esc(tip)}">
          <span class="acs-photos__figure">${image}</span>
          <img class="acs-photos__badge" src="${util.misc.getIconImagePaths(type).iconImagePath}" alt="">
        </button>
      </li>`;
  }
}

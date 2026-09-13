/**
 * The photo strip in the AccessScore insights dock (#5217): a scrollable ribbon of label crops from the scope in
 * view, so the imagery behind a score is one glance away rather than a click into a cluster. A thumbnail opens the
 * full label card, whose arrows page through the strip.
 *
 * Source is the cluster feed for one neighborhood (`/v3/api/labelClusters?regionId=…`), cached for the page's life,
 * because a street is a filter over its neighborhood's clusters and a city has too many clusters to fetch for a
 * dozen pictures; the area in view pools the few nearest neighborhoods' feeds and keeps the clusters inside the
 * map's bounds. The brush never narrows the strip: a brush is a set of street ids across the city and the strip
 * draws from neighborhood feeds. One label per cluster, worst-rated and largest clusters first, capped at
 * `MAX_PHOTOS`; each is a `LabelMiniCard`, so a picture can be agreed or disagreed with where it is seen.
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
  /** The cards on show, by label id, so a vote cast in the full label card can be reflected here. */
  #cards = new Map();
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
  }

  /**
   * Shows the photos of a scope. No neighborhood (a city with nothing scored yet) shows the empty state. A viewport
   * scope keeps the current pictures up while its feeds load and skips the redraw when it picks the same clusters:
   * a pan arrives as a run of such calls, and a ribbon that blinks on each one is unreadable.
   *
   * @param {object} scope - Where the photos come from.
   * @param {string} scope.caption - The strip's caption, already worded.
   * @param {?number} [scope.regionId] - The neighborhood whose cluster feed is read; null for none.
   * @param {?Array<number>} [scope.regionIds] - Several neighborhoods' feeds, pooled (the area in view).
   * @param {?Array<number>} [scope.bounds] - `[west, south, east, north]`; keep only the clusters inside.
   * @param {?number} [scope.streetId] - Keep only the clusters on this street…
   * @param {Set<number>} [scope.intersectionIds] - …or at these intersections (its ends).
   * @returns {Promise<void>} Resolves once the strip is drawn (or superseded by a later call).
   */
  async show({ caption, regionId = null, regionIds = null, bounds = null, streetId = null, intersectionIds = null }) {
    const token = ++this.#token;
    this.#els.caption.textContent = caption;
    const ids = regionIds ?? (regionId === null || regionId === undefined ? [] : [regionId]);
    const keepWhileLoading = bounds !== null;
    if (!keepWhileLoading) {
      this.#els.ribbon.innerHTML = '';
      this.#ids = [];
    }
    if (ids.length === 0) {
      this.#els.ribbon.innerHTML = '';
      this.#ids = [];
      this.#els.status.textContent = i18next.t('accessscore:photos-empty');
      return;
    }
    if (!keepWhileLoading) this.#els.status.textContent = i18next.t('accessscore:photos-loading');
    // A neighborhood whose feed fails contributes nothing rather than sinking the others.
    const perRegion = await Promise.all(ids.map((id) => this.#clusters(id).catch((e) => {
      console.warn('AccessScore photo strip: cluster feed failed', e);
      return [];
    })));
    if (token !== this.#token) return; // The scope moved on while the feed loaded.
    let clusters = perRegion.flat();
    if (streetId !== null) {
      clusters = clusters.filter((p) => p.street_edge_id === streetId
        || (intersectionIds && intersectionIds.has(p.intersection_id)));
    }
    if (bounds !== null) {
      const [west, south, east, north] = bounds;
      clusters = clusters.filter((p) => Array.isArray(p.coordinates)
        && p.coordinates[0] >= west && p.coordinates[0] <= east
        && p.coordinates[1] >= south && p.coordinates[1] <= north);
    }
    // Worst first: 3 is the bad end of both rating scales; unrated clusters trail, larger ones ahead of smaller.
    const picked = clusters
      .filter((p) => Array.isArray(p.label_ids) && p.label_ids.length > 0)
      .sort((a, b) => (b.median_severity ?? 0) - (a.median_severity ?? 0) || (b.cluster_size - a.cluster_size))
      .slice(0, AccessScorePhotoStrip.MAX_PHOTOS);
    if (picked.length === 0) {
      this.#els.ribbon.innerHTML = '';
      this.#ids = [];
      this.#els.status.textContent = i18next.t('accessscore:photos-empty');
      return;
    }
    const wanted = picked.map((p) => p.label_ids[0]);
    if (keepWhileLoading && wanted.length === this.#ids.length && wanted.every((id, k) => id === this.#ids[k])) {
      this.#els.status.textContent = '';
      return;
    }
    if (keepWhileLoading) this.#els.status.textContent = i18next.t('accessscore:photos-loading');
    const labels = await Promise.all(picked.map((p) => this.#label(p.label_ids[0]).then(
      (label) => ({ label, cluster: p }),
      () => null,
    )));
    if (token !== this.#token) return;
    const loaded = labels.filter(Boolean);
    this.#ids = loaded.map(({ label }) => label.label_id);
    this.#els.status.textContent = loaded.length === 0 ? i18next.t('accessscore:photos-empty') : '';
    this.#els.ribbon.innerHTML = '';
    this.#cards.clear();
    for (const { label } of loaded) {
      const card = new LabelMiniCard(label, {
        size: 'strip',
        className: 'acs-photos__item',
        source: 'AccessScoreStrip',
        log: this.#log,
        onOpen: (labelId) => {
          this.#log('PhotoStrip_labelId', labelId);
          this.#onOpenLabel(labelId, this.#ids);
        },
      });
      this.#cards.set(label.label_id, card);
      this.#els.ribbon.appendChild(card.element);
    }
  }

  /**
   * Re-renders one thumbnail after a vote cast in the full label card, keeping the fresh JSON for the next redraw.
   * @param {object} label - A `/label/id/:id` JSON.
   */
  refreshLabel(label) {
    this.#labelsById.set(label.label_id, Promise.resolve(label));
    this.#cards.get(label.label_id)?.update(label);
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
      }).then((fc) => (fc.features || []).map((f) => ({
        ...f.properties,
        // The point is what a viewport filter tests; it lives on the geometry, which the properties don't carry.
        coordinates: f.geometry?.coordinates ?? f.properties.coordinates ?? null,
      })));
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
}

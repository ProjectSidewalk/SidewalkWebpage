/**
 * The AccessScore insights dock (#5217): the collapsible panel over the bottom of the map that holds the KPI
 * strip and three linked views — the score histogram, the clusters behind the scores, and the ranked
 * neighborhoods — and coordinates them with the map.
 *
 * Three composition rules keep the views agreeing with each other:
 *
 * 1. **Scope defines the population.** City, the map view, or the selected street's neighborhood; every view and
 *    every KPI computes over the scope set and never over the brush (a histogram of the brush would collapse to the
 *    bins just brushed).
 * 2. **A brush emphasizes in the overview views and filters the detail view.** The histogram marks brushed bins
 *    and mutes the rest, the rank list mutes non-matching rows, and the cluster view is computed over
 *    scope ∩ brush. On the map, everything outside the brush dims.
 * 3. **A selection marks; it does not filter.** Selecting a neighborhood leaves the histogram city-wide and drops a
 *    caret at that neighborhood's score — the point of the view is to place it among the others. The Selected
 *    scope is the one exception, and it exists only in the streets unit, where it means that street's neighborhood.
 *
 * The map's highlight follows one precedence: a transient hover set (a histogram bin, a rank row) if any, else the
 * brush; a hover never drops the brush. Every change is batched into one animation frame, like the map view's
 * score writes. Mid-drag on a weight slider (`{kind: 'Weight', final: false}`) the views redraw but the scope is
 * not recomputed and the map's dim state is not rewritten — the brush's membership shifts as scores move, and
 * writing tens of thousands of feature-states per slider tick is the one cost this page can't afford; the dim
 * catches up on release.
 */
class AccessScoreDock {
  /** The scope modes, in the order the control shows them. */
  static SCOPES = ['city', 'viewport', 'selection'];
  /** Quiet time after a map move before a Viewport scope recomputes. */
  static MOVEEND_DEBOUNCE_MS = 250;
  /** The dock sits this far above the map's bottom edge, clear of Mapbox's attribution strip. */
  static #BOTTOM_OFFSET_PX = 30;

  #root;
  #model;
  #mapView;
  #map;
  #config;
  #callbacks;
  #els;
  #histogram;
  #clusters;
  #rank;

  #open = true;
  #scope = 'city';
  /** `{from, to}` in histogram bin indices, `to` exclusive; null with none. */
  #brush = null;
  #selection = null;
  #scopeIds = { streetIds: null, regionIds: null, name: null };
  /** Ids of the active unit hovered in a view, or null; with the score a rank hover puts under the caret. */
  #hover = null;
  #mapHover = null;
  #hiddenTypes = new Set();
  #problemTypes;

  #frame = null;
  #needScope = true;
  #needDim = true;
  /** Whether the next flush should read the brush out to the live region. */
  #announce = false;
  #moveTimer = null;
  #paddingBottom = 0;

  /**
   * @param {HTMLElement} root - The `#acs-dock` element, carrying the shell markup from the Twirl view.
   * @param {object} options - Collaborators and callbacks.
   * @param {AccessScoreModel} options.model - The scoring model.
   * @param {AccessScoreMapView} options.mapView - The map view, for the brush dim and the viewport queries.
   * @param {mapboxgl.Map} options.map - The map, for `moveend` and the bottom padding.
   * @param {object} options.config - The `/v3/api/accessScoreConfig` response.
   * @param {function} options.onRankSelect - Called with a region id when a rank row is clicked.
   * @param {function} options.onToggleType - Called with `(type, shown)` when a cluster type is toggled.
   * @param {function} options.onStateChange - Called after any change the URL should carry.
   * @param {function} [options.log] - Called with `(kind, value)` for an interaction worth logging.
   */
  constructor(root, { model, mapView, map, config, onRankSelect, onToggleType, onStateChange, log = () => {} }) {
    this.#root = root;
    this.#model = model;
    this.#mapView = mapView;
    this.#map = map;
    this.#config = config;
    this.#callbacks = { onRankSelect, onToggleType, onStateChange, log };
    this.#problemTypes = new Set(config.scored_types.filter((t) => config.type_weights[t].base_weight < 0));
    this.#els = {
      toggle: root.querySelector('#acs-dock-toggle'),
      body: root.querySelector('#acs-dock-body'),
      scopeInputs: Array.from(root.querySelectorAll('input[name="acs-scope"]')),
      selectionOption: root.querySelector('#acs-scope-selection-option'),
      caption: root.querySelector('#acs-dock-scope-caption'),
      kpis: root.querySelector('#acs-dock-kpis'),
      brush: root.querySelector('#acs-dock-brush'),
      brushText: root.querySelector('#acs-dock-brush-text'),
      brushClear: root.querySelector('#acs-dock-brush-clear'),
      status: root.querySelector('#acs-dock-status'),
    };
    this.#histogram = new AccessScoreHistogram(root.querySelector('#acs-histogram'), {
      onBrush: (range) => this.setBrush(range, { final: range === null || range.final, log: true }),
      onHover: (bin) => this.#hoverBin(bin),
      onHoverEnd: () => this.#hoverEnd(),
    });
    this.#clusters = new AccessScoreClusterBars(root.querySelector('#acs-cluster-bars'), {
      onToggleType: (type, shown) => this.#toggleType(type, shown),
    });
    this.#rank = new AccessScoreRankBars(root.querySelector('#acs-rank-bars'), {
      onSelect: (regionId) => {
        this.#callbacks.log('RankSelect_regionId', regionId);
        this.#callbacks.onRankSelect(regionId);
      },
      onHover: (regionId) => this.#hoverRegion(regionId),
      onHoverEnd: () => this.#hoverEnd(),
    });
    this.#bind();
    this.#observeHeight();
    this.#schedule({ scope: true, dim: false });
  }

  /** The dock's own state, for the URL: `{open, scope, brush}`. */
  get state() {
    return { open: this.#open, scope: this.#scope, brush: this.#brush ? { ...this.#brush } : null };
  }

  /**
   * Applies the state a URL carried. A Selected scope only holds once a selection exists, so the page applies
   * this after restoring the URL's selection.
   * @param {object} state - Any of `open` (boolean), `scope`, and `brush` (`{from, to}` in bin indices).
   */
  applyUrlState({ open, scope, brush } = {}) {
    if (open === false) this.setOpen(false, { log: false });
    if (brush) this.setBrush(brush, { final: true, log: false, announce: false });
    if (scope && scope !== 'city') this.setScope(scope, { log: false });
  }

  /**
   * Redraws for a model change, as reported by the sidebar.
   * @param {{kind: string, final: boolean}} meta - The change; a weight mid-drag skips the expensive halves.
   */
  applyChange(meta) {
    const midDrag = meta.kind === 'Weight' && !meta.final;
    if (meta.kind === 'Unit' && this.#scope === 'selection') this.#scope = 'city';
    this.#schedule({ scope: !midDrag, dim: !midDrag });
  }

  /**
   * Follows the map's selection: the histogram and the rank list mark it, and a Selected scope tracks it.
   * @param {?{unit: string, id: number}} selection - The selection, or null.
   */
  setSelection(selection) {
    this.#selection = selection ? { unit: selection.unit, id: selection.id } : null;
    if (this.#scope === 'selection' && !this.#selectionRegionId()) this.#scope = 'city';
    this.#schedule({ scope: true, dim: false });
  }

  /**
   * Follows the map's hover: the histogram caret and the rank list mark the feature under the pointer.
   * @param {?{unit: string, id: number, score: ?number}} hover - The hovered feature, or null on leave.
   */
  markHover(hover) {
    this.#mapHover = hover;
    this.#histogram.markHover(hover?.score ?? null);
    const regionId = hover ? this.#regionOf(hover) : null;
    if (regionId !== null) this.#rank.highlight([regionId]);
    else this.#rank.clearHighlight();
  }

  /**
   * Opens or collapses the dock. Collapsed, only the bar with the KPIs stays.
   * @param {boolean} open - The state.
   * @param {object} [options] - `log` false for a programmatic change.
   */
  setOpen(open, { log = true } = {}) {
    this.#open = open;
    this.#root.classList.toggle('acs-dock--collapsed', !open);
    this.#els.toggle.setAttribute('aria-expanded', String(open));
    this.#els.body.hidden = !open;
    if (log) this.#callbacks.log('Dock', open ? 'open' : 'closed');
    this.#callbacks.onStateChange();
  }

  /**
   * Changes the scope. `selection` falls back to `city` when nothing is selected.
   * @param {string} scope - One of `SCOPES`.
   * @param {object} [options] - `log` false for a programmatic change.
   */
  setScope(scope, { log = true } = {}) {
    if (!AccessScoreDock.SCOPES.includes(scope)) return;
    if (scope === 'selection' && !this.#selectionRegionId()) scope = 'city';
    this.#scope = scope;
    if (log) this.#callbacks.log('Scope', scope);
    this.#schedule({ scope: true, dim: true });
    this.#callbacks.onStateChange();
  }

  /**
   * Sets or clears the brush.
   * @param {?{from: number, to: number}} range - Bin indices, `to` exclusive, or null to clear.
   * @param {object} [options] - `final` false mid-sweep (nothing is logged or announced until release);
   *                             `announce` false to skip the live region.
   */
  setBrush(range, { final = true, log = true, announce = true } = {}) {
    this.#brush = range ? { from: range.from, to: range.to } : null;
    this.#schedule({ scope: false, dim: true });
    if (!final) return;
    if (log) this.#callbacks.log('Brush', range ? `${range.from * 5}-${range.to * 5}` : 'clear');
    if (announce) this.#announce = true;
    this.#callbacks.onStateChange();
  }

  /** Coalesces every change into one animation frame; the flags accumulate until it runs. */
  #schedule({ scope, dim }) {
    this.#needScope ||= scope;
    this.#needDim ||= dim;
    if (this.#frame !== null) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      this.#flush();
    });
  }

  /** The flush: scope, then the datasets, then the views, the map's dim state, and the captions. */
  #flush() {
    const unit = this.#model.state.unit;
    if (this.#needScope) this.#recomputeScope();
    const needDim = this.#needDim;
    this.#needScope = false;
    this.#needDim = false;

    const { streetIds, regionIds } = this.#scopeIds;
    const brushStreets = this.#brushStreetIds();
    // The needle is always the whole city's score, so a scoped histogram still says where the city sits.
    const cityScore = this.#model.kpis().cityScore;
    const histogram = this.#model.histogram({ streetIds, regionIds });

    this.#histogram.draw({
      shapeKey: unit,
      unit,
      bins: histogram.bins,
      total: histogram.total,
      needle: cityScore === null
        ? null
        : {
            score: cityScore,
            label: i18next.t('accessscore:histogram-city', { score: AccessScoreChart.score(cityScore) }),
          },
      brush: this.#brush,
      selection: this.#selectionScore(),
      hover: this.#mapHover?.score ?? null,
    });
    const breakdown = this.#model.clusterBreakdown({ streetIds: brushStreets ?? streetIds });
    this.#clusters.draw({
      shapeKey: 'types',
      ...breakdown,
      buckets: this.#config.severity_buckets,
      hidden: this.#hiddenTypes,
      problemTypes: this.#problemTypes,
    });
    const ranked = this.#model.rankedRegions();
    const rows = this.#scope === 'viewport' && regionIds
      ? ranked.filter((r) => regionIds.has(r.regionId))
      : ranked;
    this.#rank.draw({
      shapeKey: rows.map((r) => r.regionId).sort((a, b) => a - b).join(','),
      rows,
      brush: this.#brush,
      selectedId: this.#selection ? this.#regionOf(this.#selection) : null,
      floored: this.#model.regionStats.length - ranked.length,
    });

    this.#renderKpis(this.#model.kpis({ streetIds, regionIds }));
    this.#renderScopeControl();
    this.#renderBrushBar(brushStreets);
    if (needDim) this.#applyMapBrush();
    if (this.#announce) {
      this.#announce = false;
      this.#els.status.textContent = this.#brush
        ? this.#els.brushText.textContent
        : i18next.t('accessscore:brush-cleared');
    }
  }

  /** Recomputes the population for the current scope, unit, and selection. */
  #recomputeScope() {
    if (this.#scope === 'viewport') {
      this.#scopeIds = { streetIds: this.#mapView.visibleStreetIds(), regionIds: this.#mapView.visibleRegionIds(),
        name: null };
    } else if (this.#scope === 'selection') {
      const regionId = this.#selectionRegionId();
      this.#scopeIds = { streetIds: this.#model.regionStreetIds(regionId), regionIds: new Set([regionId]),
        name: this.#model.explainRegion(regionId)?.name ?? null };
    } else {
      this.#scopeIds = { streetIds: null, regionIds: null, name: null };
    }
  }

  /**
   * The streets the brush keeps, within the scope: in the regions unit, the streets of the brushed regions.
   * @returns {?Set<number>} Street ids, or null with no brush.
   */
  #brushStreetIds() {
    if (!this.#brush) return null;
    const { from, to } = this.#brush;
    const { streetIds, regionIds } = this.#scopeIds;
    if (this.#model.state.unit === 'streets') return this.#model.streetIdsInBins(from, to, { streetIds });
    const out = new Set();
    for (const regionId of this.#model.regionIdsInBins(from, to, { regionIds })) {
      for (const id of this.#model.regionStreetIds(regionId)) if (!streetIds || streetIds.has(id)) out.add(id);
    }
    return out;
  }

  /** The ids of the active unit the brush keeps, for the map. */
  #brushUnitIds() {
    if (!this.#brush) return null;
    const { from, to } = this.#brush;
    if (this.#model.state.unit === 'streets') {
      return this.#model.streetIdsInBins(from, to, { streetIds: this.#scopeIds.streetIds });
    }
    return this.#model.regionIdsInBins(from, to, { regionIds: this.#scopeIds.regionIds });
  }

  /** Hover beats brush; neither leaves the map undimmed. */
  #applyMapBrush() {
    this.#mapView.setBrush(this.#hover ? this.#hover.ids : this.#brushUnitIds());
  }

  #hoverBin(bin) {
    const { streetIds, regionIds } = this.#scopeIds;
    const streets = this.#model.state.unit === 'streets';
    const ids = streets
      ? this.#model.streetIdsInBins(bin, bin + 1, { streetIds })
      : this.#model.regionIdsInBins(bin, bin + 1, { regionIds });
    this.#hover = { ids };
    this.#rank.highlight(this.#model.regionIdsInBins(bin, bin + 1, { regionIds }));
    this.#applyMapBrush();
  }

  #hoverRegion(regionId) {
    const r = this.#model.explainRegion(regionId);
    const ids = this.#model.state.unit === 'streets' ? this.#model.regionStreetIds(regionId) : [regionId];
    this.#hover = { ids };
    this.#histogram.markHover(r && !r.belowFloor ? r.score : null);
    this.#applyMapBrush();
  }

  #hoverEnd() {
    if (!this.#hover) return;
    this.#hover = null;
    this.#rank.clearHighlight();
    this.#histogram.markHover(this.#mapHover?.score ?? null);
    this.#applyMapBrush();
  }

  #toggleType(type, shown) {
    if (shown) this.#hiddenTypes.delete(type);
    else this.#hiddenTypes.add(type);
    this.#callbacks.log('ClusterType', `${type}_shown=${shown}`);
    this.#callbacks.onToggleType(type, shown);
    this.#schedule({ scope: false, dim: false });
  }

  /** The neighborhood a selection or hover belongs to: the region itself, or the street's region. */
  #regionOf({ unit, id }) {
    if (unit === 'regions') return id;
    return this.#model.explainStreet(id)?.regionId ?? null;
  }

  /** The region a Selected scope would mean, or null when the scope has nothing to stand on. */
  #selectionRegionId() {
    if (!this.#selection || this.#model.state.unit !== 'streets') return null;
    return this.#regionOf(this.#selection);
  }

  /** The selected feature's score in the active unit, for the histogram's caret. */
  #selectionScore() {
    if (!this.#selection) return null;
    const unit = this.#model.state.unit;
    if (this.#selection.unit !== unit) return null;
    if (unit === 'streets') return this.#model.explainStreet(this.#selection.id)?.score ?? null;
    const r = this.#model.explainRegion(this.#selection.id);
    return r && !r.belowFloor ? r.score : null;
  }

  #renderKpis(k) {
    const unit = this.#model.state.unit;
    const of = (scored, total) => i18next.t('accessscore:kpi-of', {
      scored: AccessScoreChart.number(scored), total: AccessScoreChart.number(total),
    });
    const score = k.cityScore === null
      ? '—'
      : AccessScoreChart.number(k.cityScore * 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const tiles = [
      ['kpi-score', score],
      unit === 'regions'
        ? ['kpi-regions', of(k.regionsScored, k.regions)]
        : ['kpi-streets', of(k.auditedStreets, k.streets)],
      ['kpi-length', i18next.t('accessscore:length-large', { km: k.auditedKm })],
      ['kpi-problems', AccessScoreChart.number(k.problemClusters)],
    ];
    const key = tiles.map(([id]) => id).join();
    if (this.#els.kpis.dataset.tiles !== key) {
      this.#els.kpis.dataset.tiles = key;
      this.#els.kpis.innerHTML = tiles.map(([id]) => `
        <div class="acs-kpi" data-kpi="${id}">
          <span class="acs-kpi__value"></span>
          <span class="acs-kpi__label">${i18next.t(`accessscore:${id}`)}</span>
        </div>`).join('');
    }
    for (const [id, value] of tiles) {
      this.#els.kpis.querySelector(`[data-kpi="${id}"] .acs-kpi__value`).textContent = value;
    }
  }

  #renderScopeControl() {
    const unit = this.#model.state.unit;
    const { streetIds, regionIds, name } = this.#scopeIds;
    this.#els.scopeInputs.forEach((input) => {
      input.checked = input.value === this.#scope;
    });
    const selectable = unit === 'streets';
    this.#els.selectionOption.hidden = !selectable;
    const selectionInput = this.#els.scopeInputs.find((i) => i.value === 'selection');
    if (selectionInput) selectionInput.disabled = !selectable || !this.#selectionRegionId();
    const regionCount = regionIds ? regionIds.size : this.#model.regionStats.length;
    const streetCount = streetIds ? streetIds.size : this.#model.streetCount;
    const count = unit === 'regions'
      ? i18next.t('accessscore:scope-regions', { count: regionCount })
      : i18next.t('accessscore:scope-streets', { count: streetCount });
    const what = this.#scope === 'selection' ? name : i18next.t(`accessscore:scope-caption-${this.#scope}`);
    this.#els.caption.textContent = `${what} · ${count}`;
  }

  #renderBrushBar(brushStreets) {
    const bar = this.#els.brush;
    if (!this.#brush) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const range = { from: this.#brush.from * 5, to: this.#brush.to * 5 };
    let text;
    if (this.#model.state.unit === 'regions') {
      const { from, to } = this.#brush;
      const n = this.#model.regionIdsInBins(from, to, { regionIds: this.#scopeIds.regionIds }).size;
      text = i18next.t('accessscore:brush-regions', { ...range, count: n });
    } else {
      let meters = 0;
      for (const id of brushStreets) meters += this.#model.explainStreet(id)?.lengthM ?? 0;
      text = i18next.t('accessscore:brush-streets', {
        ...range, count: brushStreets.size, length: i18next.t('accessscore:length-large', { km: meters / 1000 }),
      });
    }
    this.#els.brushText.textContent = text;
  }

  #bind() {
    this.#els.toggle.addEventListener('click', () => this.setOpen(!this.#open));
    this.#els.scopeInputs.forEach((input) => input.addEventListener('change', () => {
      if (input.checked) this.setScope(input.value);
    }));
    this.#els.brushClear.addEventListener('click', () => this.setBrush(null));
    // Only a Viewport scope has anything to recompute on a move, and only once the map has settled.
    this.#map.on('moveend', () => {
      if (this.#scope !== 'viewport') return;
      clearTimeout(this.#moveTimer);
      this.#moveTimer = setTimeout(() => this.#schedule({ scope: true, dim: true }),
        AccessScoreDock.MOVEEND_DEBOUNCE_MS);
    });
  }

  /**
   * Publishes the dock's height as `--acs-dock-height` on the map holder, so the legend lifts above it, and as
   * the map's bottom padding, so a fly-to frames its target above the dock rather than behind it.
   */
  #observeHeight() {
    const publish = () => {
      const height = this.#root.offsetHeight;
      this.#root.parentElement?.style.setProperty('--acs-dock-height', `${height}px`);
      // Never more than half the canvas: padding that tall projects the center off the map.
      const canvas = this.#map.getContainer().getBoundingClientRect().height;
      const bottom = Math.min(height + AccessScoreDock.#BOTTOM_OFFSET_PX, Math.floor(canvas / 2));
      if (bottom === this.#paddingBottom) return;
      const first = this.#paddingBottom === 0;
      this.#paddingBottom = bottom;
      const padding = { ...this.#map.getPadding(), bottom };
      // The first publish is page setup and jumps; a collapse or expand eases, like the drawer's.
      if (first) this.#map.setPadding(padding);
      else this.#map.easeTo({ padding, duration: 300 });
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(publish).observe(this.#root);
    publish();
  }
}

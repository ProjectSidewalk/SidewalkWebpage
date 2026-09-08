/**
 * The AccessScore insights dock (#5217): the collapsible band along the bottom of the map that holds the KPI
 * strip and three linked views — the score histogram (which doubles as the score legend), what drives the scores,
 * and the ranked neighborhoods — and coordinates them with the map.
 *
 * Three composition rules keep the views agreeing with each other:
 *
 * 1. **The whole city is the population.** Every view and every KPI computes over the city and never over the
 *    brush (a histogram of the brush would collapse to the bins just brushed).
 * 2. **A brush emphasizes in the overview views and filters the detail view.** The histogram marks brushed bins
 *    and mutes the rest, the rank list mutes non-matching rows, and the drivers view is computed over the brush.
 *    On the map, everything outside the brush dims.
 * 3. **A selection marks; it does not filter.** Selecting a neighborhood leaves the histogram city-wide and drops a
 *    caret at that neighborhood's score — the point of the view is to place it among the others — while the map
 *    fades every other neighborhood (in the streets unit, every street outside the selected street's
 *    neighborhood) so the selection is the one thing in focus.
 *
 * The map's dim follows one precedence: a transient hover set (a histogram bin, a rank row) if any, else the
 * brush, else the selection; a hover never drops the brush. Every change is batched into one animation frame,
 * like the map view's score writes. Mid-drag on a weight slider (`{kind: 'Weight', final: false}`) the views
 * redraw but the map's dim state is not rewritten — the brush's membership shifts as scores move, and writing
 * tens of thousands of feature-states per slider tick is the one cost this page can't afford; the dim catches up
 * on release.
 */
class AccessScoreDock {
  #root;
  #model;
  #mapView;
  #map;
  #callbacks;
  #els;
  #histogram;
  #drivers;
  #rank;

  #open = true;
  /** `{from, to}` in histogram bin indices, `to` exclusive; null with none. */
  #brush = null;
  #selection = null;
  /** Ids of the active unit hovered in a view, or null. */
  #hover = null;
  #mapHover = null;
  #hiddenTypes = new Set();

  #frame = null;
  #needDim = true;
  /** Whether the next flush should read the brush out to the live region. */
  #announce = false;
  #paddingBottom = 0;

  /**
   * @param {HTMLElement} root - The `#acs-dock` element, carrying the shell markup from the Twirl view.
   * @param {object} options - Collaborators and callbacks.
   * @param {AccessScoreModel} options.model - The scoring model.
   * @param {AccessScoreMapView} options.mapView - The map view, for the dim.
   * @param {mapboxgl.Map} options.map - The map, for the bottom padding.
   * @param {function} options.onRankSelect - Called with a region id when a rank row is clicked.
   * @param {function} options.onToggleType - Called with `(type, shown)` when a type is toggled in the drivers view.
   * @param {function} options.onStateChange - Called after any change the URL should carry.
   * @param {function} [options.log] - Called with `(kind, value)` for an interaction worth logging.
   */
  constructor(root, { model, mapView, map, onRankSelect, onToggleType, onStateChange, log = () => {} }) {
    this.#root = root;
    this.#model = model;
    this.#mapView = mapView;
    this.#map = map;
    this.#callbacks = { onRankSelect, onToggleType, onStateChange, log };
    this.#els = {
      toggle: root.querySelector('#acs-dock-toggle'),
      body: root.querySelector('#acs-dock-body'),
      caption: root.querySelector('#acs-dock-caption'),
      stripBar: root.querySelector('.acs-dock__strip-bar'),
      stripCaret: root.querySelector('.acs-dock__strip-caret'),
      kpis: root.querySelector('#acs-dock-kpis'),
      brush: root.querySelector('#acs-dock-brush'),
      brushText: root.querySelector('#acs-dock-brush-text'),
      brushClear: root.querySelector('#acs-dock-brush-clear'),
      status: root.querySelector('#acs-dock-status'),
    };
    // The collapsed band keeps a slim ramp, so the legend is never off screen. The ramp is data, not styling.
    if (this.#els.stripBar) this.#els.stripBar.style.background = ScoreRamp.cssGradient();
    this.#histogram = new AccessScoreHistogram(root.querySelector('#acs-histogram'), {
      onBrush: (range) => this.setBrush(range, { final: range === null || range.final, log: true }),
      onHover: (bin) => this.#hoverBin(bin),
      onHoverEnd: () => this.#hoverEnd(),
    });
    this.#drivers = new AccessScoreDriversBars(root.querySelector('#acs-drivers'), {
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
    this.#schedule({ dim: false });
  }

  /** The dock's own state, for the URL: `{open, brush}`. */
  get state() {
    return { open: this.#open, brush: this.#brush ? { ...this.#brush } : null };
  }

  /**
   * Applies the state a URL carried.
   * @param {object} state - Any of `open` (boolean) and `brush` (`{from, to}` in bin indices).
   */
  applyUrlState({ open, brush } = {}) {
    if (open === false) this.setOpen(false, { log: false });
    if (brush) this.setBrush(brush, { final: true, log: false, announce: false });
  }

  /**
   * Redraws for a model change, as reported by the sidebar.
   * @param {{kind: string, final: boolean}} meta - The change; a weight mid-drag skips the map's dim rewrite.
   */
  applyChange(meta) {
    this.#schedule({ dim: !(meta.kind === 'Weight' && !meta.final) });
  }

  /**
   * Follows the map's selection: the histogram and the rank list mark it, and the map fades everything else.
   * @param {?{unit: string, id: number}} selection - The selection, or null.
   */
  setSelection(selection) {
    this.#selection = selection ? { unit: selection.unit, id: selection.id } : null;
    this.#schedule({ dim: true });
  }

  /**
   * Follows the map's hover: the histogram caret, the collapsed strip's caret, and the rank list mark the feature
   * under the pointer.
   * @param {?{unit: string, id: number, score: ?number}} hover - The hovered feature, or null on leave.
   */
  markHover(hover) {
    this.#mapHover = hover;
    this.#markCaret(hover?.score ?? this.#selectionScore());
    const regionId = hover ? this.#regionOf(hover) : null;
    if (regionId !== null) this.#rank.highlight([regionId]);
    else this.#rank.clearHighlight();
  }

  /**
   * Opens or collapses the dock. Collapsed, only the bar with the ramp strip and the KPIs stays.
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
   * Sets or clears the brush.
   * @param {?{from: number, to: number}} range - Bin indices, `to` exclusive, or null to clear.
   * @param {object} [options] - `final` false mid-sweep (nothing is logged or announced until release);
   *                             `announce` false to skip the live region.
   */
  setBrush(range, { final = true, log = true, announce = true } = {}) {
    this.#brush = range ? { from: range.from, to: range.to } : null;
    this.#schedule({ dim: true });
    if (!final) return;
    if (log) this.#callbacks.log('Brush', range ? `${range.from * 5}-${range.to * 5}` : 'clear');
    if (announce) this.#announce = true;
    this.#callbacks.onStateChange();
  }

  /** Coalesces every change into one animation frame; the flag accumulates until it runs. */
  #schedule({ dim }) {
    this.#needDim ||= dim;
    if (this.#frame !== null) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      this.#flush();
    });
  }

  /** The flush: the datasets, then the views, the map's dim state, and the captions. */
  #flush() {
    const unit = this.#model.state.unit;
    const needDim = this.#needDim;
    this.#needDim = false;

    const brushStreets = this.#brushStreetIds();
    const kpis = this.#model.kpis();
    const cityScore = kpis.cityScore;
    const histogram = this.#model.histogram();

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
    const { means } = this.#model.contributions({ streetIds: brushStreets });
    const breakdown = this.#model.clusterBreakdown({ streetIds: brushStreets });
    this.#drivers.draw({
      shapeKey: 'types',
      rows: breakdown.types.map((t) => ({ type: t.type, mean: means[t.type], count: t.total, buckets: t.buckets })),
      hidden: this.#hiddenTypes,
      streets: breakdown.streets,
    });
    const rows = this.#model.rankedRegions();
    this.#rank.draw({
      shapeKey: rows.map((r) => r.regionId).sort((a, b) => a - b).join(','),
      rows,
      brush: this.#brush,
      selectedId: this.#selection ? this.#regionOf(this.#selection) : null,
      floored: this.#model.regionStats.length - rows.length,
    });

    this.#renderKpis(kpis);
    this.#renderCaption();
    this.#renderBrushBar(brushStreets);
    if (!this.#mapHover) this.#markCaret(this.#selectionScore());
    if (needDim) this.#applyMapDim();
    if (this.#announce) {
      this.#announce = false;
      this.#els.status.textContent = this.#brush
        ? this.#els.brushText.textContent
        : i18next.t('accessscore:brush-cleared');
    }
  }

  /**
   * The streets the brush keeps: in the regions unit, the streets of the brushed regions.
   * @returns {?Set<number>} Street ids, or null with no brush.
   */
  #brushStreetIds() {
    if (!this.#brush) return null;
    const { from, to } = this.#brush;
    if (this.#model.state.unit === 'streets') return this.#model.streetIdsInBins(from, to);
    const out = new Set();
    for (const regionId of this.#model.regionIdsInBins(from, to)) {
      for (const id of this.#model.regionStreetIds(regionId)) out.add(id);
    }
    return out;
  }

  /** The ids of the active unit the brush keeps, for the map. */
  #brushUnitIds() {
    if (!this.#brush) return null;
    const { from, to } = this.#brush;
    if (this.#model.state.unit === 'streets') return this.#model.streetIdsInBins(from, to);
    return this.#model.regionIdsInBins(from, to);
  }

  /** The ids of the active unit a selection keeps bright: its neighborhood, as regions or as streets. */
  #selectionUnitIds() {
    if (!this.#selection) return null;
    const regionId = this.#regionOf(this.#selection);
    if (regionId === null) return null;
    return this.#model.state.unit === 'streets' ? this.#model.regionStreetIds(regionId) : [regionId];
  }

  /** Hover beats brush beats selection; none leaves the map undimmed. */
  #applyMapDim() {
    this.#mapView.setBrush(this.#hover?.ids ?? this.#brushUnitIds() ?? this.#selectionUnitIds());
  }

  #hoverBin(bin) {
    const streets = this.#model.state.unit === 'streets';
    const ids = streets ? this.#model.streetIdsInBins(bin, bin + 1) : this.#model.regionIdsInBins(bin, bin + 1);
    this.#hover = { ids };
    this.#rank.highlight(this.#model.regionIdsInBins(bin, bin + 1));
    this.#applyMapDim();
  }

  #hoverRegion(regionId) {
    const r = this.#model.explainRegion(regionId);
    const ids = this.#model.state.unit === 'streets' ? this.#model.regionStreetIds(regionId) : [regionId];
    this.#hover = { ids };
    this.#markCaret(r && !r.belowFloor ? r.score : null);
    this.#applyMapDim();
  }

  #hoverEnd() {
    if (!this.#hover) return;
    this.#hover = null;
    this.#rank.clearHighlight();
    this.#markCaret(this.#mapHover?.score ?? this.#selectionScore());
    this.#applyMapDim();
  }

  #toggleType(type, shown) {
    if (shown) this.#hiddenTypes.delete(type);
    else this.#hiddenTypes.add(type);
    this.#callbacks.log('ClusterType', `${type}_shown=${shown}`);
    this.#callbacks.onToggleType(type, shown);
    this.#schedule({ dim: false });
  }

  /** Moves the transient caret in the histogram and on the collapsed strip. */
  #markCaret(score) {
    this.#histogram.markHover(score);
    const caret = this.#els.stripCaret;
    if (!caret) return;
    const show = typeof score === 'number' && Number.isFinite(score);
    caret.hidden = !show;
    if (show) caret.style.left = `${Math.min(100, Math.max(0, score * 100))}%`;
  }

  /** The neighborhood a selection or hover belongs to: the region itself, or the street's region. */
  #regionOf({ unit, id }) {
    if (unit === 'regions') return id;
    return this.#model.explainStreet(id)?.regionId ?? null;
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

  /** What the views count: the city's streets, or its neighborhoods. */
  #renderCaption() {
    const unit = this.#model.state.unit;
    this.#els.caption.textContent = unit === 'regions'
      ? i18next.t('accessscore:count-regions', { count: this.#model.regionStats.length })
      : i18next.t('accessscore:count-streets', { count: this.#model.streetCount });
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
      const n = this.#model.regionIdsInBins(this.#brush.from, this.#brush.to).size;
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
    this.#els.brushClear.addEventListener('click', () => this.setBrush(null));
  }

  /**
   * Publishes the dock's height as `--acs-dock-height` on the map holder — Mapbox's attribution and logo lift
   * above the band by it — and as the map's bottom padding, so a fly-to frames its target above the dock rather
   * than behind it.
   */
  #observeHeight() {
    const publish = () => {
      const height = this.#root.offsetHeight;
      this.#root.parentElement?.style.setProperty('--acs-dock-height', `${height}px`);
      // Never more than half the canvas: padding that tall projects the center off the map.
      const canvas = this.#map.getContainer().getBoundingClientRect().height;
      const bottom = Math.min(height, Math.floor(canvas / 2));
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

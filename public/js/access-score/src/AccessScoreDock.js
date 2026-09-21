/**
 * A brush over a score range, in histogram bin indices with `to` exclusive.
 * @typedef {{kind: 'score', from: number, to: number}} AccessScoreScoreBrush
 */

/**
 * A brush over slope classes (#5223), as indices into the map legend's, gentlest first, with
 * `AccessScoreGradeRamp.NO_GRADE` for the streets that have no slope at all.
 * @typedef {{kind: 'grade', classes: number[]}} AccessScoreGradeBrush
 */

/** @typedef {AccessScoreScoreBrush|AccessScoreGradeBrush} AccessScoreBrush */

/**
 * The AccessScore insights dock (#5217): the collapsible band along the bottom of the map that holds the KPI
 * strip and four linked views — the score histogram (which doubles as the score legend), what's here, the ranked
 * regions, and the photo strip — and coordinates them with the map.
 *
 * Three composition rules keep the views agreeing with each other:
 *
 * 1. **The whole city is the population.** Every view and every KPI computes over the city and never over the
 *    brush (a histogram of the brush would collapse to the bins just brushed).
 * 2. **A brush emphasizes in the overview views and filters the detail views.** The histogram marks brushed bins
 *    and mutes the rest, the rank list mutes non-matching rows, and what's here is counted over the brush. On
 *    the map, everything outside the brush dims. There are two kinds — a score range from the histogram and a set of
 *    slope classes from the map's legend (#5223) — and only ever one in force, since two would dim each other's
 *    streets. A slope brush says nothing about score bins, so the histogram marks none while one is in force.
 * 3. **A selection marks the overview views and scopes the detail views.** Selecting a region leaves the
 *    histogram city-wide and drops a caret at that region's score — the point of the view is to place it
 *    among the others — while what's here and the photo strip narrow to it, and the map fades every other
 *    region (in the streets unit, every street outside the selected street's region) so the selection
 *    is the one thing in focus. With nothing selected, the detail views take the city (the photo strip, which
 *    reads one region's feed, takes the lowest-scoring one and says so).
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
  /** @type {AccessScoreModel} */
  #model;
  /** @type {AccessScoreMapView} */
  #mapView;
  /** @type {mapboxgl.Map} */
  #map;
  #callbacks;
  #els;
  /** @type {AccessScoreHistogram} */
  #histogram;
  /** @type {AccessScoreWhatsHere} */
  #whatsHere;
  /** @type {AccessScoreRankBars} */
  #rank;
  /** @type {AccessScorePhotoStrip} */
  #photos;
  /** The scope the photo strip last loaded, so a slider tick never refetches it. */
  #photoScopeKey = null;
  #moveTimer = null;

  /** Below this zoom the viewport spans most of a city, and "the area in view" would say nothing. */
  static PHOTO_VIEWPORT_ZOOM = 13;
  /** At most this many region feeds (the nearest to the center) per viewport, so a pan is a few fetches. */
  static PHOTO_VIEWPORT_REGIONS = 4;
  /** A pan settles in a few moveends; one refetch per settle, not per tick. */
  static PHOTO_MOVE_DEBOUNCE_MS = 500;

  #open = true;
  /** @type {?AccessScoreBrush} The brush in force, of either kind; null with none. */
  #brush = null;
  /** The ascending slope-class breaks, for reading a grade brush back into streets; null in an unsampled city. */
  #gradeBreaks = null;
  #selection = null;
  /** Ids of the active unit hovered in a view, or null. */
  #hover = null;
  #mapHover = null;
  /** The city's short name, for the histogram's needle label. */
  #cityName;
  /** A region chosen from the rank list as the band's scope, when the map has no selection of its own. */
  #focusRegionId = null;
  /** Which end of the street leaderboard the rank list shows (#5223); the neighborhoods list has no ends. */
  #rankWorst = false;

  #frame = null;
  #needDim = true;
  /** Whether the next flush re-aims the photo strip; a slider mid-drag leaves it, so the city's lowest-scoring
   *  region flipping under the drag never refetches a strip nobody is looking at yet. */
  #needPhotos = true;
  /** Whether the next flush should read the brush out to the live region. */
  #announce = false;
  #paddingBottom = 0;

  /**
   * @param {HTMLElement} root - The `#acs-dock` element, carrying the shell markup from the Twirl view.
   * @param {object} options - Collaborators and callbacks.
   * @param {AccessScoreModel} options.model - The scoring model.
   * @param {AccessScoreMapView} options.mapView - The map view, for the dim.
   * @param {mapboxgl.Map} options.map - The map, for the bottom padding.
   * @param {string} [options.cityName] - The city's short name, as the backend states it, for the needle label.
   * @param {(row: {unit: AccessScoreUnit, id: number}) => void} options.onRankSelect - Called when a rank row is
   *   clicked, with the id in the unit the list is ranking.
   * @param {(labelId: number, stripLabelIds: number[]) => void} [options.onOpenLabel] - Called when a photo is
   *   chosen, with the strip's label ids for the card's arrows to page through.
   * @param {() => void} options.onStateChange - Called after any change the URL should carry.
   * @param {(kind: string, value?: string|number) => void} [options.log] - Called for an interaction worth logging.
   * @param {?number[]} [options.gradeBreaks] - The slope-class breaks a grade brush is read against (#5223); null
   *   in a city whose streets have no slope.
   */
  constructor(root, {
    model, mapView, map, cityName = '', onRankSelect, onOpenLabel = () => {}, onStateChange, log = () => {},
    gradeBreaks = null,
  }) {
    this.#gradeBreaks = gradeBreaks;
    this.#root = root;
    this.#model = model;
    this.#mapView = mapView;
    this.#map = map;
    this.#callbacks = { onRankSelect, onOpenLabel, onStateChange, log };
    this.#cityName = cityName;
    // With nothing selected the strip follows the map; only a reader's own move counts, as for the URL, so a fly-to
    // from a rank row or the URL's viewport never fires a fetch of its own.
    this.#map.on('moveend', (event) => {
      if (!event.originalEvent) return;
      clearTimeout(this.#moveTimer);
      this.#moveTimer = setTimeout(() => this.#showPhotos(this.#photoScope()), AccessScoreDock.PHOTO_MOVE_DEBOUNCE_MS);
    });
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
      rankTitle: root.querySelector('#acs-dock-rank-title'),
      rankInfo: root.querySelector('.acs-dock__panel--rank .acs-info'),
      rankOrder: root.querySelector('#acs-rank-order'),
    };
    // The collapsed band keeps a slim ramp, so the legend is never off screen. The ramp is data, not styling.
    if (this.#els.stripBar) this.#els.stripBar.style.background = ScoreRamp.cssGradient();
    this.#histogram = new AccessScoreHistogram(root.querySelector('#acs-histogram'), {
      onBrush: (range) => this.setBrush(range, { final: range === null || range.final, log: true }),
      onHover: (bin) => this.#hoverBin(bin),
      onHoverEnd: () => this.#hoverEnd(),
    });
    this.#whatsHere = new AccessScoreWhatsHere(root.querySelector('#acs-whats-here'));
    this.#photos = new AccessScorePhotoStrip(root.querySelector('#acs-photos'), {
      types: model.config.scored_types,
      onOpenLabel: (labelId, ids) => this.#callbacks.onOpenLabel(labelId, ids),
      log,
    });
    this.#rank = new AccessScoreRankBars(root.querySelector('#acs-rank-bars'), {
      // A street row is a map selection, which arrives back through `setSelection` and scopes the band itself; a
      // region row in the streets unit has no map selection to make, so the dock's own focus is the whole answer.
      onSelect: (id) => {
        const unit = this.#model.state.unit;
        if (unit === 'streets') {
          this.#callbacks.log('RankSelect_streetId', id);
        } else {
          this.#callbacks.log('RankSelect_regionId', id);
          this.setFocusRegion(id);
        }
        this.#callbacks.onRankSelect({ unit, id });
      },
      onHover: (id) => this.#hoverRankRow(id),
      onHoverEnd: () => this.#hoverEnd(),
    });
    this.#bind();
    this.#observeHeight();
    this.#schedule({ dim: false });
  }

  /**
   * The dock's own state, for the URL.
   * @returns {{open: boolean, brush: ?AccessScoreBrush, focus: ?number}}
   */
  get state() {
    const held = this.#brush;
    /** @type {?AccessScoreBrush} */
    let brush = null;
    if (held?.kind === 'grade') brush = { kind: 'grade', classes: [...held.classes] };
    else if (held) brush = { ...held };
    return { open: this.#open, brush, focus: this.#focusRegionId };
  }

  /**
   * Scopes the band to a region without a map selection — what a rank-list click means in the streets unit,
   * where a region can't be selected on the map. Any map selection, a unit switch, or a full reset clears it.
   * @param {?number} regionId - The region, or null to clear.
   */
  setFocusRegion(regionId) {
    const next = regionId === null || regionId === undefined ? null : regionId;
    if (next === this.#focusRegionId) return;
    this.#focusRegionId = next;
    this.#schedule({ dim: false });
    this.#callbacks.onStateChange();
  }

  /**
   * Applies the state a URL carried.
   * @param {{open?: boolean, brush?: ?AccessScoreBrush, focus?: ?number}} [state] - Each left out when the URL
   *   didn't say.
   */
  applyUrlState({ open, brush, focus } = {}) {
    if (open === false) this.setOpen(false, { log: false });
    if (brush) this.setBrush(brush, { final: true, log: false, announce: false });
    if (focus) this.setFocusRegion(focus);
  }

  /**
   * Redraws for a model change, as reported by the sidebar.
   * @param {AccessScoreChangeMeta} meta - The change; a weight mid-drag skips the map's dim rewrite.
   */
  applyChange(meta) {
    // A focused region belongs to the unit it was chosen in; the reset puts the band back to the city.
    if (meta.kind === 'Unit' || meta.kind === 'ResetAll') this.setFocusRegion(null);
    // A slope brush goes wherever its classes stop describing what is on screen — the regions unit has no slope, a
    // statistic change re-classes every street — or it would stand for a different set than the reader picked.
    if (this.#brush?.kind === 'grade' && ['Unit', 'ResetAll', 'SlopeStat', 'SlopeReset'].includes(meta.kind)) {
      this.setBrush(null, { log: false, announce: false });
    }
    const settled = !(meta.kind === 'Weight' && !meta.final);
    this.#schedule({ dim: settled, photos: settled });
  }

  /**
   * Follows the map's selection: the histogram and the rank list mark it, and the map fades everything else.
   * @param {?{unit: AccessScoreUnit, id: number}} selection - The selection, or null.
   */
  setSelection(selection) {
    this.#selection = selection ? { unit: selection.unit, id: selection.id } : null;
    // A map selection is the reader's newer choice of scope.
    if (this.#selection) this.setFocusRegion(null);
    this.#schedule({ dim: true });
  }

  /**
   * Follows the map's hover: the histogram caret, the collapsed strip's caret, and the rank list mark the feature
   * under the pointer.
   * @param {?{unit: AccessScoreUnit, id: number, score: ?number}} hover - The hovered feature, or null on leave.
   */
  markHover(hover) {
    this.#mapHover = hover;
    this.#markCaret(hover?.score ?? this.#selectionScore());
    // The list ranks the unit in force, so a hovered street marks its own row where it has one, and a hovered
    // region marks the region's.
    const rowId = hover ? (hover.unit === 'streets' ? hover.id : this.#regionOf(hover)) : null;
    if (rowId !== null) this.#rank.highlight([rowId]);
    else this.#rank.clearHighlight();
  }

  /**
   * Opens or collapses the dock. Collapsed, only the bar with the ramp strip and the KPIs stays.
   * @param {boolean} open - The state.
   * @param {{log?: boolean}} [options] - `log` false for a programmatic change.
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
   * Sets or clears the brush. The two kinds displace each other, since only one thing is ever emphasized; either
   * way the legend is told, so its pressed classes match what the map is dimming.
   * @param {?(AccessScoreBrush|{from: number, to: number})} range - A brush of either kind, a bare score range as
   *   the histogram reports one, or null to clear.
   * @param {{final?: boolean, log?: boolean, announce?: boolean}} [options] - `final` false mid-sweep, so nothing
   *   is logged or announced until release; `log` false for a programmatic change; `announce` false for a change
   *   the live region should not read out, such as the brush a shared link carried in.
   */
  setBrush(range, { final = true, log = true, announce = true } = {}) {
    const brush = AccessScoreDock.#normalizeBrush(range);
    this.#brush = brush;
    this.#mapView.setGradeSelection(brush?.kind === 'grade' ? brush.classes : []);
    this.#schedule({ dim: true });
    if (!final) return;
    if (log) this.#callbacks.log('Brush', AccessScoreDock.#brushLogValue(brush));
    if (announce) this.#announce = true;
    this.#callbacks.onStateChange();
  }

  /**
   * A brush argument in the one internal shape; a bare `{from, to}` is the score range the histogram reports.
   * @param {?(AccessScoreBrush|{from: number, to: number})} range - What a caller passed.
   * @returns {?AccessScoreBrush} Null where it selects nothing.
   */
  static #normalizeBrush(range) {
    if (!range) return null;
    if ('kind' in range && range.kind === 'grade') {
      const classes = [...new Set(range.classes)].sort((a, b) => a - b);
      return classes.length > 0 ? { kind: 'grade', classes } : null;
    }
    return { kind: 'score', from: range.from, to: range.to };
  }

  /**
   * What a brush change logs: the score range in whole percent, or the slope classes, or a clear.
   * @param {?AccessScoreBrush} brush - The brush now in force.
   * @returns {string}
   */
  static #brushLogValue(brush) {
    if (!brush) return 'clear';
    if (brush.kind === 'grade') return `grade=${brush.classes.join(',')}`;
    const step = 100 / AccessScoreModel.HISTOGRAM_BINS;
    return `${brush.from * step}-${brush.to * step}`;
  }

  /** Coalesces every change into one animation frame; the flags accumulate until it runs. */
  #schedule({ dim, photos = true }) {
    this.#needDim ||= dim;
    this.#needPhotos ||= photos;
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
    const needPhotos = this.#needPhotos;
    this.#needDim = false;
    this.#needPhotos = false;

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
            label: i18next.t('accessscore:histogram-city',
              { city: this.#cityName, score: AccessScoreChart.score(cityScore) }),
          },
      // Only a score brush marks bins; a slope brush is not a range over this axis and marking nothing is honest.
      brush: this.#brush?.kind === 'score' ? this.#brush : null,
      selection: this.#selectionScore(),
      hover: this.#mapHover?.score ?? null,
    });
    const scope = this.#scope();
    const breakdown = this.#model.clusterBreakdown(this.#breakdownScope(scope, brushStreets));
    const scoring = this.#model.config.type_weights;
    this.#whatsHere.draw({
      shapeKey: 'types',
      rows: breakdown.types.map((t) => ({
        type: t.type,
        count: t.total,
        buckets: t.buckets,
        rated: ['positive_quality', 'negative_severity'].includes(scoring[t.type]?.scoring),
      })),
      caption: this.#scopeCaption(scope, brushStreets),
      empty: breakdown.streets === 0 && breakdown.intersections === 0,
    });
    if (needPhotos) this.#showPhotos(this.#photoScope());
    this.#drawRank(brushStreets, kpis.auditedStreets);

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
   * Draws the rank list for whichever unit is in force, and the panel's title and order toggle with it.
   *
   * The neighborhoods list is the whole city, best first, since a city has tens of them. Streets run to
   * thousands, so that list is a leaderboard: one end of it at a time, with the toggle for the other end
   * (#5223). Both are drawn from the same view, so a brush mutes and a selection marks the same way.
   *
   * @param {?Set<number>} brushStreets - The streets a brush keeps, or null with none.
   * @param {number} auditedStreets - How many streets the city has a score for, for the list's note.
   */
  #drawRank(brushStreets, auditedStreets) {
    const streets = this.#model.state.unit === 'streets';
    const limit = AccessScoreModel.RANK_LIMIT;
    const titleKey = `accessscore:chart-rank${streets ? '-streets' : ''}`;
    if (this.#els.rankTitle) this.#els.rankTitle.textContent = i18next.t(titleKey);
    if (this.#els.rankInfo) {
      // The help sits in both attributes the shared info button uses: the styled tooltip and its accessible name.
      const help = i18next.t(`${titleKey}-help`);
      this.#els.rankInfo.setAttribute('data-ps-tooltip', help);
      this.#els.rankInfo.setAttribute('aria-label', help);
    }
    if (this.#els.rankOrder) {
      this.#els.rankOrder.hidden = !streets;
      this.#els.rankOrder.textContent
        = i18next.t(`accessscore:rank-show-${this.#rankWorst ? 'best' : 'worst'}`, { n: limit });
    }
    const rows = streets ? this.#rankStreetRows(limit) : this.#rankRegionRows();
    let note = '';
    if (streets && auditedStreets > rows.length) {
      note = i18next.t(`accessscore:rank-streets-${this.#rankWorst ? 'worst' : 'best'}`,
        { shown: rows.length, total: auditedStreets });
    } else if (!streets) {
      const floored = this.#model.regionStats.length - rows.length;
      if (floored > 0) note = i18next.t('accessscore:rank-floored', { count: floored });
    }
    this.#rank.draw({
      // The roster changes with the unit and with which end of it is shown, and a street's rank changes under a
      // slider without the roster changing, so both belong in the key.
      shapeKey: `${this.#model.state.unit}:${this.#rankWorst}:${rows.map((r) => r.id).sort((a, b) => a - b).join(',')}`,
      rows,
      outIds: this.#outRowIds(rows, brushStreets),
      selectedId: this.#rankSelectedId(streets),
      note,
      empty: i18next.t(`accessscore:rank-empty${streets ? '-streets' : ''}`),
    });
  }

  /** @returns {AccessScoreRankRow[]} Every scored neighborhood, best first. */
  #rankRegionRows() {
    return this.#model.rankedRegions().map((r, i) => ({
      id: r.regionId,
      name: r.name,
      score: r.score,
      label: i18next.t('accessscore:rank-row', {
        position: i + 1, name: r.name, score: AccessScoreChart.score(r.score),
        percent: Math.round(r.completion * 100),
      }),
    }));
  }

  /**
   * @param {number} limit - How many rows the leaderboard holds.
   * @returns {AccessScoreRankRow[]} One end of the street leaderboard, its best row first.
   */
  #rankStreetRows(limit) {
    return this.#model.rankedStreets({ worst: this.#rankWorst, limit }).map((s, i) => {
      // An unnamed way is a real street with a real score, so it is ranked like any other and named for the reader
      // rather than left blank.
      const name = s.name ?? i18next.t('accessscore:rank-street-unnamed');
      return {
        id: s.streetId,
        name,
        score: s.score,
        label: i18next.t('accessscore:rank-row-street', {
          position: i + 1, name, score: AccessScoreChart.score(s.score), meters: s.lengthM,
        }),
      };
    });
  }

  /**
   * The row the list marks: the selection when it was made in the unit the list ranks, else the region the band
   * is focused on. A street selection marks no neighborhood row, matching the histogram's caret.
   * @param {boolean} streets - Whether the list is ranking streets.
   * @returns {?number}
   */
  #rankSelectedId(streets) {
    if (streets) return this.#selection?.unit === 'streets' ? this.#selection.id : null;
    return this.#selection ? this.#regionOf(this.#selection) : this.#focusRegionId;
  }

  /**
   * Shows the other end of the street leaderboard.
   * @param {boolean} worst - True for the worst-scoring streets.
   */
  setRankWorst(worst) {
    if (worst === this.#rankWorst) return;
    this.#rankWorst = worst;
    this.#schedule({ dim: false, photos: false });
  }

  /**
   * Re-renders the photo strip's card for a label from fresh JSON, after a vote cast in the full label card.
   * @param {Record<string, any>} label - A `/label/id/:id` JSON.
   */
  refreshLabel(label) {
    this.#photos.refreshLabel(label);
  }

  /**
   * What the detail views describe: the selected street or region, else the region focused from the
   * rank list, else the city. A selection made in the other unit is not one here, matching the histogram's caret.
   * What's here never narrows to the viewport: its counts must be the histogram's population, or the two panels
   * would disagree about the same city.
   * @returns {{kind: string, id: ?number, regionId: ?number, name: ?string}} `kind` is 'street', 'region' or
   *   'city'; `regionId` the region the scope sits in, if any; `name` the street's or region's.
   */
  #scope() {
    const unit = this.#model.state.unit;
    const s = this.#selection;
    if (s && s.unit === unit) {
      if (unit === 'streets') {
        const street = this.#model.explainStreet(s.id);
        if (street) return { kind: 'street', id: s.id, regionId: street.regionId, name: street.name };
      } else {
        const r = this.#model.explainRegion(s.id);
        if (r) return { kind: 'region', id: s.id, regionId: s.id, name: r.name };
      }
    }
    if (this.#focusRegionId !== null) {
      const r = this.#model.explainRegion(this.#focusRegionId);
      if (r) return { kind: 'region', id: this.#focusRegionId, regionId: this.#focusRegionId, name: r.name };
    }
    return { kind: 'city', id: null, regionId: null, name: null };
  }

  /**
   * Where the photo strip draws from: the selection, else the area in view once zoomed in enough for that to mean
   * something, else the city rule. A viewport is the nearest few regions it touches plus its own bounds, so
   * a pan inside one region costs no new fetch.
   * @returns {object} A `#scope()` result, or `{kind: 'viewport', regionIds, bounds: [west, south, east, north]}`.
   */
  #photoScope() {
    const scope = this.#scope();
    if (scope.kind !== 'city') return scope;
    if (!this.#map.getZoom || this.#map.getZoom() < AccessScoreDock.PHOTO_VIEWPORT_ZOOM) return scope;
    const visible = this.#mapView.visibleRegionIds ? this.#mapView.visibleRegionIds() : new Set();
    if (visible.size === 0) return scope;
    const center = this.#map.getCenter();
    const regionIds = [...visible]
      .map((id) => {
        const c = this.#mapView.regionBoundsOf(id)?.getCenter() ?? center;
        return { id, d: (c.lng - center.lng) ** 2 + (c.lat - center.lat) ** 2 };
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, AccessScoreDock.PHOTO_VIEWPORT_REGIONS)
      .map((r) => r.id)
      .sort((a, b) => a - b);
    const b = this.#map.getBounds();
    return {
      kind: 'viewport', id: null, regionId: null, name: null, regionIds,
      bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
    };
  }

  /** "Tuxedo Square · Street 1932", or the id alone for an unnamed way. */
  static #streetTitle(scope) {
    return scope.name
      ? i18next.t('accessscore:popup-street-named', { name: scope.name, id: scope.id })
      : i18next.t('accessscore:popup-street', { id: scope.id });
  }

  /** The scope, narrowed by the brush, in the model's terms: a street set, a region set, or nothing for the city. */
  #breakdownScope(scope, brushStreets) {
    if (scope.kind === 'street') {
      const keep = !brushStreets || brushStreets.has(scope.id);
      return { streetIds: new Set(keep ? [scope.id] : []) };
    }
    if (scope.kind === 'region') {
      if (!brushStreets) return { regionIds: new Set([scope.id]) };
      const ids = new Set();
      for (const id of this.#model.regionStreetIds(scope.id)) if (brushStreets.has(id)) ids.add(id);
      return { streetIds: ids };
    }
    return brushStreets ? { streetIds: brushStreets } : {};
  }

  /** "in Sagamore Park · scores 40–60": where the counts come from. */
  #scopeCaption(scope, brushStreets) {
    let text;
    if (scope.kind === 'street') {
      text = scope.name
        ? i18next.t('accessscore:scope-street-named', { name: scope.name })
        : i18next.t('accessscore:scope-street', { id: scope.id });
    } else if (scope.kind === 'region') {
      text = i18next.t('accessscore:scope-region', { name: scope.name });
    } else {
      text = i18next.t('accessscore:scope-city');
    }
    const brush = this.#brush;
    if (brushStreets && brush) {
      if (brush.kind === 'grade') {
        const classes = this.#gradeClassNames(brush.classes).join(i18next.t('accessscore:list-separator'));
        text += ` · ${i18next.t('accessscore:scope-brush-grade', { classes })}`;
      } else {
        const step = 100 / AccessScoreModel.HISTOGRAM_BINS;
        text += ` · ${i18next.t('accessscore:scope-brush',
          { from: brush.from * step, to: brush.to * step })}`;
      }
    }
    return text;
  }

  /** Points the photo strip at the scope's regions, only when the scope actually changed. */
  #showPhotos(scope) {
    let key;
    let request;
    if (scope.kind === 'street') {
      key = `street:${scope.id}`;
      const street = this.#model.explainStreet(scope.id);
      const ends = new Set([street?.startIntersection?.id, street?.endIntersection?.id]
        .filter((id) => id !== null && id !== undefined));
      request = {
        caption: i18next.t('accessscore:photos-from', { scope: AccessScoreDock.#streetTitle(scope) }),
        regionId: scope.regionId,
        streetId: scope.id,
        intersectionIds: ends,
      };
    } else if (scope.kind === 'region') {
      key = `region:${scope.id}`;
      request = {
        caption: i18next.t('accessscore:photos-from', { scope: scope.name }),
        regionId: scope.id,
      };
    } else if (scope.kind === 'viewport') {
      // Bounds to ~100 m: a nudge inside the same view is the same key, and the strip itself skips a redraw when the
      // clusters it picks are unchanged.
      const box = scope.bounds.map((v) => v.toFixed(3)).join(',');
      key = `viewport:${scope.regionIds.join(',')}:${box}`;
      request = {
        caption: i18next.t('accessscore:photos-from', { scope: i18next.t('accessscore:photos-scope-viewport') }),
        regionIds: scope.regionIds,
        bounds: scope.bounds,
      };
    } else {
      // The strip reads one region's feed; with nothing selected, the one most in need of a look.
      const ranked = this.#model.rankedRegions();
      const lowest = ranked.length ? ranked[ranked.length - 1] : null;
      key = `city:${lowest ? lowest.regionId : 'none'}`;
      request = lowest
        ? {
            caption: i18next.t('accessscore:photos-from', {
              scope: i18next.t('accessscore:photos-lowest', { name: lowest.name }),
            }),
            regionId: lowest.regionId,
          }
        : {
            caption: i18next.t('accessscore:photos-from', { scope: i18next.t('accessscore:scope-city') }),
            regionId: null,
          };
    }
    if (key === this.#photoScopeKey) return;
    this.#photoScopeKey = key;
    this.#photos.show(request);
  }

  /**
   * The streets the brush keeps: in the regions unit, the streets of the brushed regions.
   * @returns {?Set<number>} Street ids, or null with no brush.
   */
  #brushStreetIds() {
    const brush = this.#brush;
    if (!brush) return null;
    if (brush.kind === 'grade') return this.#gradeBrushStreetIds(brush.classes);
    if (this.#model.state.unit === 'streets') return this.#model.streetIdsInBins(brush.from, brush.to);
    return this.#model.streetIdsInRegions(this.#model.regionIdsInBins(brush.from, brush.to));
  }

  /** The ids of the active unit the brush keeps, for the map. */
  #brushUnitIds() {
    const brush = this.#brush;
    if (!brush) return null;
    const streets = this.#model.state.unit === 'streets';
    if (brush.kind === 'grade') return streets ? this.#gradeBrushStreetIds(brush.classes) : null;
    if (streets) return this.#model.streetIdsInBins(brush.from, brush.to);
    return this.#model.regionIdsInBins(brush.from, brush.to);
  }

  /**
   * The ranked rows a brush leaves out, muted in the list: for a score brush the ones scoring outside it, for a
   * slope brush the regions holding none of its streets, since grades say nothing about where a score sits. A
   * street row is simply in the brushed set or not, whichever kind the brush is.
   * @param {AccessScoreRankRow[]} rows - The rows on show.
   * @param {?Set<number>} brushStreets - The streets the brush keeps, or null with no brush.
   * @returns {?Set<number>} Ids to mute, or null with no brush.
   */
  #outRowIds(rows, brushStreets) {
    const brush = this.#brush;
    if (!brush) return null;
    if (this.#model.state.unit === 'streets') {
      return new Set(rows.filter((r) => !brushStreets?.has(r.id)).map((r) => r.id));
    }
    if (brush.kind === 'score') {
      const { from, to } = brush;
      return new Set(rows.filter((r) => {
        const bin = AccessScoreModel.binOf(r.score);
        return bin < from || bin >= to;
      }).map((r) => r.id));
    }
    const kept = new Set();
    for (const r of rows) {
      for (const id of this.#model.regionStreetIds(r.id)) {
        if (brushStreets.has(id)) {
          kept.add(r.id);
          break;
        }
      }
    }
    return new Set(rows.filter((r) => !kept.has(r.id)).map((r) => r.id));
  }

  /**
   * The streets a slope-class brush keeps; empty where the city publishes no classes to have brushed on.
   * @param {number[]} classes - The brushed class indices.
   * @returns {Set<number>}
   */
  #gradeBrushStreetIds(classes) {
    if (this.#gradeBreaks === null) return new Set();
    return this.#model.streetIdsInGradeClasses(classes, this.#gradeBreaks);
  }

  /** The ids of the active unit a selection keeps bright: its region, as regions or as streets. */
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
    // The rank list holds whatever the unit ranks, so a bin marks its own members in the streets unit rather than
    // the regions they sit in — a bin of steep blocks would otherwise light up half the list.
    this.#rank.highlight(streets ? ids : this.#model.regionIdsInBins(bin, bin + 1));
    this.#applyMapDim();
  }

  /**
   * A rank row under the pointer or focus: the map keeps its feature bright and the caret moves to its score.
   * @param {number} id - The row's id, a street in the streets unit and a region otherwise.
   */
  #hoverRankRow(id) {
    if (this.#model.state.unit === 'streets') {
      const street = this.#model.explainStreet(id);
      this.#hover = { ids: [id] };
      this.#markCaret(street?.score ?? null);
    } else {
      const r = this.#model.explainRegion(id);
      this.#hover = { ids: [id] };
      this.#markCaret(r && !r.belowFloor ? r.score : null);
    }
    this.#applyMapDim();
  }

  #hoverEnd() {
    if (!this.#hover) return;
    this.#hover = null;
    this.#rank.clearHighlight();
    this.#markCaret(this.#mapHover?.score ?? this.#selectionScore());
    this.#applyMapDim();
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

  /** The region a selection or hover belongs to: the region itself, or the street's region. */
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

  /** What the views count: the city's streets, or its regions. */
  #renderCaption() {
    const unit = this.#model.state.unit;
    this.#els.caption.textContent = unit === 'regions'
      ? i18next.t('accessscore:count-regions', { count: this.#model.regionStats.length })
      : i18next.t('accessscore:count-streets', { count: this.#model.streetCount });
  }

  #renderBrushBar(brushStreets) {
    const bar = this.#els.brush;
    const brush = this.#brush;
    if (!brush) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    if (brush.kind === 'grade') {
      const meters = this.#model.totalLengthM(brushStreets);
      this.#els.brushText.textContent = i18next.t('accessscore:brush-grade', {
        classes: this.#gradeClassNames(brush.classes).join(i18next.t('accessscore:list-separator')),
        count: brushStreets.size,
        length: i18next.t('accessscore:length-large', { km: meters / 1000 }),
      });
      return;
    }
    const step = 100 / AccessScoreModel.HISTOGRAM_BINS;
    const range = { from: brush.from * step, to: brush.to * step };
    let text;
    if (this.#model.state.unit === 'regions') {
      const n = this.#model.regionIdsInBins(brush.from, brush.to).size;
      text = i18next.t('accessscore:brush-regions', { ...range, count: n });
    } else {
      const meters = this.#model.totalLengthM(brushStreets);
      text = i18next.t('accessscore:brush-streets', {
        ...range, count: brushStreets.size, length: i18next.t('accessscore:length-large', { km: meters / 1000 }),
      });
    }
    this.#els.brushText.textContent = text;
  }

  /**
   * A grade brush's classes as the legend words them, so the two say the same thing. Built here rather than read
   * off the legend's DOM, which belongs to a Mapbox control the dock does not own.
   * @param {number[]} selected - The brushed class indices.
   * @returns {string[]} Gentlest first, the no-grade class last.
   */
  #gradeClassNames(selected) {
    const percent = AccessScoreGradeRamp.percent;
    const classes = AccessScoreGradeRamp.classes(this.#gradeBreaks ?? []);
    return selected.map((index) => {
      if (index === AccessScoreGradeRamp.NO_GRADE) return i18next.t('accessscore:grade-legend-none');
      const { from, to } = classes[index] ?? { from: null, to: null };
      if (from === null) return i18next.t('accessscore:grade-class-under', { to: percent(to) });
      if (to === null) return i18next.t('accessscore:grade-class-over', { from: percent(from) });
      return i18next.t('accessscore:grade-class-between', { from: percent(from), to: percent(to) });
    });
  }

  #bind() {
    this.#els.toggle.addEventListener('click', () => this.setOpen(!this.#open));
    this.#els.brushClear.addEventListener('click', () => this.setBrush(null));
    this.#els.rankOrder?.addEventListener('click', () => {
      this.setRankWorst(!this.#rankWorst);
      this.#callbacks.log('RankOrder', this.#rankWorst ? 'worst' : 'best');
    });
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

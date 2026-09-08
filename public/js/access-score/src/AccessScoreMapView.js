/**
 * The AccessScore tool's map layers: streets as score-colored lines, neighborhoods as a score choropleth with a
 * hatch for regions below the completion floor, plus hover, selection, and the legend (#5217).
 *
 * The map owns geometry and paint; the scores live in feature-state. A slider move therefore never re-uploads a
 * source: `applyScores` writes each feature's score as feature-state in one batch per animation frame, and the
 * paint expressions read it through the shared ScoreRamp. Unaudited streets carry no score and fall to the
 * ramp's fallback color, at reduced width and opacity.
 */
class AccessScoreMapView {
  static STREET_SOURCE = 'acs-streets';
  static STREET_LAYER = 'acs-streets';
  static STREET_SELECTED_LAYER = 'acs-streets-selected';
  static REGION_SOURCE = 'acs-regions';
  static REGION_FILL_LAYER = 'acs-regions-fill';
  static REGION_HATCH_LAYER = 'acs-regions-hatch';
  static REGION_OUTLINE_LAYER = 'acs-regions-outline';
  static REGION_LABEL_LAYER = 'acs-regions-labels';
  static HATCH_IMAGE = 'acs-hatch';

  #map;
  #model;
  #onSelect;
  #onHover;
  #tooltipHtml;
  #clickClaimed;
  #hoverClaimed;
  #unit;
  #hover = { source: null, id: null };
  #selected = { unit: null, id: null };
  #tooltip;
  #frame = null;
  #scoresPending = false;
  #dimPending = false;
  /** The ids kept bright by the brush, or null when nothing is dimmed. */
  #brush = null;
  /** Per source, the ids currently carrying `dim: true` in feature-state, so a rewrite touches only the difference. */
  #dimmed = { [AccessScoreMapView.STREET_SOURCE]: new Set(), [AccessScoreMapView.REGION_SOURCE]: new Set() };
  /** Each region's bounding box, for the viewport query. */
  #regionBounds = new Map();
  #legend;
  #marker = null;

  /**
   * @param {mapboxgl.Map} map - A loaded Mapbox map.
   * @param {object} options - Data and callbacks.
   * @param {AccessScoreModel} options.model - The scoring model.
   * @param {object} options.streets - The API's street FeatureCollection (geometry + `street_edge_id`, `region_id`,
   *                                   `audit_count`).
   * @param {object} options.regions - The `/neighborhoods` polygon FeatureCollection (`region_id`, `region_name`).
   * @param {function} options.onSelect - Called with `{unit, id, lngLat}` on a click, or `null` on deselect.
   * @param {function} [options.onHover] - Called with `{unit, id, score}` as the pointer enters a feature (score
   *                                       null where it has none), and with `null` as it leaves.
   * @param {function} options.tooltipHtml - Called with `{unit, id}`; returns the hover tooltip's HTML or null.
   * @param {function} [options.clickClaimed] - Called with the Mapbox click event; return true when something
   *                                            drawn above these layers (a cluster dot) owns the click.
   * @param {function} [options.hoverClaimed] - Called with the Mapbox mousemove event; return true when something
   *                                            drawn above these layers owns the hover, so its tooltip is the
   *                                            only one showing.
   */
  constructor(map, { model, streets, regions, onSelect, onHover = () => {}, tooltipHtml, clickClaimed = () => false,
    hoverClaimed = () => false }) {
    this.#map = map;
    this.#model = model;
    this.#onSelect = onSelect;
    this.#onHover = onHover;
    this.#tooltipHtml = tooltipHtml;
    this.#clickClaimed = clickClaimed;
    this.#hoverClaimed = hoverClaimed;
    this.#unit = model.state.unit;
    this.#tooltip = new mapboxgl.Popup({
      closeButton: false, closeOnClick: false, focusAfterOpen: false, className: 'acs-tooltip', maxWidth: '280px',
    });
    this.#addHatchImage();
    this.#addRegionLayers(regions);
    this.#addStreetLayers(streets);
    this.#addInteractions();
    this.#legend = this.#addLegend();
    this.setUnit(this.#unit);
    this.applyScores();
  }

  /**
   * Shows one unit's layers and hides the other's. Streets keep a faint presence under the choropleth so the
   * network stays legible, but only the active unit answers hover and click.
   * @param {string} unit - 'streets' or 'regions'.
   */
  setUnit(unit) {
    this.#unit = unit;
    const streets = unit === 'streets';
    this.#map.setLayoutProperty(AccessScoreMapView.STREET_LAYER, 'visibility', streets ? 'visible' : 'none');
    this.#map.setLayoutProperty(AccessScoreMapView.STREET_SELECTED_LAYER, 'visibility', streets ? 'visible' : 'none');
    for (const id of [AccessScoreMapView.REGION_FILL_LAYER, AccessScoreMapView.REGION_HATCH_LAYER,
      AccessScoreMapView.REGION_LABEL_LAYER]) {
      this.#map.setLayoutProperty(id, 'visibility', streets ? 'none' : 'visible');
    }
    // Region outlines stay on in both units as the neighborhood context; they only carry hover in regions mode.
    this.#clearHover();
    this.#tooltip.remove();
    this.#renderLegend();
    // A brush is a set of the active unit's ids, so the other unit's dims are stale the moment the unit flips.
    this.#brush = null;
    this.#dimPending = true;
    this.#schedule();
  }

  /**
   * Writes the model's current scores into feature-state, coalescing calls into one pass per animation frame so a
   * slider drag costs one batch per frame however many `input` events it fires.
   */
  applyScores() {
    this.#scoresPending = true;
    this.#schedule();
  }

  /**
   * Dims every feature of the active unit outside a set of ids — the map's side of a chart brush — or clears the
   * dimming. Writes only the difference from the last call, and shares `applyScores`'s animation frame, so a
   * slider drag with a brush in force still costs one batch per frame.
   * @param {?Iterable<number>} ids - The street or region ids to keep bright, or null for no brush.
   */
  setBrush(ids) {
    this.#brush = ids ? new Set(ids) : null;
    this.#dimPending = true;
    this.#schedule();
  }

  /** One animation frame flushes whatever is pending: scores, dims, or both. */
  #schedule() {
    if (this.#frame !== null) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      if (this.#scoresPending) this.#writeScores();
      if (this.#dimPending) this.#writeDims();
      this.#scoresPending = false;
      this.#dimPending = false;
    });
  }

  /** Hides the hover tooltip, e.g. when a selection popup opens where the pointer sits. */
  hideTooltip() {
    this.#tooltip.remove();
  }

  /**
   * Whether unaudited streets are drawn at all.
   * @param {boolean} show - True to draw them faintly, false to hide them.
   */
  setShowUnaudited(show) {
    this.#map.setPaintProperty(AccessScoreMapView.STREET_LAYER, 'line-opacity', this.#streetOpacity(show));
  }

  /**
   * Marks a feature as selected (a persistent outline) and remembers it for the URL.
   * @param {?{unit: string, id: number}} selection - The selection, or null to clear.
   */
  setSelection(selection) {
    this.#selected = selection ? { ...selection } : { unit: null, id: null };
    const streetId = this.#selected.unit === 'streets' ? this.#selected.id : -1;
    this.#map.setFilter(AccessScoreMapView.STREET_SELECTED_LAYER, ['==', ['get', 'street_edge_id'], streetId]);
    this.#map.setPaintProperty(AccessScoreMapView.REGION_OUTLINE_LAYER, 'line-width', [
      'case',
      ['==', ['get', 'region_id'], this.#selected.unit === 'regions' ? this.#selected.id : -1], 3.5,
      ['boolean', ['feature-state', 'hover'], false], 2.5,
      1.2,
    ]);
    this.#markSelected();
  }

  /**
   * Fits the map to a region's polygon.
   * @param {number} regionId - The region to frame.
   */
  flyToRegion(regionId) {
    const source = this.#map.getSource(AccessScoreMapView.REGION_SOURCE);
    const feature = source?._data?.features?.find((f) => f.properties.region_id === regionId);
    if (!feature) return;
    this.#map.fitBounds(featureCollectionBounds({ type: 'FeatureCollection', features: [feature] }),
      { padding: 40, maxZoom: 15 });
  }

  /**
   * The ids of the streets drawn in the part of the map the user can see, for viewport-scoped charts.
   * @returns {Set<number>} Street ids.
   */
  visibleStreetIds() {
    const rendered = this.#map.queryRenderedFeatures(this.#visibleBox(), {
      layers: [AccessScoreMapView.STREET_LAYER],
    });
    return new Set(rendered.map((f) => f.properties.street_edge_id));
  }

  /**
   * The ids of the regions whose bounding box touches the part of the map the user can see. A bounding-box test
   * rather than `queryRenderedFeatures` on the fill layer, which returns one entry per tile per polygon.
   * @returns {Set<number>} Region ids.
   */
  visibleRegionIds() {
    const [[x0, y0], [x1, y1]] = this.#visibleBox();
    const sw = this.#map.unproject([x0, y1]);
    const ne = this.#map.unproject([x1, y0]);
    const out = new Set();
    for (const [id, b] of this.#regionBounds) {
      if (b.getWest() <= ne.lng && b.getEast() >= sw.lng && b.getSouth() <= ne.lat && b.getNorth() >= sw.lat) {
        out.add(id);
      }
    }
    return out;
  }

  /**
   * The pixel box of the map not covered by the drawer or the dock: the map's canvas minus its padding, which is
   * exactly what those overlays set.
   * @returns {Array<Array<number>>} `[[left, top], [right, bottom]]` in canvas pixels.
   */
  #visibleBox() {
    const p = this.#map.getPadding();
    const { width, height } = this.#map.getContainer().getBoundingClientRect();
    return [[p.left, p.top], [Math.max(p.left, width - p.right), Math.max(p.top, height - p.bottom)]];
  }

  /** The hatch tile: thin diagonal grey strokes, so an unscored region reads as "no data" rather than a color. */
  #addHatchImage() {
    const size = 12;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = AccessScoreMapView.#token('--color-neutral-600');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-2, size + 2);
    ctx.lineTo(size + 2, -2);
    ctx.moveTo(-2, size / 2 + 2);
    ctx.lineTo(size / 2 + 2, -2);
    ctx.moveTo(size / 2 - 2, size + 2);
    ctx.lineTo(size + 2, size / 2 - 2);
    ctx.stroke();
    this.#map.addImage(AccessScoreMapView.HATCH_IMAGE, ctx.getImageData(0, 0, size, size), { pixelRatio: 1 });
  }

  /** Neighborhood fill, hatch, outline, and name layers, bottom to top. */
  #addRegionLayers(regions) {
    for (const f of regions.features || []) this.#regionBounds.set(f.properties.region_id, geometryBounds(f.geometry));
    this.#map.addSource(AccessScoreMapView.REGION_SOURCE, {
      type: 'geojson', data: regions, promoteId: 'region_id',
    });
    const score = ['coalesce', ['feature-state', 'score'], -1];
    const dim = ['boolean', ['feature-state', 'dim'], false];
    this.#map.addLayer({
      id: AccessScoreMapView.REGION_FILL_LAYER,
      type: 'fill',
      source: AccessScoreMapView.REGION_SOURCE,
      paint: {
        'fill-color': ScoreRamp.expression(score, { noneColor: AccessScoreMapView.#token('--color-neutral-200') }),
        'fill-opacity': ['case', dim, 0.15, ['boolean', ['feature-state', 'hover'], false], 0.85, 0.7],
      },
    });
    // A filter can't read feature-state, so the hatch layer is filtered on an id list that applyScores rewrites.
    this.#map.addLayer({
      id: AccessScoreMapView.REGION_HATCH_LAYER,
      type: 'fill',
      source: AccessScoreMapView.REGION_SOURCE,
      filter: ['in', ['get', 'region_id'], ['literal', []]],
      paint: { 'fill-pattern': AccessScoreMapView.HATCH_IMAGE, 'fill-opacity': 0.9 },
    });
    this.#map.addLayer({
      id: AccessScoreMapView.REGION_OUTLINE_LAYER,
      type: 'line',
      source: AccessScoreMapView.REGION_SOURCE,
      paint: {
        'line-color': AccessScoreMapView.#token('--color-neutral-white'),
        'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 1.2],
        'line-opacity': 0.9,
      },
    });
    this.#map.addLayer({
      id: AccessScoreMapView.REGION_LABEL_LAYER,
      type: 'symbol',
      source: AccessScoreMapView.REGION_SOURCE,
      minzoom: 12,
      layout: {
        'text-field': ['get', 'region_name'],
        'text-size': 12,
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': AccessScoreMapView.#token('--color-neutral-900'),
        'text-halo-color': AccessScoreMapView.#token('--color-neutral-white'),
        'text-halo-width': 1.5,
        'text-opacity': ['case', dim, 0.3, 1],
      },
    });
  }

  /** Street lines colored by feature-state score, plus a casing layer for the selected street. */
  #addStreetLayers(streets) {
    // Only what the paint expressions and the popup need travels to the GPU; the counts stay in the model.
    const slim = {
      type: 'FeatureCollection',
      features: streets.features.map((f) => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          street_edge_id: f.properties.street_edge_id,
          region_id: f.properties.region_id,
          audited: f.properties.audit_count > 0 ? 1 : 0,
        },
      })),
    };
    this.#map.addSource(AccessScoreMapView.STREET_SOURCE, {
      type: 'geojson', data: slim, promoteId: 'street_edge_id', tolerance: 0.5,
    });
    const score = ['coalesce', ['feature-state', 'score'], -1];
    const hovered = ['boolean', ['feature-state', 'hover'], false];
    const unaudited = ['==', ['get', 'audited'], 0];
    this.#map.addLayer({
      id: AccessScoreMapView.STREET_SELECTED_LAYER,
      type: 'line',
      source: AccessScoreMapView.STREET_SOURCE,
      filter: ['==', ['get', 'street_edge_id'], -1],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': AccessScoreMapView.#token('--color-neutral-black'),
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 9, 17, 16],
        'line-opacity': 0.9,
      },
    });
    this.#map.addLayer({
      id: AccessScoreMapView.STREET_LAYER,
      type: 'line',
      source: AccessScoreMapView.STREET_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ScoreRamp.expression(score, { noneColor: AccessScoreMapView.#token('--color-neutral-400') }),
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          10, ['case', hovered, 3, unaudited, 0.8, 1.2],
          14, ['case', hovered, 6, unaudited, 1.5, 3],
          17, ['case', hovered, 12, unaudited, 3, 7],
        ],
        'line-opacity': this.#streetOpacity(this.#model.state.showUnaudited),
      },
    });
  }

  /**
   * The street opacity expression: audited full, unaudited faint or hidden, and everything outside a brush dimmed —
   * unaudited streets included, or they would read brighter than the scored streets a brush left out.
   */
  #streetOpacity(showUnaudited) {
    const dim = ['boolean', ['feature-state', 'dim'], false];
    return [
      'case',
      ['==', ['get', 'audited'], 0], showUnaudited ? ['case', dim, 0.1, 0.55] : 0,
      dim, 0.15,
      0.92,
    ];
  }

  /** Hover state + tooltip and click selection for whichever unit is active. */
  #addInteractions() {
    const bind = (layer, source, unit) => {
      this.#map.on('mousemove', layer, (e) => {
        if (this.#unit !== unit || !e.features.length) return;
        // A cluster dot under the pointer owns the tooltip; two popups over one spot is unreadable.
        if (this.#hoverClaimed(e)) {
          this.#clearHover();
          this.#tooltip.remove();
          this.#markSelected();
          return;
        }
        const id = e.features[0].id;
        if (this.#hover.id !== id || this.#hover.source !== source) {
          this.#clearHover();
          this.#hover = { source, id };
          this.#map.setFeatureState({ source, id }, { hover: true });
          this.#map.getCanvas().style.cursor = 'pointer';
          this.#onHover({ unit, id, score: this.#scoreOf(unit, id) });
        }
        this.markScore(this.#scoreOf(unit, id));
        const html = this.#tooltipHtml({ unit, id });
        if (html) this.#tooltip.setLngLat(e.lngLat).setHTML(html).addTo(this.#map);
      });
      this.#map.on('mouseleave', layer, () => {
        if (this.#unit !== unit) return;
        this.#clearHover();
        this.#tooltip.remove();
        this.#markSelected();
        this.#map.getCanvas().style.cursor = '';
      });
      this.#map.on('click', layer, (e) => {
        if (this.#unit !== unit || !e.features.length || this.#clickClaimed(e)) return;
        e.preventDefault();
        this.#onSelect({ unit, id: e.features[0].id, lngLat: e.lngLat });
      });
    };
    bind(AccessScoreMapView.STREET_LAYER, AccessScoreMapView.STREET_SOURCE, 'streets');
    bind(AccessScoreMapView.REGION_FILL_LAYER, AccessScoreMapView.REGION_SOURCE, 'regions');
    // A click on bare map clears the selection; Mapbox marks layer clicks with defaultPrevented.
    this.#map.on('click', (e) => {
      if (!e.defaultPrevented && this.#selected.id !== null) this.#onSelect(null);
    });
    // Leaving the canvas for a DOM element over it — the address-search pin and its popup, a control — fires no
    // layer mouseleave, and the tooltip would otherwise sit open beside the pin's own popup.
    this.#map.on('mouseout', () => {
      this.#clearHover();
      this.#tooltip.remove();
      this.#markSelected();
      this.#map.getCanvas().style.cursor = '';
    });
  }

  /** A street's or region's score under the current weights, or null where it has none. */
  #scoreOf(unit, id) {
    if (unit === 'streets') {
      const s = this.#model.explainStreet(id);
      return s && s.audited ? s.score : null;
    }
    const r = this.#model.explainRegion(id);
    return r && !r.belowFloor ? r.score : null;
  }

  /** Returns the legend mark to whatever is selected — where the pointer leaves it when nothing is hovered. */
  #markSelected() {
    this.markScore(this.#selected.id === null ? null : this.#scoreOf(this.#selected.unit, this.#selected.id));
  }

  #clearHover() {
    if (this.#hover.id !== null) {
      this.#map.setFeatureState({ source: this.#hover.source, id: this.#hover.id }, { hover: false });
      this.#onHover(null);
    }
    this.#hover = { source: null, id: null };
  }

  /**
   * The dim batch: the active unit's features outside the brush get `dim: true`, everything else `dim: false` —
   * written as the difference from the last batch. The inactive unit's dims are always cleared, so a brush set in
   * one unit never lingers under the other.
   */
  #writeDims() {
    const streets = this.#unit === 'streets';
    const activeSource = streets ? AccessScoreMapView.STREET_SOURCE : AccessScoreMapView.REGION_SOURCE;
    for (const source of Object.keys(this.#dimmed)) {
      const target = new Set();
      if (this.#brush && source === activeSource) {
        if (streets) {
          for (const id of this.#model.streetIds) if (!this.#brush.has(id)) target.add(id);
        } else {
          for (const r of this.#model.regionStats) if (!this.#brush.has(r.regionId)) target.add(r.regionId);
        }
      }
      const current = this.#dimmed[source];
      for (const id of current) if (!target.has(id)) this.#map.setFeatureState({ source, id }, { dim: false });
      for (const id of target) if (!current.has(id)) this.#map.setFeatureState({ source, id }, { dim: true });
      this.#dimmed[source] = target;
    }
  }

  /** The feature-state batch: every street's score, every region's score and floor flag. */
  #writeScores() {
    const ids = this.#model.streetIds;
    const scores = this.#model.streetScores;
    const audited = this.#model.streetAudited;
    const source = AccessScoreMapView.STREET_SOURCE;
    for (let i = 0; i < ids.length; i++) {
      if (audited[i] === 1) this.#map.setFeatureState({ source, id: ids[i] }, { score: scores[i] });
    }
    for (const r of this.#model.regionStats) {
      this.#map.setFeatureState({ source: AccessScoreMapView.REGION_SOURCE, id: r.regionId }, {
        score: r.score === null || r.belowFloor ? -1 : r.score,
        belowFloor: r.belowFloor || r.score === null,
      });
    }
    // fill-pattern can't read feature-state through a paint expression, so the hatch layer filters on it instead.
    this.#map.setFilter(AccessScoreMapView.REGION_HATCH_LAYER, ['in', ['get', 'region_id'], ['literal',
      this.#model.regionStats.filter((r) => r.belowFloor || r.score === null).map((r) => r.regionId)]]);
    // A weight change moves the selected feature's score, so the legend mark has to follow it.
    if (this.#hover.id === null) this.#markSelected();
  }

  /**
   * The legend overlay in the map's bottom-left corner. It goes on the map's holder, after the drawer, so the
   * stylesheet can shift it clear of the open drawer with a sibling selector; inside the map canvas it would sit
   * under the drawer's left 350px.
   */
  #addLegend() {
    const el = document.createElement('div');
    el.className = 'acs-legend';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', i18next.t('accessscore:legend'));
    this.#map.getContainer().parentElement.appendChild(el);
    return el;
  }

  #renderLegend() {
    const unaudited = this.#unit === 'streets'
      ? `<div class="acs-legend__row"><span class="acs-legend__swatch acs-legend__swatch--unaudited"></span>${
        i18next.t('accessscore:legend-unaudited')}</div>`
      : `<div class="acs-legend__row"><span class="acs-legend__swatch acs-legend__swatch--hatch"></span>${
        i18next.t('accessscore:legend-insufficient')}</div>`;
    // The numeric ends carry which direction is better; the words under them say what the direction means.
    this.#legend.innerHTML = `
      <div class="acs-legend__title">${i18next.t('accessscore:legend-title')}</div>
      <div class="acs-legend__bar"><span class="acs-legend__marker" hidden aria-hidden="true"></span></div>
      <div class="acs-legend__ticks"><span>0</span><span>50</span><span>100</span></div>
      <div class="acs-legend__poles">
        <span>${i18next.t('accessscore:legend-low')}</span>
        <span>${i18next.t('accessscore:legend-high')}</span>
      </div>
      ${unaudited}
    `;
    // The ramp is data, not styling, so it can't live in the stylesheet.
    this.#legend.querySelector('.acs-legend__bar').style.background = ScoreRamp.cssGradient();
    this.#marker = this.#legend.querySelector('.acs-legend__marker');
  }

  /**
   * Marks a score's place on the legend's ramp, so hovering a feature says in one glance which end of the scale
   * it sits at — the question a gradient alone never answers.
   * @param {?number} score - A score in [0, 1], or null to clear the mark.
   */
  markScore(score) {
    if (!this.#marker) return;
    const show = typeof score === 'number' && Number.isFinite(score);
    this.#marker.hidden = !show;
    if (show) this.#marker.style.left = `${Math.min(100, Math.max(0, score * 100))}%`;
  }

  /** A main.css color token's value. */
  static #token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
}

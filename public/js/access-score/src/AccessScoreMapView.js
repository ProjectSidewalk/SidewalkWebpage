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
  #tooltipHtml;
  #unit;
  #hover = { source: null, id: null };
  #selected = { unit: null, id: null };
  #tooltip;
  #frame = null;
  #legend;

  /**
   * @param {mapboxgl.Map} map - A loaded Mapbox map.
   * @param {object} options - Data and callbacks.
   * @param {AccessScoreModel} options.model - The scoring model.
   * @param {object} options.streets - The API's street FeatureCollection (geometry + `street_edge_id`, `region_id`,
   *                                   `audit_count`).
   * @param {object} options.regions - The `/neighborhoods` polygon FeatureCollection (`region_id`, `region_name`).
   * @param {function} options.onSelect - Called with `{unit, id, lngLat}` on a click, or `null` on deselect.
   * @param {function} options.tooltipHtml - Called with `{unit, id}`; returns the hover tooltip's HTML or null.
   */
  constructor(map, { model, streets, regions, onSelect, tooltipHtml }) {
    this.#map = map;
    this.#model = model;
    this.#onSelect = onSelect;
    this.#tooltipHtml = tooltipHtml;
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
  }

  /**
   * Writes the model's current scores into feature-state, coalescing calls into one pass per animation frame so a
   * slider drag costs one batch per frame however many `input` events it fires.
   */
  applyScores() {
    if (this.#frame !== null) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      this.#writeScores();
    });
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
   * The ids of the streets currently drawn in the viewport, for viewport-scoped charts.
   * @returns {Set<number>} Street ids.
   */
  visibleStreetIds() {
    const rendered = this.#map.queryRenderedFeatures({ layers: [AccessScoreMapView.STREET_LAYER] });
    return new Set(rendered.map((f) => f.properties.street_edge_id));
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
    this.#map.addSource(AccessScoreMapView.REGION_SOURCE, {
      type: 'geojson', data: regions, promoteId: 'region_id',
    });
    const score = ['coalesce', ['feature-state', 'score'], -1];
    this.#map.addLayer({
      id: AccessScoreMapView.REGION_FILL_LAYER,
      type: 'fill',
      source: AccessScoreMapView.REGION_SOURCE,
      paint: {
        'fill-color': ScoreRamp.expression(score, { noneColor: AccessScoreMapView.#token('--color-neutral-200') }),
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.85, 0.7],
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

  /** The street opacity expression: audited full, unaudited faint or hidden, brushed-out streets dimmed. */
  #streetOpacity(showUnaudited) {
    return [
      'case',
      ['==', ['get', 'audited'], 0], showUnaudited ? 0.55 : 0,
      ['boolean', ['feature-state', 'dim'], false], 0.15,
      0.92,
    ];
  }

  /** Hover state + tooltip and click selection for whichever unit is active. */
  #addInteractions() {
    const bind = (layer, source, unit) => {
      this.#map.on('mousemove', layer, (e) => {
        if (this.#unit !== unit || !e.features.length) return;
        const id = e.features[0].id;
        if (this.#hover.id !== id || this.#hover.source !== source) {
          this.#clearHover();
          this.#hover = { source, id };
          this.#map.setFeatureState({ source, id }, { hover: true });
          this.#map.getCanvas().style.cursor = 'pointer';
        }
        const html = this.#tooltipHtml({ unit, id });
        if (html) this.#tooltip.setLngLat(e.lngLat).setHTML(html).addTo(this.#map);
      });
      this.#map.on('mouseleave', layer, () => {
        if (this.#unit !== unit) return;
        this.#clearHover();
        this.#tooltip.remove();
        this.#map.getCanvas().style.cursor = '';
      });
      this.#map.on('click', layer, (e) => {
        if (this.#unit !== unit || !e.features.length) return;
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
  }

  #clearHover() {
    if (this.#hover.id !== null) {
      this.#map.setFeatureState({ source: this.#hover.source, id: this.#hover.id }, { hover: false });
    }
    this.#hover = { source: null, id: null };
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
    this.#legend.innerHTML = `
      <div class="acs-legend__title">${i18next.t('accessscore:legend-title')}</div>
      <div class="acs-legend__bar"></div>
      <div class="acs-legend__ticks">
        <span>${i18next.t('accessscore:legend-low')}</span>
        <span>50</span>
        <span>${i18next.t('accessscore:legend-high')}</span>
      </div>
      ${unaudited}
    `;
    // The ramp is data, not styling, so it can't live in the stylesheet.
    this.#legend.querySelector('.acs-legend__bar').style.background = ScoreRamp.cssGradient();
  }

  /** A main.css color token's value. */
  static #token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
}

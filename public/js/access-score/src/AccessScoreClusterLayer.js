/**
 * The label clusters a score is computed from, drawn on the AccessScore map (#5217).
 *
 * The engine scores **clusters**, not raw labels: `AccessScoreService` streams one row per cluster and
 * `AccessScoreCalculator` turns each into a term. Drawing the raw labels instead would show a different, denser
 * population than the arithmetic uses — three pins on one broken curb read as three problems on the map and one
 * on the street's score. So this layer draws the clusters themselves, one Mapbox circle layer per scored type,
 * with a dot's radius carrying how many labels went into it.
 *
 * Presentation only: it takes a FeatureCollection from `/v3/api/labelClusters` and hands hover and click back to
 * the page, which owns the model and the label card.
 */
class AccessScoreClusterLayer {
  /** Cluster sizes above this stop growing the dot; a 40-label cluster shouldn't swallow the street. */
  static #MAX_SIZE = 10;

  #map;
  #types;
  #layers = [];
  #tooltip;
  #tooltipHtml;
  #onSelect;
  #visible = true;
  /** Types switched off individually, from the dock's cluster view. */
  #hiddenTypes = new Set();
  #hovered = null;

  /**
   * @param {mapboxgl.Map} map - A loaded Mapbox map.
   * @param {object} options - Data and callbacks.
   * @param {Array<string>} options.types - The scored label types, in the engine's order (bottom layer first).
   * @param {function} options.tooltipHtml - Called with a cluster's `properties`; returns tooltip HTML or null.
   * @param {function} options.onSelect - Called with a cluster's `properties` on a click.
   */
  constructor(map, { types, tooltipHtml, onSelect }) {
    this.#map = map;
    this.#types = types;
    this.#tooltipHtml = tooltipHtml;
    this.#onSelect = onSelect;
    this.#tooltip = new mapboxgl.Popup({
      closeButton: false, closeOnClick: false, focusAfterOpen: false, className: 'acs-tooltip', maxWidth: '280px',
    });
    for (const type of types) this.#layers.push(this.#addLayer(type));
    this.#addInteractions();
  }

  /** The layer ids, so a caller can ask whether a pointer event landed on a cluster. */
  get layerIds() {
    return this.#layers;
  }

  /**
   * Replaces the clusters drawn, per type. Types absent from the collection are emptied rather than left stale.
   * @param {object} featureCollection - A `/v3/api/labelClusters` GeoJSON response.
   */
  setData(featureCollection) {
    const byType = Object.fromEntries(this.#types.map((type) => [type, []]));
    for (const feature of featureCollection.features || []) {
      byType[feature.properties.label_type]?.push(feature);
    }
    for (const type of this.#types) {
      this.#map.getSource(AccessScoreClusterLayer.#layerId(type))
        .setData({ type: 'FeatureCollection', features: byType[type] });
    }
  }

  /**
   * Shows or hides every cluster layer.
   * @param {boolean} visible - True to draw them.
   */
  setVisible(visible) {
    this.#visible = visible;
    this.#applyVisibility();
    if (!visible) this.#clearHover();
  }

  /**
   * Shows or hides one type's clusters, under the layer-wide switch: a type hidden here stays hidden when the
   * layer is switched back on.
   * @param {string} type - A scored label type.
   * @param {boolean} visible - True to draw it.
   */
  setTypeVisible(type, visible) {
    if (visible) this.#hiddenTypes.delete(type);
    else this.#hiddenTypes.add(type);
    this.#applyVisibility();
    if (!visible) this.#clearHover();
  }

  #applyVisibility() {
    for (const type of this.#types) {
      const shown = this.#visible && !this.#hiddenTypes.has(type);
      this.#map.setLayoutProperty(AccessScoreClusterLayer.#layerId(type), 'visibility', shown ? 'visible' : 'none');
    }
  }

  /**
   * Whether a cluster sits under a pointer event — the map's street/neighborhood tooltip yields to this one, and
   * a click on a dot must not also select the street beneath it.
   * @param {object} e - A Mapbox pointer event.
   * @returns {boolean} True when a visible cluster is under the pointer.
   */
  claims(e) {
    if (!this.#visible) return false;
    return this.#map.queryRenderedFeatures(e.point, { layers: this.#layers }).length > 0;
  }

  /** Hides the cluster tooltip, e.g. when a selection popup opens where the pointer sits. */
  hideTooltip() {
    this.#tooltip.remove();
  }

  /** One source + circle layer for a type, sized by cluster size and colored by the type's canonical color. */
  #addLayer(type) {
    const id = AccessScoreClusterLayer.#layerId(type);
    this.#map.addSource(id, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      promoteId: 'label_cluster_id',
    });
    const colors = util.misc.getLabelColors();
    const hovered = ['boolean', ['feature-state', 'hover'], false];
    this.#map.addLayer({
      id,
      type: 'circle',
      source: id,
      layout: { visibility: 'visible' },
      paint: {
        'circle-radius': AccessScoreClusterLayer.#radius(hovered),
        'circle-color': colors[type].fillStyle,
        'circle-stroke-color': colors[type].strokeStyle,
        'circle-stroke-width': ['case', hovered, 2, 1],
        'circle-opacity': 0.85,
        'circle-stroke-opacity': 0.9,
      },
    });
    return id;
  }

  /**
   * Radius by zoom and cluster size. Size is the honest signal here — a cluster of eight labels is eight people
   * (or eight passes) agreeing something is there — so it is on the dot rather than only in the tooltip.
   *
   * Mapbox allows `zoom` only as the input of the *outermost* interpolate, so the size ramp and the hover bump
   * both live inside each zoom stop rather than being added around the whole expression.
   *
   * @param {Array} hovered - The feature-state hover test, added as a few extra pixels at every zoom.
   * @returns {Array} A Mapbox paint expression.
   */
  static #radius(hovered) {
    const bySize = (small, large) => ['+',
      ['interpolate', ['linear'], ['get', 'cluster_size'], 1, small, AccessScoreClusterLayer.#MAX_SIZE, large],
      ['case', hovered, 3, 0]];
    return ['interpolate', ['linear'], ['zoom'], 13, bySize(2, 4), 17, bySize(5, 11), 20, bySize(8, 18)];
  }

  #addInteractions() {
    this.#map.on('mousemove', this.#layers, (e) => {
      if (!this.#visible || !e.features.length) return;
      const feature = e.features[0];
      if (this.#hovered?.id !== feature.id || this.#hovered?.source !== feature.layer.id) {
        this.#clearHover();
        this.#hovered = { source: feature.layer.id, id: feature.id };
        this.#map.setFeatureState(this.#hovered, { hover: true });
        this.#map.getCanvas().style.cursor = 'pointer';
      }
      const html = this.#tooltipHtml(AccessScoreClusterLayer.#props(feature));
      if (html) this.#tooltip.setLngLat(e.lngLat).setHTML(html).addTo(this.#map);
    });
    this.#map.on('mouseleave', this.#layers, () => this.#clearHover());
    this.#map.on('click', this.#layers, (e) => {
      if (!this.#visible || !e.features.length) return;
      // The street or neighborhood under the dot keeps its selection; AccessScoreMapView checks defaultPrevented.
      e.preventDefault();
      this.#onSelect(AccessScoreClusterLayer.#props(e.features[0]));
    });
  }

  /**
   * A cluster's properties as the API sent them.
   *
   * Mapbox turns a GeoJSON source into vector tiles internally, and vector tiles carry only scalar values — so
   * `label_ids` and `tag_counts` come back out of a query or an event as **JSON strings**, silently. Reading
   * `properties.label_ids[0]` gets you the character `[`, not a label id, and the failure is a broken label card
   * rather than an error.
   *
   * @param {object} feature - A Mapbox feature from a query or a pointer event.
   * @returns {object} The properties, with the JSON-encoded fields parsed back.
   */
  static #props(feature) {
    const props = { ...feature.properties };
    for (const key of ['label_ids', 'users', 'tag_counts']) {
      if (typeof props[key] === 'string') {
        try {
          props[key] = JSON.parse(props[key]);
        } catch {
          delete props[key];
        }
      }
    }
    return props;
  }

  #clearHover() {
    if (this.#hovered) this.#map.setFeatureState(this.#hovered, { hover: false });
    this.#hovered = null;
    this.#tooltip.remove();
    this.#map.getCanvas().style.cursor = '';
  }

  static #layerId(type) {
    return `acs-clusters-${type}`;
  }
}

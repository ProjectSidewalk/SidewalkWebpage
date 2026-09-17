/**
 * The places the AccessScore map shows beside the scores (#5311): schools, health care, libraries, grocery stores,
 * transit stops, parks, and community centers, one Mapbox symbol layer per category, fed by `/v3/api/places`.
 *
 * The categories come from the backend (`place_categories` on `/v3/api/accessScoreConfig`); what this class holds
 * is presentation only — which glyph each category wears and the zoom it appears at. Every marker is the same disc
 * in the place-marker color with a white glyph: the map already spends its hues on the score ramp and the label
 * types, so a place reads as a landmark rather than as data, and the sidebar's icon list is the legend. Mapbox's
 * own collision detection thins the markers where they crowd (a big city has thousands of bus stops), which is why
 * these are symbols rather than circles.
 *
 * Presentation only: it takes a FeatureCollection and hands hover and click back to the page, which owns the model
 * and the place card.
 */
class AccessScorePlacesLayer {
  /**
   * Per category: the glyph file under `images/icons/` and the zoom the category first appears at. Health care and
   * libraries are few enough to be useful at city scale; the rest wait for street level, like the cluster dots.
   */
  static PRESENTATION = Object.freeze({
    school: Object.freeze({ icon: 'school-white-lucide.svg', minZoom: 14 }),
    health: Object.freeze({ icon: 'hospital-white-lucide.svg', minZoom: 12 }),
    library: Object.freeze({ icon: 'library-white-lucide.svg', minZoom: 12 }),
    grocery: Object.freeze({ icon: 'shopping-basket-white-lucide.svg', minZoom: 14 }),
    transit: Object.freeze({ icon: 'bus-white-lucide.svg', minZoom: 14 }),
    park: Object.freeze({ icon: 'trees-white-lucide.svg', minZoom: 14 }),
    community: Object.freeze({ icon: 'users-white-lucide.svg', minZoom: 14 }),
  });

  /** What a category the backend added before this file learned it looks like: a plain pin at street level. */
  static DEFAULT_PRESENTATION = Object.freeze({ icon: 'map-pin-white-lucide.svg', minZoom: 14 });

  /** The marker disc's diameter in CSS pixels at `icon-size` 1. */
  static MARKER_PX = 26;

  /** How far into the zoom range the marker shrinks, so a city-scale hospital is a dot, not a badge. */
  static #SIZE_STOPS = [12, 0.6, 16, 1];

  /** Names appear from this zoom; below it the glyph alone marks the place. */
  static #NAME_ZOOM = 16;

  #map;
  #categories;
  #layers = [];
  #tooltip;
  #tooltipHtml;
  #onSelect;
  #visible = true;
  /** The enabled category ids, or null for every category. */
  #enabled = null;
  /** The last collection drawn, kept so a basemap swap can redraw it, and buffered until the icons are ready. */
  #data = { type: 'FeatureCollection', features: [] };
  /** The marker under the pointer, as `{source, id}` for feature-state, or null. */
  #hovered = null;
  #mounted = false;

  /**
   * Resolves once the icons are drawn and the layers exist; `setData` before then is buffered, not lost.
   * @type {Promise<void>}
   */
  ready;

  /**
   * @param {mapboxgl.Map} map - A loaded Mapbox map.
   * @param {object} options - Data and callbacks.
   * @param {Array<string>} options.categories - The category ids, in the backend's order.
   * @param {Function} options.tooltipHtml - Called with a place's `properties`; returns tooltip HTML or null.
   * @param {Function} options.onSelect - Called with a place's `properties` on a click.
   */
  constructor(map, { categories, tooltipHtml, onSelect }) {
    this.#map = map;
    this.#categories = categories;
    this.#tooltipHtml = tooltipHtml;
    this.#onSelect = onSelect;
    this.#tooltip = new mapboxgl.Popup({
      closeButton: false, closeOnClick: false, focusAfterOpen: false, className: 'acs-tooltip', maxWidth: '280px',
    });
    this.ready = this.#mount();
  }

  /**
   * The presentation of a category: its own row, or the default for one this file does not know.
   * @param {string} category - A category id.
   * @returns {{icon: string, minZoom: number}} The glyph file and the zoom it appears at.
   */
  static presentation(category) {
    return AccessScorePlacesLayer.PRESENTATION[category] ?? AccessScorePlacesLayer.DEFAULT_PRESENTATION;
  }

  /**
   * Draws one category's marker: the glyph on a disc in the place-marker color with a halo, at 2× for crisp
   * rendering on dense screens. A static so a test can stand in for it, since jsdom has neither image loading
   * nor a canvas.
   *
   * @param {string} iconUrl - The glyph's asset URL.
   * @param {{fill: string, halo: string}} colors - The disc's fill and its halo.
   * @returns {Promise<ImageData>} The marker's pixels, `MARKER_PX` wide at 2×.
   */
  static async rasterize(iconUrl, colors) {
    const scale = 2;
    const size = AccessScorePlacesLayer.MARKER_PX * scale;
    const glyph = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`AccessScore: could not load the place icon ${iconUrl}`));
      img.src = iconUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const center = size / 2;
    const halo = 1.5 * scale;
    ctx.beginPath();
    ctx.arc(center, center, center - halo / 2, 0, Math.PI * 2);
    ctx.fillStyle = colors.fill;
    ctx.fill();
    ctx.lineWidth = halo;
    ctx.strokeStyle = colors.halo;
    ctx.stroke();
    // The glyph takes 60% of the disc: Lucide's 24-unit grid has a 2-unit margin of its own.
    const glyphSize = size * 0.6;
    ctx.drawImage(glyph, center - glyphSize / 2, center - glyphSize / 2, glyphSize, glyphSize);
    // ImageData rather than the canvas itself: Mapbox reads `data` off what it is given and a canvas has none.
    return ctx.getImageData(0, 0, size, size);
  }

  /**
   * Replaces the places drawn, per category. Categories absent from the collection are emptied rather than left
   * stale. Before the layers exist the collection is kept and drawn once they do.
   * @param {object} featureCollection - A `/v3/api/places` GeoJSON response.
   */
  setData(featureCollection) {
    this.#data = featureCollection;
    if (!this.#mounted) return;
    const byCategory = Object.fromEntries(this.#categories.map((c) => [c, []]));
    for (const feature of featureCollection.features || []) {
      byCategory[feature.properties.category]?.push(feature);
    }
    for (const category of this.#categories) {
      this.#map.getSource(AccessScorePlacesLayer.#layerId(category))
        .setData({ type: 'FeatureCollection', features: byCategory[category] });
    }
  }

  /**
   * How many places each category holds in the last collection, for the sidebar's count badges.
   * @returns {Record<string, number>} Count per category id (zero for an empty one).
   */
  counts() {
    const counts = Object.fromEntries(this.#categories.map((c) => [c, 0]));
    for (const feature of this.#data.features || []) {
      if (feature.properties.category in counts) counts[feature.properties.category] += 1;
    }
    return counts;
  }

  /**
   * The place drawn nearest a point, if one is within `radiusM`: how a shared link's `place` param finds its marker.
   * @param {{lat: number, lng: number}} point - Where to look.
   * @param {number} [radiusM=5] - How far a marker may sit from the point and still be it.
   * @returns {?object} The place's `properties`, or null.
   */
  placeNear(point, radiusM = 5) {
    const metersPerDegLat = 111320;
    const metersPerDegLng = metersPerDegLat * Math.cos((point.lat * Math.PI) / 180);
    let best = null;
    let bestDistance = radiusM;
    for (const feature of this.#data.features || []) {
      const [lng, lat] = feature.geometry.coordinates;
      const distance = Math.hypot((lat - point.lat) * metersPerDegLat, (lng - point.lng) * metersPerDegLng);
      if (distance <= bestDistance) {
        best = feature.properties;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * A place by id, from the last collection.
   * @param {number} placeId - The place's id.
   * @returns {?object} Its `properties` plus `lngLat`, or null.
   */
  place(placeId) {
    const feature = (this.#data.features || []).find((f) => f.properties.place_id === placeId);
    if (!feature) return null;
    const [lng, lat] = feature.geometry.coordinates;
    return { ...feature.properties, lngLat: { lng, lat } };
  }

  /**
   * Rebuilds the images, sources and layers after a `map.setStyle`, with the last data and the visibility in force.
   * The pointer handlers are keyed by layer id and survive the swap, so they are not bound again.
   * @returns {Promise<void>} Resolves once the markers are back.
   */
  async remount() {
    this.#hovered = null;
    this.#tooltip.remove();
    this.#mounted = false;
    for (const id of this.#layers) {
      if (this.#map.getLayer(id)) this.#map.removeLayer(id);
      if (this.#map.getSource(id)) this.#map.removeSource(id);
    }
    // A style swap discards the images; the ids are the same strings, so the handlers keep matching.
    await this.#addImages();
    for (const category of this.#categories) this.#addLayer(category);
    this.#mounted = true;
    this.setData(this.#data);
    this.#applyVisibility();
  }

  /**
   * Shows or hides every place layer.
   * @param {boolean} visible - True to draw them.
   */
  setVisible(visible) {
    this.#visible = visible;
    this.#applyVisibility();
    if (!visible) this.#clearHover();
  }

  /**
   * Restricts the drawn categories.
   * @param {?Array<string>} categories - The category ids to draw, or null for all of them.
   */
  setCategories(categories) {
    this.#enabled = categories === null ? null : new Set(categories);
    this.#applyVisibility();
    this.#clearHover();
  }

  /**
   * The lowest zoom at which any enabled category is drawn, so the sidebar can say "zoom in" only while nothing
   * enabled can show.
   * @returns {number} A zoom level; Infinity when no category is enabled.
   */
  lowestVisibleZoom() {
    let lowest = Infinity;
    for (const category of this.#categories) {
      if (this.#isEnabled(category)) {
        lowest = Math.min(lowest, AccessScorePlacesLayer.presentation(category).minZoom);
      }
    }
    return lowest;
  }

  /**
   * Whether a place sits under a pointer event — the map's street/region tooltip yields to this one, and a click
   * on a marker must not also select the street beneath it.
   * @param {object} e - A Mapbox pointer event.
   * @returns {boolean} True when a visible place is under the pointer.
   */
  claims(e) {
    if (!this.#visible || !this.#mounted) return false;
    return this.#map.queryRenderedFeatures(e.point, { layers: this.#layers }).length > 0;
  }

  async #mount() {
    await this.#addImages();
    for (const category of this.#categories) this.#layers.push(this.#addLayer(category));
    this.#addInteractions();
    this.#mounted = true;
    this.setData(this.#data);
    this.#applyVisibility();
  }

  /** Draws every category's marker into the map's image store, so its symbol layer can name it. */
  async #addImages() {
    const colors = {
      fill: AccessScorePlacesLayer.#token('--color-place-marker'),
      halo: AccessScorePlacesLayer.#token('--color-place-marker-halo'),
    };
    await Promise.all(this.#categories.map(async (category) => {
      const id = AccessScorePlacesLayer.#imageId(category);
      const icon = util.assetPath(`images/icons/${AccessScorePlacesLayer.presentation(category).icon}`);
      const pixels = await AccessScorePlacesLayer.rasterize(icon, colors);
      if (this.#map.hasImage(id)) this.#map.removeImage(id);
      this.#map.addImage(id, pixels, { pixelRatio: 2 });
    }));
  }

  /** One source + symbol layer for a category, gated at the category's zoom and named from `NAME_ZOOM`. */
  #addLayer(category) {
    const id = AccessScorePlacesLayer.#layerId(category);
    this.#map.addSource(id, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      promoteId: 'place_id',
    });
    const hovered = ['boolean', ['feature-state', 'hover'], false];
    this.#map.addLayer({
      id,
      type: 'symbol',
      source: id,
      minzoom: AccessScorePlacesLayer.presentation(category).minZoom,
      layout: {
        'visibility': this.#isDrawn(category) ? 'visible' : 'none',
        'icon-image': AccessScorePlacesLayer.#imageId(category),
        'icon-size': ['interpolate', ['linear'], ['zoom'], ...AccessScorePlacesLayer.#SIZE_STOPS],
        'icon-allow-overlap': false,
        'text-field': ['step', ['zoom'], '', AccessScorePlacesLayer.#NAME_ZOOM, ['coalesce', ['get', 'name'], '']],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 1.1],
        'text-max-width': 12,
        // The glyph is the marker; a name that would collide is dropped rather than the whole place.
        'text-optional': true,
      },
      paint: {
        'icon-opacity': ['case', hovered, 1, 0.92],
        'text-color': AccessScorePlacesLayer.#token('--color-place-marker'),
        'text-halo-color': AccessScorePlacesLayer.#token('--color-place-marker-halo'),
        'text-halo-width': 1.2,
      },
    });
    return id;
  }

  #applyVisibility() {
    if (!this.#mounted) return;
    for (const category of this.#categories) {
      this.#map.setLayoutProperty(
        AccessScorePlacesLayer.#layerId(category), 'visibility', this.#isDrawn(category) ? 'visible' : 'none',
      );
    }
  }

  #isEnabled(category) {
    return this.#enabled === null || this.#enabled.has(category);
  }

  #isDrawn(category) {
    return this.#visible && this.#isEnabled(category);
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
      const html = this.#tooltipHtml(feature.properties);
      if (html) this.#tooltip.setLngLat(e.lngLat).setHTML(html).addTo(this.#map);
    });
    this.#map.on('mouseleave', this.#layers, () => this.#clearHover());
    this.#map.on('click', this.#layers, (e) => {
      if (!this.#visible || !e.features.length) return;
      // The street or region under the marker keeps its selection; AccessScoreMapView checks defaultPrevented.
      e.preventDefault();
      const feature = e.features[0];
      const [lng, lat] = feature.geometry.coordinates;
      this.#onSelect({ ...feature.properties, lngLat: { lng, lat } });
    });
  }

  #clearHover() {
    if (this.#hovered) this.#map.setFeatureState(this.#hovered, { hover: false });
    this.#hovered = null;
    this.#tooltip.remove();
    this.#map.getCanvas().style.cursor = '';
  }

  /** A main.css color token's value. */
  static #token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  static #layerId(category) {
    return `acs-places-${category}`;
  }

  static #imageId(category) {
    return `acs-place-${category}`;
  }
}

/**
 * The places the AccessScore map shows beside the scores (#5311): schools, health care, libraries, grocery stores,
 * transit stops, parks, community centers, and government offices, one Mapbox symbol layer per category, fed by
 * `/v3/api/places`.
 *
 * The categories come from the backend (`place_categories` on `/v3/api/accessScoreConfig`); what this class holds
 * is presentation only — which glyph each category wears. A marker is a disc in the score color of the nearest
 * street with the category's glyph on it, so a school on a red block reads at a glance, before the card opens.
 * A symbol's image is a layout property, which unlike the streets' paint cannot read feature-state, so the discs
 * are drawn once per score bin (the histogram's, so a marker matches the bar it would fall under) and each place
 * carries its bin as a property; a reweighting restamps the bins and re-uploads the points. The glyph is white or
 * the marker ink, whichever contrasts better with the disc: the ramp's yellow middle would swallow a white glyph.
 * Mapbox's own collision detection thins the markers where they crowd (a big city has thousands of bus stops),
 * which is why these are symbols rather than circles.
 *
 * Presentation only: it takes a FeatureCollection and a `binOf` callback and hands hover and click back to the
 * page, which owns the model and the place card.
 */
class AccessScorePlacesLayer {
  /** The marker disc's diameter in CSS pixels at `icon-size` 1. */
  static MARKER_PX = 26;

  /** The `score_bin` a place without a scored street carries, and the suffix of the disc it wears. */
  static NO_BIN = 'none';

  /**
   * The disc of a place with no scored street within reach: the map's unaudited-street color per surface, so the
   * marker reads as the street it sits on (AccessScoreMapView's `streetNone`), not as a low score.
   */
  static #NONE_TOKENS = Object.freeze({ light: '--color-neutral-700', dark: '--color-neutral-400' });

  /**
   * WCAG 2 relative luminance of a `#rrggbb` color, for picking the glyph that contrasts with a disc.
   * @param {string} hex - The color.
   * @returns {number} Luminance in [0, 1].
   */
  static luminance(hex) {
    const h = hex.trim().replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const [r, g, b] = [0, 2, 4].map((i) => {
      const c = parseInt(full.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /**
   * Which of two inks contrasts more with a disc, by WCAG contrast ratio.
   * @param {string} fill - The disc color, `#rrggbb`.
   * @param {string} light - The light ink (white).
   * @param {string} dark - The dark ink.
   * @returns {string} `light` or `dark`.
   */
  static glyphColorFor(fill, light, dark) {
    const contrast = (a, b) => {
      const [hi, lo] = [AccessScorePlacesLayer.luminance(a), AccessScorePlacesLayer.luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    return contrast(fill, light) >= contrast(fill, dark) ? light : dark;
  }

  /** How far into the zoom range the marker shrinks, so a city-scale hospital is a dot, not a badge. */
  static #SIZE_STOPS = [12, 0.6, 16, 1];

  /** Names appear from this zoom; below it the glyph alone marks the place. */
  static #NAME_ZOOM = 16;

  /**
   * The collision priority: a named place before an unnamed one (lower draws first). `has` would count a `null`
   * name as present, so the test is on the coalesced string.
   */
  static SORT_KEY = Object.freeze(['case', ['to-boolean', ['coalesce', ['get', 'name'], '']], 0, 1]);

  #map;
  #categories;
  #bins;
  #binOf;
  #dark;
  #layers = [];
  /** The pending animation frame of a `rescore`, so a slider drag restamps once per frame however it fires. */
  #frame = null;
  #tooltip;
  #tooltipHtml;
  #onSelect;
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
   * @param {number} [options.bins=1] - How many score bins the discs are drawn at (the model's histogram bins).
   * @param {Function} [options.binOf] - Called with a place's `properties`; returns its nearest street's bin in
   *   `[0, bins)`, or null for no scored street. Without it every marker wears the no-score disc.
   * @param {boolean} [options.dark=false] - Whether the basemap is dark, which picks the ramp's dark stepping.
   */
  constructor(map, { categories, tooltipHtml, onSelect, bins = 1, binOf = () => null, dark = false }) {
    this.#map = map;
    this.#categories = categories;
    this.#bins = bins;
    this.#binOf = binOf;
    this.#dark = dark;
    this.#tooltipHtml = tooltipHtml;
    this.#onSelect = onSelect;
    this.#tooltip = new mapboxgl.Popup({
      closeButton: false, closeOnClick: false, focusAfterOpen: false, className: 'acs-tooltip', maxWidth: '280px',
    });
    this.ready = this.#mount();
  }

  /**
   * The presentation of a category. No zoom gate: every category starts off, so one that is on was asked for, and a
   * reader who ticks "Transit stops" at city scale should see stops, not an empty map. Collision detection keeps a
   * crowded category to what fits.
   * @param {string} category - A category id.
   * @returns {{icon: string}} The glyph file, shared with the Explore minimap (PlaceCategoryIcons).
   */
  static presentation(category) {
    return { icon: PlaceCategoryIcons.file(category) };
  }

  /**
   * Loads a category's glyph once, for every disc it is drawn on. A static so a test can stand in for it, since
   * jsdom has no image loading.
   * @param {string} iconUrl - The glyph's asset URL.
   * @returns {Promise<HTMLImageElement>} The decoded glyph.
   */
  static loadGlyph(iconUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`AccessScore: could not load the place icon ${iconUrl}`));
      img.src = iconUrl;
    });
  }

  /**
   * Draws one marker: the glyph, tinted, on a disc with a halo, at 2× for crisp rendering on dense screens. A
   * static so a test can stand in for it, since jsdom has no canvas.
   *
   * @param {HTMLImageElement} glyph - The category's glyph, as `loadGlyph` gives it (drawn white).
   * @param {{fill: string, halo: string, glyph: string}} colors - The disc's fill, its halo, and the glyph's ink.
   * @returns {ImageData} The marker's pixels, `MARKER_PX` wide at 2×.
   */
  static rasterize(glyph, colors) {
    const scale = 2;
    const size = AccessScorePlacesLayer.MARKER_PX * scale;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const center = size / 2;
    const halo = 1.5 * scale;
    // The glyph takes 60% of the disc: Lucide's 24-unit grid has a 2-unit margin of its own. It is tinted on its
    // own canvas first (`source-in` keeps only the glyph's pixels, in the new color) so the disc is untouched.
    const glyphSize = size * 0.6;
    const ink = document.createElement('canvas');
    ink.width = size;
    ink.height = size;
    const inkCtx = ink.getContext('2d');
    inkCtx.drawImage(glyph, center - glyphSize / 2, center - glyphSize / 2, glyphSize, glyphSize);
    inkCtx.globalCompositeOperation = 'source-in';
    inkCtx.fillStyle = colors.glyph;
    inkCtx.fillRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(center, center, center - halo / 2, 0, Math.PI * 2);
    ctx.fillStyle = colors.fill;
    ctx.fill();
    ctx.lineWidth = halo;
    ctx.strokeStyle = colors.halo;
    ctx.stroke();
    ctx.drawImage(ink, 0, 0);
    // ImageData rather than the canvas itself: Mapbox reads `data` off what it is given and a canvas has none.
    return ctx.getImageData(0, 0, size, size);
  }

  /**
   * The disc colors per score bin for a surface, worst first, then the no-score disc: what `rasterize` paints and
   * what a legend would swatch. Each bin takes the ramp at its center, so a marker sits between the colors of the
   * streets at the bin's edges rather than at one of them.
   * @param {number} bins - How many score bins.
   * @param {boolean} dark - Whether the basemap is dark.
   * @returns {Array<string>} `bins + 1` hex colors.
   */
  static discColors(bins, dark) {
    const mode = dark ? 'dark' : 'light';
    const ramp = Array.from({ length: bins }, (_, i) => ScoreRamp.at((i + 0.5) / bins, { mode }));
    return [...ramp, AccessScorePlacesLayer.#token(AccessScorePlacesLayer.#NONE_TOKENS[mode])];
  }

  /**
   * Replaces the places drawn, per category. Categories absent from the collection are emptied rather than left
   * stale. Before the layers exist the collection is kept and drawn once they do. Each feature's properties get a
   * `score_bin` (written in place: a copy per place per slider frame would be the cost that matters).
   * @param {GeoJSON.FeatureCollection} featureCollection - A `/v3/api/places` GeoJSON response.
   */
  setData(featureCollection) {
    this.#data = featureCollection;
    this.#draw();
  }

  /**
   * Restamps every place's `score_bin` from `binOf` and redraws, once per animation frame: how the discs follow
   * the weight sliders. A no-op before the layers exist, since the mount draws with fresh bins.
   */
  rescore() {
    if (!this.#mounted || this.#frame !== null) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      this.#draw();
    });
  }

  /**
   * Switches the discs to the ramp's stepping for a dark or light basemap; takes effect at the next `remount`,
   * which the basemap swap triggers anyway.
   * @param {boolean} dark - Whether the basemap is dark.
   */
  setDark(dark) {
    this.#dark = dark;
  }

  /** Stamps the bins and uploads each category's places to its source. */
  #draw() {
    if (!this.#mounted) return;
    const byCategory = Object.fromEntries(this.#categories.map((c) => [c, []]));
    for (const feature of this.#data.features || []) {
      const bin = this.#binOf(feature.properties);
      feature.properties.score_bin = bin === null || bin === undefined ? AccessScorePlacesLayer.NO_BIN : String(bin);
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
   * @returns {?Record<string, any>} The place's `properties`, or null.
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
    this.#draw();
    this.#applyVisibility();
  }

  /**
   * Restricts the drawn categories.
   * @param {?Array<string>} categories - The category ids to draw, null for all of them, an empty list for none.
   */
  setCategories(categories) {
    this.#enabled = categories === null ? null : new Set(categories);
    this.#applyVisibility();
    this.#clearHover();
  }

  /**
   * Whether a place sits under a pointer event — the map's street/region tooltip yields to this one, and a click
   * on a marker must not also select the street beneath it.
   * @param {mapboxgl.MapMouseEvent} e - A Mapbox pointer event.
   * @returns {boolean} True when a visible place is under the pointer.
   */
  claims(e) {
    if (!this.#mounted) return false;
    return this.#map.queryRenderedFeatures(e.point, { layers: this.#layers }).length > 0;
  }

  async #mount() {
    await this.#addImages();
    for (const category of this.#categories) this.#layers.push(this.#addLayer(category));
    this.#addInteractions();
    this.#mounted = true;
    this.#draw();
    this.#applyVisibility();
  }

  /**
   * Draws every category's marker, one per score bin plus the no-score disc, into the map's image store, so its
   * symbol layer can name them by bin.
   */
  async #addImages() {
    const halo = AccessScorePlacesLayer.#token('--color-place-marker-halo');
    const inkLight = AccessScorePlacesLayer.#token('--color-neutral-white');
    const inkDark = AccessScorePlacesLayer.#token('--color-place-marker');
    const fills = AccessScorePlacesLayer.discColors(this.#bins, this.#dark);
    const suffixes = [...fills.keys()].map((i) => (i < this.#bins ? String(i) : AccessScorePlacesLayer.NO_BIN));
    await Promise.all(this.#categories.map(async (category) => {
      const icon = util.assetPath(`images/icons/${AccessScorePlacesLayer.presentation(category).icon}`);
      const glyph = await AccessScorePlacesLayer.loadGlyph(icon);
      fills.forEach((fill, i) => {
        const id = AccessScorePlacesLayer.#imageId(category, suffixes[i]);
        const pixels = AccessScorePlacesLayer.rasterize(glyph, {
          fill, halo, glyph: AccessScorePlacesLayer.glyphColorFor(fill, inkLight, inkDark),
        });
        if (this.#map.hasImage(id)) this.#map.removeImage(id);
        this.#map.addImage(id, pixels, { pixelRatio: 2 });
      });
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
      layout: {
        'visibility': this.#isEnabled(category) ? 'visible' : 'none',
        // The disc for the place's score bin; a place the page has not stamped wears the no-score disc.
        'icon-image': ['concat', AccessScorePlacesLayer.#imageId(category, ''),
          ['coalesce', ['get', 'score_bin'], AccessScorePlacesLayer.NO_BIN]],
        'icon-size': ['interpolate', ['linear'], ['zoom'], ...AccessScorePlacesLayer.#SIZE_STOPS],
        'icon-allow-overlap': false,
        // Named places win collisions: where markers crowd, the named park is drawn and the unnamed playground
        // inside it is what gets thinned, not the other way round.
        'symbol-sort-key': AccessScorePlacesLayer.SORT_KEY,
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
        AccessScorePlacesLayer.#layerId(category), 'visibility', this.#isEnabled(category) ? 'visible' : 'none',
      );
    }
  }

  #isEnabled(category) {
    return this.#enabled === null || this.#enabled.has(category);
  }

  #addInteractions() {
    this.#map.on('mousemove', this.#layers, (e) => {
      if (!e.features.length) return;
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
      if (!e.features.length) return;
      // The street or region under the marker is not what was clicked: AccessScoreMapView asks `claims` before it
      // selects one. Its bare-map handler was registered first, so it runs before this and clears any selection —
      // which is the page's "one card at a time" rule anyway. `preventDefault` marks the click handled for the rest.
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

  /** The image id of a category's disc for a bin suffix (`'3'`, `NO_BIN`, or `''` for the prefix alone). */
  static #imageId(category, suffix) {
    return `acs-place-${category}-${suffix}`;
  }
}

/**
 * Shared Mapbox GL helpers for the API docs preview maps.
 *
 * Building the map, layering chips and legends over it, and reading GeoJSON properties back off a rendered feature
 * live here. Data fetching, colors, and popup content belong to each page's own `*Preview.js`.
 *
 * @requires mapbox-gl, mapbox-gl-language, i18next
 */

window.ApiDocsMap = (function () {
  // Our own Studio style, as used by RouteBuilder and the route thumbnails. `?optimize=true` strips what the style
  // doesn't draw out of the tiles, which holds up as long as nothing here queries or re-filters a basemap layer.
  const STYLE_PROJECT_SIDEWALK = 'mapbox://styles/projectsidewalk/cloov4big002801rc0qw75w5g?optimize=true';

  // The preview layers are small dots over a busy street grid, so the basemap is knocked back behind them.
  const BASEMAP_DIM_OPACITY = 0.5;

  // ColorBrewer RdYlGn: low accessibility is red and high is green, as in the paper the score comes from.
  const ACCESS_SCORE_RAMP = ['#d7191c', '#fdae61', '#ffffbf', '#a6d96a', '#1a9641'];

  /**
   * Builds a Mapbox map in the given container and resolves once it has loaded.
   *
   * @param {object} options - Map options.
   * @param {HTMLElement|string} options.container - Map container element, or its element ID.
   * @param {string} options.mapboxApiKey - Mapbox access token.
   * @param {string} [options.style=STYLE_PROJECT_SIDEWALK] - Mapbox style URL.
   * @param {object} [options.bounds] - mapboxgl.LngLatBounds to frame the initial view on.
   * @param {number} [options.fitPadding] - Pixels of padding left around `bounds`. Defaults to a share of the map's
   *                                        width, capped at 75.
   * @param {Array<number>} [options.center] - Initial center as [lng, lat]. Used only when `bounds` is omitted.
   * @param {number} [options.zoom] - Initial zoom. Used only when `bounds` is omitted.
   * @param {number} [options.dim=BASEMAP_DIM_OPACITY] - Basemap dimming, 0 (none) to 1 (black).
   * @returns {Promise<object>} Resolves with the Mapbox map once it has loaded and been dimmed.
   */
  function create(options) {
    mapboxgl.accessToken = options.mapboxApiKey;
    const element = typeof options.container === 'string'
      ? document.getElementById(options.container)
      : options.container;
    // A share of the map's own width, because a flat 75px is breathing room on a desktop map and most of a phone.
    const fitPadding = options.fitPadding ?? Math.min(75, Math.round(element.clientWidth * 0.12));

    const map = new mapboxgl.Map({
      container: element,
      style: options.style || STYLE_PROJECT_SIDEWALK,
      // Framed at construction rather than by a fitBounds() after load, so the reader never sees the map land
      // somewhere else first and then jump. Mapbox fits at fractional zoom, so the padding is the only slack.
      ...(options.bounds
        ? { bounds: options.bounds, fitBoundsOptions: { padding: fitPadding } }
        : { center: options.center, zoom: options.zoom }),
      // These maps sit mid-article, so wheel-zoom would swallow the scroll of anyone reading past them.
      scrollZoom: false,
      // The touch counterpart: two fingers to pan instead of one.
      cooperativeGestures: true,
      locale: { 'TouchPanBlocker.Message': i18next.t('common:map-two-finger-pan') },
      // Bottom-left is the legend's, so the logo joins the attribution on the right.
      logoPosition: 'bottom-right',
      attributionControl: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-left');
    map.addControl(new MapboxLanguage({ defaultLanguage: i18next.t('common:mapbox-language-code') }));

    return new Promise((resolve) => {
      const finish = () => {
        // Dimmed before the promise resolves, so every layer a caller adds afterwards lands on top of the scrim.
        const dim = options.dim ?? BASEMAP_DIM_OPACITY;
        if (dim > 0) {
          // A `background` layer covers the viewport at any zoom without an extra source, and has no antimeridian
          // or pole edge cases to get wrong.
          map.addLayer({
            id: 'basemap-dim',
            type: 'background',
            paint: { 'background-color': '#000000', 'background-opacity': dim },
          });
        }
        resolve(map);
      };
      if (map.loaded()) finish();
      else map.on('load', finish);
    });
  }

  /**
   * Layers an element over the map in one of its four control corners, returning it so callers can fill and refill
   * it as data arrives.
   *
   * @param {object} map - The Mapbox map.
   * @param {string} position - 'top-left', 'top-right', 'bottom-left', or 'bottom-right'.
   * @param {string} className - Class(es) to style the overlay with.
   * @returns {HTMLElement} The overlay element, already added to the map.
   */
  function addOverlay(map, position, className) {
    const element = document.createElement('div');
    // mapboxgl-ctrl gives the overlay the same margins and pointer handling as the map's built-in controls.
    element.className = `mapboxgl-ctrl ${className}`;
    map.addControl({ onAdd: () => element, onRemove: () => element.remove() }, position);
    return element;
  }

  /**
   * Opens a popup carrying the shared `.map-popup` styling.
   *
   * @param {object} map - The Mapbox map.
   * @param {object|Array<number>} lngLat - Where to anchor the popup.
   * @param {string} html - The popup's contents.
   * @returns {object} The opened mapboxgl.Popup.
   */
  function popup(map, lngLat, html) {
    return new mapboxgl.Popup({
      // Lands on the popup root, so the stylesheet can reach Mapbox's frame and our content through the one class.
      className: 'map-popup',
      // Any truthy maxWidth is written onto the frame as an inline style that no stylesheet rule can outrank — the
      // documented 'none' included. Falsy leaves the width to CSS, where the rest of the popup's styling lives.
      maxWidth: '',
      focusAfterOpen: false,
    })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(map);
  }

  /**
   * Returns the bounds enclosing a GeoJSON geometry, whatever its nesting depth (point through multi-polygon).
   *
   * @param {object} geometry - The GeoJSON geometry.
   * @returns {object} mapboxgl.LngLatBounds covering every coordinate in it.
   */
  function geometryBounds(geometry) {
    const bounds = new mapboxgl.LngLatBounds();
    const extend = (coords) => {
      if (typeof coords[0] === 'number') bounds.extend(coords);
      else coords.forEach(extend);
    };
    extend(geometry.coordinates);
    return bounds;
  }

  /**
   * Returns the bounds enclosing every feature in a GeoJSON FeatureCollection.
   *
   * @param {Array<object>} features - The collection's features.
   * @returns {object} mapboxgl.LngLatBounds covering all of them.
   */
  function featureCollectionBounds(features) {
    const bounds = new mapboxgl.LngLatBounds();
    features.forEach((feature) => bounds.extend(geometryBounds(feature.geometry)));
    return bounds;
  }

  /**
   * Reads a property off a rendered map feature, undoing Mapbox's flattening of non-scalar values.
   *
   * Mapbox GL carries only strings, numbers, and booleans through its feature pipeline, so an array or object in the
   * source GeoJSON (a label's `tags`) arrives on `e.features[].properties` as a JSON *string* — which reads back as
   * the string's characters rather than the array's, and looks fine until a popup renders `[` as its first tag.
   *
   * @param {object} properties - The `properties` object from a rendered feature.
   * @param {string} name - Property name.
   * @returns {*} The value, parsed back into an array/object where Mapbox stringified one.
   */
  function featureProp(properties, name) {
    const value = properties[name];
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return value;
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  /**
   * Fetches JSON from one of our API endpoints, tagging the request as coming from the docs.
   *
   * @param {string} url - Endpoint URL, without the utm_source marker.
   * @returns {Promise<object>} The parsed response body.
   */
  async function fetchJson(url) {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}utm_source=apiDocs`);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Builds a Mapbox `match` expression that colors a feature by its label type.
   *
   * @param {object} labelTypeInfo - Map of label type name to `{color, description}`, from /v3/api/labelTypes.
   * @param {string} [property=label_type] - Feature property holding the label type name.
   * @returns {Array} A Mapbox expression usable as a `circle-color` / `line-color` paint value.
   */
  function labelTypeColorExpression(labelTypeInfo, property = 'label_type') {
    const expression = ['match', ['get', property]];
    Object.entries(labelTypeInfo).forEach(([name, info]) => expression.push(name, info.color));
    // Mapbox requires a fallback, and a type the API knows about but this page's palette doesn't should still draw.
    expression.push('#999999');
    return expression;
  }

  /**
   * Builds a Mapbox `interpolate` expression that colors a feature by a numeric property.
   *
   * @param {string} property - Feature property holding the value.
   * @param {Array<string>} ramp - Colors, from the low end of the domain to the high end.
   * @param {object} [options] - Domain and empty-value handling.
   * @param {number} [options.min=0] - Value mapped to the first ramp color.
   * @param {number} [options.max=1] - Value mapped to the last ramp color.
   * @param {string} [options.noneColor=#3d3d3d] - Color for features carrying no value.
   * @param {number} [options.noneAtOrBelow] - Values at or below this get `noneColor` too. Defaults to nulls only.
   * @returns {Array} A Mapbox expression usable as a `fill-color` / `line-color` paint value.
   */
  function gradientColorExpression(property, ramp, options = {}) {
    const { min = 0, max = 1, noneColor = '#3d3d3d' } = options;
    // A null would make `interpolate` throw, so missing values fold to a sentinel the `case` ahead of it catches.
    const sentinel = min - 1;
    const value = ['coalesce', ['get', property], sentinel];
    // Every feature sharing one value — a city with no labels yet — would otherwise collapse the domain to zero.
    const span = max > min ? max - min : 1;
    const stops = ramp.flatMap((color, i) => [min + (span * i) / (ramp.length - 1), color]);
    return [
      'case',
      ['<=', value, options.noneAtOrBelow ?? sentinel], noneColor,
      ['interpolate', ['linear'], value, ...stops],
    ];
  }

  /**
   * Wraps a pair of paint values so the first applies while the feature is hovered. Needs `addHoverState` on the
   * layer to have anything to read.
   *
   * @param {*} hovered - Value while hovered.
   * @param {*} normal - Value otherwise.
   * @returns {Array} A Mapbox expression usable as a paint value.
   */
  function whenHovered(hovered, normal) {
    return ['case', ['boolean', ['feature-state', 'hover'], false], hovered, normal];
  }

  /**
   * Tracks which of a layer's features the pointer is over as Mapbox feature-state, so `whenHovered` paint values
   * respond to it. Feature-state is keyed by feature id, so the layer's source needs a `promoteId`.
   *
   * @param {object} map - The Mapbox map.
   * @param {string} layerId - Layer to track hover on.
   * @param {string} sourceId - Source backing that layer.
   */
  function addHoverState(map, layerId, sourceId) {
    let hoveredId = null;
    const clearHover = () => {
      if (hoveredId !== null) map.setFeatureState({ source: sourceId, id: hoveredId }, { hover: false });
      hoveredId = null;
    };
    map.on('mousemove', layerId, (e) => {
      if (!e.features.length || e.features[0].id === hoveredId) return;
      clearHover();
      hoveredId = e.features[0].id;
      map.setFeatureState({ source: sourceId, id: hoveredId }, { hover: true });
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', layerId, () => {
      clearHover();
      map.getCanvas().style.cursor = '';
    });
  }

  /**
   * Fills a legend overlay with a continuous color bar, tick labels spread evenly beneath it, and an optional swatch
   * row for the features the ramp doesn't cover.
   *
   * @param {HTMLElement} element - The overlay element to fill.
   * @param {string} title - Legend heading.
   * @param {Array<string>} ramp - The colors passed to the matching `gradientColorExpression`.
   * @param {Array<string>} tickLabels - Labels under the bar, low end first.
   * @param {object} [none] - The `{color, label}` for features with no value, matching `gradientColorExpression`'s
   *                          `noneColor`. Omit when every feature lands somewhere on the ramp.
   */
  function renderGradientLegend(element, title, ramp, tickLabels, none) {
    // A discrete category has no honest position on a continuous bar, so it gets its own row below the ticks.
    const noneRow = none
      ? `<div class="map-legend-item">
           <span class="map-legend-swatch" style="background-color: ${none.color};"></span>
           ${none.label}
         </div>`
      : '';
    element.innerHTML = `
      <h4>${title}</h4>
      <div class="map-legend-gradient"></div>
      <div class="map-legend-ticks">${tickLabels.map((label) => `<span>${label}</span>`).join('')}</div>
      ${noneRow}
    `;
    // The ramp is data, so this one declaration can't live in the stylesheet with the rest of the legend's styling.
    element.querySelector('.map-legend-gradient').style.background = `linear-gradient(to right, ${ramp.join(', ')})`;
  }

  /**
   * Fills a legend overlay with one swatch-and-name row per label type present in the rendered data.
   *
   * @param {HTMLElement} element - The overlay element to fill.
   * @param {string} heading - Legend heading.
   * @param {Array<string>} typeNames - Label type names present in the data.
   * @param {object} labelTypeInfo - Map of label type name to `{color, description}`, from /v3/api/labelTypes.
   * @param {string} emptyMessage - Shown in place of the rows when nothing was rendered.
   */
  function renderLabelTypeLegend(element, heading, typeNames, labelTypeInfo, emptyMessage) {
    const rows = typeNames
      .filter((name) => labelTypeInfo[name])
      .map((name) => `
        <div class="map-legend-item">
          <span class="map-legend-swatch" style="background-color: ${labelTypeInfo[name].color};"></span>
          ${name}
        </div>
      `)
      .join('');
    element.innerHTML = `
      <h4>${heading}</h4>
      ${rows || `<div>${emptyMessage}</div>`}
    `;
  }

  return {
    STYLE_PROJECT_SIDEWALK,
    ACCESS_SCORE_RAMP,
    create,
    popup,
    addOverlay,
    geometryBounds,
    featureCollectionBounds,
    featureProp,
    fetchJson,
    labelTypeColorExpression,
    gradientColorExpression,
    whenHovered,
    addHoverState,
    renderGradientLegend,
    renderLabelTypeLegend,
  };
})();

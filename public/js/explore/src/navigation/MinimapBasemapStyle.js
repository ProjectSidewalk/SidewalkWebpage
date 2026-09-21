/**
 * The Explore minimap's basemap: a MapLibre style object over OpenStreetMap vector tiles (#5429).
 *
 * The style lives in the repo, as code, so the cartography is reviewed like anything else. It is deliberately sparse:
 * the minimap is ~200px and sits under the fog-of-war and FOV overlays, so it draws only what helps a labeler orient —
 * land, water, parks, buildings, roads, rail, and road names. No POI icons, transit, or place labels (#4665), which
 * also means no sprite sheet to host: glyphs are the only style asset fetched.
 *
 * Colors come from the main.css design tokens (via MinimapStyle.token) so the basemap stays in the design system's
 * palette and quiet enough for the route lines and label icons drawn over it to carry the contrast.
 */
class MinimapBasemapStyle {
  // The tile and glyph host. Both URLs must stay on an origin listed in the CSP's connect-src (conf/application.conf),
  // or the browser blocks the fetches and the minimap draws streets and markers over a blank background.
  // OpenFreeMap serves the OpenMapTiles schema; the source-layer and class names below are that schema's, so a
  // different host works unchanged only if it serves the same schema.
  static #TILES_URL = 'https://tiles.openfreemap.org/planet';
  static #GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

  /** Id of the vector source; also how Minimap tells basemap layers from its own. */
  static SOURCE_ID = 'basemap';

  /** Id of the lowest label layer. Minimap inserts its street lines beneath it, so road names draw over them. */
  static FIRST_LABEL_LAYER_ID = 'road-name-minor';

  static #MAJOR_ROADS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
  static #MINOR_ROADS = ['minor', 'service', 'track'];

  /**
   * A filter matching line features of the transportation layer in the given classes.
   * @param {string[]} classes - OpenMapTiles transportation classes.
   * @returns {Array} A MapLibre filter expression.
   */
  static #roadFilter(classes) {
    return ['all',
      ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
      ['match', ['get', 'class'], classes, true, false],
    ];
  }

  /**
   * A line width that grows with zoom the way a real road does, so streets keep their relative weight from the
   * route overview (z12) to the closest street view (z20).
   * @param {number} atZoom13 - Width in px at zoom 13.
   * @param {number} atZoom20 - Width in px at zoom 20.
   * @returns {Array} A MapLibre interpolate expression.
   */
  static #roadWidth(atZoom13, atZoom20) {
    return ['interpolate', ['exponential', 1.5], ['zoom'], 13, atZoom13, 20, atZoom20];
  }

  /**
   * One basemap layer. Exists so layer specs can use plain keys: 'source-layer' is the one key that needs quoting,
   * and the lint rule would then want every key beside it quoted too.
   * @param {string} id - Layer id.
   * @param {string} type - MapLibre layer type.
   * @param {string} sourceLayer - The OpenMapTiles layer to draw from.
   * @param {object} spec - The rest of the layer: filter, layout, paint.
   * @returns {object} A MapLibre layer specification.
   */
  static #layer(id, type, sourceLayer, spec) {
    const layer = { id, type, source: MinimapBasemapStyle.SOURCE_ID, ...spec };
    layer['source-layer'] = sourceLayer;
    return layer;
  }

  /**
   * One road-name label layer.
   * @param {string} id - Layer id.
   * @param {string[]} classes - OpenMapTiles transportation classes to label.
   * @param {number} size - Text size in px.
   * @returns {object} A MapLibre symbol layer.
   */
  static #roadNameLayer(id, classes, size) {
    return MinimapBasemapStyle.#layer(id, 'symbol', 'transportation_name', {
      filter: MinimapBasemapStyle.#roadFilter(classes),
      layout: {
        'symbol-placement': 'line',
        // The street's local name, whatever the UI language: labelers match it against the street sign in the image.
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': size,
        // The map is small and never rotates, so repeat names often enough that one is usually in view.
        'symbol-spacing': 150,
        'text-rotation-alignment': 'map',
      },
      paint: {
        'text-color': MinimapStyle.token('--color-asphalt-300', '#615E78'),
        'text-halo-color': MinimapStyle.token('--color-neutral-white', '#FFFFFF'),
        'text-halo-width': 1.5,
      },
    });
  }

  /**
   * Builds the style. Called once, at minimap creation, after main.css has loaded (the tokens are read here).
   * @returns {object} A MapLibre style specification.
   */
  static build() {
    const token = MinimapStyle.token;
    const layer = MinimapBasemapStyle.#layer;
    const roadFilter = MinimapBasemapStyle.#roadFilter;
    const roadWidth = MinimapBasemapStyle.#roadWidth;
    const roadNameLayer = MinimapBasemapStyle.#roadNameLayer;
    const white = token('--color-neutral-white', '#FFFFFF');
    const roadCasing = token('--color-neutral-400', '#C2C2C2');
    const polygon = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
    const roundLine = { 'line-cap': 'round', 'line-join': 'round' };

    return {
      version: 8,
      glyphs: MinimapBasemapStyle.#GLYPHS_URL,
      sources: {
        [MinimapBasemapStyle.SOURCE_ID]: { type: 'vector', url: MinimapBasemapStyle.#TILES_URL },
      },
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: { 'background-color': token('--color-neutral-100', '#F0F0F0') },
        },
        layer('park', 'fill', 'park', {
          filter: polygon,
          paint: { 'fill-color': token('--color-pine-100', '#E4F4EE') },
        }),
        layer('water', 'fill', 'water', {
          filter: ['all', polygon, ['!=', ['get', 'brunnel'], 'tunnel']],
          paint: { 'fill-color': token('--color-blue-400', '#C6E0FA') },
        }),
        layer('building', 'fill', 'building', {
          paint: {
            'fill-color': token('--color-neutral-200', '#E1E1E1'),
            'fill-outline-color': token('--color-neutral-300', '#D1D1D1'),
          },
        }),
        layer('rail', 'line', 'transportation', {
          filter: roadFilter(['rail', 'transit']),
          paint: { 'line-color': roadCasing, 'line-width': 1.5 },
        }),
        layer('path', 'line', 'transportation', {
          filter: roadFilter(['path']),
          layout: roundLine,
          paint: { 'line-color': white, 'line-width': roadWidth(0.8, 5) },
        }),
        // Casings first, then fills, so a minor road's casing never draws over the major road it meets.
        layer('road-minor-casing', 'line', 'transportation', {
          filter: roadFilter(MinimapBasemapStyle.#MINOR_ROADS),
          layout: roundLine,
          paint: { 'line-color': roadCasing, 'line-width': roadWidth(2.4, 24) },
        }),
        layer('road-major-casing', 'line', 'transportation', {
          filter: roadFilter(MinimapBasemapStyle.#MAJOR_ROADS),
          layout: roundLine,
          paint: { 'line-color': roadCasing, 'line-width': roadWidth(3.6, 32) },
        }),
        layer('road-minor', 'line', 'transportation', {
          filter: roadFilter(MinimapBasemapStyle.#MINOR_ROADS),
          layout: roundLine,
          paint: { 'line-color': white, 'line-width': roadWidth(1.6, 21) },
        }),
        layer('road-major', 'line', 'transportation', {
          filter: roadFilter(MinimapBasemapStyle.#MAJOR_ROADS),
          layout: roundLine,
          paint: { 'line-color': white, 'line-width': roadWidth(2.8, 29) },
        }),
        roadNameLayer(MinimapBasemapStyle.FIRST_LABEL_LAYER_ID, MinimapBasemapStyle.#MINOR_ROADS, 10),
        roadNameLayer('road-name-major', MinimapBasemapStyle.#MAJOR_ROADS, 11),
      ],
    };
  }
}

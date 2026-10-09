/**
 * The Explore minimap's basemap: a MapLibre style object over OpenStreetMap vector tiles (#5429).
 *
 * Deliberately sparse: the minimap is ~200px and sits under the fog-of-war and FOV overlays, so it draws only what
 * helps a labeler orient (land, water, parks, buildings, roads, rail, and road and water names). No POI icons, transit
 * or place labels (#4665), which also means no sprite sheet to host. Colors come from the main.css tokens (via
 * MinimapStyle.token), quiet enough for the route lines and label icons over the map to carry the contrast.
 */

import { MinimapStyle } from './MinimapStyle.js';

export class MinimapBasemapStyle {
  // The tile and glyph host must be in the CSP's connect-src (conf/application.conf), or the browser blocks the
  // fetches and the minimap draws over a blank background. The source-layer and class names below are the
  // OpenMapTiles schema's, so a different host works unchanged only if it serves that schema.
  static #TILES_URL = 'https://tiles.openfreemap.org/planet';
  static #GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

  /** Id of the vector source; also how Minimap tells basemap layers from its own. */
  static SOURCE_ID = 'basemap';

  static #MAJOR_ROADS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
  static #MINOR_ROADS = ['minor', 'service', 'track'];

  // Typical curb-to-curb widths in meters by OpenMapTiles class: the tiles carry a class but no width (OSM's `width`
  // tag is sparse and not in the schema), so roads are drawn at their class's typical width.
  static #ROAD_METERS = {
    motorway: 22, trunk: 18, primary: 15, secondary: 13, tertiary: 11, minor: 9, service: 5, track: 4, path: 2,
  };

  // Real width holds up to the default zoom; above it a road doubles only once over the next two levels, so at the
  // closest zoom a residential street doesn't fill a ~200px map.
  static #TRUE_WIDTH_UNTIL_ZOOM = 17;
  static #MAX_ZOOM = 19;
  static #MIN_ZOOM = 12;
  // Floor for a residential street where true width would be under a pixel, scaled by class width for the others,
  // so the road hierarchy survives at the overview zoom.
  static #MIN_MINOR_PX = 1;
  // The casing's gray border on each side, in px at any zoom.
  static #CASING_PX = 1.2;

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
   * A road line width at real-world scale for each road's class, as a zoom- and class-driven MapLibre expression.
   * A 512px-tile map shows 40,075 km · cos(lat) / (512 · 2^z) meters per pixel, so width depends on latitude; the
   * minimap stays within one city, so the latitude is fixed when the style is built.
   * @param {string[]} classes - The OpenMapTiles classes the layer draws.
   * @param {number} latitude - Latitude the map is centered near, in degrees.
   * @param {number} [extraPx=0] - Added at every zoom (a casing's border on both sides).
   * @returns {Array} A MapLibre interpolate expression.
   */
  static #roadWidth(classes, latitude, extraPx = 0) {
    const S = MinimapBasemapStyle;
    const metersPerPx = (zoom) => (40075016.686 * Math.cos((latitude * Math.PI) / 180)) / (512 * 2 ** zoom);
    const widthAt = (zoom, meters) => {
      const trueZoom = Math.min(zoom, S.#TRUE_WIDTH_UNTIL_ZOOM);
      // Above TRUE_WIDTH_UNTIL_ZOOM, grow by half a doubling per level instead of a full one.
      const px = (meters / metersPerPx(trueZoom)) * 2 ** ((zoom - trueZoom) / 2);
      const floor = Math.max(0.8, (S.#MIN_MINOR_PX * meters) / S.#ROAD_METERS.minor);
      return Math.max(px, floor) + extraPx;
    };
    const byClass = (zoom) => [
      'match', ['get', 'class'],
      ...classes.flatMap((cls) => [cls, Number(widthAt(zoom, S.#ROAD_METERS[cls]).toFixed(2))]),
      Number(widthAt(zoom, S.#ROAD_METERS.minor).toFixed(2)),
    ];
    const zooms = [S.#MIN_ZOOM, 14, 16, S.#TRUE_WIDTH_UNTIL_ZOOM, S.#MAX_ZOOM];
    return ['interpolate', ['exponential', 2], ['zoom'], ...zooms.flatMap((zoom) => [zoom, byClass(zoom)])];
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
   * The UI-language name where the tiles have one, else the local name: what the Mapbox maps' language plugin shows.
   * The tiles key translations by bare language ('name:zh'), so a region tag is dropped.
   * @param {?string} language - A BCP 47 tag ('pt-BR'); none means the local name only.
   * @returns {Array} A MapLibre expression.
   */
  static #nameField(language) {
    const base = (language || '').split('-')[0];
    return base ? ['coalesce', ['get', `name:${base}`], ['get', 'name']] : ['get', 'name'];
  }

  /**
   * One road-name label layer.
   * @param {string} id - Layer id.
   * @param {string[]} classes - OpenMapTiles transportation classes to label.
   * @param {number} size - Text size in px.
   * @param {Array} nameField - The text expression, from #nameField.
   * @returns {object} A MapLibre symbol layer.
   */
  static #roadNameLayer(id, classes, size, nameField) {
    return MinimapBasemapStyle.#layer(id, 'symbol', 'transportation_name', {
      filter: MinimapBasemapStyle.#roadFilter(classes),
      layout: {
        'symbol-placement': 'line',
        'text-field': nameField,
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
   * @param {number} latitude - Latitude the map opens at, for drawing roads at real width (see #roadWidth).
   * @param {string} language - The UI language (see #nameField).
   * @returns {object} A MapLibre style specification.
   */
  static build(latitude, language) {
    const token = MinimapStyle.token;
    const layer = MinimapBasemapStyle.#layer;
    const roadFilter = MinimapBasemapStyle.#roadFilter;
    const S = MinimapBasemapStyle;
    const major = S.#MAJOR_ROADS;
    const minor = S.#MINOR_ROADS;
    const roadWidth = (classes, extraPx) => S.#roadWidth(classes, latitude, extraPx);
    const roadNameLayer = MinimapBasemapStyle.#roadNameLayer;
    const nameField = MinimapBasemapStyle.#nameField(language);
    const white = token('--color-neutral-white', '#FFFFFF');
    const roadCasing = token('--color-neutral-400', '#C2C2C2');
    const water = token('--color-blue-400', '#C6E0FA');
    const labelColor = token('--color-asphalt-300', '#615E78');
    const polygon = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
    const notTunnel = ['!=', ['get', 'brunnel'], 'tunnel'];
    const roundLine = { 'line-cap': 'round', 'line-join': 'round' };
    // Italic alone sets water names apart from road names: the blue tokens are too light to read as text.
    const waterName = (id, sourceLayer, spec) => layer(id, 'symbol', sourceLayer, {
      ...spec,
      layout: { 'text-field': nameField, 'text-font': ['Noto Sans Italic'], 'text-size': 10, ...spec.layout },
      paint: { 'text-color': labelColor, 'text-halo-color': white, 'text-halo-width': 1.5 },
    });

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
          filter: ['all', polygon, notTunnel],
          paint: { 'fill-color': water },
        }),
        // Water too narrow for a polygon; streams only near street level so the overview isn't a tangle of them.
        layer('waterway', 'line', 'waterway', {
          filter: ['all', ['match', ['get', 'class'], ['river', 'canal', 'stream'], true, false], notTunnel],
          layout: roundLine,
          paint: {
            'line-color': water,
            'line-width': ['match', ['get', 'class'], 'river', 2.5, 'canal', 2, 1],
            // MapLibre only accepts a zoom test at the top of an expression, hence the step outside the match.
            'line-opacity': ['step', ['zoom'], ['match', ['get', 'class'], 'stream', 0, 1], 14, 1],
          },
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
          paint: { 'line-color': white, 'line-width': roadWidth(['path']) },
        }),
        // Casings first, then fills, so a minor road's casing never draws over the major road it meets.
        layer('road-minor-casing', 'line', 'transportation', {
          filter: roadFilter(MinimapBasemapStyle.#MINOR_ROADS),
          layout: roundLine,
          paint: { 'line-color': roadCasing, 'line-width': roadWidth(minor, 2 * S.#CASING_PX) },
        }),
        layer('road-major-casing', 'line', 'transportation', {
          filter: roadFilter(MinimapBasemapStyle.#MAJOR_ROADS),
          layout: roundLine,
          paint: { 'line-color': roadCasing, 'line-width': roadWidth(major, 2 * S.#CASING_PX) },
        }),
        layer('road-minor', 'line', 'transportation', {
          filter: roadFilter(MinimapBasemapStyle.#MINOR_ROADS),
          layout: roundLine,
          paint: { 'line-color': white, 'line-width': roadWidth(minor) },
        }),
        layer('road-major', 'line', 'transportation', {
          filter: roadFilter(MinimapBasemapStyle.#MAJOR_ROADS),
          layout: roundLine,
          paint: { 'line-color': white, 'line-width': roadWidth(major) },
        }),
        roadNameLayer('road-name-minor', MinimapBasemapStyle.#MINOR_ROADS, 10, nameField),
        roadNameLayer('road-name-major', MinimapBasemapStyle.#MAJOR_ROADS, 11, nameField),
        waterName('waterway-name', 'waterway', {
          filter: ['match', ['get', 'class'], ['river', 'canal'], true, false],
          layout: { 'symbol-placement': 'line', 'symbol-spacing': 300 },
        }),
        waterName('water-name', 'water_name', {
          filter: ['match', ['geometry-type'], ['Point'], true, false],
        }),
      ],
    };
  }
}

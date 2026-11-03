/**
 * A report's map: the city's own tile archive under the region's streets, as in the Explore minimap, so a view costs
 * no per-load charge however many streets a report has. It draws one street among its neighbors with an icon per
 * location, or with no street in focus, every street in the region in its score color.
 *
 * With sidewalks on, a street whose sides are known is drawn as its sides instead: each side with a likely sidewalk in
 * the street's own color, and a side without one dashed. The color is still the street's (no score is per side), so
 * the two never compete for the one meaning a line's color has.
 *
 * It knows nothing of cards. A host hears which location or street the pointer is on and tells it what to light, so
 * the same map serves the overview and a street's section.
 */

import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';
import i18next from 'i18next';
import { MinimapBasemapStyle } from '../explore/navigation/MinimapBasemapStyle.js';
import { AccessScoreGradeRamp } from '../common/AccessScoreGradeRamp.js';
import { AccessScoreMapLegend } from '../access-score/AccessScoreMapLegend.js';
import { ScoreRamp } from '../common/scoreRamp.js';
import { util } from '../common/utilities.js';
import '../common/utilitiesSidewalk.js';

// MapLibre looks for its worker beside its own file, which in the bundle is this chunk; this is the one Vite built.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

/**
 * @typedef {object} ReportMapEdge
 * @property {number} id
 * @property {?number} score
 * @property {boolean} explored
 * @property {?number} grade - The steepest grade, as a fraction; null where it has not been sampled.
 * @property {number[][]} coordinates
 *
 * @typedef {object} ReportMapLocation
 * @property {number} clusterId
 * @property {string} labelType
 * @property {number} lat
 * @property {number} lng
 *
 * @typedef {object} ReportMapOptions
 * @property {{tilesUrl: ?string, glyphsUrl: string}} basemap - From the page's data.
 * @property {ReportMapEdge[]} edges - Every street edge in the region.
 * @property {?Array<number>} [focusEdgeIds] - The street to draw over the rest; none draws every street by score.
 * @property {ReportMapLocation[]} [locations] - What to pin.
 * @property {(clusterId: ?number) => void} [onLocationHover]
 * @property {(clusterId: number) => void} [onLocationClick]
 * @property {(streetId: ?number) => void} [onStreetHover] - With the segment's edge id.
 * @property {(streetId: number) => void} [onStreetClick]
 * @property {boolean} [still] - Draws once, for `snapshot`: no controls, no input, and a canvas that can be read back.
 * @property {[number, number]} [center] - Centers here at `STILL_ZOOM` rather than framing the street.
 * @property {{score: ?number, grade: ?number}} [mark] - The focused street's own numbers, for its legend to point at.
 */

const STREETS_SOURCE = 'report-streets';
const SIDEWALKS_SOURCE = 'report-sidewalks';
const VIEWPOINT_SOURCE = 'report-viewpoint';
const CURSOR_SOURCE = 'report-cursor';
const CONTEXT_LAYER = 'report-streets-context';
const LIT_STREET_LAYER = 'report-street-lit';
const SCORED_LAYER = 'report-streets-scored';
const SIDEWALK_LAYER = 'report-sidewalks';
const NO_SIDEWALK_LAYER = 'report-sidewalks-absent';
const SPINE_LAYER = 'report-streets-spine';
const SIDEWALK_OFFSET_PX = 6;
// A block or so around a fix: the street it is on and the corner it is near, at a size two panes can show.
const STILL_ZOOM = 17.5;
const STILL_ICON_PX = 24;
// A tile that never answers must not hold a card's map forever; the sketch stays in its place.
const STILL_TIMEOUT_MS = 10000;
// A lit icon covers about 15px around its point, so this leaves the wedge plainly visible past it.
const VIEWPOINT_MIN_RADIUS_PX = 56;
const EARTH_CIRCUMFERENCE_METERS = 40075016.686;
const TILE_SIZE_PX = 512;
const EMPTY = /** @type {GeoJSON.FeatureCollection} */ ({ type: 'FeatureCollection', features: [] });

let archiveProtocolAdded = false;

/** Teaches MapLibre to read `pmtiles://` archives, once per page. */
function addArchiveProtocol() {
  if (archiveProtocolAdded) return;
  // `metadata` carries the archive's OpenStreetMap credit to the attribution control.
  maplibregl.addProtocol('pmtiles', new Protocol({ metadata: true }).tile);
  archiveProtocolAdded = true;
}

/**
 * @param {string} name - A design token.
 * @returns {string} Its color.
 */
function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * @param {string} src
 * @returns {Promise<?HTMLImageElement>} The image once decoded, or null if it can't be.
 */
function loadImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/**
 * @param {number[][]} points - `[lng, lat]`s.
 * @returns {[[number, number], [number, number]]} The box around them.
 */
function boundsOf(points) {
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

export class ReportMap {
  /** @type {maplibregl.Map} */ #map;
  /** @type {ReportMapOptions} */ #options;
  /** @type {Map<number, {marker: maplibregl.Marker, element: HTMLElement, labelType: string}>} */ #markers = new Map();
  /** Work asked for before the style finished loading. */
  #pending = [];
  #loaded = false;
  #sidewalkMode = false;
  /** @type {?number[]} */ #gradeBreaks = null;
  /** @type {Set<number>} Edges with at least one side known, which sidewalk mode draws as sides. */
  #sided = new Set();
  /** @type {AccessScoreMapLegend} */ #legend;
  #prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  /**
   * @param {HTMLElement} container - The element to draw in.
   * @param {ReportMapOptions} options
   */
  constructor(container, options) {
    this.#options = options;
    const { basemap, edges, focusEdgeIds = null, locations = [], still = false, center = null } = options;
    if (basemap.tilesUrl) addArchiveProtocol();
    // pmtiles' protocol handler wants an absolute URL after its prefix.
    const tilesUrl = basemap.tilesUrl ? `pmtiles://${new URL(basemap.tilesUrl, window.location.href).href}` : null;

    const focus = focusEdgeIds ? edges.filter((e) => focusEdgeIds.includes(e.id)) : edges;
    const framed = [...focus.flatMap((e) => e.coordinates), ...locations.map((l) => [l.lng, l.lat])];
    const bounds = boundsOf(framed.length ? framed : edges.flatMap((e) => e.coordinates));

    this.#map = new maplibregl.Map({
      container,
      style: /** @type {import('maplibre-gl').StyleSpecification} */ (
        MinimapBasemapStyle.build(bounds[0][1], i18next.language, tilesUrl, basemap.glyphsUrl)),
      ...(center ? { center, zoom: STILL_ZOOM } : { bounds, fitBoundsOptions: { padding: 32, maxZoom: 18 } }),
      ...(still ? { interactive: false, canvasContextAttributes: { preserveDrawingBuffer: true } } : {}),
      maxZoom: 19,
      // A map mid-page must not take the page's scroll: wheel zooming needs a modifier and touch panning two fingers.
      cooperativeGestures: true,
      dragRotate: false,
      touchPitch: false,
      attributionControl: false,
      locale: {
        'CooperativeGesturesHandler.WindowsHelpText': i18next.t('report:map.gesture-windows'),
        'CooperativeGesturesHandler.MacHelpText': i18next.t('report:map.gesture-mac'),
        'CooperativeGesturesHandler.MobileHelpText': i18next.t('report:map.gesture-touch'),
      },
    });
    if (!still) {
      this.#map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      this.#map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      this.#addLegend();
    }

    this.#map.once('load', () => {
      this.#addStreets(focusEdgeIds);
      this.#addSidewalks();
      this.#bindStreetPointer();
      this.#addViewpoint();
      this.#addCursor();
      this.#loaded = true;
      for (const work of this.#pending) work();
      this.#pending = [];
    });
    // A still map's icons are painted into its picture instead, since a DOM marker isn't on the canvas.
    if (!still) for (const location of locations) this.#addMarker(location);
  }

  /**
   * Waits for the map to finish drawing and returns it as a picture with its locations' icons painted in.
   * @returns {Promise<?string>} A PNG data URL, or null if the map never finished.
   */
  async snapshot() {
    await /** @type {Promise<void>} */ (new Promise((resolve) => {
      this.#whenLoaded(() => resolve());
    }));
    const settled = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), STILL_TIMEOUT_MS);
      this.#map.once('idle', () => {
        clearTimeout(timer);
        resolve(true);
      });
      this.#map.triggerRepaint();
    });
    if (!settled) return null;
    const source = this.#map.getCanvas();
    const picture = document.createElement('canvas');
    picture.width = source.width;
    picture.height = source.height;
    const context = picture.getContext('2d');
    context.drawImage(source, 0, 0);
    const ratio = source.width / source.clientWidth;
    const size = STILL_ICON_PX * ratio;
    for (const { labelType, lng, lat } of this.#options.locations ?? []) {
      const icon = await loadImage(util.misc.getIconImagePaths(labelType).iconImagePath);
      if (!icon) continue;
      const { x, y } = this.#map.project([lng, lat]);
      context.drawImage(icon, x * ratio - size / 2, y * ratio - size / 2, size, size);
    }
    return picture.toDataURL('image/png');
  }

  /** @param {() => void} work - Runs now, or once the style has loaded. */
  #whenLoaded(work) {
    if (this.#loaded) work();
    else this.#pending.push(work);
  }

  /** @returns {GeoJSON.FeatureCollection} The streets as they now stand; a host may change an edge's score in place. */
  #streetFeatures() {
    const focused = new Set(this.#options.focusEdgeIds ?? []);
    return {
      type: 'FeatureCollection',
      features: this.#options.edges.map((e) => ({
        type: 'Feature',
        properties: {
          streetId: e.id,
          score: e.score ?? -1,
          grade: e.grade ?? -1,
          explored: e.explored,
          focused: focused.has(e.id),
          sided: this.#sided.has(e.id),
        },
        geometry: { type: 'LineString', coordinates: e.coordinates },
      })),
    };
  }

  /**
   * @param {?Array<number>} focusEdgeIds
   */
  #addStreets(focusEdgeIds) {
    this.#map.addSource(STREETS_SOURCE, { type: 'geojson', data: this.#streetFeatures() });
    const scoreColor = ScoreRamp.expression(['get', 'score'], { noneColor: token('--color-neutral-400') });
    const line = (id, filter, paint) => this.#map.addLayer({
      id, type: 'line', source: STREETS_SOURCE, filter, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint,
    });

    if (focusEdgeIds) {
      line(CONTEXT_LAYER, ['!', ['get', 'focused']], { 'line-color': token('--color-neutral-400'), 'line-width': 2 });
      line('report-street-casing', ['get', 'focused'], {
        'line-color': token('--color-neutral-white'), 'line-width': 9,
      });
      line(SCORED_LAYER, this.#scoredFilter(), { 'line-color': scoreColor, 'line-width': 5 });
      line(SPINE_LAYER, this.#spineFilter(), { 'line-color': token('--color-neutral-500'), 'line-width': 1.5 });
      return;
    }

    // The lit street's casing goes under every street, so its own color stays what it's scored.
    line(LIT_STREET_LAYER, ['==', ['get', 'streetId'], -1], {
      'line-color': token('--color-neutral-900'), 'line-width': 9,
    });
    line(SCORED_LAYER, this.#scoredFilter(), { 'line-color': scoreColor, 'line-width': 4 });
    line(SPINE_LAYER, this.#spineFilter(), { 'line-color': token('--color-neutral-500'), 'line-width': 1.5 });
    line(CONTEXT_LAYER, ['!', ['get', 'explored']], { 'line-color': token('--color-neutral-400'), 'line-width': 2 });
  }

  /** A street's line, or in sidewalk mode its present sides, leads to its section. */
  #bindStreetPointer() {
    const { onStreetHover, onStreetClick } = this.#options;
    if (this.#options.focusEdgeIds) return;
    for (const layer of [SCORED_LAYER, SIDEWALK_LAYER]) {
      this.#map.on('mousemove', layer, (e) => {
        this.#map.getCanvas().style.cursor = 'pointer';
        onStreetHover?.(e.features?.[0]?.properties?.streetId ?? null);
      });
      this.#map.on('mouseleave', layer, () => {
        this.#map.getCanvas().style.cursor = '';
        onStreetHover?.(null);
      });
      this.#map.on('click', layer, (e) => {
        const streetId = e.features?.[0]?.properties?.streetId;
        if (streetId !== undefined) onStreetClick?.(streetId);
      });
    }
  }

  /** @returns {any} The streets this map draws in color: the focused one, or every explored one. */
  #drawn() {
    return this.#options.focusEdgeIds ? ['get', 'focused'] : ['get', 'explored'];
  }

  /** @returns {any} Streets drawn by their centerline: all drawn ones, less those sidewalk mode draws as sides. */
  #scoredFilter() {
    return this.#sidewalkMode ? ['all', this.#drawn(), ['!', ['get', 'sided']]] : this.#drawn();
  }

  /** @returns {any} The thin line that keeps a street drawn as its sides reading as one street. */
  #spineFilter() {
    return ['all', this.#drawn(), ['get', 'sided'], ['literal', this.#sidewalkMode]];
  }

  #colorExpression() {
    const noneColor = token('--color-neutral-400');
    return this.#gradeBreaks
      ? AccessScoreGradeRamp.expression(['get', 'grade'], this.#gradeBreaks, { noneColor })
      : ScoreRamp.expression(['get', 'score'], { noneColor });
  }

  /** The key to the line colors, on every report map, so a printed or scrolled-to map still says what it shows. */
  #addLegend() {
    if (this.#legend) this.#map.removeControl(this.#legend);
    this.#legend = new AccessScoreMapLegend({ gradeBreaks: this.#gradeBreaks, brushable: false });
    this.#map.addControl(this.#legend, 'bottom-left');
    this.#legend.setUnit('streets');
    this.#legend.setGrade(this.#gradeBreaks !== null);
    const { mark } = this.#options;
    if (mark) {
      this.#legend.mark(mark.score);
      this.#legend.markGrade(mark.grade);
    }
  }

  /** Two lines per street, one on each side, from one centerline. */
  #addSidewalks() {
    this.#map.addSource(SIDEWALKS_SOURCE, { type: 'geojson', data: EMPTY });
    const offset = /** @type {any} */ (
      ['match', ['get', 'street_side'], 'left', -SIDEWALK_OFFSET_PX, SIDEWALK_OFFSET_PX]);
    const layout = /** @type {any} */ ({ 'line-join': 'round', 'line-cap': 'round', 'visibility': 'none' });
    this.#map.addLayer({
      id: SIDEWALK_LAYER,
      type: 'line',
      source: SIDEWALKS_SOURCE,
      filter: ['all', ['==', ['get', 'presence'], 'present'], this.#drawn()],
      layout,
      paint: { 'line-color': /** @type {any} */ (this.#colorExpression()), 'line-width': 3.5, 'line-offset': offset },
    });
    // Dashed and grey rather than in a color, since no color on these maps means "missing".
    this.#map.addLayer({
      id: NO_SIDEWALK_LAYER,
      type: 'line',
      source: SIDEWALKS_SOURCE,
      filter: ['all', ['==', ['get', 'presence'], 'absent'], this.#drawn()],
      layout: { ...layout, 'line-cap': 'butt' },
      paint: {
        'line-color': token('--color-neutral-600'), 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-offset': offset,
      },
    });
  }

  /** The shape shown while a card is lit: a wedge for what the photo sees, a dot where it was taken. */
  #addViewpoint() {
    this.#map.addSource(VIEWPOINT_SOURCE, { type: 'geojson', data: EMPTY });
    const color = token('--color-asphalt-500');
    this.#map.addLayer({
      id: 'report-viewpoint-wedge',
      type: 'fill',
      source: VIEWPOINT_SOURCE,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': color, 'fill-opacity': 0.22 },
    });
    this.#map.addLayer({
      id: 'report-viewpoint-camera',
      type: 'circle',
      source: VIEWPOINT_SOURCE,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-color': color, 'circle-radius': 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
    });
  }

  /** The dot that follows the pointer along the street's elevation profile. */
  #addCursor() {
    this.#map.addSource(CURSOR_SOURCE, { type: 'geojson', data: EMPTY });
    this.#map.addLayer({
      id: 'report-cursor',
      type: 'circle',
      source: CURSOR_SOURCE,
      paint: {
        'circle-color': token('--color-neutral-900'),
        'circle-radius': 6,
        'circle-stroke-color': token('--color-neutral-white'),
        'circle-stroke-width': 2,
      },
    });
  }

  /**
   * A real button rather than a circle in a layer, so that the keyboard and screen readers can reach it, and with the
   * same icon the photo wears, so the two read as one thing.
   * @param {ReportMapLocation} location
   */
  #addMarker(location) {
    const { clusterId, labelType, lng, lat } = location;
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'report-map-marker';
    element.dataset.clusterId = String(clusterId);
    element.setAttribute('aria-label', i18next.t('report:map.location', { type: util.misc.labelTypeName(labelType) }));
    const icon = document.createElement('img');
    icon.src = util.misc.getIconImagePaths(labelType).iconImagePath;
    icon.alt = '';
    element.append(icon);

    const { onLocationHover, onLocationClick } = this.#options;
    element.addEventListener('mouseenter', () => onLocationHover?.(clusterId));
    element.addEventListener('mouseleave', () => onLocationHover?.(null));
    element.addEventListener('focus', () => onLocationHover?.(clusterId));
    element.addEventListener('blur', () => onLocationHover?.(null));
    element.addEventListener('click', () => onLocationClick?.(clusterId));

    const marker = new maplibregl.Marker({ element }).setLngLat([lng, lat]).addTo(this.#map);
    this.#markers.set(clusterId, { marker, element, labelType });
  }

  /**
   * Lights one location. Pans only if its icon is out of view, since a map that moves on every hover loses the reader.
   * @param {?number} clusterId - The location, or null for none.
   */
  lightLocation(clusterId) {
    for (const [id, { element }] of this.#markers) element.classList.toggle('is-lit', id === clusterId);
    const lit = clusterId === null ? null : this.#markers.get(clusterId);
    if (!lit) return;
    const lngLat = lit.marker.getLngLat();
    if (!this.#map.getBounds().contains(lngLat)) {
      this.#map.easeTo({ center: lngLat, duration: this.#prefersReducedMotion ? 0 : 300 });
    }
  }

  /** @returns {number} The least a viewpoint's shape should reach to read at this zoom, in meters. */
  viewpointMinRadiusMeters() {
    const { lat } = this.#map.getCenter();
    const metersPerPixel = (EARTH_CIRCUMFERENCE_METERS * Math.cos((lat * Math.PI) / 180))
      / (TILE_SIZE_PX * 2 ** this.#map.getZoom());
    return metersPerPixel * VIEWPOINT_MIN_RADIUS_PX;
  }

  /**
   * Shows what a photo sees, or nothing.
   * @param {?{camera: number[], wedge: GeoJSON.Feature}} viewpoint
   */
  showViewpoint(viewpoint) {
    this.#whenLoaded(() => {
      const features = viewpoint
        ? [viewpoint.wedge, /** @type {GeoJSON.Feature} */ ({
            type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: viewpoint.camera },
          })]
        : [];
      /** @type {maplibregl.GeoJSONSource} */ (this.#map.getSource(VIEWPOINT_SOURCE))
        ?.setData({ type: 'FeatureCollection', features });
    });
  }

  /** @param {?number[]} lngLat - Where the profile's cursor falls on this map, or null for nowhere. */
  showCursor(lngLat) {
    this.#whenLoaded(() => {
      const features = lngLat
        ? [({
            type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: lngLat },
          })]
        : [];
      /** @type {maplibregl.GeoJSONSource} */ (this.#map.getSource(CURSOR_SOURCE))
        ?.setData(/** @type {GeoJSON.FeatureCollection} */ ({ type: 'FeatureCollection', features }));
    });
  }

  /**
   * Colors the streets by AccessScore or, with the city's slope classes, by how steep they are.
   * @param {?number[]} gradeBreaks - The classes' breaks, or null for score.
   */
  colorBy(gradeBreaks) {
    this.#gradeBreaks = gradeBreaks;
    this.#whenLoaded(() => {
      const color = /** @type {any} */ (this.#colorExpression());
      this.#map.setPaintProperty(SCORED_LAYER, 'line-color', color);
      this.#map.setPaintProperty(SIDEWALK_LAYER, 'line-color', color);
      this.#addLegend();
    });
  }

  /** @param {?number} streetId - The segment to outline, or null for none. */
  lightStreet(streetId) {
    this.#whenLoaded(() => {
      if (!this.#map.getLayer(LIT_STREET_LAYER)) return;
      this.#map.setFilter(LIT_STREET_LAYER, ['==', ['get', 'streetId'], streetId ?? -1]);
    });
  }

  /**
   * Takes the sides, each given its street's score, grade and way so a side can stand in for its street.
   * @param {GeoJSON.FeatureCollection} faces - `/v3/api/sidewalkPresence`'s answer.
   */
  setSidewalks(faces) {
    const edges = new Map(this.#options.edges.map((e) => [e.id, e]));
    const focused = new Set(this.#options.focusEdgeIds ?? []);
    const known = faces.features
      .filter((f) => f.properties.presence !== 'unknown' && edges.has(f.properties.street_edge_id));
    const enriched = /** @type {GeoJSON.FeatureCollection} */ ({
      type: 'FeatureCollection',
      features: known.map((f) => {
        const edge = edges.get(f.properties.street_edge_id);
        return {
          ...f,
          properties: {
            ...f.properties,
            streetId: edge.id,
            score: edge.score ?? -1,
            grade: edge.grade ?? -1,
            explored: edge.explored,
            focused: focused.has(edge.id),
          },
        };
      }),
    });
    this.#sided = new Set(known.map((f) => f.properties.street_edge_id));
    this.#whenLoaded(() => {
      /** @type {maplibregl.GeoJSONSource} */ (this.#map.getSource(SIDEWALKS_SOURCE))?.setData(enriched);
      /** @type {maplibregl.GeoJSONSource} */ (this.#map.getSource(STREETS_SOURCE))?.setData(this.#streetFeatures());
    });
  }

  /** @param {boolean} visible - Whether streets with known sides are drawn as their sides. */
  setSidewalksVisible(visible) {
    this.#sidewalkMode = visible;
    this.#whenLoaded(() => {
      for (const layer of [SIDEWALK_LAYER, NO_SIDEWALK_LAYER]) {
        this.#map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
      }
      this.#map.setFilter(SCORED_LAYER, this.#scoredFilter());
      this.#map.setFilter(SPINE_LAYER, this.#spineFilter());
    });
  }

  /** Frees the map's WebGL context; a page gets only about 16 of them. */
  destroy() {
    this.#map.remove();
  }
}

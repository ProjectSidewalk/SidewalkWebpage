/**
 * A report's map: the city's own tile archive under the region's streets, as in the Explore minimap, so a view costs
 * no per-load charge however many streets a report has. It draws one street among its neighbors with an icon per
 * location, or with no street in focus, every street in the region in its score color.
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
import { ScoreRamp } from '../common/scoreRamp.js';
import { util } from '../common/utilities.js';
import '../common/utilitiesSidewalk.js';

// MapLibre looks for its worker beside its own file, which in the bundle is this chunk; this is the one Vite built.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

/**
 * @typedef {object} ReportMapEdge
 * @property {number} id
 * @property {number} wayId
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
 * @property {(wayId: ?number) => void} [onStreetHover]
 * @property {(wayId: number) => void} [onStreetClick]
 */

const STREETS_SOURCE = 'report-streets';
const SIDEWALKS_SOURCE = 'report-sidewalks';
const VIEWPOINT_SOURCE = 'report-viewpoint';
const CURSOR_SOURCE = 'report-cursor';
const CONTEXT_LAYER = 'report-streets-context';
const LIT_STREET_LAYER = 'report-street-lit';
const SCORED_LAYER = 'report-streets-scored';
const SIDEWALK_LAYER = 'report-sidewalks';
const SIDEWALK_OFFSET_PX = 6;
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
  #prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  /**
   * @param {HTMLElement} container - The element to draw in.
   * @param {ReportMapOptions} options
   */
  constructor(container, options) {
    this.#options = options;
    const { basemap, edges, focusEdgeIds = null, locations = [] } = options;
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
      bounds,
      fitBoundsOptions: { padding: 32, maxZoom: 18 },
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
    this.#map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    this.#map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    this.#map.once('load', () => {
      this.#addStreets(edges, focusEdgeIds);
      this.#addSidewalks();
      this.#addViewpoint();
      this.#addCursor();
      this.#loaded = true;
      for (const work of this.#pending) work();
      this.#pending = [];
    });
    for (const location of locations) this.#addMarker(location);
  }

  /** @param {() => void} work - Runs now, or once the style has loaded. */
  #whenLoaded(work) {
    if (this.#loaded) work();
    else this.#pending.push(work);
  }

  /**
   * @param {ReportMapEdge[]} edges
   * @param {?Array<number>} focusEdgeIds
   */
  #addStreets(edges, focusEdgeIds) {
    const focused = new Set(focusEdgeIds ?? []);
    this.#map.addSource(STREETS_SOURCE, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: edges.map((e) => ({
          type: 'Feature',
          properties: {
            wayId: e.wayId,
            score: e.score ?? -1,
            grade: e.grade ?? -1,
            explored: e.explored,
            focused: focused.has(e.id),
          },
          geometry: { type: 'LineString', coordinates: e.coordinates },
        })),
      },
    });
    const scoreColor = ScoreRamp.expression(['get', 'score'], { noneColor: token('--color-neutral-400') });
    const line = (id, filter, paint) => this.#map.addLayer({
      id, type: 'line', source: STREETS_SOURCE, filter, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint,
    });

    if (focusEdgeIds) {
      line(CONTEXT_LAYER, ['!', ['get', 'focused']], { 'line-color': token('--color-neutral-400'), 'line-width': 2 });
      line('report-street-casing', ['get', 'focused'], {
        'line-color': token('--color-neutral-white'), 'line-width': 9,
      });
      line(SCORED_LAYER, ['get', 'focused'], { 'line-color': scoreColor, 'line-width': 5 });
      return;
    }

    // The lit street's casing goes under every street, so its own color stays what it's scored.
    line(LIT_STREET_LAYER, ['==', ['get', 'wayId'], -1], {
      'line-color': token('--color-neutral-900'), 'line-width': 9,
    });
    line(SCORED_LAYER, ['get', 'explored'], { 'line-color': scoreColor, 'line-width': 4 });
    line(CONTEXT_LAYER, ['!', ['get', 'explored']], { 'line-color': token('--color-neutral-400'), 'line-width': 2 });

    const { onStreetHover, onStreetClick } = this.#options;
    this.#map.on('mousemove', SCORED_LAYER, (e) => {
      this.#map.getCanvas().style.cursor = 'pointer';
      onStreetHover?.(e.features?.[0]?.properties?.wayId ?? null);
    });
    this.#map.on('mouseleave', SCORED_LAYER, () => {
      this.#map.getCanvas().style.cursor = '';
      onStreetHover?.(null);
    });
    this.#map.on('click', SCORED_LAYER, (e) => {
      const wayId = e.features?.[0]?.properties?.wayId;
      if (wayId !== undefined) onStreetClick?.(wayId);
    });
  }

  /** Two lines per street, one on each side, from one centerline. */
  #addSidewalks() {
    const color = /** @type {import('maplibre-gl').ExpressionSpecification} */ (['match', ['get', 'presence'],
      'absent', token('--color-label-no-sidewalk'),
      'present', token('--color-success-200'),
      token('--color-neutral-400')]);
    this.#map.addSource(SIDEWALKS_SOURCE, { type: 'geojson', data: EMPTY });
    this.#map.addLayer({
      id: SIDEWALK_LAYER,
      type: 'line',
      source: SIDEWALKS_SOURCE,
      filter: ['!=', ['get', 'presence'], 'unknown'],
      layout: { 'line-join': 'round', 'visibility': 'visible' },
      paint: {
        'line-color': color,
        'line-width': 2.5,
        'line-offset': ['match', ['get', 'street_side'], 'left', -SIDEWALK_OFFSET_PX, SIDEWALK_OFFSET_PX],
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
    this.#whenLoaded(() => {
      const noneColor = token('--color-neutral-400');
      const color = gradeBreaks
        ? AccessScoreGradeRamp.expression(['get', 'grade'], gradeBreaks, { noneColor })
        : ScoreRamp.expression(['get', 'score'], { noneColor });
      this.#map.setPaintProperty(SCORED_LAYER, 'line-color', /** @type {any} */ (color));
    });
  }

  /** @param {?number} wayId - The street to outline, or null for none. */
  lightStreet(wayId) {
    this.#whenLoaded(() => {
      if (!this.#map.getLayer(LIT_STREET_LAYER)) return;
      this.#map.setFilter(LIT_STREET_LAYER, ['==', ['get', 'wayId'], wayId ?? -1]);
    });
  }

  /** @param {GeoJSON.FeatureCollection} faces - `/v3/api/sidewalkPresence`'s answer. */
  setSidewalks(faces) {
    this.#whenLoaded(() => {
      /** @type {maplibregl.GeoJSONSource} */ (this.#map.getSource(SIDEWALKS_SOURCE))?.setData(faces);
    });
  }

  /** @param {boolean} visible */
  setSidewalksVisible(visible) {
    this.#whenLoaded(() => {
      this.#map.setLayoutProperty(SIDEWALK_LAYER, 'visibility', visible ? 'visible' : 'none');
    });
  }

  /** @param {Set<string>} types - The label types to show. */
  setVisibleTypes(types) {
    for (const { element, labelType } of this.#markers.values()) element.hidden = !types.has(labelType);
  }

  /** Frees the map's WebGL context; a page gets only about 16 of them. */
  destroy() {
    this.#map.remove();
  }
}

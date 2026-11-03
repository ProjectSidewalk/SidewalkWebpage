/**
 * A report's map: the city's own tile archive under the region's streets, as in the Explore minimap, so a view costs
 * no per-load charge however many streets a report has. It draws one street among its neighbors with an icon per
 * location, or with no street in focus, every street in the region in its score color.
 *
 * With sidewalks on, a street whose sides are known is drawn as its sides instead: each side with a likely sidewalk in
 * the street's own color, and a side without one dashed. The color is still the street's (no score is per side), so
 * the two never compete for the one meaning a line's color has.
 *
 * Given problems instead of locations, it is the worst-problems map: every street in a quiet grey under one dot per
 * location, colored by type, so the dots are the only color on it.
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
import { PlaceCategoryIcons } from '../common/PlaceCategoryIcons.js';
import { PlaceMarkerColors } from '../common/PlaceMarkerColors.js';
import { AccessScoreModel } from '../access-score/AccessScoreModel.js';
import { formatScore } from '../access-score/AccessScoreText.js';
import { util } from '../common/utilities.js';
import '../common/utilitiesSidewalk.js';

// MapLibre looks for its worker beside its own file, which in the bundle is this chunk; this is the one Vite built.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

/**
 * @typedef {object} ReportMapEdge
 * @property {number} id
 * @property {?string} name
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
 * @property {ReportMapPlace[]} [places] - Important places to show.
 * @property {ReportMapProblem[]} [problems] - Draws the worst-problems map: these as dots, the streets unscored.
 * @property {(labelType: ?string) => void} [onProblemHover] - With the type of the dot under the pointer.
 * @property {(problem: ReportMapProblem, lngLat: [number, number]) => void} [onProblemClick]
 * @property {() => void} [onProblemClose] - When a card opened by `openProblem` closes, however it was closed.
 *
 * @typedef {object} ReportMapProblem
 * @property {number} clusterId
 * @property {?number} labelId - The label that pictures it; null when review has rejected them all.
 * @property {string} labelType
 * @property {number} lat
 * @property {number} lng
 *
 * @typedef {object} ReportMapPlace
 * @property {?string} name
 * @property {string} category
 * @property {number} lat
 * @property {number} lng
 * @property {number} edgeId - Its nearest street segment, whose score its disc wears.
 * @property {number} distance - How far it is from that segment, in meters.
 */

const STREETS_SOURCE = 'report-streets';
const SIDEWALKS_SOURCE = 'report-sidewalks';
const VIEWPOINT_SOURCE = 'report-viewpoint';
const CURSOR_SOURCE = 'report-cursor';
const PROBLEMS_SOURCE = 'report-problems';
const PROBLEM_LAYER = 'report-problems';
const PROBLEM_OPEN_LAYER = 'report-problem-open';
// A dot fades to this when another type is lit: still there, so the reader keeps their bearings.
const UNLIT_OPACITY = 0.15;
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
const PLACE_DISC_PX = 22;
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
 * @param {string} category - A place category id.
 * @returns {string} Its glyph's served URL.
 */
function placeIconUrl(category) {
  return util.assetPath(`images/icons/${PlaceCategoryIcons.file(category)}`);
}

/**
 * A white glyph recolored, for a still map's picture, where CSS can't reach.
 * @param {HTMLImageElement} glyph
 * @param {string} color
 * @param {number} size - The drawn size in canvas pixels.
 * @returns {HTMLCanvasElement}
 */
function tinted(glyph, color, size) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(size);
  canvas.height = Math.ceil(size);
  const context = canvas.getContext('2d');
  context.drawImage(glyph, 0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
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
  /** @type {?Map<number, ReportMapEdge>} The edges by id, built on first need. */ #edges = null;
  /** @type {?(() => void)} Closes the place tooltip that is open, if any. */ #openPlace = null;
  /** @type {Map<number, {marker: maplibregl.Marker, element: HTMLElement, labelType: string}>} */ #markers = new Map();
  /** Work asked for before the style finished loading. */
  #pending = [];
  #loaded = false;
  #sidewalkMode = false;
  /** @type {?number[]} */ #gradeBreaks = null;
  /** @type {Set<number>} Edges with at least one side known, which sidewalk mode draws as sides. */
  #sided = new Set();
  /** @type {AccessScoreMapLegend} */ #legend;
  /** @type {?maplibregl.Popup} */ #popup = null;
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
        'Popup.Close': i18next.t('report:worst.close'),
      },
    });
    if (!still) {
      this.#map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      this.#map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      // The worst map's only color is its dots', whose key is the type list beside it.
      if (!options.problems) this.#addLegend();
    }

    this.#map.once('load', () => {
      this.#addStreets(focusEdgeIds);
      if (options.problems) {
        this.#addProblems(options.problems);
      } else {
        this.#addSidewalks();
        this.#bindStreetPointer();
        this.#addViewpoint();
        this.#addCursor();
      }
      this.#loaded = true;
      for (const work of this.#pending) work();
      this.#pending = [];
    });
    // A still map's icons are painted into its picture instead, since a DOM marker isn't on the canvas.
    if (!still) {
      for (const place of options.places ?? []) this.#addPlace(place);
      // A pinned place tooltip closes on a click anywhere else on the map; a place's own click doesn't reach here.
      this.#map.on('click', () => this.#openPlace?.());
      for (const location of locations) this.#addMarker(location);
    }
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
    const disc = PLACE_DISC_PX * ratio;
    for (const place of this.#options.places ?? []) {
      const glyph = await loadImage(placeIconUrl(place.category));
      const colors = this.#placeColors(place);
      const { x, y } = this.#map.project([place.lng, place.lat]);
      context.beginPath();
      context.arc(x * ratio, y * ratio, disc / 2, 0, 2 * Math.PI);
      context.fillStyle = colors.fill;
      context.fill();
      context.lineWidth = 2 * ratio;
      context.strokeStyle = colors.halo;
      context.stroke();
      if (glyph) {
        const g = disc * 0.6;
        context.drawImage(tinted(glyph, colors.glyph, g), x * ratio - g / 2, y * ratio - g / 2, g, g);
      }
    }
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

    // Explored streets a shade darker than the rest, so a reader sees where nobody has looked, and so found nothing.
    if (this.#options.problems) {
      line(CONTEXT_LAYER, ['!', ['get', 'explored']], { 'line-color': token('--color-neutral-300'), 'line-width': 2 });
      line(SCORED_LAYER, ['get', 'explored'], { 'line-color': token('--color-neutral-500'), 'line-width': 3 });
      return;
    }

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

  /**
   * A dot per problem, and a ring for the one whose card is open.
   * @param {ReportMapProblem[]} problems
   */
  #addProblems(problems) {
    this.#map.addSource(PROBLEMS_SOURCE, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: problems.map((p) => ({
          type: 'Feature',
          properties: {
            clusterId: p.clusterId, labelId: p.labelId, labelType: p.labelType,
            color: util.misc.getLabelColors(p.labelType),
          },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
      },
    });
    const radius = /** @type {any} */ (['interpolate', ['linear'], ['zoom'], 12, 3, 15, 5, 18, 8]);
    this.#map.addLayer({
      id: PROBLEM_LAYER,
      type: 'circle',
      source: PROBLEMS_SOURCE,
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': radius,
        // Dark, not white: the palest type color (Other's grey) needs it to stand off the grey streets (WCAG 1.4.11).
        'circle-stroke-color': token('--color-neutral-900'),
        'circle-stroke-width': 1,
      },
    });
    this.#map.addLayer({
      id: PROBLEM_OPEN_LAYER,
      type: 'circle',
      source: PROBLEMS_SOURCE,
      filter: ['==', ['get', 'clusterId'], -1],
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': /** @type {any} */ (['interpolate', ['linear'], ['zoom'], 12, 6, 15, 8, 18, 11]),
        'circle-stroke-color': token('--color-neutral-900'),
        'circle-stroke-width': 2.5,
      },
    });

    const { onProblemHover, onProblemClick } = this.#options;
    // mousemove fires dozens of times over one dot, and each call restyles the layer, so only a change is passed on.
    /** @type {?string} */ let hovered = null;
    const hover = (labelType) => {
      if (labelType === hovered) return;
      hovered = labelType;
      onProblemHover?.(labelType);
    };
    this.#map.on('mousemove', PROBLEM_LAYER, (e) => {
      this.#map.getCanvas().style.cursor = 'pointer';
      hover(e.features?.[0]?.properties?.labelType ?? null);
    });
    this.#map.on('mouseleave', PROBLEM_LAYER, () => {
      this.#map.getCanvas().style.cursor = '';
      hover(null);
    });
    this.#map.on('click', PROBLEM_LAYER, (e) => {
      const props = e.features?.[0]?.properties;
      const problem = props && problems.find((p) => p.clusterId === props.clusterId);
      if (problem) onProblemClick?.(problem, [problem.lng, problem.lat]);
    });
    // The popup's own close-on-click would also hear the click that opens it, so a click off every dot closes it here.
    this.#map.on('click', (e) => {
      const layers = [PROBLEM_LAYER, PROBLEM_OPEN_LAYER];
      if (this.#map.queryRenderedFeatures(e.point, { layers }).length === 0) this.#popup?.remove();
    });
  }

  /**
   * Lights one type's dots by fading the rest.
   * @param {?string} labelType - The type, or null to show every dot alike.
   */
  lightType(labelType) {
    this.#whenLoaded(() => {
      if (!this.#map.getLayer(PROBLEM_LAYER)) return;
      const opacity = labelType === null
        ? 1
        : ['case', ['==', ['get', 'labelType'], labelType], 1, UNLIT_OPACITY];
      this.#map.setPaintProperty(PROBLEM_LAYER, 'circle-opacity', /** @type {any} */ (opacity));
      this.#map.setPaintProperty(PROBLEM_LAYER, 'circle-stroke-opacity', /** @type {any} */ (opacity));
    });
  }

  /**
   * Opens a card over the map at a problem, closing any other. Escape closes it too, since MapLibre's popup only
   * closes from its button or a click elsewhere. Closing returns focus to the map if it was inside the card, since the
   * popup takes focus on opening and its removal would otherwise drop it to the page.
   * @param {ReportMapProblem} problem
   * @param {HTMLElement} content - What to show; the host fills it in as the card arrives.
   * @returns {maplibregl.Popup}
   */
  openProblem(problem, content) {
    this.#popup?.remove();
    const popup = new maplibregl.Popup({
      maxWidth: 'none', className: 'report-problem-popup', focusAfterOpen: true, closeOnClick: false,
    })
      .setLngLat([problem.lng, problem.lat])
      .setDOMContent(content)
      .addTo(this.#map);
    this.#popup = popup;
    const ring = (id) => this.#whenLoaded(() => {
      if (this.#map.getLayer(PROBLEM_OPEN_LAYER)) {
        this.#map.setFilter(PROBLEM_OPEN_LAYER, ['==', ['get', 'clusterId'], id]);
      }
    });
    ring(problem.clusterId);
    const onKey = (e) => {
      if (e.key === 'Escape') popup.remove();
    };
    popup.getElement().addEventListener('keydown', onKey);
    popup.on('close', () => {
      if (this.#popup !== popup) return;
      this.#popup = null;
      ring(-1);
      const focus = document.activeElement;
      if (!focus || focus === document.body || popup.getElement().contains(focus)) {
        this.#map.getCanvas().focus({ preventScroll: true });
      }
      this.#options.onProblemClose?.();
    });
    return popup;
  }

  /**
   * Re-places the open card. MapLibre picks which side of the dot a popup sits on when it's placed, so a card that
   * grows after that (its loading line replaced, then its photo) can run past the map's clipped edge until this runs.
   */
  refitProblem() {
    this.#popup?.setLngLat(this.#popup.getLngLat());
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
  /**
   * A place's marker colors: its nearest segment's score, binned as AccessScore bins it, so the report's markers and
   * the tool's agree.
   * @param {ReportMapPlace} place
   * @returns {{fill: string, glyph: string, halo: string}}
   */
  #placeColors(place) {
    return PlaceMarkerColors.forScore(this.#edgeById(place.edgeId)?.score ?? null, AccessScoreModel.HISTOGRAM_BINS);
  }

  /**
   * @param {number} id
   * @returns {ReportMapEdge|undefined}
   */
  #edgeById(id) {
    this.#edges ??= new Map(this.#options.edges.map((e) => [e.id, e]));
    return this.#edges.get(id);
  }

  /**
   * A place near the streets, as AccessScore draws it: a disc in its nearest segment's score color with its category's
   * glyph. A button, so pointer, keyboard and screen reader all reach its tooltip, which hover and focus show and a
   * click pins.
   * @param {ReportMapPlace} place
   */
  #addPlace(place) {
    const colors = this.#placeColors(place);
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'report-map-place';
    element.style.background = colors.fill;
    element.style.boxShadow = `0 0 0 2px ${colors.halo}`;
    const glyph = document.createElement('span');
    glyph.className = 'ps-mask-icon report-map-place__glyph';
    glyph.style.color = colors.glyph;
    const icon = `url("${placeIconUrl(place.category)}")`;
    glyph.style.maskImage = icon;
    glyph.style.webkitMaskImage = icon;
    element.append(glyph);
    const content = this.#placeTooltip(place);
    element.setAttribute('aria-label', [...content.children].map((line) => line.textContent).join(', '));

    const popup = new maplibregl.Popup({
      closeButton: false, closeOnClick: false, offset: 14, className: 'report-place-popup', maxWidth: '260px',
    }).setDOMContent(content);
    let pinned = false;
    const close = () => {
      pinned = false;
      popup.remove();
      if (this.#openPlace === close) this.#openPlace = null;
    };
    // One place tooltip per map, as AccessScore keeps one card: showing a place closes whichever other one is open,
    // pinned or not, since a click doesn't move focus in every browser and so can't be relied on to blur it.
    const show = () => {
      if (this.#openPlace && this.#openPlace !== close) this.#openPlace();
      this.#openPlace = close;
      popup.setLngLat([place.lng, place.lat]).addTo(this.#map);
    };
    const hide = () => {
      if (!pinned) close();
    };
    element.addEventListener('mouseenter', show);
    element.addEventListener('focus', show);
    element.addEventListener('mouseleave', hide);
    element.addEventListener('blur', close);
    element.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pinned) {
        close();
      } else {
        show();
        pinned = true;
      }
    });
    element.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
    new maplibregl.Marker({ element }).setLngLat([place.lng, place.lat]).addTo(this.#map);
  }

  /**
   * The place tooltip in AccessScore's shape: title, what it is, the nearest segment's score, and which segment and
   * how far. Built from DOM nodes, since a place's name is OSM's.
   * @param {ReportMapPlace} place
   * @returns {HTMLElement}
   */
  #placeTooltip(place) {
    const category = i18next.t(`accessscore:place-${place.category}`, { defaultValue: place.category });
    const edge = this.#edgeById(place.edgeId);
    const box = document.createElement('div');
    const line = (className, text) => {
      const element = document.createElement(className === 'title' ? 'strong' : 'div');
      element.className = `report-place-popup__${className}`;
      element.textContent = text;
      box.append(element);
    };
    line('title', place.name ?? category);
    if (place.name) line('meta', category);
    if (edge?.score !== null && edge?.score !== undefined) {
      line('score', i18next.t('report:place.score', { score: formatScore(edge.score) }));
    } else {
      line('meta', i18next.t('report:place.unscored'));
    }
    line('meta', i18next.t('report:place.street', {
      street: edge?.name ?? i18next.t('report:place.unnamed'),
      distance: i18next.t('accessscore:length', { meters: place.distance, interpolation: { escapeValue: false } }),
      interpolation: { escapeValue: false },
    }));
    return box;
  }

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
    if (this.#options.problems) return;
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
    if (this.#options.problems) return;
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
    if (this.#options.problems) return;
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

/**
 * The city reports page's map (#6041): every neighborhood as a shape over the city's own tile archive, colored by the
 * page's lens, as the neighborhood reports draw their maps, so a view costs no billable Google or Mapbox call.
 *
 * It draws the shared state and writes the pointer's hover and click back to it; it never talks to the table. The table
 * is the page's keyboard and screen-reader path to the same neighborhoods, so the canvas is a picture to point at.
 * Hovering a shape shows its card; a click selects it and pins the card with its links.
 */

import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';
import i18next from 'i18next';
import { MinimapBasemapStyle } from '../explore/navigation/MinimapBasemapStyle.js';
import { ScoreRamp } from '../common/scoreRamp.js';
import { mapCard } from './cityReportMapCard.js';
import { util } from '../common/utilities.js';
import '../common/utilitiesSidewalk.js';

// MapLibre looks for its worker beside its own file, which in the bundle is this chunk; this is the one Vite built.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

const SOURCE = 'reports-regions';
const FILL_LAYER = 'reports-regions-fill';
const OUTLINE_LAYER = 'reports-regions-outline';
const HIGHLIGHT_LAYER = 'reports-regions-highlight';
const NAME_LAYER = 'reports-regions-names';
// A faded neighborhood stays visible, so the reader keeps their bearings, and can still be picked.
const FADED_OPACITY = 0.15;

/**
 * @param {string} name - A design token.
 * @returns {string} Its color.
 */
function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * @param {string} hex - `#rrggbb`.
 * @returns {number[]} Its red, green and blue, 0 to 255.
 */
function rgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/**
 * A color between two, linear in sRGB as MapLibre interpolates.
 * @param {string} from - `#rrggbb` at 0.
 * @param {string} to - `#rrggbb` at 1.
 * @param {number} t - Where between them, clamped to 0 to 1.
 * @returns {string} `#rrggbb`.
 */
function mix(from, to, t) {
  const f = Math.min(1, Math.max(0, t));
  const [a, b] = [rgb(from), rgb(to)];
  return `#${a.map((c, i) => Math.round(c + (b[i] - c) * f).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * @typedef {object} CityReportMapRow
 * @property {number} id
 * @property {boolean} scored
 * @property {boolean} hasStreets
 * @property {?number} score - 0 to 1.
 * @property {?number} completion - 0 to 1; null with no streets.
 * @property {?string} topType - The type that lowers its score most.
 */

/** @typedef {CityReportMapRow & import('./cityReportPanel.js').CityReportRow} CityReportMapEntry */

/**
 * The color a neighborhood wears under a lens. Exported for its tests.
 * @param {CityReportMapRow} row
 * @param {import('./CityReportState.js').CityReportLens} lens
 * @returns {string} A color.
 */
export function regionColor(row, lens) {
  const none = token('--color-neutral-200');
  if (lens === 'score') return row.scored ? ScoreRamp.at(row.score) : none;
  if (lens === 'explored') {
    if (!row.hasStreets) return none;
    return mix(token('--color-explored-ramp-low'), token('--color-explored-ramp-high'), row.completion);
  }
  return row.topType ? util.misc.getLabelColors(row.topType) : none;
}

let archiveProtocolAdded = false;

export class CityReportMap {
  /** @type {maplibregl.Map} */
  #map;
  /** @type {import('./CityReportState.js').CityReportState} */
  #state;
  /** @type {CityReportMapEntry[]} */
  #rows;
  /** @type {Map<number, CityReportMapEntry>} */
  #rowsById;
  #scoresReady;
  #loaded = false;
  /** The hover card, which follows the pointer. */
  #tooltip;
  /** The card a click pins, holding the links. */
  #pinned;
  /** @type {?number} */
  #tooltipId = null;
  /** @type {?number} */
  #pinnedId = null;

  /**
   * @param {HTMLElement} container - Where the map goes.
   * @param {object} options - What it draws.
   * @param {{tilesUrl: ?string, glyphsUrl: string}} options.basemap - The city's tile archive and glyphs.
   * @param {GeoJSON.FeatureCollection} options.regions - The `/regions` polygons (`region_id`, `name`).
   * @param {CityReportMapEntry[]} options.rows - The page's neighborhoods; a polygon with no row isn't drawn.
   * @param {boolean} options.scoresReady - Whether the city's scores are in, for the cards.
   * @param {import('./CityReportState.js').CityReportState} options.state - The page's shared state.
   */
  constructor(container, { basemap, regions, rows, scoresReady, state }) {
    this.#state = state;
    this.#rows = rows;
    this.#rowsById = new Map(rows.map((r) => [r.id, r]));
    this.#scoresReady = scoresReady;
    const ids = new Set(rows.map((r) => r.id));
    const features = regions.features.filter((f) => ids.has(f.properties.region_id));
    const shown = /** @type {GeoJSON.FeatureCollection} */ ({ type: 'FeatureCollection', features });
    const bounds = CityReportMap.#boundsOf(features);

    if (basemap.tilesUrl && !archiveProtocolAdded) {
      // `metadata` carries the archive's OpenStreetMap credit to the attribution control.
      maplibregl.addProtocol('pmtiles', new Protocol({ metadata: true }).tile);
      archiveProtocolAdded = true;
    }
    const tilesUrl = basemap.tilesUrl ? `pmtiles://${new URL(basemap.tilesUrl, window.location.href).href}` : null;
    this.#map = new maplibregl.Map({
      container,
      style: /** @type {import('maplibre-gl').StyleSpecification} */ (
        MinimapBasemapStyle.build(bounds[0][1], i18next.language, tilesUrl, basemap.glyphsUrl)),
      bounds,
      fitBoundsOptions: { padding: 16 },
      maxZoom: 18,
      // A map mid-page must not take the page's scroll: wheel zooming needs a modifier and touch panning two fingers.
      cooperativeGestures: true,
      dragRotate: false,
      touchPitch: false,
      pitchWithRotate: false,
      maxPitch: 0,
      attributionControl: false,
      locale: {
        'CooperativeGesturesHandler.WindowsHelpText': i18next.t('report:map.gesture-windows'),
        'CooperativeGesturesHandler.MacHelpText': i18next.t('report:map.gesture-mac'),
        'CooperativeGesturesHandler.MobileHelpText': i18next.t('report:map.gesture-touch'),
        'Popup.Close': i18next.t('report:worst.close'),
      },
    });
    this.#map.touchZoomRotate.disableRotation();
    this.#map.keyboard.disableRotation();
    this.#map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    this.#map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    this.#tooltip = new maplibregl.Popup({
      closeButton: false, closeOnClick: false, focusAfterOpen: false, className: 'reports-map-tooltip', offset: 12,
      maxWidth: '260px',
    });
    // Not closed by MapLibre's own map click: the click handlers below decide, so a click on another shape moves it.
    this.#pinned = new maplibregl.Popup({
      closeOnClick: false, focusAfterOpen: false, className: 'reports-map-popup', maxWidth: '280px',
    });
    this.#pinned.on('close', () => {
      this.#pinnedId = null;
    });
    // Escape dismisses either card without moving the pointer (WCAG 1.4.13).
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      this.#hideTooltip();
      this.#pinned.remove();
    });
    this.#map.once('load', () => {
      this.#addLayers(shown, Boolean(tilesUrl));
      this.#bindPointer();
      this.#loaded = true;
      this.#paint();
    });
    state.subscribe((current, change) => {
      // A neighborhood picked in the table shows in the panel; a pinned card for another one would contradict it.
      if (change.type === 'select' && current.selected !== this.#pinnedId) this.#pinned.remove();
      if (this.#loaded) this.#paint(change.type);
    });
  }

  /**
   * @param {GeoJSON.Feature[]} features - Polygons and multipolygons.
   * @returns {[[number, number], [number, number]]} The box around them, or the whole world for none.
   */
  static #boundsOf(features) {
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    const visit = (coords) => {
      if (typeof coords[0] === 'number') {
        minX = Math.min(minX, coords[0]);
        minY = Math.min(minY, coords[1]);
        maxX = Math.max(maxX, coords[0]);
        maxY = Math.max(maxY, coords[1]);
      } else {
        for (const c of coords) visit(c);
      }
    };
    for (const f of features) visit(/** @type {any} */ (f.geometry).coordinates);
    return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : [[-180, -60], [180, 75]];
  }

  /**
   * The fill, its outline and, where the archive has glyphs, the neighborhoods' names, bottom to top.
   * @param {GeoJSON.FeatureCollection} regions
   * @param {boolean} hasGlyphs - Whether names can be drawn: a background-only style carries no glyphs.
   */
  #addLayers(regions, hasGlyphs) {
    this.#map.addSource(SOURCE, { type: 'geojson', data: regions, promoteId: 'region_id' });
    /** @type {(key: string) => import('maplibre-gl').ExpressionSpecification} */
    const flag = (key) => ['boolean', ['feature-state', key], false];
    const faded = flag('faded');
    const hovered = flag('hover');
    const selected = flag('selected');
    const asphalt = token('--color-asphalt-500');
    const white = token('--color-neutral-white');
    this.#map.addLayer({
      id: FILL_LAYER,
      type: 'fill',
      source: SOURCE,
      paint: {
        'fill-color': ['to-color', ['coalesce', ['feature-state', 'color'], token('--color-neutral-200')]],
        'fill-opacity': ['case', faded, FADED_OPACITY, hovered, 0.95, 0.75],
      },
    });
    this.#map.addLayer({
      id: OUTLINE_LAYER,
      type: 'line',
      source: SOURCE,
      paint: {
        'line-color': white,
        'line-width': 1.2,
        'line-opacity': ['case', faded, 0.4, 1],
      },
    });
    // Its own layer above every white edge: in one layer a neighbor drawn later paints over the shared border.
    this.#map.addLayer({
      id: HIGHLIGHT_LAYER,
      type: 'line',
      source: SOURCE,
      paint: {
        'line-color': asphalt,
        'line-width': ['case', selected, 3.5, hovered, 2.5, 0],
        'line-opacity': ['case', ['any', selected, hovered], 1, 0],
      },
    });
    if (hasGlyphs) {
      this.#map.addLayer({
        id: NAME_LAYER,
        type: 'symbol',
        source: SOURCE,
        minzoom: 12,
        layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-font': ['Noto Sans Regular'] },
        paint: {
          'text-color': asphalt,
          'text-halo-color': white,
          'text-halo-width': 1.5,
          'text-opacity': ['case', faded, 0.3, 1],
        },
      });
    }
  }

  /**
   * The pointer's hover and click on a neighborhood go to the state, which redraws the map and the table alike, and
   * show its card: following the pointer on a hover, pinned where it was clicked.
   */
  #bindPointer() {
    this.#map.on('mousemove', FILL_LAYER, (e) => {
      this.#map.getCanvas().style.cursor = 'pointer';
      const id = e.features?.[0]?.id;
      if (typeof id !== 'number') return;
      this.#state.hover(id);
      this.#showTooltip(id, e.lngLat);
    });
    this.#map.on('mouseleave', FILL_LAYER, () => {
      this.#map.getCanvas().style.cursor = '';
      this.#state.hover(null);
      this.#hideTooltip();
    });
    this.#map.on('click', (e) => {
      const hit = this.#map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] })[0];
      if (typeof hit?.id !== 'number') {
        this.#pinned.remove();
        return;
      }
      this.#state.select(hit.id, 'Map');
      this.#hideTooltip();
      this.#pinned.setLngLat(e.lngLat)
        .setDOMContent(mapCard(this.#rowsById.get(hit.id), { scoresReady: this.#scoresReady, pinned: true }))
        .addTo(this.#map);
      this.#pinnedId = hit.id;
    });
  }

  /**
   * Shows a neighborhood's hover card at the pointer, building it only when the neighborhood changes.
   * @param {number} id - The neighborhood.
   * @param {maplibregl.LngLat} lngLat - The pointer.
   */
  #showTooltip(id, lngLat) {
    // Its pinned card already says all of it.
    if (id === this.#pinnedId) {
      this.#hideTooltip();
      return;
    }
    if (id !== this.#tooltipId) {
      this.#tooltip.setDOMContent(mapCard(this.#rowsById.get(id), { scoresReady: this.#scoresReady, pinned: false }));
      this.#tooltipId = id;
    }
    this.#tooltip.setLngLat(lngLat);
    if (!this.#tooltip.isOpen()) this.#tooltip.addTo(this.#map);
  }

  #hideTooltip() {
    this.#tooltip.remove();
    this.#tooltipId = null;
  }

  /**
   * Brings every neighborhood's feature-state in line with the page's state.
   * @param {?string} [changeType] - What changed, to skip recoloring on a hover; all of it when absent.
   */
  #paint(changeType) {
    const recolor = !changeType || changeType === 'lens';
    for (const row of this.#rows) {
      const featureState = {
        faded: !this.#state.inFilter(row.id),
        hover: row.id === this.#state.hovered,
        selected: row.id === this.#state.selected,
        ...(recolor ? { color: regionColor(row, this.#state.lens) } : {}),
      };
      this.#map.setFeatureState({ source: SOURCE, id: row.id }, featureState);
    }
  }
}

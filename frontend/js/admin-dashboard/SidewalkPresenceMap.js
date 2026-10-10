/**
 * The admin Sidewalks page's map (#5724): every open street drawn twice, once per side, each side colored by what the
 * labels say about its sidewalk.
 *
 * The docs preview's encoding (`/v3/api/sidewalkPresence`), except unaudited sides are red, plus two things a review
 * page needs that a preview does not: an absent side's opacity follows how many people labeled it (the #5222 study
 * found one labeler right 69% of the time and three 84%), and a street can be focused from outside, which is how the
 * review lists and the region table drive the map.
 */

import { util } from '../common/utilities.js';
import { AdminShell } from './AdminShell.js';

/**
 * Display metadata for the backend's sidewalk_presence_status and sidewalk_presence_basis enums. The values come from
 * the payload; only how each one is named and colored is decided here.
 */
export class SidewalkPresenceStyle {
  /** @type {Record<string, {label: string, token: string}>} Verdicts, keyed by the API's `presence`. */
  static PRESENCE = {
    absent: { label: 'No sidewalk', token: '--color-label-no-sidewalk' },
    present: { label: 'Sidewalk', token: '--color-success-200' },
    // Red, not the docs preview's gray, which vanishes against the light basemap.
    unknown: { label: 'Unknown (street not audited)', token: '--color-error-200' },
  };

  /** @type {Record<string, string>} How each `presence_basis` reads in the filters, popups and tables. */
  static BASIS = {
    no_sidewalk_labels: 'NoSidewalk labels on this side',
    other_side_tag: 'Other side tagged "street has no sidewalks"',
    audited_no_labels: 'Audited, no NoSidewalk label',
    unaudited: 'Not audited',
  };

  /**
   * Resolves a main.css color token, since Mapbox paint properties can't read CSS custom properties.
   *
   * @param {string} token - Custom property name.
   * @returns {string} The color.
   */
  static color(token) {
    return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  }

  /**
   * @param {string} presence - A `presence` value.
   * @returns {string} Its display name, or the raw value for one this page doesn't know yet.
   */
  static presenceLabel(presence) {
    return SidewalkPresenceStyle.PRESENCE[presence]?.label || presence;
  }

  /**
   * @param {string} basis - A `presence_basis` value.
   * @returns {string} Its display name, or the raw value for one this page doesn't know yet.
   */
  static basisLabel(basis) {
    return SidewalkPresenceStyle.BASIS[basis] || basis;
  }
}

export class SidewalkPresenceMap {
  static #SOURCE = 'sidewalk-faces';
  static #FACE_LAYER = 'sidewalk-face-line';
  static #HALO_LAYER = 'sidewalk-face-halo';

  /**
   * How far each side sits from its street's centerline, in pixels so the gap holds at any zoom. Mapbox's line-offset
   * is positive to the right of the line's digitized direction, the frame `street_side` is defined in.
   */
  static #OFFSET_PX = 3;

  #map;
  #mapboxToken;
  #popup;
  #boundsByStreet = new Map(); // street_edge_id -> [[minLng, minLat], [maxLng, maxLat]]
  #hoverId = null;
  #loaded = false;
  #pendingFocus = null;        // Streets chosen before the map loaded; applied on load.

  /**
   * @param {string} containerId - ID of the map container element.
   * @param {{mapboxToken: string}} opts
   */
  constructor(containerId, opts) {
    this.containerId = containerId;
    this.#mapboxToken = opts.mapboxToken;
  }

  /**
   * Initializes the map and draws the faces.
   *
   * @param {GeoJSON.FeatureCollection} faces - Two features per street, each carrying `face_id` and its face's
   *   verdict and evidence in its properties.
   * @returns {Promise<void>} Resolves once the map's first render is ready.
   */
  init(faces) {
    if (!this.#mapboxToken) throw new Error('SidewalkPresenceMap: missing Mapbox access token');
    mapboxgl.accessToken = this.#mapboxToken;

    for (const feature of faces.features) {
      const id = Number(feature.properties.street_edge_id);
      if (!this.#boundsByStreet.has(id)) this.#boundsByStreet.set(id, SidewalkPresenceMap.#bounds([feature]));
    }

    this.#map = new mapboxgl.Map({
      container: this.containerId,
      style: 'mapbox://styles/mapbox/light-v11',
      bounds: SidewalkPresenceMap.#bounds(faces.features),
      fitBoundsOptions: { padding: 24 },
    });
    this.#map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    this.#popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'coverage-popup' });

    return new Promise((resolve) => {
      this.#map.on('load', () => {
        this.#addLayers(faces);
        this.#wireInteractions();
        this.#loaded = true;
        // The page's tables are usable before the map loads, so a street chosen in that window is marked now.
        if (this.#pendingFocus) this.focusStreets(this.#pendingFocus);
        this.#pendingFocus = null;
        resolve();
      });
    });
  }

  #addLayers(faces) {
    const source = SidewalkPresenceMap.#SOURCE;
    this.#map.addSource(source, { type: 'geojson', data: faces, promoteId: 'face_id' });

    const colorExpr = ['match', ['get', 'presence']];
    for (const [value, { token }] of Object.entries(SidewalkPresenceStyle.PRESENCE)) {
      colorExpr.push(value, SidewalkPresenceStyle.color(token));
    }
    colorExpr.push(SidewalkPresenceStyle.color('--color-neutral-700'));

    const isUnknown = ['==', ['get', 'presence'], 'unknown'];
    const hovered = ['boolean', ['feature-state', 'hover'], false];

    // A wide, faint line on the centerline under both faces marks a focused street without hiding its colors. It is
    // filtered to the focused faces rather than drawn everywhere at width 0, so it costs nothing until used.
    this.#map.addLayer({
      id: SidewalkPresenceMap.#HALO_LAYER,
      type: 'line',
      source,
      filter: SidewalkPresenceMap.#haloFilter([]),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': SidewalkPresenceStyle.color('--color-neutral-black'),
        'line-opacity': 0.3,
        'line-width': 14,
      },
    });
    this.#map.addLayer({
      id: SidewalkPresenceMap.#FACE_LAYER,
      type: 'line',
      source,
      // Butt caps (the default): a rounded end on an offset line pokes past the corner it meets.
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': colorExpr,
        'line-offset': ['match', ['get', 'street_side'], 'left', -SidewalkPresenceMap.#OFFSET_PX,
          SidewalkPresenceMap.#OFFSET_PX],
        'line-width': ['case', hovered, 5, isUnknown, 1.2, 2.5],
        // Absent sides fade with thinner evidence; a validator's confirmation counts as full strength.
        'line-opacity': ['case',
          hovered, 1,
          isUnknown, 0.5,
          ['>=', ['get', 'validated_no_sidewalk_count'], 1], 1,
          ['==', ['get', 'presence'], 'absent'],
          ['step', ['get', 'no_sidewalk_user_count'], 0.55, 2, 0.8, 3, 1],
          0.9],
      },
    });
  }

  #wireInteractions() {
    const layer = SidewalkPresenceMap.#FACE_LAYER;
    this.#map.on('mousemove', layer, (e) => {
      if (!e.features.length) return;
      this.#map.getCanvas().style.cursor = 'pointer';
      const feature = e.features[0];
      this.#setHover(feature.id);
      this.#popup.setLngLat(e.lngLat).setHTML(SidewalkPresenceMap.#popupHtml(feature.properties)).addTo(this.#map);
    });
    this.#map.on('mouseleave', layer, () => {
      this.#map.getCanvas().style.cursor = '';
      this.#setHover(null);
      this.#popup.remove();
    });
  }

  #setHover(faceId) {
    if (this.#hoverId === faceId) return;
    const source = SidewalkPresenceMap.#SOURCE;
    if (this.#hoverId !== null) this.#map.setFeatureState({ source, id: this.#hoverId }, { hover: false });
    this.#hoverId = faceId;
    if (faceId !== null) this.#map.setFeatureState({ source, id: faceId }, { hover: true });
  }

  /**
   * Shows only the faces that pass a filter.
   *
   * @param {Array|null} expression - A Mapbox filter expression over face properties, or null to show every face.
   */
  setFilter(expression) {
    this.#map?.setFilter(SidewalkPresenceMap.#FACE_LAYER, expression);
  }

  /**
   * Marks the given streets with a halo and fits the view to them, replacing any earlier mark.
   *
   * @param {number[]} streetEdgeIds - Streets to mark; an empty list clears the mark and leaves the view alone.
   */
  focusStreets(streetEdgeIds) {
    if (!this.#loaded) {
      this.#pendingFocus = streetEdgeIds;
      return;
    }
    this.#map.setFilter(SidewalkPresenceMap.#HALO_LAYER,
      SidewalkPresenceMap.#haloFilter(streetEdgeIds.flatMap((id) => [`${id}:left`, `${id}:right`])));
    this.fitStreets(streetEdgeIds, 17);
  }

  /**
   * Fits the view to the given streets without marking them.
   *
   * @param {number[]} streetEdgeIds - Streets to fit; an empty list leaves the view alone.
   * @param {number} maxZoom - The closest the fit may zoom, so one short street isn't shown at street level.
   */
  fitStreets(streetEdgeIds, maxZoom) {
    const boxes = streetEdgeIds.map((id) => this.#boundsByStreet.get(Number(id))).filter(Boolean);
    if (!this.#map || boxes.length === 0) return;
    const box = [
      [Math.min(...boxes.map((b) => b[0][0])), Math.min(...boxes.map((b) => b[0][1]))],
      [Math.max(...boxes.map((b) => b[1][0])), Math.max(...boxes.map((b) => b[1][1]))],
    ];
    this.#map.fitBounds(box, { padding: 48, maxZoom });
  }

  /**
   * @param {string[]} faceIds - Faces to halo.
   * @returns {Array<any>} A filter matching exactly those faces.
   */
  static #haloFilter(faceIds) {
    return ['in', ['get', 'face_id'], ['literal', faceIds]];
  }

  /** Builds the hover popup: this side's verdict and the evidence behind it, beside the other side's verdict. */
  static #popupHtml(p) {
    const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
    const swatch = (presence) => {
      const token = SidewalkPresenceStyle.PRESENCE[presence]?.token || '--color-neutral-700';
      return `<span class="street-status-swatch" style="background:var(${token})" aria-hidden="true"></span>`;
    };
    const verdict = (presence) => {
      const label = util.escapeHTML(SidewalkPresenceStyle.presenceLabel(presence));
      return `${swatch(presence)}${label}`;
    };
    const rows = [
      row('This side', verdict(p.presence)),
      row('Basis', util.escapeHTML(SidewalkPresenceStyle.basisLabel(p.presence_basis))),
    ];
    if (p.no_sidewalk_label_count > 0) {
      rows.push(row('NoSidewalk', `${AdminShell.num(p.no_sidewalk_label_count)} labels from `
      + `${AdminShell.num(p.no_sidewalk_user_count)} users, ${AdminShell.num(p.validated_no_sidewalk_count)} `
      + 'confirmed'));
    }
    if (p.rejected_no_sidewalk_count > 0) {
      rows.push(row('Rejected', `${AdminShell.num(p.rejected_no_sidewalk_count)} NoSidewalk by validators`));
    }
    rows.push(
      row('Other labels', `${AdminShell.num(p.curb_ramp_count)} curb ramps, ${AdminShell.num(p.problem_label_count)} `
      + 'obstacle/surface'),
      row('Other side', verdict(p.other_presence)),
      row('Audits', AdminShell.num(p.audit_count)),
      row('Region', util.escapeHTML(p.region_name)),
    );
    return [
      `<div class="coverage-popup-name">Street ${util.escapeHTML(p.street_edge_id)}, `
      + `${util.escapeHTML(p.street_side)} side</div>`,
      `<dl class="coverage-popup-dl">${rows.join('')}</dl>`,
    ].join('');
  }

  /**
   * @param {GeoJSON.Feature[]} features - Line features.
   * @returns {number[][]} A [[minLng, minLat], [maxLng, maxLat]] box covering them.
   */
  static #bounds(features) {
    const box = [[Infinity, Infinity], [-Infinity, -Infinity]];
    const visit = (coords) => {
      if (typeof coords[0] === 'number') {
        box[0][0] = Math.min(box[0][0], coords[0]);
        box[1][0] = Math.max(box[1][0], coords[0]);
        box[0][1] = Math.min(box[0][1], coords[1]);
        box[1][1] = Math.max(box[1][1], coords[1]);
      } else {
        coords.forEach(visit);
      }
    };
    for (const feature of features) if (feature.geometry) visit(feature.geometry.coordinates);
    return box;
  }
}

/**
 * The four routing tiers a street's priority falls into, and how they are drawn (#4908).
 *
 * Presentational source of truth for the Imagery page: map colors, legend, table badges, and the tier counts all read
 * TIERS so they can never disagree. Tiers are derived from a street's audit *counts* rather than from cutoffs on the
 * priority value: the counts are what the backend formula consumes, so a change to how priority is weighted (#4894)
 * moves the numbers without silently mis-bucketing the map. Colors are Tableau 10 rather than design tokens: the
 * token set has no categorical scale, and a sequential ramp's light end disappears at the 2px width these segments
 * are drawn at. Warm hues are the two tiers that need labeler work, cool the two that are covered.
 */
class StreetPriorityTiers {
  /** @type {Array<{key: string, label: string, color: string, description: string}>} highest priority first. */
  static TIERS = [
    {
      key: 'unaudited',
      label: 'Not yet audited',
      color: '#E15759',
      description: 'No completed audit counts toward priority yet, so these are served first.',
    },
    {
      key: 'reaudit',
      label: 'Needs re-audit',
      color: '#F28E2B',
      description: 'Audited, but every counted audit is on imagery that has since been replaced.',
    },
    {
      key: 'audited_once',
      label: 'Audited once',
      color: '#76B7B2',
      description: 'One audit on current imagery.',
    },
    {
      key: 'audited_multi',
      label: 'Audited 2+ times',
      color: '#BAB0AC',
      description: 'Two or more audits on current imagery; served last.',
    },
  ];

  /** Fallback color for a tier key that isn't in TIERS (shouldn't happen, but keeps unknown data visible). */
  static FALLBACK = '#d0d0d0';

  /** High-contrast color for the pinned region's segments, distinct from all four tier colors. */
  static SELECTED = '#0566f5'; // --color-accent-link

  /**
   * Classifies one street into a tier from the audit counts the priority formula uses.
   *
   * @param {{fresh_good_count: number, outdated_good_count: number}} street - A row from /adminapi/streetPriority.
   * @returns {string} The tier key.
   */
  static tierFor(street) {
    if (street.fresh_good_count >= 2) return 'audited_multi';
    if (street.fresh_good_count === 1) return 'audited_once';
    if (street.outdated_good_count > 0) return 'reaudit';
    return 'unaudited';
  }

  /** @param {string} key @returns {string} the tier's color, or the fallback if unrecognized. */
  static colorFor(key) {
    const match = StreetPriorityTiers.TIERS.find((tier) => tier.key === key);
    return match ? match.color : StreetPriorityTiers.FALLBACK;
  }

  /** @param {string} key @returns {string} the tier's label, or the raw key if unrecognized. */
  static labelFor(key) {
    const match = StreetPriorityTiers.TIERS.find((tier) => tier.key === key);
    return match ? match.label : key;
  }

  /** Builds a Mapbox 'match' expression coloring each segment by its tier, with a fallback color. */
  static mapboxExpression() {
    const expr = ['match', ['get', 'priority_tier']];
    for (const tier of StreetPriorityTiers.TIERS) expr.push(tier.key, tier.color);
    expr.push(StreetPriorityTiers.FALLBACK);
    return expr;
  }

  /**
   * Publishes the palette as `--priority-<tier>` custom properties so the legend, table badges, and chart series can
   * be styled from CSS without a second hand-maintained copy of these colors.
   */
  static publishCssVars() {
    const root = document.documentElement;
    for (const tier of StreetPriorityTiers.TIERS) {
      root.style.setProperty(`--priority-${tier.key.replace(/_/g, '-')}`, tier.color);
    }
  }
}

/**
 * Renders the per-segment re-audit priority map with Mapbox GL and exposes the same coordination hooks as the Street
 * Status map: hover shows a tooltip and brushes the segment's region, clicking fires onRegionClick, and
 * highlightSegments()/clearHighlight() drive the pinned outline from the outside.
 */
class StreetPriorityMap {
  static #SOURCE = 'imagery-priority-streets';
  static #LINE_LAYER = 'imagery-priority-line';
  static #SELECTED_LAYER = 'imagery-priority-selected';

  #map;
  #mapboxToken;
  #onRegionClick;
  #onRegionHover;
  #onRegionHoverEnd;
  #popup;
  #selectedIds = new Set();
  #hoverId = null;

  /**
   * @param {string} containerId - id of the map container element.
   * @param {{mapboxToken: string, onRegionClick?: function(number): void, onRegionHover?: function(number): void,
   *          onRegionHoverEnd?: function(): void}} [opts]
   */
  constructor(containerId, opts = {}) {
    this.containerId = containerId;
    this.#mapboxToken = opts.mapboxToken;
    this.#onRegionClick = opts.onRegionClick || (() => {});
    this.#onRegionHover = opts.onRegionHover || (() => {});
    this.#onRegionHoverEnd = opts.onRegionHoverEnd || (() => {});
  }

  /**
   * Initializes the map and draws the street segments.
   *
   * @param {object} geojson - FeatureCollection of routable streets, each carrying priority_tier, priority, the audit
   *   counts, and region_id in its properties.
   * @returns {Promise<void>} resolves once the map's first render is ready.
   */
  init(geojson) {
    if (!this.#mapboxToken) throw new Error('StreetPriorityMap: missing Mapbox access token');
    mapboxgl.accessToken = this.#mapboxToken;

    this.#map = new mapboxgl.Map({
      container: this.containerId,
      style: 'mapbox://styles/mapbox/light-v11',
      bounds: StreetPriorityMap.#bounds(geojson),
      fitBoundsOptions: { padding: 24 },
    });
    this.#map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    this.#popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'coverage-popup' });

    return new Promise((resolve) => {
      this.#map.on('load', () => {
        this.#addLayers(geojson);
        this.#wireInteractions();
        resolve();
      });
    });
  }

  #addLayers(geojson) {
    this.#map.addSource(StreetPriorityMap.#SOURCE, { type: 'geojson', data: geojson, promoteId: 'street_edge_id' });

    this.#map.addLayer({
      id: StreetPriorityMap.#LINE_LAYER,
      type: 'line',
      source: StreetPriorityMap.#SOURCE,
      layout: { 'line-cap': 'butt' },
      paint: {
        'line-color': StreetPriorityTiers.mapboxExpression(),
        // 2.2px is the floor at which these hues stay separable against the basemap's own grey roads.
        'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 4.4, 2.2],
      },
    });
    this.#map.addLayer({
      id: StreetPriorityMap.#SELECTED_LAYER,
      type: 'line',
      source: StreetPriorityMap.#SOURCE,
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': StreetPriorityTiers.SELECTED,
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 5, 0],
      },
    });
  }

  #wireInteractions() {
    this.#map.on('mousemove', StreetPriorityMap.#LINE_LAYER, (e) => {
      if (!e.features.length) return;
      this.#map.getCanvas().style.cursor = 'pointer';
      const feature = e.features[0];
      this.#setHover(feature.id, Number(feature.properties.region_id));
      this.#popup.setLngLat(e.lngLat).setHTML(StreetPriorityMap.#popupHtml(feature.properties)).addTo(this.#map);
    });
    this.#map.on('mouseleave', StreetPriorityMap.#LINE_LAYER, () => {
      this.#map.getCanvas().style.cursor = '';
      this.#setHover(null, null);
      this.#popup.remove();
    });
    this.#map.on('click', StreetPriorityMap.#LINE_LAYER, (e) => {
      if (e.features.length) this.#onRegionClick(Number(e.features[0].properties.region_id));
    });
  }

  /** Tracks the hovered segment (for the line-thicken feature-state) and brushes its region via the coordinator. */
  #setHover(segmentId, regionId) {
    if (this.#hoverId === segmentId) return;
    const source = StreetPriorityMap.#SOURCE;
    if (this.#hoverId !== null) this.#map.setFeatureState({ source, id: this.#hoverId }, { hover: false });
    this.#hoverId = segmentId;
    if (segmentId !== null) {
      this.#map.setFeatureState({ source, id: segmentId }, { hover: true });
      this.#onRegionHover(regionId);
    } else {
      this.#onRegionHoverEnd();
    }
  }

  /**
   * Highlights exactly the given set of segments, replacing any prior highlight.
   *
   * @param {number[]} streetEdgeIds - The segments to outline; an empty list clears the highlight.
   */
  highlightSegments(streetEdgeIds) {
    const source = StreetPriorityMap.#SOURCE;
    const next = new Set(streetEdgeIds.map(Number));
    for (const id of this.#selectedIds) {
      if (!next.has(id)) this.#map.setFeatureState({ source, id }, { selected: false });
    }
    for (const id of next) {
      if (!this.#selectedIds.has(id)) this.#map.setFeatureState({ source, id }, { selected: true });
    }
    this.#selectedIds = next;
  }

  /** Clears any pinned-segment highlight. */
  clearHighlight() {
    this.highlightSegments([]);
  }

  /** Builds the hover-popup HTML: the street's tier and priority, and the audit counts that produced them. */
  static #popupHtml(p) {
    const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
    const swatch = `<span class="street-status-swatch" style="background:${
      StreetPriorityTiers.colorFor(p.priority_tier)}" aria-hidden="true"></span>`;
    const priority = Number(p.priority);
    return [
      `<div class="coverage-popup-name">Street ${AdminShell.esc(p.street_edge_id)}</div>`,
      '<dl class="coverage-popup-dl">',
      row('Tier', `${swatch}${AdminShell.esc(StreetPriorityTiers.labelFor(p.priority_tier))}`),
      row('Priority', Number.isFinite(priority) ? priority.toFixed(3) : '—'),
      row('Region', AdminShell.esc(p.region_name)),
      row('Audits counted', `${AdminShell.num(p.fresh_good_count)} current, `
      + `${AdminShell.num(p.outdated_good_count)} outdated, ${AdminShell.num(p.bad_count)} low quality`),
      row('Last audited', AdminShell.esc(p.last_audit_date || 'never')),
      row('Imagery (median)', AdminShell.esc(p.median_newest_capture || 'not polled')),
      '</dl>',
    ].join('');
  }

  /** Computes a [[minLng,minLat],[maxLng,maxLat]] bounds box covering all features. */
  static #bounds(geojson) {
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
    for (const feature of geojson.features) if (feature.geometry) visit(feature.geometry.coordinates);
    return box;
  }
}

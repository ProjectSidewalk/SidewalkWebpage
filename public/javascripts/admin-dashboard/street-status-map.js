/**
 * Categorical palette + labels for the four street_edge_status values (#3888, #4331). This is the presentational
 * source of truth for the Street Status page: the map line colors, the legend, the per-region table columns, and the
 * stacked-bar cells all read STATUSES so they can never disagree. The status *values* mirror the backend enum
 * `app/models/street/StreetEdgeStatus.scala` (and are documented on /v3/api/streets); only the display order, labels,
 * and colors live here, since there is no canonical backend color for street status. Colors are design-system tokens
 * from main.css, chosen for lightness separation so the four stay distinguishable under deuteranopia/protanopia.
 */
class StreetStatusColors {
    /** @type {Array<{key: string, label: string, color: string}>} ordered open → no_imagery → closed → disabled. */
    static STATUSES = [
        { key: 'open',       label: 'Open',       color: '#60A189' }, // --color-pine-600   (healthy/auditable)
        { key: 'no_imagery', label: 'No imagery', color: '#EB724E' }, // --color-orange-500 (the headline problem)
        { key: 'closed',     label: 'Closed',     color: '#B3B3B3' }, // --color-neutral-500 (region not opened)
        { key: 'disabled',   label: 'Disabled',   color: '#424055' },  // --color-asphalt-400 (manually hidden)
    ];

    /** Fallback color for any status value not in STATUSES (shouldn't happen, but keeps unknown data visible). */
    static FALLBACK = '#d0d0d0';

    /** High-contrast color for the currently selected region's segments (distinct from all four status colors). */
    static SELECTED = '#0566f5'; // --color-accent-link

    /** @param {string} status @returns {string} the hex color for a status, or the fallback if unrecognized. */
    static colorFor(status) {
        const match = StreetStatusColors.STATUSES.find((s) => s.key === status);
        return match ? match.color : StreetStatusColors.FALLBACK;
    }

    /** @param {string} status @returns {string} the human-readable label for a status, or the raw value if unknown. */
    static labelFor(status) {
        const match = StreetStatusColors.STATUSES.find((s) => s.key === status);
        return match ? match.label : status;
    }

    /** Builds a Mapbox 'match' expression coloring each segment by its status property, with a fallback color. */
    static mapboxExpression() {
        const expr = ['match', ['get', 'status']];
        for (const s of StreetStatusColors.STATUSES) expr.push(s.key, s.color);
        expr.push(StreetStatusColors.FALLBACK);
        return expr;
    }
}

/**
 * Renders the per-segment street-status map with Mapbox GL and exposes hooks so a coordinator can keep it in sync with
 * the linked per-region table: hover shows a tooltip and brushes the segment's region, clicking fires onRegionClick,
 * and highlightSegments()/clearHighlight() drive the selected outline from the outside. Segments are keyed by
 * street_edge_id, so region-level highlighting is done by passing the set of street_edge_ids that belong to a region.
 */
class StreetStatusMap {
    static #SOURCE = 'street-status-streets';

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
     * @param {object} geojson - A GeoJSON FeatureCollection of streets with status + region_id in properties.
     * @returns {Promise<void>} resolves once the map's first render is ready.
     */
    init(geojson) {
        if (!this.#mapboxToken) throw new Error('StreetStatusMap: missing Mapbox access token');
        mapboxgl.accessToken = this.#mapboxToken;

        this.#map = new mapboxgl.Map({
            container: this.containerId,
            style: 'mapbox://styles/mapbox/light-v11',
            bounds: StreetStatusMap.#bounds(geojson),
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
        this.#map.addSource(StreetStatusMap.#SOURCE, { type: 'geojson', data: geojson, promoteId: 'street_edge_id' });

        // Base segment line colored by status; thickens on hover.
        this.#map.addLayer({
            id: 'street-status-line', type: 'line', source: StreetStatusMap.#SOURCE,
            layout: { 'line-cap': 'round' },
            paint: {
                'line-color': StreetStatusColors.mapboxExpression(),
                'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 4, 1.6],
            },
        });
        // Separate selected outline (a region's segments) in the high-contrast highlight color, drawn on top.
        this.#map.addLayer({
            id: 'street-status-selected', type: 'line', source: StreetStatusMap.#SOURCE,
            layout: { 'line-cap': 'round' },
            paint: {
                'line-color': StreetStatusColors.SELECTED,
                'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 5, 0],
            },
        });
    }

    #wireInteractions() {
        this.#map.on('mousemove', 'street-status-line', (e) => {
            if (!e.features.length) return;
            this.#map.getCanvas().style.cursor = 'pointer';
            const f = e.features[0];
            this.#setHover(f.id, Number(f.properties.region_id));
            this.#popup.setLngLat(e.lngLat).setHTML(StreetStatusMap.#popupHtml(f.properties)).addTo(this.#map);
        });
        this.#map.on('mouseleave', 'street-status-line', () => {
            this.#map.getCanvas().style.cursor = '';
            this.#setHover(null, null);
            this.#popup.remove();
        });
        this.#map.on('click', 'street-status-line', (e) => {
            if (e.features.length) this.#onRegionClick(Number(e.features[0].properties.region_id));
        });
    }

    /** Tracks the hovered segment (for the line-thicken feature-state) and brushes its region via the coordinator. */
    #setHover(segmentId, regionId) {
        if (this.#hoverId === segmentId) return;
        const src = StreetStatusMap.#SOURCE;
        if (this.#hoverId !== null) this.#map.setFeatureState({ source: src, id: this.#hoverId }, { hover: false });
        this.#hoverId = segmentId;
        if (segmentId !== null) {
            this.#map.setFeatureState({ source: src, id: segmentId }, { hover: true });
            this.#onRegionHover(regionId);
        } else {
            this.#onRegionHoverEnd();
        }
    }

    /**
     * Highlights exactly the given set of segments (e.g. all street_edge_ids in a region), replacing any prior
     * highlight. The coordinator resolves region → segment ids and passes them here.
     * @param {number[]} streetEdgeIds
     */
    highlightSegments(streetEdgeIds) {
        const src = StreetStatusMap.#SOURCE;
        const next = new Set(streetEdgeIds.map(Number));
        for (const id of this.#selectedIds) {
            if (!next.has(id)) this.#map.setFeatureState({ source: src, id }, { selected: false });
        }
        for (const id of next) {
            if (!this.#selectedIds.has(id)) this.#map.setFeatureState({ source: src, id }, { selected: true });
        }
        this.#selectedIds = next;
    }

    /** Clears any selected-segment highlight. */
    clearHighlight() {
        this.highlightSegments([]);
    }

    /** Builds the hover-popup HTML showing a segment's status and activity. */
    static #popupHtml(p) {
        const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
        const swatch = `<span class="street-status-swatch" style="background:${StreetStatusColors.colorFor(p.status)}"`
            + ' aria-hidden="true"></span>';
        return [
            `<div class="coverage-popup-name">Street ${p.street_edge_id}</div>`,
            '<dl class="coverage-popup-dl">',
            row('Status', `${swatch}${StreetStatusColors.labelFor(p.status)}`),
            row('Region', p.region_name),
            row('Way type', p.way_type),
            row('Audits', (p.audit_count || 0).toLocaleString()),
            row('Labels', (p.label_count || 0).toLocaleString()),
            row('Contributors', (p.user_count || 0).toLocaleString()),
            '</dl>',
        ].join('');
    }

    /** Computes a [[minLng,minLat],[maxLng,maxLat]] bounds box covering all features. */
    static #bounds(geojson) {
        let minLng = Infinity;
        let minLat = Infinity;
        let maxLng = -Infinity;
        let maxLat = -Infinity;
        const visit = (coords) => {
            if (typeof coords[0] === 'number') {
                minLng = Math.min(minLng, coords[0]);
                maxLng = Math.max(maxLng, coords[0]);
                minLat = Math.min(minLat, coords[1]);
                maxLat = Math.max(maxLat, coords[1]);
            } else {
                coords.forEach(visit);
            }
        };
        for (const f of geojson.features) if (f.geometry) visit(f.geometry.coordinates);
        return [[minLng, minLat], [maxLng, maxLat]];
    }
}

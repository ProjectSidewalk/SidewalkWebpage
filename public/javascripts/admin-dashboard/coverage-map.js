/**
 * Sequential color scale for coverage (ColorBrewer "Blues", colorblind-safe). Shared by the map fill, the Vega bar
 * chart, and the legend so all three agree. Keep STOPS in sync with the --coverage-c* tokens in admin-dashboard.css.
 */
class CoverageColors {
    /** @type {Array<[number, string]>} [rate 0..1, hex] control points, ascending by rate. */
    static STOPS = [[0, '#eff3ff'], [0.33, '#bdd7e7'], [0.66, '#6baed6'], [1, '#2171b5']];

    /** High-contrast color for the currently selected region (matches --coverage-selected). */
    static SELECTED = '#f68d3e';

    /**
     * Linearly interpolates the scale (in RGB) at the given rate.
     * @param {number} rate - Coverage fraction in [0, 1].
     * @returns {string} An rgb(...) color string.
     */
    static forRate(rate) {
        const r = Math.max(0, Math.min(1, Number.isFinite(rate) ? rate : 0));
        const stops = CoverageColors.STOPS;
        for (let i = 1; i < stops.length; i++) {
            if (r <= stops[i][0]) {
                const [lo, loHex] = stops[i - 1];
                const [hi, hiHex] = stops[i];
                const t = (r - lo) / (hi - lo || 1);
                return CoverageColors.#lerpHex(loHex, hiHex, t);
            }
        }
        return stops[stops.length - 1][1];
    }

    /** Builds a Mapbox 'interpolate' expression over completion_rate using the same stops. */
    static mapboxExpression() {
        const expr = ['interpolate', ['linear'], ['get', 'completion_rate']];
        for (const [rate, hex] of CoverageColors.STOPS) expr.push(rate, hex);
        return expr;
    }

    static #lerpHex(a, b, t) {
        const pa = CoverageColors.#parse(a);
        const pb = CoverageColors.#parse(b);
        const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
        return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }

    static #parse(hex) {
        const h = hex.replace('#', '');
        return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    }
}

/** Small formatting helpers shared across the coverage page. */
class CoverageFormat {
    /** @param {number} rate - Fraction in [0,1]. @returns {string} e.g. "73%". */
    static pct(rate) { return `${Math.round((rate || 0) * 100)}%`; }

    /** @param {number} meters @returns {string} distance in km with one decimal, e.g. "4.2 km". */
    static km(meters) { return `${((meters || 0) / 1000).toFixed(1)} km`; }
}

/**
 * Renders the region-coverage choropleth with Mapbox GL and exposes hooks so a coordinator can keep it in sync with
 * the linked bar chart: hover shows a tooltip, clicking a region fires onRegionClick, and highlightRegion()/
 * clearHighlight() drive the selected-region outline from the outside.
 */
class CoverageMap {
    static #SOURCE = 'coverage-regions';

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
     * Initializes the map and draws the regions.
     * @param {object} geojson - A GeoJSON FeatureCollection of regions with completion_rate in properties.
     * @returns {Promise<void>} resolves once the map's first render is ready.
     */
    init(geojson) {
        if (!this.#mapboxToken) throw new Error('CoverageMap: missing Mapbox access token');
        mapboxgl.accessToken = this.#mapboxToken;

        this.#map = new mapboxgl.Map({
            container: this.containerId,
            style: 'mapbox://styles/mapbox/light-v11',
            bounds: CoverageMap.#bounds(geojson),
            fitBoundsOptions: { padding: 24 }
        });
        this.#map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
        this.#popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'coverage-popup' });

        return new Promise(resolve => {
            this.#map.on('load', () => {
                this.#addLayers(geojson);
                this.#wireInteractions();
                resolve();
            });
        });
    }

    #addLayers(geojson) {
        this.#map.addSource(CoverageMap.#SOURCE, { type: 'geojson', data: geojson, promoteId: 'region_id' });

        this.#map.addLayer({
            id: 'coverage-fill', type: 'fill', source: CoverageMap.#SOURCE,
            paint: { 'fill-color': CoverageColors.mapboxExpression(), 'fill-opacity': 0.85 }
        });
        // Outline thickens on hover.
        this.#map.addLayer({
            id: 'coverage-outline', type: 'line', source: CoverageMap.#SOURCE,
            paint: {
                'line-color': '#ffffff',
                'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 0.6]
            }
        });
        // Separate selected-region outline in the high-contrast highlight color.
        this.#map.addLayer({
            id: 'coverage-selected', type: 'line', source: CoverageMap.#SOURCE,
            paint: {
                'line-color': CoverageColors.SELECTED,
                'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 4, 0]
            }
        });
    }

    #wireInteractions() {
        this.#map.on('mousemove', 'coverage-fill', e => {
            if (!e.features.length) return;
            this.#map.getCanvas().style.cursor = 'pointer';
            const f = e.features[0];
            this.#setHover(f.id);
            this.#popup.setLngLat(e.lngLat).setHTML(CoverageMap.#popupHtml(f.properties)).addTo(this.#map);
        });
        this.#map.on('mouseleave', 'coverage-fill', () => {
            this.#map.getCanvas().style.cursor = '';
            this.#setHover(null);
            this.#popup.remove();
        });
        this.#map.on('click', 'coverage-fill', e => {
            if (e.features.length) this.#onRegionClick(Number(e.features[0].id));
        });
    }

    #setHover(id) {
        if (this.#hoverId === id) return;
        const src = CoverageMap.#SOURCE;
        if (this.#hoverId !== null) this.#map.setFeatureState({ source: src, id: this.#hoverId }, { hover: false });
        this.#hoverId = id;
        if (id !== null) {
            this.#map.setFeatureState({ source: src, id }, { hover: true });
            this.#onRegionHover(id);
        } else {
            this.#onRegionHoverEnd();
        }
    }

    /**
     * Highlights exactly the given set of regions (outlining them and dimming the rest), replacing any prior
     * highlight. Accepts one id (map/table/bar selection) or many (a histogram coverage bucket).
     * @param {number[]} ids
     */
    highlightRegions(ids) {
        const src = CoverageMap.#SOURCE;
        const next = new Set(ids.map(Number));
        for (const id of this.#selectedIds) {
            if (!next.has(id)) this.#map.setFeatureState({ source: src, id }, { selected: false });
        }
        for (const id of next) {
            if (!this.#selectedIds.has(id)) this.#map.setFeatureState({ source: src, id }, { selected: true });
        }
        this.#selectedIds = next;
    }

    /** Convenience for a single-region highlight. @param {number} regionId */
    highlightRegion(regionId) {
        this.highlightRegions([regionId]);
    }

    /** Clears any selected-region highlight. */
    clearHighlight() {
        this.highlightRegions([]);
    }

    /** Builds the hover-popup HTML showing a region's coverage details. */
    static #popupHtml(p) {
        const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
        return `<div class="coverage-popup-name">${p.name}</div>` +
            '<dl class="coverage-popup-dl">' +
            row('Coverage', CoverageFormat.pct(p.completion_rate)) +
            row('Audited', `${CoverageFormat.km(p.audited_distance_m)} / ${CoverageFormat.km(p.total_distance_m)}`) +
            row('Streets', (p.street_count || 0).toLocaleString()) +
            row('Audits', (p.audit_count || 0).toLocaleString()) +
            row('Labels', (p.label_count || 0).toLocaleString()) +
            row('Contributors', (p.user_count || 0).toLocaleString()) +
            '</dl>';
    }

    /** Computes a [[minLng,minLat],[maxLng,maxLat]] bounds box covering all features. */
    static #bounds(geojson) {
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
        const visit = coords => {
            if (typeof coords[0] === 'number') {
                minLng = Math.min(minLng, coords[0]); maxLng = Math.max(maxLng, coords[0]);
                minLat = Math.min(minLat, coords[1]); maxLat = Math.max(maxLat, coords[1]);
            } else {
                coords.forEach(visit);
            }
        };
        for (const f of geojson.features) if (f.geometry) visit(f.geometry.coordinates);
        return [[minLng, minLat], [maxLng, maxLat]];
    }
}

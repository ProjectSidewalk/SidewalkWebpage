/**
 * AccessScore: Streets Map Preview Generator.
 *
 * Renders a live map of a sample region's streets, fed directly from /v3/api/accessScoreStreets. Each street is colored
 * on a fixed red→yellow→green ramp by its AccessScore (already in [0, 1]); unaudited streets (null score) are gray.
 * Hover/click a street to see its score and per-type cluster breakdown.
 *
 * @requires A DOM element with id 'access-score-streets-preview'
 * @requires Leaflet.js
 */

(function () {
    let config = {
        apiBaseUrl: '/v3/api',
        mainContainerId: 'access-score-streets-preview',
        endpoint: '/accessScoreStreets',
        regionsEndpoint: '/regions',
        mapHeight: 500,
    };

    // Diverging red→yellow→green ramp (ColorBrewer RdYlGn): low accessibility is red, high is green (per the paper).
    const RAMP = ['#d7191c', '#fdae61', '#ffffbf', '#a6d96a', '#1a9641'];
    const NONE_COLOR = '#888888'; // Unaudited streets (null score).

    /** Interpolates between two hex colors by a 0–1 factor. */
    function interpolateColor(color1, color2, factor) {
        const c1 = { r: parseInt(color1.slice(1, 3), 16), g: parseInt(color1.slice(3, 5), 16), b: parseInt(color1.slice(5, 7), 16) };
        const c2 = { r: parseInt(color2.slice(1, 3), 16), g: parseInt(color2.slice(3, 5), 16), b: parseInt(color2.slice(5, 7), 16) };
        const r = Math.round(c1.r + (c2.r - c1.r) * factor);
        const g = Math.round(c1.g + (c2.g - c1.g) * factor);
        const b = Math.round(c1.b + (c2.b - c1.b) * factor);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    /** Maps a value in [0, 1] to a color along the multi-stop RAMP. */
    function rampColor(value) {
        const v = Math.max(0, Math.min(1, value));
        const segments = RAMP.length - 1;
        const scaled = v * segments;
        const i = Math.min(Math.floor(scaled), segments - 1);
        return interpolateColor(RAMP[i], RAMP[i + 1], scaled - i);
    }

    window.AccessScoreStreetsPreview = {
        _map: null,
        _layer: null,
        _legend: null,

        /** Apply caller config overrides. */
        setup(options) {
            config = Object.assign(config, options);
            return this;
        },

        /** Fetch the data and render the map (or a friendly message on failure). */
        init() {
            const container = document.getElementById(config.mainContainerId);
            if (!container) {
                console.error('AccessScore streets preview container not found.');
                return Promise.reject(new Error('container not found'));
            }
            container.style.height = `${config.mapHeight}px`;
            const loading = document.createElement('div');
            loading.className = 'loading-message';
            loading.textContent = 'Loading AccessScore data...';
            container.appendChild(loading);

            // Limit the preview to a single region so it stays legible and the response stays small.
            return this.fetchSampleRegionId()
                .then((regionId) => this.fetchStreets(regionId))
                .then((streets) => {
                    container.innerHTML = '';
                    this.renderMap(container, streets);
                })
                .catch((error) => {
                    console.error('Error rendering AccessScore streets preview:', error);
                    container.innerHTML = '';
                    const message = document.createElement('div');
                    message.className = 'no-data-message';
                    message.textContent = 'Unable to load AccessScore data for the preview.';
                    container.appendChild(message);
                });
        },

        /** Pick a sample region (the one with the most labels) to keep the preview focused. Null = whole city. */
        fetchSampleRegionId() {
            // getRegionWithMostLabels returns a flat Region object (region_id at the top level), not a GeoJSON Feature.
            return fetch(`${config.apiBaseUrl}/regionWithMostLabels?source=apiDocs`)
                .then((response) => (response.ok ? response.json() : null))
                .then((region) => (region ? region.region_id : null))
                .catch(() => null);
        },

        /** Fetch street AccessScores (optionally scoped to a region) as a GeoJSON FeatureCollection. */
        fetchStreets(regionId) {
            const regionParam = regionId ? `&regionId=${regionId}` : '';
            return fetch(`${config.apiBaseUrl}${config.endpoint}?inline=true&source=apiDocs${regionParam}`)
                .then((response) => {
                    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
                    return response.json();
                });
        },

        /** Build the map, draw the street polylines, and add the legend. */
        renderMap(container, streets) {
            const features = streets.features || [];

            const mapElement = document.createElement('div');
            mapElement.id = 'access-score-streets-map';
            container.appendChild(mapElement);

            const map = L.map('access-score-streets-map', { scrollWheelZoom: false });
            this._map = map;
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
                subdomains: 'abcd', maxZoom: 19,
            }).addTo(map);

            if (features.length === 0) {
                map.setView([0, 0], 2);
                this.addNoDataMessage(map, 'No streets found for this city.');
                return;
            }

            this._layer = L.geoJSON(streets, {
                style: (feature) => this.styleForFeature(feature),
                onEachFeature: (feature, layer) => this.bindInteractions(feature, layer),
            }).addTo(map);
            map.fitBounds(this._layer.getBounds(), { padding: [10, 10] });

            const countDiv = document.createElement('div');
            countDiv.className = 'counter-badge';
            countDiv.textContent = `${features.length} street${features.length === 1 ? '' : 's'}`;
            map.getContainer().appendChild(countDiv);

            this.updateLegend();
        },

        /** Leaflet style for a street: stroke colored by score, gray and thinner when unaudited (null). */
        styleForFeature(feature) {
            const score = feature.properties.score;
            if (score === null || score === undefined) {
                return { color: NONE_COLOR, weight: 2, opacity: 0.5 };
            }
            return { color: rampColor(score), weight: 4, opacity: 0.9 };
        },

        /** Popup + hover behavior for a street, including a compact per-type cluster breakdown. */
        bindInteractions(feature, layer) {
            const p = feature.properties;
            const score = (p.score === null || p.score === undefined) ? 'N/A (unaudited)' : p.score.toFixed(3);
            const counts = p.cluster_counts || {};
            const breakdown = Object.keys(counts).filter((k) => counts[k] > 0).map((k) => `${k}: ${counts[k]}`).join(', ')
                || 'no scored features';
            layer.bindPopup(`
                <div class="as-popup">
                    <h4>Street ${p.street_edge_id}</h4>
                    <p><span class="as-score">${score}</span> AccessScore</p>
                    <p><strong>Audits:</strong> ${p.audit_count} &nbsp; <strong>Labels:</strong> ${p.label_count}</p>
                    <p class="as-breakdown"><strong>Clusters:</strong> ${breakdown}</p>
                </div>
            `, { autoPanPaddingTopLeft: L.point(10, 10), autoPanPaddingBottomRight: L.point(260, 130) });

            layer.on('mouseover', function () {
                this.setStyle({ weight: 7, opacity: 1 });
                this.bringToFront();
            });
            layer.on('mouseout', () => this._layer.resetStyle(layer));
        },

        /** Build the fixed 0→1 AccessScore gradient legend. */
        updateLegend() {
            const map = this._map;
            if (this._legend) map.removeControl(this._legend);
            const legend = L.control({ position: 'bottomright' });
            legend.onAdd = function () {
                const div = L.DomUtil.create('div', 'info legend continuous-legend');
                div.innerHTML = `<h4>AccessScore (0 = low, 1 = high)</h4>`;
                const gradientContainer = L.DomUtil.create('div', 'gradient-container', div);
                gradientContainer.style.cssText = 'width: 200px; height: 20px; position: relative; margin: 5px 0;';
                const gradientBar = L.DomUtil.create('div', 'gradient-bar', gradientContainer);
                gradientBar.style.cssText
                    = `width: 100%; height: 100%; background: linear-gradient(to right, ${RAMP.join(', ')});`;
                const labelsContainer = L.DomUtil.create('div', 'legend-labels', div);
                labelsContainer.style.cssText = 'display: flex; justify-content: space-between; width: 200px;';
                L.DomUtil.create('div', 'legend-tick', labelsContainer).textContent = '0';
                L.DomUtil.create('div', 'legend-tick', labelsContainer).textContent = '1';
                return div;
            };
            legend.addTo(map);
            this._legend = legend;
        },

        /** Show an on-map message (e.g. when there is no data). */
        addNoDataMessage(map, text) {
            const div = document.createElement('div');
            div.className = 'no-data-message';
            div.textContent = text;
            map.getContainer().appendChild(div);
        },
    };
})();

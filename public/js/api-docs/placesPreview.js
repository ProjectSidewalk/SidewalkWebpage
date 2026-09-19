/**
 * Places Map Preview Generator (#5311).
 *
 * Renders a live map of a sample region's places, fed directly from /v3/api/places. Every place is one dot in the
 * marker color the AccessScore map uses; hover a place to highlight it, click for its name, category, and nearest
 * street. The legend counts the categories present.
 *
 * @requires A DOM element with id 'places-preview'
 * @requires mapbox-gl and js/api-docs/apiDocsMap.js
 */

(function () {
  const PLACE_SOURCE = 'places';
  const PLACE_LAYER = 'place-points';

  let config = {
    apiBaseUrl: '/v3/api',
    mainContainerId: 'places-preview',
    mapboxApiKey: '',
    endpoint: '/places',
  };

  const MARKER_COLOR = ApiDocsTheme.color('--color-place-marker');
  const HALO_COLOR = ApiDocsTheme.color('--color-place-marker-halo');

  window.PlacesPreview = {
    /** Apply caller config overrides. */
    setup(options) {
      config = Object.assign(config, options);
      return this;
    },

    /** Fetch the data and render the map (or a friendly message on failure). */
    async init() {
      const container = document.getElementById(config.mainContainerId);
      if (!container) {
        console.error('Places preview container not found.');
        return;
      }

      const loading = document.createElement('div');
      loading.className = 'loading-message';
      loading.textContent = 'Loading places...';
      container.appendChild(loading);

      try {
        // Limit the preview to a single region so it stays legible and the response stays small.
        const regionId = await this.fetchSampleRegionId();
        const places = await this.fetchPlaces(regionId);
        container.innerHTML = '';
        await this.renderMap(container, places);
      } catch (error) {
        console.error('Error rendering places preview:', error);
        container.innerHTML = '<div class="map-message" role="alert">Unable to load places for the preview.</div>';
      }
    },

    /** Pick a sample region (the one with the most labels) to keep the preview focused. Null = whole city. */
    fetchSampleRegionId() {
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}/regionWithMostLabels`)
        .then((region) => (region ? region.properties.region_id : null))
        .catch(() => null);
    },

    /** Fetch places (optionally scoped to a region) as a GeoJSON FeatureCollection. */
    fetchPlaces(regionId) {
      const regionParam = regionId ? `&regionId=${regionId}` : '';
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}${config.endpoint}?inline=true${regionParam}`);
    },

    /** Build the map, draw the places, and add the legend. */
    async renderMap(container, places) {
      const features = places.features || [];

      const mapElement = document.createElement('div');
      mapElement.id = 'places-map';
      container.appendChild(mapElement);

      const bounds = features.length ? featureCollectionBounds({ type: 'FeatureCollection', features }) : null;
      const map = await ApiDocsMap.create({
        container: mapElement,
        mapboxApiKey: config.mapboxApiKey,
        ...(bounds ? { bounds } : { center: [0, 0], zoom: 1 }),
      });

      if (!features.length) {
        this.addNoDataMessage(map, 'No places have been fetched for this city yet.');
        return;
      }

      // promoteId lifts place_id into the feature id that setFeatureState needs for the hover styling below.
      map.addSource(PLACE_SOURCE, { type: 'geojson', data: places, promoteId: 'place_id' });
      map.addLayer({
        id: PLACE_LAYER,
        type: 'circle',
        source: PLACE_SOURCE,
        paint: {
          'circle-color': MARKER_COLOR,
          'circle-stroke-color': HALO_COLOR,
          'circle-stroke-width': 1.5,
          'circle-radius': ApiDocsMap.whenHovered(9, 6),
          'circle-opacity': ApiDocsMap.whenHovered(1, 0.9),
        },
      });
      ApiDocsMap.addHoverState(map, PLACE_LAYER, PLACE_SOURCE);
      this.addPlacePopups(map);

      const countChip = ApiDocsMap.addOverlay(map, 'top-right', 'map-chip');
      countChip.textContent = `${features.length} place${features.length === 1 ? '' : 's'}`;

      const legend = ApiDocsMap.addOverlay(map, 'bottom-left', 'map-legend');
      this.renderCategoryLegend(legend, features);
    },

    /**
     * Fills the legend with one row per category present, and how many places it holds.
     *
     * @param {HTMLElement} element - The overlay element to fill.
     * @param {Array<GeoJSON.Feature>} features - The rendered places.
     */
    renderCategoryLegend(element, features) {
      const counts = new Map();
      features.forEach((f) => counts.set(f.properties.category, (counts.get(f.properties.category) || 0) + 1));
      const rows = [...counts.entries()].map(([category, n]) => `
        <div class="map-legend-item">
          <span class="map-legend-swatch" style="background-color: ${MARKER_COLOR};"></span>
          ${category} (${n})
        </div>
      `).join('');
      element.innerHTML = `<h4>Places by category</h4>${rows}`;
    },

    /** Wire up the click popup for the place layer. */
    addPlacePopups(map) {
      map.on('click', PLACE_LAYER, (e) => {
        const feature = e.features[0];
        const p = feature.properties;
        const name = p.name ? this.escapeHtml(p.name) : `Unnamed ${p.category}`;
        const street = (p.nearest_street_edge_id === null || p.nearest_street_edge_id === undefined)
          ? 'no street within 250 m'
          : `street ${p.nearest_street_edge_id}, ${Math.round(p.nearest_street_distance_m)} m away`;
        const osm = p.osm_url ? `<a href="${p.osm_url}" target="_blank" rel="noopener">View on OpenStreetMap</a>` : '';

        ApiDocsMap.popup(map, e.lngLat, `
          <h4>${name}</h4>
          <p><strong>Category:</strong> ${p.category} &nbsp; <strong>Place ID:</strong> ${p.place_id}</p>
          <p><strong>Nearest street:</strong> ${street}</p>
          <p>${osm}</p>
        `);
      });
    },

    /**
     * Escapes a value for an HTML sink: place names are OSM contributors' text.
     *
     * @param {string} value - The raw text.
     * @returns {string} The text with HTML metacharacters escaped.
     */
    escapeHtml(value) {
      return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    /** Show an on-map message (e.g. when there is no data). */
    addNoDataMessage(map, text) {
      const div = document.createElement('div');
      div.className = 'map-message';
      div.setAttribute('role', 'status');
      div.textContent = text;
      map.getContainer().appendChild(div);
    },
  };
})();

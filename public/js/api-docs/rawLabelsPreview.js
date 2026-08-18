/**
 * Raw Labels Map Preview Generator.
 *
 * This script generates a live map preview of raw PS labels by fetching data directly from the Raw Labels API.
 *
 * @requires DOM element with id 'raw-labels-preview'
 * @requires mapbox-gl and js/api-docs/apiDocsMap.js
 */

(function () {
  const LABELS_LAYER = 'raw-labels';
  const REGION_SOURCE = 'preview-region';

  // Outline color for the region the preview is scoped to. Presentational only — it mirrors no backend value, and
  // is picked to stay distinct from every label type color against the dark basemap.
  const REGION_COLOR = '#0077cc';

  // Configuration options - can be overridden by calling setup().
  let config = {
    apiBaseUrl: '/v3/api',
    containerId: 'raw-labels-preview',
    mapboxApiKey: '',
    rawLabelsEndpoint: '/rawLabels',
    labelTypesEndpoint: '/labelTypes',
    regionWithMostLabelsEndpoint: '/regionWithMostLabels',
  };

  // Store label type information for coloring labels.
  let labelTypeInfo = {};

  // Public API.
  window.RawLabelsPreview = {
    /**
     * Configure the raw labels preview.
     * @param {object} options - Configuration options
     * @returns {object} The RawLabelsPreview object for chaining
     */
    setup(options) {
      config = Object.assign(config, options);
      return this;
    },

    /**
     * Initialize the raw labels preview map.
     * @returns {Promise} A promise that resolves when the preview is rendered
     */
    async init() {
      const container = document.getElementById(config.containerId);

      if (!container) {
        console.error(`Container element with id '${config.containerId}' not found.`);
        return Promise.reject(new Error('Container element not found'));
      }

      // Initialize with loading message.
      const loadingMessage = document.createElement('div');
      loadingMessage.className = 'loading-message';
      loadingMessage.textContent = 'Loading raw labels data...';
      container.appendChild(loadingMessage);

      // First load label types, then get region with most labels, then load labels.
      try {
        const typeData = await this.fetchLabelTypes();
        labelTypeInfo = typeData.label_types.reduce((acc, type) => {
          acc[type.name] = { color: type.color, description: type.description };
          return acc;
        }, {});

        const regionData = await this.fetchRegionWithMostLabels();
        container.innerHTML = '';
        const map = await this.createMap(container, regionData);

        const labels = await this.fetchLabelsByRegionId(regionData.region_id);
        this.displayLabelsOnMap(map, labels);
      } catch (error) {
        container.innerHTML = `<div class="message message-error">Failed to load raw labels: ${error.message}</div>`;
        console.error('Raw labels preview error:', error);
        // The failure is already surfaced in the container above, and init() is fire-and-forget at every call
        // site (app/views/apiDocs/*), so re-rejecting here can only ever become an unhandled rejection.
      }
    },

    /**
     * Fetch label types from the API.
     * @returns {Promise} A promise that resolves with the label types data
     */
    fetchLabelTypes() {
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}${config.labelTypesEndpoint}`);
    },

    /**
     * Fetch region with the most labels.
     * @returns {Promise} A promise that resolves with the region data
     */
    fetchRegionWithMostLabels() {
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}${config.regionWithMostLabelsEndpoint}`)
        .catch((error) => {
          console.error('Error fetching region with most labels:', error);
          throw new Error('Failed to fetch region with most labels');
        });
    },

    /**
     * Fetch labels by region ID.
     * @param {number} regionId - ID of the region
     * @returns {Promise} A promise that resolves with the labels data
     */
    fetchLabelsByRegionId(regionId) {
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}${config.rawLabelsEndpoint}?regionId=${regionId}`);
    },

    /**
     * Create the map, framed on the region the preview is scoped to and with that region outlined.
     * @param {HTMLElement} container - Container element for the map
     * @param {object} regionData - Data about the region to display
     * @returns {Promise<object>} A promise that resolves with the loaded Mapbox map
     */
    async createMap(container, regionData) {
      const map = await ApiDocsMap.create({
        container,
        mapboxApiKey: config.mapboxApiKey,
        bounds: ApiDocsMap.geometryBounds(regionData.geometry),
      });

      // Outline the region so it's clear which slice of the city the labels below are drawn from.
      map.addSource(REGION_SOURCE, {
        type: 'geojson',
        data: { type: 'Feature', geometry: regionData.geometry, properties: {} },
      });
      map.addLayer({
        id: 'region-fill',
        type: 'fill',
        source: REGION_SOURCE,
        paint: { 'fill-color': REGION_COLOR, 'fill-opacity': 0.1 },
      });
      map.addLayer({
        id: 'region-outline',
        type: 'line',
        source: REGION_SOURCE,
        paint: { 'line-color': REGION_COLOR, 'line-width': 2, 'line-opacity': 0.7 },
      });

      const regionTitle = ApiDocsMap.addOverlay(map, 'top-right', 'map-chip');
      regionTitle.innerHTML = `<strong>Region:</strong> ${regionData.name || 'Sample Region'}`;

      return map;
    },

    /**
     * Display labels on the map.
     * @param {object} map - The Mapbox map object
     * @param {object} labels - GeoJSON data containing the labels
     */
    displayLabelsOnMap(map, labels) {
      if (!labels.features || labels.features.length === 0) {
        const noLabelsDiv = document.createElement('div');
        noLabelsDiv.className = 'no-labels-message';
        noLabelsDiv.textContent = 'No labels found in this region.';
        map.getContainer().appendChild(noLabelsDiv);
        return;
      }

      map.addSource(LABELS_LAYER, { type: 'geojson', data: labels });
      map.addLayer({
        id: LABELS_LAYER,
        type: 'circle',
        source: LABELS_LAYER,
        paint: {
          'circle-radius': 4,
          'circle-color': ApiDocsMap.labelTypeColorExpression(labelTypeInfo),
          'circle-opacity': 0.75,
          'circle-stroke-color': '#000000',
          'circle-stroke-width': 1,
        },
      });

      this.addLabelPopups(map);

      const countChip = ApiDocsMap.addOverlay(map, 'top-right', 'map-chip');
      countChip.textContent = `Showing ${labels.features.length} labels`;

      // The legend lists only the types actually drawn, so a region with no signals doesn't advertise them.
      const typesInData = [...new Set(labels.features.map((feature) => feature.properties.label_type))];
      const legend = ApiDocsMap.addOverlay(map, 'bottom-left', 'map-legend');
      ApiDocsMap.renderLabelTypeLegend(legend, 'Label Types', typesInData, labelTypeInfo,
        'No labels in this region');
    },

    /**
     * Wire up the click popup and hover cursor for the label layer.
     * @param {object} map - The Mapbox map object
     */
    addLabelPopups(map) {
      map.on('click', LABELS_LAYER, (e) => {
        const feature = e.features[0];
        const props = feature.properties;

        const severity = props.severity ? `Severity: ${props.severity}` : 'No severity rating';
        const tagList = ApiDocsMap.featureProp(props, 'tags');
        const tags = tagList && tagList.length ? `Tags: ${tagList.join(', ')}` : 'No tags';
        const timeCreated = props.time_created ? new Date(props.time_created).toLocaleDateString() : 'Unknown date';

        let validationStatus = 'Not validated';
        if (props.correct === true) {
          validationStatus = `Validated (${props.agree_count} agree, ${props.disagree_count} disagree)`;
        } else if (props.correct === false) {
          validationStatus = `Invalidated (${props.agree_count} agree, ${props.disagree_count} disagree)`;
        }

        // Absent for providers without a public viewer (e.g. infra3d).
        const panoLink = props.pano_url
          ? `<p><a href="${props.pano_url}" target="_blank" rel="noopener noreferrer">View panorama</a></p>`
          : '';

        ApiDocsMap.popup(map, feature.geometry.coordinates.slice(), `
          <h4>${props.label_type}</h4>
          <p>${labelTypeInfo[props.label_type]?.description || ''}</p>
          <p>${severity}</p>
          <p>${tags}</p>
          <p>Created: ${timeCreated}</p>
          <p>${validationStatus}</p>
          <p>Label ID: ${props.label_id}</p>
          ${panoLink}
        `);
      });

      map.on('mouseenter', LABELS_LAYER, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', LABELS_LAYER, () => {
        map.getCanvas().style.cursor = '';
      });
    },
  };
})();

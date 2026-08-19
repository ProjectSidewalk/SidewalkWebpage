/**
 * Label Clusters Map Preview Generator.
 *
 * Generates a live map preview of PS label clusters by fetching data directly from the Label Clusters API.
 *
 * @requires DOM element with id 'label-clusters-preview'
 * @requires mapbox-gl and js/api-docs/apiDocsMap.js
 */

(function () {
  const CLUSTERS_LAYER = 'label-clusters';
  const REGION_SOURCE = 'preview-region';

  // Presentational only — it mirrors no backend value, and is picked to stay distinct from every label type color
  // against the dimmed basemap.
  const REGION_COLOR = '#0077cc';

  let config = {
    apiBaseUrl: '/v3/api',
    containerId: 'label-clusters-preview',
    mapboxApiKey: '',
    labelClustersEndpoint: '/labelClusters',
    labelTypesEndpoint: '/labelTypes',
    regionWithMostLabelsEndpoint: '/regionWithMostLabels',
  };

  let labelTypeInfo = {};

  window.LabelClustersPreview = {
    /**
     * Configure the label clusters preview.
     * @param {object} options - Configuration options
     * @returns {object} The LabelClustersPreview object for chaining
     */
    setup(options) {
      config = Object.assign(config, options);
      return this;
    },

    /**
     * Initialize the label clusters preview map.
     * @returns {Promise} A promise that resolves when the preview is rendered
     */
    async init() {
      const container = document.getElementById(config.containerId);

      if (!container) {
        console.error(`Container element with id '${config.containerId}' not found.`);
        return Promise.reject(new Error('Container element not found'));
      }

      const loadingMessage = document.createElement('div');
      loadingMessage.className = 'loading-message';
      loadingMessage.textContent = 'Loading label clusters data...';
      container.appendChild(loadingMessage);

      try {
        const typeData = await this.fetchLabelTypes();
        labelTypeInfo = typeData.label_types.reduce((acc, type) => {
          acc[type.name] = { color: type.color, description: type.description };
          return acc;
        }, {});

        const regionData = await this.fetchRegionWithMostLabels();
        container.innerHTML = '';
        const map = await this.createMap(container, regionData);

        const clusters = await this.fetchClustersByRegionId(regionData.region_id);
        this.displayClustersOnMap(map, clusters);
      } catch (error) {
        container.innerHTML = `<div class="message message-error">Failed to load label clusters: `
          + `${error.message}</div>`;
        console.error('Label clusters preview error:', error);
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
     * Fetch clusters by region ID.
     * @param {number} regionId - ID of the region
     * @returns {Promise} A promise that resolves with the clusters data
     */
    fetchClustersByRegionId(regionId) {
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}${config.labelClustersEndpoint}?regionId=${regionId}`);
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

      // Outline the region so it's clear which slice of the city the clusters below are drawn from.
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
     * Display clusters on the map.
     * @param {object} map - The Mapbox map object
     * @param {object} clusters - GeoJSON data containing the label clusters
     */
    displayClustersOnMap(map, clusters) {
      if (!clusters.features || clusters.features.length === 0) {
        const noClustersDiv = document.createElement('div');
        noClustersDiv.className = 'no-clusters-message';
        noClustersDiv.textContent = 'No label clusters found in this region.';
        map.getContainer().appendChild(noClustersDiv);
        return;
      }

      map.addSource(CLUSTERS_LAYER, { type: 'geojson', data: clusters });
      map.addLayer({
        id: CLUSTERS_LAYER,
        type: 'circle',
        source: CLUSTERS_LAYER,
        paint: {
          // Bigger circle for a cluster more people confirmed, capped so a heavily-labeled corner doesn't swallow
          // its neighbors.
          'circle-radius': ['min', 8, ['+', 3, ['*', 0.5, ['coalesce', ['get', 'cluster_size'], 1]]]],
          'circle-color': ApiDocsMap.labelTypeColorExpression(labelTypeInfo),
          'circle-opacity': 0.75,
          'circle-stroke-color': '#000000',
          'circle-stroke-width': 1,
        },
      });

      this.addClusterPopups(map);

      const countChip = ApiDocsMap.addOverlay(map, 'top-right', 'map-chip');
      countChip.textContent = `Showing ${clusters.features.length} clusters`;

      // The legend lists only the types actually drawn, so it never advertises one this region has none of.
      const typesInData = [...new Set(clusters.features.map((feature) => feature.properties.label_type))];
      const legend = ApiDocsMap.addOverlay(map, 'bottom-left', 'map-legend');
      ApiDocsMap.renderLabelTypeLegend(legend, 'Label Types', typesInData, labelTypeInfo,
        'No clusters in this region');
    },

    /**
     * Wire up the click popup and hover cursor for the cluster layer.
     * @param {object} map - The Mapbox map object
     */
    addClusterPopups(map) {
      map.on('click', CLUSTERS_LAYER, (e) => {
        const feature = e.features[0];
        const props = feature.properties;

        const severity = props.median_severity
          ? `Median Severity: ${props.median_severity}`
          : 'No severity rating';
        const avgLabelDate = props.avg_label_date
          ? `Avg. Label Date: ${new Date(props.avg_label_date).toLocaleDateString()}`
          : 'Unknown date';
        const clusterSize = `Cluster Size: ${props.cluster_size} labels`;
        const validation = `Validation: ${props.agree_count} agree, ${props.disagree_count} disagree, `
          + `${props.unsure_count} unsure`;

        ApiDocsMap.popup(map, feature.geometry.coordinates.slice(), `
          <h4>${props.label_type}</h4>
          <p>${labelTypeInfo[props.label_type]?.description || ''}</p>
          <p>${severity}</p>
          <p>${clusterSize}</p>
          <p>${avgLabelDate}</p>
          <p>${validation}</p>
          <p>Cluster ID: ${props.label_cluster_id}</p>
        `);
      });

      map.on('mouseenter', CLUSTERS_LAYER, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', CLUSTERS_LAYER, () => {
        map.getCanvas().style.cursor = '';
      });
    },
  };
})();

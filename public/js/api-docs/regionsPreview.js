/**
 * Regions Map Preview Generator.
 *
 * Renders a single live choropleth map of all of a city's regions (neighborhoods), fed directly from the
 * /v3/api/regions endpoint. A metric toggle recolors the same polygons by label count, completed-audit count, or
 * contributing-user count. Hover/click a region to see its full statistics.
 *
 * @requires A DOM element with id 'regions-preview'
 * @requires mapbox-gl and js/api-docs/apiDocsMap.js
 */

(function () {
  const REGION_SOURCE = 'regions';
  const FILL_LAYER = 'region-fill';
  const OUTLINE_LAYER = 'region-outline';

  let config = {
    apiBaseUrl: '/v3/api',
    mainContainerId: 'regions-preview',
    mapboxApiKey: '',
    regionsEndpoint: '/regions',
  };

  // Keyed by the GeoJSON property each one colors by. The ramps are picked to read against the dimmed basemap.
  const NONE_COLOR = ApiDocsTheme.color('--color-neutral-800');
  const METRICS = {
    label_count: {
      label: 'Label count', legendTitle: 'Labels per region',
      none: { color: NONE_COLOR, label: 'No labels' }, ramp: ['#440154', '#f0f921'],
    },
    audit_count: {
      label: 'Audit count', legendTitle: 'Completed audits per region',
      none: { color: NONE_COLOR, label: 'No completed audits' }, ramp: ['#0d3b2e', '#44ff88'],
    },
    user_count: {
      label: 'User count', legendTitle: 'Contributors per region',
      none: { color: NONE_COLOR, label: 'No contributors' }, ramp: ['#472c7a', '#ffffff'],
    },
  };

  window.RegionsPreview = {
    _legend: null,
    _metric: 'label_count',
    _maxByMetric: {},

    /**
     * Configure the regions preview.
     * @param {object} options - Configuration options
     * @returns {object} The RegionsPreview object for chaining
     */
    setup(options) {
      config = Object.assign(config, options);
      return this;
    },

    /**
     * Initialize the regions preview map.
     * @returns {Promise} A promise that resolves when the preview is rendered
     */
    async init() {
      const container = document.getElementById(config.mainContainerId);
      if (!container) {
        console.error('Regions preview container element not found.');
        return;
      }

      const loading = document.createElement('div');
      loading.className = 'loading-message';
      loading.textContent = 'Loading region data...';
      container.appendChild(loading);

      try {
        const regions = await this.fetchRegions();
        container.innerHTML = '';
        await this.renderMap(container, regions);
      } catch (error) {
        console.error('Error rendering regions preview:', error);
        container.innerHTML = '<div class="map-message">Unable to load region data for the preview.</div>';
      }
    },

    /**
     * Fetch all regions for the current city as a GeoJSON FeatureCollection.
     * @returns {Promise} A promise that resolves with the GeoJSON FeatureCollection
     */
    fetchRegions() {
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}${config.regionsEndpoint}?inline=true`);
    },

    /**
     * Build the map, draw the region polygons, and wire up the metric toggle and legend.
     * @param {HTMLElement} container - Container element for the map
     * @param {object} regions - GeoJSON FeatureCollection of regions
     * @returns {Promise} A promise that resolves once the map has loaded
     */
    async renderMap(container, regions) {
      const features = regions.features || [];

      // Each ramp is scaled to its own metric's maximum, so a narrow range still spans every color.
      Object.keys(METRICS).forEach((metric) => {
        this._maxByMetric[metric] = features.reduce((max, f) => Math.max(max, f.properties[metric] || 0), 0);
      });

      this.addToolbar(container);
      const mapElement = document.createElement('div');
      mapElement.id = 'regions-map';
      container.appendChild(mapElement);

      const bounds = features.length ? ApiDocsMap.featureCollectionBounds(features) : null;
      const map = await ApiDocsMap.create({
        container: mapElement,
        mapboxApiKey: config.mapboxApiKey,
        ...(bounds ? { bounds } : { center: [0, 0], zoom: 1 }),
      });

      if (!features.length) {
        this.addNoRegionsMessage(map);
        return;
      }

      // promoteId lifts region_id into the feature id that setFeatureState needs for the hover styling below.
      map.addSource(REGION_SOURCE, { type: 'geojson', data: regions, promoteId: 'region_id' });
      map.addLayer({
        id: FILL_LAYER,
        type: 'fill',
        source: REGION_SOURCE,
        paint: {
          'fill-color': this.colorExpression(),
          'fill-opacity': ApiDocsMap.whenHovered(0.85, 0.7),
        },
      });
      map.addLayer({
        id: OUTLINE_LAYER,
        type: 'line',
        source: REGION_SOURCE,
        paint: {
          'line-color': ApiDocsTheme.color('--color-neutral-white'),
          'line-width': ApiDocsMap.whenHovered(3, 1),
          'line-opacity': ApiDocsMap.whenHovered(1, 0.7),
        },
      });
      ApiDocsMap.addHoverState(map, FILL_LAYER, REGION_SOURCE);
      this.addRegionPopups(map);

      const countChip = ApiDocsMap.addOverlay(map, 'top-right', 'map-chip');
      countChip.textContent = `${features.length} region${features.length === 1 ? '' : 's'}`;

      this._legend = ApiDocsMap.addOverlay(map, 'bottom-left', 'map-legend');
      this.updateLegend();

      // Wired only now that there is a layer to recolor and a legend to rewrite.
      const select = document.getElementById('region-metric-select');
      select.value = this._metric;
      select.addEventListener('change', (event) => {
        this._metric = event.target.value;
        map.setPaintProperty(FILL_LAYER, 'fill-color', this.colorExpression());
        this.updateLegend();
      });
    },

    /**
     * Add the metric selector above the map, where a region popup can never cover it.
     * @param {HTMLElement} container - Container element for the whole preview
     */
    addToolbar(container) {
      const toolbar = document.createElement('div');
      toolbar.className = 'map-toolbar';
      const optionsHtml = Object.keys(METRICS)
        .map((metric) => `<option value="${metric}">${METRICS[metric].label}</option>`)
        .join('');
      toolbar.innerHTML = `<label for="region-metric-select">Color by</label>
        <select id="region-metric-select" class="ps-select">${optionsHtml}</select>`;
      container.appendChild(toolbar);
    },

    /**
     * Build the fill color expression for the currently selected metric.
     * @returns {Array} A Mapbox expression for `fill-color`
     */
    colorExpression() {
      const metricCfg = METRICS[this._metric];
      return ApiDocsMap.gradientColorExpression(this._metric, metricCfg.ramp, {
        // The ramp starts at 1, since 0 is the category below it — keep the legend's low tick in step.
        min: 1,
        max: this._maxByMetric[this._metric],
        noneColor: metricCfg.none.color,
        // A region nobody has touched should read differently from the least-labeled one someone has.
        noneAtOrBelow: 0,
      });
    },

    /**
     * Wire up the click popup for the region layer.
     * @param {object} map - The Mapbox map object
     */
    addRegionPopups(map) {
      map.on('click', FILL_LAYER, (e) => {
        const props = e.features[0].properties;
        const firstLabelDate = props.first_label_date
          ? new Date(props.first_label_date).toLocaleDateString()
          : 'No labels';
        const lastLabelDate = props.last_label_date
          ? new Date(props.last_label_date).toLocaleDateString()
          : 'No labels';

        ApiDocsMap.popup(map, e.lngLat, `
          <h4>${props.name || `Region ${props.region_id}`}</h4>
          <p><strong>Region ID:</strong> ${props.region_id}</p>
          <p><strong>Labels:</strong> ${props.label_count}</p>
          <p><strong>Streets:</strong> ${props.street_count}</p>
          <p><strong>Contributors:</strong> ${props.user_count}</p>
          <p><strong>Completed audits:</strong> ${props.audit_count}</p>
          <p><strong>First Label:</strong> ${firstLabelDate}</p>
          <p><strong>Last Label:</strong> ${lastLabelDate}</p>
          <a href="/labelmap?regions=${props.region_id}" class="button-ps button--primary button--tiny"
            target="_blank">
            View region on the label map
          </a>
        `);
      });
    },

    /**
     * (Re)build the continuous gradient legend for the currently selected metric.
     */
    updateLegend() {
      const metricCfg = METRICS[this._metric];
      // Clamped so a city where every region scores 0 on this metric doesn't label the bar 1 down to 0.
      const max = Math.max(1, this._maxByMetric[this._metric]);
      ApiDocsMap.renderGradientLegend(this._legend, metricCfg.legendTitle, metricCfg.ramp,
        ['1', max.toLocaleString()], metricCfg.none);
    },

    /**
     * Show a message when there are no regions to display.
     * @param {object} map - The Mapbox map object
     */
    addNoRegionsMessage(map) {
      const div = document.createElement('div');
      div.className = 'map-message';
      div.textContent = 'No regions found for this city.';
      map.getContainer().appendChild(div);
    },
  };
})();

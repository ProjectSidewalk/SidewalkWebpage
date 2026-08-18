/**
 * AccessScore: Regions Map Preview Generator.
 *
 * Renders a live choropleth of a city's regions, fed directly from /v3/api/accessScoreRegions. Regions are colored on a
 * fixed red→yellow→green ramp by AccessScore (default) or audit coverage — both already in [0, 1], so no rescaling is
 * needed. Hover/click a region to see its score, coverage, and audited-street counts.
 *
 * @requires A DOM element with id 'access-score-regions-preview'
 * @requires mapbox-gl and js/api-docs/apiDocsMap.js
 */

(function () {
  const REGION_SOURCE = 'access-score-regions';
  const FILL_LAYER = 'access-score-region-fill';
  const OUTLINE_LAYER = 'access-score-region-outline';

  let config = {
    apiBaseUrl: '/v3/api',
    mainContainerId: 'access-score-regions-preview',
    mapboxApiKey: '',
    endpoint: '/accessScoreRegions',
  };

  // Metrics that can be visualized. Both are already normalized to [0, 1], so the ramp domain is fixed.
  const METRICS = {
    score: { label: 'AccessScore', legendTitle: 'AccessScore (0 = low, 1 = high)' },
    coverage: { label: 'Audit coverage', legendTitle: 'Fraction of streets audited' },
  };

  const NONE_COLOR = '#3d3d3d'; // Regions with no audited streets (null score).

  window.AccessScoreRegionsPreview = {
    _legend: null,
    _metric: 'score',

    /** Apply caller config overrides. */
    setup(options) {
      config = Object.assign(config, options);
      return this;
    },

    /** Fetch the data and render the map (or a friendly message on failure). */
    async init() {
      const container = document.getElementById(config.mainContainerId);
      if (!container) {
        console.error('AccessScore regions preview container not found.');
        return;
      }

      const loading = document.createElement('div');
      loading.className = 'loading-message';
      loading.textContent = 'Loading AccessScore data...';
      container.appendChild(loading);

      try {
        const regions = await this.fetchRegions();
        container.innerHTML = '';
        await this.renderMap(container, regions);
      } catch (error) {
        console.error('Error rendering AccessScore regions preview:', error);
        container.innerHTML = '<div class="no-data-message">Unable to load AccessScore data for the preview.</div>';
      }
    },

    /** Fetch region AccessScores as a GeoJSON FeatureCollection. */
    fetchRegions() {
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}${config.endpoint}?inline=true`);
    },

    /** Build the map, draw region polygons, and wire the metric toggle and legend. */
    async renderMap(container, regions) {
      const features = regions.features || [];

      this.addToolbar(container);
      const mapElement = document.createElement('div');
      mapElement.id = 'access-score-regions-map';
      container.appendChild(mapElement);

      const bounds = features.length ? ApiDocsMap.featureCollectionBounds(features) : null;
      const map = await ApiDocsMap.create({
        container: mapElement,
        mapboxApiKey: config.mapboxApiKey,
        ...(bounds ? { bounds } : { center: [0, 0], zoom: 1 }),
      });

      if (!features.length) {
        this.addNoDataMessage(map, 'No regions found for this city.');
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
          'fill-opacity': ApiDocsMap.whenHovered(0.9, 0.75),
        },
      });
      map.addLayer({
        id: OUTLINE_LAYER,
        type: 'line',
        source: REGION_SOURCE,
        paint: {
          'line-color': '#ffffff',
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
      const select = document.getElementById('as-region-metric-select');
      select.value = this._metric;
      select.addEventListener('change', (event) => {
        this._metric = event.target.value;
        map.setPaintProperty(FILL_LAYER, 'fill-color', this.colorExpression());
        this.updateLegend();
      });
    },

    /** Add the metric selector above the map, where a region popup can never cover it. */
    addToolbar(container) {
      const toolbar = document.createElement('div');
      toolbar.className = 'as-toolbar';
      const optionsHtml = Object.keys(METRICS)
        .map((metric) => `<option value="${metric}">${METRICS[metric].label}</option>`).join('');
      toolbar.innerHTML = `<label for="as-region-metric-select">Color by</label>
        <select id="as-region-metric-select">${optionsHtml}</select>`;
      container.appendChild(toolbar);
    },

    /** Fill color for the selected metric, gray where the region has no score at all. */
    colorExpression() {
      return ApiDocsMap.gradientColorExpression(this._metric, ApiDocsMap.ACCESS_SCORE_RAMP, { noneColor: NONE_COLOR });
    },

    /** Wire up the click popup for the region layer. */
    addRegionPopups(map) {
      map.on('click', FILL_LAYER, (e) => {
        const p = e.features[0].properties;
        const score = (p.score === null || p.score === undefined) ? 'N/A (no audited streets)' : p.score.toFixed(3);
        const coverage = `${Math.round((p.coverage || 0) * 100)}%`;

        ApiDocsMap.popup(map, e.lngLat, `
          <h4>${p.name || `Region ${p.region_id}`}</h4>
          <p><span class="as-score">${score}</span> AccessScore</p>
          <p><strong>Coverage:</strong> ${coverage}
            (${p.audited_street_count} of ${p.total_street_count} streets audited)</p>
          <p><strong>Region ID:</strong> ${p.region_id}</p>
          <a href="/v3/api/accessScoreRegions?regionId=${p.region_id}&inline=true"
            class="map-popup-link" target="_blank">
            View this region's JSON
          </a>
        `);
      });
    },

    /** (Re)build the fixed 0→1 gradient legend for the selected metric. */
    updateLegend() {
      const metricCfg = METRICS[this._metric];
      ApiDocsMap.renderGradientLegend(this._legend, metricCfg.legendTitle, ApiDocsMap.ACCESS_SCORE_RAMP, '0', '1');
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
